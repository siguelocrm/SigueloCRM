import { iniciarProgramadorDeMensajes } from './whatsapp/programados.js';
import { iniciarCierreAutomatico } from './whatsapp/cierre-automatico.js';
import { iniciarSeguimiento } from './siguelo/index.js';
import { iaRouter } from './siguelo/ia/rutas.js';
import { usuariosSigueloRouter } from './siguelo/usuarios/rutas.js';
import { redesRouter } from './siguelo/redes/rutas.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { supabase } from './supabase/client.js';
import { botRouter } from './routes/bot.js';
import { empresasRouter } from './routes/empresas.js';
import { enviarRouter } from './routes/enviar.js';
import { etiquetasRouter } from './routes/etiquetas.js';
import { lineasRouter } from './routes/lineas.js';
import { usuariosRouter } from './routes/usuarios.js';
import { iniciarConexion } from './whatsapp/conexion.js';
import { carpetaAuth } from './whatsapp/sesiones.js';

// Con varias líneas corriendo en el mismo proceso, un error sin atrapar de
// UNA sesión de WhatsApp no puede tirar abajo el servidor entero — eso
// desconectaría a todas las demás líneas de una. Este es el freno
// de última instancia; el arreglo real para cada caso puntual (ver
// whatsapp/conexion.ts) es no dejar promesas sin `.catch()`.
process.on('unhandledRejection', (motivo) => {
  console.error('Unhandled rejection (el proceso sigue corriendo):', motivo);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (el proceso sigue corriendo):', err);
});

const app = express();
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
app.use(enviarRouter);
app.use(etiquetasRouter);
app.use(lineasRouter);
app.use(usuariosRouter);
app.use(empresasRouter);
app.use(botRouter);
app.use(iaRouter);
app.use(usuariosSigueloRouter);
app.use(redesRouter);

// Para saber si el CRM arrancó bien: el despliegue la consulta después de
// publicar una versión nueva y, si no responde, vuelve a la anterior.
app.get('/salud', (_req, res) => {
  res.json({ ok: true });
});

// Nombre y logo del negocio para la pantalla de entrada, antes de iniciar
// sesión (con la sesión todavía no se puede leer la empresa por los permisos).
app.get('/marca', async (_req, res) => {
  const { data } = await supabase.from('empresas').select('nombre, logo_url').limit(1).maybeSingle();
  res.json({ nombre: data?.nombre ?? null, logo_url: data?.logo_url ?? null });
});

// En el servidor, este mismo proceso sirve también la página ya compilada
// (client/dist): todo queda en un solo dominio y no hace falta otro servidor.
// En la compu (npm run dev) la página la sirve Vite y esta carpeta no existe.
const carpetaCliente = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(carpetaCliente)) {
  app.use(express.static(carpetaCliente));
  app.get('*', (_req, res) => res.sendFile(path.join(carpetaCliente, 'index.html')));
}

app.listen(env.port, () => {
  console.log(`API de envío escuchando en http://localhost:${env.port}`);
});

iniciarProgramadorDeMensajes();
iniciarCierreAutomatico();
iniciarSeguimiento();

// Reconecta automáticamente todas las líneas que ya tenían una sesión guardada
// en disco (no hace falta volver a escanear cada vez que reiniciás el backend).
//
// Antes se disparaban todas a la vez (fire-and-forget en el mismo tick): con
// varias líneas de WhatsApp Business, cada una arranca su propia sincronización
// inicial de etiquetas (cientos de eventos hacia Supabase) apenas conecta, y
// hacerlo todo junto saturaba la conexión a Supabase -- vimos ~14.000 "fetch
// failed" seguidos en producción el 2026-09-14, que además tiraron abajo la
// conexión de WhatsApp de una de las líneas (agotó sus reintentos y quedó
// desconectada, pidiendo escanear el QR de nuevo). Escalonamos el arranque de
// cada línea para que esa ráfaga no se sume entre varias al mismo tiempo.
const ESPERA_ENTRE_RECONEXIONES_MS = 20000;

(async () => {
  const { data: lineas, error } = await supabase.from('lineas_whatsapp').select('id');
  if (error) {
    console.error('No se pudieron leer las líneas de Supabase:', error.message);
    return;
  }
  for (const linea of lineas ?? []) {
    if (!fs.existsSync(carpetaAuth(linea.id))) continue;
    iniciarConexion(linea.id).catch((err) => console.error(`Error reconectando línea ${linea.id}:`, err.message));
    await new Promise((resolver) => setTimeout(resolver, ESPERA_ENTRE_RECONEXIONES_MS));
  }
})();
