import { useState } from 'react';
import { KeyRound, Pause, Play, Plus, RefreshCw, Users } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import Etiqueta from '../seguimiento/Etiqueta';
import Acceso from './Acceso';
import { claseCampo, diaDe, estiloCampo, fecha, finDelDia, nuevaContrasena, sugerirUsuario, type Cuenta, type Plan } from './comun';

// Las cuentas del CRM que creaste: las de tus clientes y las tuyas (el club, la agencia).
// Cada una es aparte: sus números, contactos e IA no se mezclan con nada tuyo.

const ESTADO = {
  activa: { texto: 'Activa', color: 'var(--ok)' },
  vencida: { texto: 'Vencida', color: 'var(--bad)' },
  pausada: { texto: 'En pausa', color: 'var(--warn)' },
} as const;

function FormCuenta({ planes, onCerrar, onCreada }: { planes: Plan[]; onCerrar: () => void; onCreada: (a: { nombre: string; usuario: string; contrasena: string }) => void }) {
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [telefono, setTelefono] = useState('');
  const [usuario, setUsuario] = useState('');
  const [tocado, setTocado] = useState(false);
  const [contrasena, setContrasena] = useState(nuevaContrasena());
  const [vence, setVence] = useState(diaDe(new Date(Date.now() + 30 * 86400000).toISOString()));
  const [planId, setPlanId] = useState('');
  const [propia, setPropia] = useState(false);
  const [miClave, setMiClave] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const etiqueta = (t: string) => <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{t}</span>;

  const crear = async () => {
    if (!nombre.trim()) return toast('Escribe el nombre de la cuenta.', 'error');
    if (usuario.trim().length < 3 || contrasena.length < 6) return toast('El usuario necesita 3 letras y la contraseña 6.', 'error');
    setGuardando(true);
    const r = await llamarBackend('/siguelo/agencia/cuentas', {
      nombre: nombre.trim(),
      contacto: contacto.trim() || undefined,
      telefono: telefono.trim() || undefined,
      usuario: usuario.trim(),
      password: contrasena,
      vence_en: propia || !vence ? null : finDelDia(vence),
      plan_id: planId || null,
      propia,
      usar_mi_clave: miClave,
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error || 'No se pudo crear.', 'error');
    onCreada({ nombre: nombre.trim(), usuario: r.data.usuario, contrasena });
  };

  return (
    <Tarjeta className="p-4 flex flex-col gap-3">
      <span className="text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Crear un acceso</span>
      <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>Una cuenta nueva del CRM, vacía y totalmente aparte. Para una venta con plan, mejor usa "Registrar venta": crea el acceso y anota el pago.</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">{etiqueta('Nombre de la cuenta (el negocio) *')}<input value={nombre} onChange={(e) => { setNombre(e.target.value); if (!tocado) setUsuario(sugerirUsuario(e.target.value)); }} placeholder="Ej. Agencia de Marketing" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">{etiqueta('Persona de contacto')}<input value={contacto} onChange={(e) => setContacto(e.target.value)} className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">{etiqueta('Su WhatsApp')}<input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">
          {etiqueta('Plan (opcional)')}
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={claseCampo} style={estiloCampo}>
            <option value="">Sin plan</option>
            {planes.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">{etiqueta('Usuario para entrar *')}<input value={usuario} onChange={(e) => { setUsuario(e.target.value); setTocado(true); }} autoCapitalize="none" placeholder="o un correo" className={claseCampo} style={estiloCampo} /></label>
        <label className="flex flex-col gap-1">
          {etiqueta('Contraseña *')}
          <span className="flex gap-1.5">
            <input value={contrasena} onChange={(e) => setContrasena(e.target.value)} className={claseCampo} style={estiloCampo} />
            <Boton tamano="sm" icono={RefreshCw} onClick={() => setContrasena(nuevaContrasena())} aria-label="Otra contraseña" style={{ height: 36 }}>{''}</Boton>
          </span>
        </label>
        {!propia && <label className="flex flex-col gap-1">{etiqueta('Acceso hasta (vacío = sin vencimiento)')}<input type="date" value={vence} onChange={(e) => setVence(e.target.value)} className={claseCampo} style={estiloCampo} /></label>}
      </div>
      <label className="flex items-start gap-2 text-[12.5px]" style={{ color: TEXTO_PRIMARIO }}>
        <input type="checkbox" className="mt-0.5" checked={propia} onChange={(e) => setPropia(e.target.checked)} />
        <span><b>Es una cuenta mía</b> (como el club o la agencia): no vence, tiene esta sección Agencia y aparece en "Cambiar de cuenta". Para un cliente, déjalo sin marcar.</span>
      </label>
      <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
        <input type="checkbox" checked={miClave} onChange={(e) => setMiClave(e.target.checked)} />
        Su IA usa mi clave de OpenAI
      </label>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" onClick={crear} disabled={guardando}>{guardando ? 'Creando…' : 'Crear acceso'}</Boton>
        <Boton onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
      </div>
    </Tarjeta>
  );
}

function FilaCuenta({ c, planes, onCambio }: { c: Cuenta; planes: Plan[]; onCambio: () => void }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [editVence, setEditVence] = useState(false);
  const [vence, setVence] = useState(diaDe(c.vence_en));
  const [acceso, setAcceso] = useState<{ usuario: string; contrasena: string } | null>(null);
  const est = c.propia ? { texto: 'Tuya', color: 'var(--accent)' } : ESTADO[c.estado];
  const plan = planes.find((p) => p.id === c.plan_id);
  const dias = c.vence_en ? Math.ceil((new Date(c.vence_en).getTime() - Date.now()) / 86400000) : null;

  const cambiar = async (cambios: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    const r = await llamarBackend(`/siguelo/agencia/cuentas/${c.empresa_id}`, cambios, 'PATCH');
    setOcupado(false);
    if (!r.ok) {
      toast(r.error || 'No se pudo.', 'error');
      return false;
    }
    toast(ok, 'ok');
    onCambio();
    return true;
  };
  const nuevaClave = async () => {
    if (!window.confirm(`¿Poner una contraseña nueva a "${c.nombre}"? La anterior deja de funcionar.`)) return;
    const contrasena = nuevaContrasena();
    if (await cambiar({ password: contrasena }, 'Contraseña cambiada.')) setAcceso({ usuario: c.usuario || '', contrasena });
  };

  if (acceso) return <Acceso nombre={c.nombre} usuario={acceso.usuario} contrasena={acceso.contrasena} onCerrar={() => setAcceso(null)} />;
  return (
    <Tarjeta className="p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
            {c.nombre} <Etiqueta color={est.color}>{est.texto}</Etiqueta>
            {!c.propia && c.estado === 'activa' && dias !== null && dias <= 7 && <Etiqueta color="var(--warn)">Vence en {dias} {dias === 1 ? 'día' : 'días'}</Etiqueta>}
          </span>
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Usuario <b>{c.usuario || '—'}</b>
            {plan && ` · ${plan.nombre}`}
            {!c.propia && ` · ${c.vence_en ? `hasta el ${fecha(c.vence_en)}` : 'sin vencimiento'}`}
          </span>
          <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
            {c.numeros ? `${c.conectados} de ${c.numeros} ${c.numeros === 1 ? 'número conectado' : 'números conectados'}` : 'Todavía no conectó su WhatsApp'}
            {(c.contacto || c.telefono) && ` · ${[c.contacto, c.telefono].filter(Boolean).join(' · ')}`}
            {` · creada el ${fecha(c.creado_en)}`}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!c.propia && <Boton tamano="sm" onClick={() => setEditVence((v) => !v)} disabled={ocupado}>Cambiar vencimiento</Boton>}
          {!c.propia && (c.pausada ? (
            <Boton tamano="sm" icono={Play} onClick={() => cambiar({ pausada: false }, 'La cuenta volvió a funcionar.')} disabled={ocupado}>Reanudar</Boton>
          ) : (
            <Boton tamano="sm" icono={Pause} onClick={() => window.confirm(`¿Pausar "${c.nombre}"? Nadie de esa cuenta podrá entrar y su IA se detiene. No se borra nada.`) && cambiar({ pausada: true }, 'Cuenta en pausa.')} disabled={ocupado}>Pausar</Boton>
          ))}
          <Boton tamano="sm" icono={KeyRound} onClick={nuevaClave} disabled={ocupado}>Nueva contraseña</Boton>
        </div>
      </div>
      {editVence && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} className={claseCampo} style={{ ...estiloCampo, width: 170 }} />
          {[30, 90, 365].map((d) => (
            <Boton key={d} tamano="sm" onClick={() => setVence(diaDe(new Date(Math.max(Date.now(), c.vence_en ? new Date(c.vence_en).getTime() : 0) + d * 86400000).toISOString()))}>+{d === 365 ? '1 año' : `${d} días`}</Boton>
          ))}
          <Boton tamano="sm" variante="primario" disabled={ocupado} onClick={async () => { if (await cambiar({ vence_en: vence ? finDelDia(vence) : null }, vence ? `Acceso hasta el ${fecha(finDelDia(vence))}.` : 'Sin vencimiento.')) setEditVence(false); }}>Guardar</Boton>
          <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Vacío = sin vencimiento. Para cobrar la renovación, usa "Registrar venta".</span>
        </div>
      )}
    </Tarjeta>
  );
}

