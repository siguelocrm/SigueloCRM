import assert from 'node:assert/strict';
const R = new URL('../server/src/siguelo/', import.meta.url).href;
const H = await import(R + 'horario.ts');
const C = await import(R + 'calculo.ts');
const T = await import(R + 'textos.ts');

const HORA = 3600_000, DIA = 24 * HORA, MIN = 60_000;
const zona = 'America/La_Paz';
const f = { zona, desde: '08:00', hasta: '20:00' };
const ts = (s: string) => new Date(s).getTime();
let ok = 0;
const t = (n: string, fn: () => void) => { fn(); ok++; console.log('✓', n); };

// ---------- horario ----------
t('instante 08:00 La Paz = 12:00 UTC', () => assert.equal(H.instante('2026-10-26', '08:00', zona), Date.UTC(2026, 9, 26, 12, 0)));
t('21:00 se mueve a las 08:00 del día siguiente', () => assert.equal(H.ajustar(ts('2026-10-26T21:00:00-04:00'), f), ts('2026-10-27T08:00:00-04:00')));
t('06:00 se mueve a las 08:00 del mismo día', () => assert.equal(H.ajustar(ts('2026-10-26T06:00:00-04:00'), f), ts('2026-10-26T08:00:00-04:00')));
t('10:00 queda igual', () => assert.equal(H.ajustar(ts('2026-10-26T10:00:00-04:00'), f), ts('2026-10-26T10:00:00-04:00')));
t('20:00 justo ya está fuera', () => assert.equal(H.enFranja(ts('2026-10-26T20:00:00-04:00'), f), false));
t('fecha local a las 23:30 La Paz', () => assert.equal(H.fechaDe(ts('2026-10-26T23:30:00-04:00'), zona), '2026-10-26'));
t('Madrid con cambio de hora (25 oct 2026)', () => assert.equal(H.instante('2026-10-25', '08:00', 'Europe/Madrid'), Date.UTC(2026, 9, 25, 7, 0)));

// ---------- textos ----------
t('{nombre} con nombre', () => assert.equal(T.aplicarNombre('Hola {nombre}, ¿cómo estás?', 'Ana María'), 'Hola Ana, ¿cómo estás?'));
t('{nombre} sin nombre', () => assert.equal(T.aplicarNombre('Hola {nombre}, ¿cómo estás?', null), 'Hola, ¿cómo estás?'));
t('{nombre} al inicio sin nombre', () => assert.equal(T.aplicarNombre('{nombre}, ¡hola! Paso por aquí', '+591 712 34567'), '¡Hola! Paso por aquí'));
t('variante no repite la última', () => {
  for (let i = 0; i < 50; i++) assert.equal(T.elegirVariante(['Uno {nombre}', 'Dos'], 'Ana', 'Uno Ana\n\nSi no quieres, responde stop').texto, 'Dos');
});
t('{sucursal} se llena con el nombre del número', () => {
  assert.deepEqual(T.elegirVariante(['Hola {nombre}, te escribe {Sucursal}'], 'Ana', null, { sucursal: 'Quillacollo' }), { texto: 'Hola Ana, te escribe Quillacollo', faltan: [] });
});
t('una variante con una variable sin valor no sale', () => {
  for (let i = 0; i < 30; i++) assert.equal(T.elegirVariante(['Ven a {direccion}', 'Te esperamos'], 'Ana', null, { sucursal: 'X' }).texto, 'Te esperamos');
});
t('si ninguna variante se puede llenar, dice qué falta', () => {
  assert.deepEqual(T.elegirVariante(['Ven a {direccion}', '{sucursal}: abrimos a las {horario}'], 'Ana', null, { sucursal: '' }), { texto: '', faltan: ['{direccion}', '{sucursal}', '{horario}'] });
});
t('pie con variable', () => assert.equal(T.agregarPie('Hola', { activo: true, variantes: ['— {sucursal}'] }, null, { sucursal: 'El Alto' }), 'Hola\n\n— El Alto'));
t('pie se agrega', () => assert.equal(T.agregarPie('Hola', { activo: true, variantes: ['Responde *stop*'] }, null), 'Hola\n\nResponde *stop*'));
t('pie apagado', () => assert.equal(T.agregarPie('Hola', { activo: false, variantes: ['x'] }, null), 'Hola'));

