// Prueba de punta a punta del motor y la cola, con Postgres en memoria,
// WhatsApp falso y reloj falso. Simula días de conversación en segundos.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase, db } from './mock-db.mjs';
import { enviados, linea } from './mock-sesiones.mjs';

import { redirigidos } from './hooks.mjs';

// Nunca contra el Supabase real: si la redirección fallara, esto apunta a ninguna parte.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { revisarEmpresa } = await import(R + 'motor.ts');
const { procesarCola } = await import(R + 'cola.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'), 'la base y el WhatsApp son los de prueba');

const MIN = 60_000, HORA = 60 * MIN, DIA = 24 * HORA;
const T0 = Date.UTC(2026, 8, 15, 14, 0); // 15 sep 2026, 10:00 en La Paz
reloj.ahora = T0;
const iso = (t: number) => new Date(t).toISOString();
const en = (t: number) => { reloj.ahora = t; };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Prueba') returning id`)).id;
const etapas = (await pg.query<any>(`select id, nombre from etapas_venta where empresa_id = $1 order by orden`, [empresa])).rows;
const [primer, negociacion] = etapas;
const lineaId = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'L1', '591', 'activo') returning id`, [empresa])).id;
const dueno = '00000000-0000-0000-0000-000000000001';
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Dueño', 'dueno')`, [dueno, empresa]);

await pg.query(
  `insert into siguelo_ajustes (empresa_id, activo, activado_en, hora_inicio, hora_fin, pausa_min_seg, pausa_max_seg)
   values ($1, true, $2, '00:00', '23:59', 0, 0)`,
  [empresa, iso(T0 - DIA)],
);
const sec = (modo: string, horas: number[], letra: string) => ({
  activa: true,
  modo,
  pasos: horas.map((h, i) => ({ horas: h, variantes: [`Hola {nombre}, ${letra}${i + 1} (A)`, `{nombre}, ${letra}${i + 1} (B) desde {sucursal}`] })),
});
await pg.query(`insert into siguelo_etapas (etapa_id, empresa_id, recordatorios, reactivacion, al_terminar) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`, [
  primer.id,
  empresa,
  JSON.stringify(sec('origen', [24, 96], 'recordatorio ')),
  JSON.stringify(sec('encadenado', [1, 3], 'reactivación ')),
  JSON.stringify({ etapa_id: negociacion.id, dias: 2 }),
]);

const chat = async (tel: string, nombre: string, desde: number) =>
  (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, ultima_actividad, creado_en) values ($1, $2, $3, 'abierto', $4, $4) returning id`, [lineaId, tel, nombre, iso(desde)])).id;
const msg = async (conv: string, remitente: 'cliente' | 'agente', t: number, texto = 'x') => {
  await pg.query(`insert into mensajes (conversacion_id, remitente, agente_id, contenido, creado_en) values ($1, $2, $3, $4, $5)`, [conv, remitente, remitente === 'agente' ? dueno : null, texto, iso(t)]);
  await pg.query(`update conversaciones set ultima_actividad = $2 where id = $1`, [conv, iso(t)]);
};
const ajustes = async () => (await db.from('siguelo_ajustes').select('*').eq('empresa_id', empresa).single()).data;
const motor = async () => revisarEmpresa(await ajustes());
const cola = async () => procesarCola(await ajustes());
const contactoDe = async (tel: string) => uno(`select * from contactos where telefono = $1`, [tel]);
const segDe = async (id: string) => uno(`select * from siguelo_seguimientos where contacto_id = $1`, [id]);
const pendientes = async (id: string) => (await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 and estado = 'pendiente' order by vence`, [id])).rows;

// Viejo: un chat de hace 10 días que volvió a escribir hace una hora. Nuevo: escribe por primera vez.
const chatViejo = await chat('59170000001', 'Viejo Cliente', T0 - 10 * DIA);
await msg(chatViejo, 'cliente', T0 - 10 * DIA);
await msg(chatViejo, 'agente', T0 - 10 * DIA + HORA);
await msg(chatViejo, 'cliente', T0 - HORA);
const chatNuevo = await chat('59170000002', 'Nuevo Cliente', T0);
await msg(chatNuevo, 'cliente', T0, 'Hola, quiero información');

