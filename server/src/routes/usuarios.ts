import { Router } from 'express';
import { supabase } from '../supabase/client.js';
import { requiereRol } from '../middleware/autenticacion.js';
import { accesoDe, esSubordinado } from '../siguelo/usuarios/accesos.js';

export const usuariosRouter = Router();

// Cada persona elige su propia zona horaria (para las horas de los mensajes
// programados). Va por el backend y no directo a Supabase porque la política
// de `usuarios` solo deja editar filas a supervisores/dueños, y un vendedor
// tampoco debería poder tocar su propio rol — acá solo se escribe esta columna.
usuariosRouter.patch(
  '/usuarios/mi-zona-horaria',
  requiereRol('vendedor', 'atendedor_online', 'supervisor', 'dueno'),
  async (req, res) => {
    const { zona_horaria } = req.body;
    if (typeof zona_horaria !== 'string' || !zona_horaria.trim()) {
      return res.status(400).json({ error: 'Falta la zona horaria' });
    }
    try {
      new Intl.DateTimeFormat('es', { timeZone: zona_horaria });
    } catch {
      return res.status(400).json({ error: 'Esa zona horaria no es válida' });
    }

    const { error } = await supabase.from('usuarios').update({ zona_horaria }).eq('id', req.usuarioAutenticado!.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  },
);

// Un supervisor o dueño cambia la contraseña de alguien de su empresa. Se
// respeta la jerarquía: el supervisor solo puede con vendedores y atendedores;
// el dueño, además, con supervisores. La propia
// contraseña se cambia desde Configuración (pide la actual).
const ROLES_QUE_PUEDE_RESETEAR: Record<string, string[]> = {
  supervisor: ['vendedor', 'atendedor_online'],
  dueno: ['vendedor', 'atendedor_online', 'supervisor', 'dueno'],
};

usuariosRouter.patch('/usuarios/:id/password', requiereRol('supervisor', 'dueno'), async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const quien = req.usuarioAutenticado!;

  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña necesita al menos 6 caracteres' });
  }
  if (id === quien.id) {
    return res.status(400).json({ error: 'Tu propia contraseña se cambia desde Configuración' });
  }

  const { data: objetivo } = await supabase.from('usuarios').select('id, empresa_id, rol').eq('id', id).maybeSingle();
  if (!objetivo || objetivo.empresa_id !== quien.empresa_id) {
    return res.status(404).json({ error: 'No se encontró ese usuario en tu empresa' });
  }
  // SígueloCRM: solo a los que están debajo de uno (al dueño principal no lo toca nadie).
  const yo = await accesoDe(quien.id);
  if (!yo || !(await esSubordinado(yo, id)) || !ROLES_QUE_PUEDE_RESETEAR[quien.rol]?.includes(objetivo.rol)) {
    return res.status(403).json({ error: 'Solo puedes cambiar la contraseña de las personas que están debajo de ti' });
  }

  const { error } = await supabase.auth.admin.updateUserById(id, { password });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Crea un agente nuevo: la cuenta de login (Supabase Auth) y su fila en `usuarios`.
// SígueloCRM: la pantalla de Usuarios ahora usa /siguelo/usuarios (con jerarquía y números);
// esta ruta queda cerrada para que nadie cree a alguien con un rol igual o más alto que el suyo.
usuariosRouter.post('/usuarios', requiereRol('supervisor', 'dueno'), (_req, res) => {
  res.status(410).json({ error: 'Crea usuarios desde Administrar → Usuarios (ahora con jerarquía y números por persona).' });
});
