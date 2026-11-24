import { db } from './db.js';
import { procesarCola } from './cola.js';
import { revisarEmpresa } from './motor.js';
import { limpiarRegistroViejo } from './registro.js';
import { configDeEmpresa, empresasConIA } from './ia/config.js';
import { leerFilas, leerPendientes, pendientesPorLeer, responderConversacion } from './ia/lector.js';
import { procesarSalida } from './ia/salida.js';
import { chatsSinRespuesta, type ChatSinRespuesta } from './ia/alDia.js';
import { revisarPagos } from './pagos/inscripcion.js';
import { revisarRedes } from './redes/redes.js';
import type { AjustesRow } from './tipos.js';
import { candadoConVigia, candadosPorClave, conCandadoEsperando } from './candados.js';
import { cuentasBloqueadas } from './agencia/bloqueo.js';
import { enFranja } from './horario.js';
import { desactivarVencidos } from './usuarios/accesos.js';
import { alDespertarMasivos, procesarMasivos, reanudarAlArrancar } from './masivos/masivos.js';
import { alLlegarMensaje } from './eventos.js';

// Seguimiento automático por etapa (SígueloCRM). Se prende desde la pantalla
// "Seguimiento"; mientras esté apagado no hace nada. Necesita las tablas de
// database/siguelo.sql.

// Cada cuánto se revisa sin que pase nada. Lo urgente (un mensaje que llega, una respuesta de la IA)
// se hace al momento por eventos; estas vueltas son de respaldo. Antes eran cada 5 a 10 segundos y
// superaban los límites del plan gratis de Supabase (registros y datos transferidos).
// El seguimiento: cada minuto dentro del horario de envío (o de las citas); fuera, cada 5 minutos.
const MOTOR_CADA_MS = 60_000;
const MOTOR_FUERA_DE_HORARIO_MS = 5 * 60_000;
const COLA_CADA_MS = 20_000;
// Con mensajes esperando, la cola vuelve apenas un número termina su pausa (nunca antes de 3 s).
const COLA_MINIMO_MS = 3_000;
const AJUSTES_VALIDOS_MS = 60_000;
const LECTOR_RESPALDO_MS = 2 * 60_000;
const SALIDA_CADA_MS = 20_000;
const PAGOS_CADA_MS = 60_000;
const PAGOS_TODOS_MS = 10 * 60_000;
const REDES_CADA_MS = 3 * 60_000;

// El motor y la cola nunca corren a la vez: así la cola no envía algo que el
// motor está por cancelar, y el motor ve siempre los envíos ya anotados.
const conCandado = candadoConVigia('el seguimiento automático');

let cache: { leido: number; ajustes: AjustesRow[] } = { leido: 0, ajustes: [] };
let avisoFaltaSql = false;

async function ajustesActivos(forzar = false): Promise<AjustesRow[]> {
  if (!forzar && Date.now() - cache.leido < AJUSTES_VALIDOS_MS) return cache.ajustes;
  const { data, error } = await db.from('siguelo_ajustes').select('*').eq('activo', true);
  if (error) {
    if (!avisoFaltaSql) {
      avisoFaltaSql = true;
      console.log('ℹ️  Seguimiento automático apagado: falta pegar database/siguelo.sql en Supabase (SQL Editor → Run).');
    }
    cache = { leido: Date.now(), ajustes: [] };
    return [];
  }
  avisoFaltaSql = false;
  const ajustes = data || [];
  // Si se activó sin fecha (por ejemplo, a mano en Supabase), cuenta desde ahora.
  for (const aj of ajustes) {
    if (!aj.activado_en) {
      aj.activado_en = new Date().toISOString();
      await db.from('siguelo_ajustes').update({ activado_en: aj.activado_en }).eq('empresa_id', aj.empresa_id);
    }
  }
  cache = { leido: Date.now(), ajustes };
  return ajustes;
}

