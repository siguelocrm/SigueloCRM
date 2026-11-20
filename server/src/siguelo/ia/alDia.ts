import { db, porGrupos, todas } from '../db.js';

// "Ponerse al día" (IA → Resumen): los chats donde el cliente fue el último en escribir, en las
// últimos 4 días, y nadie le contestó. Pasa cuando el número estuvo desconectado o restringido por
// WhatsApp: al volver, esos mensajes ya tienen más de 2 horas y la IA no los responde sola. Con el
// botón, la IA los lee uno por uno, despacio, con todos sus frenos de siempre (chat con la IA
// apagada, "Venta perdida", pago en curso...) menos el de las 2 horas. Solo responde chats que ya
// existen: eso WhatsApp lo permite aunque el número esté restringido.

export const VENTANA_AL_DIA_MS = 4 * 24 * 60 * 60_000;

export type ChatSinRespuesta = { conversacion_id: string; linea_id: string; telefono: string; nombre: string | null; ultimo: string };

export async function chatsSinRespuesta(empresaId: string, lineaId: string | null): Promise<ChatSinRespuesta[]> {
  const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', empresaId);
  const ids = (lineas || []).map((l) => l.id).filter((id) => !lineaId || id === lineaId);
  if (!ids.length) return [];
  const desde = new Date(Date.now() - VENTANA_AL_DIA_MS).toISOString();
  const chats = await todas((d, h) =>
    db.from('conversaciones').select('id, linea_id, contacto_telefono, contacto_nombre').in('linea_id', ids).gte('ultima_actividad', desde).order('id').range(d, h),
  );
  // El último mensaje de cada chat (de a 10 a la vez).
  const lista: ChatSinRespuesta[] = [];
  for (let i = 0; i < chats.length; i += 10) {
    const grupo = chats.slice(i, i + 10);
    const ultimos = await Promise.all(
      grupo.map((cv) => db.from('mensajes').select('remitente, creado_en').eq('conversacion_id', cv.id).order('creado_en', { ascending: false }).limit(1).maybeSingle()),
    );
    grupo.forEach((cv, j) => {
      const m = ultimos[j].data;
      if (m?.remitente === 'cliente' && new Date(m.creado_en).getTime() >= Date.now() - VENTANA_AL_DIA_MS) {
        lista.push({ conversacion_id: cv.id, linea_id: cv.linea_id, telefono: cv.contacto_telefono, nombre: cv.contacto_nombre, ultimo: m.creado_en });
      }
    });
  }
  if (!lista.length) return [];
  // Sin los que ya tienen una respuesta de la IA esperando para salir (o tu aprobación).
  const enCamino = await porGrupos(
    lista.map((x) => x.conversacion_id),
    (g) => db.from('siguelo_ia_salida').select('conversacion_id').in('conversacion_id', g).in('estado', ['borrador', 'pendiente', 'enviando']),
  );
  const yaVan = new Set(enCamino.map((x) => x.conversacion_id));
  // Primero los que esperan hace más.
  return lista.filter((x) => !yaVan.has(x.conversacion_id)).sort((a, b) => new Date(a.ultimo).getTime() - new Date(b.ultimo).getTime());
}
