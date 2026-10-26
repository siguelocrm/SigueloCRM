import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, PALETA_ETIQUETAS_WHATSAPP, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorEtiquetaWhatsapp } from '../../lib/tema';
import { Boton, useToast } from '../../components/ui';
import type { EtapaVenta, TipoEtapa } from '../../lib/tipos';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';

const TIPOS: { id: TipoEtapa; texto: string }[] = [
  { id: 'normal', texto: 'En curso' },
  { id: 'ganada', texto: 'Ganada' },
  { id: 'perdida', texto: 'Perdida' },
];

interface Props {
  embudoId: string;
  empresaId: string;
  // Todas las etapas de la empresa (de todos los embudos).
  etapas: EtapaVenta[];
  embudoDeEtapa: Record<string, string>;
  puedeEditar: boolean;
  onCambio: () => void;
}

// Etapas de un embudo propio (el principal se edita en Embudo → Editar etapas).
// Son etapas normales del CRM (etapas_venta), anotadas como de este embudo.
export function EtapasDeEmbudo({ embudoId, empresaId, etapas, embudoDeEtapa, puedeEditar, onCambio }: Props) {
  const toast = useToast();
  const [nueva, setNueva] = useState('');
  const propias = etapas.filter((e) => embudoDeEtapa[e.id] === embudoId).sort((a, b) => a.orden - b.orden);

  const agregar = async () => {
    const nombre = nueva.trim();
    if (!nombre) return;
    const orden = Math.max(0, ...etapas.map((e) => e.orden)) + 1;
    const { data, error } = await supabase
      .from('etapas_venta')
      .insert({ empresa_id: empresaId, nombre, tipo: 'normal', orden, color: etapas.length % PALETA_ETIQUETAS_WHATSAPP.length })
      .select('id')
      .single();
    if (error || !data) return toast(`No se pudo agregar: ${error?.message ?? ''}`, 'error');
    await supabase.from('siguelo_etapa_embudo').insert({ etapa_id: (data as { id: string }).id, embudo_id: embudoId });
    setNueva('');
    onCambio();
  };

  const cambiar = async (etapa: EtapaVenta, cambios: Partial<Pick<EtapaVenta, 'nombre' | 'tipo'>>) => {
    const { error } = await supabase.from('etapas_venta').update(cambios).eq('id', etapa.id);
    if (error) toast(`No se pudo guardar: ${error.message}`, 'error');
    onCambio();
  };

  const mover = async (etapa: EtapaVenta, direccion: -1 | 1) => {
    const i = propias.findIndex((e) => e.id === etapa.id);
    const vecina = propias[i + direccion];
    if (!vecina) return;
    await supabase.from('etapas_venta').update({ orden: vecina.orden }).eq('id', etapa.id);
    await supabase.from('etapas_venta').update({ orden: etapa.orden }).eq('id', vecina.id);
    onCambio();
  };

  const quitar = async (etapa: EtapaVenta) => {
    const { count } = await supabase.from('contactos').select('id', { count: 'exact', head: true }).eq('etapa_id', etapa.id);
    if (count) return toast(`"${etapa.nombre}" tiene ${count} contacto(s): muévelos a otra etapa antes de borrarla.`, 'error');
    if (!window.confirm(`¿Borrar la etapa "${etapa.nombre}"? Sus mensajes de seguimiento también se borran.`)) return;
    const { error } = await supabase.from('etapas_venta').delete().eq('id', etapa.id);
    if (error) return toast(`No se pudo borrar: ${error.message}`, 'error');
    onCambio();
  };

  return (
    <div className="flex flex-col gap-1.5">
      {propias.length === 0 && <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>Todavía no tiene etapas.</span>}
      {propias.map((etapa, i) => (
        <div key={etapa.id} className="flex items-center gap-2 flex-wrap rounded-lg px-2.5 py-2" style={{ border: `1px solid ${BORDE}` }}>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorEtiquetaWhatsapp(etapa.color) }} />
          <input
            defaultValue={etapa.nombre}
            disabled={!puedeEditar}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== etapa.nombre && cambiar(etapa, { nombre: e.target.value.trim() })}
            aria-label="Nombre de la etapa"
            className={`${claseCampo} flex-1 min-w-[140px]`}
            style={{ ...estiloCampo, height: 32 }}
          />
          <select value={etapa.tipo} disabled={!puedeEditar} onChange={(e) => cambiar(etapa, { tipo: e.target.value as TipoEtapa })} aria-label="Tipo de etapa" className={claseCampo} style={{ ...estiloCampo, height: 32 }}>
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto}</option>)}
          </select>
          {puedeEditar && (
            <span className="flex items-center gap-0.5">
              <button onClick={() => mover(etapa, -1)} disabled={i === 0} aria-label="Subir" className="p-1.5 rounded-md disabled:opacity-30" style={{ color: TEXTO_SECUNDARIO }}><ArrowUp size={14} /></button>
              <button onClick={() => mover(etapa, 1)} disabled={i === propias.length - 1} aria-label="Bajar" className="p-1.5 rounded-md disabled:opacity-30" style={{ color: TEXTO_SECUNDARIO }}><ArrowDown size={14} /></button>
              <button onClick={() => quitar(etapa)} aria-label={`Borrar ${etapa.nombre}`} className="p-1.5 rounded-md" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={14} /></button>
            </span>
          )}
        </div>
      ))}
      {puedeEditar && (
        <div className="flex items-center gap-2 mt-1">
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} placeholder="Nueva etapa" aria-label="Nombre de la nueva etapa" className={`${claseCampo} flex-1`} style={{ ...estiloCampo, height: 32 }} />
          <Boton tamano="sm" icono={Plus} onClick={agregar}>Agregar</Boton>
        </div>
      )}
      <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
        "Ganada" y "Perdida" cuentan para los reportes. En una etapa "Perdida" el seguimiento nunca envía mensajes.
      </span>
    </div>
  );
}

// La misma lista en una ventana, para "Editar etapas" del Embudo cuando se mira un embudo propio.
export function VentanaEtapasDeEmbudo({ titulo, onCerrar, ...props }: Props & { titulo: string; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(10,15,25,0.4)' }} onClick={onCerrar}>
      <div className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl p-5 flex flex-col gap-3" style={{ backgroundColor: 'var(--surface)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>Etapas de "{titulo}"</span>
          <button onClick={onCerrar} aria-label="Cerrar" className="p-1 rounded-md" style={{ color: TEXTO_SECUNDARIO }}><X size={16} /></button>
        </div>
        <EtapasDeEmbudo {...props} />
      </div>
    </div>
  );
}
