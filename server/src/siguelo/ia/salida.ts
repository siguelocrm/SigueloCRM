import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { MIN, fechaDe, instante } from '../horario.js';
import { registrar } from '../registro.js';
import { obtenerSesion } from '../../whatsapp/sesiones.js';
import { construirContenidoWA } from '../../whatsapp/contenido.js';
import { contenidoUbicacion, desempaquetar, linkDeMapa } from './ubicacion.js';
import { marcarEnviadoPorCRM } from '../../whatsapp/mensajes-enviados-por-crm.js';
import { enviarPasos } from '../../whatsapp/bot-automatico.js';
import { iniciarFlujo } from '../../whatsapp/flujo.js';
import type { IaRow, SalidaRow } from '../tipos.js';

// Envía lo que decidió la IA (lector.ts): sus respuestas, las respuestas
// rápidas, el link de un grupo, el pase a otra sucursal y los avisos a tu
// WhatsApp. Cada número manda de a un mensaje, con unos segundos entre uno y
// otro; los mensajes de una misma respuesta salen en orden.

type Config = { ia: IaRow; zona: string };

const LINEA_CAIDA_MAX_MS = 30 * MIN; // una respuesta que no pudo salir en este tiempo ya no tiene sentido
const MAX_POR_AVISO = 10;
const proximoPorLinea = new Map<string, number>();
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);
const jidDe = (telefono: string) => (telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`);

async function cerrar(ids: string[], cambios: Partial<SalidaRow>): Promise<void> {
  if (ids.length) await db.from('siguelo_ia_salida').update({ ...cambios, cerrado_en: new Date().toISOString() }).in('id', ids);
}

// Lo que quede sin mandar de la misma respuesta también se cancela.
async function cancelarLote(it: SalidaRow, motivo: string): Promise<void> {
  const consulta = db.from('siguelo_ia_salida').update({ estado: 'cancelado', motivo, cerrado_en: new Date().toISOString() }).in('estado', ['pendiente', 'borrador']);
  await (it.lote ? consulta.eq('lote', it.lote) : consulta.eq('id', it.id));
}

// ¿Sigue teniendo sentido? Si el cliente escribió otra vez (la IA lo vuelve a leer)
// o si le escribió una persona, no. Lo que aprobaste a mano sale igual.
async function vigente(it: SalidaRow): Promise<string> {
  if (it.aprobado || it.origen === 'pase' || !it.conversacion_id) return '';
  const { data: lectura } = await db.from('siguelo_ia_lecturas').select('sin_respuestas').eq('conversacion_id', it.conversacion_id).maybeSingle();
  if (lectura?.sin_respuestas) return 'La IA no le responde a este cliente';
  // Desde el último mensaje del cliente que leyó la IA (puede haber escrito mientras la IA pensaba).
  const desde = it.base_cliente && ms(it.base_cliente) < ms(it.creado_en) ? it.base_cliente : it.creado_en;
  const { data: despues } = await db
    .from('mensajes')
    .select('remitente, agente_id, creado_en')
    .eq('conversacion_id', it.conversacion_id)
    .gt('creado_en', desde)
    .limit(30);
  if ((despues || []).some((m) => m.remitente === 'cliente')) return 'El cliente escribió otra vez (la IA vuelve a leer)';
  if ((despues || []).some((m) => m.remitente === 'agente' && m.agente_id && ms(m.creado_en) > ms(it.creado_en))) return 'Le escribió una persona';
  return '';
}

// Conversación del cliente en ese número (para el pase): la abierta, la última, o una nueva.
async function conversacionDe(lineaId: string, telefono: string): Promise<string | null> {
  const { data: abierta } = await db.from('conversaciones').select('id').eq('linea_id', lineaId).eq('contacto_telefono', telefono).eq('estado', 'abierto').maybeSingle();
  if (abierta) return abierta.id;
  const { data: vieja } = await db
    .from('conversaciones')
    .select('id')
    .eq('linea_id', lineaId)
    .eq('contacto_telefono', telefono)
    .order('ultima_actividad', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vieja) {
    await db.from('conversaciones').update({ estado: 'abierto', ultima_actividad: new Date().toISOString() }).eq('id', vieja.id);
    return vieja.id;
  }
  const { data: nueva } = await db.from('conversaciones').insert({ linea_id: lineaId, contacto_telefono: telefono, estado: 'abierto' }).select('id').maybeSingle();
  if (nueva) return nueva.id;
  // Otro proceso la creó al mismo tiempo (índice único de conversaciones abiertas).
  const { data: otra } = await db.from('conversaciones').select('id').eq('linea_id', lineaId).eq('contacto_telefono', telefono).eq('estado', 'abierto').maybeSingle();
  return otra?.id ?? null;
}

async function enviarAlCliente(c: Config, it: SalidaRow): Promise<void> {
  const motivo = await vigente(it);
  if (motivo) return cancelarLote(it, motivo);

  const sesion = obtenerSesion(it.linea_id);
  if (!sesion || sesion.estado !== 'activo') {
    if (Date.now() - ms(it.vence) > LINEA_CAIDA_MAX_MS) {
      await cerrar([it.id], { estado: 'error', motivo: 'La línea de WhatsApp no estaba conectada' });
    }
    return; // espera a que la línea se reconecte
  }
  const { data: reclamado } = await db.from('siguelo_ia_salida').update({ estado: 'enviando' }).eq('id', it.id).eq('estado', 'pendiente').select('id');
  if (!reclamado?.length) return;

  try {
    const conversacionId = it.conversacion_id ?? (await conversacionDe(it.linea_id, it.telefono));
    if (!conversacionId) throw new Error('No se pudo abrir la conversación en ese número');
    // La IA activó una regla o flujo del bot: lo manda el bot del CRM, como si el cliente hubiera escrito su palabra clave.
    if (it.origen === 'bot') {
      const { data: regla } = await db.from('respuestas_automaticas').select('id, tipo, flujo, pasos, activo').eq('id', it.referencia ?? '').maybeSingle();
      if (!regla?.activo) throw new Error('La regla del bot ya no existe o está apagada');
      if (regla.tipo === 'flujo' && regla.flujo) await iniciarFlujo(sesion.sock, it.linea_id, c.ia.empresa_id, conversacionId, it.telefono, regla.id, regla.flujo as Parameters<typeof iniciarFlujo>[6]);
      else await enviarPasos(sesion.sock, it.linea_id, conversacionId, it.telefono, regla.pasos as Parameters<typeof enviarPasos>[4], c.ia.empresa_id);
      await cerrar([it.id], { estado: 'enviado', conversacion_id: conversacionId });
      await registrar(c.ia.empresa_id, it.contacto_id, 'ia', `IA activó ${it.contenido.replace(/^Activa /, '')} para +${it.telefono.split('@')[0]}.`);
      return;
    }
    // La ubicación sale como pin del mapa; en el chat del CRM queda como texto con el link.
    const lugar = it.tipo === 'ubicacion' ? desempaquetar(it.contenido) : null;
    const contenido = lugar
      ? await contenidoUbicacion(lugar.ubicacion, lugar.nombre, lugar.direccion)
      : await construirContenidoWA({ tipo: it.tipo, texto: it.contenido, media_url: it.media_url, mimetype: it.mimetype });
    const resultado = await sesion.sock.sendMessage(jidDe(it.telefono), contenido);
    const whatsappId = resultado?.key?.id || null;
    if (whatsappId) marcarEnviadoPorCRM(whatsappId);
    const { data: mensaje } = await db
      .from('mensajes')
      .insert({
        conversacion_id: conversacionId,
        remitente: 'agente',
        agente_id: null,
        tipo: lugar ? 'texto' : it.tipo,
        contenido: lugar ? `📍 Ubicación de ${lugar.nombre}${lugar.direccion ? ` (${lugar.direccion})` : ''}: ${linkDeMapa(lugar.ubicacion)}` : it.contenido || null,
        media_url: it.tipo === 'texto' || lugar ? null : it.media_url,
        whatsapp_id: whatsappId,
      })
      .select('id')
      .single();
    await cerrar([it.id], { estado: 'enviado', conversacion_id: conversacionId, mensaje_id: mensaje?.id ?? null, whatsapp_id: whatsappId });
    if (it.origen === 'respuesta' && it.referencia === 'espera') {
      await db.from('siguelo_ia_lecturas').update({ espera_enviada: new Date().toISOString() }).eq('conversacion_id', conversacionId);
    }
    if (it.origen === 'respuesta' || it.origen === 'pase') {
      const que = it.origen === 'pase' ? 'le escribió por el pase' : 'le respondió';
      await registrar(c.ia.empresa_id, it.contacto_id, 'ia', `IA ${que} a +${it.telefono.split('@')[0]}: "${it.contenido.slice(0, 120)}"`);
    }
  } catch (err) {
    const motivo = (err as Error).message.slice(0, 200);
    await cerrar([it.id], { estado: 'error', motivo });
    await cancelarLote(it, 'No salió el mensaje anterior de esta respuesta');
    await registrar(c.ia.empresa_id, it.contacto_id, 'ia_error', `IA: no se pudo enviar a +${it.telefono.split('@')[0]} (${motivo}).`);
  }
}

// ---------- Avisos a tu WhatsApp ----------

// Tu número personal como lo necesita WhatsApp: con código de país (8 dígitos de Bolivia → 591…).
export function numeroPersonal(crudo: string | null | undefined): string {
  const t = String(crudo || '').replace(/\D/g, '');
  return /^[67]\d{7}$/.test(t) ? `591${t}` : t;
}
const mismoNumero = (a: string | null | undefined, b: string) => {
  const x = String(a || '').replace(/\D/g, '');
  return x.length >= 7 && b.length >= 7 && (x.endsWith(b.slice(-8)) || b.endsWith(x.slice(-8)));
};

type Salida = { lineaId: string; sock: NonNullable<ReturnType<typeof obtenerSesion>>['sock'] };
// Desde qué número sale el aviso: el elegido (o el del cliente), conectado y que no sea tu mismo número
// (WhatsApp no te notifica lo que te mandas a ti mismo). Si no, cualquier otro número conectado de la empresa.
async function salidaParaAviso(empresaId: string, preferida: string | null, telefono: string): Promise<Salida | { error: string; esperar?: boolean }> {
  const { data: lineas } = await db.from('lineas_whatsapp').select('id, nombre, numero').eq('empresa_id', empresaId);
  const todas = lineas || [];
  const orden = [...todas.filter((l) => l.id === preferida), ...todas.filter((l) => l.id !== preferida)];
  for (const l of orden) {
    const s = obtenerSesion(l.id);
    const propio = s?.sock?.user?.id?.split(':')[0] || l.numero;
    if (s && s.estado === 'activo' && !mismoNumero(propio, telefono)) return { lineaId: l.id, sock: s.sock };
  }
  if (todas.length && todas.every((l) => mismoNumero(obtenerSesion(l.id)?.sock?.user?.id?.split(':')[0] || l.numero, telefono))) {
    return { error: 'tu número personal es el mismo número que tienes conectado al CRM: WhatsApp no te notifica los mensajes que te mandas a ti mismo. Pon otro número (por ejemplo el de tu celular personal) en IA → Ajustes → Avisos' };
  }
  return { error: 'ningún número del CRM está conectado (revisa Conexiones)', esperar: true };
}

// Para el botón "Mandarme un aviso de prueba" de Ajustes.
export async function enviarAvisoPrueba(empresaId: string, telefonoCrudo: string, lineaId: string | null): Promise<{ ok: true; numero: string; desde: string } | { ok: false; mensaje: string }> {
  const telefono = numeroPersonal(telefonoCrudo);
  if (telefono.length < 10) return { ok: false, mensaje: 'Escribe tu número personal con código de país, por ejemplo 59171234567.' };
  const s = await salidaParaAviso(empresaId, lineaId, telefono);
  if ('error' in s) return { ok: false, mensaje: `No se pudo: ${s.error}.` };
  try {
    const r = await s.sock.sendMessage(jidDe(telefono), { text: '🔔 *SígueloCRM*\n• Este es un aviso de prueba. Así te llegarán los avisos de la IA, de los pagos y de las redes. ✅' });
    if (r?.key?.id) marcarEnviadoPorCRM(r.key.id);
    const { data: l } = await db.from('lineas_whatsapp').select('nombre').eq('id', s.lineaId).maybeSingle();
    return { ok: true, numero: telefono, desde: l?.nombre || 'un número del CRM' };
  } catch (err) {
    return { ok: false, mensaje: `WhatsApp no lo pudo enviar: ${(err as Error).message}` };
  }
}

// Avisos a tu WhatsApp: los casos que se juntaron salen en un solo mensaje.
async function enviarAvisos(c: Config, primero: SalidaRow): Promise<void> {
  const { data: todos } = await db
    .from('siguelo_ia_salida')
    .select('*')
    .eq('empresa_id', c.ia.empresa_id)
    .eq('origen', 'aviso')
    .eq('estado', 'pendiente')
    .eq('telefono', primero.telefono)
    .order('creado_en');
  const pendientes = todos || [];
  if (!pendientes.length) return;
  const inicioHoy = new Date(instante(fechaDe(Date.now(), c.zona), '00:00', c.zona)).toISOString();
  const { data: hoy } = await db.from('siguelo_ia_salida').select('lote').eq('empresa_id', c.ia.empresa_id).eq('origen', 'aviso').eq('estado', 'enviado').gte('cerrado_en', inicioHoy);
  const enviadosHoy = new Set((hoy || []).map((x) => x.lote)).size;
  if (enviadosHoy >= (c.ia.avisos?.max_dia ?? 30)) {
    await cerrar(pendientes.map((x) => x.id), { estado: 'cancelado', motivo: `Se llegó al máximo de ${c.ia.avisos.max_dia} avisos de hoy (quedan en la pantalla IA)` });
    return;
  }
  const telefono = numeroPersonal(primero.telefono);
  const salida = await salidaParaAviso(c.ia.empresa_id, primero.linea_id, telefono);
  if ('error' in salida) {
    // Sin números conectados se espera; si el problema es tu número, se anota para que lo veas.
    if (salida.esperar && Date.now() - ms(primero.vence) < LINEA_CAIDA_MAX_MS) return;
    await cerrar(pendientes.map((x) => x.id), { estado: 'error', motivo: salida.error.slice(0, 200) });
    await registrar(c.ia.empresa_id, null, 'ia_error', `Avisos: no te llegó un aviso porque ${salida.error}.`);
    return;
  }
  const sesion = salida;
  const lote = pendientes.slice(0, MAX_POR_AVISO);
  const resto = pendientes.length - lote.length;
  const texto = ['🔔 *SígueloCRM*', ...lote.map((x) => x.contenido), resto ? `…y ${resto} más en la pantalla IA del CRM.` : ''].filter(Boolean).join('\n');
  const ids = lote.map((x) => x.id);
  const loteId = randomUUID();
  try {
    const resultado = await sesion.sock.sendMessage(jidDe(telefono), { text: texto });
    if (resultado?.key?.id) marcarEnviadoPorCRM(resultado.key.id);
    await cerrar(ids, { estado: 'enviado', lote: loteId, whatsapp_id: resultado?.key?.id || null });
  } catch (err) {
    await cerrar(ids, { estado: 'error', motivo: (err as Error).message.slice(0, 200) });
    await registrar(c.ia.empresa_id, null, 'ia_error', `Avisos: WhatsApp no pudo mandarte un aviso (${(err as Error).message.slice(0, 120)}).`);
  }
}

// Una vuelta: cada número manda como mucho un mensaje.
export async function procesarSalida(c: Config): Promise<void> {
  const ahora = Date.now();
  const { data: vencidos } = await db
    .from('siguelo_ia_salida')
    .select('*')
    .eq('empresa_id', c.ia.empresa_id)
    .eq('estado', 'pendiente')
    .lte('vence', new Date(ahora).toISOString())
    .order('vence')
    .order('orden')
    .limit(30);
  const usadas = new Set<string>();
  for (const it of vencidos || []) {
    if (usadas.has(it.linea_id) || ahora < (proximoPorLinea.get(it.linea_id) ?? 0)) continue;
    // Los mensajes de una misma respuesta salen en orden.
    if (it.lote && it.orden > 0) {
      const { count } = await db
        .from('siguelo_ia_salida')
        .select('id', { count: 'exact', head: true })
        .eq('lote', it.lote)
        .lt('orden', it.orden)
        .in('estado', ['borrador', 'pendiente', 'enviando']);
      if (count) continue;
    }
    usadas.add(it.linea_id);
    if (it.origen === 'aviso') await enviarAvisos(c, it);
    else await enviarAlCliente(c, it);
    proximoPorLinea.set(it.linea_id, Date.now() + (3 + Math.random() * 5) * 1000);
  }
}
