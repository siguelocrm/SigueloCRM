import { db } from '../db.js';
import { fechaDe, instante } from '../horario.js';
import { olvidarNegocios } from '../negocios.js';
import { llamar, olvidarCache } from './config.js';
import { REGLA_ESTILO, describirEstilo } from './contexto.js';
import type { Adaptar, AjustesRow, EtapaConfigRow, IaRow, MensajeAsistenteRow, NegocioRow, PalabrasEtapa, Secuencia } from '../tipos.js';

// El asistente: le escribes en la pantalla IA, te explica cómo funciona todo y
// cómo está configurado, y te propone cambios ("pon las reactivaciones a 1, 3,
// 5 y 8 horas"). Los cambios se guardan con el mensaje y se hacen solo cuando
// pulsas "Aplicar" (aplicarAcciones). Era el "asistente de configuración" de la
// IA de la extensión.

type Config = { ia: IaRow; clave: string; zona: string };
type Etapa = { id: string; nombre: string; tipo: 'normal' | 'ganada' | 'perdida'; orden: number; embudo: string };

export type Accion =
  | { tipo: 'secuencia'; descripcion: string; etapa_id: string; negocio_id: string | null; cual: 'recordatorios' | 'reactivacion'; secuencia: Secuencia }
  | { tipo: 'seguimiento'; descripcion: string; cambios: Partial<AjustesRow> }
  | { tipo: 'adaptar'; descripcion: string; cambios: Partial<Adaptar> }
  | { tipo: 'ia'; descripcion: string; cambios: Partial<IaRow> }
  | { tipo: 'ficha'; descripcion: string; negocio_id: string; cambios: Partial<NegocioRow>; agregar?: string }
  | { tipo: 'palabras'; descripcion: string; etapa_id: string; palabras: PalabrasEtapa };

const HISTORIA = 12; // mensajes anteriores que ve el asistente
const MAX_ACCIONES = 10;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const recortar = (s: unknown, n: number) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const horasATexto = (h: number) => (h >= 24 && h % 24 === 0 ? `${h / 24} ${h === 24 ? 'día' : 'días'}` : `${h} h`);
const listaY = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const comoModo = (cual: 'recordatorios' | 'reactivacion', modo: string) =>
  modo === 'encadenado' ? 'cada uno contado desde el anterior' : cual === 'recordatorios' ? 'contados desde que entra a la etapa' : 'contados desde que le escribiste';

// ---------- Cómo funciona el CRM (para que el asistente lo explique) ----------
const MANUAL = `CÓMO FUNCIONA EL CRM (pantallas y qué hace cada cosa):
- Automatizar → Seguimiento:
  · "Mensajes por etapa": en cada etapa del embudo, RECORDATORIOS (salen solos si el contacto sigue en la etapa: por ejemplo al día 1, 3 y 5) y REACTIVACIÓN (sale cuando le escribiste y no responde: por ejemplo a la 1, 3, 5 y 8 horas). Cada mensaje puede tener varias formas de decirlo (variantes, separadas por una línea ---): se elige una al azar. Variables: {nombre}, {negocio}, {sucursal}, {direccion}, {horario}. "Al terminar": pasa sola a otra etapa si no respondió. Cada negocio puede tener sus propios textos.
  · Modo "contados desde el inicio" (origen) o "cada uno desde el anterior" (encadenado).
  · Si el cliente responde, sus recordatorios esperan; si escribe una palabra clave (ej. "stop"), pasa de etapa sola.
  · "Cola": lo que va a salir y lo que salió. "Contactos": en qué va cada uno, lo que está "para revisar" y "deshacer". "Citas": agendar citas con sus recordatorios (2 h antes, 1 h antes...). "Ajustes": activar, horario, máximo de mensajes por día POR NÚMERO, pausa al azar entre envíos, mínimo entre dos mensajes a la misma persona, "stop", pie de mensaje, y "La IA adapta cada mensaje" (reescribe cada recordatorio y reactivación con la conversación y la ficha antes de enviarlo).
- Automatizar → IA: "Asistente" (esto), "Resumen" (respuestas para aprobar, lo que necesita que veas, uso y costo), "Ajustes" (clave de OpenAI, modo: apagado / para aprobar / automática, estilo, firma, instrucciones, horario, límites, avisos a tu WhatsApp), "Probar" (qué respondería a un mensaje inventado).
- Automatizar → Inscripciones: cursos con precio, QR, titular de la cuenta y link del grupo. El cliente manda la foto del comprobante, la IA lo lee y se controla solo (monto, a quién se pagó, fecha, número de transacción no repetido). Si está bien: le confirma, le pide sus datos, los guarda en su ficha, crea la oportunidad ganada y le manda el link. Si hay duda: queda "para revisar" y te avisa.
- Administrar → Negocios: un negocio por sucursal o por negocio distinto; sus números, dirección, horario, zonas, la información para la IA, grupos a los que puede invitar y su propio embudo.
- Administrar → Mi empresa: campos personalizados de la ficha (carnet, correo...).
- Conexiones: los números de WhatsApp (QR). Usa un número secundario para probar: automatizar tiene riesgo de bloqueo.
- Todo lo automático lo hace el servidor del CRM: tiene que estar prendido.`;

