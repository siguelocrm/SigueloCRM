import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Plus, Smartphone, Store, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EstadoVacio, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from '../seguimiento/Etiqueta';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';
import type { DatosNegocios, GrupoNegocio, Negocio } from './useNegocios';

type Borrador = {
  nombre: string;
  sucursal: string;
  direccion: string;
  horario: string;
  zonas: string;
  info_ia: string;
  ia_activa: boolean;
  grupos: GrupoNegocio[];
  embudo_id: string;
  club_sucursal_id: string;
  lineas: string[];
};

const aBorrador = (n: Negocio | null, lineas: string[]): Borrador => ({
  nombre: n?.nombre ?? '',
  sucursal: n?.sucursal ?? '',
  direccion: n?.direccion ?? '',
  horario: n?.horario ?? '',
  zonas: n?.zonas ?? '',
  info_ia: n?.info_ia ?? '',
  ia_activa: n?.ia_activa ?? true,
  grupos: (n?.grupos ?? []).map((g) => ({ ...g })),
  embudo_id: n?.embudo_id ?? '',
  club_sucursal_id: n?.club_sucursal_id ?? '',
  lineas,
});

const idNuevo = () => Math.random().toString(36).slice(2, 10);

const AYUDA_IA =
  'Qué vendes, precios, horarios, cómo inscribirse o comprar, formas de pago, preguntas frecuentes y lo que NO debe decir. La IA (Fase 3) responderá solo con esto.';

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>
      {etiqueta}
      {children}
      {ayuda && <span className="font-normal text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{ayuda}</span>}
    </label>
  );
}

interface Props {
  datos: DatosNegocios;
  empresaId: string;
  puedeEditar: boolean;
}

