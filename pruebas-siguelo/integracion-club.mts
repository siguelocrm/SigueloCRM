// Prueba de la conexión con tu sistema del club: la IA ve horarios, cupos y
// precios en vivo, y una inscripción pagada queda como "reserva de vendedor".
// Con un sistema del club falso (imita sus funciones), WhatsApp falso y OpenAI falsa.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { conectarClub, olvidarClub } = await import(R + 'club/club.ts');
const { revisarPagos } = await import(R + 'pagos/inscripcion.ts');
const { leerPendientes } = await import(R + 'ia/lector.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

// ---------- Sistema del club falso ----------
const CLUB = 'https://club.supabase.co';
const GRUPOS = [
  { grupo: 'g1', curso: 'Ajedrez', curso_id: 'c-aj', dias: [1, 3, 5], hora_inicio: '16:00', hora_fin: '17:00', cupo: 'libre', quedan: null },
  { grupo: 'g2', curso: 'Ajedrez', curso_id: 'c-aj', dias: [6], hora_inicio: '10:00', hora_fin: '11:00', cupo: 'lleno', quedan: 0 },
  { grupo: 'g3', curso: 'Dibujo y Pintura', curso_id: 'c-dib', dias: [1, 3, 5], hora_inicio: '17:00', hora_fin: '18:00', cupo: 'pocos', quedan: 2 },
];
const TARIFAS = [
  { id: 't1', nombre: 'Lunes, miércoles y viernes', dias: [1, 3, 5], clases: 12, precios: [180, 299, 380], desde: null, hasta: null, promocion: false },
  { id: 't2', nombre: 'Solo sábados', dias: [6], clases: 4, precios: [100, 150, 200], desde: null, hasta: null, promocion: false },
];
const club = { reservas: [] as any[], fotos: [] as string[], estados: new Map<string, string>(), logins: 0 };
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const resp = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

// ---------- OpenAI falsa ----------
let comprobante: Record<string, unknown> = {};
let datosClub: (usuario: string, sistema: string) => any = () => ({});
let responder: (sistema: string) => any = () => ({ resumen: 'x' });
const llamadas: { sistema: string; usuario: string }[] = [];

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const u = String(url);
  if (u.startsWith('https://falso/')) return new Response(JPG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (u.startsWith(CLUB)) {
    const ruta = u.slice(CLUB.length);
    const auth = init.headers?.Authorization ?? '';
    const cuerpo = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (ruta === '/rest/v1/rpc/publico_sucursales') return resp([{ id: 'suc-quilla', nombre: 'Quillacollo', departamento: 'Cochabamba' }, { id: 'suc-cercado', nombre: 'Cercado', departamento: 'Cochabamba' }]);
    if (ruta === '/rest/v1/rpc/publico_cursos') return resp(cuerpo.p_branch === 'suc-quilla' ? GRUPOS : []);
    if (ruta === '/rest/v1/rpc/publico_tarifas') return resp(TARIFAS);
    if (ruta.startsWith('/auth/v1/token')) {
      club.logins++;
      return cuerpo.email === 'whatsapp@usuarios.infinitychess.local' && cuerpo.password === 'clave-prueba'
        ? resp({ access_token: 'tok-vendedor', expires_in: 3600 })
        : resp({ error_description: 'Invalid login credentials' }, 400);
    }
    if (auth !== 'Bearer tok-vendedor') return resp({ message: 'sin sesión' }, 401);
    if (ruta === '/rest/v1/rpc/vendedor_yo') return resp({ id: 'vend-1', nombre_completo: 'WhatsApp SígueloCRM', sucursales: [{ id: 'suc-quilla', nombre: 'Quillacollo' }] });
    if (ruta.startsWith('/storage/v1/object/reservas/')) {
      club.fotos.push(ruta.replace('/storage/v1/object/reservas/', ''));
      return resp({ Key: ruta });
    }
    if (ruta === '/rest/v1/rpc/vendedor_reservar') {
      club.reservas.push(cuerpo.p_reserva);
      club.estados.set(cuerpo.p_reserva.id, 'pendiente');
      return resp(null);
    }
    if (ruta === '/rest/v1/rpc/vendedor_reservas') return resp([...club.estados].map(([id, estado]) => ({ id, estado, motivo: estado === 'rechazada' ? 'la familia no vino' : null })));
    return resp({ message: `ruta desconocida ${ruta}` }, 404);
  }
  if (!u.startsWith('https://api.openai.com/')) return fetchReal(url, init);
  const { messages } = JSON.parse(init.body);
  const [sis, usr] = [messages[0], messages[messages.length - 1]];
  let json: unknown;
  if (Array.isArray(usr.content)) json = comprobante;
  else if (String(sis.content).startsWith('Ayudas a inscribir a un cliente que ya pagó en un club')) {
    llamadas.push({ sistema: sis.content, usuario: usr.content });
    json = datosClub(usr.content, sis.content);
  } else {
    llamadas.push({ sistema: sis.content, usuario: usr.content });
    json = responder(sis.content);
  }
  return resp({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 700, completion_tokens: 60 } });
}) as typeof fetch;

