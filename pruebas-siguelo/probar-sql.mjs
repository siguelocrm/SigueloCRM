// Prueba database/siguelo.sql sobre instalar.sql en un Postgres en memoria (PGlite).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const RAIZ = fileURLToPath(new URL('../database/', import.meta.url));
const db = new PGlite();

// Lo mínimo de Supabase que usa instalar.sql.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (bucket_id text, name text);
  create publication supabase_realtime;
`);

const instalar = fs.readFileSync(RAIZ + 'instalar.sql', 'utf8').replace(/create extension if not exists pgcrypto;/, '');
await db.exec(instalar);
const siguelo = fs.readFileSync(RAIZ + 'siguelo.sql', 'utf8');
await db.exec(siguelo);
await db.exec(siguelo); // es seguro repetirlo
console.log('✓ instalar.sql + siguelo.sql (dos veces) sin errores');

const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Prueba') returning id`)).id;
const etapas = (await db.query(`select id, nombre, tipo from etapas_venta where empresa_id = $1 order by orden`, [empresa])).rows;
const [primer, negociacion] = etapas;
const linea = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'L1', '591') returning id`, [empresa])).id;

// Ana: en Primer Contacto, con chat. Beto: en Negociación (sin mensajes configurados). Caro: sin chat.
const ana = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, '59170000001', 'Ana') returning id`, [empresa])).id;
await uno(`insert into contactos (empresa_id, telefono, nombre, etapa_id) values ($1, '59170000002', 'Beto', $2) returning id`, [empresa, negociacion.id]);
await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, '59170000003', 'Caro') returning id`, [empresa]);

// Dos chats de Ana: uno cerrado viejo y uno abierto.
const viejo = (await uno(`insert into conversaciones (linea_id, contacto_telefono, estado, ultima_actividad) values ($1, '59170000001', 'cerrado', now() - interval '10 days') returning id`, [linea])).id;
const abierto = (await uno(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59170000001', 'abierto') returning id`, [linea])).id;
await uno(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59170000002', 'abierto') returning id`, [linea]);

const msg = async (conv, remitente, haceMin, wid = null) =>
  (await uno(`insert into mensajes (conversacion_id, remitente, contenido, creado_en, whatsapp_id) values ($1, $2, 'x', now() - ($3 || ' minutes')::interval, $4) returning id`, [conv, remitente, haceMin, wid])).id;
await msg(viejo, 'cliente', 60 * 24 * 10);
await msg(abierto, 'cliente', 120);
await msg(abierto, 'agente', 100);
const auto = await msg(abierto, 'agente', 30, 'WID-AUTO');
// Copia duplicada del mismo envío (por ejemplo, si Baileys lo guardó otra vez): mismo whatsapp_id.
await msg(abierto, 'agente', 29, 'WID-AUTO');

// Primer Contacto tiene mensajes; Negociación no.
await db.query(`insert into siguelo_etapas (etapa_id, empresa_id) values ($1, $2)`, [primer.id, empresa]);
await db.query(
  `insert into siguelo_cola (empresa_id, contacto_id, conversacion_id, linea_id, telefono, tipo, paso, token, nombre, vence, estado, mensaje_id, whatsapp_id)
   values ($1, $2, $3, $4, '59170000001', 'rec', 0, 't', 'Primer Contacto · Recordatorio 1', now(), 'enviado', $5, 'WID-AUTO')`,
  [empresa, ana, abierto, linea, auto],
);

const act = (await db.query(`select * from siguelo_actividad($1)`, [empresa])).rows;
assert.equal(act.length, 1, 'solo Ana: Beto no está en una etapa con mensajes y Caro no tiene chat');
const a = act[0];
assert.equal(a.contacto_id, ana);
assert.equal(a.conversacion_id, abierto, 'elige el chat abierto');
assert.equal(a.etapa_id, primer.id);
const minutos = (d) => Math.round((Date.now() - new Date(d).getTime()) / 60000);
assert.equal(minutos(a.primer_mensaje), 60 * 24 * 10, 'el primer mensaje cuenta también los chats viejos');
assert.equal(minutos(a.ultimo_cliente), 120);
assert.equal(minutos(a.ultimo_saliente), 29, 'último nuestro, contando los automáticos');
assert.equal(minutos(a.ultimo_manual), 100, 'último escrito a mano: no cuenta lo que mandó el seguimiento (ni su copia)');
console.log('✓ siguelo_actividad devuelve lo esperado');

// Una sola configuración general por etapa; una propia por negocio sí se puede.
await assert.rejects(db.query(`insert into siguelo_etapas (etapa_id, empresa_id) values ($1, $2)`, [primer.id, empresa]), /duplicate key/);
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre) values ($1, 'Prueba única') returning id`, [empresa])).id;
await db.query(`insert into siguelo_etapas (etapa_id, empresa_id, negocio_id) values ($1, $2, $3)`, [primer.id, empresa, negocio]);
await assert.rejects(db.query(`insert into siguelo_etapas (etapa_id, empresa_id, negocio_id) values ($1, $2, $3)`, [primer.id, empresa, negocio]), /duplicate key/);
assert.equal((await db.query(`select * from siguelo_actividad($1)`, [empresa])).rows.length, 1, 'la config de un negocio no duplica contactos');
console.log('✓ una configuración general por etapa y una por negocio');

// El tope diario se guarda por número.
await db.query(`insert into siguelo_contador (empresa_id, linea_id, fecha, enviados) values ($1, $2, '2026-10-25', 3)`, [empresa, linea]);
await assert.rejects(db.query(`insert into siguelo_contador (empresa_id, linea_id, fecha, enviados) values ($1, $2, '2026-10-25', 1)`, [empresa, linea]), /duplicate key/);
console.log('✓ contador por número y por día');

// Si nada está configurado, no devuelve a nadie.
await db.query(`delete from siguelo_etapas`);
assert.equal((await db.query(`select * from siguelo_actividad($1)`, [empresa])).rows.length, 0);
console.log('✓ sin etapas configuradas no revisa a nadie');

// Permisos: un vendedor (usuario de la empresa) ve la cola pero no puede cambiar ajustes; el dueño sí.
const dueno = '00000000-0000-0000-0000-000000000001';
const vendedor = '00000000-0000-0000-0000-000000000002';
await db.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Dueño', 'dueno'), ($3, $2, 'Vende', 'vendedor')`, [dueno, empresa, vendedor]);
await db.exec(`grant usage on schema public, auth to authenticated; grant all on all tables in schema public to authenticated; grant execute on all functions in schema auth to authenticated;`);
const como = async (uid, sql, p = []) => {
  await db.exec(`set role authenticated; select set_config('app.uid', '${uid}', false);`);
  try { return await db.query(sql, p); } finally { await db.exec('reset role'); }
};
assert.equal((await como(vendedor, `select id from siguelo_cola`)).rows.length, 1, 'el vendedor ve la cola');
await assert.rejects(como(vendedor, `insert into siguelo_ajustes (empresa_id) values ($1)`, [empresa]), /row-level security/, 'el vendedor no crea ajustes');
await como(dueno, `insert into siguelo_ajustes (empresa_id, activo) values ($1, true)`, [empresa]);
assert.equal((await como(vendedor, `select activo from siguelo_ajustes`)).rows[0].activo, true, 'el vendedor ve los ajustes');
await assert.rejects(como(vendedor, `select * from siguelo_actividad($1)`, [empresa]), /permission denied/, 'la página no puede llamar a siguelo_actividad');
const upd = await como(vendedor, `update siguelo_cola set estado = 'cancelado', a_mano = true where estado = 'enviado' returning id`);
assert.equal(upd.rows.length, 1, 'cualquiera de la empresa puede cancelar en la cola');
console.log('✓ permisos (RLS) como se esperaba');

