import { randomInt } from 'node:crypto';
import { db } from '../db.js';
import { MIN } from '../horario.js';
import { normalizarTexto } from '../textos.js';

// Conexión con tu Aula virtual (Aula Infinity Chess, otro proyecto de Supabase).
// El CRM entra con una cuenta de profesor o director del aula y usa lo mismo
// que usa la página del aula: lee los planes y los grupos, busca al alumno por
// su celular (listar_personas), crea su cuenta (función "cuentas") y lo inscribe
// con su pago (registrar_inscripcion). Solo el servidor ve la contraseña.

export type ConfigAula = { url: string; clave_publica: string; usuario: string; contrasena: string; enlace: string };
export type PlanAula = { id: string; nombre: string; precio: number; dias: number; clases: number | null; grupo_id: string | null; activo?: boolean };
export type GrupoAula = { id: string; nombre: string; dias?: number[] | null; hora_inicio?: string | null; duracion_min?: number | null; cupo?: number | null; activo?: boolean };
export type PersonaAula = { id: string; nombre: string; usuario: string; celular: string | null; rol: string; activo?: boolean; vigente?: boolean; hasta?: string | null };

export const ENLACE_AULA = 'https://infinity-chess-aula.pages.dev';
const ESPERA_MS = 20_000;
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const configs = new Map<string, { leido: number; cfg: ConfigAula | null }>();
const cache = new Map<string, { hasta: number; valor: unknown }>();
const sesiones = new Map<string, { token: string; hasta: number }>();

export function olvidarAula(): void {
  configs.clear();
  cache.clear();
  sesiones.clear();
}

export async function configAula(empresaId: string): Promise<ConfigAula | null> {
  const c = configs.get(empresaId);
  if (c && Date.now() - c.leido < MIN) return c.cfg;
  const { data, error } = await db.from('siguelo_aula').select('url, clave_publica, usuario, contrasena, enlace').eq('empresa_id', empresaId).maybeSingle();
  const cfg = error || !data ? null : { ...data, enlace: data.enlace?.trim() || ENLACE_AULA };
  configs.set(empresaId, { leido: Date.now(), cfg });
  return cfg;
}

// El correo con que inicia sesión un usuario del aula.
export const correoAula = (usuario: string) => (usuario.includes('@') ? usuario.trim() : `${usuario.trim().toLowerCase()}@aula.infinitychess.local`);
const base = (cfg: ConfigAula) => cfg.url.trim().replace(/\/+$/, '');

async function pedir(cfg: ConfigAula, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, token?: string): Promise<any> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r = await fetch(base(cfg) + ruta, {
      method: metodo,
      headers: { apikey: cfg.clave_publica, Authorization: `Bearer ${token ?? cfg.clave_publica}`, 'Content-Type': 'application/json' },
      ...(metodo === 'POST' ? { body: JSON.stringify(cuerpo ?? {}) } : {}),
      signal: control.signal,
    });
    const texto = await r.text();
    let datos: any = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = texto;
    }
    if (!r.ok) throw new Error(datos?.error || datos?.message || datos?.error_description || datos?.msg || `el aula respondió ${r.status}`);
    return datos;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('El aula tardó demasiado en responder.');
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

async function token(cfg: ConfigAula): Promise<string> {
  const clave = `${cfg.url}|${cfg.usuario}`;
  const s = sesiones.get(clave);
  if (s && s.hasta > Date.now()) return s.token;
  const d = await pedir(cfg, 'POST', '/auth/v1/token?grant_type=password', { email: correoAula(cfg.usuario), password: cfg.contrasena }).catch((err: Error) => {
    throw new Error(/invalid/i.test(err.message) ? 'El usuario o la contraseña de la cuenta del aula no son correctos.' : err.message);
  });
  sesiones.set(clave, { token: d.access_token, hasta: Date.now() + Math.max(60, Number(d.expires_in || 3600) - 120) * 1000 });
  return d.access_token;
}

const rpc = async (cfg: ConfigAula, fn: string, args: Record<string, unknown> = {}) => pedir(cfg, 'POST', `/rest/v1/rpc/${fn}`, args, await token(cfg));

export const planesAula = (cfg: ConfigAula) =>
  enCache<PlanAula[]>(`planes:${cfg.url}`, 5 * MIN, async () => pedir(cfg, 'GET', '/rest/v1/planes?select=*&activo=eq.true&order=precio', undefined, await token(cfg)));
export const gruposAula = (cfg: ConfigAula) =>
  enCache<GrupoAula[]>(`grupos:${cfg.url}`, 5 * MIN, async () => pedir(cfg, 'GET', '/rest/v1/grupos?select=*&activo=eq.true&order=nombre', undefined, await token(cfg)));
export const personasAula = async (cfg: ConfigAula) => ((await rpc(cfg, 'listar_personas')) || []) as PersonaAula[];

// ---------- Textos ----------

