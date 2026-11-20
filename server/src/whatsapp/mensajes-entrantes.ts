import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { downloadMediaMessage, normalizeMessageContent, toNumber } from '@whiskeysockets/baileys';
import { supabase } from '../supabase/client.js';
import type { ConversacionRow, TipoMensaje } from '../types/dominio.js';
import { obtenerEmpresaIdDeLinea } from './empresa.js';
import { buscarContactoPorLid, registrarLidDeContacto } from './contactos.js';
import { intentarResponderAutomaticamente } from './bot-automatico.js';
import { guardarOrigenDeAnuncio } from './origen-anuncio.js';
import { mensajeNuevo } from '../siguelo/eventos.js';

interface ResultadoDeteccion {
  tipo: TipoMensaje;
  texto: string;
  esMedia: boolean;
}

// Mira qué trae el mensaje de Baileys y devuelve el tipo y el texto/caption.
// Si es un tipo que no manejamos todavía (reacciones, stickers, mensajes de
// protocolo, etc.), devuelve null para que se ignore sin guardar nada.
export function detectarTipoYTexto(msg: WAMessage): ResultadoDeteccion | null {
  const m = msg.message || {};
  if (m.conversation || m.extendedTextMessage) {
    return { tipo: 'texto', texto: m.conversation || m.extendedTextMessage?.text || '', esMedia: false };
  }
  if (m.imageMessage) {
    return { tipo: 'imagen', texto: m.imageMessage.caption || '', esMedia: true };
  }
  if (m.documentMessage) {
    return {
      tipo: 'pdf',
      texto: m.documentMessage.caption || m.documentMessage.fileName || '',
      esMedia: true,
    };
  }
  if (m.audioMessage) {
    return { tipo: 'audio', texto: '', esMedia: true };
  }
  return null;
}

const EXTENSION_POR_TIPO: Partial<Record<TipoMensaje, string>> = { imagen: 'jpg', pdf: 'pdf', audio: 'ogg' };
const CONTENT_TYPE_POR_TIPO: Partial<Record<TipoMensaje, string>> = {
  imagen: 'image/jpeg',
  pdf: 'application/pdf',
  audio: 'audio/ogg',
};

// Busca una conversación abierta con este contacto en esta línea; si no existe, la crea.
export async function buscarOCrearConversacion(lineaId: string, telefono: string): Promise<ConversacionRow> {
  let { data: conversacion } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('linea_id', lineaId)
    .eq('contacto_telefono', telefono)
    .eq('estado', 'abierto')
    .maybeSingle();

  if (!conversacion) {
    // No hay conversación abierta: si el contacto tiene una conversación
    // cerrada previa en esta línea, la reabrimos para mantener el mismo
    // hilo en vez de crear una nueva.
    const { data: cerrada } = await supabase
      .from('conversaciones')
      .select('id')
      .eq('linea_id', lineaId)
      .eq('contacto_telefono', telefono)
      .neq('estado', 'abierto')
      .order('ultima_actividad', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cerrada) {
      const { data: reabierta, error: errorReabrir } = await supabase
        .from('conversaciones')
        .update({ estado: 'abierto', ultima_actividad: new Date().toISOString() })
        .eq('id', cerrada.id)
        .select('id')
        .single();
      if (errorReabrir) throw errorReabrir;
      conversacion = reabierta;
    } else {
      const { data: nueva, error } = await supabase
        .from('conversaciones')
        .insert({ linea_id: lineaId, contacto_telefono: telefono, estado: 'abierto' })
        .select('id')
        .single();
      if (error) {
        // Otro mensaje del mismo contacto se procesó en paralelo (ej. varios
        // adjuntos reenviados juntos, cada uno como un evento separado de
        // Baileys) y ya creó la conversación abierta antes que nosotros: el
        // índice único de database/instalar.sql rechaza este
        // INSERT duplicado. La reusamos en vez de fallar o crear otra.
        if (error.code === '23505') {
          const { data: existente, error: errorReintento } = await supabase
            .from('conversaciones')
            .select('id')
            .eq('linea_id', lineaId)
            .eq('contacto_telefono', telefono)
            .eq('estado', 'abierto')
            .single();
          if (errorReintento) throw errorReintento;
          conversacion = existente;
        } else {
          throw error;
        }
      } else {
        conversacion = nueva;
      }
    }
  } else {
    await supabase
      .from('conversaciones')
      .update({ ultima_actividad: new Date().toISOString() })
      .eq('id', conversacion.id);
  }

  return conversacion as ConversacionRow;
}

