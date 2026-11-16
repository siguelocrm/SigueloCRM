import { randomInt } from 'node:crypto';
import { db } from '../db.js';
import { registrar } from '../registro.js';
import { cambiarEtapa } from '../motor.js';
import { etapasDelEmbudo } from '../negocios.js';
import { numeroPersonal } from '../ia/salida.js';
import { olvidarCache } from '../ia/config.js';
import { olvidarBloqueos } from './bloqueo.js';
import type { CuentaRow, PlanRow } from '../tipos.js';

// Tu agencia (sección 41 de siguelo.sql): planes, ventas y las cuentas del CRM que creas.
// Cada cuenta es una empresa aparte: sus números, contactos, IA y usuarios no se mezclan
// con los tuyos. Vencida o en pausa, nadie de ella entra (no se borra nada).

const DIA = 24 * 3600 * 1000;
// Si escribes un usuario sin @ ("agencia"), se guarda como un correo de este dominio
// (Supabase pide un correo). En la entrada del CRM se puede escribir igual solo "agencia".
export const DOMINIO_USUARIOS = 'siguelocrm.app.mapse.club';

export function correoDe(usuario: string): string | null {
  const u = usuario.trim().toLowerCase();
  if (u.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u) ? u : null;
  const limpio = u.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '');
  return limpio.length >= 3 ? `${limpio}@${DOMINIO_USUARIOS}` : null;
}
// Para mostrar: "agencia" en vez de "agencia@siguelocrm.app.mapse.club".
export const usuarioDe = (correo: string) => (correo.endsWith(`@${DOMINIO_USUARIOS}`) ? correo.slice(0, -DOMINIO_USUARIOS.length - 1) : correo);

