import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, FileText, Image, Mic, Reply, Store } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import type { DatosNegocios } from './useNegocios';

type Item = { id: string; titulo: string; detalle: string; icono: typeof Reply };

const ICONO_TIPO: Record<string, typeof Reply> = { imagen: Image, pdf: FileText, documento: FileText, audio: Mic };

interface Props {
  tipo: 'respuestas' | 'bot';
  datos: DatosNegocios;
  puedeEditar: boolean;
}

// De qué negocios es cada respuesta rápida o regla del bot. Sin ninguno marcado
// es de todos. En el chat solo aparecen las del negocio del número, y el bot
// solo usa las reglas del negocio del número que recibió el mensaje.
export default function AsignarPorNegocio({ tipo, datos, puedeEditar }: Props) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [cargando, setCargando] = useState(true);
  const tabla = tipo === 'respuestas' ? 'siguelo_respuesta_negocio' : 'siguelo_bot_negocio';
  const columna = tipo === 'respuestas' ? 'respuesta_id' : 'regla_id';
  const asignaciones = tipo === 'respuestas' ? datos.respuestasDeNegocio : datos.reglasDeNegocio;

  const cargar = useCallback(async () => {
    if (tipo === 'respuestas') {
      const { data } = await supabase.from('respuestas_rapidas').select('id, titulo, atajo, tipo, contenido').order('titulo').returns<{ id: string; titulo: string; atajo: string | null; tipo: string; contenido: string }[]>();
      setItems((data || []).map((r) => ({ id: r.id, titulo: r.titulo, detalle: r.atajo ? `/${r.atajo}` : r.contenido.slice(0, 60), icono: ICONO_TIPO[r.tipo] || Reply })));
    } else {
      const { data } = await supabase
        .from('respuestas_automaticas')
        .select('id, nombre, palabra_clave, palabras_clave, disparador, activo')
        .order('creado_en')
        .returns<{ id: string; nombre: string | null; palabra_clave: string; palabras_clave: string[]; disparador: string; activo: boolean }[]>();
      const DISPARADOR: Record<string, string> = { primer_mensaje: 'primer mensaje', primer_mensaje_del_dia: 'primer mensaje del día', cualquier_mensaje: 'cualquier mensaje' };
      setItems(
        (data || []).map((r) => ({
          id: r.id,
          titulo: r.nombre || (r.palabras_clave?.length ? r.palabras_clave.join(', ') : r.palabra_clave),
          detalle: `${DISPARADOR[r.disparador] ? `Responde al ${DISPARADOR[r.disparador]}` : `Palabras: ${(r.palabras_clave?.length ? r.palabras_clave : [r.palabra_clave]).join(', ')}`}${r.activo ? '' : ' · apagada'}`,
          icono: Bot,
        })),
      );
    }
    setCargando(false);
  }, [tipo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const alternar = async (itemId: string, negocioId: string) => {
    const tiene = (asignaciones[itemId] || []).includes(negocioId);
    const { error } = tiene
      ? await supabase.from(tabla).delete().eq(columna, itemId).eq('negocio_id', negocioId)
      : await supabase.from(tabla).insert({ [columna]: itemId, negocio_id: negocioId });
    if (error) return toast(`No se pudo guardar: ${error.message}`, 'error');
    datos.recargar();
  };

  if (!datos.negocios.length) {
    return (
      <Tarjeta className="flex">
        <EstadoVacio icono={Store} titulo="Primero crea tus negocios" texto="En la pestaña Negocios crea uno por sucursal o negocio y asígnale sus números." />
      </Tarjeta>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        {tipo === 'respuestas'
          ? 'Marca de qué negocios es cada respuesta rápida. Sin ninguno marcado, sirve para todos. En el chat solo aparecen las del negocio de ese número.'
          : 'Marca de qué negocios es cada regla del bot. Sin ninguno marcado, responde en todos los números. Si no, solo en los números de esos negocios.'}
      </p>
      {cargando ? (
        <div className="text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>
      ) : items.length === 0 ? (
        <Tarjeta className="flex">
          <EstadoVacio
            icono={tipo === 'respuestas' ? Reply : Bot}
            titulo={tipo === 'respuestas' ? 'No hay respuestas rápidas' : 'No hay reglas del bot'}
            texto={tipo === 'respuestas' ? 'Créalas en Automatizar → Respuestas rápidas.' : 'Créalas en Automatizar → Bot y flujos.'}
          />
        </Tarjeta>
      ) : (
        <Tarjeta className="flex flex-col">
          {items.map((it, i) => {
            const de = asignaciones[it.id] || [];
            const Icono = it.icono;
            return (
              <div key={it.id} className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                <div className="flex items-start gap-2.5 min-w-0">
                  <Icono size={15} className="mt-0.5 shrink-0" color="var(--accent)" />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate" style={{ color: TEXTO_PRIMARIO }}>{it.titulo}</div>
                    <div className="text-[12px] truncate" style={{ color: TEXTO_TERCIARIO }}>{it.detalle}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-6">
                  {!de.length && <span className="text-[12px] font-semibold mr-1" style={{ color: 'var(--ok)' }}>Para todos</span>}
                  {datos.negocios.map((n) => {
                    const activo = de.includes(n.id);
                    return (
                      <button
                        key={n.id}
                        onClick={() => alternar(it.id, n.id)}
                        disabled={!puedeEditar}
                        aria-pressed={activo}
                        className="inline-flex items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold"
                        style={{
                          height: 26,
                          border: `1px solid ${activo ? 'var(--accent)' : BORDE}`,
                          color: activo ? 'var(--accent)' : TEXTO_SECUNDARIO,
                          backgroundColor: activo ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        {activo && <Check size={12} />}
                        {n.nombre}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Tarjeta>
      )}
    </div>
  );
}
