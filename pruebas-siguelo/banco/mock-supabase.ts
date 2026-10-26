// Supabase falso en memoria para ver la pantalla Seguimiento sin base real.
type Fila = Record<string, any>;
const H = 3600_000;
const ahora = Date.now();
const iso = (t: number) => new Date(t).toISOString();
const falta = new URLSearchParams(location.search).has('falta');
const sinAjustes = new URLSearchParams(location.search).has('nuevo');

const E = 'emp-1';
const QR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="white"/><path d="M1 1h3v3H1zM6 1h3v3H6zM1 6h3v3H1zM6 6h1v1H6zM8 8h1v1H8zM7 7h1v1H7z" fill="black"/></svg>');
const tablas: Record<string, Fila[]> = {
  etapas_venta: [
    { id: 'e1', empresa_id: E, nombre: 'Primer Contacto', tipo: 'normal', orden: 1, color: 0, probabilidad: 10 },
    { id: 'e2', empresa_id: E, nombre: 'En Negociación', tipo: 'normal', orden: 2, color: 1, probabilidad: 40 },
    { id: 'e3', empresa_id: E, nombre: 'Venta Ganada', tipo: 'ganada', orden: 3, color: 2, probabilidad: 100 },
    { id: 'e4', empresa_id: E, nombre: 'Venta Perdida', tipo: 'perdida', orden: 4, color: 3, probabilidad: 0 },
    { id: 'e5', empresa_id: E, nombre: 'Interesado', tipo: 'normal', orden: 5, color: 4, probabilidad: 20 },
    { id: 'e6', empresa_id: E, nombre: 'Inscrito', tipo: 'ganada', orden: 6, color: 5, probabilidad: 100 },
    { id: 'e7', empresa_id: E, nombre: 'No se inscribió', tipo: 'perdida', orden: 7, color: 6, probabilidad: 0 },
  ],
  siguelo_embudos: [{ id: 'emb1', empresa_id: E, nombre: 'Cursos', creado_en: iso(ahora - 9 * H) }],
  siguelo_etapa_embudo: [
    { etapa_id: 'e5', embudo_id: 'emb1' },
    { etapa_id: 'e6', embudo_id: 'emb1' },
    { etapa_id: 'e7', embudo_id: 'emb1' },
  ],
  siguelo_negocios: [
    { id: 'n1', empresa_id: E, nombre: 'Tienda Quillacollo', sucursal: 'Quillacollo', direccion: 'Av. Blanco Galindo km 13', horario: 'lunes a sábado de 8 a 19', info_ia: 'Vendemos repuestos…', embudo_id: null },
    { id: 'n2', empresa_id: E, nombre: 'Academia', sucursal: null, direccion: null, horario: null, info_ia: '', embudo_id: 'emb1' },
  ],
  siguelo_lineas: [
    { linea_id: 'l1', empresa_id: E, negocio_id: 'n1' },
    { linea_id: 'l2', empresa_id: E, negocio_id: 'n2' },
  ],
  respuestas_rapidas: [
    { id: 'rr1', titulo: 'Precios', atajo: 'precios', tipo: 'texto', contenido: 'Nuestros precios son…' },
    { id: 'rr2', titulo: 'Ubicación', atajo: 'ubi', tipo: 'imagen', contenido: 'Así llegas' },
  ],
  siguelo_respuesta_negocio: [{ respuesta_id: 'rr2', negocio_id: 'n1' }],
  respuestas_automaticas: [
    { id: 'ra1', nombre: 'Bienvenida', palabra_clave: 'hola', palabras_clave: ['hola'], disparador: 'primer_mensaje', activo: true, creado_en: iso(ahora - 50 * H) },
    { id: 'ra2', nombre: null, palabra_clave: 'curso', palabras_clave: ['curso', 'inscripción'], disparador: 'palabra_clave', activo: true, creado_en: iso(ahora - 40 * H) },
  ],
  siguelo_bot_negocio: [],
  conversaciones: [
    { id: 'cv1', contacto_telefono: '59170000001', linea_id: 'l1' },
    { id: 'cv2', contacto_telefono: '59170000002', linea_id: 'l2' },
    { id: 'cv4', contacto_telefono: '59170000004', linea_id: 'l2' },
  ],
  contacto_etiquetas: [],
  motivos_perdida: [],
  siguelo_ia: [{
    empresa_id: E, activa: true, modo: 'borrador', modelo: 'gpt-6-luna', clave_final: 'Xy9Z',
    estilo: { tono: 'amable', trato: 'tu', emojis: 'pocos', largo: 'medio', saltos: 'normal', usar_nombre: true },
    firma: '', instrucciones: '', ejemplos: '', si_no_sabe: 'avisar', texto_espera: 'Déjame consultarlo 🙏', desde: '07:00', hasta: '22:00',
    espera_min_seg: 20, espera_max_seg: 60, max_por_cliente_dia: 10, max_respuestas_dia: 150, max_consultas_dia: 500, pausa_si_escribes_min: 30,
    acciones: { mover_etapa: true, no_quiere_mas: true, respuestas_rapidas: true, pases: true, grupos: true },
    avisos: { activo: true, telefono: '59179999999', linea_id: null, tipos: { fuera: true, compro: true, pregunta: true, molesto: true, humano: true, otro: false }, max_dia: 30, juntar_min: 5 },
  }],
  siguelo_ia_salida: [
    { id: 's1', conversacion_id: 'cv1', contacto_id: 'c1', linea_id: 'l1', telefono: '59170000001', origen: 'respuesta', tipo: 'texto', contenido: 'Hola Ana, estamos en la Av. Blanco Galindo km 13 😊', media_url: null, estado: 'borrador', motivo: null, lote: 'L-1', orden: 0, creado_en: iso(ahora - 5 * 60000) },
    { id: 's2', conversacion_id: 'cv1', contacto_id: 'c1', linea_id: 'l1', telefono: '59170000001', origen: 'respuesta_rapida', tipo: 'imagen', contenido: 'Así llegas', media_url: 'https://x/ubic.jpg', estado: 'borrador', motivo: null, lote: 'L-1', orden: 1, creado_en: iso(ahora - 5 * 60000) },
    { id: 's3', conversacion_id: 'cv2', contacto_id: 'c2', linea_id: 'l2', telefono: '59170000002', origen: 'respuesta', tipo: 'texto', contenido: 'Listo, en un momento te escriben de Cercado.', media_url: null, estado: 'borrador', motivo: 'le escribió una persona hace menos de 30 min', lote: 'L-2', orden: 0, creado_en: iso(ahora - 2 * 60000) },
    { id: 's4', conversacion_id: null, contacto_id: 'c2', linea_id: 'l3', telefono: '59170000002', origen: 'pase', tipo: 'texto', contenido: 'Hola Bruno, te escribimos de la sucursal Cercado.', media_url: null, estado: 'borrador', motivo: null, lote: 'L-2', orden: 1, creado_en: iso(ahora - 2 * 60000) },
  ],
  siguelo_ia_lecturas: [
    { conversacion_id: 'cv4', contacto_id: 'c4', linea_id: 'l2', resumen: 'Pregunta por el curso de motos', interes: 'Curso', atencion: { tipo: 'fuera', motivo: 'Pregunta si hay curso de electricidad (no está en la ficha)', ts: ahora - H, hecho: null }, sin_respuestas: false, actualizado_en: iso(ahora - H) },
    { conversacion_id: 'cv1', contacto_id: 'c1', linea_id: 'l1', resumen: 'Ubicación', interes: '', atencion: null, sin_respuestas: false, actualizado_en: iso(ahora - H) },
  ],
  siguelo_ia_uso: [{ empresa_id: E, fecha: new Date().toISOString().slice(0, 10), consultas: 42, entrada: 61000, salida: 5200 }],
  siguelo_ajustes: sinAjustes
    ? []
    : [{
        empresa_id: E, activo: true, activado_en: iso(ahora - 3 * 24 * H), pausado: false, motivo_pausa: null, zona_horaria: 'America/La_Paz',
        hora_inicio: '08:00', hora_fin: '20:00', pausa_min_seg: 45, pausa_max_seg: 120, maximo_diario: 30, min_entre_misma_persona_min: 60,
        no_recordar_si_escribio_horas: 24, atraso_max_reactivacion_horas: 12, ciclos_reactivacion_cada_horas: 24, pie: { activo: false, variantes: [] },
        adaptar: { activo: true, recordatorios: true, reactivaciones: true, instrucciones: 'Menciona que los cupos son limitados.' },
        stop: { activo: true, palabras: ['stop'], parecidas: ['no me interesa'], respuesta: 'Listo, no te enviaremos más mensajes. ¡Gracias!' },
        citas: { activa: true, desde: '07:00', hasta: '21:00', max_atraso_min: 45, pasos: [
          { ref: 'inicio', horas: -2, variantes: ['Hola {nombre}, te recuerdo tu cita {cuando} a las {hora}.'] },
          { ref: 'inicio', horas: -1, variantes: ['{nombre}, falta 1 hora para tu cita. ¡Te esperamos!'] },
          { ref: 'inicio', horas: 0, variantes: ['Ya estamos listos para tu cita, {nombre}.'] },
          { ref: 'fin', horas: 2, variantes: ['Gracias por venir, {nombre}. ¿Qué te pareció?'] },
        ] },
      }],
  siguelo_citas: [
    { id: 'ct1', empresa_id: E, contacto_id: 'c1', inicio: iso(ahora + 3 * H), fin: iso(ahora + 4 * H), nota: 'Clase de prueba', estado: 'agendada', paso: 0 },
    { id: 'ct2', empresa_id: E, contacto_id: 'c4', inicio: iso(ahora + 26 * H), fin: iso(ahora + 27 * H), nota: null, estado: 'agendada', paso: 0 },
  ],
  siguelo_etapas: [
    {
      id: 'cfg-1', etapa_id: 'e1', empresa_id: E, negocio_id: null,
      recordatorios: { activa: true, modo: 'origen', pasos: [{ horas: 24, variantes: ['Hola {nombre}, ¿qué te pareció la información?', '{nombre}, ¿pudiste revisar lo que te envié?'] }, { horas: 96, variantes: ['Hola {nombre}, ¿seguimos con lo que hablamos?'] }] },
      reactivacion: { activa: true, modo: 'encadenado', pasos: [{ horas: 1, variantes: ['¿Pudiste ver mi mensaje?'] }, { horas: 3, variantes: ['Te escribo de nuevo por si no lo viste.'] }] },
      al_terminar: { etapa_id: 'e2', dias: 7 },
    },
  ],
  contactos: [
    { id: 'c1', nombre: 'Ana Rojas', telefono: '59170000001', etapa_id: 'e1' },
    { id: 'c2', nombre: 'Bruno', telefono: '59170000002', etapa_id: 'e1' },
    { id: 'c3', nombre: null, telefono: '59170000003', etapa_id: 'e1' },
    { id: 'c4', nombre: 'Juan Pérez', telefono: '59170000004', etapa_id: 'e5', valor_estimado: 350, probabilidad_cierre: 20, etapa_actualizada_en: iso(ahora - 5 * H), actualizado_en: iso(ahora - H) },
  ],
  siguelo_cola: [
    { id: 'q1', contacto_id: 'c1', linea_id: 'l1', tipo: 'react', nombre: 'Primer Contacto · Reactivación 1', variantes: ['¿Pudiste ver mi mensaje?'], vence: iso(ahora - 5 * 60000), fijo: false, estado: 'pendiente', a_mano: false, texto: null, motivo: null, creado_en: iso(ahora - H), cerrado_en: null },
    { id: 'q2', contacto_id: 'c2', linea_id: 'l2', tipo: 'rec', nombre: 'Primer Contacto · Recordatorio 1', variantes: ['Hola {nombre}, ¿qué te pareció la información?', '{nombre}, ¿pudiste revisar lo que te envié?'], vence: iso(ahora + 3 * H), fijo: false, estado: 'pendiente', a_mano: false, texto: null, motivo: null, creado_en: iso(ahora - 20 * H), cerrado_en: null },
    { id: 'q3', contacto_id: 'c3', linea_id: 'l1', tipo: 'rec', nombre: 'Primer Contacto · Recordatorio 2', variantes: ['Hola {nombre}, ¿seguimos con lo que hablamos?'], vence: iso(ahora + 30 * H), fijo: false, estado: 'pendiente', a_mano: false, texto: null, motivo: null, creado_en: iso(ahora - 2 * H), cerrado_en: null },
    { id: 'q4', contacto_id: 'c3', linea_id: 'l1', tipo: 'rec', nombre: 'Primer Contacto · Recordatorio 1', variantes: [], vence: iso(ahora - 26 * H), fijo: false, estado: 'enviado', a_mano: false, texto: '¿Qué te pareció la información?', motivo: null, creado_en: iso(ahora - 50 * H), cerrado_en: iso(ahora - 2 * H) },
    { id: 'q5', contacto_id: 'c1', linea_id: 'l1', tipo: 'react', nombre: 'Primer Contacto · Reactivación 2', variantes: [], vence: iso(ahora - 30 * H), fijo: false, estado: 'cancelado', a_mano: false, texto: null, motivo: 'El cliente respondió', creado_en: iso(ahora - 40 * H), cerrado_en: iso(ahora - 29 * H) },
  ],
  siguelo_seguimientos: [
    { contacto_id: 'c1', rec: { etapa_id: 'e1', origen: ahora - 50 * H, paso: 2, ultimo_envio: ahora - 3 * H }, react: { etapa_id: 'e1', activo: true, ciclo: 2, inicio: ahora - H, origen: ahora - H, paso: 0, ultimo_envio: null }, respondio: false, pausado: false, ultimo_automatico: iso(ahora - 3 * H), actualizado_en: iso(ahora - H) },
    { contacto_id: 'c2', rec: { etapa_id: 'e1', origen: ahora - 21 * H, paso: 0, ultimo_envio: null }, react: null, respondio: true, pausado: false, ultimo_automatico: null, actualizado_en: iso(ahora - 2 * H) },
    { contacto_id: 'c3', rec: { etapa_id: 'e1', origen: ahora - 60 * 24 * H, paso: 0, ultimo_envio: null, previo: true }, react: null, respondio: false, pausado: true, ultimo_automatico: iso(ahora - 2 * H), actualizado_en: iso(ahora - 3 * H) },
  ],
  siguelo_registro: [
    { id: 'r1', tipo: 'enviado', texto: 'Sin nombre: salió "Primer Contacto · Recordatorio 1".', creado_en: iso(ahora - 2 * H) },
    { id: 'r2', tipo: 'respondio', texto: 'Bruno: Respondió: atender. Sus recordatorios esperan hasta que le escribas.', creado_en: iso(ahora - 90 * 60000) },
    { id: 'r3', tipo: 'reactivacion', texto: 'Ana Rojas: Le escribiste: empieza su reactivación por si no responde.', creado_en: iso(ahora - H) },
  ],
  lineas_whatsapp: [{ id: 'l1', nombre: 'Quillacollo', numero: '59171111111', estado: 'activo' }, { id: 'l2', nombre: 'El Alto', numero: '59172222222', estado: 'activo' }, { id: 'l3', nombre: 'Cercado', numero: '59173333333', estado: 'activo' }],
  siguelo_cursos: [
    { id: 'k1', empresa_id: E, negocio_id: null, nombre: 'Curso de mecánica de motos', activo: true, precio: 150, moneda: 'Bs', qr_url: QR, destinatario: 'Juan Pérez Gómez', cuenta: '10000012345678', link_grupo: 'https://chat.whatsapp.com/ABC', datos: ['nombre', 'cp1'], etapa_id: null, max_horas: 72, textos: {}, creado_en: iso(ahora - 30 * 24 * H) },
    { id: 'k2', empresa_id: E, negocio_id: null, nombre: 'Taller de electricidad', activo: true, precio: 250, moneda: 'Bs', qr_url: null, destinatario: 'Juan Pérez Gómez', cuenta: '', link_grupo: '', datos: ['nombre'], etapa_id: null, max_horas: 72, textos: {}, creado_en: iso(ahora - 20 * 24 * H) },
  ],
  campos_personalizados: [{ id: 'cp1', empresa_id: E, nombre: 'Carnet', tipo: 'texto', orden: 0 }, { id: 'cp2', empresa_id: E, nombre: 'Correo', tipo: 'texto', orden: 1 }],
  siguelo_pagos: [
    { id: 'p1', contacto_id: 'c2', telefono: '59170000002', curso_id: 'k1', media_url: QR, estado: 'revisar', lectura: { pagador: 'Bruno Vargas' }, controles: [{ codigo: 'monto', nombre: 'Monto', ok: true, detalle: 'Precio Bs 150, pagó Bs 150' }, { codigo: 'destinatario', nombre: 'Destinatario', ok: true, detalle: '' }, { codigo: 'fecha', nombre: 'Fecha', ok: true, detalle: 'Reciente' }, { codigo: 'repetido', nombre: 'No repetido', ok: true, detalle: '' }, { codigo: 'edicion', nombre: 'Sin señales de edición', ok: false, detalle: 'El monto tiene otra tipografía' }], motivo: 'El monto tiene otra tipografía', monto: 150, transaccion: 'TX99812', datos: {}, accion: null, creado_en: iso(ahora - 20 * 60000), actualizado_en: iso(ahora - 20 * 60000) },
    { id: 'p2', contacto_id: 'c1', telefono: '59170000001', curso_id: 'k1', media_url: QR, estado: 'datos', lectura: {}, controles: [], motivo: null, monto: 150, transaccion: 'TX99700', datos: { nombre: 'Ana Rojas Mendoza' }, accion: null, creado_en: iso(ahora - 2 * H), actualizado_en: iso(ahora - H) },
    { id: 'p3', contacto_id: 'c4', telefono: '59170000004', curso_id: 'k1', media_url: QR, estado: 'inscrito', lectura: {}, controles: [], motivo: null, monto: 150, transaccion: 'TX99001', datos: { nombre: 'Juan Pérez', cp1: '1234567 LP' }, accion: null, creado_en: iso(ahora - 26 * H), actualizado_en: iso(ahora - 25 * H) },
    { id: 'p4', contacto_id: null, telefono: '59170000009', curso_id: null, media_url: QR, estado: 'rechazado', lectura: {}, controles: [{ codigo: 'monto', nombre: 'Monto', ok: false, detalle: '' }], motivo: 'el monto (Bs 100) no alcanza al precio (Bs 150)', monto: 100, transaccion: 'TX1', datos: {}, accion: null, creado_en: iso(ahora - 5 * H), actualizado_en: iso(ahora - 5 * H) },
  ],
  siguelo_asistente: [
    { id: 'a1', rol: 'usuario', texto: '¿Cuándo salen los recordatorios?', acciones: [], aplicado_en: null, resultado: null, creado_en: iso(ahora - 10 * 60000) },
    { id: 'a2', rol: 'asistente', texto: 'En "Primer Contacto" salen al día 1 y al día 4 desde que el cliente entra a la etapa, de 8:00 a 20:00 y como máximo 30 por día en cada número.', acciones: [], aplicado_en: null, resultado: null, creado_en: iso(ahora - 9 * 60000) },
    { id: 'a3', rol: 'usuario', texto: 'Pon las reactivaciones de 1, 3, 5 y 8 horas y los recordatorios al día 1, 3 y 5', acciones: [], aplicado_en: null, resultado: null, creado_en: iso(ahora - 5 * 60000) },
    { id: 'a4', rol: 'asistente', texto: `Listo, te preparé los cambios:
• La reactivación sale a la 1, 3, 5 y 8 horas después de que le escribes.
• Los recordatorios al día 1, 3 y 5. Para el del día 5 te escribí un texto nuevo con la información de tu negocio.
Pulsa "Aplicar" para hacerlo.`, acciones: [{ tipo: 'secuencia', descripcion: 'Reactivación de "Primer Contacto": 4 mensajes a 1 h, 3 h, 5 h y 8 h, contados desde que le escribiste, con textos nuevos' }, { tipo: 'secuencia', descripcion: 'Recordatorios de "Primer Contacto": 3 mensajes a 1 día, 3 días y 5 días, contados desde que entra a la etapa, con textos nuevos' }], aplicado_en: null, resultado: null, creado_en: iso(ahora - 4 * 60000) },
  ],
  siguelo_contador: [{ empresa_id: E, linea_id: 'l1', fecha: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date()), enviados: 4 }],
};

