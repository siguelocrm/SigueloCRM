import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { HORA, MIN, instante } from '../horario.js';
import { registrar } from '../registro.js';
import { cambiarEtapa } from '../motor.js';
import { etapasDelEmbudo, negocioDeLinea } from '../negocios.js';
import { aplicarNombre, normalizarTexto } from '../textos.js';
import { llamar } from '../ia/config.js';
import type { MensajeChat, ParteChat } from '../ia/openai.js';
import { PROMPT_COMPROBANTE, controlar, elegirCurso, formatoMonto, transaccionNormal, validarLectura } from './comprobante.js';
import type { CursoRow, EstadoPago, IaRow, PagoPorLeerRow, PagoRow, TextosCurso } from '../tipos.js';

// Inscripción con pago (Fase 5). Cada foto o PDF que manda un cliente a un
// número con cursos se lee con la IA: si es un comprobante y pasa los
// controles, se confirma solo, se le piden sus datos, se guardan en su ficha
// (campos, comprobante y oportunidad ganada) y se le manda el link del grupo.
// Si algo no cuadra queda "para revisar" y te avisa. Lo que se le manda al
// cliente sale por la bandeja de la IA (salida.ts).

type Config = { ia: IaRow; clave: string; zona: string };
type Campo = { id: string; nombre: string; tipo: string; opciones: string[] };
type Vuelta = { c: Config; cursos: CursoRow[]; campos: Map<string, Campo> | null };

const MAX_BYTES = 10 * 1024 * 1024;
const REINTENTAR_MS = 2 * MIN; // si la IA falló, se vuelve a intentar
const MAX_INTENTOS = 3;
const QUIETO_DATOS_MS = 30_000; // deja que el cliente termine de escribir sus datos
const MAX_RONDAS = 3; // veces que se le piden los datos que faltan
const AVISAR_SIN_DATOS_MS = 24 * HORA;
const NO_REPETIR_REVISAR_MS = 30 * MIN;
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);
const digitos = (t: string | null | undefined) => String(t || '').replace(/\D/g, '');
const ahoraISO = () => new Date().toISOString();

export const TEXTOS_POR_DEFECTO: TextosCurso = {
  confirmado: '¡Listo, {nombre}! Recibimos tu pago de {monto} para {curso}. ✅',
  pedir_datos: 'Para completar tu inscripción, envíame por favor:\n{datos}',
  falta: '¡Gracias! Solo me falta:\n{datos}',
  link: '¡Ya estás inscrito en {curso}! 🎉 Únete al grupo aquí:\n{link}',
  revisar: 'Recibimos tu comprobante 🙌 Lo estamos revisando y en un momento te confirmamos.',
  rechazado: 'No pudimos validar tu comprobante: {motivo}. Si crees que es un error, escríbenos por aquí.',
};

// ¿Hay un pago en curso en esta conversación? Mientras tanto la IA no le responde
// (sus mensajes son sus datos, o ya se le contestó por el pago).
export async function pagoEnCurso(conversacionId: string): Promise<boolean> {
  const { data, error } = await db
    .from('siguelo_pagos')
    .select('estado, actualizado_en')
    .eq('conversacion_id', conversacionId)
    .in('estado', ['leyendo', 'revisar', 'rechazado', 'datos', 'inscrito'])
    .order('actualizado_en', { ascending: false })
    .limit(1);
  if (error || !data?.length) return false;
  const p = data[0];
  return p.estado === 'leyendo' || p.estado === 'datos' || Date.now() - ms(p.actualizado_en) < 3 * MIN;
}

// ---------- Pequeñas ayudas ----------

const textosDe = (curso: CursoRow | null | undefined): TextosCurso => ({ ...TEXTOS_POR_DEFECTO, ...(curso?.textos || {}) });