// Preferimos el número real si Baileys lo expone (remoteJidAlt — se llamaba
// senderPn antes de la v7), aunque el remoteJid sea @lid. Ambos vienen como
// JID completo (ej. "59175486929@s.whatsapp.net" o "...@lid"); nos quedamos
// solo con la parte de antes de la @ para guardar un identificador limpio.
// Sirve tanto para mensajes entrantes como salientes: en ambos casos el
// remoteJid identifica al contacto del otro lado del chat, no a quién mandó
// este mensaje puntual.
async function resolverTelefono(msg: WAMessage, lineaId: string): Promise<string> {
  const remoteJid = msg.key.remoteJid || '';
  const remoteJidAlt = msg.key.remoteJidAlt || '';
  let telefono = (remoteJidAlt || remoteJid).split('@')[0];

  if (remoteJid.endsWith('@lid')) {
    const lid = remoteJid.split('@')[0];
    try {
      const empresaId = await obtenerEmpresaIdDeLinea(lineaId);
      if (empresaId) {
        if (remoteJidAlt) {
          // Este mensaje revela los dos identificadores del mismo chat: aprendemos
          // la relación para que un mensaje futuro que solo traiga el @lid (sin
          // remoteJidAlt) y las etiquetas de WhatsApp Business caigan en el mismo
          // contacto (ver database/instalar.sql y whatsapp/etiquetas.ts).
          await registrarLidDeContacto(empresaId, telefono, lid);
        } else {
          // No tenemos el número real en este mensaje puntual: si ya aprendimos
          // la relación antes, la usamos para no reabrir una conversación nueva
          // bajo el @lid en vez de seguir la de siempre.
          const contacto = await buscarContactoPorLid(empresaId, lid);
          if (contacto) telefono = contacto.telefono;
        }
      }
    } catch (err) {
      console.error(`[${lineaId}] Error resolviendo mapeo @lid de contacto:`, (err as Error).message);
    }
  }

  return telefono;
}

async function descargarYSubirMedia(msg: WAMessage, tipo: TipoMensaje, lineaId: string): Promise<string | null> {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    const extension = EXTENSION_POR_TIPO[tipo] || 'bin';
    const nombreArchivo = `${lineaId}/${msg.key.id}.${extension}`;

    const { error: errorSubida } = await supabase.storage
      .from('media')
      .upload(nombreArchivo, buffer as Buffer, {
        contentType: CONTENT_TYPE_POR_TIPO[tipo] || 'application/octet-stream',
      });

    if (errorSubida) {
      console.error('Error subiendo media a Storage:', errorSubida.message);
      return null;
    }
    const { data } = supabase.storage.from('media').getPublicUrl(nombreArchivo);
    return data.publicUrl;
  } catch (err) {
    console.error('Error descargando media:', (err as Error).message);
    return null;
  }
}

// El nombre de perfil que el cliente tiene en su WhatsApp (pushName) llega con
// cada mensaje entrante. Lo guardamos para que el chat y el contacto muestren
// su nombre en vez del número, pero solo si todavía no tienen uno: un nombre
// editado a mano en la ficha nunca se pisa.
async function guardarNombreDePerfil(lineaId: string, telefono: string, conversacionId: string, nombre: string): Promise<void> {
  try {
    await supabase.from('conversaciones').update({ contacto_nombre: nombre }).eq('id', conversacionId).is('contacto_nombre', null);
    const { data: linea } = await supabase.from('lineas_whatsapp').select('empresa_id').eq('id', lineaId).maybeSingle();
    if (linea?.empresa_id) {
      await supabase.from('contactos').update({ nombre }).eq('empresa_id', linea.empresa_id).eq('telefono', telefono).is('nombre', null);
    }
  } catch (err) {
    console.error('No se pudo guardar el nombre de perfil:', (err as Error).message);
  }
}

const LLEGA_TARDE_MS = 10 * 60_000;
// En el historial la hora viene como un Long de protobuf (no un número): Number() daba NaN y se
// descartaba todo. toNumber de Baileys sirve para los dos.
const horaDe = (msg: WAMessage) => toNumber(msg.messageTimestamp as Parameters<typeof toNumber>[0]) * 1000;

