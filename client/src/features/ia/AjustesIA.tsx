import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, Clock, KeyRound, Palette, Power, ShieldCheck, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { llamarBackend } from '../../lib/backend';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Interruptor, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';
import { ESTILO, TIPOS_AVISO, type AjustesIA as Ajustes, type ModoIA, type TipoAviso } from './tipos';

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

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
      {etiqueta}
      {children}
      {ayuda && <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>}
    </label>
  );
}

function Fila({ texto, activo, onCambiar, deshabilitado }: { texto: string; activo: boolean; onCambiar: (v: boolean) => void; deshabilitado: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
      <span className="flex-1">{texto}</span>
      <Interruptor activo={activo} onCambiar={onCambiar} etiqueta={texto} deshabilitado={deshabilitado} />
    </div>
  );
}

const MODOS: { id: ModoIA; titulo: string; texto: string }[] = [
  { id: 'apagado', titulo: 'Solo leer', texto: 'Lee, mueve de etapa y te avisa, pero no le responde a nadie.' },
  { id: 'borrador', titulo: 'Para aprobar', texto: 'Escribe la respuesta y espera que la apruebes en el Resumen. Ideal para empezar.' },
  { id: 'automatico', titulo: 'Automática', texto: 'Responde sola, dentro de la franja y los límites de abajo.' },
];

const NUMEROS = ['espera_min_seg', 'espera_max_seg', 'max_por_cliente_dia', 'max_respuestas_dia', 'max_consultas_dia', 'pausa_si_escribes_min'] as const;

interface Props {
  ajustes: Ajustes;
  existe: boolean;
  lineas: { id: string; nombre: string }[];
  puedeEditar: boolean;
  onGuardado: () => void;
}

