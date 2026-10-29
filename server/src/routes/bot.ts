import { Router } from 'express';
import { supabase } from '../supabase/client.js';
import { obtenerSesion } from '../whatsapp/sesiones.js';
import { buscarOCrearConversacion } from '../whatsapp/mensajes-entrantes.js';
import { enviarPasos } from '../whatsapp/bot-automatico.js';
import { iniciarFlujo } from '../whatsapp/flujo.js';
import { conNumero } from '../siguelo/usuarios/proteger.js';

export const botRouter = Router();

// Dispara a mano, desde el chat, la secuencia de pasos de una respuesta
// automática — para cuando el cliente no escribió la palabra clave (o el
// agente prefiere mandarla él mismo en vez de esperar a que matchee sola).
botRouter.post('/respuestas-automaticas/:id/disparar', ...conNumero((req) => req.body?.linea_id), async (req, res) => {
  const { id } = req.params;
  const { telefono, linea_id } = req.body;

  if (!telefono) return res.status(400).json({ error: 'Falta telefono' });
  if (!linea_id) return res.status(400).json({ error: 'Falta linea_id' });

  const sesion = obtenerSesion(linea_id);
  if (!sesion || sesion.estado !== 'activo') {
    return res.status(503).json({ error: 'Esa línea de WhatsApp no está conectada' });
  }

  const { data: regla, error } = await supabase.from('respuestas_automaticas').select('tipo, pasos, flujo').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!regla) return res.status(404).json({ error: 'No se encontró la respuesta automática' });
  const esFlujo = regla.tipo === 'flujo' && !!regla.flujo;
  if (!esFlujo && (!regla.pasos || regla.pasos.length === 0)) return res.status(400).json({ error: 'Esa regla no tiene pasos configurados' });

  try {
    const conversacion = await buscarOCrearConversacion(linea_id, telefono);
    // Sin await: una regla puede tener pasos de temporizador de varios
    // minutos — no queremos dejar la request HTTP colgada esperándolos.
    const ejecucion = esFlujo
      ? iniciarFlujo(sesion.sock, linea_id, undefined, conversacion.id, telefono, id, regla.flujo!)
      : enviarPasos(sesion.sock, linea_id, conversacion.id, telefono, regla.pasos);
    ejecucion.catch((err) =>
      console.error(`[${linea_id}] Error disparando respuesta automática a mano:`, (err as Error).message),
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
