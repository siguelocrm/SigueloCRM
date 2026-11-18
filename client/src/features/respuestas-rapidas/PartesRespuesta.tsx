import { useRef } from 'react';
import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, Mic, Plus, Trash2, X } from 'lucide-react';
import type { TipoMensaje } from '../../lib/tipos';

// Los mensajes que siguen al primero en una respuesta rápida (como en un flujo): cada uno es
// un texto, o un archivo (imagen, documento o audio) con su texto. Salen en este orden.

export type BorradorParte = { tipo: TipoMensaje; contenido: string; media_url: string | null; archivo?: File | null };

const campoStyle = { border: '1px solid var(--line-2)', backgroundColor: 'var(--surface-2)', color: 'var(--fg)' } as const;
const NOMBRE: Record<string, string> = { imagen: 'Imagen', pdf: 'Documento', documento: 'Documento', audio: 'Audio' };

function Parte({ p, i, total, onCambiar, onQuitar, onMover }: { p: BorradorParte; i: number; total: number; onCambiar: (p: BorradorParte) => void; onQuitar: () => void; onMover: (d: -1 | 1) => void }) {
  const refs = { imagen: useRef<HTMLInputElement>(null), pdf: useRef<HTMLInputElement>(null), audio: useRef<HTMLInputElement>(null) };
  const conArchivo = p.archivo || p.media_url;
  const elegir = (file: File | undefined, tipo: 'imagen' | 'pdf' | 'audio') => file && onCambiar({ ...p, tipo, archivo: file });
  return (
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ border: '1px solid var(--line)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold flex-1" style={{ color: 'var(--fg-2)' }}>Mensaje {i + 2}</span>
        <button type="button" disabled={i === 0} onClick={() => onMover(-1)} aria-label="Subir" style={{ opacity: i === 0 ? 0.3 : 1 }}><ArrowUp size={14} color="var(--fg-3)" /></button>
        <button type="button" disabled={i === total - 1} onClick={() => onMover(1)} aria-label="Bajar" style={{ opacity: i === total - 1 ? 0.3 : 1 }}><ArrowDown size={14} color="var(--fg-3)" /></button>
        <button type="button" onClick={onQuitar} aria-label={`Quitar el mensaje ${i + 2}`}><Trash2 size={14} color="var(--fg-3)" /></button>
      </div>
      <textarea
        value={p.contenido}
        onChange={(e) => onCambiar({ ...p, contenido: e.target.value })}
        placeholder={conArchivo ? 'Texto del archivo (opcional)' : 'Escribe el mensaje…'}
        rows={3}
        className="rounded-lg px-2.5 py-2 outline-none text-[13.5px] resize-y leading-relaxed"
        style={campoStyle}
      />
      <input ref={refs.imagen} type="file" accept="image/*" hidden onChange={(e) => elegir(e.target.files?.[0], 'imagen')} />
      <input ref={refs.pdf} type="file" accept="application/pdf" hidden onChange={(e) => elegir(e.target.files?.[0], 'pdf')} />
      <input ref={refs.audio} type="file" accept="audio/*" hidden onChange={(e) => elegir(e.target.files?.[0], 'audio')} />
      {conArchivo ? (
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5" style={campoStyle}>
          <span className="text-[12.5px] truncate">{NOMBRE[p.tipo] ?? 'Archivo'}{p.archivo ? `: ${p.archivo.name}` : ' (ya guardado)'}</span>
          <button type="button" onClick={() => onCambiar({ ...p, tipo: 'texto', media_url: null, archivo: null })} aria-label="Quitar archivo"><X size={14} color="var(--fg-3)" /></button>
        </div>
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          {([['imagen', ImageIcon, 'Imagen'], ['pdf', FileText, 'Documento'], ['audio', Mic, 'Audio']] as const).map(([t, Icono, nombre]) => (
            <button key={t} type="button" onClick={() => refs[t].current?.click()} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}>
              <Icono size={13} color="var(--accent)" />+ {nombre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PartesRespuesta({ partes, onCambiar }: { partes: BorradorParte[]; onCambiar: (p: BorradorParte[]) => void }) {
  const mover = (i: number, d: -1 | 1) => {
    const otra = [...partes];
    [otra[i], otra[i + d]] = [otra[i + d], otra[i]];
    onCambiar(otra);
  };
  return (
    <div className="flex flex-col gap-2">
      {partes.length > 0 && <span className="text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>Mensajes que siguen (salen en este orden)</span>}
      {partes.map((p, i) => (
        <Parte key={i} p={p} i={i} total={partes.length} onCambiar={(x) => onCambiar(partes.map((y, j) => (j === i ? x : y)))} onQuitar={() => onCambiar(partes.filter((_, j) => j !== i))} onMover={(d) => mover(i, d)} />
      ))}
      {partes.length < 10 && (
        <button type="button" onClick={() => onCambiar([...partes, { tipo: 'texto', contenido: '', media_url: null }])} className="self-start flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold" style={{ border: '1px dashed var(--accent)', color: 'var(--accent)' }}>
          <Plus size={14} /> Agregar otro mensaje (texto o archivo)
        </button>
      )}
    </div>
  );
}
