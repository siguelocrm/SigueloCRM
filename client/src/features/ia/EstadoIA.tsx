import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta } from '../../components/ui';

// "¿Por qué no responde?": lo que revisa el servidor (server/src/siguelo/ia/estado.ts),
// en general y número por número. Si todo está bien, queda en una línea.

type Revision = { ok: boolean; titulo: string; detalle?: string; aviso?: boolean };
type Estado = { general: Revision[]; numeros: { id: string; nombre: string; numero: string | null; negocio: string | null; revisiones: Revision[] }[]; listo: boolean };

function Fila({ r }: { r: Revision }) {
  const Icono = !r.ok ? XCircle : r.aviso ? AlertTriangle : CheckCircle2;
  const color = !r.ok ? 'var(--bad)' : r.aviso ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <Icono size={15} color={color} className="shrink-0 mt-0.5" />
      <span style={{ color: TEXTO_SECUNDARIO }}>
        <b style={{ color: r.ok && !r.aviso ? TEXTO_SECUNDARIO : TEXTO_PRIMARIO, fontWeight: r.ok && !r.aviso ? 500 : 600 }}>{r.titulo}</b>
        {r.detalle && <> — {r.detalle}</>}
      </span>
    </div>
  );
}

export default function EstadoIA() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const revisar = useCallback(async () => {
    setCargando(true);
    const r = await llamarBackend('/siguelo/ia/estado', {}).catch(() => ({ ok: false, data: null, error: 'No hay conexión con el servidor del CRM.' }));
    setCargando(false);
    if (!r.ok) return setError(r.error || 'No se pudo revisar.');
    setError('');
    setEstado(r.data.estado);
  }, []);

  useEffect(() => {
    revisar();
  }, [revisar]);

  if (error) return <Tarjeta className="px-4 py-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>¿Por qué no responde? {error}</Tarjeta>;
  if (!estado) return <Tarjeta className="px-4 py-3 text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>Revisando si la IA puede responder…</Tarjeta>;

  const problemas = [...estado.general, ...estado.numeros.flatMap((n) => n.revisiones)].filter((r) => !r.ok).length;
  const listos = estado.numeros.filter((n) => n.revisiones.every((r) => r.ok)).map((n) => n.nombre);
  const ver = abierto || problemas > 0;

  return (
    <Tarjeta className="p-4 flex flex-col gap-3" style={{ borderColor: problemas ? 'var(--bad)' : BORDE }}>
      <div className="flex items-center gap-2 flex-wrap">
        {problemas ? <XCircle size={18} color="var(--bad)" /> : <CheckCircle2 size={18} color="var(--ok)" />}
        <span className="flex-1 min-w-[200px] text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
          {problemas
            ? `La IA no puede responder bien: ${problemas} ${problemas === 1 ? 'cosa por arreglar' : 'cosas por arreglar'}`
            : `La IA está lista para responder${listos.length ? ` en: ${listos.join(', ')}` : ''}`}
        </span>
        {!problemas && (
          <button onClick={() => setAbierto(!abierto)} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>{abierto ? 'Ocultar' : 'Ver detalle'}</button>
        )}
        <Boton tamano="sm" variante="fantasma" icono={RefreshCw} disabled={cargando} onClick={revisar}>{cargando ? 'Revisando…' : 'Revisar de nuevo'}</Boton>
      </div>
      {ver && (
        <>
          <div className="flex flex-col gap-1.5">
            {estado.general.map((r, i) => <Fila key={i} r={r} />)}
          </div>
          {estado.numeros.map((n) => (
            <div key={n.id} className="flex flex-col gap-1.5 pt-2.5" style={{ borderTop: `1px solid ${BORDE}` }}>
              <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>
                📱 {n.nombre}{n.numero ? ` (+${n.numero})` : ''}{n.negocio ? ` → ${n.negocio}` : ''}
              </span>
              {n.revisiones.map((r, i) => <Fila key={i} r={r} />)}
            </div>
          ))}
          {!estado.numeros.length && <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>No hay números de WhatsApp: conéctalos en Administrar → Conexiones.</span>}
        </>
      )}
    </Tarjeta>
  );
}
