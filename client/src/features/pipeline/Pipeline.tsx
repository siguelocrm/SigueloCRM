import { useEffect, useState } from 'react';
import { Columns3, List, Search, Settings } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { TEAL, BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO } from '../../lib/tema';
import type { Contacto, EtapaVenta, EtiquetaWhatsapp } from '../../lib/tipos';
import VistaEmbudo from './VistaEmbudo';
import VistaLista from './VistaLista';
import GestionEtapas from './GestionEtapas';
import DetalleLead from '../contactos/DetalleLead';
import { useCambioEtapa } from './useCambioEtapa';
import { useFiltroEmbudo } from '../negocios/FiltroEmbudo';
import { VentanaEtapasDeEmbudo } from '../negocios/EtapasDeEmbudo';

interface PipelineProps {
  onAbrirChat: (telefono: string) => void;
}

export default function Pipeline({ onAbrirChat }: PipelineProps) {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'supervisor' || usuario?.rol === 'dueno';
  const [vista, setVista] = useState<'embudo' | 'lista'>('embudo');
  const [mostrarGestionEtapas, setMostrarGestionEtapas] = useState(false);
  const [leadAbierto, setLeadAbierto] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [etapas, setEtapas] = useState<EtapaVenta[]>([]);
  const [etiquetasDeContacto, setEtiquetasDeContacto] = useState<Record<string, EtiquetaWhatsapp[]>>({});
  const filtro = useFiltroEmbudo(usuario?.empresa_id);

  const cargarContactos = async () => {
    const { data } = await supabase.from('contactos').select('*').order('actualizado_en', { ascending: false }).returns<Contacto[]>();
    setContactos(data || []);
  };

  const cargarEtapas = async () => {
    const { data } = await supabase.from('etapas_venta').select('*').order('orden').returns<EtapaVenta[]>();
    setEtapas(data || []);
  };

  const cargarEtiquetas = async () => {
    const { data: asociaciones } = await supabase
      .from('contacto_etiquetas')
      .select('contacto_id, etiquetas_whatsapp(id, nombre, color, eliminada)')
      .returns<{ contacto_id: string; etiquetas_whatsapp: (EtiquetaWhatsapp & { eliminada: boolean }) | null }[]>();
    const mapa: Record<string, EtiquetaWhatsapp[]> = {};
    (asociaciones || []).forEach((a) => {
      if (!a.etiquetas_whatsapp || a.etiquetas_whatsapp.eliminada) return;
      (mapa[a.contacto_id] ||= []).push(a.etiquetas_whatsapp);
    });
    setEtiquetasDeContacto(mapa);
  };

  useEffect(() => {
    cargarContactos();
    cargarEtapas();
    cargarEtiquetas();
    const canal = supabase
      .channel(`pipeline-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contactos' }, () => cargarContactos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'etapas_venta' }, () => cargarEtapas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacto_etiquetas' }, () => cargarEtiquetas())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.empresa_id]);

  const { cambiarEtapa, dialogo } = useCambioEtapa(etapas);
  const moverContacto = (contactoId: string, etapaId: string) =>
    cambiarEtapa(contactoId, etapaId, (cambios) => setContactos((prev) => prev.map((c) => (c.id === contactoId ? { ...c, ...cambios } : c))));

  // Busca por nombre (sin tildes ni mayúsculas) o por número (solo dígitos).
  const quitarTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const termino = quitarTildes(busqueda.trim());
  const terminoDigitos = busqueda.replace(/\D/g, '');
  const contactosFiltrados = !termino
    ? contactos
    : contactos.filter((c) => {
        const porNombre = quitarTildes(c.nombre || '').includes(termino);
        const porNumero = terminoDigitos.length > 0 && c.telefono.replace(/\D/g, '').includes(terminoDigitos);
        return porNombre || porNumero;
      });

  // Negocios por número (SígueloCRM): solo el embudo y el número elegidos.
  const etapasVisibles = filtro.filtrarEtapas(etapas);
  const contactosVisibles = filtro.filtrarContactos(contactosFiltrados, etapasVisibles);

  // Resumen del embudo: solo leads abiertos (ni ganados ni perdidos).
  const tipoDe = (c: Contacto) => etapas.find((e) => e.id === c.etapa_id)?.tipo;
  const abiertos = contactosVisibles.filter((c) => tipoDe(c) === 'normal');
  const totalAbierto = abiertos.reduce((t, c) => t + (c.valor_estimado || 0), 0);
  const ponderado = abiertos.reduce((t, c) => t + (c.valor_estimado || 0) * ((c.probabilidad_cierre ?? 0) / 100), 0);
  const hace3Dias = Date.now() - 3 * 86400000;
  const estancados = abiertos.filter((c) => !c.etapa_actualizada_en || new Date(c.etapa_actualizada_en).getTime() < hace3Dias).length;

  if (leadAbierto) {
    return <DetalleLead telefono={leadAbierto} onVolver={() => setLeadAbierto(null)} />;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0">
      <div className="px-4 md:px-8 py-4 md:py-5 flex flex-col gap-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-[22px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>Embudo de ventas</h1>
            <p className="m-0 text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>Arrastra una tarjeta para cambiarla de etapa, o mira todo en lista.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filtro.selector}
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ border: `1px solid ${BORDE}`, backgroundColor: 'var(--surface)' }}>
              <Search size={14} style={{ color: TEXTO_SECUNDARIO }} />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o número"
                className="bg-transparent outline-none text-[12.5px] w-44 md:w-56"
                style={{ color: TEXTO_PRIMARIO }}
              />
            </div>
            <div className="flex items-center rounded-lg p-1" style={{ border: `1px solid ${BORDE}`, backgroundColor: 'var(--surface)' }}>
              <button onClick={() => setVista('embudo')} className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-md px-2.5 py-1.5" style={vista === 'embudo' ? { backgroundColor: TEAL, color: 'var(--accent-fg)' } : { color: TEXTO_SECUNDARIO }}>
                <Columns3 size={14} />Embudo
              </button>
              <button onClick={() => setVista('lista')} className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-md px-2.5 py-1.5" style={vista === 'lista' ? { backgroundColor: TEAL, color: 'var(--accent-fg)' } : { color: TEXTO_SECUNDARIO }}>
                <List size={14} />Lista
              </button>
            </div>
            {esAdmin && (
              <button onClick={() => setMostrarGestionEtapas(true)} className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO, backgroundColor: 'var(--surface)' }}>
                <Settings size={14} />Editar etapas
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 pb-3 flex flex-wrap gap-3 shrink-0">
        {[
          { etiqueta: 'Leads abiertos', valor: String(abiertos.length), color: 'var(--fg)' },
          { etiqueta: 'Valor en juego', valor: `Bs. ${totalAbierto.toLocaleString('es-BO')}`, color: 'var(--fg)' },
          { etiqueta: 'Pronóstico ponderado', valor: `Bs. ${Math.round(ponderado).toLocaleString('es-BO')}`, color: 'var(--ok)' },
          { etiqueta: 'Sin moverse 3+ días', valor: String(estancados), color: estancados > 0 ? 'var(--warn)' : 'var(--fg)' },
        ].map((k) => (
          <div key={k.etiqueta} className="rounded-xl px-4 py-2.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', minWidth: 150 }}>
            <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>{k.etiqueta}</div>
            <div className="num text-[18px] font-bold" style={{ color: k.color }}>{k.valor}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        {vista === 'embudo' ? (
          <VistaEmbudo contactos={contactosVisibles} etapas={etapasVisibles} etiquetasDeContacto={etiquetasDeContacto} onMoverContacto={moverContacto} onAbrirLead={setLeadAbierto} onAbrirChat={onAbrirChat} />
        ) : (
          <VistaLista contactos={contactosVisibles} etapas={etapasVisibles} etiquetasDeContacto={etiquetasDeContacto} onMoverContacto={moverContacto} />
        )}
      </div>

      {dialogo}
      {mostrarGestionEtapas && !filtro.embudoPropio && <GestionEtapas etapas={etapasVisibles} onClose={() => setMostrarGestionEtapas(false)} />}
      {mostrarGestionEtapas && filtro.embudoPropio && usuario && (
        <VentanaEtapasDeEmbudo
          titulo={filtro.embudoPropio.nombre}
          embudoId={filtro.embudoPropio.id}
          empresaId={usuario.empresa_id}
          etapas={etapas}
          embudoDeEtapa={filtro.datos.embudoDeEtapa}
          puedeEditar={esAdmin}
          onCambio={filtro.datos.recargar}
          onCerrar={() => setMostrarGestionEtapas(false)}
        />
      )}
    </div>
  );
}
