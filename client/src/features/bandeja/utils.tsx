import type { ReactNode } from 'react';
import type { Conversacion } from '../../lib/tipos';

export function formatoHora(fechaIso: string | null | undefined): string {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const hoy = new Date();
  const esHoy = fecha.toDateString() === hoy.toDateString();
  if (esHoy) return fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  return fecha.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' });
}

// SígueloCRM: la hora en la lista de chats, como WhatsApp: hoy la hora, "Ayer", el día de la
// semana si fue esta semana, y si no la fecha.
export function formatoFechaLista(fechaIso: string | null | undefined, ahora = new Date()): string {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(ahora) - dia(fecha)) / 86_400_000);
  if (dias <= 0) return fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  if (dias === 1) return 'Ayer';
  if (dias < 7) {
    const d = fecha.toLocaleDateString('es-BO', { weekday: 'long' });
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return fecha.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Interpreta el formato tipo WhatsApp (*negrita*, _cursiva_, ~tachado~) y
 * preserva los saltos de línea, para que el texto se vea en el panel como
 * se ve en la app de WhatsApp real y no todo corrido en un solo párrafo.
 */
export function formatoWhatsApp(texto: string): ReactNode[] {
  const lineas = texto.split('\n');
  return lineas.map((linea, i) => {
    const partes = formatoLinea(linea);
    return i < lineas.length - 1 ? [...partes, <br key={`br-${i}`} />] : partes;
  }).flat();
}

function formatoLinea(linea: string): ReactNode[] {
  const regex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  const trozos = linea.split(regex).filter((t) => t !== '');
  return trozos.map((trozo, i) => {
    if (trozo.length > 1 && trozo.startsWith('*') && trozo.endsWith('*')) {
      return <strong key={i}>{trozo.slice(1, -1)}</strong>;
    }
    if (trozo.length > 1 && trozo.startsWith('_') && trozo.endsWith('_')) {
      return <em key={i}>{trozo.slice(1, -1)}</em>;
    }
    if (trozo.length > 1 && trozo.startsWith('~') && trozo.endsWith('~')) {
      return <s key={i}>{trozo.slice(1, -1)}</s>;
    }
    return trozo;
  });
}

const NOMBRES_GENERICOS = ['nombre del cliente', 'cliente', 'contacto', 'sin nombre', 'whatsapp'];

// "Nombre del Cliente" y similares son relleno, no un nombre real.
export function esNombreGenerico(nombre: string | null | undefined): boolean {
  const n = (nombre || '').trim().toLowerCase();
  return !n || NOMBRES_GENERICOS.includes(n);
}

// 59171310574 -> +591 71310574 (el resto se deja como número con +).
export function formatoTelefono(telefono: string): string {
  const d = telefono.split('@')[0].replace(/\D/g, '');
  if (d.startsWith('591') && d.length === 11) return `+591 ${d.slice(3)}`;
  return d ? `+${d}` : telefono;
}

// ¿La conversación tiene un nombre real (no solo el número ni un relleno)?
export function tieneNombre(c: Conversacion): boolean {
  return !esNombreGenerico(c.contacto_nombre);
}

export function nombreConversacion(c: Conversacion): string {
  // Algunas conversaciones viejas guardaron el JID completo de WhatsApp
  // (ej. "59175486929@s.whatsapp.net") en vez de solo el número — lo
  // limpiamos acá para que no se muestre feo mientras se migran esas filas.
  return tieneNombre(c) ? (c.contacto_nombre as string) : formatoTelefono(c.contacto_telefono);
}

// Iniciales para el avatar (máx. 2 letras); vacío si no hay un nombre real.
export function inicialesDe(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter((p) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p[0] || ''));
  return palabras.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
