import { useEffect, useState } from 'react';
import { LogOut, MessageSquare, Moon, MoreHorizontal, Search, Sun, X } from 'lucide-react';
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { BORDE, FONDO_CARD, FONDO_CONTENIDO, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorAvatar } from '../../lib/tema';
import { alternarTema, temaActual } from '../../lib/temaClaroOscuro';
import { inicializarSonidoNotificacion, reproducirSonidoNotificacion } from '../../lib/sonidoNotificacion';
import { IDS_NAV_MOBILE, SECCIONES } from './constantes';

import { useConversaciones } from './hooks/useConversaciones';
import { useMensajes } from './hooks/useMensajes';
import { useEtapasVenta } from './hooks/useEtapasVenta';
import ListaConversaciones, { activarFiltroSinResponder, minutosEsperando } from './ListaConversaciones';
import MenuLateral from './MenuLateral';
import PaletaComandos from './PaletaComandos';
import HiloMensajes from './HiloMensajes';
import PanelContacto from './PanelContacto';
import LogoEmpresa from '../../components/LogoEmpresa';
import Contactos from '../contactos/Contactos';
import RespuestasRapidas from '../respuestas-rapidas/RespuestasRapidas';
import RespuestasAutomaticas from '../respuestas-automaticas/RespuestasAutomaticas';
import Agenda from '../agenda/Agenda';
import Conexiones from '../conexiones/Conexiones';
import Dashboard from '../dashboard/Dashboard';
import Reportes from '../reportes/Reportes';
import Pipeline from '../pipeline/Pipeline';
import Hoy from '../hoy/Hoy';
import UsuariosSiguelo from '../usuarios/UsuariosSiguelo';
import MiEmpresa from '../mi-empresa/MiEmpresa';
import Configuracion from '../configuracion/Configuracion';
import Programados from '../programados/Programados';
import Seguimiento from '../seguimiento/Seguimiento';
import Negocios from '../negocios/Negocios';
import IA from '../ia/IA';
import Inscripciones from '../inscripciones/Inscripciones';
import { soloDelNegocio, useNegocios } from '../negocios/useNegocios';
import Oportunidades from '../oportunidades/Oportunidades';
import { EstadoVacio, useToast } from '../../components/ui';
import type { Conversacion, Mensaje, RespuestaAutomatica, RespuestaRapida } from '../../lib/tipos';

// true cuando la pantalla es angosta (celular). Se renderiza UN solo layout
// en vez de montar ambos y ocultar uno con CSS (antes se duplicaban el
// compositor y las suscripciones del hilo).
function useMediaQuery(consulta: string): boolean {
  const [coincide, setCoincide] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const alCambiar = () => setCoincide(mq.matches);
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [consulta]);
  return coincide;
}

const useEsMovil = () => useMediaQuery('(max-width: 767px)');

function leerPlegado(): boolean {
  try { return localStorage.getItem('sidebar-plegado') === '1'; } catch { return false; }
}

