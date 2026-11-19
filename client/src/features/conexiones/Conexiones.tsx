import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, QrCode, Trash2, Unlink, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { tinte, NAVY, TEAL, AMBER, ESTADO_LINEA_STYLE, BORDE, SOMBRA_CARD, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import type { LineaWhatsapp } from '../../lib/tipos';
import { conSesion } from '../../lib/backend';
import { useToast } from '../../components/ui';

const puntoEstado: Record<LineaWhatsapp['estado'], string> = { activo: '#12B76A', conectando: AMBER, desconectado: '#98A2B3' };

export default function Conexiones() {
  const { usuario } = useAuth();
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaWhatsapp[]>([]);
  const [nombreNueva, setNombreNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [lineaConQr, setLineaConQr] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // Vincular con código (sin QR): para cuando el único celular a mano es el del propio número.
  const [conCodigo, setConCodigo] = useState(false);
  const [telefonoCodigo, setTelefonoCodigo] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [lineaEditando, setLineaEditando] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState('');
  const [eliminando, setEliminando] = useState<string | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const esAdmin = usuario?.rol === 'dueno';
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const cargar = async () => {
    const { data } = await supabase.from('lineas_whatsapp').select('*').order('creado_en').returns<LineaWhatsapp[]>();
    setLineas(data || []);
  };

  useEffect(() => {
    cargar();
    const canal = supabase
      .channel(`lineas-cambios-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineas_whatsapp' }, () => cargar())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.empresa_id]);

  useEffect(() => () => clearInterval(intervaloRef.current ?? undefined), []);

  const crearLinea = async () => {
    if (!nombreNueva.trim()) return;
    setCreando(true);
    const { error } = await supabase.from('lineas_whatsapp').insert({ empresa_id: usuario!.empresa_id, nombre: nombreNueva, numero: '', estado: 'desconectado' });
    setCreando(false);
    // Por ejemplo, el límite de números del plan de esta cuenta.
    if (error) return toast(error.message, 'error');
    setNombreNueva('');
    cargar();
  };

  const detenerPolling = () => {
    if (intervaloRef.current) clearInterval(intervaloRef.current);
    intervaloRef.current = null;
  };

  const conectar = async (linea: LineaWhatsapp, telefono?: string) => {
    setLineaConQr(linea.id);
    setQrDataUrl(null);
    setCodigo(null);
    setErrorCodigo(null);
    if (telefono === undefined) setConCodigo(false);
    try {
      const resp = await fetch(`${backendUrl}/lineas/${linea.id}/conectar`, {
        method: 'POST',
        headers: await conSesion({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(telefono === undefined ? {} : { telefono }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        return toast(d.error || 'No se pudo empezar a vincular.', 'error');
      }
    } catch (err) {
      console.error(err);
    }
    detenerPolling();
    intervaloRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${backendUrl}/lineas/${linea.id}/estado`, { headers: await conSesion() });
        const data = await resp.json();
        if (data.qr) setQrDataUrl(data.qr);
        if (data.codigo) setCodigo(data.codigo);
        if (data.errorCodigo) setErrorCodigo(data.errorCodigo);
        if (data.estado === 'activo') {
          detenerPolling();
          setLineaConQr(null);
          setQrDataUrl(null);
          cargar();
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);
  };

  const desconectar = async (linea: LineaWhatsapp) => {
    await fetch(`${backendUrl}/lineas/${linea.id}/desconectar`, { method: 'POST', headers: await conSesion() });
    cargar();
  };

  const empezarEdicion = (linea: LineaWhatsapp) => {
    setLineaEditando(linea.id);
    setNombreEditado(linea.nombre);
  };

  const cancelarEdicion = () => {
    setLineaEditando(null);
    setNombreEditado('');
  };

  const guardarNombre = async (linea: LineaWhatsapp) => {
    const nombre = nombreEditado.trim();
    if (!nombre || nombre === linea.nombre) {
      cancelarEdicion();
      return;
    }
    await supabase.from('lineas_whatsapp').update({ nombre }).eq('id', linea.id);
    cancelarEdicion();
    cargar();
  };

  const eliminarLinea = async (linea: LineaWhatsapp) => {
    if (!window.confirm(`¿Eliminar la línea "${linea.nombre}"? Esta acción no se puede deshacer.`)) return;
    setEliminando(linea.id);
    try {
      await fetch(`${backendUrl}/lineas/${linea.id}`, { method: 'DELETE', headers: await conSesion() });
      cargar();
    } finally {
      setEliminando(null);
    }
  };

  const lineaEnQr = lineas.find((l) => l.id === lineaConQr) || null;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-y-auto">
      <div className="px-4 md:px-8 py-4 md:py-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[22px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>Conexiones</h1>
          <p className="m-0 text-[13.5px]" style={{ color: TEXTO_SECUNDARIO }}>Cada línea es un número de WhatsApp vinculado a la bandeja.</p>
        </div>

        <div className={`grid grid-cols-1 gap-5 ${lineaEnQr ? 'md:grid-cols-[1fr_320px]' : ''}`}>
          <div className="flex flex-col gap-3.5">
            {esAdmin && (
              <div className="rounded-2xl p-4 flex items-end gap-3" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${BORDE}`, boxShadow: SOMBRA_CARD }}>
                <label className="flex-1 flex flex-col gap-1.5 text-xs font-semibold" style={{ color: 'var(--fg-2)' }}>
                  Nombre de la nueva línea
                  <input
                    value={nombreNueva}
                    onChange={(e) => setNombreNueva(e.target.value)}
                    placeholder="Ej. Ventas La Paz"
                    className="rounded-lg px-2.5 outline-none text-[13.5px] font-normal"
                    style={{ height: 40, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}
                  />
                </label>
                <button onClick={crearLinea} disabled={creando} className="text-[13.5px] font-semibold rounded-lg px-4 shrink-0" style={{ height: 40, backgroundColor: NAVY, color: 'white' }}>
                  + Agregar
                </button>
              </div>
            )}

            {lineas.length === 0 && <div className="text-center text-sm py-10" style={{ color: TEXTO_TERCIARIO }}>Todavía no hay líneas creadas</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {lineas.map((l) => (
                <div key={l.id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${BORDE}`, boxShadow: SOMBRA_CARD }}>
                  <div className="flex items-start gap-2.5">
                    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                      {lineaEditando === l.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={nombreEditado}
                            onChange={(e) => setNombreEditado(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarNombre(l);
                              if (e.key === 'Escape') cancelarEdicion();
                            }}
                            className="flex-1 min-w-0 rounded-lg px-2 outline-none text-[13.5px] font-semibold"
                            style={{ height: 30, border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}
                          />
                          <button onClick={() => guardarNombre(l)} className="flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, backgroundColor: TEAL, color: 'var(--accent-fg)' }}>
                            <Check size={13} />
                          </button>
                          <button onClick={cancelarEdicion} className="flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, border: `1px solid ${BORDE}`, color: 'var(--fg-2)' }}>
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[14.5px] font-bold tracking-tight truncate" style={{ color: TEXTO_PRIMARIO }}>{l.nombre}</span>
                          {esAdmin && (
                            <button onClick={() => empezarEdicion(l)} className="flex items-center justify-center rounded shrink-0" style={{ width: 20, height: 20, color: TEXTO_TERCIARIO }} title="Editar nombre">
                              <Pencil size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <span className="text-[12.5px] truncate" style={{ color: TEXTO_SECUNDARIO }}>{l.numero || 'Sin número todavía'}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-[11.5px] font-bold rounded-full px-2.5 py-1 shrink-0" style={{ backgroundColor: tinte(ESTADO_LINEA_STYLE[l.estado].color), color: ESTADO_LINEA_STYLE[l.estado].color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: puntoEstado[l.estado] }} />
                      {ESTADO_LINEA_STYLE[l.estado].label}
                    </span>
                  </div>

                  {esAdmin && (
                    <div className="flex items-center gap-2">
                      {l.estado === 'activo' ? (
                        <button onClick={() => desconectar(l)} className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5" style={{ border: '1px solid var(--bad-soft)', color: 'var(--bad)', backgroundColor: 'var(--surface)' }}>
                          <Unlink size={12} />
                          Desvincular
                        </button>
                      ) : (
                        <button onClick={() => conectar(l)} className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5" style={{ backgroundColor: TEAL, color: 'var(--accent-fg)' }}>
                          <QrCode size={12} />
                          {l.estado === 'conectando' ? 'Ver QR' : 'Conectar'}
                        </button>
                      )}
                      <button
                        onClick={() => eliminarLinea(l)}
                        disabled={eliminando === l.id}
                        className="flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3 py-1.5 ml-auto"
                        style={{ border: '1px solid var(--bad-soft)', color: 'var(--bad)', backgroundColor: 'var(--surface)', opacity: eliminando === l.id ? 0.6 : 1 }}
                      >
                        <Trash2 size={12} />
                        {eliminando === l.id ? 'Eliminando...' : 'Eliminar'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {lineaEnQr && (
            <div className="rounded-2xl flex flex-col gap-3 items-center text-center" style={{ backgroundColor: 'var(--surface)', border: `1px solid ${BORDE}`, boxShadow: SOMBRA_CARD, padding: 18 }}>
              <span className="self-start text-[14.5px] font-bold tracking-tight" style={{ color: TEXTO_PRIMARIO }}>{conCodigo ? 'Vincular con código' : 'Vincular por QR'}</span>
              {!conCodigo ? (
                <>
                  <span className="self-start text-left text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
                    Abrí WhatsApp en el celular de "{lineaEnQr.nombre}" → Dispositivos vinculados → Escaneá este código.
                  </span>
                  <div className="rounded-xl flex flex-col items-center justify-center gap-2.5" style={{ width: 196, height: 196, border: '2px dashed var(--line-2)', backgroundColor: 'var(--surface-2)' }}>
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt="Código QR de WhatsApp" className="w-full h-full object-contain p-2" />
                    ) : (
                      <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO, fontFamily: 'ui-monospace, monospace' }}>generando código…</span>
                    )}
                  </div>
                  <button type="button" onClick={() => setConCodigo(true)} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                    ¿Solo tienes este celular? Vincular con código
                  </button>
                </>
              ) : (
                <>
                  <span className="self-start text-left text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
                    Para vincular desde el mismo celular, sin escanear. Escribe el número de "{lineaEnQr.nombre}" con su código de país (por ejemplo 59171234567).
                  </span>
                  <div className="flex gap-2 w-full">
                    <input
                      value={telefonoCodigo}
                      onChange={(e) => setTelefonoCodigo(e.target.value)}
                      inputMode="tel"
                      placeholder="59171234567"
                      aria-label="Número con código de país"
                      className="flex-1 min-w-0 rounded-lg px-3 py-2 text-[14px] outline-none"
                      style={{ border: `1px solid ${BORDE}`, backgroundColor: 'var(--surface-2)', color: TEXTO_PRIMARIO }}
                    />
                    <button
                      type="button"
                      onClick={() => conectar(lineaEnQr, telefonoCodigo)}
                      disabled={telefonoCodigo.replace(/\D/g, '').length < 8}
                      className="rounded-lg px-3 py-2 text-[13px] font-semibold"
                      style={{ backgroundColor: TEAL, color: 'var(--accent-fg)', opacity: telefonoCodigo.replace(/\D/g, '').length < 8 ? 0.5 : 1 }}
                    >
                      Pedir código
                    </button>
                  </div>
                  {codigo && (
                    <>
                      <span className="text-[28px] font-bold tracking-[0.2em] select-all" style={{ color: TEXTO_PRIMARIO, fontFamily: 'ui-monospace, monospace' }}>
                        {codigo.slice(0, 4)}-{codigo.slice(4)}
                      </span>
                      <span className="self-start text-left text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
                        En WhatsApp: <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b> → abajo, <b>"Vincular con el número de teléfono"</b> → escribe este código. Vence en unos minutos: si vence, pide otro.
                      </span>
                    </>
                  )}
                  {errorCodigo && <span className="text-[12.5px]" style={{ color: 'var(--bad)' }}>No se pudo pedir el código: {errorCodigo}. Inténtalo de nuevo.</span>}
                  <button type="button" onClick={() => conectar(lineaEnQr)} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                    Mejor con QR
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
