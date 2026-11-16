// Prueba de la IA vendiendo los planes de tu agencia (pago confirmado → venta, acceso al CRM,
// confirmación al cliente y aviso con sus datos) y agendando reuniones virtuales.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase, usuariosAuth } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { revisarPagos } = await import(R + 'pagos/inscripcion.ts');
const { leerPendientes } = await import(R + 'ia/lector.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
const { huecosLibres } = await import(R + 'ia/reuniones.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

// ---------- OpenAI falsa ----------
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
let comprobante: Record<string, unknown> = {};
let datosCliente: Record<string, unknown> = {};
let responder: (sistema: string, usuario: string) => any = () => ({ resumen: 'x' });
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any) => {
  const u = String(url);
  if (u.startsWith('https://falso/')) return new Response(JPG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (!u.startsWith('https://api.openai.com/')) return fetchReal(url, init);
  const cuerpo = JSON.parse(init.body);
  const [sis, usr] = cuerpo.messages;
  const json = Array.isArray(usr.content) ? comprobante : String(sis.content).includes('acaba de pagar un plan de una agencia') ? datosCliente : responder(sis.content, usr.content);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } }), { status: 200 });
}) as typeof fetch;

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
reloj.ahora = Date.now() - 60 * MIN;
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (x: number) => { reloj.ahora += x; };
const fechaLP = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const filas = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows;
// Tu agencia: cuenta de agencia, con su número, su ficha y sus planes.
const agencia = (await uno(`insert into empresas (nombre) values ('Agencia') returning id`)).id;
await pg.query(`insert into siguelo_agencias (empresa_id) values ($1)`, [agencia]);
const yo = '00000000-0000-0000-0000-000000000001';
await pg.query(`insert into usuarios (id, empresa_id, nombre, rol) values ($1, $2, 'Yo', 'dueno')`, [yo, agencia]);
await pg.query(`insert into siguelo_accesos (usuario_id, empresa_id, principal, todas_lineas) values ($1, $2, true, true)`, [yo, agencia]);
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Agencia', '591', 'activo') returning id`, [agencia])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, info_ia) values ($1, 'Agencia', 'Marketing digital') returning id`, [agencia])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [L1, agencia, negocio]);
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, desde, hasta, espera_min_seg, espera_max_seg, avisos) values ($1, true, 'automatico', '00:00', '23:59', 0, 0, $2::jsonb)`,
  [agencia, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: {}, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-agencia')`, [agencia]);
const planCrm = (await uno(`insert into siguelo_planes (empresa_id, nombre, precio, duracion_dias, incluye, con_crm, max_numeros, max_negocios) values ($1, 'CRM con IA', 300, 30, '{"WhatsApp con IA","Seguimiento"}', true, 2, 1) returning id`, [agencia])).id;
const planVideos = (await uno(`insert into siguelo_planes (empresa_id, nombre, precio, duracion_dias, incluye, con_crm) values ($1, 'Básico de videos', 500, 30, '{"4 videos"}', false) returning id`, [agencia])).id;
const curso = async (nombre: string, precio: number, plan: string, activo: boolean) =>
  (await uno(
    `insert into siguelo_cursos (empresa_id, negocio_id, nombre, precio, moneda, qr_url, destinatario, cuenta, link_grupo, datos, plan_id, activo)
     values ($1, $2, $3, $4, 'Bs', 'https://falso/qr.jpg', 'Juan Perez Gomez', '10000012345678', '', '[]'::jsonb, $5, $6) returning id`,
    [agencia, negocio, nombre, precio, plan, activo],
  )).id;
const cursoCrm = await curso('CRM con IA', 300, planCrm, true);
const cursoVideos = await curso('Básico de videos', 500, planVideos, false);

