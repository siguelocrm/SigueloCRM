// Prueba de los links de grupo con su tarjeta (server/src/siguelo/linkDeGrupo.ts y enviarConReintento):
// un texto con un link de grupo sale en el mismo mensaje, con el link en el texto y la tarjeta del
// grupo (nombre, participantes y foto). Sin mensajes de más.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { redirigidos } from './hooks.mjs';
import { enviados } from './mock-sesiones.mjs';

const { linkDeGrupo, conTarjetaDeGrupo, limitesGrupo, olvidarVistas } = await import(new URL('../server/src/siguelo/linkDeGrupo.ts', import.meta.url).href);
const { enviarConReintento } = await import(new URL('../server/src/siguelo/reintento.ts', import.meta.url).href);
assert.ok(redirigidos.includes('sesiones'), 'usa el WhatsApp de prueba');
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

// 1. Encontrar el link de grupo en el texto.
{
  assert.deepEqual(linkDeGrupo(`¡Ya estás inscrito! 🎉 Únete al grupo aquí:\n${LINK}`), { link: LINK, codigo: 'AbCdEfGhIjKlMnOpQrStUv' });
  assert.equal(linkDeGrupo(`Entra aquí (${LINK}).`)?.link, LINK, 'sin el paréntesis ni el punto del final');
  assert.equal(linkDeGrupo('Visita https://infinitychess.com/cursos'), null, 'otros links no cuentan');
  assert.equal(linkDeGrupo('Sin links'), null);
  paso('encuentra el link del grupo (y no toma otros links)');
}

// 2. Texto con link: el mismo mensaje, con el link en el texto y la tarjeta (nombre, participantes y foto).
{
  const texto = `Hola 👋 Te dejo el grupo:\n${LINK}\n¡Te esperamos!`;
  const m = await conTarjetaDeGrupo(sockConGrupo, { text: texto });
  assert.equal(m.text, texto, 'el texto no cambia: el link sigue adentro');
  assert.equal(m.linkPreview.title, 'Ajedrez Sábados');
  assert.match(m.linkPreview.description, /87 participantes · toca para unirte/);
  assert.equal(m.linkPreview['matched-text'], LINK);
  assert.ok(Buffer.isBuffer(m.linkPreview.jpegThumbnail) && m.linkPreview.jpegThumbnail.length > 100, 'con la foto del grupo');
  paso('texto con link: un solo mensaje, con el link en el texto y la tarjeta del grupo');
}

// 3. Se le pregunta a WhatsApp una sola vez por link.
{
  const antes = consultas;
  const m = await conTarjetaDeGrupo(sockConGrupo, { text: LINK });
  assert.equal(m.linkPreview.title, 'Ajedrez Sábados');
  assert.equal(consultas, antes, 'usa la tarjeta guardada');
  paso('la tarjeta se guarda: no le vuelve a preguntar a WhatsApp');
}

// 4. Imagen, documento o texto sin link de grupo: tal cual.
{
  const img = { image: { url: 'https://falso/a.jpg' }, caption: `Grupo: ${LINK}` };
  assert.deepEqual(await conTarjetaDeGrupo(sockConGrupo, img), img, 'el pie de una imagen no lleva tarjeta');
  const t = { text: 'Hola, ¿cómo estás?' };
  assert.deepEqual(await conTarjetaDeGrupo(sockConGrupo, t), t);
  const doc = { document: { url: 'https://falso/a.pdf' }, fileName: 'a.pdf' };
  assert.deepEqual(await conTarjetaDeGrupo(sockConGrupo, doc), doc);
  paso('imágenes, documentos y textos sin link de grupo salen igual que antes');
}

// 5. Si WhatsApp no da los datos del grupo (o no contesta), el link sale igual con un título genérico.
{
  olvidarVistas();
  const callado = { groupGetInviteInfo: () => new Promise(() => {}) };
  const m = await conTarjetaDeGrupo(callado, { text: `Grupo: ${LINK}` });
  assert.equal(m.linkPreview.title, 'Grupo de WhatsApp');
  assert.equal(m.linkPreview.jpegThumbnail, undefined);
  assert.equal((await conTarjetaDeGrupo({}, { text: LINK })).linkPreview.title, 'Grupo de WhatsApp');
  paso('si WhatsApp no contesta, el link sale igual con un título genérico');
}

// 6. enviarConReintento: un solo mensaje, con el link en el texto.
{
  olvidarVistas();
  enviados.length = 0;
  const { obtenerSesion } = await import('./mock-sesiones.mjs');
  const r = await enviarConReintento('l1', obtenerSesion('l1').sock, '59170000001@s.whatsapp.net', { text: `¡Listo! Únete aquí: ${LINK}` });
  assert.equal(enviados.length, 1, 'sin mensaje de más');
  assert.equal(enviados[0].texto, `¡Listo! Únete aquí: ${LINK}`);
  assert.ok(r?.key?.id);
  paso('al enviar: un solo mensaje, con el link en el texto');
}

console.log(`\n${ok} pruebas de links de grupo: todas bien.`);