// ---------- El estado actual (lo que el asistente ve) ----------

type Estado = {
  texto: string;
  etapas: Map<string, Etapa>; // e1 → etapa
  negocios: Map<string, NegocioRow>; // n1 → negocio
  configs: EtapaConfigRow[];
  ajustes: AjustesRow | null;
  ia: IaRow;
};

function describirSecuencia(cual: 'recordatorios' | 'reactivacion', s: Secuencia | null | undefined): string {
  if (!s?.activa || !s.pasos?.length) return 'apagada';
  const pasos = s.pasos.map((p, i) => `${i + 1}) ${horasATexto(p.horas)}: ${p.variantes.slice(0, 2).map((v) => `"${recortar(v, 110)}"`).join(' | ') || '(sin texto)'}`);
  return `${comoModo(cual, s.modo)} — ${pasos.join(' ')}`;
}

async function leerEstado(c: Config): Promise<Estado> {
  const empresaId = c.ia.empresa_id;
  const ahora = Date.now();
  const hoy = fechaDe(ahora, c.zona);
  const inicioMes = new Date(instante(`${hoy.slice(0, 8)}01`, '00:00', c.zona)).toISOString();
  const [etapasR, configsR, embudosR, deEmbudoR, negociosR, ajustesR, cursosR, registroR, colaR, contadorR, pagosR] = await Promise.all([
    db.from('etapas_venta').select('id, empresa_id, nombre, tipo, orden, probabilidad').eq('empresa_id', empresaId).order('orden'),
    db.from('siguelo_etapas').select('*').eq('empresa_id', empresaId),
    db.from('siguelo_embudos').select('id, nombre').eq('empresa_id', empresaId),
    db.from('siguelo_etapa_embudo').select('etapa_id, embudo_id'),
    db.from('siguelo_negocios').select('*').eq('empresa_id', empresaId).order('creado_en'),
    db.from('siguelo_ajustes').select('*').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_cursos').select('*').eq('empresa_id', empresaId),
    db.from('siguelo_registro').select('texto, creado_en').eq('empresa_id', empresaId).order('creado_en', { ascending: false }).limit(25),
    db.from('siguelo_cola').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('estado', 'pendiente'),
    db.from('siguelo_contador').select('enviados').eq('empresa_id', empresaId).eq('fecha', hoy),
    db.from('siguelo_pagos').select('estado, monto, curso_id').eq('empresa_id', empresaId).in('estado', ['datos', 'inscrito', 'revisar']).gte('creado_en', inicioMes),
  ]);
  const fecha = (iso: string) => new Intl.DateTimeFormat('es', { timeZone: c.zona, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

  const nombreEmbudo = new Map((embudosR.data || []).map((e) => [e.id, e.nombre] as const));
  const embudoDe = new Map((deEmbudoR.data || []).map((e) => [e.etapa_id, e.embudo_id] as const));
  const etapas = new Map<string, Etapa>();
  (etapasR.data || []).forEach((e, i) => etapas.set(`e${i + 1}`, { ...e, embudo: nombreEmbudo.get(embudoDe.get(e.id) ?? '') || 'Embudo principal' }));
  const negocios = new Map<string, NegocioRow>();
  (negociosR.data || []).forEach((n, i) => negocios.set(`n${i + 1}`, n));
  const corto = (m: Map<string, { id: string }>, id: string | null) => [...m.entries()].find(([, v]) => v.id === id)?.[0];
  const configs = configsR.data || [];
  const aj = ajustesR.data ?? null;
  const ia = c.ia;

  const lineasEtapa = [...etapas.entries()].map(([k, e]) => {
    if (e.tipo === 'perdida') return `- ${k}: "${e.nombre}" (${e.embudo}) [perdida: nunca recibe mensajes automáticos]`;
    const general = configs.find((x) => x.etapa_id === e.id && !x.negocio_id);
    const propias = configs.filter((x) => x.etapa_id === e.id && x.negocio_id);
    const pal = general?.palabras;
    const destino = general?.al_terminar?.etapa_id ? [...etapas.values()].find((x) => x.id === general.al_terminar.etapa_id) : null;
    return [
      `- ${k}: "${e.nombre}" (${e.embudo})${e.tipo === 'ganada' ? ' [ganada]' : ''}`,
      `    Recordatorios: ${describirSecuencia('recordatorios', general?.recordatorios)}`,
      `    Reactivación: ${describirSecuencia('reactivacion', general?.reactivacion)}`,
      destino && `    Al terminar sin respuesta: pasa a "${destino.nombre}" a los ${general!.al_terminar.dias} días`,
      pal && (pal.cliente?.length || pal.tuyas?.length) && `    Palabras: del cliente ${JSON.stringify(pal.cliente || [])}, tuyas ${JSON.stringify(pal.tuyas || [])}`,
      ...propias.map((x) => `    Textos propios de ${corto(negocios, x.negocio_id) ?? '?'}: recordatorios ${describirSecuencia('recordatorios', x.recordatorios)}; reactivación ${describirSecuencia('reactivacion', x.reactivacion)}`),
    ]
      .filter(Boolean)
      .join('\n');
  });

  const lineasNegocio = [...negocios.entries()].map(
    ([k, n]) =>
      `- ${k}: "${n.nombre}"${n.sucursal ? `, sucursal ${n.sucursal}` : ''}${n.direccion ? `, ${n.direccion}` : ''}${n.horario ? `, horario ${n.horario}` : ''}${n.zonas ? `, zonas ${n.zonas}` : ''}; la IA responde: ${n.ia_activa === false ? 'no' : 'sí'}; información para la IA: ${n.info_ia?.trim() ? `"${recortar(n.info_ia, 600)}"` : '(vacía)'}`,
  );

  const enviadosHoy = (contadorR.data || []).reduce((s, x) => s + x.enviados, 0);
  const cursos = cursosR.data || [];
  const pagos = pagosR.data || [];
  const lineasCurso = cursos.map((k) => {
    const de = pagos.filter((p) => p.curso_id === k.id && p.estado !== 'revisar');
    return `- "${k.nombre}": ${k.moneda} ${k.precio}${k.activo ? '' : ' (pausado)'}${k.qr_url ? '' : ', sin QR'}${k.link_grupo ? '' : ', sin link de grupo'}; este mes ${de.length} inscritos por ${k.moneda} ${de.reduce((s, p) => s + Number(p.monto || 0), 0)}`;
  });
  const paraRevisar = pagos.filter((p) => p.estado === 'revisar').length;

  const texto = `ESTADO ACTUAL (${fecha(new Date(ahora).toISOString())}, zona ${c.zona}):

SEGUIMIENTO: ${!aj ? 'todavía no se configuró' : `${aj.activo ? (aj.pausado ? `en pausa (${aj.motivo_pausa || 'a mano'})` : 'activo') : 'apagado'}; horario ${aj.hora_inicio} a ${aj.hora_fin}; máximo ${aj.maximo_diario} por día por número; pausa entre envíos ${aj.pausa_min_seg}–${aj.pausa_max_seg} s; mínimo ${aj.min_entre_misma_persona_min} min entre dos mensajes automáticos a la misma persona; no recuerda a quien escribió hace menos de ${aj.no_recordar_si_escribio_horas} h; stop: ${aj.stop?.activo ? JSON.stringify(aj.stop.palabras) : 'apagado'}; la IA adapta los mensajes: ${aj.adaptar?.activo ? `sí (recordatorios: ${aj.adaptar.recordatorios ? 'sí' : 'no'}, reactivaciones: ${aj.adaptar.reactivaciones ? 'sí' : 'no'})${aj.adaptar.instrucciones ? `, instrucciones: "${recortar(aj.adaptar.instrucciones, 300)}"` : ''}` : 'no'}`}
Hoy salieron ${enviadosHoy} mensajes de seguimiento y hay ${colaR.count ?? 0} pendientes en la cola.

ETAPAS (id: nombre, embudo) Y SUS MENSAJES (generales, para todos los negocios):
${lineasEtapa.join('\n') || '(sin etapas)'}

NEGOCIOS (id: datos):
${lineasNegocio.join('\n') || '(sin negocios: todos los números trabajan igual)'}

IA: ${ia.activa ? 'activa' : 'apagada'}; clave de OpenAI ${ia.clave_final ? 'guardada' : 'sin guardar'}; modo ${ia.modo}; modelo ${ia.modelo}; estilo: ${describirEstilo(ia.estilo)}; firma "${ia.firma}"; instrucciones "${recortar(ia.instrucciones, 400)}"; responde de ${ia.desde} a ${ia.hasta}; máximo ${ia.max_respuestas_dia} respuestas por día y ${ia.max_por_cliente_dia} por cliente; avisos a tu WhatsApp: ${ia.avisos?.activo ? `sí, al ${ia.avisos.telefono}` : 'no'}.

CURSOS (inscripción con pago): ${lineasCurso.length ? `\n${lineasCurso.join('\n')}` : 'ninguno'}${paraRevisar ? `\nComprobantes para revisar este mes: ${paraRevisar}` : ''}

LO ÚLTIMO QUE PASÓ (registro del seguimiento, la IA y los pagos; lo más nuevo primero):
${(registroR.data || []).map((r) => `- [${fecha(r.creado_en)}] ${recortar(r.texto, 200)}`).join('\n') || '(nada todavía)'}`;

  return { texto, etapas, negocios, configs, ajustes: aj, ia };
}

// ---------- Lo que puede pedir (validado acá: nunca se confía en la IA a ciegas) ----------

const ESQUEMA = `Acciones que puedes proponer en "acciones" (se hacen recién cuando el dueño pulsa "Aplicar"):
1. Mensajes de una etapa:
   {"tipo": "secuencia", "etapa": "e1", "negocio": null o "n1" (null = textos para todos los negocios), "cual": "recordatorios" o "reactivacion", "modo": "origen" o "encadenado", "horas": [1, 3, 5, 8], "textos": [["variante 1", "variante 2"], ...] (opcional), "activa": true}
   - "horas" en horas (1 día = 24, 3 días = 72). Si el dueño dice "a la 1, 3, 5 y 8 horas" o "al día 1, 3 y 5", usa "origen" (cada número contado desde el inicio) con esos mismos números. Usa "encadenado" solo si dice "cada X horas" o "X horas después del anterior".
   - "textos": una lista de variantes por cada mensaje, en el mismo orden que "horas". Si la etapa ya tiene textos para esos mensajes y el dueño no pidió cambiarlos, no mandes "textos" (se conservan). Si hay mensajes nuevos sin texto, o te pide textos nuevos, escríbelos tú (2 variantes cada uno), cortos, naturales para WhatsApp, basados en la información del negocio, con {nombre} si sirve, y terminando con una pregunta fácil de responder.
2. Ajustes del seguimiento: {"tipo": "seguimiento", "activo": true/false, "pausado": true/false, "hora_inicio": "08:00", "hora_fin": "20:00", "maximo_diario": 30, "pausa_min_seg": 45, "pausa_max_seg": 120, "min_entre_misma_persona_min": 60, "no_recordar_si_escribio_horas": 24} (solo lo que cambia)
3. Que la IA adapte los mensajes de seguimiento: {"tipo": "adaptar", "activo": true/false, "recordatorios": true/false, "reactivaciones": true/false, "instrucciones": "texto"} (solo lo que cambia)
4. Ajustes de la IA: {"tipo": "ia", "activa": true/false, "modo": "apagado" | "borrador" | "automatico", "firma": "texto", "instrucciones": "texto", "desde": "08:00", "hasta": "22:00", "max_respuestas_dia": 150, "max_por_cliente_dia": 10, "estilo": {"tono": ${Object.keys(REGLA_ESTILO.tono).map((x) => `"${x}"`).join(' | ')}, "trato": "tu" | "usted", "emojis": ${Object.keys(REGLA_ESTILO.emojis).map((x) => `"${x}"`).join(' | ')}, "largo": ${Object.keys(REGLA_ESTILO.largo).map((x) => `"${x}"`).join(' | ')}, "saltos": ${Object.keys(REGLA_ESTILO.saltos).map((x) => `"${x}"`).join(' | ')}, "usar_nombre": true/false}} (solo lo que cambia)
5. Ficha de un negocio: {"tipo": "ficha", "negocio": "n1", "info_ia": "texto completo nuevo" o "agregar": "texto para agregar al final", "horario": "...", "direccion": "...", "zonas": "..."} (solo lo que cambia)
6. Palabras que pasan de etapa: {"tipo": "palabras", "etapa": "e2", "cliente": ["ya pagué"], "parecidas": ["quiero pagar"], "tuyas": ["ya te registré"], "respuesta": "texto opcional"} (las listas completas como deben quedar)`;

const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x.replace(',', '.')) : NaN);
const entero = (x: unknown, min: number, max: number) => {
  const n = num(x);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};
