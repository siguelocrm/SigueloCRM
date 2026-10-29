// Prueba de los comentarios de Facebook e Instagram: la IA responde, oculta o
// borra, te pregunta por WhatsApp y aprende de tu respuesta. Con una API de
// Meta falsa, WhatsApp falso y OpenAI falsa.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { revisarRedes } = await import(R + 'redes/redes.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

const MIN = 60_000, HORA = 60 * MIN;
reloj.ahora = Date.now() - 2 * HORA;
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (x: number) => { reloj.ahora += x; };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

// ---------- API de Meta falsa ----------
type Comentario = { id: string; texto: string; autor: string; autor_id: string; t: number; padre?: string };
const meta = {
  fb: [] as Comentario[],
  ig: [] as Comentario[],
  respuestas: [] as { id: string; texto: string }[],
  ocultos: [] as string[],
  borrados: [] as string[],
  sinFirma: 0,
  vencido: false,
};
const resp = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
const fbComentario = (k: Comentario) => ({ id: k.id, message: k.texto, created_time: iso(k.t), from: { id: k.autor_id, name: k.autor }, ...(k.padre ? { parent: { id: k.padre } } : {}) });

// ---------- OpenAI falsa ----------
let decidir: (texto: string, sistema: string, usuario: string) => any = () => ({ tipo: 'otro', accion: 'ignorar' });
const prompts: { sistema: string; usuario: string }[] = [];

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'graph.facebook.com') {
    const p = init.body ? new URLSearchParams(String(init.body)) : u.searchParams;
    if (!p.get('appsecret_proof')) meta.sinFirma++;
    if (meta.vencido) return resp({ error: { message: 'Session has expired', code: 190 } }, 400);
    const ruta = u.pathname.replace('/v26.0', '');
    const metodo = init.method || 'GET';
    if (metodo === 'GET' && ruta === '/pg1/feed') return resp({ data: [{ id: 'pg1_post1', message: 'Inscripciones abiertas: curso de ajedrez', created_time: iso(reloj.ahora - 5 * HORA), comments: { data: meta.fb.map(fbComentario) } }] });
    if (metodo === 'GET' && ruta === '/ig1/media') {
      const raiz = meta.ig.filter((k) => !k.padre);
      return resp({ data: [{ id: 'ig_m1', caption: 'Nuevo grupo de ajedrez 🏆', timestamp: iso(reloj.ahora - 5 * HORA), comments: { data: raiz.map((k) => ({ id: k.id, text: k.texto, timestamp: iso(k.t), username: k.autor, from: { id: k.autor_id, username: k.autor }, replies: { data: meta.ig.filter((r) => r.padre === k.id).map((r) => ({ id: r.id, text: r.texto, timestamp: iso(r.t), username: r.autor })) } })) } }] });
    }
    if (metodo === 'POST' && /\/(comments|replies)$/.test(ruta)) {
      meta.respuestas.push({ id: ruta.split('/')[1], texto: p.get('message')! });
      return resp({ id: `r${meta.respuestas.length}` });
    }
    if (metodo === 'POST') {
      if (p.get('is_hidden') === 'true' || p.get('hide') === 'true') meta.ocultos.push(ruta.slice(1));
      return resp({ success: true });
    }
    if (metodo === 'DELETE') {
      meta.borrados.push(ruta.slice(1));
      return resp({ success: true });
    }
    return resp({ error: { message: `ruta ${metodo} ${ruta}` } }, 404);
  }
  if (!String(url).startsWith('https://api.openai.com/')) return fetchReal(url, init);
  const { messages } = JSON.parse(init.body);
  const sistema: string = messages[0].content;
  const usuario: string = messages[messages.length - 1].content;
  let json: any;
  if (sistema.startsWith('Escribe la respuesta a un comentario')) json = { respuesta: `¡Hola! ${/Respuesta del dueño: "([^"]+)"/.exec(usuario)?.[1]} 😊 Escríbenos al 71111111 (WhatsApp).` };
  else {
    prompts.push({ sistema, usuario });
    json = decidir(/Comentario de [^:]+: "([^"]*)"/.exec(usuario)?.[1] ?? '', sistema, usuario);
  }
  return resp({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } });
}) as typeof fetch;

