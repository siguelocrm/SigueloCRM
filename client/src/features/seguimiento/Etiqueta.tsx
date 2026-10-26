import type { ComponentProps } from 'react';
import { Chip } from '../../components/ui';
import { fondoChip } from './estilos';

// Chip de ui.tsx con un fondo que se lee en el tema claro y en el oscuro.
export default function Etiqueta({ color = 'var(--accent)', ...resto }: ComponentProps<typeof Chip>) {
  return <Chip color={color} fondo={fondoChip(color)} {...resto} />;
}
