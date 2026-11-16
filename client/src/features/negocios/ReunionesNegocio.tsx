import { useState } from 'react';
import { BellRing, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, useToast } from '../../components/ui';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';

// Reuniones virtuales que agenda la IA (server/src/siguelo/ia/reuniones.ts): tus días y horarios
// libres, cuánto dura cada reunión y el link. Cuando el cliente confirma un horario, queda la cita
// (con recordatorios) y la actividad en tu Agenda, y te llega un aviso.

export type FranjaReunion = { dias: number[]; desde: string; hasta: string };
export type ConfigReuniones = { activa: boolean; franjas: FranjaReunion[]; duracion_min: number; anticipacion_horas?: number; dias_adelante?: number; enlace?: string };

const DIAS = [
  [1, 'L', 'lunes'],
  [2, 'M', 'martes'],
  [3, 'M', 'miércoles'],
  [4, 'J', 'jueves'],
  [5, 'V', 'viernes'],
  [6, 'S', 'sábado'],
  [7, 'D', 'domingo'],
] as const;

export const reunionesNuevas = (): ConfigReuniones => ({ activa: true, franjas: [{ dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '12:00' }], duracion_min: 30, anticipacion_horas: 2, dias_adelante: 7, enlace: '' });

// Los recordatorios de las reuniones: 24 h, 1 h y 15 min antes (Seguimiento → Citas).
function pasosRecordatorio(enlace: string) {
  const link = enlace ? `\nLink: ${enlace}` : '';
  return [
    { ref: 'inicio', horas: -24, variantes: [`Hola {nombre} 👋 Te recuerdo nuestra reunión virtual {cuando} a las {hora}.${link}`] },
    { ref: 'inicio', horas: -1, variantes: [`{nombre}, en 1 hora es nuestra reunión virtual ({hora}). ¡Nos vemos!${link}`] },
    { ref: 'inicio', horas: -0.25, variantes: [`¡Ya casi, {nombre}! En 15 minutos empezamos la reunión.${link}`] },
  ];
}

