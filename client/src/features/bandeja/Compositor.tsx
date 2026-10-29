import { useEffect, useRef, useState } from 'react';
import { Bot, CalendarClock, Plus, Image as ImageIcon, FileText, File, Mic, Send, Smile, StickyNote, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BLUE, BORDE, TEAL, TEXTO_SECUNDARIO } from '../../lib/tema';
import ProgramarMensaje from './ProgramarMensaje';
import { useContacto } from './hooks/useContacto';
import { useToast } from '../../components/ui';
import type { Conversacion, Mensaje, RespuestaAutomatica, RespuestaRapida, TipoMensaje, Usuario } from '../../lib/tipos';
import { conSesion } from '../../lib/backend';

// El navegador graba en el formato que soporte su implementación de
// MediaRecorder — se prueban en orden de preferencia (ogg/opus es lo más
// cercano a lo que espera WhatsApp, pero casi ningún navegador de escritorio
// lo soporta para grabar; webm/opus es lo normal en Chrome/Edge). El backend
// se encarga de convertir a ogg/opus antes de mandarlo (ver
// server/src/whatsapp/audio.ts) — acá solo importa quedarnos con *algo*
// que el navegador sepa grabar.
const TIPOS_AUDIO_PREFERIDOS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatoTiempoGrabacion(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const EMOJIS = ['😀', '😁', '😂', '🙂', '😉', '😊', '😍', '🤗', '🤔', '😅', '🙏', '👍', '👏', '🙌', '💪', '🔥', '✅', '⭐', '🎉', '📌', '📞', '💬', '📎', '📅', '⏰', '💰', '🎓', '🚀', '❤️', '👋'];

// Ventana de 24 h de WhatsApp: 24 h menos lo que pasó desde el último mensaje
// del cliente. Verde sobre 6 h, ámbar entre 1 y 6 h, rojo bajo 1 h.
function estadoVentana(mensajes: Mensaje[], ahora: number): { restanteMs: number; color: string } | null {
  let ultimo = 0;
  for (const m of mensajes) if (m.remitente === 'cliente') ultimo = Math.max(ultimo, new Date(m.creado_en).getTime());
  if (!ultimo) return null;
  const restanteMs = 24 * 3600000 - (ahora - ultimo);
  const horas = restanteMs / 3600000;
  return { restanteMs, color: horas > 6 ? 'var(--ok)' : horas > 1 ? 'var(--warn)' : 'var(--bad)' };
}

function textoRestante(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min >= 120) return `quedan ${Math.floor(min / 60)} h`;
  if (min >= 60) return `queda 1 h ${min % 60} min`;
  return `quedan ${min} min`;
}

interface CompositorProps {
  mensajes: Mensaje[];
  seleccionada: Conversacion;
  usuario: Usuario;
  respuestasRapidas: RespuestaRapida[];
  respuestasAutomaticas: RespuestaAutomatica[];
}

const backendUrl = import.meta.env.VITE_BACKEND_URL;

// El backend manda un motivo puntual en el body (ej. "Esa línea de WhatsApp
// no está conectada", ver server/src/routes/enviar.ts) — lo mostramos tal
// cual en vez del genérico "revisá que el backend esté corriendo", que es
// engañoso cuando el backend sí está corriendo y el problema es la sesión
// de WhatsApp de esa línea puntual.
async function mensajeErrorEnvio(resp: Response, fallback: string): Promise<string> {
  try {
    const data = await resp.json();
    if (typeof data?.error === 'string' && data.error) return data.error;
  } catch {
    // el body no era JSON (ej. nginx devolviendo su propia página de error)
  }
  return fallback;
}

