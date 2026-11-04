import type { AnyMessageContent } from '@whiskeysockets/baileys';

// La ubicación de un negocio como pin de WhatsApp (el mapa que se toca y abre
// Google Maps o Waze). Sale del link de Google Maps que pusiste en la ficha del
// negocio, o de "latitud, longitud". Si no se pueden sacar las coordenadas,
// se manda el link (WhatsApp también lo muestra con su vista previa).

export type Coordenadas = { lat: number; lng: number };

const valido = (lat: number, lng: number): Coordenadas | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;

// Coordenadas escritas en el texto o el link (sin ir a internet).
export function coordenadasDe(texto: string): Coordenadas | null {
  const t = decodeURIComponent(String(texto || '').trim());
  const patrones = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, // el lugar exacto de un link de "place"
    /[?&](?:q|query|ll|destination|daddr|center)=(?:loc:)?\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /\/search\/(-?\d{1,2}\.\d+),\+?\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, // el centro del mapa
    /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/, // "-17.39, -66.15"
  ];
  for (const p of patrones) {
    const m = p.exec(t);
    const c = m ? valido(Number(m[1]), Number(m[2])) : null;
    if (c) return c;
  }
  return null;
}

// Los links cortos (maps.app.goo.gl, goo.gl/maps) llevan a otro: se sigue la redirección para leer las coordenadas.
const cache = new Map<string, Coordenadas | null>();
export async function resolverUbicacion(texto: string): Promise<Coordenadas | null> {
  const directo = coordenadasDe(texto);
  if (directo) return directo;
  const url = String(texto || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (cache.has(url)) return cache.get(url)!;
  let actual = url;
  let encontrado: Coordenadas | null = null;
  try {
    for (let i = 0; i < 5 && !encontrado; i++) {
      const r = await fetch(actual, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const destino = r.headers.get('location');
      if (destino) {
        actual = new URL(destino, actual).href;
        encontrado = coordenadasDe(actual);
        continue;
      }
      // Sin redirección: a veces la página trae las coordenadas adentro.
      if (r.ok) encontrado = coordenadasDe((await r.text()).slice(0, 200_000).match(/https:\/\/www\.google\.[^"'\s]*maps[^"'\s]*/)?.[0] ?? '');
      break;
    }
  } catch {
    encontrado = null;
  }
  cache.set(url, encontrado);
  return encontrado;
}

export function linkDeMapa(texto: string): string {
  const t = String(texto || '').trim();
  if (/^https?:\/\//i.test(t)) return t;
  const c = coordenadasDe(t);
  return c ? `https://maps.google.com/?q=${c.lat},${c.lng}` : t;
}

// El mensaje de WhatsApp: el pin con el nombre y la dirección, o el link si no hay coordenadas.
export async function contenidoUbicacion(ubicacion: string, nombre: string, direccion: string): Promise<AnyMessageContent> {
  const c = await resolverUbicacion(ubicacion);
  if (c) return { location: { degreesLatitude: c.lat, degreesLongitude: c.lng, name: nombre || undefined, address: direccion || undefined } };
  return { text: `📍 ${[nombre, direccion].filter(Boolean).join(' — ')}\n${linkDeMapa(ubicacion)}` };
}

// Lo que se guarda en la salida: "nombre|dirección|ubicación" (así el envío no vuelve a leer la ficha).
export const empaquetar = (nombre: string, direccion: string | null | undefined, ubicacion: string) => [nombre, direccion || '', ubicacion].map((x) => x.replace(/\|/g, '/')).join('|');
export function desempaquetar(contenido: string): { nombre: string; direccion: string; ubicacion: string } {
  const [nombre = '', direccion = '', ...resto] = String(contenido || '').split('|');
  return { nombre, direccion, ubicacion: resto.join('|') };
}
