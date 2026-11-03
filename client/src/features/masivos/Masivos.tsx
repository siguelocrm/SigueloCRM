import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Megaphone, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EncabezadoPagina, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from '../seguimiento/Etiqueta';
import NuevoMasivo from './NuevoMasivo';

// Mensajes masivos (SígueloCRM): la lista de envíos con su avance. Los manda el
// servidor de a uno, con pausas y dentro del horario (server/src/siguelo/masivos).

type Estado = 'programado' | 'enviando' | 'pausado' | 'terminado' | 'cancelado';
type Masivo = {
  id: string;
  nombre: string;
  linea_id: string;
  textos: string[];
  media_tipo: 'imagen' | 'pdf' | null;
  media_nombre: string | null;
  estado: Estado;
  inicia_en: string;
  hora_inicio: string;
  hora_fin: string;
  maximo_diario: number;
  total: number;
  enviados: number;
  errores: number;
  motivo: string | null;
  creado_en: string;
  terminado_en: string | null;
};
type Envio = { id: string; telefono: string; nombre: string | null; estado: string; motivo: string | null; enviado_en: string | null };

const ESTADO: Record<Estado, { texto: string; color: string }> = {
  programado: { texto: 'Programado', color: 'var(--accent)' },
  enviando: { texto: 'Enviando', color: 'var(--ok)' },
  pausado: { texto: 'En pausa', color: 'var(--warn)' },
  terminado: { texto: 'Terminado', color: 'var(--fg-3)' },
  cancelado: { texto: 'Cancelado', color: 'var(--bad)' },
};
const ESTADO_ENVIO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: 'En fila', color: 'var(--fg-3)' },
  enviando: { texto: 'Enviando', color: 'var(--accent)' },
  enviado: { texto: 'Enviado', color: 'var(--ok)' },
  error: { texto: 'No salió', color: 'var(--bad)' },
  cancelado: { texto: 'Cancelado', color: 'var(--fg-3)' },
};

const hora = (iso: string) => new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// Por qué está esperando (el servidor deja un código en "motivo").
function explicar(m: Masivo): string | null {
  if (m.estado === 'programado' && new Date(m.inicia_en).getTime() > Date.now()) return `Empieza el ${hora(m.inicia_en)}.`;
  if (m.motivo === 'fuera') return `Esperando el horario (${m.hora_inicio} a ${m.hora_fin}).`;
  if (m.motivo === 'tope') return `Llegó al máximo de hoy (${m.maximo_diario} desde este número): sigue mañana.`;
  if (m.motivo === 'desconectado') return 'El número está desconectado: sigue cuando lo conectes en Conexiones.';
  return m.motivo;
}

