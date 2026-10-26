// Cálculo del embudo, sin tocar la base: qué recordatorio o reactivación le
// toca a cada contacto, cuándo, y cuándo pasa solo a otra etapa. Es el motor de
// contenido/secuencias.js de la extensión, adaptado al CRM. Los tiempos van en
// milisegundos; 0 = nunca.

import { DIA, HORA, MIN } from './horario.js';
import type { AjustesRow, AlTerminar, EstadoReact, EstadoRec, Secuencia, TipoSecuencia } from './tipos.js';

export const num = (v: unknown, def = 0): number => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() || 0 : 0);

export type ConfigEtapa = { recordatorios: Secuencia; reactivacion: Secuencia; al_terminar: AlTerminar };

export type EstadoContacto = {
  rec: EstadoRec | null;
  react: EstadoReact | null;
  respondio: boolean;
  pausado: boolean;
};

export type Contexto = {
  ahora: number;
  etapaId: string;
  // null: la etapa no tiene mensajes (o es una etapa de venta perdida).
  cfg: ConfigEtapa | null;
  // Cuándo entró el contacto a la etapa.
  entrada: number;
  // Cuándo se activó el seguimiento: lo que ya estaba antes no recibe recordatorios.
  activadoEn: number;
  ultimoCliente: number;
  ultimoManual: number;
  ajustes: Pick<AjustesRow, 'no_recordar_si_escribio_horas' | 'atraso_max_reactivacion_horas' | 'ciclos_reactivacion_cada_horas'>;
};

export type Deseo = {
  tipo: TipoSecuencia;
  paso: number;
  token: string;
  vence: number;
  variantes: string[];
  maxAtrasoMs: number | null;
  // "Recordatorio 1", "Reactivación 2"...
  etiqueta: string;
};

const limpiar = (variantes: string[] | undefined): string[] => (variantes || []).filter((v) => String(v).trim());

// Hora nominal del paso i:
//  - "desde el origen": origen + horas del paso.
//  - "encadenado": envío real del paso anterior + (horas del paso − horas del anterior).
export function horaDelPaso(sec: Secuencia, i: number, origen: number, ultimoEnvio: number | null): number {
  const h = (k: number) => (k < 0 ? 0 : num(sec.pasos[k]?.horas));
  if (sec.modo === 'origen' || i === 0) return origen + h(i) * HORA;
  const base = ultimoEnvio || origen + h(i - 1) * HORA;
  return base + Math.max(0, h(i) - h(i - 1)) * HORA;
}

// Cuándo entró a su etapa. Si nunca cambió de etapa (la ficha se creó sola con
// el chat), cuenta desde su primer mensaje, como "Primer contacto" en la extensión.
export function fechaEntrada(etapaActualizadaEn: string | null, creadoEn: string, primerMensaje: string | null): number {
  const creado = ms(creadoEn);
  const etapa = ms(etapaActualizadaEn) || creado;
  const primer = ms(primerMensaje);
  if (primer && Math.abs(etapa - creado) < 5 * MIN) return Math.min(etapa, primer);
  return etapa;
}

export function tokenDe(tipo: TipoSecuencia, est: EstadoContacto): string | null {
  if (tipo === 'rec') return est.rec ? `${est.rec.etapa_id}:${est.rec.origen}` : null;
  return est.react ? `c${est.react.ciclo}` : null;
}

// Al entrar a una etapa empieza su lista de recordatorios. No se mandan pasos
// que ya pasaron hace más de un día. Se prepara aunque la etapa no tenga
// recordatorios: sirve para saber desde cuándo está ahí.
export function prepararRec(est: EstadoContacto, ctx: Contexto): void {
  if (est.rec && est.rec.etapa_id === ctx.etapaId) return;
  const st: EstadoRec = { etapa_id: ctx.etapaId, origen: ctx.entrada, paso: 0, ultimo_envio: null, previo: ctx.entrada < ctx.activadoEn };
  const sec = ctx.cfg?.recordatorios;
  if (sec) while (st.paso < sec.pasos.length && horaDelPaso(sec, st.paso, st.origen, null) < ctx.ahora - DIA) st.paso++;
  est.rec = st;
}

// Espera tras la última conversación (del cliente o tuya a mano) antes de un recordatorio.
function esperaConversacion(ctx: Contexto): number {
  const espera = num(ctx.ajustes.no_recordar_si_escribio_horas, 24) * HORA;
  return Math.max(ctx.ultimoCliente ? ctx.ultimoCliente + espera : 0, ctx.ultimoManual ? ctx.ultimoManual + espera : 0);
}

export function deseoRec(est: EstadoContacto, ctx: Contexto): Deseo | null {
  const sec = ctx.cfg?.recordatorios;
  const st = est.rec;
  if (!sec?.activa || !sec.pasos.length || !st || st.etapa_id !== ctx.etapaId || st.previo) return null;
  if (st.paso >= sec.pasos.length || est.respondio) return null;
  return {
    tipo: 'rec',
    paso: st.paso,
    token: tokenDe('rec', est)!,
    vence: Math.max(horaDelPaso(sec, st.paso, st.origen, st.ultimo_envio), esperaConversacion(ctx)),
    variantes: limpiar(sec.pasos[st.paso].variantes),
    maxAtrasoMs: null,
    etiqueta: `Recordatorio ${st.paso + 1}`,
  };
}

