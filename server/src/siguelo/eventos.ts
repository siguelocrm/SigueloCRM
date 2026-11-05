// Aviso de "llegó un mensaje de un cliente" desde whatsapp/ (sin importar nada
// de siguelo/ allá, para no armar dependencias circulares). La IA lo usa para
// responder en segundos en vez de esperar su próxima vuelta.
type Oyente = (lineaId: string) => void;
const oyentes: Oyente[] = [];

export function alLlegarMensaje(oyente: Oyente): void {
  oyentes.push(oyente);
}

export function mensajeNuevo(lineaId: string): void {
  for (const o of oyentes) {
    try {
      o(lineaId);
    } catch (err) {
      console.error('Error avisando un mensaje nuevo:', (err as Error).message);
    }
  }
}
