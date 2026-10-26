import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CalendarDays, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { aInstanteUTC, aLocalEnZona } from '../../lib/zonaHoraria';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Interruptor, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloArea, estiloCampo } from './estilos';
import { textoAVariantes, variantesATexto } from './plantillas';
import type { AjustesSeguimiento, ConfigCitas, PasoCita } from './tipos';

type Cita = { id: string; contacto_id: string; inicio: string; fin: string; nota: string | null; paso: number; contactos: { nombre: string | null; telefono: string } | null };
type Contacto = { id: string; nombre: string | null; telefono: string };

// Cuándo sale cada mensaje, en palabras: antes de la cita, después de que empieza o después de que termina.
// Mientras editas, las horas y los textos se guardan tal como los escribes.
type Cuando = 'antes' | 'empieza' | 'termina';
type BorradorPaso = { cuando: Cuando; horas: string; texto: string };
const aBorrador = (p: PasoCita): BorradorPaso => ({
  cuando: p.ref === 'fin' ? 'termina' : p.horas < 0 ? 'antes' : 'empieza',
  horas: String(Math.abs(p.horas)),
  texto: variantesATexto(p.variantes),
});
const dePaso = (b: BorradorPaso): PasoCita => {
  const h = Math.abs(Number(b.horas.replace(',', '.')) || 0);
  return { ref: b.cuando === 'termina' ? 'fin' : 'inicio', horas: b.cuando === 'antes' ? -h : h, variantes: textoAVariantes(b.texto) };
};

const nombreDe = (c: { nombre: string | null; telefono: string } | null) => c?.nombre?.trim() || c?.telefono.split('@')[0] || 'Contacto';
const etiquetaContacto = (c: Contacto) => `${nombreDe(c)} · +${c.telefono.split('@')[0]}`;

interface Props {
  ajustes: AjustesSeguimiento;
  existe: boolean;
  puedeEditar: boolean;
  onGuardado: () => void;
}

