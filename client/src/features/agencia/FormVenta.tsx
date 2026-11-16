import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { claseCampo, duracion, estiloArea, estiloCampo, fecha, hoyISO, monto, nuevaContrasena, sugerirUsuario, type Cuenta, type Plan } from './comun';

// Registrar una venta de tu agencia. Si el plan trae el CRM de WhatsApp, en el mismo paso se
// crea el acceso del cliente (o se renueva el que ya tiene).
type Props = { planes: Plan[]; cuentas: Cuenta[]; onCerrar: () => void; onGuardada: (acceso: { nombre: string; usuario: string; contrasena: string } | null) => void };

export default function FormVenta({ planes, cuentas, onCerrar, onGuardada }: Props) {
  const toast = useToast();
  const activos = planes.filter((p) => p.activo);
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [planId, setPlanId] = useState(activos[0]?.id ?? '');
  const [montoTxt, setMontoTxt] = useState(activos[0] ? String(activos[0].precio) : '');
  const [dia, setDia] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [modo, setModo] = useState<'nueva' | 'renovar' | 'no'>('nueva');
  const [negocio, setNegocio] = useState('');
  const [usuario, setUsuario] = useState('');
  const [usuarioTocado, setUsuarioTocado] = useState(false);
  const [contrasena, setContrasena] = useState(nuevaContrasena());
  const [miClave, setMiClave] = useState(true);
  const deClientes = cuentas.filter((c) => !c.propia);
  const [renovarId, setRenovarId] = useState(deClientes[0]?.empresa_id ?? '');
  const [guardando, setGuardando] = useState(false);
  const plan = planes.find((p) => p.id === planId) ?? null;

  const cambiarPlan = (id: string) => {
    setPlanId(id);
    const p = planes.find((x) => x.id === id);
    setMontoTxt(p ? String(p.precio) : '');
  };
  const cambiarCliente = (v: string) => {
    setCliente(v);
    if (!usuarioTocado) setUsuario(sugerirUsuario(negocio || v));
  };

  const guardar = async () => {
    if (!cliente.trim()) return toast('Escribe el nombre del cliente.', 'error');
    const conCrm = !!plan?.con_crm && modo !== 'no';
    if (conCrm && modo === 'nueva' && (usuario.trim().length < 3 || contrasena.length < 6)) return toast('El usuario necesita 3 letras y la contraseña 6.', 'error');
    if (conCrm && modo === 'renovar' && !renovarId) return toast('Elige la cuenta a renovar.', 'error');
    setGuardando(true);
    const r = await llamarBackend('/siguelo/agencia/ventas', {
      cliente: cliente.trim(),
      telefono: telefono.trim() || undefined,
      plan_id: planId || null,
      monto: montoTxt === '' ? undefined : Number(montoTxt),
      fecha: new Date(`${dia}T${new Date().toTimeString().slice(0, 5)}`).toISOString(),
      notas: notas.trim() || undefined,
      cuenta: !conCrm ? null : modo === 'nueva' ? { modo: 'nueva', nombre: negocio.trim() || cliente.trim(), usuario: usuario.trim(), password: contrasena, usar_mi_clave: miClave } : { modo: 'renovar', empresa_id: renovarId },
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error || 'No se pudo guardar la venta.', 'error');
    const cuenta = r.data?.cuenta;
    if (cuenta?.nueva) onGuardada({ nombre: negocio.trim() || cliente.trim(), usuario: cuenta.usuario, contrasena });
    else {
      toast(cuenta ? `Venta guardada. Cuenta renovada hasta el ${fecha(cuenta.vence_en)}.` : 'Venta guardada.', 'ok');
      onGuardada(null);
    }
  };

  const etiqueta = (t: string) => <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{t}</span>;
  return (
    <Tarjeta className="p-4 flex flex-col gap-3">
      <span className="text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Registrar una venta</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">{etiqueta('Cliente *')}<input value={cliente} onChange={(e) => cambiarCliente(e.target.value)} placeholder="Ej. Consultorio Dra. Paz" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">{etiqueta('WhatsApp del cliente')}<input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej. 71234567" inputMode="tel" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">
          {etiqueta('Plan')}
          <select value={planId} onChange={(e) => cambiarPlan(e.target.value)} className={claseCampo} style={estiloCampo}>
            {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {monto(p.precio, p.moneda)} · {duracion(p.duracion_dias)}{p.con_crm ? ' · con CRM' : ''}</option>)}
            <option value="">Sin plan (otro servicio)</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">{etiqueta(`Pagó (${plan?.moneda ?? 'Bs'})`)}<input value={montoTxt} onChange={(e) => setMontoTxt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className={claseCampo} style={estiloCampo} /></label>
          <label className="flex flex-col gap-1">{etiqueta('Fecha')}<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className={claseCampo} style={estiloCampo} /></label>
        </div>
      </div>
      {plan && plan.incluye.length > 0 && <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>Incluye: {plan.incluye.join(' · ')}</span>}

      {plan?.con_crm && (
        <div className="rounded-xl p-3 flex flex-col gap-2.5" style={{ backgroundColor: 'var(--surface-2)' }}>
          <span className="text-[13px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Acceso al CRM de WhatsApp</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
            <label className="flex items-center gap-1.5"><input type="radio" checked={modo === 'nueva'} onChange={() => setModo('nueva')} />Crear su acceso ahora</label>
            {deClientes.length > 0 && <label className="flex items-center gap-1.5"><input type="radio" checked={modo === 'renovar'} onChange={() => setModo('renovar')} />Renovar una cuenta que ya tiene</label>}
            <label className="flex items-center gap-1.5"><input type="radio" checked={modo === 'no'} onChange={() => setModo('no')} />Todavía no</label>
          </div>
          {modo === 'nueva' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">{etiqueta('Nombre del negocio')}<input value={negocio} onChange={(e) => { setNegocio(e.target.value); if (!usuarioTocado) setUsuario(sugerirUsuario(e.target.value || cliente)); }} placeholder={cliente || 'Como se verá en su CRM'} className={claseCampo} style={estiloCampo} /></label>
                <label className="flex flex-col gap-1">{etiqueta('Usuario para entrar')}<input value={usuario} onChange={(e) => { setUsuario(e.target.value); setUsuarioTocado(true); }} autoCapitalize="none" className={claseCampo} style={estiloCampo} /></label>
                <label className="flex flex-col gap-1">
                  {etiqueta('Contraseña')}
                  <span className="flex gap-1.5">
                    <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} className={claseCampo} style={estiloCampo} />
                    <Boton tamano="sm" icono={RefreshCw} onClick={() => setContrasena(nuevaContrasena())} aria-label="Otra contraseña" style={{ height: 36 }} />
                  </span>
                </label>
              </div>
              <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                <input type="checkbox" checked={miClave} onChange={(e) => setMiClave(e.target.checked)} />
                Su IA usa mi clave de OpenAI (gasta de tu saldo; si no, el cliente pone la suya en IA → Ajustes)
              </label>
              <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Su cuenta queda vacía y aparte de las tuyas, y vence cuando termina el plan ({duracion(plan.duracion_dias)}). Él conecta su WhatsApp en Conexiones.</span>
            </>
          )}
          {modo === 'renovar' && (
            <label className="flex flex-col gap-1">
              {etiqueta('Cuenta')}
              <select value={renovarId} onChange={(e) => setRenovarId(e.target.value)} className={claseCampo} style={estiloCampo}>
                {deClientes.map((c) => <option key={c.empresa_id} value={c.empresa_id}>{c.nombre} · vence {fecha(c.vence_en)}</option>)}
              </select>
              <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Se suman {duracion(plan.duracion_dias)} desde que vence (o desde hoy si ya venció), y vuelve a funcionar si estaba en pausa.</span>
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1">{etiqueta('Notas')}<textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Opcional: qué se acordó, forma de pago…" className="w-full rounded-lg outline-none text-[13.5px] bg-[var(--surface)] resize-y" style={estiloArea} /></label>
      <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Con su WhatsApp, el cliente queda en los contactos de esta cuenta como venta ganada (con la nota y la oportunidad para tus reportes).</span>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar venta'}</Boton>
        <Boton onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
      </div>
    </Tarjeta>
  );
}
