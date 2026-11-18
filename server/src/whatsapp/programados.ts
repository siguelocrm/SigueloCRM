import { supabase } from '../supabase/client.js';
import type { MensajeProgramadoRow } from '../types/dominio.js';
import { obtenerSesion } from './sesiones.js';
import { marcarEnviadoPorCRM } from './mensajes-enviados-por-crm.js';
import { construirContenidoWA } from './contenido.js';

const CADA_MS = 60_000;
// Si la línea está desconectada a la hora de enviar, se reintenta en cada
// vuelta hasta este límite; pasado ese tiempo se marca como error.
const TOLERANCIA_LINEA_CAIDA_MS = 15 * 60 * 1000;

let corriendo = false;

async function marcar(id: string, cambios: Partial<MensajeProgramadoRow>) {
  await supabase.from('mensajes_programados').update(cambios).eq('id', id);
}

async function procesarVencidos(): Promise<void> {
  const { data: vencidos, error } = await supabase
    .from('mensajes_programados')
    .select('id, conversacion_id, linea_id, telefono, contenido, tipo, media_url, mimetype, enviar_en, cancelar_si_responde, creado_por, creado_en')
    .eq('estado', 'pendiente')
    .lte('enviar_en', new Date().toISOString())
    .order('enviar_en')
    .limit(50);
  if (error || !vencidos?.length) return;

  for (const m of vencidos) {
    // Reclama el mensaje: si otra vuelta ya lo tomó, no devuelve nada.
    const { data: reclamado } = await supabase
      .from('mensajes_programados')
      .update({ estado: 'enviando' })
      .eq('id', m.id)
      .eq('estado', 'pendiente')
      .select('id');
    if (!reclamado?.length) continue;

    try {
      if (m.cancelar_si_responde) {
        const { data: respuestas } = await supabase
          .from('mensajes')
          .select('id')
          .eq('conversacion_id', m.conversacion_id)
          .eq('remitente', 'cliente')
          .gt('creado_en', m.creado_en)
          .limit(1);
        if (respuestas?.length) {
          await marcar(m.id, { estado: 'cancelado', motivo: 'El cliente respondió antes de la hora programada' });
          continue;
        }
      }

      const sesion = obtenerSesion(m.linea_id);
      if (!sesion || sesion.estado !== 'activo') {
        const atraso = Date.now() - new Date(m.enviar_en).getTime();
        if (atraso > TOLERANCIA_LINEA_CAIDA_MS) {
          await marcar(m.id, { estado: 'error', motivo: 'La línea de WhatsApp no estaba conectada a la hora programada' });
        } else {
          await marcar(m.id, { estado: 'pendiente' }); // reintenta en la próxima vuelta
        }
        continue;
      }

      const jid = m.telefono.includes('@') ? m.telefono : `${m.telefono}@s.whatsapp.net`;
      const resultado = await sesion.sock.sendMessage(jid, await construirContenidoWA({ tipo: m.tipo, texto: m.contenido, media_url: m.media_url, mimetype: m.mimetype }));
      if (resultado?.key?.id) marcarEnviadoPorCRM(resultado.key.id);

      await supabase.from('mensajes').insert({
        conversacion_id: m.conversacion_id,
        remitente: 'agente',
        agente_id: m.creado_por,
        tipo: m.tipo,
        contenido: m.contenido,
        media_url: m.tipo === 'texto' ? null : m.media_url,
        whatsapp_id: resultado?.key?.id || null,
      });
      await marcar(m.id, { estado: 'enviado', enviado_en: new Date().toISOString() });
      console.log(`[${m.linea_id}] ⏰ Mensaje programado enviado a ${m.telefono}`);
    } catch (err) {
      console.error(`[${m.linea_id}] Error enviando mensaje programado:`, (err as Error).message);
      await marcar(m.id, { estado: 'error', motivo: (err as Error).message.slice(0, 200) });
    }
  }
}

// Revisa cada pocos segundos si hay mensajes programados que ya les toca. Un
// mensaje que quedó "enviando" por un reinicio a mitad de camino se devuelve a
// "pendiente" al arrancar, para no perderlo.
export function iniciarProgramadorDeMensajes(): void {
  supabase
    .from('mensajes_programados')
    .update({ estado: 'pendiente' })
    .eq('estado', 'enviando')
    .then(() => undefined, () => undefined);

  setInterval(async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await procesarVencidos();
    } catch (err) {
      console.error('Error en el programador de mensajes:', (err as Error).message);
    } finally {
      corriendo = false;
    }
  }, CADA_MS);
}