const texto = (x: unknown, max = 200) => String(x ?? '').trim().slice(0, max);
const fechaValida = (x: unknown): string | null => {
  if (x === null || x === undefined || x === '') return null;
  const t = new Date(String(x)).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
// El WhatsApp guardado como lo guarda el CRM (591…), para reconocer al cliente cuando vuelve a pagar.
const telefonoDe = (x: unknown) => {
  const t = numeroPersonal(texto(x, 30));
  return t.length >= 7 ? t : texto(x, 30) || null;
};
const dd = (iso: string) => new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/La_Paz' }).format(new Date(iso));

type Resultado<T> = ({ ok: true } & T) | { ok: false; mensaje: string };

// ---------- ¿Quién puede usar la Agencia? ----------
// El dueño principal de una cuenta marcada como agencia (tus cuentas: el club y la agencia).
export async function esAgencia(empresaId: string): Promise<boolean> {
  const { data, error } = await db.from('siguelo_agencias').select('empresa_id').eq('empresa_id', empresaId).maybeSingle();
  return !error && !!data;
}

// ---------- Cuentas ----------
export type DatosCuenta = {
  nombre: string; // el nombre del negocio del cliente
  contacto?: string; // la persona
  telefono?: string;
  usuario: string; // correo o usuario para entrar
  password: string;
  vence_en?: string | null;
  plan_id?: string | null;
  notas?: string;
  propia?: boolean; // una cuenta tuya: también puede crear cuentas y tiene el botón para cambiar de cuenta
  usar_mi_clave?: boolean; // la IA de esa cuenta usa tu clave de OpenAI
  max_numeros?: number | null; // cuántos números de WhatsApp puede conectar (null = sin límite)
  max_negocios?: number | null;
};

// "3" → 3; null, "" o "sin límite" → null; nada → el valor por defecto.
function limite(x: unknown, porDefecto: number | null): number | null | false {
  if (x === undefined) return porDefecto;
  if (x === null || x === '') return null;
  const n = Math.round(Number(x));
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : false;
}

export async function crearCuenta(agenciaId: string, d: DatosCuenta): Promise<Resultado<{ empresa_id: string; usuario: string }>> {
  const nombre = texto(d.nombre, 120);
  const correo = correoDe(String(d.usuario ?? ''));
  const password = String(d.password ?? '');
  if (!nombre) return { ok: false, mensaje: 'Escribe el nombre de la cuenta (el negocio).' };
  if (!correo) return { ok: false, mensaje: 'El usuario necesita al menos 3 letras o números (o un correo válido).' };
  if (password.length < 6) return { ok: false, mensaje: 'La contraseña necesita al menos 6 caracteres.' };
  const vence = d.vence_en === undefined ? null : fechaValida(d.vence_en);
  if (d.plan_id) {
    const { data: plan } = await db.from('siguelo_planes').select('id').eq('id', d.plan_id).eq('empresa_id', agenciaId).maybeSingle();
    if (!plan) return { ok: false, mensaje: 'Ese plan no existe.' };
  }
  const maxNumeros = limite(d.max_numeros, 1);
  const maxNegocios = limite(d.max_negocios, 1);
  if (maxNumeros === false || maxNegocios === false) return { ok: false, mensaje: 'Revisa los límites de números y negocios.' };

  // 1. La empresa nueva (vacía; la base le pone su embudo por defecto).
  const { data: empresa, error: errEmpresa } = await db.from('empresas').insert({ nombre }).select('id').single();
  if (errEmpresa || !empresa) {
    const falta = /empresas_una_sola|duplicate key/i.test(errEmpresa?.message ?? '');
    return { ok: false, mensaje: falta ? 'Falta pegar la sección 41 de database/siguelo.sql en Supabase (todavía permite una sola cuenta).' : `No se pudo crear la cuenta: ${errEmpresa?.message}` };
  }
  const borrarEmpresa = () => db.from('empresas').delete().eq('id', empresa.id);

  // 2. Su usuario (el dueño principal de esa cuenta).
  const { data: nuevo, error: errAuth } = await db.auth.admin.createUser({ email: correo, password, email_confirm: true });
  if (errAuth || !nuevo?.user) {
    await borrarEmpresa();
    return { ok: false, mensaje: /already|registered|exists/i.test(errAuth?.message ?? '') ? `Ya existe alguien con el usuario "${usuarioDe(correo)}". Elige otro.` : `No se pudo crear el usuario: ${errAuth?.message}` };
  }
  const usuarioId = nuevo.user.id;
  const deshacer = async () => {
    await db.from('usuarios').delete().eq('id', usuarioId);
    await db.auth.admin.deleteUser(usuarioId);
    await borrarEmpresa();
  };
  const pasos = [
    () => db.from('usuarios').insert({ id: usuarioId, empresa_id: empresa.id, nombre: texto(d.contacto, 80) || nombre, rol: 'dueno' }),
    () => db.from('siguelo_accesos').insert({ usuario_id: usuarioId, empresa_id: empresa.id, principal: true, todas_lineas: true, lineas: [] }),
    () =>
      db.from('siguelo_cuentas').insert({
        empresa_id: empresa.id,
        agencia_id: agenciaId,
        nombre,
        contacto: texto(d.contacto, 80) || null,
        telefono: telefonoDe(d.telefono),
        usuario: correo,
        usuario_id: usuarioId,
        plan_id: d.plan_id || null,
        vence_en: d.propia ? null : vence,
        propia: !!d.propia,
        notas: texto(d.notas, 1000) || null,
        max_numeros: maxNumeros,
        max_negocios: maxNegocios,
      }),
    ...(d.propia ? [() => db.from('siguelo_agencias').insert({ empresa_id: empresa.id })] : []),
  ];
  for (const paso of pasos) {
    const { error } = await paso();
    if (error) {
      await deshacer();
      return { ok: false, mensaje: `No se pudo crear la cuenta: ${error.message}. ¿Pegaste la sección 41 de database/siguelo.sql?` };
    }
  }
  // La IA de la cuenta nueva con tu misma clave de OpenAI (nunca se muestra).
  if (d.usar_mi_clave) {
    const { data: clave } = await db.from('siguelo_ia_clave').select('clave').eq('empresa_id', agenciaId).maybeSingle();
    if (clave?.clave) {
      await db.from('siguelo_ia_clave').insert({ empresa_id: empresa.id, clave: clave.clave });
      await db.from('siguelo_ia').insert({ empresa_id: empresa.id, clave_final: clave.clave.slice(-4) });
      olvidarCache();
    }
  }
  olvidarBloqueos();
  await registrar(agenciaId, null, 'agencia', `Agencia: se creó la cuenta "${nombre}" (usuario ${usuarioDe(correo)})${d.propia ? ', tuya' : vence ? `, hasta el ${dd(vence)}` : ''}.`);
  return { ok: true, empresa_id: empresa.id, usuario: usuarioDe(correo) };
}

async function cuentaDe(agenciaId: string, empresaId: string): Promise<CuentaRow | null> {
  const { data } = await db.from('siguelo_cuentas').select('*').eq('empresa_id', empresaId).eq('agencia_id', agenciaId).maybeSingle();
  return data;
}

export type CambiosCuenta = { nombre?: string; contacto?: string; telefono?: string; notas?: string; vence_en?: string | null; pausada?: boolean; plan_id?: string | null; password?: string; max_numeros?: number | null; max_negocios?: number | null };

export async function actualizarCuenta(agenciaId: string, empresaId: string, b: CambiosCuenta): Promise<Resultado<object>> {
  const cuenta = await cuentaDe(agenciaId, empresaId);
  if (!cuenta) return { ok: false, mensaje: 'Esa cuenta no es de tu agencia.' };
  const cambios: Partial<CuentaRow> = { actualizado_en: new Date().toISOString() };
  if (typeof b.nombre === 'string' && b.nombre.trim()) cambios.nombre = texto(b.nombre, 120);
  if (typeof b.contacto === 'string') cambios.contacto = texto(b.contacto, 80) || null;
  if (typeof b.telefono === 'string') cambios.telefono = telefonoDe(b.telefono);
  for (const k of ['max_numeros', 'max_negocios'] as const) {
    if (b[k] === undefined) continue;
    const n = limite(b[k], null);
    if (n === false) return { ok: false, mensaje: 'Revisa los límites de números y negocios.' };
    cambios[k] = n;
  }
  if (typeof b.notas === 'string') cambios.notas = texto(b.notas, 1000) || null;
  if (b.vence_en !== undefined) cambios.vence_en = b.vence_en === null ? null : fechaValida(b.vence_en);
  if (typeof b.pausada === 'boolean') cambios.pausada = b.pausada;
  if (b.plan_id !== undefined) {
    if (b.plan_id) {
      const { data: plan } = await db.from('siguelo_planes').select('id').eq('id', b.plan_id).eq('empresa_id', agenciaId).maybeSingle();
      if (!plan) return { ok: false, mensaje: 'Ese plan no existe.' };
    }
    cambios.plan_id = b.plan_id || null;
  }
  if (b.password !== undefined) {
    if (String(b.password).length < 6) return { ok: false, mensaje: 'La contraseña necesita al menos 6 caracteres.' };
    if (!cuenta.usuario_id) return { ok: false, mensaje: 'Esa cuenta no tiene usuario principal.' };
    const { error } = await db.auth.admin.updateUserById(cuenta.usuario_id, { password: String(b.password) });
    if (error) return { ok: false, mensaje: `No se pudo cambiar la contraseña: ${error.message}` };
  }
  const { error } = await db.from('siguelo_cuentas').update(cambios).eq('empresa_id', empresaId);
  if (error) return { ok: false, mensaje: error.message };
  // El nombre de la cuenta también es el de su empresa.
  if (cambios.nombre) await db.from('empresas').update({ nombre: cambios.nombre }).eq('id', empresaId);
  olvidarBloqueos();
  olvidarCache();
  return { ok: true };
}

// ---------- Planes ----------
export type DatosPlan = { nombre?: string; precio?: number; moneda?: string; duracion_dias?: number; incluye?: string[]; con_crm?: boolean; activo?: boolean; max_numeros?: number | null; max_negocios?: number | null; usar_mi_clave?: boolean };

function revisarPlan(b: DatosPlan, nuevo: boolean): Resultado<{ plan: Partial<PlanRow> }> {
  const plan: Partial<PlanRow> = {};
  if (b.nombre !== undefined || nuevo) {
    plan.nombre = texto(b.nombre, 80);
    if (!plan.nombre) return { ok: false, mensaje: 'Ponle un nombre al plan.' };
  }
  if (b.precio !== undefined) {
    const p = Number(b.precio);
    if (!Number.isFinite(p) || p < 0) return { ok: false, mensaje: 'El precio no es válido.' };
    plan.precio = Math.round(p * 100) / 100;
  }
  if (b.moneda !== undefined) plan.moneda = texto(b.moneda, 8) || 'Bs';
  if (b.duracion_dias !== undefined) {
    const dias = Math.round(Number(b.duracion_dias));
    if (!Number.isFinite(dias) || dias < 1 || dias > 3660) return { ok: false, mensaje: 'La duración tiene que ser entre 1 y 3660 días.' };
    plan.duracion_dias = dias;
  }
  if (b.incluye !== undefined) plan.incluye = (Array.isArray(b.incluye) ? b.incluye : []).map((x) => texto(x, 200)).filter(Boolean).slice(0, 40);
  if (typeof b.con_crm === 'boolean') plan.con_crm = b.con_crm;
  if (typeof b.activo === 'boolean') plan.activo = b.activo;
  if (typeof b.usar_mi_clave === 'boolean') plan.usar_mi_clave = b.usar_mi_clave;
  for (const k of ['max_numeros', 'max_negocios'] as const) {
    if (b[k] === undefined) continue;
    const n = limite(b[k], null);
    if (n === false) return { ok: false, mensaje: 'Revisa los límites de números y negocios.' };
    plan[k] = n;
  }
  return { ok: true, plan };
}

export async function guardarPlan(agenciaId: string, id: string | null, b: DatosPlan): Promise<Resultado<{ id: string }>> {
  const r = revisarPlan(b, !id);
  if (!r.ok) return r;
  if (!id) {
    const { data, error } = await db.from('siguelo_planes').insert({ ...r.plan, empresa_id: agenciaId }).select('id').single();
    return error || !data ? { ok: false, mensaje: `No se pudo guardar: ${error?.message}. ¿Pegaste la sección 41 de database/siguelo.sql?` } : { ok: true, id: data.id };
  }
  const { data, error } = await db.from('siguelo_planes').update({ ...r.plan, actualizado_en: new Date().toISOString() }).eq('id', id).eq('empresa_id', agenciaId).select('id');
  if (error) return { ok: false, mensaje: error.message };
  return data?.length ? { ok: true, id } : { ok: false, mensaje: 'Ese plan no existe.' };
}

// ---------- Ventas ----------
export type DatosVenta = {
  cliente: string;
  telefono?: string;
  plan_id?: string | null;
  monto?: number;
  fecha?: string;
  notas?: string;
  // Si el plan trae CRM: crear su cuenta o renovar una que ya tiene.
  cuenta?: { modo: 'nueva'; nombre?: string; usuario: string; password: string; usar_mi_clave?: boolean } | { modo: 'renovar'; empresa_id: string } | null;
  // La venta la registró la IA al confirmar un pago: el contacto ya quedó ganado (no se repite).
  contacto_id?: string | null;
  anotar?: boolean;
};

// El cliente queda en el CRM de tu agencia: como contacto, en "Venta ganada", con la oportunidad ganada y una nota.
async function anotarEnTuCRM(agenciaId: string, usuarioId: string | null, cliente: string, telefono: string, producto: string, monto: number, nota: string): Promise<string | null> {
  const tel = numeroPersonal(telefono);
  if (tel.length < 7) return null;
  let { data: contacto } = await db.from('contactos').select('id, etapa_id').eq('empresa_id', agenciaId).eq('telefono', tel).maybeSingle();
  if (!contacto) {
    const { data } = await db.from('contactos').insert({ empresa_id: agenciaId, telefono: tel, nombre: cliente }).select('id, etapa_id').single();
    contacto = data;
  }
  if (!contacto) return null;
  const { data: deEmbudo } = contacto.etapa_id ? await db.from('siguelo_etapa_embudo').select('embudo_id').eq('etapa_id', contacto.etapa_id).maybeSingle() : { data: null };
  const ganada = (await etapasDelEmbudo(agenciaId, deEmbudo?.embudo_id ?? null)).find((e) => e.tipo === 'ganada');
  if (ganada && ganada.id !== contacto.etapa_id) await cambiarEtapa(agenciaId, contacto.id, ganada);
  const ahora = new Date().toISOString();
  await db.from('oportunidades').insert({ empresa_id: agenciaId, contacto_id: contacto.id, producto, monto, probabilidad: 100, estado: 'ganada', cerrada_en: ahora, nota, creado_por: usuarioId });
  await db.from('notas').insert({ contacto_id: contacto.id, autor_id: usuarioId, texto: `💼 ${nota}` });
  return contacto.id;
}

export async function registrarVenta(agenciaId: string, usuarioId: string | null, b: DatosVenta): Promise<Resultado<{ id: string; cuenta: { empresa_id: string; usuario: string; nueva: boolean; vence_en: string | null } | null }>> {
  const cliente = texto(b.cliente, 120);
  if (!cliente) return { ok: false, mensaje: 'Escribe el nombre del cliente.' };
  let plan: PlanRow | null = null;
  if (b.plan_id) {
    const { data } = await db.from('siguelo_planes').select('*').eq('id', b.plan_id).eq('empresa_id', agenciaId).maybeSingle();
    if (!data) return { ok: false, mensaje: 'Ese plan no existe.' };
    plan = data;
  }
  const monto = b.monto === undefined || b.monto === null || (b.monto as unknown) === '' ? Number(plan?.precio ?? 0) : Number(b.monto);
  if (!Number.isFinite(monto) || monto < 0) return { ok: false, mensaje: 'El monto no es válido.' };
  const fecha = fechaValida(b.fecha) ?? new Date().toISOString();
  const dias = plan?.duracion_dias ?? 0;
  let desde: string | null = plan ? fecha : null;
  let hasta: string | null = plan ? new Date(new Date(fecha).getTime() + dias * DIA).toISOString() : null;

  // Si el plan trae el CRM: se crea su cuenta (o se renueva la que tiene).
  let cuenta: { empresa_id: string; usuario: string; nueva: boolean; vence_en: string | null } | null = null;
  if (plan?.con_crm && b.cuenta) {
    if (b.cuenta.modo === 'nueva') {
      const r = await crearCuenta(agenciaId, {
        nombre: texto(b.cuenta.nombre, 120) || cliente,
        contacto: cliente,
        telefono: b.telefono,
        usuario: b.cuenta.usuario,
        password: b.cuenta.password,
        vence_en: hasta,
        plan_id: plan.id,
        usar_mi_clave: b.cuenta.usar_mi_clave,
        max_numeros: plan.max_numeros ?? null,
        max_negocios: plan.max_negocios ?? null,
      });
      if (!r.ok) return r;
      cuenta = { empresa_id: r.empresa_id, usuario: r.usuario, nueva: true, vence_en: hasta };
    } else {
      const actual = await cuentaDe(agenciaId, b.cuenta.empresa_id);
      if (!actual) return { ok: false, mensaje: 'Esa cuenta no es de tu agencia.' };
      // Se suma desde que vence (si todavía no venció) o desde hoy.
      const base = Math.max(new Date(fecha).getTime(), actual.vence_en ? new Date(actual.vence_en).getTime() : 0);
      desde = new Date(base).toISOString();
      hasta = new Date(base + dias * DIA).toISOString();
      // Con el plan nuevo, sus límites (si el nuevo permite más).
      const mas = (a: number | null | undefined, b: number | null | undefined) => (a === null || b === null || a === undefined || b === undefined ? null : Math.max(a, b));
      const r = await actualizarCuenta(agenciaId, actual.empresa_id, { vence_en: hasta, pausada: false, plan_id: plan.id, max_numeros: mas(actual.max_numeros, plan.max_numeros), max_negocios: mas(actual.max_negocios, plan.max_negocios) });
      if (!r.ok) return r;
      cuenta = { empresa_id: actual.empresa_id, usuario: usuarioDe(actual.usuario ?? ''), nueva: false, vence_en: hasta };
    }
  }

  const producto = plan?.nombre ?? 'Servicio de la agencia';
  const nota = `Compró "${producto}" por ${plan?.moneda ?? 'Bs'} ${monto}${hasta ? ` (hasta el ${dd(hasta)})` : ''}${b.notas ? `: ${texto(b.notas, 300)}` : ''}`;
  const contactoId =
    b.anotar === false ? b.contacto_id ?? null : b.telefono ? await anotarEnTuCRM(agenciaId, usuarioId, cliente, b.telefono, producto, monto, nota).catch(() => null) : null;
  const { data: venta, error } = await db
    .from('siguelo_ventas')
    .insert({
      empresa_id: agenciaId,
      plan_id: plan?.id ?? null,
      plan_nombre: plan?.nombre ?? null,
      cliente,
      telefono: b.telefono ? numeroPersonal(b.telefono) || null : null,
      monto,
      moneda: plan?.moneda ?? 'Bs',
      fecha,
      desde,
      hasta,
      cuenta_id: cuenta?.empresa_id ?? null,
      contacto_id: contactoId,
      notas: texto(b.notas, 1000) || null,
      creado_por: usuarioId,
    })
    .select('id')
    .single();
  if (error || !venta) return { ok: false, mensaje: `No se pudo guardar la venta: ${error?.message}` };
  await registrar(agenciaId, contactoId, 'agencia', `Agencia: venta a ${cliente} — ${nota}${cuenta ? (cuenta.nueva ? ` · cuenta nueva "${cuenta.usuario}"` : ' · cuenta renovada') : ''}.`);
  return { ok: true, id: venta.id, cuenta };
}

// ---------- Todo lo de la agencia (para la pantalla) ----------
export async function datosAgencia(agenciaId: string) {
  const [planes, cuentas, ventas] = await Promise.all([
    db.from('siguelo_planes').select('*').eq('empresa_id', agenciaId).order('creado_en'),
    db.from('siguelo_cuentas').select('*').eq('agencia_id', agenciaId).order('creado_en', { ascending: false }),
    db.from('siguelo_ventas').select('*').eq('empresa_id', agenciaId).order('fecha', { ascending: false }).limit(500),
  ]);
  const error = planes.error || cuentas.error || ventas.error;
  if (error) return { ok: false as const, mensaje: `${error.message}. ¿Pegaste la sección 41 de database/siguelo.sql en Supabase?` };
  // Cuántos números conectó cada cuenta (para ver que esté todo bien).
  const ids = (cuentas.data || []).map((c) => c.empresa_id);
  const { data: lineas } = ids.length ? await db.from('lineas_whatsapp').select('empresa_id, estado').in('empresa_id', ids) : { data: [] };
  const ahora = Date.now();
  return {
    ok: true as const,
    planes: planes.data || [],
    ventas: ventas.data || [],
    cuentas: (cuentas.data || []).map((c) => ({
      ...c,
      usuario: c.usuario ? usuarioDe(c.usuario) : null,
      estado: c.pausada ? 'pausada' : c.vence_en && new Date(c.vence_en).getTime() <= ahora ? 'vencida' : 'activa',
      numeros: (lineas || []).filter((l) => l.empresa_id === c.empresa_id).length,
      conectados: (lineas || []).filter((l) => l.empresa_id === c.empresa_id && l.estado === 'activo').length,
    })),
  };
}

// ---------- La IA vende: el cliente pagó un plan (comprobante confirmado) ----------

// La cuenta de este cliente (por su WhatsApp), si ya tiene una.
export async function cuentaPorTelefono(agenciaId: string, telefono: string): Promise<CuentaRow | null> {
  const tel = numeroPersonal(telefono.split('@')[0]);
  if (tel.length < 7) return null;
  const { data } = await db.from('siguelo_cuentas').select('*').eq('agencia_id', agenciaId).eq('propia', false).eq('telefono', tel).order('creado_en', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

// Contraseña fácil de dictar (sin 0/O ni 1/l).
export function contrasenaNueva(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const azar = (x: string) => x[randomInt(x.length)];
  return Array.from({ length: 5 }, () => azar(letras)).join('') + Array.from({ length: 3 }, () => azar(numeros)).join('');
}
const sugerido = (nombre: string) =>
  nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 18) || 'cliente';

export type VentaAutomatica = Resultado<{ venta_id: string; plan: PlanRow; cuenta: { empresa_id: string; usuario: string; nueva: boolean; vence_en: string | null; contrasena: string | null } | null }>;

// Registra la venta del plan y, si trae el CRM, crea su acceso (o renueva el que tiene).
export async function ventaPorPago(agenciaId: string, d: { plan_id: string; cliente: string; negocio: string | null; telefono: string; monto: number; contacto_id: string | null; nota: string }): Promise<VentaAutomatica> {
  const { data: plan } = await db.from('siguelo_planes').select('*').eq('id', d.plan_id).eq('empresa_id', agenciaId).maybeSingle();
  if (!plan) return { ok: false, mensaje: 'El plan de este curso ya no existe (Agencia → Planes).' };
  const base: DatosVenta = { cliente: d.cliente, telefono: d.telefono, plan_id: plan.id, monto: d.monto, notas: d.nota, contacto_id: d.contacto_id, anotar: false };
  if (!plan.con_crm) {
    const r = await registrarVenta(agenciaId, null, base);
    return r.ok ? { ok: true, venta_id: r.id, plan, cuenta: null } : r;
  }
  const actual = await cuentaPorTelefono(agenciaId, d.telefono);
  if (actual) {
    const r = await registrarVenta(agenciaId, null, { ...base, cuenta: { modo: 'renovar', empresa_id: actual.empresa_id } });
    return r.ok ? { ok: true, venta_id: r.id, plan, cuenta: r.cuenta ? { ...r.cuenta, contrasena: null } : null } : r;
  }
  // Cuenta nueva: un usuario libre a partir del nombre del negocio (consultoriopaz, consultoriopaz2…).
  const contrasena = contrasenaNueva();
  const raiz = sugerido(d.negocio || d.cliente);
  let ultimo: VentaAutomatica = { ok: false, mensaje: 'No se pudo crear el acceso.' };
  for (let i = 0; i < 6; i++) {
    const usuario = i === 0 ? raiz : `${raiz}${i + 1}`;
    const r = await registrarVenta(agenciaId, null, { ...base, cuenta: { modo: 'nueva', nombre: d.negocio || d.cliente, usuario, password: contrasena, usar_mi_clave: plan.usar_mi_clave !== false } });
    if (r.ok) return { ok: true, venta_id: r.id, plan, cuenta: r.cuenta ? { ...r.cuenta, contrasena } : null };
    ultimo = r;
    if (!/Ya existe alguien con el usuario/.test(r.mensaje)) break;
  }
  return ultimo;
}
