import { db } from '../db.js';

// Quién está debajo de quién y qué números ve cada uno (database/siguelo.sql,
// secciones 29 a 31). Es lo mismo que revisan los permisos de la base de
// datos, para las rutas del servidor (que usan la clave secreta y no pasan
// por esos permisos).

export type Rol = 'dueno' | 'supervisor' | 'vendedor' | 'atendedor_online';
export type Acceso = {
  id: string;
  empresa_id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  linea_id: string | null;
  // Sin fila en siguelo_accesos (falta pegar el SQL): como antes del cambio.
  conFila: boolean;
  principal: boolean;
  jefe_id: string | null;
  todas_lineas: boolean;
  lineas: string[];
  vence_en: string | null;
};

// 4 dueño principal · 3 dueño de negocio · 2 gerente · 1 vendedor
export const nivelRol = (rol: Rol) => (rol === 'dueno' ? 3 : rol === 'supervisor' ? 2 : 1);
export const nivel = (a: Acceso) => (a.principal ? 4 : nivelRol(a.rol));

export async function accesoDe(usuarioId: string): Promise<Acceso | null> {
  const [{ data: u }, acc] = await Promise.all([
    db.from('usuarios').select('id, empresa_id, nombre, rol, activo, linea_id').eq('id', usuarioId).maybeSingle(),
    db.from('siguelo_accesos').select('jefe_id, principal, todas_lineas, lineas, vence_en').eq('usuario_id', usuarioId).maybeSingle(),
  ]);
  if (!u) return null;
  const a = acc.error ? null : acc.data;
  // Un acceso vencido cuenta como desactivado (al dueño principal no le vence).
  const vencido = !!a?.vence_en && !a.principal && new Date(a.vence_en).getTime() <= Date.now();
  return {
    ...u,
    activo: u.activo && !vencido,
    vence_en: a?.vence_en ?? null,
    conFila: !!a,
    principal: !!a?.principal,
    jefe_id: a?.jefe_id ?? null,
    todas_lineas: a ? a.todas_lineas : u.rol !== 'vendedor',
    lineas: a ? a.lineas || [] : u.linea_id ? [u.linea_id] : [],
  };
}

// Desactiva a los que se les venció el acceso (lo llama el servidor cada 10 minutos).
export async function desactivarVencidos(): Promise<void> {
  const { data, error } = await db.from('siguelo_accesos').select('usuario_id').eq('principal', false).lte('vence_en', new Date().toISOString());
  if (error || !data?.length) return;
  const { data: cambiados } = await db.from('usuarios').update({ activo: false }).in('id', data.map((x) => x.usuario_id)).eq('activo', true).select('nombre');
  for (const u of cambiados || []) console.log(`🔒 Se venció el acceso de ${u.nombre}: queda desactivado.`);
}

export const veTodo = (a: Acceso) => a.activo && (a.principal || a.todas_lineas);
export const veLinea = (a: Acceso, lineaId: string) => a.activo && (a.principal || a.todas_lineas || a.lineas.includes(lineaId));

// ¿"otro" está debajo de "yo"? El dueño principal: todos menos él mismo.
export async function esSubordinado(yo: Acceso, otroId: string): Promise<boolean> {
  if (otroId === yo.id) return false;
  const otro = await accesoDe(otroId);
  if (!otro || otro.empresa_id !== yo.empresa_id || otro.principal) return false;
  if (yo.principal) return true;
  let jefe = otro.jefe_id;
  for (let i = 0; jefe && i < 30; i++) {
    if (jefe === yo.id) return true;
    const { data } = await db.from('siguelo_accesos').select('jefe_id').eq('usuario_id', jefe).maybeSingle();
    jefe = data?.jefe_id ?? null;
  }
  return false;
}

// Los números que "yo" puede dar a otro: solo los que tiene.
export async function lineasPermitidas(yo: Acceso, pedidas: string[]): Promise<string | null> {
  if (veTodo(yo)) {
    const { data } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', yo.empresa_id).in('id', pedidas.length ? pedidas : ['00000000-0000-0000-0000-000000000000']);
    return (data || []).length === pedidas.length ? null : 'Alguno de esos números no existe.';
  }
  return pedidas.every((l) => yo.lineas.includes(l)) ? null : 'Solo puedes dar acceso a los números que tú tienes.';
}
