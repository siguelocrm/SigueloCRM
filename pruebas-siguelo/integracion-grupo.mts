// Prueba de los links de grupo con su tarjeta (server/src/siguelo/linkDeGrupo.ts y enviarConReintento):
// el link de un grupo sale al final, solo y con la tarjeta (nombre y foto del grupo); en masivos y en
// lo que escribes a mano, en un solo mensaje con la tarjeta.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { redirigidos } from './hooks.mjs';
import { enviados } from './mock-sesiones.mjs';

const { separarLink, prepararMensajes, limitesGrupo, olvidarVistas } = await import(new URL('../server/src/siguelo/linkDeGrupo.ts', import.meta.url).href);
const { enviarConReintento } = await import(new URL('../server/src/siguelo/reintento.ts', import.meta.url).href);
const { fueEnviadoPorCRM } = await import(new URL('../server/src/whatsapp/mensajes-enviados-por-crm.ts', import.meta.url).href);
assert.ok(redirigidos.includes('sesiones'), 'usa el WhatsApp de prueba');
limitesGrupo.entreMensajesMs = 5;
limitesGrupo.consultaMs = 200;

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const LINK = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv';

// Un WhatsApp falso que conoce el grupo (nombre, participantes y foto).
const foto = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#14727e' } }).jpeg().toBuffer();
let consultas = 0;
const sockConGrupo = {
  async groupGetInviteInfo(codigo: string) {
    consultas++;
    return codigo === 'AbCdEfGhIjKlMnOpQrStUv' ? { id: '120363000000000000@g.us', subject: 'Ajedrez Sábados', size: 87 } : undefined;
  },
  async profilePictureUrl() {
    return `data:image/jpeg;base64,${foto.toString('base64')}`;
  },
};

