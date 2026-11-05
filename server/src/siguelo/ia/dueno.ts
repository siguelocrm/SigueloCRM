import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { HORA, MIN } from '../horario.js';
import { registrar } from '../registro.js';
import { llamar } from './config.js';
import type { IaRow } from '../tipos.js';

// Lo que la IA no sabe te lo pregunta por WhatsApp con un código ("R12"). Cuando
// le respondes "R12 tu respuesta" (o solo tu respuesta, si hay una sola pregunta
// esperando) desde tu WhatsApp personal, la IA le escribe al cliente con eso, lo
// guarda en "Lo que aprendió" de ese negocio (así le responde sola a los demás
// clientes) y te confirma. Los códigos son los mismos que los de Redes sociales.

type Config = { ia: IaRow; clave: string; zona: string };
const digitos = (t: string | null | undefined) => String(t || '').replace(/\D/g, '');
const recortar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// Crea la pregunta y devuelve su código (null si falta pegar el SQL).
export async function crearPregunta(
  c: Config,
  datos: { conversacion_id: string; contacto_id: string | null; linea_id: string; negocio_id: string | null; telefono: string; nombre: string; pregunta: string },
): Promise<number | null> {
  const { data: codigo, error } = await db.rpc('siguelo_redes_codigo', {});
  if (error || !codigo) return null;
  const { error: e } = await db.from('siguelo_ia_preguntas').insert({ empresa_id: c.ia.empresa_id, codigo, ...datos, pregunta: recortar(datos.pregunta.trim() || '(sin texto)', 500) });
  return e ? null : codigo;
}

// El mensaje para el cliente con lo que dijo el dueño (si la IA falla, va lo que escribiste tal cual).
// Sin código ("verificar"), primero se revisa que tu mensaje de verdad responda la pregunta (no un "hola").
async function redactar(c: Config, negocio: string, pregunta: string, respuesta: string, verificar: boolean): Promise<string | null> {
  const e = c.ia.estilo;
  const r = await llamar(c, [
    {
      role: 'system',
      content: `Eres el asistente de WhatsApp de "${negocio}". Un cliente preguntó algo que no sabías; el dueño te dio la respuesta. Escribe el mensaje para el cliente con esa información, sin inventar nada más, como si lo hubieras consultado. Tono ${e?.tono || 'amable'}, ${e?.trato === 'usted' ? 'trata de usted' : 'tutea'}, ${e?.emojis === 'no' ? 'sin emojis' : 'pocos emojis'}, corto. Responde SOLO con JSON: {${verificar ? '"es_respuesta": true o false (false si el mensaje del dueño NO responde lo que preguntó el cliente: un saludo, un "ok", otra cosa), ' : ''}"respuesta": "texto para el cliente"}`,
    },
    { role: 'user', content: `Lo que preguntó el cliente: ${pregunta}\nRespuesta del dueño: ${respuesta}` },
  ]);
  if (verificar && (!r.ok || r.json.es_respuesta !== true)) return null;
  const texto = r.ok && typeof r.json.respuesta === 'string' ? r.json.respuesta.trim() : '';
  return texto || respuesta;
}

async function confirmar(c: Config, lineaId: string, texto: string): Promise<void> {
  const tel = digitos(c.ia.avisos?.telefono);
  if (tel.length < 7) return;
  await db.from('siguelo_ia_salida').insert({ empresa_id: c.ia.empresa_id, linea_id: lineaId, telefono: tel, origen: 'aviso', referencia: 'respuesta', contenido: `• ${texto}`, vence: new Date().toISOString() });
}

