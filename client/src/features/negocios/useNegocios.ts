import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { LineaWhatsapp } from '../../lib/tipos';

// Negocios por número (SígueloCRM, Fase 2): cada número trabaja como un
// negocio con su ficha, sus respuestas rápidas, sus reglas del bot y, si hace
// falta, su propio embudo. Ver database/siguelo.sql (sección 9 en adelante).

export interface Negocio {
  id: string;
  empresa_id: string;
  nombre: string;
  sucursal: string | null;
  direccion: string | null;
  horario: string | null;
  info_ia: string;
  // null = usa el embudo principal.
  embudo_id: string | null;
}

export interface Embudo {
  id: string;
  empresa_id: string;
  nombre: string;
}

export interface DatosNegocios {
  // false si todavía no se pegó la Fase 2 de database/siguelo.sql: todo sigue como antes.
  disponible: boolean;
  cargado: boolean;
  negocios: Negocio[];
  embudos: Embudo[];
  lineas: LineaWhatsapp[];
  // etapa_id → embudo_id (las etapas que no están son del embudo principal)
  embudoDeEtapa: Record<string, string>;
  // linea_id → negocio_id
  negocioDeLinea: Record<string, string>;
  // respuesta rápida / regla del bot → negocios a los que pertenece (sin entrada = de todos)
  respuestasDeNegocio: Record<string, string[]>;
  reglasDeNegocio: Record<string, string[]>;
  recargar: () => Promise<void>;
}

const agrupar = (filas: { clave: string; negocio_id: string }[]) => {
  const mapa: Record<string, string[]> = {};
  for (const f of filas) (mapa[f.clave] ||= []).push(f.negocio_id);
  return mapa;
};

export function useNegocios(empresaId: string | undefined): DatosNegocios {
  const [estado, setEstado] = useState<Omit<DatosNegocios, 'recargar'>>({
    disponible: false,
    cargado: false,
    negocios: [],
    embudos: [],
    lineas: [],
    embudoDeEtapa: {},
    negocioDeLinea: {},
    respuestasDeNegocio: {},
    reglasDeNegocio: {},
  });

  const recargar = useCallback(async () => {
    if (!empresaId) return;
    const [neg, emb, etEmb, lin, asign, resp, bot] = await Promise.all([
      supabase.from('siguelo_negocios').select('*').order('nombre').returns<Negocio[]>(),
      supabase.from('siguelo_embudos').select('*').order('creado_en').returns<Embudo[]>(),
      supabase.from('siguelo_etapa_embudo').select('etapa_id, embudo_id').returns<{ etapa_id: string; embudo_id: string }[]>(),
      supabase.from('lineas_whatsapp').select('*').order('nombre').returns<LineaWhatsapp[]>(),
      supabase.from('siguelo_lineas').select('linea_id, negocio_id').returns<{ linea_id: string; negocio_id: string }[]>(),
      supabase.from('siguelo_respuesta_negocio').select('respuesta_id, negocio_id').returns<{ respuesta_id: string; negocio_id: string }[]>(),
      supabase.from('siguelo_bot_negocio').select('regla_id, negocio_id').returns<{ regla_id: string; negocio_id: string }[]>(),
    ]);
    const disponible = !neg.error && !emb.error && !etEmb.error && !asign.error && !resp.error && !bot.error;
    setEstado({
      disponible,
      cargado: true,
      negocios: neg.data || [],
      embudos: emb.data || [],
      lineas: lin.data || [],
      embudoDeEtapa: Object.fromEntries((etEmb.data || []).map((e) => [e.etapa_id, e.embudo_id])),
      negocioDeLinea: Object.fromEntries((asign.data || []).map((a) => [a.linea_id, a.negocio_id])),
      respuestasDeNegocio: agrupar((resp.data || []).map((r) => ({ clave: r.respuesta_id, negocio_id: r.negocio_id }))),
      reglasDeNegocio: agrupar((bot.data || []).map((r) => ({ clave: r.regla_id, negocio_id: r.negocio_id }))),
    });
  }, [empresaId]);

  useEffect(() => {
    recargar();
    const intervalo = setInterval(recargar, 60000);
    return () => clearInterval(intervalo);
  }, [recargar]);

  return { ...estado, recargar };
}

// Deja solo lo que vale para un negocio: lo que no tiene negocio (es de todos)
// y lo que es de ese negocio. Sirve para respuestas rápidas y reglas del bot.
export function soloDelNegocio<T extends { id: string }>(lista: T[], asignaciones: Record<string, string[]>, negocioId: string | undefined): T[] {
  if (!Object.keys(asignaciones).length) return lista;
  return lista.filter((x) => {
    const de = asignaciones[x.id];
    return !de?.length || (!!negocioId && de.includes(negocioId));
  });
}