// 1. Separar el link del texto.
{
  const r = separarLink(`¡Ya estás inscrito! 🎉 Únete al grupo aquí:\n${LINK}`);
  assert.equal(r?.link, LINK);
  assert.equal(r?.codigo, 'AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(r?.resto, '¡Ya estás inscrito! 🎉 Únete al grupo aquí:');
  assert.equal(separarLink(`Entra aquí (${LINK}).`)?.link, LINK, 'sin el paréntesis ni el punto del final');
  assert.equal(separarLink('Visita https://infinitychess.com/cursos'), null, 'otros links no cuentan');
  assert.equal(separarLink('Sin links'), null);
  paso('separa el link del grupo del resto del texto (y no toca otros links)');
}

// 2. Texto con link: primero el texto, al final el link con la tarjeta (nombre, participantes y foto).
{
  const m = await prepararMensajes(sockConGrupo, { text: `Hola 👋 Te dejo el grupo:\n${LINK}\n¡Te esperamos!` });
  assert.equal(m.length, 2);
  assert.equal(m[0].text, 'Hola 👋 Te dejo el grupo:\n\n¡Te esperamos!');
  assert.equal(m[1].text, LINK);
  assert.equal(m[1].linkPreview.title, 'Ajedrez Sábados');
  assert.match(m[1].linkPreview.description, /87 participantes/);
  assert.equal(m[1].linkPreview['matched-text'], LINK);
  assert.ok(Buffer.isBuffer(m[1].linkPreview.jpegThumbnail) && m[1].linkPreview.jpegThumbnail.length > 100, 'con la foto del grupo');
  paso('texto con link: el texto primero y el link al final con la tarjeta del grupo');
}

// 3. Solo el link: un mensaje con la tarjeta. Y se le pregunta a WhatsApp una sola vez por link.
{
  const antes = consultas;
  const m = await prepararMensajes(sockConGrupo, { text: LINK });
  assert.equal(m.length, 1);
  assert.equal(m[0].linkPreview.title, 'Ajedrez Sábados');
  assert.equal(consultas, antes, 'usa la tarjeta guardada');
  paso('solo el link: un mensaje con la tarjeta (sin volver a preguntarle a WhatsApp)');
}

// 4. Imagen con el link en el pie: la imagen con su texto, y el link aparte con la tarjeta.
{
  const m = await prepararMensajes(sockConGrupo, { image: { url: 'https://falso/afiche.jpg' }, caption: `Curso de verano 🏆\nInscríbete aquí: ${LINK}` });
  assert.equal(m.length, 2);
  assert.equal(m[0].image.url, 'https://falso/afiche.jpg');
  assert.equal(m[0].caption, 'Curso de verano 🏆\nInscríbete aquí:');
  assert.equal(m[1].text, LINK);
  assert.ok(m[1].linkPreview);
  const solo = await prepararMensajes(sockConGrupo, { image: { url: 'https://falso/a.jpg' }, caption: LINK });
  assert.equal(solo[0].caption, undefined, 'si el pie era solo el link, la imagen va sin pie');
  paso('imagen con el link en el pie: imagen primero y el link aparte con la tarjeta');
}

// 5. Sin separar (masivos, lo que escribes a mano): un solo mensaje con la tarjeta; la imagen, tal cual.
{
  const m = await prepararMensajes(sockConGrupo, { text: `Te dejo el grupo: ${LINK}` }, false);
  assert.equal(m.length, 1);
  assert.equal(m[0].text, `Te dejo el grupo: ${LINK}`);
  assert.equal(m[0].linkPreview.title, 'Ajedrez Sábados');
  const img = { image: { url: 'https://falso/a.jpg' }, caption: `Grupo: ${LINK}` };
  assert.deepEqual(await prepararMensajes(sockConGrupo, img, false), [img]);
  paso('sin separar: un solo mensaje con la tarjeta (masivos y bandeja)');
}

// 6. Sin link de grupo, o con su propia vista previa: tal cual.
{
  const t = { text: 'Hola, ¿cómo estás?' };
  assert.deepEqual(await prepararMensajes(sockConGrupo, t), [t]);
  const doc = { document: { url: 'https://falso/a.pdf' }, fileName: 'a.pdf' };
  assert.deepEqual(await prepararMensajes(sockConGrupo, doc), [doc]);
  paso('sin link de grupo: el mensaje sale igual que antes');
}

// 7. Si WhatsApp no da los datos del grupo (o no contesta), el link sale igual con un título genérico.
{
  olvidarVistas();
  const callado = { groupGetInviteInfo: () => new Promise(() => {}) };
  const m = await prepararMensajes(callado, { text: `Grupo: ${LINK}` });
  assert.equal(m.length, 2);
  assert.equal(m[1].linkPreview.title, 'Grupo de WhatsApp');
  assert.equal(m[1].linkPreview.jpegThumbnail, undefined);
  const m2 = await prepararMensajes({}, { text: LINK });
  assert.equal(m2[0].linkPreview.title, 'Grupo de WhatsApp');
  paso('si WhatsApp no contesta, el link sale igual con un título genérico');
}

// 8. enviarConReintento: manda los dos mensajes en orden, devuelve el primero y marca el segundo como del CRM.
{
  olvidarVistas();
  enviados.length = 0;
  const { obtenerSesion } = await import('./mock-sesiones.mjs');
  const sock = obtenerSesion('l1').sock;
  const r = await enviarConReintento('l1', sock, '59170000001@s.whatsapp.net', { text: `¡Listo! Únete aquí: ${LINK}` });
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].texto, '¡Listo! Únete aquí:');
  assert.equal(enviados[1].texto, LINK);
  assert.ok(enviados[0].en <= enviados[1].en, 'en orden');
  const idPrimero = r?.key?.id;
  assert.ok(idPrimero);
  const idSegundo = `WID-${Number(String(idPrimero).split('-')[1]) + 1}`;
  assert.ok(fueEnviadoPorCRM(idSegundo), 'el link no se guarda dos veces como "escrito desde el teléfono"');

  enviados.length = 0;
  await enviarConReintento('l1', sock, '59170000001@s.whatsapp.net', { text: `Promo: ${LINK}` }, { separar: false });
  assert.equal(enviados.length, 1, 'masivos: un solo mensaje');
  enviados.length = 0;
  await enviarConReintento('l1', sock, '59170000001@s.whatsapp.net', { text: 'Sin link' });
  assert.equal(enviados.length, 1);
  paso('al enviar: el texto y luego el link, en orden; en masivos, un solo mensaje');
}

console.log(`\n${ok} pruebas de links de grupo: todas bien.`);
