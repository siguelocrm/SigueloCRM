// Prueba de punta a punta de la IA (Fase 3) con Postgres en memoria, WhatsApp
// falso y una OpenAI falsa que contesta según la conversación.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase, db } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

// Nunca contra el Supabase real: si la redirección fallara, esto apunta a ninguna parte.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { leerPendientes } = await import(R + 'ia/lector.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

// ---------- OpenAI falsa ----------
type Llamada = { sistema: string; usuario: string };
const llamadas: Llamada[] = [];
let responder: (l: Llamada) => any = () => ({ resumen: 'x' });
let fallar = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  if (!String(url).startsWith('https://api.openai.com/')) return fetchReal(url, init);
  if (fallar > 0) {
    fallar--;
    return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 });
  }
  const cuerpo = JSON.parse(init.body);
  const l = { sistema: cuerpo.messages[0].content, usuario: cuerpo.messages[1].content };
  llamadas.push(l);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responder(l)) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 });
}) as typeof fetch;
// Busca el id corto que la IA ve para un título ("r1", "n2"...).
const idDe = (l: Llamada, prefijo: string, texto: string) => new RegExp(`- (${prefijo}\\d+): [^\\n]*${texto}`).exec(l.sistema)?.[1] ?? null;

const MIN = 60_000;
reloj.ahora = Date.now() - 60 * MIN; // todo pasa "hace una hora": Postgres ve los mensajes como viejos
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (msx: number) => { reloj.ahora += msx; };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Prueba') returning id`)).id;
const etapas = (await pg.query<any>(`select id, nombre, tipo from etapas_venta where empresa_id = $1 order by orden`, [empresa])).rows;
const [primer, negociacion, , perdida] = etapas;
const linea = async (nombre: string) => (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, $2, '591', 'activo') returning id`, [empresa, nombre])).id;
const L1 = await linea('Quillacollo');
const L2 = await linea('Cercado');
const L3 = await linea('Academia');
const negocio = async (campos: Record<string, unknown>) => {
  const cols = Object.keys(campos);
  return (await uno(`insert into siguelo_negocios (empresa_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`, [empresa, ...Object.values(campos)])).id;
};
const nQuilla = await negocio({ nombre: 'Tienda Quillacollo', sucursal: 'Quillacollo', direccion: 'Av. Blanco Galindo km 13', horario: 'de 8 a 19', zonas: 'Quillacollo, Tiquipaya', info_ia: 'Vendemos repuestos de motos. Cadena: 120 Bs.' });
const nCercado = await negocio({ nombre: 'Tienda Cercado', sucursal: 'Cercado', direccion: 'Calle Jordán 123', zonas: 'Cercado, Sarco', info_ia: 'Repuestos.' });
const nAcademia = await negocio({ nombre: 'Academia', info_ia: 'Cursos de mecánica.', grupos: JSON.stringify([{ id: 'g-curso', nombre: 'Curso gratis de mecánica', link: 'https://chat.whatsapp.com/ABC', cuando: 'si le interesa aprender' }]) });
await pg.query(`update siguelo_negocios set grupos = grupos::text::jsonb where id = $1`, [nAcademia]);
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $4, $5), ($2, $4, $6), ($3, $4, $7)`, [L1, L2, L3, empresa, nQuilla, nCercado, nAcademia]);
const rUbic = (await uno(`insert into respuestas_rapidas (empresa_id, titulo, contenido, tipo, media_url) values ($1, 'Ubicación', 'Así llegas', 'imagen', 'https://x/ubic.jpg') returning id`, [empresa])).id;
await uno(`insert into respuestas_rapidas (empresa_id, titulo, contenido, tipo) values ($1, 'Precios', 'Lista de precios: …', 'texto') returning id`, [empresa]);
const rSoloCercado = (await uno(`insert into respuestas_rapidas (empresa_id, titulo, contenido, tipo) values ($1, 'Mapa Cercado', 'Mapa', 'texto') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_respuesta_negocio (respuesta_id, negocio_id) values ($1, $2), ($3, $4)`, [rUbic, nQuilla, rSoloCercado, nCercado]);
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, desde, hasta, espera_min_seg, espera_max_seg, avisos)
   values ($1, true, 'automatico', '00:00', '23:59', 0, 0, $2::jsonb)`,
  [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: { pregunta: true, compro: true }, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);
const usuario = '00000000-0000-0000-0000-000000000001';
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Dueño', 'dueno')`, [usuario, empresa]);

const chat = async (lineaId: string, tel: string, nombre: string) => {
  const conv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, creado_en) values ($1, $2, $3, 'abierto', $4) returning id`, [lineaId, tel, nombre, iso(reloj.ahora)])).id;
  const contacto = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, $2, $3) returning id, etapa_id`, [empresa, tel, nombre]));
  return { conv, contacto };
};
const escribe = (conv: string, texto: string, remitente = 'cliente', agente: string | null = null) =>
  pg.query(`insert into mensajes (conversacion_id, remitente, agente_id, contenido, creado_en) values ($1, $2, $3, $4, $5)`, [conv, remitente, agente, texto, iso(reloj.ahora)]);
