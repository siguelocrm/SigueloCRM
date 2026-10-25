import { useEffect, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { NAVY, BLUE, BORDE, BORDE_INPUT, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO, FOCO_INPUT } from '../../lib/tema';

// Antes de entrar todavía no se puede leer la empresa (permisos), así que el
// nombre lo da el servidor (/marca). Mientras llega, el del .env.
const NOMBRE_POR_DEFECTO = import.meta.env.VITE_NOMBRE_NEGOCIO || 'Mi CRM';

const CARACTERISTICAS = [
  'Bandeja compartida por WhatsApp, sin duplicar chats',
  'Embudo de ventas y ficha de cada lead en un solo lugar',
  'Reportes de origen y equipo listos para revisar',
];

export default function Login() {
  const { iniciarSesion } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [mantenerSesion, setMantenerSesion] = useState(true);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [nombreNegocio, setNombreNegocio] = useState(NOMBRE_POR_DEFECTO);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_BACKEND_URL ?? ''}/marca`)
      .then((r) => r.json())
      .then((marca: { nombre: string | null }) => {
        if (!marca.nombre) return;
        setNombreNegocio(marca.nombre);
        document.title = marca.nombre;
      })
      .catch(() => { /* sin servidor: queda el nombre del .env */ });
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    const { error } = await iniciarSesion(email, password);
    setEnviando(false);
    if (error) setError('Email o contraseña incorrectos.');
  };

  return (
    <div className="w-full h-full flex items-center justify-center px-4" style={{ background: '#E8EBF0', minHeight: '480px' }}>
      <div
        className="w-full max-w-[880px] rounded-2xl overflow-hidden flex flex-col md:flex-row"
        style={{ backgroundColor: 'var(--surface)', boxShadow: '0 24px 60px -24px rgba(11,27,51,.35)' }}
      >
        <div
          className="hidden md:flex flex-col justify-between shrink-0 p-8"
          style={{ width: '360px', background: `linear-gradient(150deg, ${NAVY} 0%, #14335C 100%)` }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-[15px] font-bold text-white"
              style={{ background: `linear-gradient(150deg, ${BLUE}, var(--accent))` }}
            >
              {nombreNegocio.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col gap-px">
              <span className="text-white text-[15px] font-bold tracking-wider">{nombreNegocio}</span>
              <span className="text-[11px] tracking-wider" style={{ color: '#7C93B5' }}>CRM DE VENTAS</span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="m-0 text-2xl font-bold leading-snug text-white">Tu Whatsapp con superpoderes.</h2>
            <div className="flex flex-col gap-2.5">
              {CARACTERISTICAS.map((texto) => (
                <div key={texto} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(255,255,255,.14)' }}>
                    <Check size={10} color="#6EE0AC" strokeWidth={3} />
                  </span>
                  <span className="text-[13.5px]" style={{ color: '#D5DEEA' }}>{texto}</span>
                </div>
              ))}
            </div>
          </div>

          <span className="text-[11px]" style={{ color: '#5E769B' }}>{nombreNegocio} · panel interno</span>
        </div>

        <form onSubmit={enviar} className="flex-1 min-w-0 flex flex-col justify-center gap-5 p-7 md:p-10">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[26px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>Entrar</h2>
            <p className="m-0 text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>Ingresá con tu cuenta de agente.</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>Correo</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tuemail@ejemplo.com"
                autoComplete="username"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none"
                style={{ border: `1px solid ${BORDE_INPUT}`, color: TEXTO_PRIMARIO }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>Contraseña</label>
                <a href="#" className="text-xs font-medium" style={{ color: BLUE }}>¿La olvidaste?</a>
              </div>
              <div className="relative">
                <input
                  type={verPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-lg pl-3.5 pr-10 py-2.5 text-sm outline-none"
                  style={{ border: `1px solid ${BORDE_INPUT}`, color: TEXTO_PRIMARIO, boxShadow: password ? FOCO_INPUT : 'none' }}
                />
                <button
                  type="button"
                  onClick={() => setVerPassword((v) => !v)}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: TEXTO_TERCIARIO }}
                >
                  {verPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: TEXTO_SECUNDARIO }}>
              <input type="checkbox" checked={mantenerSesion} onChange={(e) => setMantenerSesion(e.target.checked)} className="w-3.5 h-3.5" />
              Mantener la sesión abierta en esta computadora
            </label>
          </div>

          {error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{error}</div>}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg py-2.5 text-sm font-semibold"
            style={{ backgroundColor: NAVY, color: 'white', opacity: enviando ? 0.7 : 1 }}
          >
            {enviando ? 'Ingresando...' : 'Entrar al CRM'}
          </button>

          <p className="m-0 text-center text-xs" style={{ color: TEXTO_TERCIARIO, borderTop: `1px solid ${BORDE}`, paddingTop: 16 }}>
            ¿Problemas para entrar? Escribile a tu administrador.
          </p>
        </form>
      </div>
    </div>
  );
}
