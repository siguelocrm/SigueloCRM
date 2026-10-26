import type { CSSProperties } from 'react';
import { BORDE, TEXTO_PRIMARIO } from '../../lib/tema';

// Cuadros de texto y selectores de la pantalla Seguimiento (mismo aspecto que Configuración).
export const claseCampo = 'rounded-lg px-2.5 outline-none text-[13.5px] bg-[var(--surface)]';
export const estiloCampo: CSSProperties = { border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, height: 36 };
export const estiloArea: CSSProperties = { border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, padding: '8px 10px', lineHeight: 1.45 };

// Fondo de las etiquetas (Chip): mezclado con transparente para que se lea
// también en el tema oscuro (el de ui.tsx mezcla con blanco).
export const fondoChip = (color: string): string => `color-mix(in srgb, ${color} 16%, transparent)`;

// 24 → "1 día", 36 → "36 h", 0.5 → "30 min"
export function describirHoras(horas: number): string {
  if (horas > 0 && horas < 1) return `${Math.round(horas * 60)} min`;
  if (horas >= 24 && horas % 24 === 0) return `${horas / 24} ${horas === 24 ? 'día' : 'días'}`;
  return `${horas} h`;
}
