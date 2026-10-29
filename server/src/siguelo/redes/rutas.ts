import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { supabase } from '../../supabase/client.js';
import { db } from '../db.js';
import { MIN } from '../horario.js';
import { configDeEmpresa } from '../ia/config.js';
import { cuentasDe, graph, tokenDeCodigo, tokenLargo, urlLogin, type AppMeta } from './meta.js';
import { appDe, responderComoDueno } from './redes.js';

// Conectar Facebook e Instagram: tu App de Meta (ID y secreto, solo los ve el
// servidor), "Conectar con Facebook" (OAuth) o pegar un token a mano, y
// responder desde el CRM lo que la IA te preguntó.

export const redesRouter = Router();
const soloAdmin = requiereRol('supervisor', 'dueno');

// Pedidos de "Conectar con Facebook" en curso (state → quién y adónde vuelve). 15 minutos.
const pendientes = new Map<string, { empresaId: string; volver: string; vence: number }>();

const urlVolver = (base: string) => `${base.replace(/\/+$/, '')}/siguelo/meta/volver`;
const baseValida = (b: unknown) => typeof b === 'string' && /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/localhost(:\d+)?)\/?$/i.test(b.trim());

redesRouter.post('/siguelo/meta/app', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const app: AppMeta = { app_id: String(req.body?.app_id ?? '').trim(), app_secret: String(req.body?.app_secret ?? '').trim(), config_id: String(req.body?.config_id ?? '').trim() || null };
  if (!/^\d{5,25}$/.test(app.app_id) || app.app_secret.length < 16) return res.status(400).json({ error: 'Revisa el "ID de la app" (solo números) y la "Clave secreta de la app".' });
  try {
    // Prueba que el ID y el secreto van juntos.
    await graph('GET', `/${app.app_id}`, { fields: 'id,name' }, `${app.app_id}|${app.app_secret}`);
  } catch (err) {
    return res.status(400).json({ error: `Meta no reconoce esa app: ${(err as Error).message}` });
  }
  const ahora = new Date().toISOString();
  const { error } = await db.from('siguelo_meta_app').upsert({ empresa_id: empresaId, ...app, actualizado_en: ahora }, { onConflict: 'empresa_id' });
  if (error) return res.status(500).json({ error: `${error.message}. ¿Pegaste la última versión de database/siguelo.sql?` });
  await db.from('siguelo_meta_info').upsert({ empresa_id: empresaId, app_id: app.app_id, config_id: app.config_id ?? null, error: null, actualizado_en: ahora }, { onConflict: 'empresa_id' });
  res.json({ ok: true });
});

redesRouter.post('/siguelo/meta/iniciar', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const app = await appDe(empresaId);
  if (!app) return res.status(400).json({ error: 'Primero guarda el ID y la clave secreta de tu App de Meta.' });
  if (!baseValida(req.body?.base)) return res.status(400).json({ error: 'La dirección del CRM no es válida.' });
  for (const [k, v] of pendientes) if (v.vence < Date.now()) pendientes.delete(k);
  const estado = randomBytes(18).toString('hex');
  const volver = urlVolver(String(req.body.base).trim());
  pendientes.set(estado, { empresaId, volver, vence: Date.now() + 15 * MIN });
  res.json({ ok: true, url: urlLogin(app, volver, estado) });
});

// Guarda las páginas e Instagram de un token de usuario (de "Conectar con Facebook" o pegado a mano).
async function guardarCuentas(empresaId: string, app: AppMeta, tokenUsuario: string): Promise<{ paginas: number; instagram: number }> {
  const largo = await tokenLargo(app, tokenUsuario);
  const cuentas = await cuentasDe(app, largo);
  const ahora = new Date().toISOString();
  for (const k of cuentas) {
    const { data: fila } = await db
      .from('siguelo_redes_cuentas')
      .upsert({ empresa_id: empresaId, red: k.red, externo_id: k.externo_id, nombre: k.nombre, usuario: k.usuario, error: null, actualizado_en: ahora }, { onConflict: 'empresa_id,red,externo_id' })
      .select('id')
      .single();
    if (fila) await db.from('siguelo_redes_tokens').upsert({ cuenta_id: fila.id, token: k.token, actualizado_en: ahora }, { onConflict: 'cuenta_id' });
  }
  return { paginas: cuentas.filter((k) => k.red === 'facebook').length, instagram: cuentas.filter((k) => k.red === 'instagram').length };
}

const pagina = (res: Response, titulo: string, texto: string) =>
  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;text-align:center;color:#0f172a"><h2>${titulo}</h2><p>${texto}</p><p>Ya puedes cerrar esta pestaña y volver al CRM.</p></body></html>`,
    );

