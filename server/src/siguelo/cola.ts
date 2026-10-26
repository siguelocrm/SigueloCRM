import { db } from './db.js';
import { MIN, ajustar, enFranja, fechaDe, inicioDelDia, type Franja } from './horario.js';
import * as C from './calculo.js';
import { agregarPie, elegirVariante } from './textos.js';
import { registrar } from './registro.js';
import { variablesDeLinea } from './negocios.js';
import { avanzarCita, citaVigente, variablesCita } from './citas.js';
import { adaptarMensaje } from './ia/adaptar.js';
import { obtenerSesion } from '../whatsapp/sesiones.js';
import { construirContenidoWA } from '../whatsapp/contenido.js';
import { marcarEnviadoPorCRM } from '../whatsapp/mensajes-enviados-por-crm.js';
import type { AjustesRow, ColaRow, EstadoCola, SeguimientoRow } from './tipos.js';

// Cola de envío: el más antiguo primero, respetando el horario, una pausa al
// azar entre envíos, el tope diario y un mínimo entre dos mensajes automáticos
// a la misma persona. La pausa, el tope, el retraso de arranque del día y ese
// mínimo se cuentan por cada número de WhatsApp (el riesgo de bloqueo es por
// número): cada número manda como mucho un mensaje por vuelta, en paralelo con
// los demás. Los valores (cuánto de cada cosa) por ahora son los de la empresa. Igual que contenido/cola.js de la extensión, pero
// envía por las líneas de WhatsApp del CRM.

const ERRORES_PARA_PAUSAR = 3;

type EstadoLinea = {
  // Este número no envía nada antes de este instante (pausa al azar entre mensajes).
  proximo: number;
  erroresSeguidos: number;
  // Retraso al azar (0 a 2 min) del arranque de cada día, para no empezar en punto.
  retraso: { fecha: string; ms: number } | null;
};
const lineas = new Map<string, EstadoLinea>();

const azarMs = (aj: AjustesRow) => {
  const min = Math.min(aj.pausa_min_seg, aj.pausa_max_seg);
  const max = Math.max(aj.pausa_min_seg, aj.pausa_max_seg);
  return (min + Math.random() * (max - min)) * 1000;
};

// Al arrancar el servidor no se envía de inmediato: primero una pausa normal
// (así lo atrasado no sale todo junto).
function estadoLinea(aj: AjustesRow, lineaId: string): EstadoLinea {
  let e = lineas.get(lineaId);
  if (!e) {
    e = { proximo: Date.now() + azarMs(aj), erroresSeguidos: 0, retraso: null };
    lineas.set(lineaId, e);
  }
  return e;
}

// ¿Este número ya puede empezar a enviar? (dentro del horario y pasado su retraso del día)
function arranco(e: EstadoLinea, ahora: number, franja: Franja, fecha: string): boolean {
  if (!e.retraso || e.retraso.fecha !== fecha) e.retraso = { fecha, ms: Math.round(Math.random() * 120) * 1000 };
  return ahora >= inicioDelDia(ahora, franja) + e.retraso.ms;
}

