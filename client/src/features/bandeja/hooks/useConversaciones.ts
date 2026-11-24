import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { PALETA_LINEAS } from '../../../lib/tema';
import type { Conversacion, EstadoConversacion, EtiquetaWhatsapp, LineaWhatsapp, Mensaje, Temperatura, Usuario } from '../../../lib/tipos';

export interface UltimoMensaje {
  conversacion_id: string;
  contenido: string | null;
  tipo: Mensaje['tipo'];
  creado_en: string;
  remitente: Mensaje['remitente'];
  estado_entrega?: string | null;
}

// Datos de venta del contacto que la lista de chats necesita para marcar
// oportunidades (leads calientes) sin abrir la ficha.
export interface ResumenContacto {
  temperatura: Temperatura | null;
  probabilidad_cierre: number | null;
  valor_estimado: number | null;
  producto_interes: string | null;
}

// Un chat es "oportunidad" si el contacto está caliente o con alta
// probabilidad de cierre: son los leads que conviene atender primero.
export function esOportunidad(r: ResumenContacto | undefined): boolean {
  if (!r) return false;
  return r.temperatura === 'caliente' || (r.probabilidad_cierre ?? 0) >= 70;
}

// ---------- SígueloCRM: la Bandeja por partes ----------
// Antes se pedían todos los chats y todos sus mensajes de una vez: Supabase corta en 1000 filas,
// así que se veían "1000" chats y casi todos "Sin mensajes", y se volvía a pedir todo cada vez
// que se movía cualquier chat (con un masivo en marcha, en cada envío). Ahora se piden de a 100,
// ya filtrados, con su último mensaje (siguelo_bandeja, sección 48 del SQL), y cuando un chat
// cambia se pide solo ese. Sin la sección 48 pegada, funciona como antes.

export type Pestana = 'todos' | 'mios' | 'sin_asignar' | 'por_vencer' | 'resueltos';
export interface ConsultaBandeja {
  pestana: Pestana;
  linea: string; // 'todas' o el id del número
  busqueda: string;
  etiquetaId: string; // 'todas' o el id de la etiqueta
  sinLeer: boolean;
  soloSinResponder: boolean;
  antiguosPrimero: boolean;
}
export const CONSULTA_INICIAL: ConsultaBandeja = { pestana: 'todos', linea: 'todas', busqueda: '', etiquetaId: 'todas', sinLeer: false, soloSinResponder: false, antiguosPrimero: false };
export type Conteos = { todos: number; mios: number; sin_asignar: number; por_vencer: number; sin_responder: number; mios_sin_responder: number };

type Fila = Conversacion & {
  creado_en?: string;
  ultimo_contenido: string | null;
  ultimo_tipo: Mensaje['tipo'] | null;
  ultimo_creado_en: string | null;
  ultimo_remitente: Mensaje['remitente'] | null;
  ultimo_estado_entrega: string | null;
  pendientes: number;
  ultimo_cliente: string | null;
  contacto_id: string | null;
  temperatura: Temperatura | null;
  probabilidad_cierre: number | null;
  valor_estimado: number | null;
  producto_interes: string | null;
  etiquetas: EtiquetaWhatsapp[];
};

const POR_PAGINA = 100;
const VENTANA_MIN = 24 * 60;
const AVISO_VENTANA_MIN = 4 * 60;
const minutosDesde = (iso: string | null, ahora: number) => (iso ? Math.floor((ahora - new Date(iso).getTime()) / 60000) : null);
const porVencer = (f: Fila, ahora: number) => {
  const m = minutosDesde(f.ultimo_cliente, ahora);
  return m !== null && m < VENTANA_MIN && VENTANA_MIN - m <= AVISO_VENTANA_MIN;
};
const esperando = (f: Fila) => f.estado !== 'cerrado' && f.ultimo_remitente === 'cliente';

