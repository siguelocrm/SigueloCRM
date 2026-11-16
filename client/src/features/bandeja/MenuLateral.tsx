import { useEffect, useState } from 'react';
import { ChevronRight, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Plus, Repeat, SlidersHorizontal, Sun } from 'lucide-react';
import type { CuentaGuardada } from '../../lib/cuentas';
import LogoEmpresa from '../../components/LogoEmpresa';
import type { Empresa, Usuario } from '../../lib/tipos';
import type { Seccion } from './constantes';

interface MenuLateralProps {
  grupos: (readonly [string, Seccion[]])[];
  seccion: string;
  onIr: (id: string) => void;
  plegado: boolean;
  /** true cuando la pantalla es angosta: el riel de íconos es obligatorio. */
  plegadoForzado: boolean;
  onPlegar: () => void;
  empresa: Empresa | null;
  usuario: Usuario;
  onCerrarSesion: () => void;
  /** Tus otras cuentas (club, agencia) para cambiar sin contraseña. */
  otrasCuentas?: CuentaGuardada[];
  onCambiarCuenta?: (id: string) => void;
  /** Solo en tus cuentas de agencia: entrar a otra cuenta tuya. */
  onAgregarCuenta?: () => void;
  /** Globo rojo por sección (ej. chats esperando respuesta en Bandeja). */
  insignias: Record<string, number>;
  temaClaro: boolean;
  onTema: () => void;
}

const GRUPO_ADMIN = 'Administrar';

