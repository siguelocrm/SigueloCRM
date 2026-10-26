import { useEffect, useMemo, useState } from 'react';
import { Columns3, Smartphone } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO } from '../../lib/tema';
import type { Contacto, EtapaVenta } from '../../lib/tipos';
import { useNegocios } from './useNegocios';

const CLAVE = 'siguelo-embudo-elegido';
const leer = () => {
  try {
    return localStorage.getItem(CLAVE) || '';
  } catch {
    return '';
  }
};
const guardar = (v: string) => {
  try {
    localStorage.setItem(CLAVE, v);
  } catch {
    // sin almacenamiento: no se recuerda la elección
  }
};

// Para la pantalla Embudo: qué embudo mirar (el principal o el propio de un
// negocio) y, si hay varios números, de cuál número. Si la Fase 2 de
// database/siguelo.sql no está pegada, no filtra nada.
export function useFiltroEmbudo(empresaId: string | undefined) {
  const datos = useNegocios(empresaId);
  const [embudoId, setEmbudoId] = useState(leer); // '' = principal
  const [lineaId, setLineaId] = useState('');
  const [telefonosDeLinea, setTelefonosDeLinea] = useState<Set<string> | null>(null);

  // Si el embudo guardado ya no existe, vuelve al principal.
  const embudoValido = embudoId && datos.embudos.some((e) => e.id === embudoId) ? embudoId : '';

  useEffect(() => {
    if (!lineaId) {
      setTelefonosDeLinea(null);
      return;
    }
    let vivo = true;
    supabase
      .from('conversaciones')
      .select('contacto_telefono')
      .eq('linea_id', lineaId)
      .returns<{ contacto_telefono: string }[]>()
      .then(({ data }) => vivo && setTelefonosDeLinea(new Set((data || []).map((c) => c.contacto_telefono))));
    return () => {
      vivo = false;
    };
  }, [lineaId]);

  const elegirEmbudo = (id: string) => {
    setEmbudoId(id);
    guardar(id);
  };

  const filtrarEtapas = useMemo(
    () => (etapas: EtapaVenta[]) => (datos.disponible ? etapas.filter((e) => (datos.embudoDeEtapa[e.id] || '') === embudoValido) : etapas),
    [datos.disponible, datos.embudoDeEtapa, embudoValido],
  );

  const filtrarContactos = (contactos: Contacto[], etapasVisibles: EtapaVenta[]) => {
    if (!datos.disponible) return contactos;
    const ids = new Set(etapasVisibles.map((e) => e.id));
    return contactos.filter(
      (c) => (c.etapa_id ? ids.has(c.etapa_id) : !embudoValido) && (!telefonosDeLinea || telefonosDeLinea.has(c.telefono)),
    );
  };

  const hayEmbudos = datos.disponible && datos.embudos.length > 0;
  const hayLineas = datos.lineas.length > 1;
  const estiloSelector = { border: `1px solid ${BORDE}`, backgroundColor: 'var(--surface)', color: TEXTO_PRIMARIO };

  const selector =
    hayEmbudos || hayLineas ? (
      <>
        {hayEmbudos && (
          <label className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px]" style={estiloSelector}>
            <Columns3 size={14} style={{ color: TEXTO_SECUNDARIO }} />
            <select value={embudoValido} onChange={(e) => elegirEmbudo(e.target.value)} aria-label="Embudo" className="bg-transparent outline-none max-w-[180px]" style={{ color: TEXTO_PRIMARIO }}>
              <option value="">Embudo principal</option>
              {datos.embudos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
        )}
        {hayLineas && (
          <label className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px]" style={estiloSelector}>
            <Smartphone size={14} style={{ color: TEXTO_SECUNDARIO }} />
            <select value={lineaId} onChange={(e) => setLineaId(e.target.value)} aria-label="Número" className="bg-transparent outline-none max-w-[160px]" style={{ color: TEXTO_PRIMARIO }}>
              <option value="">Todos los números</option>
              {datos.lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
        )}
      </>
    ) : null;

  return {
    selector,
    filtrarEtapas,
    filtrarContactos,
    // null = embudo principal
    embudoPropio: embudoValido ? datos.embudos.find((e) => e.id === embudoValido) ?? null : null,
    datos,
  };
}