const chat = async (tel: string, nombre: string) => {
  const conv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, creado_en) values ($1, $2, $3, 'abierto', $4) returning id`, [L1, tel, nombre, iso(reloj.ahora)])).id;
  const contacto = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, $2, $3) returning id`, [agencia, tel, nombre])).id;
  return { conv, contacto };
};
const escribe = (conv: string, texto: string) => pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'cliente', $2, $3)`, [conv, texto, iso(reloj.ahora)]);
const foto = (conv: string, archivo: string) =>
  pg.query(`insert into mensajes (conversacion_id, remitente, tipo, contenido, media_url, creado_en) values ($1, 'cliente', 'imagen', '', $2, $3)`, [conv, `https://falso/storage/v1/object/public/media/${L1}/${archivo}`, iso(reloj.ahora)]);
const config = async () => {
  olvidarCache();
  olvidarNegocios();
  const [c] = await empresasConIA();
  return c;
};
const salida = async () => {
  for (let i = 0; i < 12; i++) {
    const antes = enviados.length;
    await procesarSalida(await config());
    avanzar(10_000);
    if (enviados.length === antes && i > 1) break;
  }
};
const a = (tel: string) => enviados.filter((e) => e.jid.startsWith(tel)).map((e) => e.texto || '');
const pagar = (monto: number, tx: string) => ({
  es_comprobante: true, monto, moneda: 'BOB', fecha: fechaLP(reloj.ahora - 20 * MIN), transaccion: tx,
  pagador: 'Paz', banco: 'BNB', destinatario: 'PEREZ GOMEZ JUAN', cuenta_destino: '****5678', glosa: 'plan', senales_edicion: [], confianza: 0.95,
});

// ---------- 1. Paga el plan con CRM: venta, su acceso, se le confirma y te llega todo ----------
const paz = await chat('59176543210', 'Dra. Paz');
await escribe(paz.conv, 'Soy la Dra. Paz del Consultorio Paz, quiero el plan con IA para agendar pacientes. Ya pagué');
await foto(paz.conv, 'paz.jpg');
avanzar(5_000);
comprobante = pagar(300, 'TX-PAZ-1');
datosCliente = { nombre: 'Dra. Carla Paz', negocio: 'Consultorio Paz', rubro: 'Odontología', correo: 'carla@paz.bo', necesita: 'Que la IA agende pacientes por WhatsApp', acordado: null, siguiente: 'Ayudarle a conectar su WhatsApp y cargar su ficha' };
await revisarPagos(await config());
const pagoPaz = await uno(`select * from siguelo_pagos where contacto_id = $1`, [paz.contacto]);
assert.equal(pagoPaz.estado, 'inscrito', pagoPaz.motivo);
assert.ok(pagoPaz.agencia?.venta_id, 'queda anotada la venta (no se repite)');
const venta = await uno(`select * from siguelo_ventas where id = $1`, [pagoPaz.agencia.venta_id]);
assert.deepEqual([venta.cliente, Number(venta.monto), venta.plan_nombre], ['Dra. Carla Paz', 300, 'CRM con IA']);
const cuenta = await uno(`select * from siguelo_cuentas where empresa_id = $1`, [venta.cuenta_id]);
assert.equal(cuenta.nombre, 'Consultorio Paz');
assert.equal(cuenta.usuario, 'consultoriopaz@siguelocrm.app.mapse.club');
assert.equal(cuenta.telefono, '59176543210');
assert.deepEqual([cuenta.max_numeros, cuenta.max_negocios], [2, 1], 'con los límites del plan');
assert.ok(Math.abs(new Date(cuenta.vence_en).getTime() - (Date.now() + 30 * DIA)) < 5 * MIN, 'vence cuando termina el plan');
assert.equal((await uno(`select clave from siguelo_ia_clave where empresa_id = $1`, [cuenta.empresa_id])).clave, 'sk-agencia', 'su IA usa tu clave (opción del plan)');
assert.equal((await filas(`select id from oportunidades where contacto_id = $1`, [paz.contacto])).length, 1, 'una sola oportunidad ganada (no se repite)');
await salida();
const aPaz = a('59176543210').join('\n---\n');
const clave = /Contraseña: (\w+)/.exec(aPaz)?.[1];
assert.match(aPaz, /Usuario: consultoriopaz/);
assert.ok(clave && (usuariosAuth.get(cuenta.usuario_id) as any).password === clave, 'le llega su usuario y su contraseña (la que funciona)');
assert.match(aPaz, /Ya quedaste registrado en "CRM con IA" ✅\. En breve nos comunicamos contigo/);
const avisoPaz = a('59179999999').at(-1)!;
assert.match(avisoPaz, /Nueva venta.*Dra\. Carla Paz.*Consultorio Paz.*pagó Bs 300 por "CRM con IA"/);
assert.match(avisoPaz, /Rubro: Odontología/);
assert.match(avisoPaz, /Correo: carla@paz\.bo/);
assert.match(avisoPaz, /Necesita: Que la IA agende pacientes/);
assert.match(avisoPaz, new RegExp(`usuario \\*consultoriopaz\\*, contraseña \\*${clave}\\*`));
assert.match(avisoPaz, /Siguiente paso: Ayudarle a conectar su WhatsApp/);
paso('paga el plan con CRM: se registra la venta, se crea su acceso, le llegan usuario y contraseña, y a ti todos sus datos');

