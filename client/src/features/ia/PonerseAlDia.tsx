import { useCallback, useEffect, useState } from 'react';
import { MessageSquareReply, Square } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';

// "Ponerse al día" (server/src/siguelo/ia/alDia.ts): cuando un número estuvo desconectado o
// restringido por WhatsApp, los mensajes que llegaron mientras tanto tienen más de 2 horas y la IA
// no los responde sola. Aquí ves cuántos chats quedaron sin respuesta en cada número y la IA los
// responde uno por uno, despacio (de 45 a 90 s entre uno y otro).

type Numero = { id: string; nombre: string; pendientes: number };
type Progreso = { total: number; hechos: number; respondidos: number; activo: boolean; numero: string | null; ultimo: string };

export default function PonerseAlDia() {
  const toast = useToast();
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [revisando, setRevisando] = useState(false);

  const revisar = useCallback(async () => {
    setRevisando(true);
    const r = await llamarBackend('/siguelo/ia/al-dia/revisar', {}).catch(() => ({ ok: false, data: null, error: 'No hay conexión con el servidor del CRM.' }));
    setRevisando(false);
    if (!r.ok) return toast(r.error || 'No se pudo revisar.', 'error');
    setNumeros(r.data.numeros);
    setProgreso(r.data.progreso);
  }, [toast]);

  // Mientras responde, se actualiza cada 10 s.
  useEffect(() => {
    if (!progreso?.activo) return;
    const t = setInterval(async () => {
      const r = await llamarBackend('/siguelo/ia/al-dia', {}, 'GET').catch(() => null);
      if (r?.ok) setProgreso(r.data.progreso);
    }, 10_000);
    return () => clearInterval(t);
  }, [progreso?.activo]);

  // Al abrir la página: si ya está respondiendo (lo empezaste antes), se muestra.
  useEffect(() => {
    llamarBackend('/siguelo/ia/al-dia', {}, 'GET')
      .then((r) => r.ok && r.data.progreso?.activo && setProgreso(r.data.progreso))
      .catch(() => {});
  }, []);

  const empezar = async (n: Numero | null) => {
    const cuantos = n ? n.pendientes : (numeros || []).reduce((a, x) => a + x.pendientes, 0);
    const minutos = Math.ceil((cuantos * 70) / 60);
    if (!window.confirm(`La IA va a leer y responder ${cuantos} ${cuantos === 1 ? 'chat' : 'chats'}${n ? ` de ${n.nombre}` : ''}, uno por uno (tarda unos ${minutos} min). Solo responde a quien te escribió y no le contestaron. ¿Seguimos?`)) return;
    const r = await llamarBackend('/siguelo/ia/al-dia', { linea_id: n?.id ?? null });
    if (!r.ok) return toast(r.error || 'No se pudo empezar.', 'error');
    toast(r.data.mensaje, 'ok');
    const p = await llamarBackend('/siguelo/ia/al-dia', {}, 'GET').catch(() => null);
    if (p?.ok) setProgreso(p.data.progreso);
  };

  const detener = async () => {
    await llamarBackend('/siguelo/ia/al-dia/detener', {});
    setProgreso((p) => (p ? { ...p, activo: false } : p));
    toast('Listo: no responde más chats pendientes.', 'ok');
  };

  const total = (numeros || []).reduce((a, x) => a + x.pendientes, 0);

  return (
    <Tarjeta className="px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <MessageSquareReply size={18} color="var(--accent)" className="shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Chats que quedaron sin respuesta</div>
          <div className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
            Si un número estuvo desconectado o restringido, la IA no responde sola los mensajes de hace más de 2 horas. Aquí los responde uno por uno, despacio.
          </div>
        </div>
        {!progreso?.activo && (
          <Boton tamano="sm" onClick={revisar} disabled={revisando}>
            {revisando ? 'Revisando…' : numeros ? 'Revisar de nuevo' : 'Revisar'}
          </Boton>
        )}
      </div>

      {progreso?.activo && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--surface-2)' }}>
          <span className="text-[12.5px] flex-1 min-w-[200px]" style={{ color: TEXTO_SECUNDARIO }}>
            <b style={{ color: TEXTO_PRIMARIO }}>
              Respondiendo {progreso.hechos} de {progreso.total}
              {progreso.numero ? ` (${progreso.numero})` : ''}
            </b>
            {' · '}
            {progreso.respondidos} {progreso.respondidos === 1 ? 'respondido' : 'respondidos'}
            {progreso.ultimo && <span className="block text-[11.5px] truncate" style={{ color: TEXTO_TERCIARIO }}>Último: {progreso.ultimo}</span>}
          </span>
          <Boton tamano="sm" variante="peligro" icono={Square} onClick={detener}>Detener</Boton>
        </div>
      )}
      {progreso && !progreso.activo && progreso.hechos > 0 && (
        <span className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>
          Última vez: leyó {progreso.hechos} de {progreso.total} y respondió {progreso.respondidos}. Los que no respondió tienen su motivo en IA → Resumen.
        </span>
      )}

      {numeros && !progreso?.activo && (
        total === 0 ? (
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>No hay chats esperando respuesta en las últimas 48 horas.</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {numeros.filter((n) => n.pendientes > 0).map((n) => (
              <Boton key={n.id} tamano="sm" onClick={() => empezar(n)}>
                {n.nombre}: responder {n.pendientes}
              </Boton>
            ))}
            {numeros.filter((n) => n.pendientes > 0).length > 1 && (
              <Boton tamano="sm" variante="primario" onClick={() => empezar(null)}>Todos ({total})</Boton>
            )}
          </div>
        )
      )}
    </Tarjeta>
  );
}
