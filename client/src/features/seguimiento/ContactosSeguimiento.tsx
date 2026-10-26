import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Search, Pause, Play, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorEtiquetaWhatsapp } from '../../lib/tema';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from './Etiqueta';
import type { EtapaVenta } from '../../lib/tipos';
import type { EtapaSeguimiento, SeguimientoContacto } from './tipos';
import { claseCampo, estiloCampo } from './estilos';

type Filtro = 'todos' | 'respondieron' | 'pausados';

interface Props {
  etapas: EtapaVenta[];
  configs: Record<string, EtapaSeguimiento>;
}

// Contactos que el seguimiento tiene en cuenta, con en qué va cada uno. Desde
// acá se pausa a alguien o se lo marca como atendido.
export default function ContactosSeguimiento({ etapas, configs }: Props) {
  const toast = useToast();
  const [filas, setFilas] = useState<SeguimientoContacto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('siguelo_seguimientos')
      .select('contacto_id, rec, react, respondio, pausado, ultimo_automatico, actualizado_en, contactos(nombre, telefono, etapa_id)')
      .order('actualizado_en', { ascending: false })
      .limit(500)
      .returns<SeguimientoContacto[]>();
    setFilas(data || []);
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 30000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  const etapaPorId = useMemo(() => Object.fromEntries(etapas.map((e) => [e.id, e])), [etapas]);

  const visibles = filas.filter((f) => {
    if (!f.contactos?.etapa_id || !configs[f.contactos.etapa_id]) return false;
    if (filtro === 'respondieron' && !f.respondio) return false;
    if (filtro === 'pausados' && !f.pausado) return false;
    const q = busqueda.trim().toLowerCase();
    return !q || (f.contactos.nombre || '').toLowerCase().includes(q) || f.contactos.telefono.includes(q);
  });

  const cambiar = async (f: SeguimientoContacto, cambios: Partial<Pick<SeguimientoContacto, 'pausado' | 'respondio'>>, aviso: string) => {
    const { error } = await supabase.from('siguelo_seguimientos').update(cambios).eq('contacto_id', f.contacto_id);
    if (error) return toast('No se pudo guardar el cambio.', 'error');
    toast(aviso, 'ok');
    setFilas((prev) => prev.map((x) => (x.contacto_id === f.contacto_id ? { ...x, ...cambios } : x)));
  };

  const lineas = (f: SeguimientoContacto): string[] => {
    const etapaId = f.contactos?.etapa_id;
    const cfg = etapaId ? configs[etapaId] : undefined;
    if (!cfg || !etapaId) return [];
    const res: string[] = [];
    const rec = cfg.recordatorios;
    if (f.rec?.previo && f.rec.etapa_id === etapaId) res.push('Ya estaba en esta etapa antes de activar el seguimiento: no recibe recordatorios.');
    else if (rec.activa && rec.pasos.length) {
      const enviados = f.rec && f.rec.etapa_id === etapaId ? Math.min(f.rec.paso, rec.pasos.length) : 0;
      res.push(`Recordatorios: ${enviados} de ${rec.pasos.length}${enviados >= rec.pasos.length ? ' (terminados)' : ''}`);
    }
    if (f.react?.activo && f.react.etapa_id === etapaId) res.push(`Reactivación en curso: ${f.react.paso} de ${cfg.reactivacion.pasos.length} enviados`);
    if (f.respondio) res.push('Respondió: sus recordatorios esperan hasta que le escribas o pulses "Atendido".');
    return res;
  };

  const FILTROS: { id: Filtro; texto: string }[] = [
    { id: 'todos', texto: 'Todos' },
    { id: 'respondieron', texto: `Respondieron (${filas.filter((f) => f.respondio).length})` },
    { id: 'pausados', texto: 'En pausa' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" color={TEXTO_TERCIARIO} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o número" aria-label="Buscar contacto" className={`${claseCampo} w-full pl-8`} style={estiloCampo} />
        </div>
        {FILTROS.map((x) => (
          <button
            key={x.id}
            onClick={() => setFiltro(x.id)}
            className="rounded-full px-3 text-[12.5px] font-semibold"
            style={{ height: 30, border: `1px solid ${filtro === x.id ? 'var(--accent)' : BORDE}`, color: filtro === x.id ? 'var(--accent)' : TEXTO_SECUNDARIO, backgroundColor: filtro === x.id ? 'var(--accent-soft)' : 'transparent' }}
          >
            {x.texto}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="text-xs" style={{ color: TEXTO_TERCIARIO }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <Tarjeta className="flex">
          <EstadoVacio icono={Users} titulo="No hay contactos acá" texto="Aparecen cuando están en una etapa con mensajes automáticos y el seguimiento está activo." />
        </Tarjeta>
      ) : (
        visibles.map((f) => {
          const etapa = f.contactos?.etapa_id ? etapaPorId[f.contactos.etapa_id] : undefined;
          return (
            <Tarjeta key={f.contacto_id} className="px-4 py-3 flex flex-wrap sm:flex-nowrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{f.contactos?.nombre || f.contactos?.telefono.split('@')[0]}</span>
                  {etapa && <Etiqueta color={colorEtiquetaWhatsapp(etapa.color)}>{etapa.nombre}</Etiqueta>}
                  {f.respondio && <Etiqueta color="var(--warn)">Respondió: atender</Etiqueta>}
                  {f.pausado && <Etiqueta color="var(--fg-2)">En pausa</Etiqueta>}
                </div>
                {lineas(f).map((l) => (
                  <div key={l} className="text-[12.5px] mt-1" style={{ color: TEXTO_SECUNDARIO }}>{l}</div>
                ))}
              </div>
              <div className="flex gap-1.5 shrink-0 flex-wrap justify-end basis-full sm:basis-auto">
                {f.respondio && (
                  <Boton tamano="sm" icono={CheckCircle2} onClick={() => cambiar(f, { respondio: false }, 'Marcado como atendido: sus recordatorios siguen')}>Atendido</Boton>
                )}
                {f.pausado ? (
                  <Boton tamano="sm" icono={Play} onClick={() => cambiar(f, { pausado: false }, 'Seguimiento reanudado')}>Reanudar</Boton>
                ) : (
                  <Boton tamano="sm" variante="fantasma" icono={Pause} onClick={() => cambiar(f, { pausado: true }, 'Contacto en pausa: no le sale nada automático')}>Pausar</Boton>
                )}
              </div>
            </Tarjeta>
          );
        })
      )}
    </div>
  );
}