// ---------- 2. Vuelve a pagar: se renueva su acceso (no se crea otro) ----------
avanzar(DIA);
await escribe(paz.conv, 'Pago el siguiente mes');
await foto(paz.conv, 'paz2.jpg');
avanzar(5_000);
comprobante = pagar(300, 'TX-PAZ-2');
await revisarPagos(await config());
assert.equal((await uno(`select count(*)::int n from siguelo_cuentas where agencia_id = $1`, [agencia])).n, 1, 'la misma cuenta');
const vence2 = new Date((await uno(`select vence_en from siguelo_cuentas where empresa_id = $1`, [cuenta.empresa_id])).vence_en).getTime();
assert.ok(Math.abs(vence2 - (new Date(cuenta.vence_en).getTime() + 30 * DIA)) < 5 * MIN, '30 días más desde que vencía');
await salida();
assert.match(a('59176543210').join('\n'), /Tu acceso a la plataforma quedó renovado/);
paso('si vuelve a pagar, se renueva su acceso desde que vencía (sin crear otro)');

// ---------- 3. Plan sin CRM (videos): se registra, se le confirma y te avisa ----------
await pg.query(`update siguelo_cursos set activo = (id = $1)`, [cursoVideos]);
const gym = await chat('59170000011', 'Gimnasio Fuerza');
await escribe(gym.conv, 'Listo, quiero los videos. Ahí va el pago');
await foto(gym.conv, 'gym.jpg');
avanzar(5_000);
comprobante = pagar(500, 'TX-GYM-1');
datosCliente = { nombre: 'Marco', negocio: 'Gimnasio Fuerza', rubro: 'Gimnasio', correo: null, necesita: '4 videos para Instagram', acordado: 'Grabar el sábado', siguiente: 'Confirmar hora de grabación del sábado' };
await revisarPagos(await config());
const pagoGym = await uno(`select * from siguelo_pagos where contacto_id = $1`, [gym.contacto]);
assert.equal(pagoGym.estado, 'inscrito', pagoGym.motivo);
assert.equal((await uno(`select cuenta_id from siguelo_ventas where id = $1`, [pagoGym.agencia.venta_id])).cuenta_id, null, 'sin acceso al CRM');
await salida();
assert.match(a('59170000011').join('\n'), /Ya quedaste registrado en "Básico de videos" ✅\. En breve nos comunicamos contigo para coordinar/);
assert.doesNotMatch(a('59170000011').join('\n'), /Contraseña/);
const avisoGym = a('59179999999').at(-1)!;
assert.match(avisoGym, /Nueva venta.*Marco.*Gimnasio Fuerza.*pagó Bs 500/);
assert.match(avisoGym, /Acordado: Grabar el sábado/);
assert.match(avisoGym, /Plan sin acceso al CRM/);
paso('plan sin CRM (videos): se registra la venta, se le confirma que lo contactarás y te llegan sus datos');