// {curso}, {monto}, {datos}, {link}, {motivo} y {nombre} (sin nombre, se quita con su coma).
function rellenar(texto: string, nombre: string | null | undefined, variables: Record<string, string>): string {
  const r = String(texto || '').replace(/\{([\p{L}_]+)\}/gu, (marca, clave: string) => {
    const k = clave.toLowerCase();
    return k === 'nombre' ? marca : (variables[k] ?? '');
  });
  return aplicarNombre(r, nombre).trim();
}

function textoLink(curso: CursoRow, nombre: string | null, variables: Record<string, string>): string {
  if (!curso.link_grupo.trim()) return rellenar('¡Ya estás inscrito en {curso}! 🎉', nombre, variables);
  return rellenar(textosDe(curso).link, nombre, { ...variables, link: curso.link_grupo.trim() });
}

const lista = (campos: Campo[]) => campos.map((f) => `• ${f.nombre}`).join('\n');

// "YYYY-MM-DD HH:mm" en la zona del negocio → milisegundos.
function fechaPago(fecha: string | null, zona: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(fecha || '');
  if (!m) return null;
  const t = instante(`${m[1]}-${m[2]}-${m[3]}`, m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '12:00', zona);
  return Number.isFinite(t) ? t : null;
}

const formatear = (ts: number, zona: string) =>
  new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts));

// Ruta del archivo dentro del bucket "media" (para guardarlo como documento del contacto).
const rutaDe = (url: string) => decodeURIComponent(url.split('/object/public/media/')[1] || url);

async function descargar(url: string): Promise<{ datos: Buffer; mime: string } | string> {
  try {
    const r = await fetch(url);
    if (!r.ok) return `no se pudo descargar el archivo (${r.status})`;
    const datos = Buffer.from(await r.arrayBuffer());
    if (datos.length > MAX_BYTES) return 'el archivo pesa más de 10 MB';
    return { datos, mime: r.headers.get('content-type') || '' };
  } catch (err) {
    return `no se pudo descargar el archivo (${(err as Error).message})`;
  }
}