const ultimaVueltaMotor = new Map<string, number>();
async function vueltaDelMotor(): Promise<void> {
  const bloqueadas = await cuentasBloqueadas();
  const ahora = Date.now();
  for (const aj of await ajustesActivos(true)) {
    if (bloqueadas.has(aj.empresa_id)) continue;
    const enHorario =
      enFranja(ahora, { zona: aj.zona_horaria, desde: aj.hora_inicio, hasta: aj.hora_fin }) ||
      enFranja(ahora, { zona: aj.zona_horaria, desde: aj.citas?.desde || '07:00', hasta: aj.citas?.hasta || '21:00' });
    if (!enHorario && ahora - (ultimaVueltaMotor.get(aj.empresa_id) ?? 0) < MOTOR_FUERA_DE_HORARIO_MS - 5_000) continue;
    ultimaVueltaMotor.set(aj.empresa_id, ahora);
    await revisarEmpresa(aj);
  }
  await limpiarRegistroViejo();
  // Lo que el motor dejó en la cola sale sin esperar la próxima vuelta.
  await vueltaDeLaCola();
}

// Devuelve en cuántos ms conviene la próxima vuelta (cuando el primer número con pendientes termine su pausa).
async function vueltaDeLaCola(): Promise<number> {
  const bloqueadas = await cuentasBloqueadas();
  let proxima = COLA_CADA_MS;
  for (const aj of await ajustesActivos()) {
    if (bloqueadas.has(aj.empresa_id)) continue;
    const t = await procesarCola(aj);
    if (t !== null) proxima = Math.min(proxima, t);
  }
  return Math.max(COLA_MINIMO_MS, proxima);
}

// La IA (Fase 3) lleva sus propios candados: una lectura puede tardar varios
// segundos (espera a OpenAI) y no debe frenar al seguimiento ni a sus envíos.
const candado = (nombre: string) => candadoConVigia(nombre);
// La lectura de la IA: un candado por número (cada número lee su chat a la vez que los demás).
const lectorDe = candadosPorClave('la lectura de la IA');
const conCandadoSalida = candado('los envíos de la IA');
const conCandadoRespaldoIA = candado('la vuelta de respaldo de la IA');
const conCandadoPagos = candado('los pagos');
const conCandadoRedes = candado('las redes sociales');
const conCandadoMasivos = candado('los mensajes masivos');

// Una sola consulta para todas las cuentas: ¿quién tiene algo por salir? Solo esas se procesan.
async function vueltaDeSalida(): Promise<void> {
  const { data } = await db.from('siguelo_ia_salida').select('empresa_id').eq('estado', 'pendiente').lte('vence', new Date().toISOString()).limit(200);
  const conAlgo = new Set((data || []).map((x) => x.empresa_id));
  if (!conAlgo.size) return;
  for (const c of await empresasConIA()) if (conAlgo.has(c.ia.empresa_id)) await procesarSalida(c);
}

// Pagos: cada minuto, solo las cuentas con algo en curso (lo que confirmaste o rechazaste, comprobantes
// por leer de nuevo, datos que esperan, reservas del club); todas, cada 10 minutos (respaldo).
let pagosTodos = 0;
async function vueltaDePagos(): Promise<void> {
  const todas = Date.now() - pagosTodos >= PAGOS_TODOS_MS;
  let conAlgo: Set<string> | null = null;
  if (!todas) {
    const { data, error } = await db.from('siguelo_pagos').select('empresa_id').or('accion.not.is.null,estado.in.(leyendo,datos,reservado)').limit(300);
    if (error) return;
    conAlgo = new Set((data || []).map((x) => x.empresa_id));
    if (!conAlgo.size) return;
  } else pagosTodos = Date.now();
  for (const c of await empresasConIA()) if (!conAlgo || conAlgo.has(c.ia.empresa_id)) await revisarPagos(c);
}

