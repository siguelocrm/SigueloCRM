import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, LayoutGrid, List, Mic, Plus, Search, Trash2, X, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { formatoWhatsApp } from '../bandeja/utils';
import { Boton, Chip, EncabezadoPagina, EstadoVacio, useToast } from '../../components/ui';
import type { RespuestaRapida, TipoMensaje } from '../../lib/tipos';
import PartesRespuesta, { type BorradorParte } from './PartesRespuesta';

type TipoAdjunto = Exclude<TipoMensaje, 'texto'>;
type Filtro = 'todas' | 'texto' | TipoAdjunto;

const ETIQUETA_TIPO: Record<TipoAdjunto, string> = { imagen: 'Imagen', pdf: 'Documento', documento: 'Documento', audio: 'Audio' };
const ICONO_TIPO = { imagen: ImageIcon, pdf: FileText, documento: FileText, audio: Mic } as const;

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: 'todas', etiqueta: 'Todas' },
  { id: 'texto', etiqueta: 'Texto' },
  { id: 'imagen', etiqueta: 'Imágenes' },
  { id: 'pdf', etiqueta: 'Documentos' },
  { id: 'audio', etiqueta: 'Audios' },
];

// "pdf" y "documento" se muestran juntos como Documentos.
const coincideFiltro = (r: RespuestaRapida, f: Filtro) =>
  f === 'todas' ? true : f === 'texto' ? r.tipo === 'texto' : f === 'pdf' ? r.tipo === 'pdf' || r.tipo === 'documento' : r.tipo === f;

const campoStyle = { border: '1px solid var(--line-2)', backgroundColor: 'var(--surface-2)', color: 'var(--fg)' } as const;

