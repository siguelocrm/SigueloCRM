// Prueba de la Agencia (server/src/siguelo/agencia): cuentas separadas, planes, ventas que
// crean o renuevan el acceso, pausa y que nada se mezcle entre cuentas.
import assert from 'node:assert/strict';
import { pg, prepararBase, usuariosAuth } from './mock-db.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const G = await import(R + 'agencia/agencia.ts');
const B = await import(R + 'agencia/bloqueo.ts');
const A = await import(R + 'usuarios/accesos.ts');
const { conNumero } = await import(R + 'usuarios/proteger.ts');
const { empresasConIA, olvidarCache } = await import(R + 'ia/config.ts');
assert.ok(redirigidos.includes('db'));

let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const DIA = 24 * 3600 * 1000;

await prepararBase();
// Tu cuenta de siempre (el club): la primera, es agencia, con su clave de OpenAI y su IA activa.
const club = (await uno(`insert into empresas (nombre) values ('Club') returning id`)).id;
await pg.query(`insert into siguelo_agencias (empresa_id) values ($1)`, [club]);
const yo = '00000000-0000-0000-0000-000000000001';
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Yo', 'dueno')`, [yo, club]);
await pg.query(`insert into siguelo_accesos (usuario_id, empresa_id, principal, todas_lineas) values ($1, $2, true, true)`, [yo, club]);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-mia-1234')`, [club]);
await pg.query(`insert into siguelo_ia (empresa_id, activa, clave_final) values ($1, true, '1234')`, [club]);
const lineaClub = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'Quillacollo', '591') returning id`, [club])).id;
const contactosClub = (await uno(`select count(*)::int n from contactos where empresa_id = $1`, [club])).n;

// ---------- 1. Tu agencia: una cuenta tuya, aparte ----------
const ag = await G.crearCuenta(club, { nombre: 'Agencia de Marketing', usuario: 'Agencia', password: 'secreta1', propia: true, usar_mi_clave: true });
assert.equal(ag.ok, true, (ag as any).mensaje);
const agencia = (ag as any).empresa_id as string;
assert.equal((ag as any).usuario, 'agencia');
const authAgencia = [...usuariosAuth.values()].find((u: any) => u.email === 'agencia@siguelocrm.app.mapse.club') as any;
assert.ok(authAgencia, 'el usuario sin @ se guarda como correo del CRM');
const dueAg = await A.accesoDe(authAgencia.id);
assert.equal(dueAg?.empresa_id, agencia);
assert.equal(dueAg?.principal, true, 'es el dueño principal de su cuenta');
assert.equal(await G.esAgencia(agencia), true, 'tu cuenta de agencia también puede crear cuentas y registrar ventas');
assert.equal((await uno(`select clave from siguelo_ia_clave where empresa_id = $1`, [agencia])).clave, 'sk-mia-1234', 'usa tu misma clave de OpenAI');
assert.equal((await uno(`select count(*)::int n from etapas_venta where empresa_id = $1`, [agencia])).n, 4, 'arranca con su propio embudo');
assert.equal((await uno(`select vence_en from siguelo_cuentas where empresa_id = $1`, [agencia])).vence_en, null, 'una cuenta tuya no vence');
paso('tu agencia es una cuenta aparte, con su usuario, su embudo y tu misma clave de OpenAI');

const repetida = await G.crearCuenta(club, { nombre: 'Otra', usuario: 'agencia', password: 'secreta1' });
assert.equal(repetida.ok, false);
assert.match((repetida as any).mensaje, /Ya existe alguien con el usuario "agencia"/);
assert.equal((await uno(`select count(*)::int n from empresas where nombre = 'Otra'`)).n, 0, 'no queda una cuenta a medias');
assert.equal((await G.crearCuenta(club, { nombre: 'X', usuario: 'ab', password: 'secreta1' })).ok, false, 'usuario muy corto');
assert.equal((await G.crearCuenta(club, { nombre: 'X', usuario: 'xyz', password: '123' })).ok, false, 'contraseña muy corta');
paso('no deja usuarios repetidos ni cuentas a medias');

// ---------- 2. Planes ----------
const pVideos = await G.guardarPlan(agencia, null, { nombre: 'Básico', precio: 500, duracion_dias: 30, incluye: ['4 videos', 'Edición de videos', ''], con_crm: false });
const pCrm = await G.guardarPlan(agencia, null, { nombre: 'CRM con IA', precio: 300, duracion_dias: 30, incluye: ['WhatsApp con IA', 'Seguimiento'], con_crm: true });
assert.ok(pVideos.ok && pCrm.ok);
const planVideos = (pVideos as any).id, planCrm = (pCrm as any).id;
assert.deepEqual((await uno(`select incluye from siguelo_planes where id = $1`, [planVideos])).incluye, ['4 videos', 'Edición de videos']);
assert.equal((await G.guardarPlan(agencia, null, { nombre: '' })).ok, false);
assert.equal((await G.guardarPlan(club, planCrm, { precio: 1 })).ok, false, 'un plan de otra cuenta no se toca');
paso('planes con lo que incluyen y si traen el CRM de WhatsApp');

// ---------- 3. Venta sin CRM (videos): solo se registra y el cliente queda en el CRM de tu agencia ----------
const v1 = await G.registrarVenta(agencia, authAgencia.id, { cliente: 'Panadería Rosa', telefono: '71234567', plan_id: planVideos });
assert.equal(v1.ok, true, (v1 as any).mensaje);
assert.equal((v1 as any).cuenta, null, 'sin acceso al CRM');
const rosa = await uno(`select c.id, e.tipo from contactos c join etapas_venta e on e.id = c.etapa_id where c.empresa_id = $1 and c.telefono = '59171234567'`, [agencia]);
assert.equal(rosa?.tipo, 'ganada', 'queda como contacto de tu agencia, en Venta ganada');
const opo = await uno(`select producto, monto, estado from oportunidades where contacto_id = $1`, [rosa.id]);
assert.deepEqual({ ...opo, monto: Number(opo.monto) }, { producto: 'Básico', monto: 500, estado: 'ganada' }, 'con la oportunidad ganada (cuenta en tus reportes)');
assert.match((await uno(`select texto from notas where contacto_id = $1`, [rosa.id])).texto, /Compró "Básico" por Bs 500/);
assert.equal((await uno(`select count(*)::int n from contactos where empresa_id = $1`, [club])).n, contactosClub, 'nada llega a tu cuenta del club');
paso('venta de videos: se registra, el cliente queda en tu agencia como venta ganada y no se crea acceso');

// ---------- 4. Venta con CRM: se crea su cuenta (separada) ----------
const v2 = await G.registrarVenta(agencia, authAgencia.id, { cliente: 'Dra. Paz', telefono: '59176543210', plan_id: planCrm, monto: 280, cuenta: { modo: 'nueva', nombre: 'Consultorio Paz', usuario: 'consultoriopaz', password: 'paz12345' } });
assert.equal(v2.ok, true, (v2 as any).mensaje);
const cuentaPaz = (v2 as any).cuenta;
assert.equal(cuentaPaz.usuario, 'consultoriopaz');
const filaPaz = await uno(`select * from siguelo_cuentas where empresa_id = $1`, [cuentaPaz.empresa_id]);
assert.equal(filaPaz.agencia_id, agencia, 'es de tu agencia');
assert.equal(filaPaz.propia, false);
assert.ok(Math.abs(new Date(filaPaz.vence_en).getTime() - (Date.now() + 30 * DIA)) < 60_000, 'vence en 30 días (lo que dura el plan)');
assert.equal(Number((await uno(`select monto from siguelo_ventas where cuenta_id = $1`, [cuentaPaz.empresa_id])).monto), 280, 'el monto que pagó');
assert.equal(await G.esAgencia(cuentaPaz.empresa_id), false, 'un cliente no puede crear cuentas');
assert.equal((await uno(`select count(*)::int n from siguelo_ia_clave where empresa_id = $1`, [cuentaPaz.empresa_id])).n, 0, 'sin tu clave si no lo pediste');
const authPaz = [...usuariosAuth.values()].find((u: any) => u.email === 'consultoriopaz@siguelocrm.app.mapse.club') as any;
assert.equal(authPaz.password, 'paz12345');
paso('venta con CRM: se crea su cuenta aparte, con su usuario y vence cuando termina el plan');

// ---------- 5. Renovar: se suma desde que vence ----------
const v3 = await G.registrarVenta(agencia, authAgencia.id, { cliente: 'Dra. Paz', telefono: '76543210', plan_id: planCrm, cuenta: { modo: 'renovar', empresa_id: cuentaPaz.empresa_id } });
assert.equal(v3.ok, true, (v3 as any).mensaje);
const venceNuevo = new Date((await uno(`select vence_en from siguelo_cuentas where empresa_id = $1`, [cuentaPaz.empresa_id])).vence_en).getTime();
assert.ok(Math.abs(venceNuevo - (Date.now() + 60 * DIA)) < 60_000, 'renovado: 30 días más desde que vencía');
assert.equal((await uno(`select count(*)::int n from contactos where empresa_id = $1 and telefono = '59176543210'`, [agencia])).n, 1, 'el mismo contacto, no uno repetido');
assert.equal((await G.registrarVenta(club, yo, { cliente: 'X', plan_id: planCrm })).ok, false, 'otra cuenta no usa tus planes');
paso('renovar suma el tiempo desde que vencía, sin repetir el contacto');

// ---------- 6. Pausa / vencida: nadie de esa cuenta entra y su IA se detiene ----------
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-paz')`, [cuentaPaz.empresa_id]);
await pg.query(`insert into siguelo_ia (empresa_id, activa) values ($1, true)`, [cuentaPaz.empresa_id]);
olvidarCache();
assert.ok((await empresasConIA()).some((c: any) => c.ia.empresa_id === cuentaPaz.empresa_id));
assert.equal((await A.accesoDe(authPaz.id))?.activo, true);
assert.equal((await G.actualizarCuenta(agencia, cuentaPaz.empresa_id, { pausada: true })).ok, true);
assert.equal((await A.accesoDe(authPaz.id))?.activo, false, 'en pausa: su dueño no puede entrar');
olvidarCache();
assert.ok(!(await empresasConIA()).some((c: any) => c.ia.empresa_id === cuentaPaz.empresa_id), 'en pausa: su IA no responde');
assert.ok((await empresasConIA()).some((c: any) => c.ia.empresa_id === club), 'tu IA sigue igual');
await G.actualizarCuenta(agencia, cuentaPaz.empresa_id, { pausada: false, vence_en: new Date(Date.now() - 1000).toISOString() });
assert.equal((await A.accesoDe(authPaz.id))?.activo, false, 'vencida: tampoco');
await G.actualizarCuenta(agencia, cuentaPaz.empresa_id, { vence_en: new Date(Date.now() + 10 * DIA).toISOString(), password: 'nueva123' });
assert.equal((await A.accesoDe(authPaz.id))?.activo, true, 'renovada: vuelve');
assert.equal(authPaz.password, 'nueva123', 'le cambias la contraseña si la olvidó');
assert.equal((await G.actualizarCuenta(club, cuentaPaz.empresa_id, { pausada: true })).ok, false, 'otra cuenta no puede pausarla');
assert.equal(await B.estaBloqueada(club), false);
paso('en pausa o vencida nadie de esa cuenta entra y su IA se detiene; al renovar vuelve; solo tu agencia la maneja');

