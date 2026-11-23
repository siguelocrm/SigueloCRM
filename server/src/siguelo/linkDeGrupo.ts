import { extractImageThumb } from '@whiskeysockets/baileys';

// Links de grupos de WhatsApp (chat.whatsapp.com/...) con su tarjeta.
//
// Cuando el CRM manda un link de grupo como texto, llega como un link azul suelto: sin la tarjeta
// con la foto y el nombre del grupo que WhatsApp muestra cuando lo mandas desde el teléfono. Y si
// el link va dentro de un texto largo o en el pie de una imagen, mucha gente no lo ve: se lee (y se
// toca) el último mensaje, si es corto.
//
// Por eso, si lo que se va a mandar tiene un link de grupo:
//  - con `separar` (lo normal): sale primero el mensaje sin el link y al final el link solo, con
//    la tarjeta del grupo. Tocar la tarjeta abre la pantalla "Unirse al grupo".
//  - sin `separar` (masivos y lo que escribes a mano en la bandeja): un solo mensaje, con la tarjeta.
// La tarjeta se arma con el nombre y la foto del grupo (se piden a WhatsApp una vez cada 6 horas por
// link). Si WhatsApp no los da, el link sale igual, solo con un título genérico.

export const LINK_GRUPO = /https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,})[^\s]*/i;

type Contenido = Record<string, unknown>;
type VistaPrevia = { 'canonical-url': string; 'matched-text': string; title: string; description: string; jpegThumbnail?: Buffer };
type SockGrupo = {
  groupGetInviteInfo?: (codigo: string) => Promise<{ id?: string; subject?: string; size?: number } | undefined>;
  profilePictureUrl?: (jid: string, tipo?: 'preview' | 'image') => Promise<string | undefined>;
};

// Tiempo máximo para preguntarle a WhatsApp (las pruebas lo acortan).
export const limitesGrupo = { consultaMs: 8_000, entreMensajesMs: 1_200 };

const HORA = 60 * 60_000;
const cache = new Map<string, { vista: VistaPrevia; hasta: number }>();
export const olvidarVistas = () => cache.clear();

const conTiempo = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => undefined), new Promise<undefined>((ok) => setTimeout(() => ok(undefined), ms))]);

// El texto separado en lo que va antes y el link de grupo (el primero que aparezca).
export function separarLink(texto: string): { resto: string; link: string; codigo: string } | null {
  const m = LINK_GRUPO.exec(texto || '');
  if (!m) return null;
  const link = m[0].replace(/[).,;!?]+$/, '');
  const resto = (texto.slice(0, m.index) + texto.slice(m.index + m[0].length))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { resto, link, codigo: m[1] };
}

// La tarjeta del grupo: nombre y foto (si WhatsApp los da).
export async function vistaDeGrupo(sock: unknown, link: string, codigo: string): Promise<VistaPrevia> {
  const guardada = cache.get(codigo);
  if (guardada && guardada.hasta > Date.now()) return guardada.vista;
  const s = sock as SockGrupo;
  const info = s.groupGetInviteInfo ? await conTiempo(s.groupGetInviteInfo(codigo), limitesGrupo.consultaMs) : undefined;
  const vista: VistaPrevia = {
    'canonical-url': link,
    'matched-text': link,
    title: info?.subject?.trim() || 'Grupo de WhatsApp',
    description: info?.size ? `Grupo de WhatsApp · ${info.size} participantes · toca para unirte` : 'Grupo de WhatsApp · toca para unirte',
  };
  if (info?.id && s.profilePictureUrl) {
    const url = await conTiempo(s.profilePictureUrl(info.id, 'preview'), limitesGrupo.consultaMs);
    if (url) {
      const foto = await conTiempo(
        fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))),
        limitesGrupo.consultaMs,
      );
      if (foto) {
        const mini = await conTiempo(extractImageThumb(Buffer.from(foto), 192), limitesGrupo.consultaMs);
        if (mini?.buffer) vista.jpegThumbnail = mini.buffer;
      }
    }
  }
  // Si WhatsApp no contestó, se vuelve a preguntar en 10 minutos (no en 6 horas).
  cache.set(codigo, { vista, hasta: Date.now() + (info ? 6 * HORA : 10 * 60_000) });
  return vista;
}

// Lo que hay que mandar, en orden. Sin link de grupo: el mismo contenido, tal cual.
export async function prepararMensajes(sock: unknown, contenido: Contenido, separar = true): Promise<Contenido[]> {
  const esTexto = typeof contenido.text === 'string';
  const pie = !esTexto && contenido.image && typeof contenido.caption === 'string' ? (contenido.caption as string) : null;
  if (!esTexto && !separar) return [contenido];
  const texto = esTexto ? (contenido.text as string) : pie;
  if (!texto || contenido.linkPreview) return [contenido];
  const partes = separarLink(texto);
  if (!partes) return [contenido];
  const vista = await vistaDeGrupo(sock, partes.link, partes.codigo);

  // Sin separar (o solo el link): un mensaje, con la tarjeta. Una imagen siempre se separa (su pie no lleva tarjeta).
  if (esTexto && (!separar || !partes.resto)) return [{ ...contenido, linkPreview: vista }];
  const tarjeta: Contenido = { text: partes.link, linkPreview: vista };
  if (!esTexto) return [{ ...contenido, caption: partes.resto || undefined }, tarjeta];
  return [{ ...contenido, text: partes.resto }, tarjeta];
}