export function deseoReact(est: EstadoContacto, ctx: Contexto): Deseo | null {
  const sec = ctx.cfg?.reactivacion;
  const st = est.react;
  if (!sec?.activa || !st?.activo) return null;
  if (st.etapa_id !== ctx.etapaId || st.paso >= sec.pasos.length) {
    st.activo = false;
    return null;
  }
  return {
    tipo: 'react',
    paso: st.paso,
    token: tokenDe('react', est)!,
    vence: horaDelPaso(sec, st.paso, st.origen, st.ultimo_envio),
    variantes: limpiar(sec.pasos[st.paso].variantes),
    maxAtrasoMs: num(ctx.ajustes.atraso_max_reactivacion_horas, 12) * HORA,
    etiqueta: `Reactivación ${st.paso + 1}`,
  };
}

// ¿A qué etapa pasa sola y cuándo? Cuando terminó sus recordatorios y pasaron
// los días configurados sin conversación.
export function transicion(est: EstadoContacto, ctx: Contexto): { destino: string; ts: number } | null {
  const cfg = ctx.cfg;
  if (!cfg || est.pausado || est.respondio) return null;
  const destino = cfg.al_terminar?.etapa_id;
  if (!destino || destino === ctx.etapaId) return null;
  const st = est.rec;
  if (!st || st.etapa_id !== ctx.etapaId || st.previo) return null;
  const rec = cfg.recordatorios;
  const conPasos = !!rec?.activa && rec.pasos.length > 0;
  if (conPasos && st.paso < rec.pasos.length) return null;
  const fin = (conPasos && st.ultimo_envio) || st.origen;
  const desde = Math.max(fin, ctx.ultimoCliente, ctx.ultimoManual);
  return { destino, ts: desde + num(cfg.al_terminar.dias) * DIA };
}

// El cliente escribió. Si ya le habíamos escrito, es una respuesta: se detiene
// la reactivación y queda "Respondió: atender" (los recordatorios esperan).
export function alMensajeCliente(est: EstadoContacto, eraRespuesta: boolean): string[] {
  const registro: string[] = [];
  if (!eraRespuesta) return registro;
  if (!est.respondio) {
    est.respondio = true;
    registro.push('Respondió: atender. Sus recordatorios esperan hasta que le escribas.');
  }
  if (est.react?.activo) {
    est.react.activo = false;
    registro.push('Reactivación detenida porque respondió.');
  }
  return registro;
}

// Escribiste a mano (desde el CRM o el teléfono): queda atendido y arranca la
// reactivación de su etapa (como mucho un ciclo cada N horas por etapa).
export function alMensajeManual(est: EstadoContacto, ctx: Contexto, ts: number): string[] {
  const registro: string[] = [];
  if (!ctx.cfg) return registro;
  est.respondio = false;
  const sec = ctx.cfg.reactivacion;
  if (!sec?.activa || !sec.pasos.length) return registro;
  const st = est.react;
  if (st && st.activo && st.etapa_id === ctx.etapaId) {
    // Ciclo en marcha: se cuenta desde este último mensaje tuyo, sin repetir pasos ya enviados.
    if (st.paso === 0) {
      st.origen = ts;
      st.ultimo_envio = null;
    } else {
      st.ultimo_envio = ts;
      st.origen = ts - num(sec.pasos[st.paso - 1]?.horas) * HORA;
    }
    return registro;
  }
  const horas = num(ctx.ajustes.ciclos_reactivacion_cada_horas, 24);
  if (!st || st.etapa_id !== ctx.etapaId || ts - (st.inicio || 0) >= horas * HORA) {
    est.react = { etapa_id: ctx.etapaId, activo: true, ciclo: (st?.ciclo || 0) + 1, inicio: ts, origen: ts, paso: 0, ultimo_envio: null };
    registro.push('Le escribiste: empieza su reactivación por si no responde.');
  } else {
    registro.push(`Le escribiste, pero no se inicia otra reactivación (ya hubo una en las últimas ${horas} h).`);
  }
  return registro;
}

// Un mensaje de la cola salió, falló o se canceló a mano: se pasa al paso
// siguiente. Una reactivación demasiado atrasada termina su ciclo.
export function avanzar(est: EstadoContacto, tipo: TipoSecuencia, paso: number, token: string, ahora: number, atrasado = false): boolean {
  const st = tipo === 'rec' ? est.rec : est.react;
  if (!st || tokenDe(tipo, est) !== token || st.paso !== paso) return false;
  st.paso++;
  st.ultimo_envio = ahora;
  if (tipo === 'react' && atrasado) (st as EstadoReact).activo = false;
  return true;
}
