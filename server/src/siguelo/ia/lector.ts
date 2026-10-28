import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { HORA, MIN, ajustar, fechaDe, instante } from '../horario.js';
import { registrar } from '../registro.js';
import { cambiarEtapa } from '../motor.js';
import { etapasDelEmbudo, negocioDeLinea, otrosNegocios, lineaDeNegocio, reglasDelNumero } from '../negocios.js';
import { llamar } from './config.js';
import { cursosConQR, pagoEnCurso } from '../pagos/inscripcion.js';
import { formatoMonto } from '../pagos/comprobante.js';
import { datosClubParaIA } from '../club/club.js';
import { armarMensajes, validarResultado, type DatosContexto, type LineaConversacion, type ResultadoIA } from './contexto.js';
import type { CursoRow, EtapaVentaRow, IaRow, LecturaRow, NegocioRow, PorLeerRow, SalidaRow, TipoAviso } from '../tipos.js';

// La IA lee cada conversación cuando el cliente termina de escribir y, con la
// ficha del negocio de ese número: mueve de etapa, anota lo que necesita que
// lo veas, te avisa, y responde (o deja la respuesta para que la apruebes) con
// respuestas rápidas, el link de un grupo o el pase a otra sucursal. Lo que
// manda lo envía salida.ts. Es contenido/ia.js de la extensión, en el servidor.

type Config = { ia: IaRow; clave: string; zona: string };

const QUIETO_SEG = 45; // deja que el cliente termine de escribir (suelen mandar varios mensajes)
const NO_RESPONDER_VIEJOS_MS = 2 * HORA; // no se contestan mensajes viejos
const REPETIR_AVISO_MS = 6 * HORA; // el mismo tipo de aviso del mismo cliente, como mucho cada 6 h
const ESPERA_REPETIR_MS = 12 * HORA; // el "déjame consultarlo", como mucho cada 12 h
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);
const digitos = (t: string | null | undefined) => String(t || '').replace(/\D/g, '');

// ¿Es tu WhatsApp personal (el de los avisos)? A ese nunca le responde la IA.
const esNumeroPersonal = (telefono: string, personal: string) => {
  const a = digitos(telefono.split('@')[0]);
  const b = digitos(personal);
  return b.length >= 7 && a.length >= 7 && (a.endsWith(b) || b.endsWith(a));
};

const formatear = (iso: string, zona: string) =>
  new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// Respuestas rápidas del negocio (las de todos y las suyas) que este cliente todavía no recibió.
async function respuestasDisponibles(empresaId: string, negocioId: string, yaEnviadas: Set<string>) {
  const [{ data: respuestas }, { data: asignadas }, cuando] = await Promise.all([
    db.from('respuestas_rapidas').select('id, empresa_id, titulo, atajo, contenido, tipo, media_url').eq('empresa_id', empresaId).order('titulo'),
    db.from('siguelo_respuesta_negocio').select('respuesta_id, negocio_id'),
    cuandoDe(empresaId, 'respuesta'),
  ]);
  const de = new Map<string, string[]>();
  for (const a of asignadas || []) de.set(a.respuesta_id, [...(de.get(a.respuesta_id) || []), a.negocio_id]);
  return (respuestas || [])
    .filter((r) => !yaEnviadas.has(r.id) && (!de.get(r.id)?.length || de.get(r.id)!.includes(negocioId)))
    .map((r) => ({ ...r, cuando: cuando.get(r.id) || '' }));
}

// "Cuándo la usa la IA" de cada respuesta rápida o regla del bot (sin la última versión del SQL, ninguno).
async function cuandoDe(empresaId: string, tipo: 'respuesta' | 'bot'): Promise<Map<string, string>> {
  const { data, error } = await db.from('siguelo_cuando_ia').select('item_id, cuando').eq('empresa_id', empresaId).eq('tipo', tipo);
  if (error) return new Map();
  return new Map((data || []).filter((x) => x.cuando.trim()).map((x) => [x.item_id, x.cuando.trim()] as const));
}