// Un mensaje tuyo (desde tu número personal): si responde a una pregunta, se usa.
async function usarRespuesta(c: Config, lineaDueno: string, texto: string): Promise<void> {
  const limpio = texto.trim();
  if (!limpio) return;
  const cod = /^\s*R\s?(\d{1,6})\b[\s:.,-]*([\s\S]+)$/i.exec(limpio);
  let p: { id: string; codigo: number; conversacion_id: string | null; contacto_id: string | null; linea_id: string; negocio_id: string | null; telefono: string; nombre: string | null; pregunta: string } | null = null;
  let respuesta = '';
  if (cod) {
    const { data } = await db.from('siguelo_ia_preguntas').select('*').eq('empresa_id', c.ia.empresa_id).eq('codigo', Number(cod[1])).eq('estado', 'esperando').maybeSingle();
    p = data;
    respuesta = cod[2].trim();
  } else {
    // Sin código: solo si hay una sola pregunta esperando (de WhatsApp y de Redes).
    const [{ data: wa }, { data: redes }] = await Promise.all([
      db.from('siguelo_ia_preguntas').select('*').eq('empresa_id', c.ia.empresa_id).eq('estado', 'esperando').gte('creado_en', new Date(Date.now() - 24 * HORA).toISOString()).limit(2),
      db.from('siguelo_redes_comentarios').select('id').eq('empresa_id', c.ia.empresa_id).eq('accion', 'preguntado').limit(1),
    ]);
    if (wa?.length === 1 && !redes?.length && limpio.length > 2) {
      p = wa[0];
      respuesta = limpio;
    } else if ((wa?.length ?? 0) > 1) {
      await confirmar(c, lineaDueno, `Tengo ${wa!.length} o más preguntas esperando: respóndeme con el código, por ejemplo *R${wa![0].codigo} tu respuesta*.`);
    }
  }
  if (!p || !respuesta) return;

  const { data: negocio } = p.negocio_id ? await db.from('siguelo_negocios').select('nombre').eq('id', p.negocio_id).maybeSingle() : { data: null };
  const mensaje = await redactar(c, negocio?.nombre ?? 'el negocio', p.pregunta, respuesta, !cod);
  if (!mensaje) return; // sin código y no era la respuesta: no se hace nada
  if (p.conversacion_id) {
    await db.from('siguelo_ia_salida').insert({
      empresa_id: c.ia.empresa_id,
      conversacion_id: p.conversacion_id,
      contacto_id: p.contacto_id,
      linea_id: p.linea_id,
      telefono: p.telefono,
      origen: 'respuesta',
      tipo: 'texto',
      referencia: `dueno:${p.codigo}`,
      contenido: mensaje,
      estado: 'pendiente',
      aprobado: true, // lo respondiste tú: sale aunque el cliente haya escrito otra cosa
      lote: randomUUID(),
      orden: 0,
      vence: new Date().toISOString(),
    });
    // Ya no "necesita que lo veas".
    const { data: lec } = await db.from('siguelo_ia_lecturas').select('atencion').eq('conversacion_id', p.conversacion_id).maybeSingle();
    if (lec?.atencion && !lec.atencion.hecho) await db.from('siguelo_ia_lecturas').update({ atencion: { ...lec.atencion, hecho: Date.now() } }).eq('conversacion_id', p.conversacion_id);
  }
  await db.from('siguelo_ia_preguntas').update({ estado: 'respondida', respuesta, respondido_en: new Date().toISOString() }).eq('id', p.id);
  // Aprende: la próxima vez le responde sola a cualquier cliente de ese negocio.
  const { error: errAprende } = await db.from('siguelo_aprendido').insert({ empresa_id: c.ia.empresa_id, negocio_id: p.negocio_id, pregunta: p.pregunta, respuesta });
  const quien = p.nombre || `+${p.telefono.split('@')[0]}`;
  await confirmar(c, lineaDueno, `✅ R${p.codigo}: le respondí a *${quien}*: "${recortar(mensaje, 160)}".${errAprende ? '' : ' Lo aprendí para responderle a los demás.'}`);
  await registrar(c.ia.empresa_id, p.contacto_id, 'ia', `IA le respondió a ${quien} con lo que dijiste (R${p.codigo}): "${recortar(mensaje, 100)}"${errAprende ? '' : ' · lo aprendió'}.`);
}

// Los mensajes nuevos de tu número personal en esta conversación.
export async function leerDueno(c: Config, conversacionId: string, lineaId: string, desde: string | null): Promise<void> {
  const { data: mensajes } = await db
    .from('mensajes')
    .select('contenido, tipo, creado_en')
    .eq('conversacion_id', conversacionId)
    .eq('remitente', 'cliente')
    .gt('creado_en', desde ?? new Date(Date.now() - 30 * MIN).toISOString())
    .order('creado_en')
    .limit(10);
  for (const m of mensajes || []) if (m.tipo === 'texto') await usarRespuesta(c, lineaId, String(m.contenido || ''));
}