// Respuesta rápida: cuando llega un mensaje de un cliente, la IA lo lee apenas
// el cliente deja de escribir (2 s sin mensajes nuevos en ese número) y lo que
// decide sale enseguida, sin esperar la próxima vuelta. Las vueltas de cada
// 10 s y 5 s siguen como respaldo. Usa los mismos candados (espera si están ocupados).
const QUIETO_RAPIDO_MS = 2_000;
const esperando = new Map<string, NodeJS.Timeout>();
const lineaEmpresa = new Map<string, string>();
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Respuestas rápidas en curso, por número: "ponerse al día" de ese número les cede el paso (lo nuevo primero).
const rapidosEnCurso = new Map<string, number>();
async function responderRapido(lineaId: string): Promise<void> {
  rapidosEnCurso.set(lineaId, (rapidosEnCurso.get(lineaId) ?? 0) + 1);
  try {
    await responderRapidoSinContar(lineaId);
  } finally {
    rapidosEnCurso.set(lineaId, (rapidosEnCurso.get(lineaId) ?? 1) - 1);
  }
}
async function responderRapidoSinContar(lineaId: string): Promise<void> {
  if (!lineaEmpresa.has(lineaId)) {
    const { data } = await db.from('lineas_whatsapp').select('empresa_id').eq('id', lineaId).maybeSingle();
    if (!data) return;
    lineaEmpresa.set(lineaId, data.empresa_id);
  }
  const c = (await empresasConIA()).find((x) => x.ia.empresa_id === lineaEmpresa.get(lineaId));
  if (!c) return;
  // Lee los chats nuevos de ESTE número. Espera hasta 30 s si ese número ya está leyendo otro chat.
  await conCandadoEsperando(lectorDe(lineaId), () => leerPendientes(c, 5, 1, lineaId), 120);
  // Lo que quedó listo para salir ahora (texto, y después ubicación o respuestas rápidas) sale en seguida.
  for (let i = 0; i < 4; i++) {
    await conCandadoEsperando(conCandadoSalida, () => procesarSalida(c));
    await dormir(i === 0 ? 800 : 1_500);
  }
  // Si era un comprobante o los datos de una inscripción, los pagos lo ven ahora.
  await conCandadoEsperando(conCandadoPagos, () => revisarPagos(c));
}
// El botón "Responder con IA" de la bandeja: lee ese chat ahora (con el mismo candado, así no
// responde dos veces) y lo que decidió sale en seguida.
export async function responderAhora(empresaId: string, conversacionId: string): Promise<{ ok: boolean; mensaje: string }> {
  const c = await configDeEmpresa(empresaId);
  if (!c) return { ok: false, mensaje: 'Falta la clave de OpenAI (IA → Ajustes).' };
  const { data: cv } = await db.from('conversaciones').select('linea_id').eq('id', conversacionId).maybeSingle();
  if (!cv) return { ok: false, mensaje: 'No se encontró esa conversación.' };
  let r: { ok: boolean; mensaje: string } = { ok: false, mensaje: 'La IA sigue ocupada con otros chats de este número: inténtalo de nuevo en un minuto.' };
  // Espera su turno en ese número hasta 1 minuto (antes se rendía a los 10 s).
  await conCandadoEsperando(lectorDe(cv.linea_id), async () => {
    r = await responderConversacion(c, conversacionId);
  }, 240);
  if (r.ok) {
    for (let i = 0; i < 6; i++) {
      await conCandadoEsperando(conCandadoSalida, () => procesarSalida(c));
      await dormir(i === 0 ? 600 : 1_200);
    }
  }
  return r;
}
// "Ponerse al día" (IA → arriba): responde despacio los chats que quedaron sin respuesta
// (ia/alDia.ts). Cada número tiene su propia fila y van a la vez: así uno con muchos pendientes no
// deja a los demás para el final. En cada número, entre chat y chat espera de 45 a 90 s, para que
// WhatsApp no lo vea como envío masivo (sobre todo si el número acaba de estar restringido).
export type ProgresoAlDia = { linea_id: string; numero: string; total: number; hechos: number; respondidos: number; activo: boolean; ultimo: string };
const alDia = new Map<string, Map<string, ProgresoAlDia>>();
export const PAUSA_AL_DIA_MS = { min: 45_000, max: 90_000 };
export const progresoAlDia = (empresaId: string): ProgresoAlDia[] => [...(alDia.get(empresaId)?.values() ?? [])];
export function detenerAlDia(empresaId: string, lineaId: string | null = null): void {
  for (const st of alDia.get(empresaId)?.values() ?? []) if (!lineaId || st.linea_id === lineaId) st.activo = false;
}

