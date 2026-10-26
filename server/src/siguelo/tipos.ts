// Tipos del seguimiento automático (SígueloCRM), según database/siguelo.sql.
// Van aparte de types/dominio.ts (el del curso) para no mezclar archivos.

export type Paso = { horas: number; variantes: string[] };
export type Modo = 'origen' | 'encadenado';
export type Secuencia = { activa: boolean; modo: Modo; pasos: Paso[] };
export type AlTerminar = { etapa_id: string | null; dias: number };
export type Pie = { activo: boolean; variantes: string[] };

export type TipoSecuencia = 'rec' | 'react';

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
  actualizado_en: string;
};

export type EtapaConfigRow = {
  id: string;
  etapa_id: string;
  empresa_id: string;
  // Fase de negocios por número: textos propios de un negocio. null = los de todos.
  negocio_id: string | null;
  recordatorios: Secuencia;
  reactivacion: Secuencia;
  al_terminar: AlTerminar;
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
  tipo: TipoSecuencia;
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
  creado_en: string;
  actualizado_en: string;
};
export type LineaNegocioRow = { linea_id: string; empresa_id: string; negocio_id: string };
export type BotNegocioRow = { regla_id: string; negocio_id: string };

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
      etapas_venta: Tabla<EtapaVentaRow>;
      contactos: Tabla<ContactoSigueloRow>;
      conversaciones: Tabla<{ id: string; linea_id: string; contacto_telefono: string; contacto_nombre: string | null; ultima_actividad: string }>;
      lineas_whatsapp: Tabla<{ id: string; empresa_id: string; nombre: string }>;
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
        contacto_id: string;
        estado: 'abierta' | 'ganada' | 'perdida';
        probabilidad: number;
        motivo_perdida_id: string | null;
        cerrada_en: string | null;
        actualizado_en: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      siguelo_actividad: { Args: { p_empresa: string }; Returns: ActividadRow[] };
    };
  };
};