// Fichas de los negocios: sus datos, sus números y lo que la IA sabe de cada uno.
export default function FichasNegocios({ datos, empresaId, puedeEditar }: Props) {
  const toast = useToast();
  const [abierto, setAbierto] = useState<string | null>(null); // id del negocio o 'nuevo'
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Sucursales del sistema del club (null = no está conectado o falta el SQL).
  const [sucursalesClub, setSucursalesClub] = useState<{ id: string; nombre: string }[] | null>(null);

  useEffect(() => {
    supabase
      .from('siguelo_club_info')
      .select('conectado, sucursales')
      .maybeSingle()
      .then(({ data, error }) => setSucursalesClub(!error && data?.conectado ? (data.sucursales as { id: string; nombre: string }[]) : null));
  }, []);

  const lineasDe = (negocioId: string) => Object.entries(datos.negocioDeLinea).filter(([, n]) => n === negocioId).map(([l]) => l);
  const nombreNegocio = (id: string | undefined) => datos.negocios.find((n) => n.id === id)?.nombre;

  const abrir = (n: Negocio | null) => {
    const id = n?.id ?? 'nuevo';
    if (abierto === id) {
      setAbierto(null);
      setBorrador(null);
      return;
    }
    setAbierto(id);
    setBorrador(aBorrador(n, n ? lineasDe(n.id) : []));
  };

  const guardar = async (n: Negocio | null) => {
    if (!borrador) return;
    if (!borrador.nombre.trim()) return toast('Escribe el nombre del negocio.', 'error');
    const grupos = borrador.grupos.filter((g) => g.nombre.trim() || g.link.trim());
    if (grupos.some((g) => !g.nombre.trim() || !/^https?:\/\//i.test(g.link.trim()))) {
      return toast('Cada grupo necesita un nombre y su link de invitación (https://chat.whatsapp.com/…).', 'error');
    }
    setGuardando(true);
    const fila = {
      nombre: borrador.nombre.trim(),
      sucursal: borrador.sucursal.trim() || null,
      direccion: borrador.direccion.trim() || null,
      horario: borrador.horario.trim() || null,
      zonas: borrador.zonas.trim() || null,
      info_ia: borrador.info_ia,
      ia_activa: borrador.ia_activa,
      grupos: grupos.map((g) => ({ id: g.id, nombre: g.nombre.trim(), link: g.link.trim(), cuando: g.cuando.trim() })),
      embudo_id: borrador.embudo_id || null,
      ...(sucursalesClub ? { club_sucursal_id: borrador.club_sucursal_id || null } : {}),
      actualizado_en: new Date().toISOString(),
    };
    let id = n?.id;
    if (id) {
      const { error } = await supabase.from('siguelo_negocios').update(fila).eq('id', id);
      if (error) {
        setGuardando(false);
        return toast(`No se pudo guardar: ${error.message}`, 'error');
      }
    } else {
      const { data, error } = await supabase.from('siguelo_negocios').insert({ ...fila, empresa_id: empresaId }).select('id').single();
      if (error || !data) {
        setGuardando(false);
        return toast(`No se pudo crear: ${error?.message ?? ''}`, 'error');
      }
      id = (data as { id: string }).id;
    }
    // Números: los marcados pasan a este negocio (aunque fueran de otro); los desmarcados quedan libres.
    const antes = n ? lineasDe(n.id) : [];
    const marcados = borrador.lineas;
    if (marcados.length) {
      await supabase.from('siguelo_lineas').upsert(marcados.map((linea_id) => ({ linea_id, empresa_id: empresaId, negocio_id: id })));
    }
    const quitar = antes.filter((l) => !marcados.includes(l));
    if (quitar.length) await supabase.from('siguelo_lineas').delete().in('linea_id', quitar);
    setGuardando(false);
    toast(`"${fila.nombre}" guardado`, 'ok');
    setAbierto(null);
    setBorrador(null);
    datos.recargar();
  };

  const eliminar = async (n: Negocio) => {
    if (!window.confirm(`¿Eliminar "${n.nombre}"? Sus números quedan sin negocio y se borran sus textos de seguimiento propios. Los contactos y chats no se tocan.`)) return;
    const { error } = await supabase.from('siguelo_negocios').delete().eq('id', n.id);
    if (error) return toast(`No se pudo eliminar: ${error.message}`, 'error');
    toast(`"${n.nombre}" eliminado`, 'ok');
    setAbierto(null);
    setBorrador(null);
    datos.recargar();
  };

  const libres = datos.lineas.filter((l) => !datos.negocioDeLinea[l.id]);

  const editor = (n: Negocio | null) =>
    borrador && (
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3" style={{ borderTop: `1px solid ${BORDE}` }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del negocio" ayuda="Se usa como {negocio} en los textos.">
            <input value={borrador.nombre} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} placeholder="Ej. Academia Sígueme" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Sucursal" ayuda="{sucursal}. Si lo dejas vacío, se usa el nombre del número.">
            <input value={borrador.sucursal} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, sucursal: e.target.value })} placeholder="Ej. Quillacollo" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Dirección" ayuda="{direccion}">
            <input value={borrador.direccion} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, direccion: e.target.value })} placeholder="Ej. Av. Blanco Galindo km 13, frente a la plaza" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
          <Campo etiqueta="Horario de atención" ayuda="{horario}">
            <input value={borrador.horario} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, horario: e.target.value })} placeholder="Ej. lunes a sábado de 8:00 a 19:00" className={`${claseCampo} font-normal`} style={estiloCampo} />
          </Campo>
        </div>
        <Campo etiqueta="Zonas que atiende" ayuda="Barrios o ciudades cercanos. La IA los usa para sugerir la sucursal más cercana.">
          <input value={borrador.zonas} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, zonas: e.target.value })} placeholder="Ej. Quillacollo, Tiquipaya, Colcapirhua" className={`${claseCampo} font-normal`} style={estiloCampo} />
        </Campo>
        {sucursalesClub && (
          <Campo etiqueta="Sucursal en tu sistema del club" ayuda="La IA responde con los horarios, cupos y precios en vivo de esta sucursal, y las inscripciones pagadas quedan como reserva en ella.">
            <select value={borrador.club_sucursal_id} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, club_sucursal_id: e.target.value })} className={`${claseCampo} font-normal`} style={estiloCampo}>
              <option value="">Ninguna (no usar el sistema del club)</option>
              {sucursalesClub.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Campo>
        )}

        <Campo etiqueta="Embudo" ayuda="Los clientes nuevos de este negocio entran a la primera etapa de este embudo. Los que ya están no se mueven.">
          <select value={borrador.embudo_id} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, embudo_id: e.target.value })} className={`${claseCampo} font-normal`} style={estiloCampo}>
            <option value="">Embudo principal</option>
            {datos.embudos.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Campo>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>Números de este negocio</span>
          {datos.lineas.length === 0 ? (
            <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>Todavía no hay números. Agrégalos en Conexiones.</span>
          ) : (
            datos.lineas.map((l) => {
              const de = datos.negocioDeLinea[l.id];
              const otro = de && de !== n?.id ? nombreNegocio(de) : null;
              const marcado = borrador.lineas.includes(l.id);
              return (
                <label key={l.id} className="flex items-center gap-2 text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    disabled={!puedeEditar}
                    onChange={(e) => setBorrador({ ...borrador, lineas: e.target.checked ? [...borrador.lineas, l.id] : borrador.lineas.filter((x) => x !== l.id) })}
                  />
                  <Smartphone size={14} color={TEXTO_SECUNDARIO} />
                  {l.nombre}
                  {l.numero && <span style={{ color: TEXTO_TERCIARIO }}>+{l.numero}</span>}
                  {otro && <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>{marcado ? `(se pasa desde ${otro})` : `(ahora en ${otro})`}</span>}
                </label>
              );
            })
          )}
        </div>

        <Campo etiqueta="Información para la IA" ayuda={AYUDA_IA}>
          <textarea
            value={borrador.info_ia}
            disabled={!puedeEditar}
            onChange={(e) => setBorrador({ ...borrador, info_ia: e.target.value })}
            rows={8}
            placeholder={'Vendemos…\nPrecios: …\nHorarios: …\nPara inscribirse: …\nNo digas: …'}
            className="rounded-lg outline-none text-[13px] font-normal bg-[var(--surface)] resize-y"
            style={estiloArea}
          />
        </Campo>

        <label className="flex items-center gap-2 text-[13px]" style={{ color: TEXTO_PRIMARIO }}>
          <input type="checkbox" checked={borrador.ia_activa} disabled={!puedeEditar} onChange={(e) => setBorrador({ ...borrador, ia_activa: e.target.checked })} />
          La IA responde en los números de este negocio
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--fg-2)' }}>Grupos de WhatsApp a los que la IA puede invitar</span>
          <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
            La IA ofrece unirse y, solo si el cliente acepta, le manda el link (una sola vez). Nunca lo agrega directo.
          </span>
          {borrador.grupos.map((g, i) => {
            const cambiar = (cambios: Partial<GrupoNegocio>) => setBorrador({ ...borrador, grupos: borrador.grupos.map((x, k) => (k === i ? { ...x, ...cambios } : x)) });
            return (
              <div key={g.id} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto] rounded-lg p-2.5" style={{ border: `1px solid ${BORDE}` }}>
                <input value={g.nombre} disabled={!puedeEditar} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Nombre (ej. Curso gratis)" aria-label="Nombre del grupo" className={`${claseCampo} font-normal`} style={estiloCampo} />
                <input value={g.link} disabled={!puedeEditar} onChange={(e) => cambiar({ link: e.target.value })} placeholder="https://chat.whatsapp.com/…" aria-label="Link de invitación" className={`${claseCampo} font-normal`} style={estiloCampo} />
                {puedeEditar && (
                  <button onClick={() => setBorrador({ ...borrador, grupos: borrador.grupos.filter((_, k) => k !== i) })} aria-label="Quitar grupo" className="p-2 rounded-md justify-self-end" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={14} /></button>
                )}
                <input value={g.cuando} disabled={!puedeEditar} onChange={(e) => cambiar({ cuando: e.target.value })} placeholder="Cuándo ofrecerlo (ej. si quiere aprender mecánica)" aria-label="Cuándo ofrecerlo" className={`${claseCampo} font-normal sm:col-span-3`} style={estiloCampo} />
              </div>
            );
          })}
          {puedeEditar && (
            <Boton tamano="sm" icono={Plus} className="self-start" onClick={() => setBorrador({ ...borrador, grupos: [...borrador.grupos, { id: idNuevo(), nombre: '', link: '', cuando: '' }] })}>
              Agregar grupo
            </Boton>
          )}
        </div>

        {puedeEditar && (
          <div className="flex items-center gap-2 flex-wrap">
            <Boton variante="primario" onClick={() => guardar(n)} disabled={guardando}>{guardando ? 'Guardando…' : n ? 'Guardar' : 'Crear negocio'}</Boton>
            {n && <Boton variante="peligro" icono={Trash2} onClick={() => eliminar(n)}>Eliminar</Boton>}
          </div>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: TEXTO_SECUNDARIO }}>
        Cada número trabaja como un negocio: con su ficha, sus respuestas rápidas, sus reglas del bot, sus textos de seguimiento y, si
        hace falta, su propio embudo. Varias sucursales pueden compartir el embudo principal.
      </p>
      {libres.length > 0 && datos.negocios.length > 0 && (
        <p className="m-0 text-[12px]" style={{ color: 'var(--warn)' }}>
          Sin negocio: {libres.map((l) => l.nombre).join(', ')}. Esos números usan solo lo que es "para todos".
        </p>
      )}
      {datos.negocios.length === 0 && abierto !== 'nuevo' && (
        <Tarjeta className="flex">
          <EstadoVacio icono={Store} titulo="Todavía no tienes negocios" texto="Crea uno por cada sucursal o negocio y asígnale sus números." />
        </Tarjeta>
      )}
      {datos.negocios.map((n) => {
        const nums = lineasDe(n.id).map((l) => datos.lineas.find((x) => x.id === l)?.nombre).filter(Boolean);
        const embudo = n.embudo_id ? datos.embudos.find((e) => e.id === n.embudo_id)?.nombre : null;
        return (
          <Tarjeta key={n.id} className="flex flex-col">
            <button onClick={() => abrir(n)} className="flex items-center gap-3 px-4 py-3 text-left" aria-expanded={abierto === n.id}>
              <Store size={16} color="var(--accent)" className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{n.nombre}</div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {nums.length ? nums.map((x) => <Etiqueta key={x} icono={Smartphone}>{x}</Etiqueta>) : <span className="text-[12px]" style={{ color: 'var(--warn)' }}>Sin números</span>}
                  <Etiqueta color="var(--fg-2)">{embudo ? `Embudo: ${embudo}` : 'Embudo principal'}</Etiqueta>
                  {!n.info_ia.trim() && <Etiqueta color="var(--warn)">Falta la información para la IA</Etiqueta>}
                </div>
              </div>
              <ChevronDown size={16} style={{ color: TEXTO_TERCIARIO, transform: abierto === n.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            {abierto === n.id && editor(n)}
          </Tarjeta>
        );
      })}
      {abierto === 'nuevo' ? (
        <Tarjeta className="flex flex-col">
          <div className="px-4 py-3 text-[14px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>Nuevo negocio</div>
          {editor(null)}
        </Tarjeta>
      ) : (
        puedeEditar && <Boton icono={Plus} className="self-start" onClick={() => abrir(null)}>Nuevo negocio</Boton>
      )}
    </div>
  );
}
