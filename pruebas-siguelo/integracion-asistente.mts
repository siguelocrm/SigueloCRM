// Prueba de la IA en el seguimiento (adapta cada recordatorio y reactivación a
// la conversación) y del asistente (responde y propone cambios que se aplican
// con "Aplicar"), con Postgres en memoria, WhatsApp falso y OpenAI falsa.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase, db } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { revisarEmpresa } = await import(R + 'motor.ts');
const { procesarCola } = await import(R + 'cola.ts');
const { olvidarCache, configDeEmpresa } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
const { conversar, aplicarAcciones } = await import(R + 'ia/asistente.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

// ---------- OpenAI falsa ----------
type Llamada = { sistema: string; usuario: string; historia: number };
const llamadas: Llamada[] = [];
let adaptar: (l: Llamada) => any = () => ({ enviar: true, texto: 'x' });
let asistente: (l: Llamada) => any = () => ({ respuesta: 'x', acciones: [] });
let fallar = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  if (!String(url).startsWith('https://api.openai.com/')) return fetchReal(url, init);
  if (fallar > 0) {
    fallar--;
    return new Response(JSON.stringify({ error: { message: 'server error' } }), { status: 500 });
  }
  const { messages } = JSON.parse(init.body);
  const l = { sistema: messages[0].content, usuario: messages[messages.length - 1].content, historia: messages.length - 2 };
  llamadas.push(l);
  const json = l.sistema.includes('Vas a enviar') ? adaptar(l) : asistente(l);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 800, completion_tokens: 60 } }), { status: 200 });
}) as typeof fetch;

const MIN = 60_000, HORA = 60 * MIN, DIA = 24 * HORA;
const T0 = Date.UTC(2026, 8, 15, 14, 0); // 15 sep 2026, 10:00 en La Paz
reloj.ahora = T0;
const iso = (t: number) => new Date(t).toISOString();
const en = (t: number) => { reloj.ahora = t; };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Academia') returning id`)).id;
const etapas = (await pg.query<any>(`select id, nombre from etapas_venta where empresa_id = $1 order by orden`, [empresa])).rows;
const [primer, negociacion] = etapas;
const lineaId = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Academia', '591', 'activo') returning id`, [empresa])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, horario, info_ia) values ($1, 'Academia de Motos', 'de 8 a 18', 'Curso de mecánica de motos: 150 Bs, empieza el lunes.') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [lineaId, empresa, negocio]);
const dueno = '00000000-0000-0000-0000-000000000001';
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Dueño', 'dueno')`, [dueno, empresa]);
await pg.query(
  `insert into siguelo_ajustes (empresa_id, activo, activado_en, hora_inicio, hora_fin, pausa_min_seg, pausa_max_seg, min_entre_misma_persona_min, adaptar)
   values ($1, true, $2, '00:00', '23:59', 0, 0, 0, '{"activo": true, "recordatorios": true, "reactivaciones": true, "instrucciones": "Siempre menciona que empieza el lunes"}'::jsonb)`,
  [empresa, iso(T0 - DIA)],
);
await pg.query(`insert into siguelo_etapas (etapa_id, empresa_id, recordatorios) values ($1, $2, $3::jsonb)`, [
  primer.id,
  empresa,
  JSON.stringify({ activa: true, modo: 'origen', pasos: [{ horas: 24, variantes: ['Hola {nombre}, ¿pudiste ver la información?'] }, { horas: 72, variantes: ['{nombre}, ¿seguimos?'] }] }),
]);
await pg.query(`insert into siguelo_ia (empresa_id, activa, modo, clave_final) values ($1, true, 'borrador', '1234')`, [empresa]);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);

const chat = async (tel: string, nombre: string) =>
  (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, ultima_actividad, creado_en) values ($1, $2, $3, 'abierto', $4, $4) returning id`, [lineaId, tel, nombre, iso(reloj.ahora)])).id;
const msg = async (conv: string, remitente: 'cliente' | 'agente', texto: string) => {
  await pg.query(`insert into mensajes (conversacion_id, remitente, agente_id, contenido, creado_en) values ($1, $2, $3, $4, $5)`, [conv, remitente, remitente === 'agente' ? dueno : null, texto, iso(reloj.ahora)]);
  await pg.query(`update conversaciones set ultima_actividad = $2 where id = $1`, [conv, iso(reloj.ahora)]);
};
const ajustes = async () => (await db.from('siguelo_ajustes').select('*').eq('empresa_id', empresa).single()).data;
const motor = async () => revisarEmpresa(await ajustes());
const cola = async () => {
  olvidarCache();
  olvidarNegocios();
  await procesarCola(await ajustes());
};
const contactoDe = async (tel: string) => uno(`select * from contactos where telefono = $1`, [tel]);
const colaDe = async (id: string) => (await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 order by creado_en`, [id])).rows;