// Biblioteca de respuestas rápidas: tarjetas compactas con buscador y filtros
// por tipo, para que quepan decenas sin ocupar toda la pantalla. El formulario
// (crear y editar) se abre en una ventana aparte.
export default function RespuestasRapidas() {
  const { usuario } = useAuth();
  const toast = useToast();
  const [respuestas, setRespuestas] = useState<RespuestaRapida[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [vista, setVista] = useState<'tarjetas' | 'lista'>(() => {
    try { return localStorage.getItem('rr-vista') === 'lista' ? 'lista' : 'tarjetas'; } catch { return 'tarjetas'; }
  });

  // Formulario: null = cerrado; 'nueva' o la respuesta que se edita.
  const [editor, setEditor] = useState<'nueva' | RespuestaRapida | null>(null);
  const [titulo, setTitulo] = useState('');
  const [atajo, setAtajo] = useState('');
  const [contenido, setContenido] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [tipoArchivo, setTipoArchivo] = useState<TipoAdjunto | null>(null);
  const [quitarExistente, setQuitarExistente] = useState(false);
  const [partes, setPartes] = useState<BorradorParte[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const inputImagenRef = useRef<HTMLInputElement>(null);
  const inputPdfRef = useRef<HTMLInputElement>(null);
  const inputAudioRef = useRef<HTMLInputElement>(null);

  const cargar = async () => {
    const { data } = await supabase.from('respuestas_rapidas').select('*, usuarios(nombre)').order('titulo').returns<RespuestaRapida[]>();
    setRespuestas(data || []);
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.empresa_id]);

  const cambiarVista = (v: 'tarjetas' | 'lista') => {
    setVista(v);
    try { localStorage.setItem('rr-vista', v); } catch { /* sin storage: no se recuerda */ }
  };

  const conteo = (f: Filtro) => respuestas.filter((r) => coincideFiltro(r, f)).length;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return respuestas.filter(
      (r) => coincideFiltro(r, filtro) && (!q || r.titulo.toLowerCase().includes(q) || (r.atajo || '').includes(q) || r.contenido.toLowerCase().includes(q)),
    );
  }, [respuestas, busqueda, filtro]);

  // ---- Formulario ----
  const limpiarArchivo = () => {
    setArchivo(null);
    setTipoArchivo(null);
    if (inputImagenRef.current) inputImagenRef.current.value = '';
    if (inputPdfRef.current) inputPdfRef.current.value = '';
    if (inputAudioRef.current) inputAudioRef.current.value = '';
  };

  const abrirNueva = () => {
    setTitulo(''); setAtajo(''); setContenido(''); setError(''); setQuitarExistente(false); setPartes([]);
    limpiarArchivo();
    setEditor('nueva');
  };

  const abrirEdicion = (r: RespuestaRapida) => {
    setTitulo(r.titulo); setAtajo(r.atajo || ''); setContenido(r.contenido || ''); setError(''); setQuitarExistente(false);
    setPartes((r.partes || []).map((p) => ({ ...p })));
    limpiarArchivo();
    setEditor(r);
  };

  const cerrarEditor = () => setEditor(null);

  const elegirArchivo = (file: File, tipo: TipoAdjunto) => {
    setArchivo(file);
    setTipoArchivo(tipo);
    setQuitarExistente(false);
    setError('');
  };

  const guardar = async () => {
    const editando = editor !== 'nueva' && editor !== null ? editor : null;
    if (!titulo.trim()) return setError('Ponle un título para encontrarla después.');
    const conservaAdjunto = !!editando && editando.tipo !== 'texto' && !quitarExistente && !archivo;
    if (!archivo && !conservaAdjunto && !contenido.trim()) return setError('Escribe el mensaje o adjunta un archivo.');
    setError('');
    const atajoLimpio = atajo.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (atajoLimpio && respuestas.some((r) => r.atajo === atajoLimpio && r.id !== editando?.id)) {
      return setError(`El atajo /${atajoLimpio} ya lo usa otra respuesta.`);
    }
    const vacia = partes.findIndex((p) => !p.contenido.trim() && !p.archivo && !p.media_url);
    if (vacia >= 0) return setError(`El mensaje ${vacia + 2} está vacío: escribe algo, adjunta un archivo o quítalo.`);

    setGuardando(true);
    try {
      let mediaUrl: string | null = editando && !quitarExistente ? editando.media_url : null;
      let tipo: TipoMensaje = editando && !quitarExistente ? editando.tipo : 'texto';
      if (archivo && tipoArchivo) {
        const ext = archivo.name.split('.').pop();
        const ruta = `${usuario!.empresa_id}/respuestas-rapidas/${Date.now()}.${ext}`;
        const { error: errorSubida } = await supabase.storage.from('media').upload(ruta, archivo);
        if (errorSubida) throw errorSubida;
        mediaUrl = supabase.storage.from('media').getPublicUrl(ruta).data.publicUrl;
        tipo = tipoArchivo;
      }
      // Los mensajes que siguen: se suben sus archivos nuevos.
      const listas = [];
      for (const [i, p] of partes.entries()) {
        let url = p.media_url;
        if (p.archivo) {
          const ruta = `${usuario!.empresa_id}/respuestas-rapidas/${Date.now()}-${i}.${p.archivo.name.split('.').pop()}`;
          const { error: e } = await supabase.storage.from('media').upload(ruta, p.archivo);
          if (e) throw e;
          url = supabase.storage.from('media').getPublicUrl(ruta).data.publicUrl;
        }
        listas.push({ tipo: url ? p.tipo : 'texto', contenido: p.contenido, media_url: url });
      }
      const datos = {
        titulo: titulo.trim(),
        atajo: atajoLimpio || null,
        contenido: contenido || '',
        tipo,
        media_url: mediaUrl,
        // Sin la sección 44 del SQL la columna no existe: solo se manda si se usa.
        ...(listas.length || editando?.partes?.length ? { partes: listas } : {}),
      };
      const { error: errorBD } = editando
        ? await supabase.from('respuestas_rapidas').update(datos).eq('id', editando.id)
        : await supabase.from('respuestas_rapidas').insert({ ...datos, empresa_id: usuario!.empresa_id, creado_por: usuario!.id });
      if (errorBD) throw errorBD;
      toast(editando ? 'Respuesta actualizada' : 'Respuesta guardada', 'ok');
      cerrarEditor();
      cargar();
    } catch (err) {
      console.error(err);
      const m = (err as { message?: string })?.message || '';
      setError(/partes/.test(m) ? 'Para guardar varios mensajes falta pegar la sección 44 de database/siguelo.sql en Supabase.' : 'No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (r: RespuestaRapida) => {
    if (!window.confirm(`¿Eliminar la respuesta "${r.titulo}"?`)) return;
    await supabase.from('respuestas_rapidas').delete().eq('id', r.id);
    toast('Respuesta eliminada', 'ok');
    if (editor !== 'nueva' && editor?.id === r.id) cerrarEditor();
    cargar();
  };

  const editando = editor !== 'nueva' && editor !== null ? editor : null;
  const adjuntoActual = editando && editando.tipo !== 'texto' && !quitarExistente && !archivo ? (editando.tipo as TipoAdjunto) : null;

  // ---- Piezas visuales ----
  const insigniaTipo = (r: RespuestaRapida) => {
    if (r.tipo === 'texto') return null;
    const Icono = ICONO_TIPO[r.tipo as TipoAdjunto];
    return <Chip icono={Icono}>{ETIQUETA_TIPO[r.tipo as TipoAdjunto]}</Chip>;
  };

  const tarjeta = (r: RespuestaRapida) => (
    <div
      key={r.id}
      role="button"
      tabIndex={0}
      onClick={() => abrirEdicion(r)}
      onKeyDown={(e) => { if (e.key === 'Enter') abrirEdicion(r); }}
      className="group card-ui flex flex-col gap-1.5 px-4 py-3 text-left cursor-pointer relative"
      style={{ transition: 'border-color .15s, transform .15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
    >
      <div className="flex items-start gap-2 pr-6">
        <span className="font-bold text-[14px] truncate" style={{ color: 'var(--fg)' }}>{r.titulo}</span>
      </div>
      <button onClick={(e) => { e.stopPropagation(); eliminar(r); }} aria-label={`Eliminar ${r.titulo}`} className="absolute top-2.5 right-2.5 p-1 rounded-md opacity-60 hover:opacity-100">
        <Trash2 size={14} color="var(--fg-3)" />
      </button>
      <div className="flex items-center gap-1.5 flex-wrap">
        {r.atajo ? <span className="num text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>/{r.atajo}</span> : <span className="text-[12px]" style={{ color: 'var(--fg-3)' }}>Sin atajo</span>}
        {insigniaTipo(r)}
        {!!r.partes?.length && <Chip>+{r.partes.length} {r.partes.length === 1 ? 'mensaje' : 'mensajes'}</Chip>}
      </div>
      <div className="text-[13px] leading-snug break-words" style={{ color: 'var(--fg-2)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '3.9em' }}>
        {r.contenido ? r.contenido.replace(/\s+/g, ' ') : <span style={{ color: 'var(--fg-3)' }}>(solo adjunto)</span>}
      </div>
    </div>
  );

  const fila = (r: RespuestaRapida) => (
    <div
      key={r.id}
      role="button"
      tabIndex={0}
      onClick={() => abrirEdicion(r)}
      onKeyDown={(e) => { if (e.key === 'Enter') abrirEdicion(r); }}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
      style={{ borderBottom: '1px solid var(--line)' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      <span className="font-semibold text-[13.5px] shrink-0 truncate" style={{ width: 200, color: 'var(--fg)' }}>{r.titulo}</span>
      <span className="num text-[12px] font-semibold shrink-0 truncate" style={{ width: 110, color: 'var(--accent)' }}>{r.atajo ? `/${r.atajo}` : ''}</span>
      <span className="shrink-0 hidden sm:block" style={{ width: 100 }}>{insigniaTipo(r)}</span>
      <span className="flex-1 min-w-0 truncate text-[13px]" style={{ color: 'var(--fg-2)' }}>{r.contenido ? r.contenido.replace(/\s+/g, ' ') : '(solo adjunto)'}</span>
      <button onClick={(e) => { e.stopPropagation(); eliminar(r); }} aria-label={`Eliminar ${r.titulo}`} className="p-1 shrink-0"><Trash2 size={14} color="var(--fg-3)" /></button>
    </div>
  );

  const BotonAdjunto = ({ icono: Icono, etiqueta, onClick }: { icono: typeof ImageIcon; etiqueta: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}>
      <Icono size={14} color="var(--accent)" />{etiqueta}
    </button>
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="aparecer px-4 md:px-7 py-5 md:py-6 flex flex-col gap-4">
        <EncabezadoPagina
          titulo="Respuestas rápidas"
          subtitulo={'Escribe una vez, úsala siempre. En el chat se insertan tecleando el atajo con "/".'}
          accion={<Boton variante="primario" icono={Plus} onClick={abrirNueva}>Nueva respuesta</Boton>}
        />

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1" style={{ minWidth: 220, maxWidth: 420, backgroundColor: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>
            <Search size={15} className="shrink-0" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por título, atajo o texto" aria-label="Buscar respuesta" className="bg-transparent outline-none w-full min-w-0 text-[13.5px]" style={{ color: 'var(--fg)' }} />
          </label>
          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Filtrar por tipo">
            {FILTROS.map((f) => {
              const activo = filtro === f.id;
              const n = conteo(f.id);
              if (f.id !== 'todas' && f.id !== 'texto' && n === 0 && !activo) return null;
              return (
                <button key={f.id} role="tab" aria-selected={activo} onClick={() => setFiltro(f.id)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ backgroundColor: activo ? 'var(--accent-soft)' : 'transparent', color: activo ? 'var(--accent)' : 'var(--fg-2)', border: `1px solid ${activo ? 'transparent' : 'var(--line)'}` }}>
                  {f.etiqueta}<span className="num text-[11.5px] opacity-80">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-xl p-[3px] ml-auto" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)' }} role="group" aria-label="Vista">
            {([['tarjetas', LayoutGrid, 'Tarjetas'], ['lista', List, 'Lista']] as const).map(([id, Icono, nombre]) => (
              <button key={id} onClick={() => cambiarVista(id)} aria-label={`Vista de ${nombre.toLowerCase()}`} aria-pressed={vista === id} className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: vista === id ? 'var(--surface-3)' : 'transparent', color: vista === id ? 'var(--fg)' : 'var(--fg-3)' }}>
                <Icono size={15} />
              </button>
            ))}
          </div>
        </div>

        {respuestas.length === 0 ? (
          <div className="card-ui flex">
            <EstadoVacio icono={Zap} titulo="Todavía no creaste ninguna" texto="Las 3 preguntas que más repites (precio, horarios, medios de pago) son un buen comienzo." accion={<Boton variante="primario" icono={Plus} onClick={abrirNueva}>Crear la primera</Boton>} />
          </div>
        ) : visibles.length === 0 ? (
          <div className="card-ui flex"><EstadoVacio icono={Search} titulo="Ninguna coincide" texto="Prueba con otra palabra o cambia el filtro." /></div>
        ) : vista === 'tarjetas' ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>{visibles.map(tarjeta)}</div>
        ) : (
          <div className="card-ui overflow-hidden">{visibles.map(fila)}</div>
        )}
        <div className="text-[12px]" style={{ color: 'var(--fg-3)' }}>{visibles.length} de {respuestas.length} respuestas</div>
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(2,8,20,.6)', backdropFilter: 'blur(4px)' }} onClick={cerrarEditor}>
          <div role="dialog" aria-label={editando ? 'Editar respuesta' : 'Nueva respuesta'} onClick={(e) => e.stopPropagation()} className="aparecer w-full flex flex-col" style={{ maxWidth: 560, maxHeight: '92dvh', backgroundColor: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 18, boxShadow: 'var(--shadow)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <h2 className="disp font-bold text-[18px] m-0" style={{ color: 'var(--fg)' }}>{editando ? 'Editar respuesta' : 'Nueva respuesta'}</h2>
              <button onClick={cerrarEditor} aria-label="Cerrar"><X size={18} color="var(--fg-2)" /></button>
            </div>

            <div className="overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
                  Título
                  <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Precio Club VIP" className="rounded-lg px-2.5 outline-none text-[13.5px] font-normal" style={{ ...campoStyle, height: 40 }} autoFocus />
                </label>
                <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
                  Atajo
                  <div className="flex items-center rounded-lg px-2.5" style={{ ...campoStyle, height: 40 }}>
                    <span className="font-bold mr-0.5" style={{ color: 'var(--accent)' }}>/</span>
                    <input value={atajo} onChange={(e) => setAtajo(e.target.value)} placeholder="preciovip" className="flex-1 outline-none text-[13.5px] font-normal bg-transparent min-w-0" style={{ color: 'var(--fg)' }} />
                  </div>
                </label>
              </div>

              <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
                Mensaje {(archivo || adjuntoActual) && <span className="font-normal" style={{ color: 'var(--fg-3)' }}>(opcional, queda como texto del adjunto)</span>}
                <textarea value={contenido} onChange={(e) => setContenido(e.target.value)} placeholder="Hola! El Club VIP tiene un costo de…" rows={7} className="rounded-lg px-2.5 py-2.5 outline-none text-[13.5px] font-normal resize-y leading-relaxed" style={campoStyle} />
              </label>
              {contenido.trim() && (
                <div className="rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ backgroundColor: 'var(--bubble-out)', color: 'var(--fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflowY: 'auto' }}>
                  <div className="eyebrow mb-1">Así lo verá el cliente</div>
                  {formatoWhatsApp(contenido)}
                </div>
              )}

              <input ref={inputImagenRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && elegirArchivo(e.target.files[0], 'imagen')} />
              <input ref={inputPdfRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && elegirArchivo(e.target.files[0], 'pdf')} />
              <input ref={inputAudioRef} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && elegirArchivo(e.target.files[0], 'audio')} />

              {archivo || adjuntoActual ? (
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ ...campoStyle }}>
                  <span className="text-[13px] truncate">
                    {archivo ? `${ETIQUETA_TIPO[tipoArchivo!]}: ${archivo.name}` : `Adjunto actual: ${ETIQUETA_TIPO[adjuntoActual!]}`}
                  </span>
                  <button onClick={() => { if (archivo) limpiarArchivo(); else setQuitarExistente(true); }} aria-label="Quitar adjunto" className="shrink-0"><X size={14} color="var(--fg-3)" /></button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
                  Adjuntar (opcional)
                  <div className="flex gap-2 flex-wrap">
                    <BotonAdjunto icono={ImageIcon} etiqueta="Imagen" onClick={() => inputImagenRef.current?.click()} />
                    <BotonAdjunto icono={FileText} etiqueta="Documento" onClick={() => inputPdfRef.current?.click()} />
                    <BotonAdjunto icono={Mic} etiqueta="Audio" onClick={() => inputAudioRef.current?.click()} />
                  </div>
                </div>
              )}
              <PartesRespuesta partes={partes} onCambiar={setPartes} />
              {error && <div className="text-[13px]" style={{ color: 'var(--bad)' }}>{error}</div>}
            </div>

            <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderTop: '1px solid var(--line)' }}>
              {editando && <Boton variante="peligro" icono={Trash2} onClick={() => eliminar(editando)}>Eliminar</Boton>}
              <span className="flex-1" />
              <Boton onClick={cerrarEditor}>Cancelar</Boton>
              <Boton variante="primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Guardar respuesta'}</Boton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
