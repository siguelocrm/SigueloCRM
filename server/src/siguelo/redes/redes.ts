import { db } from '../db.js';
import { HORA, MIN, fechaDe } from '../horario.js';
import { registrar } from '../registro.js';
import { llamar } from '../ia/config.js';
import { describirEstilo } from '../ia/contexto.js';
import { datosClubParaIA } from '../club/club.js';
import { borrar, comentarios, ocultar, responder, type AppMeta, type ComentarioMeta } from './meta.js';
import type { ComentarioRedRow, CuentaRedRow, IaRow, NegocioRow } from '../tipos.js';

// Comentarios de Facebook e Instagram (las cuentas conectadas en "Redes
// sociales"). Cada 3 minutos se leen los comentarios nuevos de cada cuenta y la
// IA decide con la ficha del negocio: responder (cada vez distinto, unos
// minutos después, llevando a la gente a tu WhatsApp), ocultar o borrar lo
// negativo, o preguntarte por WhatsApp lo que no sabe. Tu respuesta ("R12 …")
// se publica y queda aprendida para la próxima (también para la IA de WhatsApp).

type Config = { ia: IaRow; clave: string; zona: string };

const CADA_MS = 3 * MIN;
const MAX_POR_VUELTA = 10; // comentarios nuevos que se leen con la IA por cuenta y vuelta
const ESPERA_RESPALDO_MS = 6 * HORA; // si no respondes, se publica la respuesta que lleva a tu WhatsApp
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);
const digitos = (t: string | null | undefined) => String(t || '').replace(/\D/g, '');
const azar = (min: number, max: number) => min + Math.random() * (max - min);
const recortar = (s: unknown, n: number) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const TIPOS_COMENTARIO = ['pregunta', 'interes', 'positivo', 'negativo', 'spam', 'otro'] as const;
type Decision = { tipo: (typeof TIPOS_COMENTARIO)[number]; accion: 'responder' | 'ocultar' | 'ignorar' | 'preguntar'; respuesta: string; respaldo: string; motivo: string };

// ---------- Lo que aprendió ----------

export async function aprendidoDe(empresaId: string, negocioId: string | null, maximo = 30): Promise<{ pregunta: string; respuesta: string }[]> {
  const q = db.from('siguelo_aprendido').select('pregunta, respuesta, negocio_id').eq('empresa_id', empresaId).order('creado_en', { ascending: false }).limit(200);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).filter((x) => !x.negocio_id || x.negocio_id === negocioId).slice(0, maximo);
}

export const textoAprendido = (lista: { pregunta: string; respuesta: string }[]) =>
  lista.map((x) => `- Preguntaron: "${recortar(x.pregunta, 200)}" → El dueño respondió: "${recortar(x.respuesta, 400)}"`).join('\n');

// ---------- Para la IA ----------

async function negocioDe(cuenta: CuentaRedRow): Promise<NegocioRow | null> {
  if (!cuenta.negocio_id) return null;
  const { data } = await db.from('siguelo_negocios').select('*').eq('id', cuenta.negocio_id).maybeSingle();
  return data;
}

// El WhatsApp al que se lleva a la gente: el de la cuenta o el del número del negocio.
async function whatsappDe(cuenta: CuentaRedRow): Promise<string> {
  if (digitos(cuenta.whatsapp).length >= 7) return digitos(cuenta.whatsapp);
  if (!cuenta.negocio_id) return '';
  const { data: lineas } = await db.from('siguelo_lineas').select('linea_id').eq('negocio_id', cuenta.negocio_id).limit(5);
  if (!lineas?.length) return '';
  const { data } = await db.from('lineas_whatsapp').select('numero').in('id', lineas.map((l) => l.linea_id)).limit(1).maybeSingle();
  return digitos(data?.numero);
}

const comoWhatsapp = (red: CuentaRedRow['red'], numero: string) =>
  !numero ? '' : red === 'facebook' ? `https://wa.me/${numero}` : `${numero.startsWith('591') && numero.length === 11 ? numero.slice(3) : numero} (WhatsApp)`;

