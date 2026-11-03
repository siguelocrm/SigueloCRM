import { Router, type Request, type Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { db } from '../db.js';
import { elegirVariante } from '../textos.js';
import { variablesDeLinea } from '../negocios.js';
import { accesoDe, veLinea } from '../usuarios/accesos.js';
import { obtenerSesion } from '../../whatsapp/sesiones.js';
import { marcarEnviadoPorCRM } from '../../whatsapp/mensajes-enviados-por-crm.js';
import type { FiltroMasivo, MasivoRow } from '../tipos.js';
import { MAX_DESTINATARIOS, armarDestinatarios, contenidoMasivo, limpiarTelefono } from './masivos.js';

// Mensajes masivos: contar a quiénes les llega, crear, pausar, reanudar,
// cancelar y mandarte una prueba. Solo dueños y gerentes, y solo desde
// números a los que tienen acceso.

export const masivosRouter = Router();
const soloAdmin = requiereRol('supervisor', 'dueno');

const hhmm = (v: unknown, defecto: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : defecto);
const entero = (v: unknown, min: number, max: number, defecto: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defecto;
};

function leerFiltro(f: unknown): FiltroMasivo {
  const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_DESTINATARIOS * 2) : []);
  return {
    origen: o.origen === 'todos' || o.origen === 'lista' ? o.origen : 'chats',
    etapas: lista(o.etapas),
    etiquetas: lista(o.etiquetas),
    sin_perdidos: o.sin_perdidos !== false,
    lista: o.origen === 'lista' ? lista(o.lista) : [],
  };
}

// ¿Puede usar ese número? Devuelve la empresa o responde el error.
async function numeroPermitido(req: Request, res: Response, lineaId: unknown): Promise<string | null> {
  if (typeof lineaId !== 'string' || !lineaId) {
    res.status(400).json({ error: 'Elige desde qué número se envía.' });
    return null;
  }
  const yo = await accesoDe(req.usuarioAutenticado!.id);
  const { data: linea } = await db.from('lineas_whatsapp').select('id, empresa_id').eq('id', lineaId).maybeSingle();
  if (!yo || !linea || linea.empresa_id !== yo.empresa_id || !veLinea(yo, lineaId)) {
    res.status(403).json({ error: 'No tienes acceso a ese número.' });
    return null;
  }
  return linea.empresa_id;
}

const textosValidos = (v: unknown) => (Array.isArray(v) ? v.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 4000)) : []);

function mediaValida(b: Record<string, unknown>): Pick<MasivoRow, 'media_tipo' | 'media_url' | 'media_nombre'> {
  const tipo = b.media_tipo === 'imagen' || b.media_tipo === 'pdf' ? b.media_tipo : null;
  const url = typeof b.media_url === 'string' && /^https:\/\//.test(b.media_url) ? b.media_url : null;
  return tipo && url ? { media_tipo: tipo, media_url: url, media_nombre: typeof b.media_nombre === 'string' ? b.media_nombre.slice(0, 120) : null } : { media_tipo: null, media_url: null, media_nombre: null };
}

