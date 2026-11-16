import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { llamarBackend } from '../../lib/backend';
import { useToast } from '../../components/ui';
import type { Conversacion, Mensaje } from '../../lib/tipos';

// El botón "Responder con IA" de la bandeja: la IA lee este chat ahora y le
// responde al cliente sí o sí (con un texto, una respuesta rápida, la
// ubicación... lo que corresponda), aunque sola no lo haya hecho. Al lado se
// ve por qué no respondió sola el último mensaje del cliente.

type Registro = { tipo: string; texto: string; creado_en: string };

// De lo que anotó la IA, el motivo por el que no respondió (null si respondió).
function motivoDe(r: Registro): string | null {
  if (r.tipo === 'ia_error') return r.texto.replace(/^IA:\s*/, '');
  const i = r.texto.indexOf('no le respondió');
  if (i >= 0) return r.texto.slice(i).split(' · ')[0].replace(/\.$/, '').replace(/^no le respondió:?\s*/, '');
  const j = r.texto.indexOf('respuesta lista para que la apruebes');
  if (j >= 0) return r.texto.slice(j).split(' · ')[0];
  return null;
}

export default function ResponderIA({ seleccionada, mensajes, contactoId }: { seleccionada: Conversacion; mensajes: Mensaje[]; contactoId: string | null }) {
  const toast = useToast();
  const [respondiendo, setRespondiendo] = useState(false);
  const [ultimo, setUltimo] = useState<Registro | null>(null);
  const ultimoMensaje = mensajes[mensajes.length - 1];

  const cargar = useCallback(async () => {
    if (!contactoId) return setUltimo(null);
    const { data } = await supabase
      .from('siguelo_registro')
      .select('tipo, texto, creado_en')
      .eq('contacto_id', contactoId)
      .in('tipo', ['ia', 'ia_error'])
      .order('creado_en', { ascending: false })
      .limit(1);
    setUltimo((data?.[0] as Registro | undefined) ?? null);
  }, [contactoId]);

  useEffect(() => {
    setUltimo(null);
    cargar();
    // Lo que la IA decide tarda unos segundos: se vuelve a mirar.
    const t = setTimeout(cargar, 8000);
    return () => clearTimeout(t);
  }, [cargar, seleccionada.id, ultimoMensaje?.id]);

  // Solo si el cliente espera respuesta (fue el último en escribir).
  const espera = ultimoMensaje?.remitente === 'cliente';
  const haceMs = espera ? Date.now() - new Date(ultimoMensaje.creado_en).getTime() : 0;
  let motivo: string | null = null;
  if (espera && ultimo && new Date(ultimo.creado_en).getTime() >= new Date(ultimoMensaje.creado_en).getTime()) motivo = motivoDe(ultimo);
  else if (espera && haceMs > 90_000 && haceMs < 48 * 3600_000) motivo = 'la IA todavía no leyó su último mensaje';

  const responder = async () => {
    if (respondiendo) return;
    setRespondiendo(true);
    try {
      const r = await llamarBackend('/siguelo/ia/responder', { conversacion_id: seleccionada.id, linea_id: seleccionada.linea_id });
      if (!r.ok) toast(r.error || 'No se pudo pedir la respuesta a la IA.', 'error');
      else if (r.data?.ok) toast(`IA ${r.data.mensaje}`, 'ok');
      else toast(`La IA no respondió: ${String(r.data?.mensaje || 'sin motivo').replace(/^no le respondió:?\s*/, '')}`, 'error');
    } catch {
      toast('No se pudo conectar con el servidor del CRM.', 'error');
    } finally {
      setRespondiendo(false);
      cargar();
    }
  };

  return (
    <>
      {motivo && !respondiendo && (
        <button
          onClick={() => toast(`La IA no respondió: ${motivo}`, 'info')}
          title={`La IA no respondió: ${motivo}`}
          className="order-last w-full text-left text-[12px] leading-snug line-clamp-2"
          style={{ color: 'var(--warn)' }}
        >
          ⚠️ La IA no respondió: {motivo}
        </button>
      )}
      <span className="flex-1" />
      <button
        onClick={responder}
        disabled={respondiendo}
        aria-label="Responder con IA: la IA le contesta ahora a este cliente"
        title="La IA lee este chat y le responde ahora al cliente (texto, respuesta rápida, ubicación… lo que corresponda)"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-[3px] text-[12.5px] font-medium"
        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--line)', opacity: respondiendo ? 0.7 : 1 }}
      >
        {respondiendo ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
        {respondiendo ? 'La IA está respondiendo…' : 'Responder con IA'}
      </button>
    </>
  );
}
