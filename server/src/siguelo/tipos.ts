// Tipos del seguimiento automático (SígueloCRM), según database/siguelo.sql.
// Van aparte de types/dominio.ts (el del curso) para no mezclar archivos.

export type Paso = { horas: number; variantes: string[] };
export type Modo = 'origen' | 'encadenado';
export type Secuencia = { activa: boolean; modo: Modo; pasos: Paso[] };
export type AlTerminar = { etapa_id: string | null; dias: number };
export type Pie = { activo: boolean; variantes: string[] };

export type TipoSecuencia = 'rec' | 'react';

// Fase 4: citas y sus mensajes.
export type PasoCita = { ref: 'inicio' | 'fin'; horas: number; variantes: string[] };
export type ConfigCitas = { activa: boolean; desde: string; hasta: string; max_atraso_min: number; pasos: PasoCita[] };
export type CitaRow = { id: string; empresa_id: string; contacto_id: string; inicio: string; fin: string; nota: string | null; estado: 'agendada' | 'cancelada'; paso: number; creado_en: string; actualizado_en: string };

// Estado de cada contacto. Los tiempos van en milisegundos (Date.now()).
export type EstadoRec = {
  etapa_id: string;
  origen: number;
  paso: number;
  ultimo_envio: number | null;
  // Ya estaba en la etapa antes de activar el seguimiento: no recibe recordatorios.
  previo?: boolean;
};
export type EstadoReact = {
  etapa_id: string;
  activo: boolean;
  ciclo: number;
  inicio: number;
  origen: number;
  paso: number;
  ultimo_envio: number | null;
};

export type AjustesRow = {
  empresa_id: string;
  activo: boolean;
  activado_en: string | null;
  pausado: boolean;
  motivo_pausa: string | null;
  zona_horaria: string;
  hora_inicio: string;
  hora_fin: string;
  pausa_min_seg: number;
  pausa_max_seg: number;
  maximo_diario: number;
  min_entre_misma_persona_min: number;
  no_recordar_si_escribio_horas: number;
  atraso_max_reactivacion_horas: number;
  ciclos_reactivacion_cada_horas: number;
  pie: Pie;
  // Fase 4: "stop" (sin la Fase 4 pegada, no viene).
  stop?: Stop | null;
  citas?: ConfigCitas | null;
  // La IA adapta cada recordatorio y reactivación a la conversación.
  adaptar?: Adaptar | null;
  actualizado_en: string;
};
export type Stop = { activo: boolean; palabras: string[]; parecidas: string[]; respuesta: string };
export type PalabrasEtapa = { cliente: string[]; parecidas: string[]; tuyas: string[]; respuesta: string };
export type Revisar = { etapa_id: string; texto: string; ts: number };
export type Deshacer = { etapa_antes: string; desde_antes: string | null; descripcion: string; ts: number };

export type EtapaConfigRow = {
  id: string;
  etapa_id: string;
  empresa_id: string;
  // Fase de negocios por número: textos propios de un negocio. null = los de todos.
  negocio_id: string | null;
  recordatorios: Secuencia;
  reactivacion: Secuencia;
  al_terminar: AlTerminar;
  // Fase 4: palabras que cambian de etapa.
  palabras?: Partial<PalabrasEtapa> | null;
  actualizado_en: string;
};

export type SeguimientoRow = {
  contacto_id: string;
  empresa_id: string;
  rec: EstadoRec | null;
  react: EstadoReact | null;
  respondio: boolean;
  pausado: boolean;
  visto_cliente: string | null;
  visto_agente: string | null;
  ultimo_automatico: string | null;
  ultimo_texto_auto: string | null;
  // Fase 4: espera que lo revises / lo último que se movió solo.
  revisar?: Revisar | null;
  deshacer?: Deshacer | null;
  creado_en: string;
  actualizado_en: string;
};

export type EstadoCola = 'pendiente' | 'enviando' | 'enviado' | 'cancelado' | 'error';

export type ColaRow = {
  id: string;
  empresa_id: string;
  contacto_id: string;
  conversacion_id: string;
  linea_id: string;
  telefono: string;
  tipo: TipoSecuencia | 'cita';
  etapa_id: string | null;
  paso: number;
  token: string;
  nombre: string;
  variantes: string[];
  vence: string;
  max_atraso_ms: number | null;
  fijo: boolean;
  estado: EstadoCola;
  a_mano: boolean;
  texto: string | null;
  motivo: string | null;
  mensaje_id: string | null;
  whatsapp_id: string | null;
  creado_en: string;
  cerrado_en: string | null;
};

export type ContadorRow = { empresa_id: string; linea_id: string; fecha: string; enviados: number };

