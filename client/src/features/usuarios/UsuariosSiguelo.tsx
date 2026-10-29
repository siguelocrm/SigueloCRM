import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, colorAvatar } from '../../lib/tema';
import { Boton, EncabezadoPagina, Interruptor, Tarjeta, useToast } from '../../components/ui';
import type { RolUsuario, Usuario } from '../../lib/tipos';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';
import Usuarios from './Usuarios';

// Usuarios con jerarquía (SígueloCRM): el dueño principal arriba de todo; cada
// uno solo crea, edita o elimina a los que están debajo de él, con un rol más
// bajo que el suyo, y les da acceso solo a números que él tiene. El servidor
// (server/src/siguelo/usuarios) y los permisos de la base revisan lo mismo.

type Acceso = { usuario_id: string; jefe_id: string | null; principal: boolean; todas_lineas: boolean; lineas: string[]; vence_en?: string | null };
type Linea = { id: string; nombre: string };
// vence: '' = sin vencimiento; si no, la fecha (AAAA-MM-DD) hasta la que puede entrar, incluida.
type Borrador = { id?: string; nombre: string; email: string; password: string; rol: RolUsuario; todas: boolean; lineas: string[]; activo: boolean; vence: string; venceAntes: string };

const hoyMas = (meses: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
};
const PLAZOS: { texto: string; meses: number }[] = [
  { texto: '1 mes', meses: 1 },
  { texto: '3 meses', meses: 3 },
  { texto: '6 meses', meses: 6 },
  { texto: '1 año', meses: 12 },
];
// Hasta el final de ese día, en la hora de esta computadora.
const finDelDia = (fecha: string) => new Date(`${fecha}T23:59:59`).toISOString();
const fechaCorta = (iso: string) => new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

const NIVEL_ROL: Record<RolUsuario, number> = { dueno: 3, supervisor: 2, atendedor_online: 1, vendedor: 1 };
const NOMBRE_ROL: Record<RolUsuario, string> = { dueno: 'Dueño de negocio', supervisor: 'Gerente', vendedor: 'Vendedor', atendedor_online: 'Atendedor online' };
const QUE_HACE: Record<string, string> = {
  dueno: 'Ve y configura todo en sus números (negocios, IA, seguimiento, conexiones) y crea gerentes y vendedores.',
  supervisor: 'Atiende y supervisa sus números (bot, seguimiento, reportes) y crea vendedores.',
  vendedor: 'Atiende los chats de sus números.',
};