// ---------- 4. Reuniones: ofrece tus horarios libres, agenda la que confirma y te avisa ----------
await pg.query(
  `update siguelo_negocios set reuniones = $2::jsonb where id = $1`,
  [negocio, JSON.stringify({ activa: true, franjas: [{ dias: [1, 2, 3, 4, 5, 6, 7], desde: '09:00', hasta: '18:00' }], duracion_min: 30, anticipacion_horas: 2, dias_adelante: 5, enlace: 'https://meet.google.com/abc-defg-hij' })],
);
const lu = await chat('59170000022', 'Lucía');
await escribe(lu.conv, '¿Podemos tener una reunión para ver los planes?');
avanzar(MIN);
let vistos = '';
responder = (sis) => {
  vistos = sis;
  return { resumen: 'Quiere una reunión', puede_responder: true, respuesta: 'Claro, ¿te queda bien alguno de estos horarios?' };
};
await leerPendientes(await config());
assert.match(vistos, /REUNIONES VIRTUALES \(de 30 minutos/);
const primero = /HORARIOS LIBRES[^\n]*\n- ([^:]+): (h1) (\d\d:\d\d)/.exec(vistos);
assert.ok(primero, 'la IA ve los horarios libres, por día');
await salida();
await escribe(lu.conv, `Sí, el ${primero![1]} a las ${primero![3]} me queda perfecto`);
avanzar(MIN);
responder = () => ({ resumen: 'Confirmó la reunión', interes: 'Plan CRM con IA', puede_responder: true, respuesta: `¡Listo! Quedamos el ${primero![1]} a las ${primero![3]} 🙌`, reunion: 'h1' });
await leerPendientes(await config());
const cita = await uno(`select * from siguelo_citas where contacto_id = $1 and estado = 'agendada'`, [lu.contacto]);
assert.ok(cita, 'queda la cita (con sus recordatorios de Seguimiento → Citas)');
assert.equal(new Date(cita.fin).getTime() - new Date(cita.inicio).getTime(), 30 * MIN);
const tarea = await uno(`select * from tareas where contacto_id = $1`, [lu.contacto]);
assert.match(tarea.titulo, /Reunión virtual con Lucía · https:\/\/meet\.google\.com/);
assert.equal(tarea.asignado_a, yo, 'en tu Agenda');
await salida();
assert.match(a('59170000022').join('\n'), /Tu reunión: .* a las .*\n🔗 Link para conectarte: https:\/\/meet\.google\.com\/abc-defg-hij/);
const avisoReu = a('59179999999').at(-1)!;
assert.match(avisoReu, /Reunión agendada.*Lucía.*\(\+59170000022\).*30 min/);
assert.match(avisoReu, /Le interesa: Plan CRM con IA/);
const libres = await huecosLibres(agencia, { activa: true, franjas: [{ dias: [1, 2, 3, 4, 5, 6, 7], desde: '09:00', hasta: '18:00' }], duracion_min: 30, anticipacion_horas: 2, dias_adelante: 5 }, 'America/La_Paz');
assert.ok(!libres.some((h: any) => h.inicio === new Date(cita.inicio).getTime()), 'ese horario ya no se ofrece a otros');
paso('reuniones: la IA ofrece tus horarios libres, agenda el que confirma (cita, Agenda y link) y te avisa');

// Si después quiere otro horario, se cambia (no quedan dos).
await escribe(lu.conv, 'Perdón, mejor el siguiente horario');
avanzar(MIN);
responder = (sis) => {
  assert.match(sis, /YA tiene su reunión agendada/);
  return { resumen: 'Cambió la reunión', puede_responder: true, respuesta: 'Listo, cambiado', reunion: 'h2' };
};
await leerPendientes(await config());
assert.equal((await filas(`select id from siguelo_citas where contacto_id = $1 and estado = 'agendada'`, [lu.contacto])).length, 1, 'una sola reunión');
await salida();
assert.match(a('59179999999').at(-1)!, /Reunión cambiada/);
paso('si cambia de horario, se mueve su reunión (no quedan dos) y te avisa');

console.log(`\n${ok} pasos OK · ventas: ${(await uno(`select count(*)::int n from siguelo_ventas`)).n}`);