const MIN = 60_000;
reloj.ahora = Date.now() - 60 * MIN;
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (x: number) => { reloj.ahora += x; };
const hoyLP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date(reloj.ahora));
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Infinity Chess') returning id`)).id;
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Quillacollo', '591', 'activo') returning id`, [empresa])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, info_ia) values ($1, 'Club Quillacollo', 'Club de ajedrez y cursos para niños.') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [L1, empresa, negocio]);
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, desde, hasta, espera_min_seg, espera_max_seg, avisos) values ($1, true, 'automatico', '00:00', '23:59', 0, 0, $2::jsonb)`,
  [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: {}, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);
const curso = (await uno(
  `insert into siguelo_cursos (empresa_id, negocio_id, nombre, precio, moneda, destinatario, cuenta, link_grupo, club)
   values ($1, $2, 'Inscripción Club Quillacollo', 0, 'Bs', 'Gustavo Herbas', '', 'https://chat.whatsapp.com/CLUB', true) returning id`,
  [empresa, negocio],
)).id;

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
const chat = async (tel: string, nombre: string) => {
  const conv = (await uno(`insert into conversaciones (linea_id, contacto_telefono, contacto_nombre, estado, creado_en) values ($1, $2, $3, 'abierto', $4) returning id`, [L1, tel, nombre, iso(reloj.ahora)])).id;
  const contacto = (await uno(`insert into contactos (empresa_id, telefono, nombre) values ($1, $2, $3) returning id`, [empresa, tel, nombre])).id;
  return { conv, contacto };
};
const escribe = (conv: string, texto: string) => pg.query(`insert into mensajes (conversacion_id, remitente, contenido, creado_en) values ($1, 'cliente', $2, $3)`, [conv, texto, iso(reloj.ahora)]);
const foto = (conv: string, archivo: string) =>
  pg.query(`insert into mensajes (conversacion_id, remitente, tipo, contenido, media_url, creado_en) values ($1, 'cliente', 'imagen', '', $2, $3)`, [conv, `https://falso/storage/v1/object/public/media/${L1}/${archivo}`, iso(reloj.ahora)]);
const pagoDe = async (contacto: string) => uno(`select * from siguelo_pagos where contacto_id = $1 order by creado_en desc limit 1`, [contacto]);
const a = (tel: string) => enviados.filter((e) => e.jid.startsWith(tel));

// ---------- 1. Conectar tu sistema ----------
let r = await conectarClub(empresa, { url: CLUB, clave_publica: 'anon-publica', usuario: 'WhatsApp', contrasena: 'otra' });
assert.equal(r.ok, false);
assert.match((r as any).mensaje, /usuario o la contraseña del vendedor no son correctos/);
r = await conectarClub(empresa, { url: CLUB, clave_publica: 'anon-publica', usuario: 'WhatsApp', contrasena: 'clave-prueba' });
assert.ok(r.ok);
const info = await uno(`select * from siguelo_club_info where empresa_id = $1`, [empresa]);
assert.equal(info.conectado, true);
assert.equal(info.vendedor, 'WhatsApp SígueloCRM');
assert.deepEqual(info.sucursales.map((s: any) => s.nombre), ['Quillacollo', 'Cercado']);
assert.equal((await uno(`select contrasena from siguelo_club where empresa_id = $1`, [empresa])).contrasena, 'clave-prueba', 'la contraseña queda solo del lado del servidor');
paso('se conecta con el usuario del vendedor (y avisa si la contraseña está mal); la página ve las sucursales');