export default function UsuariosSiguelo() {
  const { usuario } = useAuth();
  const toast = useToast();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [accesos, setAccesos] = useState<Record<string, Acceso> | null>({});
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [b, setB] = useState<Borrador | null>(null);
  const [clave, setClave] = useState<{ u: Usuario; nueva: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const [u, a, l] = await Promise.all([
      supabase.from('usuarios').select('*').order('nombre').returns<Usuario[]>(),
      supabase.from('siguelo_accesos').select('*').returns<Acceso[]>(),
      supabase.from('lineas_whatsapp').select('id, nombre').order('nombre').returns<Linea[]>(),
    ]);
    setUsuarios(u.data || []);
    setAccesos(a.error ? null : Object.fromEntries((a.data || []).map((x) => [x.usuario_id, x])));
    setLineas(l.data || []);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const yo = usuario && accesos ? accesos[usuario.id] : undefined;
  const miNivel = !usuario ? 0 : yo?.principal ? 4 : NIVEL_ROL[usuario.rol];
  const veTodo = !!yo && (yo.principal || yo.todas_lineas);

  // ¿Está debajo de mí? (el dueño principal: todos menos él)
  const esMio = useCallback(
    (id: string) => {
      if (!usuario || !accesos || id === usuario.id || accesos[id]?.principal) return false;
      if (yo?.principal) return true;
      let jefe = accesos[id]?.jefe_id;
      for (let i = 0; jefe && i < 30; i++) {
        if (jefe === usuario.id) return true;
        jefe = accesos[jefe]?.jefe_id;
      }
      return false;
    },
    [usuario, accesos, yo],
  );

  // En orden de jerarquía: cada uno con los suyos debajo.
  const arbol = useMemo(() => {
    if (!accesos) return usuarios.map((u) => ({ u, nivel: 0 }));
    const hijos = new Map<string, Usuario[]>();
    const raiz: Usuario[] = [];
    for (const u of usuarios) {
      const jefe = accesos[u.id]?.jefe_id;
      if (jefe && usuarios.some((x) => x.id === jefe)) hijos.set(jefe, [...(hijos.get(jefe) || []), u]);
      else raiz.push(u);
    }
    raiz.sort((x, y) => Number(!!accesos[y.id]?.principal) - Number(!!accesos[x.id]?.principal));
    const lista: { u: Usuario; nivel: number }[] = [];
    const recorrer = (u: Usuario, nivel: number) => {
      lista.push({ u, nivel });
      for (const h of hijos.get(u.id) || []) recorrer(h, nivel + 1);
    };
    raiz.forEach((u) => recorrer(u, 0));
    return lista;
  }, [usuarios, accesos]);

  if (!usuario) return null;
  if (!accesos) {
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 md:px-8 pt-4 text-[12.5px]" style={{ color: 'var(--warn)' }}>
          Para usar los roles con jerarquía y los números por persona, vuelve a pegar database/siguelo.sql en Supabase.
        </div>
        <Usuarios />
      </div>
    );
  }

  const rolesQuePuedoDar = (['dueno', 'supervisor', 'vendedor'] as RolUsuario[]).filter((r) => NIVEL_ROL[r] < miNivel);
  const nombreLinea = (id: string) => lineas.find((l) => l.id === id)?.nombre ?? 'otro número';
  const textoNumeros = (u: Usuario) => {
    const a = accesos[u.id];
    if (!a) return u.rol === 'vendedor' ? (u.linea_id ? nombreLinea(u.linea_id) : 'Ningún número') : 'Todos los números';
    if (a.principal || a.todas_lineas) return 'Todos los números';
    return a.lineas.length ? a.lineas.map(nombreLinea).join(', ') : 'Ningún número';
  };

  const nuevo = () => setB({ nombre: '', email: '', password: '', rol: rolesQuePuedoDar[rolesQuePuedoDar.length - 1] ?? 'vendedor', todas: false, lineas: [], activo: true, vence: '', venceAntes: '' });
  const editar = (u: Usuario) => {
    const a = accesos[u.id];
    const vence = a?.vence_en ? new Date(a.vence_en).toISOString().slice(0, 10) : '';
    setB({ id: u.id, nombre: u.nombre, email: '', password: '', rol: u.rol, todas: a ? a.todas_lineas : u.rol !== 'vendedor', lineas: a ? a.lineas : u.linea_id ? [u.linea_id] : [], activo: u.activo, vence, venceAntes: vence });
  };

  const guardar = async () => {
    if (!b) return;
    if (!b.nombre.trim()) return toast('Escribe el nombre.', 'error');
    if (b.vence && finDelDia(b.vence) <= new Date().toISOString()) return toast('La fecha de "Acceso hasta" tiene que ser en el futuro.', 'error');
    setGuardando(true);
    const numeros = { todas_lineas: b.todas, lineas: b.todas ? [] : b.lineas };
    // El vencimiento solo se manda si cambió (o al crear).
    const vence = !b.id || b.vence !== b.venceAntes ? { vence_en: b.vence ? finDelDia(b.vence) : null } : {};
    const r = b.id
      ? await llamarBackend(`/siguelo/usuarios/${b.id}`, { nombre: b.nombre, rol: b.rol, activo: b.activo, ...numeros, ...vence }, 'PATCH')
      : await llamarBackend('/siguelo/usuarios', { nombre: b.nombre, email: b.email, password: b.password, rol: b.rol, ...numeros, ...vence });
    setGuardando(false);
    if (!r.ok) return toast(r.error || 'No se pudo guardar.', 'error');
    toast(b.id ? 'Cambios guardados' : `${b.nombre} ya puede entrar con su correo y contraseña`, 'ok');
    setB(null);
    cargar();
  };

  const eliminar = async (u: Usuario) => {
    if (!window.confirm(`¿Eliminar a ${u.nombre}? Ya no podrá entrar. Sus chats y notas se quedan; los que estaban debajo de él pasan a su jefe.`)) return;
    const r = await llamarBackend(`/siguelo/usuarios/${u.id}`, {}, 'DELETE');
    if (!r.ok) return toast(r.error || 'No se pudo eliminar.', 'error');
    toast(`${u.nombre} eliminado`, 'ok');
    cargar();
  };

  const guardarClave = async () => {
    if (!clave) return;
    if (clave.nueva.length < 6) return toast('La contraseña necesita al menos 6 caracteres.', 'error');
    const r = await llamarBackend(`/usuarios/${clave.u.id}/password`, { password: clave.nueva }, 'PATCH');
    if (!r.ok) return toast(r.error || 'No se pudo cambiar.', 'error');
    toast(`Contraseña de ${clave.u.nombre} cambiada. Pásasela por un canal seguro.`, 'ok');
    setClave(null);
  };

  const editor = b && (
    <Tarjeta className="p-4 flex flex-col gap-3.5 max-w-2xl">
      <span className="text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{b.id ? `Editar a ${b.nombre}` : 'Nuevo usuario'}</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
          Nombre completo
          <input value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} className={`${claseCampo} font-normal`} style={estiloCampo} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
          Rol
          <select value={b.rol} onChange={(e) => setB({ ...b, rol: e.target.value as RolUsuario })} className={`${claseCampo} font-normal`} style={estiloCampo}>
            {rolesQuePuedoDar.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
            {!rolesQuePuedoDar.includes(b.rol) && <option value={b.rol}>{NOMBRE_ROL[b.rol]}</option>}
          </select>
          <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{QUE_HACE[b.rol] ?? ''}</span>
        </label>
        {!b.id && (
          <>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              Correo (para entrar)
              <input value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} type="email" autoComplete="off" className={`${claseCampo} font-normal`} style={estiloCampo} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
              Contraseña temporal
              <input value={b.password} onChange={(e) => setB({ ...b, password: e.target.value })} type="text" autoComplete="off" placeholder="Mínimo 6 caracteres" className={`${claseCampo} font-normal`} style={estiloCampo} />
            </label>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Números a los que tiene acceso</span>
        {veTodo && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            <input type="radio" checked={b.todas} onChange={() => setB({ ...b, todas: true })} /> Todos los números (también los que agregues después)
          </label>
        )}
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          <input type="radio" checked={!b.todas} onChange={() => setB({ ...b, todas: false })} /> Solo estos:
        </label>
        {!b.todas && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-6">
            {lineas.map((l) => (
              <label key={l.id} className="flex items-center gap-1.5 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
                <input type="checkbox" checked={b.lineas.includes(l.id)} onChange={(e) => setB({ ...b, lineas: e.target.checked ? [...b.lineas, l.id] : b.lineas.filter((x) => x !== l.id) })} />
                {l.nombre}
              </label>
            ))}
            {!b.lineas.length && <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>Sin ningún número no verá ningún chat.</span>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Acceso hasta</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setB({ ...b, vence: '' })} className="h-8 px-3 rounded-full text-[12.5px]" style={{ border: `1px solid ${!b.vence ? 'var(--accent)' : BORDE}`, color: !b.vence ? 'var(--accent)' : TEXTO_SECUNDARIO }}>Sin vencimiento</button>
          {PLAZOS.map((p) => {
            const f = hoyMas(p.meses);
            return (
              <button key={p.meses} onClick={() => setB({ ...b, vence: f })} className="h-8 px-3 rounded-full text-[12.5px]" style={{ border: `1px solid ${b.vence === f ? 'var(--accent)' : BORDE}`, color: b.vence === f ? 'var(--accent)' : TEXTO_SECUNDARIO }}>{p.texto}</button>
            );
          })}
          <input type="date" value={b.vence} onChange={(e) => setB({ ...b, vence: e.target.value })} aria-label="Acceso hasta (fecha)" className={claseCampo} style={{ ...estiloCampo, height: 32 }} />
        </div>
        <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
          {b.vence ? `Puede entrar hasta el ${fechaCorta(finDelDia(b.vence))} inclusive; después queda desactivado solo. Para renovarlo, cambia la fecha.` : 'Puede entrar mientras esté activo.'}
        </span>
      </div>
      {b.id && (
        <div className="flex items-center gap-2.5 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
          <Interruptor activo={b.activo} onCambiar={(v) => setB({ ...b, activo: v })} etiqueta="Puede entrar (activo)" />
          {b.activo ? 'Activo: puede entrar' : 'Desactivado: no puede entrar ni ve nada'}
        </div>
      )}
      <div className="flex gap-2">
        <Boton variante="primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : b.id ? 'Guardar cambios' : 'Crear usuario'}</Boton>
        <Boton variante="fantasma" onClick={() => setB(null)}>Cancelar</Boton>
      </div>
    </Tarjeta>
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina titulo="Usuarios" subtitulo="Cada persona solo administra a los que están debajo de ella y ve solo los chats de sus números." />
      <Tarjeta className="px-4 py-3 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        <b style={{ color: TEXTO_PRIMARIO }}>Roles:</b> Dueño principal (tú, nadie puede editarte) · <b>Dueño de negocio</b>: {QUE_HACE.dueno} · <b>Gerente</b>: {QUE_HACE.supervisor} · <b>Vendedor</b>: {QUE_HACE.vendedor}
      </Tarjeta>
      {miNivel >= 2 && !b && <Boton variante="primario" icono={Plus} className="self-start" onClick={nuevo}>Nuevo usuario</Boton>}
      {editor}
      {clave && (
        <Tarjeta className="p-4 flex flex-col gap-2.5 max-w-md">
          <span className="text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Nueva contraseña para {clave.u.nombre}</span>
          <input value={clave.nueva} onChange={(e) => setClave({ ...clave, nueva: e.target.value })} type="text" autoComplete="off" placeholder="Mínimo 6 caracteres" className={claseCampo} style={estiloCampo} />
          <div className="flex gap-2">
            <Boton variante="primario" onClick={guardarClave}>Guardar contraseña</Boton>
            <Boton variante="fantasma" onClick={() => setClave(null)}>Cancelar</Boton>
          </div>
        </Tarjeta>
      )}
      <Tarjeta className="flex flex-col">
        {arbol.map(({ u, nivel }, i) => {
          const a = accesos[u.id];
          const mio = esMio(u.id);
          return (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 flex-wrap" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none', paddingLeft: 16 + Math.min(nivel, 4) * 22 }}>
              <div className="rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ width: 34, height: 34, backgroundColor: colorAvatar(u.id), opacity: u.activo ? 1 : 0.45 }}>
                {u.nombre.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-[180px] flex flex-col">
                <span className="text-[13.5px] font-semibold flex items-center gap-1.5" style={{ color: TEXTO_PRIMARIO }}>
                  {u.nombre}
                  {u.id === usuario.id && <span className="text-[11.5px] font-normal" style={{ color: TEXTO_TERCIARIO }}>(tú)</span>}
                  {!u.activo && <span className="text-[11px] font-semibold rounded px-1.5" style={{ color: 'var(--bad)', backgroundColor: 'var(--bad-soft)' }}>Inactivo</span>}
                </span>
                <span className="text-[12px] flex items-center gap-1 flex-wrap" style={{ color: TEXTO_TERCIARIO }}>
                  {a?.principal ? <><ShieldCheck size={12} color="var(--accent)" /> Dueño principal</> : NOMBRE_ROL[u.rol]} · {textoNumeros(u)}
                  {a?.vence_en && !a.principal && (
                    new Date(a.vence_en).getTime() <= Date.now()
                      ? <span className="font-semibold" style={{ color: 'var(--bad)' }}>· venció el {fechaCorta(a.vence_en)}</span>
                      : <span>· hasta el {fechaCorta(a.vence_en)}</span>
                  )}
                </span>
              </div>
              {mio && (
                <div className="flex items-center gap-1.5">
                  <Boton tamano="sm" icono={Pencil} onClick={() => editar(u)}>Editar</Boton>
                  <button onClick={() => setClave({ u, nueva: '' })} aria-label={`Cambiar contraseña de ${u.nombre}`} title="Cambiar contraseña" className="rounded-lg p-1.5" style={{ border: `1px solid ${BORDE}`, color: TEXTO_SECUNDARIO }}><KeyRound size={14} /></button>
                  <button onClick={() => eliminar(u)} aria-label={`Eliminar a ${u.nombre}`} title="Eliminar" className="rounded-lg p-1.5" style={{ border: `1px solid ${BORDE}`, color: 'var(--bad)' }}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
        {!arbol.length && (
          <div className="p-6 flex items-center gap-2 text-[13px]" style={{ color: TEXTO_TERCIARIO }}><UserCog size={16} /> Cargando…</div>
        )}
      </Tarjeta>
    </div>
  );
}