// Facebook vuelve acá después de que aceptas los permisos (no lleva sesión del CRM: se valida con "state").
redesRouter.get('/siguelo/meta/volver', async (req, res) => {
  const estado = String(req.query.state ?? '');
  const p = pendientes.get(estado);
  pendientes.delete(estado);
  if (!p || p.vence < Date.now()) return pagina(res, 'No se pudo conectar', 'El pedido venció o no es válido. Vuelve a pulsar "Conectar con Facebook" en el CRM.');
  if (req.query.error) return pagina(res, 'No se conectó', 'Cancelaste o Facebook no dio el permiso. Puedes intentarlo de nuevo desde el CRM.');
  const app = await appDe(p.empresaId);
  if (!app) return pagina(res, 'No se pudo conectar', 'Falta la App de Meta en el CRM.');
  try {
    const token = await tokenDeCodigo(app, String(req.query.code ?? ''), p.volver);
    const n = await guardarCuentas(p.empresaId, app, token);
    if (!n.paginas) return pagina(res, 'Conectado, pero sin páginas', 'Facebook no mostró ninguna página. Al conectar, marca las páginas (y sus cuentas de Instagram) que quieres que la IA atienda.');
    return pagina(res, '✅ Conectado', `Se conectaron ${n.paginas} ${n.paginas === 1 ? 'página' : 'páginas'} de Facebook y ${n.instagram} ${n.instagram === 1 ? 'cuenta' : 'cuentas'} de Instagram. En el CRM, activa cada una y elige su negocio.`);
  } catch (err) {
    await db.from('siguelo_meta_info').update({ error: (err as Error).message }).eq('empresa_id', p.empresaId);
    return pagina(res, 'No se pudo conectar', String((err as Error).message).replace(/[<>]/g, ''));
  }
});

// Política de privacidad pública: Meta pide su dirección para poner la app en modo "Activo".
redesRouter.get('/siguelo/privacidad', async (_req, res) => {
  const { data } = await supabase.from('empresas').select('nombre').limit(1).maybeSingle();
  const nombre = String(data?.nombre || 'Este negocio').replace(/[<>&"]/g, '');
  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Política de privacidad · ${nombre}</title></head><body style="font-family:system-ui,sans-serif;max-width:680px;margin:6vh auto;padding:0 20px;line-height:1.6;color:#0f172a">` +
        `<h1>Política de privacidad</h1><p><b>${nombre}</b> usa esta aplicación para atender a sus clientes en WhatsApp y para responder y moderar los comentarios de sus propias páginas de Facebook y cuentas de Instagram.</p>` +
        `<h2>Qué datos usamos</h2><p>El nombre o usuario público y el texto de los comentarios que se escriben en nuestras publicaciones, y los mensajes que nos envían por WhatsApp. Solo los usamos para responder consultas sobre nuestros productos y servicios y para ocultar o borrar comentarios ofensivos o spam.</p>` +
        `<h2>Con quién los compartimos</h2><p>No vendemos ni compartimos estos datos con terceros. Para redactar las respuestas usamos un servicio de inteligencia artificial que procesa el texto del comentario.</p>` +
        `<h2>Cuánto tiempo los guardamos</h2><p>Mientras sean necesarios para atenderte. Puedes pedir que borremos tus datos en cualquier momento.</p>` +
        `<h2 id="borrar">Cómo pedir que borremos tus datos</h2><p>Escríbenos por WhatsApp o por mensaje privado a nuestra página pidiendo que borremos tus datos, y los eliminamos en un plazo de 30 días.</p>` +
        `</body></html>`,
    );
});

// Plan B: un token de usuario copiado del "Explorador de la API Graph".
redesRouter.post('/siguelo/meta/token', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const app = await appDe(empresaId);
  if (!app) return res.status(400).json({ error: 'Primero guarda el ID y la clave secreta de tu App de Meta.' });
  const token = String(req.body?.token ?? '').trim();
  if (token.length < 30) return res.status(400).json({ error: 'Pega el token completo.' });
  try {
    const n = await guardarCuentas(empresaId, app, token);
    res.json({ ok: true, ...n });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Responder desde el CRM lo que la IA te preguntó (igual que "R12 …" por WhatsApp).
redesRouter.post('/siguelo/redes/responder', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const texto = String(req.body?.texto ?? '').trim();
  if (!texto) return res.status(400).json({ error: 'Escribe tu respuesta.' });
  const [c, app] = await Promise.all([configDeEmpresa(empresaId), appDe(empresaId)]);
  if (!c || !app) return res.status(400).json({ error: 'Falta la clave de OpenAI o la App de Meta.' });
  const r = await responderComoDueno(c, app, String(req.body?.comentario_id ?? ''), texto);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, texto: r.texto });
});
