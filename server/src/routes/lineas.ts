import fs from 'node:fs';
import { Router } from 'express';
import { actualizarEstadoLinea, borrarSesion, carpetaAuth, obtenerSesion } from '../whatsapp/sesiones.js';
import { iniciarConexion } from '../whatsapp/conexion.js';
import { supabase } from '../supabase/client.js';
import { conNumero } from '../siguelo/usuarios/proteger.js';

// SígueloCRM: conectar, desconectar y borrar, solo un dueño con acceso a ese número; ver el estado, quien tenga el número.
const delDueno = conNumero((req) => req.params.id, 'dueno');
const deQuienLoTiene = conNumero((req) => req.params.id);

export const lineasRouter = Router();

// Arranca (o reinicia) la sesión de WhatsApp de una línea. Si no tiene credenciales
// guardadas todavía, va a generar un QR nuevo — el frontend lo pide con /estado.
lineasRouter.post('/lineas/:id/conectar', ...delDueno, (req, res) => {
  const { id } = req.params;
  const existente = obtenerSesion(id);
  if (existente && (existente.estado === 'activo' || existente.estado === 'conectando')) {
    return res.json({ ok: true, yaEnProceso: true });
  }
  iniciarConexion(id).catch((err) => console.error(`Error iniciando línea ${id}:`, err.message));
  res.json({ ok: true });
});

// Fuerza un resync completo del app-state (etiquetas incluidas) de una línea
// ya conectada. Baileys solo pide el historial completo a WhatsApp en
// situaciones puntuales (primer vinculo, o si el estado local se resetea);
// un reconnect normal solo aplica los cambios nuevos desde la última vez.
// Si una cuenta de WhatsApp Business quedó con etiquetas reales sin
// sincronizar (ver server/src/whatsapp/etiquetas.ts), este endpoint le pide a Baileys que vuelva a mandar todo desde
// cero -- con el freno de `encolar` + los reintentos ya en su lugar, esta
// vez debería llegar bien.
lineasRouter.post('/lineas/:id/resincronizar-etiquetas', ...delDueno, async (req, res) => {
  const { id } = req.params;
  const sesion = obtenerSesion(id);
  if (!sesion || sesion.estado !== 'activo') {
    return res.status(503).json({ error: 'Esa línea de WhatsApp no está conectada' });
  }
  try {
    await sesion.sock.resyncAppState(
      ['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'],
      false,
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// El frontend hace polling acá cada par de segundos mientras espera el QR / la conexión.
lineasRouter.get('/lineas/:id/estado', ...deQuienLoTiene, (req, res) => {
  const sesion = obtenerSesion(req.params.id);
  if (!sesion) return res.json({ estado: 'desconectado', qr: null });
  res.json({ estado: sesion.estado, qr: sesion.qrDataUrl || null });
});

// Desvincula el número (cierra sesión de WhatsApp y borra las credenciales guardadas).
lineasRouter.post('/lineas/:id/desconectar', ...delDueno, async (req, res) => {
  const { id } = req.params;
  const sesion = obtenerSesion(id);
  if (sesion?.sock) {
    try {
      await sesion.sock.logout();
    } catch {
      // puede fallar si ya estaba caída, no pasa nada
    }
  }
  borrarSesion(id);
  fs.rmSync(carpetaAuth(id), { recursive: true, force: true });
  await actualizarEstadoLinea(id, 'desconectado');
  res.json({ ok: true });
});

// Elimina la línea por completo: cierra la sesión de WhatsApp si estaba activa,
// borra las credenciales guardadas y elimina el registro de la base de datos.
lineasRouter.delete('/lineas/:id', ...delDueno, async (req, res) => {
  const { id } = req.params;
  const sesion = obtenerSesion(id);
  if (sesion?.sock) {
    try {
      await sesion.sock.logout();
    } catch {
      // puede fallar si ya estaba caída, no pasa nada
    }
  }
  borrarSesion(id);
  fs.rmSync(carpetaAuth(id), { recursive: true, force: true });
  const { error } = await supabase.from('lineas_whatsapp').delete().eq('id', id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true });
});