// ---- Vuelta 1 ----
en(T0 + MIN);
await motor();
const nuevo = await contactoDe('59170000002');
const viejo = await contactoDe('59170000001');
assert.ok(nuevo && viejo, 'el motor crea las fichas que faltan');
assert.equal(nuevo.etapa_id, primer.id);
assert.equal((await segDe(viejo.id)).rec.previo, true);
assert.equal((await pendientes(viejo.id)).length, 0);
paso('un chat que ya existía antes de activar no recibe recordatorios');
let p = await pendientes(nuevo.id);
assert.equal(p.length, 1);
assert.equal(p[0].nombre, 'Primer Contacto · Recordatorio 1');
assert.equal(new Date(p[0].vence).getTime(), T0 + 24 * HORA);
await cola();
assert.equal(enviados.length, 0);
paso('contacto nuevo: Recordatorio 1 programado a las 24 h de su primer mensaje, y no sale antes');

// ---- Día 1: sale el recordatorio ----
en(T0 + 24 * HORA + MIN);
await cola();
assert.equal(enviados.length, 1);
assert.match(enviados[0].texto, /^(Hola Nuevo, recordatorio 1 \(A\)|Nuevo, recordatorio 1 \(B\) desde L1)$/);
assert.equal(enviados[0].jid, '59170000002@s.whatsapp.net');
let s = await segDe(nuevo.id);
assert.equal(s.rec.paso, 1);
assert.ok(s.ultimo_automatico);
assert.equal((await uno(`select enviados from siguelo_contador where empresa_id = $1`, [empresa])).enviados, 1);
assert.equal((await uno(`select count(*)::int n from mensajes where conversacion_id = $1 and remitente = 'agente'`, [chatNuevo])).n, 1);
paso('sale el Recordatorio 1 con su nombre, queda en el chat y suma al contador del día');
await motor();
s = await segDe(nuevo.id);
assert.equal(s.react, null, 'un mensaje automático no cuenta como escrito a mano');
p = await pendientes(nuevo.id);
assert.equal(p.length, 1);
assert.equal(p[0].nombre, 'Primer Contacto · Recordatorio 2');
assert.equal(new Date(p[0].vence).getTime(), T0 + 96 * HORA);
paso('después se programa el Recordatorio 2 (96 h) y no arranca la reactivación');

// ---- Le escribes a mano ----
await msg(chatNuevo, 'agente', T0 + 25 * HORA, 'Te paso los precios');
en(T0 + 25 * HORA + MIN);
await motor();
p = await pendientes(nuevo.id);
const react1 = p.find((x: any) => x.tipo === 'react');
assert.ok(react1, 'arranca la reactivación');
assert.equal(new Date(react1.vence).getTime(), T0 + 26 * HORA);
assert.equal(new Date(p.find((x: any) => x.tipo === 'rec').vence).getTime(), T0 + 96 * HORA);
paso('le escribes a mano: Reactivación 1 programada a la hora');

en(T0 + 26 * HORA + MIN);
await cola();
assert.equal(enviados.length, 2);
assert.match(enviados[1].texto, /reactivación 1/);
await motor();
const react2 = (await pendientes(nuevo.id)).find((x: any) => x.tipo === 'react');
assert.equal(new Date(react2.vence).getTime(), T0 + 28 * HORA + MIN, 'encadenada: 2 h después del envío real');
paso('sale la Reactivación 1 y la 2 queda encadenada al envío real');

