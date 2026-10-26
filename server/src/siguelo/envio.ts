import { db } from './db.js';
import { obtenerSesion } from '../whatsapp/sesiones.js';
import { marcarEnviadoPorCRM } from '../whatsapp/mensajes-enviados-por-crm.js';

// Manda un texto suelto ya mismo (por ejemplo la respuesta a "stop") y lo deja
// en el chat. Devuelve la hora con que quedó guardado, o null si no salió.
export async function enviarTexto(lineaId: string, telefono: string, conversacionId: string, texto: string): Promise<string | null> {
  const sesion = obtenerSesion(lineaId);
  if (!sesion || sesion.estado !== 'activo' || !texto.trim()) return null;
  try {
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
    const resultado = await sesion.sock.sendMessage(jid, { text: texto });
    const whatsappId = resultado?.key?.id || null;
    if (whatsappId) marcarEnviadoPorCRM(whatsappId);
    const { data } = await db
      .from('mensajes')
      .insert({ conversacion_id: conversacionId, remitente: 'agente', agente_id: null, tipo: 'texto', contenido: texto, whatsapp_id: whatsappId })
      .select('creado_en')
      .single();
    return data?.creado_en ?? new Date().toISOString();
  } catch (err) {
    console.error('Seguimiento: no se pudo enviar la respuesta automática:', (err as Error).message);
    return null;
  }
}
