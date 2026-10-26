import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Power, Clock, Gauge, MessageSquareText } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { etiquetaDeZona, formatearEnZona, listaDeZonas } from '../../lib/zonaHoraria';
import { Boton, Interruptor, Tarjeta, useToast } from '../../components/ui';
import type { AjustesSeguimiento as Ajustes } from './tipos';
import { PIE_EJEMPLO, TEXTO_VARIABLES, textoAVariantes, variablesDesconocidas, variantesATexto } from './plantillas';
import { claseCampo, estiloArea, estiloCampo } from './estilos';

interface Props {
  ajustes: Ajustes;
  existe: boolean;
  puedeEditar: boolean;
  onGuardado: () => void;
}

function Bloque({ icono: Icono, titulo, children }: { icono: typeof Clock; titulo: string; children: ReactNode }) {
  return (
    <Tarjeta className="p-4 flex flex-col gap-3 max-w-2xl">
      <span className="flex items-center gap-2 text-[14.5px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>
        <Icono size={16} color="var(--accent)" /> {titulo}
      </span>
      {children}
    </Tarjeta>
  );
}

function Numero({ etiqueta, ayuda, valor, onCambiar, deshabilitado, unidad }: { etiqueta: string; ayuda?: string; valor: string; onCambiar: (v: string) => void; deshabilitado: boolean; unidad: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
      {etiqueta}
      <span className="flex items-center gap-2 font-normal">
        <input value={valor} onChange={(e) => onCambiar(e.target.value)} disabled={deshabilitado} inputMode="decimal" className={`${claseCampo} w-24 text-right`} style={estiloCampo} />
        <span style={{ color: TEXTO_SECUNDARIO }}>{unidad}</span>
      </span>
      {ayuda && <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>}
    </label>
  );
}

const CAMPOS_NUMERO = [
  'pausa_min_seg',
  'pausa_max_seg',
  'maximo_diario',
  'min_entre_misma_persona_min',
  'no_recordar_si_escribio_horas',
  'atraso_max_reactivacion_horas',
  'ciclos_reactivacion_cada_horas',
] as const;
type CampoNumero = (typeof CAMPOS_NUMERO)[number];

