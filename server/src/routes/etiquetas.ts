import { Router } from 'express';
import { obtenerSesion } from '../whatsapp/sesiones.js';
import { supabase } from '../supabase/client.js';
import { conNumero } from '../siguelo/usuarios/proteger.js';

export const etiquetasRouter = Router();

// Empuja hacia el WhatsApp Business real la asignación/quite de una etiqueta
// que el agente hizo a mano desde el panel de contacto (ver
// PanelContacto.tsx). A diferencia de la sincronización automática de
// whatsapp/etiquetas.ts (WhatsApp → CRM, vía eventos `labels.association`),
// esta ruta va en sentido contrario (CRM → WhatsApp) usando `chatModify` de
// Baileys — el mismo mecanismo que usaría cualquier otro dispositivo
// vinculado a esa cuenta. WhatsApp igual nos va a devolver el eco del cambio
// como evento `labels.association`, pero no esperamos a eso: actualizamos
// `contacto_etiquetas` acá mismo para que el panel se sienta instantáneo.
etiquetasRouter.post('/etiquetas/:accion(asignar|quitar)', ...conNumero((req) => req.body?.linea_id), async (req, res) => {
  const { accion } = req.params;
  const { linea_id, contacto_id, etiqueta_id } = req.body;

  if (!linea_id) return res.status(400).json({ error: 'Falta linea_id' });
  if (!contacto_id) return res.status(400).json({ error: 'Falta contacto_id' });
  if (!etiqueta_id) return res.status(400).json({ error: 'Falta etiqueta_id' });

  const sesion = obtenerSesion(linea_id);
  if (!sesion || sesion.estado !== 'activo') {
    return res.status(503).json({ error: 'Esa línea de WhatsApp no está conectada' });
  }

  try {
    const [{ data: contacto }, { data: etiqueta }] = await Promise.all([
      supabase.from('contactos').select('telefono, lid').eq('id', contacto_id).single(),
      supabase.from('etiquetas_whatsapp').select('whatsapp_id').eq('id', etiqueta_id).eq('linea_id', linea_id).single(),
    ]);
    if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado' });
    if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada en esta línea' });

    // Preferimos el @lid si ya lo aprendimos (ver contactos.ts): es el mismo
    // criterio que usa whatsapp/etiquetas.ts al resolver una asociación que
    // llega desde WhatsApp, así apuntamos al mismo chat en ambas direcciones.
    const jid = contacto.lid ? `${contacto.lid}@lid` : `${contacto.telefono}@s.whatsapp.net`;
    const cuerpo = { labelId: etiqueta.whatsapp_id };
    await sesion.sock.chatModify(accion === 'asignar' ? { addChatLabel: cuerpo } : { removeChatLabel: cuerpo }, jid);

    if (accion === 'asignar') {
      await supabase.from('contacto_etiquetas').upsert(
        { contacto_id, etiqueta_id },
        { onConflict: 'contacto_id,etiqueta_id', ignoreDuplicates: true },
      );
    } else {
      await supabase.from('contacto_etiquetas').delete().eq('contacto_id', contacto_id).eq('etiqueta_id', etiqueta_id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(`[${linea_id}] Error sincronizando etiqueta hacia WhatsApp:`, (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});
