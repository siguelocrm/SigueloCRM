import { useState } from 'react';
import { CheckCircle2, Link2, Unplug } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';

export type InfoAula = { conectado: boolean; cuenta: string | null; enlace: string | null; planes: { id: string; nombre: string; texto?: string }[]; error: string | null } | null;

const ENLACE = 'https://infinity-chess-aula.pages.dev';

// Conexión con tu Aula virtual (Aula Infinity Chess): la IA ve los planes de los
// cursos virtuales y, al confirmarse un pago, el alumno queda inscrito en el aula
// con su cuenta. El CRM entra con una cuenta de profesor o director; la contraseña
// la guarda solo el servidor.
export default function AulaInscripcion({ info, puedeEditar, onCambio }: { info: InfoAula; puedeEditar: boolean; onCambio: () => void }) {
  const toast = useToast();
  const vacio = { url: '', clave_publica: '', usuario: '', contrasena: '', enlace: info?.enlace || ENLACE };
  const [f, setF] = useState(vacio);
  const [probando, setProbando] = useState(false);

  const conectar = async () => {
    setProbando(true);
    const r = await llamarBackend('/siguelo/aula/conectar', f).catch(() => ({ ok: false, error: 'No hay conexión con el servidor del CRM (¿está prendido?).' }));
    setProbando(false);
    if (!r.ok || !('data' in r)) return toast(r.error || 'No se pudo conectar.', 'error');
    toast(`Conectada: ${r.data.planes} ${r.data.planes === 1 ? 'plan activo' : 'planes activos'}`, 'ok');
    setF({ ...vacio, enlace: f.enlace });
    onCambio();
  };

  const desconectar = async () => {
    if (!window.confirm('¿Desconectar tu Aula virtual? La IA deja de ver los planes y los pagos de cursos del aula quedan para revisar.')) return;
    await llamarBackend('/siguelo/aula', {}, 'DELETE').catch(() => null);
    onCambio();
  };

  const campo = (k: keyof typeof f, etiqueta: string, ayuda: string, tipo = 'text', placeholder = '') => (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
      {etiqueta}
      <input type={tipo} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!puedeEditar} placeholder={placeholder} autoComplete="off" className={`${claseCampo} font-normal`} style={estiloCampo} />
      <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>
    </label>
  );

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {info?.conectado ? (
        <Tarjeta className="p-4 flex flex-col gap-2">
          <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
            <CheckCircle2 size={17} color="var(--ok)" /> Conectada con tu Aula virtual
          </span>
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Entra con la cuenta <b>{info.cuenta}</b>. A los alumnos se les manda <b>{info.enlace || ENLACE}</b>.
          </span>
          {info.planes.length > 0 ? (
            <div className="flex flex-col gap-0.5 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              <span className="font-semibold" style={{ color: TEXTO_PRIMARIO }}>Planes que ve la IA:</span>
              {info.planes.map((p) => <span key={p.id}>• {p.texto || p.nombre}</span>)}
            </div>
          ) : (
            <span className="text-[12.5px]" style={{ color: 'var(--warn)' }}>Tu aula no tiene planes activos: créalos en el aula para que la IA los ofrezca.</span>
          )}
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Ahora, en la pestaña <b>Cursos</b>, crea un curso (por ejemplo "Aula virtual"), con precio 0, el QR y la cuenta donde te pagan, y marca
            <b> "Inscribir en mi Aula virtual"</b>. Si los planes cambian en el aula, la IA los ve solos en unos minutos (aquí se actualizan al volver a conectar).
          </span>
          {puedeEditar && <Boton tamano="sm" variante="fantasma" icono={Unplug} className="self-start" onClick={desconectar}>Desconectar</Boton>}
        </Tarjeta>
      ) : (
        <Tarjeta className="p-4 text-[12.5px] leading-relaxed flex flex-col gap-1.5" style={{ color: TEXTO_SECUNDARIO }}>
          <b className="text-[14px]" style={{ color: TEXTO_PRIMARIO }}>Cómo conectarla</b>
          <span>1. En tu aula, entra a <b>Personas → Crear cuenta</b> y crea una cuenta para el CRM (por ejemplo usuario "whatsapp"), de tipo <b>Profesor</b> o <b>Director</b>. Entra una vez con ella para elegir su contraseña.</span>
          <span>2. En el <b>Supabase de tu aula</b> (no el del CRM ni el del club): <b>Project Settings → API Keys</b>. Copia la <b>Project URL</b> y la clave pública (<b>anon public</b> o <b>Publishable key</b>).</span>
          <span>3. Pégalos abajo con el usuario y la contraseña de esa cuenta y pulsa <b>Conectar y probar</b>. La contraseña solo la guarda el servidor del CRM.</span>
          <span style={{ color: TEXTO_TERCIARIO }}>
            Las cuentas e inscripciones que haga el CRM aparecen en tu aula como hechas por esa cuenta, con la nota "Desde WhatsApp (SígueloCRM)".
          </span>
        </Tarjeta>
      )}

      {puedeEditar && (
        <Tarjeta className="p-4 flex flex-col gap-3">
          <span className="text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{info?.conectado ? 'Cambiar la conexión' : 'Conectar'}</span>
          {campo('url', 'Project URL', 'La dirección del Supabase de tu aula.', 'text', 'https://xxxx.supabase.co')}
          {campo('clave_publica', 'Clave pública', 'La "anon public" o "Publishable key" (la misma que usa la página del aula).', 'text', 'eyJhbGciOi… o sb_publishable_…')}
          <div className="grid gap-3 sm:grid-cols-2">
            {campo('usuario', 'Usuario de la cuenta', 'Con el que entra al aula.', 'text', 'whatsapp')}
            {campo('contrasena', 'Contraseña de la cuenta', 'Se guarda solo en el servidor.', 'password')}
          </div>
          {campo('enlace', 'Dirección del aula para tus alumnos', 'Es el link que les llega con su usuario y contraseña.', 'text', ENLACE)}
          <Boton variante="primario" icono={Link2} className="self-start" onClick={conectar} disabled={probando || !f.url.trim() || !f.clave_publica.trim() || !f.usuario.trim() || !f.contrasena}>
            {probando ? 'Probando…' : 'Conectar y probar'}
          </Boton>
        </Tarjeta>
      )}
    </div>
  );
}
