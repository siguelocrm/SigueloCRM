// Prueba de los candados (server/src/siguelo/candados.ts): la IA lee un chat por número a la vez,
// pero los números distintos leen al mismo tiempo (antes, uno solo para todo el CRM).
import assert from 'node:assert/strict';

const { candadosPorClave, conCandadoEsperando } = await import(new URL('../server/src/siguelo/candados.ts', import.meta.url).href);
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lectorDe = candadosPorClave('la lectura de prueba');
const tarea = (log: string[], nombre: string, ms: number) => async () => { log.push(`${nombre}+`); await dormir(ms); log.push(`${nombre}-`); };

// 1. Dos números distintos leen a la vez.
{
  const log: string[] = [];
  const t0 = Date.now();
  await Promise.all([lectorDe('online')(tarea(log, 'online', 200)), lectorDe('elalto')(tarea(log, 'elalto', 200))]);
  assert.ok(Date.now() - t0 < 350, 'en paralelo, no uno detrás del otro');
  assert.deepEqual(log.slice(0, 2).sort(), ['elalto+', 'online+']);
  paso('dos números distintos leen al mismo tiempo');
}

// 2. El mismo número: el segundo no corre mientras el primero sigue (no responde dos veces).
{
  const log: string[] = [];
  const primero = lectorDe('online')(tarea(log, 'a', 150));
  await dormir(10);
  await lectorDe('online')(tarea(log, 'b', 10)); // ocupado: no corre
  await primero;
  assert.deepEqual(log, ['a+', 'a-']);
  paso('el mismo número no lee dos cosas a la vez');
}

// 3. Esperar su turno (el botón "Responder con IA"): espera a que termine y corre.
{
  const log: string[] = [];
  const primero = lectorDe('quilla')(tarea(log, 'a', 300));
  await dormir(10);
  const corrio = await conCandadoEsperando(lectorDe('quilla'), tarea(log, 'boton', 10), 40);
  await primero;
  assert.equal(corrio, true);
  assert.deepEqual(log, ['a+', 'a-', 'boton+', 'boton-']);
  // Si el número sigue ocupado más de lo que se espera, avisa que no corrió.
  const largo = lectorDe('cercado')(tarea([], 'largo', 800));
  await dormir(10);
  assert.equal(await conCandadoEsperando(lectorDe('cercado'), async () => {}, 2), false);
  await largo;
  paso('"Responder con IA" espera su turno en ese número (y avisa si no alcanzó)');
}

console.log(`\n${ok} pruebas de candados: todas bien.`);