export type RegistroRow = {
  id: string;
  empresa_id: string;
  contacto_id: string | null;
  tipo: string;
  texto: string;
  creado_en: string;
};

// Lo que devuelve la función siguelo_actividad(p_empresa).
export type ActividadRow = {
  contacto_id: string;
  telefono: string;
  nombre: string | null;
  etapa_id: string;
  etapa_actualizada_en: string | null;
  contacto_creado_en: string;
  conversacion_id: string;
  linea_id: string;
  primer_mensaje: string | null;
  ultimo_cliente: string | null;
  ultimo_saliente: string | null;
  ultimo_manual: string | null;
};

// Fase 2: cada número trabaja como un negocio con su ficha.
export type NegocioRow = {
  id: string;
  empresa_id: string;
  nombre: string;
  sucursal: string | null;
  direccion: string | null;
  horario: string | null;
  info_ia: string;
  embudo_id: string | null;
  // Fase 3: la IA responde en este negocio, zonas que atiende y grupos a los que puede invitar.
  ia_activa: boolean;
  zonas: string | null;
  grupos: GrupoNegocio[];
  // Sucursal de este negocio en el sistema del club (null = no está conectado).
  club_sucursal_id?: string | null;
  creado_en: string;
  actualizado_en: string;
};
export type GrupoNegocio = { id: string; nombre: string; link: string; cuando: string };
export type LineaNegocioRow = { linea_id: string; empresa_id: string; negocio_id: string };
export type BotNegocioRow = { regla_id: string; negocio_id: string };

// ---------- Fase 3: IA ----------
export type ModoIA = 'apagado' | 'borrador' | 'automatico';
export type TipoAviso = 'fuera' | 'compro' | 'pregunta' | 'molesto' | 'humano' | 'otro';
export type EstiloIA = { tono: string; trato: string; emojis: string; largo: string; saltos: string; usar_nombre: boolean };
export type AccionesIA = { mover_etapa: boolean; no_quiere_mas: boolean; respuestas_rapidas: boolean; pases: boolean; grupos: boolean };
export type AvisosIA = {
  activo: boolean;
  telefono: string;
  linea_id: string | null;
  // Más "pago" (Fase 5): pagos e inscripciones (encendido si no está).
  tipos: Partial<Record<TipoAviso | 'pago', boolean>>;
  max_dia: number;
  juntar_min: number;
};

export type IaRow = {
  empresa_id: string;
  activa: boolean;
  modo: ModoIA;
  modelo: string;
  clave_final: string | null;
  estilo: EstiloIA;
  firma: string;
  instrucciones: string;
  ejemplos: string;
  si_no_sabe: 'avisar' | 'espera';
  texto_espera: string;
  desde: string;
  hasta: string;
  espera_min_seg: number;
  espera_max_seg: number;
  max_por_cliente_dia: number;
  max_respuestas_dia: number;
  max_consultas_dia: number;
  pausa_si_escribes_min: number;
  acciones: AccionesIA;
  avisos: AvisosIA;
  actualizado_en: string;
};

export type AtencionIA = { tipo: TipoAviso; motivo: string; ts: number; hecho: number | null };

export type LecturaRow = {
  conversacion_id: string;
  empresa_id: string;
  contacto_id: string | null;
  linea_id: string | null;
  leido_hasta: string | null;
  fallos: number;
  reintentar_en: string | null;
  resumen: string | null;
  interes: string | null;
  atencion: AtencionIA | null;
  sin_respuestas: boolean;
  avisado: Partial<Record<TipoAviso, number>>;
  espera_enviada: string | null;
  actualizado_en: string;
};

export type OrigenSalida = 'respuesta' | 'respuesta_rapida' | 'grupo' | 'pase' | 'aviso' | 'qr' | 'pago' | 'bot';
export type SalidaRow = {
  id: string;
  empresa_id: string;
  conversacion_id: string | null;
  contacto_id: string | null;
  linea_id: string;
  telefono: string;
  origen: OrigenSalida;
  referencia: string | null;
  tipo: 'texto' | 'imagen' | 'pdf' | 'documento' | 'audio';
  contenido: string;
  media_url: string | null;
  mimetype: string | null;
  vence: string;
  estado: 'borrador' | 'pendiente' | 'enviando' | 'enviado' | 'cancelado' | 'error';
  aprobado: boolean;
  base_cliente: string | null;
  motivo: string | null;
  lote: string | null;
  orden: number;
  mensaje_id: string | null;
  whatsapp_id: string | null;
  creado_en: string;
  cerrado_en: string | null;
};

export type PorLeerRow = { conversacion_id: string; linea_id: string; telefono: string; contacto_id: string | null; ultimo_cliente: string };

