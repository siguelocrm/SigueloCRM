// Prueba de la conexión con tu Aula virtual: la IA ve los planes de los cursos
// virtuales, y un pago confirmado crea la cuenta del alumno (o usa la que ya
// tiene) y lo inscribe en el plan. Con un aula falsa (imita sus funciones),
// WhatsApp falso y OpenAI falsa.
import assert from 'node:assert/strict';
import { pg, reloj, prepararBase } from './mock-db.mjs';
import { enviados } from './mock-sesiones.mjs';
import { redirigidos } from './hooks.mjs';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_KEY = 'prueba';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const { conectarAula, olvidarAula, diaDeClase, buscarAlumno, usuarioPara } = await import(R + 'aula/aula.ts');
const { revisarPagos } = await import(R + 'pagos/inscripcion.ts');
const { leerPendientes } = await import(R + 'ia/lector.ts');
const { procesarSalida } = await import(R + 'ia/salida.ts');
const { olvidarCache, empresasConIA } = await import(R + 'ia/config.ts');
const { olvidarNegocios } = await import(R + 'negocios.ts');
assert.ok(redirigidos.includes('db') && redirigidos.includes('sesiones'));

const MIN = 60_000;
reloj.ahora = Date.now() - 60 * MIN;
const iso = (t: number) => new Date(t).toISOString();
const avanzar = (x: number) => { reloj.ahora += x; };
const hoyLP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date(reloj.ahora));
const masDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let ok = 0;
const paso = (n: string) => { ok++; console.log('✓', n); };

// ---------- Aula falsa ----------
const AULA = 'https://aula.supabase.co';
const PLANES = [
  { id: 'pl-mes', nombre: 'Mensual 8 clases', precio: 200, dias: 30, clases: 8, grupo_id: 'gr-ma', activo: true },
  { id: 'pl-sab', nombre: 'Sábados', precio: 120, dias: 30, clases: null, grupo_id: 'gr-sa', activo: true },
];
const GRUPOS = [
  { id: 'gr-ma', nombre: 'Martes y jueves', dias: [2, 4], hora_inicio: '19:00', duracion_min: 60, activo: true },
  { id: 'gr-sa', nombre: 'Sábados', dias: [6], hora_inicio: '10:00', duracion_min: 90, activo: true },
];
const aula = {
  personas: [{ id: 'u-lucia', nombre: 'Lucía Vargas', usuario: 'luciavargas', celular: '70000002', rol: 'usuario', activo: true, vigente: true, hasta: '' }] as any[],
  cuentas: [] as any[],
  inscripciones: [] as any[],
  fallaInscribir: false,
};
const resp = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

// ---------- OpenAI falsa ----------
let comprobante: Record<string, unknown> = {};
let datosAula: (usuario: string, sistema: string) => any = () => ({});
let responder: (sistema: string) => any = () => ({ resumen: 'x' });

const fetchReal = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const u = String(url);
  if (u.startsWith('https://falso/')) return new Response(JPG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (u.startsWith(AULA)) {
    const ruta = u.slice(AULA.length);
    const cuerpo = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (ruta.startsWith('/auth/v1/token')) {
      return cuerpo.email === 'whatsapp@aula.infinitychess.local' && cuerpo.password === 'clave-aula'
        ? resp({ access_token: 'tok-profe', expires_in: 3600 })
        : resp({ error_description: 'Invalid login credentials' }, 400);
    }
    if (init.headers?.Authorization !== 'Bearer tok-profe') return resp({ message: 'sin sesión' }, 401);
    if (ruta.startsWith('/rest/v1/planes')) return resp(PLANES);
    if (ruta.startsWith('/rest/v1/grupos')) return resp(GRUPOS);
    if (ruta === '/rest/v1/rpc/listar_personas') return resp(aula.personas);
    if (ruta === '/functions/v1/cuentas') {
      if (aula.personas.some((p) => p.usuario === cuerpo.usuario)) return resp({ error: 'Ese usuario ya existe' }, 400);
      const id = `u-${aula.personas.length + 1}`;
      aula.cuentas.push(cuerpo);
      aula.personas.push({ id, nombre: cuerpo.nombre, usuario: cuerpo.usuario, celular: cuerpo.celular, rol: cuerpo.rol, activo: true, vigente: false, hasta: null });
      return resp({ id });
    }
    if (ruta === '/rest/v1/rpc/registrar_inscripcion') {
      if (aula.fallaInscribir) return resp({ message: 'el aula está en mantenimiento' }, 500);
      aula.inscripciones.push(cuerpo);
      return resp(null);
    }
    return resp({ message: `ruta desconocida ${ruta}` }, 404);
  }
  if (!u.startsWith('https://api.openai.com/')) return fetchReal(url, init);
  const { messages } = JSON.parse(init.body);
  const [sis, usr] = [messages[0], messages[messages.length - 1]];
  let json: unknown;
  if (Array.isArray(usr.content)) json = comprobante;
  else if (String(sis.content).startsWith('Ayudas a inscribir en un aula virtual')) json = datosAula(usr.content, sis.content);
  else json = responder(sis.content);
  return resp({ choices: [{ message: { content: JSON.stringify(json) } }], usage: { prompt_tokens: 700, completion_tokens: 60 } });
}) as typeof fetch;

