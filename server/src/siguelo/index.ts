import { db } from './db.js';
import { procesarCola } from './cola.js';
import { revisarEmpresa } from './motor.js';
import { limpiarRegistroViejo } from './registro.js';
import { empresasConIA } from './ia/config.js';
import { leerPendientes } from './ia/lector.js';
import { procesarSalida } from './ia/salida.js';
import { revisarPagos } from './pagos/inscripcion.js';
import type { AjustesRow } from './tipos.js';
import { desactivarVencidos } from './usuarios/accesos.js';

// Seguimiento automático por etapa (SígueloCRM). Se prende desde la pantalla
// "Seguimiento"; mientras esté apagado no hace nada. Necesita las tablas de
// database/siguelo.sql.

const MOTOR_CADA_MS = 60_000;
const COLA_CADA_MS = 5_000;
const AJUSTES_VALIDOS_MS = 20_000;

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
  for (const aj of await ajustesActivos(true)) await revisarEmpresa(aj);
  await limpiarRegistroViejo();
}

async function vueltaDeLaCola(): Promise<void> {
  for (const aj of await ajustesActivos()) await procesarCola(aj);
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

export function iniciarIA(): void {
  db.from('siguelo_ia_salida')
    .update({ estado: 'pendiente' })
    .eq('estado', 'enviando')
    .then(() => undefined, () => undefined);
  setInterval(() => conCandadoLector(async () => {
    for (const c of await empresasConIA()) await leerPendientes(c);
  }), 10_000);
  setInterval(() => conCandadoSalida(async () => {
    for (const c of await empresasConIA()) await procesarSalida(c);
  }), 5_000);
  // Fase 5: comprobantes de pago e inscripciones.
  setInterval(() => conCandadoPagos(async () => {
    for (const c of await empresasConIA()) await revisarPagos(c);
  }), 10_000);
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

  setTimeout(() => conCandado(vueltaDelMotor), 10_000);
  setInterval(() => conCandado(vueltaDelMotor), MOTOR_CADA_MS);
  setInterval(() => conCandado(vueltaDeLaCola), COLA_CADA_MS);
}
