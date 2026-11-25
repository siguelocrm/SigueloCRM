// Cuando el CRM manda un mensaje (routes/enviar.ts) vía sock.sendMessage,
// Baileys también dispara messages.upsert para ese mismo mensaje (fromMe:
// true) como cualquier otro mensaje saliente. Sin este registro,
// procesarMensajeSaliente lo guardaría de nuevo en `mensajes`, duplicando el
// insert que routes/enviar.ts ya hizo.
const idsRecientes = new Map<string, NodeJS.Timeout>();

export function marcarEnviadoPorCRM(whatsappId: string): void {
  // SígueloCRM: 15 min (antes 30 s) para que la IA sepa qué mandó el bot hace un rato.
  const timeout = setTimeout(() => idsRecientes.delete(whatsappId), 15 * 60_000);
  timeout.unref?.(); // no retiene el proceso por este recordatorio
  idsRecientes.set(whatsappId, timeout);
}

export function fueEnviadoPorCRM(whatsappId: string): boolean {
  return idsRecientes.has(whatsappId);
}

// SígueloCRM: el bot de bienvenida (primer mensaje del cliente, o primero del día) acaba de
// responder en este chat. La IA no agrega otro mensaje encima: sigue cuando el cliente vuelva a
// escribir. Se guarda cuándo empezó (antes de la demora del bot) y cuándo salió su último paso.
const bienvenidas = new Map<string, number>();
export function marcarBienvenida(conversacionId: string): void {
  bienvenidas.set(conversacionId, Date.now());
  if (bienvenidas.size > 5000) for (const [k, t] of bienvenidas) if (Date.now() - t > 60 * 60_000) bienvenidas.delete(k);
}
// Hasta cuándo estuvo mandando la bienvenida (null si no hubo una en la última hora).
export function bienvenidaHasta(conversacionId: string): number | null {
  const t = bienvenidas.get(conversacionId);
  return t && Date.now() - t < 60 * 60_000 ? t : null;
}