// ---------- 1. El recordatorio sale adaptado a la conversación ----------
const conv = await chat('59170000001', 'Nico');
await msg(conv, 'cliente', 'Hola, ¿cuánto cuesta el curso de motos?');
await msg(conv, 'agente', 'Hola Nico, cuesta 150 Bs y empieza el lunes.');
en(T0 + MIN);
await motor();
const nico = await contactoDe('59170000001');
en(T0 + DIA + 2 * MIN);
adaptar = () => ({ enviar: true, texto: 'Nico, ¿pudiste pensar lo del curso de motos? Recuerda que empieza el lunes 🙌 ¿Te guardo un lugar?' });
await cola();
const l1 = llamadas.at(-1)!;
assert.match(l1.usuario, /MENSAJE BASE:\n"""\nHola Nico, ¿pudiste ver la información\?/, 'parte del mensaje que escribiste');
assert.match(l1.usuario, /Cliente: Hola, ¿cuánto cuesta el curso de motos\?/, 've la conversación');
assert.match(l1.sistema, /Curso de mecánica de motos: 150 Bs/, 've la ficha del negocio');
assert.match(l1.sistema, /Siempre menciona que empieza el lunes/, 'y tus instrucciones');
assert.equal(enviados.at(-1)!.texto, 'Nico, ¿pudiste pensar lo del curso de motos? Recuerda que empieza el lunes 🙌 ¿Te guardo un lugar?');
let items = await colaDe(nico.id);
assert.equal(items[0].estado, 'enviado');
assert.equal(items[0].texto, enviados.at(-1)!.texto, 'en la cola queda lo que salió de verdad');
assert.match((await uno(`select texto from siguelo_registro order by creado_en desc limit 1`)).texto, /adaptado por la IA/);
paso('el recordatorio sale adaptado a la conversación, con la ficha del negocio y tus instrucciones');

// ---------- 2. Si la IA ve que ya no corresponde, no lo manda ----------
await motor();
en(T0 + 3 * DIA + 2 * MIN);
adaptar = () => ({ enviar: false, motivo: 'El cliente dijo que ya se inscribió en otro lado' });
const antes = enviados.length;
await cola();
assert.equal(enviados.length, antes);
items = await colaDe(nico.id);
assert.equal(items[1].estado, 'cancelado');
assert.match(items[1].motivo, /La IA no lo mandó: El cliente dijo que ya se inscribió/);
paso('si la IA ve en la conversación que ya no corresponde, no lo manda y queda anotado por qué');

// ---------- 3. Si la IA falla, sale el texto que escribiste ----------
const conv2 = await chat('59170000002', 'Olga');
await msg(conv2, 'cliente', 'Info por favor');
en(T0 + 3 * DIA + 5 * MIN);
await motor();
en(T0 + 4 * DIA + 6 * MIN);
fallar = 1;
await cola();
assert.equal(enviados.at(-1)!.texto, 'Hola Olga, ¿pudiste ver la información?');
paso('si la IA falla, sale el mensaje tal como lo escribiste');

// ---------- 4. El asistente explica y propone cambios ----------
const c = await configDeEmpresa(empresa);
assert.ok(c);
asistente = (l) => {
  assert.match(l.sistema, /- e1: "Primer Contacto"/);
  assert.match(l.sistema, /Recordatorios: contados desde que entra a la etapa — 1\) 1 día: "Hola \{nombre\}, ¿pudiste ver la información\?"/, 've cómo está configurado');
  assert.match(l.sistema, /la IA adapta los mensajes: sí/);
  assert.match(l.sistema, /salió "Primer Contacto · Recordatorio 1" \(adaptado/, 've el registro');
  return { respuesta: 'Tus recordatorios de "Primer Contacto" salen al día 1 y al día 3 desde que el cliente entra a la etapa.', acciones: [] };
};
let r = await conversar(c!, dueno, '¿Cuándo salen los recordatorios?');
assert.ok(r.ok);
assert.match(r.mensaje.texto, /al día 1 y al día 3/);
assert.equal(r.mensaje.acciones.length, 0);
paso('el asistente responde preguntas con la configuración y el registro reales');

asistente = (l) => {
  assert.equal(l.historia, 2, 've la conversación anterior');
  return {
    respuesta: 'Listo, te preparé los cambios: pulsa "Aplicar".',
    acciones: [
      { tipo: 'secuencia', etapa: 'e1', negocio: null, cual: 'reactivacion', modo: 'origen', horas: [1, 3, 5, 8], textos: [['¿Pudiste ver mi mensaje, {nombre}?'], ['Te escribo de nuevo por el curso 🙂'], ['¿Te ayudo con algo más?'], ['Última vez que te escribo hoy, ¿te interesa?']] },
      { tipo: 'secuencia', etapa: 'e1', negocio: null, cual: 'recordatorios', modo: 'origen', horas: [24, 72, 120], textos: [null, null, ['{nombre}, el curso empieza el lunes, ¿te guardo un lugar?']] },
      { tipo: 'seguimiento', maximo_diario: 40 },
      { tipo: 'secuencia', etapa: 'e99', cual: 'recordatorios', horas: [1] },
      { tipo: 'secuencia', etapa: 'e2', cual: 'reactivacion', horas: [1, 2] },
    ],
  };
};
r = await conversar(c!, dueno, 'Pon las reactivaciones de 1, 3, 5 y 8 horas y los recordatorios al 1, 3 y 5 días, y que salgan máximo 40 por día');
assert.ok(r.ok);
const acc = r.mensaje.acciones as any[];
assert.equal(acc.length, 3);
assert.equal(acc[0].descripcion, 'Reactivación de "Primer Contacto": 4 mensajes a 1 h, 3 h, 5 h y 8 h, contados desde que le escribiste, con textos nuevos');
assert.equal(acc[1].descripcion, 'Recordatorios de "Primer Contacto": 3 mensajes a 1 día, 3 días y 5 días, contados desde que entra a la etapa, con textos nuevos');
assert.equal(acc[2].descripcion, 'Seguimiento: máximo 40 mensajes por día por número');
assert.match(r.mensaje.texto, /No pude preparar todo: no encontré la etapa; falta el texto del mensaje 1/);
const cfgAntes = await uno(`select * from siguelo_etapas where etapa_id = $1 and negocio_id is null`, [primer.id]);
assert.equal(cfgAntes.recordatorios.pasos.length, 2, 'todavía no cambió nada');
paso('el asistente prepara los cambios (y explica lo que no pudo), sin tocar nada todavía');

const ap = await aplicarAcciones(empresa, r.mensaje.id);
assert.ok(ap.ok);
const cfg = await uno(`select * from siguelo_etapas where etapa_id = $1 and negocio_id is null`, [primer.id]);
assert.deepEqual(cfg.reactivacion.pasos.map((p: any) => p.horas), [1, 3, 5, 8]);
assert.equal(cfg.reactivacion.activa, true);
assert.deepEqual(cfg.recordatorios.pasos.map((p: any) => p.horas), [24, 72, 120]);
assert.deepEqual(cfg.recordatorios.pasos[0].variantes, ['Hola {nombre}, ¿pudiste ver la información?'], 'conserva los textos que ya tenías');
assert.deepEqual(cfg.recordatorios.pasos[2].variantes, ['{nombre}, el curso empieza el lunes, ¿te guardo un lugar?']);
assert.equal((await ajustes()).maximo_diario, 40);
assert.equal((await aplicarAcciones(empresa, r.mensaje.id)).ok, false, 'no se aplica dos veces');
paso('al pulsar "Aplicar" se hacen los cambios (una sola vez), conservando los textos que ya tenías');

asistente = () => ({ respuesta: 'Listo.', acciones: [{ tipo: 'ia', modo: 'automatico', estilo: { emojis: 'ninguno', tono: 'inventado' } }, { tipo: 'ficha', negocio: 'n1', agregar: 'Los sábados atendemos de 9 a 12.' }] });
r = await conversar(c!, dueno, 'Que la IA responda sola, sin emojis, y agrega que los sábados atendemos de 9 a 12');
assert.ok(r.ok);
assert.match(String((r.mensaje.acciones as any[])[0].descripcion), /IA: modo automática y estilo: .*no uses emojis/);
await aplicarAcciones(empresa, r.mensaje.id);
const ia = await uno(`select modo, estilo from siguelo_ia where empresa_id = $1`, [empresa]);
assert.equal(ia.modo, 'automatico');
assert.equal(ia.estilo.emojis, 'ninguno');
assert.equal(ia.estilo.tono, 'amable', 'un valor inventado no se guarda');
assert.match((await uno(`select info_ia from siguelo_negocios where id = $1`, [negocio])).info_ia, /empieza el lunes\.\n\nLos sábados atendemos de 9 a 12\./);
paso('también cambia los ajustes de la IA y la ficha del negocio, validando cada valor');

console.log(`\n${ok} pasos OK · mensajes "enviados":`);
for (const e of enviados) console.log('  →', e.jid, JSON.stringify(e.texto));
