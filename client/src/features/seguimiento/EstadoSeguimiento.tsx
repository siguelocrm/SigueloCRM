import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, XCircle } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta } from '../../components/ui';

// "¿Por qué no se programa?": lo que revisa el servidor (server/src/siguelo/estadoSeguimiento.ts).

type Revision = { ok: boolean; titulo: string; detalle?: string; aviso?: boolean };
type Estado = {
  general: Revision[];
  etapas: { nombre: string; tipo: string; recordatorios: string; reactivacion: string; respaldo: boolean }[];
  chats: { nombre: string; telefono: string; etapa: string; estado: string; ok: boolean }[];
};

const icono = (ok: boolean, aviso?: boolean) => {
  const I = !ok ? XCircle : aviso ? AlertTriangle : CheckCircle2;
  return <I size={15} color={!ok ? 'var(--bad)' : aviso ? 'var(--warn)' : 'var(--ok)'} className="shrink-0 mt-0.5" />;
};

export default function EstadoSeguimiento() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const revisar = useCallback(async () => {
    setCargando(true);
    const r = await llamarBackend('/siguelo/seguimiento/estado', {}).catch(() => ({ ok: false, data: null, error: 'No hay conexión con el servidor del CRM.' }));
    setCargando(false);
    if (!r.ok) return setError(r.error || 'No se pudo revisar.');
    setError('');
    setEstado(r.data.estado);
  }, []);

  useEffect(() => {
    revisar();
  }, [revisar]);

  if (error) return <Tarjeta className="px-4 py-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>¿Por qué no se programa? {error}</Tarjeta>;
  if (!estado) return null;
  const problemas = estado.general.filter((r) => !r.ok).length;

  return (
    <Tarjeta className="p-4 flex flex-col gap-3" style={{ borderColor: problemas ? 'var(--bad)' : BORDE }}>
      <div className="flex items-center gap-2 flex-wrap">
        {problemas ? <XCircle size={18} color="var(--bad)" /> : <CheckCircle2 size={18} color="var(--ok)" />}
        <span className="flex-1 min-w-[200px] text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
          {problemas ? `El seguimiento no puede funcionar: ${problemas} ${problemas === 1 ? 'cosa por arreglar' : 'cosas por arreglar'}` : '¿Por qué se programa (o no) el seguimiento?'}
        </span>
        <button onClick={() => setAbierto(!abierto)} className="flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
          {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {abierto ? 'Ocultar' : 'Ver detalle'}
        </button>
        <Boton tamano="sm" variante="fantasma" icono={RefreshCw} disabled={cargando} onClick={revisar}>{cargando ? 'Revisando…' : 'Revisar de nuevo'}</Boton>
      </div>
      {(abierto || problemas > 0) && (
        <>
          <div className="flex flex-col gap-1.5">
            {estado.general.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-[12.5px]">
                {icono(r.ok, r.aviso)}
                <span style={{ color: TEXTO_SECUNDARIO }}><b style={{ color: TEXTO_PRIMARIO }}>{r.titulo}</b>{r.detalle && <> — {r.detalle}</>}</span>
              </div>
            ))}
          </div>
          {abierto && (
            <>
              <div className="flex flex-col gap-1 pt-2.5" style={{ borderTop: `1px solid ${BORDE}` }}>
                <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Lo que recibe cada etapa</span>
                {estado.etapas.map((e) => (
                  <span key={e.nombre} className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                    <b style={{ color: TEXTO_PRIMARIO }}>{e.nombre}:</b> reactivación {e.reactivacion} · recordatorios {e.recordatorios}
                    {e.respaldo && <span style={{ color: TEXTO_TERCIARIO }}> (usa los de la primera etapa porque no tiene propios)</span>}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 pt-2.5" style={{ borderTop: `1px solid ${BORDE}` }}>
                <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Chats de las últimas 48 horas</span>
                {estado.chats.map((c) => (
                  <div key={c.telefono} className="flex items-start gap-2 text-[12.5px]">
                    {icono(c.ok)}
                    <span style={{ color: TEXTO_SECUNDARIO }}>
                      <b style={{ color: TEXTO_PRIMARIO }}>{c.nombre}</b> (+{c.telefono}) · {c.etapa} — {c.estado}
                    </span>
                  </div>
                ))}
                {!estado.chats.length && <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>No hubo chats en las últimas 48 horas.</span>}
              </div>
            </>
          )}
        </>
      )}
    </Tarjeta>
  );
}