// ---- El cliente responde justo antes de la Reactivación 2 ----
en(T0 + 28 * HORA + 2 * MIN);
await msg(chatNuevo, 'cliente', T0 + 28 * HORA, 'Sí, me interesa');
await cola();
assert.equal(enviados.length, 2, 'la cola no envía si hay un mensaje nuevo que el motor todavía no vio');
paso('si el cliente acaba de escribir, la cola espera al motor y no le manda nada encima');
await motor();
s = await segDe(nuevo.id);
assert.equal(s.respondio, true);
assert.equal(s.react.activo, false);
assert.equal((await pendientes(nuevo.id)).length, 0);
const cancelados = (await pg.query<any>(`select motivo from siguelo_cola where contacto_id = $1 and estado = 'cancelado'`, [nuevo.id])).rows;
assert.ok(cancelados.every((c: any) => c.motivo === 'El cliente respondió'));
paso('el cliente respondió: se detiene la reactivación y los recordatorios esperan');

// ---- Le contestas ----
await msg(chatNuevo, 'agente', T0 + 29 * HORA, 'Genial, te espero');
en(T0 + 29 * HORA + MIN);
await motor();
s = await segDe(nuevo.id);
assert.equal(s.respondio, false);
assert.equal(s.react.ciclo, 1, 'no arranca otra reactivación dentro de las 24 h');
p = await pendientes(nuevo.id);
assert.equal(p.length, 1);
assert.equal(p[0].tipo, 'rec');
assert.equal(new Date(p[0].vence).getTime(), T0 + 96 * HORA);
paso('lo atendiste: vuelve el Recordatorio 2, sin otra reactivación en el mismo día');

// ---- Cancelas el Recordatorio 2 desde la pantalla ----
await pg.query(`update siguelo_cola set estado = 'cancelado', a_mano = true, cerrado_en = $2 where id = $1`, [p[0].id, iso(reloj.ahora)]);
await motor();
s = await segDe(nuevo.id);
assert.equal(s.rec.paso, 2);
assert.equal((await pendientes(nuevo.id)).length, 0);
paso('cancelado a mano: ese paso se salta y no se vuelve a programar');

// ---- 2 días sin conversación: pasa a la etapa siguiente ----
en(T0 + 29 * HORA + 2 * DIA - HORA);
await motor();
assert.equal((await contactoDe('59170000002')).etapa_id, primer.id, 'todavía no');
en(T0 + 29 * HORA + 2 * DIA + 2 * MIN);
await motor();
const movido = await contactoDe('59170000002');
assert.equal(movido.etapa_id, negociacion.id);
assert.equal(movido.probabilidad_cierre, 40);
assert.ok((await uno(`select count(*)::int n from siguelo_registro where texto like '%pasó solo%'`)).n === 1);
paso('terminó sin respuesta: pasa solo a "En Negociación" a los 2 días, con su probabilidad');

// ---- Tope diario y error de envío ----
const chatDora = await chat('59170000003', 'Dora', reloj.ahora);
await msg(chatDora, 'cliente', reloj.ahora, 'Hola');
const t1 = reloj.ahora;
en(t1 + MIN);
await motor();
const dora = await contactoDe('59170000003');
en(t1 + 24 * HORA + MIN);
await pg.query(`update siguelo_ajustes set maximo_diario = 0`);
await cola();
assert.equal(enviados.length, 2, 'con el tope del día lleno no sale nada');
paso('respeta el máximo por día');
await pg.query(`update siguelo_ajustes set maximo_diario = 30`);
linea.activa = false;
await cola();
assert.equal(enviados.length, 2);
assert.equal((await pendientes(dora.id)).length, 1, 'con la línea desconectada, espera');
paso('si la línea de WhatsApp está desconectada, el mensaje espera');
linea.activa = true;
(linea as any).falla = true;
await cola();
const conError = await uno(`select estado, motivo from siguelo_cola where contacto_id = $1 order by creado_en desc limit 1`, [dora.id]);
assert.equal(conError.estado, 'error');
assert.equal((await segDe(dora.id)).rec.paso, 1, 'un error salta ese paso');
paso('un error de envío queda anotado y se salta ese paso');

