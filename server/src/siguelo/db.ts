import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import type { SigueloDatabase } from './tipos.js';

// Mismo Supabase que el resto del servidor (clave secreta), pero con los tipos
// de las tablas siguelo_*, que no están en types/dominio.ts.
export const db = createClient<SigueloDatabase>(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false },
});
