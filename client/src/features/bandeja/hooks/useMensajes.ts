import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import type { Mensaje } from '../../../lib/tipos';

// SígueloCRM: de dónde salió cada mensaje nuestro (seguimiento, masivo, IA, bot...). Sección 49 del SQL.
export type OrigenMensaje = { origen: string; detalle: string | null };

export function useMensajes(conversacionId: string | null) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [origenes, setOrigenes] = useState<Record<string, OrigenMensaje>>({});
  const actual = useRef(conversacionId);
  actual.current = conversacionId;
  const cargarOrigenes = useCallback(async (id: string) => {
    const { data, error } = await supabase.rpc('siguelo_origenes', { p_conversacion: id });
    if (error || actual.current !== id) return; // sin la sección 49: sin etiquetas
    const mapa: Record<string, OrigenMensaje> = {};
    ((data || []) as ({ mensaje_id: string } & OrigenMensaje)[]).forEach((o) => { mapa[o.mensaje_id] = { origen: o.origen, detalle: o.detalle }; });
    setOrigenes(mapa);
  }, []);
  // El seguimiento y los masivos enlazan su mensaje un momento después de guardarlo.
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programarOrigenes = useCallback(() => {
    if (pendiente.current) clearTimeout(pendiente.current);
    pendiente.current = setTimeout(() => { if (actual.current) cargarOrigenes(actual.current); }, 2500);
  }, [cargarOrigenes]);

  const cargarMensajes = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', id)
      .order('creado_en', { ascending: true })
      .returns<Mensaje[]>();
    setMensajes(data || []);
    cargarOrigenes(id);
  }, [cargarOrigenes]);

  useEffect(() => {
    if (conversacionId) cargarMensajes(conversacionId);
    else {
      setMensajes([]);
      setOrigenes({});
    }
  }, [conversacionId, cargarMensajes]);

  const agregarMensaje = (mensaje: Mensaje) => {
    setMensajes((prev) => (prev.some((m) => m.id === mensaje.id) ? prev : [...prev, mensaje]));
    if (mensaje.remitente === 'agente') programarOrigenes();
  };

  // Un mensaje ya insertado puede cambiar después (ej. WhatsApp rechaza la
  // entrega de forma asíncrona y le actualizamos el estado_entrega) — esto
  // reemplaza esa fila en el estado local sin tocar el resto.
  const actualizarMensaje = (mensaje: Mensaje) => {
    setMensajes((prev) => prev.map((m) => (m.id === mensaje.id ? mensaje : m)));
  };

  return { mensajes, origenes, agregarMensaje, actualizarMensaje };
}