export type Adaptar = { activo: boolean; recordatorios: boolean; reactivaciones: boolean; instrucciones: string };

// Lo que propone el asistente (se hace al pulsar "Aplicar").
export type MensajeAsistenteRow = {
  id: string;
  empresa_id: string;
  usuario_id: string | null;
  rol: 'usuario' | 'asistente';
  texto: string;
  acciones: Record<string, unknown>[];
  aplicado_en: string | null;
  resultado: string | null;
  creado_en: string;
};

// ---------- Fase 5: inscripción con pago ----------
export type TextosCurso = { confirmado: string; pedir_datos: string; falta: string; link: string; revisar: string; rechazado: string; reservado: string };
export type CursoRow = {
  id: string;
  empresa_id: string;
  negocio_id: string | null;
  nombre: string;
  activo: boolean;
  precio: number;
  moneda: string;
  qr_url: string | null;
  destinatario: string;
  cuenta: string;
  link_grupo: string;
  datos: string[];
  etapa_id: string | null;
  max_horas: number;
  textos: TextosCurso;
  // Al pagar, la inscripción queda como reserva en el sistema del club.
  club?: boolean;
  creado_en: string;
  actualizado_en: string;
};

// Lo que la IA lee de un comprobante.
export type LecturaComprobante = {
  es_comprobante: boolean;
  monto: number | null;
  moneda: string | null;
  fecha: string | null; // "YYYY-MM-DD HH:mm"
  transaccion: string | null;
  pagador: string | null;
  banco: string | null;
  destinatario: string | null;
  cuenta_destino: string | null;
  glosa: string | null;
  senales_edicion: string[];
  confianza: number;
};
export type ControlPago = { codigo: string; nombre: string; ok: boolean; detalle: string };
export type EstadoPago = 'leyendo' | 'no_es' | 'revisar' | 'rechazado' | 'datos' | 'reservado' | 'inscrito';
// Lo que se va juntando para la reserva en el club: grupo = id del grupo del club.
// curso_texto: "Ajedrez (Lunes/Miércoles/Viernes · 16:00 a 17:00)", se llena al dejar la reserva.
export type DatosClub = { tutor: string | null; estudiantes: { nombre: string | null; fecha_nacimiento: string | null; grupo: string | null; curso_texto?: string | null }[] };
export type PagoRow = {
  id: string;
  empresa_id: string;
  contacto_id: string | null;
  conversacion_id: string | null;
  linea_id: string | null;
  telefono: string;
  curso_id: string | null;
  mensaje_id: string | null;
  media_url: string | null;
  estado: EstadoPago;
  lectura: LecturaComprobante | null;
  controles: ControlPago[];
  motivo: string | null;
  monto: number | null;
  transaccion: string | null;
  pagado_en: string | null;
  datos: Record<string, string>;
  datos_desde: string | null;
  datos_leido: string | null;
  rondas: number;
  accion: 'confirmar' | 'rechazar' | null;
  intentos: number;
  oportunidad_id: string | null;
  avisado: boolean;
  club?: DatosClub | null;
  club_reserva_id?: string | null;
  club_revisado_en?: string | null;
  creado_en: string;
  actualizado_en: string;
};
export type PagoPorLeerRow = {
  mensaje_id: string;
  conversacion_id: string;
  linea_id: string;
  telefono: string;
  contacto_id: string | null;
  tipo: string;
  media_url: string;
  contenido: string | null;
  creado_en: string;
};

// Columnas de las tablas del curso que usa el seguimiento.
export type EtapaVentaRow = {
  id: string;
  empresa_id: string;
  nombre: string;
  tipo: 'normal' | 'ganada' | 'perdida';
  orden: number;
  probabilidad: number | null;
};

export type ContactoSigueloRow = {
  id: string;
  empresa_id: string;
  telefono: string;
  nombre: string | null;
  etapa_id: string | null;
  etapa_actualizada_en: string | null;
  motivo_perdida_id: string | null;
  probabilidad_cierre: number | null;
};