export async function procesarMensajeEntrante(msg: WAMessage, sock: WASocket, lineaId: string): Promise<void> {
  const resultado = detectarTipoYTexto(msg);
  if (!resultado) return; // tipo no soportado todavía: se ignora, no se guarda nada

  const { tipo, texto, esMedia } = resultado;
  const telefono = await resolverTelefono(msg, lineaId);
  const mediaUrl = esMedia ? await descargarYSubirMedia(msg, tipo, lineaId) : null;

  const conversacion = await buscarOCrearConversacion(lineaId, telefono);

  const nombrePerfil = msg.pushName?.trim();
  if (nombrePerfil && !msg.key.fromMe) await guardarNombreDePerfil(lineaId, telefono, conversacion.id, nombrePerfil);
  await guardarOrigenDeAnuncio(lineaId, telefono, msg);

  // Baileys puede entregar el mismo mensaje más de una vez (reconexiones,
  // reenvíos de la sincronización). Si ya lo guardamos con ese whatsapp_id,
  // no lo duplicamos.
  if (msg.key.id) {
    const { data: existente } = await supabase
      .from('mensajes')
      .select('id')
      .eq('conversacion_id', conversacion.id)
      .eq('whatsapp_id', msg.key.id)
      .limit(1);
    if (existente && existente.length > 0) return;
  }

  // Un mensaje que llega tarde (el número estuvo desconectado y WhatsApp lo entrega al reconectar)
  // se guarda con su hora real: así la IA no responde de golpe todo lo atrasado (más de 2 h), y queda
  // en IA → "Chats que quedaron sin respuesta" para responderlo despacio.
  const enviadoEn = horaDe(msg);
  const atrasado = enviadoEn > 0 && Date.now() - enviadoEn > LLEGA_TARDE_MS;
  const { error: errorMensaje } = await supabase.from('mensajes').insert({
    conversacion_id: conversacion.id,
    remitente: 'cliente',
    tipo,
    contenido: texto,
    media_url: mediaUrl,
    whatsapp_id: msg.key.id || null,
    ...(atrasado ? { creado_en: new Date(enviadoEn).toISOString() } : {}),
  });

  if (errorMensaje) {
    console.error('Error guardando mensaje:', errorMensaje.message);
  } else {
    console.log(`[${lineaId}] 📩 ${telefono} [${tipo}]: ${texto || mediaUrl}`);
    // SígueloCRM: la IA lo lee en segundos (siguelo/index.ts).
    mensajeNuevo(lineaId);
  }

  // El bot de reglas no contesta lo atrasado (sería una bienvenida horas después).
  if (!errorMensaje && tipo === 'texto' && !atrasado) {
    // Sin await a propósito: una regla puede tener demora configurada (hasta
    // una hora, ver database/instalar.sql) y no queremos
    // frenar acá el procesamiento de los próximos mensajes entrantes del
    // mismo socket mientras la esperamos.
    obtenerEmpresaIdDeLinea(lineaId)
      .then((empresaId) => {
        if (empresaId) return intentarResponderAutomaticamente(sock, lineaId, empresaId, conversacion.id, telefono, texto);
      })
      .catch((err) => console.error(`[${lineaId}] Error en el bot de respuestas automáticas:`, (err as Error).message));
  }
}

// Mensaje saliente que NO pasó por routes/enviar.ts: alguien lo mandó a mano
// desde el teléfono (u otro dispositivo vinculado a esta línea). Sin esto la
// conversación se veía completa en el teléfono pero desactualizada acá,
// porque el CRM nunca se enteraba de esas respuestas.
export async function procesarMensajeSaliente(msg: WAMessage, lineaId: string): Promise<void> {
  const resultado = detectarTipoYTexto(msg);
  if (!resultado) return;

  const { tipo, texto, esMedia } = resultado;
  const telefono = await resolverTelefono(msg, lineaId);
  const mediaUrl = esMedia ? await descargarYSubirMedia(msg, tipo, lineaId) : null;

  const conversacion = await buscarOCrearConversacion(lineaId, telefono);

  const { error: errorMensaje } = await supabase.from('mensajes').insert({
    conversacion_id: conversacion.id,
    remitente: 'agente',
    agente_id: null,
    tipo,
    contenido: texto,
    media_url: mediaUrl,
    whatsapp_id: msg.key.id || null,
  });

  if (errorMensaje) {
    console.error('Error guardando mensaje saliente (desde el teléfono):', errorMensaje.message);
  } else {
    console.log(`[${lineaId}] 📱 (desde el teléfono) → ${telefono} [${tipo}]: ${texto || mediaUrl}`);
  }
}

// Historial que WhatsApp manda al volver a vincular un número (por ejemplo, después de una
// restricción o de escanear el QR de nuevo): los mensajes de los últimos 4 días que el CRM no tiene,
// del cliente y los tuyos desde el teléfono, con su hora real. NO dispara el bot ni la IA al momento:
// aparecen en la Bandeja y en IA → "Chats que quedaron sin respuesta", y tú decides cuándo responder.
const HISTORIAL_MAX_MS = 4 * 24 * 60 * 60_000;
const HISTORIAL_MAX_MENSAJES = 500;

