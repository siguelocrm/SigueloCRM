// Tipos de las tablas de Supabase que usa el frontend, escritos a mano según
// las columnas que ya usa el código. Ver la nota equivalente en
// `server/src/types/dominio.ts` sobre regenerar esto desde el esquema real.

export type EstadoLinea = 'desconectado' | 'conectando' | 'activo';
export type EstadoConversacion = 'abierto' | 'pendiente' | 'cerrado';
export type TipoMensaje = 'texto' | 'imagen' | 'pdf' | 'audio' | 'documento';
export type Remitente = 'cliente' | 'agente';
// WhatsApp puede aceptar el envío y rechazar la entrega después, de forma
// asíncrona — ver database/instalar.sql.
export type EstadoEntregaMensaje = 'enviado' | 'error';
export type RolUsuario = 'vendedor' | 'atendedor_online' | 'supervisor' | 'dueno';
export type Temperatura = 'frio' | 'tibio' | 'caliente';
// 'normal' es cualquier etapa intermedia (Primer Contacto, En Negociación,
// etc. — el nombre lo define cada empresa); 'ganada'/'perdida' son las
// etapas terminales que alimentan las métricas del Dashboard, sin importar
// cómo las haya renombrado el cliente.
export type TipoEtapa = 'normal' | 'ganada' | 'perdida';

export interface Usuario {
  id: string;
  empresa_id: string;
  nombre: string;
  rol: RolUsuario;
  linea_id: string | null;
  activo: boolean;
  zona_horaria?: string | null;
}

export interface MensajeProgramado {
  id: string;
  conversacion_id: string;
  contenido: string;
  tipo: TipoMensaje;
  media_url: string | null;
  enviar_en: string;
  estado: 'pendiente' | 'enviando' | 'enviado' | 'cancelado' | 'error';
  cancelar_si_responde: boolean;
  motivo: string | null;
  creado_en: string;
}

export interface LineaWhatsapp {
  id: string;
  empresa_id: string;
  nombre: string;
  numero: string | null;
  estado: EstadoLinea;
  creado_en: string;
}

export interface Conversacion {
  id: string;
  linea_id: string;
  contacto_telefono: string;
  contacto_nombre: string | null;
  estado: EstadoConversacion;
  agente_asignado_id: string | null;
  ultima_actividad: string;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  remitente: Remitente;
  agente_id: string | null;
  tipo: TipoMensaje;
  contenido: string | null;
  media_url: string | null;
  creado_en: string;
  whatsapp_id: string | null;
  estado_entrega: EstadoEntregaMensaje;
  error_entrega: string | null;
}

export interface Contacto {
  id: string;
  empresa_id: string;
  telefono: string;
  nombre: string | null;
  producto_interes: string | null;
  origen: string | null;
  temperatura: Temperatura | null;
  etapa_id: string | null;
  etapa_actualizada_en: string | null;
  valor_estimado: number | null;
  probabilidad_cierre: number | null;
  motivo_perdida_id: string | null;
  folio: string | null;
  creado_en: string;
  actualizado_en: string;
}

// Etapa de un pipeline de ventas configurable por empresa — ver
// database/instalar.sql.
export interface EtapaVenta {
  id: string;
  empresa_id: string;
  nombre: string;
  tipo: TipoEtapa;
  orden: number;
  color: number | null;
  /** % de cierre que recibe un contacto al entrar en la etapa; null = no cambia. */
  probabilidad: number | null;
}

export type EstadoOportunidad = 'abierta' | 'ganada' | 'perdida';

// Una venta posible con un contacto. Un contacto puede tener varias; las
// ganadas y perdidas quedan como historial — ver database/032_oportunidades.sql.
export interface Oportunidad {
  id: string;
  empresa_id: string;
  contacto_id: string;
  producto: string | null;
  monto: number;
  probabilidad: number;
  estado: EstadoOportunidad;
  motivo_perdida_id: string | null;
  nota: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  cerrada_en: string | null;
}

export type TipoCampo = 'texto' | 'numero' | 'fecha' | 'seleccion' | 'casilla';

// Campo propio de la ficha de cliente, definido por cada empresa — ver
// database/029_ficha_personalizable.sql.
export interface CampoPersonalizado {
  id: string;
  empresa_id: string;
  nombre: string;
  tipo: TipoCampo;
  opciones: string[];
  orden: number;
}

