import { db } from '../db.js';
import { fechaDe } from '../horario.js';
import { chatJSON, type MensajeChat, type ResultadoChat } from './openai.js';
import type { IaRow } from '../tipos.js';

// Ajustes de la IA, la clave de OpenAI (solo la lee el servidor) y el freno de
// consultas por día.

const VALIDO_MS = 20_000;
type Config = { ia: IaRow; clave: string; zona: string };
let cache: { leido: number; porEmpresa: Map<string, Config> } = { leido: 0, porEmpresa: new Map() };
let avisoFaltaSql = false;

// Empresas con la IA activa y su clave cargada.
export async function empresasConIA(): Promise<Config[]> {
  if (Date.now() - cache.leido < VALIDO_MS) return [...cache.porEmpresa.values()];
  const [ias, claves, ajustes] = await Promise.all([
    db.from('siguelo_ia').select('*').eq('activa', true),
    db.from('siguelo_ia_clave').select('empresa_id, clave'),
    db.from('siguelo_ajustes').select('empresa_id, zona_horaria'),
  ]);
  if (ias.error) {
    if (!avisoFaltaSql) console.log('ℹ️  IA apagada: falta pegar la parte de la Fase 3 de database/siguelo.sql en Supabase.');
    avisoFaltaSql = true;
    cache = { leido: Date.now(), porEmpresa: new Map() };
    return [];
  }
  avisoFaltaSql = false;
  const clavePor = new Map((claves.data || []).map((c) => [c.empresa_id, c.clave] as const));
  const zonaPor = new Map((ajustes.data || []).map((a) => [a.empresa_id, a.zona_horaria] as const));
  const porEmpresa = new Map<string, Config>();
  for (const ia of ias.data || []) {
    const clave = clavePor.get(ia.empresa_id)?.trim();
    if (clave) porEmpresa.set(ia.empresa_id, { ia, clave, zona: zonaPor.get(ia.empresa_id) || 'America/La_Paz' });
  }
  cache = { leido: Date.now(), porEmpresa };
  return [...porEmpresa.values()];
}

// La IA de una empresa aunque esté apagada (para el asistente): solo hace falta la clave.
export async function configDeEmpresa(empresaId: string): Promise<Config | null> {
  const [{ data: ia }, { data: clave }, { data: ajustes }] = await Promise.all([
    db.from('siguelo_ia').select('*').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_ia_clave').select('clave').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_ajustes').select('zona_horaria').eq('empresa_id', empresaId).maybeSingle(),
  ]);
  if (!ia || !clave?.clave?.trim()) return null;
  return { ia, clave: clave.clave.trim(), zona: ajustes?.zona_horaria || 'America/La_Paz' };
}

export function olvidarCache(): void {
  cache.leido = 0;
}

async function usoDeHoy(empresaId: string, fecha: string) {
  const { data } = await db.from('siguelo_ia_uso').select('consultas, entrada, salida').eq('empresa_id', empresaId).eq('fecha', fecha).maybeSingle();
  return data ?? { consultas: 0, entrada: 0, salida: 0 };
}

// Llama a la IA respetando el máximo de consultas del día y anota el uso.
export async function llamar(c: Pick<Config, 'ia' | 'clave' | 'zona'>, mensajes: MensajeChat[]): Promise<ResultadoChat & { cupo?: boolean }> {
  const fecha = fechaDe(Date.now(), c.zona);
  const uso = await usoDeHoy(c.ia.empresa_id, fecha);
  if (uso.consultas >= c.ia.max_consultas_dia) {
    return { ok: false, mensaje: `Se llegó al máximo de ${c.ia.max_consultas_dia} consultas a la IA de hoy.`, cupo: true };
  }
  const r = await chatJSON(c.clave, c.ia.modelo || 'gpt-6-luna', mensajes);
  const actual = await usoDeHoy(c.ia.empresa_id, fecha);
  await db.from('siguelo_ia_uso').upsert(
    {
      empresa_id: c.ia.empresa_id,
      fecha,
      consultas: actual.consultas + 1,
      entrada: actual.entrada + (r.ok ? r.uso.entrada : 0),
      salida: actual.salida + (r.ok ? r.uso.salida : 0),
    },
    { onConflict: 'empresa_id,fecha' },
  );
  return r;
}
