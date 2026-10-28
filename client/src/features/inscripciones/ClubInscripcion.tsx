import { useState } from 'react';
import { CheckCircle2, Link2, Unplug } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';

export type InfoClub = { conectado: boolean; vendedor: string | null; sucursales: { id: string; nombre: string; departamento?: string | null }[]; error: string | null } | null;

// Conexión con tu sistema del club: la IA lee los horarios, cupos y precios en
// vivo, y las inscripciones pagadas quedan como "Reserva de vendedor". El CRM
// entra con una cuenta de vendedor; la contraseña la guarda solo el servidor.
export default function ClubInscripcion({ info, puedeEditar, onCambio }: { info: InfoClub; puedeEditar: boolean; onCambio: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ url: '', clave_publica: '', usuario: '', contrasena: '' });
  const [probando, setProbando] = useState(false);

  const conectar = async () => {
    setProbando(true);
    const r = await llamarBackend('/siguelo/club/conectar', f).catch(() => ({ ok: false, error: 'No hay conexión con el servidor del CRM (¿está prendido?).' }));
    setProbando(false);
    if (!r.ok) return toast(r.error || 'No se pudo conectar.', 'error');
    toast(`Conectado como "${r.data.vendedor}"`, 'ok');
    setF({ url: '', clave_publica: '', usuario: '', contrasena: '' });
    onCambio();
  };

  const desconectar = async () => {
    if (!window.confirm('¿Desconectar tu sistema del club? La IA deja de ver los horarios en vivo y las inscripciones pagadas quedan para revisar.')) return;
    await llamarBackend('/siguelo/club', {}, 'DELETE').catch(() => null);
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
            <CheckCircle2 size={17} color="var(--ok)" /> Conectado con tu sistema del club
          </span>
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Entra como el vendedor <b>{info.vendedor}</b>. Sucursales: {info.sucursales.map((s) => s.nombre).join(', ') || '—'}.
          </span>
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Ahora, en <b>Administrar → Negocios</b>, elige en cada negocio su <b>sucursal del club</b>. Y en la pestaña <b>Cursos</b>, marca
            <b> "Dejar la inscripción como reserva en mi sistema del club"</b>.
          </span>
          {puedeEditar && <Boton tamano="sm" variante="fantasma" icono={Unplug} className="self-start" onClick={desconectar}>Desconectar</Boton>}
        </Tarjeta>
      ) : (
        <Tarjeta className="p-4 text-[12.5px] leading-relaxed flex flex-col gap-1.5" style={{ color: TEXTO_SECUNDARIO }}>
          <b className="text-[14px]" style={{ color: TEXTO_PRIMARIO }}>Cómo conectarlo</b>
          <span>1. En tu sistema del club, entra a <b>Vendedores</b> y crea un vendedor para el CRM (por ejemplo "WhatsApp"), con acceso a todas tus sucursales. Anota su usuario y contraseña.</span>
          <span>2. En el <b>Supabase de tu sistema del club</b> (no el del CRM): <b>Project Settings → API</b>. Copia la <b>Project URL</b> y la clave <b>anon public</b>.</span>
          <span>3. Pégalos abajo y pulsa <b>Conectar y probar</b>. La contraseña solo la guarda el servidor del CRM; esta página nunca la vuelve a mostrar.</span>
          <span style={{ color: TEXTO_TERCIARIO }}>
            Las reservas quedan a nombre de ese vendedor, en <b>Reservas de vendedores</b>, para que las confirmes con un clic. Si ese vendedor cobra comisión, ponle 0 %.
          </span>
        </Tarjeta>
      )}

      {puedeEditar && (
        <Tarjeta className="p-4 flex flex-col gap-3">
          <span className="text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{info?.conectado ? 'Cambiar la conexión' : 'Conectar'}</span>
          {campo('url', 'Project URL', 'La dirección del Supabase de tu sistema del club.', 'text', 'https://xxxx.supabase.co')}
          {campo('clave_publica', 'Clave "anon public"', 'Es la clave pública (la misma que usa tu página de visitas).', 'text', 'eyJhbGciOi…')}
          <div className="grid gap-3 sm:grid-cols-2">
            {campo('usuario', 'Usuario del vendedor', 'El usuario con que entra al panel de vendedor.', 'text', 'whatsapp')}
            {campo('contrasena', 'Contraseña del vendedor', 'Se guarda solo en el servidor.', 'password')}
          </div>
          <Boton variante="primario" icono={Link2} className="self-start" onClick={conectar} disabled={probando || !f.url.trim() || !f.clave_publica.trim() || !f.usuario.trim() || !f.contrasena}>
            {probando ? 'Probando…' : 'Conectar y probar'}
          </Boton>
        </Tarjeta>
      )}
    </div>
  );
}
