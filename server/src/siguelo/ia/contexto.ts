// Lo que la IA lee de cada conversación y lo que tiene que devolver. Viene del
// prompt de contenido/ia.js de la extensión, con lo nuevo de la Fase 3: la ficha
// de cada negocio, respuestas rápidas, pase a otra sucursal y grupos.

import type { MensajeChat } from './openai.js';
import type { GrupoNegocio, IaRow, NegocioRow, TipoAviso } from '../tipos.js';

export type LineaConversacion = { quien: 'cliente' | 'nosotros' | 'automatico'; texto: string; cuando: string };
export type EtapaCorta = { id: string; nombre: string; tipo: 'normal' | 'ganada' | 'perdida' };
// cuando: lo que escribiste en "Cuándo la usa la IA" (Negocios → Respuestas rápidas / Bot).
export type RespuestaCorta = { id: string; titulo: string; tipo: string; contenido: string; cuando?: string };
export type BotCorto = { id: string; nombre: string; cuando: string };
export type OtroNegocio = { id: string; nombre: string; sucursal: string | null; direccion: string | null; horario: string | null; zonas: string | null };

export type DatosContexto = {
  ia: Pick<IaRow, 'estilo' | 'firma' | 'instrucciones' | 'ejemplos' | 'acciones'>;
  ahora: string;
  negocio: Pick<NegocioRow, 'nombre' | 'sucursal' | 'direccion' | 'horario' | 'zonas' | 'info_ia'>;
  etapas: EtapaCorta[];
  etapaActual: string | null;
  nombreCliente: string;
  conversacion: LineaConversacion[];
  // Solo las que todavía no se le mandaron a este cliente.
  respuestasRapidas: RespuestaCorta[];
  otrosNegocios: OtroNegocio[];
  grupos: GrupoNegocio[];
  // Fase 5: cursos con QR de pago (el precio ya escrito, "Bs 150").
  cursos: { id: string; nombre: string; precio: string }[];
  // Reglas y flujos del bot que la IA puede activar (los que tienen "cuándo").
  bots?: BotCorto[];
  // Horarios, cupos y precios en vivo de su sucursal en el sistema del club ('' si no está conectado).
  club?: string;
  // Lo que respondió el dueño a preguntas que no estaban en la ficha (Redes sociales).
  aprendido?: string;
};

export type ResultadoIA = {
  resumen: string;
  interes: string;
  no_quiere_mas: boolean;
  positivo: boolean;
  etapa: string | null;
  necesita_al_dueno: boolean;
  motivo: string;
  aviso: TipoAviso | null;
  puede_responder: boolean;
  respuesta: string;
  respuestas_rapidas: string[];
  grupo: string | null;
  pase: { negocio_id: string; mensaje: string; nota: string } | null;
  qr: string | null;
  bot: string | null;
};

export const TIPOS_AVISO: Record<TipoAviso, string> = {
  fuera: 'Le interesa algo que no está en la información del negocio',
  compro: 'Compró, se inscribió, pagó o confirmó',
  pregunta: 'Pregunta algo que solo el dueño puede responder',
  molesto: 'Está molesto o se queja',
  humano: 'Pide hablar con una persona',
  otro: 'Otro asunto importante',
};

export const REGLA_ESTILO: Record<string, Record<string, string>> = {
  tono: { amable: 'amable y cálido', profesional: 'profesional y claro', cercano: 'cercano y relajado, como habla una persona por WhatsApp', entusiasta: 'entusiasta y con energía, sin exagerar', formal: 'formal y respetuoso' },
  trato: { tu: 'trata al cliente de "tú"', usted: 'trata al cliente de "usted"' },
  emojis: { ninguno: 'no uses emojis', pocos: 'como mucho 1 emoji por mensaje, y solo si encaja', normal: 'usa de 1 a 3 emojis por mensaje', muchos: 'usa varios emojis, con estilo alegre' },
  largo: { corto: 'muy corto: 1 o 2 frases', medio: 'corto: de 2 a 4 frases', detallado: 'tan completo como haga falta para responder bien, sin relleno' },
  saltos: { nada: 'todo en un solo párrafo, sin saltos de línea', pocos: 'como mucho 2 párrafos', normal: 'párrafos cortos separados por un salto de línea', muchos: 'una idea por línea, con saltos de línea frecuentes; puedes usar viñetas (•) para listas' },
};

