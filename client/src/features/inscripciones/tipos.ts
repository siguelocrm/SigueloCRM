// Tipos de la inscripción con pago (SígueloCRM, Fase 5), según database/siguelo.sql
// (secciones 21 a 24) y server/src/siguelo/pagos.

export type TextosCurso = { confirmado: string; pedir_datos: string; falta: string; link: string; revisar: string; rechazado: string };

export interface Curso {
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
  // ids de campos personalizados, o "nombre".
  datos: string[];
  etapa_id: string | null;
  max_horas: number;
  textos: TextosCurso;
}

export type EstadoPago = 'leyendo' | 'no_es' | 'revisar' | 'rechazado' | 'datos' | 'inscrito';
export type ControlPago = { codigo: string; nombre: string; ok: boolean; detalle: string };

export interface Pago {
  id: string;
  contacto_id: string | null;
  conversacion_id: string | null;
  telefono: string;
  curso_id: string | null;
  media_url: string | null;
  estado: EstadoPago;
  lectura: { pagador?: string | null; banco?: string | null; destinatario?: string | null; fecha?: string | null; glosa?: string | null } | null;
  controles: ControlPago[];
  motivo: string | null;
  monto: number | null;
  transaccion: string | null;
  pagado_en: string | null;
  datos: Record<string, string>;
  accion: 'confirmar' | 'rechazar' | null;
  creado_en: string;
  actualizado_en: string;
  contactos: { nombre: string | null } | null;
}

export type CampoPersonalizado = { id: string; nombre: string; tipo: string };

export const ESTADOS: Record<EstadoPago, { texto: string; color: string }> = {
  leyendo: { texto: 'Leyendo', color: 'var(--fg-3)' },
  no_es: { texto: 'No era un comprobante', color: 'var(--fg-3)' },
  revisar: { texto: 'Para revisar', color: 'var(--warn)' },
  rechazado: { texto: 'Rechazado', color: 'var(--bad)' },
  datos: { texto: 'Pagó · faltan sus datos', color: 'var(--accent)' },
  inscrito: { texto: 'Inscrito', color: 'var(--ok)' },
};

export const TEXTOS_POR_DEFECTO: TextosCurso = {
  confirmado: '¡Listo, {nombre}! Recibimos tu pago de {monto} para {curso}. ✅',
  pedir_datos: 'Para completar tu inscripción, envíame por favor:\n{datos}',
  falta: '¡Gracias! Solo me falta:\n{datos}',
  link: '¡Ya estás inscrito en {curso}! 🎉 Únete al grupo aquí:\n{link}',
  revisar: 'Recibimos tu comprobante 🙌 Lo estamos revisando y en un momento te confirmamos.',
  rechazado: 'No pudimos validar tu comprobante: {motivo}. Si crees que es un error, escríbenos por aquí.',
};

export const NOMBRE_TEXTOS: Record<keyof TextosCurso, string> = {
  confirmado: 'Al confirmar el pago',
  pedir_datos: 'Para pedir sus datos ({datos} = la lista)',
  falta: 'Si todavía le falta algún dato',
  link: 'Al quedar inscrito ({link} = el link del grupo)',
  revisar: 'Si el comprobante queda para revisar',
  rechazado: 'Si se rechaza ({motivo} = por qué)',
};

export const cursoNuevo = (empresaId: string): Omit<Curso, 'id'> => ({
  empresa_id: empresaId,
  negocio_id: null,
  nombre: '',
  activo: true,
  precio: 0,
  moneda: 'Bs',
  qr_url: null,
  destinatario: '',
  cuenta: '',
  link_grupo: '',
  datos: ['nombre'],
  etapa_id: null,
  max_horas: 72,
  textos: { ...TEXTOS_POR_DEFECTO },
});

export const formatoMonto = (monto: number | null | undefined, moneda: string) =>
  monto == null ? '—' : `${moneda} ${Number(monto).toLocaleString('es', { maximumFractionDigits: 2 })}`;
