import { useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Interruptor, Tarjeta, useToast } from '../../components/ui';
import type { EtapaVenta } from '../../lib/tipos';
import type { Negocio } from '../negocios/useNegocios';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';
import { NOMBRE_TEXTOS, TEXTOS_POR_DEFECTO, cursoNuevo, formatoMonto, type CampoPersonalizado, type Curso, type TextosCurso } from './tipos';

interface Props {
  empresaId: string;
  cursos: Curso[];
  negocios: Negocio[];
  etapas: EtapaVenta[];
  puedeEditar: boolean;
  onGuardado: () => void;
}

type Borrador = Omit<Curso, 'id'> & { id?: string; precioTexto: string };

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
      {etiqueta}
      {children}
      {ayuda && <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>}
    </label>
  );
}

// Cada curso (o lo que se cobra): precio, QR, a quién le llega el pago, link del
// grupo, datos que se piden y los textos que recibe el cliente.
export default function CursosInscripcion({ empresaId, cursos, negocios, etapas, puedeEditar, onGuardado }: Props) {
  const toast = useToast();
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);
  const [b, setB] = useState<Borrador | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    supabase.from('campos_personalizados').select('id, nombre, tipo').order('orden').returns<CampoPersonalizado[]>().then(({ data }) => setCampos(data || []));
  }, []);

  const editar = (k?: Curso) => setB(k ? { ...k, textos: { ...TEXTOS_POR_DEFECTO, ...k.textos }, precioTexto: String(k.precio) } : { ...cursoNuevo(empresaId), precioTexto: '' });

  const subirQR = async (file: File) => {
    if (!b) return;
    if (!file.type.startsWith('image/')) return toast('El QR tiene que ser una imagen.', 'error');
    setSubiendo(true);
    const ruta = `siguelo/${empresaId}/qr-${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    const { error } = await supabase.storage.from('media').upload(ruta, file);
    setSubiendo(false);
    if (error) return toast(`No se pudo subir: ${error.message}`, 'error');
    setB({ ...b, qr_url: supabase.storage.from('media').getPublicUrl(ruta).data.publicUrl });
  };

  const guardar = async () => {
    if (!b) return;
    const precio = Number(b.precioTexto.replace(',', '.'));
    if (!b.nombre.trim()) return toast('Ponle un nombre al curso.', 'error');
    if (!Number.isFinite(precio) || precio <= 0) return toast('Revisa el precio.', 'error');
    if (b.link_grupo.trim() && !/^https:\/\//.test(b.link_grupo.trim())) return toast('El link del grupo tiene que empezar con https://', 'error');
    if (!b.destinatario.trim() && b.cuenta.replace(/\D/g, '').length < 4) return toast('Pon el nombre del titular o el número de cuenta: así se controla que el pago llegó a ti.', 'error');
    const { id, precioTexto: _p, ...resto } = b;
    const fila = { ...resto, nombre: b.nombre.trim(), precio, link_grupo: b.link_grupo.trim(), max_horas: Math.min(720, Math.max(1, Math.round(b.max_horas) || 72)), actualizado_en: new Date().toISOString() };
    const { error } = id ? await supabase.from('siguelo_cursos').update(fila).eq('id', id) : await supabase.from('siguelo_cursos').insert(fila);
    if (error) return toast(`No se pudo guardar: ${error.message}`, 'error');
    toast('Curso guardado', 'ok');
    setB(null);
    onGuardado();
  };

  const borrar = async (k: Curso) => {
    if (!window.confirm(`¿Borrar "${k.nombre}"? Los pagos que ya llegaron se quedan.`)) return;
    await supabase.from('siguelo_cursos').delete().eq('id', k.id);
    onGuardado();
  };

  const cambiarDato = (id: string, si: boolean) => b && setB({ ...b, datos: si ? [...b.datos, id] : b.datos.filter((x) => x !== id) });

  if (b) {
    return (
      <Tarjeta className="p-4 flex flex-col gap-3.5 max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[15px] font-bold" style={{ color: TEXTO_PRIMARIO }}>{b.id ? 'Editar curso' : 'Nuevo curso'}</span>
          <Interruptor activo={b.activo} onCambiar={(v) => setB({ ...b, activo: v })} etiqueta="Curso activo" deshabilitado={!puedeEditar} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre">
            <input value={b.nombre} onChange={(e) => setB({ ...b, nombre: e.target.value })} placeholder="Curso de mecánica de motos" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Precio">
            <span className="flex gap-1.5">
              <input value={b.moneda} onChange={(e) => setB({ ...b, moneda: e.target.value })} aria-label="Moneda" className={`${claseCampo} font-normal w-16`} style={estiloCampo} />
              <input value={b.precioTexto} onChange={(e) => setB({ ...b, precioTexto: e.target.value })} inputMode="decimal" placeholder="150" className={`${claseCampo} font-normal flex-1 min-w-0`} style={estiloCampo} />
            </span>
          </Campo>
          <Campo etiqueta="Negocio" ayuda="Los comprobantes que lleguen a sus números se revisan para este curso.">
            <select value={b.negocio_id ?? ''} onChange={(e) => setB({ ...b, negocio_id: e.target.value || null })} className={`${claseCampo} font-normal`} style={estiloCampo}>
              <option value="">Todos los negocios</option>
              {negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Al pagar, pasa a la etapa">
            <select value={b.etapa_id ?? ''} onChange={(e) => setB({ ...b, etapa_id: e.target.value || null })} className={`${claseCampo} font-normal`} style={estiloCampo}>
              <option value="">La etapa "ganada" de su embudo</option>
              {etapas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </Campo>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>QR de pago</span>
          <div className="flex items-center gap-3 flex-wrap">
            {b.qr_url && <img src={b.qr_url} alt="QR" className="w-24 h-24 object-contain rounded-lg" style={{ border: `1px solid ${BORDE}` }} />}
            <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium cursor-pointer" style={{ border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}>
              <ImagePlus size={14} /> {subiendo ? 'Subiendo…' : b.qr_url ? 'Cambiar imagen' : 'Subir la imagen del QR'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirQR(e.target.files[0])} />
            </label>
          </div>
          <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>La IA lo manda sola cuando el cliente quiere inscribirse o pregunta cómo pagar.</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Titular de la cuenta" ayuda="Si son varios, sepáralos con coma. Se compara con el destinatario del comprobante.">
            <input value={b.destinatario} onChange={(e) => setB({ ...b, destinatario: e.target.value })} placeholder="Juan Pérez Gómez" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Número de cuenta" ayuda="Se comparan los últimos 4 dígitos.">
            <input value={b.cuenta} onChange={(e) => setB({ ...b, cuenta: e.target.value })} inputMode="numeric" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Link del grupo de WhatsApp" ayuda="Se manda cuando queda inscrito.">
            <input value={b.link_grupo} onChange={(e) => setB({ ...b, link_grupo: e.target.value })} placeholder="https://chat.whatsapp.com/…" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Antigüedad máxima del comprobante (horas)">
            <input value={String(b.max_horas)} onChange={(e) => setB({ ...b, max_horas: Number(e.target.value) || 0 })} inputMode="numeric" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>Datos que se le piden al pagar</span>
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            <input type="checkbox" checked={b.datos.includes('nombre')} onChange={(e) => cambiarDato('nombre', e.target.checked)} /> Nombre completo
          </label>
          {campos.map((f) => (
            <label key={f.id} className="flex items-center gap-2 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              <input type="checkbox" checked={b.datos.includes(f.id)} onChange={(e) => cambiarDato(f.id, e.target.checked)} /> {f.nombre}
            </label>
          ))}
          <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
            Se guardan en la ficha del cliente. Para pedir otros datos (carnet, correo, ciudad…), créalos como campos en Administrar → Mi empresa.
          </span>
        </div>

        <details>
          <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>Textos que recibe el cliente</summary>
          <div className="flex flex-col gap-2.5 mt-2.5">
            <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>Puedes usar {'{nombre}'}, {'{curso}'} y {'{monto}'}.</span>
            {(Object.keys(NOMBRE_TEXTOS) as (keyof TextosCurso)[]).map((k) => (
              <Campo key={k} etiqueta={NOMBRE_TEXTOS[k]}>
                <textarea value={b.textos[k]} onChange={(e) => setB({ ...b, textos: { ...b.textos, [k]: e.target.value } })} rows={2} className="rounded-lg outline-none text-[13px] font-normal bg-[var(--surface)] resize-y" style={estiloArea} />
              </Campo>
            ))}
          </div>
        </details>

        <div className="flex gap-2">
          {puedeEditar && <Boton variante="primario" onClick={guardar}>Guardar curso</Boton>}
          <Boton variante="fantasma" onClick={() => setB(null)}>Cancelar</Boton>
        </div>
      </Tarjeta>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      {cursos.length === 0 ? (
        <Tarjeta className="flex">
          <EstadoVacio icono={GraduationCap} titulo="Todavía no hay cursos" texto="Crea uno con su precio, el QR y el link del grupo: los comprobantes se revisan solos." />
        </Tarjeta>
      ) : (
        cursos.map((k) => (
          <Tarjeta key={k.id} className="p-3.5 flex items-center gap-3 flex-wrap">
            {k.qr_url ? <img src={k.qr_url} alt="" className="w-11 h-11 object-contain rounded-md" style={{ border: `1px solid ${BORDE}` }} /> : <GraduationCap size={22} color={TEXTO_TERCIARIO} />}
            <div className="flex-1 min-w-[180px] flex flex-col">
              <span className="text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{k.nombre}{!k.activo && <span className="text-[12px] font-normal" style={{ color: TEXTO_TERCIARIO }}> (pausado)</span>}</span>
              <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>
                {formatoMonto(k.precio, k.moneda)} · {negocios.find((n) => n.id === k.negocio_id)?.nombre || 'todos los negocios'}
                {!k.qr_url && ' · sin QR'}
                {!k.link_grupo && ' · sin link de grupo'}
              </span>
            </div>
            <Boton tamano="sm" onClick={() => editar(k)}>{puedeEditar ? 'Editar' : 'Ver'}</Boton>
            {puedeEditar && <button onClick={() => borrar(k)} aria-label={`Borrar ${k.nombre}`} className="p-1.5 rounded-md" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={15} /></button>}
          </Tarjeta>
        ))
      )}
      {puedeEditar && <Boton variante="primario" icono={Plus} className="self-start" onClick={() => editar()}>Nuevo curso</Boton>}
    </div>
  );
}