export default function Cuentas({ cuentas, planes, onCambio }: { cuentas: Cuenta[]; planes: Plan[]; onCambio: () => void }) {
  const [nueva, setNueva] = useState(false);
  const [acceso, setAcceso] = useState<{ nombre: string; usuario: string; contrasena: string } | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'activa' | 'vencida' | 'pausada'>('todas');
  const lista = cuentas.filter((c) => filtro === 'todas' || (!c.propia && c.estado === filtro));
  return (
    <div className="flex flex-col gap-3">
      {acceso && <Acceso {...acceso} onCerrar={() => setAcceso(null)} />}
      {nueva ? (
        <FormCuenta planes={planes} onCerrar={() => setNueva(false)} onCreada={(a) => { setNueva(false); setAcceso(a); onCambio(); }} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Boton variante="primario" icono={Plus} onClick={() => setNueva(true)}>Crear acceso</Boton>
          <span className="flex-1" />
          {(['todas', 'activa', 'vencida', 'pausada'] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className="text-[12.5px] font-semibold px-2 py-1 rounded-lg" style={{ color: filtro === f ? 'var(--accent)' : TEXTO_TERCIARIO, backgroundColor: filtro === f ? 'var(--accent-soft)' : 'transparent' }}>
              {f === 'todas' ? 'Todas' : `${ESTADO[f].texto}s`.replace('En pausas', 'En pausa')}
            </button>
          ))}
        </div>
      )}
      {!cuentas.length && !nueva && (
        <Tarjeta className="flex">
          <EstadoVacio icono={Users} titulo="Todavía no creaste cuentas" texto="Crea el acceso de tu agencia (marca &quot;Es una cuenta mía&quot;) o registra una venta con un plan que traiga el CRM." />
        </Tarjeta>
      )}
      {lista.map((c) => <FilaCuenta key={c.empresa_id} c={c} planes={planes} onCambio={onCambio} />)}
    </div>
  );
}
