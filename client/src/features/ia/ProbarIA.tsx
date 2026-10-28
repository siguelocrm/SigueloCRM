import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';
import { TIPOS_AVISO, type TipoAviso } from './tipos';
import type { Negocio } from '../negocios/useNegocios';

type Resultado = {
  resumen: string;
  interes: string;
  no_quiere_mas: boolean;
  etapa: string | null;
  necesita_al_dueno: boolean;
  motivo: string;
  aviso: TipoAviso | null;
  puede_responder: boolean;
  respuesta: string;
  respuestas_rapidas: string[];
  grupo: string | null;
  qr?: string | null;
  bot?: string | null;
  pase: { negocio: string; mensaje: string; nota: string } | null;
};

const EJEMPLOS = ['¿Dónde están ubicados?', '¿Cuánto cuesta?', 'Vivo lejos, ¿tienen otra sucursal?', 'Ya no me escriban, gracias', 'Quiero hablar con una persona'];

// Qué haría la IA con el mensaje de un cliente inventado, sin enviarle nada a nadie.
export default function ProbarIA({ negocios, hayClave }: { negocios: Negocio[]; hayClave: boolean }) {
  const toast = useToast();
  const [negocioId, setNegocioId] = useState(negocios[0]?.id ?? '');
  const [texto, setTexto] = useState('');
  const [probando, setProbando] = useState(false);
  const [r, setR] = useState<Resultado | null>(null);

  const probar = async () => {
    if (!negocioId) return toast('Elige un negocio.', 'error');
    if (!texto.trim()) return toast('Escribe el mensaje del cliente.', 'error');
    setProbando(true);
    setR(null);
    try {
      const res = await llamarBackend('/siguelo/ia/probar', { negocio_id: negocioId, texto });
      if (!res.ok) return toast(res.error || 'No se pudo probar.', 'error');
      setR(res.data.resultado);
    } catch {
      toast('No se pudo hablar con el servidor. ¿Está prendido (npm run dev)?', 'error');
    } finally {
      setProbando(false);
    }
  };

  const linea = (titulo: string, valor: string | null | undefined, color?: string) =>
    valor ? (
      <div className="flex gap-2 text-[12.5px]">
        <span className="shrink-0 font-semibold" style={{ color: TEXTO_SECUNDARIO, minWidth: 150 }}>{titulo}</span>
        <span className="min-w-0 break-words whitespace-pre-wrap" style={{ color: color || TEXTO_PRIMARIO }}>{valor}</span>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <p className="m-0 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
        Escribe lo que diría un cliente y mira qué haría la IA con la ficha de ese negocio. No se le envía nada a nadie (sí cuenta como una consulta).
      </p>
      {!hayClave && <span className="text-[12.5px]" style={{ color: 'var(--warn)' }}>Primero guarda tu clave de OpenAI en Ajustes.</span>}
      <Tarjeta className="p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
          Negocio
          <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} className={`${claseCampo} font-normal`} style={estiloCampo}>
            {negocios.length === 0 && <option value="">Primero crea tus negocios</option>}
            {negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        </label>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder="¿Tienen envíos a El Alto?" aria-label="Mensaje del cliente" className="rounded-lg outline-none text-[13px] bg-[var(--surface)]" style={estiloArea} />
        <div className="flex flex-wrap gap-1.5">
          {EJEMPLOS.map((e) => (
            <button key={e} onClick={() => setTexto(e)} className="rounded-full px-2.5 text-[12px]" style={{ height: 26, border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>{e}</button>
          ))}
        </div>
        <Boton variante="primario" icono={FlaskConical} className="self-start" onClick={probar} disabled={probando || !hayClave}>{probando ? 'Pensando…' : 'Probar'}</Boton>
      </Tarjeta>
      {r && (
        <Tarjeta className="p-4 flex flex-col gap-2">
          {linea('Lo que entendió', r.resumen)}
          {linea('Le interesa', r.interes)}
          {linea('Respondería', r.respuesta || (r.necesita_al_dueno ? '(no responde: no está en la ficha)' : '(nada)'), r.respuesta ? 'var(--ok)' : TEXTO_TERCIARIO)}
          {linea('Respuestas rápidas', r.respuestas_rapidas.join(', '))}
          {linea('Invitaría al grupo', r.grupo)}
          {linea('Le mandaría el QR de pago de', r.qr ?? null)}
          {linea('Activaría del bot', r.bot ?? null)}
          {r.pase && linea(`Pase a ${r.pase.negocio}`, `${r.pase.mensaje}\n(nota: ${r.pase.nota})`)}
          {linea('Pasaría a la etapa', r.etapa)}
          {r.no_quiere_mas && linea('No quiere más', 'Sí: pasa a la etapa perdida y no se le escribe más', 'var(--bad)')}
          {(r.necesita_al_dueno || r.aviso) && linea('Para que lo veas', `${r.aviso ? `${TIPOS_AVISO[r.aviso]}: ` : ''}${r.motivo}`, 'var(--warn)')}
        </Tarjeta>
      )}
    </div>
  );
}
