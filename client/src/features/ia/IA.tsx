import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { EncabezadoPagina, Tarjeta } from '../../components/ui';
import { useNegocios } from '../negocios/useNegocios';
import ResumenIA from './ResumenIA';
import AjustesIA from './AjustesIA';
import ProbarIA from './ProbarIA';
import AsistenteIA from './AsistenteIA';
import { ajustesIAPorDefecto, type AjustesIA as Ajustes } from './tipos';

type Pestana = 'asistente' | 'resumen' | 'ajustes' | 'probar';
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'asistente', texto: 'Asistente' },
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ajustes', texto: 'Ajustes' },
  { id: 'probar', texto: 'Probar' },
];

// IA (SígueloCRM, Fase 3): responde con la ficha de cada negocio. El servidor
// (server/src/siguelo/ia) es quien lee y envía.
export default function IA({ onAbrirChat }: { onAbrirChat?: (telefono: string) => void }) {
  const { usuario } = useAuth();
  const negocios = useNegocios(usuario?.empresa_id);
  const [pestana, setPestana] = useState<Pestana>('asistente');
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [existe, setExiste] = useState(false);
  const [faltaSql, setFaltaSql] = useState(false);
  const puedeEditar = usuario?.rol === 'dueno' || usuario?.rol === 'supervisor';

  const cargar = useCallback(async () => {
    if (!usuario) return;
    const { data, error } = await supabase.from('siguelo_ia').select('*').maybeSingle();
    if (error) return setFaltaSql(true);
    setFaltaSql(false);
    setExiste(!!data);
    const nuevos = (data as Ajustes | null) ?? ajustesIAPorDefecto(usuario.empresa_id);
    setAjustes((previos) => (JSON.stringify(previos) === JSON.stringify(nuevos) ? previos : nuevos));
  }, [usuario]);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 30000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  if (faltaSql) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
        <EncabezadoPagina titulo="IA" />
        <Tarjeta className="p-5 flex items-start gap-3 max-w-2xl" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={20} color="var(--warn)" className="shrink-0 mt-0.5" />
          <div className="text-[13px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <div className="font-bold text-[14px] mb-1" style={{ color: TEXTO_PRIMARIO }}>Falta preparar la base de datos</div>
            Entra a tu Supabase → <b>SQL Editor</b>, pega todo el archivo <b>database/siguelo.sql</b> y pulsa <b>Run</b>. Es seguro repetirlo.
          </div>
        </Tarjeta>
      </div>
    );
  }
  if (!ajustes || !usuario) return <div className="p-6 text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>;

  const nombresLinea = Object.fromEntries(negocios.lineas.map((l) => [l.id, l.nombre]));

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina titulo="IA" subtitulo="Responde a tus clientes con la ficha de cada negocio, te muestra lo que necesita que veas y te avisa por WhatsApp." />

      {(!ajustes.activa || !ajustes.clave_final) && (
        <Tarjeta className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[12.5px] flex-1 min-w-[200px]" style={{ color: TEXTO_SECUNDARIO }}>
            {!ajustes.clave_final ? 'Para empezar, guarda tu clave de OpenAI en Ajustes.' : 'La IA está apagada. Actívala en Ajustes cuando tus fichas estén listas.'}
            {negocios.disponible && negocios.negocios.some((n) => !n.info_ia?.trim()) && ' Hay negocios sin información para la IA (Administrar → Negocios).'}
          </span>
          <button onClick={() => setPestana('ajustes')} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>Ir a Ajustes</button>
        </Tarjeta>
      )}

      <div role="tablist" className="flex gap-1 overflow-x-auto shrink-0" style={{ borderBottom: `1px solid ${BORDE}` }}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className="px-3 py-2 text-[13px] whitespace-nowrap -mb-px"
            style={{ color: pestana === p.id ? 'var(--accent)' : TEXTO_SECUNDARIO, fontWeight: pestana === p.id ? 600 : 500, borderBottom: `2px solid ${pestana === p.id ? 'var(--accent)' : 'transparent'}` }}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {pestana === 'asistente' && <AsistenteIA hayClave={!!ajustes.clave_final} onCambios={cargar} />}
      {pestana === 'resumen' && <ResumenIA ajustes={ajustes} lineas={nombresLinea} onAbrirChat={onAbrirChat} />}
      {pestana === 'ajustes' && <AjustesIA ajustes={ajustes} existe={existe} lineas={negocios.lineas} puedeEditar={puedeEditar} onGuardado={cargar} />}
      {pestana === 'probar' && <ProbarIA negocios={negocios.negocios} hayClave={!!ajustes.clave_final} />}
    </div>
  );
}