// El estilo elegido en Ajustes, en palabras (también lo usan adaptar.ts y el asistente).
export const describirEstilo = (e: IaRow['estilo']): string => {
  const v = (k: string, valor: string) => REGLA_ESTILO[k]?.[valor] || '';
  return `tono ${v('tono', e.tono)}; ${v('trato', e.trato)}; ${v('emojis', e.emojis)}; largo ${v('largo', e.largo)}; formato: ${v('saltos', e.saltos)}`;
};

const recortar = (s: unknown, n: number) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Ids cortos para la IA (e1, r1, n1, g1): gasta menos y no se equivoca copiando ids largos.
type Mapa = Map<string, string>;
const corto = (prefijo: string, lista: { id: string }[]): Mapa => new Map(lista.map((x, i) => [`${prefijo}${i + 1}`, x.id]));

export function armarMensajes(d: DatosContexto, conRespuesta: boolean): { mensajes: MensajeChat[]; ids: { etapas: Mapa; respuestas: Mapa; negocios: Mapa; grupos: Mapa; cursos: Mapa; bots: Mapa } } {
  const ac = d.ia.acciones;
  const ids = {
    etapas: corto('e', d.etapas),
    respuestas: corto('r', ac.respuestas_rapidas ? d.respuestasRapidas : []),
    negocios: corto('n', ac.pases ? d.otrosNegocios : []),
    grupos: corto('g', ac.grupos ? d.grupos : []),
    cursos: corto('k', d.cursos),
    bots: corto('b', d.bots || []),
  };
  const idDe = (m: Mapa, id: string) => [...m.entries()].find(([, v]) => v === id)?.[0];
  const e = d.ia.estilo;
  const v = (k: string, valor: string) => REGLA_ESTILO[k]?.[valor] || '';
  const n = d.negocio;

  const ficha = [
    `Nombre: ${n.nombre}`,
    n.sucursal && `Sucursal: ${n.sucursal}`,
    n.direccion && `Dirección: ${n.direccion}`,
    n.horario && `Horario de atención: ${n.horario}`,
    n.zonas && `Zonas que atiende: ${n.zonas}`,
    `\n${n.info_ia?.trim() || '(el dueño todavía no escribió la información del negocio)'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const etapas = d.etapas.map((x) => `- ${idDe(ids.etapas, x.id)}: "${x.nombre}"${x.tipo === 'ganada' ? ' (compró / se inscribió)' : x.tipo === 'perdida' ? ' (no le interesa; no se le escribe más)' : ''}`).join('\n');
  const respuestas = d.respuestasRapidas
    .filter((x) => idDe(ids.respuestas, x.id))
    .map((x) => `- ${idDe(ids.respuestas, x.id)}: "${x.titulo}" (${x.tipo === 'texto' ? 'texto' : x.tipo}) ${recortar(x.contenido, 160)}${x.cuando?.trim() ? ` — MÁNDALA CUANDO: ${recortar(x.cuando, 200)}` : ''}`)
    .join('\n');
  const otros = d.otrosNegocios
    .filter((x) => idDe(ids.negocios, x.id))
    .map((x) => `- ${idDe(ids.negocios, x.id)}: ${x.nombre}${x.sucursal ? ` (sucursal ${x.sucursal})` : ''}${x.direccion ? `, ${x.direccion}` : ''}${x.horario ? `, horario: ${x.horario}` : ''}${x.zonas ? `, atiende: ${x.zonas}` : ''}`)
    .join('\n');
  const grupos = d.grupos
    .filter((x) => idDe(ids.grupos, x.id))
    .map((x) => `- ${idDe(ids.grupos, x.id)}: "${x.nombre}"${x.cuando ? ` — cuándo ofrecerlo: ${x.cuando}` : ''}`)
    .join('\n');
  const cursos = d.cursos.map((x) => `- ${idDe(ids.cursos, x.id)}: "${x.nombre}", ${x.precio}`).join('\n');
  const bots = (d.bots || []).map((x) => `- ${idDe(ids.bots, x.id)}: "${x.nombre}" — ACTÍVALO CUANDO: ${recortar(x.cuando, 200)}`).join('\n');

  const campos = [
    '"resumen": "una línea: qué quiere el cliente y en qué está"',
    '"interes": "qué producto o servicio le interesa, o \\"\\""',
    '"no_quiere_mas": true/false',
    '"positivo": true/false',
    '"etapa": "id de la etapa a la que debería pasar, o null"',
    '"necesita_al_dueno": true/false',
    '"motivo": "si necesita al dueño o hay aviso: una frase concreta para el dueño"',
    '"aviso": null o uno de "fuera", "compro", "pregunta", "molesto", "humano", "otro"',
    ...(conRespuesta
      ? [
          '"puede_responder": true/false',
          '"respuesta": "texto para enviar al cliente, o \\"\\""',
          ...(respuestas ? ['"respuestas_rapidas": ["ids de respuestas rápidas para mandar después de tu respuesta"]'] : []),
          ...(grupos ? ['"grupo": "id del grupo al que ACEPTÓ unirse, o null"'] : []),
          ...(otros ? ['"pase": null o { "negocio_id": "id", "mensaje": "primer mensaje que le escribirá esa sucursal", "nota": "contexto corto para el equipo" }'] : []),
          ...(cursos ? ['"qr": "id del curso cuyo QR de pago hay que mandarle, o null"'] : []),
          ...(bots ? ['"bot": "id de la regla o flujo del bot que hay que activar ahora, o null"'] : []),
        ]
      : []),
  ];

  const sistema = `Eres el asistente de WhatsApp de un negocio, dentro de su CRM. Lees la conversación con un cliente y devuelves SOLO un objeto JSON.

FICHA DEL NEGOCIO (escrita por el dueño):
"""
${ficha}
"""

${
    d.club?.trim()
      ? `HORARIOS, CUPOS Y PRECIOS EN VIVO (del sistema del club; si algo no coincide con la ficha, manda esto):
"""
${d.club.trim()}
"""
- Para horarios, cupos y mensualidades usa estos datos. No ofrezcas un grupo LLENO: ofrece otro horario del mismo curso o, si no hay, otra sucursal. Si quedan pocos cupos, puedes decirlo.

`
      : ''
  }${
    d.aprendido?.trim()
      ? `RESPUESTAS QUE YA DIO EL DUEÑO (a preguntas que no estaban en la ficha; úsalas si encajan):
${d.aprendido.trim()}

`
      : ''
  }ETAPAS DEL EMBUDO (id: nombre):
${etapas || '(sin etapas)'}

Devuelve exactamente este JSON:
{
  ${campos.join(',\n  ')}
}

Reglas:
- Fíjate sobre todo en los últimos mensajes del cliente.
- no_quiere_mas = true solo si pide claramente no recibir más mensajes o dice que no le interesa. Una duda, un "ahora no puedo" o un "lo pienso" NO es eso.
- positivo = true si respondió con interés, confirmó o aceptó algo.
- etapa: solo un id de la lista; null si no está claro o si ya está en la etapa correcta. Sé conservador: ante la duda, null.
- necesita_al_dueno = true si pregunta o pide algo que no puedes responder con la ficha (un precio que no está, un producto distinto, un caso particular, una queja). Si saluda, agradece, dice "ok" o pregunta algo que la ficha responde, es false.
- aviso: algo importante que el dueño debe saber en su celular. "fuera" = le interesa algo que no está en la ficha; "compro" = compró, se inscribió, pagó o confirmó; "pregunta" = algo que solo el dueño puede responder; "molesto" = queja o enojo; "humano" = pide hablar con una persona; "otro" = otra cosa urgente. null si no es importante.
- motivo: en español, corto y concreto, que el dueño entienda sin leer el chat.${
    conRespuesta
      ? `

RESPUESTA AL CLIENTE ("puede_responder" y "respuesta"):
- Escribe lo que el negocio le enviaría ahora por WhatsApp, contestando sus últimos mensajes y teniendo en cuenta toda la conversación.
- Usa SOLO la ficha del negocio y lo que ya se dijo. Si falta un dato (precio, disponibilidad, un producto que no figura, un caso particular), NO lo inventes: "puede_responder": false, "respuesta": "" y "necesita_al_dueno": true.
- Si el cliente no espera respuesta (solo dijo "ok" o "gracias" al final), "respuesta": "" o una despedida muy corta. Si no quiere más mensajes, "respuesta": "".
- Nunca prometas descuentos, fechas ni nada que no esté en la ficha. No hables del CRM ni de la IA. Si te preguntan si eres un bot, no lo niegues: di que eres el asistente virtual del negocio.
- Estilo: tono ${v('tono', e.tono)}; ${v('trato', e.trato)}; ${v('emojis', e.emojis)}; largo ${v('largo', e.largo)}; formato: ${v('saltos', e.saltos)}.${e.usar_nombre ? ' Puedes usar el nombre del cliente si es un nombre de persona.' : ' No uses el nombre del cliente.'}${d.ia.instrucciones.trim() ? `\n- Instrucciones del dueño: ${d.ia.instrucciones.trim()}` : ''}${d.ia.ejemplos.trim() ? `\n- Ejemplos de cómo escribe el dueño (imita su forma, no copies los datos):\n"""\n${d.ia.ejemplos.trim()}\n"""` : ''}${
          respuestas
            ? `

RESPUESTAS RÁPIDAS DEL NEGOCIO (id: título, tipo, contenido):
${respuestas}
- Si alguna ayuda a responder (una foto de la ubicación, un PDF con precios...), pon su id en "respuestas_rapidas" (como mucho 2). Se mandan después de tu respuesta, tal como están. No repitas su contenido: puedes presentarla ("te paso la ubicación").
- Cada una se manda una sola vez a cada cliente: las que ya recibió no están en la lista.
- Si una dice "MÁNDALA CUANDO", mándala en esa situación (y no en otras): es lo que pidió el dueño.`
            : ''
        }${
          otros
            ? `

OTRAS SUCURSALES Y NEGOCIOS (id: datos):
${otros}
- Si el cliente busca otra sucursal (otra ciudad o zona, otra dirección) o algo que da otro negocio de la lista, ofrécele que esa sucursal le escriba. Usa las zonas para sugerir la más cercana.
- Solo cuando el cliente ACEPTE claramente que esa sucursal le escriba, completa "pase": el id, el primer mensaje que le escribirá esa sucursal (presentándose, sin repetir lo ya hablado) y una nota corta para el equipo. En tu respuesta dile que en un momento le escriben. Si todavía no aceptó, pregúntale y deja "pase": null.`
            : ''
        }${
          grupos
            ? `

GRUPOS DE WHATSAPP A LOS QUE PUEDES INVITAR (id: nombre, cuándo ofrecerlo):
${grupos}
- Si encaja, invítalo. Solo cuando ACEPTE unirse, pon el id en "grupo": el link se manda solo, no lo escribas tú. Si todavía no aceptó, deja "grupo": null.`
            : ''
        }${
          cursos
            ? `

CURSOS CON INSCRIPCIÓN POR QR (id: nombre, precio):
${cursos}
- Cuando el cliente quiera inscribirse o pregunte cómo pagar uno de estos cursos, pon su id en "qr": se le manda sola la imagen del QR para pagar. No escribas números de cuenta. En tu respuesta dile que cuando pague te mande la foto del comprobante.
- No confirmes pagos ni inscripciones tú: el comprobante lo revisa el sistema.`
            : ''
        }${
          bots
            ? `

REGLAS Y FLUJOS DEL BOT QUE PUEDES ACTIVAR (id: nombre — cuándo):
${bots}
- Cuando se cumpla el "cuándo" de uno, pon su id en "bot": el bot le manda sus propios mensajes (y sus preguntas, si es un flujo). Tu respuesta debe ser corta o vacía para no repetir lo que manda el bot.`
            : ''
        }`
      : ''
  }`;

  const quien = { cliente: 'Cliente', nosotros: 'Nosotros', automatico: 'Nosotros (mensaje automático)' };
  const usuario = `Fecha y hora actual: ${d.ahora}
Etapa actual del cliente: ${d.etapaActual ? `${idDe(ids.etapas, d.etapaActual) ?? '?'} ("${d.etapas.find((x) => x.id === d.etapaActual)?.nombre ?? 'otra'}")` : 'ninguna'}
Nombre en WhatsApp: ${d.nombreCliente || '(sin nombre)'}

CONVERSACIÓN (la más antigua primero):
${d.conversacion.map((m) => `[${m.cuando}] ${quien[m.quien]}: ${m.texto}`).join('\n') || '(sin mensajes)'}`;

  return { mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], ids };
}

// Revisa lo que devolvió la IA: solo ids que existen, textos recortados, tipos correctos.
export function validarResultado(j: Record<string, unknown>, ids: ReturnType<typeof armarMensajes>['ids'], conRespuesta: boolean): ResultadoIA {
  const tipos = Object.keys(TIPOS_AVISO) as TipoAviso[];
  const real = (m: Mapa, x: unknown) => (typeof x === 'string' ? m.get(x.trim()) ?? null : null);
  const paseCrudo = j.pase && typeof j.pase === 'object' ? (j.pase as Record<string, unknown>) : null;
  const negocioPase = paseCrudo ? real(ids.negocios, paseCrudo.negocio_id) : null;
  const respuesta = conRespuesta ? String(j.respuesta ?? '').trim().slice(0, 2000) : '';
  return {
    resumen: recortar(j.resumen, 200),
    interes: recortar(j.interes, 100),
    no_quiere_mas: j.no_quiere_mas === true,
    positivo: j.positivo === true,
    etapa: real(ids.etapas, j.etapa),
    necesita_al_dueno: j.necesita_al_dueno === true,
    motivo: recortar(j.motivo, 240),
    aviso: tipos.includes(j.aviso as TipoAviso) ? (j.aviso as TipoAviso) : null,
    puede_responder: conRespuesta && j.puede_responder !== false && !!respuesta,
    respuesta,
    respuestas_rapidas: conRespuesta && Array.isArray(j.respuestas_rapidas)
      ? [...new Set(j.respuestas_rapidas.map((x) => real(ids.respuestas, x)).filter((x): x is string => !!x))].slice(0, 2)
      : [],
    grupo: conRespuesta ? real(ids.grupos, j.grupo) : null,
    pase:
      conRespuesta && negocioPase && String(paseCrudo!.mensaje ?? '').trim()
        ? { negocio_id: negocioPase, mensaje: String(paseCrudo!.mensaje).trim().slice(0, 1000), nota: recortar(paseCrudo!.nota, 300) }
        : null,
    qr: conRespuesta ? real(ids.cursos, j.qr) : null,
    bot: conRespuesta ? real(ids.bots, j.bot) : null,
  };
}
