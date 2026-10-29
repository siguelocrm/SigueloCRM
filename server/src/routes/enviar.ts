import { Router } from 'express';
import { obtenerSesion } from '../whatsapp/sesiones.js';
import { buscarOCrearConversacion } from '../whatsapp/mensajes-entrantes.js';
import { TIPOS_ENVIABLES, construirContenidoWA } from '../whatsapp/contenido.js';
import { marcarEnviadoPorCRM } from '../whatsapp/mensajes-enviados-por-crm.js';
import { supabase } from '../supabase/client.js';
import { conNumero } from '../siguelo/usuarios/proteger.js';

export const enviarRouter = Router();

// Una línea que se cae (408) se reconecta sola en pocos segundos; en ese lapso
// el socket viejo sigue en el mapa y manda "Connection Closed". En vez de
// devolverle el error al agente, esperamos la reconexión y reintentamos.
const ESPERA_RECONEXION_MS = 15000;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function esperarSesionActiva(lineaId: string, excluir?: object) {
  const limite = Date.now() + ESPERA_RECONEXION_MS;
  for (;;) {
    const s = obtenerSesion(lineaId);
    if (s && s.estado === 'activo' && s.sock !== excluir) return s;
    if (Date.now() >= limite) return undefined;
    await esperar(500);
  }
}

// SígueloCRM: hay que haber iniciado sesión y tener acceso a ese número; el mensaje queda a nombre de quien lo envía.
enviarRouter.post('/enviar', ...conNumero((req) => req.body?.linea_id), async (req, res) => {
  const { telefono, tipo = 'texto', texto, media_url, linea_id, mimetype } = req.body;
  const agente_id = req.usuarioAutenticado!.id;

  if (!telefono) return res.status(400).json({ error: 'Falta telefono' });
  if (!linea_id) return res.status(400).json({ error: 'Falta linea_id' });
  if (tipo === 'texto' && !texto) return res.status(400).json({ error: 'Falta texto' });
  if (tipo !== 'texto' && !media_url) return res.status(400).json({ error: 'Falta media_url' });

  let sesion = await esperarSesionActiva(linea_id);
  if (!sesion) {
    return res.status(503).json({ error: 'Esa línea de WhatsApp no está conectada' });
  }

  try {
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;

    if (!(TIPOS_ENVIABLES as readonly string[]).includes(tipo)) return res.status(400).json({ error: 'Tipo no soportado' });
    const contenidoWA = await construirContenidoWA({ tipo, texto, media_url, mimetype });

    let resultado;
    try {
      resultado = await sesion.sock.sendMessage(jid, contenidoWA);
    } catch (err) {
      if (!/Connection Closed|Connection was lost/i.test((err as Error).message)) throw err;
      const nueva = await esperarSesionActiva(linea_id, sesion.sock);
      if (!nueva) return res.status(503).json({ error: 'La línea se está reconectando, intenta de nuevo en unos segundos' });
      sesion = nueva;
      resultado = await sesion.sock.sendMessage(jid, contenidoWA);
    }
    if (resultado?.key?.id) marcarEnviadoPorCRM(resultado.key.id);

    const conversacion = await buscarOCrearConversacion(linea_id, telefono);

    await supabase.from('mensajes').insert({
      conversacion_id: conversacion.id,
      remitente: 'agente',
      agente_id: agente_id || null,
      tipo,
      contenido: texto || null,
      media_url: tipo !== 'texto' ? media_url : null,
      // Guardamos el id de WhatsApp para poder marcar el mensaje si más
      // adelante llega un ack de error (entrega rechazada) — ver
      // server/src/whatsapp/entrega.ts.
      whatsapp_id: resultado?.key?.id || null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando mensaje:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});
