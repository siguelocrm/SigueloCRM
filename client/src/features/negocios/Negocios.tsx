import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { useEtapasVenta } from '../bandeja/hooks/useEtapasVenta';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { EncabezadoPagina, Tarjeta } from '../../components/ui';
import { useNegocios } from './useNegocios';
import FichasNegocios from './FichasNegocios';
import EmbudosNegocios from './EmbudosNegocios';
import AsignarPorNegocio from './AsignarPorNegocio';

type Pestana = 'negocios' | 'embudos' | 'respuestas' | 'bot';
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'negocios', texto: 'Negocios' },
  { id: 'embudos', texto: 'Embudos' },
  { id: 'respuestas', texto: 'Respuestas rápidas' },
  { id: 'bot', texto: 'Bot' },
];

// Negocios por número (SígueloCRM, Fase 2): un solo CRM con varios números,
// y cada número trabaja como un negocio con lo suyo.
export default function Negocios() {
  const { usuario } = useAuth();
  const datos = useNegocios(usuario?.empresa_id);
  const etapas = useEtapasVenta(usuario?.empresa_id);
  const [pestana, setPestana] = useState<Pestana>('negocios');
  const puedeEditar = usuario?.rol === 'dueno' || usuario?.rol === 'supervisor';

  if (!usuario) return null;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina titulo="Negocios" subtitulo="Varios números en el mismo CRM, y cada uno con su negocio: ficha, respuestas rápidas, bot y embudo." />

      {!datos.cargado ? (
        <div className="text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>
      ) : !datos.disponible ? (
        <Tarjeta className="p-5 flex items-start gap-3 max-w-2xl" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={20} color="var(--warn)" className="shrink-0 mt-0.5" />
          <div className="text-[13px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <div className="font-bold text-[14px] mb-1" style={{ color: TEXTO_PRIMARIO }}>Falta preparar la base de datos</div>
            Entra a tu Supabase → <b>SQL Editor</b>, pega todo el archivo <b>database/siguelo.sql</b> y pulsa <b>Run</b>. Es seguro repetirlo
            aunque ya lo hayas pegado antes. Después vuelve a esta pantalla.
          </div>
        </Tarjeta>
      ) : (
        <>
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
          {pestana === 'negocios' && <FichasNegocios datos={datos} empresaId={usuario.empresa_id} puedeEditar={puedeEditar} />}
          {pestana === 'embudos' && <EmbudosNegocios datos={datos} etapas={etapas} empresaId={usuario.empresa_id} puedeEditar={puedeEditar} />}
          {pestana === 'respuestas' && <AsignarPorNegocio tipo="respuestas" datos={datos} puedeEditar={puedeEditar} />}
          {pestana === 'bot' && <AsignarPorNegocio tipo="bot" datos={datos} puedeEditar={puedeEditar} />}
        </>
      )}
    </div>
  );
}
