import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, Image as ImageIcon, Plus, Send, ShieldAlert, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';

// Formulario de un envío masivo nuevo: desde qué número, a quiénes, el mensaje
// (con varias versiones), cuándo y a qué ritmo. Lo envía el servidor
// (server/src/siguelo/masivos) con pausas, horario y tope por día.

type Linea = { id: string; nombre: string; numero: string | null; estado: string };
type Etapa = { id: string; nombre: string; tipo: string };
type EtiquetaWa = { id: string; nombre: string };
type Origen = 'chats' | 'todos' | 'lista' | 'grupos';
type GrupoWa = { id: string; nombre: string; personas: number; soloAdmins: boolean };

const VARIABLES = ['{nombre}', '{negocio}', '{sucursal}', '{direccion}', '{horario}'];
const ORIGENES: { valor: Origen; titulo: string; ayuda: string }[] = [
  { valor: 'chats', titulo: 'Los que tienen chat con este número', ayuda: 'Lo más seguro: ya te conocen y tienen tu número.' },
  { valor: 'todos', titulo: 'Todos mis contactos', ayuda: 'Incluye los importados y los de otros números.' },
  { valor: 'lista', titulo: 'Pegar una lista de números', ayuda: 'Uno por línea, con o sin nombre. Esta lista queda fija.' },
  { valor: 'grupos', titulo: 'Solo grupos de WhatsApp', ayuda: 'Se publica en los grupos que elijas, no a cada contacto.' },
];

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
      {etiqueta}
      {children}
      {ayuda && <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>}
    </label>
  );
}