async function decidir(c: Config, cuenta: CuentaRedRow, negocio: NegocioRow | null, k: ComentarioMeta, padre: string | null): Promise<Decision | { error: string }> {
  const [aprendido, club, { data: recientes }, numero] = await Promise.all([
    aprendidoDe(c.ia.empresa_id, negocio?.id ?? null),
    datosClubParaIA(c.ia.empresa_id, negocio?.club_sucursal_id, fechaDe(Date.now(), c.zona)),
    db.from('siguelo_redes_comentarios').select('respuesta').eq('cuenta_id', cuenta.id).eq('accion', 'respondido').order('respondido_en', { ascending: false }).limit(8),
    whatsappDe(cuenta),
  ]);
  const whatsapp = comoWhatsapp(cuenta.red, numero);
  const red = cuenta.red === 'facebook' ? 'Facebook' : 'Instagram';
  const ficha = negocio
    ? [`Nombre: ${negocio.nombre}`, negocio.sucursal && `Sucursal: ${negocio.sucursal}`, negocio.direccion && `Dirección: ${negocio.direccion}`, negocio.horario && `Horario: ${negocio.horario}`, negocio.info_ia?.trim()]
        .filter(Boolean)
        .join('\n')
    : '(sin ficha: solo puedes agradecer y llevar al WhatsApp)';
  const sistema = `Respondes los comentarios de ${red} de un negocio ("${cuenta.nombre}"), como lo haría una persona del equipo. Devuelves SOLO un objeto JSON.

FICHA DEL NEGOCIO:
"""
${ficha}
"""
${club ? `\nHORARIOS, CUPOS Y PRECIOS EN VIVO:\n"""\n${club}\n"""\n` : ''}${aprendido.length ? `\nRESPUESTAS QUE YA DIO EL DUEÑO (úsalas si encajan):\n${textoAprendido(aprendido)}\n` : ''}
WhatsApp del negocio: ${whatsapp || '(no hay)'}

Devuelve: {"tipo": ${TIPOS_COMENTARIO.map((t) => `"${t}"`).join(' | ')}, "accion": "responder" | "ocultar" | "ignorar" | "preguntar", "respuesta": "texto del comentario de respuesta, o \\"\\"", "respaldo": "solo si accion es preguntar: respuesta corta que lo lleva al WhatsApp sin dar el dato", "motivo": "una frase para el dueño"}

Reglas:
- Pregunta o interés (precios, horarios, cómo inscribirse, ubicación): responde corto (1 o 2 frases), cálido y natural, con los datos de la ficha, y lo invitas a escribir al WhatsApp${whatsapp ? ` (${whatsapp})` : ''} para más detalles o para inscribirse. ${cuenta.red === 'instagram' ? 'En Instagram los links no funcionan en comentarios: escribe el número.' : ''}
- Cada respuesta tiene que ser DISTINTA: no repitas frases ni el mismo inicio de las respuestas anteriores. Varía saludos, palabras y emojis (como mucho 1 o 2). Que no parezca un bot.
- Si se ve el nombre de la persona, puedes usarlo (en Instagram, su @usuario).
- Si pregunta algo que no está en la ficha ni en lo que ya respondió el dueño: "accion": "preguntar" (no inventes), "motivo" con la duda, y un "respaldo".
- Negativo: critica el negocio, dice que no lo recomienda, insulta o deja mala imagen → "accion": "ocultar". Un reclamo concreto y respetuoso NO es negativo: respóndelo con amabilidad e invítalo al WhatsApp para resolverlo.
- Spam (links ajenos, venden otra cosa, cuentas falsas) → "tipo": "spam", "accion": "ocultar".
- Solo etiqueta a otra persona o no aporta nada → "ignorar". Un elogio corto → un agradecimiento breve y distinto cada vez.
- Nunca prometas descuentos ni nada que no esté en la ficha. No hables de la IA.
- Estilo: ${describirEstilo(c.ia.estilo)}.${cuenta.instrucciones.trim() ? `\n- Instrucciones del dueño para esta cuenta: ${cuenta.instrucciones.trim()}` : ''}`;
  const usuario = `Publicación: "${recortar(k.publicacion, 400) || '(sin texto)'}"
${padre ? `Responde a este comentario: "${recortar(padre, 300)}"\n` : ''}Comentario de ${k.autor}: "${recortar(k.texto, 1000)}"
${(recientes || []).length ? `\nTus últimas respuestas (no las repitas):\n${(recientes || []).map((r) => `- ${recortar(r.respuesta, 160)}`).join('\n')}` : ''}`;
  const r = await llamar(c, [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario },
  ]);
  if (!r.ok) return { error: r.mensaje };
  const j = r.json;
  const tipo = (TIPOS_COMENTARIO as readonly string[]).includes(String(j.tipo)) ? (j.tipo as Decision['tipo']) : 'otro';
  let accion = (['responder', 'ocultar', 'ignorar', 'preguntar'] as const).find((a) => a === j.accion) ?? 'ignorar';
  const respuesta = recortar(j.respuesta, 600);
  if (accion === 'responder' && !respuesta) accion = 'ignorar';
  return { tipo, accion, respuesta, respaldo: recortar(j.respaldo, 400), motivo: recortar(j.motivo, 240) };
}

