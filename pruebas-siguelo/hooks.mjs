// Cambia la base y el WhatsApp de server/src/siguelo por los de prueba.
import { registerHooks } from 'node:module';

const aqui = new URL('./', import.meta.url).href;
export const redirigidos = [];

registerHooks({
  resolve(especificador, contexto, siguiente) {
    if ((contexto.parentURL || '').includes('/server/src/siguelo/')) {
      if (especificador === './db.js' || especificador === '../db.js') {
        redirigidos.push('db');
        return { url: aqui + 'mock-db.mjs', shortCircuit: true };
      }
      if (especificador.endsWith('whatsapp/sesiones.js')) {
        redirigidos.push('sesiones');
        return { url: aqui + 'mock-sesiones.mjs', shortCircuit: true };
      }
    }
    return siguiente(especificador, contexto);
  },
});
