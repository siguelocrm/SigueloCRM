import { Router } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { db } from '../db.js';
import { ENLACE_AULA, conectarAula, olvidarAula } from './aula.js';

// Tu Aula virtual: prueba la conexión (la cuenta de profesor o director y los planes) y la guarda.
export const aulaRouter = Router();
const soloAdmin = requiereRol('supervisor', 'dueno');

aulaRouter.post('/siguelo/aula/conectar', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  const b = req.body ?? {};
  const enlace = String(b.enlace ?? '').trim().replace(/\/+$/, '') || ENLACE_AULA;
  const cfg = { url: String(b.url ?? '').trim(), clave_publica: String(b.clave_publica ?? '').trim(), usuario: String(b.usuario ?? '').trim(), contrasena: String(b.contrasena ?? ''), enlace };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.url)) return res.status(400).json({ error: 'La dirección tiene que ser como https://xxxx.supabase.co (la del Supabase de tu aula).' });
  if (!/^https:\/\//i.test(enlace)) return res.status(400).json({ error: 'La dirección del aula para tus alumnos tiene que empezar con https://' });
  if (!cfg.clave_publica || !cfg.usuario || !cfg.contrasena) return res.status(400).json({ error: 'Completa la clave pública, el usuario y la contraseña de la cuenta del aula.' });
  const r = await conectarAula(empresaId, cfg);
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json({ ok: true, planes: r.planes.length });
});

aulaRouter.delete('/siguelo/aula', soloAdmin, async (req, res) => {
  const empresaId = req.usuarioAutenticado!.empresa_id;
  await db.from('siguelo_aula').delete().eq('empresa_id', empresaId);
  await db.from('siguelo_aula_info').update({ conectado: false, error: null, actualizado_en: new Date().toISOString() }).eq('empresa_id', empresaId);
  olvidarAula();
  res.json({ ok: true });
});
