import { AuthProvider, useAuth } from './lib/AuthContext';
import Login from './features/login/Login';
import RestablecerContrasena from './features/login/RestablecerContrasena';
import Bandeja from './features/bandeja/Bandeja';
import AvisoBaseAtrasada from './components/AvisoBaseAtrasada';
import { ToastProvider } from './components/ui';

function Contenido() {
  const { sesion, usuario, cargando, modoRecuperacion, cerrarSesion } = useAuth();

  if (cargando) {
    return (
      <div className="w-full h-dvh flex items-center justify-center" style={{ background: '#001D44' }}>
        <span className="text-white text-sm">Cargando...</span>
      </div>
    );
  }

  if (modoRecuperacion) return <RestablecerContrasena />;

  if (!sesion) return <Login />;

  if (!usuario) {
    return (
      <div className="w-full h-dvh flex items-center justify-center text-center px-6" style={{ background: '#001D44' }}>
        <span className="text-white text-sm">
          Tu cuenta no tiene un perfil en la tabla "usuarios" todavía. Pedile a un administrador que te cree como agente.
        </span>
      </div>
    );
  }

  // SígueloCRM: desactivado o con el acceso vencido (Usuarios → "Acceso hasta").
  if (usuario.activo === false) {
    return (
      <div className="w-full h-dvh flex flex-col gap-4 items-center justify-center text-center px-6" style={{ background: '#001D44' }}>
        <span className="text-white text-sm">Tu acceso está desactivado o venció. Pídele a quien te creó el usuario que lo renueve.</span>
        <button onClick={cerrarSesion} className="text-sm font-semibold rounded-lg px-4 py-2" style={{ backgroundColor: 'white', color: '#001D44' }}>Cerrar sesión</button>
      </div>
    );
  }

  return (
    <>
      <Bandeja />
      <AvisoBaseAtrasada />
    </>
  );
}

export default function App() {
  return (
    <div className="w-full h-dvh">
      <AuthProvider>
        <ToastProvider>
          <Contenido />
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}