// ---- Tope y pausa por número ----
(linea as any).falla = false;
const linea2 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'L2', '592', 'activo') returning id`, [empresa])).id;
await pg.query(`update siguelo_ajustes set maximo_diario = 1`);
await pg.query(`delete from siguelo_contador`);
const t2 = reloj.ahora;
const chatEva = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, ultima_actividad, creado_en) values ($1, '59170000004', 'Eva', 'abierto', $2, $2) returning id`, [linea2, iso(t2)])).id;
await msg(chatEva, 'cliente', t2, 'Hola');
const chatFito = await chat('59170000005', 'Fito', t2);
await msg(chatFito, 'cliente', t2, 'Hola');
const chatGabo = await chat('59170000006', 'Gabo', t2);
await msg(chatGabo, 'cliente', t2, 'Hola');
en(t2 + MIN);
await motor();
en(t2 + 24 * HORA + 2 * MIN);
const antes = enviados.length;
await cola();
const nuevos = enviados.slice(antes).map((e) => e.jid.slice(0, 11));
assert.equal(nuevos.length, 2, 'un mensaje por número en la misma vuelta');
assert.ok(nuevos.includes('59170000004'), 'el número 2 manda el suyo');
await cola();
assert.equal(enviados.length, antes + 2, 'el número 1 ya llegó a su tope de 1 por día: el tercero espera');
const porLinea = (await pg.query<any>(`select linea_id, enviados from siguelo_contador`)).rows;
assert.equal(porLinea.length, 2);
assert.ok(porLinea.every((r: any) => r.enviados === 1));
paso('el tope diario y las pausas se cuentan por cada número');

// ---- Variables: {sucursal} sale del número; una variable que todavía no existe no se envía ----
await pg.query(`update siguelo_ajustes set maximo_diario = 30`);
const vistos = new Set(enviados.map((e) => e.texto));
assert.ok([...vistos].every((t) => !t.includes('{')), 'ningún mensaje salió con una {variable} sin llenar');
await pg.query(
  `update siguelo_etapas set recordatorios = jsonb_set(recordatorios, '{pasos,0,variantes}', '["Te esperamos en {direccion}"]'::jsonb) where negocio_id is null`,
);
const t3 = reloj.ahora + HORA;
en(t3);
const chatHugo = await chat('59170000007', 'Hugo', t3);
await msg(chatHugo, 'cliente', t3, 'Hola');
en(t3 + MIN);
await motor();
const hugo = await contactoDe('59170000007');
en(t3 + 24 * HORA + 2 * MIN);
await motor();
const antesHugo = enviados.length;
await cola();
await cola();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000007')).length, 0, 'no se le manda un texto con {direccion} sin llenar');
const cancelado = await uno(`select estado, motivo from siguelo_cola where contacto_id = $1 order by creado_en desc limit 1`, [hugo.id]);
assert.equal(cancelado.estado, 'cancelado');
assert.match(cancelado.motivo, /Falta completar \{direccion\}/);
assert.equal((await segDe(hugo.id)).rec.paso, 1, 'ese paso se salta');
void antesHugo;
paso('una variable que todavía no existe ({direccion}) nunca llega al cliente: el paso se salta y queda anotado');

