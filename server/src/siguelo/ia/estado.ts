import { db } from '../db.js';
import { HORA, enFranja } from '../horario.js';
import { negocioDeLinea, olvidarNegocios } from '../negocios.js';
import { obtenerSesion } from '../../whatsapp/sesiones.js';

// "¿Por qué no responde?": revisa todo lo que puede dejar a la IA sin responder,
// en general y número por número (conectado, con su negocio, con información).

export type Revision = { ok: boolean; titulo: string; detalle?: string; aviso?: boolean };
export type EstadoIA = { general: Revision[]; numeros: { id: string; nombre: string; numero: string | null; negocio: string | null; revisiones: Revision[] }[]; listo: boolean };

const ultimos8 = (t: string | null | undefined) => String(t || '').replace(/\D/g, '').slice(-8);

export async function estadoIA(empresaId: string): Promise<EstadoIA> {
  olvidarNegocios();
  const [{ data: ia }, { data: clave }, { data: aj }, { data: lineas }, { data: error }] = await Promise.all([
    db.from('siguelo_ia').select('*').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_ia_clave').select('clave').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_ajustes').select('zona_horaria').eq('empresa_id', empresaId).maybeSingle(),
    db.from('lineas_whatsapp').select('id, nombre, numero').eq('empresa_id', empresaId).order('nombre'),
    db.from('siguelo_registro').select('texto, creado_en').eq('empresa_id', empresaId).eq('tipo', 'ia_error').gte('creado_en', new Date(Date.now() - 6 * HORA).toISOString()).order('creado_en', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const zona = aj?.zona_horaria || 'America/La_Paz';
  const general: Revision[] = [];
  general.push(ia?.activa ? { ok: true, titulo: 'La IA está activa' } : { ok: false, titulo: 'La IA está apagada', detalle: 'Actívala en IA → Ajustes.' });
  general.push(clave?.clave?.trim() ? { ok: true, titulo: 'Clave de OpenAI guardada' } : { ok: false, titulo: 'Falta la clave de OpenAI', detalle: 'Guárdala en IA → Ajustes ("Guardar y probar").' });
  if (ia) {
    general.push(
      ia.modo === 'automatico'
        ? { ok: true, titulo: 'Responde sola (modo Automática)' }
        : { ok: false, titulo: ia.modo === 'borrador' ? 'Está en modo "Para aprobar"' : 'La IA está en modo apagado', detalle: ia.modo === 'borrador' ? 'Escribe las respuestas pero NO las manda: esperan en IA → Resumen. Para que responda sola, en Ajustes elige "Automática".' : 'En Ajustes elige "Automática".' },
    );
    general.push(
      enFranja(Date.now(), { zona, desde: ia.desde, hasta: ia.hasta })
        ? { ok: true, titulo: `Dentro de su horario (${ia.desde} a ${ia.hasta})` }
        : { ok: false, titulo: `Fuera de su horario (${ia.desde} a ${ia.hasta})`, detalle: 'Ahora no responde: las respuestas salen cuando empiece la franja. Cámbiala en Ajustes si quieres que responda a toda hora (00:00 a 23:59).' },
    );
    const espera = Math.max(ia.espera_min_seg, ia.espera_max_seg);
    general.push(
      espera <= 3
        ? { ok: true, titulo: 'Responde en segundos' }
        : { ok: true, aviso: true, titulo: `Espera ${Math.min(ia.espera_min_seg, ia.espera_max_seg)} a ${espera} segundos antes de responder`, detalle: 'Para que responda en unos 5 segundos, en Ajustes pon "Espera antes de responder" de 0 a 2.' },
    );
    if (ia.max_por_cliente_dia < 25) general.push({ ok: true, aviso: true, titulo: `Responde sola como mucho ${ia.max_por_cliente_dia} veces por cliente al día`, detalle: 'En una conversación larga deja de responder sola (las demás quedan para aprobar). En Ajustes, sube "Máximo de respuestas por cliente al día" (por ejemplo a 40).' });
    if (ia.si_no_sabe !== 'espera') general.push({ ok: true, aviso: true, titulo: 'Si no sabe algo, el cliente no recibe nada', detalle: 'En Ajustes, "Si no sabe la respuesta" → "Manda un déjame consultarlo y te avisa".' });
  }
  if (error) general.push({ ok: false, titulo: 'Hubo un error hace poco', detalle: error.texto });
  // ¿La base está al día? (la columna de la ubicación y que acepte mandar el pin del mapa)
  const { error: sinColumna } = await db.from('siguelo_negocios').select('ubicacion').eq('empresa_id', empresaId).limit(1);
  const { data: prueba, error: sinTipo } = await db
    .from('siguelo_ia_salida')
    .insert({ empresa_id: empresaId, linea_id: (lineas || [])[0]?.id ?? empresaId, telefono: '0', origen: 'respuesta', tipo: 'ubicacion', contenido: '', estado: 'cancelado', motivo: 'Revisión de "¿Por qué no responde?"' })
    .select('id')
    .maybeSingle();
  if (prueba) await db.from('siguelo_ia_salida').delete().eq('id', prueba.id);
  general.push(
    sinColumna || sinTipo
      ? { ok: false, titulo: 'A tu base de datos le falta la última versión', detalle: 'En Supabase → SQL Editor, pega COMPLETO database/siguelo.sql y pulsa Run (sin eso no puede mandar la ubicación). Si sale un error en rojo, mándame una captura.' }
      : { ok: true, titulo: 'Base de datos al día' },
  );

  const personal = ultimos8(ia?.avisos?.telefono);
  const numeros: EstadoIA['numeros'] = [];
  for (const l of lineas || []) {
    const r: Revision[] = [];
    const sesion = obtenerSesion(l.id);
    r.push(sesion?.estado === 'activo' ? { ok: true, titulo: 'Conectado a WhatsApp' } : { ok: false, titulo: 'No está conectado a WhatsApp', detalle: 'No entran ni salen mensajes. Reconéctalo en Administrar → Conexiones.' });
    const negocio = await negocioDeLinea(l.id);
    if (!negocio) r.push({ ok: false, titulo: 'No está en ningún negocio', detalle: 'La IA no sabe qué responder por este número. En Administrar → Negocios, abre el negocio y elige este número.' });
    else {
      r.push(negocio.ia_activa ? { ok: true, titulo: `Responde con la información de "${negocio.nombre}"` } : { ok: false, titulo: `En "${negocio.nombre}" la IA está apagada`, detalle: 'En Administrar → Negocios, marca "La IA responde en los números de este negocio".' });
      const largo = (negocio.info_ia || '').trim().length;
      if (largo < 60) r.push({ ok: false, titulo: 'El negocio casi no tiene información para la IA', detalle: `En Administrar → Negocios → "${negocio.nombre}", escribe qué vendes, precios, horarios, dirección y preguntas frecuentes. Sin eso no sabe qué responder.` });
      if (!negocio.ubicacion?.trim()) r.push({ ok: true, aviso: true, titulo: 'Sin ubicación en Google Maps', detalle: 'Si te piden la ubicación, no puede mandar el pin del mapa.' });
    }
    if (personal && ultimos8(l.numero) === personal) r.push({ ok: true, aviso: true, titulo: 'Es el mismo número de tus avisos', detalle: 'Los avisos no te van a sonar: pon otro número personal en IA → Ajustes → Avisos.' });
    numeros.push({ id: l.id, nombre: l.nombre, numero: l.numero, negocio: negocio?.nombre ?? null, revisiones: r });
  }
  const listo = general.every((g) => g.ok) && numeros.some((n) => n.revisiones.every((x) => x.ok));
  return { general, numeros, listo };
}
