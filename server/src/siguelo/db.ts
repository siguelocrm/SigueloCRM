import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import type { SigueloDatabase } from './tipos.js';

// Mismo Supabase que el resto del servidor (clave secreta), pero con los tipos
// de las tablas siguelo_*, que no están en types/dominio.ts.
export const db = createClient<SigueloDatabase>(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false },
});

type Pedido<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Trae todas las filas de a 1000: Supabase devuelve como mucho 1000 por pedido y el resto se
// pierde sin avisar. La consulta tiene que llevar un .order() para que las páginas no se mezclen.
export async function todas<T>(pedir: (desde: number, hasta: number) => Pedido<T>, tope = 50_000): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await pedir(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
    if (!data || data.length < 1000 || filas.length >= tope) return filas;
  }
}

// Una consulta por cada grupo de ids (miles de ids en un .in() no entran en un pedido).
export async function porGrupos<T>(ids: string[], pedir: (grupo: string[]) => Pedido<T>, tam = 200): Promise<T[]> {
  const filas: T[] = [];
  for (let i = 0; i < ids.length; i += tam) {
    const { data, error } = await pedir(ids.slice(i, i + tam));
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
  }
  return filas;
}
