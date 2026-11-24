// Candados de las tareas del servidor (SígueloCRM).

// Un candado que se libera solo si la tarea se traba (por ejemplo, esperando a WhatsApp una
// respuesta que nunca llega): antes quedaba tomado para siempre y no salía nada más (masivos,
// seguimiento) hasta reiniciar el servidor. Si está ocupado, la tarea no corre (devuelve sin hacer nada).
export const TRABADO_MS = 10 * 60_000;
export function candadoConVigia(nombre: string, trabadoMs = TRABADO_MS): (tarea: () => Promise<void>) => Promise<void> {
  let desde: number | null = null;
  return async (tarea) => {
    if (desde !== null && Date.now() - desde < trabadoMs) return;
    if (desde !== null) console.error(`⚠️ ${nombre} estuvo trabado más de ${trabadoMs / 60_000} minutos: se libera y sigue.`);
    const yo = Date.now();
    desde = yo;
    try {
      await tarea();
    } catch (err) {
      console.error(`Error en ${nombre}:`, (err as Error).message);
    } finally {
      if (desde === yo) desde = null;
    }
  };
}

// Un candado por clave (por ejemplo, uno por número de WhatsApp): dos tareas del mismo número no
// corren a la vez, pero las de números distintos sí. Así la IA lee un chat de Online mientras lee
// otro de El Alto, en vez de hacer fila todos juntos.
export function candadosPorClave(nombre: string): (clave: string) => (tarea: () => Promise<void>) => Promise<void> {
  const candados = new Map<string, (tarea: () => Promise<void>) => Promise<void>>();
  return (clave) => {
    let c = candados.get(clave);
    if (!c) {
      c = candadoConVigia(`${nombre} (${clave.slice(0, 8)})`);
      candados.set(clave, c);
    }
    return c;
  };
}

// Espera su turno: si el candado está ocupado, reintenta cada 250 ms (hasta `intentos` veces).
// Devuelve si la tarea llegó a correr.
export async function conCandadoEsperando(conCandado: (t: () => Promise<void>) => Promise<void>, tarea: () => Promise<void>, intentos = 40): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    let corrio = false;
    await conCandado(async () => {
      corrio = true;
      await tarea();
    });
    if (corrio) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