// Último mensaje automático que este número le mandó a esta persona.
async function ultimoAutomatico(contactoId: string, lineaId: string): Promise<number> {
  const { data } = await db
    .from('siguelo_cola')
    .select('cerrado_en')
    .eq('contacto_id', contactoId)
    .eq('linea_id', lineaId)
    .eq('estado', 'enviado')
    .order('cerrado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  return C.ms(data?.cerrado_en);
}

async function enviadosHoy(empresaId: string, lineaId: string, fecha: string): Promise<number> {
  const { data } = await db.from('siguelo_contador').select('enviados').eq('empresa_id', empresaId).eq('linea_id', lineaId).eq('fecha', fecha).maybeSingle();
  return data?.enviados ?? 0;
}

async function sumarEnviado(empresaId: string, lineaId: string, fecha: string): Promise<void> {
  const n = await enviadosHoy(empresaId, lineaId, fecha);
  await db.from('siguelo_contador').upsert({ empresa_id: empresaId, linea_id: lineaId, fecha, enviados: n + 1 }, { onConflict: 'empresa_id,linea_id,fecha' });
}

const estadoContacto = (seg: Pick<SeguimientoRow, 'rec' | 'react' | 'respondio' | 'pausado'>): C.EstadoContacto => ({
  rec: seg.rec ? { ...seg.rec } : null,
  react: seg.react ? { ...seg.react } : null,
  respondio: seg.respondio,
  pausado: seg.pausado,
});

async function cancelarInterno(item: ColaRow, motivo: string): Promise<void> {
  await db.from('siguelo_cola').update({ estado: 'cancelado', motivo, cerrado_en: new Date().toISOString() }).eq('id', item.id).in('estado', ['pendiente', 'enviando']);
}

// Cierra un mensaje (enviado, con error o cancelado por atraso) y el contacto
// pasa al paso siguiente de su recordatorio o reactivación.
async function cerrar(
  item: ColaRow,
  estado: EstadoCola,
  motivo: string | null,
  extra: { texto?: string; mensaje_id?: string | null; whatsapp_id?: string | null; atrasado?: boolean } = {},
): Promise<void> {
  const ahora = new Date().toISOString();
  await db
    .from('siguelo_cola')
    .update({ estado, motivo, cerrado_en: ahora, texto: extra.texto ?? item.texto, mensaje_id: extra.mensaje_id ?? null, whatsapp_id: extra.whatsapp_id ?? null })
    .eq('id', item.id);
  const { data: seg } = await db.from('siguelo_seguimientos').select('*').eq('contacto_id', item.contacto_id).maybeSingle();
  if (!seg) return;
  const est = estadoContacto(seg);
  const cambios: Partial<SeguimientoRow> = {};
  if (item.tipo !== 'cita' && C.avanzar(est, item.tipo, item.paso, item.token, Date.now(), !!extra.atrasado)) {
    cambios.rec = est.rec;
    cambios.react = est.react;
  }
  if (estado === 'enviado') {
    cambios.ultimo_automatico = ahora;
    cambios.ultimo_texto_auto = extra.texto ?? null;
  }
  if (Object.keys(cambios).length) await db.from('siguelo_seguimientos').update({ ...cambios, actualizado_en: ahora }).eq('contacto_id', item.contacto_id);
}

// ¿Hay en su chat un mensaje nuevo que el motor todavía no revisó? (del cliente,
// o tuyo escrito a mano). Entonces se espera a la próxima vuelta del motor.
async function hayNovedadSinRevisar(item: ColaRow, seg: SeguimientoRow): Promise<boolean> {
  const { data: ultimo } = await db
    .from('mensajes')
    .select('id, remitente, creado_en, whatsapp_id')
    .eq('conversacion_id', item.conversacion_id)
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultimo) return false;
  if (ultimo.remitente === 'cliente') return C.ms(ultimo.creado_en) > C.ms(seg.visto_cliente);
  if (C.ms(ultimo.creado_en) <= C.ms(seg.visto_agente)) return false;
  const filtro = ultimo.whatsapp_id ? `mensaje_id.eq.${ultimo.id},whatsapp_id.eq.${ultimo.whatsapp_id}` : `mensaje_id.eq.${ultimo.id}`;
  const { data: propio } = await db.from('siguelo_cola').select('id').or(filtro).limit(1);
  return !propio?.length;
}

type Resultado = 'sigue' | 'enviado' | 'error' | 'tope';

