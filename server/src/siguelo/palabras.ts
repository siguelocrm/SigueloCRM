import { normalizarTexto } from './textos.js';

// Palabras que cambian de etapa (Fase 4), sin IA: comparación de palabras con
// tolerancia a una letra. Igual que contenido/palabras.js de la extensión.

const MAX_PALABRAS_CLAVE = 5; // la palabra actúa sola solo en mensajes de 5 palabras o menos

const palabras = (t: string) => normalizarTexto(t).split(' ').filter(Boolean);

// Distancia de edición limitada a 1 (una letra de más, de menos o cambiada) en palabras de 5+ letras.
export function casiIgual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++dif > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

// ¿La frase aparece en el mensaje como palabras completas seguidas?
function contiene(msg: string[], frase: string[], tolerante: boolean): boolean {
  if (!frase.length || frase.length > msg.length) return false;
  for (let i = 0; i + frase.length <= msg.length; i++) {
    if (frase.every((w, k) => (tolerante ? casiIgual(msg[i + k], w) : msg[i + k] === w))) return true;
  }
  return false;
}

// Palabra clave: el mensaje tiene 5 palabras o menos y la contiene como palabras completas.
export function esPalabraClave(texto: string, lista: string[] | undefined): boolean {
  const msg = palabras(texto);
  if (!msg.length || msg.length > MAX_PALABRAS_CLAVE) return false;
  return (lista || []).some((k) => contiene(msg, palabras(k), false));
}

// Frase en cualquier parte del mensaje, tolerando una letra por palabra larga.
export function contieneFrase(texto: string, lista: string[] | undefined): string | null {
  const msg = palabras(texto);
  return (lista || []).find((f) => contiene(msg, palabras(f), true)) ?? null;
}

// Frase tuya: al principio de tu mensaje.
export function empiezaCon(texto: string, lista: string[] | undefined): string | null {
  const msg = palabras(texto);
  return (lista || []).find((f) => {
    const w = palabras(f);
    return w.length > 0 && w.length <= msg.length && w.every((x, k) => casiIgual(msg[k], x));
  }) ?? null;
}

export type PalabrasEtapa = { cliente: string[]; parecidas: string[]; tuyas: string[]; respuesta: string };

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean) : []);
// Lo guardado en la base, con lo que falte en blanco.
export const normalizar = (p: Partial<PalabrasEtapa> | null | undefined): PalabrasEtapa => ({
  cliente: lista(p?.cliente),
  parecidas: lista(p?.parecidas),
  tuyas: lista(p?.tuyas),
  respuesta: String(p?.respuesta ?? ''),
});
export type Stop = { activo: boolean; palabras: string[]; parecidas: string[]; respuesta: string };

export type Decision =
  | { tipo: 'mover'; etapaId: string; respuesta: string; por: string }
  | { tipo: 'revisar'; etapaId: string; por: string }
  | null;

// Qué hacer con un mensaje del cliente. etapas: las del embudo del contacto
// (sin la actual) con sus palabras; perdidaId: la etapa "perdida" de ese embudo.
export function decidirCliente(
  texto: string,
  etapas: { id: string; palabras: PalabrasEtapa }[],
  stop: Stop | null,
  perdidaId: string | null,
): Decision {
  if (stop?.activo && perdidaId && esPalabraClave(texto, stop.palabras)) {
    return { tipo: 'mover', etapaId: perdidaId, respuesta: stop.respuesta || '', por: 'stop' };
  }
  for (const e of etapas) {
    if (esPalabraClave(texto, e.palabras.cliente)) return { tipo: 'mover', etapaId: e.id, respuesta: e.palabras.respuesta || '', por: 'palabra' };
  }
  // Las palabras dentro de un mensaje largo y las frases parecidas no actúan solas: piden revisión.
  if (stop?.activo && perdidaId) {
    const f = contieneFrase(texto, [...(stop.palabras || []), ...(stop.parecidas || [])]);
    if (f) return { tipo: 'revisar', etapaId: perdidaId, por: f };
  }
  for (const e of etapas) {
    const f = contieneFrase(texto, [...e.palabras.cliente, ...e.palabras.parecidas]);
    if (f) return { tipo: 'revisar', etapaId: e.id, por: f };
  }
  return null;
}

// ¿Una frase tuya lo pasa a otra etapa?
export function decidirTuyo(texto: string, etapas: { id: string; palabras: PalabrasEtapa }[]): { etapaId: string; por: string } | null {
  for (const e of etapas) {
    const f = empiezaCon(texto, e.palabras.tuyas);
    if (f) return { etapaId: e.id, por: f };
  }
  return null;
}
