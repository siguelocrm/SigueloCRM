import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, MessageCircleQuestion, Send, Trash2, Wand2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { estiloArea } from '../seguimiento/estilos';

type Mensaje = {
  id: string;
  rol: 'usuario' | 'asistente';
  texto: string;
  acciones: { tipo: string; descripcion: string }[];
  aplicado_en: string | null;
  resultado: string | null;
  creado_en: string;
};

const SUGERENCIAS = [
  '¿Cómo funciona el seguimiento y cómo lo tengo configurado?',
  'Pon las reactivaciones de 1, 3, 5 y 8 horas y los recordatorios al día 1, 3 y 5',
  'Escríbeme los textos de los recordatorios con la información de mi negocio',
  '¿Por qué no salió un mensaje hoy?',
  'Quiero que la IA adapte cada recordatorio a la conversación',
];

// El asistente: le preguntas cómo funciona algo o le pides cambios con tus
// palabras. Los cambios que propone se hacen recién cuando pulsas "Aplicar".
export default function AsistenteIA({ hayClave, onCambios }: { hayClave: boolean; onCambios: () => void }) {
  const toast = useToast();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [aplicando, setAplicando] = useState('');
  const final = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('siguelo_asistente').select('id, rol, texto, acciones, aplicado_en, resultado, creado_en').order('creado_en', { ascending: false }).limit(60).returns<Mensaje[]>();
    setMensajes((data || []).reverse());
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    final.current?.scrollIntoView({ block: 'end' });
  }, [mensajes, pensando]);

  const enviar = async (t = texto) => {
    const limpio = t.trim();
    if (!limpio || pensando) return;
    setTexto('');
    setPensando(true);
    // Se muestra ya; al volver la respuesta se recarga todo desde la base.
    setMensajes((m) => [...m, { id: `local-${Date.now()}`, rol: 'usuario', texto: limpio, acciones: [], aplicado_en: null, resultado: null, creado_en: new Date().toISOString() }]);
    const r = await llamarBackend('/siguelo/ia/asistente', { texto: limpio }).catch(() => ({ ok: false, error: 'No hay conexión con el servidor del CRM (¿está prendido?).' }));
    setPensando(false);
    if (!r.ok) toast(r.error || 'No se pudo consultar al asistente.', 'error');
    await cargar();
  };

  const aplicar = async (m: Mensaje) => {
    setAplicando(m.id);
    const r = await llamarBackend('/siguelo/ia/asistente/aplicar', { id: m.id }).catch(() => ({ ok: false, error: 'No hay conexión con el servidor del CRM.' }));
    setAplicando('');
    if (!r.ok) return toast(r.error || 'No se pudieron aplicar los cambios.', 'error');
    toast('Cambios aplicados', 'ok');
    await cargar();
    onCambios();
  };

  const borrar = async () => {
    if (!window.confirm('¿Borrar toda la conversación con el asistente? Los cambios que ya aplicaste se quedan.')) return;
    await supabase.from('siguelo_asistente').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setMensajes([]);
  };

  if (!hayClave) {
    return <span className="text-[12.5px]" style={{ color: 'var(--warn)' }}>Para hablar con el asistente, primero guarda tu clave de OpenAI en la pestaña Ajustes.</span>;
  }

  return (
    <Tarjeta className="flex flex-col max-w-3xl w-full" style={{ height: 'min(70vh, 680px)' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDE}` }}>
        <Wand2 size={16} color="var(--accent)" />
        <span className="flex-1 text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>Pregúntale cómo funciona algo o pídele cambios con tus palabras. Nada cambia hasta que pulses "Aplicar".</span>
        {mensajes.length > 0 && <button onClick={borrar} aria-label="Borrar la conversación" title="Borrar la conversación" className="p-1.5 rounded-md" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={15} /></button>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {mensajes.length === 0 && (
          <div className="flex flex-col gap-2 items-start">
            <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}><MessageCircleQuestion size={15} /> Por ejemplo:</span>
            {SUGERENCIAS.map((s) => (
              <button key={s} onClick={() => enviar(s)} className="text-left text-[12.5px] px-3 py-1.5 rounded-full" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>{s}</button>
            ))}
          </div>
        )}
        {mensajes.map((m) => (
          <div key={m.id} className={`flex flex-col gap-1.5 max-w-[88%] ${m.rol === 'usuario' ? 'self-end items-end' : 'self-start'}`}>
            <div
              className="px-3 py-2 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap break-words"
              style={m.rol === 'usuario' ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-2, var(--surface))', color: TEXTO_PRIMARIO, border: `1px solid ${BORDE}` }}
            >
              {m.texto}
            </div>
            {m.acciones?.length > 0 && (
              <div className="rounded-xl p-3 flex flex-col gap-1.5 w-full" style={{ border: `1px solid ${m.aplicado_en ? 'var(--ok)' : 'var(--accent)'}` }}>
                <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{m.aplicado_en ? 'Cambios aplicados' : 'Cambios que propone'}</span>
                {(m.resultado ? m.resultado.split('\n') : m.acciones.map((a) => `• ${a.descripcion}`)).map((l, i) => (
                  <span key={i} className="text-[12.5px]" style={{ color: l.startsWith('✗') ? 'var(--bad)' : TEXTO_PRIMARIO }}>{l}</span>
                ))}
                {!m.aplicado_en && (
                  <Boton tamano="sm" variante="primario" icono={Check} className="self-start mt-1" disabled={!!aplicando} onClick={() => aplicar(m)}>
                    {aplicando === m.id ? 'Aplicando…' : 'Aplicar'}
                  </Boton>
                )}
              </div>
            )}
          </div>
        ))}
        {pensando && <span className="self-start text-[12.5px] italic" style={{ color: TEXTO_TERCIARIO }}>Pensando…</span>}
        <div ref={final} />
      </div>

      <div className="flex gap-2 p-3" style={{ borderTop: `1px solid ${BORDE}` }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          rows={2}
          placeholder="Escribe aquí… (Enter envía, Shift+Enter hace un salto de línea)"
          aria-label="Mensaje para el asistente"
          className="flex-1 rounded-lg outline-none text-[13.5px] bg-[var(--surface)] resize-none"
          style={estiloArea}
        />
        <Boton variante="primario" icono={Send} onClick={() => enviar()} disabled={pensando || !texto.trim()} aria-label="Enviar">Enviar</Boton>
      </div>
    </Tarjeta>
  );
}