export default function ReunionesNegocio({ valor, onCambiar, puedeEditar, empresaId }: { valor: ConfigReuniones | null; onCambiar: (v: ConfigReuniones | null) => void; puedeEditar: boolean; empresaId: string }) {
  const toast = useToast();
  const [poniendo, setPoniendo] = useState(false);
  const v = valor;
  const cambiar = (cambios: Partial<ConfigReuniones>) => v && onCambiar({ ...v, ...cambios });
  const cambiarFranja = (i: number, cambios: Partial<FranjaReunion>) => v && cambiar({ franjas: v.franjas.map((f, j) => (j === i ? { ...f, ...cambios } : f)) });

  const ponerRecordatorios = async () => {
    if (!v) return;
    if (!window.confirm('Se ponen los recordatorios de las citas de esta cuenta: 24 h, 1 h y 15 min antes (con el link de la reunión), y se enciende el Seguimiento, que es el que los manda. ¿Seguimos?')) return;
    setPoniendo(true);
    const { data: aj } = await supabase.from('siguelo_ajustes').select('citas').maybeSingle();
    const citas = { desde: '07:00', hasta: '22:00', max_atraso_min: 30, ...((aj?.citas as object) || {}), activa: true, pasos: pasosRecordatorio(v.enlace?.trim() || '') };
    const { error } = await supabase.from('siguelo_ajustes').upsert({ empresa_id: empresaId, citas, activo: true }, { onConflict: 'empresa_id' });
    setPoniendo(false);
    if (error) return toast(`No se pudo: ${error.message}`, 'error');
    toast('Listo: cada reunión recibe su recordatorio 24 h, 1 h y 15 min antes. Los textos se cambian en Seguimiento → Citas.', 'ok');
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg p-3" style={{ border: `1px solid ${BORDE}` }}>
      <label className="flex items-start gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
        <input type="checkbox" className="mt-0.5" checked={!!v?.activa} disabled={!puedeEditar} onChange={(e) => onCambiar(e.target.checked ? { ...(v ?? reunionesNuevas()), activa: true } : v ? { ...v, activa: false } : null)} />
        <span>
          <b style={{ color: TEXTO_PRIMARIO }}>La IA agenda reuniones virtuales.</b> Le ofrece al cliente tus horarios libres; cuando confirma uno, queda la cita en tu Agenda, le
          llega el link y te avisa a tu WhatsApp. Un horario ocupado ya no se ofrece a nadie.
        </span>
      </label>
      {v?.activa && (
        <>
          <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Tus horarios para reuniones</span>
          {v.franjas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              {DIAS.map(([n, letra, nombre]) => {
                const si = f.dias.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    title={nombre}
                    aria-pressed={si}
                    disabled={!puedeEditar}
                    onClick={() => cambiarFranja(i, { dias: si ? f.dias.filter((d) => d !== n) : [...f.dias, n].sort() })}
                    className="w-8 h-8 rounded-full text-[12px] font-bold"
                    style={{ backgroundColor: si ? 'var(--accent)' : 'var(--surface-2)', color: si ? 'var(--accent-fg)' : TEXTO_SECUNDARIO, border: `1px solid ${si ? 'var(--accent)' : BORDE}` }}
                  >
                    {letra}
                  </button>
                );
              })}
              <input type="time" value={f.desde} disabled={!puedeEditar} onChange={(e) => cambiarFranja(i, { desde: e.target.value })} className={`${claseCampo} font-normal`} style={{ ...estiloCampo, width: 110 }} />
              <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>a</span>
              <input type="time" value={f.hasta} disabled={!puedeEditar} onChange={(e) => cambiarFranja(i, { hasta: e.target.value })} className={`${claseCampo} font-normal`} style={{ ...estiloCampo, width: 110 }} />
              {v.franjas.length > 1 && (
                <button type="button" disabled={!puedeEditar} onClick={() => cambiar({ franjas: v.franjas.filter((_, j) => j !== i) })} aria-label="Quitar horario" style={{ color: TEXTO_TERCIARIO }}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          <div>
            <Boton tamano="sm" icono={Plus} disabled={!puedeEditar} onClick={() => cambiar({ franjas: [...v.franjas, { dias: [1, 2, 3, 4, 5], desde: '15:00', hasta: '18:00' }] })}>Otro horario</Boton>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              Cada reunión dura
              <select value={v.duracion_min} disabled={!puedeEditar} onChange={(e) => cambiar({ duracion_min: Number(e.target.value) })} className={`${claseCampo} font-normal`} style={estiloCampo}>
                {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : '1 hora y media'}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              Con al menos
              <select value={v.anticipacion_horas ?? 2} disabled={!puedeEditar} onChange={(e) => cambiar({ anticipacion_horas: Number(e.target.value) })} className={`${claseCampo} font-normal`} style={estiloCampo}>
                {[1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h < 24 ? `${h} ${h === 1 ? 'hora' : 'horas'} de aviso` : `${h / 24} ${h === 24 ? 'día' : 'días'} de aviso`}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              Ofrece los próximos
              <select value={v.dias_adelante ?? 7} disabled={!puedeEditar} onChange={(e) => cambiar({ dias_adelante: Number(e.target.value) })} className={`${claseCampo} font-normal`} style={estiloCampo}>
                {[3, 5, 7, 14, 21].map((d) => <option key={d} value={d}>{d} días</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
            Link de la reunión (Google Meet, Zoom…)
            <input value={v.enlace ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar({ enlace: e.target.value })} placeholder="Ej. https://meet.google.com/abc-defg-hij" className={`${claseCampo} font-normal`} style={estiloCampo} />
            <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>Se le manda al cliente al confirmar y va en sus recordatorios. Usa un link fijo (tu sala personal de Meet o Zoom).</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Boton tamano="sm" icono={BellRing} disabled={!puedeEditar || poniendo} onClick={ponerRecordatorios}>{poniendo ? 'Poniendo…' : 'Recordatorios: 24 h, 1 h y 15 min antes'}</Boton>
            <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>Guarda primero el link. Los textos se cambian en Seguimiento → Citas.</span>
          </div>
        </>
      )}
    </div>
  );
}
