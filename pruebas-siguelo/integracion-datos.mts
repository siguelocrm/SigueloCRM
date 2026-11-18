// Prueba de las preguntas sobre tus datos en el Asistente (server/src/siguelo/ia/datos.ts y la
// sección 43 de siguelo.sql): por sede y por período, en personas distintas.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { consultarDatos } = await import(R + 'ia/datos.ts');
const { conversar } = await import(R + 'ia/asistente.ts');
const { configDeEmpresa } = await import(R + 'ia/config.ts');
assert.ok(redirigidos.includes('db'));

// OpenAI falsa: primero pide las consultas, después responde con los resultados.
const llamadas: { sistema: string; ultimo: string }[] = [];
let asistente: (ultimo: string) => any = () => ({ respuesta: 'x', acciones: [] });
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  if (!String(url).startsWith('https://api.openai.com/')) return fetchReal(url, init);
  const { messages } = JSON.parse(init.body);
  const ultimo = messages[messages.length - 1].content;
  llamadas.push({ sistema: messages[0].content, ultimo });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(asistente(ultimo)) } }], usage: { prompt_tokens: 800, completion_tokens: 60 } }), { status: 200 });
}) as typeof fetch;

const MIN = 60_000, DIA = 24 * 60 * MIN;
reloj.ahora = Date.now();
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
const dia = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz' }).format(new Date(Date.now() - ms));
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Club') returning id`)).id;
const otra = (await uno(`insert into empresas (nombre) values ('Otra cuenta') returning id`)).id;
const linea = async (e: string, n: string) => (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, $2, '591') returning id`, [e, n])).id;
const LQ = await linea(empresa, 'Quillacollo');
const LC = await linea(empresa, 'Cercado');
const LX = await linea(otra, 'De otro');
const negocio = async (nombre: string, sucursal: string, l: string) => {
  const id = (await uno(`insert into siguelo_negocios (empresa_id, nombre, sucursal) values ($1, $2, $3) returning id`, [empresa, nombre, sucursal])).id;
  await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [l, empresa, id]);
  return (await uno(`select * from siguelo_negocios where id = $1`, [id]));
};
const nQ = await negocio('Club Quillacollo', 'Quillacollo', LQ);
const nC = await negocio('Club Cercado', 'Cercado', LC);
const asistira = (await uno(`insert into etapas_venta (empresa_id, nombre, tipo, orden) values ($1, 'Asistirá', 'normal', 5) returning id, nombre`, [empresa]));
const horarios = (await uno(`insert into respuestas_rapidas (empresa_id, titulo, contenido, tipo) values ($1, 'Horarios Cercado', 'Lunes y miércoles 16:00', 'texto') returning id`, [empresa])).id;

const chat = async (l: string, tel: string, nombre: string, e = empresa) => {
  const conv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado) values ($1, $2, $3, 'abierto') returning id`, [l, tel, nombre])).id;
  const contacto = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, $2, $3) returning id`, [e, tel, nombre])).id;
  return { conv, contacto };
};
const msj = (conv: string, remitente: string, texto: string, antes: number) =>
  pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, $2, $3, $4)`, [conv, remitente, texto, hace(antes)]);
const interes = (conv: string, l: string, texto: string) => pg.query(`insert into siguelo_ia_lecturas (conversacion_id, empresa_id, linea_id, interes) values ($1, $2, $3, $4)`, [conv, empresa, l, texto]);

// Cercado: Ana pidió horarios, se los mandamos (respuesta rápida "Horarios Cercado") y dijo que va a ir.
const ana = await chat(LC, '59170000001', 'Ana');
await msj(ana.conv, 'cliente', '¿Qué horarios tienen de ajedrez?', 2 * DIA);
await msj(ana.conv, 'agente', 'Estos son los horarios de ajedrez: lunes y miércoles 16:00', 2 * DIA - MIN);
await pg.query(`insert into siguelo_ia_salida (empresa_id, conversacion_id, linea_id, telefono, origen, referencia, contenido, estado, cerrado_en, vence) values ($1, $2, $3, '59170000001', 'respuesta_rapida', $4, 'x', 'enviado', $5, $5)`, [empresa, ana.conv, LC, horarios, hace(2 * DIA - MIN)]);
await msj(ana.conv, 'cliente', 'Gracias, voy a ir el sábado', 2 * DIA - 5 * MIN);
await interes(ana.conv, LC, 'Ajedrez');
await pg.query(`update contactos set etapa_id = $2, etapa_actualizada_en = $3 where id = $1`, [ana.contacto, asistira.id, hace(2 * DIA - 5 * MIN)]);
// Cercado: Beto preguntó por dibujo (sin horarios).
const beto = await chat(LC, '59170000002', 'Beto');
await msj(beto.conv, 'cliente', 'Info de dibujo por favor', DIA);
await msj(beto.conv, 'agente', 'Claro, el curso de dibujo es para niños de 6 a 12 años', DIA - MIN);
await interes(beto.conv, LC, 'dibujo');
// Quillacollo: Caro pidió horarios de ajedrez.
const caro = await chat(LQ, '59170000003', 'Caro');
await msj(caro.conv, 'cliente', 'Horarios de ajedrez?', 3 * DIA);
await msj(caro.conv, 'agente', 'Te paso los horarios: martes y jueves', 3 * DIA - MIN);
await interes(caro.conv, LQ, 'ajedrez ');
// Cercado, hace 20 días (fuera de la semana).
const dani = await chat(LC, '59170000004', 'Dani');
await msj(dani.conv, 'cliente', 'Hola, horarios?', 20 * DIA);
await msj(dani.conv, 'agente', 'Los horarios son...', 20 * DIA - MIN);
// Otra cuenta (nunca debe contarse).
const x = await chat(LX, '59170000009', 'De otro', otra);
await msj(x.conv, 'agente', 'horarios de otro', DIA);

