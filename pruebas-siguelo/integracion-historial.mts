// Prueba del historial al volver a vincular un número (server/src/whatsapp/mensajes-entrantes.ts →
// importarHistorial): guarda lo de las últimas 48 h que falta, con su hora real, sin bot ni IA al
// momento, y aparece en IA → "Chats que quedaron sin respuesta".
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';
import { botAutomatico } from './mock-bot.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
await prepararBase();
const { importarHistorial } = await import(new URL('../server/src/whatsapp/mensajes-entrantes.ts', import.meta.url).href);
const { chatsSinRespuesta } = await import(new URL('../server/src/siguelo/ia/alDia.ts', import.meta.url).href);
assert.ok(redirigidos.includes('supabase'), 'usa la base de prueba');

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const HORA = 3_600_000;
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Historial') returning id`)).id;
const linea = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'El Alto', '591', 'activo') returning id`, [empresa])).id;

const seg = (t: number) => Math.floor(t / 1000);
const msg = (id: string, jid: string, texto: string, horasAtras: number, fromMe = false) => ({
  key: { remoteJid: jid, id, fromMe },
  messageTimestamp: seg(reloj.ahora - horasAtras * HORA),
  message: { conversation: texto },
});
const historial = [
  msg('H1', '59170000001@s.whatsapp.net', 'Hola, ¿qué horarios tienen?', 14), // anoche, sin respuesta
  msg('H2', '59170000002@s.whatsapp.net', 'Quiero inscribir a mi hijo', 10),
  msg('H3', '59170000002@s.whatsapp.net', 'Claro, te paso la info', 9, true), // respondiste desde el teléfono
  msg('H4', '59170000003@s.whatsapp.net', 'Mensaje viejo', 72), // de hace 3 días: no
  msg('H5', '120363000000@g.us', 'Un grupo', 5), // grupo: no
];

const n = await importarHistorial(historial, linea);
assert.equal(n, 3, 'guarda los 3 de las últimas 48 h de chats uno a uno');
assert.equal(await importarHistorial(historial, linea), 0, 'si llega dos veces, no se duplica');
const h1 = await uno(`select remitente, contenido, creado_en from mensajes where whatsapp_id = 'H1'`);
assert.equal(h1.remitente, 'cliente');
assert.ok(Math.abs(new Date(h1.creado_en).getTime() - (reloj.ahora - 14 * HORA)) < 2000, 'con su hora real');
assert.equal((await uno(`select remitente from mensajes where whatsapp_id = 'H3'`)).remitente, 'agente', 'lo que respondiste desde el teléfono cuenta como respondido');
assert.equal(botAutomatico.length, 0, 'no dispara el bot');
paso('al volver a vincular: guarda lo que faltaba de las últimas 48 h, con su hora, sin duplicar ni disparar el bot');

const sin = await chatsSinRespuesta(empresa, null);
assert.deepEqual(sin.map((x: any) => x.telefono), ['59170000001'], 'solo queda sin respuesta el de anoche (al otro le respondiste desde el teléfono)');
paso('lo que llegó con el número desconectado aparece en "Chats que quedaron sin respuesta"');

console.log(`\n${ok} pasos OK`);
