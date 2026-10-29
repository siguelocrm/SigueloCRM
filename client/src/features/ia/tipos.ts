// Tipos de la IA (Fase 3), según database/siguelo.sql (secciones 13 a 18) y
// server/src/siguelo/tipos.ts.

export type ModoIA = 'apagado' | 'borrador' | 'automatico';
export type TipoAviso = 'fuera' | 'compro' | 'pregunta' | 'molesto' | 'humano' | 'otro';

export interface AjustesIA {
  empresa_id: string;
  activa: boolean;
  modo: ModoIA;
  modelo: string;
  clave_final: string | null;
  estilo: { tono: string; trato: string; emojis: string; largo: string; saltos: string; usar_nombre: boolean };
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
  acciones: { mover_etapa: boolean; no_quiere_mas: boolean; respuestas_rapidas: boolean; pases: boolean; grupos: boolean };
  avisos: { activo: boolean; telefono: string; linea_id: string | null; tipos: Partial<Record<TipoAviso | 'pago' | 'redes', boolean>>; max_dia: number; juntar_min: number };
}

export interface ItemSalida {
  id: string;
  conversacion_id: string | null;
  contacto_id: string | null;
  linea_id: string;
  telefono: string;
  origen: 'respuesta' | 'respuesta_rapida' | 'grupo' | 'pase' | 'aviso';
  tipo: string;
  contenido: string;
  media_url: string | null;
  estado: string;
  motivo: string | null;
  lote: string | null;
  orden: number;
  creado_en: string;
  contactos: { nombre: string | null; telefono: string } | null;
}

export interface Lectura {
  conversacion_id: string;
  contacto_id: string | null;
  linea_id: string | null;
  resumen: string | null;
  interes: string | null;
  atencion: { tipo: TipoAviso; motivo: string; ts: number; hecho: number | null } | null;
  sin_respuestas: boolean;
  actualizado_en: string;
  contactos: { nombre: string | null; telefono: string } | null;
}

export const TIPOS_AVISO: Record<TipoAviso, string> = {
  fuera: 'Le interesa algo que no está en la ficha',
  compro: 'Compró, se inscribió, pagó o confirmó',
  pregunta: 'Pregunta algo que solo tú puedes responder',
  molesto: 'Está molesto o se queja',
  humano: 'Pide hablar con una persona',
  otro: 'Otro asunto importante',
};

export const ESTILO: Record<string, Record<string, string>> = {
  tono: { amable: 'Amable y cálido', profesional: 'Profesional y claro', cercano: 'Cercano y relajado', entusiasta: 'Entusiasta, con energía', formal: 'Formal y respetuoso' },
  trato: { tu: 'Tutear (tú)', usted: 'Ustedear (usted)' },
  emojis: { ninguno: 'Sin emojis', pocos: 'Pocos (0 o 1)', normal: 'Normal (1 a 3)', muchos: 'Muchos' },
  largo: { corto: 'Muy corto (1 o 2 frases)', medio: 'Corto (2 a 4 frases)', detallado: 'Detallado si hace falta' },
  saltos: { nada: 'Todo en un párrafo', pocos: 'Pocos párrafos', normal: 'Párrafos cortos', muchos: 'Una idea por línea' },
};

// Precio aproximado por millón de tokens [entrada, salida] en dólares (los de la extensión).
export const PRECIOS: Record<string, [number, number]> = { 'gpt-6-luna': [0.1, 0.5], 'gpt-6.1-sol': [2, 10], 'gpt-6-astra': [10, 50] };

export const ajustesIAPorDefecto = (empresaId: string): AjustesIA => ({
  empresa_id: empresaId,
  activa: false,
  modo: 'borrador',
  modelo: 'gpt-6-luna',
  clave_final: null,
  estilo: { tono: 'amable', trato: 'tu', emojis: 'pocos', largo: 'medio', saltos: 'normal', usar_nombre: true },
  firma: '',
  instrucciones: '',
  ejemplos: '',
  si_no_sabe: 'avisar',
  texto_espera: 'Déjame consultarlo y te respondo en un momento 🙏',
  desde: '07:00',
  hasta: '22:00',
  espera_min_seg: 20,
  espera_max_seg: 60,
  max_por_cliente_dia: 10,
  max_respuestas_dia: 150,
  max_consultas_dia: 500,
  pausa_si_escribes_min: 30,
  acciones: { mover_etapa: true, no_quiere_mas: true, respuestas_rapidas: true, pases: true, grupos: true },
  avisos: { activo: false, telefono: '', linea_id: null, tipos: { fuera: true, compro: true, pregunta: true, molesto: true, humano: true, otro: false }, max_dia: 30, juntar_min: 5 },
});
