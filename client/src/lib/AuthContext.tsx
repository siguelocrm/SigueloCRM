import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Empresa, Usuario } from './tipos';
import { actualizarTokens, correoDeUsuario, cuentasGuardadas, guardarCuenta, olvidarCuenta, type CuentaGuardada } from './cuentas';

interface AuthContextValue {
  sesion: Session | null;
  usuario: Usuario | null;
  empresa: Empresa | null;
  cargando: boolean;
  modoRecuperacion: boolean;
  iniciarSesion: (email: string, password: string) => Promise<{ error: { message: string } | null }>;
  cerrarSesion: () => Promise<void>;
  actualizarContrasena: (nuevaContrasena: string) => Promise<{ error: { message: string } | null }>;
  recargarEmpresa: () => Promise<void>;
  recargarUsuario: () => Promise<void>;
  // SígueloCRM: '' si la cuenta está bien; 'pausada' o 'vencida' (Agencia → Cuentas).
  estadoCuenta: string;
  // ¿Esta cuenta es una de tus agencias (y tú su dueño principal)? Ve la sección Agencia.
  esAgencia: boolean;
  // Tus otras cuentas guardadas en este navegador (para cambiar sin contraseña).
  otrasCuentas: CuentaGuardada[];
  cambiarDeCuenta: (id: string) => Promise<{ error: string | null }>;
  agregarCuenta: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Aplica (o saca) los colores de marca de la empresa como custom properties
// CSS — NAVY/TEAL en tema.ts los usan como fallback var(--marca-x, #hex),
// así que si la empresa no configuró nada no cambia nada.
function aplicarColoresDeMarca(empresa: Empresa | null) {
  const raiz = document.documentElement.style;
  if (empresa?.color_primario) raiz.setProperty('--marca-primario', empresa.color_primario);
  else raiz.removeProperty('--marca-primario');
  if (empresa?.color_acento) raiz.setProperty('--marca-acento', empresa.color_acento);
  else raiz.removeProperty('--marca-acento');
  // El texto sobre el acento (--accent-fg) se elige según qué tan claro sea el
  // color de la empresa; si no, un acento claro deja botones blanco sobre blanco.
  const textoSobreAcento = empresa?.color_acento ? textoLegibleSobre(empresa.color_acento) : null;
  if (textoSobreAcento) raiz.setProperty('--accent-fg', textoSobreAcento);
  else raiz.removeProperty('--accent-fg');
}

const TEXTO_CLARO = '#ffffff';
const TEXTO_OSCURO = '#031326';

// Luminancia relativa (WCAG) de un color #rgb o #rrggbb; null si no se puede leer.
function luminancia(hex: string): number | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Devuelve el texto (claro u oscuro) con más contraste sobre el fondo dado.
function textoLegibleSobre(fondo: string): string | null {
  const lf = luminancia(fondo);
  if (lf === null) return null;
  const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contraste(lf, luminancia(TEXTO_CLARO)!) >= contraste(lf, luminancia(TEXTO_OSCURO)!) ? TEXTO_CLARO : TEXTO_OSCURO;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null); // fila de la tabla `usuarios` (rol, línea, empresa)
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [modoRecuperacion, setModoRecuperacion] = useState(false);
  const [estadoCuenta, setEstadoCuenta] = useState('');
  const [esAgencia, setEsAgencia] = useState(false);
  const [otrasCuentas, setOtrasCuentas] = useState<CuentaGuardada[]>([]);

  const cargarEmpresa = async (empresaId: string) => {
    const { data } = await supabase.from('empresas').select('*').eq('id', empresaId).single();
    const fila = (data as Empresa) || null;
    setEmpresa(fila);
    aplicarColoresDeMarca(fila);
    if (fila?.nombre) document.title = fila.nombre;
    return fila;
  };

