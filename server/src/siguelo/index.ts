import { db } from './db.js';
import { procesarCola } from './cola.js';
import { revisarEmpresa } from './motor.js';
import { limpiarRegistroViejo } from './registro.js';
import { configDeEmpresa, empresasConIA } from './ia/config.js';
import { leerPendientes, responderConversacion } from './ia/lector.js';
import { procesarSalida } from './ia/salida.js';
import { chatsSinRespuesta } from './ia/alDia.js';
import { revisarPagos } from './pagos/inscripcion.js';
import { revisarRedes } from './redes/redes.js';
import type { AjustesRow } from './tipos.js';
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
// Un candado que se libera solo si la tarea se traba (por ejemplo, esperando a WhatsApp una
// respuesta que nunca llega): antes quedaba tomado para siempre y no salía nada más (masivos,
// seguimiento) hasta reiniciar el servidor.
const TRABADO_MS = 10 * 60_000;
function candadoConVigia(nombre: string): (tarea: () => Promise<void>) => Promise<void> {
  let desde: number | null = null;
  return async (tarea) => {
    if (desde !== null && Date.now() - desde < TRABADO_MS) return;
    if (desde !== null) console.error(`⚠️ ${nombre} estuvo trabado más de ${TRABADO_MS / 60_000} minutos: se libera y sigue.`);
    const yo = Date.now();
    desde = yo;
    try {
      await tarea();
    } catch (err) {
      console.error(`Error en ${nombre}:`, (err as Error).message);
    } finally {
      if (desde === yo) desde = null;
    }
  };
}
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
const conCandadoLector = candado('la lectura de la IA');
const conCandadoSalida = candado('los envíos de la IA');
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
async function conCandadoEsperando(conCandado: (t: () => Promise<void>) => Promise<void>, tarea: () => Promise<void>): Promise<void> {
  // El candado no corre la tarea si está ocupado: se reintenta unos segundos.
  for (let i = 0; i < 40; i++) {
    let corrio = false;
    await conCandado(async () => {
      corrio = true;
      await tarea();
    });
    if (corrio) return;
    await dormir(250);
  }
}
async function responderRapido(lineaId: string): Promise<void> {
  if (!lineaEmpresa.has(lineaId)) {
    const { data } = await db.from('lineas_whatsapp').select('empresa_id').eq('id', lineaId).maybeSingle();
    if (!data) return;
    lineaEmpresa.set(lineaId, data.empresa_id);
  }
  const c = (await empresasConIA()).find((x) => x.ia.empresa_id === lineaEmpresa.get(lineaId));
  if (!c) return;
  await conCandadoEsperando(conCandadoLector, () => leerPendientes(c, 5, 1));
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
  let r: { ok: boolean; mensaje: string } = { ok: false, mensaje: 'La IA está ocupada leyendo otros chats: inténtalo de nuevo en unos segundos.' };
  await conCandadoEsperando(conCandadoLector, async () => {
    r = await responderConversacion(c, conversacionId);
  });
  if (r.ok) {
    for (let i = 0; i < 6; i++) {
      await conCandadoEsperando(conCandadoSalida, () => procesarSalida(c));
      await dormir(i === 0 ? 600 : 1_200);
    }
  }
  return r;
}
// "Ponerse al día" (IA → Resumen): responde, uno por uno y despacio, los chats que quedaron sin
// respuesta (ia/alDia.ts). Entre chat y chat espera de 45 a 90 s, para que WhatsApp no lo vea como
// envío masivo (sobre todo si el número acaba de estar restringido).
export type ProgresoAlDia = { total: number; hechos: number; respondidos: number; activo: boolean; numero: string | null; ultimo: string };
const alDia = new Map<string, ProgresoAlDia>();
export const PAUSA_AL_DIA_MS = { min: 45_000, max: 90_000 };
export const progresoAlDia = (empresaId: string): ProgresoAlDia | null => alDia.get(empresaId) ?? null;
export function detenerAlDia(empresaId: string): void {
  const st = alDia.get(empresaId);
  if (st) st.activo = false;
}
export async function ponerseAlDia(empresaId: string, lineaId: string | null, numero: string | null): Promise<{ ok: boolean; mensaje: string }> {
  if (alDia.get(empresaId)?.activo) return { ok: false, mensaje: 'Ya está respondiendo los chats pendientes.' };
  const c = await configDeEmpresa(empresaId);
  if (!c) return { ok: false, mensaje: 'Falta la clave de OpenAI (IA → Ajustes).' };
  const chats = await chatsSinRespuesta(empresaId, lineaId);
  if (!chats.length) return { ok: true, mensaje: 'No hay chats esperando respuesta.' };
  const st: ProgresoAlDia = { total: chats.length, hechos: 0, respondidos: 0, activo: true, numero, ultimo: '' };
  alDia.set(empresaId, st);
  (async () => {
    for (const ch of chats) {
      if (!st.activo) break;
      let r: { ok: boolean; mensaje: string } | null = null;
      // Espera su turno con la lectura normal de la IA (así no responde dos veces el mismo chat).
      for (let i = 0; i < 20 && !r && st.activo; i++) {
        await conCandadoEsperando(conCandadoLector, async () => {
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
  })().catch((err) => {
    st.activo = false;
    console.error('IA: falló "ponerse al día":', (err as Error).message);
  });
  return { ok: true, mensaje: `Respondiendo ${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}, uno por uno.` };
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
  setInterval(() => conCandadoLector(async () => {
    for (const c of await empresasConIA()) await leerPendientes(c);
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
