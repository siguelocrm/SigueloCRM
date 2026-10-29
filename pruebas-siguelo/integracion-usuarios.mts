// Prueba de las reglas de usuarios del servidor (server/src/siguelo/usuarios):
// quién está debajo de quién, qué números ve cada uno y cuáles puede dar.
import assert from 'node:assert/strict';
import { pg, prepararBase } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const A = await import(R + 'usuarios/accesos.ts');
assert.ok(redirigidos.includes('db'));

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Club') returning id`)).id;
const linea = async (n: string) => (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, $2, '591') returning id`, [empresa, n])).id;
const [Q, C, E] = [await linea('Quillacollo'), await linea('Cercado'), await linea('El Alto')];
const [P, D, G, V, V2] = ['01', '02', '03', '04', '05'].map((n) => `00000000-0000-0000-0000-0000000000${n}`);
await pg.query(
  `insert into usuarios (id, empresa_id, nombre, rol, creado_en) values ($1, $6, 'Dueño principal', 'dueno', now() - interval '1 day'), ($2, $6, 'Dueña Cercado', 'dueno', now()), ($3, $6, 'Gerente', 'supervisor', now()), ($4, $6, 'Vendedor', 'vendedor', now()), ($5, $6, 'Otro vendedor', 'vendedor', now())`,
  [P, D, G, V, V2, empresa],
);
await pg.query(`insert into siguelo_accesos (usuario_id, empresa_id, principal, todas_lineas) values ($1, $2, true, true)`, [P, empresa]);
await pg.query(`insert into siguelo_accesos (usuario_id, empresa_id, jefe_id, todas_lineas, lineas) values ($1, $4, $5, false, $6), ($2, $4, $1, false, $6), ($3, $4, $2, false, $6)`, [D, G, V, empresa, P, [C]]);
await pg.query(`insert into siguelo_accesos (usuario_id, empresa_id, jefe_id, todas_lineas, lineas) values ($1, $2, $3, false, $4)`, [V2, empresa, P, [Q]]);
const a = async (id: string) => (await A.accesoDe(id))!;

const [p, d, g, v] = [await a(P), await a(D), await a(G), await a(V)];
assert.deepEqual([A.nivel(p), A.nivel(d), A.nivel(g), A.nivel(v)], [4, 3, 2, 1]);
paso('niveles: dueño principal 4, dueño de negocio 3, gerente 2, vendedor 1');

assert.equal(await A.esSubordinado(p, D), true);
assert.equal(await A.esSubordinado(p, V2), true);
assert.equal(await A.esSubordinado(d, V), true, 'el vendedor del gerente también está debajo de la dueña');
assert.equal(await A.esSubordinado(d, V2), false, 'el vendedor de otro no');
assert.equal(await A.esSubordinado(g, D), false, 'nadie administra a su jefe');
assert.equal(await A.esSubordinado(d, P), false, 'nadie administra al dueño principal');
assert.equal(await A.esSubordinado(p, P), false, 'ni él mismo');
assert.equal(await A.esSubordinado(d, D), false);
paso('cada uno administra solo a los que están debajo (en cualquier nivel), nunca al dueño principal');

assert.equal(A.veLinea(p, Q), true);
assert.equal(A.veLinea(d, C), true);
assert.equal(A.veLinea(d, Q), false);
assert.equal(A.veLinea(v, C), true);
await pg.query(`update usuarios set activo = false where id = $1`, [V]);
assert.equal(A.veLinea(await a(V), C), false, 'inactivo: ningún número');
paso('cada uno ve solo sus números (inactivo: ninguno)');

assert.equal(await A.lineasPermitidas(d, [C]), null);
assert.match(String(await A.lineasPermitidas(d, [C, E])), /Solo puedes dar acceso a los números que tú tienes/);
assert.equal(await A.lineasPermitidas(p, [Q, C, E]), null);
assert.match(String(await A.lineasPermitidas(p, ['00000000-0000-0000-0000-00000000dead'])), /no existe/);
paso('solo se dan números que uno tiene');

// Sin la sección 29 pegada (sin fila): como antes, el vendedor solo su línea y los demás todo.
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol, linea_id) values ('00000000-0000-0000-0000-000000000099', $1, 'Viejo', 'vendedor', $2)`, [empresa, E]);
const viejo = await a('00000000-0000-0000-0000-000000000099');
assert.equal(viejo.conFila, false);
assert.equal(A.veLinea(viejo, E), true);
assert.equal(A.veLinea(viejo, Q), false);
paso('un usuario sin fila de accesos sigue como antes (vendedor: solo su línea)');

// Acceso con vencimiento: vencido cuenta como desactivado y la revisión automática lo desactiva.
await pg.query(`update siguelo_accesos set vence_en = now() - interval '1 hour' where usuario_id = $1`, [G]);
assert.equal((await a(G)).activo, false);
assert.equal(A.veLinea(await a(G), C), false);
await pg.query(`update siguelo_accesos set vence_en = now() - interval '1 hour' where usuario_id = $1`, [P]);
assert.equal((await a(P)).activo, true, 'al dueño principal no le vence');
await A.desactivarVencidos();
assert.equal((await uno(`select activo from usuarios where id = $1`, [G])).activo, false, 'el vencido queda desactivado');
assert.equal((await uno(`select activo from usuarios where id = $1`, [P])).activo, true);
paso('un acceso vencido cuenta como desactivado y la revisión automática lo desactiva (al dueño principal nunca)');

console.log(`\n${ok} pasos OK`);