function Seccion({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <Tarjeta className="p-4 flex flex-col gap-3">
      <span className="flex items-center gap-2 text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
        <span className="inline-flex items-center justify-center rounded-full text-[12px]" style={{ width: 22, height: 22, backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>{numero}</span>
        {titulo}
      </span>
      {children}
    </Tarjeta>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{ border: `1px solid ${activa ? 'var(--accent)' : BORDE}`, backgroundColor: activa ? 'var(--accent-soft)' : 'var(--surface)', color: activa ? 'var(--accent)' : TEXTO_SECUNDARIO }}
    >
      {children}
    </button>
  );
}

// "2 h 30 min", "3 días"
function duracion(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}
const minutosDe = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

export default function NuevoMasivo({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const { usuario } = useAuth();
  const toast = useToast();
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [etiquetas, setEtiquetas] = useState<EtiquetaWa[]>([]);

  const [nombre, setNombre] = useState('');
  const [lineaId, setLineaId] = useState('');
  const [origen, setOrigen] = useState<Origen>('chats');
  const [elegidasEtapas, setElegidasEtapas] = useState<string[]>([]);
  const [elegidasEtiquetas, setElegidasEtiquetas] = useState<string[]>([]);
  const [sinPerdidos, setSinPerdidos] = useState(true);
  const [conInteres, setConInteres] = useState(false);
  const [intereses, setIntereses] = useState('');
  const [grupos, setGrupos] = useState<GrupoWa[] | null>(null);
  const [cargandoGrupos, setCargandoGrupos] = useState(false);
  const [elegidosGrupos, setElegidosGrupos] = useState<string[]>([]);
  const [adaptar, setAdaptar] = useState(false);
  const [lista, setLista] = useState('');
  const [textos, setTextos] = useState<string[]>(['']);
  const [media, setMedia] = useState<{ tipo: 'imagen' | 'pdf'; url: string; nombre: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [cuando, setCuando] = useState<'ahora' | 'programar'>('ahora');
  const [fecha, setFecha] = useState('');
  const [desde, setDesde] = useState('08:00');
  const [hasta, setHasta] = useState('20:00');
  const [pausaMin, setPausaMin] = useState(40);
  const [pausaMax, setPausaMax] = useState(120);
  const [maximo, setMaximo] = useState(150);
  const [telPrueba, setTelPrueba] = useState('');
  const [conteo, setConteo] = useState<{ total: number; ejemplos: string[]; maximo: number; intereses?: { texto: string; n: number }[] } | null>(null);
  const [contando, setContando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const inputImagen = useRef<HTMLInputElement>(null);
  const inputPdf = useRef<HTMLInputElement>(null);
  const textoActivo = useRef(0);

  useEffect(() => {
    supabase.from('lineas_whatsapp').select('id, nombre, numero, estado').order('nombre').returns<Linea[]>().then(({ data }) => {
      setLineas(data || []);
      if (data?.length === 1) setLineaId(data[0].id);
    });
    supabase.from('etapas_venta').select('id, nombre, tipo').order('orden').returns<Etapa[]>().then(({ data }) => setEtapas(data || []));
  }, []);

  useEffect(() => {
    setElegidasEtiquetas([]);
    setGrupos(null);
    setElegidosGrupos([]);
    if (!lineaId) return setEtiquetas([]);
    supabase.from('etiquetas_whatsapp').select('id, nombre').eq('linea_id', lineaId).eq('eliminada', false).order('nombre').returns<EtiquetaWa[]>().then(({ data }) => setEtiquetas(data || []));
  }, [lineaId]);

  const filtro = useMemo(
    () => ({
      origen,
      etapas: elegidasEtapas,
      etiquetas: elegidasEtiquetas,
      sin_perdidos: sinPerdidos,
      lista: origen === 'lista' ? lista.split('\n').map((l) => l.trim()).filter(Boolean) : [],
      con_interes: conInteres,
      intereses: conInteres ? intereses.split(',').map((x) => x.trim()).filter(Boolean) : [],
      grupos: (grupos || []).filter((g) => elegidosGrupos.includes(g.id)).map((g) => ({ id: g.id, nombre: g.nombre })),
    }),
    [origen, elegidasEtapas, elegidasEtiquetas, sinPerdidos, lista, conInteres, intereses, grupos, elegidosGrupos],
  );

  const cargarGrupos = async () => {
    setCargandoGrupos(true);
    const r = await llamarBackend('/siguelo/masivos/grupos', { linea_id: lineaId }).catch(() => ({ ok: false, data: null, error: 'No se pudo conectar con el servidor.' }));
    setCargandoGrupos(false);
    if (!r.ok) return toast(r.error || 'No se pudieron leer los grupos.', 'error');
    setGrupos(r.data.grupos);
  };
  // La lista se arma al empezar, salvo una lista pegada (que queda fija).
  const alEmpezar = origen !== 'lista';

  // Cuenta a cuántos les llega (medio segundo después del último cambio).
  useEffect(() => {
    if (!lineaId) return setConteo(null);
    setContando(true);
    const t = setTimeout(async () => {
      const r = await llamarBackend('/siguelo/masivos/contar', { linea_id: lineaId, filtro }).catch(() => ({ ok: false, data: null, error: 'No se pudo conectar con el servidor.' }));
      setContando(false);
      if (r.ok) setConteo(r.data);
      else {
        setConteo(null);
        toast(r.error || 'No se pudo contar.', 'error');
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineaId, filtro]);

  const alternar = (lista: string[], set: (v: string[]) => void, id: string) => set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const insertar = (v: string) => {
    const i = textoActivo.current;
    setTextos((prev) => prev.map((t, k) => (k === i ? `${t}${v}` : t)));
  };

  const subir = async (file: File, tipo: 'imagen' | 'pdf') => {
    if (file.size > 15 * 1024 * 1024) return toast('El archivo pesa más de 15 MB.', 'error');
    setSubiendo(true);
    const ext = file.name.split('.').pop() || (tipo === 'pdf' ? 'pdf' : 'jpg');
    const ruta = `${usuario!.empresa_id}/masivos/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('media').upload(ruta, file);
    setSubiendo(false);
    if (error) return toast(`No se pudo subir: ${error.message}`, 'error');
    setMedia({ tipo, url: supabase.storage.from('media').getPublicUrl(ruta).data.publicUrl, nombre: file.name });
  };

  const textosLimpios = textos.map((t) => t.trim()).filter(Boolean);
  const cuerpo = () => ({
    nombre: nombre.trim(),
    linea_id: lineaId,
    textos: textosLimpios,
    media_tipo: media?.tipo ?? null,
    media_url: media?.url ?? null,
    media_nombre: media?.nombre ?? null,
    filtro,
    inicia_en: cuando === 'programar' && fecha ? new Date(fecha).toISOString() : new Date().toISOString(),
    hora_inicio: desde,
    hora_fin: hasta,
    pausa_min_seg: pausaMin,
    pausa_max_seg: Math.max(pausaMin, pausaMax),
    maximo_diario: maximo,
    adaptar,
  });

  const probar = async () => {
    setProbando(true);
    const r = await llamarBackend('/siguelo/masivos/prueba', { ...cuerpo(), telefono: telPrueba, nombre: usuario?.nombre });
    setProbando(false);
    if (r.ok) toast('Te llegó la prueba: revisa tu WhatsApp.', 'ok');
    else toast(r.error || 'No se pudo enviar la prueba.', 'error');
  };

  const guardar = async () => {
    if (!nombre.trim()) return toast('Ponle un nombre al envío.', 'error');
    if (!lineaId) return toast('Elige desde qué número se envía.', 'error');
    if (!textosLimpios.length && !media) return toast('Escribe el mensaje.', 'error');
    if (cuando === 'programar' && !fecha) return toast('Elige la fecha y hora de inicio.', 'error');
    const programado = cuando === 'programar';
    if (origen === 'grupos' && !elegidosGrupos.length) return toast('Elige al menos un grupo de WhatsApp.', 'error');
    if (!conteo?.total && !(programado && alEmpezar)) return toast('Con esos filtros no le llega a nadie.', 'error');
    const pregunta = programado && alEmpezar
      ? `¿Programar "${nombre.trim()}"? Al empezar se arma la lista con todos los que correspondan en ese momento (hoy serían ${conteo?.total ?? 0}).`
      : `¿Enviar "${nombre.trim()}" a ${conteo!.total} ${conteo!.total === 1 ? 'destinatario' : 'destinatarios'}? Puedes pausarlo o cancelarlo cuando quieras.`;
    if (!window.confirm(pregunta)) return;
    setGuardando(true);
    const r = await llamarBackend('/siguelo/masivos', cuerpo());
    setGuardando(false);
    if (!r.ok) return toast(r.error || 'No se pudo guardar.', 'error');
    toast(r.data.alEmpezar ? 'Listo: la lista se arma al empezar, con todos los que correspondan.' : `Listo: se enviará a ${r.data.total}, de a poco.`, 'ok');
    onCreado();
  };

  // Cuánto tarda, más o menos, con la pausa promedio, el horario y el tope por día.
  const estimado = useMemo(() => {
    const total = conteo?.total ?? 0;
    if (!total) return '';
    const porMensaje = ((pausaMin + Math.max(pausaMin, pausaMax)) / 2) * 1000;
    const minutosDia = Math.max(1, minutosDe(hasta) - minutosDe(desde));
    const porDia = Math.min(maximo, Math.floor((minutosDia * 60_000) / porMensaje));
    if (porDia <= 0) return '';
    const dias = Math.ceil(total / porDia);
    return dias <= 1 ? `Tardará unos ${duracion(total * porMensaje)}.` : `Tardará unos ${dias} días (hasta ${porDia} por día).`;
  }, [conteo, pausaMin, pausaMax, desde, hasta, maximo]);

  const lineaElegida = lineas.find((l) => l.id === lineaId);

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Nuevo envío masivo</span>
        <Boton variante="fantasma" icono={X} onClick={onCerrar}>Cancelar</Boton>
      </div>

      <Tarjeta className="p-3.5 flex gap-2.5 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        <ShieldAlert size={18} className="shrink-0 mt-0.5" color="var(--warn)" />
        <span>
          WhatsApp puede bloquear un número que manda muchos mensajes iguales a gente que no lo tiene guardado. Para cuidarlo: envía a quienes
          ya te escribieron, escribe <b>2 o 3 versiones</b> del mensaje, deja pausas largas y empieza con pocos por día (por ejemplo 50) en un número nuevo.
        </span>
      </Tarjeta>

      <Seccion numero={1} titulo="Nombre y número">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del envío" ayuda="Solo lo ves tú.">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Vacaciones útiles enero" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Desde qué número" ayuda={lineaElegida && lineaElegida.estado !== 'activo' ? 'Ese número está desconectado: se enviará cuando lo conectes.' : undefined}>
            <select value={lineaId} onChange={(e) => setLineaId(e.target.value)} className={`${claseCampo} font-normal`} style={estiloCampo}>
              <option value="">Elige un número…</option>
              {lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.numero ? ` (+${l.numero})` : ''}{l.estado !== 'activo' ? ' · desconectado' : ''}</option>)}
            </select>
          </Campo>
        </div>
      </Seccion>

      <Seccion numero={2} titulo="A quiénes">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ORIGENES.map((o) => (
            <button
              key={o.valor}
              type="button"
              onClick={() => setOrigen(o.valor)}
              aria-pressed={origen === o.valor}
              className="text-left rounded-xl p-3 flex flex-col gap-0.5"
              style={{ border: `1.5px solid ${origen === o.valor ? 'var(--accent)' : BORDE}`, backgroundColor: origen === o.valor ? 'var(--accent-soft)' : 'var(--surface)' }}
            >
              <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{o.titulo}</span>
              <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{o.ayuda}</span>
            </button>
          ))}
        </div>
        {origen === 'lista' && (
          <Campo etiqueta="Números" ayuda="Uno por línea: 70000000 o 59170000000, y si quieres el nombre después de una coma (70000000, Ana). Con 8 dígitos se agrega 591.">
            <textarea value={lista} onChange={(e) => setLista(e.target.value)} rows={6} placeholder={'70000001, Ana Pérez\n70000002, Beto\n59170000003'} className={`${claseCampo} font-normal resize-y`} style={estiloArea} />
          </Campo>
        )}
        {origen !== 'grupos' && (
          <div className="flex flex-col gap-1.5 rounded-lg p-2.5" style={{ border: `1px solid ${BORDE}` }}>
            <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: TEXTO_SECUNDARIO }}>
              <input type="checkbox" className="mt-0.5" checked={conInteres} onChange={(e) => setConInteres(e.target.checked)} />
              <span><b style={{ color: TEXTO_PRIMARIO }}>Solo los que mostraron interés</b> (lo que la IA anotó al leer su chat).</span>
            </label>
            {conInteres && (
              <>
                <input value={intereses} onChange={(e) => setIntereses(e.target.value)} placeholder="Palabras, separadas por coma (ej. ajedrez, dibujo). Vacío = cualquier interés." className={`${claseCampo} font-normal`} style={estiloCampo} />
                {!!conteo?.intereses?.length && (
                  <div className="flex flex-wrap gap-1.5">
                    {conteo.intereses.map((x) => {
                      const elegidas = intereses.split(',').map((y) => y.trim().toLowerCase()).filter(Boolean);
                      const activa = elegidas.includes(x.texto.toLowerCase());
                      return (
                        <Opcion
                          key={x.texto}
                          activa={activa}
                          onClick={() => setIntereses((activa ? elegidas.filter((y) => y !== x.texto.toLowerCase()) : [...elegidas, x.texto.toLowerCase()]).join(', '))}
                        >
                          {x.texto} ({x.n})
                        </Opcion>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {etapas.length > 0 && origen !== 'grupos' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Solo estas etapas <span className="font-normal" style={{ color: TEXTO_TERCIARIO }}>(ninguna marcada = todas)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {etapas.map((e) => <Opcion key={e.id} activa={elegidasEtapas.includes(e.id)} onClick={() => alternar(elegidasEtapas, setElegidasEtapas, e.id)}>{e.nombre}</Opcion>)}
            </div>
          </div>
        )}
        {etiquetas.length > 0 && origen !== 'grupos' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Solo con estas etiquetas de WhatsApp <span className="font-normal" style={{ color: TEXTO_TERCIARIO }}>(ninguna = sin filtrar)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {etiquetas.map((e) => <Opcion key={e.id} activa={elegidasEtiquetas.includes(e.id)} onClick={() => alternar(elegidasEtiquetas, setElegidasEtiquetas, e.id)}>{e.nombre}</Opcion>)}
            </div>
          </div>
        )}
        <label className="flex items-start gap-2 text-[12.5px] cursor-pointer" style={{ color: TEXTO_SECUNDARIO }}>
          <input type="checkbox" className="mt-0.5" checked={sinPerdidos} onChange={(e) => setSinPerdidos(e.target.checked)} />
          <span>No enviar a los que están en <b>Venta perdida</b> (ahí quedan los que pidieron no recibir más mensajes).</span>
        </label>
        {lineaId && (
          <div className="flex flex-col gap-1.5 rounded-lg p-2.5" style={{ border: `1px solid ${BORDE}` }}>
            <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              {origen === 'grupos' ? 'Grupos de WhatsApp donde se publica' : 'Publicarlo también en grupos de WhatsApp'} <span className="font-normal" style={{ color: TEXTO_TERCIARIO }}>(los de este número)</span>
            </span>
            {grupos === null ? (
              <Boton tamano="sm" className="self-start" disabled={cargandoGrupos} onClick={cargarGrupos}>{cargandoGrupos ? 'Buscando grupos…' : 'Elegir grupos'}</Boton>
            ) : grupos.length ? (
              <div className="flex flex-wrap gap-1.5">
                {grupos.map((g) => (
                  <Opcion key={g.id} activa={elegidosGrupos.includes(g.id)} onClick={() => alternar(elegidosGrupos, setElegidosGrupos, g.id)}>
                    {g.nombre} ({g.personas}){g.soloAdmins ? ' · solo admins' : ''}
                  </Opcion>
                ))}
              </div>
            ) : (
              <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Este número no está en ningún grupo.</span>
            )}
            {grupos?.some((g) => g.soloAdmins && elegidosGrupos.includes(g.id)) && (
              <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>En los grupos "solo admins" se publica solo si este número es administrador.</span>
            )}
          </div>
        )}
        <div className="rounded-lg px-3 py-2 text-[13px]" style={{ backgroundColor: 'var(--surface-2)', color: TEXTO_PRIMARIO }}>
          {!lineaId ? (
            <span style={{ color: TEXTO_TERCIARIO }}>Elige el número para ver a cuántos les llega.</span>
          ) : contando ? (
            <span style={{ color: TEXTO_TERCIARIO }}>Contando…</span>
          ) : conteo ? (
            <>
              {alEmpezar && cuando === 'programar' ? 'Hoy le llegaría a ' : 'Le llega a '}<b>{conteo.total}</b> {conteo.total === 1 ? 'destinatario' : 'destinatarios'}
              {conteo.ejemplos.length > 0 && <span style={{ color: TEXTO_TERCIARIO }}>: {conteo.ejemplos.join(', ')}{conteo.total > conteo.ejemplos.length ? '…' : ''}</span>}
              {conteo.total > conteo.maximo && <div className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>El máximo por envío es {conteo.maximo}: usa más filtros o divide la lista.</div>}
              {alEmpezar && (
                <div className="text-[12px] mt-1" style={{ color: TEXTO_TERCIARIO }}>
                  La lista se arma al empezar: le llega a todos los que cumplan estos filtros ese día y a esa hora (también a los que te escriban de aquí a entonces).
                </div>
              )}
            </>
          ) : null}
        </div>
      </Seccion>

      <Seccion numero={3} titulo="El mensaje">
        <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
          Si escribes varias versiones, a cada persona le llega una al azar (así no son todos iguales). Puedes usar variables:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button key={v} type="button" onClick={() => insertar(v)} className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--accent)' }}>{v}</button>
          ))}
        </div>
        {textos.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Versión {i + 1}</span>
              {textos.length > 1 && (
                <button type="button" onClick={() => setTextos((p) => p.filter((_, k) => k !== i))} aria-label={`Quitar versión ${i + 1}`}><X size={14} color={TEXTO_TERCIARIO} /></button>
              )}
            </div>
            <textarea
              value={t}
              onFocus={() => { textoActivo.current = i; }}
              onChange={(e) => setTextos((p) => p.map((x, k) => (k === i ? e.target.value : x)))}
              rows={4}
              placeholder={i === 0 ? 'Hola {nombre} 👋 Este verano abrimos las vacaciones útiles en {sucursal}…' : 'Otra forma de decir lo mismo…'}
              className={`${claseCampo} font-normal resize-y`}
              style={estiloArea}
            />
          </div>
        ))}
        {textos.length < 5 && (
          <Boton tamano="sm" icono={Plus} className="self-start" onClick={() => setTextos((p) => [...p, ''])}>Otra versión</Boton>
        )}
        {origen !== 'grupos' && (
          <label className="flex items-start gap-2 text-[12.5px] rounded-lg p-2.5 cursor-pointer" style={{ color: TEXTO_SECUNDARIO, border: `1px solid ${BORDE}` }}>
            <input type="checkbox" className="mt-0.5" checked={adaptar} onChange={(e) => setAdaptar(e.target.checked)} />
            <span>
              <b style={{ color: TEXTO_PRIMARIO }}>Que la IA adapte el mensaje a cada cliente si corresponde.</b> Queda lo más fiel posible a tu mensaje (mismos
              datos, precios, fechas y links), pero con lo que el cliente ya contó: el curso que le interesa, la edad de su hijo… Si no hay nada que
              agregar, sale igual. Usa una consulta a la IA por cada persona. En los grupos sale tu mensaje tal cual.
            </span>
          </label>
        )}
        <input ref={inputImagen} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f, 'imagen'); e.target.value = ''; }} />
        <input ref={inputPdf} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f, 'pdf'); e.target.value = ''; }} />
        {media ? (
          <div className="flex items-center gap-2 rounded-lg p-2" style={{ border: `1px solid ${BORDE}` }}>
            {media.tipo === 'imagen' ? <img src={media.url} alt="" className="rounded-md object-cover" style={{ width: 56, height: 56 }} /> : <FileText size={22} color="var(--accent)" />}
            <span className="text-[12.5px] flex-1 truncate" style={{ color: TEXTO_PRIMARIO }}>{media.nombre}<span style={{ color: TEXTO_TERCIARIO }}> · el texto va como {media.tipo === 'imagen' ? 'leyenda de la imagen' : 'leyenda del PDF'}</span></span>
            <button type="button" onClick={() => setMedia(null)} aria-label="Quitar archivo"><X size={15} color={TEXTO_TERCIARIO} /></button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Boton tamano="sm" icono={ImageIcon} disabled={subiendo} onClick={() => inputImagen.current?.click()}>{subiendo ? 'Subiendo…' : 'Agregar imagen'}</Boton>
            <Boton tamano="sm" icono={FileText} disabled={subiendo} onClick={() => inputPdf.current?.click()}>Agregar PDF</Boton>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 pt-1" style={{ borderTop: `1px solid ${BORDE}` }}>
          <Campo etiqueta="Mándame una prueba a">
            <input value={telPrueba} onChange={(e) => setTelPrueba(e.target.value)} placeholder="Ej. 70000000" inputMode="tel" className={`${claseCampo} font-normal`} style={{ ...estiloCampo, width: 170 }} />
          </Campo>
          <Boton icono={Send} disabled={probando || !lineaId || !telPrueba.trim() || (!textosLimpios.length && !media)} onClick={probar}>{probando ? 'Enviando…' : 'Enviar prueba'}</Boton>
        </div>
      </Seccion>

      <Seccion numero={4} titulo="Cuándo y a qué ritmo">
        <div className="flex flex-wrap gap-1.5">
          <Opcion activa={cuando === 'ahora'} onClick={() => setCuando('ahora')}>Empezar ahora</Opcion>
          <Opcion activa={cuando === 'programar'} onClick={() => setCuando('programar')}>Programar fecha y hora</Opcion>
        </div>
        {cuando === 'programar' && (
          <Campo etiqueta="Empieza el">
            <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className={`${claseCampo} font-normal`} style={{ ...estiloCampo, width: 230 }} />
          </Campo>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Campo etiqueta="Envía desde las">
            <input type="time" value={desde} onChange={(e) => setDesde(e.target.value)} className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Hasta las">
            <input type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Pausa entre mensajes (s)" ayuda="Al azar entre los dos.">
            <div className="flex items-center gap-1">
              <input type="number" min={20} max={3600} value={pausaMin} onChange={(e) => setPausaMin(Math.max(20, Number(e.target.value) || 20))} className={`${claseCampo} font-normal w-full`} style={estiloCampo} />
              <span style={{ color: TEXTO_TERCIARIO }}>a</span>
              <input type="number" min={20} max={3600} value={pausaMax} onChange={(e) => setPausaMax(Math.max(20, Number(e.target.value) || 20))} className={`${claseCampo} font-normal w-full`} style={estiloCampo} />
            </div>
          </Campo>
          <Campo etiqueta="Máximo por día" ayuda="Sumando todos los masivos de este número.">
            <input type="number" min={1} max={1000} value={maximo} onChange={(e) => setMaximo(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))} className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
        </div>
        {estimado && <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>{estimado}</span>}
      </Seccion>

      <div className="flex gap-2 pb-6">
        <Boton variante="primario" icono={Send} disabled={guardando || contando || (!conteo?.total && !(alEmpezar && cuando === 'programar'))} onClick={guardar}>
          {guardando ? 'Guardando…' : alEmpezar && cuando === 'programar' ? 'Programar envío' : conteo?.total ? `Enviar a ${conteo.total}` : 'Programar envío'}
        </Boton>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
      </div>
    </div>
  );
}
