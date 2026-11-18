import { db } from '../db.js';
import { DIA, fechaDe, fechaMasDias, instante } from '../horario.js';
import type { NegocioRow } from '../tipos.js';

// Las consultas de datos del Asistente (IA → Asistente): "¿cuántos respondieron?", "¿qué cursos
// piden más?", "¿a cuántos de Cercado les mandaste los horarios?". La IA pide las consultas que
// necesita (con la sede y el período), el servidor las cuenta en la base (sección 43 de
// siguelo.sql) y la IA responde con esos números. Nunca ve datos de otra cuenta.

export type Consulta = Record<string, unknown>;
const MAX_CONSULTAS = 8;
const DIAS_POR_DEFECTO = 7;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const CONSULTAS = `CONSULTAS DE DATOS (para preguntas sobre números: cuántos escribieron, respondieron, qué piden más, cuántos van a asistir, por sede...):
Si la pregunta necesita datos, NO respondas todavía: devuelve {"respuesta": "", "acciones": [], "consultas": [...]} y el sistema te devuelve los resultados para que respondas.
Cada consulta lleva "negocio": "n1" (una sede o negocio; null = todos juntos), "desde" y "hasta": "AAAA-MM-DD" (si el dueño no dice el período, los últimos ${DIAS_POR_DEFECTO} días; "hoy", "esta semana", "este mes" calcúlalos con la fecha actual). Para comparar sedes, una consulta por sede.
1. {"tipo": "resumen", ...}: personas que escribieron, nuevas, a cuántas les escribimos, a cuántas respondió la IA, cuántas respondieron a un mensaje nuestro, seguimiento y masivos (enviados y cuántos respondieron), respuestas rápidas enviadas (por título, por ejemplo "Horarios"), QR enviados y pagos por curso, lo que más les interesa (anotado por la IA en cada chat), en qué etapa están hoy y citas agendadas.
2. {"tipo": "buscar", "quien": "nosotros" | "cliente" | "todos", "palabras": ["horario", "horarios"], ...}: a cuántas personas distintas les escribimos (o escribieron) algo con esas palabras, con ejemplos. Pon variantes (singular, plural, sin tilde).
3. {"tipo": "etapa", "etapa": "e3", ...}: cuántos están hoy en esa etapa del embudo, cuántos entraron en el período y nombres.
Consejos: "¿a cuántos les mandaste los horarios?" → resumen (respuestas rápidas cuyo título dice horario) y buscar quien "nosotros" con "horario". "¿Cuántos van a asistir?" → etapa que signifique eso (Asistirá, Confirmado, Inscrito...) y, si no hay, buscar quien "cliente" con "voy a ir", "asistiré", "confirmo", "ahí estaré". "¿Qué cursos piden más?" → resumen (intereses, QR y pagos).`;

export const EXPLICACION_RESULTADOS = `Cómo leer los resultados (todo en personas distintas, en ese período y en los números de esa sede):
- escribieron: personas que escribieron. nuevos: escribieron por primera vez. les_escribimos: les mandamos algo (IA, equipo, seguimiento o masivo). equipo_escribio: les escribió una persona del equipo. ia_respondio: la IA les respondió. respondieron_a_un_mensaje_nuestro: después de un mensaje nuestro, contestaron.
- seguimiento / masivos: a cuántas personas les llegó y cuántas respondieron después.
- respuestas_rapidas: cuántas personas recibieron cada respuesta rápida (por título). qr_enviados: a cuántas se les mandó el QR de cada curso. pagos: comprobantes confirmados por curso y el total.
- intereses: lo que la IA anotó que le interesa a cada persona (agrupa los parecidos al responder). etapas_hoy: en qué etapa están hoy los que escribieron. citas_agendadas: citas nuevas.
- buscar: personas con al menos un mensaje con esas palabras (y ejemplos). etapa: personas en esa etapa hoy y cuántas entraron en el período.
Responde con los números concretos, di el período y la sede, y si el dato es aproximado (por ejemplo una búsqueda de palabras) explícalo en una línea. Si algo no se puede saber con estos datos, dilo. No inventes números.`;

type Contexto = { empresaId: string; zona: string; negocios: Map<string, NegocioRow>; etapas: Map<string, { id: string; nombre: string }> };

