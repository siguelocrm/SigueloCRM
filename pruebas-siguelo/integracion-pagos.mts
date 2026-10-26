// Prueba de punta a punta de la inscripción con pago (Fase 5) con Postgres en
// memoria, WhatsApp falso y una OpenAI falsa que "lee" los comprobantes.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { revisarPagos } = await import(R + 'pagos/inscripcion.ts');
const { leerPendientes } = await import(R + 'ia/lector.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

// ---------- OpenAI falsa y archivos falsos ----------
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const DOCX = Buffer.from('PK\u0003\u0004 no es una imagen');
let comprobante: Record<string, unknown> = {};
let datosIA: Record<string, unknown> = {};
let responder: (sistema: string, usuario: string) => any = () => ({ resumen: 'x' });
let fallar = 0;
const llamadas = { vision: 0, datos: 0, lector: 0, ultimaVision: null as any };
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.startsWith('https://falso/')) return new Response(u.endsWith('.docx') ? DOCX : JPG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (!u.startsWith('https://api.openai.com/')) return fetchReal(url, init);
  if (fallar > 0) {
    fallar--;
    return new Response(JSON.stringify({ error: { message: 'server error' } }), { status: 500 });
  }
  const cuerpo = JSON.parse(init.body);
  const [sis, usr] = cuerpo.messages;
  let json: unknown;
  if (Array.isArray(usr.content)) {
    llamadas.vision++;
    llamadas.ultimaVision = usr.content;
    json = comprobante;
  } else if (String(sis.content).includes('Ayudas a inscribir')) {
    llamadas.datos++;
    json = datosIA;
  } else {
    llamadas.lector++;
    json = responder(sis.content, usr.content);
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } }), { status: 200 });
}) as typeof fetch;

const MIN = 60_000;
reloj.ahora = Date.now() - 60 * MIN; // Postgres ve los mensajes como de hace una hora
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (x: number) => { reloj.ahora += x; };
const fechaLP = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const filas = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows;
const empresa = (await uno(`insert into empresas (nombre) values ('Academia') returning id`)).id;
const etapas = (await filas(`select id, nombre, tipo from etapas_venta where empresa_id = $1 order by orden`, [empresa]));
const ganada = etapas.find((e: any) => e.tipo === 'ganada');
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Academia', '591', 'activo') returning id`, [empresa])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, info_ia) values ($1, 'Academia', 'Cursos de mecánica') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [L1, empresa, negocio]);
const carnet = (await uno(`insert into campos_personalizados (empresa_id, nombre, tipo) values ($1, 'Carnet', 'texto') returning id`, [empresa])).id;
const curso = (await uno(
  `insert into siguelo_cursos (empresa_id, negocio_id, nombre, precio, moneda, qr_url, destinatario, cuenta, link_grupo, datos)
   values ($1, $2, 'Curso de Mecánica', 150, 'Bs', 'https://falso/qr.jpg', 'Juan Perez Gomez', '10000012345678', 'https://chat.whatsapp.com/CURSO', $3::jsonb) returning id`,
  [empresa, negocio, JSON.stringify(['nombre', carnet])],
)).id;
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, desde, hasta, espera_min_seg, espera_max_seg, avisos) values ($1, true, 'automatico', '00:00', '23:59', 0, 0, $2::jsonb)`,
  [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: {}, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);

const chat = async (tel: string, nombre: string) => {
  const conv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, creado_en) values ($1, $2, $3, 'abierto', $4) returning id`, [L1, tel, nombre, iso(reloj.ahora)])).id;
  const contacto = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, $2, $3) returning id`, [empresa, tel, nombre])).id;
  return { conv, contacto };
};
const escribe = (conv: string, texto: string) => pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'cliente', $2, $3)`, [conv, texto, iso(reloj.ahora)]);
const foto = (conv: string, archivo = 'comp.jpg', tipo = 'imagen') =>
  pg.query(`insert into mensajes (conversacion_id, remitente, tipo, contenido, media_url, creado_en) values ($1, 'cliente', $2, '', $3, $4)`, [conv, tipo, `https://falso/storage/v1/object/public/media/${L1}/${archivo}`, iso(reloj.ahora)]);
