import { supabase } from './supabaseClient';

const backendUrl = import.meta.env.VITE_BACKEND_URL;

// Cabeceras con el token de la sesión actual, para los fetch al backend que
// no usan llamarBackend (enviar, etiquetas, bot, conexiones): el servidor
// revisa quién llama y si tiene acceso a ese número (SígueloCRM).
export async function conSesion(cabeceras: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return { ...cabeceras, ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) };
}

// Llama a un endpoint del backend mandando el token de la sesión actual en
// el header Authorization, para que el backend pueda validar quién llama
// (ver server/src/middleware/autenticacion.ts).
export async function llamarBackend(
  path: string,
  body: unknown,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<{ data: any; ok: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${backendUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  const data = await resp.json();
  return { data, ok: resp.ok, error: data.error };
}
