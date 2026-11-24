import { useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, Bot, CalendarClock, CheckCheck, Clock, FileText, Megaphone, PenLine, Repeat, Smartphone, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { formatoHora, formatoWhatsApp } from './utils';
import type { Mensaje } from '../../lib/tipos';
import type { OrigenMensaje } from './hooks/useMensajes';

// SígueloCRM: de dónde salió el mensaje, en chiquito dentro de la burbuja.
const IA: Record<string, string> = {
  ia_respuesta: 'IA',
  ia_respuesta_rapida: 'IA · Respuesta rápida',
  ia_grupo: 'IA · Invitación al grupo',
  ia_pase: 'IA · Pase a otra sucursal',
  ia_qr: 'IA · QR de pago',
  ia_pago: 'Inscripción (pago)',
  ia_bot: 'IA activó el bot',
};
export function etiquetaOrigen(o: OrigenMensaje | undefined): { Icono: LucideIcon; texto: string } | null {
  if (!o) return null;
  const con = (base: string) => (o.detalle ? `${base} · ${o.detalle}` : base);
  switch (o.origen) {
    case 'seguimiento': return { Icono: Repeat, texto: con('Seguimiento') };
    case 'cita': return { Icono: CalendarClock, texto: con('Cita') };
    case 'masivo': return { Icono: Megaphone, texto: con('Masivo') };
    case 'bot': return { Icono: Bot, texto: con('Bot') };
    case 'programado': return { Icono: Clock, texto: 'Programado' };
    case 'telefono': return { Icono: Smartphone, texto: 'Desde el teléfono' };
    case 'automatico': return { Icono: Zap, texto: con('Automático') };
    case 'persona': return { Icono: PenLine, texto: o.detalle || 'Escrito en el CRM' };
    case 'ia_aviso': return { Icono: Bell, texto: 'Aviso' };
  }
  if (o.origen.startsWith('ia_')) {
    const base = IA[o.origen] || 'IA';
    return { Icono: Sparkles, texto: o.origen === 'ia_respuesta_rapida' && o.detalle ? `${base}: ${o.detalle}` : base };
  }
  return null;
}

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

export default function BurbujaMensaje({ m, origen }: { m: Mensaje; origen?: OrigenMensaje }) {
  const esAgente = m.remitente === 'agente';
  const fallo = esAgente && m.estado_entrega === 'error';
  const fondo = fallo ? 'var(--bad-soft)' : esAgente ? 'var(--bubble-out)' : 'var(--bubble-in)';
  const etiqueta = esAgente ? etiquetaOrigen(origen) : null;
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
        {etiqueta && (
          <span className="mr-auto pr-3 flex items-center gap-1 min-w-0 text-[11px]" title={etiqueta.texto}>
            <etiqueta.Icono size={11} className="shrink-0" />
            <span className="truncate" style={{ maxWidth: 260 }}>{etiqueta.texto}</span>
          </span>
        )}
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