// ---------- Datos ----------
await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Club') returning id`)).id;
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Quillacollo', '59171111111', 'activo') returning id`, [empresa])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, info_ia) values ($1, 'Club Quillacollo', 'Curso de ajedrez para niños: sábados de 10 a 11, Bs 100 al mes.') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [L1, empresa, negocio]);
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, avisos) values ($1, true, 'automatico', $2::jsonb)`,
  [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: {}, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);
await pg.query(`insert into siguelo_meta_app (empresa_id, app_id, app_secret) values ($1, '123456789', 'secreto-de-la-app-123')`, [empresa]);
const fb = (await uno(`insert into siguelo_redes_cuentas (empresa_id, red, externo_id, nombre, negocio_id, activo, negativos) values ($1, 'facebook', 'pg1', 'Club Infinity Quillacollo', $2, true, 'ocultar') returning id`, [empresa, negocio])).id;
const ig = (await uno(`insert into siguelo_redes_cuentas (empresa_id, red, externo_id, nombre, usuario, negocio_id, activo, negativos) values ($1, 'instagram', 'ig1', 'Infinity Chess', 'infinitychess', $2, true, 'borrar') returning id`, [empresa, negocio])).id;
await pg.query(`insert into siguelo_redes_tokens (cuenta_id, token) values ($1, 'tok-pagina'), ($2, 'tok-pagina')`, [fb, ig]);

const config = async () => {
  olvidarCache();
  olvidarNegocios();
  const [c] = await empresasConIA();
  return c;
};
const vuelta = async () => revisarRedes(await config());
const fila = async (externo: string) => uno(`select * from siguelo_redes_comentarios where externo_id = $1`, [externo]);
const salida = async () => {
  for (let i = 0; i < 8; i++) {
    await procesarSalida(await config());
    avanzar(10_000);
  }
};

// ---------- 1. Al activar, los comentarios viejos no se tocan ----------
meta.fb.push({ id: 'c0', texto: 'Comentario de antes', autor: 'Ana', autor_id: 'u0', t: reloj.ahora - HORA });
await vuelta();
assert.ok((await uno(`select revisado_hasta from siguelo_redes_cuentas where id = $1`, [fb])).revisado_hasta);
avanzar(4 * MIN);
await vuelta();
assert.equal(await fila('c0'), undefined, 'lo de antes de activar no se responde');
paso('al activar una cuenta se responde desde ese momento (los comentarios viejos no)');

// ---------- 2. La IA decide con la ficha: responder, ocultar, borrar, preguntarte ----------
meta.fb.push(
  { id: 'c1', texto: '¿Cuánto cuesta el curso?', autor: 'Beto', autor_id: 'u1', t: reloj.ahora },
  { id: 'c2', texto: 'Pésimo, no lo recomiendo', autor: 'Caro', autor_id: 'u2', t: reloj.ahora },
  { id: 'c3', texto: 'Gracias por visitarnos', autor: 'Club Infinity Quillacollo', autor_id: 'pg1', t: reloj.ahora },
);
meta.ig.push(
  { id: 'i1', texto: '¿Tienen clases para adultos?', autor: 'dani', autor_id: 'u3', t: reloj.ahora },
  { id: 'i2', texto: 'Gana dinero fácil en mi perfil', autor: 'bot123', autor_id: 'u4', t: reloj.ahora },
);
decidir = (texto) =>
  texto.startsWith('¿Cuánto') ? { tipo: 'pregunta', accion: 'responder', respuesta: '¡Hola Beto! Son Bs 100 al mes, los sábados de 10 a 11. Escríbenos a https://wa.me/59171111111 😊' }
  : texto.startsWith('Pésimo') ? { tipo: 'negativo', accion: 'ocultar', motivo: 'Critica el negocio' }
  : texto.startsWith('¿Tienen clases para adultos') ? { tipo: 'pregunta', accion: 'preguntar', motivo: 'No dice nada de adultos', respaldo: '¡Hola! Escríbenos al 71111111 (WhatsApp) y te contamos 🙌' }
  : { tipo: 'spam', accion: 'ocultar', motivo: 'Spam' };
avanzar(4 * MIN);
await vuelta();
const pFb = prompts.find((p) => p.usuario.includes('¿Cuánto cuesta'))!;
assert.match(pFb.sistema, /Curso de ajedrez para niños: sábados de 10 a 11, Bs 100 al mes/, 'usa la ficha del negocio');
assert.match(pFb.sistema, /WhatsApp del negocio: https:\/\/wa\.me\/59171111111/, 'en Facebook, el link de WhatsApp');
assert.match(prompts.find((p) => p.usuario.includes('adultos'))!.sistema, /WhatsApp del negocio: 71111111 \(WhatsApp\)/, 'en Instagram, el número');
assert.equal(prompts.some((p) => p.usuario.includes('Gracias por visitarnos')), false, 'no lee los comentarios de la propia página');
assert.equal((await fila('c1')).accion, 'programado');
assert.equal((await fila('c2')).accion, 'oculto');
assert.deepEqual(meta.ocultos, ['c2'], 'el negativo se oculta en Facebook');
assert.equal((await fila('i2')).accion, 'borrado');
assert.deepEqual(meta.borrados, ['i2'], 'en Instagram (ajuste "borrar") el spam se borra');
const pregunta = await fila('i1');
assert.equal(pregunta.accion, 'preguntado');
assert.equal(pregunta.codigo, 1);
assert.equal(meta.respuestas.length, 0, 'nada se responde al instante');
assert.equal(meta.sinFirma, 0, 'todos los pedidos van firmados con el secreto de la app');
paso('la IA responde con la ficha (link de WhatsApp en Facebook, número en Instagram), oculta o borra lo negativo y el spam, y no lee lo propio');

// ---------- 3. La respuesta sale unos minutos después ----------
avanzar(7 * MIN);
await vuelta();
assert.deepEqual(meta.respuestas, [{ id: 'c1', texto: '¡Hola Beto! Son Bs 100 al mes, los sábados de 10 a 11. Escríbenos a https://wa.me/59171111111 😊' }]);
assert.equal((await fila('c1')).accion, 'respondido');
paso('la respuesta sale unos minutos después, como una persona');

// ---------- 4. Lo que no sabe te lo pregunta por WhatsApp; tu respuesta se publica y queda aprendida ----------
await salida();
const avisos = enviados.filter((e) => e.jid.startsWith('59179999999'));
assert.ok(avisos.some((e) => /R1 · Instagram Infinity Chess: @?dani preguntó "¿Tienen clases para adultos\?"[\s\S]*Contéstame así: R1 tu respuesta/.test(e.texto)), 'te pregunta con un código');
assert.ok(avisos.some((e) => /oculté un comentario negativo de Caro/.test(e.texto)), 'te avisa del negativo');
const tuChat = (await uno(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59179999999', 'abierto') returning id`, [L1])).id;
avanzar(MIN);
await pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'cliente', 'R1 Sí, los martes a las 19:00, Bs 120 al mes', $2)`, [tuChat, iso(reloj.ahora)]);
avanzar(MIN);
await vuelta();
assert.equal(meta.respuestas.at(-1)!.id, 'i1');
assert.match(meta.respuestas.at(-1)!.texto, /Sí, los martes a las 19:00, Bs 120 al mes/);
assert.equal((await fila('i1')).accion, 'respondido');
assert.equal((await uno(`select respuesta from siguelo_aprendido where pregunta like '%adultos%'`)).respuesta, 'Sí, los martes a las 19:00, Bs 120 al mes');
await salida();
assert.ok(enviados.filter((e) => e.jid.startsWith('59179999999')).some((e) => /✅ R1: le respondí a @?dani/.test(e.texto)), 'te confirma');
paso('lo que no sabe te lo pregunta por WhatsApp ("R1 …"); tu respuesta se publica y queda aprendida');

// ---------- 5. Lo aprendido y las respuestas anteriores van a la próxima ----------
meta.fb.push({ id: 'c4', texto: '¿Y hay clases para adultos?', autor: 'Eli', autor_id: 'u5', t: reloj.ahora });
decidir = () => ({ tipo: 'pregunta', accion: 'responder', respuesta: '¡Claro Eli! Los martes a las 19:00, Bs 120. Escríbenos a https://wa.me/59171111111' });
avanzar(4 * MIN);
await vuelta();
const p5 = prompts.at(-1)!;
assert.match(p5.sistema, /RESPUESTAS QUE YA DIO EL DUEÑO[\s\S]*adultos[\s\S]*Sí, los martes a las 19:00, Bs 120 al mes/, 'usa lo aprendido');
assert.match(p5.usuario, /Tus últimas respuestas \(no las repitas\):\n- ¡Hola Beto! Son Bs 100/, 've sus respuestas anteriores para no repetirse');
paso('lo aprendido se usa en la próxima pregunta, y ve sus respuestas anteriores para no repetirse');

// ---------- 6. Si no respondes en 6 horas, lo lleva a tu WhatsApp ----------
meta.ig.push({ id: 'i3', texto: '¿Hacen torneos?', autor: 'fer', autor_id: 'u6', t: reloj.ahora });
decidir = () => ({ tipo: 'pregunta', accion: 'preguntar', motivo: 'No dice nada de torneos', respaldo: '¡Hola! Escríbenos al 71111111 (WhatsApp) y te contamos todo 🏆' });
avanzar(4 * MIN);
await vuelta();
assert.equal((await fila('i3')).codigo, 2);
avanzar(6 * HORA + MIN);
await vuelta();
assert.equal(meta.respuestas.at(-1)!.texto, '¡Hola! Escríbenos al 71111111 (WhatsApp) y te contamos todo 🏆');
assert.match((await fila('i3')).motivo, /No respondiste a tiempo/);
paso('si no respondes en 6 horas, publica una respuesta que lo lleva a tu WhatsApp');

// ---------- 7. Si Facebook quita el permiso, queda anotado ----------
meta.vencido = true;
avanzar(4 * MIN);
await vuelta();
assert.match((await uno(`select error from siguelo_redes_cuentas where id = $1`, [fb])).error, /vuelve a conectar la cuenta/);
paso('si Facebook quita el permiso, la cuenta muestra que hay que volver a conectarla');

console.log(`\n${ok} pasos OK · respuestas publicadas: ${meta.respuestas.length}`);
for (const r of meta.respuestas) console.log('  →', r.id, JSON.stringify(r.texto));
