import { db } from './db.js';
import { HORA, enFranja } from './horario.js';
import type { EtapaConfigRow, Secuencia } from './tipos.js';
import { nombreConcretado } from './calculo.js';

// "¿Por qué no se programa?" del Seguimiento: la configuración general, los mensajes de cada
// etapa (y cuáles usan los de la primera etapa) y, chat por chat de las últimas 48 h, en qué
// está su seguimiento y por qué.

type Revision = { ok: boolean; titulo: string; detalle?: string; aviso?: boolean };
export type EstadoSeguimiento = {
  general: Revision[];
  etapas: { nombre: string; tipo: string; recordatorios: string; reactivacion: string; respaldo: boolean; concretado?: boolean }[];
  chats: { nombre: string; telefono: string; etapa: string; estado: string; ok: boolean }[];
};

const activa = (s: Secuencia | undefined) => !!s?.activa && (s.pasos || []).length > 0;
const horas = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24} ${h === 24 ? 'día' : 'días'}` : `${h} h`);
const describir = (s: Secuencia | undefined) => (activa(s) ? s!.pasos.map((p) => horas(Number(p.horas) || 0)).join(', ') : '');
const fecha = (iso: string, zona: string) => new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export async function estadoSeguimiento(empresaId: string): Promise<EstadoSeguimiento> {
  const [{ data: aj }, { data: etapas }, { data: cfgs }, { data: deEmbudo }] = await Promise.all([
    db.from('siguelo_ajustes').select('*').eq('empresa_id', empresaId).maybeSingle(),
    db.from('etapas_venta').select('id, nombre, tipo, orden').eq('empresa_id', empresaId).order('orden'),
    db.from('siguelo_etapas').select('*').eq('empresa_id', empresaId),
    db.from('siguelo_etapa_embudo').select('etapa_id, embudo_id'),
  ]);
  const zona = aj?.zona_horaria || 'America/La_Paz';
  const general: Revision[] = [];
  if (!aj?.activo) general.push({ ok: false, titulo: 'El seguimiento está apagado', detalle: 'Actívalo en la pestaña Ajustes ("Activar el seguimiento").' });
  else general.push({ ok: true, titulo: `Seguimiento activo${aj.activado_en ? ` desde el ${fecha(aj.activado_en, zona)}` : ''}`, detalle: 'Los chats que ya existían antes no reciben recordatorios (sí reactivaciones cuando les escribes).' });
  if (aj?.pausado) general.push({ ok: false, titulo: 'Está en pausa', detalle: `${aj.motivo_pausa || 'Lo pausaste a mano'}. Quita la pausa en Ajustes.` });
  if (aj) {
    general.push(
      enFranja(Date.now(), { zona, desde: aj.hora_inicio, hasta: aj.hora_fin })
        ? { ok: true, titulo: `Dentro de su horario de envío (${aj.hora_inicio} a ${aj.hora_fin})` }
        : { ok: true, aviso: true, titulo: `Fuera de su horario de envío (${aj.hora_inicio} a ${aj.hora_fin})`, detalle: 'Se programa igual, pero los mensajes salen cuando empiece la franja.' },
    );
  }

  // Mensajes de cada etapa (los generales; los de un negocio mandan sobre estos).
  const embudoDe = new Map((deEmbudo || []).map((e) => [e.etapa_id, e.embudo_id] as const));
  const general_ = new Map((cfgs || []).filter((c: EtapaConfigRow) => !c.negocio_id).map((c: EtapaConfigRow) => [c.etapa_id, c] as const));
  const lista = etapas || [];
  const resumen: EstadoSeguimiento['etapas'] = [];
  for (const e of lista) {
    if (e.tipo !== 'normal') continue;
    const propia = general_.get(e.id);
    if (propia?.sin_seguimiento || (nombreConcretado(e.nombre) && !activa(propia?.recordatorios) && !activa(propia?.reactivacion))) {
      resumen.push({ nombre: e.nombre, tipo: e.tipo, recordatorios: 'ninguno', reactivacion: 'ninguna', respaldo: false, concretado: true });
      continue;
    }
    const base = lista
      .filter((x) => x.tipo === 'normal' && (embudoDe.get(x.id) ?? null) === (embudoDe.get(e.id) ?? null))
      .map((x) => general_.get(x.id))
      .find((c) => c && (activa(c.recordatorios) || activa(c.reactivacion)));
    const rec = activa(propia?.recordatorios) ? propia!.recordatorios : base?.recordatorios;
    const react = activa(propia?.reactivacion) ? propia!.reactivacion : base?.reactivacion;
    resumen.push({
      nombre: e.nombre,
      tipo: e.tipo,
      recordatorios: describir(rec) || 'ninguno',
      reactivacion: describir(react) || 'ninguna',
      respaldo: (!activa(propia?.recordatorios) && activa(base?.recordatorios)) || (!activa(propia?.reactivacion) && activa(base?.reactivacion)),
    });
  }
  if (!resumen.some((r) => r.recordatorios !== 'ninguno' || r.reactivacion !== 'ninguna')) {
    general.push({ ok: false, titulo: 'Ninguna etapa tiene mensajes de seguimiento', detalle: 'En "Mensajes por etapa", activa los recordatorios y la reactivación de "Primer Contacto" con sus mensajes (las demás etapas los usan si no tienen propios).' });
  }

  // Los chats con mensajes del cliente en las últimas 48 h.
  const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', empresaId);
  const { data: convs } = await db
    .from('conversaciones')
    .select('id, contacto_telefono, contacto_nombre, ultima_actividad')
    .in('linea_id', (lineas || []).map((l) => l.id).concat(['00000000-0000-0000-0000-000000000000']))
    .gte('ultima_actividad', new Date(Date.now() - 48 * HORA).toISOString())
    .order('ultima_actividad', { ascending: false })
    .limit(15);
  const chats: EstadoSeguimiento['chats'] = [];
  const etapaDe = new Map(lista.map((e) => [e.id, e] as const));
  for (const cv of convs || []) {
    if (!/^\d{7,15}$/.test(cv.contacto_telefono)) continue;
    const { data: c } = await db.from('contactos').select('id, nombre, etapa_id').eq('empresa_id', empresaId).eq('telefono', cv.contacto_telefono).maybeSingle();
    const etapa = c?.etapa_id ? etapaDe.get(c.etapa_id) : undefined;
    const base = { nombre: c?.nombre || cv.contacto_nombre || `+${cv.contacto_telefono}`, telefono: cv.contacto_telefono, etapa: etapa?.nombre ?? '—' };
    if (!c) {
      chats.push({ ...base, ok: false, estado: 'Todavía no tiene ficha de contacto: el seguimiento la crea en su próxima vuelta (cada minuto).' });
      continue;
    }
    if (etapa && etapa.tipo !== 'normal') {
      chats.push({ ...base, ok: true, estado: etapa.tipo === 'ganada' ? 'Está en una etapa de venta ganada: no se le hace seguimiento.' : 'Está en venta perdida: no se le escribe más.' });
      continue;
    }
    const resumenEtapa = resumen.find((r) => r.nombre === etapa?.nombre);
    if (resumenEtapa?.concretado) {
      chats.push({ ...base, ok: true, estado: `Está en "${etapa?.nombre}" (ya concretó): no recibe recordatorios ni reactivaciones.` });
      continue;
    }
    if (!resumenEtapa || (resumenEtapa.recordatorios === 'ninguno' && resumenEtapa.reactivacion === 'ninguna')) {
      chats.push({ ...base, ok: false, estado: `Su etapa "${etapa?.nombre ?? '?'}" no tiene mensajes de seguimiento.` });
      continue;
    }
    const [{ data: seg }, { data: cola }] = await Promise.all([
      db.from('siguelo_seguimientos').select('*').eq('contacto_id', c.id).maybeSingle(),
      db.from('siguelo_cola').select('nombre, vence').eq('contacto_id', c.id).eq('estado', 'pendiente').order('vence').limit(2),
    ]);
    if (cola?.length) {
      chats.push({ ...base, ok: true, estado: `Programado: ${cola.map((q) => `${q.nombre} el ${fecha(q.vence, zona)}`).join(' · ')}.` });
      continue;
    }
    if (!aj?.activo) {
      chats.push({ ...base, ok: false, estado: 'El seguimiento está apagado.' });
      continue;
    }
    if (!seg) {
      chats.push({ ...base, ok: false, estado: 'El seguimiento todavía no lo revisó (lo hace cada minuto).' });
      continue;
    }
    const partes: string[] = [];
    if (seg.pausado) partes.push('lo pausaste a mano');
    if (seg.respondio) partes.push('te respondió: la reactivación arranca cuando le escribas (tú o la IA) y te deje en visto');
    if (seg.rec?.previo) partes.push('ya escribía antes de que activaras el seguimiento: no recibe recordatorios');
    if (seg.react && !seg.react.activo && !seg.respondio) partes.push('su reactivación ya terminó o se detuvo');
    chats.push({ ...base, ok: partes.length > 0 && !seg.pausado, estado: partes.length ? `Nada programado: ${partes.join('; ')}.` : 'Nada programado todavía: se programa cuando le escribas y te deje en visto.' });
  }
  return { general, etapas: resumen, chats };
}
