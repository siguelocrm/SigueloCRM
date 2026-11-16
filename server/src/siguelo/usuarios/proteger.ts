import type { NextFunction, Request, Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { accesoDe, veLinea, type Rol } from './accesos.js';
import { db } from '../db.js';

// De qué cuenta es cada número (no cambia nunca).
const empresaDeLinea = new Map<string, string>();
async function cuentaDelNumero(lineaId: string): Promise<string | null> {
  if (!empresaDeLinea.has(lineaId)) {
    const { data } = await db.from('lineas_whatsapp').select('empresa_id').eq('id', lineaId).maybeSingle();
    if (!data) return null;
    empresaDeLinea.set(lineaId, data.empresa_id);
  }
  return empresaDeLinea.get(lineaId)!;
}

// Para las rutas del curso que actúan sobre un número de WhatsApp (enviar,
// bot, etiquetas, conexiones): hay que haber iniciado sesión, tener uno de
// esos roles y tener acceso a ese número.
const TODOS: Rol[] = ['vendedor', 'atendedor_online', 'supervisor', 'dueno'];

export function conNumero(lineaDe: (req: Request) => unknown, ...roles: Rol[]) {
  const sesion = requiereRol(...(roles.length ? roles : TODOS));
  const numero = async (req: Request, res: Response, next: NextFunction) => {
    const lineaId = lineaDe(req);
    if (typeof lineaId !== 'string' || !lineaId) return next(); // la ruta responde "Falta linea_id"
    const a = await accesoDe(req.usuarioAutenticado!.id);
    // El número tiene que ser de tu misma cuenta (con varias cuentas, "todos los números" son solo los tuyos).
    if (!a || !veLinea(a, lineaId) || (await cuentaDelNumero(lineaId)) !== a.empresa_id) return res.status(403).json({ error: 'No tienes acceso a ese número.' });
    next();
  };
  return [sesion, numero];
}
