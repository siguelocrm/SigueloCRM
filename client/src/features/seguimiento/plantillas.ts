import type { AjustesSeguimiento, EtapaSeguimiento, Paso, Secuencia } from './tipos';

// Textos de ejemplo traídos de la extensión SígueloCRM (comun/secuencias-iniciales.js).
// Se cargan en una etapa con "Cargar ejemplo" y después los cambias a tu gusto.

const paso = (horas: number, variantes: string[]): Paso => ({ horas, variantes });

export const secuenciaVacia = (modo: Secuencia['modo']): Secuencia => ({ activa: false, modo, pasos: [] });

const REACTIVACION_GENERAL: Secuencia = {
  activa: true,
  modo: 'encadenado',
  pasos: [
    paso(1, [
      'Hola {nombre}, ¿pudiste ver mi mensaje? Cualquier duda me dices.',
      '{nombre}, solo para confirmar que te llegó mi mensaje 🙂',
      'Hola {nombre}, ¿todo bien? Quedo atento a tu respuesta.',
    ]),
    paso(3, [
      'Hola {nombre}, te escribo de nuevo por si no viste mi mensaje anterior.',
      '{nombre}, ¿pudiste revisar lo que te envié? Quedo atento.',
      'Hola {nombre}, cualquier duda que tengas, con gusto te la resuelvo.',
    ]),
    paso(5, [
      '{nombre}, sé que puedes estar ocupado. Te respondo apenas me escribas.',
      'Hola {nombre}, sin apuro. Cuando tengas un momento me cuentas.',
      'Hola {nombre}, aquí sigo por si necesitas algo más.',
    ]),
    paso(8, [
      'Hola {nombre}, no te escribo más por hoy. Cuando puedas, me respondes. ¡Buen día!',
      '{nombre}, te dejo tranquilo por ahora. Aquí estaré cuando quieras continuar.',
      'Hola {nombre}, quedo pendiente de tu respuesta cuando te sea posible.',
    ]),
  ],
};

export interface Plantilla {
  id: string;
  nombre: string;
  descripcion: string;
  recordatorios: Secuencia;
  reactivacion: Secuencia;
  // Días para pasar a la etapa siguiente al terminar sin respuesta (la etapa la eliges tú).
  dias: number;
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'primer_contacto',
    nombre: 'Primer contacto',
    descripcion: '4 recordatorios (1, 4, 6 y 8 días) y reactivación a la 1, 3, 5 y 8 h de tu mensaje.',
    recordatorios: {
      activa: true,
      modo: 'origen',
      pasos: [
        paso(24, [
          'Hola {nombre}, ¿cómo estás? Te escribo para saber qué te pareció la información que te compartí. ¿Te quedó alguna duda?',
          'Hola {nombre}, espero que estés muy bien. Quería saber si pudiste revisar lo que conversamos y qué te pareció.',
          '{nombre}, ¡hola! ¿Pudiste pensar en lo que te comenté? Estoy atento por si necesitas más información.',
        ]),
        paso(96, [
          'Hola {nombre}, te escribo de nuevo por si quedó algo pendiente. ¿Te gustaría que te ayude con algo más?',
          '{nombre}, ¿cómo vas? Quería retomar nuestra conversación, por si aún te interesa.',
          'Hola {nombre}, sé que a veces el día se pasa volando. ¿Seguimos con lo que habíamos hablado?',
        ]),
        paso(144, [
          'Hola {nombre}, ¿cómo va todo? Solo quería recordarte que sigo aquí por si te interesa retomar lo que conversamos.',
          '{nombre}, ¡hola! Paso por aquí por si tienes alguna pregunta. Con gusto te ayudo.',
          'Hola {nombre}, espero que tengas un buen día. Si en algún momento quieres más información, me escribes.',
        ]),
        paso(192, [
          'Hola {nombre}, no quiero molestarte. Te dejo mi contacto por si más adelante te animas. ¡Que estés muy bien!',
          '{nombre}, este es mi último recordatorio por ahora. Cuando quieras retomar, aquí estaré.',
          'Hola {nombre}, entiendo que quizás no es el momento. Si cambias de opinión, escríbeme cuando quieras.',
        ]),
      ],
    },
    reactivacion: REACTIVACION_GENERAL,
    dias: 7,
  },
  {
    id: 'va_asistir',
    nombre: 'Va a asistir',
    descripcion: '1 recordatorio para confirmar la asistencia y reactivación a la 1 y 3 h.',
    recordatorios: {
      activa: true,
      modo: 'origen',
      pasos: [
        paso(24, [
          'Hola {nombre}, te escribo para confirmar tu asistencia. ¿Sigue en pie?',
          '{nombre}, ¡hola! Solo para recordarte lo que conversamos. ¿Nos vemos como quedamos?',
          'Hola {nombre}, ¿todo bien para tu visita? Cualquier cambio me avisas.',
        ]),
      ],
    },
    reactivacion: {
      activa: true,
      modo: 'encadenado',
      pasos: [
        paso(1, [
          'Hola {nombre}, ¿pudiste ver mi mensaje sobre tu asistencia?',
          '{nombre}, solo para confirmar que te llegó mi mensaje 🙂',
          'Hola {nombre}, quedo atento a tu confirmación.',
        ]),
        paso(3, [
          'Hola {nombre}, cuando puedas me confirmas, por favor.',
          '{nombre}, sin apuro. Me avisas si sigue en pie.',
          'Hola {nombre}, aquí sigo por si necesitas algo antes de venir.',
        ]),
      ],
    },
    dias: 0,
  },
  {
    id: 'inscrito',
    nombre: 'Después de inscribirse',
    descripcion: '"¿Pudiste asistir?" a los 3 días. Sin reactivación.',
    recordatorios: {
      activa: true,
      modo: 'origen',
      pasos: [
        paso(72, [
          'Hola {nombre}, ¿cómo estás? ¿Pudiste asistir? Me encantaría saber cómo te fue.',
          '{nombre}, ¡hola! Quería saber si pudiste asistir y qué te pareció.',
          'Hola {nombre}, espero que estés muy bien. ¿Cómo te fue? ¿Pudiste asistir?',
        ]),
      ],
    },
    reactivacion: { ...REACTIVACION_GENERAL, activa: false },
    dias: 0,
  },
  {
    id: 'remarketing_1',
    nombre: 'Remarketing 1',
    descripcion: 'Un mensaje al entrar y otro a los 3 días, con reactivación.',
    recordatorios: {
      activa: true,
      modo: 'encadenado',
      pasos: [
        paso(0, [
          'Hola {nombre}, ¿cómo estás? Hace unos días conversamos y quería saber si aún te interesa. Tenemos novedades que te pueden gustar.',
          '{nombre}, ¡hola! Pasaron unos días y quería saludarte. Si todavía te interesa, te cuento las novedades.',
          'Hola {nombre}, espero que estés muy bien. ¿Te gustaría que te comparta la información actualizada?',
        ]),
        paso(72, [
          'Hola {nombre}, solo para saber si viste mi mensaje anterior. Cualquier cosa me avisas.',
          '{nombre}, no quiero insistir; si te interesa, con gusto te ayudo.',
          'Hola {nombre}, quedo atento por si quieres retomar.',
        ]),
      ],
    },
    reactivacion: REACTIVACION_GENERAL,
    dias: 14,
  },
  {
    id: 'remarketing_2',
    nombre: 'Remarketing 2 (último)',
    descripcion: 'Un mensaje al entrar y una despedida a los 3 días, con reactivación.',
    recordatorios: {
      activa: true,
      modo: 'encadenado',
      pasos: [
        paso(0, [
          'Hola {nombre}, ¡tanto tiempo! Quería saludarte y contarte que seguimos con cupos disponibles.',
          '{nombre}, hola. Te escribo por si ahora es un mejor momento para retomar lo que conversamos.',
          'Hola {nombre}, espero que todo vaya bien. Si en algún momento te interesa, aquí estoy.',
        ]),
        paso(72, [
          'Hola {nombre}, este es mi último mensaje por ahora. ¡Te deseo lo mejor!',
          '{nombre}, te dejo tranquilo. Cuando quieras, me escribes.',
          'Hola {nombre}, gracias por tu tiempo. Si más adelante te interesa, aquí estaré.',
        ]),
      ],
    },
    reactivacion: REACTIVACION_GENERAL,
    dias: 3,
  },
];