async function responderFila(c: NonNullable<Awaited<ReturnType<typeof configDeEmpresa>>>, st: ProgresoAlDia, chats: ChatSinRespuesta[]): Promise<void> {
  for (const ch of chats) {
    if (!st.activo) break;
    // Lo nuevo primero: si alguien acaba de escribir a ESTE número, se espera a que la IA le responda (hasta 1 min).
    for (let i = 0; i < 60 && st.activo && (esperando.has(st.linea_id) || (rapidosEnCurso.get(st.linea_id) ?? 0) > 0); i++) await dormir(1_000);
    let r: { ok: boolean; mensaje: string } | null = null;
    // Espera su turno con la lectura normal de la IA (así no responde dos veces el mismo chat).
    for (let i = 0; i < 20 && !r && st.activo; i++) {
      await conCandadoEsperando(lectorDe(st.linea_id), async () => {
        r = await responderConversacion(c, ch.conversacion_id, true);
      });
      if (!r) await dormir(5_000);
    }
    const hecho: { ok: boolean; mensaje: string } = r ?? { ok: false, mensaje: 'la IA estaba ocupada' };
    st.hechos++;
    if (/^(respondiendo|respuesta lista)/.test(hecho.mensaje)) st.respondidos++;
    st.ultimo = `${ch.nombre || `+${ch.telefono.split('@')[0]}`}: ${hecho.mensaje}`;
    if (st.hechos < chats.length && st.activo) await dormir(PAUSA_AL_DIA_MS.min + Math.random() * (PAUSA_AL_DIA_MS.max - PAUSA_AL_DIA_MS.min));
  }
  st.activo = false;
}

export async function ponerseAlDia(empresaId: string, lineaId: string | null): Promise<{ ok: boolean; mensaje: string }> {
  const c = await configDeEmpresa(empresaId);
  if (!c) return { ok: false, mensaje: 'Falta la clave de OpenAI (IA → Ajustes).' };
  const filas = alDia.get(empresaId) ?? new Map<string, ProgresoAlDia>();
  alDia.set(empresaId, filas);
  const chats = await chatsSinRespuesta(empresaId, lineaId);
  const porLinea = new Map<string, ChatSinRespuesta[]>();
  for (const ch of chats) porLinea.set(ch.linea_id, [...(porLinea.get(ch.linea_id) ?? []), ch]);
  // Los números que ya están respondiendo siguen con lo suyo.
  for (const id of [...porLinea.keys()]) if (filas.get(id)?.activo) porLinea.delete(id);
  if (!porLinea.size) return { ok: !chats.length, mensaje: chats.length ? 'Ese número ya está respondiendo sus chats pendientes.' : 'No hay chats esperando respuesta.' };
  const { data: lineas } = await db.from('lineas_whatsapp').select('id, nombre').in('id', [...porLinea.keys()]);
  const nombre = new Map((lineas || []).map((l) => [l.id, l.nombre] as const));
  let total = 0;
  for (const [id, lista] of porLinea) {
    const st: ProgresoAlDia = { linea_id: id, numero: nombre.get(id) ?? 'Número', total: lista.length, hechos: 0, respondidos: 0, activo: true, ultimo: '' };
    filas.set(id, st);
    total += lista.length;
    responderFila(c, st, lista).catch((err) => {
      st.activo = false;
      console.error('IA: falló "ponerse al día":', (err as Error).message);
    });
  }
  const n = porLinea.size;
  return { ok: true, mensaje: `Respondiendo ${total} ${total === 1 ? 'chat' : 'chats'}${n > 1 ? ` en ${n} números a la vez` : ''}, uno por uno en cada número.` };
}