// ---------- Fase 2: negocios por número ----------
// Embudo "Cursos" con dos etapas, el negocio "Academia" lo usa y tiene la línea 2.
const embudo = (await uno(`insert into siguelo_embudos (empresa_id, nombre) values ($1, 'Cursos') returning id`, [empresa])).id;
const maxOrden = (await uno(`select max(orden) m from etapas_venta where empresa_id = $1`, [empresa])).m;
const cursoInteresado = (await uno(`insert into etapas_venta (empresa_id, nombre, tipo, orden) values ($1, 'Interesado', 'normal', $2) returning id`, [empresa, maxOrden + 1])).id;
const cursoInscrito = (await uno(`insert into etapas_venta (empresa_id, nombre, tipo, orden) values ($1, 'Inscrito', 'ganada', $2) returning id`, [empresa, maxOrden + 2])).id;
await db.query(`insert into siguelo_etapa_embudo (etapa_id, embudo_id) values ($1, $3), ($2, $3)`, [cursoInteresado, cursoInscrito, embudo]);
const academia = (await uno(`insert into siguelo_negocios (empresa_id, nombre, embudo_id) values ($1, 'Academia', $2) returning id`, [empresa, embudo])).id;
const sucursal = (await uno(`insert into siguelo_negocios (empresa_id, nombre, sucursal) values ($1, 'Tienda', 'Quillacollo') returning id`, [empresa])).id;
const linea2 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'L2', '592') returning id`, [empresa])).id;
await db.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3), ($4, $2, $5)`, [linea2, empresa, academia, linea, sucursal]);