export default function Bandeja() {
  const { usuario, empresa, cerrarSesion } = useAuth();
  const toast = useToast();
  const esMovil = useEsMovil();
  // Por debajo de 1280 px el menú es siempre un riel de íconos.
  const anchoReducido = useMediaQuery('(max-width: 1279px)');
  const [plegado, setPlegado] = useState(leerPlegado);
  const [mostrarMas, setMostrarMas] = useState(false);
  const [agentes, setAgentes] = useState<Record<string, string>>({});
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const [temaClaro, setTemaClaro] = useState(() => temaActual() === 'claro');
  const [seccion, setSeccion] = useState('chats');
  const [seleccionada, setSeleccionada] = useState<Conversacion | null>(null);
  const [mostrarPanelContacto, setMostrarPanelContacto] = useState(false);
  const [respuestasRapidas, setRespuestasRapidas] = useState<RespuestaRapida[]>([]);
  const [respuestasAutomaticas, setRespuestasAutomaticas] = useState<RespuestaAutomatica[]>([]);

  const conv = useConversaciones(usuario);
  const { mensajes, agregarMensaje, actualizarMensaje } = useMensajes(seleccionada?.id ?? null);
  const etapasVenta = useEtapasVenta(usuario?.empresa_id);
  // Negocios por número (SígueloCRM): en cada chat, solo las respuestas y reglas del negocio de ese número.
  const negocios = useNegocios(usuario?.empresa_id);
  const negocioDelChat = seleccionada ? negocios.negocioDeLinea[seleccionada.linea_id] : undefined;

  useEffect(() => {
    inicializarSonidoNotificacion();
  }, []);

  // Nombres de los agentes, para mostrar a quién está asignado cada chat.
  useEffect(() => {
    supabase.from('usuarios').select('id, nombre').then(({ data }) => {
      const mapa: Record<string, string> = {};
      (data || []).forEach((u: { id: string; nombre: string }) => { mapa[u.id] = u.nombre.split(' ')[0]; });
      setAgentes(mapa);
    });
  }, [usuario?.id]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletaAbierta((v) => !v);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // ---------- Carga inicial ----------
  useEffect(() => {
    if (!usuario) return;
    const cargarRespuestasRapidas = async () => {
      const { data } = await supabase.from('respuestas_rapidas').select('*').order('titulo').returns<RespuestaRapida[]>();
      setRespuestasRapidas(data || []);
    };
    cargarRespuestasRapidas();
    const cargarRespuestasAutomaticas = async () => {
      const { data } = await supabase
        .from('respuestas_automaticas')
        .select('*')
        .eq('activo', true)
        .order('palabra_clave')
        .returns<RespuestaAutomatica[]>();
      setRespuestasAutomaticas(data || []);
    };
    cargarRespuestasAutomaticas();
  }, [usuario?.id]);

  // ---------- Tiempo real ----------
  useEffect(() => {
    if (!usuario) return;
    const canal = supabase
      .channel(`conversaciones-y-mensajes-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones' }, () => conv.recargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'respuestas_rapidas' }, async () => {
        const { data } = await supabase.from('respuestas_rapidas').select('*').order('titulo').returns<RespuestaRapida[]>();
        setRespuestasRapidas(data || []);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, (payload: RealtimePostgresInsertPayload<Mensaje>) => {
        conv.recargar();
        if (payload.new.remitente === 'cliente') reproducirSonidoNotificacion();
        if (seleccionada && payload.new.conversacion_id === seleccionada.id) {
          agregarMensaje(payload.new);
        }
      })
      // WhatsApp puede rechazar la entrega después de que ya se insertó el
      // mensaje como "enviado" — esto trae ese cambio de estado en vivo.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes' }, (payload: RealtimePostgresUpdatePayload<Mensaje>) => {
        if (seleccionada && payload.new.conversacion_id === seleccionada.id) {
          actualizarMensaje(payload.new);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, seleccionada?.id]);

  useEffect(() => {
    setMostrarPanelContacto(false);
  }, [seleccionada?.id]);

  // Salta desde el embudo (u otra sección) directo al chat de WhatsApp de
  // ese contacto, si ya existe una conversación para él.
  const abrirChatDeContacto = (telefono: string) => {
    const tel = telefono.split('@')[0];
    const conversacion = conv.conversaciones.find((c) => c.contacto_telefono.split('@')[0] === tel);
    if (!conversacion) {
      toast('Este contacto todavía no tiene una conversación de WhatsApp.', 'info');
      return;
    }
    setSeleccionada(conversacion);
    setSeccion('chats');
  };

  // Mantiene "seleccionada" al día con los cambios que llegan por tiempo real
  // (estado, asignación, etc.), porque es un objeto aparte del array de la lista.
  useEffect(() => {
    if (!seleccionada) return;
    const actualizada = conv.conversaciones.find((c) => c.id === seleccionada.id);
    if (actualizada && actualizada !== seleccionada) setSeleccionada(actualizada);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.conversaciones]);

  if (!usuario) return null;

  const esVendedor = usuario.rol === 'vendedor';
  const esAdmin = usuario.rol === 'supervisor' || usuario.rol === 'dueno';
  const esDueno = usuario.rol === 'dueno';
  const seccionesVisibles = SECCIONES.filter(
    (s) => (!s.soloAdmin || esAdmin) && (!s.soloDueno || esDueno),
  );
  const seccionActual = SECCIONES.find((s) => s.id === seccion) || SECCIONES[0];
  const gruposVisibles = Array.from(new Set(seccionesVisibles.map((s) => s.grupo))).map(
    (grupo) => [grupo, seccionesVisibles.filter((s) => s.grupo === grupo)] as const,
  );

  const contenidoOtraSeccion = () => {
    if (seccion === 'usuarios') return <UsuariosSiguelo />;
    if (seccion === 'contactos') return <Contactos onAbrirChat={abrirChatDeContacto} />;
    if (seccion === 'pipeline') return <Pipeline onAbrirChat={abrirChatDeContacto} />;
    if (seccion === 'respuestas') return <RespuestasRapidas />;
    if (seccion === 'bot') return <RespuestasAutomaticas />;
    if (seccion === 'agenda') return <Agenda />;
    if (seccion === 'conexiones') return <Conexiones />;
    if (seccion === 'dashboard') return <Dashboard />;
    if (seccion === 'reportes') return <Reportes />;
    if (seccion === 'hoy') return <Hoy conversaciones={conv.conversaciones} ultimosMensajes={conv.ultimosMensajes} onResponderAhora={() => { activarFiltroSinResponder(usuario.id); irA('chats'); }} onAbrirConversacion={abrirConversacion} onAbrirChat={abrirChatDeContacto} />;
    if (seccion === 'mi-empresa') return <MiEmpresa />;
    if (seccion === 'configuracion') return <Configuracion />;
    if (seccion === 'programados') return <Programados />;
    if (seccion === 'seguimiento') return <Seguimiento />;
    if (seccion === 'negocios') return <Negocios />;
    if (seccion === 'ia') return <IA onAbrirChat={abrirChatDeContacto} />;
    if (seccion === 'inscripciones') return <Inscripciones onAbrirChat={abrirChatDeContacto} />;
    if (seccion === 'oportunidades') return <Oportunidades onAbrirChat={abrirChatDeContacto} />;
    return <EstadoVacio icono={seccionActual.icon} titulo={seccionActual.label} texto="Esta sección todavía no está construida." />;
  };
  const alternarPlegado = () => {
    const nuevo = !plegado;
    setPlegado(nuevo);
    try { localStorage.setItem('sidebar-plegado', nuevo ? '1' : '0'); } catch { /* sin storage: no se recuerda */ }
  };

  const irA = (id: string) => {
    setSeccion(id);
    setMostrarMas(false);
  };

  const cambiarTema = () => setTemaClaro(alternarTema() === 'claro');

  // Chats abiertos esperando respuesta: globo rojo en "Bandeja".
  const ahora = Date.now();
  const esperando = conv.conversaciones.filter((c) => minutosEsperando(c, conv.ultimosMensajes[c.id], ahora) !== null).length;
  const insignias: Record<string, number> = { chats: esperando };
  const lineasActivas = conv.lineas.filter((l) => l.estado === 'activo').length;

  const abrirConversacion = (c: Conversacion) => {
    setSeleccionada(c);
    setSeccion('chats');
  };

  const barraSuperior = (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 shrink-0" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <LogoEmpresa logoUrl={empresa?.logo_url} nombre={empresa?.nombre} size={32} />
        <div className="min-w-0">
          <div className="disp font-bold text-[15px] leading-tight truncate" style={{ color: 'var(--fg)' }}>{seccionActual.label}</div>
          <div className="text-[11px] leading-tight truncate" style={{ color: 'var(--fg-3)' }}>{empresa?.nombre || 'Mi CRM'} · {usuario.nombre}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setPaletaAbierta(true)} aria-label="Buscar" className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', color: 'var(--fg-2)' }}>
          <Search size={16} />
        </button>
        <button onClick={cambiarTema} aria-label="Cambiar tema" className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ border: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', color: 'var(--fg-2)' }}>
          {temaClaro ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </div>
  );

  const barraSuperiorEscritorio = (
    <header className="flex items-center gap-3.5 px-7 py-3 shrink-0" style={{ borderBottom: '1px solid var(--line)', backdropFilter: 'blur(8px)' }}>
      <span className="disp font-bold text-[18px] shrink-0" style={{ color: 'var(--fg)' }}>{seccionActual.label}</span>
      <button
        onClick={() => setPaletaAbierta(true)}
        className="flex-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-left min-w-0"
        style={{ maxWidth: 460, backgroundColor: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}
      >
        <Search size={16} className="shrink-0" />
        <span className="truncate text-[14px]">Buscar o ir a…</span>
        <kbd className="num ml-auto text-[11px] rounded-md px-1.5 shrink-0" style={{ border: '1px solid var(--line-2)', color: 'var(--fg-2)' }}>Ctrl K</kbd>
      </button>
      <div className="flex items-center gap-2 ml-auto text-[13px]" style={{ color: 'var(--fg-2)' }} title={conv.lineas.map((l) => `${l.nombre}: ${l.estado}`).join('\n')}>
        <span className={`w-[9px] h-[9px] rounded-full ${lineasActivas > 0 ? 'pulso' : ''}`} style={{ backgroundColor: lineasActivas > 0 ? 'var(--ok)' : 'var(--bad)' }} />
        <span>{lineasActivas} de {conv.lineas.length} {conv.lineas.length === 1 ? 'línea conectada' : 'líneas conectadas'}</span>
      </div>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0 disp" style={{ backgroundColor: colorAvatar(usuario.id) }} title={usuario.nombre}>
        {usuario.nombre.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
      </div>
    </header>
  );

  const seccionesFijasMovil = IDS_NAV_MOBILE.map((id) => seccionesVisibles.find((s) => s.id === id)).filter((s) => !!s);
  const masActiva = !IDS_NAV_MOBILE.includes(seccion);

  const navInferiorMobile = (
    <nav className="flex items-center justify-around py-1.5 shrink-0" style={{ backgroundColor: 'var(--surface)', borderTop: `1px solid ${BORDE}` }}>
      {seccionesFijasMovil.map((s) => {
        const Icono = s.icon;
        const activa = seccion === s.id;
        const insignia = insignias[s.id] || 0;
        return (
          <button key={s.id} onClick={() => irA(s.id)} aria-current={activa ? 'page' : undefined} className="relative flex flex-col items-center gap-0.5 px-3 py-1 min-w-[64px] rounded-xl" style={{ color: activa ? 'var(--accent)' : TEXTO_TERCIARIO, backgroundColor: activa ? 'var(--accent-soft)' : 'transparent' }}>
            <Icono size={20} />
            <span className="text-[11px] font-semibold">{s.label}</span>
            {insignia > 0 && <span className="num absolute top-0 right-2 rounded-full text-white text-[10px] font-bold px-1 min-w-4 text-center leading-4" style={{ backgroundColor: 'var(--bad)' }}>{insignia > 99 ? '99+' : insignia}</span>}
          </button>
        );
      })}
      <button onClick={() => setMostrarMas(true)} className="flex flex-col items-center gap-0.5 px-3 py-1 min-w-[64px] rounded-xl" style={{ color: masActiva ? 'var(--accent)' : TEXTO_TERCIARIO, backgroundColor: masActiva ? 'var(--accent-soft)' : 'transparent' }}>
        <MoreHorizontal size={20} />
        <span className="text-[11px] font-semibold">Más</span>
      </button>
    </nav>
  );

  const hojaMas = mostrarMas && (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" style={{ backgroundColor: 'rgba(2,8,20,.6)' }} onClick={() => setMostrarMas(false)}>
      <div className="aparecer rounded-t-2xl px-4 pt-3 pb-6 max-h-[80dvh] overflow-y-auto" style={{ backgroundColor: FONDO_CARD, borderTop: '1px solid var(--line-2)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Todas las secciones">
        <div className="flex items-center justify-between pb-2">
          <span className="disp text-[16px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Todas las secciones</span>
          <button onClick={() => setMostrarMas(false)} aria-label="Cerrar"><X size={18} color={TEXTO_SECUNDARIO} /></button>
        </div>
        {gruposVisibles.map(([grupo, items]) => (
          <div key={grupo} className="pt-2">
            <div className="eyebrow pb-1.5">{grupo}</div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((s) => {
                const Icono = s.icon;
                const activa = seccion === s.id;
                return (
                  <button key={s.id} onClick={() => irA(s.id)} className="flex flex-col items-center gap-1 rounded-xl px-1 py-3 text-center" style={{ backgroundColor: activa ? 'var(--accent-soft)' : 'var(--surface-2)', color: activa ? 'var(--accent)' : TEXTO_PRIMARIO, border: `1px solid ${activa ? 'var(--accent)' : 'var(--line)'}` }}>
                    <Icono size={20} />
                    <span className="text-[11.5px] font-semibold leading-tight">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button onClick={cerrarSesion} className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>
          <LogOut size={14} />Cerrar sesión
        </button>
      </div>
    </div>
  );

  const paleta = (
    <PaletaComandos
      abierta={paletaAbierta}
      onCerrar={() => setPaletaAbierta(false)}
      secciones={seccionesVisibles}
      conversaciones={conv.conversaciones}
      temaClaro={temaClaro}
      onIrSeccion={irA}
      onAbrirConversacion={abrirConversacion}
      onTema={cambiarTema}
      onCerrarSesion={cerrarSesion}
    />
  );

  const sidebarEscritorio = (
    <MenuLateral
      grupos={gruposVisibles as unknown as (readonly [string, typeof seccionesVisibles])[]}
      seccion={seccion}
      onIr={irA}
      plegado={plegado || anchoReducido}
      plegadoForzado={anchoReducido}
      onPlegar={alternarPlegado}
      empresa={empresa}
      usuario={usuario}
      onCerrarSesion={cerrarSesion}
      insignias={insignias}
      temaClaro={temaClaro}
      onTema={cambiarTema}
    />
  );

  const lista = (
    <ListaConversaciones
      conversaciones={conv.conversaciones}
      ultimosMensajes={conv.ultimosMensajes}
      lineas={conv.lineas}
      etiquetasPorTelefono={conv.etiquetasPorTelefono}
      contactoPorTelefono={conv.contactoPorTelefono}
      pendientes={conv.pendientes}
      ultimoDelCliente={conv.ultimoDelCliente}
      esVendedor={esVendedor}
      miId={usuario.id}
      seleccionadaId={esMovil ? null : seleccionada?.id ?? null}
      onSeleccionar={setSeleccionada}
      colorLinea={conv.colorLinea}
      nombreLinea={conv.nombreLinea}
      compacta={!esMovil}
    />
  );

  const hilo = seleccionada && (
    <HiloMensajes
      seleccionada={seleccionada}
      usuario={usuario}
      mensajes={mensajes}
      respuestasRapidas={soloDelNegocio(respuestasRapidas, negocios.respuestasDeNegocio, negocioDelChat)}
      respuestasAutomaticas={soloDelNegocio(respuestasAutomaticas, negocios.reglasDeNegocio, negocioDelChat)}
      etapasVenta={etapasVenta}
      nombreLinea={conv.lineas.length > 1 ? conv.nombreLinea(seleccionada.linea_id) : ''}
      nombreAsignado={seleccionada.agente_asignado_id ? agentes[seleccionada.agente_asignado_id] : undefined}
      mostrarPanelContacto={mostrarPanelContacto}
      onTogglePanelContacto={() => setMostrarPanelContacto(!mostrarPanelContacto)}
      onCambiarEstado={(estado) => conv.cambiarEstado(seleccionada, estado)}
      onResolver={() => conv.resolver(seleccionada)}
      onReclamar={() => conv.reclamar(seleccionada)}
      onLiberar={() => conv.liberar(seleccionada)}
      agentes={Object.entries(agentes).map(([id, nombre]) => ({ id, nombre }))}
      onTransferir={(agenteId) => conv.transferir(seleccionada, agenteId)}
      onVolver={esMovil ? () => setSeleccionada(null) : undefined}
    />
  );

  const panelContacto = seleccionada && mostrarPanelContacto && (
    <PanelContacto telefono={seleccionada.contacto_telefono} lineaId={seleccionada.linea_id} asignadoA={seleccionada.agente_asignado_id ? (seleccionada.agente_asignado_id === usuario.id ? 'Ti' : agentes[seleccionada.agente_asignado_id]) : undefined} onClose={() => setMostrarPanelContacto(false)} />
  );

  if (esMovil) {
    return (
      <div className="w-full flex flex-col" style={{ height: '100%', minHeight: '480px', background: FONDO_CONTENIDO }}>
        {barraSuperior}
        <div className="flex-1 min-h-0 flex min-w-0">
          {seccion !== 'chats' ? contenidoOtraSeccion() : !seleccionada ? lista : mostrarPanelContacto ? panelContacto : hilo}
        </div>
        {!(seccion === 'chats' && seleccionada) && navInferiorMobile}
        {hojaMas}
        {paleta}
      </div>
    );
  }

  return (
    <div className="w-full flex" style={{ height: '100%', minHeight: '480px', background: FONDO_CONTENIDO }}>
      {sidebarEscritorio}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {barraSuperiorEscritorio}
        <div className="flex-1 min-h-0 flex min-w-0 relative">
          {seccion !== 'chats' ? (
            contenidoOtraSeccion()
          ) : (
            <>
              {lista}
              {!seleccionada ? (
                <EstadoVacio icono={MessageSquare} titulo="Elige una conversación" texto="Selecciona un chat de la lista para ver los mensajes y responder." />
              ) : (
                hilo
              )}
              {panelContacto}
            </>
          )}
        </div>
      </div>
      {paleta}
    </div>
  );
}