// ================= Fase 2: negocios por número =================
const { reglasDelNumero, variablesDeLinea } = await import(R + 'negocios.ts');
// Ficha de la línea 1 (sucursal Quillacollo) y un negocio "Academia" con su propio embudo en la línea 2.
const tienda = (await uno(`insert into siguelo_negocios (empresa_id, nombre, sucursal, direccion, horario) values ($1, 'Tienda', 'Quillacollo', 'Av. Blanco Galindo km 13', 'de 8 a 19') returning id`, [empresa])).id;
const embudoCursos = (await uno(`insert into siguelo_embudos (empresa_id, nombre) values ($1, 'Cursos') returning id`, [empresa])).id;
const maxOrden = (await uno(`select max(orden) m from etapas_venta`)).m;
const interesado = (await uno(`insert into etapas_venta (empresa_id, nombre, tipo, orden) values ($1, 'Interesado', 'normal', $2) returning id, nombre`, [empresa, maxOrden + 1]));
await pg.query(`insert into siguelo_etapa_embudo (etapa_id, embudo_id) values ($1, $2)`, [interesado.id, embudoCursos]);
const academia = (await uno(`insert into siguelo_negocios (empresa_id, nombre, embudo_id) values ($1, 'Academia', $2) returning id`, [empresa, embudoCursos])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3), ($4, $2, $5)`, [lineaId, empresa, tienda, linea2, academia]);
// Textos: el general de Primer Contacto habla de la dirección; Academia tiene los suyos en "Interesado".
await pg.query(
  `update siguelo_etapas set recordatorios = jsonb_set(recordatorios, '{pasos,0,variantes}', '["Te esperamos en {direccion}, {horario} ({sucursal})"]'::jsonb) where negocio_id is null`,
);
await pg.query(`insert into siguelo_etapas (etapa_id, empresa_id, negocio_id, recordatorios) values ($1, $2, $3, $4::jsonb)`, [
  interesado.id,
  empresa,
  academia,
  JSON.stringify({ activa: true, modo: 'origen', pasos: [{ horas: 24, variantes: ['Hola {nombre}, soy de {negocio}'] }] }),
]);
en(reloj.ahora + 2 * DIA); // pasa el tiempo para que el servidor lea los negocios nuevos

assert.deepEqual(await variablesDeLinea(lineaId), { negocio: 'Tienda', sucursal: 'Quillacollo', direccion: 'Av. Blanco Galindo km 13', horario: 'de 8 a 19' });
assert.deepEqual(await variablesDeLinea(linea2), { negocio: 'Academia', sucursal: 'L2', direccion: '', horario: '' });
paso('cada número tiene las variables de la ficha de su negocio');

const t4 = reloj.ahora;
const chatIris = await chat('59170000008', 'Iris', t4); // escribe a la Tienda (línea 1)
await msg(chatIris, 'cliente', t4, 'Hola');
const chatJuan = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, ultima_actividad, creado_en) values ($1, '59170000009', 'Juan', 'abierto', $2, $2) returning id`, [linea2, iso(t4)])).id;
await msg(chatJuan, 'cliente', t4, 'Info del curso');
en(t4 + MIN);
await motor();
const iris = await contactoDe('59170000008');
const juan = await contactoDe('59170000009');
assert.equal(iris.etapa_id, primer.id, 'la Tienda usa el embudo principal');
assert.equal(juan.etapa_id, interesado.id, 'la Academia tiene su propio embudo: entra a "Interesado"');
paso('cada cliente nuevo entra al embudo de su negocio');

en(t4 + 24 * HORA + 2 * MIN);
await motor();
// Hay otros mensajes más viejos en cola: cada vuelta manda uno por número, hasta vaciarla.
for (let i = 0; i < 30; i++) {
  const antes = enviados.length;
  await cola();
  if (enviados.length === antes) break;
}
const aIris = enviados.filter((e) => e.jid.startsWith('59170000008')).map((e) => e.texto);
const aJuan = enviados.filter((e) => e.jid.startsWith('59170000009')).map((e) => e.texto);
assert.deepEqual(aIris, ['Te esperamos en Av. Blanco Galindo km 13, de 8 a 19 (Quillacollo)']);
assert.deepEqual(aJuan, ['Hola Juan, soy de Academia']);
paso('cada negocio manda sus propios textos, con su dirección y horario');

