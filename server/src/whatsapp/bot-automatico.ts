import type { WASocket } from '@whiskeysockets/baileys';
import { supabase } from '../supabase/client.js';
import type { PasoRespuestaAutomatica, RespuestaAutomaticaRow } from '../types/dominio.js';
import { obtenerEmpresaIdDeLinea } from './empresa.js';
import { continuarFlujo, iniciarFlujo } from './flujo.js';
import { aplicarVariables, palabraQueCoincide } from './coincidencia.js';
import { reglasDelNumero } from '../siguelo/negocios.js';

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Pausa entre un paso y el siguiente de la misma regla, para que no le
// lleguen todos los mensajes pegados al cliente.
const PAUSA_ENTRE_PASOS_MS = 900;

// Busca entre las reglas activas de la empresa si el texto del cliente
// contiene alguna palabra clave y, si encuentra una, manda los pasos
// configurados (texto, imagen y/o PDF, en orden) por WhatsApp y los deja
// guardados en `mensajes` como si los hubiera escrito un agente
// (remitente 'agente', agente_id null).
export async function intentarResponderAutomaticamente(
  sock: WASocket,
  lineaId: string,
  empresaId: string,
  conversacionId: string,
  telefono: string,
  textoCliente: string,
): Promise<void> {
  if (!textoCliente.trim()) return;

  // Si el cliente está contestando una pregunta de un flujo, sigue ese flujo.
  if (await continuarFlujo(sock, lineaId, empresaId, conversacionId, telefono, textoCliente)) return;

  const { data: reglas, error } = await supabase
    .from('respuestas_automaticas')
    .select('id, tipo, flujo, palabra_clave, palabras_clave, modo_coincidencia, tolerancia_errores, disparador, pasos, demora_segundos')
    .eq('empresa_id', empresaId)
    .eq('activo', true);

  if (error || !reglas || reglas.length === 0) return;

  // Negocios por número (SígueloCRM): solo las reglas de todos y las del negocio de esta línea.
  const regla = await elegirRegla(await reglasDelNumero(reglas, lineaId), conversacionId, textoCliente);
  if (!regla) return;
  if (regla.tipo !== 'flujo' && regla.pasos.length === 0) return;
  if (regla.tipo === 'flujo' && !regla.flujo) return;

  // La demora no debe frenar el procesamiento de otros mensajes entrantes
  // (ver mensajes-entrantes.ts, que llama a esta función sin esperarla) —
  // acá adentro sí la esperamos, antes de mandar el primer paso.
  if (regla.demora_segundos > 0) await espera(regla.demora_segundos * 1000);

  if (regla.tipo === 'flujo' && regla.flujo) {
    await iniciarFlujo(sock, lineaId, empresaId, conversacionId, telefono, regla.id, regla.flujo);
    return;
  }

  await enviarPasos(sock, lineaId, conversacionId, telefono, regla.pasos, empresaId);
}

// Manda los pasos de una respuesta automática (texto/imagen/PDF/espera), en
// orden, por WhatsApp — lo usa tanto la detección automática de palabra
// clave de arriba como el botón "Mandar un bot a mano" del chat (ver
// server/src/routes/bot.ts).
export async function enviarPasos(
  sock: WASocket,
  lineaId: string,
  conversacionId: string,
  telefono: string,
  pasos: PasoRespuestaAutomatica[],
  empresaId?: string,
): Promise<void> {
  const variables = await variablesDelContacto(lineaId, telefono, empresaId);
  const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
  const inicio = new Date().toISOString();

  for (const [indice, paso] of pasos.entries()) {
    // Si el cliente contestó mientras esperábamos (ej. recordatorio a las 2 h),
    // el resto de la secuencia ya no tiene sentido: se corta acá.
    if (indice > 0 && pasos[indice - 1].tipo === 'espera' && (await clienteRespondioDesde(conversacionId, inicio))) {
      console.log(`[${lineaId}] El cliente respondió durante la espera: se cancelan los pasos restantes.`);
      return;
    }
    try {
      await enviarPaso(sock, jid, conversacionId, paso, variables);
    } catch (err) {
      console.error(`[${lineaId}] Error enviando paso de respuesta automática:`, (err as Error).message);
    }
    if (indice < pasos.length - 1) await espera(PAUSA_ENTRE_PASOS_MS);
  }
}

type ReglaCandidata = Pick<
  RespuestaAutomaticaRow,
  'id' | 'tipo' | 'flujo' | 'palabra_clave' | 'palabras_clave' | 'modo_coincidencia' | 'tolerancia_errores' | 'disparador' | 'pasos' | 'demora_segundos'
>;

// Inicio del día actual en Bolivia (UTC-4, sin horario de verano), para el
// disparador "primer mensaje del día".
function inicioDelDiaISO(): string {
  const ahoraBolivia = new Date(Date.now() - 4 * 3600 * 1000);
  ahoraBolivia.setUTCHours(0, 0, 0, 0);
  return new Date(ahoraBolivia.getTime() + 4 * 3600 * 1000).toISOString();
}

