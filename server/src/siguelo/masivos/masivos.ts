import type { AnyMessageContent } from '@whiskeysockets/baileys';
import { db } from '../db.js';
import { MIN, enFranja, inicioDelDia, type Franja } from '../horario.js';
import { elegirVariante } from '../textos.js';
import { variablesDeLinea } from '../negocios.js';
import { obtenerSesion } from '../../whatsapp/sesiones.js';
import { marcarEnviadoPorCRM } from '../../whatsapp/mensajes-enviados-por-crm.js';
import type { FiltroMasivo, MasivoEnvioRow, MasivoRow } from '../tipos.js';

// Mensajes masivos (SígueloCRM): un mensaje a muchos contactos desde un número,
// sin apuro y con los mismos cuidados que el seguimiento para que WhatsApp no
// bloquee el número: solo dentro del horario, una pausa al azar entre envíos,
// un tope por día (contado por número, sumando todos sus masivos), primero se
// revisa que el número tenga WhatsApp, varias versiones del texto y pausa sola
// después de 3 errores seguidos. Las pantallas están en client/src/features/masivos.

export const MAX_DESTINATARIOS = 5000;
const ERRORES_PARA_PAUSAR = 3;

// ---------- A quién le llega ----------

export type Destinatario = { telefono: string; nombre: string | null; contacto_id: string | null };

// Solo números de verdad (sin grupos ni @lid). 8 dígitos (celular de Bolivia) → se agrega 591.
export function limpiarTelefono(crudo: string): string | null {
  const t = String(crudo || '').replace(/[^\d]/g, '');
  if (/^[67]\d{7}$/.test(t)) return `591${t}`;
  return /^\d{10,15}$/.test(t) ? t : null;
}

// "59170000000, Juan Pérez" o "70000000 Juan" → número y nombre.
export function leerLinea(linea: string): { telefono: string; nombre: string | null } | null {
  const m = String(linea || '').trim().match(/^([+\d][\d\s\-().]{6,})[\s,;:\t-]*(.*)$/);
  if (!m) return null;
  const telefono = limpiarTelefono(m[1]);
  return telefono ? { telefono, nombre: m[2].trim() || null } : null;
}

// Trae todas las filas de a 1000 (Supabase devuelve como mucho 1000 por pedido).
async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
    if (!data || data.length < 1000 || filas.length > 50_000) return filas;
  }
}

type ContactoCorto = { id: string; telefono: string; nombre: string | null; etapa_id: string | null };

async function contactosPorTelefono(empresaId: string, telefonos: string[]): Promise<Map<string, ContactoCorto>> {
  const mapa = new Map<string, ContactoCorto>();
  for (let i = 0; i < telefonos.length; i += 200) {
    const { data } = await db.from('contactos').select('id, telefono, nombre, etapa_id').eq('empresa_id', empresaId).in('telefono', telefonos.slice(i, i + 200));
    for (const c of data || []) mapa.set(c.telefono, c);
  }
  return mapa;
}

