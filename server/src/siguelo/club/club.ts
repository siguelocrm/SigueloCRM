import { db } from '../db.js';
import { MIN } from '../horario.js';
import { textoParaIA, type GrupoClub, type SucursalClub, type TarifaClub } from './formato.js';

export * from './formato.js';

// Conexión con tu sistema del club (Infinity Chess Gestión, otro proyecto de
// Supabase). Lo público (sucursales, grupos con su cupo y tarifas) se lee con
// las mismas funciones que usa la página de visitas; para dejar reservas, el
// CRM inicia sesión como un vendedor y usa las funciones del panel de
// vendedores. Solo el servidor ve la contraseña.

export type ConfigClub = { url: string; clave_publica: string; usuario: string; contrasena: string };
export type VendedorClub = { id: string; nombre_completo?: string; nombre?: string; sucursales?: { id: string; nombre: string }[] };

const ESPERA_MS = 20_000;
const configs = new Map<string, { leido: number; cfg: ConfigClub | null }>();
const cache = new Map<string, { hasta: number; valor: unknown }>();
const sesiones = new Map<string, { token: string; hasta: number }>();

export function olvidarClub(): void {
  configs.clear();
  cache.clear();
  sesiones.clear();
}

export async function configClub(empresaId: string): Promise<ConfigClub | null> {
  const c = configs.get(empresaId);
  if (c && Date.now() - c.leido < MIN) return c.cfg;
  const { data, error } = await db.from('siguelo_club').select('url, clave_publica, usuario, contrasena').eq('empresa_id', empresaId).maybeSingle();
  const cfg = error || !data ? null : data;
  configs.set(empresaId, { leido: Date.now(), cfg });
  return cfg;
}

// El correo con que inicia sesión un usuario del sistema del club.
export const correoInterno = (usuario: string) => (usuario.includes('@') ? usuario.trim() : `${usuario.trim().toLowerCase()}@usuarios.infinitychess.local`);
const base = (cfg: ConfigClub) => cfg.url.trim().replace(/\/+$/, '');

