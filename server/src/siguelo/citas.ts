import { db } from './db.js';
import { DIA, HORA, MIN, fechaDe, fechaMasDias, partes } from './horario.js';
import { registrar } from './registro.js';
import type { AjustesRow, CitaRow, ColaRow, ConfigCitas } from './tipos.js';

// Citas (Fase 4): cada cita agendada recibe sus mensajes (por ejemplo 2 h antes,
// 1 h antes, al empezar y 2 h después de terminar). El motor deja en la cola el
// que toca; la cola los manda con prioridad, en su franja y sin contar para el tope.

const ms = (iso: string) => new Date(iso).getTime() || 0;

// Los pasos en orden de hora: [{ i, ts }]
export function pasosDe(cfg: ConfigCitas, cita: Pick<CitaRow, 'inicio' | 'fin'>) {
  return cfg.pasos
    .map((p, i) => ({ i, ts: (p.ref === 'fin' ? ms(cita.fin) : ms(cita.inicio)) + Number(p.horas || 0) * HORA, variantes: (p.variantes || []).filter((v) => v.trim()) }))
    .sort((a, b) => a.ts - b.ts || a.i - b.i);
}

export const tokenCita = (cita: Pick<CitaRow, 'id' | 'inicio'>) => `cita:${cita.id}:${ms(cita.inicio)}`;
export const idDeToken = (token: string) => token.split(':')[1];

// {hora} y {cuando} ("hoy", "mañana", "el viernes 30/10") de la cita, en la zona del negocio.
export function variablesCita(cita: Pick<CitaRow, 'inicio'>, zona: string, ahora = Date.now()): Record<string, string> {
  const p = partes(ms(cita.inicio), zona);
  const hoy = fechaDe(ahora, zona);
  const hora = `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
  let cuando: string;
  if (p.fecha === hoy) cuando = 'hoy';
  else if (p.fecha === fechaMasDias(hoy, 1)) cuando = 'mañana';
  else {
    const dia = new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'long' }).format(new Date(ms(cita.inicio)));
    cuando = `el ${dia} ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
  }
  return { hora, cuando };
}

// Chat del contacto por el que se le escribe: el abierto o el más reciente.
async function chatDe(empresaId: string, contactoId: string) {
  const { data: contacto } = await db.from('contactos').select('telefono').eq('id', contactoId).maybeSingle();
  if (!contacto) return null;
  const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', empresaId);
  const ids = (lineas || []).map((l) => l.id);
  if (!ids.length) return null;
  const { data: chats } = await db
    .from('conversaciones')
    .select('id, linea_id, estado, ultima_actividad')
    .eq('contacto_telefono', contacto.telefono)
    .in('linea_id', ids)
    .order('ultima_actividad', { ascending: false })
    .limit(10);
  const chat = (chats || []).find((c) => c.estado === 'abierto') ?? chats?.[0];
  return chat ? { conversacion_id: chat.id, linea_id: chat.linea_id, telefono: contacto.telefono } : null;
}

// Deja en la cola el mensaje que toca de cada cita (y cancela lo que ya no corresponde).
export async function revisarCitas(aj: AjustesRow, pendientes: ColaRow[], cancelados: Set<string>): Promise<void> {
  const cfg = aj.citas;
  const deCitas = pendientes.filter((p) => p.tipo === 'cita');
  const cancelar = (it: ColaRow, motivo: string) =>
    db.from('siguelo_cola').update({ estado: 'cancelado', motivo, cerrado_en: new Date().toISOString() }).eq('id', it.id).eq('estado', 'pendiente');
  if (!cfg?.activa) {
    for (const it of deCitas) await cancelar(it, 'Los mensajes de las citas están apagados');
    return;
  }
  const ahora = Date.now();
  const { data: citas, error } = await db
    .from('siguelo_citas')
    .select('*')
    .eq('empresa_id', aj.empresa_id)
    .eq('estado', 'agendada')
    .gte('fin', new Date(ahora - DIA).toISOString());
  if (error) return; // sin la Fase 4 pegada
  const vigentes = new Set<string>();
  for (const cita of citas || []) {
    const token = tokenCita(cita);
    const lista = pasosDe(cfg, cita);
    let paso = cita.paso;
    // Se salta un paso cancelado a mano, sin texto o cuya hora ya había pasado al
    // agendar (o cambiar) la cita: un "falta 1 hora" a 30 minutos no sería cierto.
    const agendada = ms(cita.actualizado_en) - MIN;
    const saltar = (k: number) => cancelados.has(`${cita.contacto_id}|cita|${k}|${token}`) || !lista[k].variantes.length || lista[k].ts < agendada;
    while (paso < lista.length && saltar(paso)) paso++;
    if (paso !== cita.paso) await db.from('siguelo_citas').update({ paso }).eq('id', cita.id);
    if (paso >= lista.length) continue;
    const p = lista[paso];
    const existente = deCitas.find((it) => it.contacto_id === cita.contacto_id && it.token === token && it.paso === paso);
    if (existente) {
      vigentes.add(existente.id);
      continue;
    }
    const chat = await chatDe(aj.empresa_id, cita.contacto_id);
    if (!chat) continue;
    const { data: nuevo, error: errorCola } = await db
      .from('siguelo_cola')
      .insert({
        empresa_id: aj.empresa_id,
        contacto_id: cita.contacto_id,
        ...chat,
        tipo: 'cita',
        etapa_id: null,
        paso,
        token,
        nombre: `Cita · Mensaje ${paso + 1}`,
        variantes: p.variantes,
        vence: new Date(p.ts).toISOString(),
        max_atraso_ms: Math.max(5, cfg.max_atraso_min || 45) * MIN,
      })
      .select('id')
      .single();
    if (errorCola) console.error('Citas: no se pudo programar un mensaje:', errorCola.message);
    else if (nuevo) vigentes.add(nuevo.id);
  }
  for (const it of deCitas) if (!vigentes.has(it.id)) await cancelar(it, 'La cita cambió o se quitó');
}

// La cola avisa cuando un mensaje de cita salió (o se saltó): pasa al siguiente.
export async function avanzarCita(item: Pick<ColaRow, 'token' | 'paso' | 'contacto_id' | 'empresa_id' | 'nombre'>, enviado: boolean): Promise<void> {
  const id = idDeToken(item.token);
  // actualizado_en no se toca: marca cuándo se agendó o cambió la cita.
  await db.from('siguelo_citas').update({ paso: item.paso + 1 }).eq('id', id).eq('paso', item.paso);
  if (!enviado) await registrar(item.empresa_id, item.contacto_id, 'cola', `Se saltó "${item.nombre}" de su cita.`);
}

// ¿Sigue valiendo este mensaje de cita? Devuelve la cita o null.
export async function citaVigente(item: Pick<ColaRow, 'token' | 'paso'>): Promise<CitaRow | null> {
  const { data } = await db.from('siguelo_citas').select('*').eq('id', idDeToken(item.token)).maybeSingle();
  if (!data || data.estado !== 'agendada' || tokenCita(data) !== item.token || data.paso !== item.paso) return null;
  return data;
}
