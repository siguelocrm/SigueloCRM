import path from 'node:path';
import type { WASocket } from '@whiskeysockets/baileys';
import { env } from '../config/env.js';
import { supabase } from '../supabase/client.js';
import type { EstadoLinea } from '../types/dominio.js';

export interface SesionLinea {
  sock: WASocket;
  estado: EstadoLinea;
  qrDataUrl: string | null;
  // Vincular con código (sin QR, desde el mismo celular): el código de 8 letras que se escribe en
  // WhatsApp → Dispositivos vinculados → Vincular con el número de teléfono.
  codigo?: string | null;
  errorCodigo?: string | null;
}

// Una sesión de WhatsApp por cada línea conectada, en memoria.
const sesiones = new Map<string, SesionLinea>();

export function carpetaAuth(lineaId: string): string {
  return path.join(env.authDir, `auth_info_${lineaId}`);
}

export function obtenerSesion(lineaId: string): SesionLinea | undefined {
  return sesiones.get(lineaId);
}

export function guardarSesion(lineaId: string, sesion: SesionLinea): void {
  sesiones.set(lineaId, sesion);
}

export function borrarSesion(lineaId: string): void {
  sesiones.delete(lineaId);
}

export async function actualizarEstadoLinea(
  lineaId: string,
  estado: EstadoLinea,
  numero?: string | null,
): Promise<void> {
  const cambios: { estado: EstadoLinea; numero?: string } = { estado };
  if (numero) cambios.numero = numero;
  await supabase.from('lineas_whatsapp').update(cambios).eq('id', lineaId);
}