// Reglas y flujos del bot de este número que la IA puede activar: los que tienen "cuándo",
// y no se le activaron a este cliente en las últimas 24 h.
async function botsDisponibles(empresaId: string, lineaId: string, conversacionId: string) {
  const cuando = await cuandoDe(empresaId, 'bot');
  if (!cuando.size) return [];
  const [{ data: reglas }, { data: usados }] = await Promise.all([
    db.from('respuestas_automaticas').select('id, nombre, palabra_clave, tipo, flujo, pasos').eq('empresa_id', empresaId).eq('activo', true).in('id', [...cuando.keys()]),
    db.from('siguelo_ia_salida').select('referencia').eq('conversacion_id', conversacionId).eq('origen', 'bot').in('estado', ['pendiente', 'enviando', 'enviado']).gte('creado_en', new Date(Date.now() - 24 * HORA).toISOString()),
  ]);
  const ya = new Set((usados || []).map((x) => x.referencia));
  const delNumero = await reglasDelNumero(reglas || [], lineaId);
  return delNumero.filter((r) => !ya.has(r.id)).map((r) => ({ id: r.id, nombre: r.nombre || r.palabra_clave, cuando: cuando.get(r.id)! }));
}

// ¿Hay un flujo del bot esperando la respuesta de este cliente? Entonces contesta el bot, no la IA.
async function flujoEsperando(conversacionId: string): Promise<boolean> {
  const { data } = await db.from('bot_sesiones').select('actualizado_en').eq('conversacion_id', conversacionId).maybeSingle();
  return !!data && Date.now() - ms(data.actualizado_en) < 24 * HORA;
}

// Lo que ya se le mandó (o está por mandarse) a este cliente: cada respuesta rápida y cada grupo, una sola vez.
async function referenciasEnviadas(contactoId: string | null, conversacionId: string): Promise<Set<string>> {
  const consulta = db.from('siguelo_ia_salida').select('referencia').in('origen', ['respuesta_rapida', 'grupo']).in('estado', ['pendiente', 'enviando', 'enviado']);
  const { data } = contactoId ? await consulta.eq('contacto_id', contactoId) : await consulta.eq('conversacion_id', conversacionId);
  return new Set((data || []).map((x) => x.referencia).filter((x): x is string => !!x));
}

// Cursos con QR de pago de este negocio (Fase 5). El QR de cada uno, como mucho cada 6 h al mismo cliente.
async function cursosDisponibles(empresaId: string, negocioId: string, conversacionId: string): Promise<CursoRow[]> {
  const cursos = await cursosConQR(empresaId, negocioId);
  if (!cursos.length) return [];
  const { data } = await db
    .from('siguelo_ia_salida')
    .select('referencia')
    .eq('conversacion_id', conversacionId)
    .eq('origen', 'qr')
    .in('estado', ['pendiente', 'enviando', 'enviado'])
    .gte('creado_en', new Date(Date.now() - 6 * HORA).toISOString());
  const ya = new Set((data || []).map((x) => x.referencia));
  return cursos.filter((k) => !ya.has(k.id));
}
const cursosCortos = (cursos: CursoRow[]) => cursos.map((k) => ({ id: k.id, nombre: k.nombre, precio: formatoMonto(k.precio, k.moneda) }));

// ¿Por qué no responde sola ahora? ('' si puede)
async function motivoSinAuto(c: Config, conversacionId: string, ultimaPersona: number): Promise<string> {
  if (c.ia.modo !== 'automatico') return 'modo para aprobar';
  if (ultimaPersona && Date.now() - ultimaPersona < c.ia.pausa_si_escribes_min * MIN) return `le escribió una persona hace menos de ${c.ia.pausa_si_escribes_min} min`;
  const inicioHoy = new Date(instante(fechaDe(Date.now(), c.zona), '00:00', c.zona)).toISOString();
  const contar = (filtro: (q: any) => any) =>
    filtro(db.from('siguelo_ia_salida').select('id', { count: 'exact', head: true }).eq('origen', 'respuesta').eq('estado', 'enviado').gte('cerrado_en', inicioHoy)).then(
      (r: { count: number | null }) => r.count ?? 0,
    );
  if ((await contar((q) => q.eq('conversacion_id', conversacionId))) >= c.ia.max_por_cliente_dia) return `ya recibió ${c.ia.max_por_cliente_dia} respuestas de la IA hoy`;
  if ((await contar((q) => q.eq('empresa_id', c.ia.empresa_id))) >= c.ia.max_respuestas_dia) return `se llegó al máximo de ${c.ia.max_respuestas_dia} respuestas de la IA hoy`;
  return '';
}

