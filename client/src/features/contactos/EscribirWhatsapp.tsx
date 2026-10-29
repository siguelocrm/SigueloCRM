import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from '../../components/ui';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import type { EstadoLinea } from '../../lib/tipos';
import { conSesion } from '../../lib/backend';

const backendUrl = import.meta.env.VITE_BACKEND_URL;
const VERDE_WHATSAPP = '#25D366';

interface LineaEnvio {
  id: string;
  nombre: string;
  estado: EstadoLinea;
}

interface FormWhatsappProps {
  // Teléfono tal como lo espera /enviar: si ya hay conversación conviene
  // pasar su contacto_telefono (puede traer el @lid), si no el del contacto.
  telefono: string;
  // Línea de la conversación más reciente, para responder por la misma.
  lineaSugerida?: string | null;
  texto: string;
  onTexto: (texto: string) => void;
  onEnviado?: () => void;
  autoFocus?: boolean;
}

// Mismo criterio que mensajeErrorEnvio en bandeja/Compositor.tsx: mostrar el
// motivo puntual del backend (ej. "Esa línea de WhatsApp no está conectada").
async function motivoError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    if (typeof data?.error === 'string' && data.error) return data.error;
  } catch {
    // el body no era JSON
  }
  return 'No se pudo enviar por WhatsApp. Revisá que el backend esté corriendo.';
}

// Escribe directo por WhatsApp a un contacto sin pasar por la bandeja. El
// backend (server/src/routes/enviar.ts) crea la conversación si no existía.
export function FormWhatsapp({ telefono, lineaSugerida, texto, onTexto, onEnviado, autoFocus }: FormWhatsappProps) {
  const { usuario } = useAuth();
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaEnvio[]>([]);
  const [lineaId, setLineaId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const enviandoRef = useRef(false);

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase.from('lineas_whatsapp').select('id, nombre, estado').order('nombre').returns<LineaEnvio[]>();
      const lista = data || [];
      setLineas(lista);
      const sugerida = lista.find((l) => l.id === lineaSugerida && l.estado === 'activo');
      setLineaId(sugerida?.id || lista.find((l) => l.estado === 'activo')?.id || lineaSugerida || lista[0]?.id || '');
    };
    cargar();
  }, [usuario?.empresa_id, lineaSugerida]);

  const lineaElegida = lineas.find((l) => l.id === lineaId);
  const puedeEnviar = !!texto.trim() && !!lineaId && !enviando;

  const enviar = async () => {
    if (enviandoRef.current || !puedeEnviar || !usuario) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError('');
    try {
      const resp = await fetch(`${backendUrl}/enviar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ telefono, tipo: 'texto', texto, agente_id: usuario.id, linea_id: lineaId }),
      });
      if (!resp.ok) throw new Error(await motivoError(resp));
      // Igual que el Compositor: sube la conversación arriba en la bandeja.
      await supabase.from('conversaciones').update({ ultima_actividad: new Date().toISOString() }).eq('contacto_telefono', telefono).eq('linea_id', lineaId);
      onTexto('');
      toast('Mensaje enviado por WhatsApp.', 'ok');
      onEnviado?.();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'No se pudo enviar por WhatsApp.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {lineas.length > 1 && (
        <label className="flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase" style={{ color: TEXTO_TERCIARIO }}>
          Enviar desde
          <select
            value={lineaId}
            onChange={(e) => setLineaId(e.target.value)}
            className="flex-1 min-w-0 rounded-lg pl-2.5 pr-1.5 py-1.5 text-[12.5px] font-semibold normal-case tracking-normal outline-none cursor-pointer"
            style={{ border: '1px solid var(--line)', color: TEXTO_PRIMARIO, backgroundColor: 'var(--surface)' }}
          >
            {lineas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}{l.estado !== 'activo' ? ' (desconectada)' : ''}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          autoFocus={autoFocus}
          rows={2}
          placeholder="Escribí un mensaje de WhatsApp..."
          className="flex-1 rounded-lg px-3 py-2 outline-none text-[13px] resize-none leading-snug"
          style={{ minHeight: 44, maxHeight: 160, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO, backgroundColor: 'var(--surface)' }}
        />
        <button
          onClick={enviar}
          disabled={!puedeEnviar}
          aria-label="Enviar por WhatsApp"
          className="rounded-lg flex items-center justify-center shrink-0"
          style={{ width: 44, height: 44, backgroundColor: puedeEnviar ? VERDE_WHATSAPP : 'var(--line)', color: puedeEnviar ? 'white' : TEXTO_TERCIARIO }}
        >
          <Send size={16} />
        </button>
      </div>
      {lineaElegida && lineaElegida.estado !== 'activo' && (
        <span className="text-[11.5px]" style={{ color: 'var(--warn, #B54708)' }}>La línea "{lineaElegida.nombre}" no está conectada; el envío va a fallar.</span>
      )}
      {lineas.length === 0 && <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>No hay líneas de WhatsApp configuradas.</span>}
      {error && <span className="text-[11.5px]" style={{ color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}

interface ModalWhatsappProps {
  nombre: string;
  telefono: string;
  lineaSugerida?: string | null;
  onCerrar: () => void;
  onAbrirChat?: () => void;
}

export function ModalWhatsapp({ nombre, telefono, lineaSugerida, onCerrar, onAbrirChat }: ModalWhatsappProps) {
  const [texto, setTexto] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(2,8,20,.6)', backdropFilter: 'blur(4px)' }} onClick={onCerrar}>
      <div role="dialog" aria-label="Escribir por WhatsApp" onClick={(e) => e.stopPropagation()} className="aparecer w-full flex flex-col" style={{ maxWidth: 480, backgroundColor: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 18, boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#E7F8EE', color: '#128C4B' }}>
            <MessageCircle size={17} />
          </span>
          <div className="flex-1 min-w-0 flex flex-col">
            <h2 className="disp font-bold text-[16px] m-0 truncate" style={{ color: 'var(--fg)' }}>{nombre}</h2>
            <span className="text-xs truncate" style={{ color: TEXTO_SECUNDARIO, fontFamily: 'var(--fuente-mono)' }}>{telefono.split('@')[0]}</span>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"><X size={18} color="var(--fg-2)" /></button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <FormWhatsapp telefono={telefono} lineaSugerida={lineaSugerida} texto={texto} onTexto={setTexto} onEnviado={onCerrar} autoFocus />
          {onAbrirChat && (
            <button onClick={onAbrirChat} className="self-start text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
              Abrir el chat completo en la bandeja →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