export const PIE_EJEMPLO = [
  'Si ya estás inscrito, responde *ya estoy*. Si no quieres recibir más mensajes, responde *stop*.',
  'Si ya te inscribiste, responde *ya estoy*. Si prefieres no recibir más mensajes, responde *stop*.',
];

export const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const configVacia = (etapaId: string, empresaId: string): EtapaSeguimiento => ({
  etapa_id: etapaId,
  empresa_id: empresaId,
  negocio_id: null,
  recordatorios: secuenciaVacia('origen'),
  reactivacion: secuenciaVacia('encadenado'),
  al_terminar: { etapa_id: null, dias: 0 },
});

export const ajustesPorDefecto = (empresaId: string): AjustesSeguimiento => ({
  empresa_id: empresaId,
  activo: false,
  activado_en: null,
  pausado: false,
  motivo_pausa: null,
  zona_horaria: 'America/La_Paz',
  hora_inicio: '08:00',
  hora_fin: '20:00',
  pausa_min_seg: 45,
  pausa_max_seg: 120,
  maximo_diario: 30,
  min_entre_misma_persona_min: 60,
  no_recordar_si_escribio_horas: 24,
  atraso_max_reactivacion_horas: 12,
  ciclos_reactivacion_cada_horas: 24,
  pie: { activo: false, variantes: [] },
});

// Variables que se pueden usar en los textos (las llena el servidor:
// server/src/siguelo/textos.ts y negocios.ts). Salen del nombre del cliente y
// de la ficha del negocio del número que envía; sin ficha, {sucursal} es el
// nombre del número en Conexiones.
export const VARIABLES = ['nombre', 'negocio', 'sucursal', 'direccion', 'horario'];
export const TEXTO_VARIABLES = VARIABLES.map((v) => `{${v}}`).join(', ');
export const variablesDesconocidas = (texto: string): string[] =>
  [...new Set([...texto.matchAll(/\{([\p{L}_]+)\}/gu)].map((m) => m[1].toLowerCase()))].filter((v) => !VARIABLES.includes(v));

// Las variantes se escriben en un solo cuadro, separadas por una línea con ---
export const variantesATexto = (variantes: string[]): string => variantes.join('\n---\n');
export const textoAVariantes = (texto: string): string[] =>
  texto
    .split(/^\s*---\s*$/m)
    .map((v) => v.trim())
    .filter(Boolean);
