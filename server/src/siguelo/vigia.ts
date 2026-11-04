import fs from 'node:fs';
import path from 'node:path';
import { supabase } from '../supabase/client.js';
import { iniciarConexion } from '../whatsapp/conexion.js';
import { carpetaAuth, obtenerSesion } from '../whatsapp/sesiones.js';

// Vigía de las conexiones de WhatsApp (SígueloCRM). Si un número se cae (sin
// internet un rato, WhatsApp reiniciando sus servidores...) el CRM reintenta 5
// veces y, si no puede, lo deja desconectado: desde ese momento no entran ni
// salen mensajes hasta que alguien lo reconecte a mano. Esto lo reintenta solo
// cada pocos minutos, pero SOLO en los números que siguen vinculados (tienen su
// sesión guardada con la cuenta): los que desconectaste a mano o los que nunca
// escanearon el QR no se tocan (no se generan QR solos).

const CADA_MS = 2 * 60_000;
const ENTRE_LINEAS_MS = 20_000;

// ¿La sesión guardada en disco ya está vinculada a una cuenta de WhatsApp?
export function estaVinculada(lineaId: string): boolean {
  // creds.json.bak es el respaldo que guarda auth-state.ts si creds.json se rompe.
  for (const archivo of ['creds.json', 'creds.json.bak']) {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(carpetaAuth(lineaId), archivo), 'utf-8'));
      if (creds?.me?.id) return true;
    } catch {
      // sigue con el respaldo
    }
  }
  return false;
}

let enUso = false;
async function vuelta(): Promise<void> {
  if (enUso) return;
  enUso = true;
  try {
    const { data: lineas, error } = await supabase.from('lineas_whatsapp').select('id, nombre');
    if (error) return;
    for (const l of lineas ?? []) {
      if (obtenerSesion(l.id) || !estaVinculada(l.id)) continue;
      console.log(`🔌 [${l.id}] "${l.nombre}" estaba caído: lo reconecto solo.`);
      await iniciarConexion(l.id).catch((err) => console.error(`[${l.id}] No se pudo reconectar:`, (err as Error).message));
      await new Promise((r) => setTimeout(r, ENTRE_LINEAS_MS));
    }
  } finally {
    enUso = false;
  }
}

// Empieza después del arranque (que ya reconecta todo, escalonado).
export function iniciarVigia(): void {
  setTimeout(() => {
    void vuelta();
    setInterval(() => void vuelta(), CADA_MS);
  }, 5 * 60_000);
}
