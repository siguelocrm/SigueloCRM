import type { Session } from '@supabase/supabase-js';

// Varias cuentas (SígueloCRM): tus cuentas (el club y la agencia) quedan guardadas en ESTE
// navegador para cambiar de una a otra sin volver a escribir la contraseña. Solo se guardan
// las cuentas de agencia; las de tus clientes nunca. Es lo mismo que Supabase ya guarda para
// mantener tu sesión abierta.

// Un usuario sin @ ("agencia") es un correo de este dominio (Supabase pide un correo).
export const DOMINIO_USUARIOS = 'siguelocrm.app.mapse.club';
export const correoDeUsuario = (texto: string) => {
  const t = texto.trim().toLowerCase();
  return t.includes('@') ? t : `${t}@${DOMINIO_USUARIOS}`;
};
export const usuarioCorto = (correo: string) => (correo.endsWith(`@${DOMINIO_USUARIOS}`) ? correo.slice(0, -DOMINIO_USUARIOS.length - 1) : correo);

export type CuentaGuardada = { id: string; correo: string; empresa: string; access_token: string; refresh_token: string };
const CLAVE = 'siguelo.cuentas';

export function cuentasGuardadas(): CuentaGuardada[] {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) || '[]');
    return Array.isArray(x) ? x.filter((c) => c && c.id && c.refresh_token) : [];
  } catch {
    return [];
  }
}
function escribir(lista: CuentaGuardada[]) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}
export function guardarCuenta(sesion: Session, empresa: string) {
  const fila: CuentaGuardada = { id: sesion.user.id, correo: sesion.user.email || '', empresa, access_token: sesion.access_token, refresh_token: sesion.refresh_token };
  escribir([fila, ...cuentasGuardadas().filter((c) => c.id !== fila.id)].slice(0, 6));
}
// Con el token renovado (Supabase lo cambia cada hora), solo si ya estaba guardada.
export function actualizarTokens(sesion: Session) {
  const lista = cuentasGuardadas();
  const i = lista.findIndex((c) => c.id === sesion.user.id);
  if (i < 0) return;
  lista[i] = { ...lista[i], access_token: sesion.access_token, refresh_token: sesion.refresh_token };
  escribir(lista);
}
export function olvidarCuenta(id: string) {
  escribir(cuentasGuardadas().filter((c) => c.id !== id));
}
