// Prueba del historial al volver a vincular un número (server/src/whatsapp/mensajes-entrantes.ts →
// importarHistorial): guarda lo de los últimos 4 días que falta, con su hora real, sin bot ni IA al
// momento, y aparece en IA → "Chats que quedaron sin respuesta".
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';
import { botAutomatico } from './mock-bot.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
await prepararBase();
const { importarHistorial, estadoHistorial, marcarVinculado } = await import(new URL('../server/src/whatsapp/mensajes-entrantes.ts', import.meta.url).href);
const { chatsSinRespuesta } = await import(new URL('../server/src/siguelo/ia/alDia.ts', import.meta.url).href);
assert.ok(redirigidos.includes('supabase'), 'usa la base de prueba');

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const HORA = 3_600_000;
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Historial') returning id`)).id;
const linea = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'El Alto', '591', 'activo') returning id`, [empresa])).id;

// Como llega en el historial real: la hora es un Long de protobuf (no un número).
const seg = (t: number) => ({ low: Math.floor(t / 1000), high: 0, unsigned: true, toNumber() { return this.low; } });
const msg = (id: string, jid: string, texto: string, horasAtras: number, fromMe = false) => ({
  key: { remoteJid: jid, id, fromMe },
  messageTimestamp: seg(reloj.ahora - horasAtras * HORA),
  message: { conversation: texto },
});
const historial = [
  msg('H1', '59170000001@s.whatsapp.net', 'Hola, ¿qué horarios tienen?', 14), // anoche, sin respuesta
  msg('H2', '59170000002@s.whatsapp.net', 'Quiero inscribir a mi hijo', 10),
  msg('H3', '59170000002@s.whatsapp.net', 'Claro, te paso la info', 9, true), // respondiste desde el teléfono
  msg('H4', '59170000003@s.whatsapp.net', 'Mensaje viejo', 120), // de hace 5 días: no
  msg('H5', '120363000000@g.us', 'Un grupo', 5), // grupo: no
  // Mensaje temporal: viene envuelto.
  { key: { remoteJid: '59170000006@s.whatsapp.net', id: 'H6', fromMe: false }, messageTimestamp: seg(reloj.ahora - 8 * HORA), message: { ephemeralMessage: { message: { extendedTextMessage: { text: '¿Tienen clases el sábado?' } } } } },
  // Foto: no se descarga, queda una nota.
  { key: { remoteJid: '59170000007@s.whatsapp.net', id: 'H7', fromMe: false }, messageTimestamp: seg(reloj.ahora - 7 * HORA), message: { imageMessage: { caption: 'Este es el comprobante' } } },
];

marcarVinculado(linea);
assert.equal(estadoHistorial(linea).lotes, 0, 'recién vinculado: esperando el historial');
const n = await importarHistorial(historial, linea);
assert.equal(n, 5, 'guarda los 5 de los últimos 4 días de chats uno a uno');
assert.equal((await uno(`select contenido from mensajes where whatsapp_id = 'H6'`)).contenido, '¿Tienen clases el sábado?', 'saca el texto del mensaje temporal');
assert.match((await uno(`select contenido from mensajes where whatsapp_id = 'H7'`)).contenido, /Foto .*mírala en el teléfono\)\nEste es el comprobante/);
const est = estadoHistorial(linea);
assert.deepEqual({ lotes: est.lotes, recibidos: est.recibidos, enVentana: est.enVentana, guardados: est.guardados, errores: est.errores }, { lotes: 1, recibidos: 7, enVentana: 5, guardados: 5, errores: 0 }, 'cuenta lo que pasó (se ve en la tarjeta)');
await pg.query(`update conversaciones set estado = 'cerrado', ultima_actividad = $1 where contacto_telefono = '59170000002'`, [new Date(reloj.ahora - 9 * HORA).toISOString()]);
assert.equal(await importarHistorial(historial, linea), 0, 'si llega dos veces, no se duplica');
const cerrado = await uno(`select estado from conversaciones where contacto_telefono = '59170000002'`);
assert.equal(cerrado.estado, 'cerrado', 'un chat sin nada nuevo no se reabre');
const h1 = await uno(`select remitente, contenido, creado_en from mensajes where whatsapp_id = 'H1'`);
assert.equal(h1.remitente, 'cliente');
assert.ok(Math.abs(new Date(h1.creado_en).getTime() - (reloj.ahora - 14 * HORA)) < 2000, 'con su hora real');
assert.equal((await uno(`select remitente from mensajes where whatsapp_id = 'H3'`)).remitente, 'agente', 'lo que respondiste desde el teléfono cuenta como respondido');
assert.equal(botAutomatico.length, 0, 'no dispara el bot');
paso('al volver a vincular: guarda lo que faltaba de los últimos 4 días, con su hora, sin duplicar ni disparar el bot');

const sin = await chatsSinRespuesta(empresa, null);
assert.deepEqual(sin.map((x: any) => x.telefono).sort(), ['59170000001', '59170000006', '59170000007'], 'quedan sin respuesta los que escribieron (al que respondiste desde el teléfono, no)');
paso('lo que llegó con el número desconectado aparece en "Chats que quedaron sin respuesta"');

// Sin QR nuevo: WhatsApp entrega lo pendiente como mensajes nuevos. Lo atrasado se guarda con su
// hora real (así la IA no responde todo de golpe) y el bot no contesta; lo de recién, normal.
const { procesarMensajeEntrante } = await import(new URL('../server/src/whatsapp/mensajes-entrantes.ts', import.meta.url).href);
await procesarMensajeEntrante(msg('N1', '59170000004@s.whatsapp.net', 'Hola, ¿están?', 6), {} as any, linea);
const n1 = await uno(`select creado_en from mensajes where whatsapp_id = 'N1'`);
assert.ok(Math.abs(new Date(n1.creado_en).getTime() - (reloj.ahora - 6 * HORA)) < 2000, 'lo atrasado queda con su hora real');
await procesarMensajeEntrante(msg('N2', '59170000005@s.whatsapp.net', 'Hola', 0), {} as any, linea);
await new Promise((r) => setTimeout(r, 300));
assert.equal(botAutomatico.length, 1, 'el bot solo contesta el de recién, no el atrasado');
paso('lo que WhatsApp entrega tarde al reconectar se guarda con su hora real y el bot no lo contesta');

console.log(`\n${ok} pasos OK`);