export async function armarDestinatarios(empresaId: string, lineaId: string, filtro: FiltroMasivo): Promise<Destinatario[]> {
  // 1. De dónde salen los números.
  let base: { telefono: string; nombre: string | null }[] = [];
  if (filtro.origen === 'lista') {
    base = (filtro.lista || []).map(leerLinea).filter((x): x is { telefono: string; nombre: string | null } => !!x);
  } else if (filtro.origen === 'chats') {
    const chats = await todas((d, h) => db.from('conversaciones').select('contacto_telefono, contacto_nombre').eq('linea_id', lineaId).order('creado_en').range(d, h));
    base = chats.map((c) => ({ telefono: c.contacto_telefono, nombre: c.contacto_nombre }));
  } else {
    const cs = await todas((d, h) => db.from('contactos').select('telefono, nombre').eq('empresa_id', empresaId).order('creado_en').range(d, h));
    base = cs.map((c) => ({ telefono: c.telefono, nombre: c.nombre }));
  }
  // Sin repetidos y solo números de verdad.
  const unicos = new Map<string, { telefono: string; nombre: string | null }>();
  for (const b of base) {
    const t = filtro.origen === 'lista' ? b.telefono : /^\d{10,15}$/.test(b.telefono) ? b.telefono : null;
    if (t && !unicos.has(t)) unicos.set(t, { telefono: t, nombre: b.nombre });
  }
  const contactos = await contactosPorTelefono(empresaId, [...unicos.keys()]);

  // 2. Filtros (etapas, etiquetas, sin "perdidos").
  const etapas = new Set(filtro.etapas || []);
  let conEtiqueta: Set<string> | null = null;
  if (filtro.etiquetas?.length) {
    const filas = await todas((d, h) => db.from('contacto_etiquetas').select('contacto_id').in('etiqueta_id', filtro.etiquetas!).range(d, h));
    conEtiqueta = new Set(filas.map((f) => f.contacto_id));
  }
  let perdidas = new Set<string>();
  if (filtro.sin_perdidos !== false) {
    const { data } = await db.from('etapas_venta').select('id').eq('empresa_id', empresaId).eq('tipo', 'perdida');
    perdidas = new Set((data || []).map((e) => e.id));
  }
  const salida: Destinatario[] = [];
  for (const u of unicos.values()) {
    const c = contactos.get(u.telefono);
    if (etapas.size && (!c?.etapa_id || !etapas.has(c.etapa_id))) continue;
    if (conEtiqueta && (!c || !conEtiqueta.has(c.id))) continue;
    if (c?.etapa_id && perdidas.has(c.etapa_id)) continue;
    salida.push({ telefono: u.telefono, nombre: (filtro.origen === 'lista' && u.nombre) || c?.nombre || u.nombre || null, contacto_id: c?.id ?? null });
  }
  return salida;
}

// ---------- El envío ----------

type EstadoLinea = { proximo: number; erroresSeguidos: number };
const lineas = new Map<string, EstadoLinea>();
const azar = (m: Pick<MasivoRow, 'pausa_min_seg' | 'pausa_max_seg'>) => {
  const min = Math.min(m.pausa_min_seg, m.pausa_max_seg);
  const max = Math.max(m.pausa_min_seg, m.pausa_max_seg);
  return (min + Math.random() * (max - min)) * 1000;
};
const franjaDe = (m: MasivoRow): Franja => ({ zona: m.zona_horaria, desde: m.hora_inicio, hasta: m.hora_fin });

// El mensaje de WhatsApp: texto, imagen con leyenda o PDF con leyenda.
export function contenidoMasivo(m: Pick<MasivoRow, 'media_tipo' | 'media_url' | 'media_nombre'>, texto: string): AnyMessageContent {
  if (m.media_tipo === 'imagen' && m.media_url) return { image: { url: m.media_url }, caption: texto || undefined };
  if (m.media_tipo === 'pdf' && m.media_url) return { document: { url: m.media_url }, mimetype: 'application/pdf', fileName: m.media_nombre || 'documento.pdf', caption: texto || undefined };
  return { text: texto };
}

// ¿Ese número tiene WhatsApp? (si la línea no lo puede revisar, se asume que sí)
async function tieneWhatsapp(sock: unknown, telefono: string): Promise<boolean> {
  const s = sock as { onWhatsApp?: (...jids: string[]) => Promise<{ exists: unknown }[] | undefined> };
  if (typeof s.onWhatsApp !== 'function') return true;
  try {
    const r = await s.onWhatsApp(`${telefono}@s.whatsapp.net`);
    if (!Array.isArray(r)) return true;
    return r.length > 0 && !!r[0].exists;
  } catch {
    return true;
  }
}

async function asegurarContacto(empresaId: string, d: Pick<MasivoEnvioRow, 'contacto_id' | 'telefono' | 'nombre'>): Promise<string | null> {
  if (d.contacto_id) return d.contacto_id;
  const { data: existe } = await db.from('contactos').select('id, nombre').eq('empresa_id', empresaId).eq('telefono', d.telefono).maybeSingle();
  if (existe) {
    if (!existe.nombre && d.nombre) await db.from('contactos').update({ nombre: d.nombre }).eq('id', existe.id);
    return existe.id;
  }
  const { data: nuevo } = await db.from('contactos').insert({ empresa_id: empresaId, telefono: d.telefono, nombre: d.nombre }).select('id').single();
  return nuevo?.id ?? null;
}

