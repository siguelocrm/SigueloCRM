import { db } from './db.js';
import { DIA } from './horario.js';
import * as C from './calculo.js';
import { registrar } from './registro.js';
import { negocioDeLinea } from './negocios.js';
import * as P from './palabras.js';
import { aplicarNombre } from './textos.js';
import { enviarTexto } from './envio.js';
import { revisarCitas } from './citas.js';
import type { ActividadRow, AjustesRow, ColaRow, EtapaConfigRow, EtapaVentaRow, SeguimientoRow, TipoSecuencia } from './tipos.js';

// Motor del embudo: cada minuto revisa a los contactos que están en una etapa
// con mensajes, se entera de quién respondió y a quién le escribiste a mano,
// los pasa de etapa cuando toca y deja en la cola exactamente lo que le
// corresponde a cada uno. Quien envía es cola.ts.

const TIPOS: TipoSecuencia[] = ['rec', 'react'];
const clave = (contactoId: string, tipo: string, paso: number, token: string) => `${contactoId}|${tipo}|${paso}|${token}`;
const nombreDe = (a: Pick<ActividadRow, 'nombre' | 'telefono'>) => a.nombre?.trim() || a.telefono.split('@')[0];

// Las conversaciones recientes que todavía no tienen ficha de contacto la
// reciben (igual que hace la Bandeja al abrirse), así un cliente nuevo entra
// al embudo aunque nadie tenga el CRM abierto.
async function asegurarContactos(empresaId: string): Promise<void> {
  const { data: lineas } = await db.from('lineas_whatsapp').select('id').eq('empresa_id', empresaId);
  const ids = (lineas || []).map((l) => l.id);
  if (!ids.length) return;
  const { data: chats } = await db
    .from('conversaciones')
    .select('contacto_telefono, contacto_nombre')
    .in('linea_id', ids)
    .gte('ultima_actividad', new Date(Date.now() - 3 * DIA).toISOString())
    .limit(1000);
  if (!chats?.length) return;
  const filas = new Map<string, { empresa_id: string; telefono: string; nombre: string | null }>();
  for (const c of chats) filas.set(c.contacto_telefono, { empresa_id: empresaId, telefono: c.contacto_telefono, nombre: c.contacto_nombre || null });
  const { error } = await db.from('contactos').upsert([...filas.values()], { onConflict: 'empresa_id,telefono', ignoreDuplicates: true });
  if (error) console.error('Seguimiento: no se pudieron crear las fichas de contacto:', error.message);
}

// Mismo cambio de etapa que hace la página (client/src/features/pipeline/useCambioEtapa.tsx):
// el contacto toma la probabilidad de la etapa y sus oportunidades abiertas la acompañan.
export async function cambiarEtapa(empresaId: string, contactoId: string, destino: EtapaVentaRow): Promise<void> {
  const ahora = new Date().toISOString();
  let motivoId: string | null = null;
  if (destino.tipo === 'perdida') {
    const { data } = await db.from('motivos_perdida').select('id').eq('empresa_id', empresaId).ilike('nombre', 'dej% de responder').limit(1).maybeSingle();
    motivoId = data?.id ?? null;
  }
  await db
    .from('contactos')
    .update({
      etapa_id: destino.id,
      etapa_actualizada_en: ahora,
      motivo_perdida_id: motivoId,
      ...(destino.probabilidad !== null ? { probabilidad_cierre: destino.probabilidad } : {}),
    })
    .eq('id', contactoId);
  if (destino.tipo === 'ganada' || destino.tipo === 'perdida') {
    await db
      .from('oportunidades')
      .update({ estado: destino.tipo, probabilidad: destino.tipo === 'ganada' ? 100 : 0, motivo_perdida_id: motivoId, cerrada_en: ahora, actualizado_en: ahora })
      .eq('contacto_id', contactoId)
      .eq('estado', 'abierta');
  } else if (destino.probabilidad !== null) {
    await db.from('oportunidades').update({ probabilidad: destino.probabilidad }).eq('contacto_id', contactoId).eq('estado', 'abierta');
  }
}

