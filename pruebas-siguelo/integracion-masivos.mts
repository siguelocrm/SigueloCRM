// Prueba de los mensajes masivos: a quiénes les llega (filtros), el ritmo
// (pausas, horario, tope por día), números sin WhatsApp, pausa sola por errores
// y que no arranquen el seguimiento como si los hubieras escrito tú.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { enviados, linea } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { armarDestinatarios, procesarMasivos, leerLinea, _reiniciarRitmo } = await import(R + 'masivos/masivos.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

const MIN = 60_000, HORA = 60 * MIN;
// 10:00 de la mañana en Bolivia (UTC-4).
const hoy = new Date();
reloj.ahora = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 14, 0, 0);
const avanzar = (x: number) => { reloj.ahora += x; };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const filas = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows;
const empresa = (await uno(`insert into empresas (nombre) values ('Club') returning id`)).id;
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Quillacollo', '59171111111', 'activo') returning id`, [empresa])).id;
const L2 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Cercado', '59172222222', 'activo') returning id`, [empresa])).id;
const etapa = async (tipo: string) => (await uno(`select id from etapas_venta where empresa_id = $1 and tipo = $2 order by orden limit 1`, [empresa, tipo])).id;
const primera = await etapa('normal');
const perdida = await etapa('perdida');
// El seguimiento tiene mensajes en la primera etapa (para revisar que el masivo no cuente como "le escribiste").
await pg.query(`insert into siguelo_etapas (empresa_id, etapa_id) values ($1, $2)`, [empresa, primera]);

