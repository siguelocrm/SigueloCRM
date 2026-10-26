import { useState } from 'react';
import { ChevronDown, Plus, Trash2, Bell, RotateCcw, ArrowRight, Ban } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, BORDE, colorEtiquetaWhatsapp } from '../../lib/tema';
import { Boton, Interruptor, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from './Etiqueta';
import type { EtapaVenta } from '../../lib/tipos';
import type { EtapaSeguimiento, Modo, Secuencia } from './tipos';
import { PLANTILLAS, configVacia, copia, textoAVariantes, variablesDesconocidas, variantesATexto } from './plantillas';
import { claseCampo, describirHoras, estiloArea, estiloCampo } from './estilos';

// Mientras editas, cada paso guarda las horas y las variantes como texto (así
// las líneas --- no se reacomodan mientras escribes).
type PasoBorrador = { horas: string; texto: string };
type SecBorrador = { activa: boolean; modo: Modo; pasos: PasoBorrador[] };
type Borrador = { recordatorios: SecBorrador; reactivacion: SecBorrador; destino: string; dias: string };

const aBorradorSec = (s: Secuencia): SecBorrador => ({
  activa: s.activa,
  modo: s.modo,
  pasos: s.pasos.map((p) => ({ horas: String(p.horas), texto: variantesATexto(p.variantes) })),
});

const aBorrador = (c: EtapaSeguimiento): Borrador => ({
  recordatorios: aBorradorSec(c.recordatorios),
  reactivacion: aBorradorSec(c.reactivacion),
  destino: c.al_terminar?.etapa_id || '',
  dias: String(c.al_terminar?.dias ?? 0),
});

const numero = (t: string): number => {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// Convierte el borrador en la configuración que se guarda, o devuelve qué falta.
function deBorradorSec(b: SecBorrador, nombre: string): Secuencia | string {
  const pasos = [];
  for (const [i, p] of b.pasos.entries()) {
    const horas = numero(p.horas);
    if (Number.isNaN(horas) || horas < 0) return `${nombre}, paso ${i + 1}: escribe las horas con un número (por ejemplo 24).`;
    const variantes = textoAVariantes(p.texto);
    if (b.activa && !variantes.length) return `${nombre}, paso ${i + 1}: escribe al menos un mensaje.`;
    pasos.push({ horas, variantes });
  }
  return { activa: b.activa, modo: b.modo, pasos };
}

const resumenSec = (s: Secuencia | undefined) => (s?.activa && s.pasos.length ? s.pasos.map((p) => describirHoras(p.horas)).join(', ') : null);

interface EditorSecuenciaProps {
  titulo: string;
  ayuda: string;
  icono: typeof Bell;
  sec: SecBorrador;
  onCambiar: (s: SecBorrador) => void;
  esReactivacion?: boolean;
  deshabilitado: boolean;
}

function EditorSecuencia({ titulo, ayuda, icono: Icono, sec, onCambiar, esReactivacion, deshabilitado }: EditorSecuenciaProps) {
  const cambiarPaso = (i: number, cambios: Partial<PasoBorrador>) => onCambiar({ ...sec, pasos: sec.pasos.map((p, k) => (k === i ? { ...p, ...cambios } : p)) });
  const quitarPaso = (i: number) => onCambiar({ ...sec, pasos: sec.pasos.filter((_, k) => k !== i) });
  const agregarPaso = () => {
    const ultima = numero(sec.pasos[sec.pasos.length - 1]?.horas ?? '0');
    const horas = Number.isNaN(ultima) ? 24 : ultima + (esReactivacion ? 2 : 24);
    onCambiar({ ...sec, pasos: [...sec.pasos, { horas: String(horas), texto: '' }] });
  };
  const desde = esReactivacion ? 'de tu mensaje' : sec.modo === 'origen' ? 'de entrar a la etapa' : 'del mensaje anterior';

  return (
    <div className="flex flex-col gap-2.5 rounded-xl p-3.5" style={{ border: `1px solid ${BORDE}` }}>
      <div className="flex items-start gap-3">
        <Icono size={16} className="mt-0.5 shrink-0" color="var(--accent)" />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{titulo}</div>
          <div className="text-[12px] mt-0.5" style={{ color: TEXTO_SECUNDARIO }}>{ayuda}</div>
        </div>
        <Interruptor activo={sec.activa} onCambiar={(v) => onCambiar({ ...sec, activa: v })} etiqueta={`Activar ${titulo}`} deshabilitado={deshabilitado} />
      </div>

      {sec.activa && (
        <>
          {!esReactivacion && (
            <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              Las horas cuentan
              <select value={sec.modo} disabled={deshabilitado} onChange={(e) => onCambiar({ ...sec, modo: e.target.value as Modo })} className={claseCampo} style={{ ...estiloCampo, height: 32 }}>
                <option value="origen">desde que entra a la etapa</option>
                <option value="encadenado">desde el mensaje anterior</option>
              </select>
            </label>
          )}
          {sec.pasos.map((p, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-lg p-2.5" style={{ backgroundColor: 'var(--surface-2, var(--bg2))' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Paso {i + 1}</span>
                <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>a las</span>
                <input
                  value={p.horas}
                  disabled={deshabilitado}
                  onChange={(e) => cambiarPaso(i, { horas: e.target.value })}
                  inputMode="decimal"
                  aria-label={`Horas del paso ${i + 1}`}
                  className={`${claseCampo} w-20 text-right`}
                  style={{ ...estiloCampo, height: 30 }}
                />
                <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>h {desde}</span>
                <span className="flex-1" />
                {!deshabilitado && (
                  <button onClick={() => quitarPaso(i)} aria-label={`Quitar paso ${i + 1}`} className="p-1 rounded-md" style={{ color: TEXTO_TERCIARIO }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <textarea
                value={p.texto}
                disabled={deshabilitado}
                onChange={(e) => cambiarPaso(i, { texto: e.target.value })}
                rows={Math.min(8, Math.max(3, p.texto.split('\n').length + 1))}
                placeholder={'Hola {nombre}, ¿pudiste ver mi mensaje?\n---\nOtra forma de decirlo (opcional)'}
                aria-label={`Mensajes del paso ${i + 1}`}
                className="rounded-lg outline-none text-[13px] bg-[var(--surface)] resize-y"
                style={estiloArea}
              />
            </div>
          ))}
          {!deshabilitado && (
            <Boton tamano="sm" icono={Plus} onClick={agregarPaso} className="self-start">Agregar paso</Boton>
          )}
        </>
      )}
    </div>
  );
}

interface Props {
  etapas: EtapaVenta[];
  configs: Record<string, EtapaSeguimiento>;
  empresaId: string;
  puedeEditar: boolean;
  onGuardado: () => void;
}

export default function EtapasSeguimiento({ etapas, configs, empresaId, puedeEditar, onGuardado }: Props) {
  const toast = useToast();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);

  const abrir = (etapa: EtapaVenta) => {
    if (abierta === etapa.id) {
      setAbierta(null);
      setBorrador(null);
      return;
    }
    setAbierta(etapa.id);
    setBorrador(aBorrador(configs[etapa.id] ?? configVacia(etapa.id, empresaId)));
  };

  const cargarPlantilla = (id: string) => {
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p || !borrador) return;
    setBorrador({
      ...borrador,
      recordatorios: aBorradorSec(copia(p.recordatorios)),
      reactivacion: aBorradorSec(copia(p.reactivacion)),
      dias: borrador.destino ? borrador.dias : String(p.dias),
    });
    toast(`Ejemplo "${p.nombre}" cargado. Revísalo y pulsa Guardar.`, 'info');
  };

  const guardar = async (etapa: EtapaVenta) => {
    if (!borrador) return;
    const recordatorios = deBorradorSec(borrador.recordatorios, 'Recordatorios');
    if (typeof recordatorios === 'string') return toast(recordatorios, 'error');
    const reactivacion = deBorradorSec(borrador.reactivacion, 'Reactivación');
    if (typeof reactivacion === 'string') return toast(reactivacion, 'error');
    const dias = numero(borrador.dias || '0');
    if (borrador.destino && (Number.isNaN(dias) || dias < 0)) return toast('Escribe los días con un número (por ejemplo 7).', 'error');
    const desconocidas = variablesDesconocidas([...recordatorios.pasos, ...reactivacion.pasos].flatMap((p) => p.variantes).join('\n'));
    if (desconocidas.length) {
      return toast(`Todavía no existe ${desconocidas.map((v) => `{${v}}`).join(', ')}. Por ahora puedes usar {nombre} y {sucursal}.`, 'error');
    }
    setGuardando(true);
    const fila = {
      recordatorios,
      reactivacion,
      al_terminar: { etapa_id: borrador.destino || null, dias: borrador.destino ? dias : 0 },
      actualizado_en: new Date().toISOString(),
    };
    const actual = configs[etapa.id];
    const { error } = actual?.id
      ? await supabase.from('siguelo_etapas').update(fila).eq('id', actual.id)
      : await supabase.from('siguelo_etapas').insert({ ...fila, etapa_id: etapa.id, empresa_id: empresaId, negocio_id: null });
    setGuardando(false);
    if (error) return toast(`No se pudo guardar: ${error.message}`, 'error');
    toast(`Mensajes de "${etapa.nombre}" guardados`, 'ok');
    onGuardado();
  };

  const quitar = async (etapa: EtapaVenta) => {
    if (!window.confirm(`¿Quitar todos los mensajes automáticos de "${etapa.nombre}"? Lo que esté en la cola para esta etapa se cancela.`)) return;
    const actual = configs[etapa.id];
    if (!actual?.id) return;
    const { error } = await supabase.from('siguelo_etapas').delete().eq('id', actual.id);
    if (error) return toast(`No se pudo quitar: ${error.message}`, 'error');
    setAbierta(null);
    setBorrador(null);
    toast(`"${etapa.nombre}" ya no tiene mensajes automáticos`, 'ok');
    onGuardado();
  };

  const nombreEtapa = (id: string | null) => etapas.find((e) => e.id === id)?.nombre;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        Cada etapa del embudo tiene sus propios mensajes. <b>Recordatorios</b>: salen solos desde que el contacto entra a la etapa (y
        esperan si hubo conversación hace poco). <b>Reactivación</b>: sale cuando tú le escribes y no responde. Escribe varias formas de decir
        cada mensaje separándolas con una línea <code>---</code>; se elige una al azar. <code>{'{nombre}'}</code> se cambia por su nombre y{' '}
        <code>{'{sucursal}'}</code> por el nombre del número que lo envía (el que tiene en Conexiones).
      </p>
      {etapas.map((etapa) => {
        const cfg = configs[etapa.id];
        const abiertaAhora = abierta === etapa.id && borrador;
        const rec = resumenSec(cfg?.recordatorios);
        const react = resumenSec(cfg?.reactivacion);
        const destino = cfg?.al_terminar?.etapa_id ? nombreEtapa(cfg.al_terminar.etapa_id) : null;
        const perdida = etapa.tipo === 'perdida';
        return (
          <Tarjeta key={etapa.id} className="flex flex-col">
            <button onClick={() => abrir(etapa)} className="flex items-center gap-3 px-4 py-3 text-left" aria-expanded={!!abiertaAhora}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorEtiquetaWhatsapp(etapa.color) }} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{etapa.nombre}</div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {perdida ? (
                    <Etiqueta color="var(--fg-3)" icono={Ban}>Nunca envía mensajes</Etiqueta>
                  ) : !rec && !react && !destino ? (
                    <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Sin mensajes automáticos</span>
                  ) : (
                    <>
                      {rec && <Etiqueta icono={Bell}>Recordatorios: {rec}</Etiqueta>}
                      {react && <Etiqueta color="var(--warn)" icono={RotateCcw}>Reactivación: {react}</Etiqueta>}
                      {destino && <Etiqueta color="var(--fg-2)" icono={ArrowRight}>Luego pasa a {destino} ({cfg!.al_terminar.dias} d)</Etiqueta>}
                    </>
                  )}
                </div>
              </div>
              <ChevronDown size={16} style={{ color: TEXTO_TERCIARIO, transform: abiertaAhora ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>

            {abiertaAhora && (
              <div className="flex flex-col gap-3 px-4 pb-4" style={{ borderTop: `1px solid ${BORDE}` }}>
                {perdida ? (
                  <p className="m-0 pt-3 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                    Es una etapa de venta perdida: a los contactos que están acá nunca se les envía nada automático.
                  </p>
                ) : (
                  <>
                    {puedeEditar && (
                      <label className="flex items-center gap-2 pt-3 text-[12.5px] flex-wrap" style={{ color: TEXTO_SECUNDARIO }}>
                        Cargar un ejemplo:
                        <select value="" onChange={(e) => cargarPlantilla(e.target.value)} className={`${claseCampo} w-full sm:w-auto max-w-full`} style={{ ...estiloCampo, height: 32 }}>
                          <option value="">Elegir…</option>
                          {PLANTILLAS.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre} — {p.descripcion}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <EditorSecuencia
                      titulo="Recordatorios"
                      ayuda="Salen solos mientras el contacto está en esta etapa. Si respondió, esperan hasta que le escribas."
                      icono={Bell}
                      sec={borrador.recordatorios}
                      onCambiar={(s) => setBorrador({ ...borrador, recordatorios: s })}
                      deshabilitado={!puedeEditar}
                    />
                    <EditorSecuencia
                      titulo="Reactivación"
                      ayuda="Empieza cuando le escribes a mano y se detiene apenas responde. Como mucho un ciclo cada 24 h (se cambia en Ajustes)."
                      icono={RotateCcw}
                      sec={borrador.reactivacion}
                      onCambiar={(s) => setBorrador({ ...borrador, reactivacion: s })}
                      esReactivacion
                      deshabilitado={!puedeEditar}
                    />
                    <div className="flex items-center gap-2 flex-wrap rounded-xl p-3.5 text-[12.5px]" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}>
                      <ArrowRight size={16} color="var(--accent)" />
                      Al terminar los recordatorios sin respuesta, pasar a
                      <select value={borrador.destino} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, destino: e.target.value })} className={claseCampo} style={{ ...estiloCampo, height: 32 }}>
                        <option value="">(no pasar a otra etapa)</option>
                        {etapas.filter((e) => e.id !== etapa.id).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                      </select>
                      {borrador.destino && (
                        <>
                          después de
                          <input value={borrador.dias} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, dias: e.target.value })} inputMode="decimal" aria-label="Días" className={`${claseCampo} w-16 text-right`} style={{ ...estiloCampo, height: 32 }} />
                          días sin conversación
                        </>
                      )}
                    </div>
                    {puedeEditar && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Boton variante="primario" onClick={() => guardar(etapa)} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
                        {cfg && <Boton variante="peligro" icono={Trash2} onClick={() => quitar(etapa)}>Quitar mensajes</Boton>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Tarjeta>
        );
      })}
    </div>
  );
}