const config = async () => {
  olvidarCache();
  olvidarNegocios();
  const [c] = await empresasConIA();
  return c;
};
const salida = async () => {
  for (let i = 0; i < 10; i++) {
    const antes = enviados.length;
    await procesarSalida(await config());
    avanzar(10_000);
    if (enviados.length === antes && i > 1) break;
  }
};
const items = async (conv: string) => (await pg.query<any>(`select origen, estado, motivo, contenido, tipo, linea_id from siguelo_ia_salida where conversacion_id = $1 order by creado_en, orden`, [conv])).rows;

// ---------- 1. Responde con la ficha y manda una respuesta rápida ----------
const ana = await chat(L1, '59170000001', 'Ana');
await escribe(ana.conv, 'Hola, ¿dónde están ubicados?');
avanzar(MIN);
responder = (l) => ({ resumen: 'Pregunta la ubicación', puede_responder: true, respuesta: 'Hola Ana, estamos en la Av. Blanco Galindo km 13 😊', respuestas_rapidas: [idDe(l, 'r', '"Ubicación"')] });
await leerPendientes(await config());
const l1 = llamadas.at(-1)!;
assert.match(l1.sistema, /Av\. Blanco Galindo km 13/);
assert.match(l1.sistema, /Cadena: 120 Bs\./, 'la información para la IA de su negocio');
assert.match(l1.sistema, /"Ubicación"/);
assert.doesNotMatch(l1.sistema, /Mapa Cercado/, 'no ve las respuestas rápidas de otro negocio');
assert.match(l1.sistema, /Tienda Cercado \(sucursal Cercado\).*atiende: Cercado, Sarco/, 've las otras sucursales con sus zonas');
assert.match(l1.usuario, /Cliente: Hola, ¿dónde están ubicados\?/);
paso('la IA lee la conversación con la ficha, las zonas de las otras sucursales y solo las respuestas rápidas de su negocio');
await salida();
const aAna = enviados.filter((e) => e.jid.startsWith('59170000001'));
assert.equal(aAna.length, 2);
assert.equal(aAna[0].texto, 'Hola Ana, estamos en la Av. Blanco Galindo km 13 😊');
assert.equal(aAna[1].imagen, 'https://x/ubic.jpg', 'después la foto de la ubicación');
assert.equal((await uno(`select count(*)::int n from mensajes where conversacion_id = $1 and remitente = 'agente'`, [ana.conv])).n, 2, 'quedan en el chat');
assert.equal((await uno(`select count(*)::int n from siguelo_registro where tipo = 'ia_error' and texto like '%no se pudo guardar%'`)).n, 0, 'texto + respuesta rápida se guardan juntos sin error (Supabase deja en NULL lo que falta)');
paso('responde sola y manda la foto de la respuesta rápida, en orden');

// ---------- 2. Una respuesta rápida se manda una sola vez a cada cliente ----------
await escribe(ana.conv, '¿Y cuánto cuesta la cadena?');
avanzar(MIN);
responder = (l) => {
  assert.doesNotMatch(l.sistema, /"Ubicación"/, 'ya la recibió: no está en la lista');
  return { resumen: 'Pregunta precio', puede_responder: true, respuesta: 'La cadena cuesta 120 Bs.', respuestas_rapidas: ['r9'] };
};
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000001')).length, 3, 'solo el texto (un id inventado se ignora)');
paso('cada respuesta rápida se manda una sola vez al mismo cliente');

// ---------- 3. Si el cliente vuelve a escribir antes del envío, la respuesta se cancela ----------
await pg.query(`update siguelo_ia set espera_min_seg = 120, espera_max_seg = 120`);
await escribe(ana.conv, 'Hola de nuevo');
avanzar(MIN);
responder = () => ({ resumen: 'Saluda', puede_responder: true, respuesta: '¡Hola! ¿En qué te ayudo?' });
await leerPendientes(await config());
await escribe(ana.conv, 'Quería saber si tienen frenos');
avanzar(3 * MIN);
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000001')).length, 3, 'no se mandó la respuesta vieja');
assert.match((await items(ana.conv)).at(-1).motivo, /escribió otra vez/);
paso('si el cliente vuelve a escribir antes de que salga la respuesta, se cancela y la IA vuelve a leer');
await pg.query(`update siguelo_ia set espera_min_seg = 0, espera_max_seg = 0`);
responder = () => ({ resumen: 'Pregunta por frenos', puede_responder: false, respuesta: '', necesita_al_dueno: true, motivo: 'Pregunta si hay frenos (no está en la ficha)', aviso: 'pregunta' });
await leerPendientes(await config());
await salida();
const aviso = enviados.find((e) => e.jid.startsWith('59179999999'));
assert.ok(aviso, 'aviso a tu WhatsApp');
assert.match(aviso!.texto, /🔔 \*SígueloCRM\*\n• \*Ana\* \(\+59170000001\) — Tienda Quillacollo: Pregunta si hay frenos/);
const lecturaAna = await uno(`select atencion from siguelo_ia_lecturas where conversacion_id = $1`, [ana.conv]);
assert.equal(lecturaAna.atencion.motivo, 'Pregunta si hay frenos (no está en la ficha)');
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000001')).length, 3, 'no inventa: no le responde');
paso('lo que no está en la ficha no lo inventa: queda para que lo veas y te avisa a tu WhatsApp');

