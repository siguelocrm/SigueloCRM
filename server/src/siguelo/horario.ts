// Horario de envío y fechas en la zona horaria del negocio (por defecto
// America/La_Paz). Igual que comun/horario.js de la extensión, pero recibe la
// zona y la franja en vez de leerlas de los ajustes globales.
// La página tiene una copia (client/src/features/seguimiento/horario.ts) para
// mostrar las horas estimadas: si cambias una, cambia la otra.

export const MIN = 60 * 1000;
export const HORA = 60 * MIN;
export const DIA = 24 * HORA;

export type Franja = { zona: string; desde: string; hasta: string };

export const aMinutos = (hhmm: string): number => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatos.set(zona, f);
  }
  return f;
}

export type Partes = { y: number; m: number; d: number; hh: number; mm: number; ss: number; fecha: string; minutos: number };

// Fecha 'AAAA-MM-DD' y hora local del instante en la zona.
export function partes(ts: number, zona: string): Partes {
  const p: Record<string, string> = {};
  for (const { type, value } of formato(zona).formatToParts(new Date(ts))) p[type] = value;
  const r = { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
  return { ...r, fecha: `${p.year}-${p.month}-${p.day}`, minutos: r.hh * 60 + r.mm };
}

// Diferencia entre la hora local de la zona y UTC en ese instante.
function desfase(ts: number, zona: string): number {
  const p = partes(ts, zona);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ts / 1000) * 1000;
}

// Instante de una fecha 'AAAA-MM-DD' a la hora 'HH:MM' local de la zona.
export function instante(fecha: string, hhmm: string, zona: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  const min = aMinutos(hhmm);
  const local = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  const ts = local - desfase(local, zona);
  return local - desfase(ts, zona); // segunda pasada por si hay cambio de hora
}

export function fechaMasDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const fechaDe = (ts: number, zona: string): string => partes(ts, zona).fecha;

// ¿El instante cae dentro de la franja?
export function enFranja(ts: number, f: Franja): boolean {
  const min = partes(ts, f.zona).minutos;
  return min >= aMinutos(f.desde) && min < aMinutos(f.hasta);
}

// Inicio de la franja del mismo día del instante.
export const inicioDelDia = (ts: number, f: Franja): number => instante(partes(ts, f.zona).fecha, f.desde, f.zona);

// Inicio de la franja del día siguiente (cuando se llena el tope diario).
export const inicioDeManana = (ts: number, f: Franja): number => instante(fechaMasDias(partes(ts, f.zona).fecha, 1), f.desde, f.zona);

// Si el instante cae fuera de la franja, lo mueve al siguiente inicio.
export function ajustar(ts: number, f: Franja): number {
  if (enFranja(ts, f)) return ts;
  const hoy = inicioDelDia(ts, f);
  return ts < hoy ? hoy : inicioDeManana(ts, f);
}
