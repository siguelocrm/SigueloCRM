// Prueba del destino real de cada envío (server/src/whatsapp/destino.ts) y de los chats cuyo mensaje no
// llegó: WhatsApp identifica muchos chats con un ID interno ("LID", 14 o 15 dígitos). Antes el CRM le
// respondía a ese ID como si fuera un teléfono, y no le llegaba a nadie.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
await prepararBase();
const { jidDestino, olvidarDestinos, limitesDestino, pareceLid } = await import(new URL('../server/src/whatsapp/destino.ts', import.meta.url).href);
const { chatsSinRespuesta } = await import(new URL('../server/src/siguelo/ia/alDia.ts', import.meta.url).href);
assert.ok(redirigidos.includes('db'), 'usa la base de prueba');
limitesDestino.consultaMs = 200;

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const LID = '278683399024812';

// 1. Números normales y JID completos: como siempre.
{
  assert.equal(await jidDestino({}, '59170000001'), '59170000001@s.whatsapp.net');
  assert.equal(await jidDestino({}, '12345@g.us'), '12345@g.us');
  assert.equal(pareceLid(LID), true);
  assert.equal(pareceLid('59170000001'), false);
  paso('un número normal (o un JID completo) sale igual que antes');
}

// 2. Un ID interno con número real conocido: se le manda al número real.
{
  olvidarDestinos();
  let preguntas = 0;
  const sock = { signalRepository: { lidMapping: { getPNForLID: async (lid: string) => { preguntas++; return lid === `${LID}@lid` ? '59162695289:3@s.whatsapp.net' : null; } } }, onWhatsApp: async () => [{ exists: false }] };
  assert.equal(await jidDestino(sock, LID), '59162695289@s.whatsapp.net');
  assert.equal(await jidDestino(sock, LID), '59162695289@s.whatsapp.net');
  assert.equal(preguntas, 1, 'se recuerda');
  paso('si WhatsApp sabe el número real de ese ID, se le manda al número real');
}

// 3. Sin número real: si no es un teléfono de verdad, se manda al ID interno (eso sí llega).
{
  olvidarDestinos();
  const sock = { signalRepository: { lidMapping: { getPNForLID: async () => null } }, onWhatsApp: async () => [] };
  assert.equal(await jidDestino(sock, LID), `${LID}@lid`);
  // Un teléfono largo de verdad (WhatsApp lo conoce): se le manda como teléfono.
  olvidarDestinos();
  const sockReal = { onWhatsApp: async () => [{ exists: true, jid: `${LID}@s.whatsapp.net` }] };
  assert.equal(await jidDestino(sockReal, LID), `${LID}@s.whatsapp.net`);
  // WhatsApp no contesta: al ID interno, sin recordarlo (se vuelve a preguntar la próxima vez).
  olvidarDestinos();
  let veces = 0;
  const callado = { onWhatsApp: () => { veces++; return new Promise(() => {}); } };
  assert.equal(await jidDestino(callado, LID), `${LID}@lid`);
  await jidDestino(callado, LID);
  assert.equal(veces, 2);
  paso('si no hay número real, se manda al ID interno (y un teléfono largo de verdad sale como teléfono)');
}

// 4. Lo que no se entregó no cuenta como respuesta: el chat vuelve a "Chats que quedaron sin respuesta".
{
  const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
  const empresa = (await uno(`insert into empresas (nombre) values ('Destino') returning id`)).id;
  const linea = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Online', '591', 'activo') returning id`, [empresa])).id;
  const cv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, ultima_actividad) values ($1, $2, now()) returning id`, [linea, LID])).id;
  const hace = (min: number) => new Date(reloj.ahora - min * 60_000).toISOString();
  await pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'cliente', 'Quiero saber el precio del tablero', $2)`, [cv, hace(30)]);
  await pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en, estado_entrega) values ($1, 'agente', 'Déjame consultarlo', $2, 'error')`, [cv, hace(20)]);
  const lista = await chatsSinRespuesta(empresa, null);
  assert.deepEqual(lista.map((x: { conversacion_id: string }) => x.conversacion_id), [cv], 'el mensaje que no llegó no cuenta como respuesta');
  await pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'agente', 'Sí, cuesta 350 Bs', $2)`, [cv, hace(10)]);
  assert.equal((await chatsSinRespuesta(empresa, null)).length, 0, 'uno que sí llegó, sí cuenta');
  paso('un mensaje nuestro que no se entregó no cuenta como respuesta: el chat vuelve a "sin respuesta"');
}

console.log(`\n${ok} pruebas del destino de los envíos: todas bien.`);
