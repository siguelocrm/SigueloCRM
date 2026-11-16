import { Router, type Request, type Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { accesoDe } from '../usuarios/accesos.js';
import { actualizarCuenta, crearCuenta, datosAgencia, esAgencia, guardarPlan, registrarVenta } from './agencia.js';

// La pantalla Agencia: solo el dueño principal de una cuenta de agencia (las tuyas).
// Los clientes nunca llegan acá: sus cuentas no son de agencia.

export const agenciaRouter = Router();
const soloDueno = requiereRol('dueno');

async function agenciaDe(req: Request, res: Response): Promise<string | null> {
  const a = await accesoDe(req.usuarioAutenticado!.id);
  if (!a || !a.activo || !a.principal || !(await esAgencia(a.empresa_id))) {
    res.status(403).json({ error: 'Solo el dueño principal de tu agencia puede usar esta sección.' });
    return null;
  }
  return a.empresa_id;
}

agenciaRouter.get('/siguelo/agencia', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await datosAgencia(agencia);
  if (!r.ok) return res.status(500).json({ error: r.mensaje });
  res.json(r);
});

agenciaRouter.post('/siguelo/agencia/cuentas', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await crearCuenta(agencia, req.body ?? {});
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json(r);
});

agenciaRouter.patch('/siguelo/agencia/cuentas/:id', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await actualizarCuenta(agencia, req.params.id, req.body ?? {});
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json(r);
});

agenciaRouter.post('/siguelo/agencia/planes', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await guardarPlan(agencia, null, req.body ?? {});
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json(r);
});

agenciaRouter.patch('/siguelo/agencia/planes/:id', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await guardarPlan(agencia, req.params.id, req.body ?? {});
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json(r);
});

agenciaRouter.post('/siguelo/agencia/ventas', soloDueno, async (req, res) => {
  const agencia = await agenciaDe(req, res);
  if (!agencia) return;
  const r = await registrarVenta(agencia, req.usuarioAutenticado!.id, req.body ?? {});
  if (!r.ok) return res.status(400).json({ error: r.mensaje });
  res.json(r);
});