// ---------- 4. Modo para aprobar ----------
await pg.query(`update siguelo_ia set modo = 'borrador'`);
const beto = await chat(L1, '59170000002', 'Beto');
await escribe(beto.conv, 'Hola, ¿abren el sábado?');
avanzar(MIN);
responder = () => ({ resumen: 'Pregunta horario', puede_responder: true, respuesta: 'Sí, abrimos de 8 a 19.' });
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000002')).length, 0, 'no sale sola');
assert.equal((await items(beto.conv))[0].estado, 'borrador');
await pg.query(`update siguelo_ia_salida set estado = 'pendiente', aprobado = true, vence = $2 where conversacion_id = $1`, [beto.conv, iso(reloj.ahora)]);
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000002')).at(-1)?.texto, 'Sí, abrimos de 8 a 19.');
paso('en modo "para aprobar" la respuesta espera y sale cuando la apruebas');
await pg.query(`update siguelo_ia set modo = 'automatico'`);

// ---------- 5. Mueve de etapa y "no quiere más" ----------
const caro = await chat(L1, '59170000003', 'Caro');
await escribe(caro.conv, 'Me interesa, ¿me reservan una cadena?');
avanzar(MIN);
responder = (l) => ({ resumen: 'Quiere reservar', positivo: true, etapa: idDe(l, 'e', '"En Negociación"'), puede_responder: true, respuesta: 'Claro, te la reservo.' });
await leerPendientes(await config());
assert.equal((await uno(`select etapa_id from contactos where id = $1`, [caro.contacto.id])).etapa_id, negociacion.id);
await salida();
await escribe(caro.conv, 'Mejor no, ya no me escriban');
avanzar(MIN);
responder = () => ({ resumen: 'No quiere más', no_quiere_mas: true, puede_responder: true, respuesta: 'Ok' });
await leerPendientes(await config());
assert.equal((await uno(`select etapa_id from contactos where id = $1`, [caro.contacto.id])).etapa_id, perdida.id);
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000003')).length, 1, 'solo la primera respuesta: al que no quiere más no se le responde');
paso('mueve de etapa y al que no quiere más mensajes lo pasa a "perdida" sin responderle');

// ---------- 6. Pase a otra sucursal (con su consentimiento) ----------
const dani = await chat(L1, '59170000004', 'Dani');
await escribe(dani.conv, 'Vivo en Sarco, ¿hay algo más cerca?');
await escribe(dani.conv, 'Sí, que me escriban de Cercado por favor');
avanzar(MIN);
responder = (l) => ({
  resumen: 'Quiere atención en Cercado',
  puede_responder: true,
  respuesta: 'Listo Dani, en un momento te escriben de nuestra sucursal Cercado.',
  pase: { negocio_id: idDe(l, 'n', 'Tienda Cercado'), mensaje: 'Hola Dani, te escribimos de la sucursal Cercado (Calle Jordán 123). ¿En qué te ayudamos?', nota: 'Vive en Sarco, quiere repuestos' },
});
await leerPendientes(await config());
avanzar(40_000);
await salida();
const aDani = enviados.filter((e) => e.jid.startsWith('59170000004'));
assert.equal(aDani.length, 2);
assert.equal(aDani[0].linea, L1);
assert.equal(aDani[1].linea, L2, 'el segundo mensaje sale por el número de Cercado');
assert.match(aDani[1].texto, /sucursal Cercado/);
assert.ok(await uno(`select id from conversaciones where linea_id = $1 and contacto_telefono = '59170000004'`, [L2]), 'se abre su chat en Cercado');
assert.match((await uno(`select texto from notas where contacto_id = $1`, [dani.contacto.id])).texto, /Pase de Tienda Quillacollo a Tienda Cercado: Vive en Sarco/);
paso('pase a otra sucursal: le escribe ese número, con una nota para el equipo');

// ---------- 7. Invitación a un grupo (solo el link, una vez) ----------
const eli = await chat(L3, '59170000005', 'Eli');
await escribe(eli.conv, 'Sí, me quiero unir al curso gratis');
avanzar(MIN);
responder = (l) => ({ resumen: 'Acepta el grupo', puede_responder: true, respuesta: '¡Genial! Te paso el link.', grupo: idDe(l, 'g', '"Curso gratis de mecánica"') });
await leerPendientes(await config());
await salida();
const aEli = enviados.filter((e) => e.jid.startsWith('59170000005'));
assert.equal(aEli.length, 2);
assert.match(aEli[1].texto, /Curso gratis de mecánica[\s\S]*https:\/\/chat\.whatsapp\.com\/ABC/);
await escribe(eli.conv, 'Gracias');
avanzar(MIN);
responder = (l) => {
  assert.doesNotMatch(l.sistema, /Curso gratis de mecánica/, 'ya recibió el link');
  return { resumen: 'Agradece', puede_responder: true, respuesta: '¡De nada!' };
};
await leerPendientes(await config());
paso('invita a un grupo mandando solo el link, una sola vez');

