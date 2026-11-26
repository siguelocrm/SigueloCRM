import { jidNormalizedUser } from '@whiskeysockets/baileys';

// A quién se le manda de verdad (SígueloCRM).
//
// WhatsApp identifica cada vez más chats con un ID interno ("LID", 14 o 15 dígitos, por ejemplo
// 278683399024812) en vez del número real, sobre todo a la gente que llega por anuncios. Si el CRM no
// sabía el número real, guardaba ese ID como si fuera el teléfono y respondía a "278683399024812@s.whatsapp.net":
// un número que no existe. WhatsApp aceptaba el envío pero no le llegaba a nadie (ni la IA, ni el
// seguimiento, ni los masivos, que además decían "no tiene WhatsApp").
//
// Ahora, si el "teléfono" tiene 14 o 15 dígitos: primero se busca el número real que WhatsApp tiene para
// ese ID; si no lo tiene, se pregunta si es un teléfono de verdad; si no lo es, se manda al ID interno
// ("…@lid"), que sí le llega. Se recuerda por número, para no preguntar cada vez.

export const pareceLid = (digitos: string) => /^\d{14,15}$/.test(digitos);

type SockDestino = {
  onWhatsApp?: (...jids: string[]) => Promise<{ exists?: boolean | unknown; jid?: string }[] | undefined>;
  signalRepository?: { lidMapping?: { getPNForLID?: (lid: string) => Promise<string | null> } };
};

// Tiempo máximo para preguntarle a WhatsApp (las pruebas lo acortan).
export const limitesDestino = { consultaMs: 8_000 };
const cache = new Map<string, string>();
export const olvidarDestinos = () => cache.clear();

const conTiempo = <T>(p: Promise<T> | undefined): Promise<T | undefined> =>
  p ? Promise.race([p.catch(() => undefined), new Promise<undefined>((ok) => setTimeout(() => ok(undefined), limitesDestino.consultaMs))]) : Promise.resolve(undefined);

export async function jidDestino(sock: unknown, telefono: string): Promise<string> {
  if (telefono.includes('@')) return telefono;
  const d = telefono.replace(/\D/g, '');
  if (!pareceLid(d)) return `${d}@s.whatsapp.net`;
  const guardado = cache.get(d);
  if (guardado) return guardado;
  const s = sock as SockDestino;
  // 1. El número real que WhatsApp tiene para ese ID interno.
  const pn = await conTiempo(s.signalRepository?.lidMapping?.getPNForLID?.(`${d}@lid`));
  if (pn) {
    const jid = `${jidNormalizedUser(pn).split('@')[0]}@s.whatsapp.net`;
    cache.set(d, jid);
    return jid;
  }
  // 2. ¿Es un teléfono de verdad (largo)? Si WhatsApp no lo conoce como teléfono, es un ID interno.
  const r = await conTiempo(s.onWhatsApp?.(`${d}@s.whatsapp.net`));
  if (r === undefined) return `${d}@lid`; // WhatsApp no contestó: lo más probable es que sea un ID interno (no se recuerda)
  const jid = r?.[0]?.exists ? `${d}@s.whatsapp.net` : `${d}@lid`;
  cache.set(d, jid);
  return jid;
}
