import { db } from './db.js';
import { procesarCola } from './cola.js';
import { revisarEmpresa } from './motor.js';
import { limpiarRegistroViejo } from './registro.js';
import type { AjustesRow } from './tipos.js';

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

export function iniciarSeguimiento(): void {
  // Un mensaje que quedó "enviando" por un reinicio a mitad de camino vuelve a la cola.
  db.from('siguelo_cola')
    .update({ estado: 'pendiente' })
    .eq('estado', 'enviando')
    .then(() => undefined, () => undefined);

  setTimeout(() => conCandado(vueltaDelMotor), 10_000);
  setInterval(() => conCandado(vueltaDelMotor), MOTOR_CADA_MS);
  setInterval(() => conCandado(vueltaDeLaCola), COLA_CADA_MS);
}
