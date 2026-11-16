import { useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, FileText } from 'lucide-react';
import { formatoHora, formatoWhatsApp } from './utils';
import type { Mensaje } from '../../lib/tipos';

// Un mensaje largo (plantillas, mensajes masivos) se recorta a ~8 líneas con
// un degradado y "Ver más".
const LINEAS_MAXIMAS = 8;
const INTERLINEADO_EM = 1.4;

function TextoColapsable({ texto, fondo }: { texto: string; fondo: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [largo, setLargo] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tamano = parseFloat(getComputedStyle(el).fontSize) || 14;
    setLargo(el.scrollHeight > LINEAS_MAXIMAS * INTERLINEADO_EM * tamano + 6);
  }, [texto]);

  const recortado = largo && !abierto;
  return (
    <>
      <div
        ref={ref}
        className="text-[14.5px] relative"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: INTERLINEADO_EM, maxHeight: recortado ? `${LINEAS_MAXIMAS * INTERLINEADO_EM}em` : undefined, overflow: recortado ? 'hidden' : undefined }}
      >
        {formatoWhatsApp(texto)}
        {recortado && <span aria-hidden="true" className="absolute left-0 right-0 bottom-0" style={{ height: '2.4em', background: `linear-gradient(transparent, ${fondo})` }} />}
      </div>
      {largo && (
        <button onClick={() => setAbierto((v) => !v)} className="text-[13px] font-semibold mt-0.5 self-start" style={{ color: 'var(--accent)' }}>
          {abierto ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </>
  );
}

export default function BurbujaMensaje({ m }: { m: Mensaje }) {
  const esAgente = m.remitente === 'agente';
  const fallo = esAgente && m.estado_entrega === 'error';
  const fondo = fallo ? 'var(--bad-soft)' : esAgente ? 'var(--bubble-out)' : 'var(--bubble-in)';
  return (
    <div
      className={`flex flex-col ${esAgente ? 'self-end' : 'self-start'}`}
      style={{
        maxWidth: 'min(70%, 560px)',
        padding: '9px 12px 6px',
        borderRadius: esAgente ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        backgroundColor: fondo,
        color: fallo ? 'var(--bad)' : 'var(--fg)',
        border: fallo ? '1px solid var(--bad)' : esAgente ? '1px solid transparent' : '1px solid var(--line)',
      }}
    >
      {m.tipo === 'imagen' && m.media_url && (
        <img src={m.media_url} alt="Imagen enviada" className="rounded-lg mb-1 max-w-full" style={{ maxHeight: '220px' }} />
      )}
      {(m.tipo === 'pdf' || m.tipo === 'documento') && m.media_url && (
        <a href={m.media_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 mb-1">
          <FileText size={22} color={fallo ? 'var(--bad)' : 'var(--accent)'} />
          <span className="text-sm truncate underline">{m.contenido || 'archivo'}</span>
        </a>
      )}
      {m.tipo === 'audio' && m.media_url && (
        // El navegador reproduce bien el archivo tal cual quedó grabado
        // (webm/ogg/m4a) — la conversión a ogg/opus es solo para el envío
        // por WhatsApp, ver server/src/whatsapp/audio.ts.
        <audio controls src={m.media_url} className="block" style={{ height: 32, width: 230, maxWidth: '100%' }} />
      )}
      {m.tipo === 'audio' && m.remitente === 'cliente' && m.contenido?.trim() && (
        // Lo que dijo en la nota de voz (lo transcribe la IA para poder responderle).
        <div className="mt-1 text-[12.5px] italic leading-snug" style={{ color: 'var(--fg-2)', maxWidth: 260 }} title="Transcripción de la nota de voz">
          🎤 {m.contenido}
        </div>
      )}
      {m.tipo === 'texto' && <TextoColapsable texto={m.contenido || ''} fondo={fondo} />}
      <span className="flex items-center justify-end gap-1 mt-0.5 text-[11.5px]" style={{ color: fallo ? 'var(--bad)' : 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
        {fallo ? (
          <>
            <AlertTriangle size={12} />
            No se pudo entregar
          </>
        ) : (
          <>
            {formatoHora(m.creado_en)}
            {/* Solo "enviado": todavía no rastreamos si lo entregaron/leyeron de verdad. */}
            {esAgente && <CheckCheck size={15} style={{ color: 'var(--accent)' }} aria-label="Enviado" />}
          </>
        )}
      </span>
    </div>
  );
}
