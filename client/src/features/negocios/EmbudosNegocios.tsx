import { useState } from 'react';
import { Columns3, Plus, Store, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { PALETA_ETIQUETAS_WHATSAPP, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorEtiquetaWhatsapp } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import type { EtapaVenta } from '../../lib/tipos';
import Etiqueta from '../seguimiento/Etiqueta';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';
import { EtapasDeEmbudo } from './EtapasDeEmbudo';
import type { DatosNegocios } from './useNegocios';

// Etapas con las que nace un embudo nuevo (después se renombran a gusto).
const ETAPAS_INICIALES = [
  { nombre: 'Primer contacto', tipo: 'normal', probabilidad: 10 },
  { nombre: 'Interesado', tipo: 'normal', probabilidad: 40 },
  { nombre: 'Inscrito', tipo: 'ganada', probabilidad: 100 },
  { nombre: 'No se inscribió', tipo: 'perdida', probabilidad: 0 },
] as const;

interface Props {
  datos: DatosNegocios;
  etapas: EtapaVenta[];
  empresaId: string;
  puedeEditar: boolean;
}

// Embudos: el principal (el de siempre, que comparten las sucursales) y los
// propios de algún negocio, cada uno con sus etapas.
export default function EmbudosNegocios({ datos, etapas, empresaId, puedeEditar }: Props) {
  const toast = useToast();
  const [nuevo, setNuevo] = useState('');
  const principales = etapas.filter((e) => !datos.embudoDeEtapa[e.id]).sort((a, b) => a.orden - b.orden);
  const quienesUsan = (embudoId: string | null) => datos.negocios.filter((n) => (n.embudo_id ?? null) === embudoId).map((n) => n.nombre);

  const crear = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return toast('Escribe el nombre del embudo.', 'error');
    const { data, error } = await supabase.from('siguelo_embudos').insert({ empresa_id: empresaId, nombre }).select('id').single();
    if (error || !data) return toast(`No se pudo crear: ${error?.message ?? ''}`, 'error');
    const embudoId = (data as { id: string }).id;
    let orden = Math.max(0, ...etapas.map((e) => e.orden));
    for (const [i, e] of ETAPAS_INICIALES.entries()) {
      const { data: etapa } = await supabase
        .from('etapas_venta')
        .insert({ empresa_id: empresaId, nombre: e.nombre, tipo: e.tipo, probabilidad: e.probabilidad, orden: ++orden, color: (etapas.length + i) % PALETA_ETIQUETAS_WHATSAPP.length })
        .select('id')
        .single();
      if (etapa) await supabase.from('siguelo_etapa_embudo').insert({ etapa_id: (etapa as { id: string }).id, embudo_id: embudoId });
    }
    setNuevo('');
    toast(`Embudo "${nombre}" creado. Asígnalo a un negocio en su ficha.`, 'ok');
    datos.recargar();
  };

  const renombrar = async (id: string, nombre: string) => {
    if (!nombre.trim()) return;
    await supabase.from('siguelo_embudos').update({ nombre: nombre.trim() }).eq('id', id);
    datos.recargar();
  };

  const eliminar = async (id: string, nombre: string) => {
    const propias = etapas.filter((e) => datos.embudoDeEtapa[e.id] === id).map((e) => e.id);
    if (propias.length) {
      const { count } = await supabase.from('contactos').select('id', { count: 'exact', head: true }).in('etapa_id', propias);
      if (count) return toast(`"${nombre}" tiene ${count} contacto(s) en sus etapas: muévelos antes de eliminarlo.`, 'error');
    }
    if (!window.confirm(`¿Eliminar el embudo "${nombre}" y sus etapas? Los negocios que lo usan vuelven al embudo principal.`)) return;
    if (propias.length) await supabase.from('etapas_venta').delete().in('id', propias);
    const { error } = await supabase.from('siguelo_embudos').delete().eq('id', id);
    if (error) return toast(`No se pudo eliminar: ${error.message}`, 'error');
    toast(`Embudo "${nombre}" eliminado`, 'ok');
    datos.recargar();
  };

  const usadoPor = (embudoId: string | null) => {
    const nombres = quienesUsan(embudoId);
    return nombres.length ? (
      <span className="flex flex-wrap gap-1.5">{nombres.map((x) => <Etiqueta key={x} icono={Store}>{x}</Etiqueta>)}</span>
    ) : (
      <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Ningún negocio lo usa todavía.</span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        Las sucursales pueden compartir el embudo principal. Un negocio distinto puede tener su propio embudo con sus etapas; sus clientes
        nuevos entran solos ahí. En la pantalla Embudo eliges qué embudo mirar.
      </p>

      <Tarjeta className="p-4 flex flex-col gap-2.5">
        <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}><Columns3 size={16} color="var(--accent)" /> Embudo principal</span>
        {usadoPor(null)}
        <div className="flex flex-wrap gap-1.5">
          {principales.map((e) => <Etiqueta key={e.id} color={colorEtiquetaWhatsapp(e.color)}>{e.nombre}</Etiqueta>)}
        </div>
        <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>Sus etapas se editan en Embudo → Editar etapas.</span>
      </Tarjeta>

      {datos.embudos.map((emb) => (
        <Tarjeta key={emb.id} className="p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Columns3 size={16} color="var(--accent)" />
            <input
              defaultValue={emb.nombre}
              disabled={!puedeEditar}
              onBlur={(e) => e.target.value.trim() !== emb.nombre && renombrar(emb.id, e.target.value)}
              aria-label="Nombre del embudo"
              className={`${claseCampo} flex-1 min-w-[160px] font-bold`}
              style={estiloCampo}
            />
            {puedeEditar && <Boton tamano="sm" variante="peligro" icono={Trash2} onClick={() => eliminar(emb.id, emb.nombre)}>Eliminar</Boton>}
          </div>
          {usadoPor(emb.id)}
          <EtapasDeEmbudo embudoId={emb.id} empresaId={empresaId} etapas={etapas} embudoDeEtapa={datos.embudoDeEtapa} puedeEditar={puedeEditar} onCambio={datos.recargar} />
        </Tarjeta>
      ))}

      {puedeEditar && (
        <Tarjeta className="p-4 flex items-center gap-2 flex-wrap">
          <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crear()} placeholder="Nombre del nuevo embudo (ej. Cursos)" aria-label="Nombre del nuevo embudo" className={`${claseCampo} flex-1 min-w-[200px]`} style={estiloCampo} />
          <Boton icono={Plus} onClick={crear}>Crear embudo</Boton>
        </Tarjeta>
      )}
    </div>
  );
}