(window as any).__ops = [];

class Consulta {
  private filtros: ((f: Fila) => boolean)[] = [];
  private orden: [string, boolean][] = [];
  private lim = 0;
  private op = 'select';
  private datos: any;
  private cols = '*';
  private uno: '' | 'quizas' | 'uno' = '';
  constructor(private t: string) {}
  private devolver = false;
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.devolver = true; return this; }
  insert(d: any) { this.op = 'insert'; this.datos = d; return this; }
  upsert(d: any) { this.op = 'upsert'; this.datos = d; return this; }
  update(d: any) { this.op = 'update'; this.datos = d; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filtros.push((f) => f[c] === v); return this; }
  neq(c: string, v: any) { this.filtros.push((f) => f[c] !== v); return this; }
  in(c: string, v: any[]) { this.filtros.push((f) => v.includes(f[c])); return this; }
  gte(c: string, v: any) { this.filtros.push((f) => f[c] >= v); return this; }
  lte(c: string, v: any) { this.filtros.push((f) => f[c] <= v); return this; }
  lt(c: string, v: any) { this.filtros.push((f) => f[c] < v); return this; }
  gt(c: string, v: any) { this.filtros.push((f) => f[c] > v); return this; }
  is(c: string, v: any) { this.filtros.push((f) => (f[c] ?? null) === v); return this; }
  not(c: string, _op: string, v: any) { this.filtros.push((f) => (f[c] ?? null) !== v); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { this.orden.push([c, o.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  returns() { return this; }
  maybeSingle() { this.uno = 'quizas'; return this; }
  single() { this.uno = 'uno'; return this; }
  then(ok: any, mal: any) { return Promise.resolve(this.correr()).then(ok, mal); }
  private correr() {
    if (falta && this.t.startsWith('siguelo_')) return { data: null, error: { message: `relation "${this.t}" does not exist` } };
    const tabla = (tablas[this.t] ||= []);
    const pasa = (f: Fila) => this.filtros.every((fn) => fn(f));
    if (this.op !== 'select') {
      (window as any).__ops.push({ tabla: this.t, op: this.op, datos: this.datos });
      let tocadas: Fila[] = [];
      if (this.op === 'insert') {
        tocadas = ([].concat(this.datos) as Fila[]).map((d) => ({ id: `id-${Math.random().toString(36).slice(2, 8)}`, ...d }));
        tabla.push(...tocadas);
      }
      if (this.op === 'upsert') for (const d of [].concat(this.datos) as Fila[]) {
        const k = ['linea_id', 'etapa_id', 'id'].find((c) => c in d) || 'empresa_id';
        const i = tabla.findIndex((f) => f[k] === d[k]);
        if (i >= 0) tabla[i] = { ...tabla[i], ...d }; else tabla.push(d);
        tocadas.push(d);
      }
      if (this.op === 'update') for (const f of tabla) if (pasa(f)) Object.assign(f, this.datos);
      if (this.op === 'delete') tablas[this.t] = tabla.filter((f) => !pasa(f));
      if (this.devolver) return { data: this.uno ? tocadas[0] ?? null : tocadas, error: null };
      return { data: null, error: null };
    }
    let filas = tabla.filter(pasa).map((f) => ({ ...f }));
    if (this.cols.includes('contactos(')) for (const f of filas) f.contactos = tablas.contactos.find((c) => c.id === f.contacto_id) ?? null;
    for (const [c, asc] of [...this.orden].reverse()) filas.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
    if (this.lim) filas = filas.slice(0, this.lim);
    if (this.uno) return { data: filas[0] ?? null, error: null };
    return { data: filas, error: null };
  }
}

export const supabase = {
  from: (t: string) => new Consulta(t),
  channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; },
  removeChannel: () => undefined,
  auth: { getSession: async () => ({ data: { session: null } }) },
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (r: string) => ({ data: { publicUrl: `https://falso/${r}` } }) }) },
};
