import fs from 'node:fs';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, proto } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import { actualizarEstadoLinea, borrarSesion, carpetaAuth, guardarSesion, obtenerSesion } from './sesiones.js';
import { importarHistorial, marcarVinculado, procesarMensajeEntrante, procesarMensajeSaliente } from './mensajes-entrantes.js';
import { programarLimpiezaDeEtiquetasHuerfanas, registrarEventosDeEtiquetas } from './etiquetas.js';
import { registrarSeguimientoDeEntrega } from './entrega.js';
import { fueEnviadoPorCRM } from './mensajes-enviados-por-crm.js';
import { useAuthStateSeguro } from './auth-state.js';

// Cuántas veces seguidas se reintentó reconectar cada línea sin éxito. Con
// esto evitamos un loop infinito cuando el problema es persistente (ej. un
// QR que nadie escanea nunca — Baileys tira "QR refs attempts ended" y sin
// este freno se reintentaría para siempre, cada vez más rápido de lo que
// conviene). Se resetea apenas la conexión abre bien.
const intentosReconexion = new Map<string, number>();
const MAX_INTENTOS_RECONEXION = 5;
const ESPERA_BASE_MS = 3000;
const ESPERA_MAXIMA_MS = 60000;

// El CRM no usa el historial de chats que WhatsApp manda al vincular (no
// escuchamos messaging-history.set), pero Baileys igual lo descarga, lo
// descomprime y lo retiene en memoria hasta procesarlo. Con syncFullHistory
// en true (el default de Baileys 7) WhatsApp manda TODO el historial de la
// cuenta: al vincular una cuenta grande (línea 414ec4b5, 2026-10-19) el heap
// pasó los 2 GB y el proceso murió con todas las líneas. Pedimos solo la
// sincronización mínima y descartamos los tipos pesados. No se desactiva
// todo: INITIAL_BOOTSTRAP/RECENT/PUSH_NAME traen los mapeos @lid <-> número
// (sin ellos Baileys avisa que la sesión se vuelve inestable) y el paso de
// RECENT es el que dispara la sincronización inicial de etiquetas.
const TIPOS_DE_HISTORIAL_DESCARTADOS = new Set<number>([
  proto.HistorySync.HistorySyncType.FULL,
  proto.HistorySync.HistorySyncType.ON_DEMAND,
  proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3,
]);

// Cierra el socket anterior de la línea (si había) antes de abrir uno nuevo.
// Sin esto, "Ver QR" o una reconexión dejaban vivo el socket viejo con todos
// sus listeners, timers y buffers: dos sockets sobre las mismas credenciales
// y memoria que nunca se liberaba. Primero se sacan los listeners para que su
// propio 'close' no dispare otra reconexión.
function cerrarSocket(sock: WASocket | undefined): void {
  if (!sock) return;
  (sock.ev as unknown as { removeAllListeners: () => void }).removeAllListeners();
  try {
    sock.end(undefined);
  } catch {
    // ya estaba cerrado
  }
}

// Vincular con código en vez de QR (cuando el único celular es el del propio número): el teléfono
// al que se le pide el código. Se borra al conectar.
const vincularConCodigo = new Map<string, string>();
export function pedirCodigoDeVinculacion(lineaId: string, telefono: string): void {
  vincularConCodigo.set(lineaId, telefono);
}