// El chat de ese número en esa línea (el abierto, o se reabre el último, o uno nuevo).
async function chatDe(lineaId: string, telefono: string, nombre: string | null): Promise<string | null> {
  const { data: previos } = await db
    .from('conversaciones')
    .select('id, estado')
    .eq('linea_id', lineaId)
    .eq('contacto_telefono', telefono)
    .order('ultima_actividad', { ascending: false })
    .limit(5);
  const abierto = (previos || []).find((c) => c.estado === 'abierto');
  const ahora = new Date().toISOString();
  if (abierto) {
    await db.from('conversaciones').update({ ultima_actividad: ahora }).eq('id', abierto.id);
    return abierto.id;
  }
  if (previos?.length) {
    await db.from('conversaciones').update({ estado: 'abierto', ultima_actividad: ahora }).eq('id', previos[0].id);
    return previos[0].id;
  }
  const { data } = await db.from('conversaciones').insert({ linea_id: lineaId, contacto_telefono: telefono, contacto_nombre: nombre, estado: 'abierto', ultima_actividad: ahora }).select('id').single();
  return data?.id ?? null;
}

// Cuántos salieron hoy desde este número, sumando todos sus masivos.
async function enviadosHoy(m: MasivoRow, ahora: number): Promise<number> {
  const desde = new Date(inicioDelDia(ahora, { ...franjaDe(m), desde: '00:00' })).toISOString();
  const { data: suyos } = await db.from('siguelo_masivos').select('id').eq('linea_id', m.linea_id).gte('actualizado_en', new Date(ahora - 3 * 24 * 60 * MIN).toISOString());
  const ids = [...new Set([m.id, ...(suyos || []).map((x) => x.id)])];
  const { count } = await db.from('siguelo_masivo_envios').select('id', { count: 'exact', head: true }).in('masivo_id', ids).eq('estado', 'enviado').gte('enviado_en', desde);
  return count ?? 0;
}

async function actualizarMasivo(m: MasivoRow, cambios: Partial<MasivoRow>): Promise<void> {
  Object.assign(m, cambios);
  await db.from('siguelo_masivos').update({ ...cambios, actualizado_en: new Date().toISOString() }).eq('id', m.id);
}

async function cerrarEnvio(e: MasivoEnvioRow, cambios: Partial<MasivoEnvioRow>): Promise<void> {
  await db.from('siguelo_masivo_envios').update(cambios).eq('id', e.id);
}