alLlegarMensaje((lineaId) => {
  clearTimeout(esperando.get(lineaId));
  esperando.set(
    lineaId,
    setTimeout(() => {
      esperando.delete(lineaId);
      responderRapido(lineaId).catch((err) => console.error('Error en la respuesta rápida de la IA:', (err as Error).message));
    }, QUIETO_RAPIDO_MS),
  );
});


export function iniciarIA(): void {
  db.from('siguelo_ia_salida')
    .update({ estado: 'pendiente' })
    .eq('estado', 'enviando')
    .then(() => undefined, () => undefined);
  // Respaldo: lo que la lectura al momento no alcanzó (reintentos, el servidor recién prendido).
  // Cada número lee lo suyo a la vez que los demás. Se pide número por número: la lista de todo el
  // CRM trae solo los 20 más viejos, y un número con muchos pendientes dejaba a los demás afuera.
  setInterval(() => conCandadoRespaldoIA(async () => {
    for (const c of await empresasConIA()) {
      const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', c.ia.empresa_id);
      await Promise.all((lineas || []).map((l) => lectorDe(l.id)(async () => leerFilas(c, await pendientesPorLeer(c, undefined, l.id)))));
    }
  }), LECTOR_RESPALDO_MS);
  setInterval(() => conCandadoSalida(vueltaDeSalida), SALIDA_CADA_MS);
  // Fase 5: comprobantes de pago e inscripciones (y al llegar cada mensaje, en responderRapido).
  setInterval(() => conCandadoPagos(vueltaDePagos), PAGOS_CADA_MS);
  // Comentarios de Facebook e Instagram (cada cuenta se revisa cada 3 minutos).
  setInterval(() => conCandadoRedes(async () => {
    for (const c of await empresasConIA()) await revisarRedes(c);
  }), REDES_CADA_MS);
}

export function iniciarSeguimiento(): void {
  iniciarIA();
  // Los accesos con vencimiento (Usuarios): al vencer, el usuario queda desactivado.
  const vencer = () => desactivarVencidos().catch((err) => console.error('Usuarios: no se pudo revisar los vencimientos:', (err as Error).message));
  setTimeout(vencer, 15_000);
  setInterval(vencer, 10 * 60_000);
  // Un mensaje que quedó "enviando" por un reinicio a mitad de camino vuelve a la cola.
  db.from('siguelo_cola')
    .update({ estado: 'pendiente' })
    .eq('estado', 'enviando')
    .then(() => undefined, () => undefined);

  // Mensajes masivos: no dependen de que el seguimiento esté prendido.
  reanudarAlArrancar().catch(() => undefined);
  // Cada 5 s mientras hay un envío en marcha; si no hay ninguno, cada minuto (o al crear uno).
  const masivos = async () => {
    let activos = false;
    await conCandadoMasivos(async () => {
      activos = await procesarMasivos();
    });
    setTimeout(masivos, activos ? 5_000 : 60_000);
  };
  alDespertarMasivos(() => conCandadoMasivos(async () => void (await procesarMasivos())));
  setTimeout(masivos, 5_000);

  setTimeout(() => conCandado(vueltaDelMotor), 10_000);
  setInterval(() => conCandado(vueltaDelMotor), MOTOR_CADA_MS);
  // La cola se programa sola: rápido mientras hay mensajes que ya tocan, cada 20 s si no.
  const cola = async () => {
    let espera = COLA_MINIMO_MS; // si el motor estaba ocupado, se reintenta pronto
    await conCandado(async () => {
      espera = await vueltaDeLaCola();
    });
    setTimeout(cola, espera);
  };
  setTimeout(cola, 15_000);
}