// El mismo orden que siguelo_bandeja: así un chat que se mueve queda en su lugar sin volver a pedir todo.
function comparar(q: ConsultaBandeja) {
  const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
  return (a: Fila, b: Fila) => {
    if (q.pestana === 'por_vencer') {
      const d = (t(a.ultimo_cliente) || Infinity) - (t(b.ultimo_cliente) || Infinity);
      if (d) return d;
    }
    if (q.antiguosPrimero || q.soloSinResponder) {
      const ea = esperando(a), eb = esperando(b);
      if (ea !== eb) return ea ? -1 : 1;
      if (ea && eb && t(a.ultimo_creado_en) !== t(b.ultimo_creado_en)) return t(a.ultimo_creado_en) - t(b.ultimo_creado_en);
    }
    return t(b.ultima_actividad) - t(a.ultima_actividad) || (a.id < b.id ? -1 : 1);
  };
}

// Filtro y orden en la página, para cuando la sección 48 no está pegada (cómo era antes).
function filtrarLocal(filas: Fila[], q: ConsultaBandeja, miId: string, ahora: number): Fila[] {
  const texto = q.busqueda.trim().toLowerCase();
  const digitos = q.busqueda.replace(/\D/g, '');
  return filas
    .filter((f) => {
      if (q.linea !== 'todas' && f.linea_id !== q.linea) return false;
      if (q.pestana === 'resueltos' ? f.estado !== 'cerrado' : f.estado === 'cerrado') return false;
      if (q.pestana === 'mios' && f.agente_asignado_id !== miId) return false;
      if (q.pestana === 'sin_asignar' && f.agente_asignado_id !== null) return false;
      if (q.pestana === 'por_vencer' && !porVencer(f, ahora)) return false;
      if (q.sinLeer && !(f.pendientes > 0)) return false;
      if (q.soloSinResponder && !esperando(f)) return false;
      if (q.etiquetaId !== 'todas' && !f.etiquetas.some((e) => e.id === q.etiquetaId)) return false;
      if (texto && !((f.contacto_nombre || '').toLowerCase().includes(texto) || (digitos && f.contacto_telefono.includes(digitos)) || (f.ultimo_contenido || '').toLowerCase().includes(texto) || f.etiquetas.some((e) => e.nombre.toLowerCase().includes(texto)))) return false;
      return true;
    })
    .sort(comparar(q));
}

function contarLocal(filas: Fila[], q: ConsultaBandeja, miId: string, ahora: number): Conteos {
  const abiertos = filas.filter((f) => f.estado !== 'cerrado' && (q.linea === 'todas' || f.linea_id === q.linea));
  return {
    todos: abiertos.length,
    mios: abiertos.filter((f) => f.agente_asignado_id === miId).length,
    sin_asignar: abiertos.filter((f) => f.agente_asignado_id === null).length,
    por_vencer: abiertos.filter((f) => porVencer(f, ahora)).length,
    sin_responder: abiertos.filter(esperando).length,
    mios_sin_responder: abiertos.filter((f) => esperando(f) && f.agente_asignado_id === miId).length,
  };
}

const argumentos = (q: ConsultaBandeja) => ({
  p_pestana: q.pestana,
  p_linea: q.linea === 'todas' ? null : q.linea,
  p_busqueda: q.busqueda.trim() || null,
  p_etiqueta: q.etiquetaId === 'todas' ? null : q.etiquetaId,
  p_sin_leer: q.sinLeer,
  p_sin_responder: q.soloSinResponder,
  p_antiguos: q.antiguosPrimero || q.soloSinResponder,
});

// ¿La sección 48 no está pegada? (PostgREST no encuentra la función)
const faltaFuncion = (e: { code?: string; message?: string } | null) => !!e && (e.code === 'PGRST202' || /siguelo_bandeja/.test(e.message || ''));

