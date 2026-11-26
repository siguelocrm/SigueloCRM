import type { WASocket } from '@whiskeysockets/baileys';
import { supabase } from '../supabase/client.js';
import type { FlujoBot, NodoFlujo, PasoRespuestaAutomatica } from '../types/dominio.js';
import { palabraQueCoincide } from './coincidencia.js';
import { jidDestino } from './destino.js';
import { enviarPaso, variablesDelContacto } from './bot-automatico.js';

// Un cliente que no contesta una pregunta en este tiempo deja de estar "dentro"
// del flujo: su próximo mensaje se trata como uno nuevo.
const VIGENCIA_SESION_MS = 24 * 60 * 60 * 1000;
// Freno por si alguien arma un ciclo sin preguntas ni esperas (A → B → A…).
const MAX_NODOS_POR_EJECUCION = 60;

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PAUSA_ENTRE_MENSAJES_MS = 900;

function siguienteNodo(flujo: FlujoBot, nodoId: string, handle?: string): NodoFlujo | null {
  const conexion = flujo.edges.find((e) => e.source === nodoId && (handle === undefined ? !e.sourceHandle || e.sourceHandle === 'out' : e.sourceHandle === handle));
  if (!conexion) return null;
  return flujo.nodes.find((n) => n.id === conexion.target) ?? null;
}

function nodoAPaso(nodo: NodoFlujo): PasoRespuestaAutomatica | null {
  const d = nodo.data;
  switch (nodo.type) {
    case 'texto':
    case 'pregunta':
      return d.contenido?.trim() ? { tipo: 'texto', contenido: d.contenido, media_url: null } : null;
    case 'imagen':
      return d.media_url ? { tipo: 'imagen', contenido: d.contenido || '', media_url: d.media_url } : null;
    case 'pdf':
      return d.media_url ? { tipo: 'pdf', contenido: d.contenido || 'documento.pdf', media_url: d.media_url } : null;
    case 'espera':
      return { tipo: 'espera', contenido: null, media_url: null, duracion_segundos: d.duracion_segundos ?? 5 };
    default:
      return null;
  }
}

async function guardarSesion(conversacionId: string, reglaId: string, nodoId: string, lineaId: string, telefono: string) {
  await supabase.from('bot_sesiones').upsert(
    { conversacion_id: conversacionId, regla_id: reglaId, nodo_id: nodoId, linea_id: lineaId, telefono, actualizado_en: new Date().toISOString() },
    { onConflict: 'conversacion_id' },
  );
}

async function borrarSesion(conversacionId: string) {
  await supabase.from('bot_sesiones').delete().eq('conversacion_id', conversacionId);
}

// Recorre el flujo desde `inicio`, mandando cada nodo por WhatsApp, hasta que
// termina o llega a una "pregunta" (ahí queda esperando la respuesta del cliente).
async function recorrer(
  sock: WASocket,
  lineaId: string,
  empresaId: string | undefined,
  conversacionId: string,
  telefono: string,
  reglaId: string,
  flujo: FlujoBot,
  inicio: NodoFlujo | null,
): Promise<void> {
  const jid = await jidDestino(sock, telefono); // SígueloCRM: el ID interno de WhatsApp (LID) también llega
  const variables = await variablesDelContacto(lineaId, telefono, empresaId);
  let nodo = inicio;
  let enviados = 0;

  for (let i = 0; nodo && i < MAX_NODOS_POR_EJECUCION; i++) {
    if (nodo.type === 'fin') {
      await borrarSesion(conversacionId);
      return;
    }

    const paso = nodoAPaso(nodo);
    if (paso) {
      if (paso.tipo !== 'espera' && enviados > 0) await espera(PAUSA_ENTRE_MENSAJES_MS);
      try {
        await enviarPaso(sock, jid, conversacionId, paso, variables);
        if (paso.tipo !== 'espera') enviados++;
      } catch (err) {
        console.error(`[${lineaId}] Error enviando nodo "${nodo.type}" del flujo:`, (err as Error).message);
      }
    }

    if (nodo.type === 'pregunta') {
      await guardarSesion(conversacionId, reglaId, nodo.id, lineaId, telefono);
      return;
    }

    nodo = siguienteNodo(flujo, nodo.id);
  }

  // Llegó al final de una rama sin pregunta: el flujo terminó.
  await borrarSesion(conversacionId);
}

export async function iniciarFlujo(
  sock: WASocket,
  lineaId: string,
  empresaId: string | undefined,
  conversacionId: string,
  telefono: string,
  reglaId: string,
  flujo: FlujoBot,
): Promise<void> {
  const inicio = flujo.nodes.find((n) => n.type === 'inicio');
  if (!inicio) return;
  await recorrer(sock, lineaId, empresaId, conversacionId, telefono, reglaId, flujo, siguienteNodo(flujo, inicio.id));
}

// Si esta conversación está esperando la respuesta a una pregunta de un flujo,
// la procesa y devuelve true (el mensaje ya fue atendido). Si no, devuelve false
// y el mensaje sigue su camino normal (reglas de palabra clave, etc.).
export async function continuarFlujo(
  sock: WASocket,
  lineaId: string,
  empresaId: string,
  conversacionId: string,
  telefono: string,
  textoCliente: string,
): Promise<boolean> {
  const { data: sesion } = await supabase
    .from('bot_sesiones')
    .select('regla_id, nodo_id, actualizado_en')
    .eq('conversacion_id', conversacionId)
    .maybeSingle();
  if (!sesion) return false;

  if (Date.now() - new Date(sesion.actualizado_en).getTime() > VIGENCIA_SESION_MS) {
    await borrarSesion(conversacionId);
    return false;
  }

  const { data: regla } = await supabase
    .from('respuestas_automaticas')
    .select('flujo, activo')
    .eq('id', sesion.regla_id)
    .maybeSingle();
  const flujo = regla?.flujo as FlujoBot | null | undefined;
  const pregunta = flujo?.nodes.find((n) => n.id === sesion.nodo_id);
  if (!regla?.activo || !flujo || !pregunta) {
    await borrarSesion(conversacionId);
    return false;
  }

  // ¿Qué opción de la pregunta eligió el cliente? Se prueban en orden; cada
  // opción acepta varias palabras y tolera errores de tipeo.
  const opcion = (pregunta.data.opciones || []).find(
    (o) =>
      palabraQueCoincide(textoCliente, {
        palabras_clave: o.palabras.length ? o.palabras : [o.etiqueta],
        modo_coincidencia: 'contiene',
        tolerancia_errores: true,
      }) !== null,
  );

  const destino = opcion ? siguienteNodo(flujo, pregunta.id, opcion.id) : siguienteNodo(flujo, pregunta.id, 'otro');

  if (!opcion && !destino) {
    // No entendimos la respuesta y no hay rama "otra respuesta": soltamos al
    // cliente del flujo para que lo atienda una persona u otra regla.
    await borrarSesion(conversacionId);
    return false;
  }

  await borrarSesion(conversacionId);
  await recorrer(sock, lineaId, empresaId, conversacionId, telefono, sesion.regla_id, flujo, destino);
  return true;
}
