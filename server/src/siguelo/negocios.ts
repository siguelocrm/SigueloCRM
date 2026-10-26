import { db } from './db.js';
import type { EtapaVentaRow, NegocioRow } from './tipos.js';

// Negocios por número (Fase 2): de qué negocio es cada número, su ficha y qué
// reglas del bot son solo de algunos negocios. Se lee de la base como mucho
// cada 30 segundos. Si todavía no se pegó la parte de la Fase 2 de
// database/siguelo.sql, todo sigue como antes (un solo negocio para todos).

const VALIDO_MS = 30_000;

type Datos = {
  leido: number;
  negocios: NegocioRow[];
  negocioPorLinea: Map<string, NegocioRow>;
  lineasDeNegocio: Map<string, string[]>;
  nombreDeLinea: Map<string, string>;
  lineaActiva: Map<string, boolean>;
  // Reglas del bot que son solo de algunos negocios (las que no están acá son de todos).
  negociosDeRegla: Map<string, Set<string>>;
};

let datos: Datos = {
  leido: 0,
  negocios: [],
  negocioPorLinea: new Map(),
  lineasDeNegocio: new Map(),
  nombreDeLinea: new Map(),
  lineaActiva: new Map(),
  negociosDeRegla: new Map(),
};
let cargando: Promise<Datos> | null = null;

async function leer(): Promise<Datos> {
  const [negocios, lineas, asignaciones, reglas] = await Promise.all([
    db.from('siguelo_negocios').select('*'),
    db.from('lineas_whatsapp').select('id, nombre, estado'),
    db.from('siguelo_lineas').select('linea_id, negocio_id'),
    db.from('siguelo_bot_negocio').select('regla_id, negocio_id'),
  ]);
  const porId = new Map((negocios.data || []).map((n) => [n.id, n] as const));
  const negocioPorLinea = new Map<string, NegocioRow>();
  const lineasDeNegocio = new Map<string, string[]>();
  for (const a of asignaciones.data || []) {
    const n = porId.get(a.negocio_id);
    if (!n) continue;
    negocioPorLinea.set(a.linea_id, n);
    lineasDeNegocio.set(n.id, [...(lineasDeNegocio.get(n.id) || []), a.linea_id]);
  }
  const negociosDeRegla = new Map<string, Set<string>>();
  for (const r of reglas.data || []) {
    if (!negociosDeRegla.has(r.regla_id)) negociosDeRegla.set(r.regla_id, new Set());
    negociosDeRegla.get(r.regla_id)!.add(r.negocio_id);
  }
  return {
    leido: Date.now(),
    negocios: negocios.data || [],
    negocioPorLinea,
    lineasDeNegocio,
    nombreDeLinea: new Map((lineas.data || []).map((l) => [l.id, l.nombre?.trim() || ''] as const)),
    lineaActiva: new Map((lineas.data || []).map((l) => [l.id, l.estado === 'activo'] as const)),
    negociosDeRegla,
  };
}

// Para que una lectura nueva vea enseguida un cambio recién hecho (por ejemplo, en las pruebas).
export function olvidarNegocios(): void {
  datos.leido = 0;
}

// Los demás negocios de la empresa que tienen al menos un número (para que la IA pase al cliente).
export async function otrosNegocios(empresaId: string, menos: string): Promise<NegocioRow[]> {
  const d = await actuales();
  return d.negocios.filter((n) => n.empresa_id === empresaId && n.id !== menos && (d.lineasDeNegocio.get(n.id) || []).length > 0);
}

// El número por el que escribe un negocio: el primero conectado, o el primero que tenga.
export async function lineaDeNegocio(negocioId: string): Promise<string | null> {
  const d = await actuales();
  const lineas = d.lineasDeNegocio.get(negocioId) || [];
  return lineas.find((l) => d.lineaActiva.get(l)) ?? lineas[0] ?? null;
}

async function actuales(): Promise<Datos> {
  if (Date.now() - datos.leido < VALIDO_MS) return datos;
  cargando ??= leer()
    .then((d) => (datos = d))
    .catch((err) => {
      console.error('Negocios: no se pudieron leer:', (err as Error).message);
      return datos;
    })
    .finally(() => {
      cargando = null;
    });
  return cargando;
}

export async function negocioDeLinea(lineaId: string): Promise<NegocioRow | null> {
  return (await actuales()).negocioPorLinea.get(lineaId) ?? null;
}

// Variables de los textos según el número que envía: {negocio}, {sucursal},
// {direccion} y {horario} salen de la ficha de su negocio. Sin ficha,
// {sucursal} es el nombre del número en Conexiones.
export async function variablesDeLinea(lineaId: string): Promise<Record<string, string>> {
  const d = await actuales();
  const n = d.negocioPorLinea.get(lineaId);
  return {
    negocio: n?.nombre?.trim() || '',
    sucursal: n?.sucursal?.trim() || d.nombreDeLinea.get(lineaId) || '',
    direccion: n?.direccion?.trim() || '',
    horario: n?.horario?.trim() || '',
  };
}

// Deja solo las reglas del bot que valen para este número: las que no tienen
// negocio (son de todos) y las del negocio del número.
export async function reglasDelNumero<T extends { id: string }>(reglas: T[], lineaId: string): Promise<T[]> {
  const d = await actuales();
  if (!d.negociosDeRegla.size) return reglas;
  const negocio = d.negocioPorLinea.get(lineaId);
  return reglas.filter((r) => {
    const de = d.negociosDeRegla.get(r.id);
    return !de || (!!negocio && de.has(negocio.id));
  });
}

// Las etapas de un embudo (null = el embudo principal), en orden.
export async function etapasDelEmbudo(empresaId: string, embudoId: string | null): Promise<EtapaVentaRow[]> {
  const [{ data: etapas }, { data: deEmbudo }] = await Promise.all([
    db.from('etapas_venta').select('id, empresa_id, nombre, tipo, orden, probabilidad').eq('empresa_id', empresaId).order('orden'),
    db.from('siguelo_etapa_embudo').select('etapa_id, embudo_id'),
  ]);
  const embudoDe = new Map((deEmbudo || []).map((e) => [e.etapa_id, e.embudo_id] as const));
  return (etapas || []).filter((e) => (embudoDe.get(e.id) ?? null) === (embudoId ?? null));
}