// ---------- 8. Lo que la IA no lee ----------
const antesLlamadas = llamadas.length;
const yo = await chat(L1, '59179999999', 'Yo');
await escribe(yo.conv, 'Hola, soy el dueño');
await pg.query(`update siguelo_negocios set ia_activa = false where id = $1`, [nCercado]);
const fede = await chat(L2, '59170000006', 'Fede');
await escribe(fede.conv, 'Hola');
avanzar(MIN);
const enviadosAntesDueno = enviados.length;
await leerPendientes(await config());
// Tu "Hola, soy el dueño" sin código: a lo sumo se revisa si responde una pregunta que esperaba (no la responde).
assert.ok(llamadas.slice(antesLlamadas).every((l) => /el dueño te dio la respuesta/.test(l.sistema)), 'ni tu número personal ni un negocio con la IA apagada');
assert.equal(enviados.length, enviadosAntesDueno, 'un saludo tuyo no se le manda a ningún cliente');
paso('no lee tu WhatsApp personal ni los negocios donde apagaste la IA');

// ---------- 9. Si OpenAI falla, reintenta y después lo deja ----------
await pg.query(`update siguelo_negocios set ia_activa = true where id = $1`, [nCercado]);
fallar = 1;
await escribe(fede.conv, '¿Tienen cascos?');
avanzar(MIN);
await leerPendientes(await config());
const conFallo = await uno(`select fallos, reintentar_en from siguelo_ia_lecturas where conversacion_id = $1`, [fede.conv]);
assert.equal(conFallo.fallos, 1);
assert.ok(conFallo.reintentar_en, 'reintenta más tarde');
assert.ok(await uno(`select id from siguelo_registro where tipo = 'ia_error' and texto like '%no tiene saldo disponible%'`), 'queda anotado por qué');
paso('si OpenAI falla, lo anota y reintenta más tarde');

// ---------- 10. Freno de consultas por día ----------
await pg.query(`update siguelo_ia set max_consultas_dia = 0`);
await pg.query(`update siguelo_ia_lecturas set reintentar_en = null where conversacion_id = $1`, [fede.conv]);
const antes2 = llamadas.length;
await leerPendientes(await config());
assert.equal(llamadas.length, antes2);
paso('respeta el máximo de consultas a la IA por día');

