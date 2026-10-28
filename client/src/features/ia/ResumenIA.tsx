import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Check, History, MessageSquare, Send, Sparkles, Trash2, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from '../seguimiento/Etiqueta';
import { estiloArea } from '../seguimiento/estilos';
import { PRECIOS, TIPOS_AVISO, type AjustesIA, type ItemSalida, type Lectura } from './tipos';

const ms = (iso: string) => new Date(iso).getTime() || 0;
const formatear = (ts: number) => new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const nombreDe = (x: { contactos: { nombre: string | null; telefono: string } | null; telefono?: string }) =>
  x.contactos?.nombre?.trim() || (x.contactos?.telefono || x.telefono || '').split('@')[0] || 'Cliente';
const QUE: Record<string, string> = { respuesta_rapida: 'Respuesta rápida', grupo: 'Link del grupo', pase: 'Pase a otra sucursal', qr: 'QR de pago', pago: 'Pago', bot: 'Bot' };

interface Props {
  ajustes: AjustesIA;
  lineas: Record<string, string>;
  onAbrirChat?: (telefono: string) => void;
}

// Lo que la IA necesita de ti: respuestas para aprobar, clientes para ver, y lo último que hizo.
export default function ResumenIA({ ajustes, lineas, onAbrirChat }: Props) {
  const toast = useToast();
  const [borradores, setBorradores] = useState<ItemSalida[]>([]);
  const [atencion, setAtencion] = useState<Lectura[]>([]);
  const [registro, setRegistro] = useState<{ id: string; tipo: string; texto: string; creado_en: string }[]>([]);
  const [uso, setUso] = useState<{ fecha: string; consultas: number; entrada: number; salida: number }[]>([]);
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    const mes = new Date().toISOString().slice(0, 7);
    const [b, a, r, u] = await Promise.all([
      supabase.from('siguelo_ia_salida').select('*, contactos(nombre, telefono)').eq('estado', 'borrador').order('creado_en').order('orden').returns<ItemSalida[]>(),
      supabase.from('siguelo_ia_lecturas').select('*, contactos(nombre, telefono)').not('atencion', 'is', null).order('actualizado_en', { ascending: false }).limit(100).returns<Lectura[]>(),
      supabase.from('siguelo_registro').select('id, tipo, texto, creado_en').in('tipo', ['ia', 'ia_error']).order('creado_en', { ascending: false }).limit(40).returns<{ id: string; tipo: string; texto: string; creado_en: string }[]>(),
      supabase.from('siguelo_ia_uso').select('fecha, consultas, entrada, salida').gte('fecha', `${mes}-01`).returns<{ fecha: string; consultas: number; entrada: number; salida: number }[]>(),
    ]);
    setBorradores(b.data || []);
    setAtencion((a.data || []).filter((l) => l.atencion && !l.atencion.hecho));
    setRegistro(r.data || []);
    setUso(u.data || []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 20000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  // Los mensajes de una misma respuesta (texto, foto, link, pase) van juntos.
  const lotes = useMemo(() => {
    const mapa = new Map<string, ItemSalida[]>();
    for (const it of borradores) {
      const k = it.lote || it.id;
      mapa.set(k, [...(mapa.get(k) || []), it]);
    }
    return [...mapa.values()];
  }, [borradores]);

  const aprobar = async (items: ItemSalida[]) => {
    const ahora = new Date().toISOString();
    for (const it of items) {
      const contenido = editados[it.id];
      const { error } = await supabase
        .from('siguelo_ia_salida')
        .update({ estado: 'pendiente', aprobado: true, vence: ahora, ...(contenido !== undefined ? { contenido } : {}) })
        .eq('id', it.id)
        .eq('estado', 'borrador');
      if (error) return toast('No se pudo aprobar.', 'error');
    }
    toast('Aprobada: sale en unos segundos', 'ok');
    cargar();
  };

  const descartar = async (items: ItemSalida[]) => {
    await supabase.from('siguelo_ia_salida').update({ estado: 'cancelado', motivo: 'Descartada a mano', cerrado_en: new Date().toISOString() }).in('id', items.map((x) => x.id));
    toast('Descartada', 'ok');
    cargar();
  };

  const listo = async (l: Lectura) => {
    await supabase.from('siguelo_ia_lecturas').update({ atencion: { ...l.atencion, hecho: Date.now() } }).eq('conversacion_id', l.conversacion_id);
    cargar();
  };

  const callar = async (l: Lectura) => {
    await supabase.from('siguelo_ia_lecturas').update({ sin_respuestas: !l.sin_respuestas }).eq('conversacion_id', l.conversacion_id);
    toast(l.sin_respuestas ? 'La IA puede volver a responderle' : 'La IA ya no le responde a este cliente en este número', 'ok');
    cargar();
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const deHoy = uso.find((u) => u.fecha === hoy);
  const delMes = uso.reduce((t, u) => ({ consultas: t.consultas + u.consultas, entrada: t.entrada + u.entrada, salida: t.salida + u.salida }), { consultas: 0, entrada: 0, salida: 0 });
  const precio = PRECIOS[ajustes.modelo];
  const costo = (e: number, s: number) => (precio ? ` · ≈ $${((e * precio[0] + s * precio[1]) / 1e6).toFixed(e + s > 2e6 ? 2 : 3)}` : '');

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <Sparkles size={16} color="var(--accent)" />
        <span className="text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
          <b>Hoy:</b> {deHoy?.consultas ?? 0} / {ajustes.max_consultas_dia} consultas{costo(deHoy?.entrada ?? 0, deHoy?.salida ?? 0)}
        </span>
        <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Este mes: {delMes.consultas} consultas, {Math.round((delMes.entrada + delMes.salida) / 1000)} mil tokens{costo(delMes.entrada, delMes.salida)}
        </span>
      </Tarjeta>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><Send size={15} /> Para aprobar ({lotes.length})</h2>
        {cargando ? (
          <div className="text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>
        ) : lotes.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>No hay respuestas esperando. {ajustes.modo === 'automatico' ? 'La IA responde sola.' : ''}</span>
        ) : (
          lotes.map((items) => {
            const p = items[0];
            return (
              <Tarjeta key={p.lote || p.id} className="p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{nombreDe(p)}</span>
                  {lineas[p.linea_id] && <Etiqueta color="var(--fg-2)">{lineas[p.linea_id]}</Etiqueta>}
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>{formatear(ms(p.creado_en))}</span>
                  {p.motivo && <span className="basis-full text-[12px]" style={{ color: 'var(--warn)' }}>No salió sola porque {p.motivo}.</span>}
                </div>
                {items.map((it) =>
                  it.origen === 'respuesta' ? (
                    <textarea
                      key={it.id}
                      value={editados[it.id] ?? it.contenido}
                      onChange={(e) => setEditados({ ...editados, [it.id]: e.target.value })}
                      rows={Math.min(8, Math.max(2, (editados[it.id] ?? it.contenido).split('\n').length + 1))}
                      aria-label="Respuesta de la IA"
                      className="rounded-lg outline-none text-[13px] bg-[var(--surface)] resize-y"
                      style={estiloArea}
                    />
                  ) : (
                    <div key={it.id} className="text-[12.5px] rounded-lg px-3 py-2" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>
                      <b>{QUE[it.origen] || it.origen}{it.origen === 'pase' && lineas[it.linea_id] ? ` (por ${lineas[it.linea_id]})` : ''}:</b> {it.tipo !== 'texto' ? `[${it.tipo}] ` : ''}
                      {it.contenido}
                    </div>
                  ),
                )}
                <div className="flex gap-2 flex-wrap">
                  <Boton variante="primario" icono={Send} onClick={() => aprobar(items)}>Enviar</Boton>
                  <Boton variante="fantasma" icono={Trash2} onClick={() => descartar(items)}>Descartar</Boton>
                  {onAbrirChat && p.contactos && <Boton variante="fantasma" icono={MessageSquare} onClick={() => onAbrirChat(p.contactos!.telefono)}>Abrir chat</Boton>}
                </div>
              </Tarjeta>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><BellRing size={15} /> Necesitan que los veas ({atencion.length})</h2>
        {!cargando && atencion.length === 0 ? (
          <Tarjeta className="flex">
            <EstadoVacio icono={Check} titulo="Nada pendiente" texto="Cuando un cliente pregunte algo que no está en la ficha, se queje o pida una persona, aparece acá." />
          </Tarjeta>
        ) : (
          atencion.map((l) => (
            <Tarjeta key={l.conversacion_id} className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{nombreDe(l)}</span>
                  {l.linea_id && lineas[l.linea_id] && <Etiqueta color="var(--fg-2)">{lineas[l.linea_id]}</Etiqueta>}
                  <Etiqueta color="var(--warn)">{TIPOS_AVISO[l.atencion!.tipo] || 'Revisar'}</Etiqueta>
                  {l.sin_respuestas && <Etiqueta color="var(--fg-2)">La IA no le responde</Etiqueta>}
                </div>
                <div className="text-[13px] mt-1" style={{ color: TEXTO_PRIMARIO }}>{l.atencion!.motivo}</div>
                {l.resumen && <div className="text-[12px] mt-0.5" style={{ color: TEXTO_TERCIARIO }}>{l.resumen}</div>}
              </div>
              <div className="flex gap-1.5 shrink-0 flex-wrap justify-end basis-full sm:basis-auto">
                {onAbrirChat && l.contactos && <Boton tamano="sm" icono={MessageSquare} onClick={() => onAbrirChat(l.contactos!.telefono)}>Abrir chat</Boton>}
                <Boton tamano="sm" variante="fantasma" icono={UserX} onClick={() => callar(l)}>{l.sin_respuestas ? 'Que la IA responda' : 'Que la IA no responda'}</Boton>
                <Boton tamano="sm" icono={Check} onClick={() => listo(l)}>Listo</Boton>
              </div>
            </Tarjeta>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><History size={15} /> Lo último que hizo la IA</h2>
        {registro.length === 0 ? (
          <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>Todavía nada.</span>
        ) : (
          <Tarjeta className="flex flex-col">
            {registro.map((r, i) => (
              <div key={r.id} className="px-4 py-2 flex gap-3 text-[12.5px]" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                <span className="shrink-0 num" style={{ color: TEXTO_TERCIARIO, minWidth: 120 }}>{formatear(ms(r.creado_en))}</span>
                <span className="break-words min-w-0" style={{ color: r.tipo === 'ia_error' ? 'var(--bad)' : TEXTO_SECUNDARIO }}>{r.texto}</span>
              </div>
            ))}
          </Tarjeta>
        )}
      </section>
    </div>
  );
}