// ---------- embudo ----------
const rec = { activa: true, modo: 'origen' as const, pasos: [24, 96, 144, 192].map((h) => ({ horas: h, variantes: ['r' + h] })) };
const react = { activa: true, modo: 'encadenado' as const, pasos: [1, 3, 5, 8].map((h) => ({ horas: h, variantes: ['a' + h] })) };
const cfg = { recordatorios: rec, reactivacion: react, al_terminar: { etapa_id: 'E2', dias: 7 } };
const aj = { no_recordar_si_escribio_horas: 24, atraso_max_reactivacion_horas: 12, ciclos_reactivacion_cada_horas: 24 };
const activado = ts('2026-10-01T00:00:00-04:00');
const T0 = ts('2026-10-20T10:00:00-04:00'); // primer mensaje del cliente
const ctx = (ahora: number, extra: Record<string, unknown> = {}) =>
  ({ ahora, etapaId: 'E1', cfg, entrada: T0, activadoEn: activado, ultimoCliente: T0, ultimoManual: 0, ajustes: aj, ...extra }) as any;
const nuevo = () => ({ rec: null, react: null, respondio: false, pausado: false }) as any;

t('fechaEntrada: nunca cambió de etapa → primer mensaje', () => {
  assert.equal(C.fechaEntrada('2026-10-20T14:00:30Z', '2026-10-20T14:00:00Z', '2026-10-20T13:00:00Z'), ts('2026-10-20T13:00:00Z'));
});
t('fechaEntrada: cambió de etapa → cuando cambió', () => {
  assert.equal(C.fechaEntrada('2026-10-22T10:00:00Z', '2026-10-20T14:00:00Z', '2026-10-20T13:00:00Z'), ts('2026-10-22T10:00:00Z'));
});
t('fechaEntrada: timestamps de Postgres con microsegundos', () => {
  assert.equal(C.ms('2026-10-20T14:00:00.123456+00:00'), ts('2026-10-20T14:00:00.123Z'));
});
t('recordatorio 1 a las 24 h del primer mensaje', () => {
  const e = nuevo(); const c = ctx(T0 + HORA);
  C.prepararRec(e, c);
  const d = C.deseoRec(e, c)!;
  assert.equal(d.paso, 0); assert.equal(d.vence, T0 + 24 * HORA); assert.equal(d.etiqueta, 'Recordatorio 1');
});
t('si escribiste a mano, espera 24 h desde tu mensaje', () => {
  const e = nuevo(); const c = ctx(T0 + 2 * HORA, { ultimoManual: T0 + 2 * HORA });
  C.prepararRec(e, c);
  assert.equal(C.deseoRec(e, c)!.vence, T0 + 26 * HORA);
});
t('contacto que ya estaba antes de activar: sin recordatorios ni cambio de etapa', () => {
  const e = nuevo(); const c = ctx(T0, { entrada: activado - DIA });
  C.prepararRec(e, c);
  assert.equal(e.rec.previo, true); assert.equal(C.deseoRec(e, c), null); assert.equal(C.transicion(e, c), null);
});
t('entró hace 5 días: se saltan los pasos de hace más de un día', () => {
  const e = nuevo(); const c = ctx(T0 + 5 * DIA);
  C.prepararRec(e, c);
  // 24 h fue hace 4 días (se salta); 96 h fue hace justo 1 día (no es "más de un día"): queda
  assert.equal(e.rec.paso, 1);
});
t('al salir el paso avanza y el siguiente es el de 96 h', () => {
  const e = nuevo(); const c = ctx(T0 + 25 * HORA);
  C.prepararRec(e, c);
  const d = C.deseoRec(e, c)!;
  assert.equal(C.avanzar(e, 'rec', d.paso, d.token, T0 + 25 * HORA), true);
  assert.equal(C.deseoRec(e, c)!.vence, T0 + 96 * HORA);
  assert.equal(C.avanzar(e, 'rec', d.paso, d.token, 0), false, 'el mismo paso no avanza dos veces');
});
t('cliente responde → respondio, recordatorios esperan', () => {
  const e = nuevo(); const c = ctx(T0 + HORA);
  C.prepararRec(e, c);
  C.alMensajeCliente(e, true);
  assert.equal(e.respondio, true); assert.equal(C.deseoRec(e, c), null);
});
t('primer mensaje del cliente no es respuesta', () => {
  const e = nuevo(); C.alMensajeCliente(e, false); assert.equal(e.respondio, false);
});
t('escribes a mano → reactivación a la 1, 3, 5 y 8 h encadenada', () => {
  const e = nuevo(); const M = T0 + 2 * HORA; const c = ctx(M);
  e.respondio = true;
  C.alMensajeManual(e, c, M);
  assert.equal(e.respondio, false);
  let d = C.deseoReact(e, c)!;
  assert.equal(d.vence, M + HORA); assert.equal(d.maxAtrasoMs, 12 * HORA);
  // sale 10 min tarde: el paso 2 cuenta desde el envío real (+2 h)
  C.avanzar(e, 'react', d.paso, d.token, M + HORA + 10 * MIN);
  d = C.deseoReact(e, c)!;
  assert.equal(d.vence, M + 3 * HORA + 10 * MIN);
});
t('cliente responde → se detiene la reactivación', () => {
  const e = nuevo(); const M = T0 + 2 * HORA; const c = ctx(M);
  C.alMensajeManual(e, c, M);
  C.alMensajeCliente(e, true);
  assert.equal(C.deseoReact(e, c), null);
});
t('máximo un ciclo de reactivación cada 24 h', () => {
  const e = nuevo(); const M = T0 + 2 * HORA; const c = ctx(M);
  C.alMensajeManual(e, c, M); C.alMensajeCliente(e, true);
  const notas = C.alMensajeManual(e, c, M + 5 * HORA);
  assert.match(notas[0], /no se inicia otra/); assert.equal(e.react.activo, false);
  C.alMensajeManual(e, c, M + 25 * HORA);
  assert.equal(e.react.activo, true); assert.equal(e.react.ciclo, 2);
});
t('nuevo mensaje tuyo con ciclo en marcha: recalcula sin repetir pasos', () => {
  const e = nuevo(); const M = T0; const c = ctx(M);
  C.alMensajeManual(e, c, M);
  const d = C.deseoReact(e, c)!; C.avanzar(e, 'react', d.paso, d.token, M + HORA);
  C.alMensajeManual(e, c, M + 2 * HORA);
  assert.equal(e.react.paso, 1);
  assert.equal(C.deseoReact(e, c)!.vence, M + 2 * HORA + 2 * HORA); // 3 h − 1 h desde tu último mensaje
});
t('reactivación atrasada: termina el ciclo', () => {
  const e = nuevo(); const c = ctx(T0);
  C.alMensajeManual(e, c, T0);
  const d = C.deseoReact(e, c)!;
  C.avanzar(e, 'react', d.paso, d.token, T0 + 20 * HORA, true);
  assert.equal(e.react.activo, false); assert.equal(C.deseoReact(e, c), null);
});
t('terminó los 4 recordatorios: pasa a E2 a los 7 días del último', () => {
  const e = nuevo(); const c = ctx(T0 + 25 * HORA);
  C.prepararRec(e, c);
  let ultimo = 0;
  for (const h of [24, 96, 144, 192]) { const d = C.deseoRec(e, ctx(T0 + h * HORA))!; ultimo = T0 + h * HORA; C.avanzar(e, 'rec', d.paso, d.token, ultimo); }
  assert.equal(C.deseoRec(e, c), null);
  const tr = C.transicion(e, ctx(ultimo))!;
  assert.equal(tr.destino, 'E2'); assert.equal(tr.ts, ultimo + 7 * DIA);
});
t('con respuesta pendiente no pasa de etapa', () => {
  const e = nuevo(); const c = ctx(T0); C.prepararRec(e, c); e.rec.paso = 4; e.respondio = true;
  assert.equal(C.transicion(e, c), null);
});
t('al pasar a otra etapa empieza su propia lista', () => {
  const e = nuevo(); C.prepararRec(e, ctx(T0));
  const c2 = { ...ctx(T0 + 20 * DIA), etapaId: 'E2', entrada: T0 + 20 * DIA };
  C.prepararRec(e, c2);
  assert.equal(e.rec.etapa_id, 'E2'); assert.equal(e.rec.paso, 0); assert.equal(e.rec.previo, false);
});
t('etapa sin config (perdida): nada', () => {
  const e = nuevo(); const c = ctx(T0, { cfg: null }); C.prepararRec(e, c);
  assert.equal(C.deseoRec(e, c), null); assert.equal(C.transicion(e, c), null);
  assert.deepEqual(C.alMensajeManual(e, c, T0), []);
});
console.log(`\n${ok} pruebas OK`);
