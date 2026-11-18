import { db } from '../db.js';

// Cuentas en pausa o vencidas (sección 41 de siguelo.sql): nadie de esa cuenta entra y su IA,
// seguimiento y masivos se detienen. No se borra nada; al renovar sigue todo como estaba.

const VALIDO_MS = 2 * 60_000;
let cache = { leido: 0, bloqueadas: new Set<string>() };

export async function cuentasBloqueadas(): Promise<Set<string>> {
  if (Date.now() - cache.leido < VALIDO_MS) return cache.bloqueadas;
  const { data, error } = await db.from('siguelo_cuentas').select('empresa_id, pausada, vence_en');
  // Sin la sección 41 pegada: ninguna.
  const ahora = Date.now();
  const bloqueadas = new Set(
    error ? [] : (data || []).filter((c) => c.pausada || (c.vence_en && new Date(c.vence_en).getTime() <= ahora)).map((c) => c.empresa_id as string),
  );
  cache = { leido: Date.now(), bloqueadas };
  return bloqueadas;
}

export async function estaBloqueada(empresaId: string): Promise<boolean> {
  return (await cuentasBloqueadas()).has(empresaId);
}

// Después de pausar, renovar o crear una cuenta.
export function olvidarBloqueos(): void {
  cache.leido = 0;
}
