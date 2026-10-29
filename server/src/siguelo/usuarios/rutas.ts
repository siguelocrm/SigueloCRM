import { Router, type Request, type Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { db } from '../db.js';
import { accesoDe, esSubordinado, lineasPermitidas, nivel, nivelRol, veTodo, type Acceso, type Rol } from './accesos.js';

// Crear, editar y eliminar usuarios respetando la jerarquía: cada uno solo
// administra a los que están debajo de él, nunca con un rol igual o más alto
// que el suyo, y solo les da números que él tiene. Al dueño principal no lo
// puede tocar nadie.

export const usuariosSigueloRouter = Router();
const cualquiera = requiereRol('vendedor', 'atendedor_online', 'supervisor', 'dueno');
const ROLES: Rol[] = ['vendedor', 'supervisor', 'dueno'];

// "2026-11-29" o "2026-11-29T…" → fecha válida en el futuro; null = sin vencimiento; undefined = no vino.
function venceDe(x: unknown): string | null | undefined | false {
  if (x === undefined) return undefined;
  if (x === null || x === '') return null;
  const t = new Date(String(x)).getTime();
  return Number.isFinite(t) && t > Date.now() ? new Date(t).toISOString() : false;
}

const unicos = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)))] : []);

async function yo(req: Request, res: Response): Promise<Acceso | null> {
  const a = await accesoDe(req.usuarioAutenticado!.id);
  if (!a || !a.activo) {
    res.status(403).json({ error: 'Tu usuario no está activo.' });
    return null;
  }
  return a;
}

// Revisa los números pedidos: "todos" solo si uno mismo ve todos; si no, solo los que uno tiene.
async function revisarNumeros(a: Acceso, todas: boolean, lineas: string[]): Promise<string | null> {
  if (todas && !veTodo(a)) return 'No puedes dar acceso a todos los números: tú no los tienes todos.';
  return todas ? null : lineasPermitidas(a, lineas);
}