// ---------- 2. La IA responde con horarios, cupos y precios en vivo ----------
await pg.query(`update siguelo_negocios set club_sucursal_id = 'suc-quilla' where id = $1`, [negocio]);
olvidarClub();
const ana = await chat('59170000001', 'Ana');
await escribe(ana.conv, '¿Qué horarios hay de ajedrez y cuánto cuesta?');
avanzar(MIN);
responder = (sistema) => {
  assert.match(sistema, /HORARIOS, CUPOS Y PRECIOS EN VIVO/);
  assert.match(sistema, /- Ajedrez: Lunes\/Miércoles\/Viernes · 16:00 a 17:00 \(hay cupo\); Sábado · 10:00 a 11:00 \(LLENO\)/);
  assert.match(sistema, /- Dibujo y Pintura: Lunes\/Miércoles\/Viernes · 17:00 a 18:00 \(quedan 2 cupos\)/);
  assert.match(sistema, /Lunes\/Miércoles\/Viernes, 12 clases al mes: 1 curso Bs 180 · 2 cursos Bs 299 · 3 cursos Bs 380/);
  return { resumen: 'Pregunta horarios', puede_responder: true, respuesta: 'Ajedrez: lunes, miércoles y viernes de 16:00 a 17:00 (Bs 180 al mes). El sábado está lleno.' };
};
await leerPendientes(await config());
await salida();
assert.match(a('59170000001').at(-1)!.texto, /16:00 a 17:00/);
paso('la IA responde con los horarios, cupos y precios de tu sistema, en vivo (y sabe qué grupo está lleno)');

// ---------- 3. Pagó: se confirma y se le piden solo los datos que faltan ----------
await escribe(ana.conv, 'Quiero inscribir a mi hijo Juan Pérez Rojas en ajedrez lunes miércoles y viernes a las 4');
await foto(ana.conv, 'ana.jpg');
avanzar(5_000);
comprobante = { es_comprobante: true, monto: 180, moneda: 'BOB', fecha: hoyLP() + ' 09:00', transaccion: 'TX-777', destinatario: 'GUSTAVO HERBAS', cuenta_destino: null, senales_edicion: [], confianza: 0.95 };
let leido = '';
datosClub = (usuario, sistema) => {
  leido = usuario;
  assert.match(sistema, /- k1: Ajedrez · Lunes\/Miércoles\/Viernes · 16:00 a 17:00/);
  assert.doesNotMatch(sistema, /Sábado · 10:00/, 'los grupos llenos no se ofrecen');
  return { tutor: null, estudiantes: [{ nombre: 'Juan Pérez Rojas', fecha_nacimiento: null, grupo: 'k1' }] };
};
await revisarPagos(await config());
assert.match(leido, /Cliente: Quiero inscribir a mi hijo Juan Pérez Rojas/, 'lee lo que dijo antes de pagar');
let p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'datos', p.motivo);
assert.equal(p.club.estudiantes[0].grupo, 'g1');
await salida();
const aAna = a('59170000001');
assert.match(aAna.at(-2)!.texto, /Recibimos tu pago de Bs 180/);
assert.match(aAna.at(-1)!.texto, /• Nombre del papá, mamá o tutor\n• Fecha de nacimiento de Juan$/);
assert.doesNotMatch(aAna.at(-1)!.texto, /Curso y horario/, 'el curso ya lo había dicho');
paso('pagó: se confirma solo y se le piden solo los datos que faltan (el curso y horario los dijo antes)');