async function pedir(cfg: ConfigClub, ruta: string, cuerpo: unknown, token?: string): Promise<any> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r = await fetch(base(cfg) + ruta, {
      method: 'POST',
      headers: { apikey: cfg.clave_publica, Authorization: `Bearer ${token ?? cfg.clave_publica}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
      signal: control.signal,
    });
    const texto = await r.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }
    if (!r.ok) throw new Error(datos?.message || datos?.error_description || datos?.msg || datos?.error || `el sistema del club respondió ${r.status}`);
    return datos;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('El sistema del club tardó demasiado en responder.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function enCache<T>(clave: string, ms: number, f: () => Promise<T>): Promise<T> {
  const c = cache.get(clave);
  if (c && c.hasta > Date.now()) return c.valor as T;
  const valor = await f();
  cache.set(clave, { hasta: Date.now() + ms, valor });
  return valor;
}

export const sucursalesClub = (cfg: ConfigClub) => enCache<SucursalClub[]>(`suc:${cfg.url}`, 10 * MIN, () => pedir(cfg, '/rest/v1/rpc/publico_sucursales', {}));
export const gruposClub = (cfg: ConfigClub, sucursal: string) =>
  enCache<GrupoClub[]>(`cur:${cfg.url}:${sucursal}`, 2 * MIN, () => pedir(cfg, '/rest/v1/rpc/publico_cursos', { p_branch: sucursal }));
export const tarifasClub = (cfg: ConfigClub, sucursal: string) =>
  enCache<TarifaClub[]>(`tar:${cfg.url}:${sucursal}`, 10 * MIN, () => pedir(cfg, '/rest/v1/rpc/publico_tarifas', { p_branch: sucursal }));

async function token(cfg: ConfigClub): Promise<string> {
  const clave = `${cfg.url}|${cfg.usuario}`;
  const s = sesiones.get(clave);
  if (s && s.hasta > Date.now()) return s.token;
  const d = await pedir(cfg, '/auth/v1/token?grant_type=password', { email: correoInterno(cfg.usuario), password: cfg.contrasena }).catch((err: Error) => {
    throw new Error(/invalid/i.test(err.message) ? 'El usuario o la contraseña del vendedor no son correctos.' : err.message);
  });
  sesiones.set(clave, { token: d.access_token, hasta: Date.now() + Math.max(60, Number(d.expires_in || 3600) - 120) * 1000 });
  return d.access_token;
}

export async function rpcVendedor(cfg: ConfigClub, fn: string, args: Record<string, unknown> = {}): Promise<any> {
  return pedir(cfg, `/rest/v1/rpc/${fn}`, args, await token(cfg));
}

export const vendedorYo = (cfg: ConfigClub) => rpcVendedor(cfg, 'vendedor_yo') as Promise<VendedorClub>;

// Sube la foto del comprobante a "reservas" (donde la busca tu sistema al revisar la reserva).
export async function subirFoto(cfg: ConfigClub, ruta: string, datos: Buffer, mime: string): Promise<string> {
  const r = await fetch(`${base(cfg)}/storage/v1/object/reservas/${ruta}`, {
    method: 'POST',
    headers: { apikey: cfg.clave_publica, Authorization: `Bearer ${await token(cfg)}`, 'Content-Type': mime, 'x-upsert': 'false' },
    body: new Uint8Array(datos),
  });
  if (!r.ok) {
    const texto = await r.text();
    if (!/exists|duplicate/i.test(texto)) throw new Error(`No se pudo subir la foto del comprobante al club (${r.status}).`);
  }
  return ruta;
}

let avisoError = 0;
// El bloque de datos en vivo para la IA ('' si el negocio no está conectado o el club no responde).
export async function datosClubParaIA(empresaId: string, sucursalId: string | null | undefined, hoy: string): Promise<string> {
  if (!sucursalId) return '';
  const cfg = await configClub(empresaId);
  if (!cfg) return '';
  try {
    const [sucursales, grupos, tarifas] = await Promise.all([sucursalesClub(cfg), gruposClub(cfg, sucursalId), tarifasClub(cfg, sucursalId)]);
    return textoParaIA(sucursales.find((s) => s.id === sucursalId)?.nombre ?? '', grupos, tarifas, hoy);
  } catch (err) {
    if (Date.now() - avisoError > 10 * MIN) console.error('Club: no se pudieron leer los horarios:', (err as Error).message);
    avisoError = Date.now();
    return '';
  }
}

// Conecta (o vuelve a probar) y guarda lo que ve la página.
export async function conectarClub(empresaId: string, cfg: ConfigClub): Promise<{ ok: true; vendedor: string; sucursales: SucursalClub[] } | { ok: false; mensaje: string }> {
  olvidarClub();
  try {
    const sucursales = await sucursalesClub(cfg);
    const yo = await vendedorYo(cfg);
    if (!yo?.id) return { ok: false, mensaje: 'Ese usuario no es de un vendedor activo del club.' };
    const vendedor = yo.nombre_completo || yo.nombre || cfg.usuario;
    const ahora = new Date().toISOString();
    const { error } = await db.from('siguelo_club').upsert({ empresa_id: empresaId, ...cfg, actualizado_en: ahora }, { onConflict: 'empresa_id' });
    if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}. ¿Pegaste la última versión de database/siguelo.sql?` };
    await db
      .from('siguelo_club_info')
      .upsert({ empresa_id: empresaId, conectado: true, vendedor, sucursales: sucursales.map((s) => ({ id: s.id, nombre: s.nombre, departamento: s.departamento ?? null })), error: null, actualizado_en: ahora }, { onConflict: 'empresa_id' });
    olvidarClub();
    return { ok: true, vendedor, sucursales };
  } catch (err) {
    return { ok: false, mensaje: (err as Error).message };
  }
}
