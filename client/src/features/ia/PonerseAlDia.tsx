import { useCallback, useEffect, useState } from 'react';
import { MessageSquareReply, Square } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';

// "Ponerse al día" (server/src/siguelo/ia/alDia.ts): cuando un número estuvo desconectado o
// restringido por WhatsApp, los mensajes que llegaron mientras tanto tienen más de 2 horas y la IA
// no los responde sola. Aquí ves cuántos chats quedaron sin respuesta en cada número (últimas 48 h) y
// la IA los responde despacio: cada número con su propia fila, a la vez, de 45 a 90 s entre chat y chat.

type Numero = { id: string; nombre: string; pendientes: number; conectado?: boolean };
type Progreso = { linea_id: string; numero: string; total: number; hechos: number; respondidos: number; activo: boolean; ultimo: string };

export default function PonerseAlDia() {
  const toast = useToast();
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [progreso, setProgreso] = useState<Progreso[]>([]);
  const [revisando, setRevisando] = useState(false);

  const revisar = useCallback(async () => {
    setRevisando(true);
    const r = await llamarBackend('/siguelo/ia/al-dia/revisar', {}).catch(() => ({ ok: false, data: null, error: 'No hay conexión con el servidor del CRM.' }));
    setRevisando(false);
    if (!r.ok) return toast(r.error || 'No se pudo revisar.', 'error');
    setNumeros(r.data.numeros);
    setProgreso(r.data.progreso ?? []);
  }, [toast]);

  const activos = progreso.filter((p) => p.activo);
  const hayActivos = activos.length > 0;
  const actualizar = useCallback(async () => {
    const r = await llamarBackend('/siguelo/ia/al-dia', {}, 'GET').catch(() => null);
    if (r?.ok) setProgreso(r.data.progreso ?? []);
  }, []);

  // Mientras responde, se actualiza cada 10 s. Al abrir la página, si ya estaba respondiendo, se ve.
  useEffect(() => {
    actualizar();
  }, [actualizar]);
  useEffect(() => {
    if (!hayActivos) return;
    const t = setInterval(actualizar, 10_000);
    return () => clearInterval(t);
  }, [hayActivos, actualizar]);

  const corriendo = (id: string) => activos.some((p) => p.linea_id === id);
  const empezar = async (n: Numero | null) => {
    const lista = (numeros || []).filter((x) => x.pendientes > 0 && !corriendo(x.id) && (!n || x.id === n.id));
    const cuantos = lista.reduce((a, x) => a + x.pendientes, 0);
    const mayor = Math.max(0, ...lista.map((x) => x.pendientes));
    const minutos = Math.ceil((mayor * 70) / 60);
    const texto = lista.length > 1 ? `${cuantos} chats de ${lista.length} números (cada número con su propia fila, a la vez)` : `${cuantos} ${cuantos === 1 ? 'chat' : 'chats'}${n ? ` de ${n.nombre}` : ''}`;
    if (!window.confirm(`La IA va a leer y responder ${texto}, uno por uno en cada número (tarda unos ${minutos} min). Solo responde a quien te escribió y no le contestaron. ¿Seguimos?`)) return;
    const r = await llamarBackend('/siguelo/ia/al-dia', { linea_id: n?.id ?? null });
    if (!r.ok) return toast(r.error || 'No se pudo empezar.', 'error');
    toast(r.data.mensaje, 'ok');
    actualizar();
  };

  const detener = async (lineaId: string | null) => {
    await llamarBackend('/siguelo/ia/al-dia/detener', { linea_id: lineaId });
    setProgreso((ps) => ps.map((p) => (!lineaId || p.linea_id === lineaId ? { ...p, activo: false } : p)));
    toast('Listo: no responde más chats pendientes' + (lineaId ? ' en ese número.' : '.'), 'ok');
  };

  const total = (numeros || []).reduce((a, x) => a + x.pendientes, 0);

  return (
    <Tarjeta className="px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <MessageSquareReply size={18} color="var(--accent)" className="shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Chats que quedaron sin respuesta</div>
          <div className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
            Si un número estuvo desconectado o restringido, la IA no responde sola los mensajes de hace más de 2 horas. Aquí ves los de las últimas 48 horas y los responde despacio: cada número con su propia fila, a la vez.
          </div>
        </div>
        <Boton tamano="sm" onClick={revisar} disabled={revisando}>
          {revisando ? 'Revisando…' : numeros ? 'Revisar de nuevo' : 'Revisar'}
        </Boton>
        {activos.length > 1 && <Boton tamano="sm" variante="peligro" icono={Square} onClick={() => detener(null)}>Detener todo</Boton>}
      </div>

      {activos.map((p) => (
        <div key={p.linea_id} className="flex items-center gap-3 flex-wrap rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--surface-2)' }}>
          <span className="text-[12.5px] flex-1 min-w-[200px]" style={{ color: TEXTO_SECUNDARIO }}>
            <b style={{ color: TEXTO_PRIMARIO }}>
              {p.numero}: {p.hechos} de {p.total}
            </b>
            {' · '}
            {p.respondidos} {p.respondidos === 1 ? 'respondido' : 'respondidos'}
            {p.ultimo && <span className="block text-[11.5px] truncate" style={{ color: TEXTO_TERCIARIO }}>Último: {p.ultimo}</span>}
          </span>
          <Boton tamano="sm" variante="peligro" icono={Square} onClick={() => detener(p.linea_id)}>Detener</Boton>
        </div>
      ))}
      {progreso
        .filter((p) => !p.activo && p.hechos > 0)
        .map((p) => (
          <span key={p.linea_id} className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
            {p.numero}: leyó {p.hechos} de {p.total} y respondió {p.respondidos}. Los que no respondió tienen su motivo en IA → Resumen.
          </span>
        ))}

      {(numeros || [])
        .filter((n) => n.conectado === false)
        .map((n) => (
          <span key={n.id} className="text-[12px] rounded-lg px-3 py-2" style={{ color: 'var(--warn)', backgroundColor: 'var(--surface-2)' }}>
            <b>{n.nombre} está desconectado del CRM.</b> Lo que te escriban mientras tanto solo está en tu teléfono. Al volver a conectarlo (aunque sea con un QR nuevo), el CRM trae los mensajes de las últimas 48 horas y aparecen aquí.
          </span>
        ))}
      {numeros && (
        total === 0 ? (
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>No hay chats esperando respuesta en las últimas 48 horas.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {numeros.filter((n) => n.pendientes > 0).map((n) => (
              <Boton key={n.id} tamano="sm" disabled={corriendo(n.id)} onClick={() => empezar(n)}>
                {n.nombre}: {corriendo(n.id) ? 'respondiendo…' : `responder ${n.pendientes}`}
              </Boton>
            ))}
            {numeros.filter((n) => n.pendientes > 0 && !corriendo(n.id)).length > 1 && (
              <Boton tamano="sm" variante="primario" onClick={() => empezar(null)}>Todos a la vez ({total})</Boton>
            )}
          </div>
        )
      )}
    </Tarjeta>
  );
}