export default function Compositor({ mensajes, seleccionada, usuario, respuestasRapidas, respuestasAutomaticas }: CompositorProps) {
  const toast = useToast();
  const { contacto } = useContacto(seleccionada.contacto_telefono.split('@')[0], usuario.empresa_id);
  const [modo, setModo] = useState<'responder' | 'nota'>('responder');
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const ventana = estadoVentana(mensajes, ahora);
  const esNota = modo === 'nota';
  const [borrador, setBorrador] = useState('');
  const [mostrarMenu, setMostrarMenu] = useState(false);
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  // Archivo elegido desde el clip que espera en la caja hasta que el agente
  // confirme con Enter o el botón de enviar — no se manda al elegirlo.
  const [adjunto, setAdjunto] = useState<{ file: File; tipo: TipoMensaje; vistaPrevia: string | null } | null>(null);
  const [errorEnvio, setErrorEnvio] = useState('');
  const [mostrarRespuestas, setMostrarRespuestas] = useState(false);
  const [mostrarBots, setMostrarBots] = useState(false);
  const [mostrarProgramar, setMostrarProgramar] = useState(false);
  const [disparandoBotId, setDisparandoBotId] = useState<string | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [segundosGrabando, setSegundosGrabando] = useState(0);

  const inputImagenRef = useRef<HTMLInputElement>(null);
  const inputPdfRef = useRef<HTMLInputElement>(null);
  const inputDocumentoRef = useRef<HTMLInputElement>(null);
  const inputAudioRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const grabadorRef = useRef<MediaRecorder | null>(null);
  const fragmentosRef = useRef<Blob[]>([]);
  const canceladaRef = useRef(false);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guarda síncrona (no de estado) contra doble envío: si se apoya Enter y
  // queda repitiendo, o se clickea "Enviar" dos veces rápido, el segundo
  // disparo puede llegar antes de que `setBorrador('')` se refleje en el
  // render — un estado de React no lo evita a tiempo, pero un ref sí.
  const enviandoRef = useRef(false);

  useEffect(() => {
    setMostrarRespuestas(false);
    setMostrarBots(false);
    setAdjunto(null);
  }, [seleccionada.id]);

  // Libera la URL de la miniatura cuando se cambia o se quita el adjunto.
  useEffect(() => {
    return () => {
      if (adjunto?.vistaPrevia) URL.revokeObjectURL(adjunto.vistaPrevia);
    };
  }, [adjunto]);

  const elegirArchivo = (input: HTMLInputElement, tipo: TipoMensaje) => {
    const file = input.files?.[0];
    // Se limpia para que elegir el mismo archivo otra vez vuelva a disparar onChange.
    input.value = '';
    if (!file) return;
    setErrorEnvio('');
    setAdjunto({ file, tipo, vistaPrevia: tipo === 'imagen' ? URL.createObjectURL(file) : null });
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const dispararBot = async (bot: RespuestaAutomatica) => {
    setDisparandoBotId(bot.id);
    setErrorEnvio('');
    setMostrarBots(false);
    try {
      const resp = await fetch(`${backendUrl}/respuestas-automaticas/${bot.id}/disparar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ telefono: seleccionada.contacto_telefono, linea_id: seleccionada.linea_id }),
      });
      if (!resp.ok) throw new Error(await mensajeErrorEnvio(resp, 'No se pudo mandar ese bot.'));
      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('id', seleccionada.id);
    } catch (err) {
      console.error(err);
      setErrorEnvio(err instanceof Error ? err.message : 'No se pudo mandar ese bot.');
    } finally {
      setDisparandoBotId(null);
    }
  };

  // Nota interna: se guarda en la ficha del contacto (tabla notas) y NO se manda a WhatsApp.
  const guardarNota = async () => {
    if (enviandoRef.current || !borrador.trim()) return;
    if (!contacto) return setErrorEnvio('Todavía se está cargando la ficha del contacto. Inténtalo de nuevo.');
    enviandoRef.current = true;
    const texto = borrador.trim();
    setErrorEnvio('');
    const { error } = await supabase.from('notas').insert({ contacto_id: contacto.id, autor_id: usuario.id, texto });
    enviandoRef.current = false;
    if (error) return setErrorEnvio('No se pudo guardar la nota.');
    setBorrador('');
    toast('Nota guardada. Solo la ve tu equipo.', 'ok');
  };

  const enviarMensaje = () => {
    if (esNota) return guardarNota();
    if (adjunto) return enviarAdjunto();
    return enviarTexto();
  };

  const enviarTexto = async () => {
    if (enviandoRef.current || !borrador.trim()) return;
    enviandoRef.current = true;
    const texto = borrador;
    setBorrador('');
    setErrorEnvio('');
    try {
      const resp = await fetch(`${backendUrl}/enviar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ telefono: seleccionada.contacto_telefono, tipo: 'texto', texto, agente_id: usuario.id, linea_id: seleccionada.linea_id }),
      });
      if (!resp.ok) throw new Error(await mensajeErrorEnvio(resp, 'No se pudo enviar por WhatsApp. Revisa que el backend esté corriendo.'));
      // El backend ya inserta la fila en `mensajes` (server/src/routes/enviar.ts)
      // después de mandarlo por WhatsApp — insertarla acá también duplicaba
      // cada mensaje enviado. Este insert solo actualiza `ultima_actividad`;
      // la burbuja aparece sola vía la suscripción realtime de Bandeja.tsx.
      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('id', seleccionada.id);
    } catch (err) {
      console.error(err);
      setErrorEnvio(err instanceof Error ? err.message : 'No se pudo enviar por WhatsApp. Revisa que el backend esté corriendo.');
    } finally {
      enviandoRef.current = false;
    }
  };

  // Devuelve si salió bien, para que enviarAdjunto sepa si limpiar la caja.
  const subirYEnviarArchivo = async (file: File, tipo: TipoMensaje, leyenda?: string): Promise<boolean> => {
    setSubiendoArchivo(true);
    setErrorEnvio('');
    try {
      const ext = file.name.split('.').pop();
      const ruta = `${usuario.empresa_id}/${seleccionada.id}/${Date.now()}.${ext}`;
      const { error: errorSubida } = await supabase.storage.from('media').upload(ruta, file);
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(ruta);
      const mediaUrl = urlData.publicUrl;

      const esDocumento = tipo === 'pdf' || tipo === 'documento';
      const resp = await fetch(`${backendUrl}/enviar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        // El nombre del archivo solo viaja como `texto` para documentos,
        // donde el backend lo usa como fileName — en imágenes se mostraría
        // como un caption no deseado debajo de la foto. `mimetype` real del
        // archivo (el navegador lo sabe, WhatsApp lo necesita para mostrar
        // el ícono/preview correcto de zip, Excel, Word, PPT, etc.).
        body: JSON.stringify({
          telefono: seleccionada.contacto_telefono,
          tipo,
          texto: esDocumento ? file.name : leyenda || undefined,
          mimetype: tipo === 'documento' ? file.type : undefined,
          media_url: mediaUrl,
          agente_id: usuario.id,
          linea_id: seleccionada.linea_id,
        }),
      });
      if (!resp.ok) throw new Error(await mensajeErrorEnvio(resp, 'No se pudo enviar el archivo.'));

      // Igual que en enviarMensaje: el backend ya inserta la fila en `mensajes`.
      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('id', seleccionada.id);
      return true;
    } catch (err) {
      console.error(err);
      setErrorEnvio(err instanceof Error ? err.message : 'No se pudo enviar el archivo.');
      return false;
    } finally {
      setSubiendoArchivo(false);
    }
  };

  // En una imagen el texto escrito va como leyenda debajo de la foto; en un
  // PDF u otro archivo WhatsApp no muestra leyenda (el backend usa `texto`
  // como nombre del archivo), así que el texto sale después como mensaje aparte.
  const enviarAdjunto = async () => {
    if (!adjunto || enviandoRef.current) return;
    enviandoRef.current = true;
    const { file, tipo } = adjunto;
    const texto = borrador.trim();
    const ok = await subirYEnviarArchivo(file, tipo, tipo === 'imagen' ? texto : undefined);
    enviandoRef.current = false;
    if (!ok) return;
    setAdjunto(null);
    if (tipo === 'imagen' || !texto) {
      setBorrador('');
      return;
    }
    await enviarTexto();
  };

  const enviarAudio = async (blob: Blob) => {
    setSubiendoArchivo(true);
    setErrorEnvio('');
    try {
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      const ruta = `${usuario.empresa_id}/${seleccionada.id}/${Date.now()}.${ext}`;
      const { error: errorSubida } = await supabase.storage.from('media').upload(ruta, blob, { contentType: blob.type || 'audio/webm' });
      if (errorSubida) throw errorSubida;
      const { data: urlData } = supabase.storage.from('media').getPublicUrl(ruta);
      const mediaUrl = urlData.publicUrl;

      const resp = await fetch(`${backendUrl}/enviar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ telefono: seleccionada.contacto_telefono, tipo: 'audio', media_url: mediaUrl, agente_id: usuario.id, linea_id: seleccionada.linea_id }),
      });
      if (!resp.ok) throw new Error(await mensajeErrorEnvio(resp, 'No se pudo enviar el audio.'));

      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('id', seleccionada.id);
    } catch (err) {
      console.error(err);
      setErrorEnvio(err instanceof Error ? err.message : 'No se pudo enviar el audio.');
    } finally {
      setSubiendoArchivo(false);
    }
  };

  const iniciarGrabacion = async () => {
    setErrorEnvio('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipoSoportado = TIPOS_AUDIO_PREFERIDOS.find((t) => MediaRecorder.isTypeSupported(t));
      const grabador = new MediaRecorder(stream, tipoSoportado ? { mimeType: tipoSoportado } : undefined);
      fragmentosRef.current = [];
      canceladaRef.current = false;
      grabador.ondataavailable = (e) => {
        if (e.data.size > 0) fragmentosRef.current.push(e.data);
      };
      grabador.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!canceladaRef.current && fragmentosRef.current.length > 0) {
          enviarAudio(new Blob(fragmentosRef.current, { type: grabador.mimeType || 'audio/webm' }));
        }
      };
      grabador.start();
      grabadorRef.current = grabador;
      setSegundosGrabando(0);
      intervaloRef.current = setInterval(() => setSegundosGrabando((s) => s + 1), 1000);
      setGrabando(true);
    } catch (err) {
      console.error(err);
      setErrorEnvio('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
    }
  };

  const detenerGrabacion = (cancelar: boolean) => {
    canceladaRef.current = cancelar;
    grabadorRef.current?.stop();
    if (intervaloRef.current) clearInterval(intervaloRef.current);
    setGrabando(false);
  };

  useEffect(() => {
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
      if (grabadorRef.current?.state === 'recording') {
        canceladaRef.current = true;
        grabadorRef.current.stop();
      }
    };
  }, []);

  // Crece con el contenido (como el compositor de WhatsApp), hasta un tope
  // razonable — de ahí para arriba scrollea adentro del propio textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [borrador]);

  const atajoActivo = borrador.startsWith('/') && borrador.length > 1;
  const sugerenciasAtajo = atajoActivo
    ? respuestasRapidas.filter((r) => r.atajo && r.atajo.startsWith(borrador.slice(1).toLowerCase()))
    : [];

  // Una respuesta rápida con adjunto (imagen/pdf/audio) no tiene forma de
  // "insertarse" en el textarea — se manda directo por WhatsApp, igual que
  // un archivo elegido desde el clip. Una de puro texto sigue insertándose
  // para poder editarla antes de enviar.
  const enviarRespuestaConAdjunto = async (r: RespuestaRapida) => {
    setBorrador('');
    setMostrarRespuestas(false);
    setSubiendoArchivo(true);
    setErrorEnvio('');
    try {
      const resp = await fetch(`${backendUrl}/enviar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          telefono: seleccionada.contacto_telefono,
          tipo: r.tipo,
          texto: r.contenido || undefined,
          media_url: r.media_url,
          agente_id: usuario.id,
          linea_id: seleccionada.linea_id,
        }),
      });
      if (!resp.ok) throw new Error(await mensajeErrorEnvio(resp, 'No se pudo enviar el adjunto.'));
      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('id', seleccionada.id);
    } catch (err) {
      console.error(err);
      setErrorEnvio(err instanceof Error ? err.message : 'No se pudo enviar el adjunto.');
    } finally {
      setSubiendoArchivo(false);
    }
  };

  const usarSugerencia = (r: RespuestaRapida) => {
    if (r.tipo !== 'texto') {
      enviarRespuestaConAdjunto(r);
      return;
    }
    setBorrador(r.contenido);
  };
  const insertarRespuesta = (r: RespuestaRapida) => {
    if (r.tipo !== 'texto') {
      enviarRespuestaConAdjunto(r);
      return;
    }
    setBorrador((prev) => (prev ? `${prev} ${r.contenido}` : r.contenido));
    setMostrarRespuestas(false);
  };

  return (
    <div className="px-4 py-3.5 relative" style={{ backgroundColor: 'var(--surface)', borderTop: `1px solid ${BORDE}` }}>
      <input ref={inputImagenRef} type="file" accept="image/*" hidden onChange={(e) => elegirArchivo(e.target, 'imagen')} />
      <input ref={inputPdfRef} type="file" accept="application/pdf" hidden onChange={(e) => elegirArchivo(e.target, 'pdf')} />
      <input ref={inputAudioRef} type="file" accept="audio/*" hidden onChange={(e) => elegirArchivo(e.target, 'audio')} />
      <input
        ref={inputDocumentoRef}
        type="file"
        accept=".zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.pdf,.txt"
        hidden
        onChange={(e) => elegirArchivo(e.target, 'documento')}
      />
      <div className="-mx-4 -mt-3.5 mb-3 empty:hidden">
        <ProgramarMensaje
          seleccionada={seleccionada}
          usuario={usuario}
          borrador={borrador}
          adjunto={adjunto}
          abierto={mostrarProgramar}
          onCerrar={() => setMostrarProgramar(false)}
          onProgramado={() => {
            setBorrador('');
            setAdjunto(null);
            setMostrarProgramar(false);
          }}
        />
      </div>
      {errorEnvio && <div className="text-[10px] mb-1.5" style={{ color: 'var(--bad)' }}>{errorEnvio}</div>}
      {atajoActivo && sugerenciasAtajo.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1.5 rounded-xl p-1.5 flex flex-col gap-1 max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          {sugerenciasAtajo.map((r) => (
            <button key={r.id} onClick={() => usarSugerencia(r)} className="text-left rounded-lg px-2 py-1.5" style={{ backgroundColor: 'var(--surface-2)' }}>
              <div className="text-[11px] font-medium" style={{ color: TEAL }}>/{r.atajo} <span style={{ color: 'var(--fg)' }}>— {r.titulo}</span></div>
              <div className="text-[10px] truncate" style={{ color: 'var(--fg-3)' }}>{r.contenido}</div>
            </button>
          ))}
        </div>
      )}
      {mostrarRespuestas && (
        <div className="absolute bottom-full left-2 mb-1.5 rounded-xl p-1.5 flex flex-col gap-1 max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: '220px' }}>
          {respuestasRapidas.length === 0 && <div className="text-[11px] px-2 py-1" style={{ color: 'var(--fg-3)' }}>Todavía no creaste respuestas rápidas</div>}
          {respuestasRapidas.map((r) => (
            <button key={r.id} onClick={() => insertarRespuesta(r)} className="text-left rounded-lg px-2 py-1.5" style={{ backgroundColor: 'var(--surface-2)' }}>
              <div className="text-[11px] font-medium" style={{ color: 'var(--fg)' }}>
                {r.titulo}
                {r.tipo !== 'texto' && <span className="ml-1" style={{ color: TEAL }}>({r.tipo})</span>}
              </div>
              <div className="text-[10px] truncate" style={{ color: 'var(--fg-3)' }}>{r.contenido || '(sin texto)'}</div>
            </button>
          ))}
        </div>
      )}
      {mostrarMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMostrarMenu(false)} />
          <div className="aparecer absolute bottom-full left-2 mb-1.5 z-20 rounded-xl p-1.5 flex flex-col" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${BORDE}`, boxShadow: '0 8px 24px rgba(16,24,40,.14)', width: 230 }} role="menu">
            {[
              { icono: ImageIcon, etiqueta: 'Imagen', color: BLUE, accion: () => inputImagenRef.current?.click() },
              { icono: FileText, etiqueta: 'PDF', color: BLUE, accion: () => inputPdfRef.current?.click() },
              { icono: Mic, etiqueta: 'Audio', color: BLUE, accion: () => inputAudioRef.current?.click() },
              { icono: File, etiqueta: 'Otro archivo', color: BLUE, accion: () => inputDocumentoRef.current?.click() },
              { icono: Bot, etiqueta: 'Mandar respuesta automática', color: BLUE, accion: () => { setMostrarBots(true); setMostrarRespuestas(false); setMostrarProgramar(false); } },
              { icono: CalendarClock, etiqueta: 'Programar mensaje', color: 'var(--warn)', accion: () => { setMostrarProgramar(true); setMostrarRespuestas(false); setMostrarBots(false); } },
            ].map((it) => (
              <button key={it.etiqueta} role="menuitem" onClick={() => { setMostrarMenu(false); it.accion(); }} className="flex items-center gap-2.5 text-left rounded-lg px-2.5 py-2 hover:bg-[var(--surface-2)]">
                <it.icono size={16} color={it.color} className="shrink-0" />
                <span className="text-[13px] flex-1" style={{ color: 'var(--fg)' }}>{it.etiqueta}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {mostrarEmojis && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMostrarEmojis(false)} />
          <div className="aparecer absolute bottom-full left-12 mb-1.5 z-20 rounded-xl p-2 grid grid-cols-10 gap-0.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(16,24,40,.14)', width: 320 }} role="menu" aria-label="Emojis">
            {EMOJIS.map((em) => (
              <button key={em} role="menuitem" onClick={() => { const el = textareaRef.current; const i = el?.selectionStart ?? borrador.length; setBorrador(borrador.slice(0, i) + em + borrador.slice(i)); setMostrarEmojis(false); setTimeout(() => el?.focus(), 0); }} className="rounded-md text-[18px] leading-none py-1 hover:bg-[var(--accent-soft)]">{em}</button>
            ))}
          </div>
        </>
      )}
      {mostrarBots && (
        <div className="absolute bottom-full left-2 mb-1.5 rounded-xl p-1.5 flex flex-col gap-1 max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: '220px' }}>
          {respuestasAutomaticas.length === 0 && <div className="text-[11px] px-2 py-1" style={{ color: 'var(--fg-3)' }}>Todavía no creaste respuestas automáticas</div>}
          {respuestasAutomaticas.map((bot) => (
            <button
              key={bot.id}
              onClick={() => dispararBot(bot)}
              disabled={disparandoBotId !== null}
              className="text-left rounded-lg px-2 py-1.5"
              style={{ backgroundColor: 'var(--surface-2)' }}
            >
              <div className="text-[11px] font-medium truncate" style={{ color: 'var(--fg)' }}>"{bot.palabra_clave}"</div>
              <div className="text-[10px] truncate" style={{ color: 'var(--fg-3)' }}>
                {disparandoBotId === bot.id ? 'Mandando…' : `${bot.pasos.length} paso${bot.pasos.length === 1 ? '' : 's'}`}
              </div>
            </button>
          ))}
        </div>
      )}
      {ventana && !esNota && (
        <div className="flex items-center gap-2 -mx-4 -mt-3.5 mb-3 px-4 py-1.5 text-[12.5px]" style={{ color: 'var(--fg-2)', borderBottom: '1px solid var(--line)' }}>
          <span>Ventana de WhatsApp</span>
          <span className="rounded-full overflow-hidden" style={{ width: 70, height: 5, backgroundColor: 'var(--line)' }} aria-hidden="true">
            <i className="block h-full" style={{ width: `${Math.max(0, Math.min(100, (ventana.restanteMs / (24 * 3600000)) * 100))}%`, backgroundColor: ventana.color }} />
          </span>
          {ventana.restanteMs > 0 ? (
            <span><b style={{ color: ventana.color }}>{textoRestante(ventana.restanteMs)}</b> para responder libremente</span>
          ) : (
            <span><b style={{ color: 'var(--bad)' }}>Ventana cerrada:</b> pasaron más de 24 h desde el último mensaje del cliente. Usa una respuesta rápida o plantilla para retomar.</span>
          )}
        </div>
      )}
      <div className="inline-flex rounded-[10px] p-0.5 mb-2" role="group" aria-label="Tipo de mensaje" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--line)' }}>
        {([['responder', 'Responder'], ['nota', 'Nota interna']] as const).map(([id, texto]) => (
          <button key={id} onClick={() => setModo(id)} aria-pressed={modo === id} className="rounded-lg px-3 py-[3px] text-[13px] inline-flex items-center gap-1.5" style={{ backgroundColor: modo === id ? 'var(--surface)' : 'transparent', color: modo === id ? 'var(--fg)' : 'var(--fg-2)', fontWeight: modo === id ? 600 : 400 }}>
            {id === 'nota' && <StickyNote size={13} />}{texto}
          </button>
        ))}
      </div>
      {adjunto && !esNota && (
        <div className="flex items-center gap-2.5 rounded-xl p-2 mb-2" style={{ backgroundColor: 'var(--surface-2)', border: `1px solid ${BORDE}` }}>
          {adjunto.vistaPrevia ? (
            <img src={adjunto.vistaPrevia} alt="" className="rounded-lg object-cover shrink-0" style={{ width: 44, height: 44 }} />
          ) : (
            <span className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 44, height: 44, backgroundColor: 'var(--surface)', color: BLUE }}>
              {adjunto.tipo === 'pdf' ? <FileText size={20} /> : <File size={20} />}
            </span>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
            <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--fg)' }}>{adjunto.file.name}</span>
            <span className="text-[11.5px]" style={{ color: 'var(--fg-3)' }}>
              {subiendoArchivo
                ? 'Enviando…'
                : `${formatoTamano(adjunto.file.size)} · Enter para enviar${adjunto.tipo === 'imagen' ? ' · lo que escribas va como leyenda' : ''}`}
            </span>
          </div>
          <button onClick={() => setAdjunto(null)} disabled={subiendoArchivo} aria-label="Quitar archivo adjunto" className="rounded-full flex items-center justify-center shrink-0" style={{ width: 30, height: 30, color: TEXTO_SECUNDARIO }}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-full pl-1.5 pr-1.5 py-1" style={{ border: `1px solid ${esNota ? 'var(--warn)' : 'var(--line)'}`, backgroundColor: esNota ? 'var(--warn-soft)' : 'var(--surface-2)' }}>
        {grabando ? (
          <button onClick={() => detenerGrabacion(true)} aria-label="Cancelar grabación" className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 34, height: 34 }}>
            <X size={16} color={TEXTO_SECUNDARIO} />
          </button>
        ) : esNota ? null : (
          <button
            onClick={() => { setMostrarMenu(!mostrarMenu); setMostrarRespuestas(false); setMostrarBots(false); }}
            aria-label="Más opciones: adjuntar, respuestas rápidas, programar"
            aria-expanded={mostrarMenu}
            disabled={subiendoArchivo}
            className="rounded-full flex items-center justify-center shrink-0"
            style={{ width: 34, height: 34, backgroundColor: mostrarMenu || mostrarProgramar ? BLUE : 'var(--surface-2)', transition: 'background-color 120ms' }}
          >
            <Plus size={18} color={mostrarMenu || mostrarProgramar ? 'white' : BLUE} style={{ transform: mostrarMenu ? 'rotate(45deg)' : 'none', transition: 'transform 120ms' }} />
          </button>
        )}
        {!grabando && (
          <button onClick={() => setMostrarEmojis((v) => !v)} aria-label="Insertar emoji" aria-expanded={mostrarEmojis} className="rounded-full flex items-center justify-center shrink-0" style={{ width: 34, height: 34, color: 'var(--fg-2)' }}>
            <Smile size={18} />
          </button>
        )}
        {grabando ? (
          <div className="flex-1 flex items-center gap-2 px-1 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--bad)' }} />
            <span className="text-[13px] font-medium" style={{ color: 'var(--bad)' }}>Grabando… {formatoTiempoGrabacion(segundosGrabando)}</span>
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={borrador}
              rows={1}
              onChange={(e) => {
                setBorrador(e.target.value);
                if (e.target.value.startsWith('/')) {
                  setMostrarRespuestas(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && adjunto && !subiendoArchivo) {
                  setAdjunto(null);
                  return;
                }
                if (e.key !== 'Enter' || e.shiftKey) return;
                e.preventDefault();
                if (atajoActivo && sugerenciasAtajo.length > 0) {
                  usarSugerencia(sugerenciasAtajo[0]);
                } else {
                  enviarMensaje();
                }
              }}
              placeholder={subiendoArchivo ? 'Subiendo archivo...' : esNota ? 'Nota interna: solo la ve tu equipo' : adjunto ? (adjunto.tipo === 'imagen' ? 'Agrega una leyenda (opcional)' : 'Agrega un mensaje (opcional)') : 'Escribe un mensaje'}
              disabled={subiendoArchivo}
              className="flex-1 outline-none min-w-0 px-1 py-1 text-[13.5px] bg-transparent resize-none leading-relaxed"
              style={{ color: 'var(--fg)', maxHeight: 120 }}
            />
            {!esNota && (
              <button onClick={() => { setMostrarRespuestas((v) => !v); setMostrarMenu(false); setMostrarBots(false); }} aria-label="Respuestas rápidas" aria-expanded={mostrarRespuestas} className="text-[12.5px] rounded-[7px] px-2 py-px shrink-0 whitespace-nowrap" style={{ color: 'var(--fg-3)', border: '1px solid var(--line)', backgroundColor: mostrarRespuestas ? 'var(--accent-soft)' : 'transparent' }}>/ respuestas</button>
            )}
          </>
        )}
        {grabando ? (
          <button onClick={() => detenerGrabacion(false)} aria-label="Detener y enviar audio" className="rounded-full flex items-center justify-center shrink-0 px-4" style={{ height: 34, backgroundColor: BLUE }}>
            <Send size={15} color="white" />
          </button>
        ) : borrador.trim() || esNota || adjunto ? (
          <button onClick={enviarMensaje} disabled={subiendoArchivo} aria-label={esNota ? 'Guardar nota' : adjunto ? 'Enviar archivo' : 'Enviar'} className="rounded-full flex items-center justify-center shrink-0 px-4" style={{ height: 34, backgroundColor: esNota ? 'var(--warn)' : BLUE, opacity: borrador.trim() || (adjunto && !esNota) ? 1 : 0.5 }}>
            <Send size={15} color="white" />
          </button>
        ) : (
          <button onClick={iniciarGrabacion} disabled={subiendoArchivo} aria-label="Grabar audio" className="rounded-full flex items-center justify-center shrink-0" style={{ width: 34, height: 34, backgroundColor: TEAL }}>
            <Mic size={16} color="white" />
          </button>
        )}
      </div>
    </div>
  );
}
