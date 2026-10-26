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
  // Fase 4 (sin la Fase 4 pegada, no viene).
  stop?: Stop;
  citas?: ConfigCitas;
  // La IA adapta cada recordatorio y reactivación a la conversación (sin la última versión del SQL, no viene).
  adaptar?: Adaptar;
}

export type Adaptar = { activo: boolean; recordatorios: boolean; reactivaciones: boolean; instrucciones: string };

export interface EtapaSeguimiento {
  id?: string;
  etapa_id: string;
  empresa_id: string;
  // Fase de negocios por número: textos propios de un negocio. null = los de todos.
  negocio_id: string | null;
  recordatorios: Secuencia;
  reactivacion: Secuencia;
  al_terminar: AlTerminar;
  // Fase 4: palabras que lo pasan a esta etapa.
  palabras?: { cliente: string[]; parecidas: string[]; tuyas: string[]; respuesta: string } | null;
}

export type Stop = { activo: boolean; palabras: string[]; parecidas: string[]; respuesta: string };

// Citas (Fase 4): cada mensaje sale unas horas antes/después del inicio o del fin.
export type PasoCita = { ref: 'inicio' | 'fin'; horas: number; variantes: string[] };
export type ConfigCitas = { activa: boolean; desde: string; hasta: string; max_atraso_min: number; pasos: PasoCita[] };

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
  // Fase 4: espera que lo revises / lo último que se movió solo.
  revisar?: { etapa_id: string; texto: string; ts: number } | null;
  deshacer?: { etapa_antes: string; desde_antes: string | null; descripcion: string; ts: number } | null;
  contactos: { nombre: string | null; telefono: string; etapa_id: string | null } | null;
}

export type EstadoCola = 'pendiente' | 'enviando' | 'enviado' | 'cancelado' | 'error';

export interface ItemCola {
  id: string;
  contacto_id: string;
  linea_id: string;
  tipo: 'rec' | 'react' | 'cita';
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