// ---------- Datos ----------
await prepararBase();
const uno = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows[0];
const empresa = (await uno(`insert into empresas (nombre) values ('Infinity Chess') returning id`)).id;
const L1 = (await uno(`insert into lineas_whatsapp (empresa_id, nombre, numero, estado) values ($1, 'Online', '591', 'activo') returning id`, [empresa])).id;
const negocio = (await uno(`insert into siguelo_negocios (empresa_id, nombre, info_ia) values ($1, 'Infinity Chess Online', 'Clases de ajedrez.') returning id`, [empresa])).id;
await pg.query(`insert into siguelo_lineas (linea_id, empresa_id, negocio_id) values ($1, $2, $3)`, [L1, empresa, negocio]);
await pg.query(
  `insert into siguelo_ia (empresa_id, activa, modo, desde, hasta, espera_min_seg, espera_max_seg, avisos) values ($1, true, 'automatico', '00:00', '23:59', 0, 0, $2::jsonb)`,
  [empresa, JSON.stringify({ activo: true, telefono: '59179999999', linea_id: null, tipos: {}, max_dia: 30, juntar_min: 0 })],
);
await pg.query(`insert into siguelo_ia_clave (empresa_id, clave) values ($1, 'sk-prueba')`, [empresa]);
await pg.query(
  `insert into siguelo_cursos (empresa_id, negocio_id, nombre, precio, moneda, destinatario, cuenta, link_grupo, qr_url, aula)
   values ($1, $2, 'Aula virtual', 0, 'Bs', 'Gustavo Herbas', '', '', 'https://falso/qr.png', true)`,
  [empresa, negocio],
);
aula.personas[0].hasta = masDias(hoyLP(), 5);

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
const pagar = (monto: number, tx: string) => {
  comprobante = { es_comprobante: true, monto, moneda: 'BOB', fecha: hoyLP() + ' 09:00', transaccion: tx, destinatario: 'GUSTAVO HERBAS', cuenta_destino: null, senales_edicion: [], confianza: 0.95 };
};

// ---------- 0. Cálculos ----------
assert.equal(diaDeClase('2026-11-02', [2, 4], 8), '2026-11-26', 'la 8.ª clase de martes y jueves desde el lunes 2/11');
assert.equal(usuarioPara('Juan Pérez Rojas', '59170000123'), 'juanperez123');
const gente = [
  { id: 'a', nombre: 'Pedro Gómez', usuario: 'p', celular: '70000005', rol: 'usuario' },
  { id: 'b', nombre: 'Sara Gómez', usuario: 's', celular: '+591 70000005', rol: 'usuario' },
];
assert.equal(buscarAlumno(gente, '59170000005', 'Sara Gómez Paz')?.id, 'b', 'hermanos con el mismo celular: por nombre');
assert.equal(buscarAlumno(gente, '59170000005', 'Tito Gómez'), null, 'otro hijo con ese celular: cuenta nueva');
paso('fechas como el aula (hasta la última clase del grupo), usuario nuevo y buscar al alumno por celular y nombre');