export async function iniciarConexion(lineaId: string): Promise<WASocket> {
  const { state, saveCreds } = await useAuthStateSeguro(carpetaAuth(lineaId));
  // La versión de WhatsApp Web que trae Baileys por defecto se queda vieja y
  // WhatsApp empieza a rechazar el vínculo ("No se pudo conectar") aunque el
  // QR escanee bien. Pedimos la vigente; si falla la consulta usamos la default.
  const version = await fetchLatestBaileysVersion()
    .then((r) => r.version)
    .catch(() => undefined);
  cerrarSocket(obtenerSesion(lineaId)?.sock);
  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    syncFullHistory: false,
    shouldSyncHistoryMessage: ({ syncType }) => !TIPOS_DE_HISTORIAL_DESCARTADOS.has(syncType ?? -1),
  });

  guardarSesion(lineaId, { sock, estado: 'conectando', qrDataUrl: null });

  sock.ev.on('creds.update', saveCreds);
  // Si la línea es un WhatsApp Business, esto trae la sincronización inicial
  // de etiquetas que el cliente ya tenía cargadas, y después los cambios en
  // vivo. Si no es Business, estos eventos simplemente nunca se disparan.
  registrarEventosDeEtiquetas(sock, lineaId);
  registrarSeguimientoDeEntrega(sock, lineaId);

  // Este socket mostró un QR o pidió un código: es un vínculo nuevo (no una reconexión).
  let mostroQr = false;
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const sesionActual = obtenerSesion(lineaId);
    // Un socket que ya fue reemplazado por otro no toca más la sesión.
    if (sesionActual && sesionActual.sock !== sock) return;

    if (qr) {
      mostroQr = true;
      const telefono = vincularConCodigo.get(lineaId);
      if (telefono && !state.creds.registered) {
        // Con código: se pide una sola vez por socket (el QR se renueva cada ~20 s, el código no).
        const previa = obtenerSesion(lineaId);
        if (!(previa?.sock === sock && (previa.codigo || previa.errorCodigo))) {
          try {
            const codigo = await sock.requestPairingCode(telefono);
            guardarSesion(lineaId, { sock, qrDataUrl: null, codigo, errorCodigo: null, estado: 'conectando' });
          } catch (err) {
            guardarSesion(lineaId, { sock, qrDataUrl: null, codigo: null, errorCodigo: (err as Error).message, estado: 'conectando' });
          }
        }
      } else {
        const qrDataUrl = await qrcode.toDataURL(qr);
        guardarSesion(lineaId, { sock, qrDataUrl, estado: 'conectando' });
      }
      await actualizarEstadoLinea(lineaId, 'conectando');
    }

    if (connection === 'close') {
      const codigo = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      // Una línea que nunca llegó a vincularse y cuyo QR venció (408) no se
      // reconecta sola: cada reintento generaba un QR nuevo cada pocos segundos
      // y el que el cliente escaneaba ya pertenecía a un socket muerto, así que
      // el celular decía "No se pudo conectar". Se reinicia a mano con "Ver QR".
      // OJO: `creds.registered` NO sirve acá — para una línea vinculada con QR
      // queda en false, así que una caída de red (408 "Connection was lost")
      // se confundía con "QR vencido", no se reconectaba y, peor, se borraba la
      // carpeta de credenciales (pasó el 2026-10-15: se cayeron todas las
      // líneas a la vez y hubo que reescanear todos los QR). Una línea ya
      // vinculada siempre tiene `creds.me`.
      // Con código: si venció sin que lo escribieran, tampoco se reintenta solo (se pide otro).
      const codigoVencido = vincularConCodigo.has(lineaId) && !state.creds.registered && codigo === DisconnectReason.timedOut;
      if (codigoVencido) vincularConCodigo.delete(lineaId);
      const qrVencidoSinVincular = codigoVencido || (codigo === DisconnectReason.timedOut && !state.creds.me);
      const debeReconectar = codigo !== DisconnectReason.loggedOut && !qrVencidoSinVincular;
      console.log(`[${lineaId}] Conexión cerrada (código ${codigo ?? 'desconocido'}: ${(lastDisconnect?.error as Error | undefined)?.message ?? 'sin detalle'}).`, debeReconectar ? 'Reconectando...' : qrVencidoSinVincular ? 'QR vencido sin vincular, esperando que se pida uno nuevo.' : 'Sesión cerrada.');
      if (debeReconectar) {
        const intentos = (intentosReconexion.get(lineaId) ?? 0) + 1;
        intentosReconexion.set(lineaId, intentos);
        if (intentos > MAX_INTENTOS_RECONEXION) {
          console.error(`[${lineaId}] ${intentos} intentos de reconexión seguidos sin éxito — dejo de reintentar para no crashear el proceso. Reconectá manualmente desde Conexiones.`);
          intentosReconexion.delete(lineaId);
          cerrarSocket(sock);
          borrarSesion(lineaId);
          await actualizarEstadoLinea(lineaId, 'desconectado');
        } else {
          const espera = Math.min(ESPERA_BASE_MS * 2 ** (intentos - 1), ESPERA_MAXIMA_MS);
          console.log(`[${lineaId}] Reintento ${intentos}/${MAX_INTENTOS_RECONEXION} en ${espera}ms...`);
          setTimeout(() => {
            // Sin este .catch(), un rechazo acá tira abajo TODO el proceso —
            // y con él, las líneas de WhatsApp de todas las demás empresas.
            iniciarConexion(lineaId).catch((err) => console.error(`[${lineaId}] Error reconectando:`, err.message));
          }, espera);
        }
      } else {
        intentosReconexion.delete(lineaId);
        cerrarSocket(sock);
        borrarSesion(lineaId);
        await actualizarEstadoLinea(lineaId, 'desconectado');
        // Solo un cierre de sesión real (el usuario desvinculó el dispositivo)
        // invalida las credenciales; un QR vencido sin vincular no tiene nada
        // que perder pero tampoco hace falta borrarlo.
        if (codigo === DisconnectReason.loggedOut) fs.rmSync(carpetaAuth(lineaId), { recursive: true, force: true });
      }
    } else if (connection === 'open') {
      intentosReconexion.delete(lineaId);
      // Recién vinculado (con QR o código): desde ahora se espera el historial de WhatsApp.
      if (mostroQr || vincularConCodigo.has(lineaId) || !state.creds.accountSyncCounter) marcarVinculado(lineaId);
      vincularConCodigo.delete(lineaId);
      const numero = sock.user?.id?.split(':')[0] || null;
      guardarSesion(lineaId, { sock, estado: 'activo', qrDataUrl: null });
      await actualizarEstadoLinea(lineaId, 'activo', numero);
      console.log(`[${lineaId}] ✔ Conectado a WhatsApp correctamente. Escuchando mensajes...`);
      programarLimpiezaDeEtiquetasHuerfanas(lineaId);
    }
  });

  // Al volver a vincular, WhatsApp manda lo reciente como historial: se guarda lo de las últimas 48 h
  // que falte (sin bot ni IA al momento; ver importarHistorial).
  sock.ev.on('messaging-history.set', ({ messages }) => {
    if (messages?.length) importarHistorial(messages, lineaId).catch((err) => console.error(`[${lineaId}] Error importando el historial:`, (err as Error).message));
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'append') {
      await importarHistorial(messages, lineaId).catch((err) => console.error(`[${lineaId}] Error importando el historial:`, (err as Error).message));
      return;
    }
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      // Solo entran chats uno a uno: @s.whatsapp.net (número real) o @lid (el
      // identificador anónimo que WhatsApp usa cada vez más seguido). Así quedan
      // afuera grupos (@g.us), estados y listas (@broadcast) y canales (@newsletter).
      if (!jid || !(jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'))) continue;
      if (msg.key.fromMe) {
        // Si lo mandó el CRM (routes/enviar.ts), ya está guardado con su
        // whatsapp_id; lo ignoramos acá para no duplicarlo. Si no, es un
        // mensaje mandado a mano desde el teléfono y hay que guardarlo para
        // que la conversación se vea igual en ambos lados.
        if (msg.key.id && fueEnviadoPorCRM(msg.key.id)) continue;
        await procesarMensajeSaliente(msg, lineaId);
        continue;
      }
      await procesarMensajeEntrante(msg, sock, lineaId);
    }
  });

  return sock;
}
