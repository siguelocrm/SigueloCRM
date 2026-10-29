import { useEffect, useState } from 'react';
import { X, Clock, Check, Plus, ChevronDown, User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { useContacto } from './hooks/useContacto';
import { useEtapasVenta } from './hooks/useEtapasVenta';
import { formatoTelefono, inicialesDe } from './utils';
import { useCambioEtapa } from '../pipeline/useCambioEtapa';
import FichaExtra from './FichaExtra';
import OportunidadesContacto from '../oportunidades/OportunidadesContacto';
import ProgramadosContacto from './ProgramadosContacto';
import { EVENTO_CAMBIO } from './ProgramarMensaje';
import { tinte, TEAL, AMBER, TEMPERATURA_STYLE, BORDE, SOMBRA_CARD, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorEtiquetaWhatsapp } from '../../lib/tema';
import type { Contacto, EtiquetaWhatsapp, Nota, Tarea, Temperatura } from '../../lib/tipos';
import { conSesion } from '../../lib/backend';

function Card({ titulo, accion, children }: { titulo: string; accion?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5 flex flex-col gap-3" style={{ border: `1px solid ${BORDE}`, boxShadow: SOMBRA_CARD }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: TEXTO_TERCIARIO }}>{titulo}</span>
        {accion && <button onClick={accion.onClick} className="text-xs font-semibold" style={{ color: TEAL }}>+ {accion.label}</button>}
      </div>
      {children}
    </div>
  );
}

interface PanelContactoProps {
  telefono: string;
  // Null cuando se abre desde una pantalla que no sabe a qué línea
  // pertenece el contacto (ej. Contactos.tsx sin conversación registrada
  // todavía) — en ese caso no se puede sincronizar la etiqueta con
  // WhatsApp Business, así que el desplegable de asignación queda oculto.
  lineaId: string | null;
  /** Nombre de quien tiene asignado el chat (si hay). */
  asignadoA?: string;
  onClose: () => void;
}

const backendUrl = import.meta.env.VITE_BACKEND_URL;

export default function PanelContacto({ telefono: telefonoCrudo, lineaId, asignadoA, onClose }: PanelContactoProps) {
  // Defensa por si en algún momento llega con el JID completo de WhatsApp
  // (ej. "...@s.whatsapp.net") en vez de solo el número.
  const telefono = telefonoCrudo.split('@')[0];
  const { usuario } = useAuth();
  const { contacto, cargando, setContacto } = useContacto(telefono, usuario?.empresa_id);
  const etapas = useEtapasVenta(usuario?.empresa_id);
  const [pestana, setPestana] = useState<'datos' | 'venta' | 'seguimiento'>('datos');

  const { cambiarEtapa: aplicarEtapa, dialogo: dialogoEtapa } = useCambioEtapa(etapas);
  const cambiarEtapa = (etapaId: string) => {
    if (!contacto) return;
    aplicarEtapa(contacto.id, etapaId, (cambios) => setContacto((prev) => (prev ? { ...prev, ...cambios } : prev)));
  };
  const [notas, setNotas] = useState<Nota[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [etiquetas, setEtiquetas] = useState<EtiquetaWhatsapp[]>([]);
  const [etiquetasDisponibles, setEtiquetasDisponibles] = useState<EtiquetaWhatsapp[]>([]);
  const [errorEtiqueta, setErrorEtiqueta] = useState('');
  const [notaBorrador, setNotaBorrador] = useState('');
  const [tareaTitulo, setTareaTitulo] = useState('');
  const [tareaFecha, setTareaFecha] = useState('');
  // Al agendar con fecha se ofrece avisarle la cita al cliente por WhatsApp.
  const [confirmarCita, setConfirmarCita] = useState(true);
  const [textoCita, setTextoCita] = useState('');
  const [avisoCita, setAvisoCita] = useState('');

  useEffect(() => {
    if (!tareaFecha) return setTextoCita('');
    const cuando = new Date(tareaFecha);
    const dia = cuando.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' });
    const hora = cuando.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
    const nombre = contacto?.nombre?.trim();
    setTextoCita(`Hola${nombre ? ` ${nombre}` : ''}, te confirmamos tu cita para el ${dia} a las ${hora}. ¡Te esperamos! Si necesitas cambiarla, respóndenos por aquí.`);
  }, [tareaFecha, contacto?.nombre]);
  const [nombreBorrador, setNombreBorrador] = useState('');
  const [nombreGuardado, setNombreGuardado] = useState(false);
  const [errorNombre, setErrorNombre] = useState('');

  useEffect(() => {
    setNombreBorrador(contacto?.nombre || '');
  }, [contacto?.id]);

  const cargarNotas = async (contactoId: string) => {
    const { data } = await supabase
      .from('notas')
      .select('*, usuarios(nombre)')
      .eq('contacto_id', contactoId)
      .order('creado_en', { ascending: false })
      .returns<Nota[]>();
    setNotas(data || []);
  };
  const cargarTareas = async (contactoId: string) => {
    const { data } = await supabase
      .from('tareas')
      .select('*')
      .eq('contacto_id', contactoId)
      .order('fecha', { ascending: true })
      .returns<Tarea[]>();
    setTareas(data || []);
  };

  const cargarEtiquetas = async (contactoId: string) => {
    const { data } = await supabase
      .from('contacto_etiquetas')
      .select('etiquetas_whatsapp(id, nombre, color, eliminada)')
      .eq('contacto_id', contactoId)
      .returns<{ etiquetas_whatsapp: EtiquetaWhatsapp & { eliminada: boolean } }[]>();
    setEtiquetas((data || []).map((fila) => fila.etiquetas_whatsapp).filter((e) => e && !e.eliminada));
  };

  const cargarEtiquetasDisponibles = async () => {
    if (!lineaId) return setEtiquetasDisponibles([]);
    const { data } = await supabase
      .from('etiquetas_whatsapp')
      .select('id, nombre, color')
      .eq('linea_id', lineaId)
      .eq('eliminada', false)
      .order('nombre')
      .returns<EtiquetaWhatsapp[]>();
    setEtiquetasDisponibles(data || []);
  };

  useEffect(() => {
    if (!contacto?.id) return;
    cargarNotas(contacto.id);
    cargarTareas(contacto.id);
    cargarEtiquetas(contacto.id);
    cargarEtiquetasDisponibles();
    // Las etiquetas las mueve el cliente desde su propio WhatsApp Business,
    // así que pueden cambiar mientras el panel está abierto sin que nadie
    // toque nada acá — por eso sí vale la pena escuchar en tiempo real.
    const canal = supabase
      .channel(`etiquetas-contacto-${contacto.id}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacto_etiquetas', filter: `contacto_id=eq.${contacto.id}` }, () => cargarEtiquetas(contacto.id))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [contacto?.id]);

  // Pega la asignación/quite al WhatsApp Business real de la línea (ver
  // server/src/routes/etiquetas.ts, que además actualiza `contacto_etiquetas`
  // — por eso acá solo hace falta recargar, no escribir directo a Supabase).
  const sincronizarEtiqueta = async (accion: 'asignar' | 'quitar', etiquetaId: string) => {
    if (!contacto) return;
    if (!lineaId) return setErrorEtiqueta('No se sabe a qué línea pertenece este contacto todavía.');
    setErrorEtiqueta('');
    try {
      const resp = await fetch(`${backendUrl}/etiquetas/${accion}`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ linea_id: lineaId, contacto_id: contacto.id, etiqueta_id: etiquetaId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'No se pudo sincronizar con WhatsApp');
      cargarEtiquetas(contacto.id);
    } catch (err) {
      setErrorEtiqueta((err as Error).message);
    }
  };
  const asignarEtiqueta = (etiquetaId: string) => sincronizarEtiqueta('asignar', etiquetaId);
  const quitarEtiqueta = (etiquetaId: string) => sincronizarEtiqueta('quitar', etiquetaId);

  // Devuelve si el update realmente tocó una fila. Un vendedor solo puede
  // editar contactos de su propia línea (ver database/017_contactos_scope_
  // vendedor.sql) — si RLS lo bloquea, Supabase no tira error, simplemente
  // no actualiza nada, así que hay que pedir `.select()` y mirar si volvió
  // vacío para no mostrar "guardado" cuando en realidad no se guardó nada.
  const actualizarCampo = async (campo: keyof Contacto, valor: string | null): Promise<boolean> => {
    const { data, error } = await supabase
      .from('contactos')
      .update({ [campo]: valor, actualizado_en: new Date().toISOString() })
      .eq('id', contacto!.id)
      .select('id');
    if (error || !data || data.length === 0) return false;
    setContacto((prev) => (prev ? { ...prev, [campo]: valor } : prev));
    // El nombre en el header del chat y en la lista de conversaciones sale
    // de conversaciones.contacto_nombre (lo trae WhatsApp al crear la
    // conversación) — sin este update, corregir el nombre acá no se veía
    // reflejado ahí.
    if (campo === 'nombre') {
      await supabase.from('conversaciones').update({ contacto_nombre: valor || null }).eq('contacto_telefono', telefono);
    }
    return true;
  };

  const guardarNombre = async () => {
    setErrorNombre('');
    const ok = await actualizarCampo('nombre', nombreBorrador);
    if (!ok) {
      setErrorNombre('No se pudo guardar — no tenés permiso para editar este contacto.');
      return;
    }
    setNombreGuardado(true);
    setTimeout(() => setNombreGuardado(false), 1800);
  };

  const agregarNota = async () => {
    if (!notaBorrador.trim() || !contacto) return;
    await supabase.from('notas').insert({ contacto_id: contacto.id, autor_id: usuario!.id, texto: notaBorrador });
    setNotaBorrador('');
    cargarNotas(contacto.id);
  };

  const agregarTarea = async () => {
    if (!tareaTitulo.trim() || !contacto) return;
    setAvisoCita('');
    await supabase.from('tareas').insert({
      empresa_id: usuario!.empresa_id,
      contacto_id: contacto.id,
      titulo: tareaTitulo,
      fecha: tareaFecha || null,
      asignado_a: usuario!.id,
    });
    if (tareaFecha && confirmarCita && textoCita.trim()) {
      // El mensaje sale por el programador (sale en menos de un minuto y queda
      // visible en las cajitas de Mensajes programados).
      const { data: conv } = lineaId
        ? await supabase
            .from('conversaciones')
            .select('id, contacto_telefono')
            .eq('linea_id', lineaId)
            .like('contacto_telefono', `${telefono}%`)
            .order('ultima_actividad', { ascending: false })
            .limit(1)
            .maybeSingle<{ id: string; contacto_telefono: string }>()
        : { data: null };
      if (conv) {
        const { error: errorCita } = await supabase.from('mensajes_programados').insert({
          conversacion_id: conv.id,
          linea_id: lineaId,
          telefono: conv.contacto_telefono,
          tipo: 'texto',
          contenido: textoCita.trim(),
          enviar_en: new Date(Date.now() + 15000).toISOString(),
          cancelar_si_responde: false,
          creado_por: usuario!.id,
        });
        setAvisoCita(errorCita ? 'La tarea se guardó, pero no se pudo programar la confirmación.' : 'Tarea guardada. La confirmación de cita sale en unos segundos.');
        window.dispatchEvent(new Event(EVENTO_CAMBIO));
      } else {
        setAvisoCita('Tarea guardada. No hay un chat con este cliente en esta línea, así que no se envió la confirmación.');
      }
    }
    setTareaTitulo('');
    setTareaFecha('');
    cargarTareas(contacto.id);
  };

  const alternarTarea = async (tarea: Tarea) => {
    await supabase.from('tareas').update({ completada: !tarea.completada }).eq('id', tarea.id);
    if (contacto) cargarTareas(contacto.id);
  };

  return (
    <div className="flex flex-col h-full w-full md:w-[300px] shrink-0 min-[768px]:max-[1279px]:absolute min-[768px]:max-[1279px]:right-0 min-[768px]:max-[1279px]:top-0 min-[768px]:max-[1279px]:bottom-0 min-[768px]:max-[1279px]:z-30" style={{ backgroundColor: 'var(--surface)', borderLeft: `1px solid ${BORDE}`, boxShadow: '-8px 0 24px rgba(7,26,56,.12)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${BORDE}` }}>
        <span className="text-[14.5px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>Datos del cliente</span>
        <button onClick={onClose} aria-label="Cerrar" className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ border: `1px solid ${BORDE}` }}><X size={14} color={TEXTO_SECUNDARIO} /></button>
      </div>

      <div className="flex px-2 shrink-0" style={{ borderBottom: `1px solid ${BORDE}` }} role="tablist">
        {([['datos', 'Datos'], ['venta', 'Venta'], ['seguimiento', 'Seguimiento']] as const).map(([id, etiqueta]) => (
          <button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className="flex-1 py-2.5 text-[12.5px] font-semibold"
            style={{ color: pestana === id ? 'var(--accent)' : TEXTO_SECUNDARIO, borderBottom: `2px solid ${pestana === id ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {cargando || !contacto ? (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando...</div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {pestana === 'datos' && (<>
          <Card titulo="Identidad">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center font-semibold text-sm shrink-0" style={{ backgroundColor: contacto.nombre ? 'var(--accent-soft)' : 'var(--surface-2)', color: contacto.nombre ? 'var(--accent)' : 'var(--fg-3)' }}>
                {contacto.nombre ? inicialesDe(contacto.nombre) : <User size={22} aria-label="Sin nombre" />}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-semibold truncate" style={{ color: TEXTO_PRIMARIO }}>{contacto.nombre || telefono}</span>
                <span className="text-xs truncate" style={{ color: TEXTO_SECUNDARIO }}>{formatoTelefono(telefono)}{contacto.nombre ? '' : ' · sin nombre'}</span>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Nombre
              <div className="flex items-center gap-1.5">
                <input
                  value={nombreBorrador}
                  onChange={(e) => setNombreBorrador(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && guardarNombre()}
                  placeholder="Agregar nombre"
                  className="flex-1 min-w-0 rounded-lg px-2.5 outline-none font-normal text-[13.5px]"
                  style={{ height: 36, border: `1px solid ${nombreBorrador !== (contacto.nombre || '') ? TEAL : BORDE}`, color: TEXTO_PRIMARIO }}
                />
                <button
                  onClick={guardarNombre}
                  disabled={nombreBorrador === (contacto.nombre || '')}
                  aria-label="Guardar nombre"
                  className="shrink-0 rounded-lg flex items-center justify-center"
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: nombreGuardado ? 'var(--ok)' : nombreBorrador !== (contacto.nombre || '') ? TEAL : 'var(--line)',
                    color: nombreBorrador !== (contacto.nombre || '') || nombreGuardado ? 'white' : TEXTO_TERCIARIO,
                  }}
                >
                  <Check size={14} />
                </button>
              </div>
              {errorNombre && <span className="font-normal" style={{ color: 'var(--bad)' }}>{errorNombre}</span>}
            </label>
          </Card>

          <Card titulo="Embudo">
            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Etapa
              <select
                value={contacto.etapa_id || ''}
                onChange={(e) => e.target.value && cambiarEtapa(e.target.value)}
                disabled={etapas.length === 0}
                className="rounded-lg px-2.5 outline-none font-normal text-[13.5px]"
                style={{ height: 36, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, backgroundColor: 'var(--surface-2)' }}
              >
                {!contacto.etapa_id && <option value="">Sin etapa</option>}
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
            <div className="flex items-center justify-between text-[13px]" style={{ color: 'var(--fg-2)' }}>
              <span>Asignado a</span>
              <b style={{ color: 'var(--fg)' }}>{asignadoA || 'Sin asignar'}</b>
            </div>
          </Card>

          <Card titulo="Etiquetas de WhatsApp">
            {etiquetas.length === 0 ? (
              <span className="text-[11px]" style={{ color: TEXTO_TERCIARIO }}>Sin etiquetas todavía.</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {etiquetas.map((e) => (
                  <span key={e.id} className="flex items-center gap-1 text-[11.5px] font-semibold rounded-full pl-2.5 pr-1.5 py-1" style={{ backgroundColor: tinte(colorEtiquetaWhatsapp(e.color)), color: colorEtiquetaWhatsapp(e.color) }}>
                    {e.nombre}
                    <button onClick={() => quitarEtiqueta(e.id)} aria-label={`Quitar etiqueta ${e.nombre}`} className="rounded-full flex items-center justify-center" style={{ width: 13, height: 13 }}>
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {etiquetasDisponibles.filter((d) => !etiquetas.some((e) => e.id === d.id)).length > 0 && (
              <div className="relative">
                <select
                  value=""
                  onChange={(e) => e.target.value && asignarEtiqueta(e.target.value)}
                  className="w-full rounded-lg pl-2.5 pr-6 outline-none appearance-none font-normal text-[13px]"
                  style={{ height: 34, border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}
                >
                  <option value="">+ Agregar etiqueta</option>
                  {etiquetasDisponibles
                    .filter((d) => !etiquetas.some((e) => e.id === d.id))
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d.nombre}</option>
                    ))}
                </select>
                <ChevronDown size={11} color={TEXTO_SECUNDARIO} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            )}
            {etiquetasDisponibles.length === 0 && etiquetas.length === 0 && (
              <span className="text-[10.5px]" style={{ color: TEXTO_TERCIARIO }}>Se sincronizan desde el WhatsApp Business de la línea.</span>
            )}
            {errorEtiqueta && <span className="text-[10.5px]" style={{ color: 'var(--bad)' }}>{errorEtiqueta}</span>}
          </Card>

          <Card titulo="Calificación">
            <label className="flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
              Origen del prospecto
              <input
                defaultValue={contacto.origen || ''}
                onBlur={(e) => actualizarCampo('origen', e.target.value)}
                placeholder="Ej: Facebook Ads, referido..."
                className="rounded-lg px-2.5 outline-none font-normal text-[13.5px]"
                style={{ height: 36, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>Estado del lead</span>
              <div className="flex gap-1.5">
                {(Object.entries(TEMPERATURA_STYLE) as [Temperatura, { label: string; color: string; bg: string; border: string }][]).map(([valor, cfg]) => {
                  const activo = contacto.temperatura === valor;
                  return (
                    <button
                      key={valor}
                      onClick={() => actualizarCampo('temperatura', valor)}
                      className="flex-1 text-[12.5px] font-bold rounded-lg py-1.5"
                      style={activo ? { backgroundColor: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.border}` } : { backgroundColor: 'var(--surface)', color: TEXTO_SECUNDARIO, border: '1.5px solid var(--line)' }}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
          <FichaExtra contacto={contacto} onFolio={(folio) => setContacto((prev) => (prev ? { ...prev, folio: folio || null } : prev))} />
          </>)}

          {pestana === 'venta' && (<>
          <Card titulo="Oportunidades">
            {usuario && <OportunidadesContacto contactoId={contacto.id} empresaId={usuario.empresa_id} usuarioId={usuario.id} />}
          </Card>
          </>)}

          {pestana === 'seguimiento' && (<>
          <Card titulo="Mensajes programados">
            {usuario && <ProgramadosContacto telefono={telefono} lineaId={lineaId} usuario={usuario} />}
          </Card>

          <Card titulo="Seguimiento · Tareas">
            <div className="flex flex-col gap-1.5">
              {tareas.length === 0 && <div className="text-[11px]" style={{ color: TEXTO_TERCIARIO }}>Sin tareas todavía</div>}
              {tareas.map((t) => (
                <div key={t.id} className="flex items-start gap-2 rounded-lg p-2" style={{ backgroundColor: 'var(--surface-2)' }}>
                  <button onClick={() => alternarTarea(t)} className="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: t.completada ? TEAL : 'var(--surface)', border: t.completada ? 'none' : '1.5px solid var(--line-2)' }}>
                    {t.completada && <Check size={10} color="white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium" style={{ color: TEXTO_PRIMARIO, textDecoration: t.completada ? 'line-through' : 'none' }}>{t.titulo}</div>
                    {t.fecha && <div className="text-[11px]" style={{ color: TEXTO_TERCIARIO }}>{new Date(t.fecha).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                  </div>
                </div>
              ))}
            </div>
            <input
              value={tareaTitulo}
              onChange={(e) => setTareaTitulo(e.target.value)}
              placeholder="Nueva tarea..."
              className="rounded-lg px-2.5 outline-none text-[13px]"
              style={{ height: 34, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}
            />
            <div className="flex gap-1.5">
              <input
                type="datetime-local"
                value={tareaFecha}
                onChange={(e) => setTareaFecha(e.target.value)}
                className="flex-1 rounded-lg px-2 text-[11px] outline-none"
                style={{ height: 30, border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}
              />
              <button onClick={agregarTarea} className="rounded-lg px-2.5 flex items-center justify-center shrink-0" style={{ backgroundColor: TEAL }}>
                <Plus size={13} color="white" />
              </button>
            </div>
            {tareaFecha && lineaId && (
              <div className="flex flex-col gap-1.5 rounded-lg p-2" style={{ backgroundColor: 'var(--surface-2)', border: `1px solid ${BORDE}` }}>
                <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer" style={{ color: TEXTO_PRIMARIO }}>
                  <input type="checkbox" checked={confirmarCita} onChange={(e) => setConfirmarCita(e.target.checked)} />
                  Enviar confirmación de cita al cliente
                </label>
                {confirmarCita && (
                  <textarea value={textoCita} onChange={(e) => setTextoCita(e.target.value)} rows={3} className="rounded-lg px-2 py-1.5 outline-none text-[12px] resize-none" style={{ border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, backgroundColor: 'var(--surface)' }} />
                )}
              </div>
            )}
            {avisoCita && <span className="text-[11px]" style={{ color: TEXTO_SECUNDARIO }}>{avisoCita}</span>}
          </Card>

          <Card titulo="Notas internas">
            <div className="flex flex-col gap-1.5">
              {notas.length === 0 && <div className="text-[11px]" style={{ color: TEXTO_TERCIARIO }}>Sin notas todavía</div>}
              {notas.map((n) => (
                <div key={n.id} className="flex flex-col gap-1 rounded-lg py-2 px-2.5" style={{ backgroundColor: 'var(--surface-2)', borderLeft: '3px solid #E0D6BE' }}>
                  <span className="text-[12.5px] leading-snug" style={{ color: 'var(--fg)' }}>{n.texto}</span>
                  <span className="text-[10.5px] flex items-center gap-1" style={{ color: TEXTO_TERCIARIO }}>
                    <Clock size={8} />
                    {n.usuarios?.nombre || 'Agente'} · {new Date(n.creado_en).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={notaBorrador}
                onChange={(e) => setNotaBorrador(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && agregarNota()}
                placeholder="Agregar nota..."
                className="flex-1 rounded-lg px-2.5 outline-none text-[13px]"
                style={{ height: 34, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}
              />
              <button onClick={agregarNota} className="rounded-lg px-2.5 flex items-center justify-center shrink-0" style={{ backgroundColor: AMBER }}>
                <Plus size={13} color="white" />
              </button>
            </div>
          </Card>
          </>)}
        </div>
      )}
      {dialogoEtapa}
    </div>
  );
}