// Bot: una regla solo de la Academia, una de todos.
const reglas = [{ id: 'r-todos' }, { id: 'r-academia' }];
const rTodos = (await uno(`insert into respuestas_automaticas (empresa_id, palabra_clave) values ($1, 'hola') returning id`, [empresa])).id;
const rAcademia = (await uno(`insert into respuestas_automaticas (empresa_id, palabra_clave) values ($1, 'curso') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_bot_negocio (regla_id, negocio_id) values ($1, $2)`, [rAcademia, academia]);
reglas[0].id = rTodos;
reglas[1].id = rAcademia;
en(reloj.ahora + MIN);
assert.deepEqual((await reglasDelNumero(reglas, linea2)).map((r: any) => r.id), [rTodos, rAcademia]);
assert.deepEqual((await reglasDelNumero(reglas, lineaId)).map((r: any) => r.id), [rTodos], 'la Tienda no usa la regla de la Academia');
paso('el bot solo usa las reglas de todos y las del negocio de cada número');

// ================= Fase 4: palabras que cambian de etapa =================
await pg.query(`insert into siguelo_etapas (etapa_id, empresa_id, palabras) values ($1, $2, $3::jsonb)`, [
  negociacion.id,
  empresa,
  JSON.stringify({ cliente: ['ya estoy'], parecidas: ['si voy'], tuyas: ['ya te registré'], respuesta: '¡Genial {nombre}, gracias por avisar!' }),
]);
const perdidaPrincipal = (await uno(`select id from etapas_venta where empresa_id = $1 and tipo = 'perdida' order by orden limit 1`, [empresa])).id;
const t5 = reloj.ahora + HORA;
const nuevoContacto = async (tel: string, nombre: string) => {
  const conv = await chat(tel, nombre, t5);
  await msg(conv, 'cliente', t5, 'Hola');
  return conv;
};
const chatKiko = await nuevoContacto('59170000011', 'Kiko');
const chatLalo = await nuevoContacto('59170000012', 'Lalo');
const chatMimi = await nuevoContacto('59170000013', 'Mimi');
const chatNico = await nuevoContacto('59170000014', 'Nico');
en(t5 + MIN);
await motor(); // los ve por primera vez
const antesF4 = enviados.length;
en(t5 + 10 * MIN);
await msg(chatKiko, 'cliente', reloj.ahora, 'Ya estoy');
await msg(chatLalo, 'cliente', reloj.ahora, 'creo que si voy el sabado con mi hermano');
await msg(chatMimi, 'cliente', reloj.ahora, 'STOP');
await msg(chatNico, 'agente', reloj.ahora, 'Ya te registre, te espero el lunes');
en(reloj.ahora + MIN);
await motor();
const kiko = await contactoDe('59170000011');
assert.equal(kiko.etapa_id, negociacion.id, '"ya estoy" lo pasa solo');
assert.ok(enviados.slice(antesF4).some((e) => e.jid.startsWith('59170000011') && e.texto === '¡Genial Kiko, gracias por avisar!'), 'y se le responde');
assert.equal((await segDe(kiko.id)).deshacer.etapa_antes, primer.id, 'queda para deshacer');
paso('una palabra del cliente en un mensaje corto lo pasa solo de etapa y se le responde');
const mimi = await contactoDe('59170000013');
assert.equal(mimi.etapa_id, perdidaPrincipal, '"stop" lo pasa a la etapa perdida');
assert.ok(enviados.slice(antesF4).some((e) => e.jid.startsWith('59170000013') && /no te enviaremos más mensajes/.test(e.texto)));
assert.equal((await pendientes(mimi.id)).length, 0, 'y no le queda nada en la cola');
paso('"stop" lo pasa a "perdida", se le confirma y no recibe más mensajes');
const lalo = await contactoDe('59170000012');
const segLalo = await segDe(lalo.id);
assert.equal(lalo.etapa_id, primer.id, 'una frase parecida no lo mueve sola');
assert.equal(segLalo.revisar.etapa_id, negociacion.id);
assert.equal((await pendientes(lalo.id)).length, 0, 'sus mensajes automáticos esperan');
paso('una frase parecida en un mensaje largo no actúa sola: queda para revisar y sus mensajes esperan');
assert.equal((await contactoDe('59170000014')).etapa_id, negociacion.id);
paso('una frase tuya ("ya te registré") lo pasa a la etapa configurada');
// La respuesta automática no cuenta como mensaje tuyo: no arranca la reactivación.
en(reloj.ahora + MIN);
await motor();
assert.equal((await segDe(kiko.id)).react, null);
paso('la respuesta a la palabra no cuenta como mensaje tuyo');

// ================= Fase 4: citas =================
const Hr = await import(R + 'horario.ts');
const zonaLP = 'America/La_Paz';
const chatOfe = await chat('59170000015', 'Ofe', reloj.ahora);
await msg(chatOfe, 'cliente', reloj.ahora, 'Quiero agendar');
const ofe = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, '59170000015', 'Ofe') on conflict (empresa_id, telefono) do update set nombre = excluded.nombre returning id`, [empresa])).id;
const manana = Hr.fechaMasDias(Hr.fechaDe(reloj.ahora, zonaLP), 1);
const inicio = Hr.instante(manana, '16:00', zonaLP);
const cita = (await uno(`insert into siguelo_citas (empresa_id, contacto_id, inicio, fin, actualizado_en) values ($1, $2, $3, $4, $5) returning id`, [empresa, ofe, iso(inicio), iso(inicio + HORA), iso(reloj.ahora)])).id;
await pg.query(`update siguelo_ajustes set maximo_diario = 0`); // las citas no cuentan para el tope
await motor();
let pCita = (await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 and estado = 'pendiente' and tipo = 'cita'`, [ofe])).rows;
assert.equal(pCita.length, 1);
assert.equal(new Date(pCita[0].vence).getTime(), inicio - 2 * HORA, 'primer mensaje 2 h antes');
en(inicio - 2 * HORA + MIN);
const antesCita = enviados.length;
await cola();
const aOfe = enviados.slice(antesCita).filter((e) => e.jid.startsWith('59170000015'));
assert.equal(aOfe.length, 1, 'sale aunque el tope del día esté lleno');
assert.match(aOfe[0].texto, /hoy a las 16:00/);
paso('el recordatorio de la cita sale 2 h antes, con "hoy a las 16:00", sin contar para el tope');
await motor();
pCita = (await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 and estado = 'pendiente' and tipo = 'cita'`, [ofe])).rows;
assert.equal(pCita.length, 1);
assert.equal(new Date(pCita[0].vence).getTime(), inicio - HORA, 'el siguiente, 1 h antes');
await pg.query(`update siguelo_citas set estado = 'cancelada' where id = $1`, [cita]);
await motor();
assert.equal((await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 and estado = 'pendiente' and tipo = 'cita'`, [ofe])).rows.length, 0);
paso('al quitar la cita se cancelan sus mensajes');

