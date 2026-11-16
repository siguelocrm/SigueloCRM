import { db } from '../db.js';
import { DIA, HORA, MIN, aMinutos, fechaDe, fechaMasDias, instante } from '../horario.js';
import type { ConfigReuniones } from '../tipos.js';

// Reuniones virtuales que agenda la IA (Negocios → ficha → Reuniones): con tus días y horarios
// libres, le ofrece al cliente los que no están ocupados y, cuando confirma uno, queda la cita
// (con sus recordatorios de Seguimiento → Citas) y la actividad en tu Agenda.

export type Hueco = { inicio: number; fin: number; dia: string; hora: string };
export const NOTA_REUNION = 'Reunión virtual';
const MAX_HUECOS = 60;
const ms = (iso: string) => new Date(iso).getTime() || 0;
const iso = (t: number) => new Date(t).toISOString();

export const reunionesActivas = (cfg?: ConfigReuniones | null): cfg is ConfigReuniones =>
  !!cfg?.activa && Array.isArray(cfg.franjas) && cfg.franjas.some((f) => f.dias?.length && aMinutos(f.hasta) > aMinutos(f.desde));

export const duracionDe = (cfg: ConfigReuniones) => Math.max(10, Math.min(240, Math.round(Number(cfg.duracion_min) || 30)));

// 1 = lunes … 7 = domingo, de una fecha "2026-11-18".
const diaSemana = (fecha: string) => {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const formato = (zona: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es', { timeZone: zona, ...o });
export const textoReunion = (inicio: number, zona: string) =>
  `${formato(zona, { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(inicio))} a las ${formato(zona, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(inicio))}`;

// Los horarios libres de los próximos días (sin los que ya tienen una cita).
export async function huecosLibres(empresaId: string, cfg: ConfigReuniones, zona: string, ahora = Date.now()): Promise<Hueco[]> {
  const dur = duracionDe(cfg) * MIN;
  const desde = ahora + Math.max(0, Number(cfg.anticipacion_horas ?? 2)) * HORA;
  const dias = Math.max(1, Math.min(30, Math.round(Number(cfg.dias_adelante ?? 7))));
  const { data: citas } = await db.from('siguelo_citas').select('inicio, fin').eq('empresa_id', empresaId).eq('estado', 'agendada').gte('fin', iso(ahora)).lte('inicio', iso(ahora + (dias + 1) * DIA));
  const ocupado = (a: number, b: number) => (citas || []).some((c) => ms(c.inicio) < b && ms(c.fin) > a);
  const hoy = fechaDe(ahora, zona);
  const vistos = new Set<number>();
  const huecos: Hueco[] = [];
  for (let i = 0; i <= dias; i++) {
    const fecha = fechaMasDias(hoy, i);
    for (const f of cfg.franjas || []) {
      if (!f.dias?.includes(diaSemana(fecha))) continue;
      const fin = instante(fecha, f.hasta, zona);
      for (let t = instante(fecha, f.desde, zona); t + dur <= fin; t += dur) {
        if (t < desde || vistos.has(t) || ocupado(t, t + dur)) continue;
        vistos.add(t);
        huecos.push({
          inicio: t,
          fin: t + dur,
          dia: formato(zona, { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(t)),
          hora: formato(zona, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)),
        });
      }
    }
  }
  return huecos.sort((a, b) => a.inicio - b.inicio).slice(0, MAX_HUECOS);
}

// La próxima reunión que ya tiene este cliente (para que la IA no le agende otra sin querer).
export async function reunionDe(contactoId: string | null): Promise<{ id: string; inicio: number } | null> {
  if (!contactoId) return null;
  const { data } = await db
    .from('siguelo_citas')
    .select('id, inicio, nota')
    .eq('contacto_id', contactoId)
    .eq('estado', 'agendada')
    .gte('inicio', iso(Date.now()))
    .order('inicio')
    .limit(5);
  const r = (data || []).find((c) => (c.nota || '').startsWith(NOTA_REUNION));
  return r ? { id: r.id, inicio: ms(r.inicio) } : null;
}

// Agenda la reunión: la cita (con sus recordatorios) y la actividad en la Agenda del dueño principal.
// Si ya tenía otra reunión por delante, esa se cambia por la nueva.
export async function agendarReunion(empresaId: string, contactoId: string, hueco: Hueco, quien: string, enlace: string | undefined): Promise<{ ok: true; reprogramada: boolean } | { ok: false; mensaje: string }> {
  const { data: choque } = await db.from('siguelo_citas').select('id, contacto_id').eq('empresa_id', empresaId).eq('estado', 'agendada').lt('inicio', iso(hueco.fin)).gt('fin', iso(hueco.inicio));
  if ((choque || []).some((c) => c.contacto_id !== contactoId)) return { ok: false, mensaje: 'ese horario se acaba de ocupar' };
  const ahora = iso(Date.now());
  const anterior = await reunionDe(contactoId);
  if (anterior && anterior.inicio === hueco.inicio) return { ok: true, reprogramada: false }; // ya estaba agendada así
  if (anterior) {
    await db.from('siguelo_citas').update({ estado: 'cancelada', actualizado_en: ahora }).eq('id', anterior.id);
    await db.from('tareas').update({ completada: true }).eq('contacto_id', contactoId).eq('completada', false).eq('fecha', iso(anterior.inicio));
  }
  const { error } = await db.from('siguelo_citas').insert({ empresa_id: empresaId, contacto_id: contactoId, inicio: iso(hueco.inicio), fin: iso(hueco.fin), nota: `${NOTA_REUNION} (agendada por la IA)${enlace ? ` · ${enlace}` : ''}` });
  if (error) return { ok: false, mensaje: error.message };
  const { data: principal } = await db.from('siguelo_accesos').select('usuario_id').eq('empresa_id', empresaId).eq('principal', true).maybeSingle();
  await db.from('tareas').insert({ empresa_id: empresaId, contacto_id: contactoId, titulo: `📅 Reunión virtual con ${quien}${enlace ? ` · ${enlace}` : ''}`, fecha: iso(hueco.inicio), asignado_a: principal?.usuario_id ?? null });
  return { ok: true, reprogramada: !!anterior };
}