const textos = (x: unknown, max: number, largo: number) =>
  Array.isArray(x) ? [...new Set(x.map((v) => String(v ?? '').trim().slice(0, largo)).filter(Boolean))].slice(0, max) : null;

function validar(a: Record<string, unknown>, e: Estado): Accion | string {
  const tipo = String(a.tipo || '');
  const etapa = typeof a.etapa === 'string' ? e.etapas.get(a.etapa.trim()) : undefined;

  if (tipo === 'secuencia') {
    if (!etapa) return 'no encontré la etapa';
    if (etapa.tipo === 'perdida') return `"${etapa.nombre}" es una etapa perdida: nunca recibe mensajes`;
    const negocio = a.negocio ? e.negocios.get(String(a.negocio).trim()) : null;
    if (a.negocio && !negocio) return 'no encontré el negocio';
    const cual = String(a.cual || '').startsWith('reactiv') ? 'reactivacion' : String(a.cual || '').startsWith('record') ? 'recordatorios' : null;
    if (!cual) return 'no está claro si son recordatorios o reactivación';
    const activa = a.activa !== false;
    const modo = a.modo === 'encadenado' ? 'encadenado' : 'origen';
    const horas = Array.isArray(a.horas) ? a.horas.map(num) : [];
    if (activa && (!horas.length || horas.length > 12 || horas.some((h) => !Number.isFinite(h) || h <= 0 || h > 24 * 90))) return 'las horas no son válidas';
    if (modo === 'origen' && horas.some((h, i) => i > 0 && h <= horas[i - 1])) return 'las horas tienen que ir de menor a mayor';
    const propia = negocio ? e.configs.find((x) => x.etapa_id === etapa.id && x.negocio_id === negocio.id) : null;
    const general = e.configs.find((x) => x.etapa_id === etapa.id && !x.negocio_id);
    const actual = ((propia ?? general)?.[cual] as Secuencia | undefined)?.pasos || [];
    const nuevos = Array.isArray(a.textos) ? a.textos : [];
    const pasos = horas.map((h, i) => {
      const t = nuevos[i];
      const variantes = (Array.isArray(t) ? textos(t, 6, 1000) : typeof t === 'string' && t.trim() ? [t.trim().slice(0, 1000)] : null) || actual[i]?.variantes || [];
      return { horas: Math.round(h * 100) / 100, variantes };
    });
    const sinTexto = pasos.findIndex((p) => !p.variantes.length);
    if (activa && sinTexto >= 0) return `falta el texto del mensaje ${sinTexto + 1}`;
    const nombre = cual === 'recordatorios' ? 'Recordatorios' : 'Reactivación';
    const para = negocio ? ` (solo ${negocio.nombre})` : '';
    const descripcion = activa
      ? `${nombre} de "${etapa.nombre}"${para}: ${pasos.length} ${pasos.length === 1 ? 'mensaje' : 'mensajes'} a ${listaY(pasos.map((p) => horasATexto(p.horas)))}, ${comoModo(cual, modo)}${nuevos.length ? ', con textos nuevos' : ''}`
      : `Apagar ${nombre.toLowerCase()} de "${etapa.nombre}"${para}`;
    return { tipo, descripcion, etapa_id: etapa.id, negocio_id: negocio?.id ?? null, cual, secuencia: { activa, modo, pasos: activa ? pasos : actual } };
  }

  if (tipo === 'seguimiento') {
    const c: Partial<AjustesRow> = {};
    const partes: string[] = [];
    if (typeof a.activo === 'boolean') { c.activo = a.activo; partes.push(a.activo ? 'activarlo' : 'apagarlo'); }
    if (typeof a.pausado === 'boolean') { c.pausado = a.pausado; partes.push(a.pausado ? 'ponerlo en pausa' : 'quitar la pausa'); }
    if (typeof a.hora_inicio === 'string' && HHMM.test(a.hora_inicio)) c.hora_inicio = a.hora_inicio;
    if (typeof a.hora_fin === 'string' && HHMM.test(a.hora_fin)) c.hora_fin = a.hora_fin;
    if (c.hora_inicio || c.hora_fin) partes.push(`horario de ${c.hora_inicio ?? e.ajustes?.hora_inicio ?? '08:00'} a ${c.hora_fin ?? e.ajustes?.hora_fin ?? '20:00'}`);
    const n = (k: 'maximo_diario' | 'pausa_min_seg' | 'pausa_max_seg' | 'min_entre_misma_persona_min' | 'no_recordar_si_escribio_horas', max: number, texto: (v: number) => string) => {
      if (a[k] === undefined) return;
      const v = entero(a[k], 0, max);
      if (v === null) return;
      c[k] = v;
      partes.push(texto(v));
    };
    n('maximo_diario', 1000, (v) => `máximo ${v} mensajes por día por número`);
    n('pausa_min_seg', 3600, (v) => `pausa mínima ${v} s`);
    n('pausa_max_seg', 3600, (v) => `pausa máxima ${v} s`);
    n('min_entre_misma_persona_min', 10080, (v) => `mínimo ${v} min entre dos mensajes a la misma persona`);
    n('no_recordar_si_escribio_horas', 720, (v) => `no recordar a quien escribió hace menos de ${v} h`);
    if (!partes.length) return 'no hay nada que cambiar en el seguimiento';
    return { tipo, descripcion: `Seguimiento: ${listaY(partes)}`, cambios: c };
  }

  if (tipo === 'adaptar') {
    const c: Partial<Adaptar> = {};
    const partes: string[] = [];
    if (typeof a.activo === 'boolean') { c.activo = a.activo; partes.push(a.activo ? 'que la IA adapte cada mensaje a la conversación' : 'que la IA deje de adaptar los mensajes'); }
    if (typeof a.recordatorios === 'boolean') { c.recordatorios = a.recordatorios; partes.push(`recordatorios: ${a.recordatorios ? 'sí' : 'no'}`); }
    if (typeof a.reactivaciones === 'boolean') { c.reactivaciones = a.reactivaciones; partes.push(`reactivaciones: ${a.reactivaciones ? 'sí' : 'no'}`); }
    if (typeof a.instrucciones === 'string') { c.instrucciones = a.instrucciones.trim().slice(0, 1000); partes.push(`instrucciones: "${recortar(c.instrucciones, 80)}"`); }
    if (!partes.length) return 'no hay nada que cambiar';
    return { tipo, descripcion: `Seguimiento: ${listaY(partes)}`, cambios: c };
  }

  if (tipo === 'ia') {
    const c: Partial<IaRow> = {};
    const partes: string[] = [];
    if (typeof a.activa === 'boolean') {
      if (a.activa && !e.ia.clave_final) return 'para activar la IA primero hay que guardar la clave de OpenAI (IA → Ajustes)';
      c.activa = a.activa;
      partes.push(a.activa ? 'activar la IA' : 'apagar la IA');
    }
    if (a.modo === 'apagado' || a.modo === 'borrador' || a.modo === 'automatico') {
      c.modo = a.modo;
      partes.push(`modo ${a.modo === 'borrador' ? 'para aprobar' : a.modo === 'automatico' ? 'automática' : 'sin responder'}`);
    }
    if (typeof a.firma === 'string') { c.firma = a.firma.trim().slice(0, 200); partes.push(`firma "${c.firma}"`); }
    if (typeof a.instrucciones === 'string') { c.instrucciones = a.instrucciones.trim().slice(0, 4000); partes.push('instrucciones nuevas'); }
    if (typeof a.desde === 'string' && HHMM.test(a.desde)) c.desde = a.desde;
    if (typeof a.hasta === 'string' && HHMM.test(a.hasta)) c.hasta = a.hasta;
    if (c.desde || c.hasta) partes.push(`responde de ${c.desde ?? e.ia.desde} a ${c.hasta ?? e.ia.hasta}`);
    const mr = a.max_respuestas_dia === undefined ? null : entero(a.max_respuestas_dia, 0, 5000);
    if (mr !== null) { c.max_respuestas_dia = mr; partes.push(`máximo ${mr} respuestas por día`); }
    const mc = a.max_por_cliente_dia === undefined ? null : entero(a.max_por_cliente_dia, 0, 100);
    if (mc !== null) { c.max_por_cliente_dia = mc; partes.push(`máximo ${mc} por cliente`); }
    if (a.estilo && typeof a.estilo === 'object') {
      const s = a.estilo as Record<string, unknown>;
      const estilo = { ...e.ia.estilo };
      for (const k of ['tono', 'trato', 'emojis', 'largo', 'saltos'] as const) if (typeof s[k] === 'string' && REGLA_ESTILO[k]?.[s[k] as string]) estilo[k] = s[k] as string;
      if (typeof s.usar_nombre === 'boolean') estilo.usar_nombre = s.usar_nombre;
      if (JSON.stringify(estilo) !== JSON.stringify(e.ia.estilo)) { c.estilo = estilo; partes.push(`estilo: ${describirEstilo(estilo)}`); }
    }
    if (!partes.length) return 'no hay nada que cambiar en la IA';
    return { tipo, descripcion: `IA: ${listaY(partes)}`, cambios: c };
  }

  if (tipo === 'ficha') {
    const negocio = typeof a.negocio === 'string' ? e.negocios.get(a.negocio.trim()) : undefined;
    if (!negocio) return 'no encontré el negocio';
    const c: Partial<NegocioRow> = {};
    const partes: string[] = [];
    if (typeof a.info_ia === 'string' && a.info_ia.trim()) { c.info_ia = a.info_ia.trim().slice(0, 8000); partes.push('reemplazar la información para la IA'); }
    const agregar = typeof a.agregar === 'string' && a.agregar.trim() ? a.agregar.trim().slice(0, 4000) : undefined;
    if (agregar) partes.push(`agregar a la información: "${recortar(agregar, 120)}"`);
    for (const k of ['horario', 'direccion', 'zonas'] as const) {
      if (typeof a[k] === 'string') { c[k] = (a[k] as string).trim().slice(0, 300) || null; partes.push(`${k === 'direccion' ? 'dirección' : k}: "${c[k] ?? ''}"`); }
    }
    if (!partes.length) return 'no hay nada que cambiar en la ficha';
    return { tipo, descripcion: `Ficha de "${negocio.nombre}": ${listaY(partes)}`, negocio_id: negocio.id, cambios: c, agregar };
  }

  if (tipo === 'palabras') {
    if (!etapa) return 'no encontré la etapa';
    const actual = e.configs.find((x) => x.etapa_id === etapa.id && !x.negocio_id)?.palabras;
    const palabras: PalabrasEtapa = {
      cliente: textos(a.cliente, 30, 80) ?? actual?.cliente ?? [],
      parecidas: textos(a.parecidas, 30, 120) ?? actual?.parecidas ?? [],
      tuyas: textos(a.tuyas, 30, 120) ?? actual?.tuyas ?? [],
      respuesta: typeof a.respuesta === 'string' ? a.respuesta.trim().slice(0, 500) : actual?.respuesta ?? '',
    };
    const partes = [
      palabras.cliente.length && `del cliente: ${palabras.cliente.map((x) => `"${x}"`).join(', ')}`,
      palabras.parecidas.length && `para revisar: ${palabras.parecidas.map((x) => `"${x}"`).join(', ')}`,
      palabras.tuyas.length && `tuyas: ${palabras.tuyas.map((x) => `"${x}"`).join(', ')}`,
      palabras.respuesta && `responde "${recortar(palabras.respuesta, 60)}"`,
    ].filter(Boolean) as string[];
    return { tipo, descripcion: `Palabras que pasan a "${etapa.nombre}": ${partes.join('; ') || 'ninguna'}`, etapa_id: etapa.id, palabras };
  }
  return `no sé hacer "${tipo}"`;
}