// La parte del mensaje para la IA según lo que es el archivo de verdad (WhatsApp guarda todo documento como "pdf").
function parteDe(datos: Buffer): ParteChat | null {
  const b64 = datos.toString('base64');
  const cabeza = datos.subarray(0, 12);
  if (cabeza.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'file', file: { filename: 'comprobante.pdf', file_data: `data:application/pdf;base64,${b64}` } };
  const mime =
    cabeza[0] === 0xff && cabeza[1] === 0xd8 ? 'image/jpeg'
    : cabeza[0] === 0x89 && cabeza.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png'
    : cabeza.subarray(0, 4).toString('latin1') === 'RIFF' && cabeza.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
    : '';
  return mime ? { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' } } : null;
}

async function actualizar(pago: PagoRow, cambios: Partial<PagoRow>): Promise<void> {
  Object.assign(pago, cambios);
  const { error } = await db.from('siguelo_pagos').update({ ...cambios, actualizado_en: ahoraISO() }).eq('id', pago.id);
  if (error) console.error('Pagos: no se pudo guardar un pago:', error.message);
}

async function contactoDe(id: string | null) {
  if (!id) return null;
  const { data } = await db.from('contactos').select('id, nombre, telefono, etapa_id').eq('id', id).maybeSingle();
  return data;
}

async function asegurarContacto(empresaId: string, telefono: string): Promise<string | null> {
  const { data } = await db.from('contactos').select('id').eq('empresa_id', empresaId).eq('telefono', telefono).maybeSingle();
  if (data) return data.id;
  const { data: nuevo } = await db.from('contactos').insert({ empresa_id: empresaId, telefono }).select('id').maybeSingle();
  return nuevo?.id ?? null;
}

const quien = (nombre: string | null | undefined, telefono: string) => {
  const tel = digitos(telefono.split('@')[0]);
  return `*${nombre?.trim() || `+${tel}`}*${nombre?.trim() && tel ? ` (+${tel})` : ''}`;
};

// Lo que se le manda al cliente sale por la bandeja de la IA, en orden y ya aprobado.
async function mandar(x: Vuelta, pago: PagoRow, mensajes: { tipo: string; texto: string }[]): Promise<void> {
  const filas = mensajes.filter((m) => m.texto.trim());
  if (!filas.length || !pago.linea_id) return;
  const lote = randomUUID();
  const { error } = await db.from('siguelo_ia_salida').insert(
    filas.map((m, orden) => ({
      empresa_id: x.c.ia.empresa_id,
      conversacion_id: pago.conversacion_id,
      contacto_id: pago.contacto_id,
      linea_id: pago.linea_id!,
      telefono: pago.telefono,
      origen: 'pago' as const,
      referencia: m.tipo,
      contenido: m.texto,
      estado: 'pendiente' as const,
      aprobado: true,
      lote,
      orden,
      vence: ahoraISO(),
    })),
  );
  if (error) console.error('Pagos: no se pudo dejar el mensaje para el cliente:', error.message);
}

// Aviso a tu WhatsApp personal (los de la IA), si están activos y no apagaste los de pagos.
async function avisar(x: Vuelta, pago: PagoRow, texto: string): Promise<void> {
  const av = x.c.ia.avisos;
  if (!av?.activo || digitos(av.telefono).length < 7 || av.tipos?.pago === false || !pago.linea_id) return;
  await db.from('siguelo_ia_salida').insert({
    empresa_id: x.c.ia.empresa_id,
    contacto_id: pago.contacto_id,
    linea_id: av.linea_id || pago.linea_id,
    telefono: digitos(av.telefono),
    origen: 'aviso',
    referencia: 'pago',
    contenido: `• ${texto}`,
    vence: new Date(Date.now() + Math.max(0, av.juntar_min || 0) * MIN).toISOString(),
  });
}

async function campos(x: Vuelta): Promise<Map<string, Campo>> {
  if (!x.campos) {
    const { data } = await db.from('campos_personalizados').select('id, nombre, tipo, opciones').eq('empresa_id', x.c.ia.empresa_id);
    x.campos = new Map((data || []).map((f) => [f.id, { ...f, opciones: Array.isArray(f.opciones) ? f.opciones : [] }]));
  }
  return x.campos;
}

// Los datos del curso que todavía no tiene: los que mandó en este pago o ya estaban en su ficha no se piden.
async function datosQueFaltan(x: Vuelta, curso: CursoRow, contactoId: string, datos: Record<string, string>): Promise<Campo[]> {
  const todos = await campos(x);
  const ids = (curso.datos || []).filter((id) => id === 'nombre' || todos.has(id));
  const { data: tiene } = await db.from('contacto_campos').select('campo_id, valor').eq('contacto_id', contactoId);
  const enFicha = new Map((tiene || []).map((v) => [v.campo_id, v.valor] as const));
  return ids
    .filter((id) => !datos[id]?.trim() && (id === 'nombre' || !enFicha.get(id)?.trim()))
    .map((id) => (id === 'nombre' ? { id, nombre: 'Nombre completo', tipo: 'texto', opciones: [] } : todos.get(id)!));
}

async function guardarDato(contactoId: string, campo: Campo, valor: string): Promise<void> {
  if (campo.id === 'nombre') await db.from('contactos').update({ nombre: valor }).eq('id', contactoId);
  else await db.from('contacto_campos').upsert({ contacto_id: contactoId, campo_id: campo.id, valor }, { onConflict: 'contacto_id,campo_id' });
}

// La oportunidad del curso queda ganada (la abierta del mismo curso, o una nueva).
async function oportunidadGanada(empresaId: string, contactoId: string, curso: CursoRow, monto: number): Promise<string | null> {
  const ahora = ahoraISO();
  const { data: abiertas } = await db.from('oportunidades').select('id, producto').eq('contacto_id', contactoId).eq('estado', 'abierta');
  const misma = (abiertas || []).find((o) => normalizarTexto(o.producto) === normalizarTexto(curso.nombre));
  const cambios = { producto: curso.nombre, monto, probabilidad: 100, estado: 'ganada' as const, cerrada_en: ahora, actualizado_en: ahora };
  if (misma) {
    await db.from('oportunidades').update(cambios).eq('id', misma.id);
    return misma.id;
  }
  const { data } = await db
    .from('oportunidades')
    .insert({ empresa_id: empresaId, contacto_id: contactoId, ...cambios, nota: 'Pagó por QR: comprobante revisado por SígueloCRM' })
    .select('id')
    .maybeSingle();
  return data?.id ?? null;
}

// Pasa a la etapa del curso, o a la "ganada" del embudo de su negocio.
async function moverDeEtapa(empresaId: string, contacto: { id: string; etapa_id: string | null }, curso: CursoRow, lineaId: string | null): Promise<string> {
  const negocio = lineaId ? await negocioDeLinea(lineaId) : null;
  const etapas = await etapasDelEmbudo(empresaId, negocio?.embudo_id ?? null);
  let destino = curso.etapa_id ? etapas.find((e) => e.id === curso.etapa_id) : etapas.find((e) => e.tipo === 'ganada');
  if (!destino && curso.etapa_id) {
    const { data } = await db.from('etapas_venta').select('id, empresa_id, nombre, tipo, orden, probabilidad').eq('id', curso.etapa_id).maybeSingle();
    destino = data ?? undefined;
  }
  if (!destino || destino.id === contacto.etapa_id) return '';
  await cambiarEtapa(empresaId, contacto.id, destino);
  return destino.nombre;
}

// ---------- Lo que pasa con cada pago ----------

async function confirmar(x: Vuelta, pago: PagoRow, curso: CursoRow, aMano = false): Promise<void> {
  const empresaId = x.c.ia.empresa_id;
  const contacto = await contactoDe(pago.contacto_id);
  if (!contacto) return actualizar(pago, { estado: 'revisar', motivo: 'No se encontró el contacto', accion: null });
  const monto = pago.monto ?? Number(curso.precio);
  const hechos: string[] = [];

  if (pago.media_url) {
    const fecha = new Intl.DateTimeFormat('es', { timeZone: x.c.zona, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms(pago.pagado_en) || Date.now()));
    const { error } = await db
      .from('contacto_documentos')
      .insert({ contacto_id: contacto.id, nombre: `Comprobante ${curso.nombre} ${fecha.replace(/\//g, '-')}`, ruta: rutaDe(pago.media_url), url: pago.media_url, subido_por: null });
    if (!error) hechos.push('comprobante en su ficha');
  }
  const oportunidadId = await oportunidadGanada(empresaId, contacto.id, curso, monto);
  if (oportunidadId) hechos.push(`oportunidad ganada de ${formatoMonto(monto, curso.moneda)}`);
  const etapa = await moverDeEtapa(empresaId, contacto, curso, pago.linea_id);
  if (etapa) hechos.push(`pasó a "${etapa}"`);

  const faltan = await datosQueFaltan(x, curso, contacto.id, pago.datos);
  const variables = { curso: curso.nombre, monto: formatoMonto(monto, curso.moneda) };
  const t = textosDe(curso);
  const estado: EstadoPago = faltan.length ? 'datos' : 'inscrito';
  await mandar(x, pago, [
    { tipo: 'confirmado', texto: rellenar(t.confirmado, contacto.nombre, variables) },
    faltan.length
      ? { tipo: 'pedir_datos', texto: rellenar(t.pedir_datos, contacto.nombre, { ...variables, datos: lista(faltan) }) }
      : { tipo: 'link', texto: textoLink(curso, contacto.nombre, variables) },
  ]);
  await actualizar(pago, { estado, motivo: null, accion: null, oportunidad_id: oportunidadId, curso_id: curso.id });
  if (!aMano) {
    await avisar(x, pago, `💰 ${quien(contacto.nombre, pago.telefono)} pagó ${formatoMonto(monto, curso.moneda)} por "${curso.nombre}": ✅ confirmado solo${faltan.length ? ', falta que mande sus datos' : ' y se le mandó el link'}.`);
  }
  await registrar(empresaId, contacto.id, 'pago', `Pago de ${quien(contacto.nombre, pago.telefono).replace(/\*/g, '')} confirmado${aMano ? ' a mano' : ''} (${curso.nombre}, ${formatoMonto(monto, curso.moneda)}): ${[...hechos, faltan.length ? 'se le piden sus datos' : 'se le mandó el link'].join(' · ')}.`);
}

async function rechazar(x: Vuelta, pago: PagoRow, curso: CursoRow | null, motivo: string, aMano = false): Promise<void> {
  const contacto = await contactoDe(pago.contacto_id);
  await mandar(x, pago, [{ tipo: 'rechazado', texto: rellenar(textosDe(curso ?? x.cursos[0]).rechazado, contacto?.nombre, { motivo, curso: curso?.nombre ?? '' }) }]);
  await actualizar(pago, { estado: 'rechazado', motivo, accion: null });
  if (!aMano) await avisar(x, pago, `❌ Comprobante de ${quien(contacto?.nombre, pago.telefono)} rechazado: ${motivo}.`);
  await registrar(x.c.ia.empresa_id, pago.contacto_id, 'pago', `Comprobante de ${quien(contacto?.nombre, pago.telefono).replace(/\*/g, '')} rechazado${aMano ? ' a mano' : ''}: ${motivo}.`);
}

async function paraRevisar(x: Vuelta, pago: PagoRow, curso: CursoRow | null, motivo: string): Promise<void> {
  const contacto = await contactoDe(pago.contacto_id);
  // Un solo "lo estamos revisando" por conversación cada media hora.
  const { count } = pago.conversacion_id
    ? await db
        .from('siguelo_ia_salida')
        .select('id', { count: 'exact', head: true })
        .eq('conversacion_id', pago.conversacion_id)
        .eq('origen', 'pago')
        .eq('referencia', 'revisar')
        .gte('creado_en', new Date(Date.now() - NO_REPETIR_REVISAR_MS).toISOString())
    : { count: 1 };
  if (!count) await mandar(x, pago, [{ tipo: 'revisar', texto: rellenar(textosDe(curso ?? x.cursos[0]).revisar, contacto?.nombre, { curso: curso?.nombre ?? '' }) }]);
  await actualizar(pago, { estado: 'revisar', motivo, accion: null });
  const monto = pago.monto != null ? ` de ${formatoMonto(pago.monto, curso?.moneda || 'Bs')}` : '';
  await avisar(x, pago, `⚠️ ${quien(contacto?.nombre, pago.telefono)} mandó un comprobante${monto} que tienes que revisar: ${motivo}.`);
  await registrar(x.c.ia.empresa_id, pago.contacto_id, 'pago', `Comprobante de ${quien(contacto?.nombre, pago.telefono).replace(/\*/g, '')} para revisar: ${motivo}.`);
}

async function inscribir(x: Vuelta, pago: PagoRow, curso: CursoRow, aMano = false): Promise<void> {
  const contacto = await contactoDe(pago.contacto_id);
  await mandar(x, pago, [{ tipo: 'link', texto: textoLink(curso, contacto?.nombre ?? null, { curso: curso.nombre, monto: formatoMonto(pago.monto, curso.moneda) }) }]);
  await actualizar(pago, { estado: 'inscrito', motivo: null, accion: null });
  if (!aMano) await avisar(x, pago, `🎓 ${quien(contacto?.nombre, pago.telefono)} completó su inscripción en "${curso.nombre}".`);
  await registrar(x.c.ia.empresa_id, pago.contacto_id, 'pago', `${quien(contacto?.nombre, pago.telefono).replace(/\*/g, '')} quedó inscrito en ${curso.nombre}${aMano ? ' (a mano)' : ''}.`);
}

async function fallo(x: Vuelta, pago: PagoRow, motivo: string, rendirse = false): Promise<void> {
  const intentos = pago.intentos + 1;
  if (rendirse || intentos >= MAX_INTENTOS) {
    pago.intentos = intentos;
    return paraRevisar(x, pago, null, `La IA no pudo leer el comprobante: ${motivo}`);
  }
  await actualizar(pago, { intentos });
  await registrar(x.c.ia.empresa_id, pago.contacto_id, 'ia_error', `Pagos: no se pudo leer un comprobante (${motivo}); se reintenta en 2 min.`);
}

// Lee el comprobante con la IA y decide. Devuelve false si la IA falló.
async function leerComprobante(x: Vuelta, pago: PagoRow): Promise<boolean> {
  const { c } = x;
  const archivo = pago.media_url ? await descargar(pago.media_url) : 'no tiene archivo';
  if (typeof archivo === 'string') {
    await fallo(x, pago, archivo);
    return true;
  }
  const parte = parteDe(archivo.datos);
  if (!parte) {
    await actualizar(pago, { estado: 'no_es', motivo: 'No es una imagen ni un PDF' });
    return true;
  }
  const negocio = pago.linea_id ? await negocioDeLinea(pago.linea_id) : null;
  const candidatos = x.cursos.filter((k) => k.activo && (!k.negocio_id || k.negocio_id === negocio?.id));
  const referencia = candidatos.map((k) => `- ${k.nombre}: ${formatoMonto(k.precio, k.moneda)}`).join('\n');
  const mensajes: MensajeChat[] = [
    { role: 'system', content: `Eres un auditor experto en detectar comprobantes de pago falsos. Fecha y hora actual: ${formatear(Date.now(), c.zona)}.` },
    { role: 'user', content: [{ type: 'text', text: `${PROMPT_COMPROBANTE}${referencia ? `\n\nPara tu referencia, lo que se cobra:\n${referencia}` : ''}` }, parte] },
  ];
  const r = await llamar(c, mensajes);
  if (!r.ok) {
    await fallo(x, pago, r.mensaje, !!r.cupo);
    return false;
  }
  const l = validarLectura(r.json);
  if (!l.es_comprobante) {
    await actualizar(pago, { estado: 'no_es', lectura: l, motivo: 'No es un comprobante de pago' });
    return true;
  }
  const curso = elegirCurso(candidatos, l);
  const contactoId = pago.contacto_id ?? (await asegurarContacto(c.ia.empresa_id, pago.telefono));
  const pagadoEn = fechaPago(l.fecha, c.zona);
  const transaccion = transaccionNormal(l.transaccion);

  // La misma transacción: si es del mismo cliente es que lo volvió a mandar (no se hace nada).
  let repetido = false;
  if (transaccion) {
    const { data: usados } = await db
      .from('siguelo_pagos')
      .select('id, contacto_id')
      .eq('empresa_id', c.ia.empresa_id)
      .eq('transaccion', transaccion)
      .in('estado', ['revisar', 'datos', 'inscrito'])
      .neq('id', pago.id);
    if ((usados || []).some((u) => u.contacto_id === contactoId)) {
      await actualizar(pago, { estado: 'no_es', lectura: l, contacto_id: contactoId, transaccion, motivo: 'Ya había mandado este comprobante' });
      return true;
    }
    repetido = !!usados?.length;
  }
  let yaInscrito = false;
  if (curso && contactoId) {
    const { count } = await db
      .from('siguelo_pagos')
      .select('id', { count: 'exact', head: true })
      .eq('contacto_id', contactoId)
      .eq('curso_id', curso.id)
      .in('estado', ['datos', 'inscrito'])
      .neq('id', pago.id);
    yaInscrito = !!count;
  }

  const v = controlar(l, curso, { pagadoEn, ahora: Date.now(), repetido, yaInscrito });
  await actualizar(pago, {
    contacto_id: contactoId,
    curso_id: curso?.id ?? null,
    lectura: l,
    controles: v.controles,
    monto: l.monto,
    transaccion,
    pagado_en: pagadoEn ? new Date(pagadoEn).toISOString() : null,
  });
  if (v.resultado === 'ok' && curso) await confirmar(x, pago, curso);
  else if (v.resultado === 'rechazar') await rechazar(x, pago, curso, v.motivo);
  else await paraRevisar(x, pago, curso, v.motivo);
  return true;
}

// Lee los datos que mandó el cliente después de pagar.
async function leerDatos(x: Vuelta, pago: PagoRow): Promise<void> {
  const curso = x.cursos.find((k) => k.id === pago.curso_id);
  if (!curso || !pago.conversacion_id || !pago.contacto_id) return;
  const contacto = await contactoDe(pago.contacto_id);
  if (!contacto) return;
  const desde = pago.datos_leido ?? pago.datos_desde ?? pago.creado_en;
  const { data: nuevos } = await db
    .from('mensajes')
    .select('tipo, contenido, creado_en')
    .eq('conversacion_id', pago.conversacion_id)
    .eq('remitente', 'cliente')
    .gt('creado_en', desde)
    .order('creado_en')
    .limit(20);
  if (!nuevos?.length) {
    if (!pago.avisado && Date.now() - ms(pago.datos_desde ?? pago.creado_en) > AVISAR_SIN_DATOS_MS) {
      await avisar(x, pago, `⏳ ${quien(contacto.nombre, pago.telefono)} pagó "${curso.nombre}" pero todavía no mandó sus datos.`);
      await actualizar(pago, { avisado: true });
    }
    return;
  }
  const ultimo = nuevos[nuevos.length - 1].creado_en;
  if (Date.now() - ms(ultimo) < QUIETO_DATOS_MS) return;

  const faltan = await datosQueFaltan(x, curso, contacto.id, pago.datos);
  if (!faltan.length) return inscribir(x, pago, curso);
  const textos = nuevos.filter((m) => m.tipo === 'texto' && m.contenido?.trim()).map((m) => m.contenido!.trim());
  if (!textos.length) return actualizar(pago, { datos_leido: ultimo });

  const ids = new Map(faltan.map((f, i) => [`d${i + 1}`, f] as const));
  const detalle = (f: Campo) =>
    f.tipo === 'fecha' ? ' (fecha, en formato AAAA-MM-DD)' : f.tipo === 'numero' ? ' (número)' : f.tipo === 'seleccion' && f.opciones.length ? ` (una de: ${f.opciones.join(', ')})` : '';
  const r = await llamar(x.c, [
    {
      role: 'system',
      content: `Ayudas a inscribir a un cliente que ya pagó. De sus mensajes, extrae SOLO estos datos (id: dato):
${[...ids].map(([k, f]) => `- ${k}: ${f.nombre}${detalle(f)}`).join('\n')}
Responde SOLO con JSON: {"datos": {"d1": "valor" o null, ...}}. No inventes nada: si un dato no está, null. El nombre completo lleva nombre y apellido.`,
    },
    { role: 'user', content: textos.join('\n') },
  ]);
  if (!r.ok) {
    const intentos = pago.intentos + 1;
    if (intentos >= MAX_INTENTOS || r.cupo) await paraRevisar(x, pago, curso, `La IA no pudo leer sus datos: ${r.mensaje}`);
    else await actualizar(pago, { intentos });
    return;
  }
  const crudo = (r.json.datos && typeof r.json.datos === 'object' ? r.json.datos : {}) as Record<string, unknown>;
  const datos = { ...pago.datos };
  for (const [k, f] of ids) {
    const valor = crudo[k] == null ? '' : String(crudo[k]).trim().slice(0, 300);
    if (!valor || /^null$/i.test(valor)) continue;
    datos[f.id] = valor;
    await guardarDato(contacto.id, f, valor);
  }
  const siguen = faltan.filter((f) => !datos[f.id]);
  const rondas = pago.rondas + 1;
  await actualizar(pago, { datos, datos_leido: ultimo, rondas, intentos: 0 });
  if (!siguen.length) return inscribir(x, pago, curso);
  if (rondas >= MAX_RONDAS) return paraRevisar(x, pago, curso, `Faltan sus datos: ${siguen.map((f) => f.nombre).join(', ')}`);
  await mandar(x, pago, [{ tipo: 'falta', texto: rellenar(textosDe(curso).falta, contacto.nombre, { curso: curso.nombre, datos: lista(siguen) }) }]);
}

// Lo que pediste desde la pantalla: confirmar o rechazar.
async function hacerAccion(x: Vuelta, pago: PagoRow): Promise<void> {
  const accion = pago.accion;
  const { data: tomado } = await db.from('siguelo_pagos').update({ accion: null }).eq('id', pago.id).eq('accion', accion!).select('id');
  if (!tomado?.length) return;
  pago.accion = null;
  const curso = x.cursos.find((k) => k.id === pago.curso_id) ?? null;
  if (accion === 'confirmar') {
    if (!curso) return actualizar(pago, { motivo: 'Elige el curso antes de confirmar' });
    if (pago.estado === 'datos') return inscribir(x, pago, curso, true);
    if (pago.estado !== 'inscrito') {
      if (!pago.contacto_id) await actualizar(pago, { contacto_id: await asegurarContacto(x.c.ia.empresa_id, pago.telefono) });
      return confirmar(x, pago, curso, true);
    }
  } else if (accion === 'rechazar' && pago.estado !== 'inscrito' && pago.estado !== 'datos') {
    return rechazar(x, pago, curso, pago.motivo?.trim() || 'no pudimos validar los datos del pago', true);
  }
}

// Una vuelta (cada 10 s): comprobantes nuevos, reintentos, lo que pediste y los datos.
export async function revisarPagos(c: Config): Promise<void> {
  const { data: cursos, error } = await db.from('siguelo_cursos').select('*').eq('empresa_id', c.ia.empresa_id);
  if (error || !cursos?.length) return; // sin la Fase 5 pegada, o sin cursos
  const x: Vuelta = { c, cursos, campos: null };
  const empresaId = c.ia.empresa_id;

  const { data: nuevos } = await db.rpc('siguelo_pagos_por_leer', { p_empresa: empresaId });
  for (const m of (nuevos || []).slice(0, 3) as PagoPorLeerRow[]) {
    const { data: pago } = await db
      .from('siguelo_pagos')
      .insert({
        empresa_id: empresaId,
        contacto_id: m.contacto_id,
        conversacion_id: m.conversacion_id,
        linea_id: m.linea_id,
        telefono: m.telefono,
        mensaje_id: m.mensaje_id,
        media_url: m.media_url,
        estado: 'leyendo',
        datos_desde: m.creado_en,
        creado_en: ahoraISO(),
        actualizado_en: ahoraISO(),
      })
      .select('*')
      .maybeSingle();
    if (pago && !(await leerComprobante(x, pago))) return; // si la IA falla, no insiste con los demás
  }

  const { data: reintentos } = await db
    .from('siguelo_pagos')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('estado', 'leyendo')
    .lt('actualizado_en', new Date(Date.now() - REINTENTAR_MS).toISOString())
    .order('actualizado_en')
    .limit(3);
  for (const pago of reintentos || []) if (!(await leerComprobante(x, pago))) return;

  const { data: acciones } = await db.from('siguelo_pagos').select('*').eq('empresa_id', empresaId).in('accion', ['confirmar', 'rechazar']).limit(10);
  for (const pago of acciones || []) await hacerAccion(x, pago);

  const { data: conDatos } = await db.from('siguelo_pagos').select('*').eq('empresa_id', empresaId).eq('estado', 'datos').order('actualizado_en').limit(10);
  for (const pago of conDatos || []) await leerDatos(x, pago);
}

// Para el QR de la IA: los cursos de un negocio con su imagen de pago.
export async function cursosConQR(empresaId: string, negocioId: string): Promise<CursoRow[]> {
  const { data, error } = await db.from('siguelo_cursos').select('*').eq('empresa_id', empresaId).eq('activo', true);
  if (error) return [];
  return (data || []).filter((k) => k.qr_url && (!k.negocio_id || k.negocio_id === negocioId));
}
