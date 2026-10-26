import { db } from './db.js';

const DIAS_QUE_SE_GUARDAN = 30;
let ultimaLimpieza = 0;

// Deja anotado lo que hizo el seguimiento (se ve en la pantalla "Seguimiento").
export async function registrar(empresaId: string, contactoId: string | null, tipo: string, texto: string): Promise<void> {
  console.log(`🔁 Seguimiento [${tipo}] ${texto}`);
  const { error } = await db.from('siguelo_registro').insert({ empresa_id: empresaId, contacto_id: contactoId, tipo, texto });
  if (error) console.error('Seguimiento: no se pudo guardar el registro:', error.message);
}

// Una vez por hora borra lo anotado hace más de 30 días.
export async function limpiarRegistroViejo(): Promise<void> {
  if (Date.now() - ultimaLimpieza < 60 * 60 * 1000) return;
  ultimaLimpieza = Date.now();
  const limite = new Date(Date.now() - DIAS_QUE_SE_GUARDAN * 24 * 3600 * 1000).toISOString();
  await db.from('siguelo_registro').delete().lt('creado_en', limite);
}