// ---------- Conversar ----------

export async function conversar(c: Config, usuarioId: string | null, texto: string): Promise<{ ok: true; mensaje: MensajeAsistenteRow } | { ok: false; mensaje: string }> {
  const empresaId = c.ia.empresa_id;
  const { data: anteriores } = await db.from('siguelo_asistente').select('*').eq('empresa_id', empresaId).order('creado_en', { ascending: false }).limit(HISTORIA);
  const { error: errorUsuario } = await db.from('siguelo_asistente').insert({ empresa_id: empresaId, usuario_id: usuarioId, rol: 'usuario', texto });
  if (errorUsuario) return { ok: false, mensaje: `No se pudo guardar el mensaje: ${errorUsuario.message}. ¿Pegaste la última versión de database/siguelo.sql?` };
  const estado = await leerEstado(c);

  const sistema = `Eres el asistente de SígueloCRM, un CRM de WhatsApp. Hablas con el dueño del negocio, que no es programador: respóndele en español, con "tú", claro y en pocas palabras, paso a paso si hace falta. Le explicas cómo funciona el CRM, cómo está configurado y por qué pasó algo (usa el registro), y cuando te pide cambiar algo le preparas los cambios.

${MANUAL}

${estado.texto}

${ESQUEMA}

Devuelve SOLO este JSON: {"respuesta": "lo que le dices al dueño", "acciones": [ ... ]}
Reglas:
- Si solo pregunta, "acciones": []. Si pide un cambio, prepara las acciones y en "respuesta" explícale en palabras simples qué va a cambiar y que pulse "Aplicar" para hacerlo.
- Si algo no está claro (qué etapa, qué negocio), pregúntale antes de proponer el cambio.
- Si algo no se puede hacer desde aquí (subir el QR, conectar un número, crear etapas o campos), dile en qué pantalla se hace.
- No inventes datos del negocio: usa los que están arriba.`;

  const historia = (anteriores || []).reverse().map((m) => ({
    role: m.rol === 'usuario' ? ('user' as const) : ('assistant' as const),
    content:
      m.rol === 'usuario'
        ? m.texto
        : `${m.texto}${m.acciones?.length ? `\n[Propuse: ${m.acciones.map((x) => String(x.descripcion)).join('; ')} — ${m.aplicado_en ? 'el dueño lo aplicó' : 'sin aplicar'}]` : ''}`,
  }));
  const r = await llamar(c, [{ role: 'system', content: sistema }, ...historia, { role: 'user', content: texto }]);
  if (!r.ok) {
    await db.from('siguelo_asistente').insert({ empresa_id: empresaId, rol: 'asistente', texto: `No pude consultar a la IA: ${r.mensaje}` });
    return { ok: false, mensaje: r.mensaje };
  }
  let respuesta = String(r.json.respuesta ?? '').trim().slice(0, 6000) || 'No entendí bien, ¿me lo explicas de otra forma?';
  const acciones: Accion[] = [];
  const fallidas: string[] = [];
  for (const a of (Array.isArray(r.json.acciones) ? r.json.acciones : []).slice(0, MAX_ACCIONES)) {
    if (!a || typeof a !== 'object') continue;
    const v = validar(a as Record<string, unknown>, estado);
    if (typeof v === 'string') fallidas.push(v);
    else acciones.push(v);
  }
  if (fallidas.length) respuesta += `\n\n(No pude preparar todo: ${fallidas.join('; ')}.)`;
  const { data: mensaje, error } = await db
    .from('siguelo_asistente')
    .insert({ empresa_id: empresaId, rol: 'asistente', texto: respuesta, acciones: acciones as unknown as Record<string, unknown>[] })
    .select('*')
    .single();
  if (error || !mensaje) return { ok: false, mensaje: `No se pudo guardar la respuesta: ${error?.message}` };
  return { ok: true, mensaje };
}