// ---------- Avisos a tu WhatsApp ----------

async function avisar(c: Config, cuenta: CuentaRedRow, texto: string): Promise<boolean> {
  const av = c.ia.avisos;
  if (!av?.activo || digitos(av.telefono).length < 7 || av.tipos?.redes === false) return false;
  let linea = av.linea_id;
  if (!linea && cuenta.negocio_id) {
    const { data } = await db.from('siguelo_lineas').select('linea_id').eq('negocio_id', cuenta.negocio_id).limit(1).maybeSingle();
    linea = data?.linea_id ?? null;
  }
  if (!linea) {
    const { data } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', c.ia.empresa_id).eq('estado', 'activo').limit(1).maybeSingle();
    linea = data?.id ?? null;
  }
  if (!linea) return false;
  const { error } = await db.from('siguelo_ia_salida').insert({
    empresa_id: c.ia.empresa_id,
    linea_id: linea,
    telefono: digitos(av.telefono),
    origen: 'aviso',
    referencia: 'redes',
    contenido: `• ${texto}`,
    vence: new Date(Date.now() + Math.max(0, av.juntar_min || 0) * MIN).toISOString(),
  });
  return !error;
}

// ---------- Leer y decidir ----------

type Vuelta = { c: Config; app: AppMeta };

async function tokenDe(cuentaId: string): Promise<string | null> {
  const { data } = await db.from('siguelo_redes_tokens').select('token').eq('cuenta_id', cuentaId).maybeSingle();
  return data?.token ?? null;
}

async function actualizarCuenta(cuenta: CuentaRedRow, cambios: Partial<CuentaRedRow>): Promise<void> {
  Object.assign(cuenta, cambios);
  await db.from('siguelo_redes_cuentas').update({ ...cambios, actualizado_en: new Date().toISOString() }).eq('id', cuenta.id);
}

async function revisarCuenta(x: Vuelta, cuenta: CuentaRedRow): Promise<void> {
  const { c, app } = x;
  const token = await tokenDe(cuenta.id);
  if (!token) return actualizarCuenta(cuenta, { error: 'Falta conectar esta cuenta otra vez.', revisado_en: new Date().toISOString() });
  // Al activarla: se responde desde ese momento (los comentarios viejos no).
  if (!cuenta.revisado_hasta) return actualizarCuenta(cuenta, { revisado_hasta: new Date().toISOString(), revisado_en: new Date().toISOString(), error: null });
  let lista: ComentarioMeta[];
  try {
    lista = await comentarios(cuenta.red, cuenta.externo_id, token, app.app_secret);
  } catch (err) {
    return actualizarCuenta(cuenta, { error: (err as Error).message, revisado_en: new Date().toISOString() });
  }
  await actualizarCuenta(cuenta, { revisado_en: new Date().toISOString(), error: null });
  const desde = ms(cuenta.revisado_hasta);
  const propios = new Set([cuenta.externo_id, cuenta.usuario ? `@${cuenta.usuario}` : '']);
  const candidatos = lista.filter((k) => ms(k.publicado_en) > desde && k.texto.trim() && !propios.has(k.autor_id ?? '') && !propios.has(k.autor));
  if (!candidatos.length) return;
  const { data: vistos } = await db.from('siguelo_redes_comentarios').select('externo_id').eq('cuenta_id', cuenta.id).in('externo_id', candidatos.map((k) => k.externo_id));
  const ya = new Set((vistos || []).map((v) => v.externo_id));
  const nuevos = candidatos.filter((k) => !ya.has(k.externo_id)).sort((a, b) => ms(a.publicado_en) - ms(b.publicado_en)).slice(0, MAX_POR_VUELTA);
  if (!nuevos.length) return;
  const negocio = await negocioDe(cuenta);
  const textoDe = new Map(lista.map((k) => [k.externo_id, k.texto] as const));
  for (const k of nuevos) {
    const d = await decidir(c, cuenta, negocio, k, k.respuesta_a ? textoDe.get(k.respuesta_a) ?? null : null);
    if ('error' in d) {
      await registrar(c.ia.empresa_id, null, 'ia_error', `Redes: no se pudo leer un comentario de ${cuenta.nombre}: ${d.error}`);
      return; // se reintenta en la próxima vuelta
    }
    await aplicar(x, cuenta, k, d, token);
  }
}

