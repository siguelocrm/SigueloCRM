import { useCallback, useEffect, useState } from 'react';
import { Check, Receipt, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from '../seguimiento/Etiqueta';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';
import { ESTADOS, formatoMonto, type Curso, type Pago } from './tipos';

type Filtro = 'atender' | 'todos';

interface Props {
  cursos: Curso[];
  zona: string;
  puedeEditar: boolean;
  onAbrirChat?: (telefono: string) => void;
}

// Los comprobantes que llegaron: los que tienes que revisar arriba, con lo que
// leyó la IA y cada control. Confirmar o rechazar lo hace el servidor.
export default function PagosInscripcion({ cursos, zona, puedeEditar, onAbrirChat }: Props) {
  const toast = useToast();
  const [filtro, setFiltro] = useState<Filtro>('atender');
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [cursoElegido, setCursoElegido] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    let q = supabase
      .from('siguelo_pagos')
      .select('*, contactos(nombre)')
      .neq('estado', 'no_es')
      .order('creado_en', { ascending: false })
      .limit(100);
    if (filtro === 'atender') q = q.in('estado', ['revisar', 'leyendo', 'datos', 'reservado']);
    const { data } = await q.returns<Pago[]>();
    setPagos(data || []);
  }, [filtro]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [cargar]);

  const pedir = async (p: Pago, accion: 'confirmar' | 'rechazar') => {
    const curso = cursoElegido[p.id] || p.curso_id;
    if (accion === 'confirmar' && !curso) return toast('Elige de qué curso es el pago.', 'error');
    let motivo = p.motivo;
    if (accion === 'rechazar') {
      const r = window.prompt('¿Por qué se rechaza? (se lo decimos al cliente)', 'el pago no llegó a nuestra cuenta');
      if (r === null) return;
      motivo = r.trim() || 'no pudimos validar los datos del pago';
    } else {
      const delClub = cursos.find((k) => k.id === curso)?.club;
      const pregunta =
        p.estado === 'reservado' ? '¿Mandarle el link del grupo ya, sin esperar que confirmes la reserva en tu sistema del club?'
        : p.estado === 'datos' && delClub ? '¿Volver a intentar dejar la reserva en tu sistema del club con los datos que tiene?'
        : p.estado === 'datos' ? '¿Mandarle el link del grupo sin esperar sus datos?'
        : '¿Confirmar este pago? Se le avisa al cliente y se le piden sus datos.';
      if (!window.confirm(pregunta)) return;
    }
    const { error } = await supabase.from('siguelo_pagos').update({ accion, curso_id: curso, motivo, actualizado_en: new Date().toISOString() }).eq('id', p.id);
    if (error) return toast(`No se pudo: ${error.message}`, 'error');
    toast(accion === 'confirmar' ? 'Listo: el servidor lo confirma en unos segundos' : 'Listo: el servidor le avisa al cliente', 'ok');
    cargar();
  };

  const fecha = (iso: string) => new Intl.DateTimeFormat('es', { timeZone: zona, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const nombreCurso = (id: string | null) => cursos.find((k) => k.id === id)?.nombre;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        {(['atender', 'todos'] as Filtro[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className="px-3 h-8 rounded-full text-[12.5px] font-medium"
            style={{ border: `1px solid ${filtro === f ? 'var(--accent)' : BORDE}`, color: filtro === f ? 'var(--accent)' : TEXTO_SECUNDARIO }}
          >
            {f === 'atender' ? 'Por atender' : 'Todos'}
          </button>
        ))}
      </div>
      {pagos.length === 0 ? (
        <Tarjeta className="flex">
          <EstadoVacio icono={Receipt} titulo={filtro === 'atender' ? 'Nada por atender' : 'Todavía no llegaron comprobantes'} texto="Cuando un cliente manda la foto de su comprobante, aparece aquí." />
        </Tarjeta>
      ) : (
        pagos.map((p) => {
          const e = ESTADOS[p.estado];
          const curso = cursos.find((k) => k.id === p.curso_id);
          const pendiente = p.accion ? (p.accion === 'confirmar' ? 'Confirmando…' : 'Rechazando…') : '';
          return (
            <Tarjeta key={p.id} className="p-3.5 flex gap-3 flex-wrap">
              {p.media_url && (
                <a href={p.media_url} target="_blank" rel="noreferrer" className="shrink-0" title="Ver el comprobante">
                  {/\.pdf($|\?)/i.test(p.media_url) ? (
                    <span className="w-20 h-28 rounded-lg flex items-center justify-center text-[12px] font-semibold" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>PDF</span>
                  ) : (
                    <img src={p.media_url} alt="Comprobante" className="w-20 h-28 object-cover rounded-lg" style={{ border: `1px solid ${BORDE}` }} />
                  )}
                </a>
              )}
              <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{p.contactos?.nombre || `+${p.telefono.split('@')[0]}`}</span>
                  <Etiqueta color={e.color}>{pendiente || e.texto}</Etiqueta>
                  <span className="text-[12px] ml-auto" style={{ color: TEXTO_TERCIARIO }}>{fecha(p.creado_en)}</span>
                </div>
                <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                  {formatoMonto(p.monto, curso?.moneda || 'Bs')} · {nombreCurso(p.curso_id) || 'curso sin identificar'}
                  {p.transaccion && ` · Tx ${p.transaccion}`}
                  {p.lectura?.pagador && ` · pagó ${p.lectura.pagador}`}
                </span>
                {p.motivo && p.estado !== 'inscrito' && <span className="text-[12.5px]" style={{ color: p.estado === 'rechazado' ? 'var(--bad)' : 'var(--warn)' }}>{p.motivo}</span>}
                {p.controles.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {p.controles.map((c) => (
                      <span key={c.codigo} className="flex items-center gap-1 text-[11.5px]" style={{ color: c.ok ? TEXTO_TERCIARIO : 'var(--warn)' }} title={c.detalle}>
                        {c.ok ? <Check size={12} color="var(--ok)" /> : <X size={12} color="var(--bad)" />}
                        {c.nombre}
                      </span>
                    ))}
                  </div>
                )}
                {Object.keys(p.datos || {}).length > 0 && (
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Datos recibidos: {Object.values(p.datos).join(' · ')}</span>
                )}
                {p.club && (p.club.tutor || p.club.estudiantes.length > 0) && (
                  <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
                    Para el club: {[p.club.tutor && `tutor ${p.club.tutor}`, ...p.club.estudiantes.map((e) => [e.nombre, e.fecha_nacimiento, e.curso_texto].filter(Boolean).join(', '))].filter(Boolean).join(' · ')}
                  </span>
                )}
                {p.estado === 'reservado' && (
                  <span className="text-[12px]" style={{ color: 'var(--accent)' }}>Confírmala en tu sistema del club → Reservas de vendedores. Al confirmarla, le llega el link solo.</span>
                )}
                <div className="flex gap-1.5 flex-wrap items-center mt-1">
                  {puedeEditar && !pendiente && (p.estado === 'revisar' || p.estado === 'rechazado') && (
                    <>
                      {!p.curso_id && (
                        <select value={cursoElegido[p.id] || ''} onChange={(ev) => setCursoElegido({ ...cursoElegido, [p.id]: ev.target.value })} aria-label="Curso" className={claseCampo} style={{ ...estiloCampo, height: 32 }}>
                          <option value="">¿De qué curso es?</option>
                          {cursos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                        </select>
                      )}
                      <Boton tamano="sm" variante="primario" icono={Check} onClick={() => pedir(p, 'confirmar')}>Confirmar pago</Boton>
                      {p.estado === 'revisar' && <Boton tamano="sm" variante="peligro" icono={X} onClick={() => pedir(p, 'rechazar')}>Rechazar</Boton>}
                    </>
                  )}
                  {puedeEditar && !pendiente && (p.estado === 'datos' || p.estado === 'reservado') && (
                    <Boton tamano="sm" onClick={() => pedir(p, 'confirmar')}>{p.estado === 'datos' && curso?.club ? 'Volver a intentar la reserva' : 'Mandarle el link ya'}</Boton>
                  )}
                  {onAbrirChat && <Boton tamano="sm" variante="fantasma" onClick={() => onAbrirChat(p.telefono)}>Abrir chat</Boton>}
                </div>
              </div>
            </Tarjeta>
          );
        })
      )}
    </div>
  );
}