// Una cita agendada a 30 min no manda "falta 2 h" ni "falta 1 h": el primero es al empezar.
const pronto = Math.ceil((reloj.ahora + 30 * MIN) / MIN) * MIN;
await uno(`insert into siguelo_citas (empresa_id, contacto_id, inicio, fin, actualizado_en) values ($1, $2, $3, $4, $5) returning id`, [empresa, ofe, iso(pronto), iso(pronto + HORA), iso(reloj.ahora)]);
await motor();
pCita = (await pg.query<any>(`select * from siguelo_cola where contacto_id = $1 and estado = 'pendiente' and tipo = 'cita'`, [ofe])).rows;
assert.equal(pCita.length, 1);
assert.equal(new Date(pCita[0].vence).getTime(), pronto, 'el primero que sale es el de al empezar');
await pg.query(`update siguelo_citas set estado = 'cancelada' where contacto_id = $1`, [ofe]);
await motor();
paso('una cita agendada a última hora se salta los avisos que ya no son ciertos');
await pg.query(`update siguelo_ajustes set maximo_diario = 30`);

console.log(`\n${ok} pasos OK · mensajes "enviados":`);
for (const e of enviados) console.log('  →', e.jid, JSON.stringify(e.texto));
const reg = (await pg.query<any>(`select texto from siguelo_registro order by creado_en`)).rows.map((r: any) => r.texto);
console.log('\nRegistro:\n  ' + reg.join('\n  '));
