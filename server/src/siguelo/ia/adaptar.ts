import { db } from '../db.js';
import { negocioDeLinea } from '../negocios.js';
import { empresasConIA, llamar } from './config.js';
import { describirEstilo } from './contexto.js';
import { datosClubParaIA } from '../club/club.js';
import { fechaDe } from '../horario.js';
import type { AjustesRow, ColaRow } from '../tipos.js';

// La IA adapta cada recordatorio y reactivación a la conversación justo antes
// de enviarlo: el mensaje que escribiste es la base (qué decir), la ficha del
// negocio pone los datos y la conversación da la continuidad. Si la IA falla o
// no está activa, sale el texto que escribiste. Era "adaptar recordatorios" en
// la IA de la extensión.

export type Adaptado = { texto: string } | { omitir: string } | null;

const MAX_MENSAJES = 20;
const quien = { cliente: 'Cliente', agente: 'Nosotros' } as const;

export async function adaptarMensaje(aj: AjustesRow, item: Pick<ColaRow, 'tipo' | 'linea_id' | 'conversacion_id' | 'nombre'>, nombreCliente: string | null, base: string): Promise<Adaptado> {
  const ad = aj.adaptar;
  if (!ad?.activo || item.tipo === 'cita' || (item.tipo === 'rec' ? !ad.recordatorios : !ad.reactivaciones)) return null;
  const c = (await empresasConIA()).find((x) => x.ia.empresa_id === aj.empresa_id);
  if (!c) return null;

  const { data } = await db
    .from('mensajes')
    .select('remitente, tipo, contenido, creado_en')
    .eq('conversacion_id', item.conversacion_id)
    .order('creado_en', { ascending: false })
    .limit(MAX_MENSAJES);
  const lista = (data || []).reverse();
  // Sin nada que haya dicho el cliente no hay a qué darle continuidad.
  if (!lista.some((m) => m.remitente === 'cliente')) return null;

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat('es', { timeZone: c.zona, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const negocio = await negocioDeLinea(item.linea_id);
  const ficha = negocio
    ? [`Nombre: ${negocio.nombre}`, negocio.sucursal && `Sucursal: ${negocio.sucursal}`, negocio.direccion && `Dirección: ${negocio.direccion}`, negocio.horario && `Horario: ${negocio.horario}`, negocio.info_ia?.trim()]
        .filter(Boolean)
        .join('\n')
    : '(sin ficha)';
  const club = await datosClubParaIA(aj.empresa_id, negocio?.club_sucursal_id, fechaDe(Date.now(), c.zona));
  const tipo = item.tipo === 'rec' ? 'un RECORDATORIO (el cliente no avanzó y se le recuerda)' : 'una REACTIVACIÓN (se le escribió y no respondió)';

  const sistema = `Eres quien atiende el WhatsApp de un negocio. Vas a enviar ${tipo} a un cliente. Te doy el mensaje base que escribió el dueño y la conversación.
Reescríbelo para que suene como la continuación natural de ESTA conversación: retoma lo último que se habló (lo que preguntó, lo que le interesó, lo que quedó pendiente) y termina con una pregunta corta y fácil de responder.

Reglas:
- Mantén la intención del mensaje base y más o menos su largo. Si el base trae un dato (precio, fecha, link), consérvalo.
- Usa solo datos de la ficha del negocio y de la conversación: no inventes precios, fechas, promociones ni nada.
- No repitas algo que ya se le dijo con las mismas palabras. Si la conversación es de hoy, no vuelvas a saludar como si fuera la primera vez.
- No digas que es un mensaje automático ni hables del CRM o de la IA.
- Estilo: ${describirEstilo(c.ia.estilo)}.${c.ia.estilo.usar_nombre ? ' Puedes usar el nombre del cliente si es un nombre de persona.' : ' No uses el nombre del cliente.'}${ad.instrucciones?.trim() ? `\n- Instrucciones del dueño para estos mensajes: ${ad.instrucciones.trim()}` : ''}
- Si en la conversación el cliente ya compró, dijo claramente que no le interesa o pidió que no le escriban, no se envía: "enviar": false.

FICHA DEL NEGOCIO:
"""
${ficha}
"""
${club ? `
HORARIOS, CUPOS Y PRECIOS EN VIVO (sistema del club; no ofrezcas grupos LLENOS):
"""
${club}
"""
` : ''}
Devuelve SOLO este JSON: {"enviar": true/false, "texto": "el mensaje final", "motivo": "si no se envía, por qué (una frase)"}`;

  const usuario = `Mensaje: ${item.nombre}
Nombre del cliente en WhatsApp: ${nombreCliente || '(sin nombre)'}
Fecha y hora actual: ${fecha(new Date().toISOString())}

MENSAJE BASE:
"""
${base}
"""

CONVERSACIÓN (la más antigua primero):
${lista.map((m) => `[${fecha(m.creado_en)}] ${quien[m.remitente]}: ${m.tipo === 'texto' ? m.contenido || '' : `[${m.tipo}] ${m.contenido || ''}`.trim()}`).join('\n')}`;

  const r = await llamar(c, [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario },
  ]);
  if (!r.ok) return null;
  if (r.json.enviar === false) return { omitir: String(r.json.motivo || 'no corresponde según la conversación').trim().slice(0, 200) };
  const texto = String(r.json.texto ?? '').trim();
  // Un texto vacío, larguísimo o con una variable sin llenar no sale: sale el base.
  if (!texto || texto.length > 1500 || /\{[\p{L}_]+\}/u.test(texto)) return null;
  return { texto };
}