async function guardar(cuenta: CuentaRedRow, k: ComentarioMeta, cambios: Partial<ComentarioRedRow>): Promise<void> {
  const { error } = await db.from('siguelo_redes_comentarios').insert({
    empresa_id: cuenta.empresa_id,
    cuenta_id: cuenta.id,
    externo_id: k.externo_id,
    publicacion_id: k.publicacion_id,
    publicacion: recortar(k.publicacion, 300),
    autor: k.autor,
    texto: recortar(k.texto, 2000),
    publicado_en: k.publicado_en,
    ...cambios,
  });
  if (error) console.error('Redes: no se pudo guardar un comentario:', error.message);
}

async function aplicar(x: Vuelta, cuenta: CuentaRedRow, k: ComentarioMeta, d: Decision, token: string): Promise<void> {
  const { c, app } = x;
  const red = cuenta.red === 'facebook' ? 'Facebook' : 'Instagram';
  const base = { tipo: d.tipo, motivo: d.motivo || null };

  if (d.accion === 'ocultar') {
    const que = cuenta.negativos;
    if (que === 'nada') {
      await guardar(cuenta, k, { ...base, accion: 'ignorado' });
    } else {
      try {
        if (que === 'borrar') await borrar(k.externo_id, token, app.app_secret);
        else await ocultar(cuenta.red, k.externo_id, token, app.app_secret);
        await guardar(cuenta, k, { ...base, accion: que === 'borrar' ? 'borrado' : 'oculto' });
      } catch (err) {
        await guardar(cuenta, k, { ...base, accion: 'error', motivo: (err as Error).message });
        return;
      }
    }
    if (d.tipo === 'negativo') await avisar(c, cuenta, `🚫 ${red} ${cuenta.nombre}: ${que === 'borrar' ? 'borré' : que === 'ocultar' ? 'oculté' : 'hay'} un comentario negativo de ${k.autor}: "${recortar(k.texto, 160)}"`);
    return;
  }

  if (d.accion === 'ignorar' || (d.accion === 'responder' && !cuenta.responder)) {
    return guardar(cuenta, k, { ...base, accion: 'ignorado' });
  }

  if (d.accion === 'preguntar') {
    const { data: codigo } = await db.rpc('siguelo_redes_codigo', {});
    const pregunta = `❓ R${codigo} · ${red} ${cuenta.nombre}: ${k.autor} preguntó "${recortar(k.texto, 200)}". No sé qué responder${d.motivo ? ` (${d.motivo})` : ''}. Contéstame así: R${codigo} tu respuesta`;
    const avisado = typeof codigo === 'number' && (await avisar(c, cuenta, pregunta));
    if (avisado) {
      return guardar(cuenta, k, { ...base, accion: 'preguntado', codigo, respaldo: d.respaldo || null, responder_en: new Date(Date.now() + ESPERA_RESPALDO_MS).toISOString() });
    }
    // Sin avisos a tu WhatsApp no te puede preguntar: lo lleva a tu WhatsApp ahora (si puede).
    if (!d.respaldo || !cuenta.responder) return guardar(cuenta, k, { ...base, accion: 'ignorado', motivo: `${d.motivo || 'No sabía qué responder'} (no hay avisos a tu WhatsApp para preguntarte)` });
    return guardar(cuenta, k, { ...base, accion: 'programado', respuesta: d.respaldo, responder_en: new Date(Date.now() + azar(1, 5) * MIN).toISOString() });
  }

  // Responder: unos minutos después, como una persona.
  return guardar(cuenta, k, { ...base, accion: 'programado', respuesta: d.respuesta, responder_en: new Date(Date.now() + azar(1, 6) * MIN).toISOString() });
}