async function intentar(item: ColaRow, aj: AjustesRow, franja: Franja, ahora: number, usados: number): Promise<Resultado> {
  const [{ data: contacto }, { data: seg }] = await Promise.all([
    db.from('contactos').select('id, nombre, telefono, etapa_id').eq('id', item.contacto_id).maybeSingle(),
    db.from('siguelo_seguimientos').select('*').eq('contacto_id', item.contacto_id).maybeSingle(),
  ]);
  if (!contacto || !seg) {
    await cancelarInterno(item, 'El contacto ya no existe');
    return 'sigue';
  }
  if (contacto.etapa_id !== item.etapa_id) {
    await cancelarInterno(item, 'Cambió de etapa');
    return 'sigue';
  }
  if (seg.pausado) return 'sigue'; // queda pendiente hasta que lo reanudes
  const est = estadoContacto(seg);
  const tipo = item.tipo === 'rec' ? 'rec' : 'react';
  const st = tipo === 'rec' ? est.rec : est.react;
  if (!st || C.tokenDe(tipo, est) !== item.token || st.paso !== item.paso || (item.tipo === 'react' && !est.react?.activo)) {
    await cancelarInterno(item, 'Ya no corresponde');
    return 'sigue';
  }
  if (item.tipo === 'rec' && seg.respondio) return 'sigue';
  if (await hayNovedadSinRevisar(item, seg)) return 'sigue';

  // Demasiado atrasado (por ejemplo, la computadora estuvo apagada): ya no tiene
  // sentido. Se mide desde la hora en que podía salir dentro del horario.
  if (item.max_atraso_ms && ahora - ajustar(C.ms(item.vence), franja) > item.max_atraso_ms) {
    await cerrar(item, 'cancelado', 'Demasiado atrasado', { atrasado: true });
    await registrar(aj.empresa_id, item.contacto_id, 'cola', `${contacto.nombre || contacto.telefono}: se canceló "${item.nombre}" por atraso.`);
    return 'sigue';
  }
  // Mínimo entre dos mensajes automáticos de este número a la misma persona.
  if (ahora < (await ultimoAutomatico(item.contacto_id, item.linea_id)) + aj.min_entre_misma_persona_min * MIN) return 'sigue';
  if (usados >= aj.maximo_diario) return 'tope';

  const sesion = obtenerSesion(item.linea_id);
  if (!sesion || sesion.estado !== 'activo') return 'sigue'; // espera a que la línea se reconecte

  const variables = await variablesDeLinea(item.linea_id);
  const elegido = elegirVariante(item.variantes, contacto.nombre, seg.ultimo_texto_auto, variables);
  if (!elegido.texto) {
    const motivo = elegido.faltan.length ? `Falta completar ${elegido.faltan.join(', ')} para este número` : 'El mensaje no tiene texto';
    await cerrar(item, 'cancelado', motivo);
    await registrar(aj.empresa_id, item.contacto_id, 'error', `${contacto.nombre || contacto.telefono}: no salió "${item.nombre}" (${motivo}).`);
    return 'sigue';
  }
  // Reclama el mensaje: si otra vuelta ya lo tomó, no devuelve nada.
  const { data: reclamado } = await db.from('siguelo_cola').update({ estado: 'enviando' }).eq('id', item.id).eq('estado', 'pendiente').select('id');
  if (!reclamado?.length) return 'sigue';

  const e = estadoLinea(aj, item.linea_id);
  // Si está activo, la IA lo adapta a la conversación (si falla, sale el que escribiste).
  const adaptado = await adaptarMensaje(aj, item, contacto.nombre, elegido.texto).catch(() => null);
  if (adaptado && 'omitir' in adaptado) {
    await cerrar(item, 'cancelado', `La IA no lo mandó: ${adaptado.omitir}`);
    await registrar(aj.empresa_id, item.contacto_id, 'cola', `${contacto.nombre || contacto.telefono}: la IA no mandó "${item.nombre}" (${adaptado.omitir}).`);
    return 'sigue';
  }
  const texto = agregarPie(adaptado ? adaptado.texto : elegido.texto, aj.pie, contacto.nombre, variables);

  try {
    const jid = item.telefono.includes('@') ? item.telefono : `${item.telefono}@s.whatsapp.net`;
    const resultado = await sesion.sock.sendMessage(jid, await construirContenidoWA({ tipo: 'texto', texto }));
    const whatsappId = resultado?.key?.id || null;
    if (whatsappId) marcarEnviadoPorCRM(whatsappId);
    const { data: mensaje } = await db
      .from('mensajes')
      .insert({ conversacion_id: item.conversacion_id, remitente: 'agente', agente_id: null, tipo: 'texto', contenido: texto, whatsapp_id: whatsappId })
      .select('id')
      .single();
    await cerrar(item, 'enviado', null, { texto, mensaje_id: mensaje?.id ?? null, whatsapp_id: whatsappId });
    await sumarEnviado(aj.empresa_id, item.linea_id, fechaDe(ahora, franja.zona));
    await registrar(aj.empresa_id, item.contacto_id, 'enviado', `${contacto.nombre || contacto.telefono}: salió "${item.nombre}"${adaptado ? ' (adaptado por la IA a la conversación)' : ''}.`);
    e.erroresSeguidos = 0;
    e.proximo = Date.now() + azarMs(aj);
    return 'enviado';
  } catch (err) {
    const motivo = (err as Error).message.slice(0, 200);
    await cerrar(item, 'error', motivo);
    await registrar(aj.empresa_id, item.contacto_id, 'error', `${contacto.nombre || contacto.telefono}: no se pudo enviar "${item.nombre}" (${motivo}).`);
    e.erroresSeguidos++;
    e.proximo = Date.now() + azarMs(aj);
    if (e.erroresSeguidos >= ERRORES_PARA_PAUSAR) {
      e.erroresSeguidos = 0;
      await db.from('siguelo_ajustes').update({ pausado: true, motivo_pausa: `${ERRORES_PARA_PAUSAR} errores de envío seguidos en un número` }).eq('empresa_id', aj.empresa_id);
      await registrar(aj.empresa_id, null, 'pausa', `Se pausó todo después de ${ERRORES_PARA_PAUSAR} errores de envío seguidos en un número. Revisa la línea en Conexiones y quita la pausa en Seguimiento → Ajustes.`);
    }
    return 'error';
  }
}