// Un envío de un masivo (como mucho uno por número en cada vuelta).
async function enviarUno(m: MasivoRow, ahora: number): Promise<void> {
  const est = lineas.get(m.linea_id) ?? { proximo: ahora + 5_000 + Math.random() * 10_000, erroresSeguidos: 0 };
  lineas.set(m.linea_id, est);
  if (ahora < est.proximo) return;

  if (!enFranja(ahora, franjaDe(m))) {
    if (m.motivo !== 'fuera') await actualizarMasivo(m, { motivo: 'fuera' });
    return;
  }
  const sesion = obtenerSesion(m.linea_id);
  if (!sesion || sesion.estado !== 'activo') {
    if (m.motivo !== 'desconectado') await actualizarMasivo(m, { motivo: 'desconectado' });
    return;
  }
  if ((await enviadosHoy(m, ahora)) >= m.maximo_diario) {
    if (m.motivo !== 'tope') await actualizarMasivo(m, { motivo: 'tope' });
    return;
  }

  const { data: siguiente } = await db.from('siguelo_masivo_envios').select('*').eq('masivo_id', m.id).eq('estado', 'pendiente').order('orden').limit(1).maybeSingle();
  if (!siguiente) {
    const { count } = await db.from('siguelo_masivo_envios').select('id', { count: 'exact', head: true }).eq('masivo_id', m.id).eq('estado', 'enviando');
    if (!count) await actualizarMasivo(m, { estado: 'terminado', motivo: null, terminado_en: new Date().toISOString() });
    return;
  }
  // Lo reclama: si otra vuelta ya lo tomó, no hace nada.
  const { data: reclamado } = await db.from('siguelo_masivo_envios').update({ estado: 'enviando' }).eq('id', siguiente.id).eq('estado', 'pendiente').select('id');
  if (!reclamado?.length) return;
  if (m.estado !== 'enviando' || m.motivo) await actualizarMasivo(m, { estado: 'enviando', motivo: null });

  if (!(await tieneWhatsapp(sesion.sock, siguiente.telefono))) {
    await cerrarEnvio(siguiente, { estado: 'error', motivo: 'Ese número no tiene WhatsApp' });
    await actualizarMasivo(m, { errores: m.errores + 1 });
    est.proximo = Date.now() + 3_000 + Math.random() * 4_000;
    return;
  }

  const variables = await variablesDeLinea(m.linea_id);
  const elegido = elegirVariante(m.textos, siguiente.nombre, null, variables);
  if (!elegido.texto && !m.media_url) {
    const motivo = elegido.faltan.length ? `Falta completar ${elegido.faltan.join(', ')} en la ficha del negocio` : 'El mensaje no tiene texto';
    await cerrarEnvio(siguiente, { estado: 'error', motivo });
    await actualizarMasivo(m, { errores: m.errores + 1 });
    return;
  }

  try {
    const contactoId = await asegurarContacto(m.empresa_id, siguiente);
    const chatId = await chatDe(m.linea_id, siguiente.telefono, siguiente.nombre);
    const resultado = await sesion.sock.sendMessage(`${siguiente.telefono}@s.whatsapp.net`, contenidoMasivo(m, elegido.texto));
    const whatsappId = resultado?.key?.id || null;
    if (whatsappId) marcarEnviadoPorCRM(whatsappId);
    const { data: mensaje } = chatId
      ? await db
          .from('mensajes')
          .insert({
            conversacion_id: chatId,
            remitente: 'agente',
            agente_id: null,
            tipo: m.media_url && m.media_tipo ? m.media_tipo : 'texto',
            // Igual que el resto del CRM: en un PDF, "contenido" es el nombre del archivo.
            contenido: m.media_tipo === 'pdf' && m.media_url ? m.media_nombre || 'documento.pdf' : elegido.texto,
            media_url: m.media_url && m.media_tipo ? m.media_url : null,
            whatsapp_id: whatsappId,
          })
          .select('id')
          .single()
      : { data: null };
    await cerrarEnvio(siguiente, { estado: 'enviado', contacto_id: contactoId, texto: elegido.texto, mensaje_id: mensaje?.id ?? null, whatsapp_id: whatsappId, enviado_en: new Date().toISOString(), motivo: null });
    await actualizarMasivo(m, { enviados: m.enviados + 1 });
    console.log(`📣 Masivo "${m.nombre}": enviado a +${siguiente.telefono}`);
    est.erroresSeguidos = 0;
  } catch (err) {
    const motivo = (err as Error).message.slice(0, 200);
    await cerrarEnvio(siguiente, { estado: 'error', motivo });
    await actualizarMasivo(m, { errores: m.errores + 1 });
    console.error(`📣 Masivo "${m.nombre}": no se pudo enviar a +${siguiente.telefono}: ${motivo}`);
    if (++est.erroresSeguidos >= ERRORES_PARA_PAUSAR) {
      est.erroresSeguidos = 0;
      await actualizarMasivo(m, { estado: 'pausado', motivo: `Se pausó solo: ${ERRORES_PARA_PAUSAR} errores de envío seguidos. Revisa el número en Conexiones y pulsa "Reanudar".` });
    }
  }
  est.proximo = Date.now() + azar(m);
}

// Una vuelta: cada número manda como mucho un mensaje (el masivo más antiguo primero).
export async function procesarMasivos(): Promise<void> {
  const ahora = Date.now();
  const { data, error } = await db
    .from('siguelo_masivos')
    .select('*')
    .in('estado', ['programado', 'enviando'])
    .lte('inicia_en', new Date(ahora).toISOString())
    .order('creado_en')
    .limit(100);
  if (error || !data?.length) return;
  const usadas = new Set<string>();
  for (const m of data) {
    if (usadas.has(m.linea_id)) continue;
    usadas.add(m.linea_id);
    await enviarUno(m, ahora);
  }
}

// Al arrancar: lo que quedó "enviando" por un reinicio a mitad de camino vuelve a la fila.
export async function reanudarAlArrancar(): Promise<void> {
  await db.from('siguelo_masivo_envios').update({ estado: 'pendiente' }).eq('estado', 'enviando');
}

// Para las pruebas.
export const _reiniciarRitmo = () => lineas.clear();
