// Tipos del seguimiento automático, según database/siguelo.sql (los mismos
// que usa el servidor en server/src/siguelo/tipos.ts).

export type Paso = { horas: number; variantes: string[] };
export type Modo = 'origen' | 'encadenado';
export type Secuencia = { activa: boolean; modo: Modo; pasos: Paso[] };
export type AlTerminar = { etapa_id: string | null; dias: number };
export type Pie = { activo: boolean; variantes: string[] };

export interface AjustesSeguimiento {
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
}

export interface EtapaSeguimiento {
  id?: string;
  etapa_id: string;
  empresa_id: string;
  // Fase de negocios por número: textos propios de un negocio. null = los de todos.
  negocio_id: string | null;
  recordatorios: Secuencia;
  reactivacion: Secuencia;
  al_terminar: AlTerminar;
}

export interface EstadoRec {
  etapa_id: string;
  origen: number;
  paso: number;
  ultimo_envio: number | null;
  previo?: boolean;
}

export interface EstadoReact {
  etapa_id: string;
  activo: boolean;
  ciclo: number;
  inicio: number;
  origen: number;
  paso: number;
  ultimo_envio: number | null;
}

export interface SeguimientoContacto {
  contacto_id: string;
  rec: EstadoRec | null;
  react: EstadoReact | null;
  respondio: boolean;
  pausado: boolean;
  ultimo_automatico: string | null;
  actualizado_en: string;
  contactos: { nombre: string | null; telefono: string; etapa_id: string | null } | null;
}

export type EstadoCola = 'pendiente' | 'enviando' | 'enviado' | 'cancelado' | 'error';

export interface ItemCola {
  id: string;
  contacto_id: string;
  linea_id: string;
  tipo: 'rec' | 'react';
  nombre: string;
  variantes: string[];
  vence: string;
  fijo: boolean;
  estado: EstadoCola;
  a_mano: boolean;
  texto: string | null;
  motivo: string | null;
  creado_en: string;
  cerrado_en: string | null;
  contactos: { nombre: string | null; telefono: string } | null;
}

export interface RegistroSeguimiento {
  id: string;
  tipo: string;
  texto: string;
  creado_en: string;
}