usuariosSigueloRouter.post('/siguelo/usuarios', cualquiera, async (req, res) => {
  const a = await yo(req, res);
  if (!a) return;
  const { email, password, nombre, rol } = req.body ?? {};
  const todas = req.body?.todas_lineas === true;
  const lineas = todas ? [] : unicos(req.body?.lineas);
  if (nivel(a) < 2) return res.status(403).json({ error: 'Tu rol no puede crear usuarios.' });
  if (!email || !password || !String(nombre ?? '').trim()) return res.status(400).json({ error: 'Completa nombre, correo y contraseña.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña necesita al menos 6 caracteres.' });
  if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Ese rol no existe.' });
  if (nivelRol(rol) >= nivel(a)) return res.status(403).json({ error: 'No puedes crear a alguien con un rol igual o más alto que el tuyo.' });
  const malNumeros = await revisarNumeros(a, todas, lineas);
  if (malNumeros) return res.status(403).json({ error: malNumeros });
  const vence = venceDe(req.body?.vence_en);
  if (vence === false) return res.status(400).json({ error: 'La fecha de vencimiento tiene que ser en el futuro.' });

  const { data: nuevo, error: errorAuth } = await db.auth.admin.createUser({ email: String(email).trim(), password: String(password), email_confirm: true });
  if (errorAuth || !nuevo.user) return res.status(400).json({ error: /already/i.test(errorAuth?.message ?? '') ? 'Ya existe un usuario con ese correo.' : errorAuth?.message ?? 'No se pudo crear.' });
  const id = nuevo.user.id;
  const { error: errorUsuario } = await db.from('usuarios').insert({ id, empresa_id: a.empresa_id, nombre: String(nombre).trim(), rol, linea_id: rol === 'vendedor' ? lineas[0] ?? null : null });
  const { error: errorAcceso } = errorUsuario
    ? { error: null }
    : await db.from('siguelo_accesos').insert({ usuario_id: id, empresa_id: a.empresa_id, jefe_id: a.id, principal: false, todas_lineas: todas, lineas, vence_en: vence ?? null });
  if (errorUsuario || errorAcceso) {
    // No dejar una cuenta a medias.
    await db.from('usuarios').delete().eq('id', id);
    await db.auth.admin.deleteUser(id);
    return res.status(500).json({ error: `No se pudo crear: ${(errorUsuario || errorAcceso)!.message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  }
  res.json({ ok: true, id });
});

usuariosSigueloRouter.patch('/siguelo/usuarios/:id', cualquiera, async (req, res) => {
  const a = await yo(req, res);
  if (!a) return;
  const id = req.params.id;
  if (!(await esSubordinado(a, id))) return res.status(403).json({ error: 'Solo puedes editar a las personas que están debajo de ti.' });
  const otro = (await accesoDe(id))!;
  const b = req.body ?? {};
  const cambios: { nombre?: string; rol?: Rol; activo?: boolean; linea_id?: string | null } = {};
  if (typeof b.nombre === 'string' && b.nombre.trim()) cambios.nombre = b.nombre.trim();
  if (b.rol !== undefined) {
    if (!ROLES.includes(b.rol)) return res.status(400).json({ error: 'Ese rol no existe.' });
    if (nivelRol(b.rol) >= nivel(a)) return res.status(403).json({ error: 'No puedes dar un rol igual o más alto que el tuyo.' });
    cambios.rol = b.rol;
  }
  if (typeof b.activo === 'boolean') cambios.activo = b.activo;
  let numeros: { todas_lineas: boolean; lineas: string[] } | null = null;
  if (typeof b.todas_lineas === 'boolean' || Array.isArray(b.lineas)) {
    const todas = typeof b.todas_lineas === 'boolean' ? b.todas_lineas : otro.todas_lineas;
    const lineas = todas ? [] : Array.isArray(b.lineas) ? unicos(b.lineas) : otro.lineas;
    const mal = await revisarNumeros(a, todas, lineas);
    if (mal) return res.status(403).json({ error: mal });
    numeros = { todas_lineas: todas, lineas };
  }
  const vence = venceDe(b.vence_en);
  if (vence === false) return res.status(400).json({ error: 'La fecha de vencimiento tiene que ser en el futuro.' });
  // Renovar el acceso lo vuelve a activar (si no se dijo otra cosa).
  if (vence !== undefined && typeof b.activo !== 'boolean') cambios.activo = true;
  const rolFinal = cambios.rol ?? otro.rol;
  const lineasFinal = numeros ? numeros.lineas : otro.lineas;
  if (cambios.rol || numeros) cambios.linea_id = rolFinal === 'vendedor' ? lineasFinal[0] ?? null : null;
  if (Object.keys(cambios).length) {
    const { error } = await db.from('usuarios').update(cambios).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
  }
  if (numeros || vence !== undefined || !otro.conFila) {
    const { error } = await db
      .from('siguelo_accesos')
      .upsert(
        {
          usuario_id: id,
          empresa_id: a.empresa_id,
          jefe_id: otro.jefe_id ?? a.id,
          principal: false,
          ...(numeros ?? { todas_lineas: otro.todas_lineas, lineas: otro.lineas }),
          vence_en: vence === undefined ? otro.vence_en : vence,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: 'usuario_id' },
      );
    if (error) return res.status(500).json({ error: `${error.message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  }
  res.json({ ok: true });
});

usuariosSigueloRouter.delete('/siguelo/usuarios/:id', cualquiera, async (req, res) => {
  const a = await yo(req, res);
  if (!a) return;
  const id = req.params.id;
  if (!(await esSubordinado(a, id))) return res.status(403).json({ error: 'Solo puedes eliminar a las personas que están debajo de ti.' });
  const otro = (await accesoDe(id))!;
  // Los que estaban debajo de él pasan a estar debajo de su jefe.
  await db.from('siguelo_accesos').update({ jefe_id: otro.jefe_id ?? a.id }).eq('jefe_id', id);
  const { error } = await db.from('usuarios').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  const { error: errorAuth } = await db.auth.admin.deleteUser(id);
  if (errorAuth) console.error('Usuarios: se borró el perfil pero no la cuenta de acceso:', errorAuth.message);
  res.json({ ok: true });
});