// "2026-11-01" → el inicio de ese día en la zona del negocio.
function periodo(c: Contexto, desde: unknown, hasta: unknown) {
  const hoy = fechaDe(Date.now(), c.zona);
  const h = typeof hasta === 'string' && FECHA.test(hasta) ? hasta : hoy;
  const d = typeof desde === 'string' && FECHA.test(desde) ? desde : fechaMasDias(h, -(DIAS_POR_DEFECTO - 1));
  const [a, b] = d <= h ? [d, h] : [h, d];
  const inicio = instante(a, '00:00', c.zona);
  const fin = Math.min(instante(fechaMasDias(b, 1), '00:00', c.zona), inicio + 400 * DIA);
  return { desde: new Date(inicio).toISOString(), hasta: new Date(fin).toISOString(), texto: a === b ? `el ${a}` : `del ${a} al ${b}` };
}

async function lineasDe(c: Contexto, negocioCorto: unknown): Promise<{ lineas: string[]; sede: string } | string> {
  if (negocioCorto && typeof negocioCorto === 'string' && negocioCorto !== 'null') {
    const n = c.negocios.get(negocioCorto.trim());
    if (!n) return `no encontré el negocio "${negocioCorto}"`;
    const { data } = await db.from('siguelo_lineas').select('linea_id').eq('negocio_id', n.id);
    const lineas = (data || []).map((x) => x.linea_id);
    if (!lineas.length) return `"${n.nombre}" no tiene números asignados`;
    return { lineas, sede: `${n.nombre}${n.sucursal ? ` (${n.sucursal})` : ''}` };
  }
  const { data } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', c.empresaId);
  return { lineas: (data || []).map((x) => x.id), sede: 'todos los números' };
}

async function una(c: Contexto, q: Consulta): Promise<Record<string, unknown>> {
  const tipo = String(q.tipo || '');
  const p = periodo(c, q.desde, q.hasta);
  const donde = await lineasDe(c, q.negocio);
  if (typeof donde === 'string') return { consulta: tipo, error: donde };
  const base = { consulta: tipo, sede: donde.sede, periodo: p.texto };
  const r = (x: { data: unknown; error: { message: string } | null }) => x;
  const llamar = async (consulta: Promise<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = r(await consulta);
    if (error) return { ...base, error: /function|does not exist|schema cache/i.test(error.message) ? 'falta pegar la sección 43 de database/siguelo.sql en Supabase' : error.message };
    return { ...base, resultado: data };
  };
  if (tipo === 'resumen') return llamar(Promise.resolve(db.rpc('siguelo_datos_resumen', { p_empresa: c.empresaId, p_lineas: donde.lineas, p_desde: p.desde, p_hasta: p.hasta })));
  if (tipo === 'buscar') {
    const palabras = (Array.isArray(q.palabras) ? q.palabras : [q.palabras])
      .map((x) => String(x ?? '').trim().replace(/[%_\\]/g, '').slice(0, 40))
      .filter((x) => x.length >= 2)
      .slice(0, 10);
    if (!palabras.length) return { ...base, error: 'faltan las palabras a buscar' };
    const quien = q.quien === 'nosotros' ? 'agente' : q.quien === 'cliente' ? 'cliente' : null;
    return llamar(Promise.resolve(db.rpc('siguelo_datos_buscar', { p_empresa: c.empresaId, p_lineas: donde.lineas, p_desde: p.desde, p_hasta: p.hasta, p_remitente: quien, p_palabras: palabras })));
  }
  if (tipo === 'etapa') {
    const etapa = typeof q.etapa === 'string' ? c.etapas.get(q.etapa.trim()) : undefined;
    if (!etapa) return { ...base, error: 'no encontré esa etapa' };
    const hecho = await llamar(Promise.resolve(db.rpc('siguelo_datos_etapa', { p_empresa: c.empresaId, p_lineas: donde.lineas, p_etapa: etapa.id, p_desde: p.desde, p_hasta: p.hasta })));
    return { ...hecho, etapa: etapa.nombre };
  }
  return { consulta: tipo, error: `no sé hacer la consulta "${tipo}"` };
}

// Corre las consultas que pidió la IA y devuelve los resultados en texto (JSON) para su segunda vuelta.
export async function consultarDatos(c: Contexto, consultas: unknown): Promise<{ texto: string; hechas: number }> {
  const lista = (Array.isArray(consultas) ? consultas : []).filter((q): q is Consulta => !!q && typeof q === 'object').slice(0, MAX_CONSULTAS);
  const resultados = await Promise.all(lista.map((q) => una(c, q).catch((err) => ({ consulta: String(q.tipo), error: (err as Error).message }))));
  return { texto: JSON.stringify(resultados), hechas: lista.length };
}