const config = async () => {
  olvidarCache();
  olvidarNegocios();
  const [c] = await empresasConIA();
  return c;
};
const salida = async () => {
  for (let i = 0; i < 12; i++) {
    const antes = enviados.length;
    await procesarSalida(await config());
    avanzar(10_000);
    if (enviados.length === antes && i > 1) break;
  }
};
const pagoDe = async (contacto: string) => uno(`select * from siguelo_pagos where contacto_id = $1 order by creado_en desc limit 1`, [contacto]);
const a = (tel: string) => enviados.filter((e) => e.jid.startsWith(tel));
const buenComprobante = (extra: Record<string, unknown> = {}) => ({
  es_comprobante: true, monto: '150,00', moneda: 'BOB', fecha: fechaLP(reloj.ahora - 20 * MIN), transaccion: 'TX-0001-AB',
  pagador: 'Ana Rojas', banco: 'BNB', destinatario: 'PEREZ GOMEZ JUAN', cuenta_destino: '****5678', glosa: 'curso', senales_edicion: [], confianza: 0.95, ...extra,
});

// ---------- 1. Un comprobante correcto se confirma solo ----------
const ana = await chat('59170000001', 'Ana');
await escribe(ana.conv, 'Ya pagué');
await foto(ana.conv);
avanzar(5_000);
comprobante = buenComprobante();
await revisarPagos(await config());
let p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'datos', JSON.stringify(p.controles));
assert.equal(Number(p.monto), 150);
assert.equal(p.transaccion, 'TX0001AB');
assert.equal(p.curso_id, curso);
assert.match(llamadas.ultimaVision[1].image_url.url, /^data:image\/jpeg;base64,/, 'la IA recibe la foto');
const docs = await filas(`select * from contacto_documentos where contacto_id = $1`, [ana.contacto]);
assert.equal(docs.length, 1);
assert.equal(docs[0].ruta, `${L1}/comp.jpg`, 'el comprobante queda en sus documentos');
const opo = await filas(`select * from oportunidades where contacto_id = $1`, [ana.contacto]);
assert.equal(opo.length, 1);
assert.equal(opo[0].estado, 'ganada');
assert.equal(Number(opo[0].monto), 150);
assert.equal(opo[0].producto, 'Curso de Mecánica');
assert.equal((await uno(`select etapa_id from contactos where id = $1`, [ana.contacto])).etapa_id, ganada.id, 'pasa a la etapa ganada');
paso('un comprobante correcto se confirma solo: comprobante en su ficha, oportunidad ganada y etapa ganada');

await salida();
const aAna = a('59170000001');
assert.equal(aAna.length, 2);
assert.match(aAna[0].texto, /Recibimos tu pago de Bs 150 para Curso de Mecánica/);
assert.match(aAna[1].texto, /Nombre completo[\s\S]*Carnet/);
const aviso = a('59179999999').at(-1);
assert.match(aviso!.texto, /pagó Bs 150 por "Curso de Mecánica": ✅ confirmado solo, falta que mande sus datos/);
paso('se le confirma, se le piden sus datos y te avisa a tu WhatsApp');

// ---------- 2. Sus datos se guardan y recibe el link ----------
const lectorAntes = llamadas.lector;
await escribe(ana.conv, 'Ana María Rojas, carnet 1234567 LP');
avanzar(10_000);
await revisarPagos(await config());
assert.equal(llamadas.datos, 0, 'espera a que termine de escribir');
avanzar(40_000);
datosIA = { datos: { d1: 'Ana María Rojas', d2: '1234567 LP' } };
await revisarPagos(await config());
p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'inscrito');
assert.equal((await uno(`select nombre from contactos where id = $1`, [ana.contacto])).nombre, 'Ana María Rojas');
assert.equal((await uno(`select valor from contacto_campos where contacto_id = $1 and campo_id = $2`, [ana.contacto, carnet])).valor, '1234567 LP');
await leerPendientes(await config());
assert.equal(llamadas.lector, lectorAntes, 'la IA no le responde mientras se inscribe');
await salida();
assert.match(a('59170000001').at(-1)!.texto, /Ya estás inscrito en Curso de Mecánica[\s\S]*https:\/\/chat\.whatsapp\.com\/CURSO/);
paso('sus datos van a su ficha (nombre y campo Carnet) y recibe el link del grupo; la IA no se mete');

// ---------- 3. Mismo comprobante de otra persona: rechazado ----------
const beto = await chat('59170000002', 'Beto');
await foto(beto.conv, 'beto.jpg');
avanzar(5_000);
await revisarPagos(await config());
p = await pagoDe(beto.contacto);
assert.equal(p.estado, 'rechazado');
await salida();
assert.match(a('59170000002').at(-1)!.texto, /No pudimos validar tu comprobante: ese comprobante ya fue usado antes/);
assert.match(a('59179999999').at(-1)!.texto, /Comprobante de \*Beto\*.*rechazado/);
paso('el mismo número de transacción de otra persona se rechaza y se le explica');