// ---------- Aplicar (cuando el dueño pulsa "Aplicar") ----------

async function aplicarUna(empresaId: string, a: Accion): Promise<void> {
  const ahora = new Date().toISOString();
  const falla = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  if (a.tipo === 'secuencia') {
    const q = db.from('siguelo_etapas').select('*').eq('empresa_id', empresaId).eq('etapa_id', a.etapa_id);
    const { data: filas } = await (a.negocio_id ? q.eq('negocio_id', a.negocio_id) : q.is('negocio_id', null));
    const fila = filas?.[0];
    const cambio: Partial<EtapaConfigRow> = a.cual === 'recordatorios' ? { recordatorios: a.secuencia } : { reactivacion: a.secuencia };
    if (fila) return falla((await db.from('siguelo_etapas').update({ ...cambio, actualizado_en: ahora }).eq('id', fila.id)).error);
    // Textos nuevos de un negocio: parten de los generales de la etapa.
    const { data: general } = a.negocio_id ? await db.from('siguelo_etapas').select('*').eq('empresa_id', empresaId).eq('etapa_id', a.etapa_id).is('negocio_id', null).maybeSingle() : { data: null };
    const base = general ? { recordatorios: general.recordatorios, reactivacion: general.reactivacion, al_terminar: general.al_terminar } : {};
    return falla((await db.from('siguelo_etapas').insert({ empresa_id: empresaId, etapa_id: a.etapa_id, negocio_id: a.negocio_id, ...base, ...cambio })).error);
  }
  if (a.tipo === 'seguimiento' || a.tipo === 'adaptar') {
    const { data: aj } = await db.from('siguelo_ajustes').select('*').eq('empresa_id', empresaId).maybeSingle();
    const cambios: Partial<AjustesRow> = a.tipo === 'adaptar' ? { adaptar: { activo: false, recordatorios: true, reactivaciones: true, instrucciones: '', ...(aj?.adaptar || {}), ...a.cambios } } : { ...a.cambios };
    if (cambios.activo) cambios.activado_en = aj?.activado_en ?? ahora;
    if (cambios.pausado === false) cambios.motivo_pausa = null;
    if (aj) return falla((await db.from('siguelo_ajustes').update({ ...cambios, actualizado_en: ahora }).eq('empresa_id', empresaId)).error);
    return falla((await db.from('siguelo_ajustes').insert({ empresa_id: empresaId, ...cambios })).error);
  }
  if (a.tipo === 'ia') {
    falla((await db.from('siguelo_ia').update({ ...a.cambios, actualizado_en: ahora }).eq('empresa_id', empresaId)).error);
    return olvidarCache();
  }
  if (a.tipo === 'ficha') {
    const cambios = { ...a.cambios };
    if (a.agregar) {
      const { data: n } = await db.from('siguelo_negocios').select('info_ia').eq('id', a.negocio_id).maybeSingle();
      cambios.info_ia = [cambios.info_ia ?? n?.info_ia ?? '', a.agregar].filter((x) => x.trim()).join('\n\n');
    }
    falla((await db.from('siguelo_negocios').update({ ...cambios, actualizado_en: ahora }).eq('id', a.negocio_id).eq('empresa_id', empresaId)).error);
    return olvidarNegocios();
  }
  if (a.tipo === 'palabras') {
    const { data: fila } = await db.from('siguelo_etapas').select('id').eq('empresa_id', empresaId).eq('etapa_id', a.etapa_id).is('negocio_id', null).maybeSingle();
    if (fila) return falla((await db.from('siguelo_etapas').update({ palabras: a.palabras, actualizado_en: ahora }).eq('id', fila.id)).error);
    return falla((await db.from('siguelo_etapas').insert({ empresa_id: empresaId, etapa_id: a.etapa_id, negocio_id: null, palabras: a.palabras })).error);
  }
}