function Detalle({ masivo }: { masivo: Masivo }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'error'>('todos');
  useEffect(() => {
    let q = supabase.from('siguelo_masivo_envios').select('id, telefono, nombre, estado, motivo, enviado_en').eq('masivo_id', masivo.id);
    if (filtro === 'error') q = q.eq('estado', 'error');
    q.order('orden').limit(300).returns<Envio[]>().then(({ data }) => setEnvios(data || []));
  }, [masivo.id, masivo.enviados, masivo.errores, filtro]);
  return (
    <div className="flex flex-col gap-2 pt-2" style={{ borderTop: `1px solid ${BORDE}` }}>
      <div className="flex flex-col gap-1">
        {masivo.textos.map((t, i) => (
          <div key={i} className="rounded-lg px-2.5 py-1.5 text-[12.5px] whitespace-pre-wrap" style={{ backgroundColor: 'var(--surface-2)', color: TEXTO_SECUNDARIO }}>
            {masivo.textos.length > 1 && <b>Versión {i + 1}: </b>}{t}
          </div>
        ))}
        {masivo.media_nombre && <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Con {masivo.media_tipo === 'pdf' ? 'el PDF' : 'la imagen'} {masivo.media_nombre}</span>}
      </div>
      {masivo.errores > 0 && (
        <div className="flex gap-1.5">
          <button onClick={() => setFiltro('todos')} className="text-[12px] font-semibold" style={{ color: filtro === 'todos' ? 'var(--accent)' : TEXTO_TERCIARIO }}>Todos</button>
          <span style={{ color: TEXTO_TERCIARIO }}>·</span>
          <button onClick={() => setFiltro('error')} className="text-[12px] font-semibold" style={{ color: filtro === 'error' ? 'var(--accent)' : TEXTO_TERCIARIO }}>Solo los que no salieron ({masivo.errores})</button>
        </div>
      )}
      {!envios ? (
        <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Cargando…</span>
      ) : (
        <div className="flex flex-col max-h-80 overflow-y-auto">
          {envios.map((e) => {
            const est = ESTADO_ENVIO[e.estado] ?? ESTADO_ENVIO.pendiente;
            return (
              <div key={e.id} className="flex items-center gap-2 py-1.5 text-[12.5px]" style={{ borderBottom: `1px solid ${BORDE}` }}>
                <span className="flex-1 min-w-0 truncate" style={{ color: TEXTO_PRIMARIO }}>
                  {e.nombre || `+${e.telefono}`}
                  {e.nombre && <span style={{ color: TEXTO_TERCIARIO }}> · +{e.telefono}</span>}
                  {e.motivo && <span style={{ color: 'var(--bad)' }}> · {e.motivo}</span>}
                </span>
                {e.enviado_en && <span className="text-[11.5px] shrink-0" style={{ color: TEXTO_TERCIARIO }}>{hora(e.enviado_en)}</span>}
                <Etiqueta color={est.color}>{est.texto}</Etiqueta>
              </div>
            );
          })}
          {envios.length === 300 && <span className="text-[11.5px] pt-1" style={{ color: TEXTO_TERCIARIO }}>Se muestran los primeros 300.</span>}
        </div>
      )}
    </div>
  );
}