type Contexto = {
  c: Config;
  fila: PorLeerRow;
  lectura: LecturaRow;
  negocio: NegocioRow;
  nombre: string;
  contacto: { id: string; nombre: string | null; etapa_id: string | null; etapa_actualizada_en?: string | null } | null;
  etapas: EtapaVentaRow[];
  respuestas: Awaited<ReturnType<typeof respuestasDisponibles>>;
  otros: NegocioRow[];
  cursos: CursoRow[];
  bots: Awaited<ReturnType<typeof botsDisponibles>>;
  clienteUltimo: boolean;
  ultimaPersona: number;
};

async function encolarAviso(x: Contexto, tipo: TipoAviso, motivo: string): Promise<boolean> {
  const av = x.c.ia.avisos;
  if (!av?.activo || digitos(av.telefono).length < 7 || !av.tipos?.[tipo]) return false;
  if (Date.now() - (x.lectura.avisado[tipo] || 0) < REPETIR_AVISO_MS) return false;
  x.lectura.avisado = { ...x.lectura.avisado, [tipo]: Date.now() };
  const tel = digitos(x.fila.telefono.split('@')[0]);
  await db.from('siguelo_ia_salida').insert({
    empresa_id: x.c.ia.empresa_id,
    contacto_id: x.contacto?.id ?? null,
    linea_id: av.linea_id || x.fila.linea_id,
    telefono: digitos(av.telefono),
    origen: 'aviso',
    referencia: tipo,
    contenido: `• *${x.nombre}*${tel ? ` (+${tel})` : ''} — ${x.negocio.nombre}: ${motivo}`,
    vence: new Date(Date.now() + Math.max(0, av.juntar_min || 0) * MIN).toISOString(),
  });
  return true;
}

