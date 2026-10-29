import type { NextFunction, Request, Response } from 'express';
import { requiereRol } from '../../middleware/autenticacion.js';
import { accesoDe, veLinea, type Rol } from './accesos.js';

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
    if (!a || !veLinea(a, lineaId)) return res.status(403).json({ error: 'No tienes acceso a ese número.' });
    next();
  };
  return [sesion, numero];
}