// Mensaje de una cita: con prioridad, en su franja, sin contar para el tope ni el mínimo por persona.
async function intentarCita(item: ColaRow, aj: AjustesRow, franja: Franja, ahora: number): Promise<Resultado> {
  const cita = await citaVigente(item);
  if (!cita) {
    await cancelarInterno(item, 'La cita cambió o se quitó');
    return 'sigue';
  }
  if (item.max_atraso_ms && ahora - ajustar(C.ms(item.vence), franja) > item.max_atraso_ms) {
    await cancelarInterno(item, 'Demasiado atrasado');
    await avanzarCita(item, false);
    return 'sigue';
  }
  const { data: contacto } = await db.from('contactos').select('id, nombre, telefono, etapa_id').eq('id', item.contacto_id).maybeSingle();
  if (!contacto) {
    await cancelarInterno(item, 'El contacto ya no existe');
    return 'sigue';
  }
  const sesion = obtenerSesion(item.linea_id);
  if (!sesion || sesion.estado !== 'activo') return 'sigue';
  const { data: seg } = await db.from('siguelo_seguimientos').select('ultimo_texto_auto').eq('contacto_id', item.contacto_id).maybeSingle();
  const variables = { ...(await variablesDeLinea(item.linea_id)), ...variablesCita(cita, aj.zona_horaria) };
  const elegido = elegirVariante(item.variantes, contacto.nombre, seg?.ultimo_texto_auto, variables);
  if (!elegido.texto) {
    await cancelarInterno(item, elegido.faltan.length ? `Falta completar ${elegido.faltan.join(', ')} para este número` : 'El mensaje no tiene texto');
    await avanzarCita(item, false);
    return 'sigue';
  }
  const { data: reclamado } = await db.from('siguelo_cola').update({ estado: 'enviando' }).eq('id', item.id).eq('estado', 'pendiente').select('id');
  if (!reclamado?.length) return 'sigue';
  const e = estadoLinea(aj, item.linea_id);
  try {
    const jid = item.telefono.includes('@') ? item.telefono : `${item.telefono}@s.whatsapp.net`;
    const resultado = await sesion.sock.sendMessage(jid, { text: elegido.texto });
    const whatsappId = resultado?.key?.id || null;
    if (whatsappId) marcarEnviadoPorCRM(whatsappId);
    const { data: mensaje } = await db
      .from('mensajes')
      .insert({ conversacion_id: item.conversacion_id, remitente: 'agente', agente_id: null, tipo: 'texto', contenido: elegido.texto, whatsapp_id: whatsappId })
      .select('id')
      .single();
    await cerrar(item, 'enviado', null, { texto: elegido.texto, mensaje_id: mensaje?.id ?? null, whatsapp_id: whatsappId });
    await avanzarCita(item, true);
    await registrar(aj.empresa_id, item.contacto_id, 'enviado', `${contacto.nombre || contacto.telefono}: salió "${item.nombre}".`);
    e.proximo = Date.now() + (5 + Math.random() * 15) * 1000; // después de una cita, una pausa corta
    return 'enviado';
  } catch (err) {
    const motivo = (err as Error).message.slice(0, 200);
    await cerrar(item, 'error', motivo);
    await avanzarCita(item, false);
    e.proximo = Date.now() + azarMs(aj);
    return 'error';
  }
}

// Una vuelta de la cola: cada número manda como mucho un mensaje.
export async function procesarCola(aj: AjustesRow): Promise<void> {
  if (aj.pausado) return;
  const ahora = Date.now();
  const franja: Franja = { zona: aj.zona_horaria, desde: aj.hora_inicio, hasta: aj.hora_fin };
  // Los mensajes de las citas tienen su propia franja (por ejemplo 7:00 a 21:00).
  const franjaCitas: Franja = { zona: aj.zona_horaria, desde: aj.citas?.desde || '07:00', hasta: aj.citas?.hasta || '21:00' };
  const enHorario = enFranja(ahora, franja);
  if (!enHorario && !enFranja(ahora, franjaCitas)) return;
  const fecha = fechaDe(ahora, franja.zona);

  const { data: vencidos } = await db
    .from('siguelo_cola')
    .select('*')
    .eq('empresa_id', aj.empresa_id)
    .eq('estado', 'pendiente')
    .lte('vence', new Date(ahora).toISOString())
    .order('vence')
    .order('creado_en')
    .limit(50);
  if (!vencidos?.length) return;
  // Las citas primero: tienen hora fija.
  vencidos.sort((a, b) => Number(b.tipo === 'cita') - Number(a.tipo === 'cita'));

  const listas = new Set<string>(); // números que ya terminaron esta vuelta
  const usados = new Map<string, number>();
  for (const item of vencidos) {
    const linea = item.linea_id;
    const e = estadoLinea(aj, linea);
    const esCita = item.tipo === 'cita';
    if (listas.has(linea) || ahora < e.proximo) continue;
    if (esCita ? !enFranja(ahora, franjaCitas) : !enHorario || !arranco(e, ahora, franja, fecha)) continue;
    if (!usados.has(linea)) usados.set(linea, await enviadosHoy(aj.empresa_id, linea, fecha));
    const r = esCita ? await intentarCita(item, aj, franjaCitas, ahora) : await intentar(item, aj, franja, ahora, usados.get(linea)!);
    if (r !== 'sigue') listas.add(linea);
  }
}