// ---------- 11. "Cuándo la usa la IA": respuestas rápidas y reglas del bot ----------
await pg.query(`update siguelo_ia set max_consultas_dia = 500, modo = 'automatico', espera_min_seg = 0, espera_max_seg = 0`);
const { botActivados } = await import('./mock-bot.mjs');
const rQR = (await uno(`insert into respuestas_rapidas (empresa_id, titulo, contenido, tipo, media_url) values ($1, 'QR inscripción', 'Escanea para pagar', 'imagen', 'https://x/qr.jpg') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_cuando_ia (empresa_id, tipo, item_id, cuando) values ($1, 'respuesta', $2, 'cuando el cliente quiere inscribirse')`, [empresa, rQR]);
const regla = (await uno(`insert into respuestas_automaticas (empresa_id, palabra_clave, nombre, tipo, pasos) values ($1, 'cursos', 'Info de cursos', 'rapida', $2::jsonb) returning id`, [empresa, JSON.stringify([{ tipo: 'texto', contenido: 'Tenemos estos cursos…' }])])).id;
await pg.query(`insert into siguelo_cuando_ia (empresa_id, tipo, item_id, cuando) values ($1, 'bot', $2, 'cuando pide información de los cursos')`, [empresa, regla]);
const gabi = await chat(L1, '59170000020', 'Gabi');
await escribe(gabi.conv, 'Hola, ¿qué cursos tienen? Quiero inscribir a mi hijo');
avanzar(MIN);
responder = (l) => {
  assert.match(l.sistema, /"QR inscripción" \(imagen\) Escanea para pagar — MÁNDALA CUANDO: cuando el cliente quiere inscribirse/);
  const bot = /- (b\d+): "Info de cursos" — ACTÍVALO CUANDO: cuando pide información de los cursos/.exec(l.sistema)?.[1];
  assert.ok(bot, 've la regla del bot que puede activar');
  return { resumen: 'Quiere info e inscribir', puede_responder: true, respuesta: 'Te paso la información 😊', respuestas_rapidas: [idDe(l, 'r', '"QR inscripción"')], bot };
};
await leerPendientes(await config());
await salida();
const aGabi = enviados.filter((e) => e.jid.startsWith('59170000020'));
assert.equal(aGabi[0]?.texto, 'Te paso la información 😊');
assert.equal(aGabi.find((e) => e.imagen)?.imagen, 'https://x/qr.jpg');
assert.equal(botActivados.length, 1);
assert.equal(botActivados[0].tipo, 'pasos');
assert.equal(botActivados[0].conversacionId, gabi.conv);
paso('la IA manda la respuesta rápida y activa la regla del bot en la situación que escribiste');

await pg.query(`insert into bot_sesiones (conversacion_id, regla_id, nodo_id, linea_id, telefono, actualizado_en) values ($1, $2, 'n1', $3, '59170000020', $4)`, [gabi.conv, regla, L1, iso(reloj.ahora)]);
await escribe(gabi.conv, 'La opción 2');
avanzar(MIN);
const antesFlujo = llamadas.length;
await leerPendientes(await config());
assert.equal(llamadas.length, antesFlujo, 'contesta el flujo del bot, no la IA');
paso('mientras un flujo del bot espera la respuesta del cliente, la IA no se mete');

// ---------- Ubicación en el mapa (pin), también de otra sucursal y todas las veces que la pida ----------
const { coordenadasDe } = await import(R + 'ia/ubicacion.ts');
assert.deepEqual(coordenadasDe('https://www.google.com/maps/place/Club/@-17.3901,-66.2789,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-17.39012!4d-66.27654'), { lat: -17.39012, lng: -66.27654 }, 'el lugar exacto de un link de Google Maps');
assert.deepEqual(coordenadasDe('https://maps.google.com/?q=-17.3935,-66.1570'), { lat: -17.3935, lng: -66.157 });
assert.deepEqual(coordenadasDe('-17.3935, -66.1570'), { lat: -17.3935, lng: -66.157 });
assert.equal(coordenadasDe('https://maps.app.goo.gl/AbCd123'), null, 'un link corto se resuelve al enviar');
await pg.query(`update siguelo_negocios set ubicacion = $1 where id = $2`, ['https://maps.google.com/?q=-17.3935,-66.1570', nQuilla]);
await pg.query(`update siguelo_negocios set ubicacion = $1 where id = $2`, ['-17.3897, -66.1568', nCercado]);
const hugo = await chat(L1, '59170000030', 'Hugo');
for (const [pregunta, sucursal] of [['¿Me mandas la ubicación?', 'ESTE negocio'], ['¿Y me pasas la ubicación otra vez?', 'ESTE negocio'], ['¿Y la de Cercado?', 'Tienda Cercado']] as const) {
  await escribe(hugo.conv, pregunta);
  avanzar(MIN);
  responder = (l) => {
    assert.match(l.sistema, /UBICACIONES EN EL MAPA QUE PUEDES MANDAR/);
    const u = new RegExp(`- (u\\d+): ${sucursal.replace(/[()]/g, '\\$&')}`).exec(l.sistema)?.[1];
    assert.ok(u, `ve la ubicación de ${sucursal}`);
    return { resumen: 'Pide la ubicación', puede_responder: true, respuesta: 'Te paso la ubicación 📍', ubicacion: u };
  };
  await leerPendientes(await config());
  await salida();
}
const pines = enviados.filter((e) => e.jid.startsWith('59170000030') && e.ubicacion).map((e) => e.ubicacion);
assert.equal(pines.length, 3, 'manda el pin cada vez que la pide');
assert.deepEqual([pines[0].degreesLatitude, pines[0].degreesLongitude, pines[0].name, pines[0].address], [-17.3935, -66.157, 'Tienda Quillacollo (Quillacollo)', 'Av. Blanco Galindo km 13']);
assert.deepEqual([pines[2].degreesLatitude, pines[2].name], [-17.3897, 'Tienda Cercado (Cercado)'], 'y la de otra sucursal');
const enChat = await uno(`select contenido from mensajes where conversacion_id = $1 and contenido like '📍%' order by creado_en desc limit 1`, [hugo.conv]);
assert.match(enChat.contenido, /📍 Ubicación de Tienda Cercado \(Cercado\) \(Calle Jordán 123\): https:\/\/maps\.google\.com\/\?q=-17\.3897,-66\.1568/);
paso('manda el pin del mapa (también de otra sucursal y todas las veces que la pida), y en el chat queda el link');

// ---------- Si no sabe: te avisa y queda anotado por qué no respondió ----------
await pg.query(`update siguelo_ia set si_no_sabe = 'avisar' where empresa_id = $1`, [empresa]);
const ines = await chat(L1, '59170000031', 'Inés');
await escribe(ines.conv, '¿Tienen estacionamiento para camiones?');
avanzar(MIN);
const avisosAntes = enviados.filter((e) => e.jid.startsWith('59179999999')).length;
responder = () => ({ resumen: 'Pregunta por estacionamiento', puede_responder: false, respuesta: '', necesita_al_dueno: true, motivo: 'Pregunta si hay estacionamiento para camiones', aviso: null });
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000031')).length, 0);
assert.ok(enviados.filter((e) => e.jid.startsWith('59179999999')).length > avisosAntes, 'aunque la IA no lo marque como aviso, te llega a tu WhatsApp');
const nota = await uno(`select texto from siguelo_registro where contacto_id = $1 order by creado_en desc limit 1`, [ines.contacto.id]);
assert.match(nota.texto, /no le respondió porque no tiene esa información en la ficha \(en Ajustes está "No responde y te avisa"\)/);
paso('si no sabe la respuesta, te avisa a tu WhatsApp y queda anotado por qué no le respondió');

// ---------- Avisos: número sin código de país, tu mismo número y el aviso de prueba ----------
const { enviarAvisoPrueba, numeroPersonal } = await import(R + 'ia/salida.ts');
assert.equal(numeroPersonal('7999-9999'), '59179999999', '8 dígitos: se agrega 591');
assert.equal(numeroPersonal('+591 79999999'), '59179999999');
let prueba = await enviarAvisoPrueba(empresa, '79999998', null);
assert.ok(prueba.ok, (prueba as any).mensaje);
assert.match(enviados.at(-1)!.jid, /^59179999998@/);
assert.match(enviados.at(-1)!.texto, /aviso de prueba/);
await pg.query(`update lineas_whatsapp set numero = '59175555555' where empresa_id = $1`, [empresa]);
prueba = await enviarAvisoPrueba(empresa, '75555555', null);
assert.equal(prueba.ok, false);
assert.match((prueba as any).mensaje, /es el mismo número que tienes conectado al CRM/);
await pg.query(`update siguelo_ia set avisos = jsonb_set(avisos, '{telefono}', '"75555555"') where empresa_id = $1`, [empresa]);
const juan = await chat(L1, '59170000032', 'Juan');
await escribe(juan.conv, '¿Hacen envíos a Oruro?');
avanzar(MIN);
responder = () => ({ resumen: 'Pregunta envíos', puede_responder: false, respuesta: '', necesita_al_dueno: true, motivo: 'Pregunta si hacen envíos a Oruro', aviso: 'pregunta' });
await leerPendientes(await config());
await salida();
const fallido = await uno(`select estado, motivo from siguelo_ia_salida where origen = 'aviso' and contacto_id = $1`, [juan.contacto.id]);
assert.equal(fallido.estado, 'error');
const notaAviso = await uno(`select texto from siguelo_registro where tipo = 'ia_error' order by creado_en desc limit 1`);
assert.match(notaAviso.texto, /no te llegó un aviso porque tu número personal es el mismo número/);
await pg.query(`update lineas_whatsapp set numero = '591' where empresa_id = $1`, [empresa]);
paso('avisos: agrega el 591, detecta si pusiste el mismo número del CRM (y lo anota) y el aviso de prueba llega');

// ---------- El bot contesta primero (bienvenida): la IA igual responde la pregunta ----------
const { marcarEnviadoPorCRM } = await import(new URL('../server/src/whatsapp/mensajes-enviados-por-crm.ts', import.meta.url).href);
const lalo = await chat(L1, '59170000033', 'Lalo');
await escribe(lalo.conv, '¿Cuánto cuesta la cadena?');
avanzar(1_000);
marcarEnviadoPorCRM('WID-BOT-1');
await pg.query(`insert into mensajes (conversacion_id, remitente, agente_id, contenido, whatsapp_id, creado_en) values ($1, 'agente', null, '¡Bienvenido a Tienda Quillacollo! 👋', 'WID-BOT-1', $2)`, [lalo.conv, iso(reloj.ahora)]);
avanzar(MIN);
responder = (l) => {
  assert.match(l.usuario, /Nosotros \(mensaje automático\): ¡Bienvenido/, 'la IA sabe que la bienvenida fue automática');
  return { resumen: 'Pregunta precio', puede_responder: true, respuesta: 'La cadena cuesta 120 Bs 😊' };
};
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000033')).at(-1)?.texto, 'La cadena cuesta 120 Bs 😊');
paso('si el bot contesta primero (bienvenida), la IA igual responde la pregunta del cliente');

// ---------- Cuando no responde, queda anotado por qué ----------
const L4 = await linea('Sin negocio');
const mia = await chat(L4, '59170000034', 'Mía');
await escribe(mia.conv, 'Hola');
avanzar(MIN);
const antesNada = llamadas.length;
await leerPendientes(await config());
assert.equal(llamadas.length, antesNada, 'sin negocio no gasta una consulta');
const porQue = await uno(`select texto from siguelo_registro where contacto_id = $1 order by creado_en desc limit 1`, [mia.contacto.id]);
assert.match(porQue.texto, /IA no le respondió a \+59170000034: el número "Sin negocio" no está en ningún negocio/);
paso('cuando no responde (número sin negocio, IA apagada, tu número…), queda anotado por qué');

// ---------- "¿Por qué no responde?" ----------
const { estadoIA } = await import(R + 'ia/estado.ts');
await pg.query(`update siguelo_ia set modo = 'borrador', espera_min_seg = 20, espera_max_seg = 60 where empresa_id = $1`, [empresa]);
let est = await estadoIA(empresa);
assert.equal(est.listo, false);
assert.ok(est.general.some((r: any) => !r.ok && /Para aprobar/.test(r.titulo)));
assert.ok(est.general.some((r: any) => r.aviso && /Espera 20 a 60 segundos/.test(r.titulo)));
const sinNeg = est.numeros.find((n: any) => n.nombre === 'Sin negocio')!;
assert.ok(sinNeg.revisiones.some((r: any) => !r.ok && /No está en ningún negocio/.test(r.titulo)));
const quilla = est.numeros.find((n: any) => n.nombre === 'Quillacollo')!;
assert.equal(quilla.negocio, 'Tienda Quillacollo');
assert.ok(quilla.revisiones.some((r: any) => !r.ok && /casi no tiene información/.test(r.titulo)), 'la ficha de prueba es corta');
await pg.query(`update siguelo_ia set modo = 'automatico', espera_min_seg = 0, espera_max_seg = 0 where empresa_id = $1`, [empresa]);
est = await estadoIA(empresa);
await pg.query(`update siguelo_negocios set info_ia = $1 where id = $2`, ['Vendemos repuestos de motos: cadenas (120 Bs), frenos, llantas y aceite. Atendemos de lunes a sábado de 8 a 19.', nQuilla]);
assert.ok(est.general.some((r: any) => !r.ok && /Hubo un error hace poco/.test(r.titulo)), 'muestra el último error (de las pruebas de arriba)');
await pg.query(`delete from siguelo_registro where tipo = 'ia_error'`);
est = await estadoIA(empresa);
assert.ok(est.numeros.find((n: any) => n.nombre === 'Quillacollo')!.revisiones.every((r: any) => r.ok));
assert.equal(est.listo, true);
paso('"¿Por qué no responde?" revisa el modo, el horario, la espera y cada número (conectado, negocio, información)');

// ---------- La IA dice que no puede responder (ej. "¿dónde queda?" sin dirección): nunca queda en silencio ----------
await pg.query(`update siguelo_ia set si_no_sabe = 'espera', texto_espera = 'Déjame consultarlo y te respondo en un momento 🙏', avisos = jsonb_set(avisos, '{telefono}', '"59179999999"') where empresa_id = $1`, [empresa]);
const nora = await chat(L1, '59170000035', 'Nora');
await escribe(nora.conv, 'Sí, ¿dónde queda?');
avanzar(MIN);
const avisosNora = enviados.filter((e) => e.jid.startsWith('59179999999')).length;
responder = () => ({ resumen: 'Pregunta la ubicación', puede_responder: false, respuesta: '', necesita_al_dueno: false });
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000035')).at(-1)?.texto, 'Déjame consultarlo y te respondo en un momento 🙏', 'el cliente recibe el "déjame consultarlo"');
assert.ok(enviados.filter((e) => e.jid.startsWith('59179999999')).length > avisosNora, 'y te avisa');
paso('si la IA dice que no puede responder (aunque no lo marque como "necesita al dueño"), manda el "déjame consultarlo" y te avisa');

// ---------- Si la base no acepta la ubicación (SQL sin pegar), igual responde: texto + link, y lo anota ----------
await pg.query(`alter table siguelo_ia_salida drop constraint siguelo_ia_salida_tipo_check`);
await pg.query(`alter table siguelo_ia_salida add constraint siguelo_ia_salida_tipo_check check (tipo in ('texto', 'imagen', 'pdf', 'documento', 'audio')) not valid`);
const oto = await chat(L1, '59170000036', 'Otto');
await escribe(oto.conv, '¿Dónde queda?');
avanzar(MIN);
responder = (l) => ({ resumen: 'Pregunta la ubicación', puede_responder: true, respuesta: 'Estamos en la Av. Blanco Galindo km 13 📍', ubicacion: /- (u\d+): ESTE negocio/.exec(l.sistema)?.[1] });
await leerPendientes(await config());
await salida();
const aOtto = enviados.filter((e) => e.jid.startsWith('59170000036'));
assert.equal(aOtto[0]?.texto, 'Estamos en la Av. Blanco Galindo km 13 📍', 'la respuesta sale igual');
assert.match(aOtto[1]?.texto ?? '', /📍 Tienda Quillacollo \(Quillacollo\) — Av\. Blanco Galindo km 13\nhttps:\/\/maps\.google\.com\/\?q=-17\.3935,-66\.157/, 'y la ubicación como link');
assert.match((await uno(`select texto from siguelo_registro where tipo = 'ia_error' order by creado_en desc limit 1`)).texto, /no se pudo guardar la respuesta para Otto/);
const { estadoIA: estadoOtra } = await import(R + 'ia/estado.ts');
assert.ok((await estadoOtra(empresa)).general.some((r: any) => !r.ok && /le falta la última versión/.test(r.titulo)), 'el panel avisa que falta pegar el SQL');
await pg.query(`alter table siguelo_ia_salida drop constraint siguelo_ia_salida_tipo_check`);
await pg.query(`alter table siguelo_ia_salida add constraint siguelo_ia_salida_tipo_check check (tipo in ('texto', 'imagen', 'pdf', 'documento', 'audio', 'ubicacion'))`);
assert.ok((await estadoOtra(empresa)).general.some((r: any) => r.ok && /Base de datos al día/.test(r.titulo)));
paso('si la base no acepta la ubicación, igual le responde (texto y link), lo anota y el panel pide pegar el SQL');

// ---------- Te pregunta por WhatsApp (R12), le respondes, se lo dice al cliente y lo aprende para los demás ----------
await pg.query(`update siguelo_ia set modo = 'automatico', si_no_sabe = 'espera', avisos = $2::jsonb where empresa_id = $1`, [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: { pregunta: true, compro: true }, max_dia: 30, juntar_min: 5 })]);
const pia = await chat(L1, '59170000037', 'Pía');
await escribe(pia.conv, '¿Tienen estacionamiento?');
avanzar(MIN);
responder = () => ({ resumen: 'Pregunta por estacionamiento', puede_responder: false, respuesta: '', necesita_al_dueno: true, motivo: 'Pregunta si hay estacionamiento' });
await leerPendientes(await config());
await salida();
const avisoR = enviados.filter((e) => e.jid.startsWith('59179999999')).at(-1)!.texto;
const codigo = /R(\d+) tu respuesta/.exec(avisoR)?.[1];
assert.ok(codigo, `el aviso trae el código para responder: ${avisoR}`);
assert.match(avisoR, /Pía.*Pregunta si hay estacionamiento/s);
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000037')).at(-1)?.texto, 'Déjame consultarlo y te respondo en un momento 🙏');
// Le respondes desde tu WhatsApp personal, al mismo número del CRM.
const dueno = yo;
await escribe(dueno.conv, `R${codigo} Sí, tenemos estacionamiento gratis atrás del local`);
avanzar(MIN);
responder = (l) => {
  assert.match(l.sistema, /el dueño te dio la respuesta/);
  assert.match(l.usuario, /Lo que preguntó el cliente: ¿Tienen estacionamiento\?\nRespuesta del dueño: Sí, tenemos estacionamiento gratis atrás del local/);
  return { respuesta: '¡Sí! Tenemos estacionamiento gratis atrás del local 🚗' };
};
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000037')).at(-1)?.texto, '¡Sí! Tenemos estacionamiento gratis atrás del local 🚗', 'el cliente recibe tu respuesta');
assert.match(enviados.filter((e) => e.jid.startsWith('59179999999')).at(-1)!.texto, new RegExp(`✅ R${codigo}: le respondí a \\*Pía\\*.*Lo aprendí`));
const aprendida = await uno(`select pregunta, respuesta, negocio_id from siguelo_aprendido where respuesta like '%estacionamiento gratis%'`);
assert.equal(aprendida.negocio_id, nQuilla);
assert.equal(aprendida.pregunta, '¿Tienen estacionamiento?');
// Otro cliente pregunta lo mismo: la IA ya lo sabe.
const quique = await chat(L1, '59170000038', 'Quique');
await escribe(quique.conv, 'Hola, ¿hay parqueo?');
avanzar(MIN);
responder = (l) => {
  assert.match(l.sistema, /RESPUESTAS QUE YA DIO EL DUEÑO[\s\S]*estacionamiento gratis atrás del local/, 'lo aprendido va a la IA para los demás clientes');
  return { resumen: 'Pregunta por parqueo', puede_responder: true, respuesta: 'Sí, hay estacionamiento gratis atrás del local 🚗' };
};
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000038')).at(-1)?.texto, 'Sí, hay estacionamiento gratis atrás del local 🚗');
// Sin código y con varias preguntas esperando: te pide el código.
await escribe(dueno.conv, 'Sí, abrimos los domingos');
avanzar(MIN);
await leerPendientes(await config());
await salida();
assert.match(enviados.filter((e) => e.jid.startsWith('59179999999')).at(-1)!.texto, /preguntas esperando: respóndeme con el código/);
await pg.query(`update siguelo_ia_preguntas set estado = 'respondida'`);
// Sin código: si hay una sola pregunta esperando, se usa igual.
const rosa = await chat(L1, '59170000039', 'Rosa');
await escribe(rosa.conv, '¿Aceptan tarjeta?');
avanzar(MIN);
responder = () => ({ resumen: 'Pregunta por tarjeta', puede_responder: false, respuesta: '', necesita_al_dueno: true, motivo: 'Pregunta si aceptan tarjeta' });
await leerPendientes(await config());
await salida();
await escribe(dueno.conv, 'Sí, aceptamos tarjeta y QR');
avanzar(MIN);
responder = () => ({ es_respuesta: true, respuesta: 'Sí, aceptamos tarjeta y QR 😊' });
await leerPendientes(await config());
await salida();
assert.equal(enviados.filter((e) => e.jid.startsWith('59170000039')).at(-1)?.texto, 'Sí, aceptamos tarjeta y QR 😊');
paso('te pregunta por WhatsApp con un código; tu respuesta le llega al cliente y la aprende para responderle a los demás');

const uso = await uno(`select sum(consultas)::int c, sum(entrada)::int e from siguelo_ia_uso`);
console.log(`\n${ok} pasos OK · ${uso.c} consultas a la IA (${uso.e} tokens de entrada) · mensajes:`);
for (const e of enviados) console.log('  →', e.jid.split('@')[0], e.imagen ? `[foto ${e.imagen}]` : e.ubicacion ? `[ubicación ${e.ubicacion.name}]` : JSON.stringify(e.texto).slice(0, 110));