async function cancelarInterno(item: ColaRow, motivo: string): Promise<void> {
  await db.from('siguelo_cola').update({ estado: 'cancelado', motivo, cerrado_en: new Date().toISOString() }).eq('id', item.id).eq('estado', 'pendiente');
}

export async function revisarEmpresa(aj: AjustesRow): Promise<void> {
  const empresaId = aj.empresa_id;
  const ahora = Date.now();
  const activadoEn = C.ms(aj.activado_en) || ahora;

  await asegurarContactos(empresaId);

  const [etapasR, cfgR, actR, segR, colaR, manoR] = await Promise.all([
    db.from('etapas_venta').select('id, empresa_id, nombre, tipo, orden, probabilidad').eq('empresa_id', empresaId),
    db.from('siguelo_etapas').select('*').eq('empresa_id', empresaId),
    db.rpc('siguelo_actividad', { p_empresa: empresaId }),
    db.from('siguelo_seguimientos').select('*').eq('empresa_id', empresaId),
    db.from('siguelo_cola').select('*').eq('empresa_id', empresaId).eq('estado', 'pendiente'),
    db
      .from('siguelo_cola')
      .select('contacto_id, tipo, paso, token')
      .eq('empresa_id', empresaId)
      .eq('estado', 'cancelado')
      .eq('a_mano', true)
      .gte('cerrado_en', new Date(ahora - 30 * DIA).toISOString()),
  ]);
  const error = etapasR.error || cfgR.error || actR.error || segR.error || colaR.error || manoR.error;
  if (error) {
    console.error('Seguimiento: no se pudo leer la base:', error.message);
    return;
  }

  // De qué embudo es cada etapa (si la Fase 2 no está pegada, todas son del principal).
  const { data: deEmbudo } = await db.from('siguelo_etapa_embudo').select('etapa_id, embudo_id');
  const embudoDe = new Map((deEmbudo || []).map((e) => [e.etapa_id, e.embudo_id] as const));
  const etapas = new Map((etapasR.data || []).map((e) => [e.id, e] as const));
  const mismoEmbudo = (etapaId: string) => [...etapas.values()].filter((e) => (embudoDe.get(e.id) ?? null) === (embudoDe.get(etapaId) ?? null)).sort((x, y) => x.orden - y.orden);
  // Textos de cada etapa: los generales y los propios de algún negocio (que mandan sobre los generales).
  const cfgs = new Map((cfgR.data || []).map((c: EtapaConfigRow) => [`${c.etapa_id}|${c.negocio_id ?? ''}`, c] as const));
  const cfgDe = (etapaId: string, negocioId: string | null) => (negocioId && cfgs.get(`${etapaId}|${negocioId}`)) || cfgs.get(`${etapaId}|`) || null;
  const segs = new Map((segR.data || []).map((s: SeguimientoRow) => [s.contacto_id, s] as const));
  const pendientes = colaR.data || [];
  const cancelados = new Set((manoR.data || []).map((i) => clave(i.contacto_id, i.tipo, i.paso, i.token)));
  const revisados = new Set<string>();

  const contexto = (a: ActividadRow, etapa: EtapaVentaRow, negocioId: string | null): C.Contexto => {
    const cfg = etapa.tipo === 'perdida' ? null : cfgDe(etapa.id, negocioId);
    return {
      ahora,
      etapaId: etapa.id,
      cfg,
      entrada: C.fechaEntrada(a.etapa_actualizada_en, a.contacto_creado_en, a.primer_mensaje),
      activadoEn,
      ultimoCliente: C.ms(a.ultimo_cliente),
      ultimoManual: C.ms(a.ultimo_manual),
      ajustes: aj,
    };
  };

  for (const a of actR.data || []) {
    const inicial = etapas.get(a.etapa_id);
    if (!inicial) continue;
    let etapa: EtapaVentaRow = inicial;
    revisados.add(a.contacto_id);
    const nombre = nombreDe(a);
    const anotar = (tipo: string, texto: string) => registrar(empresaId, a.contacto_id, tipo, `${nombre}: ${texto}`);
    // Negocio del número de su chat: si tiene textos propios para la etapa, se usan esos.
    const negocioId = (await negocioDeLinea(a.linea_id))?.id ?? null;

    const previo = segs.get(a.contacto_id);
    // La primera vez que se lo ve, lo que ya pasó en su chat no cuenta como novedad.
    const seg: SeguimientoRow = previo ?? {
      contacto_id: a.contacto_id,
      empresa_id: empresaId,
      rec: null,
      react: null,
      respondio: false,
      pausado: false,
      visto_cliente: a.ultimo_cliente,
      visto_agente: a.ultimo_manual,
      ultimo_automatico: null,
      ultimo_texto_auto: null,
      creado_en: new Date(ahora).toISOString(),
      actualizado_en: new Date(ahora).toISOString(),
    };
    const est: C.EstadoContacto = {
      rec: seg.rec ? { ...seg.rec } : null,
      react: seg.react ? { ...seg.react } : null,
      respondio: seg.respondio,
      pausado: seg.pausado,
    };
    let ctx = contexto(a, etapa, negocioId);
    C.prepararRec(est, ctx);

    // Novedades desde la última vuelta, en orden: el cliente escribió / le escribiste a mano.
    const eventos: { ts: number; tipo: 'cliente' | 'manual' }[] = [];
    if (ctx.ultimoCliente > C.ms(seg.visto_cliente)) eventos.push({ ts: ctx.ultimoCliente, tipo: 'cliente' });
    if (ctx.ultimoManual > C.ms(seg.visto_agente)) eventos.push({ ts: ctx.ultimoManual, tipo: 'manual' });
    eventos.sort((x, y) => x.ts - y.ts);
    for (const ev of eventos) {
      const notas = ev.tipo === 'cliente' ? C.alMensajeCliente(est, !!a.ultimo_saliente) : C.alMensajeManual(est, ctx, ev.ts);
      for (const n of notas) await anotar(ev.tipo === 'cliente' ? 'respondio' : 'reactivacion', n);
    }

    // Palabras que cambian de etapa (Fase 4): lo nuevo que escribió el cliente y tus frases.
    let revisar = seg.revisar ?? null;
    let deshacer = seg.deshacer ?? null;
    let vistoAgente = a.ultimo_manual;
    if (previo && eventos.length) {
      const [{ data: delCliente }, { data: tuyos }] = await Promise.all([
        db.from('mensajes').select('id, remitente, contenido, creado_en').eq('conversacion_id', a.conversacion_id).eq('remitente', 'cliente').gt('creado_en', seg.visto_cliente ?? '1970-01-01').order('creado_en'),
        db.from('mensajes').select('id, remitente, contenido, creado_en').eq('conversacion_id', a.conversacion_id).eq('remitente', 'agente').gt('creado_en', seg.visto_agente ?? '1970-01-01').order('creado_en'),
      ]);
      const idsTuyos = (tuyos || []).map((m) => m.id);
      const { data: automaticos } = idsTuyos.length ? await db.from('siguelo_cola').select('mensaje_id').in('mensaje_id', idsTuyos) : { data: [] };
      const deCola = new Set((automaticos || []).map((x) => x.mensaje_id));
      const nuevos = [...(delCliente || []), ...(tuyos || []).filter((m) => !deCola.has(m.id))].sort((x, y) => C.ms(x.creado_en) - C.ms(y.creado_en));
      for (const m of nuevos) {
        if (etapa.tipo === 'perdida' || !m.contenido?.trim()) continue;
        const candidatas = mismoEmbudo(etapa.id)
          .filter((e) => e.id !== etapa.id)
          .map((e) => ({ id: e.id, palabras: P.normalizar(cfgDe(e.id, null)?.palabras) }));
        const destinoDe = (id: string) => etapas.get(id);
        const mover = async (destinoId: string, descripcion: string, respuesta: string) => {
          const destino = destinoDe(destinoId);
          if (!destino || destino.id === etapa.id) return;
          deshacer = { etapa_antes: etapa.id, desde_antes: a.etapa_actualizada_en, descripcion, ts: ahora };
          revisar = null;
          await cambiarEtapa(empresaId, a.contacto_id, destino);
          a.etapa_id = destino.id;
          a.etapa_actualizada_en = new Date(ahora).toISOString();
          etapa = destino;
          ctx = contexto(a, etapa, negocioId);
          C.prepararRec(est, ctx);
          est.respondio = false;
          if (est.react) est.react.activo = false;
          let nota = descripcion;
          if (respuesta.trim()) {
            const enviado = await enviarTexto(a.linea_id, a.telefono, a.conversacion_id, aplicarNombre(respuesta, a.nombre));
            if (enviado) {
              vistoAgente = enviado; // la respuesta no cuenta como mensaje tuyo
              nota += ' · se le respondió';
            }
          }
          await anotar('etapa', nota);
        };
        if (m.remitente === 'cliente') {
          const perdida = mismoEmbudo(etapa.id).find((e) => e.tipo === 'perdida')?.id ?? null;
          const d = P.decidirCliente(m.contenido, candidatas, aj.stop ?? null, perdida);
          if (d?.tipo === 'mover') {
            const destino = destinoDe(d.etapaId)!;
            await mover(d.etapaId, `escribió "${m.contenido.slice(0, 60)}": pasa a "${destino.nombre}"${d.por === 'stop' ? ' (no quiere más mensajes)' : ''}.`, d.respuesta);
          } else if (d?.tipo === 'revisar') {
            revisar = { etapa_id: d.etapaId, texto: m.contenido.slice(0, 300), ts: ahora };
            await anotar('revisar', `escribió "${m.contenido.slice(0, 60)}": ¿pasa a "${destinoDe(d.etapaId)?.nombre}"? Sus mensajes automáticos esperan que lo revises.`);
          }
        } else {
          const t = P.decidirTuyo(m.contenido, candidatas);
          if (t) await mover(t.etapaId, `le escribiste "${t.por}": pasa a "${destinoDe(t.etapaId)?.nombre}".`, '');
        }
      }
    }
    // Esperando que lo revises: no se mueve ni se le manda nada automático.
    if (revisar) est.pausado = true;

    // Pasa sola a otra etapa al terminar sin respuesta.
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const t = C.transicion(est, ctx);
      if (!t || ahora < t.ts) break;
      const destino = etapas.get(t.destino);
      if (!destino) break;
      await cambiarEtapa(empresaId, a.contacto_id, destino);
      await anotar('etapa', `pasó solo de "${etapa.nombre}" a "${destino.nombre}" (terminó sin respuesta).`);
      a.etapa_id = destino.id;
      a.etapa_actualizada_en = new Date(ahora).toISOString();
      etapa = destino;
      ctx = contexto(a, etapa, negocioId);
      C.prepararRec(est, ctx);
    }

    // Lo que debería estar en la cola. Un paso cancelado a mano se salta, y uno
    // sin texto también (no hay nada que enviar).
    const deseos: Record<TipoSecuencia, C.Deseo | null> = { rec: null, react: null };
    for (const tipo of revisar ? [] : TIPOS) {
      const calcular = () => (tipo === 'rec' ? C.deseoRec(est, ctx) : C.deseoReact(est, ctx));
      let d = calcular();
      for (let i = 0; d && i < 50 && (!d.variantes.length || cancelados.has(clave(a.contacto_id, tipo, d.paso, d.token))); i++) {
        C.avanzar(est, tipo, d.paso, d.token, ahora);
        d = calcular();
      }
      deseos[tipo] = d;
    }

    // Deja en la cola exactamente eso.
    for (const tipo of TIPOS) {
      const d = deseos[tipo];
      let mantener: ColaRow | null = null;
      for (const it of pendientes) {
        if (it.contacto_id !== a.contacto_id || it.tipo !== tipo) continue;
        if (d && !mantener && it.paso === d.paso && it.token === d.token) mantener = it;
        else await cancelarInterno(it, est.respondio ? 'El cliente respondió' : 'Ya no corresponde (cambió la etapa o los mensajes)');
      }
      if (!d) continue;
      const fila = {
        conversacion_id: a.conversacion_id,
        linea_id: a.linea_id,
        telefono: a.telefono,
        etapa_id: etapa.id,
        nombre: `${etapa.nombre} · ${d.etiqueta}`,
        variantes: d.variantes,
        max_atraso_ms: d.maxAtrasoMs,
      };
      const vence = new Date(d.vence).toISOString();
      if (mantener) {
        const cambios: Partial<ColaRow> = {};
        if (!mantener.fijo && C.ms(mantener.vence) !== d.vence) cambios.vence = vence;
        for (const k of Object.keys(fila) as (keyof typeof fila)[]) {
          if (JSON.stringify(mantener[k]) !== JSON.stringify(fila[k])) Object.assign(cambios, { [k]: fila[k] });
        }
        if (Object.keys(cambios).length) await db.from('siguelo_cola').update(cambios).eq('id', mantener.id).eq('estado', 'pendiente');
      } else {
        const { error: errorCola } = await db.from('siguelo_cola').insert({ ...fila, empresa_id: empresaId, contacto_id: a.contacto_id, tipo, paso: d.paso, token: d.token, vence });
        if (errorCola) console.error('Seguimiento: no se pudo programar un mensaje:', errorCola.message);
      }
    }

    // Guarda solo lo que cambió (así no pisa un "Pausar" o "Atendido" que hiciste en la página).
    const cambios: Partial<SeguimientoRow> = {};
    if (JSON.stringify(est.rec) !== JSON.stringify(seg.rec)) cambios.rec = est.rec;
    if (JSON.stringify(est.react) !== JSON.stringify(seg.react)) cambios.react = est.react;
    if (est.respondio !== seg.respondio) cambios.respondio = est.respondio;
    if (previo && a.ultimo_cliente !== previo.visto_cliente) cambios.visto_cliente = a.ultimo_cliente;
    if (previo && vistoAgente !== previo.visto_agente) cambios.visto_agente = vistoAgente;
    if (JSON.stringify(revisar ?? null) !== JSON.stringify(seg.revisar ?? null)) cambios.revisar = revisar;
    if (JSON.stringify(deshacer ?? null) !== JSON.stringify(seg.deshacer ?? null)) cambios.deshacer = deshacer;
    if (!previo) {
      const { error: errorSeg } = await db.from('siguelo_seguimientos').insert({ ...seg, ...cambios });
      if (errorSeg) console.error('Seguimiento: no se pudo guardar el estado de un contacto:', errorSeg.message);
    } else if (Object.keys(cambios).length) {
      await db.from('siguelo_seguimientos').update({ ...cambios, actualizado_en: new Date().toISOString() }).eq('contacto_id', a.contacto_id);
    }
  }

  // Lo pendiente de contactos que ya no están en una etapa con mensajes.
  for (const it of pendientes) {
    if (it.tipo !== 'cita' && !revisados.has(it.contacto_id)) await cancelarInterno(it, 'El contacto ya no está en una etapa con seguimiento');
  }

  // Los mensajes de las citas (Fase 4) van para cualquier contacto, esté en la etapa que esté.
  await revisarCitas(aj, pendientes, cancelados);
}
