import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Pause, Power } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { useEtapasVenta } from '../bandeja/hooks/useEtapasVenta';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { EncabezadoPagina, Tarjeta } from '../../components/ui';
import type { AjustesSeguimiento as Ajustes, EtapaSeguimiento } from './tipos';
import { ajustesPorDefecto } from './plantillas';
import EtapasSeguimiento from './EtapasSeguimiento';
import ColaSeguimiento from './ColaSeguimiento';
import ContactosSeguimiento from './ContactosSeguimiento';
import AjustesSeguimiento from './AjustesSeguimiento';

type Pestana = 'etapas' | 'cola' | 'contactos' | 'ajustes';
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'etapas', texto: 'Mensajes por etapa' },
  { id: 'cola', texto: 'Cola' },
  { id: 'contactos', texto: 'Contactos' },
  { id: 'ajustes', texto: 'Ajustes' },
];

// Seguimiento automático (traído de la extensión SígueloCRM): recordatorios y
// reactivaciones por etapa del embudo, con una cola que respeta tu horario y un
// máximo por día. El servidor (server/src/siguelo) es quien envía.
export default function Seguimiento() {
  const { usuario } = useAuth();
  const etapas = useEtapasVenta(usuario?.empresa_id);
  const [pestana, setPestana] = useState<Pestana>('etapas');
  const [faltaSql, setFaltaSql] = useState(false);
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [existe, setExiste] = useState(false);
  const [configs, setConfigs] = useState<Record<string, EtapaSeguimiento>>({});
  const puedeEditar = usuario?.rol === 'dueno' || usuario?.rol === 'supervisor';

  const cargar = useCallback(async () => {
    if (!usuario) return;
    const [aj, cfg] = await Promise.all([
      supabase.from('siguelo_ajustes').select('*').maybeSingle(),
      // Por ahora solo los textos generales (los de cada negocio llegan en su fase).
      supabase.from('siguelo_etapas').select('*').is('negocio_id', null).returns<EtapaSeguimiento[]>(),
    ]);
    if (aj.error || cfg.error) {
      setFaltaSql(true);
      return;
    }
    setFaltaSql(false);
    setExiste(!!aj.data);
    // Solo se reemplazan si cambiaron: así no se borra lo que estás escribiendo en Ajustes.
    const nuevos = (aj.data as Ajustes | null) ?? ajustesPorDefecto(usuario.empresa_id);
    setAjustes((previos) => (JSON.stringify(previos) === JSON.stringify(nuevos) ? previos : nuevos));
    const nuevasConfigs = Object.fromEntries((cfg.data || []).map((c) => [c.etapa_id, c]));
    setConfigs((previas) => (JSON.stringify(previas) === JSON.stringify(nuevasConfigs) ? previas : nuevasConfigs));
  }, [usuario]);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 30000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  if (faltaSql) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
        <EncabezadoPagina titulo="Seguimiento automático" />
        <Tarjeta className="p-5 flex items-start gap-3 max-w-2xl" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={20} color="var(--warn)" className="shrink-0 mt-0.5" />
          <div className="text-[13px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <div className="font-bold text-[14px] mb-1" style={{ color: TEXTO_PRIMARIO }}>Falta preparar la base de datos</div>
            Entra a tu Supabase → <b>SQL Editor</b>, pega todo el archivo <b>database/siguelo.sql</b> y pulsa <b>Run</b>. Se hace una sola vez y
            es seguro repetirlo. Después vuelve a esta pantalla.
          </div>
        </Tarjeta>
      </div>
    );
  }

  if (!ajustes) return <div className="p-6 text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>;

  const etapasOrdenadas = [...etapas].sort((a, b) => a.orden - b.orden);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina
        titulo="Seguimiento automático"
        subtitulo="Recordatorios y reactivaciones por etapa, con una cola que respeta tu horario y un máximo de mensajes por día."
      />

      {(!ajustes.activo || ajustes.pausado) && (
        <Tarjeta className="px-4 py-3 flex items-center gap-3 flex-wrap">
          {ajustes.activo ? <Pause size={16} color="var(--warn)" /> : <Power size={16} color={TEXTO_TERCIARIO} />}
          <span className="text-[12.5px] flex-1 min-w-[200px]" style={{ color: TEXTO_SECUNDARIO }}>
            {ajustes.activo
              ? `En pausa${ajustes.motivo_pausa ? ` (${ajustes.motivo_pausa})` : ''}: no sale nada hasta que la quites en Ajustes.`
              : 'Está apagado. Prepara tus mensajes por etapa y actívalo en Ajustes cuando estés listo.'}
          </span>
          <button onClick={() => setPestana('ajustes')} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>Ir a Ajustes</button>
        </Tarjeta>
      )}

      <div role="tablist" className="flex gap-1 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDE}` }}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className="px-3 py-2 text-[13px] whitespace-nowrap -mb-px"
            style={{
              color: pestana === p.id ? 'var(--accent)' : TEXTO_SECUNDARIO,
              fontWeight: pestana === p.id ? 600 : 500,
              borderBottom: `2px solid ${pestana === p.id ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {pestana === 'etapas' && <EtapasSeguimiento etapas={etapasOrdenadas} configs={configs} empresaId={usuario!.empresa_id} puedeEditar={puedeEditar} onGuardado={cargar} />}
      {pestana === 'cola' && <ColaSeguimiento ajustes={ajustes} />}
      {pestana === 'contactos' && <ContactosSeguimiento etapas={etapasOrdenadas} configs={configs} />}
      {pestana === 'ajustes' && <AjustesSeguimiento ajustes={ajustes} existe={existe} puedeEditar={puedeEditar} onGuardado={cargar} />}
    </div>
  );
}