// Arma lo que se le manda al cliente: la respuesta, las respuestas rápidas, el link del grupo y el pase.
async function gestionarRespuesta(x: Contexto, r: ResultadoIA): Promise<string> {
  const { c } = x;
  if (c.ia.modo === 'apagado' || r.no_quiere_mas || x.lectura.sin_respuestas) return '';
  const etapa = x.etapas.find((e) => e.id === x.contacto?.etapa_id);
  if (etapa?.tipo === 'perdida') return '';
  // Solo si el cliente fue el último en escribir, y hace poco.
  if (!x.clienteUltimo || Date.now() - ms(x.fila.ultimo_cliente) > NO_RESPONDER_VIEJOS_MS) return '';

  let texto = r.puede_responder ? r.respuesta : '';
  let espera = false;
  if (!texto && r.necesita_al_dueno && c.ia.si_no_sabe === 'espera' && c.ia.texto_espera.trim() && Date.now() - ms(x.lectura.espera_enviada) > ESPERA_REPETIR_MS) {
    texto = c.ia.texto_espera.trim();
    espera = true;
  }
  const ac = c.ia.acciones;
  const respuestas = ac.respuestas_rapidas ? x.respuestas.filter((rr) => r.respuestas_rapidas.includes(rr.id)) : [];
  const grupo = ac.grupos && r.grupo ? x.negocio.grupos.find((g) => g.id === r.grupo && g.link) : undefined;
  const otro = ac.pases && r.pase ? x.otros.find((n) => n.id === r.pase!.negocio_id) : undefined;
  const lineaOtro = otro ? await lineaDeNegocio(otro.id) : null;
  const curso = r.qr ? x.cursos.find((k) => k.id === r.qr && k.qr_url) : undefined;
  const bot = r.bot ? x.bots.find((b) => b.id === r.bot) : undefined;
  if (!texto && !respuestas.length && !grupo && !curso && !bot && !(otro && lineaOtro)) return '';
  if (texto && c.ia.firma.trim() && !texto.includes(c.ia.firma.trim())) texto += `\n${c.ia.firma.trim()}`;

  const motivo = await motivoSinAuto(c, x.fila.conversacion_id, x.ultimaPersona);
  const estado: SalidaRow['estado'] = motivo ? 'borrador' : 'pendiente';

  // Lo que la IA iba a mandar antes y todavía no salió queda reemplazado.
  await db
    .from('siguelo_ia_salida')
    .update({ estado: 'cancelado', motivo: 'Reemplazada por una respuesta nueva', cerrado_en: new Date().toISOString() })
    .eq('conversacion_id', x.fila.conversacion_id)
    .in('origen', ['respuesta', 'respuesta_rapida', 'grupo', 'qr', 'bot'])
    .in('estado', ['borrador', 'pendiente']);

  const min = Math.min(c.ia.espera_min_seg, c.ia.espera_max_seg);
  const max = Math.max(c.ia.espera_min_seg, c.ia.espera_max_seg);
  const vence = new Date(ajustar(Date.now() + (min + Math.random() * (max - min)) * 1000, { zona: c.zona, desde: c.ia.desde, hasta: c.ia.hasta })).toISOString();
  const lote = randomUUID();
  const base = {
    empresa_id: c.ia.empresa_id,
    conversacion_id: x.fila.conversacion_id,
    contacto_id: x.contacto?.id ?? null,
    linea_id: x.fila.linea_id,
    telefono: x.fila.telefono,
    vence,
    estado,
    motivo: motivo && motivo !== 'modo para aprobar' ? motivo : null,
    lote,
    base_cliente: x.fila.ultimo_cliente,
  };
  const filas: Partial<SalidaRow>[] = [];
  if (texto) filas.push({ ...base, origen: 'respuesta', contenido: texto, orden: 0, referencia: espera ? 'espera' : null });
  for (const rr of respuestas) {
    const tipo = (['texto', 'imagen', 'pdf', 'documento', 'audio'].includes(rr.tipo) ? rr.tipo : 'texto') as SalidaRow['tipo'];
    filas.push({ ...base, origen: 'respuesta_rapida', referencia: rr.id, tipo, contenido: rr.contenido, media_url: rr.media_url, orden: filas.length });
  }
  if (grupo) filas.push({ ...base, origen: 'grupo', referencia: grupo.id, contenido: `Aquí tienes el link para unirte a "${grupo.nombre}":\n${grupo.link}`, orden: filas.length });
  if (curso) filas.push({ ...base, origen: 'qr', referencia: curso.id, tipo: 'imagen', media_url: curso.qr_url, contenido: `QR para pagar ${curso.nombre}: ${formatoMonto(curso.precio, curso.moneda)}`, orden: filas.length });
  if (bot) filas.push({ ...base, origen: 'bot', referencia: bot.id, contenido: `Activa "${bot.nombre}" del bot`, orden: filas.length });
  if (otro && lineaOtro) {
    // Sale por el número del otro negocio, un rato después de la respuesta.
    filas.push({
      ...base,
      conversacion_id: null,
      linea_id: lineaOtro,
      origen: 'pase',
      referencia: otro.id,
      contenido: r.pase!.mensaje,
      orden: filas.length,
      lote: randomUUID(),
      vence: new Date(new Date(vence).getTime() + 30_000).toISOString(),
    });
    if (x.contacto) {
      await db.from('notas').insert({
        contacto_id: x.contacto.id,
        autor_id: null,
        texto: `🤝 Pase de ${x.negocio.nombre} a ${otro.nombre}${estado === 'borrador' ? ' (falta que lo apruebes en IA)' : ''}: ${r.pase!.nota || r.resumen}`,
      });
    }
  }
  const { error } = await db.from('siguelo_ia_salida').insert(filas);
  if (error) {
    console.error('IA: no se pudo guardar la respuesta:', error.message);
    return '';
  }
  if (espera && estado === 'pendiente') x.lectura.espera_enviada = new Date().toISOString();
  const que = [texto && `"${texto.slice(0, 80)}${texto.length > 80 ? '…' : ''}"`, ...respuestas.map((rr) => `"${rr.titulo}"`), grupo && `link de "${grupo.nombre}"`, curso && `QR de "${curso.nombre}"`, bot && `activa "${bot.nombre}" del bot`, otro && `pase a ${otro.nombre}`]
    .filter(Boolean)
    .join(' + ');
  return estado === 'pendiente' ? `respondiendo: ${que}` : `respuesta lista para que la apruebes${base.motivo ? ` (${base.motivo})` : ''}: ${que}`;
}