// Cuántos mensajes del cliente hay en la conversación desde una fecha (el que
// acaba de llegar ya está guardado, así que "1" significa "es el primero").
async function mensajesDelClienteDesde(conversacionId: string, desdeISO?: string): Promise<number> {
  let consulta = supabase
    .from('mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('conversacion_id', conversacionId)
    .eq('remitente', 'cliente');
  if (desdeISO) consulta = consulta.gte('creado_en', desdeISO);
  const { count } = await consulta;
  return count ?? 0;
}

// Elige qué regla responde: primero las de palabra clave (la más específica,
// es decir la de palabra más larga, gana si empatan varias); si ninguna
// empata, las de primer mensaje / primer mensaje del día / cualquier mensaje.
async function elegirRegla(
  reglas: ReglaCandidata[],
  conversacionId: string,
  textoCliente: string,
): Promise<ReglaCandidata | null> {
  let mejor: { regla: ReglaCandidata; largo: number } | null = null;
  for (const regla of reglas) {
    if (regla.disparador !== 'palabra_clave') continue;
    const palabras = regla.palabras_clave?.length ? regla.palabras_clave : [regla.palabra_clave];
    const palabra = palabraQueCoincide(textoCliente, { ...regla, palabras_clave: palabras });
    if (palabra && (!mejor || palabra.length > mejor.largo)) mejor = { regla, largo: palabra.length };
  }
  if (mejor) return mejor.regla;

  const generales = reglas.filter((r) => r.disparador !== 'palabra_clave');
  if (generales.length === 0) return null;

  const totalHistorico = await mensajesDelClienteDesde(conversacionId);
  const totalHoy = await mensajesDelClienteDesde(conversacionId, inicioDelDiaISO());
  return (
    generales.find((r) => r.disparador === 'primer_mensaje' && totalHistorico <= 1) ||
    generales.find((r) => r.disparador === 'primer_mensaje_del_dia' && totalHoy <= 1) ||
    generales.find((r) => r.disparador === 'cualquier_mensaje') ||
    null
  );
}

// Variables disponibles en los textos del bot: {nombre} y {telefono}.
export async function variablesDelContacto(
  lineaId: string,
  telefono: string,
  empresaIdConocida?: string,
): Promise<Record<string, string>> {
  const numero = telefono.split('@')[0];
  const variables: Record<string, string> = { nombre: '', telefono: numero };
  try {
    const empresaId = empresaIdConocida ?? (await obtenerEmpresaIdDeLinea(lineaId));
    if (!empresaId) return variables;
    const { data } = await supabase.from('contactos').select('nombre').eq('empresa_id', empresaId).eq('telefono', numero).maybeSingle();
    if (data?.nombre) variables.nombre = data.nombre.trim().split(/\s+/)[0];
  } catch {
    // sin nombre: la variable se reemplaza por vacío
  }
  return variables;
}

async function clienteRespondioDesde(conversacionId: string, desdeISO: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mensajes')
    .select('id')
    .eq('conversacion_id', conversacionId)
    .eq('remitente', 'cliente')
    .gt('creado_en', desdeISO)
    .limit(1);
  if (error) return false; // ante la duda, no bloqueamos el envío
  return !!data && data.length > 0;
}

export async function enviarPaso(
  sock: WASocket,
  jid: string,
  conversacionId: string,
  paso: PasoRespuestaAutomatica,
  variables: Record<string, string>,
): Promise<void> {
  if (paso.tipo === 'espera') {
    if (paso.duracion_segundos && paso.duracion_segundos > 0) await espera(paso.duracion_segundos * 1000);
    return;
  }

  let contenidoWA;
  if (paso.tipo === 'texto') {
    if (!paso.contenido) return;
    contenidoWA = { text: aplicarVariables(paso.contenido, variables) };
  } else if (paso.tipo === 'imagen') {
    if (!paso.media_url) return;
    contenidoWA = { image: { url: paso.media_url }, caption: paso.contenido ? aplicarVariables(paso.contenido, variables) : undefined };
  } else {
    if (!paso.media_url) return;
    contenidoWA = { document: { url: paso.media_url }, mimetype: 'application/pdf', fileName: paso.contenido || 'documento.pdf' };
  }

  const resultado = await sock.sendMessage(jid, contenidoWA);

  await supabase.from('mensajes').insert({
    conversacion_id: conversacionId,
    remitente: 'agente',
    agente_id: null,
    tipo: paso.tipo,
    contenido: paso.tipo === 'texto' && paso.contenido ? aplicarVariables(paso.contenido, variables) : paso.contenido,
    media_url: paso.tipo !== 'texto' ? paso.media_url : null,
    whatsapp_id: resultado?.key?.id || null,
  });
}
