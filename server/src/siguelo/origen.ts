import { db } from './db.js';

// De dónde salió un mensaje que mandamos (sección 49 del SQL): el chat lo muestra chiquito debajo.
// Seguimiento, masivos y la IA ya quedan enlazados por su cuenta; esto es para el bot, los
// programados, las respuestas automáticas y lo que escribes desde el teléfono. Si la sección 49
// no está pegada, no pasa nada: el mensaje se guardó igual, solo no lleva etiqueta.
export type Origen = 'bot' | 'programado' | 'telefono' | 'automatico';

export async function marcarOrigen(mensajeId: string | null | undefined, origen: Origen, detalle: string | null = null): Promise<void> {
  if (!mensajeId) return;
  try {
    const { error } = await (db as unknown as { from: (t: string) => { insert: (f: object) => PromiseLike<{ error: { message: string } | null }> } })
      .from('siguelo_mensaje_origen')
      .insert({ mensaje_id: mensajeId, origen, detalle });
    if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) console.error('Origen del mensaje:', error.message);
  } catch {
    // Solo es la etiqueta: nunca frena el envío.
  }
}
