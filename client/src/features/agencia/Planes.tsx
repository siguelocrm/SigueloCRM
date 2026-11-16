import { useState } from 'react';
import { Archive, Check, Package, Pencil, Plus, RotateCcw } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import Etiqueta from '../seguimiento/Etiqueta';
import { claseCampo, duracion, estiloArea, estiloCampo, monto, type Plan } from './comun';

// Los planes de tu agencia: qué incluyen, cuánto cuestan, cuánto duran y si traen el CRM de
// WhatsApp (al venderlo se crea el acceso del cliente).

function FormPlan({ plan, onCerrar, onGuardado }: { plan: Plan | null; onCerrar: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const [nombre, setNombre] = useState(plan?.nombre ?? '');
  const [precio, setPrecio] = useState(plan ? String(plan.precio) : '');
  const [moneda, setMoneda] = useState(plan?.moneda ?? 'Bs');
  const [dias, setDias] = useState(String(plan?.duracion_dias ?? 30));
  const [incluye, setIncluye] = useState((plan?.incluye ?? []).join('\n'));
  const [conCrm, setConCrm] = useState(plan?.con_crm ?? false);
  const [guardando, setGuardando] = useState(false);
  const etiqueta = (t: string) => <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{t}</span>;

  const guardar = async () => {
    if (!nombre.trim()) return toast('Ponle un nombre al plan.', 'error');
    setGuardando(true);
    const cuerpo = { nombre: nombre.trim(), precio: Number(precio || 0), moneda: moneda.trim() || 'Bs', duracion_dias: Number(dias || 30), incluye: incluye.split('\n').map((x) => x.trim()).filter(Boolean), con_crm: conCrm };
    const r = plan ? await llamarBackend(`/siguelo/agencia/planes/${plan.id}`, cuerpo, 'PATCH') : await llamarBackend('/siguelo/agencia/planes', cuerpo);
    setGuardando(false);
    if (!r.ok) return toast(r.error || 'No se pudo guardar.', 'error');
    toast('Plan guardado.', 'ok');
    onGuardado();
  };

  return (
    <Tarjeta className="p-4 flex flex-col gap-3">
      <span className="text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{plan ? `Editar "${plan.nombre}"` : 'Nuevo plan'}</span>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">{etiqueta('Nombre *')}<input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Básico de videos" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">{etiqueta('Precio')}<span className="flex gap-1.5"><input value={moneda} onChange={(e) => setMoneda(e.target.value)} className={claseCampo} style={{ ...estiloCampo, width: 56 }} /><input value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className={claseCampo} style={estiloCampo} /></span></label>
        <label className="flex flex-col gap-1">
          {etiqueta('Dura')}
          <select value={dias} onChange={(e) => setDias(e.target.value)} className={claseCampo} style={estiloCampo}>
            {[7, 15, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{duracion(d)}</option>)}
            {![7, 15, 30, 60, 90, 180, 365].includes(Number(dias)) && <option value={dias}>{duracion(Number(dias))}</option>}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        {etiqueta('Qué incluye (uno por línea)')}
        <textarea value={incluye} onChange={(e) => setIncluye(e.target.value)} rows={4} placeholder={'4 videos al mes\nEdición de videos\nPublicación en redes'} className="w-full rounded-lg outline-none text-[13.5px] bg-[var(--surface)] resize-y" style={estiloArea} />
      </label>
      <label className="flex items-start gap-2 text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
        <input type="checkbox" className="mt-0.5" checked={conCrm} onChange={(e) => setConCrm(e.target.checked)} />
        <span><b>Incluye el CRM de WhatsApp</b>: al registrar la venta se crea el acceso del cliente (con usuario y contraseña) y vence cuando termina el plan. Sin marcar (por ejemplo, solo videos), la venta solo queda registrada.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" icono={Check} onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar plan'}</Boton>
        <Boton onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
      </div>
    </Tarjeta>
  );
}

export default function Planes({ planes, onCambio }: { planes: Plan[]; onCambio: () => void }) {
  const toast = useToast();
  const [editando, setEditando] = useState<Plan | 'nuevo' | null>(null);
  const archivar = async (p: Plan) => {
    const r = await llamarBackend(`/siguelo/agencia/planes/${p.id}`, { activo: !p.activo }, 'PATCH');
    if (!r.ok) return toast(r.error || 'No se pudo.', 'error');
    toast(p.activo ? 'Plan archivado: ya no aparece al vender (las ventas anteriores siguen igual).' : 'Plan disponible otra vez.', 'ok');
    onCambio();
  };
  const ordenados = [...planes].sort((a, b) => Number(b.activo) - Number(a.activo));
  return (
    <div className="flex flex-col gap-3">
      {editando ? (
        <FormPlan plan={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); onCambio(); }} />
      ) : (
        <div><Boton variante="primario" icono={Plus} onClick={() => setEditando('nuevo')}>Nuevo plan</Boton></div>
      )}
      {!planes.length && !editando && (
        <Tarjeta className="flex">
          <EstadoVacio icono={Package} titulo="Todavía no tienes planes" texto="Crea tus planes (por ejemplo: Básico de videos, CRM con IA) con lo que incluye cada uno y si trae el CRM de WhatsApp." />
        </Tarjeta>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {ordenados.map((p) => (
          <Tarjeta key={p.id} className="p-4 flex flex-col gap-2" style={{ opacity: p.activo ? 1 : 0.6 }}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{p.nombre}</span>
                <span className="text-[13px]" style={{ color: TEXTO_SECUNDARIO }}><b>{monto(p.precio, p.moneda)}</b> · {duracion(p.duracion_dias)}</span>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {p.con_crm ? <Etiqueta color="var(--accent)">Con CRM de WhatsApp</Etiqueta> : <Etiqueta color="var(--fg-3)">Sin CRM</Etiqueta>}
                {!p.activo && <Etiqueta color="var(--fg-3)">Archivado</Etiqueta>}
              </div>
            </div>
            {p.incluye.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-[13px] m-0 pl-5 list-disc" style={{ color: TEXTO_PRIMARIO }}>
                {p.incluye.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            )}
            <div className="flex gap-1.5 pt-1">
              <Boton tamano="sm" icono={Pencil} onClick={() => setEditando(p)}>Editar</Boton>
              <Boton tamano="sm" icono={p.activo ? Archive : RotateCcw} onClick={() => archivar(p)}>{p.activo ? 'Archivar' : 'Volver a usar'}</Boton>
            </div>
          </Tarjeta>
        ))}
      </div>
      {planes.length > 0 && <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Los planes no se borran (así tus ventas anteriores siguen con su plan): archívalos cuando ya no los ofrezcas.</span>}
    </div>
  );
}