export default function AjustesIA({ ajustes, existe, lineas, puedeEditar, onGuardado }: Props) {
  const toast = useToast();
  const [b, setB] = useState<Ajustes>(ajustes);
  const [numeros, setNumeros] = useState<Record<string, string>>(() => Object.fromEntries(NUMEROS.map((k) => [k, String(ajustes[k])])));
  const [clave, setClave] = useState('');
  const [modelos, setModelos] = useState<string[]>([]);
  const [probando, setProbando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setB(ajustes);
    setNumeros(Object.fromEntries(NUMEROS.map((k) => [k, String(ajustes[k])])));
  }, [ajustes]);

  const guardarCambios = async (cambios: Partial<Ajustes>, aviso: string) => {
    const ahora = new Date().toISOString();
    const { error } = existe
      ? await supabase.from('siguelo_ia').update({ ...cambios, actualizado_en: ahora }).eq('empresa_id', ajustes.empresa_id)
      : await supabase.from('siguelo_ia').insert({ ...ajustes, ...cambios, actualizado_en: ahora });
    if (error) {
      toast(`No se pudo guardar: ${error.message}`, 'error');
      return false;
    }
    toast(aviso, 'ok');
    onGuardado();
    return true;
  };

  const guardarClave = async () => {
    if (!clave.trim()) return toast('Pega tu clave de OpenAI (empieza con sk-).', 'error');
    setProbando(true);
    try {
      const r = await llamarBackend('/siguelo/ia/clave', { clave: clave.trim() });
      if (!r.ok) return toast(r.error || 'No se pudo guardar la clave.', 'error');
      setClave('');
      setModelos(r.data.modelos || []);
      toast('Clave guardada y probada: funciona', 'ok');
      onGuardado();
    } catch {
      toast('No se pudo hablar con el servidor. ¿Está prendido (npm run dev)?', 'error');
    } finally {
      setProbando(false);
    }
  };

  const probarConexion = async () => {
    setProbando(true);
    try {
      const r = await llamarBackend('/siguelo/ia/modelos', {});
      if (!r.ok) return toast(r.error || 'No funciona la clave.', 'error');
      setModelos(r.data.modelos || []);
      toast('✓ Conectado con OpenAI', 'ok');
    } catch {
      toast('No se pudo hablar con el servidor. ¿Está prendido (npm run dev)?', 'error');
    } finally {
      setProbando(false);
    }
  };

  const quitarClave = async () => {
    if (!window.confirm('¿Quitar la clave de OpenAI? La IA deja de funcionar hasta que pongas otra.')) return;
    const r = await llamarBackend('/siguelo/ia/clave', {}, 'DELETE').catch(() => null);
    if (!r?.ok) return toast('No se pudo quitar la clave.', 'error');
    toast('Clave quitada', 'ok');
    onGuardado();
  };

  const guardar = async () => {
    const valores: Record<string, number> = {};
    for (const k of NUMEROS) {
      const n = Math.round(Number(numeros[k]));
      if (!Number.isFinite(n) || n < 0) return toast('Revisa los números: tienen que ser 0 o más.', 'error');
      valores[k] = n;
    }
    if (b.desde >= b.hasta) return toast('La franja tiene que ser como 07:00 a 22:00.', 'error');
    if (b.avisos.activo && b.avisos.telefono.replace(/\D/g, '').length < 7) return toast('Escribe tu número personal con código de país (ej. 59171234567).', 'error');
    setGuardando(true);
    const { empresa_id: _e, activa: _a, modo: _m, clave_final: _c, ...resto } = b;
    await guardarCambios({ ...resto, ...valores }, 'Ajustes de la IA guardados');
    setGuardando(false);
  };

  const sel = (grupo: keyof typeof ESTILO) => (
    <select value={b.estilo[grupo as 'tono']} disabled={!puedeEditar} onChange={(e) => setB({ ...b, estilo: { ...b.estilo, [grupo]: e.target.value } })} className={`${claseCampo} font-normal`} style={estiloCampo}>
      {Object.entries(ESTILO[grupo]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  const num = (k: (typeof NUMEROS)[number]) => (
    <input value={numeros[k]} disabled={!puedeEditar} onChange={(e) => setNumeros({ ...numeros, [k]: e.target.value })} inputMode="numeric" className={`${claseCampo} w-24 text-right font-normal`} style={estiloCampo} />
  );

  return (
    <div className="flex flex-col gap-3">
      <Bloque icono={Power} titulo="Estado">
        <Fila
          texto={ajustes.activa ? 'La IA está activa: lee los mensajes de los clientes.' : 'La IA está apagada.'}
          activo={ajustes.activa}
          onCambiar={(v) => guardarCambios({ activa: v }, v ? 'IA activada' : 'IA apagada')}
          deshabilitado={!puedeEditar || (!ajustes.clave_final && !ajustes.activa)}
        />
        {!ajustes.clave_final && <span className="text-[12px]" style={{ color: 'var(--warn)' }}>Primero guarda tu clave de OpenAI (abajo).</span>}
        <div className="grid gap-2 sm:grid-cols-3">
          {MODOS.map((m) => (
            <button
              key={m.id}
              disabled={!puedeEditar}
              onClick={() => guardarCambios({ modo: m.id }, `Modo: ${m.titulo}`)}
              aria-pressed={ajustes.modo === m.id}
              className="text-left rounded-xl p-3 flex flex-col gap-1"
              style={{ border: `1px solid ${ajustes.modo === m.id ? 'var(--accent)' : 'var(--line)'}`, backgroundColor: ajustes.modo === m.id ? 'var(--accent-soft)' : 'transparent' }}
            >
              <span className="text-[13px] font-semibold" style={{ color: ajustes.modo === m.id ? 'var(--accent)' : TEXTO_PRIMARIO }}>{m.titulo}</span>
              <span className="text-[11.5px]" style={{ color: TEXTO_SECUNDARIO }}>{m.texto}</span>
            </button>
          ))}
        </div>
        <p className="m-0 text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
          La IA lee el texto de las conversaciones y lo manda a OpenAI con tu clave. Responde solo con la ficha de cada negocio (Administrar → Negocios).
        </p>
      </Bloque>

      <Bloque icono={KeyRound} titulo="Clave de OpenAI">
        <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          {ajustes.clave_final ? <>Hay una clave guardada que termina en <b>…{ajustes.clave_final}</b>. Por seguridad no se puede ver desde acá.</> : 'Todavía no hay clave.'} Ponle un límite de gasto mensual en tu cuenta de OpenAI.
        </span>
        {puedeEditar && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder={ajustes.clave_final ? 'Pegar una clave nueva' : 'sk-…'} autoComplete="off" aria-label="Clave de OpenAI" className={`${claseCampo} flex-1 min-w-[200px]`} style={estiloCampo} />
            <Boton variante="primario" icono={ShieldCheck} onClick={guardarClave} disabled={probando}>{probando ? 'Probando…' : 'Guardar y probar'}</Boton>
            {ajustes.clave_final && <Boton onClick={probarConexion} disabled={probando}>Probar conexión</Boton>}
            {ajustes.clave_final && <Boton variante="fantasma" onClick={quitarClave}>Quitar</Boton>}
          </div>
        )}
        <Campo etiqueta="Modelo" ayuda="El más barato alcanza para responder. Pulsa “Probar conexión” para ver los que tiene tu cuenta.">
          <input list="modelos-ia" value={b.modelo} disabled={!puedeEditar} onChange={(e) => setB({ ...b, modelo: e.target.value })} className={`${claseCampo} font-normal max-w-xs`} style={estiloCampo} />
          <datalist id="modelos-ia">{modelos.map((m) => <option key={m} value={m} />)}</datalist>
        </Campo>
      </Bloque>

      <Bloque icono={Palette} titulo="Cómo escribe">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tono">{sel('tono')}</Campo>
          <Campo etiqueta="Trato">{sel('trato')}</Campo>
          <Campo etiqueta="Emojis">{sel('emojis')}</Campo>
          <Campo etiqueta="Largo">{sel('largo')}</Campo>
          <Campo etiqueta="Saltos de línea">{sel('saltos')}</Campo>
          <Campo etiqueta="Firma (opcional)" ayuda="Se agrega al final de cada respuesta.">
            <input value={b.firma} disabled={!puedeEditar} onChange={(e) => setB({ ...b, firma: e.target.value })} placeholder="— Equipo de ventas" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
        </div>
        <Fila texto="Usar el nombre del cliente" activo={b.estilo.usar_nombre} onCambiar={(v) => setB({ ...b, estilo: { ...b.estilo, usar_nombre: v } })} deshabilitado={!puedeEditar} />
        <Campo etiqueta="Instrucciones (opcional)" ayuda="Por ejemplo: «Siempre invita a pasar por la tienda». Lo de cada negocio va en su ficha.">
          <textarea value={b.instrucciones} disabled={!puedeEditar} onChange={(e) => setB({ ...b, instrucciones: e.target.value })} rows={3} className="rounded-lg outline-none text-[13px] font-normal bg-[var(--surface)]" style={estiloArea} />
        </Campo>
        <Campo etiqueta="Ejemplos de cómo respondes tú (opcional)" ayuda="Pega 2 o 3 respuestas tuyas: la IA imita la forma, no copia los datos.">
          <textarea value={b.ejemplos} disabled={!puedeEditar} onChange={(e) => setB({ ...b, ejemplos: e.target.value })} rows={4} className="rounded-lg outline-none text-[13px] font-normal bg-[var(--surface)]" style={estiloArea} />
        </Campo>
        <Campo etiqueta="Si no sabe la respuesta">
          <select value={b.si_no_sabe} disabled={!puedeEditar} onChange={(e) => setB({ ...b, si_no_sabe: e.target.value as Ajustes['si_no_sabe'] })} className={`${claseCampo} font-normal`} style={estiloCampo}>
            <option value="avisar">No responde y te avisa</option>
            <option value="espera">Manda un “déjame consultarlo” y te avisa</option>
          </select>
        </Campo>
        {b.si_no_sabe === 'espera' && (
          <input value={b.texto_espera} disabled={!puedeEditar} onChange={(e) => setB({ ...b, texto_espera: e.target.value })} aria-label="Texto de espera" className={`${claseCampo} font-normal`} style={estiloCampo} />
        )}
      </Bloque>

      <Bloque icono={Zap} titulo="Qué puede hacer">
        <Fila texto="Mover al cliente de etapa según lo que responde" activo={b.acciones.mover_etapa} onCambiar={(v) => setB({ ...b, acciones: { ...b.acciones, mover_etapa: v } })} deshabilitado={!puedeEditar} />
        <Fila texto="Pasar a “perdida” al que no quiere más mensajes" activo={b.acciones.no_quiere_mas} onCambiar={(v) => setB({ ...b, acciones: { ...b.acciones, no_quiere_mas: v } })} deshabilitado={!puedeEditar} />
        <Fila texto="Mandar respuestas rápidas (cada una, una sola vez por cliente)" activo={b.acciones.respuestas_rapidas} onCambiar={(v) => setB({ ...b, acciones: { ...b.acciones, respuestas_rapidas: v } })} deshabilitado={!puedeEditar} />
        <Fila texto="Pasar al cliente a otra sucursal (si acepta)" activo={b.acciones.pases} onCambiar={(v) => setB({ ...b, acciones: { ...b.acciones, pases: v } })} deshabilitado={!puedeEditar} />
        <Fila texto="Invitar a grupos de WhatsApp (solo manda el link, si acepta)" activo={b.acciones.grupos} onCambiar={(v) => setB({ ...b, acciones: { ...b.acciones, grupos: v } })} deshabilitado={!puedeEditar} />
      </Bloque>

      <Bloque icono={Clock} titulo="Cuándo y cuánto responde">
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          Responde de
          <input type="time" value={b.desde} disabled={!puedeEditar} onChange={(e) => setB({ ...b, desde: e.target.value })} aria-label="Desde" className={claseCampo} style={estiloCampo} />
          a
          <input type="time" value={b.hasta} disabled={!puedeEditar} onChange={(e) => setB({ ...b, hasta: e.target.value })} aria-label="Hasta" className={claseCampo} style={estiloCampo} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Espera antes de responder: desde (segundos)">{num('espera_min_seg')}</Campo>
          <Campo etiqueta="hasta (segundos)">{num('espera_max_seg')}</Campo>
          <Campo etiqueta="Máximo de respuestas por cliente al día">{num('max_por_cliente_dia')}</Campo>
          <Campo etiqueta="Máximo de respuestas al día (todas)">{num('max_respuestas_dia')}</Campo>
          <Campo etiqueta="Máximo de consultas a la IA al día" ayuda="Freno para el gasto.">{num('max_consultas_dia')}</Campo>
          <Campo etiqueta="Si una persona escribió hace menos de (minutos)" ayuda="La IA no responde encima: deja la respuesta para aprobar.">{num('pausa_si_escribes_min')}</Campo>
        </div>
      </Bloque>

      <Bloque icono={BellRing} titulo="Avisos a tu WhatsApp personal">
        <Fila texto="Avisarme lo importante" activo={b.avisos.activo} onCambiar={(v) => setB({ ...b, avisos: { ...b.avisos, activo: v } })} deshabilitado={!puedeEditar} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tu número personal" ayuda="Con código de país, ej. 59171234567. La IA nunca le responde a ese número.">
            <input value={b.avisos.telefono} disabled={!puedeEditar} onChange={(e) => setB({ ...b, avisos: { ...b.avisos, telefono: e.target.value } })} inputMode="tel" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Desde qué número te escribe">
            <select value={b.avisos.linea_id ?? ''} disabled={!puedeEditar} onChange={(e) => setB({ ...b, avisos: { ...b.avisos, linea_id: e.target.value || null } })} className={`${claseCampo} font-normal`} style={estiloCampo}>
              <option value="">El mismo del cliente</option>
              {lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(TIPOS_AVISO) as TipoAviso[]).map((t) => (
            <label key={t} className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              <input type="checkbox" checked={!!b.avisos.tipos[t]} disabled={!puedeEditar} onChange={(e) => setB({ ...b, avisos: { ...b.avisos, tipos: { ...b.avisos.tipos, [t]: e.target.checked } } })} />
              {TIPOS_AVISO[t]}
            </label>
          ))}
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            <input type="checkbox" checked={b.avisos.tipos.pago !== false} disabled={!puedeEditar} onChange={(e) => setB({ ...b, avisos: { ...b.avisos, tipos: { ...b.avisos.tipos, pago: e.target.checked } } })} />
            Pagos e inscripciones (comprobantes confirmados, rechazados o para revisar)
          </label>
        </div>
        <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
          Junta los casos de {b.avisos.juntar_min} minutos en un solo mensaje, no repite lo mismo del mismo cliente en 6 horas y manda como mucho {b.avisos.max_dia} por día.
        </span>
      </Bloque>

      {puedeEditar && <Boton variante="primario" className="self-start" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar ajustes'}</Boton>}
    </div>
  );
}
