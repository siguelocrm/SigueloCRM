import { useRef, useState, useEffect } from 'react';
import { Bot, Clock, FileText, GitBranch, Image as ImageIcon, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { TEAL, BLUE, BORDE, SOMBRA_CARD, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import type { PasoRespuestaAutomatica, RespuestaAutomatica } from '../../lib/tipos';
import FlujoEditor from './FlujoEditor';
import { Boton, Chip, EncabezadoPagina, EstadoVacio, Interruptor, Tarjeta } from '../../components/ui';

type Disparador = RespuestaAutomatica['disparador'];
type Modo = RespuestaAutomatica['modo_coincidencia'];

const DISPARADORES: { valor: Disparador; etiqueta: string; ayuda: string }[] = [
  { valor: 'palabra_clave', etiqueta: 'Por palabra clave en el mensaje', ayuda: 'Responde cuando el cliente escribe alguna de las palabras o frases que definas.' },
  { valor: 'primer_mensaje', etiqueta: 'Primer mensaje del cliente', ayuda: 'Responde solo la primera vez que ese cliente escribe (ideal para dar la bienvenida).' },
  { valor: 'primer_mensaje_del_dia', etiqueta: 'Primer mensaje del cliente en el día', ayuda: 'Responde al primer mensaje de cada día de ese cliente.' },
  { valor: 'cualquier_mensaje', etiqueta: 'Cualquier mensaje recibido', ayuda: 'Responde a todo lo que no coincida con otra regla de palabra clave.' },
];

const MODOS: { valor: Modo; etiqueta: string }[] = [
  { valor: 'contiene', etiqueta: 'El mensaje contiene la palabra' },
  { valor: 'empieza_con', etiqueta: 'El mensaje empieza con la palabra' },
  { valor: 'exacta', etiqueta: 'El mensaje es exactamente la palabra' },
];

const VARIABLES = ['{nombre}', '{telefono}'];

const inputStyle = { border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO } as const;

const ICONO_PASO = { texto: MessageSquare, imagen: ImageIcon, pdf: FileText, espera: Clock } as const;
const ETIQUETA_PASO = { texto: 'Texto', imagen: 'Imagen', pdf: 'PDF', espera: 'Espera' } as const;

// Cuándo se activa una regla o flujo, para mostrarlo en la lista.
function cuandoSeActiva(r: RespuestaAutomatica) {
  if (r.disparador && r.disparador !== 'palabra_clave') {
    return <span style={{ color: TEAL }}>{DISPARADORES.find((d) => d.valor === r.disparador)?.etiqueta}</span>;
  }
  return (
    <>
      {MODOS.find((m) => m.valor === r.modo_coincidencia)?.etiqueta.replace(' la palabra', '') || 'El mensaje contiene'}:{' '}
      <span style={{ color: TEAL }}>{(r.palabras_clave?.length ? r.palabras_clave : [r.palabra_clave]).map((p) => `"${p}"`).join(', ')}</span>
    </>
  );
}

export default function RespuestasAutomaticas() {
  const { usuario } = useAuth();
  const [reglas, setReglas] = useState<RespuestaAutomatica[]>([]);
  const [nombre, setNombre] = useState('');
  const [disparador, setDisparador] = useState<Disparador>('palabra_clave');
  const [palabrasClave, setPalabrasClave] = useState<string[]>([]);
  const [palabraNueva, setPalabraNueva] = useState('');
  const [modo, setModo] = useState<Modo>('contiene');
  const [toleranciaErrores, setToleranciaErrores] = useState(true);
  const [demoraSegundos, setDemoraSegundos] = useState('0');
  const [pasos, setPasos] = useState<PasoRespuestaAutomatica[]>([]);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [creandoRegla, setCreandoRegla] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  // null = editor cerrado; 'nuevo' = flujo nuevo; una regla = editando ese flujo
  const [editorFlujo, setEditorFlujo] = useState<RespuestaAutomatica | 'nuevo' | null>(null);

  const inputImagenRef = useRef<HTMLInputElement>(null);
  const inputPdfRef = useRef<HTMLInputElement>(null);

  const cargar = async () => {
    const { data } = await supabase
      .from('respuestas_automaticas')
      .select('*, usuarios(nombre)')
      .order('creado_en', { ascending: false })
      .returns<RespuestaAutomatica[]>();
    setReglas(data || []);
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.empresa_id]);

  const agregarPasoTexto = () => setPasos((prev) => [...prev, { tipo: 'texto', contenido: '', media_url: null }]);
  const agregarPasoEspera = () => setPasos((prev) => [...prev, { tipo: 'espera', contenido: null, media_url: null, duracion_segundos: 5 }]);

  const subirArchivo = async (file: File, tipo: 'imagen' | 'pdf') => {
    setSubiendo(true);
    setError('');
    try {
      const ext = file.name.split('.').pop();
      const ruta = `${usuario!.empresa_id}/bot/${Date.now()}.${ext}`;
      const { error: errorSubida } = await supabase.storage.from('media').upload(ruta, file);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(ruta);
      setPasos((prev) => [...prev, { tipo, contenido: tipo === 'pdf' ? file.name : '', media_url: urlData.publicUrl }]);
    } catch (err) {
      console.error(err);
      setError('No se pudo subir el archivo.');
    } finally {
      setSubiendo(false);
    }
  };

  const actualizarPaso = (indice: number, contenido: string) => {
    setPasos((prev) => prev.map((p, i) => (i === indice ? { ...p, contenido } : p)));
  };

  const actualizarDuracionPaso = (indice: number, duracion_segundos: number) => {
    setPasos((prev) => prev.map((p, i) => (i === indice ? { ...p, duracion_segundos } : p)));
  };

  const quitarPaso = (indice: number) => setPasos((prev) => prev.filter((_, i) => i !== indice));

  const agregarPalabra = () => {
    const nuevas = palabraNueva.split(',').map((p) => p.trim()).filter((p) => p && !palabrasClave.some((x) => x.toLowerCase() === p.toLowerCase()));
    if (nuevas.length) setPalabrasClave((prev) => [...prev, ...nuevas]);
    setPalabraNueva('');
  };

  const insertarVariable = (indice: number, variable: string) => {
    setPasos((prev) => prev.map((p, i) => (i === indice ? { ...p, contenido: `${p.contenido || ''}${variable}` } : p)));
  };

  const guardar = async () => {
    if (!nombre.trim()) {
      setError('Ponle un nombre a la regla para reconocerla después.');
      return;
    }
    const pasosValidos = pasos.filter((p) => {
      if (p.tipo === 'texto') return !!p.contenido?.trim();
      if (p.tipo === 'espera') return !!p.duracion_segundos && p.duracion_segundos > 0;
      return !!p.media_url;
    });
    // Lo que quedó escrito en el campo sin confirmar con Enter también cuenta.
    const pendientes = palabraNueva.split(',').map((p) => p.trim()).filter(Boolean);
    const palabras = [...palabrasClave, ...pendientes.filter((p) => !palabrasClave.some((x) => x.toLowerCase() === p.toLowerCase()))];
    if (disparador === 'palabra_clave' && palabras.length === 0) {
      setError('Agregá al menos una palabra o frase clave.');
      return;
    }
    if (pasosValidos.length === 0) return;
    setError('');
    const datosRegla = {
      nombre: nombre.trim(),
      disparador,
      palabras_clave: disparador === 'palabra_clave' ? palabras : [],
      // palabra_clave se mantiene como texto a mostrar (ej. en el chat).
      palabra_clave: disparador === 'palabra_clave' ? palabras.join(', ') : DISPARADORES.find((d) => d.valor === disparador)!.etiqueta,
      modo_coincidencia: modo,
      tolerancia_errores: toleranciaErrores,
    };

    if (editandoId) {
      await supabase
        .from('respuestas_automaticas')
        .update({
          ...datosRegla,
          pasos: pasosValidos,
          demora_segundos: Math.max(0, Number(demoraSegundos) || 0),
        })
        .eq('id', editandoId);
    } else {
      await supabase.from('respuestas_automaticas').insert({
        empresa_id: usuario!.empresa_id,
        ...datosRegla,
        pasos: pasosValidos,
        demora_segundos: Math.max(0, Number(demoraSegundos) || 0),
        creado_por: usuario!.id,
      });
    }
    cancelarEdicion();
    cargar();
  };

  const iniciarEdicion = (regla: RespuestaAutomatica) => {
    if (regla.tipo === 'flujo') {
      setEditorFlujo(regla);
      return;
    }
    setEditandoId(regla.id);
    setNombre(regla.nombre || '');
    setDisparador(regla.disparador || 'palabra_clave');
    setPalabrasClave(regla.palabras_clave?.length ? regla.palabras_clave : regla.palabra_clave ? [regla.palabra_clave] : []);
    setPalabraNueva('');
    setModo(regla.modo_coincidencia || 'contiene');
    setToleranciaErrores(!!regla.tolerancia_errores);
    setDemoraSegundos(String(regla.demora_segundos ?? 0));
    setPasos(regla.pasos || []);
    setError('');
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setCreandoRegla(false);
    setNombre('');
    setDisparador('palabra_clave');
    setPalabrasClave([]);
    setPalabraNueva('');
    setModo('contiene');
    setToleranciaErrores(true);
    setDemoraSegundos('0');
    setPasos([]);
  };

  const alternarActivo = async (regla: RespuestaAutomatica) => {
    await supabase.from('respuestas_automaticas').update({ activo: !regla.activo }).eq('id', regla.id);
    cargar();
  };

  const eliminar = async (id: string) => {
    await supabase.from('respuestas_automaticas').delete().eq('id', id);
    if (editandoId === id) cancelarEdicion();
    cargar();
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col gap-5">
        <EncabezadoPagina
          titulo="Bot y flujos"
          subtitulo="Todas las respuestas automáticas en un solo lugar. Un flujo pregunta y sigue por un camino u otro según lo que responda el cliente; una regla rápida manda una lista de pasos de corrido."
          accion={
            <div className="flex gap-2 flex-wrap">
              <Boton icono={Plus} onClick={() => { cancelarEdicion(); setCreandoRegla(true); }}>Regla rápida</Boton>
              <Boton variante="primario" icono={GitBranch} onClick={() => setEditorFlujo('nuevo')}>Nuevo flujo</Boton>
            </div>
          }
        />

        <div className="flex flex-col gap-5">
          {(creandoRegla || editandoId) && (
          <div className="aparecer rounded-2xl p-5 flex flex-col gap-3.5 max-w-2xl" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${BORDE}`, boxShadow: SOMBRA_CARD }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>{editandoId ? 'Editando regla rápida' : 'Nueva regla rápida'}</span>
              {(editandoId || creandoRegla) && (
                <button onClick={cancelarEdicion} className="text-[11.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Cancelar</button>
              )}
            </div>
            <input ref={inputImagenRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subirArchivo(e.target.files[0], 'imagen')} />
            <input ref={inputPdfRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && subirArchivo(e.target.files[0], 'pdf')} />

            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Nombre de la regla
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Precios del curso"
                className="rounded-lg px-2.5 outline-none text-[13.5px] font-normal"
                style={{ ...inputStyle, height: 40 }}
              />
              <span className="text-[10.5px] font-normal" style={{ color: TEXTO_TERCIARIO }}>Solo lo ves tú: sirve para reconocerla en la lista, en el chat y en Negocios.</span>
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              ¿Cuándo responde el bot?
              <select
                value={disparador}
                onChange={(e) => setDisparador(e.target.value as Disparador)}
                className="rounded-lg px-2.5 outline-none text-[13.5px] font-normal bg-[var(--surface)]"
                style={{ ...inputStyle, height: 40 }}
              >
                {DISPARADORES.map((d) => <option key={d.valor} value={d.valor}>{d.etiqueta}</option>)}
              </select>
              <span className="text-[10.5px] font-normal" style={{ color: TEXTO_TERCIARIO }}>{DISPARADORES.find((d) => d.valor === disparador)?.ayuda}</span>
            </label>

            {disparador === 'palabra_clave' && (
              <div className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
                Palabras o frases clave (basta que coincida una)
                {palabrasClave.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {palabrasClave.map((p) => (
                      <span key={p} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ backgroundColor: 'var(--accent-soft)', color: TEAL }}>
                        {p}
                        <button onClick={() => setPalabrasClave((prev) => prev.filter((x) => x !== p))} aria-label={`Quitar ${p}`}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={palabraNueva}
                    onChange={(e) => setPalabraNueva(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarPalabra(); } }}
                    placeholder="Ej. precio, costo, cuánto cuesta  (Enter para agregar)"
                    className="flex-1 rounded-lg px-2.5 outline-none text-[13.5px] font-normal"
                    style={{ ...inputStyle, height: 40 }}
                  />
                  <button onClick={agregarPalabra} className="rounded-lg px-3 text-[12.5px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>Agregar</button>
                </div>
                <select
                  value={modo}
                  onChange={(e) => setModo(e.target.value as Modo)}
                  className="rounded-lg px-2.5 outline-none text-[13px] font-normal bg-[var(--surface)]"
                  style={{ ...inputStyle, height: 38 }}
                >
                  {MODOS.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
                <label className="flex items-start gap-2 text-[12px] font-normal cursor-pointer" style={{ color: 'var(--fg-2)' }}>
                  <input type="checkbox" checked={toleranciaErrores} onChange={(e) => setToleranciaErrores(e.target.checked)} className="mt-0.5" />
                  <span>Aceptar errores de tipeo (ej. "presio" activa la regla "precio"). Las palabras de menos de 5 letras siempre se comparan exacto.</span>
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Esperar antes de responder (segundos)
              <div className="flex items-center gap-1.5 rounded-lg px-2.5" style={{ ...inputStyle, height: 40, width: 140 }}>
                <Clock size={13} color={TEXTO_TERCIARIO} />
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={demoraSegundos}
                  onChange={(e) => setDemoraSegundos(e.target.value)}
                  className="flex-1 outline-none text-[13.5px] font-normal bg-transparent"
                  style={{ color: TEXTO_PRIMARIO, width: '100%' }}
                />
              </div>
              <span className="text-[10.5px] font-normal" style={{ color: TEXTO_TERCIARIO }}>0 = responde apenas detecta la palabra clave.</span>
            </label>

            <div className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Pasos de la respuesta
              <div className="flex flex-col gap-2">
                {pasos.map((paso, indice) => {
                  const Icono = ICONO_PASO[paso.tipo];
                  return (
                    <div key={indice} className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ border: `1px solid ${BORDE}`, backgroundColor: 'var(--surface-2)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: BLUE }}>
                          <Icono size={13} /> {ETIQUETA_PASO[paso.tipo]} · Paso {indice + 1}
                        </span>
                        <button onClick={() => quitarPaso(indice)} aria-label="Quitar paso"><X size={13} color={TEXTO_TERCIARIO} /></button>
                      </div>
                      {paso.tipo === 'texto' ? (
                        <>
                          <textarea
                            value={paso.contenido || ''}
                            onChange={(e) => actualizarPaso(indice, e.target.value)}
                            placeholder="Escribí el mensaje… Ej. Hola {nombre}, ¿en qué te ayudo?"
                            rows={2}
                            className="rounded-md px-2 py-1.5 outline-none text-[12.5px] font-normal resize-y leading-relaxed"
                            style={inputStyle}
                          />
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10.5px] font-normal" style={{ color: TEXTO_TERCIARIO }}>Insertar:</span>
                            {VARIABLES.map((v) => (
                              <button key={v} onClick={() => insertarVariable(indice, v)} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>{v}</button>
                            ))}
                          </div>
                        </>
                      ) : paso.tipo === 'espera' ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={3600}
                            value={paso.duracion_segundos ?? 5}
                            onChange={(e) => actualizarDuracionPaso(indice, Math.max(1, Number(e.target.value) || 1))}
                            className="rounded-md px-2 outline-none text-[12.5px] font-normal"
                            style={{ ...inputStyle, height: 32, width: 80 }}
                          />
                          <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>segundos antes del próximo paso</span>
                        </div>
                      ) : (
                        <>
                          {paso.tipo === 'imagen' && paso.media_url && (
                            <img src={paso.media_url} alt="Vista previa" className="rounded-md max-h-32 object-cover self-start" />
                          )}
                          <input
                            value={paso.contenido || ''}
                            onChange={(e) => actualizarPaso(indice, e.target.value)}
                            placeholder={paso.tipo === 'imagen' ? 'Descripción (opcional)' : 'Nombre del archivo'}
                            className="rounded-md px-2 outline-none text-[12.5px] font-normal"
                            style={{ ...inputStyle, height: 32 }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1.5 mt-1">
                <button onClick={agregarPasoTexto} className="flex items-center gap-1 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>
                  <Plus size={12} /> Texto
                </button>
                <button onClick={() => inputImagenRef.current?.click()} disabled={subiendo} className="flex items-center gap-1 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>
                  <Plus size={12} /> Imagen
                </button>
                <button onClick={() => inputPdfRef.current?.click()} disabled={subiendo} className="flex items-center gap-1 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>
                  <Plus size={12} /> PDF
                </button>
                <button onClick={agregarPasoEspera} className="flex items-center gap-1 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5" style={{ backgroundColor: 'var(--surface-2)', color: BLUE }}>
                  <Plus size={12} /> Temporizador
                </button>
              </div>
            </div>

            {error && <span className="text-[11.5px]" style={{ color: 'var(--bad)' }}>{error}</span>}
            <button onClick={guardar} disabled={subiendo} className="self-start text-[13.5px] font-semibold rounded-lg px-4" style={{ height: 40, backgroundColor: TEAL, color: 'var(--accent-fg)' }}>
              {subiendo ? 'Subiendo…' : editandoId ? 'Guardar cambios' : 'Guardar regla'}
            </button>
          </div>
          )}

          {reglas.length === 0 ? (
            !creandoRegla && (
              <Tarjeta className="flex">
                <EstadoVacio icono={Bot} titulo="Todavía no creaste ninguna automatización" texto='Empezá con una regla rápida para palabras como "precio", "horario" o "ubicación", o armá un flujo con ramas.' />
              </Tarjeta>
            )
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 content-start">
              {reglas.map((r) => (
                <div key={r.id} className="rounded-xl px-3.5 py-3" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${editandoId === r.id ? TEAL : BORDE}`, boxShadow: SOMBRA_CARD, opacity: r.activo ? 1 : 0.55 }}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>
                      {r.tipo === 'flujo' && <span className="mr-1.5 align-middle"><Chip icono={GitBranch}>Flujo</Chip></span>}
                      {r.nombre || cuandoSeActiva(r)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.demora_segundos > 0 && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: TEXTO_TERCIARIO }}>
                          <Clock size={11} /> {r.demora_segundos}s
                        </span>
                      )}
                      <Interruptor activo={r.activo} onCambiar={() => alternarActivo(r)} etiqueta={r.activo ? 'Pausar automatización' : 'Activar automatización'} />
                      <button onClick={() => iniciarEdicion(r)} aria-label="Editar automatización"><Pencil size={13} color={TEXTO_TERCIARIO} /></button>
                      <button onClick={() => { if (window.confirm('¿Eliminar esta automatización?')) eliminar(r.id); }} aria-label="Eliminar automatización"><Trash2 size={13} color={TEXTO_TERCIARIO} /></button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mt-1.5">
                    {r.nombre && <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>{cuandoSeActiva(r)}</div>}
                    {r.tipo === 'flujo' && (
                      <div className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
                        {(r.flujo?.nodes || []).filter((n) => n.type !== 'inicio').length} bloques · {(r.flujo?.nodes || []).filter((n) => n.type === 'pregunta').length} preguntas con ramas
                      </div>
                    )}
                    {(r.pasos || []).map((paso, i) => {
                      const Icono = ICONO_PASO[paso.tipo];
                      return (
                        <div key={i} className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                          <Icono size={12} color={TEXTO_TERCIARIO} />
                          <span className="truncate">
                            {paso.tipo === 'espera'
                              ? `Espera ${paso.duracion_segundos ?? 0}s`
                              : paso.tipo === 'texto'
                                ? paso.contenido
                                : paso.contenido || ETIQUETA_PASO[paso.tipo]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] mt-1.5" style={{ color: TEXTO_TERCIARIO }}>{r.usuarios?.nombre || 'Agente'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editorFlujo && (
        <FlujoEditor
          regla={editorFlujo === 'nuevo' ? null : editorFlujo}
          onCerrar={() => setEditorFlujo(null)}
          onGuardado={() => {
            setEditorFlujo(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}
