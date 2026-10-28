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
await leerPendientes(await config());
assert.equal(llamadas.length, antesLlamadas, 'ni tu número personal ni un negocio con la IA apagada');
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

const uso = await uno(`select sum(consultas)::int c, sum(entrada)::int e from siguelo_ia_uso`);
console.log(`\n${ok} pasos OK · ${uso.c} consultas a la IA (${uso.e} tokens de entrada) · mensajes:`);
for (const e of enviados) console.log('  →', e.jid.split('@')[0], e.imagen ? `[foto ${e.imagen}]` : JSON.stringify(e.texto).slice(0, 110));
