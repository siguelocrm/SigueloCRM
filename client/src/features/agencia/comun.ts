import type { CSSProperties } from 'react';
import { BORDE, TEXTO_PRIMARIO } from '../../lib/tema';

// Lo que comparten las pantallas de la Agencia (server/src/siguelo/agencia).

export type Plan = { id: string; nombre: string; precio: number; moneda: string; duracion_dias: number; incluye: string[]; con_crm: boolean; activo: boolean; max_numeros?: number | null; max_negocios?: number | null; usar_mi_clave?: boolean };
export type Cuenta = {
  empresa_id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  usuario: string | null;
  plan_id: string | null;
  vence_en: string | null;
  pausada: boolean;
  propia: boolean;
  notas: string | null;
  creado_en: string;
  estado: 'activa' | 'pausada' | 'vencida';
  max_numeros?: number | null;
  max_negocios?: number | null;
  numeros: number;
  conectados: number;
};
export type Venta = {
  id: string;
  plan_id: string | null;
  plan_nombre: string | null;
  cliente: string;
  telefono: string | null;
  monto: number;
  moneda: string;
  fecha: string;
  desde: string | null;
  hasta: string | null;
  cuenta_id: string | null;
  notas: string | null;
};
export type DatosAgencia = { planes: Plan[]; cuentas: Cuenta[]; ventas: Venta[] };

export const claseCampo = 'w-full rounded-lg px-2.5 outline-none text-[13.5px] bg-[var(--surface)]';
export const estiloCampo: CSSProperties = { border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, height: 36 };
export const estiloArea: CSSProperties = { border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, padding: '8px 10px', lineHeight: 1.45 };

export const fecha = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '—');
export const monto = (n: number, moneda = 'Bs') => `${moneda} ${Number(n || 0).toLocaleString('es-BO', { maximumFractionDigits: 2 })}`;
export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// "2026-12-16" (del calendario) → el final de ese día en tu hora.
export const finDelDia = (dia: string) => new Date(`${dia}T23:59:00`).toISOString();
export const diaDe = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const duracion = (dias: number) =>
  dias % 365 === 0 ? `${dias / 365} ${dias === 365 ? 'año' : 'años'}` : dias % 30 === 0 ? `${dias / 30} ${dias === 30 ? 'mes' : 'meses'}` : `${dias} días`;

// Usuario sugerido a partir del nombre ("Consultorio Paz" → "consultoriopaz").
export const sugerirUsuario = (nombre: string) =>
  nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 20);

// Contraseña fácil de dictar (sin 0/O ni 1/l).
export function nuevaContrasena(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const azar = (s: string) => s[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * s.length)];
  return Array.from({ length: 5 }, () => azar(letras)).join('') + Array.from({ length: 3 }, () => azar(numeros)).join('');
}

// Límite de números o negocios: null = sin límite.
export const textoLimite = (n: number | null | undefined, uno: string, varios: string) => (n === null ? `${varios} sin límite` : `hasta ${n ?? 1} ${(n ?? 1) === 1 ? uno : varios}`);

// Selector de límite: 1, 2, 3, 5, 10 o sin límite.
export const OPCIONES_LIMITE = ['1', '2', '3', '5', '10', ''] as const;
export const limiteDeTexto = (v: string): number | null => (v === '' ? null : Number(v));
export const textoDeLimite = (n: number | null | undefined) => (n === null ? '' : String(n ?? 1));
