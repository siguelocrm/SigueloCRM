import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { EncabezadoPagina, Tarjeta } from '../../components/ui';
import { useEtapasVenta } from '../bandeja/hooks/useEtapasVenta';
import { useNegocios } from '../negocios/useNegocios';
import PagosInscripcion from './PagosInscripcion';
import CursosInscripcion from './CursosInscripcion';
import ReporteInscripcion from './ReporteInscripcion';
import type { Curso } from './tipos';

type Pestana = 'pagos' | 'cursos' | 'reporte';
const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'pagos', texto: 'Pagos' },
  { id: 'cursos', texto: 'Cursos' },
  { id: 'reporte', texto: 'Inscritos' },
];

// Inscripción con pago (SígueloCRM, Fase 5): el cliente paga con el QR, manda el
// comprobante y el servidor (server/src/siguelo/pagos) lo revisa con la IA.
export default function Inscripciones({ onAbrirChat }: { onAbrirChat?: (telefono: string) => void }) {
  const { usuario } = useAuth();
  const negocios = useNegocios(usuario?.empresa_id);
  const etapas = useEtapasVenta(usuario?.empresa_id);
  const [pestana, setPestana] = useState<Pestana>('pagos');
  const [cursos, setCursos] = useState<Curso[] | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [zona, setZona] = useState('America/La_Paz');
  const [iaLista, setIaLista] = useState(true);
  const puedeEditar = usuario?.rol === 'dueno' || usuario?.rol === 'supervisor';

  const cargar = useCallback(async () => {
    const [k, aj, ia] = await Promise.all([
      supabase.from('siguelo_cursos').select('*').order('creado_en').returns<Curso[]>(),
      supabase.from('siguelo_ajustes').select('zona_horaria').maybeSingle(),
      supabase.from('siguelo_ia').select('activa, clave_final').maybeSingle(),
    ]);
    if (k.error) return setFaltaSql(true);
    setFaltaSql(false);
    setCursos(k.data || []);
    if (aj.data?.zona_horaria) setZona(aj.data.zona_horaria);
    setIaLista(!!ia.data?.activa && !!ia.data?.clave_final);
    if (!(k.data || []).length) setPestana((p) => (p === 'pagos' ? 'cursos' : p));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (faltaSql) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
        <EncabezadoPagina titulo="Inscripciones" />
        <Tarjeta className="p-5 flex items-start gap-3 max-w-2xl" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={20} color="var(--warn)" className="shrink-0 mt-0.5" />
          <div className="text-[13px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <div className="font-bold text-[14px] mb-1" style={{ color: TEXTO_PRIMARIO }}>Falta preparar la base de datos</div>
            Entra a tu Supabase → <b>SQL Editor</b>, pega todo el archivo <b>database/siguelo.sql</b> y pulsa <b>Run</b>. Es seguro repetirlo.
          </div>
        </Tarjeta>
      </div>
    );
  }
  if (!cursos || !usuario) return <div className="p-6 text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina titulo="Inscripciones" subtitulo="El cliente paga con el QR y manda el comprobante: la IA lo revisa, le confirma, le pide sus datos y le manda el link del grupo." />
      {!iaLista && (
        <Tarjeta className="px-4 py-3 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Los comprobantes los lee la IA: actívala y guarda tu clave de OpenAI en <b>Automatizar → IA → Ajustes</b>. Mientras tanto no se revisan.
        </Tarjeta>
      )}
      <div role="tablist" className="flex gap-1 overflow-x-auto shrink-0" style={{ borderBottom: `1px solid ${BORDE}` }}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => setPestana(p.id)}
            className="px-3 py-2 text-[13px] whitespace-nowrap -mb-px"
            style={{ color: pestana === p.id ? 'var(--accent)' : TEXTO_SECUNDARIO, fontWeight: pestana === p.id ? 600 : 500, borderBottom: `2px solid ${pestana === p.id ? 'var(--accent)' : 'transparent'}` }}
          >
            {p.texto}
          </button>
        ))}
      </div>
      {pestana === 'pagos' && <PagosInscripcion cursos={cursos} zona={zona} puedeEditar={puedeEditar} onAbrirChat={onAbrirChat} />}
      {pestana === 'cursos' && (
        <CursosInscripcion
          empresaId={usuario.empresa_id}
          cursos={cursos}
          negocios={negocios.disponible ? negocios.negocios : []}
          etapas={[...etapas].sort((a, b) => a.orden - b.orden)}
          puedeEditar={puedeEditar}
          onGuardado={cargar}
        />
      )}
      {pestana === 'reporte' && <ReporteInscripcion cursos={cursos} zona={zona} />}
    </div>
  );
}