// ---------- 4. Manda sus datos: la reserva queda en tu sistema ----------
await escribe(ana.conv, 'Soy María Rojas, Juan nació el 15 de marzo de 2017');
avanzar(40_000);
datosClub = () => ({ tutor: 'María Rojas', estudiantes: [{ nombre: null, fecha_nacimiento: '2017-03-15', grupo: null }] });
await revisarPagos(await config());
p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'reservado', p.motivo);
assert.equal(club.reservas.length, 1);
const res = club.reservas[0];
assert.equal(res.id, p.club_reserva_id);
assert.equal(res.branch_id, 'suc-quilla');
assert.equal(res.tipo, 'inscripcion');
assert.equal(res.total_sugerido, 180);
assert.equal(res.pago_qr, 180);
assert.equal(res.foto_qr, `vend-1/${res.id}.jpg`);
assert.deepEqual(club.fotos, [`vend-1/${res.id}.jpg`], 'la foto del comprobante sube a "reservas"');
assert.deepEqual(res.datos.tutor, { nombre: 'María Rojas', celular: '70000001', celular2: null });
const est = res.datos.estudiantes[0];
assert.equal(est.nombre, 'Juan Pérez Rojas');
assert.equal(est.fecha_nacimiento, '2017-03-15');
assert.ok(est.edad >= 9);
assert.deepEqual({ ...est.cursos[0], fecha_inicio: undefined }, { group_id: 'g1', course_id: 'c-aj', curso: 'Ajedrez', horario: 'Lunes/Miércoles/Viernes · 16:00 a 17:00', fecha_inicio: undefined, meses: 1, precio: null });
assert.ok([1, 3, 5].includes(new Date(est.cursos[0].fecha_inicio + 'T12:00:00Z').getUTCDay()), 'empieza en su próximo día de clase');
assert.match(res.nota, /pagó Bs 180 por QR, transacción TX777/);
await salida();
assert.match(a('59170000001').at(-1)!.texto, /Ya tenemos todo para la inscripción en Ajedrez \(Lunes\/Miércoles\/Viernes · 16:00 a 17:00\)/);
assert.match(a('59179999999').at(-1)!.texto, /quedó en "Reservas de vendedores" de tu sistema del club/);
paso('con sus datos completos, la reserva queda en tu sistema (tutor, niño, curso, horario, total, pago y foto) y te avisa');

// ---------- 5. La confirmas en tu sistema: recibe el link ----------
club.estados.set(res.id, 'aprobada');
avanzar(3 * MIN);
await revisarPagos(await config());
p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'inscrito');
await salida();
assert.match(a('59170000001').at(-1)!.texto, /Ya estás inscrito en Ajedrez \(Lunes\/Miércoles\/Viernes · 16:00 a 17:00\)! 🎉[\s\S]*https:\/\/chat\.whatsapp\.com\/CLUB/);
paso('cuando la confirmas en tu sistema, le llega el link del grupo');

// ---------- 6. Si la rechazas en tu sistema, queda para revisar ----------
const beto = await chat('59170000002', 'Beto');
await escribe(beto.conv, 'Quiero inscribir a Lucía Vargas, nació el 2016-08-01, dibujo lunes miércoles viernes 17:00. Soy Pedro Vargas');
await foto(beto.conv, 'beto.jpg');
avanzar(5_000);
comprobante = { ...comprobante, transaccion: 'TX-888' };
datosClub = () => ({ tutor: 'Pedro Vargas', estudiantes: [{ nombre: 'Lucía Vargas', fecha_nacimiento: '2016-08-01', grupo: 'k2' }] });
await revisarPagos(await config());
p = await pagoDe(beto.contacto);
assert.equal(p.estado, 'reservado', 'con todo en la conversación, la reserva sale de una');
const res2 = club.reservas[1];
assert.equal(res2.datos.estudiantes[0].cursos[0].curso, 'Dibujo y Pintura');
club.estados.set(res2.id, 'rechazada');
avanzar(3 * MIN);
await revisarPagos(await config());
p = await pagoDe(beto.contacto);
assert.equal(p.estado, 'revisar');
assert.match(p.motivo, /se rechazó en el club: la familia no vino/);
paso('si ya dijo todo antes de pagar, la reserva sale de una; si la rechazas en tu sistema, queda para revisar');

console.log(`\n${ok} pasos OK · inicios de sesión del vendedor: ${club.logins} · mensajes "enviados":`);
for (const e of enviados) console.log('  →', e.jid.split('@')[0], JSON.stringify(e.texto).slice(0, 140));