export function useConversaciones(usuario: Usuario | null) {
  const [lineas, setLineas] = useState<LineaWhatsapp[]>([]);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [consulta, setConsultaEstado] = useState<ConsultaBandeja>(CONSULTA_INICIAL);
  const [conteos, setConteos] = useState<Conteos>({ todos: 0, mios: 0, sin_asignar: 0, por_vencer: 0, sin_responder: 0, mios_sin_responder: 0 });
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [misEsperando, setMisEsperando] = useState<Fila[]>([]);
  const [etiquetasDisponibles, setEtiquetasDisponibles] = useState<EtiquetaWhatsapp[]>([]);
  // Modo "antes": todos los chats en la página (sin la sección 48).
  const [modoAntiguo, setModoAntiguo] = useState(false);
  const [todasAntiguo, setTodasAntiguo] = useState<Fila[]>([]);
  const [ahora, setAhora] = useState(() => Date.now());

  const consultaRef = useRef(consulta);
  consultaRef.current = consulta;
  const filasRef = useRef(filas);
  filasRef.current = filas;
  const modoRef = useRef(modoAntiguo);
  modoRef.current = modoAntiguo;
  const pedido = useRef(0);
  const conContacto = useRef(new Set<string>());

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const cargarLineas = useCallback(async () => {
    const { data } = await supabase.from('lineas_whatsapp').select('*').order('nombre').returns<LineaWhatsapp[]>();
    setLineas(data || []);
  }, []);

  const cargarEtiquetasDisponibles = useCallback(async () => {
    const { data } = await supabase.from('etiquetas_whatsapp').select('id, nombre, color').eq('eliminada', false).order('nombre').returns<EtiquetaWhatsapp[]>();
    const vistas = new Map<string, EtiquetaWhatsapp>();
    (data || []).forEach((e) => vistas.set(e.id, e));
    setEtiquetasDisponibles([...vistas.values()]);
  }, []);

  // Cada chat tiene su ficha de contacto (sin pisar datos ya cargados): solo los que no la tienen.
  const asegurarContactos = useCallback(async (lista: Fila[]) => {
    if (!usuario) return;
    const faltan = lista.filter((f) => !f.contacto_id && !conContacto.current.has(f.contacto_telefono));
    if (!faltan.length) return;
    faltan.forEach((f) => conContacto.current.add(f.contacto_telefono));
    await supabase.from('contactos').upsert(
      faltan.map((f) => ({ empresa_id: usuario.empresa_id, telefono: f.contacto_telefono, nombre: f.contacto_nombre || null })),
      { onConflict: 'empresa_id,telefono', ignoreDuplicates: true },
    );
  }, [usuario]);

  // ---------- Modo de antes (sin la sección 48) ----------
  const cargarAntiguo = useCallback(async () => {
    if (!usuario) return;
    const { data, error } = await supabase.from('conversaciones').select('*').order('ultima_actividad', { ascending: false }).returns<Conversacion[]>();
    if (error) return console.error(error);
    const convs = data || [];
    const ids = convs.map((c) => c.id);
    const { data: msjs } = ids.length
      ? await supabase.from('mensajes').select('conversacion_id, contenido, tipo, creado_en, remitente, estado_entrega').in('conversacion_id', ids).order('creado_en', { ascending: false }).returns<UltimoMensaje[]>()
      : { data: [] as UltimoMensaje[] };
    const { data: contactos } = await supabase.from('contactos').select('id, telefono, temperatura, probabilidad_cierre, valor_estimado, producto_interes').returns<({ id: string; telefono: string } & ResumenContacto)[]>();
    const { data: asociaciones } = await supabase.from('contacto_etiquetas').select('contacto_id, etiquetas_whatsapp(id, nombre, color, eliminada)').returns<{ contacto_id: string; etiquetas_whatsapp: (EtiquetaWhatsapp & { eliminada: boolean }) | null }[]>();
    const porTel = new Map((contactos || []).map((c) => [c.telefono, c]));
    const etiquetasDe: Record<string, EtiquetaWhatsapp[]> = {};
    (asociaciones || []).forEach((a) => {
      if (a.etiquetas_whatsapp && !a.etiquetas_whatsapp.eliminada) (etiquetasDe[a.contacto_id] ||= []).push(a.etiquetas_whatsapp);
    });
    const info: Record<string, { u?: UltimoMensaje; n: number; cortada: boolean; uc?: string }> = {};
    (msjs || []).forEach((m) => {
      const x = (info[m.conversacion_id] ||= { n: 0, cortada: false });
      if (!x.u) x.u = m;
      if (m.remitente === 'cliente' && !x.uc) x.uc = m.creado_en;
      if (x.cortada) return;
      if (m.remitente === 'cliente') x.n++;
      else x.cortada = true;
    });
    const lista: Fila[] = convs.map((c) => {
      const x = info[c.id];
      const k = porTel.get(c.contacto_telefono);
      return {
        ...c,
        ultimo_contenido: x?.u?.contenido ?? null, ultimo_tipo: x?.u?.tipo ?? null, ultimo_creado_en: x?.u?.creado_en ?? null,
        ultimo_remitente: x?.u?.remitente ?? null, ultimo_estado_entrega: x?.u?.estado_entrega ?? null,
        pendientes: x?.n ?? 0, ultimo_cliente: x?.uc ?? null,
        contacto_id: k?.id ?? null, temperatura: k?.temperatura ?? null, probabilidad_cierre: k?.probabilidad_cierre ?? null,
        valor_estimado: k?.valor_estimado ?? null, producto_interes: k?.producto_interes ?? null,
        etiquetas: k ? etiquetasDe[k.id] || [] : [],
      };
    });
    setTodasAntiguo(lista);
    setCargando(false);
    asegurarContactos(lista);
  }, [usuario, asegurarContactos]);

  // ---------- Modo nuevo: de a 100, ya filtrados ----------
  const pedir = useCallback(async (q: ConsultaBandeja, extra: { p_ids?: string[]; p_limite?: number; p_desde?: number; p_pestana?: Pestana; p_sin_responder?: boolean; p_antiguos?: boolean } = {}) => {
    const { data, error } = await supabase.rpc('siguelo_bandeja', { ...argumentos(q), p_limite: POR_PAGINA, ...extra });
    if (error) {
      if (faltaFuncion(error)) setModoAntiguo(true);
      else console.error(error);
      return null;
    }
    return ((data || []) as Fila[]).map((f) => ({ ...f, etiquetas: f.etiquetas || [] }));
  }, []);

  const cargarConteos = useCallback(async () => {
    if (modoRef.current) return;
    const q = consultaRef.current;
    const { data, error } = await supabase.rpc('siguelo_bandeja_conteos', { p_linea: q.linea === 'todas' ? null : q.linea });
    if (!error && data) setConteos(data as Conteos);
    // Para "Hoy": mis chats que esperan respuesta.
    const mios = await pedir({ ...CONSULTA_INICIAL }, { p_pestana: 'mios', p_sin_responder: true, p_antiguos: true, p_limite: 50 });
    if (mios) setMisEsperando(mios);
  }, [pedir]);

  const cargarPrimera = useCallback(async () => {
    if (!usuario) return;
    if (modoRef.current) return cargarAntiguo();
    const n = ++pedido.current;
    setCargando(true);
    const lista = await pedir(consultaRef.current);
    if (n !== pedido.current) return; // llegó otra consulta mientras tanto
    setCargando(false);
    if (!lista) return;
    setFilas(lista);
    setHayMas(lista.length === POR_PAGINA);
    asegurarContactos(lista);
  }, [usuario, pedir, cargarAntiguo, asegurarContactos]);

  const cargarMas = useCallback(async () => {
    if (modoRef.current || cargandoMas || !hayMas) return;
    setCargandoMas(true);
    const n = pedido.current;
    const lista = await pedir(consultaRef.current, { p_desde: filasRef.current.length });
    setCargandoMas(false);
    if (!lista || n !== pedido.current) return;
    setFilas((prev) => {
      const vistos = new Set(prev.map((f) => f.id));
      return [...prev, ...lista.filter((f) => !vistos.has(f.id))];
    });
    setHayMas(lista.length === POR_PAGINA);
    asegurarContactos(lista);
  }, [cargandoMas, hayMas, pedir, asegurarContactos]);

  // Cambios que llegan en vivo: se juntan un momento y se piden solo esos chats.
  const porRefrescar = useRef(new Set<string>());
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporizadorConteos = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programarConteos = useCallback(() => {
    if (temporizadorConteos.current) return;
    temporizadorConteos.current = setTimeout(() => {
      temporizadorConteos.current = null;
      cargarConteos();
    }, 8000);
  }, [cargarConteos]);

  const refrescarAhora = useCallback(async () => {
    temporizador.current = null;
    const ids = [...porRefrescar.current];
    porRefrescar.current.clear();
    if (!ids.length) return;
    if (modoRef.current) return cargarAntiguo();
    const q = consultaRef.current;
    const nuevas = await pedir(q, { p_ids: ids, p_limite: ids.length });
    if (!nuevas) return;
    setFilas((prev) => {
      const porId = new Map(nuevas.map((f) => [f.id, f]));
      const quedan = prev.filter((f) => !ids.includes(f.id) || porId.has(f.id)).map((f) => porId.get(f.id) ?? f);
      const vistos = new Set(quedan.map((f) => f.id));
      return [...quedan, ...nuevas.filter((f) => !vistos.has(f.id))].sort(comparar(q));
    });
    setMisEsperando((prev) => prev.map((f) => nuevas.find((x) => x.id === f.id) ?? f));
    asegurarContactos(nuevas);
    programarConteos();
  }, [pedir, cargarAntiguo, asegurarContactos, programarConteos]);

  const refrescarChats = useCallback((ids: string[]) => {
    ids.forEach((id) => porRefrescar.current.add(id));
    if (!temporizador.current) temporizador.current = setTimeout(refrescarAhora, modoRef.current ? 3000 : 800);
  }, [refrescarAhora]);

  // Un chat se movió (estado, asignación, actividad) o llegó/salió un mensaje.
  const alCambiarConversacion = useCallback((id: string, borrada = false) => {
    if (borrada) {
      setFilas((prev) => prev.filter((f) => f.id !== id));
      programarConteos();
      return;
    }
    refrescarChats([id]);
  }, [refrescarChats, programarConteos]);

  // Cambió la ficha o las etiquetas de un contacto: solo sus chats que están en pantalla.
  const alCambiarContacto = useCallback((cambio: { contactoId?: string; telefono?: string }) => {
    const lista = modoRef.current ? todasAntiguo : filasRef.current;
    const ids = lista.filter((f) => (cambio.contactoId && f.contacto_id === cambio.contactoId) || (cambio.telefono && f.contacto_telefono === cambio.telefono)).map((f) => f.id);
    if (ids.length) refrescarChats(ids);
  }, [refrescarChats, todasAntiguo]);

  const setConsulta = useCallback((cambio: Partial<ConsultaBandeja>) => {
    setConsultaEstado((prev) => {
      const nueva = { ...prev, ...cambio };
      return JSON.stringify(nueva) === JSON.stringify(prev) ? prev : nueva;
    });
  }, []);

  // Al entrar, y cada vez que cambia la consulta (pestaña, filtros, búsqueda), se pide la primera parte.
  useEffect(() => {
    if (!usuario) return;
    cargarPrimera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, consulta, modoAntiguo]);
  useEffect(() => {
    if (!usuario) return;
    cargarConteos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, consulta.linea, modoAntiguo]);

  useEffect(() => {
    if (!usuario) return;
    cargarLineas();
    cargarEtiquetasDisponibles();
    const canal = supabase
      .channel(`etiquetas-chats-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacto_etiquetas' }, (p) => {
        const fila = (p.new && 'contacto_id' in p.new ? p.new : p.old) as { contacto_id?: string };
        if (fila?.contacto_id) alCambiarContacto({ contactoId: fila.contacto_id });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'etiquetas_whatsapp' }, () => {
        cargarEtiquetasDisponibles();
        if (modoRef.current) cargarAntiguo();
        else refrescarChats(filasRef.current.filter((f) => f.etiquetas.length).map((f) => f.id));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contactos' }, (p) => {
        const fila = (p.new && 'id' in p.new ? p.new : p.old) as { id?: string; telefono?: string };
        alCambiarContacto({ contactoId: fila?.id, telefono: fila?.telefono });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  // Lo que ve la lista (en el modo de antes se filtra aquí).
  const visibles = useMemo(
    () => (modoAntiguo && usuario ? filtrarLocal(todasAntiguo, consulta, usuario.id, ahora) : filas),
    [modoAntiguo, todasAntiguo, consulta, usuario, ahora, filas],
  );
  const conteosVisibles = useMemo(
    () => (modoAntiguo && usuario ? contarLocal(todasAntiguo, consulta, usuario.id, ahora) : conteos),
    [modoAntiguo, todasAntiguo, consulta, usuario, ahora, conteos],
  );
  const esperandoMios = useMemo(
    () => (modoAntiguo && usuario ? todasAntiguo.filter((f) => esperando(f) && f.agente_asignado_id === usuario.id) : misEsperando),
    [modoAntiguo, todasAntiguo, usuario, misEsperando],
  );

  // Lo que ya usaban las otras partes (Hoy, la paleta, el chat abierto), armado desde las filas.
  const derivados = useMemo(() => {
    const todas = new Map<string, Fila>();
    [...visibles, ...esperandoMios].forEach((f) => todas.set(f.id, f));
    const ultimosMensajes: Record<string, UltimoMensaje> = {};
    const pendientes: Record<string, number> = {};
    const ultimoDelCliente: Record<string, string> = {};
    const etiquetasPorTelefono: Record<string, EtiquetaWhatsapp[]> = {};
    const contactoPorTelefono: Record<string, ResumenContacto> = {};
    todas.forEach((f) => {
      if (f.ultimo_creado_en) ultimosMensajes[f.id] = { conversacion_id: f.id, contenido: f.ultimo_contenido, tipo: f.ultimo_tipo || 'texto', creado_en: f.ultimo_creado_en, remitente: f.ultimo_remitente || 'cliente', estado_entrega: f.ultimo_estado_entrega };
      if (f.pendientes) pendientes[f.id] = f.pendientes;
      if (f.ultimo_cliente) ultimoDelCliente[f.id] = f.ultimo_cliente;
      etiquetasPorTelefono[f.contacto_telefono] = f.etiquetas;
      if (f.contacto_id) contactoPorTelefono[f.contacto_telefono] = { temperatura: f.temperatura, probabilidad_cierre: f.probabilidad_cierre, valor_estimado: f.valor_estimado, producto_interes: f.producto_interes };
    });
    return { ultimosMensajes, pendientes, ultimoDelCliente, etiquetasPorTelefono, contactoPorTelefono };
  }, [visibles, esperandoMios]);

  // Un chat que no está en la lista cargada (por ejemplo, abierto desde Contactos).
  const buscarConversacion = useCallback(async (telefono: string): Promise<Conversacion | null> => {
    const { data } = await supabase.from('conversaciones').select('*').like('contacto_telefono', `${telefono}%`).order('ultima_actividad', { ascending: false }).limit(1).returns<Conversacion[]>();
    return data?.[0] ?? null;
  }, []);

  const reclamar = async (c: Conversacion) => {
    await supabase.from('conversaciones').update({ agente_asignado_id: usuario!.id }).eq('id', c.id);
  };
  const liberar = async (c: Conversacion) => {
    await supabase.from('conversaciones').update({ agente_asignado_id: null }).eq('id', c.id);
  };
  const transferir = async (c: Conversacion, agenteId: string) => {
    await supabase.from('conversaciones').update({ agente_asignado_id: agenteId }).eq('id', c.id);
  };
  const cambiarEstado = async (c: Conversacion, estado: EstadoConversacion) => {
    await supabase.from('conversaciones').update({ estado }).eq('id', c.id);
  };
  const resolver = (c: Conversacion) => cambiarEstado(c, 'cerrado');

  const colorLinea = (lineaId: string) => {
    const idx = lineas.findIndex((l) => l.id === lineaId);
    return PALETA_LINEAS[idx >= 0 ? idx % PALETA_LINEAS.length : 0];
  };
  const nombreLinea = (lineaId: string) => lineas.find((l) => l.id === lineaId)?.nombre || '';

  return {
    lineas,
    conversaciones: visibles as Conversacion[],
    misEsperando: esperandoMios as Conversacion[],
    ...derivados,
    consulta,
    setConsulta,
    conteos: conteosVisibles,
    hayMas: !modoAntiguo && hayMas,
    cargando,
    cargandoMas,
    cargarMas,
    etiquetasDisponibles,
    modoAntiguo,
    recargar: cargarPrimera,
    alCambiarConversacion,
    buscarConversacion,
    reclamar,
    liberar,
    transferir,
    cambiarEstado,
    resolver,
    colorLinea,
    nombreLinea,
  };
}