type Tabla<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type SigueloDatabase = {
  public: {
    Tables: {
      siguelo_ajustes: Tabla<AjustesRow>;
      siguelo_etapas: Tabla<EtapaConfigRow>;
      siguelo_seguimientos: Tabla<SeguimientoRow>;
      siguelo_cola: Tabla<ColaRow>;
      siguelo_contador: Tabla<ContadorRow>;
      siguelo_registro: Tabla<RegistroRow>;
      siguelo_negocios: Tabla<NegocioRow>;
      siguelo_lineas: Tabla<LineaNegocioRow>;
      siguelo_bot_negocio: Tabla<BotNegocioRow>;
      siguelo_citas: Tabla<CitaRow>;
      etapas_venta: Tabla<EtapaVentaRow>;
      contactos: Tabla<ContactoSigueloRow>;
      conversaciones: Tabla<{
        id: string;
        linea_id: string;
        contacto_telefono: string;
        contacto_nombre: string | null;
        estado: 'abierto' | 'pendiente' | 'cerrado';
        ultima_actividad: string;
        creado_en: string;
      }>;
      lineas_whatsapp: Tabla<{ id: string; empresa_id: string; nombre: string; estado: string }>;
      siguelo_ia: Tabla<IaRow>;
      siguelo_ia_clave: Tabla<{ empresa_id: string; clave: string; actualizado_en: string }>;
      siguelo_ia_lecturas: Tabla<LecturaRow>;
      siguelo_ia_salida: Tabla<SalidaRow>;
      siguelo_ia_uso: Tabla<{ empresa_id: string; fecha: string; consultas: number; entrada: number; salida: number }>;
      siguelo_etapa_embudo: Tabla<{ etapa_id: string; embudo_id: string }>;
      siguelo_respuesta_negocio: Tabla<{ respuesta_id: string; negocio_id: string }>;
      respuestas_rapidas: Tabla<{ id: string; empresa_id: string; titulo: string; atajo: string | null; contenido: string; tipo: string; media_url: string | null }>;
      notas: Tabla<{ id: string; contacto_id: string; autor_id: string | null; texto: string; creado_en: string }>;
      mensajes: Tabla<{
        id: string;
        conversacion_id: string;
        remitente: 'cliente' | 'agente';
        agente_id: string | null;
        tipo: string;
        contenido: string | null;
        media_url: string | null;
        whatsapp_id: string | null;
        creado_en: string;
      }>;
      motivos_perdida: Tabla<{ id: string; empresa_id: string; nombre: string }>;
      oportunidades: Tabla<{
        id: string;
        empresa_id: string;
        contacto_id: string;
        producto: string | null;
        monto: number;
        nota: string | null;
        creado_en: string;
        estado: 'abierta' | 'ganada' | 'perdida';
        probabilidad: number;
        motivo_perdida_id: string | null;
        cerrada_en: string | null;
        actualizado_en: string;
      }>;
      siguelo_cursos: Tabla<CursoRow>;
      siguelo_asistente: Tabla<MensajeAsistenteRow>;
      siguelo_cuando_ia: Tabla<{ empresa_id: string; tipo: 'respuesta' | 'bot'; item_id: string; cuando: string; actualizado_en: string }>;
      respuestas_automaticas: Tabla<{ id: string; empresa_id: string; nombre: string | null; palabra_clave: string; activo: boolean; tipo: string; flujo: unknown; pasos: unknown[] }>;
      bot_sesiones: Tabla<{ conversacion_id: string; regla_id: string; nodo_id: string; linea_id: string; telefono: string; actualizado_en: string }>;
      siguelo_club: Tabla<{ empresa_id: string; url: string; clave_publica: string; usuario: string; contrasena: string; actualizado_en: string }>;
      siguelo_club_info: Tabla<{ empresa_id: string; conectado: boolean; vendedor: string | null; sucursales: { id: string; nombre: string; departamento?: string | null }[]; error: string | null; actualizado_en: string }>;
      usuarios: Tabla<{ id: string; empresa_id: string; nombre: string; rol: 'dueno' | 'supervisor' | 'vendedor' | 'atendedor_online'; linea_id: string | null; activo: boolean; creado_en: string }>;
      siguelo_accesos: Tabla<{ usuario_id: string; empresa_id: string; jefe_id: string | null; principal: boolean; todas_lineas: boolean; lineas: string[]; vence_en: string | null; actualizado_en: string }>;
      siguelo_embudos: Tabla<{ id: string; empresa_id: string; nombre: string; creado_en: string }>;
      siguelo_pagos: Tabla<PagoRow>;
      campos_personalizados: Tabla<{ id: string; empresa_id: string; nombre: string; tipo: string; opciones: string[]; orden: number }>;
      contacto_campos: Tabla<{ contacto_id: string; campo_id: string; valor: string | null }>;
      contacto_documentos: Tabla<{ id: string; contacto_id: string; nombre: string; ruta: string; url: string; tamano: number | null; subido_por: string | null; creado_en: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      siguelo_actividad: { Args: { p_empresa: string }; Returns: ActividadRow[] };
      siguelo_ia_por_leer: { Args: { p_empresa: string; p_quieto_seg: number }; Returns: PorLeerRow[] };
      siguelo_pagos_por_leer: { Args: { p_empresa: string }; Returns: PagoPorLeerRow[] };
    };
  };
};
