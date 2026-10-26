import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Send, ListOrdered, History } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { AMBER, BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from './Etiqueta';
import type { AjustesSeguimiento, ItemCola, RegistroSeguimiento } from './tipos';
import { MIN, ajustar, enFranja, fechaDe, inicioDeManana, type Franja } from './horario';

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

const ESTADO: Record<string, { texto: string; color: string }> = {
  pendiente: { texto: 'Pendiente', color: AMBER },
  enviando: { texto: 'Enviando', color: 'var(--accent)' },
  enviado: { texto: 'Enviado', color: 'var(--ok)' },
  cancelado: { texto: 'Cancelado', color: TEXTO_TERCIARIO },
  error: { texto: 'Error', color: 'var(--bad)' },
};

// Hora estimada de cada pendiente: simula la cola con la pausa media, el
// horario, el tope diario y el mínimo entre mensajes a la misma persona. Cada
// número de WhatsApp lleva su propio reloj y su propio tope, como en el servidor.
function planificar(items: ItemCola[], aj: AjustesSeguimiento, usadosHoy: Record<string, number>, ultimoAuto: Record<string, number>, pausados: Set<string>) {
  const franja: Franja = { zona: aj.zona_horaria, desde: aj.hora_inicio, hasta: aj.hora_fin };
  const minMisma = aj.min_entre_misma_persona_min * MIN;
  const pausaMedia = ((aj.pausa_min_seg + aj.pausa_max_seg) / 2) * 1000;
  const relojes: Record<string, { t: number; dia: string; usados: number }> = {};
  const ultimo = { ...ultimoAuto };
  const estimado: Record<string, number | null> = {};
  for (const item of items) {
    if (pausados.has(item.contacto_id)) {
      estimado[item.id] = null;
      continue;
    }
    const r = (relojes[item.linea_id] ||= { t: Date.now(), dia: fechaDe(Date.now(), franja.zona), usados: usadosHoy[item.linea_id] || 0 });
    const persona = `${item.contacto_id}|${item.linea_id}`;
    let e = Math.max(r.t, ms(item.vence), (ultimo[persona] || 0) + minMisma);
    e = ajustar(e, franja);
    if (fechaDe(e, franja.zona) !== r.dia) {
      r.dia = fechaDe(e, franja.zona);
      r.usados = 0;
    }
    if (r.usados >= aj.maximo_diario) {
      e = inicioDeManana(e, franja);
      r.dia = fechaDe(e, franja.zona);
      r.usados = 0;
    }
    r.usados++;
    ultimo[persona] = e;
    estimado[item.id] = e;
    r.t = Math.max(r.t, e + pausaMedia);
  }
  return estimado;
}

const formatear = (ts: number, zona: string) =>
  new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));

const nombreDe = (i: { contactos: { nombre: string | null; telefono: string } | null }) =>
  i.contactos?.nombre?.trim() || i.contactos?.telefono.split('@')[0] || 'Contacto';