// Lo que pasó con el historial de cada número (se ve en IA → "Chats que quedaron sin respuesta"):
// si WhatsApp lo mandó, cuántos mensajes trajo y cuántos se guardaron. Así, si algo falla, se sabe dónde.
export type EstadoHistorial = {
  vinculado: string | null;
  lotes: number;
  recibidos: number;
  enVentana: number;
  guardados: number;
  yaEstaban: number;
  sinTexto: number;
  errores: number;
  primerError: string | null;
  procesando: boolean;
  hechos: number;
  ultimo: string | null;
};
const historiales = new Map<string, EstadoHistorial>();
const estadoVacio = (): EstadoHistorial => ({ vinculado: null, lotes: 0, recibidos: 0, enVentana: 0, guardados: 0, yaEstaban: 0, sinTexto: 0, errores: 0, primerError: null, procesando: false, hechos: 0, ultimo: null });
export const estadoHistorial = (lineaId: string): EstadoHistorial | null => historiales.get(lineaId) ?? null;
// Al vincular (QR o código): desde aquí se espera el historial.
export function marcarVinculado(lineaId: string): void {
  historiales.set(lineaId, { ...estadoVacio(), vinculado: new Date().toISOString() });
}

// Fotos, audios y documentos del historial no se descargan (con decenas de chats tardaba muchos
// minutos y a veces ya no se pueden bajar): queda una nota y se miran en el teléfono.
const NOTA_MEDIA: Partial<Record<TipoMensaje, string>> = {
  imagen: '📷 Foto (llegó con el número desconectado: mírala en el teléfono)',
  audio: '🎤 Nota de voz (llegó con el número desconectado: escúchala en el teléfono)',
  pdf: '📄 Documento (llegó con el número desconectado: míralo en el teléfono)',
};

type Resultado = 'guardado' | 'ya estaba' | 'sin texto';
async function guardarDelHistorial(original: WAMessage, lineaId: string): Promise<Resultado> {
  if (!original.key.id) return 'sin texto';
  // Mensajes temporales, de una sola vista, etc. vienen envueltos: se sacan del envoltorio.
  const msg = { ...original, message: normalizeMessageContent(original.message) ?? original.message } as WAMessage;
  const resultado = detectarTipoYTexto(msg);
  if (!resultado) return 'sin texto';
  const { tipo, texto, esMedia } = resultado;
  const telefono = await resolverTelefono(msg, lineaId);
  // Primero se mira si ya lo tenemos (en cualquier chat de ese contacto en este número): así un chat
  // viejo sin nada nuevo no se reabre ni sube en la Bandeja.
  const { data: chats } = await supabase.from('conversaciones').select('id').eq('linea_id', lineaId).eq('contacto_telefono', telefono);
  const ids = (chats || []).map((c) => c.id);
  if (ids.length) {
    const { data: existente } = await supabase.from('mensajes').select('id').in('conversacion_id', ids).eq('whatsapp_id', original.key.id).limit(1);
    if (existente && existente.length > 0) return 'ya estaba';
  }
  const conversacion = await buscarOCrearConversacion(lineaId, telefono);
  const contenido = esMedia ? [NOTA_MEDIA[tipo], texto.trim()].filter(Boolean).join('\n') : texto;
  const { error } = await supabase.from('mensajes').insert({
    conversacion_id: conversacion.id,
    remitente: msg.key.fromMe ? 'agente' : 'cliente',
    agente_id: null,
    tipo: 'texto',
    contenido,
    media_url: null,
    whatsapp_id: original.key.id,
    creado_en: new Date(horaDe(msg)).toISOString(),
  });
  if (error) throw new Error(error.message);
  return 'guardado';
}

export async function importarHistorial(mensajes: WAMessage[], lineaId: string): Promise<number> {
  const st = historiales.get(lineaId) ?? estadoVacio();
  historiales.set(lineaId, st);
  const desde = Date.now() - HISTORIAL_MAX_MS;
  const lista = mensajes
    .filter((m) => {
      const jid = m.key.remoteJid;
      return !!jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) && horaDe(m) >= desde && horaDe(m) <= Date.now() + 60_000;
    })
    .sort((a, b) => horaDe(a) - horaDe(b))
    .slice(-HISTORIAL_MAX_MENSAJES);
  st.lotes++;
  st.recibidos += mensajes.length;
  st.enVentana += lista.length;
  st.procesando = true;
  st.ultimo = new Date().toISOString();
  let guardados = 0;
  try {
    for (const msg of lista) {
      try {
        const r = await guardarDelHistorial(msg, lineaId);
        if (r === 'guardado') guardados++;
        else if (r === 'ya estaba') st.yaEstaban++;
        else st.sinTexto++;
      } catch (err) {
        st.errores++;
        st.primerError ??= (err as Error).message.slice(0, 200);
        console.error(`[${lineaId}] Error con un mensaje del historial:`, (err as Error).message);
      }
      st.hechos++;
    }
  } finally {
    st.guardados += guardados;
    st.procesando = false;
    st.ultimo = new Date().toISOString();
  }
  console.log(`[${lineaId}] 🗂️ Historial: llegaron ${mensajes.length} mensajes, ${lista.length} de los últimos 4 días, ${guardados} nuevos guardados.`);
  return guardados;
}
