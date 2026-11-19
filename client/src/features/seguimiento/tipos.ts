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
  // Límites y pausa de cada número (sección 47 de siguelo.sql; sin ella no viene).
  por_numero?: Record<string, AjustesNumero> | null;
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
  // Los de esta etapa ya concretaron (inscritos, van a asistir): sin recordatorios ni reactivaciones.
  sin_seguimiento?: boolean;
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

export type AjustesNumero = { maximo_diario?: number | null; pausa_min_seg?: number | null; pausa_max_seg?: number | null; pausado?: boolean };

// Lo de un número: lo propio o, si no tiene, lo general (como server/src/siguelo/cola.ts).
export function delNumero(aj: AjustesSeguimiento, lineaId: string) {
  const p = aj.por_numero?.[lineaId] ?? {};
  const num = (v: unknown, general: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : general);
  return {
    maximo_diario: num(p.maximo_diario, aj.maximo_diario),
    pausa_min_seg: num(p.pausa_min_seg, aj.pausa_min_seg),
    pausa_max_seg: num(p.pausa_max_seg, aj.pausa_max_seg),
    pausado: !!p.pausado,
  };
}
