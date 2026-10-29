// Sesión falsa: un dueño de la empresa de prueba.
const rol = new URLSearchParams(location.search).get('rol') || 'dueno';
const usuario = { id: new URLSearchParams(location.search).get('yo') || 'u1', empresa_id: 'emp-1', nombre: 'Dueño de prueba', rol, linea_id: null, activo: true, zona_horaria: 'America/La_Paz' };
export function useAuth() {
  return { usuario, empresa: { id: 'emp-1', nombre: 'Empresa de prueba' }, sesion: null, cargando: false, cerrarSesion: async () => undefined };
}