const ctx = { empresaId: empresa, zona: 'America/La_Paz', negocios: new Map([['n1', nQ], ['n2', nC]]), etapas: new Map([['e5', asistira]]) };
const consultar = async (q: Record<string, unknown>) => JSON.parse((await consultarDatos(ctx, [q])).texto)[0];

const cercado = await consultar({ tipo: 'resumen', negocio: 'n2' });
assert.equal(cercado.error, undefined, cercado.error);
assert.equal(cercado.sede, 'Club Cercado (Cercado)');
assert.match(cercado.periodo, /^del \d{4}-\d{2}-\d{2} al \d{4}-\d{2}-\d{2}$/, 'por defecto, los últimos 7 días');
const r = cercado.resultado;
assert.equal(r.escribieron, 2, 'Ana y Beto (Dani fue hace 20 días)');
assert.equal(r.les_escribimos, 2);
assert.equal(r.respondieron_a_un_mensaje_nuestro, 1, 'Ana contestó después de nuestro mensaje');
assert.deepEqual(r.respuestas_rapidas, [{ titulo: 'Horarios Cercado', personas: 1 }]);
assert.deepEqual(r.intereses.map((i: any) => [i.interes, i.personas]).sort(), [['ajedrez', 1], ['dibujo', 1]]);
assert.ok(r.etapas_hoy.some((e: any) => e.etapa === 'Asistirá' && e.personas === 1));
paso('resumen de una sede en la semana: cuántos escribieron, respondieron, qué respuestas rápidas y qué les interesa');

const todas = (await consultar({ tipo: 'resumen', negocio: null })).resultado;
assert.equal(todas.escribieron, 3, 'las dos sedes, sin la otra cuenta');
assert.deepEqual(todas.intereses[0], { interes: 'ajedrez', personas: 2 }, '"Ajedrez" y "ajedrez " cuentan juntos: lo más pedido');
const mes = (await consultar({ tipo: 'resumen', negocio: 'n2', desde: dia(30 * DIA), hasta: dia(0) })).resultado;
assert.equal(mes.escribieron, 3, 'en el mes también cuenta Dani');
paso('todas las sedes juntas (lo más pedido) y otro período');

const horariosC = await consultar({ tipo: 'buscar', negocio: 'n2', quien: 'nosotros', palabras: ['horario', 'horarios'] });
assert.equal(horariosC.resultado.personas, 1, 'en Cercado esta semana: solo a Ana');
assert.equal(horariosC.resultado.ejemplos[0].nombre, 'Ana');
assert.equal((await consultar({ tipo: 'buscar', negocio: 'n1', quien: 'nosotros', palabras: ['horario'] })).resultado.personas, 1, 'en Quillacollo: Caro');
assert.equal((await consultar({ tipo: 'buscar', negocio: null, quien: 'cliente', palabras: ['voy a ir'] })).resultado.personas, 1, 'los que dijeron que van a ir');
paso('buscar: a cuántas personas les mandamos los horarios por sede, y quiénes dijeron que van a ir');

const vanA = await consultar({ tipo: 'etapa', etapa: 'e5', negocio: 'n2' });
assert.equal(vanA.etapa, 'Asistirá');
assert.equal(vanA.resultado.personas, 1);
assert.equal(vanA.resultado.entraron_en_el_periodo, 1);
assert.match((await consultar({ tipo: 'resumen', negocio: 'n9' })).error, /no encontré el negocio/);
paso('etapa: cuántos están en "Asistirá" en Cercado; un negocio que no existe se explica');

// De punta a punta: el Asistente pide las consultas y responde con los números.
await pg.query(`insert into siguelo_ia (empresa_id, activa, modo, clave_final) values ($1, true, 'borrador', '1234')`, [empresa]);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);
asistente = (ultimo) =>
  ultimo.startsWith('RESULTADOS DE TUS CONSULTAS')
    ? { respuesta: `En Cercado, esta semana: a ${JSON.parse(ultimo.split('\n')[1])[0].resultado.personas} persona le mandamos los horarios.`, acciones: [] }
    : { respuesta: '', acciones: [], consultas: [{ tipo: 'buscar', negocio: 'n2', quien: 'nosotros', palabras: ['horario'] }] };
const c = await configDeEmpresa(empresa);
const respuesta = await conversar(c!, null, '¿En la sede de Cercado a cuántas personas les mandaste los horarios?');
assert.equal(respuesta.ok, true);
assert.equal((respuesta as any).mensaje.texto, 'En Cercado, esta semana: a 1 persona le mandamos los horarios.');
assert.match(llamadas[0].sistema, /CONSULTAS DE DATOS/);
assert.match(llamadas[0].sistema, /n2: "Club Cercado", sucursal Cercado/, 've las sedes con su id');
assert.equal(llamadas.length, 2, 'una vuelta para pedir los datos y otra para responder');
paso('el Asistente pide los datos que necesita y responde con los números reales');

console.log(`\n${ok} pasos OK`);
