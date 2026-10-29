import type { NextFunction, Request, Response } from 'express';
import { supabase } from '../supabase/client.js';
import type { RolUsuario } from '../types/dominio.js';

export interface UsuarioAutenticado {
  id: string;
  empresa_id: string;
  rol: RolUsuario;
}

declare module 'express-serve-static-core' {
  interface Request {
    usuarioAutenticado?: UsuarioAutenticado;
  }
}

// Valida el JWT de Supabase que manda el frontend en el header Authorization
// y chequea que el rol del que llama esté entre los permitidos. Los
// endpoints que crean cuentas (usuarios, empresas) no pueden confiar solo
// en que el frontend esconda el botón — cualquiera podría llamarlos directo.
export function requiereRol(...rolesPermitidos: RolUsuario[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Falta autenticación' });
    }

    const { data: { user }, error: errorToken } = await supabase.auth.getUser(token);
    if (errorToken || !user) {
      return res.status(401).json({ error: 'Sesión inválida o vencida' });
    }

    const { data: perfil } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', user.id)
      .single();
    if (!perfil) {
      return res.status(403).json({ error: 'La cuenta no tiene un perfil de usuario' });
    }
    // SígueloCRM: un usuario desactivado (o con el acceso vencido) no puede usar el servidor.
    if ((perfil as { activo?: boolean }).activo === false) {
      return res.status(403).json({ error: 'Tu usuario está desactivado o tu acceso venció.' });
    }

    if (!rolesPermitidos.includes(perfil.rol)) {
      return res.status(403).json({ error: 'No tenés permiso para hacer esto' });
    }

    req.usuarioAutenticado = { id: perfil.id, empresa_id: perfil.empresa_id, rol: perfil.rol } as UsuarioAutenticado;
    next();
  };
}