masivosRouter.post('/siguelo/masivos/contar', soloAdmin, async (req, res) => {
  const empresaId = await numeroPermitido(req, res, req.body?.linea_id);
  if (!empresaId) return;
  try {
    const lista = await armarDestinatarios(empresaId, req.body.linea_id, leerFiltro(req.body?.filtro));
    res.json({ ok: true, total: lista.length, maximo: MAX_DESTINATARIOS, ejemplos: lista.slice(0, 8).map((d) => d.nombre || `+${d.telefono}`) });
  } catch (err) {
    res.status(500).json({ error: `No se pudo contar: ${(err as Error).message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  }
});

masivosRouter.post('/siguelo/masivos', soloAdmin, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const empresaId = await numeroPermitido(req, res, b.linea_id);
  if (!empresaId) return;
  const lineaId = b.linea_id as string;
  const nombre = String(b.nombre ?? '').trim().slice(0, 120);
  const textos = textosValidos(b.textos);
  const media = mediaValida(b);
  if (!nombre) return res.status(400).json({ error: 'Ponle un nombre al envío.' });
  if (!textos.length && !media.media_url) return res.status(400).json({ error: 'Escribe el mensaje.' });
  const filtro = leerFiltro(b.filtro);
  const inicia = typeof b.inicia_en === 'string' && !Number.isNaN(Date.parse(b.inicia_en)) ? new Date(b.inicia_en) : new Date();
  const desde = hhmm(b.hora_inicio, '08:00');
  const hasta = hhmm(b.hora_fin, '20:00');
  if (desde >= hasta) return res.status(400).json({ error: 'El horario no es válido: la hora de inicio tiene que ser antes que la de fin.' });
  const pausaMin = entero(b.pausa_min_seg, 20, 3600, 40);
  const pausaMax = Math.max(pausaMin, entero(b.pausa_max_seg, 20, 3600, 120));

  let destinatarios;
  try {
    destinatarios = await armarDestinatarios(empresaId, lineaId, filtro);
  } catch (err) {
    return res.status(500).json({ error: `No se pudo armar la lista: ${(err as Error).message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  }
  if (!destinatarios.length) return res.status(400).json({ error: 'Con esos filtros no le llega a nadie.' });
  if (destinatarios.length > MAX_DESTINATARIOS) return res.status(400).json({ error: `Son ${destinatarios.length} personas: el máximo por envío es ${MAX_DESTINATARIOS}. Divide la lista en varios envíos.` });

  const { data: aj } = await db.from('siguelo_ajustes').select('zona_horaria').eq('empresa_id', empresaId).maybeSingle();
  const { data: masivo, error } = await db
    .from('siguelo_masivos')
    .insert({
      empresa_id: empresaId,
      nombre,
      linea_id: lineaId,
      textos,
      ...media,
      filtro: filtro.origen === 'lista' ? { ...filtro, lista: [] } : filtro,
      estado: 'programado',
      inicia_en: inicia.toISOString(),
      zona_horaria: aj?.zona_horaria || 'America/La_Paz',
      hora_inicio: desde,
      hora_fin: hasta,
      pausa_min_seg: pausaMin,
      pausa_max_seg: pausaMax,
      maximo_diario: entero(b.maximo_diario, 1, 1000, 150),
      total: destinatarios.length,
      creado_por: req.usuarioAutenticado!.id,
    })
    .select('id')
    .single();
  if (error || !masivo) return res.status(500).json({ error: `No se pudo guardar: ${error?.message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  // El orden se mezcla al azar: así no les llega a todos en el orden de la lista.
  const mezclados = [...destinatarios].sort(() => Math.random() - 0.5);
  for (let i = 0; i < mezclados.length; i += 500) {
    const { error: e } = await db.from('siguelo_masivo_envios').insert(
      mezclados.slice(i, i + 500).map((d, k) => ({ masivo_id: masivo.id, empresa_id: empresaId, contacto_id: d.contacto_id, telefono: d.telefono, nombre: d.nombre, orden: i + k })),
    );
    if (e) {
      await db.from('siguelo_masivos').delete().eq('id', masivo.id);
      return res.status(500).json({ error: `No se pudo guardar la lista: ${e.message}` });
    }
  }
  res.json({ ok: true, id: masivo.id, total: destinatarios.length });
});

masivosRouter.post('/siguelo/masivos/:id/accion', soloAdmin, async (req, res) => {
  const { data: m } = await db.from('siguelo_masivos').select('*').eq('id', req.params.id).maybeSingle();
  if (!m) return res.status(404).json({ error: 'Ese envío ya no existe.' });
  if (!(await numeroPermitido(req, res, m.linea_id))) return;
  const accion = req.body?.accion;
  const ahora = new Date().toISOString();
  if (accion === 'pausar') {
    if (!['programado', 'enviando'].includes(m.estado)) return res.status(400).json({ error: 'Ese envío no está en marcha.' });
    await db.from('siguelo_masivos').update({ estado: 'pausado', motivo: null, actualizado_en: ahora }).eq('id', m.id);
  } else if (accion === 'reanudar') {
    if (m.estado !== 'pausado') return res.status(400).json({ error: 'Ese envío no está en pausa.' });
    await db.from('siguelo_masivos').update({ estado: 'enviando', motivo: null, actualizado_en: ahora }).eq('id', m.id);
  } else if (accion === 'cancelar') {
    if (['terminado', 'cancelado'].includes(m.estado)) return res.status(400).json({ error: 'Ese envío ya terminó.' });
    await db.from('siguelo_masivo_envios').update({ estado: 'cancelado', motivo: 'Cancelaste el envío' }).eq('masivo_id', m.id).eq('estado', 'pendiente');
    await db.from('siguelo_masivos').update({ estado: 'cancelado', motivo: null, terminado_en: ahora, actualizado_en: ahora }).eq('id', m.id);
  } else if (accion === 'eliminar') {
    if (['programado', 'enviando'].includes(m.estado)) return res.status(400).json({ error: 'Primero cancélalo o pausa el envío.' });
    await db.from('siguelo_masivos').delete().eq('id', m.id);
  } else {
    return res.status(400).json({ error: 'Acción no válida.' });
  }
  res.json({ ok: true });
});

// Te manda el mensaje a ti (o a quien pongas) para que veas cómo llega. No queda en ningún chat.
masivosRouter.post('/siguelo/masivos/prueba', soloAdmin, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!(await numeroPermitido(req, res, b.linea_id))) return;
  const telefono = limpiarTelefono(String(b.telefono ?? ''));
  if (!telefono) return res.status(400).json({ error: 'Escribe el número al que te llega la prueba (por ejemplo 70000000).' });
  const textos = textosValidos(b.textos);
  const media = mediaValida(b);
  if (!textos.length && !media.media_url) return res.status(400).json({ error: 'Escribe el mensaje.' });
  const sesion = obtenerSesion(b.linea_id as string);
  if (!sesion || sesion.estado !== 'activo') return res.status(503).json({ error: 'Ese número no está conectado (revisa Conexiones).' });
  const elegido = elegirVariante(textos, String(b.nombre ?? '') || 'Prueba', null, await variablesDeLinea(b.linea_id as string));
  if (!elegido.texto && !media.media_url) return res.status(400).json({ error: `Falta completar ${elegido.faltan.join(', ')} en la ficha del negocio de ese número.` });
  try {
    const r = await sesion.sock.sendMessage(`${telefono}@s.whatsapp.net`, contenidoMasivo(media, elegido.texto));
    if (r?.key?.id) marcarEnviadoPorCRM(r.key.id);
    res.json({ ok: true, texto: elegido.texto });
  } catch (err) {
    res.status(500).json({ error: `No se pudo enviar: ${(err as Error).message}` });
  }
});