// ---------- 4. Monto menor: rechazado ----------
const caro = await chat('59170000003', 'Caro');
await foto(caro.conv, 'caro.jpg');
avanzar(5_000);
comprobante = buenComprobante({ monto: 100, transaccion: 'TX-0002' });
await revisarPagos(await config());
p = await pagoDe(caro.contacto);
assert.equal(p.estado, 'rechazado');
assert.match(p.motivo, /el monto \(Bs 100\) no alcanza al precio \(Bs 150\)/);
paso('si pagó menos, se rechaza con el motivo');

// ---------- 5. Dudoso: para revisar; lo confirmas tú y sigue solo ----------
const dani = await chat('59170000004', 'Dani');
await foto(dani.conv, 'dani.jpg');
avanzar(5_000);
comprobante = buenComprobante({ transaccion: 'TX-0003', senales_edicion: ['el monto tiene otra tipografía'], confianza: 0.4 });
await revisarPagos(await config());
p = await pagoDe(dani.contacto);
assert.equal(p.estado, 'revisar');
assert.match(p.motivo, /otra tipografía/);
await salida();
assert.match(a('59170000004').at(-1)!.texto, /Lo estamos revisando/);
assert.match(a('59179999999').at(-1)!.texto, /que tienes que revisar/);
assert.equal((await filas(`select * from oportunidades where contacto_id = $1`, [dani.contacto])).length, 0, 'todavía no cuenta como venta');
await pg.query(`update siguelo_pagos set accion = 'confirmar' where id = $1`, [p.id]);
await revisarPagos(await config());
p = await pagoDe(dani.contacto);
assert.equal(p.estado, 'datos');
assert.equal(p.accion, null);
await salida();
assert.match(a('59170000004').at(-2)!.texto, /Recibimos tu pago/);
paso('un comprobante dudoso queda para revisar; al confirmarlo desde la pantalla sigue solo');

// ---------- 6. Una foto que no es un comprobante no hace nada; un documento que no es imagen tampoco ----------
const eli = await chat('59170000005', 'Eli');
await foto(eli.conv, 'gato.jpg');
await foto(eli.conv, 'lista.docx', 'pdf');
avanzar(5_000);
comprobante = { es_comprobante: false, confianza: 0.9 };
const visionAntes = llamadas.vision;
await revisarPagos(await config());
const deEli = await filas(`select estado from siguelo_pagos where contacto_id = $1 order by creado_en`, [eli.contacto]);
assert.deepEqual(deEli.map((x: any) => x.estado), ['no_es', 'no_es']);
assert.equal(llamadas.vision, visionAntes + 1, 'el documento que no es imagen ni PDF no se manda a la IA');
await salida();
assert.equal(a('59170000005').length, 0);
paso('una foto cualquiera o un archivo que no es imagen no hacen nada');

// ---------- 7. La IA manda el QR cuando el cliente quiere pagar ----------
const fer = await chat('59170000006', 'Fer');
await escribe(fer.conv, 'Quiero inscribirme al curso, ¿cómo pago?');
avanzar(MIN);
responder = (sistema) => {
  assert.match(sistema, /CURSOS CON INSCRIPCIÓN POR QR/);
  const id = /- (k\d+): "Curso de Mecánica", Bs 150/.exec(sistema)?.[1];
  return { resumen: 'Quiere pagar', puede_responder: true, respuesta: 'Te paso el QR. Cuando pagues, mándame la foto del comprobante 🙌', qr: id };
};
await leerPendientes(await config());
await salida();
const aFer = a('59170000006');
assert.equal(aFer.length, 2);
assert.equal(aFer[1].imagen, 'https://falso/qr.jpg');
assert.match(aFer[1].texto, /QR para pagar Curso de Mecánica: Bs 150/);
paso('cuando el cliente quiere pagar, la IA le manda el QR del curso');

// ---------- 8. Si la IA falla, se reintenta; a la tercera queda para revisar ----------
const gabi = await chat('59170000007', 'Gabi');
await foto(gabi.conv, 'gabi.jpg');
avanzar(5_000);
fallar = 3;
await revisarPagos(await config());
assert.equal((await pagoDe(gabi.contacto)).estado, 'leyendo');
for (let i = 0; i < 2; i++) {
  avanzar(3 * MIN);
  await revisarPagos(await config());
}
p = await pagoDe(gabi.contacto);
assert.equal(p.estado, 'revisar');
assert.match(p.motivo, /La IA no pudo leer el comprobante/);
paso('si la IA falla se reintenta, y a la tercera queda para revisar');

console.log(`\n${ok} pasos OK · mensajes "enviados":`);
for (const e of enviados) console.log('  →', e.jid, JSON.stringify(e.texto), e.imagen ?? '');