// Menú lateral: Trabajo y Automatizar a la vista; lo administrativo se recoge
// en un único ítem "Administración" desplegable. Tema, plegar y cerrar sesión
// viven en el menú del usuario (pie).
export default function MenuLateral({ grupos, seccion, onIr, plegado, plegadoForzado, onPlegar, empresa, usuario, onCerrarSesion, otrasCuentas = [], onCambiarCuenta, onAgregarCuenta, insignias, temaClaro, onTema }: MenuLateralProps) {
  const iniciales = usuario.nombre.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const itemsAdmin = grupos.find(([g]) => g === GRUPO_ADMIN)?.[1] ?? [];
  const gruposVisibles = grupos.filter(([g]) => g !== GRUPO_ADMIN);
  const adminActivo = itemsAdmin.some((s) => s.id === seccion);
  const [adminAbierto, setAdminAbierto] = useState(adminActivo);
  const [menuUsuario, setMenuUsuario] = useState(false);
  useEffect(() => { if (adminActivo) setAdminAbierto(true); }, [adminActivo]);

  const boton = (s: Seccion, anidado = false) => {
    const Icono = s.icon;
    const activa = seccion === s.id;
    const insignia = insignias[s.id] || 0;
    return (
      <button
        key={s.id}
        onClick={() => onIr(s.id)}
        title={plegado ? s.label : undefined}
        aria-label={s.label}
        aria-current={activa ? 'page' : undefined}
        className={`relative flex items-center rounded-xl py-2.5 text-left ${plegado ? 'justify-center' : anchoItem(anidado)}`}
        style={{ backgroundColor: activa ? 'var(--accent-soft)' : 'transparent', color: activa ? 'var(--accent)' : 'var(--fg-2)', fontWeight: activa ? 600 : 500 }}
        onMouseEnter={(e) => { if (!activa) e.currentTarget.style.backgroundColor = 'var(--accent-soft)'; }}
        onMouseLeave={(e) => { if (!activa) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <Icono size={plegado ? 20 : 18} className="shrink-0" />
        {!plegado && <span className="text-[14px] flex-1 truncate">{s.label}</span>}
        {s.id === 'hoy' && !plegado && (
          <span className="rounded-full text-[10.5px] font-bold px-[7px]" style={{ backgroundColor: 'var(--ok-soft)', color: 'var(--ok)' }}>Nuevo</span>
        )}
        {insignia > 0 && (plegado ? (
          <span className="absolute top-1.5 right-3.5 rounded-full" style={{ width: 9, height: 9, backgroundColor: 'var(--bad)' }} aria-label={`${insignia} pendientes`} />
        ) : (
          <span className="num rounded-full text-white text-[11.5px] font-semibold text-center leading-[18px] min-w-[20px] px-1.5" style={{ backgroundColor: 'var(--bad)' }} aria-label={`${insignia} pendientes`}>
            {insignia > 99 ? '99+' : insignia}
          </span>
        ))}
      </button>
    );
  };
  const anchoItem = (anidado: boolean) => (anidado ? 'gap-3 pl-5 pr-3' : 'gap-3 px-3');

  return (
    <nav
      aria-label="Principal"
      className="flex flex-col shrink-0 px-2.5 pt-3.5 min-h-0"
      style={{ width: plegado ? 68 : 240, background: 'var(--side, linear-gradient(180deg, var(--surface), var(--bg2)))', borderRight: '1px solid var(--line)', transition: 'width 160ms ease' }}
    >
      <div className={`flex items-center pb-3 ${plegado ? 'justify-center' : 'gap-2.5 px-2'}`}>
        <LogoEmpresa logoUrl={empresa?.logo_url} nombre={empresa?.nombre} size={plegado ? 38 : 38} />
        {!plegado && (
          <div className="flex flex-col min-w-0 flex-1">
            <span className="disp font-bold text-[15px] truncate" style={{ color: 'var(--fg)' }}>{empresa?.nombre || 'Mi CRM'}</span>
            <span className="text-[12px] truncate" style={{ color: 'var(--fg-2)' }}>CRM de atención</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto min-h-0 flex-1 -mx-1 px-1">
        {gruposVisibles.map(([grupo, items]) => (
          <div key={grupo} className="flex flex-col gap-0.5">
            {plegado ? (
              <span className="mx-3.5 my-2.5 h-px" style={{ backgroundColor: 'var(--line)' }} />
            ) : (
              <span className="eyebrow px-2.5 pt-3.5 pb-1.5">{grupo}</span>
            )}
            {items.map((s) => boton(s))}
          </div>
        ))}

        {itemsAdmin.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {plegado ? (
              <span className="mx-3.5 my-2.5 h-px" style={{ backgroundColor: 'var(--line)' }} />
            ) : (
              <span className="eyebrow px-2.5 pt-3.5 pb-1.5">{GRUPO_ADMIN}</span>
            )}
            <button
              onClick={() => (plegado ? onIr(itemsAdmin[0].id) : setAdminAbierto((v) => !v))}
              title={plegado ? 'Administración' : undefined}
              aria-label="Administración"
              aria-expanded={plegado ? undefined : adminAbierto}
              className={`flex items-center rounded-xl py-2.5 text-left ${plegado ? 'justify-center' : 'gap-3 px-3'}`}
              style={{ color: adminActivo ? 'var(--accent)' : 'var(--fg-2)', fontWeight: 500, backgroundColor: plegado && adminActivo ? 'var(--accent-soft)' : 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = plegado && adminActivo ? 'var(--accent-soft)' : 'transparent'; }}
            >
              <SlidersHorizontal size={plegado ? 20 : 18} className="shrink-0" />
              {!plegado && <span className="text-[14px] flex-1">Administración</span>}
              {!plegado && <ChevronRight size={15} className="shrink-0" style={{ transform: adminAbierto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />}
            </button>
            {!plegado && adminAbierto && <div className="flex flex-col gap-0.5">{itemsAdmin.map((s) => boton(s, true))}</div>}
          </div>
        )}
      </div>

      <div className="relative py-2.5 mt-1" style={{ borderTop: '1px solid var(--line)' }}>
        {menuUsuario && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuUsuario(false)} />
            <div
              role="menu"
              className="aparecer absolute z-20 rounded-[14px] p-1.5"
              style={plegado
                ? { left: 'calc(100% + 4px)', bottom: 8, width: 220, backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(7,26,56,.18)' }
                : { left: 0, right: 0, bottom: 'calc(100% - 4px)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(7,26,56,.18)' }}
            >
              <button role="menuitem" onClick={() => { onTema(); setMenuUsuario(false); }} className="flex items-center gap-2.5 w-full rounded-[10px] px-2.5 py-2 text-[13.5px] text-left" style={{ color: 'var(--fg-2)' }}>
                {temaClaro ? <Moon size={17} /> : <Sun size={17} />}{temaClaro ? 'Tema oscuro' : 'Tema claro'}
              </button>
              {!plegadoForzado && (
                <button role="menuitem" onClick={() => { onPlegar(); setMenuUsuario(false); }} className="flex items-center gap-2.5 w-full rounded-[10px] px-2.5 py-2 text-[13.5px] text-left" style={{ color: 'var(--fg-2)' }}>
                  {plegado ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}{plegado ? 'Expandir menú' : 'Plegar menú'}
                </button>
              )}
              {otrasCuentas.map((c) => (
                <button key={c.id} role="menuitem" onClick={() => { setMenuUsuario(false); onCambiarCuenta?.(c.id); }} className="flex items-center gap-2.5 w-full rounded-[10px] px-2.5 py-2 text-[13.5px] text-left" style={{ color: 'var(--fg)' }} title={`Cambiar a ${c.empresa || c.correo}`}>
                  <Repeat size={17} className="shrink-0" /><span className="truncate">Cambiar a <b>{c.empresa || c.correo}</b></span>
                </button>
              ))}
              {onAgregarCuenta && (
                <button role="menuitem" onClick={() => { setMenuUsuario(false); onAgregarCuenta(); }} className="flex items-center gap-2.5 w-full rounded-[10px] px-2.5 py-2 text-[13.5px] text-left" style={{ color: 'var(--fg-2)' }}>
                  <Plus size={17} />Entrar a otra cuenta tuya
                </button>
              )}
              <button role="menuitem" onClick={() => { setMenuUsuario(false); onCerrarSesion(); }} className="flex items-center gap-2.5 w-full rounded-[10px] px-2.5 py-2 text-[13.5px] text-left" style={{ color: 'var(--fg-2)' }}>
                <LogOut size={17} />Cerrar sesión
              </button>
            </div>
          </>
        )}
        <button
          onClick={() => setMenuUsuario((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuUsuario}
          title={plegado ? usuario.nombre : undefined}
          className={`flex items-center w-full rounded-xl p-1.5 text-left ${plegado ? 'justify-center' : 'gap-2.5'}`}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-soft)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {iniciales}
          </span>
          {!plegado && (
            <>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold truncate leading-tight" style={{ color: 'var(--fg)' }}>{usuario.nombre}</span>
                <span className="block text-[12px] truncate" style={{ color: 'var(--fg-2)' }}>{usuario.rol}</span>
              </span>
              <ChevronRight size={15} className="shrink-0" style={{ transform: 'rotate(-90deg)', color: 'var(--fg-3)' }} />
            </>
          )}
        </button>
      </div>
    </nav>
  );
}
