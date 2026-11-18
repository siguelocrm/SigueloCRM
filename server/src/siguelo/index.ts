import { db } from './db.js';
import { procesarCola } from './cola.js';
import { revisarEmpresa } from './motor.js';
import { limpiarRegistroViejo } from './registro.js';
import { configDeEmpresa, empresasConIA } from './ia/config.js';
import { leerPendientes, responderConversacion } from './ia/lector.js';
import { procesarSalida } from './ia/salida.js';
import { revisarPagos } from './pagos/inscripcion.js';
import { revisarRedes } from './redes/redes.js';
import type { AjustesRow } from './tipos.js';
import { cuentasBloqueadas } from './agencia/bloqueo.js';
import { desactivarVencidos } from './usuarios/accesos.js';
import { alDespertarMasivos, procesarMasivos, reanudarAlArrancar } from './masivos/masivos.js';
import { alLlegarMensaje } from './eventos.js';

// Seguimiento automático por etapa (SígueloCRM). Se prende desde la pantalla
// "Seguimiento"; mientras esté apagado no hace nada. Necesita las tablas de
// database/siguelo.sql.

// Cada cuánto se revisa sin que pase nada. Lo urgente (un mensaje que llega, una respuesta de la IA)
// se hace al momento por eventos; estas vueltas son de respaldo. Antes eran cada 5 a 10 segundos y
// superaban los límites del plan gratis de Supabase (registros y datos transferidos).
const MOTOR_CADA_MS = 3 * 60_000;
const COLA_CADA_MS = 30_000;
const AJUSTES_VALIDOS_MS = 60_000;
const LECTOR_RESPALDO_MS = 2 * 60_000;
const SALIDA_CADA_MS = 20_000;
const PAGOS_CADA_MS = 60_000;
const PAGOS_TODOS_MS = 10 * 60_000;
const REDES_CADA_MS = 3 * 60_000;

// El motor y la cola nunca corren a la vez: así la cola no envía algo que el
// motor está por cancelar, y el motor ve siempre los envíos ya anotados.
let ocupado = false;
async function conCandado(tarea: () => Promise<void>): Promise<void> {
  if (ocupado) return;
  ocupado = true;
  try {
    await tarea();
  } catch (err) {
    console.error('Error en el seguimiento automático:', (err as Error).message);
  } finally {
    ocupado = false;
  }
}

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

async function vueltaDelMotor(): Promise<void> {
  const bloqueadas = await cuentasBloqueadas();
  for (const aj of await ajustesActivos(true)) if (!bloqueadas.has(aj.empresa_id)) await revisarEmpresa(aj);
  await limpiarRegistroViejo();
  // Lo que el motor dejó en la cola sale sin esperar la próxima vuelta.
  await vueltaDeLaCola();
}

async function vueltaDeLaCola(): Promise<void> {
  const bloqueadas = await cuentasBloqueadas();
  for (const aj of await ajustesActivos()) if (!bloqueadas.has(aj.empresa_id)) await procesarCola(aj);
}

// La IA (Fase 3) lleva sus propios candados: una lectura puede tardar varios
// segundos (espera a OpenAI) y no debe frenar al seguimiento ni a sus envíos.
function candado(nombre: string): (tarea: () => Promise<void>) => Promise<void> {
  let enUso = false;
  return async (tarea) => {
    if (enUso) return;
    enUso = true;
    try {
      await tarea();
    } catch (err) {
      console.error(`Error en ${nombre}:`, (err as Error).message);
    } finally {
      enUso = false;
    }
  };
}
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
  setInterval(() => conCandado(vueltaDeLaCola), COLA_CADA_MS);
}
