import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCheck, FileText, Flame, Mic, Search, User } from 'lucide-react';
import { CHIP_LINEA, colorEtiquetaWhatsapp } from '../../lib/tema';
import { formatoFechaLista, formatoTelefono, inicialesDe, nombreConversacion, tieneNombre } from './utils';
import { CONSULTA_INICIAL, esOportunidad, type ConsultaBandeja, type Conteos, type Pestana, type ResumenContacto, type UltimoMensaje } from './hooks/useConversaciones';
import type { Conversacion, EtiquetaWhatsapp, LineaWhatsapp } from '../../lib/tipos';

interface ListaConversacionesProps {
  conversaciones: Conversacion[];
  ultimosMensajes: Record<string, UltimoMensaje>;
  lineas: LineaWhatsapp[];
  etiquetasPorTelefono: Record<string, EtiquetaWhatsapp[]>;
  contactoPorTelefono: Record<string, ResumenContacto>;
  pendientes: Record<string, number>;
  ultimoDelCliente: Record<string, string>;
  esVendedor: boolean;
  miId: string;
  seleccionadaId: string | null;
  onSeleccionar: (c: Conversacion) => void;
  colorLinea: (lineaId: string) => string;
  nombreLinea: (lineaId: string) => string;
  compacta: boolean;
  // SígueloCRM: la lista viene ya filtrada y de a 100 (useConversaciones → siguelo_bandeja).
  consulta: ConsultaBandeja;
  onConsulta: (cambio: Partial<ConsultaBandeja>) => void;
  conteos: Conteos;
  etiquetasDisponibles: EtiquetaWhatsapp[];
  hayMas: boolean;
  cargando: boolean;
  cargandoMas: boolean;
  onCargarMas: () => void;
  aviso?: string;
}

// WhatsApp deja responder con texto libre hasta 24 h después del último mensaje
// del cliente. "Por vencer" (los que ya pasaron las 20 h) lo filtra la base.
const VENTANA_MIN = 24 * 60;

// Minutos que le quedan a la ventana de 24 h; null si ya venció o el cliente
// nunca escribió.
export function minutosRestantesVentana(ultimoCliente: string | undefined, ahora: number): number | null {
  if (!ultimoCliente) return null;
  const restante = VENTANA_MIN - Math.floor((ahora - new Date(ultimoCliente).getTime()) / 60000);
  return restante > 0 ? restante : null;
}

// Los filtros se recuerdan por usuario (cada agente trabaja a su manera). "v2": desde la Bandeja
// por partes, "Más antiguos primero" viene apagado (el más reciente arriba, como WhatsApp).
type Guardado = Omit<ConsultaBandeja, 'busqueda'>;
const claveDe = (miId: string) => `bandeja-filtros-v2-${miId}`;

function leerFiltros(clave: string): Guardado {
  const { busqueda: _b, ...inicial } = CONSULTA_INICIAL;
  void _b;
  try {
    const guardado = localStorage.getItem(clave);
    return guardado ? { ...inicial, ...JSON.parse(guardado) } : inicial;
  } catch {
    return inicial;
  }
}

// "Responder ahora" (pantalla Hoy) deja marcado el filtro de sin responder
// antes de abrir la Bandeja; la lista lo lee al montarse.
export function activarFiltroSinResponder(miId: string): void {
  const clave = claveDe(miId);
  try {
    localStorage.setItem(clave, JSON.stringify({ ...leerFiltros(clave), pestana: 'mios', soloSinResponder: true }));
  } catch { /* sin storage: se abre la Bandeja sin filtro */ }
}

// Minutos que lleva esperando respuesta un chat (el último mensaje es del
// cliente); null si no está esperando.
export function minutosEsperando(c: Conversacion, ultimo: UltimoMensaje | undefined, ahora: number): number | null {
  if (c.estado === 'cerrado' || !ultimo || ultimo.remitente !== 'cliente') return null;
  return Math.max(0, Math.floor((ahora - new Date(ultimo.creado_en).getTime()) / 60000));
}