// Aplica lo que decidió la IA. Devuelve lo que hizo (para el registro).
async function aplicar(x: Contexto, r: ResultadoIA): Promise<string[]> {
  const { c } = x;
  const hechos: string[] = [];
  const ac = c.ia.acciones;
  const actual = x.etapas.find((e) => e.id === x.contacto?.etapa_id);
  // Si una palabra o una frase tuya acaba de moverlo (Fase 4), la IA no lo cambia.
  const { data: seg } = x.contacto ? await db.from('siguelo_seguimientos').select('deshacer').eq('contacto_id', x.contacto.id).maybeSingle() : { data: null };
  const movidoReciente = !!seg?.deshacer && Date.now() - seg.deshacer.ts < 10 * MIN;
  if (x.contacto && actual?.tipo !== 'perdida' && !movidoReciente) {
    if (r.no_quiere_mas && ac.no_quiere_mas) {
      const destino = x.etapas.find((e) => e.tipo === 'perdida');
      if (destino) {
        await cambiarEtapa(c.ia.empresa_id, x.contacto.id, destino);
        x.contacto.etapa_id = destino.id;
        hechos.push(`pasó a "${destino.nombre}" (no quiere más mensajes)`);
      }
    } else if (ac.mover_etapa && r.etapa && r.etapa !== x.contacto.etapa_id) {
      const destino = x.etapas.find((e) => e.id === r.etapa);
      if (destino && destino.tipo !== 'perdida') {
        await cambiarEtapa(c.ia.empresa_id, x.contacto.id, destino);
        x.contacto.etapa_id = destino.id;
        hechos.push(`pasó a "${destino.nombre}"`);
      }
    }
  }
  if ((r.necesita_al_dueno || r.aviso) && r.motivo) {
    x.lectura.atencion = { tipo: r.aviso || 'pregunta', motivo: r.motivo, ts: Date.now(), hecho: null };
    hechos.push(`para que lo veas: ${r.motivo}`);
    if (r.aviso && (await encolarAviso(x, r.aviso, r.motivo))) hechos.push('aviso a tu WhatsApp');
  }
  const rta = await gestionarRespuesta(x, r);
  if (rta) hechos.push(rta);
  return hechos;
}