const contacto = async (tel: string, nombre: string, etapaId: string, lineaId: string | null) => {
  const id = (await uno(`insert into contactos (empresa_id, telefono, nombre, etapa_id) values ($1, $2, $3, $4) returning id`, [empresa, tel, nombre, etapaId])).id;
  if (lineaId) {
    const cv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre) values ($1, $2, $3) returning id`, [lineaId, tel, nombre])).id;
    await pg.query(`insert into mensajes (conversacion_id, remitente, tipo, contenido, creado_en) values ($1, 'cliente', 'texto', 'Hola', $2)`, [cv, new Date(reloj.ahora - 5 * HORA).toISOString()]);
  }
  return id;
};
const ana = await contacto('59170000001', 'Ana Pérez', primera, L1);
const beto = await contacto('59170000002', 'Beto', primera, L1);
await contacto('59170000003', 'Caro', perdida, L1);
await contacto('59170000004', 'Dani', primera, L2);
const etiqueta = (await uno(`insert into etiquetas_whatsapp (linea_id, whatsapp_id, nombre) values ($1, '1', 'Clientes 2025') returning id`, [L1])).id;
await pg.query(`insert into contacto_etiquetas (contacto_id, etiqueta_id) values ($1, $2)`, [beto, etiqueta]);

// ---------- 1. A quiénes les llega ----------
const tels = (l: { telefono: string }[]) => l.map((d) => d.telefono).sort();
assert.deepEqual(tels(await armarDestinatarios(empresa, L1, { origen: 'chats' })), ['59170000001', '59170000002'], 'los de este número, sin los de Venta Perdida');
assert.deepEqual(tels(await armarDestinatarios(empresa, L1, { origen: 'chats', sin_perdidos: false })), ['59170000001', '59170000002', '59170000003']);
assert.deepEqual(tels(await armarDestinatarios(empresa, L1, { origen: 'chats', etiquetas: [etiqueta] })), ['59170000002'], 'por etiqueta');
assert.deepEqual(tels(await armarDestinatarios(empresa, L1, { origen: 'todos', etapas: [primera] })), ['59170000001', '59170000002', '59170000004'], 'todos los contactos de una etapa');
const lista = await armarDestinatarios(empresa, L1, { origen: 'lista', lista: ['70000009, Pepe Rojas', '123', '+591 7000-0001 Ana', '70000009'] });
assert.deepEqual(lista.map((d) => [d.telefono, d.nombre]), [['59170000009', 'Pepe Rojas'], ['59170000001', 'Ana']], 'lista pegada: agrega 591, quita repetidos y los que no son números');
assert.equal(leerLinea('hola'), null);
paso('a quiénes les llega: chats del número, todos, etapas, etiquetas, lista pegada y sin los de Venta Perdida');

// ---------- 2. Envía uno por vez, con pausa, y no cuenta como "le escribiste" ----------
olvidarNegocios();
const crear = async (nombre: string, destinatarios: { telefono: string; nombre: string | null; contacto_id: string | null }[], extra: Record<string, unknown> = {}) => {
  const m = (await uno(
    `insert into siguelo_masivos (empresa_id, nombre, linea_id, textos, total, pausa_min_seg, pausa_max_seg, maximo_diario, hora_inicio, hora_fin)
     values ($1, $2, $3, $4, $5, $6, $7, $8, '08:00', '20:00') returning id`,
    [empresa, nombre, L1, extra.textos ?? ['Hola {nombre}, ¡empiezan las vacaciones útiles en {sucursal}! 🏆', '{nombre}, abrimos inscripciones en {sucursal} 🙌'], destinatarios.length, 40, 60, extra.maximo ?? 150],
  )).id;
  let i = 0;
  for (const d of destinatarios) await pg.query(`insert into siguelo_masivo_envios (masivo_id, empresa_id, contacto_id, telefono, nombre, orden) values ($1, $2, $3, $4, $5, $6)`, [m, empresa, d.contacto_id, d.telefono, d.nombre, i++]);
  return m;
};
const vueltas = async (n: number, cada: number) => { for (let i = 0; i < n; i++) { await procesarMasivos(); avanzar(cada); } };
const masivo = async (id: string) => uno(`select * from siguelo_masivos where id = $1`, [id]);

const m1 = await crear('Vacaciones útiles', await armarDestinatarios(empresa, L1, { origen: 'chats' }));
await procesarMasivos();
assert.equal(enviados.length, 0, 'no sale apenas lo creas: primero una pausa');
avanzar(20_000);
await procesarMasivos();
assert.equal(enviados.length, 1);
await procesarMasivos();
avanzar(30_000);
await procesarMasivos();
assert.equal(enviados.length, 1, 'entre dos envíos hay una pausa al azar (40 a 60 s)');
avanzar(31_000);
await procesarMasivos();
assert.equal(enviados.length, 2);
await vueltas(3, 61_000);
const r1 = await masivo(m1);
assert.equal(r1.estado, 'terminado');
assert.equal(r1.enviados, 2);
const textos = enviados.map((e) => e.texto).join(' | ');
assert.match(textos, /Ana/); assert.match(textos, /Beto/); assert.match(textos, /Quillacollo/);
assert.doesNotMatch(textos, /\{/, 'sin variables sin llenar');
const guardados = await filas(`select m.contenido from mensajes m join conversaciones c on c.id = m.conversacion_id where m.remitente = 'agente' and c.linea_id = $1`, [L1]);
assert.equal(guardados.length, 2, 'cada envío queda en su chat de la Bandeja');
const act = await filas(`select telefono, ultimo_manual, ultimo_saliente from siguelo_actividad($1)`, [empresa]);
const deAna = act.find((a: any) => a.telefono === '59170000001');
assert.ok(deAna.ultimo_saliente && !deAna.ultimo_manual, 'el masivo no cuenta como un mensaje escrito por ti (no arranca reactivaciones)');
paso('envía uno por vez con pausa al azar, con {nombre} y {sucursal}, queda en la Bandeja y no arranca el seguimiento');

// ---------- 3. Horario y tope por día ----------
enviados.length = 0;
_reiniciarRitmo();
const gente = [0, 1, 2].map((i) => ({ telefono: `5917100000${i}`, nombre: `Persona ${i}`, contacto_id: null }));
// Tope 4 por día desde este número: hoy ya salieron 2 del masivo anterior (el tope suma todos los masivos del número).
const m2 = await crear('Promo', gente, { maximo: 4 });
reloj.ahora = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 23, 30, 0); // 19:30 en Bolivia
await vueltas(4, 61_000);
assert.equal(enviados.length, 2, 'solo 4 por día desde este número, sumando los 2 del masivo anterior');
assert.equal((await masivo(m2)).motivo, 'tope');
reloj.ahora = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + 1, 0, 10, 0); // 20:10 en Bolivia
await vueltas(3, 61_000);
assert.equal((await masivo(m2)).motivo, 'fuera', 'fuera del horario no envía');
assert.equal(enviados.length, 2);
reloj.ahora = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + 1, 12, 5, 0); // 8:05 del día siguiente
await vueltas(3, 61_000);
assert.equal(enviados.length, 3, 'al día siguiente sigue');
assert.equal((await masivo(m2)).estado, 'terminado');
const nuevo = await uno(`select c.nombre, c.etapa_id from contactos c where telefono = '59171000000'`);
assert.equal(nuevo?.nombre, 'Persona 0', 'un número nuevo queda como contacto');
paso('respeta el horario y el tope por día (y sigue al día siguiente); los números nuevos quedan como contactos');

// ---------- 4. Sin WhatsApp y errores seguidos ----------
enviados.length = 0;
_reiniciarRitmo();
linea.sinWhatsapp = ['59172000000'];
const m3 = await crear('Aviso', [0, 1, 2, 3, 4].map((i) => ({ telefono: `5917200000${i}`, nombre: null, contacto_id: null })));
await vueltas(2, 61_000);
const sinWa = await uno(`select estado, motivo from siguelo_masivo_envios where masivo_id = $1 and telefono = '59172000000'`, [m3]);
assert.equal(sinWa.estado, 'error');
assert.match(sinWa.motivo, /no tiene WhatsApp/);
linea.falla = true;
await vueltas(5, 61_000);
const r3 = await masivo(m3);
assert.equal(r3.estado, 'pausado', 'tres errores seguidos: se pausa solo');
assert.match(r3.motivo, /errores de envío seguidos/);
linea.falla = false;
await pg.query(`update siguelo_masivos set estado = 'enviando', motivo = null where id = $1`, [m3]);
await vueltas(5, 61_000);
const fin = await filas(`select estado, count(*)::int n from siguelo_masivo_envios where masivo_id = $1 group by estado order by estado`, [m3]);
assert.deepEqual(fin.map((f: any) => `${f.estado}:${f.n}`), ['enviado:1', 'error:4']);
assert.equal(enviados[0].texto.startsWith('Hola, ') || enviados[0].texto.startsWith('Abrimos'), true, 'sin nombre, el saludo queda bien');
paso('salta los números sin WhatsApp y se pausa solo después de 3 errores seguidos');

console.log(`\n${ok} pasos OK · mensajes "enviados":`);
for (const e of enviados) console.log(`  → ${e.jid} ${JSON.stringify(e.texto)}`);