// ---------- 1. Conectar ----------
let r = await conectarAula(empresa, { url: AULA, clave_publica: 'pub', usuario: 'WhatsApp', contrasena: 'otra', enlace: 'https://aula.ejemplo' });
assert.equal(r.ok, false);
assert.match((r as any).mensaje, /usuario o la contraseña de la cuenta del aula no son correctos/);
r = await conectarAula(empresa, { url: AULA, clave_publica: 'pub', usuario: 'WhatsApp', contrasena: 'clave-aula', enlace: 'https://aula.ejemplo' });
assert.ok(r.ok);
const info = await uno(`select * from siguelo_aula_info where empresa_id = $1`, [empresa]);
assert.equal(info.conectado, true);
assert.deepEqual(info.planes.map((p: any) => p.nombre), ['Mensual 8 clases', 'Sábados']);
assert.match(info.planes[0].texto, /Bs 200 · 30 días · 8 clases · grupo Martes y jueves \(martes y jueves · 19:00 a 20:00/);
paso('se conecta con la cuenta del aula (y avisa si la contraseña está mal); la página ve los planes');

// ---------- 2. La IA ofrece los planes, sin decir "Bs 0" ----------
olvidarAula();
const ana = await chat('59170000001', 'Ana');
await escribe(ana.conv, '¿Tienen clases virtuales de ajedrez?');
avanzar(MIN);
responder = (sistema) => {
  assert.match(sistema, /CURSOS VIRTUALES EN VIVO/);
  assert.match(sistema, /- Mensual 8 clases: Bs 200 · 30 días · 8 clases · grupo Martes y jueves/);
  assert.match(sistema, /- Sábados: Bs 120 · 30 días · clases sin límite · grupo Sábados \(sábado · 10:00 a 11:30/);
  assert.match(sistema, /"Aula virtual", el precio del plan del Aula virtual que elija/);
  assert.doesNotMatch(sistema, /Bs 0\b/);
  return { resumen: 'Pregunta por clases virtuales', puede_responder: true, respuesta: 'Sí: el plan mensual (8 clases, martes y jueves 19:00) cuesta Bs 200.' };
};
await leerPendientes(await config());
await salida();
assert.match(a('59170000001').at(-1)!.texto, /Bs 200/);
paso('la IA ve los planes del aula en vivo (precio, clases y horario) y no dice que el curso cuesta Bs 0');

// ---------- 3. Pagó: cuenta nueva e inscripción ----------
await escribe(ana.conv, 'Quiero inscribir a mi hijo Juan Pérez Rojas en el plan mensual');
await foto(ana.conv, 'ana.jpg');
avanzar(5_000);
pagar(200, 'TX-1001');
let leido = '';
datosAula = (usuario, sistema) => {
  leido = usuario;
  assert.match(sistema, /- p1: Mensual 8 clases/);
  assert.match(sistema, /Pagó: Bs 200/);
  return { alumno: 'Juan Pérez Rojas', plan: 'p1' };
};
await revisarPagos(await config());
assert.match(leido, /Cliente: Quiero inscribir a mi hijo Juan Pérez Rojas/, 'lee lo que dijo antes de pagar');
let p = await pagoDe(ana.contacto);
assert.equal(p.estado, 'inscrito', p.motivo);
assert.equal(aula.cuentas.length, 1);
assert.deepEqual({ ...aula.cuentas[0], clave: undefined }, { accion: 'crear', nombre: 'Juan Pérez Rojas', celular: '70000001', usuario: 'juanperez001', clave: undefined, rol: 'usuario' });
assert.match(aula.cuentas[0].clave, /^\d{6}$/);
const ins = aula.inscripciones[0];
assert.equal(ins.p_usuario, 'u-2');
assert.equal(ins.p_plan, 'pl-mes');
assert.equal(ins.p_desde, hoyLP());
assert.equal(ins.p_hasta, diaDeClase(hoyLP(), [2, 4], 8), 'hasta la 8.ª clase de su grupo');
assert.deepEqual([ins.p_clases, ins.p_total, ins.p_pago, ins.p_metodo, ins.p_grupo], [8, 200, 200, 'qr', 'gr-ma']);
assert.match(ins.p_nota, /Desde WhatsApp \(SígueloCRM\): pagó Bs 200 por QR, transacción TX1001/);
assert.deepEqual({ ...p.aula, inscrito_en: undefined }, { alumno: 'Juan Pérez Rojas', plan: 'pl-mes', usuario_id: 'u-2', usuario: 'juanperez001', nueva: true, inscrito_en: undefined });
assert.doesNotMatch(JSON.stringify(p.aula), new RegExp(aula.cuentas[0].clave), 'la contraseña no se guarda en el pago');
await salida();
const aAna = a('59170000001');
assert.match(aAna.at(-2)!.texto, /Recibimos tu pago de Bs 200 para Aula virtual/);
assert.match(aAna.at(-1)!.texto, /Juan Pérez Rojas ya está inscrito en el Aula Infinity Chess \(Mensual 8 clases, del /);
assert.match(aAna.at(-1)!.texto, new RegExp(`Entra aquí: https://aula.ejemplo\\nUsuario: juanperez001\\nContraseña temporal: ${aula.cuentas[0].clave}`));
const aviso = enviados.filter((e) => e.jid.startsWith('59179999999')).map((e) => e.texto).join('\n');
assert.match(aviso, /Juan Pérez Rojas quedó inscrito en el Aula virtual \(Mensual 8 clases.*cuenta nueva "juanperez001"/);
paso('pagó: se confirma, se crea su cuenta, queda inscrito en el plan hasta su última clase y le llegan su usuario y contraseña');

// ---------- 4. Ya tenía cuenta: la usa y la inscripción sigue a la que tiene ----------
const lucia = await chat('59170000002', 'Lucía');
await escribe(lucia.conv, 'Hola, quiero renovar el plan de los sábados, soy Lucía Vargas');
await foto(lucia.conv, 'lucia.jpg');
avanzar(5_000);
pagar(120, 'TX-2002');
datosAula = () => ({ alumno: 'Lucía Vargas', plan: 'p2' });
await revisarPagos(await config());
p = await pagoDe(lucia.contacto);
assert.equal(p.estado, 'inscrito', p.motivo);
assert.equal(aula.cuentas.length, 1, 'no se crea otra cuenta');
const ins2 = aula.inscripciones[1];
assert.equal(ins2.p_usuario, 'u-lucia');
assert.equal(ins2.p_desde, masDias(hoyLP(), 6), 'empieza al día siguiente de la que tiene vigente');
assert.equal(ins2.p_hasta, masDias(hoyLP(), 35));
await salida();
assert.match(a('59170000002').at(-1)!.texto, /Entra aquí con tu usuario de siempre \(luciavargas\): https:\/\/aula.ejemplo/);
paso('si ya tenía cuenta (por su celular y nombre) la usa, y la nueva inscripción empieza cuando termina la vigente');

// ---------- 5. No dijo el nombre ni el plan: se los pide ----------
const beto = await chat('59170000003', 'Beto');
await escribe(beto.conv, 'Hola, ya pagué');
await foto(beto.conv, 'beto.jpg');
avanzar(5_000);
pagar(150, 'TX-3003');
datosAula = () => ({ alumno: null, plan: null });
await revisarPagos(await config());
p = await pagoDe(beto.contacto);
assert.equal(p.estado, 'datos', p.motivo);
await salida();
const pedido = a('59170000003').at(-1)!.texto;
assert.match(pedido, /• Nombre completo de quien va a tomar las clases/);
assert.match(pedido, /• El plan que quieres:\n {3}– Mensual 8 clases: Bs 200/);
await escribe(beto.conv, 'Es para mi hija Ana Gómez, el de los sábados');
avanzar(40_000);
datosAula = (usuario) => {
  assert.match(usuario, /Cliente: Es para mi hija Ana Gómez/);
  return { alumno: 'Ana Gómez', plan: 'p2' };
};
await revisarPagos(await config());
p = await pagoDe(beto.contacto);
assert.equal(p.estado, 'inscrito', p.motivo);
assert.equal(aula.inscripciones[2].p_pago, 120, 'pagó de más: en el aula se anota el precio del plan');
paso('si no dijo el nombre o el plan, se los pide (con la lista de planes) y lo inscribe al responder');

// ---------- 6. El aula falla: queda para revisar y "Confirmar" lo reintenta una sola vez ----------
const caro = await chat('59170000004', 'Caro');
await escribe(caro.conv, 'Plan sábados para Carolina Ríos');
await foto(caro.conv, 'caro.jpg');
avanzar(5_000);
pagar(120, 'TX-4004');
datosAula = () => ({ alumno: 'Carolina Ríos', plan: 'p2' });
aula.fallaInscribir = true;
await revisarPagos(await config());
p = await pagoDe(caro.contacto);
assert.equal(p.estado, 'revisar');
assert.match(p.motivo, /No se pudo inscribir en el aula: el aula está en mantenimiento/);
aula.fallaInscribir = false;
await pg.query(`update siguelo_pagos set accion = 'confirmar' where id = $1`, [p.id]);
await revisarPagos(await config());
p = await pagoDe(caro.contacto);
assert.equal(p.estado, 'inscrito', p.motivo);
assert.equal(aula.inscripciones.filter((x) => x.p_usuario === p.aula.usuario_id).length, 1);
assert.equal(aula.cuentas.filter((x) => x.nombre === 'Carolina Ríos').length, 1, 'la cuenta que se creó antes de fallar se reutiliza');
await revisarPagos(await config());
assert.equal(aula.inscripciones.length, 4, 'nunca se inscribe dos veces');
paso('si el aula falla queda para revisar; al confirmarlo se reintenta, usa la cuenta ya creada y no se inscribe dos veces');

console.log(`\n${ok} pasos OK · cuentas creadas: ${aula.cuentas.length} · inscripciones: ${aula.inscripciones.length}`);