export default function CitasSeguimiento({ ajustes, existe, puedeEditar, onGuardado }: Props) {
  const toast = useToast();
  const zona = ajustes.zona_horaria;
  const [citas, setCitas] = useState<Cita[]>([]);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const manana = useMemo(() => aLocalEnZona(new Date(Date.now() + 86400000), zona).slice(0, 10), [zona]);
  const [nueva, setNueva] = useState({ contacto: '', fecha: manana, hora: '16:00', duracion: '60', nota: '' });
  const [cambiando, setCambiando] = useState<{ id: string; fecha: string; hora: string } | null>(null);
  const [activa, setActiva] = useState(ajustes.citas?.activa ?? true);
  const [pasos, setPasos] = useState<BorradorPaso[]>((ajustes.citas?.pasos ?? []).map(aBorrador));

  useEffect(() => {
    setActiva(ajustes.citas?.activa ?? true);
    setPasos((ajustes.citas?.pasos ?? []).map(aBorrador));
  }, [ajustes]);

  const cargar = useCallback(async () => {
    const [c, k] = await Promise.all([
      supabase
        .from('siguelo_citas')
        .select('id, contacto_id, inicio, fin, nota, paso, contactos(nombre, telefono)')
        .eq('estado', 'agendada')
        .gte('fin', new Date(Date.now() - 86400000).toISOString())
        .order('inicio')
        .returns<Cita[]>(),
      supabase.from('contactos').select('id, nombre, telefono').order('actualizado_en', { ascending: false }).limit(1000).returns<Contacto[]>(),
    ]);
    setCitas(c.data || []);
    setContactos(k.data || []);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!ajustes.citas) {
    return (
      <span className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
        {existe
          ? 'Para usar las citas, vuelve a pegar database/siguelo.sql en Supabase (trae la Fase 4).'
          : 'Primero guarda y activa el seguimiento en Ajustes: los mensajes de las citas salen con él.'}
      </span>
    );
  }

  const agendar = async () => {
    const contacto = contactos.find((c) => etiquetaContacto(c) === nueva.contacto);
    if (!contacto) return toast('Elige el contacto de la lista.', 'error');
    const minutos = Math.max(5, Math.round(Number(nueva.duracion) || 60));
    const inicio = aInstanteUTC(`${nueva.fecha}T${nueva.hora}`, zona);
    if (Number.isNaN(inicio.getTime())) return toast('Revisa la fecha y la hora.', 'error');
    // Una cita por contacto: la nueva reemplaza a la anterior.
    await supabase.from('siguelo_citas').update({ estado: 'cancelada', actualizado_en: new Date().toISOString() }).eq('contacto_id', contacto.id).eq('estado', 'agendada');
    const { error } = await supabase.from('siguelo_citas').insert({
      empresa_id: ajustes.empresa_id,
      contacto_id: contacto.id,
      inicio: inicio.toISOString(),
      fin: new Date(inicio.getTime() + minutos * 60000).toISOString(),
      nota: nueva.nota.trim() || null,
    });
    if (error) return toast(`No se pudo agendar: ${error.message}`, 'error');
    toast(`Cita de ${nombreDe(contacto)} agendada: sus mensajes se programan solos`, 'ok');
    setNueva({ ...nueva, contacto: '', nota: '' });
    cargar();
  };

  const guardarCambio = async (cita: Cita) => {
    if (!cambiando) return;
    const inicio = aInstanteUTC(`${cambiando.fecha}T${cambiando.hora}`, zona);
    const dur = new Date(cita.fin).getTime() - new Date(cita.inicio).getTime();
    const { error } = await supabase
      .from('siguelo_citas')
      .update({ inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + dur).toISOString(), paso: 0, actualizado_en: new Date().toISOString() })
      .eq('id', cita.id);
    if (error) return toast('No se pudo cambiar la cita.', 'error');
    toast('Cita cambiada: sus mensajes se reprograman', 'ok');
    setCambiando(null);
    cargar();
  };

  const quitar = async (cita: Cita) => {
    if (!window.confirm(`¿Quitar la cita de ${nombreDe(cita.contactos)}? Sus mensajes pendientes se cancelan.`)) return;
    await supabase.from('siguelo_citas').update({ estado: 'cancelada', actualizado_en: new Date().toISOString() }).eq('id', cita.id);
    toast('Cita quitada', 'ok');
    cargar();
  };

  const guardarMensajes = async () => {
    if (!ajustes.citas) return;
    const cfg: ConfigCitas = { ...ajustes.citas, activa, pasos: pasos.map(dePaso) };
    if (cfg.pasos.some((p) => !p.variantes.length)) return toast('Cada mensaje necesita al menos un texto.', 'error');
    const { error } = await supabase.from('siguelo_ajustes').update({ citas: cfg, actualizado_en: new Date().toISOString() }).eq('empresa_id', ajustes.empresa_id);
    if (error) return toast(`No se pudo guardar: ${error.message}. ¿Ya activaste el seguimiento en Ajustes?`, 'error');
    toast('Mensajes de las citas guardados', 'ok');
    onGuardado();
  };

  const dia = (iso: string) => new Intl.DateTimeFormat('es', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
  const hora = (iso: string) => new Intl.DateTimeFormat('es', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const porDia = citas.reduce<Record<string, Cita[]>>((m, c) => ({ ...m, [dia(c.inicio)]: [...(m[dia(c.inicio)] || []), c] }), {});
  const cambiarPaso = (i: number, cambios: Partial<BorradorPaso>) => setPasos(pasos.map((p, k) => (k === i ? { ...p, ...cambios } : p)));
  const cfg = ajustes.citas;

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-4 flex flex-col gap-3 max-w-2xl">
        <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}><CalendarPlus size={16} color="var(--accent)" /> Agendar una cita</span>
        <input list="contactos-cita" value={nueva.contacto} onChange={(e) => setNueva({ ...nueva, contacto: e.target.value })} placeholder="Busca el contacto por nombre o número" aria-label="Contacto" className={claseCampo} style={estiloCampo} />
        <datalist id="contactos-cita">{contactos.map((c) => <option key={c.id} value={etiquetaContacto(c)} />)}</datalist>
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          <input type="date" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} aria-label="Día" className={claseCampo} style={estiloCampo} />
          a las
          <input type="time" value={nueva.hora} onChange={(e) => setNueva({ ...nueva, hora: e.target.value })} aria-label="Hora" className={claseCampo} style={estiloCampo} />
          durante
          <input value={nueva.duracion} onChange={(e) => setNueva({ ...nueva, duracion: e.target.value })} inputMode="numeric" aria-label="Duración en minutos" className={`${claseCampo} w-16 text-right`} style={estiloCampo} />
          min
        </div>
        <input value={nueva.nota} onChange={(e) => setNueva({ ...nueva, nota: e.target.value })} placeholder="Nota (opcional)" aria-label="Nota" className={claseCampo} style={estiloCampo} />
        <Boton variante="primario" icono={CalendarPlus} className="self-start" onClick={agendar}>Agendar</Boton>
      </Tarjeta>

      <section className="flex flex-col gap-2">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><CalendarDays size={15} /> Próximas citas</h2>
        {citas.length === 0 ? (
          <Tarjeta className="flex"><EstadoVacio icono={CalendarDays} titulo="No hay citas agendadas" texto="Agenda una arriba: sus recordatorios salen solos." /></Tarjeta>
        ) : (
          Object.entries(porDia).map(([d, lista]) => (
            <Tarjeta key={d} className="flex flex-col">
              <div className="px-4 py-2 text-[12.5px] font-semibold first-letter:uppercase" style={{ color: TEXTO_SECUNDARIO, borderBottom: `1px solid ${BORDE}` }}>{d}</div>
              {lista.map((c) => (
                <div key={c.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold num" style={{ color: TEXTO_PRIMARIO, minWidth: 48 }}>{hora(c.inicio)}</span>
                  <span className="text-[13.5px] flex-1 min-w-[140px]" style={{ color: TEXTO_PRIMARIO }}>
                    {nombreDe(c.contactos)}
                    {c.nota && <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}> — {c.nota}</span>}
                  </span>
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>{Math.min(c.paso, ajustes.citas!.pasos.length)} de {ajustes.citas!.pasos.length} mensajes</span>
                  {cambiando?.id === c.id ? (
                    <span className="flex items-center gap-1.5 flex-wrap basis-full">
                      <input type="date" value={cambiando.fecha} onChange={(e) => setCambiando({ ...cambiando, fecha: e.target.value })} aria-label="Nuevo día" className={claseCampo} style={{ ...estiloCampo, height: 32 }} />
                      <input type="time" value={cambiando.hora} onChange={(e) => setCambiando({ ...cambiando, hora: e.target.value })} aria-label="Nueva hora" className={claseCampo} style={{ ...estiloCampo, height: 32 }} />
                      <Boton tamano="sm" variante="primario" onClick={() => guardarCambio(c)}>Guardar</Boton>
                      <Boton tamano="sm" variante="fantasma" onClick={() => setCambiando(null)}>Cancelar</Boton>
                    </span>
                  ) : (
                    <span className="flex gap-1.5">
                      <Boton tamano="sm" onClick={() => setCambiando({ id: c.id, fecha: aLocalEnZona(new Date(c.inicio), zona).slice(0, 10), hora: hora(c.inicio) })}>Cambiar</Boton>
                      <Boton tamano="sm" variante="peligro" onClick={() => quitar(c)}>Quitar</Boton>
                    </span>
                  )}
                </div>
              ))}
            </Tarjeta>
          ))
        )}
      </section>

      <Tarjeta className="p-4 flex flex-col gap-3 max-w-2xl">
        <div className="flex items-start gap-3">
          <span className="flex-1 flex items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}><MessageSquareText size={16} color="var(--accent)" /> Mensajes de las citas</span>
          <Interruptor activo={activa} onCambiar={setActiva} etiqueta="Activar los mensajes de las citas" deshabilitado={!puedeEditar} />
        </div>
        <span className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
          Salen con prioridad mientras el seguimiento está activo, sin contar para el máximo del día, de {cfg.desde} a {cfg.hasta}. Si uno se atrasa más de {cfg.max_atraso_min} min, se cancela.
          Puedes usar {'{nombre}'}, {'{hora}'} (16:30) y {'{cuando}'} (hoy, mañana o el viernes 30/10).
        </span>
        {pasos.map((p, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg p-2.5" style={{ border: `1px solid ${BORDE}` }}>
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              <b style={{ color: TEXTO_PRIMARIO }}>Mensaje {i + 1}</b>
              <input value={p.horas} disabled={!puedeEditar} onChange={(e) => cambiarPaso(i, { horas: e.target.value })} inputMode="decimal" aria-label="Horas" className={`${claseCampo} w-16 text-right`} style={{ ...estiloCampo, height: 30 }} />
              h
              <select value={p.cuando} disabled={!puedeEditar} onChange={(e) => cambiarPaso(i, { cuando: e.target.value as Cuando })} className={claseCampo} style={{ ...estiloCampo, height: 30 }}>
                <option value="antes">antes de la cita</option>
                <option value="empieza">después de que empieza (0 = al empezar)</option>
                <option value="termina">después de que termina</option>
              </select>
              <span className="flex-1" />
              {puedeEditar && <button onClick={() => setPasos(pasos.filter((_, k) => k !== i))} aria-label={`Quitar mensaje ${i + 1}`} className="p-1 rounded-md" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={14} /></button>}
            </div>
            <textarea value={p.texto} disabled={!puedeEditar} onChange={(e) => cambiarPaso(i, { texto: e.target.value })} rows={3} aria-label={`Textos del mensaje ${i + 1}`} className="rounded-lg outline-none text-[13px] bg-[var(--surface)] resize-y" style={estiloArea} />
          </div>
        ))}
        {puedeEditar && (
          <div className="flex gap-2 flex-wrap">
            <Boton tamano="sm" icono={Plus} onClick={() => setPasos([...pasos, { cuando: 'antes', horas: '24', texto: '' }])}>Agregar mensaje</Boton>
            <Boton variante="primario" onClick={guardarMensajes}>Guardar mensajes</Boton>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