  // La cuenta (pausada/vencida) y si es una de tus agencias. Sin la sección 41 pegada: nada cambia.
  const cargarCuenta = async (sesionActual: Session, fila: Usuario) => {
    const { data: estado } = await supabase.rpc('siguelo_mi_cuenta');
    setEstadoCuenta(typeof estado === 'string' ? estado : '');
    const [{ data: agencia }, { data: acceso }] = await Promise.all([
      supabase.from('siguelo_agencias').select('empresa_id').eq('empresa_id', fila.empresa_id).maybeSingle(),
      supabase.from('siguelo_accesos').select('principal').eq('usuario_id', fila.id).maybeSingle(),
    ]);
    const deAgencia = !!agencia;
    setEsAgencia(deAgencia && !!acceso?.principal);
    // Tus cuentas (las de agencia) se recuerdan en este navegador para cambiar de una a otra.
    if (deAgencia) guardarCuenta(sesionActual, (await supabase.from('empresas').select('nombre').eq('id', fila.empresa_id).maybeSingle()).data?.nombre || '');
    setOtrasCuentas(cuentasGuardadas().filter((c) => c.id !== sesionActual.user.id));
  };

  const cargarPerfil = async (sesionActual: Session | null) => {
    if (!sesionActual) {
      setUsuario(null);
      setEmpresa(null);
      setEstadoCuenta('');
      setEsAgencia(false);
      setOtrasCuentas(cuentasGuardadas());
      aplicarColoresDeMarca(null);
      return;
    }
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', sesionActual.user.id)
      .single();
    if (error) {
      console.error('No se pudo cargar el perfil del usuario:', error.message);
      setUsuario(null);
      setEmpresa(null);
      aplicarColoresDeMarca(null);
    } else {
      const fila = data as Usuario;
      setUsuario(fila);
      await cargarEmpresa(fila.empresa_id);
      await cargarCuenta(sesionActual, fila).catch(() => undefined);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSesion(session);
      await cargarPerfil(session);
      setCargando(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (evento, session) => {
      // Supabase renueva el token cada hora: la cuenta guardada se queda con el nuevo.
      if (evento === 'TOKEN_REFRESHED' && session) {
        actualizarTokens(session);
        setSesion(session);
        return;
      }
      setSesion(session);
      await cargarPerfil(session);
      if (evento === 'PASSWORD_RECOVERY') setModoRecuperacion(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Se puede entrar con el correo o con el usuario corto ("agencia").
  const iniciarSesion = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: correoDeUsuario(email), password });
    return { error };
  };

  // Cerrar sesión también olvida esta cuenta en este navegador.
  const cerrarSesion = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) olvidarCuenta(data.session.user.id);
    await supabase.auth.signOut();
  };

  // Cambia a otra de tus cuentas guardadas (sin contraseña) y recarga la página.
  const cambiarDeCuenta = async (id: string) => {
    const destino = cuentasGuardadas().find((c) => c.id === id);
    if (!destino) return { error: 'Esa cuenta ya no está guardada: entra con su usuario y contraseña.' };
    const { data } = await supabase.auth.getSession();
    if (data.session) actualizarTokens(data.session);
    const { error } = await supabase.auth.setSession({ access_token: destino.access_token, refresh_token: destino.refresh_token });
    if (error) {
      olvidarCuenta(id);
      // Vuelve a la cuenta en la que estaba.
      if (data.session) await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      return { error: 'Esa cuenta se cerró: entra otra vez con su usuario y contraseña.' };
    }
    window.location.reload();
    return { error: null };
  };

  // Para entrar a otra cuenta tuya: esta queda guardada y se muestra la entrada.
  const agregarCuenta = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) actualizarTokens(data.session);
    await supabase.auth.signOut({ scope: 'local' });
  };

  const actualizarContrasena = async (nuevaContrasena: string) => {
    const { error } = await supabase.auth.updateUser({ password: nuevaContrasena });
    if (!error) setModoRecuperacion(false);
    return { error };
  };

  const recargarEmpresa = async () => {
    if (usuario) await cargarEmpresa(usuario.empresa_id);
  };

  const recargarUsuario = async () => {
    if (sesion) await cargarPerfil(sesion);
  };

  return (
    <AuthContext.Provider
      value={{
        sesion,
        usuario,
        empresa,
        cargando,
        modoRecuperacion,
        iniciarSesion,
        cerrarSesion,
        actualizarContrasena,
        recargarEmpresa,
        recargarUsuario,
        estadoCuenta,
        esAgencia,
        otrasCuentas,
        cambiarDeCuenta,
        agregarCuenta,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