export default function Masivos() {
  const toast = useToast();
  const [masivos, setMasivos] = useState<Masivo[] | null>(null);
  const [lineas, setLineas] = useState<Record<string, string>>({});
  const [faltaSql, setFaltaSql] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('siguelo_masivos').select('*').order('creado_en', { ascending: false }).limit(100).returns<Masivo[]>();
    setFaltaSql(!!error);
    setMasivos(data || []);
  }, []);

  useEffect(() => {
    cargar();
    supabase.from('lineas_whatsapp').select('id, nombre').returns<{ id: string; nombre: string }[]>().then(({ data }) => setLineas(Object.fromEntries((data || []).map((l) => [l.id, l.nombre]))));
  }, [cargar]);

  // Mientras haya alguno en marcha, se actualiza solo cada 10 segundos.
  const enMarcha = (masivos || []).some((m) => m.estado === 'programado' || m.estado === 'enviando');
  useEffect(() => {
    if (!enMarcha || nuevo) return;
    const t = setInterval(cargar, 10_000);
    return () => clearInterval(t);
  }, [enMarcha, nuevo, cargar]);

  const accion = async (m: Masivo, accion: 'pausar' | 'reanudar' | 'cancelar' | 'eliminar') => {
    if (accion === 'cancelar' && !window.confirm(`¿Cancelar "${m.nombre}"? Los que faltan ya no recibirán el mensaje.`)) return;
    if (accion === 'eliminar' && !window.confirm(`¿Borrar "${m.nombre}" de la lista? Los mensajes que ya salieron siguen en sus chats.`)) return;
    setOcupado(m.id);
    const r = await llamarBackend(`/siguelo/masivos/${m.id}/accion`, { accion });
    setOcupado(null);
    if (!r.ok) return toast(r.error || 'No se pudo.', 'error');
    cargar();
  };

  if (nuevo) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
        <NuevoMasivo onCerrar={() => setNuevo(false)} onCreado={() => { setNuevo(false); cargar(); }} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina
        titulo="Mensajes masivos"
        subtitulo="Un mensaje a muchos contactos a la vez. Sale de a uno, con pausas y dentro del horario, para cuidar tu número."
        accion={<Boton variante="primario" icono={Plus} onClick={() => setNuevo(true)} disabled={faltaSql}>Nuevo envío</Boton>}
      />
      {faltaSql && (
        <Tarjeta className="p-4 text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
          Falta la última versión de la base de datos: en tu Supabase → <b>SQL Editor</b>, pega todo <b>database/siguelo.sql</b> y pulsa <b>Run</b>.
        </Tarjeta>
      )}
      {masivos && !masivos.length && !faltaSql && (
        <Tarjeta className="flex">
          <EstadoVacio icono={Megaphone} titulo="Todavía no hiciste envíos masivos" texto="Crea uno para avisar una promoción, un curso nuevo o un cambio de horario a tus contactos." accion={<Boton variante="primario" icono={Plus} onClick={() => setNuevo(true)}>Nuevo envío</Boton>} />
        </Tarjeta>
      )}
      <div className="flex flex-col gap-3">
        {(masivos || []).map((m) => {
          const est = ESTADO[m.estado];
          const hechos = m.enviados + m.errores;
          const pct = m.total ? Math.round((hechos / m.total) * 100) : 0;
          const nota = ['programado', 'enviando', 'pausado'].includes(m.estado) ? explicar(m) : null;
          return (
            <Tarjeta key={m.id} className="p-4 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
                    {m.nombre} <Etiqueta color={est.color}>{est.texto}</Etiqueta>
                  </span>
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
                    Desde {lineas[m.linea_id] || 'un número'} · creado el {hora(m.creado_en)}
                    {m.terminado_en && ` · ${m.estado === 'cancelado' ? 'cancelado' : 'terminó'} el ${hora(m.terminado_en)}`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(m.estado === 'programado' || m.estado === 'enviando') && <Boton tamano="sm" icono={Pause} disabled={ocupado === m.id} onClick={() => accion(m, 'pausar')}>Pausar</Boton>}
                  {m.estado === 'pausado' && <Boton tamano="sm" variante="primario" icono={Play} disabled={ocupado === m.id} onClick={() => accion(m, 'reanudar')}>Reanudar</Boton>}
                  {!['terminado', 'cancelado'].includes(m.estado) && <Boton tamano="sm" variante="peligro" icono={Square} disabled={ocupado === m.id} onClick={() => accion(m, 'cancelar')}>Cancelar</Boton>}
                  {['terminado', 'cancelado', 'pausado'].includes(m.estado) && <Boton tamano="sm" variante="fantasma" icono={Trash2} disabled={ocupado === m.id} onClick={() => accion(m, 'eliminar')} aria-label="Borrar de la lista" />}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="rounded-full overflow-hidden" style={{ height: 8, backgroundColor: 'var(--surface-2)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full flex">
                    <i className="block h-full" style={{ width: `${m.total ? (m.enviados / m.total) * 100 : 0}%`, backgroundColor: 'var(--ok)' }} />
                    <i className="block h-full" style={{ width: `${m.total ? (m.errores / m.total) * 100 : 0}%`, backgroundColor: 'var(--bad)' }} />
                  </div>
                </div>
                <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                  <b style={{ color: TEXTO_PRIMARIO }}>{m.enviados}</b> de {m.total} enviados
                  {m.errores > 0 && <> · <span style={{ color: 'var(--bad)' }}>{m.errores} no salieron</span></>}
                  {m.total - hechos > 0 && m.estado !== 'cancelado' && <> · faltan {m.total - hechos}</>}
                </span>
                {nota && <span className="text-[12.5px]" style={{ color: m.estado === 'pausado' ? 'var(--warn)' : TEXTO_TERCIARIO }}>{nota}</span>}
              </div>
              <button className="self-start flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }} onClick={() => setAbierto(abierto === m.id ? null : m.id)}>
                {abierto === m.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {abierto === m.id ? 'Ocultar detalle' : 'Ver mensaje y a quiénes'}
              </button>
              {abierto === m.id && <Detalle masivo={m} />}
            </Tarjeta>
          );
        })}
      </div>
    </div>
  );
}
