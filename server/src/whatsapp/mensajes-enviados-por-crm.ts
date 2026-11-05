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