// ---------- 7. Un número de otra cuenta: nadie lo usa aunque "vea todos los números" ----------
const lineaPaz = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero) values ($1, 'Consultorio', '592') returning id`, [cuentaPaz.empresa_id])).id;
const [, revisar] = conNumero((req: any) => req.body.linea_id);
const probar = async (usuario: { id: string; empresa_id: string }, lineaId: string) => {
  let estado = 200;
  let siguio = false;
  const res: any = { status: (n: number) => { estado = n; return res; }, json: () => res };
  await (revisar as any)({ usuarioAutenticado: usuario, body: { linea_id: lineaId } }, res, () => { siguio = true; });
  return siguio ? 200 : estado;
};
assert.equal(await probar({ id: yo, empresa_id: club }, lineaClub), 200, 'tu número: sí');
assert.equal(await probar({ id: yo, empresa_id: club }, lineaPaz), 403, 'el número de un cliente: no (aunque seas dueño de "todos los números")');
assert.equal(await probar({ id: authPaz.id, empresa_id: cuentaPaz.empresa_id }, lineaClub), 403, 'el cliente no usa tus números');
assert.equal(await probar({ id: authPaz.id, empresa_id: cuentaPaz.empresa_id }, lineaPaz), 200, 'el cliente usa el suyo');
paso('cada cuenta solo usa sus propios números de WhatsApp');

// ---------- 8. Lo que ve la pantalla ----------
const d = await G.datosAgencia(agencia);
assert.equal(d.ok, true);
const enLista = (d as any).cuentas.find((c: any) => c.empresa_id === cuentaPaz.empresa_id);
assert.equal(enLista.usuario, 'consultoriopaz', 'el usuario se ve corto');
assert.equal(enLista.estado, 'activa');
assert.equal(enLista.numeros, 1);
assert.equal((d as any).ventas.length, 3);
assert.equal((d as any).planes.length, 2);
assert.equal(((await G.datosAgencia(club)) as any).cuentas.length, 1, 'desde el club ves la cuenta de tu agencia');
paso('la pantalla muestra planes, ventas y cuentas (con su estado y sus números)');

console.log(`\n${ok} pasos OK · cuentas: ${usuariosAuth.size}`);