export async function aplicarAcciones(empresaId: string, mensajeId: string): Promise<{ ok: true; resultado: string } | { ok: false; mensaje: string }> {
  const { data: m } = await db.from('siguelo_asistente').select('*').eq('id', mensajeId).eq('empresa_id', empresaId).maybeSingle();
  if (!m || m.rol !== 'asistente' || !m.acciones?.length) return { ok: false, mensaje: 'No hay cambios para aplicar.' };
  if (m.aplicado_en) return { ok: false, mensaje: 'Estos cambios ya se aplicaron.' };
  // Se marca primero: así dos clics seguidos no lo hacen dos veces.
  const { data: tomado } = await db.from('siguelo_asistente').update({ aplicado_en: new Date().toISOString() }).eq('id', m.id).is('aplicado_en', null).select('id');
  if (!tomado?.length) return { ok: false, mensaje: 'Estos cambios ya se aplicaron.' };
  const lineas: string[] = [];
  for (const a of m.acciones as unknown as Accion[]) {
    try {
      await aplicarUna(empresaId, a);
      lineas.push(`✓ ${a.descripcion}`);
    } catch (err) {
      lineas.push(`✗ ${a.descripcion} (${(err as Error).message})`);
    }
  }
  const resultado = lineas.join('\n');
  await db.from('siguelo_asistente').update({ resultado }).eq('id', m.id);
  return { ok: true, resultado };
}