// ---------- Publicar lo que toca ----------

async function publicar(x: Vuelta, fila: ComentarioRedRow, texto: string, motivo: string | null = null): Promise<boolean> {
  const { data: cuenta } = await db.from('siguelo_redes_cuentas').select('*').eq('id', fila.cuenta_id).maybeSingle();
  const token = cuenta ? await tokenDe(cuenta.id) : null;
  if (!cuenta || !token) return false;
  try {
    await responder(cuenta.red, fila.externo_id, texto, token, x.app.app_secret);
    await db
      .from('siguelo_redes_comentarios')
      .update({ accion: 'respondido', respuesta: texto, respondido_en: new Date().toISOString(), ...(motivo ? { motivo } : {}) })
      .eq('id', fila.id);
    return true;
  } catch (err) {
    await db.from('siguelo_redes_comentarios').update({ accion: 'error', motivo: (err as Error).message }).eq('id', fila.id);
    return false;
  }
}

async function publicarPendientes(x: Vuelta): Promise<void> {
  const ahora = new Date().toISOString();
  const { data: listos } = await db.from('siguelo_redes_comentarios').select('*').eq('empresa_id', x.c.ia.empresa_id).eq('accion', 'programado').lte('responder_en', ahora).limit(10);
  for (const f of listos || []) await publicar(x, f, f.respuesta || '');
  // Te pregunté y no respondiste a tiempo: se lo lleva a tu WhatsApp.
  const { data: vencidos } = await db.from('siguelo_redes_comentarios').select('*').eq('empresa_id', x.c.ia.empresa_id).eq('accion', 'preguntado').lte('responder_en', ahora).limit(10);
  for (const f of vencidos || []) {
    if (f.respaldo) await publicar(x, f, f.respaldo, 'No respondiste a tiempo: se lo llevó a tu WhatsApp');
    else await db.from('siguelo_redes_comentarios').update({ accion: 'ignorado', motivo: 'No respondiste a tiempo' }).eq('id', f.id);
  }
}

// ---------- Tu respuesta (por WhatsApp o desde el CRM) ----------

// Publica la respuesta del dueño (redactada por la IA con sus datos) y la guarda como aprendida.
export async function responderComoDueno(c: Config, app: AppMeta, comentarioId: string, respuestaDueno: string): Promise<{ ok: true; texto: string } | { ok: false; mensaje: string }> {
  const { data: fila } = await db.from('siguelo_redes_comentarios').select('*').eq('id', comentarioId).eq('empresa_id', c.ia.empresa_id).maybeSingle();
  if (!fila) return { ok: false, mensaje: 'No encontré ese comentario.' };
  const { data: cuenta } = await db.from('siguelo_redes_cuentas').select('*').eq('id', fila.cuenta_id).maybeSingle();
  if (!cuenta) return { ok: false, mensaje: 'La cuenta ya no está conectada.' };
  const numero = await whatsappDe(cuenta);
  const r = await llamar(c, [
    {
      role: 'system',
      content: `Escribe la respuesta a un comentario de ${cuenta.red === 'facebook' ? 'Facebook' : 'Instagram'} con lo que respondió el dueño del negocio. Corta (1 o 2 frases), natural, sin inventar nada más, y si sirve invítalo al WhatsApp${numero ? ` ${comoWhatsapp(cuenta.red, numero)}` : ''}. Estilo: ${describirEstilo(c.ia.estilo)}. Devuelve SOLO JSON: {"respuesta": "texto"}`,
    },
    { role: 'user', content: `Comentario de ${fila.autor}: "${fila.texto}"\nRespuesta del dueño: "${respuestaDueno}"` },
  ]);
  const texto = (r.ok && recortar(r.json.respuesta, 600)) || respuestaDueno.trim();
  const ok = await publicar({ c, app }, fila, texto, 'Respondido con lo que dijo el dueño');
  if (!ok) return { ok: false, mensaje: 'No se pudo publicar la respuesta en la red social.' };
  await db.from('siguelo_aprendido').insert({ empresa_id: c.ia.empresa_id, negocio_id: cuenta.negocio_id, pregunta: fila.texto, respuesta: respuestaDueno.trim() });
  await registrar(c.ia.empresa_id, null, 'ia', `Redes: se respondió a ${fila.autor} en ${cuenta.nombre} con lo que dijiste (queda aprendido).`);
  return { ok: true, texto };
}