export default function AjustesSeguimiento({ ajustes, existe, puedeEditar, onGuardado }: Props) {
  const toast = useToast();
  const [zona, setZona] = useState(ajustes.zona_horaria);
  const [horaInicio, setHoraInicio] = useState(ajustes.hora_inicio);
  const [horaFin, setHoraFin] = useState(ajustes.hora_fin);
  const [numeros, setNumeros] = useState<Record<CampoNumero, string>>(() => Object.fromEntries(CAMPOS_NUMERO.map((c) => [c, String(ajustes[c])])) as Record<CampoNumero, string>);
  const [pieActivo, setPieActivo] = useState(ajustes.pie?.activo ?? false);
  const [pieTexto, setPieTexto] = useState(variantesATexto(ajustes.pie?.variantes ?? []));
  const [guardando, setGuardando] = useState(false);

  // Si los ajustes cambian desde afuera (otra pestaña, el servidor), se recargan.
  useEffect(() => {
    setZona(ajustes.zona_horaria);
    setHoraInicio(ajustes.hora_inicio);
    setHoraFin(ajustes.hora_fin);
    setNumeros(Object.fromEntries(CAMPOS_NUMERO.map((c) => [c, String(ajustes[c])])) as Record<CampoNumero, string>);
    setPieActivo(ajustes.pie?.activo ?? false);
    setPieTexto(variantesATexto(ajustes.pie?.variantes ?? []));
  }, [ajustes]);

  const zonas = useMemo(() => [...new Set([...listaDeZonas(), zona])].sort((a, b) => a.localeCompare(b)), [zona]);

  const guardarCambios = async (cambios: Partial<Ajustes>, aviso: string) => {
    const fila = { ...ajustes, ...cambios, actualizado_en: new Date().toISOString() };
    const { error } = existe
      ? await supabase.from('siguelo_ajustes').update({ ...cambios, actualizado_en: fila.actualizado_en }).eq('empresa_id', ajustes.empresa_id)
      : await supabase.from('siguelo_ajustes').insert(fila);
    if (error) {
      toast(`No se pudo guardar: ${error.message}`, 'error');
      return false;
    }
    toast(aviso, 'ok');
    onGuardado();
    return true;
  };

  const activar = (activo: boolean) =>
    guardarCambios(
      activo ? { activo: true, activado_en: ajustes.activado_en ?? new Date().toISOString() } : { activo: false },
      activo ? 'Seguimiento activado' : 'Seguimiento apagado: no sale nada automático',
    );

  const pausar = (pausado: boolean) =>
    guardarCambios(pausado ? { pausado: true, motivo_pausa: 'Pausado a mano' } : { pausado: false, motivo_pausa: null }, pausado ? 'En pausa: no sale nada' : 'Pausa quitada');

  const guardar = async () => {
    const valores: Partial<Record<CampoNumero, number>> = {};
    for (const c of CAMPOS_NUMERO) {
      const n = parseFloat(numeros[c].replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) return toast('Revisa los números: tienen que ser 0 o más.', 'error');
      valores[c] = ['pausa_min_seg', 'pausa_max_seg', 'maximo_diario', 'min_entre_misma_persona_min'].includes(c) ? Math.round(n) : n;
    }
    if (!/^\d{1,2}:\d{2}$/.test(horaInicio) || !/^\d{1,2}:\d{2}$/.test(horaFin) || horaInicio >= horaFin) {
      return toast('El horario tiene que ser como 08:00 a 20:00, y el inicio antes del fin.', 'error');
    }
    const variantes = textoAVariantes(pieTexto);
    if (pieActivo && !variantes.length) return toast('Escribe el pie o apágalo.', 'error');
    const desconocidas = variablesDesconocidas(pieTexto);
    if (desconocidas.length) return toast(`Esa variable no existe: ${desconocidas.map((v) => `{${v}}`).join(', ')}. Puedes usar ${TEXTO_VARIABLES}.`, 'error');
    setGuardando(true);
    await guardarCambios({ ...valores, zona_horaria: zona, hora_inicio: horaInicio, hora_fin: horaFin, pie: { activo: pieActivo, variantes } }, 'Ajustes guardados');
    setGuardando(false);
  };

  const n = (c: CampoNumero) => ({ valor: numeros[c], onCambiar: (v: string) => setNumeros({ ...numeros, [c]: v }), deshabilitado: !puedeEditar });

  return (
    <div className="flex flex-col gap-3">
      <Bloque icono={Power} titulo="Estado">
        <div className="flex items-start gap-3">
          <div className="flex-1 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <b style={{ color: TEXTO_PRIMARIO }}>Seguimiento automático {ajustes.activo ? 'activo' : 'apagado'}.</b>{' '}
            {ajustes.activo
              ? `Activo desde el ${formatearEnZona(ajustes.activado_en || new Date().toISOString(), ajustes.zona_horaria)}. Los contactos que ya estaban en su etapa antes de esa fecha no reciben recordatorios (sí reactivación si les escribes).`
              : 'Al activarlo, solo los contactos que entren a una etapa desde ahora reciben recordatorios. Así no le escribes de golpe a todo tu historial.'}
          </div>
          <Interruptor activo={ajustes.activo} onCambiar={activar} etiqueta="Activar el seguimiento automático" deshabilitado={!puedeEditar} />
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            <b style={{ color: TEXTO_PRIMARIO }}>Pausar todo</b>: la cola no envía nada hasta que lo quites.
            {ajustes.pausado && ajustes.motivo_pausa && <span style={{ color: 'var(--bad)' }}> Motivo: {ajustes.motivo_pausa}.</span>}
          </div>
          <Interruptor activo={ajustes.pausado} onCambiar={pausar} etiqueta="Pausar todo" deshabilitado={!puedeEditar} />
        </div>
        <p className="m-0 text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
          Automatizar WhatsApp va contra sus términos y existe riesgo de bloqueo del número. Prueba primero con un número secundario.
        </p>
      </Bloque>

      <Bloque icono={Clock} titulo="Horario de envío">
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Solo de
          <input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} disabled={!puedeEditar} aria-label="Hora de inicio" className={claseCampo} style={estiloCampo} />
          a
          <input type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} disabled={!puedeEditar} aria-label="Hora de fin" className={claseCampo} style={estiloCampo} />
          en
          <select value={zona} onChange={(e) => setZona(e.target.value)} disabled={!puedeEditar} aria-label="Zona horaria" className={`${claseCampo} max-w-full`} style={estiloCampo}>
            {zonas.map((z) => <option key={z} value={z}>{etiquetaDeZona(z)}</option>)}
          </select>
        </div>
        <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>Lo que vence fuera de horario sale desde la hora de inicio, con un retraso al azar de hasta 2 minutos.</span>
      </Bloque>

      <Bloque icono={Gauge} titulo="Límites">
        <div className="grid gap-3 sm:grid-cols-2">
          <Numero etiqueta="Máximo por día, por cada número" unidad="mensajes" ayuda="Al llegar, lo pendiente de ese número pasa a mañana en el mismo orden." {...n('maximo_diario')} />
          <Numero etiqueta="Mínimo entre dos a la misma persona" unidad="minutos" {...n('min_entre_misma_persona_min')} />
          <Numero etiqueta="Pausa al azar entre mensajes de un mismo número: desde" unidad="segundos" {...n('pausa_min_seg')} />
          <Numero etiqueta="hasta" unidad="segundos" {...n('pausa_max_seg')} />
          <Numero etiqueta="No recordar si hubo conversación hace menos de" unidad="horas" {...n('no_recordar_si_escribio_horas')} />
          <Numero etiqueta="Cancelar una reactivación atrasada más de" unidad="horas" ayuda="Por ejemplo, si la computadora estuvo apagada." {...n('atraso_max_reactivacion_horas')} />
          <Numero etiqueta="Como mucho una reactivación cada" unidad="horas" ayuda="Por contacto y por etapa." {...n('ciclos_reactivacion_cada_horas')} />
        </div>
      </Bloque>

      <Bloque icono={MessageSquareText} titulo="Pie de mensaje">
        <div className="flex items-start gap-3">
          <p className="flex-1 m-0 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
            Se agrega al final de cada mensaje automático (una variante al azar). Por ahora, cuando el contacto responde cualquier cosa, sus
            mensajes automáticos se detienen hasta que lo atiendas; que "stop" o "ya estoy" lo cambien de etapa solo llega en la Fase 2.
          </p>
          <Interruptor activo={pieActivo} onCambiar={setPieActivo} etiqueta="Activar el pie de mensaje" deshabilitado={!puedeEditar} />
        </div>
        {pieActivo && (
          <>
            <textarea value={pieTexto} onChange={(e) => setPieTexto(e.target.value)} disabled={!puedeEditar} rows={4} aria-label="Variantes del pie" placeholder="Si no quieres recibir más mensajes, responde *stop*." className="rounded-lg outline-none text-[13px] bg-[var(--surface)]" style={estiloArea} />
            {puedeEditar && !pieTexto.trim() && (
              <Boton tamano="sm" className="self-start" onClick={() => setPieTexto(variantesATexto(PIE_EJEMPLO))}>Usar el ejemplo de la extensión</Boton>
            )}
          </>
        )}
      </Bloque>

      {puedeEditar && (
        <Boton variante="primario" className="self-start" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar ajustes'}</Boton>
      )}
    </div>
  );
}