// Lee una conversación. Devuelve false si falló la IA.
async function leer(c: Config, fila: PorLeerRow): Promise<boolean> {
  const empresaId = c.ia.empresa_id;
  const { data: previa } = await db.from('siguelo_ia_lecturas').select('*').eq('conversacion_id', fila.conversacion_id).maybeSingle();
  const lectura: LecturaRow = previa ?? {
    conversacion_id: fila.conversacion_id,
    empresa_id: empresaId,
    contacto_id: fila.contacto_id,
    linea_id: fila.linea_id,
    leido_hasta: null,
    fallos: 0,
    reintentar_en: null,
    resumen: null,
    interes: null,
    atencion: null,
    sin_respuestas: false,
    avisado: {},
    espera_enviada: null,
    actualizado_en: new Date().toISOString(),
  };
  const guardar = async (cambios: Partial<LecturaRow>) => {
    const fila2 = { ...lectura, ...cambios, contacto_id: fila.contacto_id ?? lectura.contacto_id, linea_id: fila.linea_id, actualizado_en: new Date().toISOString() };
    const { error } = await db.from('siguelo_ia_lecturas').upsert(fila2, { onConflict: 'conversacion_id' });
    if (error) console.error('IA: no se pudo guardar la lectura:', error.message);
  };
  const leido = { leido_hasta: fila.ultimo_cliente, fallos: 0, reintentar_en: null };

  const negocio = await negocioDeLinea(fila.linea_id);
  // Sin ficha de negocio no hay con qué responder; tampoco a tu número personal.
  if (!negocio || !negocio.ia_activa || esNumeroPersonal(fila.telefono, c.ia.avisos?.telefono || '')) {
    await guardar(leido);
    return true;
  }
  // Si está mandando un comprobante o sus datos de inscripción (Fase 5), de eso se encarga pagos/;
  // si un flujo del bot espera su respuesta, contesta el bot.
  if ((await pagoEnCurso(fila.conversacion_id)) || (await flujoEsperando(fila.conversacion_id))) {
    await guardar(leido);
    return true;
  }

  const [{ data: contacto }, { data: mensajes }, enviadas] = await Promise.all([
    fila.contacto_id ? db.from('contactos').select('id, nombre, etapa_id, etapa_actualizada_en').eq('id', fila.contacto_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('mensajes').select('id, remitente, agente_id, tipo, contenido, creado_en').eq('conversacion_id', fila.conversacion_id).order('creado_en', { ascending: false }).limit(30),
    referenciasEnviadas(fila.contacto_id, fila.conversacion_id),
  ]);
  const lista = (mensajes || []).reverse();
  // Los automáticos (seguimiento e IA) se marcan como tales para la IA.
  const ids = lista.filter((m) => m.remitente === 'agente').map((m) => m.id);
  const [{ data: deCola }, { data: deIa }] = ids.length
    ? await Promise.all([db.from('siguelo_cola').select('mensaje_id').in('mensaje_id', ids), db.from('siguelo_ia_salida').select('mensaje_id').in('mensaje_id', ids)])
    : [{ data: [] }, { data: [] }];
  const automaticos = new Set([...(deCola || []), ...(deIa || [])].map((x) => x.mensaje_id));
  const conversacion: LineaConversacion[] = lista.map((m) => ({
    quien: m.remitente === 'cliente' ? 'cliente' : automaticos.has(m.id) ? 'automatico' : 'nosotros',
    texto: m.tipo === 'texto' ? m.contenido || '' : `[${m.tipo}] ${m.contenido || ''}`.trim(),
    cuando: formatear(m.creado_en, c.zona),
  }));
  const ultimaPersona = ms([...lista].reverse().find((m) => m.remitente === 'agente' && m.agente_id)?.creado_en);

  const [etapas, respuestas, otros, cursos, bots, club] = await Promise.all([
    etapasDelEmbudo(empresaId, negocio.embudo_id),
    respuestasDisponibles(empresaId, negocio.id, enviadas),
    otrosNegocios(empresaId, negocio.id),
    cursosDisponibles(empresaId, negocio.id, fila.conversacion_id),
    botsDisponibles(empresaId, fila.linea_id, fila.conversacion_id),
    datosClubParaIA(empresaId, negocio.club_sucursal_id, fechaDe(Date.now(), c.zona)),
  ]);
  const nombre = contacto?.nombre?.trim() || fila.telefono.split('@')[0];
  const datos: DatosContexto = {
    ia: c.ia,
    ahora: formatear(new Date().toISOString(), c.zona),
    negocio,
    etapas: etapas.map((e) => ({ id: e.id, nombre: e.nombre, tipo: e.tipo })),
    etapaActual: contacto?.etapa_id ?? null,
    nombreCliente: contacto?.nombre || '',
    conversacion,
    respuestasRapidas: respuestas.map((r) => ({ id: r.id, titulo: r.titulo, tipo: r.tipo, contenido: r.contenido, cuando: r.cuando })),
    otrosNegocios: otros,
    grupos: (negocio.grupos || []).filter((g) => g.link && !enviadas.has(g.id)),
    cursos: cursosCortos(cursos),
    bots,
    club,
  };
  const conRespuesta = c.ia.modo !== 'apagado';
  const { mensajes: prompt, ids: mapa } = armarMensajes(datos, conRespuesta);
  const res = await llamar(c, prompt);
  if (!res.ok) {
    const fallos = lectura.fallos + 1;
    // Tras 3 fallos seguidos se deja (el próximo mensaje del cliente lo vuelve a intentar).
    const rendirse = fallos >= 3 || !!res.cupo;
    await guardar({
      fallos: rendirse ? 0 : fallos,
      reintentar_en: rendirse ? null : new Date(Date.now() + Math.min(60, 5 * fallos) * MIN).toISOString(),
      ...(rendirse ? { leido_hasta: fila.ultimo_cliente } : {}),
    });
    await registrar(empresaId, fila.contacto_id, 'ia_error', `IA: no se pudo leer a ${nombre}: ${res.mensaje}`);
    return false;
  }
  const r = validarResultado(res.json, mapa, conRespuesta);
  const x: Contexto = {
    c,
    fila,
    lectura,
    negocio,
    nombre,
    contacto: contacto ? { ...contacto } : null,
    etapas,
    respuestas,
    otros,
    cursos,
    bots,
    clienteUltimo: lista.at(-1)?.remitente === 'cliente',
    ultimaPersona,
  };
  const hechos = await aplicar(x, r);
  await guardar({ ...leido, resumen: r.resumen || lectura.resumen, interes: r.interes || lectura.interes, atencion: lectura.atencion, avisado: lectura.avisado, espera_enviada: lectura.espera_enviada });
  await registrar(empresaId, fila.contacto_id, 'ia', `IA leyó a ${nombre} (${negocio.nombre}): ${r.resumen || 'sin resumen'}${hechos.length ? ` · ${hechos.join(' · ')}` : ''}`);
  return true;
}

// Una vuelta: lee las conversaciones que tienen mensajes nuevos del cliente.
export async function leerPendientes(c: Config, maximo = 5): Promise<void> {
  const { data, error } = await db.rpc('siguelo_ia_por_leer', { p_empresa: c.ia.empresa_id, p_quieto_seg: QUIETO_SEG });
  if (error) return;
  for (const fila of (data || []).slice(0, maximo)) {
    const ok = await leer(c, fila);
    if (!ok) break; // si OpenAI falla, no insiste con los demás en esta vuelta
  }
}

// Para "Probar" en la pantalla IA: lee una conversación inventada sin tocar nada.
export async function probarMensaje(c: Config, negocioId: string, texto: string) {
  const { data: negocio } = await db.from('siguelo_negocios').select('*').eq('id', negocioId).maybeSingle();
  if (!negocio) return { ok: false as const, mensaje: 'Elige un negocio.' };
  const ahora = new Date().toISOString();
  const { data: lineaDelNegocio } = await db.from('siguelo_lineas').select('linea_id').eq('negocio_id', negocio.id).limit(1).maybeSingle();
  const [etapas, respuestas, otros, cursos, bots, club] = await Promise.all([
    etapasDelEmbudo(c.ia.empresa_id, negocio.embudo_id),
    respuestasDisponibles(c.ia.empresa_id, negocio.id, new Set()),
    otrosNegocios(c.ia.empresa_id, negocio.id),
    cursosConQR(c.ia.empresa_id, negocio.id),
    lineaDelNegocio ? botsDisponibles(c.ia.empresa_id, lineaDelNegocio.linea_id, '00000000-0000-0000-0000-000000000000') : Promise.resolve([]),
    datosClubParaIA(c.ia.empresa_id, negocio.club_sucursal_id, fechaDe(Date.now(), c.zona)),
  ]);
  const datos: DatosContexto = {
    ia: c.ia,
    ahora: formatear(ahora, c.zona),
    negocio,
    etapas: etapas.map((e) => ({ id: e.id, nombre: e.nombre, tipo: e.tipo })),
    etapaActual: etapas.find((e) => e.tipo === 'normal')?.id ?? null,
    nombreCliente: 'Cliente de prueba',
    conversacion: [
      { quien: 'cliente', texto: 'Hola, quiero información', cuando: formatear(new Date(Date.now() - 10 * MIN).toISOString(), c.zona) },
      { quien: 'cliente', texto, cuando: formatear(ahora, c.zona) },
    ],
    respuestasRapidas: respuestas.map((r) => ({ id: r.id, titulo: r.titulo, tipo: r.tipo, contenido: r.contenido, cuando: r.cuando })),
    otrosNegocios: otros,
    grupos: (negocio.grupos || []).filter((g) => g.link),
    cursos: cursosCortos(cursos),
    bots,
    club,
  };
  const { mensajes, ids } = armarMensajes(datos, true);
  const res = await llamar(c, mensajes);
  if (!res.ok) return { ok: false as const, mensaje: res.mensaje };
  const r = validarResultado(res.json, ids, true);
  return {
    ok: true as const,
    resultado: {
      ...r,
      respuesta: r.respuesta && c.ia.firma.trim() ? `${r.respuesta}\n${c.ia.firma.trim()}` : r.respuesta,
      etapa: etapas.find((e) => e.id === r.etapa)?.nombre ?? null,
      respuestas_rapidas: respuestas.filter((rr) => r.respuestas_rapidas.includes(rr.id)).map((rr) => rr.titulo),
      grupo: negocio.grupos.find((g) => g.id === r.grupo)?.nombre ?? null,
      pase: r.pase ? { ...r.pase, negocio: otros.find((n) => n.id === r.pase!.negocio_id)?.nombre ?? '' } : null,
      qr: cursos.find((k) => k.id === r.qr)?.nombre ?? null,
      bot: bots.find((b) => b.id === r.bot)?.nombre ?? null,
    },
  };
}
