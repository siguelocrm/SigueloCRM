import { obtenerSesion } from '../whatsapp/sesiones.js';
import { conTarjetaDeGrupo } from './linkDeGrupo.js';

// WhatsApp a veces cierra la conexión un momento ("Connection Closed") y la línea se reconecta
// sola en pocos segundos. Un envío que cae justo ahí no es un error real: se espera la conexión
// nueva y se vuelve a intentar una vez. Antes, el seguimiento, la IA y los masivos perdían ese mensaje.

const ESPERA_RECONEXION_MS = 15_000;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const esConexionCaida = (err: unknown) => /Connection Closed|Connection was lost|Connection Terminated|Timed Out|Stream Errored|not open/i.test(String((err as Error)?.message ?? err));

// La sesión activa de esa línea (que no sea la conexión que se cayó), esperando hasta 15 s.
export async function esperarSesionActiva(lineaId: string, excluir?: object) {
  const limite = Date.now() + ESPERA_RECONEXION_MS;
  for (;;) {
    const s = obtenerSesion(lineaId);
    if (s && s.estado === 'activo' && s.sock !== excluir) return s;
    if (Date.now() >= limite) return undefined;
    await esperar(500);
  }
}

// Cuánto se espera a WhatsApp antes de darlo por caído (las pruebas lo acortan).
export const limites = { envioMs: 90_000, consultaMs: 20_000 };

// Una promesa con tiempo máximo: si WhatsApp no responde, falla como "Timed Out" (se trata como conexión caída).
export function conLimite<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<T>((_, no) => (t = setTimeout(() => no(new Error(`Timed Out: ${que}`)), ms)))]).finally(() => clearTimeout(t));
}

type Sock = { sendMessage: (jid: string, contenido: never) => Promise<{ key?: { id?: string | null } } | undefined> };

// Manda un mensaje por esa línea; si la conexión se había caído, espera la nueva y reintenta una vez.
async function enviarUno<C>(lineaId: string, sock: unknown, jid: string, contenido: C): Promise<{ key?: { id?: string | null } } | undefined> {
  try {
    return await conLimite((sock as Sock).sendMessage(jid, contenido as never), limites.envioMs, 'WhatsApp no respondió al enviar');
  } catch (err) {
    if (!esConexionCaida(err)) throw err;
    const nueva = await esperarSesionActiva(lineaId, sock as object);
    if (!nueva) throw err;
    return conLimite((nueva.sock as unknown as Sock).sendMessage(jid, contenido as never), limites.envioMs, 'WhatsApp no respondió al enviar');
  }
}

// Manda por esa línea, con reintento. Un texto con link de grupo sale con la tarjeta del grupo (linkDeGrupo.ts).
export async function enviarConReintento<C>(lineaId: string, sock: unknown, jid: string, contenido: C): Promise<{ key?: { id?: string | null } } | undefined> {
  return enviarUno(lineaId, sock, jid, await conTarjetaDeGrupo(sock, contenido));
}