// "lunes, miércoles y viernes · 19:00 a 20:00"
export function horarioGrupo(g: GrupoAula | null | undefined): string {
  if (!g) return '';
  const dias = [...(g.dias || [])].sort((a, b) => a - b).map((d) => DIAS[d - 1]).filter(Boolean);
  const texto = dias.length > 1 ? `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}` : dias[0] || '';
  if (!g.hora_inicio) return texto;
  const [h, m] = g.hora_inicio.split(':').map(Number);
  const fin = h * 60 + m + Number(g.duracion_min || 60);
  const hhmm = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return `${texto} · ${hhmm(h * 60 + m)} a ${hhmm(fin)}`;
}

export function textoPlan(p: PlanAula, grupos: GrupoAula[]): string {
  const g = grupos.find((x) => x.id === p.grupo_id);
  const partes = [`Bs ${Number(p.precio).toLocaleString('es')}`, `${p.dias} días`, p.clases != null ? `${p.clases} clases` : 'clases sin límite'];
  if (g) partes.push(`grupo ${g.nombre}${horarioGrupo(g) ? ` (${horarioGrupo(g)} hora de Bolivia)` : ''}`);
  return `${p.nombre}: ${partes.join(' · ')}`;
}

export function textoAulaParaIA(planes: PlanAula[], grupos: GrupoAula[], enlace: string): string {
  if (!planes.length) return '';
  return [
    `Cursos virtuales de ajedrez en el Aula Infinity Chess (${enlace}): clases en vivo por internet, con grabaciones, ejercicios y biblioteca.`,
    'PLANES:',
    ...planes.map((p) => `- ${textoPlan(p, grupos)}`),
    'Para inscribirse: paga por QR el precio del plan y manda la foto del comprobante; al confirmarse le llegan su usuario y contraseña del aula.',
  ].join('\n');
}

let avisoError = 0;
// El bloque para la IA ('' si no hay un curso del aula para este negocio o el aula no responde).
export async function datosAulaParaIA(empresaId: string, negocioId: string | null | undefined): Promise<string> {
  const { data: cursos, error } = await db.from('siguelo_cursos').select('id, negocio_id').eq('empresa_id', empresaId).eq('activo', true).eq('aula', true);
  if (error || !(cursos || []).some((k) => !k.negocio_id || k.negocio_id === negocioId)) return '';
  const cfg = await configAula(empresaId);
  if (!cfg) return '';
  try {
    const [planes, grupos] = await Promise.all([planesAula(cfg), gruposAula(cfg)]);
    return textoAulaParaIA(planes, grupos, cfg.enlace);
  } catch (err) {
    if (Date.now() - avisoError > 10 * MIN) console.error('Aula: no se pudieron leer los planes:', (err as Error).message);
    avisoError = Date.now();
    return '';
  }
}

// ---------- Inscribir ----------

