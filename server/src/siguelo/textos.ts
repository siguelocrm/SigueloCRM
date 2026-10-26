import type { Pie } from './tipos.js';

// Quita tildes, mayúsculas, puntuación y emojis: sirve para comparar textos.
export const normalizarTexto = (s: string | null | undefined): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pareceTelefono = (s: string): boolean => /^\+?[\d\s\-().]{7,}$/.test(s.trim());

// Primer nombre del contacto, o '' si solo tiene un número o no tiene letras.
export function primerNombre(nombre: string | null | undefined): string {
  const t = String(nombre || '').trim();
  if (!t || pareceTelefono(t) || !/\p{L}/u.test(t)) return '';
  return t.split(/\s+/)[0];
}

// Reemplaza {nombre}. Sin nombre, quita el campo junto con la coma o el espacio
// que lo acompañan: "Hola {nombre}, ¿cómo estás?" → "Hola, ¿cómo estás?"
export function aplicarNombre(texto: string, nombre: string | null | undefined): string {
  const t = String(texto || '');
  const n = primerNombre(nombre);
  if (n) return t.replace(/\{nombre\}/gi, n);
  const r = t
    .replace(/^(\s*)\{nombre\}\s*[,:;]?\s*/gim, '$1')
    .replace(/[ \t]+\{nombre\}(?=\s*[,.!?¡¿:;)]|\s*$)/gim, '')
    .replace(/\{nombre\}\s*[,:;]?\s*/gi, '');
  // Mayúscula inicial de cada línea que quedó en minúscula ("¡hola!" → "¡Hola!").
  return r.replace(/^(\s*[¡¿"“(]*)(\p{Ll})/gmu, (_m, a: string, b: string) => a + b.toUpperCase());
}

// Variables que se pueden usar en los textos, además de {nombre}. Salen de la
// ficha del negocio del número que envía (server/src/siguelo/negocios.ts);
// sin ficha, {sucursal} es el nombre del número en Conexiones.
export const VARIABLES = ['nombre', 'negocio', 'sucursal', 'direccion', 'horario'];

// Reemplaza {clave} por su valor y dice cuáles no se pudieron llenar
// ({nombre} lo resuelve aplicarNombre).
export function aplicarVariables(texto: string, variables: Record<string, string>): { texto: string; faltan: string[] } {
  const faltan: string[] = [];
  const r = String(texto || '').replace(/\{([\p{L}_]+)\}/gu, (marca, clave: string) => {
    const k = clave.toLowerCase();
    if (k === 'nombre') return marca;
    if (variables[k]?.trim()) return variables[k].trim();
    faltan.push(`{${k}}`);
    return marca;
  });
  return { texto: r, faltan };
}

const preparar = (variante: string, nombre: string | null | undefined, variables: Record<string, string>) => {
  const { texto, faltan } = aplicarVariables(variante, variables);
  return { texto: aplicarNombre(texto, nombre).trim(), faltan };
};

// Elige una variante al azar sin repetir la última que recibió esa persona
// (el último texto puede llevar el pie al final: se compara el comienzo).
// Una variante con una variable sin valor nunca sale; si no queda ninguna,
// devuelve texto vacío y cuáles faltan.
export function elegirVariante(
  variantes: string[],
  nombre: string | null | undefined,
  ultimoTexto: string | null | undefined,
  variables: Record<string, string> = {},
): { texto: string; faltan: string[] } {
  const preparadas = variantes.map((v) => preparar(v, nombre, variables)).filter((p) => p.texto);
  const textos = preparadas.filter((p) => !p.faltan.length).map((p) => p.texto);
  if (!textos.length) return { texto: '', faltan: [...new Set(preparadas.flatMap((p) => p.faltan))] };
  const ultimo = normalizarTexto(ultimoTexto);
  const candidatos = ultimo ? textos.filter((t) => !ultimo.startsWith(normalizarTexto(t))) : textos;
  const lista = candidatos.length ? candidatos : textos;
  return { texto: lista[Math.floor(Math.random() * lista.length)], faltan: [] };
}

// Pie de mensaje: una variante al azar al final de cada mensaje automático.
export function agregarPie(texto: string, pie: Pie | null | undefined, nombre: string | null | undefined, variables: Record<string, string> = {}): string {
  if (!pie?.activo) return texto;
  const variantes = (pie.variantes || []).map((v) => preparar(v, nombre, variables)).filter((p) => p.texto && !p.faltan.length);
  if (!variantes.length) return texto;
  return `${texto}\n\n${variantes[Math.floor(Math.random() * variantes.length)].texto}`;
}