export default function ColaSeguimiento({ ajustes }: { ajustes: AjustesSeguimiento }) {
  const toast = useToast();
  const [pendientes, setPendientes] = useState<ItemCola[]>([]);
  const [cerrados, setCerrados] = useState<ItemCola[]>([]);
  const [registro, setRegistro] = useState<RegistroSeguimiento[]>([]);
  const [usadosHoy, setUsadosHoy] = useState<Record<string, number>>({});
  const [lineas, setLineas] = useState<{ id: string; nombre: string }[]>([]);
  const [ultimoAuto, setUltimoAuto] = useState<Record<string, number>>({});
  const [pausados, setPausados] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const zona = ajustes.zona_horaria;

  const cargar = useCallback(async () => {
    const campos = 'id, contacto_id, linea_id, tipo, nombre, variantes, vence, fijo, estado, a_mano, texto, motivo, creado_en, cerrado_en, contactos(nombre, telefono)';
    const [pend, cerr, reg, cont, lin] = await Promise.all([
      supabase.from('siguelo_cola').select(campos).in('estado', ['pendiente', 'enviando']).order('vence').order('creado_en').limit(300).returns<ItemCola[]>(),
      supabase.from('siguelo_cola').select(campos).in('estado', ['enviado', 'cancelado', 'error']).order('cerrado_en', { ascending: false }).limit(30).returns<ItemCola[]>(),
      supabase.from('siguelo_registro').select('id, tipo, texto, creado_en').order('creado_en', { ascending: false }).limit(60).returns<RegistroSeguimiento[]>(),
      supabase.from('siguelo_contador').select('linea_id, enviados').eq('fecha', fechaDe(Date.now(), zona)).returns<{ linea_id: string; enviados: number }[]>(),
      supabase.from('lineas_whatsapp').select('id, nombre').order('nombre').returns<{ id: string; nombre: string }[]>(),
    ]);
    const lista = pend.data || [];
    setPendientes(lista);
    setCerrados(cerr.data || []);
    setRegistro(reg.data || []);
    setUsadosHoy(Object.fromEntries((cont.data || []).map((c) => [c.linea_id, c.enviados])));
    setLineas(lin.data || []);
    const ids = [...new Set(lista.map((i) => i.contacto_id))];
    if (ids.length) {
      const [{ data: segs }, { data: recientes }] = await Promise.all([
        supabase.from('siguelo_seguimientos').select('contacto_id, pausado').in('contacto_id', ids).returns<{ contacto_id: string; pausado: boolean }[]>(),
        // Último automático de cada número a cada persona (el mínimo entre mensajes se cuenta por número).
        supabase
          .from('siguelo_cola')
          .select('contacto_id, linea_id, cerrado_en')
          .eq('estado', 'enviado')
          .in('contacto_id', ids)
          .gte('cerrado_en', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
          .returns<{ contacto_id: string; linea_id: string; cerrado_en: string }[]>(),
      ]);
      const ultimo: Record<string, number> = {};
      for (const r of recientes || []) {
        const k = `${r.contacto_id}|${r.linea_id}`;
        ultimo[k] = Math.max(ultimo[k] || 0, ms(r.cerrado_en));
      }
      setUltimoAuto(ultimo);
      setPausados(new Set((segs || []).filter((s) => s.pausado).map((s) => s.contacto_id)));
    }
    setCargando(false);
  }, [zona]);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 20000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  const estimado = useMemo(() => planificar(pendientes, ajustes, usadosHoy, ultimoAuto, pausados), [pendientes, ajustes, usadosHoy, ultimoAuto, pausados]);

  const cancelar = async (item: ItemCola) => {
    const { error } = await supabase
      .from('siguelo_cola')
      .update({ estado: 'cancelado', a_mano: true, motivo: 'Cancelado a mano: se salta este paso', cerrado_en: new Date().toISOString() })
      .eq('id', item.id)
      .eq('estado', 'pendiente');
    if (error) toast('No se pudo cancelar el mensaje.', 'error');
    else toast('Cancelado: ese paso se salta y sigue el siguiente', 'ok');
    cargar();
  };

  // Pasa al frente de la cola. Igual respeta el horario, la pausa entre mensajes y el tope diario.
  const adelantar = async (item: ItemCola) => {
    const primero = Math.min(Date.now(), ...pendientes.map((i) => ms(i.vence)));
    const { error } = await supabase.from('siguelo_cola').update({ vence: new Date(primero - 1000).toISOString(), fijo: true }).eq('id', item.id).eq('estado', 'pendiente');
    if (error) toast('No se pudo adelantar el mensaje.', 'error');
    else toast('Adelantado al frente de la cola', 'ok');
    cargar();
  };

  const franja: Franja = { zona, desde: ajustes.hora_inicio, hasta: ajustes.hora_fin };
  const lineasConPendientes = [...new Set(pendientes.map((i) => i.linea_id))];
  const todasLlenas = lineasConPendientes.length > 0 && lineasConPendientes.every((l) => (usadosHoy[l] || 0) >= ajustes.maximo_diario);
  const estadoCola = !ajustes.activo
    ? 'El seguimiento está apagado: no sale nada.'
    : ajustes.pausado
      ? `En pausa${ajustes.motivo_pausa ? ` (${ajustes.motivo_pausa})` : ''}: no sale nada hasta que la quites en Ajustes.`
      : todasLlenas
        ? `Tope del día alcanzado: lo pendiente sale mañana desde las ${ajustes.hora_inicio}.`
        : !enFranja(Date.now(), franja)
          ? `Fuera de horario: se reanuda a las ${ajustes.hora_inicio}.`
          : 'Enviando: cada número manda uno a la vez, con una pausa al azar entre mensajes.';
  const varias = lineas.length > 1;
  const nombreLinea = (id: string) => lineas.find((l) => l.id === id)?.nombre || 'Número';
  const totalHoy = Object.values(usadosHoy).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <Send size={16} color="var(--accent)" />
        {varias ? (
          <span className="flex items-center gap-1.5 flex-wrap text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
            <b>Hoy:</b>
            {lineas.map((l) => (
              <Etiqueta key={l.id} color={(usadosHoy[l.id] || 0) >= ajustes.maximo_diario ? 'var(--bad)' : 'var(--accent)'}>{l.nombre}: {usadosHoy[l.id] || 0} / {ajustes.maximo_diario}</Etiqueta>
            ))}
          </span>
        ) : (
          <span className="text-[13.5px] font-semibold num" style={{ color: TEXTO_PRIMARIO }}>Hoy: {totalHoy} / {ajustes.maximo_diario}</span>
        )}
        <span className="text-[12.5px] flex-1 min-w-[200px]" style={{ color: TEXTO_SECUNDARIO }}>{estadoCola}</span>
      </Tarjeta>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><ListOrdered size={15} /> Por salir</h2>
        {cargando ? (
          <div className="text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>
        ) : pendientes.length === 0 ? (
          <Tarjeta className="flex">
            <EstadoVacio icono={Clock} titulo="No hay mensajes en la cola" texto="Cuando un contacto esté en una etapa con mensajes, sus recordatorios y reactivaciones aparecen acá." />
          </Tarjeta>
        ) : (
          pendientes.map((item) => {
            const est = estimado[item.id];
            return (
              <Tarjeta key={item.id} className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-start gap-3">
                <Clock size={16} className="mt-0.5 shrink-0" color={AMBER} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{nombreDe(item)}</span>
                    <Etiqueta color={item.tipo === 'react' ? 'var(--warn)' : 'var(--accent)'}>{item.nombre}</Etiqueta>
                    {varias && <Etiqueta color="var(--fg-2)">{nombreLinea(item.linea_id)}</Etiqueta>}
                    <span className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
                      {item.estado === 'enviando' ? 'Enviando…' : est === null ? 'Contacto en pausa' : `≈ ${formatear(est ?? ms(item.vence), zona)}`}
                    </span>
                    {item.fijo && <Etiqueta color="var(--fg-2)">Adelantado</Etiqueta>}
                  </div>
                  <div className="text-[12.5px] mt-1 break-words line-clamp-2" style={{ color: TEXTO_SECUNDARIO }}>{item.variantes[0]}</div>
                  {item.variantes.length > 1 && <div className="text-[11.5px] mt-0.5" style={{ color: TEXTO_TERCIARIO }}>+ {item.variantes.length - 1} variante(s): se elige una al azar</div>}
                </div>
                {item.estado === 'pendiente' && (
                  <div className="flex gap-1.5 shrink-0 basis-full sm:basis-auto justify-end">
                    <Boton tamano="sm" variante="fantasma" onClick={() => adelantar(item)}>Adelantar</Boton>
                    <Boton tamano="sm" variante="peligro" onClick={() => cancelar(item)}>Cancelar</Boton>
                  </div>
                )}
              </Tarjeta>
            );
          })
        )}
      </section>

      {cerrados.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><Send size={15} /> Últimos procesados</h2>
          <Tarjeta className="flex flex-col">
            {cerrados.map((item, i) => {
              const est = ESTADO[item.estado];
              return (
                <div key={item.id} className="px-4 py-2.5 flex items-start gap-2 flex-wrap" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                  <Etiqueta color={est.color}>{est.texto}</Etiqueta>
                  <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{nombreDe(item)}</span>
                  <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>{item.nombre}</span>
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>{item.cerrado_en ? formatear(ms(item.cerrado_en), zona) : ''}</span>
                  {item.motivo && <span className="basis-full text-[12px]" style={{ color: est.color }}>{item.motivo}</span>}
                  {item.estado === 'enviado' && item.texto && <span className="basis-full text-[12px] break-words" style={{ color: TEXTO_SECUNDARIO }}>{item.texto}</span>}
                </div>
              );
            })}
          </Tarjeta>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><History size={15} /> Registro</h2>
        {registro.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>Todavía no pasó nada. Acá vas a ver quién respondió, qué salió y quién cambió de etapa.</span>
        ) : (
          <Tarjeta className="flex flex-col">
            {registro.map((r, i) => (
              <div key={r.id} className="px-4 py-2 flex gap-3 text-[12.5px]" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                <span className="shrink-0 num" style={{ color: TEXTO_TERCIARIO, minWidth: 120 }}>{formatear(ms(r.creado_en), zona)}</span>
                <span className="break-words min-w-0" style={{ color: r.tipo === 'error' || r.tipo === 'pausa' ? 'var(--bad)' : TEXTO_SECUNDARIO }}>{r.texto}</span>
              </div>
            ))}
          </Tarjeta>
        )}
      </section>
    </div>
  );
}
