import { Copy, KeyRound } from 'lucide-react';
import { Boton, Tarjeta, useToast } from '../../components/ui';
import { TEXTO_PRIMARIO, TEXTO_SECUNDARIO } from '../../lib/tema';

// Los datos para entrar a una cuenta recién creada (la contraseña solo se ve ahora).
export default function Acceso({ nombre, usuario, contrasena, onCerrar }: { nombre: string; usuario: string; contrasena: string; onCerrar: () => void }) {
  const toast = useToast();
  const enlace = window.location.origin;
  const texto = `Tu acceso a ${nombre}:\n${enlace}\nUsuario: ${usuario}\nContraseña: ${contrasena}`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Copiado: pégalo en WhatsApp para tu cliente.', 'ok');
    } catch {
      toast('No se pudo copiar: selecciona el texto y cópialo.', 'error');
    }
  };
  return (
    <Tarjeta className="p-4 flex flex-col gap-2.5" style={{ border: '1px solid var(--ok)' }}>
      <span className="flex items-center gap-2 text-[14px] font-bold" style={{ color: TEXTO_PRIMARIO }}>
        <KeyRound size={16} color="var(--ok)" /> Acceso creado: {nombre}
      </span>
      <div className="rounded-lg px-3 py-2.5 text-[13.5px] whitespace-pre-wrap select-all" style={{ backgroundColor: 'var(--surface-2)', color: TEXTO_PRIMARIO, fontFamily: 'var(--fuente-mono, monospace)' }}>
        {texto}
      </div>
      <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
        Guárdalo o mándaselo ahora: la contraseña no se vuelve a mostrar (si la olvida, en Cuentas le pones una nueva). Entra tú con estos datos para revisar que todo esté bien.
      </span>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" icono={Copy} onClick={copiar}>Copiar para enviar</Boton>
        <Boton onClick={onCerrar}>Listo</Boton>
      </div>
    </Tarjeta>
  );
}