export interface DocumentoContacto {
  id: string;
  contacto_id: string;
  nombre: string;
  ruta: string;
  url: string;
  tamano: number | null;
  creado_en: string;
}

// Por qué se perdió una venta; la lista la define cada empresa — ver
// database/028_probabilidad_etapa_y_motivos_perdida.sql.
export interface MotivoPerdida {
  id: string;
  empresa_id: string;
  nombre: string;
}

// Etiquetas de WhatsApp Business, sincronizadas de solo lectura desde la
// cuenta del cliente (ver database/instalar.sql y
// server/src/whatsapp/etiquetas.ts). `color` es el índice (0-19) de la
// paleta de colores predefinidos de WhatsApp — ver PALETA_ETIQUETAS_WHATSAPP.
export interface EtiquetaWhatsapp {
  id: string;
  nombre: string;
  color: number | null;
}

export interface Nota {
  id: string;
  contacto_id: string;
  autor_id: string;
  texto: string;
  creado_en: string;
  usuarios?: { nombre: string } | null;
}

export interface TareaItem {
  id: string;
  tarea_id: string;
  texto: string;
  hecho: boolean;
  orden: number;
}

export interface Tarea {
  id: string;
  empresa_id: string;
  /** Null en una actividad que el gerente le deja al equipo, sin cliente. */
  contacto_id: string | null;
  titulo: string;
  descripcion?: string | null;
  creado_por?: string | null;
  fecha: string | null;
  completada: boolean;
  asignado_a: string;
  contactos?: { nombre: string | null; telefono: string } | null;
  usuarios?: { nombre: string } | null;
}

export interface Empresa {
  id: string;
  nombre: string;
  color_primario: string | null;
  color_acento: string | null;
  logo_url: string | null;
  cierre_auto_horas: number | null;
  creado_en: string;
}

export interface RespuestaRapida {
  id: string;
  empresa_id: string;
  titulo: string;
  atajo: string | null;
  contenido: string;
  tipo: TipoMensaje;
  media_url: string | null;
  creado_por: string;
  creado_en: string;
  usuarios?: { nombre: string } | null;
  // Los mensajes que siguen al primero (como en un flujo), en orden.
  partes?: ParteRespuesta[];
}

export interface ParteRespuesta {
  tipo: TipoMensaje;
  contenido: string;
  media_url: string | null;
}

// Un paso de una respuesta automática: se mandan en orden, uno detrás de
// otro — ver server/src/whatsapp/bot-automatico.ts. Un paso 'espera' no
// manda nada, solo pausa `duracion_segundos` antes de seguir.
export interface PasoRespuestaAutomatica {
  tipo: 'texto' | 'imagen' | 'pdf' | 'espera';
  contenido: string | null;
  media_url: string | null;
  duracion_segundos?: number | null;
}

// Reglas del bot de respuesta automática: si el texto del cliente contiene
// `palabra_clave` (sin distinguir mayúsculas/tildes), el backend manda los
// `pasos` configurados, en orden.
export interface OpcionPregunta {
  id: string;
  etiqueta: string;
  palabras: string[];
}

export interface NodoFlujo {
  id: string;
  type: 'inicio' | 'texto' | 'imagen' | 'pdf' | 'espera' | 'pregunta' | 'fin';
  position?: { x: number; y: number };
  data: {
    contenido?: string | null;
    media_url?: string | null;
    duracion_segundos?: number | null;
    opciones?: OpcionPregunta[];
  };
}

export interface FlujoBot {
  nodes: NodoFlujo[];
  edges: { id: string; source: string; target: string; sourceHandle?: string | null }[];
}

export interface RespuestaAutomatica {
  id: string;
  empresa_id: string;
  tipo: 'rapida' | 'flujo';
  nombre: string | null;
  flujo: FlujoBot | null;
  palabra_clave: string;
  palabras_clave: string[];
  modo_coincidencia: 'contiene' | 'exacta' | 'empieza_con';
  tolerancia_errores: boolean;
  disparador: 'palabra_clave' | 'primer_mensaje' | 'primer_mensaje_del_dia' | 'cualquier_mensaje';
  pasos: PasoRespuestaAutomatica[];
  demora_segundos: number;
  activo: boolean;
  creado_por: string | null;
  creado_en: string;
  usuarios?: { nombre: string } | null;
}
