import { extractImageThumb } from '@whiskeysockets/baileys';

// Links de grupos de WhatsApp (chat.whatsapp.com/...) con su tarjeta.
//
// Cuando el CRM manda un link de grupo como texto, llega como un link azul suelto: sin la tarjeta
// con la foto y el nombre del grupo que WhatsApp muestra cuando lo mandas desde el teléfono.
// Ahora un texto con un link de grupo sale en el MISMO mensaje (el link sigue en el texto) con la
// tarjeta del grupo, que WhatsApp pone arriba del texto; tocarla abre "Unirse al grupo". No se
// manda ningún mensaje de más. El pie de una imagen no puede llevar tarjeta: la imagen sale tal cual.
// La tarjeta se arma con el nombre y la foto del grupo (se piden a WhatsApp una vez cada 6 horas por
// link). Si WhatsApp no los da, el link sale igual, solo con un título genérico.

export const LINK_GRUPO = /https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,})[^\s]*/i;

type VistaPrevia = { 'canonical-url': string; 'matched-text': string; title: string; description: string; jpegThumbnail?: Buffer };
type SockGrupo = {
  groupGetInviteInfo?: (codigo: string) => Promise<{ id?: string; subject?: string; size?: number } | undefined>;
  profilePictureUrl?: (jid: string, tipo?: 'preview' | 'image') => Promise<string | undefined>;
};

// Tiempo máximo para preguntarle a WhatsApp (las pruebas lo acortan).
export const limitesGrupo = { consultaMs: 8_000 };

const HORA = 60 * 60_000;
const cache = new Map<string, { vista: VistaPrevia; hasta: number }>();
export const olvidarVistas = () => cache.clear();

const conTiempo = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => undefined), new Promise<undefined>((ok) => setTimeout(() => ok(undefined), ms))]);

// El primer link de grupo del texto y su código.
export function linkDeGrupo(texto: string): { link: string; codigo: string } | null {
  const m = LINK_GRUPO.exec(texto || '');
  return m ? { link: m[0].replace(/[).,;!?]+$/, ''), codigo: m[1] } : null;
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

// El mismo mensaje; si es un texto con un link de grupo, con la tarjeta del grupo.
export async function conTarjetaDeGrupo<C>(sock: unknown, contenido: C): Promise<C> {
  const c = contenido as Record<string, unknown>;
  if (typeof c.text !== 'string' || c.linkPreview) return contenido;
  const g = linkDeGrupo(c.text);
  if (!g) return contenido;
  return { ...c, linkPreview: await vistaDeGrupo(sock, g.link, g.codigo) } as C;
}