export function textoEspera(min: number): string {
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

// Verde dentro de la meta (5 min), ámbar hasta 30, rojo después.
export function colorEspera(min: number): string {
  if (min <= 5) return 'var(--ok)';
  if (min <= 30) return 'var(--warn)';
  return 'var(--bad)';
}


export default function ListaConversaciones({
  conversaciones,
  ultimosMensajes,
  lineas,
  etiquetasPorTelefono,
  contactoPorTelefono,
  pendientes,
  ultimoDelCliente,
  esVendedor,
  miId,
  seleccionadaId,
  onSeleccionar,
  nombreLinea,
  compacta,
  consulta,
  onConsulta,
  conteos,
  etiquetasDisponibles,
  hayMas,
  cargando,
  cargandoMas,
  onCargarMas,
  aviso,
}: ListaConversacionesProps) {
  const claveFiltros = claveDe(miId);
  const cambiarFiltros = (cambio: Partial<Guardado>) => {
    onConsulta(cambio);
    try {
      const { busqueda: _b, ...guardar } = { ...consulta, ...cambio };
      void _b;
      localStorage.setItem(claveFiltros, JSON.stringify(guardar));
    } catch { /* sin storage: no se recuerda */ }
  };
  // Al abrir: los filtros que dejaste la última vez.
  useEffect(() => {
    onConsulta({ ...leerFiltros(claveFiltros), ...(esVendedor ? { linea: 'todas' } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveFiltros]);
  const pestana = consulta.pestana;
  const setPestana = (p: Pestana) => cambiarFiltros({ pestana: p });
  const filtros = consulta;

  // La búsqueda se manda a la base un momento después de dejar de escribir.
  const [busqueda, setBusqueda] = useState(consulta.busqueda);
  useEffect(() => {
    const t = setTimeout(() => onConsulta({ busqueda }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  // Se refresca cada minuto para que los "hace X min" se muevan solos.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const sinResponder = conteos.sin_responder;
  const lista = conversaciones;

  const pestanas: { id: Pestana; etiqueta: string; conteo?: number }[] = [
    { id: 'todos', etiqueta: 'Todos', conteo: conteos.todos },
    { id: 'mios', etiqueta: 'Míos', conteo: conteos.mios },
    { id: 'sin_asignar', etiqueta: 'Sin asignar', conteo: conteos.sin_asignar },
    { id: 'por_vencer', etiqueta: 'Por vencer', conteo: conteos.por_vencer },
  ];

  // Más chats al llegar al final de la lista.
  const contenedor = useRef<HTMLDivElement>(null);
  const alDesplazar = () => {
    const el = contenedor.current;
    if (el && hayMas && !cargandoMas && el.scrollTop + el.clientHeight > el.scrollHeight - 400) onCargarMas();
  };
  useEffect(() => {
    contenedor.current?.scrollTo({ top: 0 });
  }, [consulta]);
  const estiloChip = (activo: boolean): React.CSSProperties => ({
    border: `1px solid ${activo ? 'transparent' : 'var(--line)'}`,
    backgroundColor: activo ? 'var(--accent-soft)' : 'var(--surface)',
    color: activo ? 'var(--accent)' : 'var(--fg-2)',
    fontWeight: activo ? 600 : 400,
  });

  const encabezado = (
    <div className="shrink-0">
      <div className="px-4 pt-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 disp text-[20px] font-bold" style={{ color: 'var(--fg)' }}>Chats</h2>
          {sinResponder > 0 && (
            <button
              onClick={() => cambiarFiltros({ soloSinResponder: !filtros.soloSinResponder, ...(pestana === 'resueltos' ? { pestana: 'todos' } : {}) })}
              aria-pressed={filtros.soloSinResponder}
              title={filtros.soloSinResponder ? 'Quitar el filtro' : 'Ver solo los que esperan respuesta, del más antiguo al más reciente'}
              className="rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap"
              style={{ backgroundColor: 'var(--bad-soft)', color: 'var(--bad)', border: `1px solid ${filtros.soloSinResponder ? 'var(--bad)' : 'transparent'}` }}
            >
              {sinResponder} sin responder
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>
          <Search size={15} className="shrink-0" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o número"
            aria-label="Buscar chat"
            className="bg-transparent outline-none w-full min-w-0 text-[13.5px]"
            style={{ color: 'var(--fg)' }}
          />
        </label>
        <div className="flex gap-[11px] overflow-x-auto" role="tablist" aria-label="Filtrar chats" style={{ borderBottom: '1px solid var(--line)', scrollbarWidth: 'none' }}>
          {pestanas.map((p) => {
            const activa = pestana === p.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={activa}
                onClick={() => setPestana(p.id)}
                className="whitespace-nowrap py-2 text-[13px]"
                style={{ color: activa ? 'var(--accent)' : 'var(--fg-2)', fontWeight: activa ? 600 : 500, borderBottom: `2px solid ${activa ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}
              >
                {p.etiqueta}
                {p.conteo !== undefined && <span className="ml-1 font-normal" style={{ color: 'var(--fg-3)' }}>{p.conteo}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap px-4 py-2.5">
        <button aria-pressed={filtros.sinLeer} onClick={() => cambiarFiltros({ sinLeer: !filtros.sinLeer })} className="rounded-full px-3 py-[3px] text-[12.5px]" style={estiloChip(filtros.sinLeer)}>Sin leer</button>
        {etiquetasDisponibles.length > 0 && (
          <select
            value={filtros.etiquetaId}
            onChange={(e) => cambiarFiltros({ etiquetaId: e.target.value })}
            aria-label="Filtrar por etiqueta"
            className="rounded-full px-2.5 py-[3px] text-[12.5px] outline-none cursor-pointer"
            style={estiloChip(filtros.etiquetaId !== 'todas')}
          >
            <option value="todas">Etiqueta ▾</option>
            {etiquetasDisponibles.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        {!esVendedor && lineas.length > 1 && (
          <select
            value={filtros.linea}
            onChange={(e) => cambiarFiltros({ linea: e.target.value })}
            aria-label="Filtrar por línea"
            className="rounded-full px-2.5 py-[3px] text-[12.5px] outline-none cursor-pointer"
            style={estiloChip(filtros.linea !== 'todas')}
          >
            <option value="todas">Línea ▾</option>
            {lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        )}
        <button aria-pressed={pestana === 'resueltos'} onClick={() => setPestana(pestana === 'resueltos' ? 'todos' : 'resueltos')} className="rounded-full px-3 py-[3px] text-[12.5px]" style={estiloChip(pestana === 'resueltos')}>Resueltos</button>
        <button aria-pressed={filtros.antiguosPrimero} onClick={() => cambiarFiltros({ antiguosPrimero: !filtros.antiguosPrimero })} className="rounded-full px-3 py-[3px] text-[12.5px] whitespace-nowrap" style={estiloChip(filtros.antiguosPrimero)}>Más antiguos primero</button>
      </div>
    </div>
  );


  const variasLineas = lineas.filter((l) => l.estado === 'activo').length > 1;

  // Lo último del chat, como en WhatsApp: 🎤 audio, 📷 foto, 📄 documento.
  const vistaPrevia = (u: UltimoMensaje | undefined) => {
    if (!u) return { icono: null, texto: 'Sin mensajes todavía' };
    const t = (u.contenido || '').replace(/\s+/g, ' ').trim();
    if (u.tipo === 'audio') return { icono: <Mic size={14} className="shrink-0" />, texto: t.replace(/^\[nota de voz\]\s*/i, '') || 'Audio' };
    if (u.tipo === 'imagen') return { icono: <Camera size={14} className="shrink-0" />, texto: t || 'Foto' };
    if (u.tipo === 'pdf' || u.tipo === 'documento') return { icono: <FileText size={14} className="shrink-0" />, texto: t || 'Documento' };
    return { icono: null, texto: t || 'Mensaje' };
  };

  const filaConversacion = (c: Conversacion) => {
    const activa = seleccionadaId === c.id;
    const ultimo = ultimosMensajes[c.id];
    const espera = minutosEsperando(c, ultimo, ahora);
    const restanteVentana = minutosRestantesVentana(ultimoDelCliente[c.id], ahora);
    const resumen = contactoPorTelefono[c.contacto_telefono];
    const oportunidad = esOportunidad(resumen);
    const etiquetas = etiquetasPorTelefono[c.contacto_telefono] || [];
    const sinLeer = pendientes[c.id] || 0;
    const nombre = nombreConversacion(c);
    const conNombre = tieneNombre(c);
    const iniciales = conNombre ? inicialesDe(nombre) : '';
    const previa = vistaPrevia(ultimo);
    const nuestro = ultimo && ultimo.remitente !== 'cliente';
    const fallo = nuestro && ultimo?.estado_entrega === 'error';

    return (
      <button
        key={c.id}
        onClick={() => onSeleccionar(c)}
        aria-pressed={activa}
        className="relative w-full flex items-center gap-3 text-left"
        style={{ padding: '9px 14px', backgroundColor: activa ? 'var(--accent-soft)' : 'transparent' }}
        onMouseEnter={(e) => { if (!activa) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { if (!activa) e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={conNombre ? `${nombre} · ${formatoTelefono(c.contacto_telefono)}` : nombre}
      >
        <span
          className="shrink-0 rounded-full flex items-center justify-center font-semibold text-[14px]"
          style={{ width: 46, height: 46, backgroundColor: iniciales ? 'var(--accent-soft)' : 'var(--surface-2)', color: iniciales ? 'var(--accent)' : 'var(--fg-3)' }}
        >
          {iniciales || <User size={20} aria-label="Sin nombre" />}
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-[3px] self-stretch justify-center" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 9, marginBottom: -9 }}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[15px]" style={{ color: 'var(--fg)', fontWeight: sinLeer > 0 ? 700 : 500 }}>{nombre}</span>
            {oportunidad && <Flame size={13} className="shrink-0" style={{ color: 'var(--warn)' }} aria-label={resumen?.probabilidad_cierre != null ? `${resumen.probabilidad_cierre}% de cierre` : 'Caliente'} />}
            {etiquetas.slice(0, 3).map((e) => (
              <i key={e.id} title={e.nombre} className="shrink-0 rounded-full" style={{ width: 8, height: 8, backgroundColor: colorEtiquetaWhatsapp(e.color) }} />
            ))}
            {pestana === 'por_vencer' && restanteVentana !== null ? (
              <span className="ml-auto shrink-0 text-[12px] font-semibold whitespace-nowrap" style={{ color: restanteVentana <= 60 ? 'var(--bad)' : 'var(--warn)' }}>Quedan {textoEspera(restanteVentana)}</span>
            ) : (
              <span className="ml-auto shrink-0 text-[12px] whitespace-nowrap" style={{ color: sinLeer > 0 ? 'var(--accent)' : 'var(--fg-3)', fontWeight: sinLeer > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>{formatoFechaLista(ultimo?.creado_en || c.ultima_actividad)}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-[13.5px]" style={{ color: 'var(--fg-2)' }}>
            {fallo ? <AlertCircle size={15} className="shrink-0" style={{ color: 'var(--bad)' }} aria-label="No se entregó" /> : nuestro && <CheckCheck size={15} className="shrink-0" style={{ color: 'var(--accent)' }} aria-label="Enviado" />}
            {previa.icono}
            <span className="truncate flex-1" style={{ color: ultimo ? undefined : 'var(--fg-3)', fontStyle: ultimo ? undefined : 'italic' }}>{previa.texto}</span>
            {variasLineas && (
              <span className="shrink-0 rounded px-1.5 text-[11px] truncate max-w-[92px]" style={{ backgroundColor: CHIP_LINEA.bg, color: CHIP_LINEA.color }}>{nombreLinea(c.linea_id)}</span>
            )}
            {espera !== null && espera > 5 && sinLeer === 0 && (
              <span className="shrink-0 text-[11.5px] font-semibold whitespace-nowrap" style={{ color: 'var(--bad)' }}>{textoEspera(espera)}</span>
            )}
            {sinLeer > 0 && (
              <span className="shrink-0 rounded-full text-[11.5px] font-bold flex items-center justify-center" style={{ minWidth: 20, height: 20, padding: '0 6px', backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }} aria-label={`${sinLeer} sin leer`}>{sinLeer > 98 ? '99+' : sinLeer}</span>
            )}
          </div>
        </div>
      </button>
    );
  };

  const vacio: Record<Pestana, string> = {
    todos: 'Todavía no hay chats.',
    mios: 'No tienes chats asignados. Toma uno desde "Sin asignar".',
    sin_asignar: 'No hay chats sin asignar. Buen trabajo.',
    por_vencer: 'Ningún chat está por perder la ventana de 24 h de WhatsApp.',
    resueltos: 'Todavía no hay chats resueltos.',
  };
  const hayFiltros = !!consulta.busqueda || filtros.sinLeer || filtros.soloSinResponder || filtros.etiquetaId !== 'todas';

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 ${compacta ? 'shrink-0' : 'h-full w-full'}`}
      style={compacta ? { width: 380, borderRight: '1px solid var(--line)', backgroundColor: 'color-mix(in srgb, var(--surface) 60%, transparent)' } : undefined}
    >
      {encabezado}
      {aviso && <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'var(--warn-soft)', color: 'var(--warn)' }}>{aviso}</div>}
      <div ref={contenedor} onScroll={alDesplazar} className="flex-1 overflow-y-auto min-h-0">
        {cargando && lista.length === 0 && <div className="text-center text-[13px] py-10 px-6" style={{ color: 'var(--fg-3)' }}>Cargando chats…</div>}
        {!cargando && lista.length === 0 && <div className="text-center text-[13px] py-10 px-6" style={{ color: 'var(--fg-3)' }}>{hayFiltros ? 'Ningún chat coincide con la búsqueda o los filtros.' : vacio[pestana]}</div>}
        {lista.map((c) => filaConversacion(c))}
        {hayMas && (
          <div className="py-4 flex justify-center">
            <button onClick={onCargarMas} disabled={cargandoMas} className="rounded-full px-4 py-1.5 text-[12.5px]" style={{ border: '1px solid var(--line)', color: 'var(--fg-2)', backgroundColor: 'var(--surface)' }}>
              {cargandoMas ? 'Cargando…' : 'Ver más chats'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