// Lee lo que le escribiste al CRM desde tu WhatsApp personal: "R12 tu respuesta".
async function leerRespuestasDueno(x: Vuelta): Promise<void> {
  const { c } = x;
  const tel = digitos(c.ia.avisos?.telefono);
  if (tel.length < 7) return;
  const { data: info } = await db.from('siguelo_meta_info').select('leido_dueno').eq('empresa_id', c.ia.empresa_id).maybeSingle();
  const desde = info?.leido_dueno ?? null;
  if (!desde) {
    await db.from('siguelo_meta_info').upsert({ empresa_id: c.ia.empresa_id, leido_dueno: new Date().toISOString() }, { onConflict: 'empresa_id' });
    return;
  }
  const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', c.ia.empresa_id);
  if (!lineas?.length) return;
  const { data: chats } = await db.from('conversaciones').select('id, contacto_telefono').in('linea_id', lineas.map((l) => l.id)).like('contacto_telefono', `%${tel.slice(-8)}%`);
  const mios = (chats || []).filter((ch) => digitos(ch.contacto_telefono.split('@')[0]).endsWith(tel.slice(-8)));
  if (!mios.length) return;
  const { data: mensajes } = await db
    .from('mensajes')
    .select('contenido, creado_en')
    .in('conversacion_id', mios.map((ch) => ch.id))
    .eq('remitente', 'cliente')
    .gt('creado_en', desde)
    .order('creado_en')
    .limit(20);
  if (!mensajes?.length) return;
  for (const m of mensajes) {
    const texto = String(m.contenido || '').trim();
    const cod = /^\s*R\s?(\d{1,6})\b[\s:.,-]*([\s\S]+)$/i.exec(texto);
    let fila: { id: string } | null = null;
    let respuesta = '';
    if (cod) {
      const { data } = await db.from('siguelo_redes_comentarios').select('id').eq('empresa_id', c.ia.empresa_id).eq('codigo', Number(cod[1])).eq('accion', 'preguntado').maybeSingle();
      fila = data;
      respuesta = cod[2].trim();
    } else {
      // Sin código: solo si hay una sola pregunta esperando.
      const { data } = await db.from('siguelo_redes_comentarios').select('id').eq('empresa_id', c.ia.empresa_id).eq('accion', 'preguntado').limit(2);
      if (data?.length === 1 && texto.length > 3) {
        fila = data[0];
        respuesta = texto;
      }
    }
    if (fila && respuesta) {
      const r = await responderComoDueno(c, x.app, fila.id, respuesta);
      const { data: f } = await db.from('siguelo_redes_comentarios').select('autor, codigo, cuenta_id').eq('id', fila.id).maybeSingle();
      const { data: cuenta } = f ? await db.from('siguelo_redes_cuentas').select('*').eq('id', f.cuenta_id).maybeSingle() : { data: null };
      if (cuenta) await avisar(c, cuenta, r.ok ? `✅ R${f!.codigo}: le respondí a ${f!.autor}: "${recortar(r.texto, 160)}". Lo aprendí para la próxima.` : `⚠️ R${f!.codigo}: no pude publicar la respuesta (${r.mensaje}).`);
    }
  }
  await db.from('siguelo_meta_info').update({ leido_dueno: mensajes[mensajes.length - 1].creado_en }).eq('empresa_id', c.ia.empresa_id);
}

// ---------- Una vuelta (cada minuto) ----------

export async function appDe(empresaId: string): Promise<AppMeta | null> {
  const { data, error } = await db.from('siguelo_meta_app').select('app_id, app_secret, config_id').eq('empresa_id', empresaId).maybeSingle();
  return error || !data ? null : data;
}

export async function revisarRedes(c: Config): Promise<void> {
  const app = await appDe(c.ia.empresa_id);
  if (!app) return; // sin la App de Meta (o sin esta parte del SQL)
  const x: Vuelta = { c, app };
  const { data: cuentas } = await db.from('siguelo_redes_cuentas').select('*').eq('empresa_id', c.ia.empresa_id).eq('activo', true);
  for (const cuenta of cuentas || []) {
    if (Date.now() - ms(cuenta.revisado_en) >= CADA_MS) await revisarCuenta(x, cuenta);
  }
  await publicarPendientes(x);
  await leerRespuestasDueno(x);
}