// Un cliente nuevo que escribe a la línea 2 entra a "Interesado" (embudo Cursos).
await db.query(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59171111111', 'abierto')`, [linea2]);
const enCursos = await uno(`insert into contactos (empresa_id, telefono) values ($1, '59171111111') returning etapa_id`, [empresa]);
assert.equal(enCursos.etapa_id, cursoInteresado, 'entra al embudo de su negocio');
// Uno que escribe a la línea 1 (negocio sin embudo propio) queda en el principal.
await db.query(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59172222222', 'abierto')`, [linea]);
const enPrincipal = await uno(`insert into contactos (empresa_id, telefono) values ($1, '59172222222') returning etapa_id`, [empresa]);
assert.equal(enPrincipal.etapa_id, primer.id, 'embudo principal');
// Si la ficha se crea con una etapa elegida a mano, se respeta.
await db.query(`insert into conversaciones (linea_id, contacto_telefono, estado) values ($1, '59173333333', 'abierto')`, [linea2]);
const aMano = await uno(`insert into contactos (empresa_id, telefono, etapa_id) values ($1, '59173333333', $2) returning etapa_id`, [empresa, negociacion.id]);
assert.equal(aMano.etapa_id, negociacion.id, 'etapa elegida a mano');
// Aunque una etapa de otro embudo quede primera por orden, un contacto sin negocio va al principal.
await db.query(`update etapas_venta set orden = -1 where id = $1`, [cursoInteresado]);
const sinNegocio = await uno(`insert into contactos (empresa_id, telefono) values ($1, '59174444444') returning etapa_id`, [empresa]);
assert.equal(sinNegocio.etapa_id, primer.id, 'sin chat ni negocio: embudo principal');
await db.query(`update etapas_venta set orden = $2 where id = $1`, [cursoInteresado, maxOrden + 1]);
console.log('✓ cada cliente nuevo entra al embudo de su negocio');

// Textos de seguimiento propios del negocio: se borran con él.
await db.query(`insert into siguelo_etapas (etapa_id, empresa_id, negocio_id) values ($1, $2, $3)`, [primer.id, empresa, sucursal]);
await db.query(`delete from siguelo_negocios where id = $1`, [sucursal]);
assert.equal((await uno(`select count(*)::int n from siguelo_etapas where negocio_id = $1`, [sucursal])).n, 0);
assert.equal((await uno(`select count(*)::int n from siguelo_lineas where linea_id = $1`, [linea])).n, 0, 'el número queda sin negocio');
console.log('✓ al borrar un negocio se van sus textos y sus números quedan libres');

// Permisos: el vendedor ve los negocios pero no los cambia.
assert.equal((await como(vendedor, `select id from siguelo_negocios`)).rows.length, (await uno(`select count(*)::int n from siguelo_negocios`)).n);
await assert.rejects(como(vendedor, `insert into siguelo_negocios (empresa_id, nombre) values ($1, 'X')`, [empresa]), /row-level security/);
await como(dueno, `insert into siguelo_negocios (empresa_id, nombre) values ($1, 'Nuevo')`, [empresa]);
const regla = (await uno(`insert into respuestas_automaticas (empresa_id, palabra_clave) values ($1, 'hola') returning id`, [empresa])).id;
await como(dueno, `insert into siguelo_bot_negocio (regla_id, negocio_id) values ($1, $2)`, [regla, academia]);
assert.equal((await como(vendedor, `select * from siguelo_bot_negocio`)).rows.length, 1);
await assert.rejects(como(vendedor, `delete from siguelo_bot_negocio returning *`).then((r) => { if (!r.rows.length) throw new Error('row-level security: nada borrado'); }), /row-level security/);
console.log('✓ permisos de la Fase 2');

await db.exec(siguelo); // repetir todo el archivo con datos cargados
console.log('✓ siguelo.sql se puede volver a pegar con datos cargados');

// ---------- Usuarios: jerarquía y acceso por número ----------
// (Solo hay una empresa: se arma de cero quién está debajo de quién.)
const club = empresa;
await db.query(`delete from siguelo_accesos`);
const [P, D, G, V] = ['10', '11', '12', '13'].map((n) => `00000000-0000-0000-0000-0000000000${n}`);
await db.query(`insert into usuarios (id, empresa_id, nombre, rol, creado_en) values ($1, $2, 'Dueño principal', 'supervisor', now() - interval '1 year')`, [P, club]);
await db.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $4, 'Dueño de negocio', 'dueno'), ($2, $4, 'Gerente', 'supervisor'), ($3, $4, 'Vendedor', 'vendedor')`, [D, G, V, club]);
await db.exec(siguelo); // al pegarlo, el primer usuario queda como dueño principal
assert.equal((await uno(`select rol from usuarios where id = $1`, [P])).rol, 'dueno', 'el dueño principal vuelve a ser dueño');
assert.equal((await uno(`select principal from siguelo_accesos where usuario_id = $1`, [P])).principal, true);
assert.equal((await uno(`select jefe_id from siguelo_accesos where usuario_id = $1`, [D])).jefe_id, P, 'los demás quedan debajo del dueño principal');
const [L1, L2] = [(await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'L-Quilla', '1') returning id`, [club])).id, (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'L-Cercado', '2') returning id`, [club])).id];
await db.query(`update siguelo_accesos set todas_lineas = false, lineas = $2 where usuario_id = $1`, [D, [L2]]);
await db.query(`update siguelo_accesos set jefe_id = $1, todas_lineas = false, lineas = $3 where usuario_id = $2`, [D, G, [L2]]);
await db.query(`update siguelo_accesos set jefe_id = $1, todas_lineas = false, lineas = $3 where usuario_id = $2`, [G, V, [L2]]);

// Nadie de abajo puede editar al dueño principal ni a su jefe.
let r = await como(D, `update usuarios set rol = 'vendedor' where id = $1 returning id`, [P]);
assert.equal(r.rows.length, 0, 'el dueño de negocio no puede tocar al dueño principal');
assert.equal((await uno(`select rol from usuarios where id = $1`, [P])).rol, 'dueno');
r = await como(G, `update usuarios set activo = false where id = $1 returning id`, [D]);
assert.equal(r.rows.length, 0, 'el gerente no puede tocar a su jefe');
r = await como(D, `update usuarios set nombre = 'Gerente 2' where id = $1 returning id`, [G]);
assert.equal(r.rows.length, 1, 'el dueño de negocio sí edita a su gerente');
await assert.rejects(como(G, `update usuarios set rol = 'dueno' where id = $1`, [V]), /row-level security/, 'nadie da un rol igual o más alto que el suyo');
await assert.rejects(como(G, `update usuarios set rol = 'supervisor' where id = $1`, [V]), /row-level security/);
r = await como(P, `update usuarios set nombre = 'Vende' where id = $1 returning id`, [V]);
assert.equal(r.rows.length, 1, 'el dueño principal edita a cualquiera de abajo');
await assert.rejects(como(G, `insert into usuarios (id, empresa_id, nombre, rol) values (gen_random_uuid(), $1, 'X', 'supervisor')`, [club]), /row-level security/);
console.log('✓ el dueño principal no se puede editar; cada uno solo administra a los de abajo y con roles más bajos');

// Cada uno ve solo los chats, mensajes y contactos de sus números.
const cv1 = (await uno(`insert into conversaciones (linea_id, contacto_telefono) values ($1, '59181111111') returning id`, [L1])).id;
const cv2 = (await uno(`insert into conversaciones (linea_id, contacto_telefono) values ($1, '59182222222') returning id`, [L2])).id;
await db.query(`insert into mensajes (conversacion_id, remitente, contenido) values ($1, 'cliente', 'hola 1'), ($2, 'cliente', 'hola 2')`, [cv1, cv2]);
await db.query(`insert into contactos (empresa_id, telefono) values ($1, '59181111111'), ($1, '59182222222'), ($1, '59183333333')`, [club]);
const ver = async (uid) => ({
  conv: (await como(uid, `select id from conversaciones where id in ($1, $2) order by id`, [cv1, cv2])).rows.map((x) => x.id).sort(),
  msj: (await como(uid, `select contenido from mensajes where conversacion_id in ($1, $2) order by contenido`, [cv1, cv2])).rows.map((x) => x.contenido),
  tel: (await como(uid, `select telefono from contactos where telefono in ('59181111111', '59182222222', '59183333333') order by telefono`)).rows.map((x) => x.telefono),
  lineas: (await como(uid, `select nombre from lineas_whatsapp where nombre like 'L-%' order by nombre`)).rows.map((x) => x.nombre),
});
assert.deepEqual(await ver(P), { conv: [cv1, cv2].sort(), msj: ['hola 1', 'hola 2'], tel: ['59181111111', '59182222222', '59183333333'], lineas: ['L-Cercado', 'L-Quilla'] });
assert.deepEqual(await ver(V), { conv: [cv2], msj: ['hola 2'], tel: ['59182222222', '59183333333'], lineas: ['L-Cercado'] }, 'el vendedor solo ve su número (y los contactos sin chat)');
assert.deepEqual((await ver(D)).msj, ['hola 2'], 'el dueño de negocio con un solo número tampoco ve los otros');
await assert.rejects(como(V, `insert into mensajes (conversacion_id, remitente, contenido) values ($1, 'agente', 'x')`, [cv1]), /row-level security/, 'no escribe en un chat de otro número');
await db.query(`update siguelo_accesos set lineas = '{}' where usuario_id = $1`, [V]);
assert.deepEqual((await ver(V)).conv, [], 'sin números asignados no ve ningún chat');
await db.query(`update siguelo_accesos set lineas = $2 where usuario_id = $1`, [V, [L2]]);
await db.query(`update usuarios set activo = false where id = $1`, [V]);
assert.deepEqual((await ver(V)).conv, [], 'un usuario inactivo no ve nada');
await assert.rejects(como(D, `delete from lineas_whatsapp where id = $1 returning id`, [L1]).then((x) => { if (!x.rows.length) throw new Error('row-level security: nada borrado'); }), /row-level security/, 'no borra un número que no tiene');
console.log('✓ cada uno ve solo los chats, mensajes y contactos de sus números');

// Acceso con vencimiento: vencido = no ve nada ni administra a nadie (solo lee su propia fila).
await db.query(`update usuarios set activo = true where id = $1`, [V]);
await db.query(`update siguelo_accesos set vence_en = now() - interval '1 minute' where usuario_id = $1`, [G]);
assert.deepEqual((await ver(G)).conv, [], 'vencido: ningún chat');
assert.equal((await como(G, `update usuarios set nombre = 'X' where id = $1 returning id`, [V])).rows.length, 0, 'vencido: no administra');
assert.deepEqual((await como(G, `select id from usuarios`)).rows.map((x) => x.id), [G], 'vencido: solo ve su propia fila (para el aviso)');
await db.query(`update siguelo_accesos set vence_en = now() + interval '1 month' where usuario_id = $1`, [G]);
assert.deepEqual((await ver(G)).conv, [cv2], 'renovado: vuelve a ver sus chats');
await db.query(`update siguelo_accesos set vence_en = now() - interval '1 day' where usuario_id = $1`, [P]);
assert.equal((await ver(P)).conv.length, 2, 'al dueño principal no le vence nunca');
await db.query(`update siguelo_accesos set vence_en = null where usuario_id = $1`, [P]);
console.log('✓ un acceso vencido o desactivado no ve nada; al renovarlo vuelve; al dueño principal no le vence');
console.log('\nTodo OK');