// Fechas como en la página del aula: "AAAA-MM-DD" + n días.
export function masDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// El día de la clase número n, contando desde "desde" los días del grupo (1 = lunes … 7 = domingo).
export function diaDeClase(desde: string, dias: number[], n: number): string | null {
  if (!dias.length || !(n > 0)) return null;
  let cuenta = 0;
  for (let i = 0; i <= n * 7 + 7; i++) {
    const f = masDias(desde, i);
    const dia = ((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (dias.includes(dia) && ++cuenta === n) return f;
  }
  return null;
}

// Desde y hasta de la inscripción: si ya tiene una vigente, la nueva empieza al día siguiente.
export function fechasInscripcion(plan: PlanAula, grupo: GrupoAula | null, persona: Pick<PersonaAula, 'vigente' | 'hasta'> | null, hoy: string): { desde: string; hasta: string } {
  const desde = persona?.vigente && persona.hasta && persona.hasta >= hoy ? masDias(persona.hasta, 1) : hoy;
  const porClases = plan.clases != null && grupo?.dias?.length ? diaDeClase(desde, grupo.dias, plan.clases) : null;
  return { desde, hasta: porClases ?? masDias(desde, Math.max(1, Number(plan.dias) || 30) - 1) };
}

const ultimos8 = (t: string | null | undefined) => String(t || '').replace(/\D/g, '').slice(-8);

// El alumno que ya tiene cuenta: mismo celular y (si hay varios con ese celular, por ejemplo hermanos) el mismo nombre.
export function buscarAlumno(personas: PersonaAula[], telefono: string, alumno: string): PersonaAula | null {
  const tel = ultimos8(telefono);
  if (tel.length < 7) return null;
  const mismos = personas.filter((p) => (p.rol === 'usuario' || !p.rol) && p.activo !== false && ultimos8(p.celular) === tel);
  const palabras = normalizarTexto(alumno).split(' ').filter((w) => w.length > 2);
  const porNombre = mismos.filter((p) => {
    const n = normalizarTexto(p.nombre);
    return palabras.length > 0 && palabras.filter((w) => n.includes(w)).length >= Math.min(2, palabras.length);
  });
  if (porNombre.length) return porNombre[0];
  // Un solo alumno con ese celular y sin nombre para comparar: es él.
  return mismos.length === 1 && !palabras.length ? mismos[0] : null;
}

// "Ana María Rojas Pérez" + 70000123 → "anarojas123"
export function usuarioPara(alumno: string, telefono: string): string {
  const ws = normalizarTexto(alumno).replace(/[^a-z ]/g, '').split(' ').filter(Boolean);
  const nombre = (ws[0] || 'alumno') + (ws.length > 2 ? ws[ws.length - 2] : ws[1] || '');
  return `${nombre.slice(0, 16)}${ultimos8(telefono).slice(-3)}`;
}
export const claveTemporal = () => String(randomInt(100000, 1000000));

export type ResultadoAula = { usuario_id: string; usuario: string; clave: string | null; nueva: boolean; desde: string; hasta: string };

// Busca o crea la cuenta del alumno y lo inscribe en el plan con su pago.
export async function inscribirEnAula(
  cfg: ConfigAula,
  datos: { alumno: string; telefono: string; plan: PlanAula; monto: number; hoy: string; nota: string },
): Promise<ResultadoAula> {
  const [personas, grupos] = await Promise.all([personasAula(cfg), gruposAula(cfg).catch(() => [] as GrupoAula[])]);
  let persona = buscarAlumno(personas, datos.telefono, datos.alumno);
  let clave: string | null = null;
  if (!persona) {
    clave = claveTemporal();
    const celular = datos.telefono.replace(/\D/g, '').replace(/^591(?=[67]\d{7}$)/, '');
    let usuario = usuarioPara(datos.alumno, datos.telefono);
    let creada: { id?: string } | null = null;
    for (let intento = 0; intento < 3 && !creada; intento++) {
      try {
        creada = await pedir(cfg, 'POST', '/functions/v1/cuentas', { accion: 'crear', nombre: datos.alumno, celular, usuario, clave, rol: 'usuario' }, await token(cfg));
      } catch (err) {
        if (intento < 2 && /exist|ya hay|ocupad|registrad|duplic|already/i.test((err as Error).message)) usuario = `${usuarioPara(datos.alumno, datos.telefono)}${randomInt(10, 100)}`;
        else throw new Error(`no se pudo crear la cuenta en el aula: ${(err as Error).message}`);
      }
    }
    // La función devuelve el id; si no, se busca a la persona recién creada.
    const id = creada?.id || (await personasAula(cfg)).find((p) => p.usuario === usuario)?.id;
    if (!id) throw new Error('se creó la cuenta en el aula pero no se encontró para inscribirla');
    persona = { id, nombre: datos.alumno, usuario, celular, rol: 'usuario', vigente: false, hasta: null };
  }
  const grupo = grupos.find((g) => g.id === datos.plan.grupo_id) ?? null;
  const { desde, hasta } = fechasInscripcion(datos.plan, grupo, persona, datos.hoy);
  const total = Number(datos.plan.precio) || datos.monto;
  await rpc(cfg, 'registrar_inscripcion', {
    p_usuario: persona.id,
    p_plan: datos.plan.id,
    p_descripcion: datos.plan.nombre,
    p_desde: desde,
    p_hasta: hasta,
    p_clases: datos.plan.clases ?? null,
    p_total: total,
    p_pago: Math.min(total, datos.monto),
    p_metodo: 'qr',
    p_nota: datos.nota,
    p_grupo: datos.plan.grupo_id ?? null,
  });
  return { usuario_id: persona.id, usuario: persona.usuario, clave, nueva: !!clave, desde, hasta };
}

// Conecta (o vuelve a probar) y guarda lo que ve la página.
export async function conectarAula(empresaId: string, cfg: ConfigAula): Promise<{ ok: true; planes: PlanAula[] } | { ok: false; mensaje: string }> {
  olvidarAula();
  try {
    await token(cfg);
    await personasAula(cfg).catch((err: Error) => {
      throw new Error(`esa cuenta no puede ver a los alumnos del aula (tiene que ser de profesor o director): ${err.message}`);
    });
    const [planes, grupos] = await Promise.all([planesAula(cfg), gruposAula(cfg).catch(() => [] as GrupoAula[])]);
    const ahora = new Date().toISOString();
    const { error } = await db.from('siguelo_aula').upsert({ empresa_id: empresaId, ...cfg, actualizado_en: ahora }, { onConflict: 'empresa_id' });
    if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}. ¿Pegaste la última versión de database/siguelo.sql?` };
    await db.from('siguelo_aula_info').upsert(
      { empresa_id: empresaId, conectado: true, cuenta: cfg.usuario, enlace: cfg.enlace, planes: planes.map((p) => ({ id: p.id, nombre: p.nombre, texto: textoPlan(p, grupos) })), error: null, actualizado_en: ahora },
      { onConflict: 'empresa_id' },
    );
    olvidarAula();
    return { ok: true, planes };
  } catch (err) {
    return { ok: false, mensaje: (err as Error).message };
  }
}
