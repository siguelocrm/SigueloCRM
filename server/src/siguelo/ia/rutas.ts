import { Router } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { db } from '../db.js';
import { listarModelos } from './openai.js';
import { configDeEmpresa, olvidarCache } from './config.js';
import { probarMensaje } from './lector.js';
import { aplicarAcciones, conversar } from './asistente.js';
import type { IaRow } from '../tipos.js';

// Lo de la IA que pasa por el servidor: la clave de OpenAI (la página la manda
// una vez y nunca la vuelve a leer), probar la conexión y probar un mensaje.

export const iaRouter = Router();
const soloAdmin = requiereRol('supervisor', 'dueno');

async function claveDe(empresaId: string): Promise<string | null> {
  const { data } = await db.from('siguelo_ia_clave').select('clave').eq('empresa_id', empresaId).maybeSingle();
  return data?.clave?.trim() || null;
}

// Guarda la clave después de comprobar que funciona; devuelve los modelos que puede usar.
iaRouter.post('/siguelo/ia/clave', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const clave = String(req.body?.clave ?? '').trim();
  if (!clave) return res.status(400).json({ error: 'Pega la clave de OpenAI.' });
  const r = await listarModelos(clave);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  const { error } = await db.from('siguelo_ia_clave').upsert({ empresa_id: empresaId, clave, actualizado_en: new Date().toISOString() }, { onConflict: 'empresa_id' });
  if (error) return res.status(500).json({ error: `No se pudo guardar: ${error.message}. ¿Pegaste la Fase 3 de database/siguelo.sql?` });
  const { data: ia } = await db.from('siguelo_ia').select('empresa_id').eq('empresa_id', empresaId).maybeSingle();
  if (ia) await db.from('siguelo_ia').update({ clave_final: clave.slice(-4) }).eq('empresa_id', empresaId);
  else await db.from('siguelo_ia').insert({ empresa_id: empresaId, clave_final: clave.slice(-4) });
  olvidarCache();
  res.json({ ok: true, modelos: r.modelos });
});

iaRouter.delete('/siguelo/ia/clave', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  await db.from('siguelo_ia_clave').delete().eq('empresa_id', empresaId);
  await db.from('siguelo_ia').update({ clave_final: null }).eq('empresa_id', empresaId);
  olvidarCache();
  res.json({ ok: true });
});

// Prueba la clave guardada y lista los modelos.
iaRouter.post('/siguelo/ia/modelos', soloAdmin, async (req, res) => {
  const clave = await claveDe(req.usuarioAutenticado!.empresa_id);
  if (!clave) return res.status(400).json({ error: 'Todavía no guardaste la clave de OpenAI.' });
  const r = await listarModelos(clave);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, modelos: r.modelos });
});

// Qué haría la IA con un mensaje de un cliente inventado, sin tocar a nadie.
iaRouter.post('/siguelo/ia/probar', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const texto = String(req.body?.texto ?? '').trim();
  const negocioId = String(req.body?.negocio_id ?? '');
  if (!texto) return res.status(400).json({ error: 'Escribe el mensaje del cliente.' });
  const [clave, { data: ia }, { data: ajustes }] = await Promise.all([
    claveDe(empresaId),
    db.from('siguelo_ia').select('*').eq('empresa_id', empresaId).maybeSingle(),
    db.from('siguelo_ajustes').select('zona_horaria').eq('empresa_id', empresaId).maybeSingle(),
  ]);
  if (!clave || !ia) return res.status(400).json({ error: 'Primero guarda la clave de OpenAI.' });
  const r = await probarMensaje({ ia: ia as IaRow, clave, zona: ajustes?.zona_horaria || 'America/La_Paz' }, negocioId, texto);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, resultado: r.resultado });
});

// El asistente: responde y propone cambios (que se hacen recién con "Aplicar").
iaRouter.post('/siguelo/ia/asistente', soloAdmin, async (req, res) => {
  const u = req.usuarioAutenticado!;
  const texto = String(req.body?.texto ?? '').trim().slice(0, 4000);
  if (!texto) return res.status(400).json({ error: 'Escribe tu pregunta o lo que quieres cambiar.' });
  const c = await configDeEmpresa(u.empresa_id);
  if (!c) return res.status(400).json({ error: 'Primero guarda tu clave de OpenAI en IA → Ajustes.' });
  const r = await conversar(c, u.id, texto);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, mensaje: r.mensaje });
});

iaRouter.post('/siguelo/ia/asistente/aplicar', soloAdmin, async (req, res) => {
  const r = await aplicarAcciones(req.usuarioAutenticado!.empresa_id, String(req.body?.id ?? ''));
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, resultado: r.resultado });
});
