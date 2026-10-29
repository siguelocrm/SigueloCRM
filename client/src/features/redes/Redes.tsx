import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Link2, MessageCircleQuestion, Plus, Share2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthContext';
import { llamarBackend } from '../../lib/backend';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, EncabezadoPagina, EstadoVacio, Interruptor, Tarjeta, useToast } from '../../components/ui';
import Etiqueta from '../seguimiento/Etiqueta';
import { claseCampo, estiloArea, estiloCampo } from '../seguimiento/estilos';
import { useNegocios } from '../negocios/useNegocios';

// Redes sociales (SígueloCRM): la IA lee los comentarios nuevos de tus páginas
// de Facebook y cuentas de Instagram, responde con la ficha del negocio, oculta
// o borra lo negativo y te pregunta por WhatsApp lo que no sabe. El servidor
// (server/src/siguelo/redes) hace el trabajo cada 3 minutos.

type Info = { app_id: string | null; config_id: string | null; error: string | null } | null;
type Cuenta = {
  id: string;
  red: 'facebook' | 'instagram';
  nombre: string;
  usuario: string | null;
  negocio_id: string | null;
  activo: boolean;
  responder: boolean;
  negativos: 'nada' | 'ocultar' | 'borrar';
  whatsapp: string;
  instrucciones: string;
  revisado_en: string | null;
  error: string | null;
};
type Comentario = { id: string; cuenta_id: string; autor: string | null; texto: string; tipo: string | null; accion: string; respuesta: string | null; respaldo: string | null; motivo: string | null; codigo: number | null; responder_en: string | null; creado_en: string };
type Aprendido = { id: string; negocio_id: string | null; pregunta: string; respuesta: string; creado_en: string };
type Pestana = 'comentarios' | 'cuentas' | 'aprendido';

const ACCION: Record<string, { texto: string; color: string }> = {
  programado: { texto: 'Responde en unos minutos', color: 'var(--accent)' },
  respondido: { texto: 'Respondido', color: 'var(--ok)' },
  oculto: { texto: 'Oculto', color: 'var(--warn)' },
  borrado: { texto: 'Borrado', color: 'var(--bad)' },
  ignorado: { texto: 'Sin responder', color: 'var(--fg-3)' },
  preguntado: { texto: 'Te preguntó', color: 'var(--warn)' },
  error: { texto: 'Error', color: 'var(--bad)' },
};
const RED: Record<Cuenta['red'], { texto: string; color: string }> = { facebook: { texto: 'Facebook', color: '#1877F2' }, instagram: { texto: 'Instagram', color: '#C13584' } };
const PERMISOS = 'pages_show_list, pages_read_engagement, pages_read_user_content, pages_manage_engagement, pages_manage_metadata, business_management, instagram_basic, instagram_manage_comments';

// La dirección del servidor del CRM (adonde vuelve Facebook después de conectar).
const baseServidor = () => {
  try {
    return new URL(import.meta.env.VITE_BACKEND_URL || window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
};
const hora = (iso: string) => new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export default function Redes() {
  const { usuario } = useAuth();
  const toast = useToast();
  const negocios = useNegocios(usuario?.empresa_id);
  const [pestana, setPestana] = useState<Pestana>('comentarios');
  const [info, setInfo] = useState<Info>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [aprendido, setAprendido] = useState<Aprendido[]>([]);
  const [app, setApp] = useState({ app_id: '', app_secret: '', config_id: '' });
  const [token, setToken] = useState('');
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<Record<string, Cuenta>>({});
  const [nuevo, setNuevo] = useState<{ pregunta: string; respuesta: string; negocio_id: string } | null>(null);
  const puedeEditar = usuario?.rol === 'dueno' || usuario?.rol === 'supervisor';
  const volver = `${baseServidor()}/siguelo/meta/volver`;
  const privacidad = `${baseServidor()}/siguelo/privacidad`;

  const cargar = useCallback(async () => {
    const [i, c, k, a] = await Promise.all([
      supabase.from('siguelo_meta_info').select('app_id, config_id, error').maybeSingle(),
      supabase.from('siguelo_redes_cuentas').select('*').order('red').order('nombre').returns<Cuenta[]>(),
      supabase.from('siguelo_redes_comentarios').select('*').order('creado_en', { ascending: false }).limit(100).returns<Comentario[]>(),
      supabase.from('siguelo_aprendido').select('*').order('creado_en', { ascending: false }).limit(200).returns<Aprendido[]>(),
    ]);
    if (i.error || c.error) return setFaltaSql(true);
    setFaltaSql(false);
    setInfo((i.data as Info) ?? null);
    setCuentas(c.data || []);
    setComentarios(k.data || []);
    setAprendido(a.data || []);
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [cargar]);

  if (faltaSql) {
    return (
      <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
        <EncabezadoPagina titulo="Redes sociales" />
        <Tarjeta className="p-5 flex items-start gap-3 max-w-2xl" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={20} color="var(--warn)" className="shrink-0 mt-0.5" />
          <span className="text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>Falta preparar la base de datos: pega todo <b>database/siguelo.sql</b> en Supabase → SQL Editor y pulsa Run.</span>
        </Tarjeta>
      </div>
    );
  }

  const nombreCuenta = (id: string) => {
    const k = cuentas.find((x) => x.id === id);
    return k ? `${RED[k.red].texto} · ${k.nombre}` : 'Cuenta';
  };
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Copiado', 'ok'));

  const guardarApp = async () => {
    const r = await llamarBackend('/siguelo/meta/app', app);
    if (!r.ok) return toast(r.error || 'No se pudo guardar.', 'error');
    toast('App de Meta guardada', 'ok');
    setApp({ app_id: '', app_secret: '', config_id: '' });
    cargar();
  };

  const conectar = async () => {
    const r = await llamarBackend('/siguelo/meta/iniciar', { base: baseServidor() });
    if (!r.ok) return toast(r.error || 'No se pudo iniciar.', 'error');
    window.open(r.data.url, '_blank', 'noopener');
    toast('Acepta los permisos en la pestaña de Facebook; tus cuentas aparecen aquí en unos segundos.', 'info');
    let n = 0;
    const t = setInterval(() => {
      cargar();
      if (++n > 30) clearInterval(t);
    }, 4000);
  };

  const conToken = async () => {
    const r = await llamarBackend('/siguelo/meta/token', { token });
    if (!r.ok) return toast(r.error || 'No se pudo conectar.', 'error');
    toast(`Conectadas ${r.data.paginas} páginas y ${r.data.instagram} cuentas de Instagram`, 'ok');
    setToken('');
    cargar();
  };

  const guardarCuenta = async (k: Cuenta) => {
    const antes = cuentas.find((x) => x.id === k.id);
    const { error } = await supabase
      .from('siguelo_redes_cuentas')
      .update({
        negocio_id: k.negocio_id,
        activo: k.activo,
        responder: k.responder,
        negativos: k.negativos,
        whatsapp: k.whatsapp.trim(),
        instrucciones: k.instrucciones,
        // Al activarla, responde desde ahora (no lo de antes).
        ...(k.activo && !antes?.activo ? { revisado_hasta: null, revisado_en: null } : {}),
        actualizado_en: new Date().toISOString(),
      })
      .eq('id', k.id);
    if (error) return toast(`No se pudo guardar: ${error.message}`, 'error');
    toast(k.activo ? 'Guardado: la IA atiende esta cuenta desde ahora' : 'Guardado', 'ok');
    const { [k.id]: _, ...resto } = editando;
    setEditando(resto);
    cargar();
  };

  const responderYo = async (c: Comentario) => {
    const texto = (respuestas[c.id] || '').trim();
    if (!texto) return toast('Escribe tu respuesta.', 'error');
    const r = await llamarBackend('/siguelo/redes/responder', { comentario_id: c.id, texto });
    if (!r.ok) return toast(r.error || 'No se pudo responder.', 'error');
    toast('Publicado. Queda aprendido para la próxima.', 'ok');
    setRespuestas({ ...respuestas, [c.id]: '' });
    cargar();
  };

  const guardarAprendido = async () => {
    if (!nuevo || !nuevo.pregunta.trim() || !nuevo.respuesta.trim()) return toast('Escribe la pregunta y la respuesta.', 'error');
    const { error } = await supabase.from('siguelo_aprendido').insert({ empresa_id: usuario!.empresa_id, negocio_id: nuevo.negocio_id || null, pregunta: nuevo.pregunta.trim(), respuesta: nuevo.respuesta.trim() });
    if (error) return toast(`No se pudo guardar: ${error.message}`, 'error');
    setNuevo(null);
    cargar();
  };

  const borrarAprendido = async (a: Aprendido) => {
    if (!window.confirm('¿Borrar esta respuesta aprendida?')) return;
    await supabase.from('siguelo_aprendido').delete().eq('id', a.id);
    cargar();
  };

  const preguntas = comentarios.filter((c) => c.accion === 'preguntado');
  const activas = cuentas.filter((c) => c.activo).length;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina titulo="Redes sociales" subtitulo="La IA responde los comentarios de tus páginas de Facebook y cuentas de Instagram, oculta lo negativo y te pregunta por WhatsApp lo que no sabe." />

      <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden shrink-0" style={{ borderBottom: `1px solid ${BORDE}` }}>
        {([
          ['comentarios', `Comentarios${preguntas.length ? ` (${preguntas.length} te preguntan)` : ''}`],
          ['cuentas', `Cuentas${activas ? ` (${activas} activas)` : ''}`],
          ['aprendido', `Lo que aprendió (${aprendido.length})`],
        ] as [Pestana, string][]).map(([id, texto]) => (
          <button
            key={id}
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className="px-3 py-2 text-[13px] whitespace-nowrap -mb-px"
            style={{ color: pestana === id ? 'var(--accent)' : TEXTO_SECUNDARIO, fontWeight: pestana === id ? 600 : 500, borderBottom: `2px solid ${pestana === id ? 'var(--accent)' : 'transparent'}` }}
          >
            {texto}
          </button>
        ))}
      </div>

      {pestana === 'comentarios' && (
        <div className="flex flex-col gap-3">
          {!cuentas.some((c) => c.activo) && (
            <Tarjeta className="px-4 py-3 text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
              Todavía no hay cuentas activas. Conéctalas en la pestaña <b>Cuentas</b>.
            </Tarjeta>
          )}
          {preguntas.map((c) => (
            <Tarjeta key={c.id} className="p-4 flex flex-col gap-2" style={{ borderColor: 'var(--warn)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <MessageCircleQuestion size={16} color="var(--warn)" />
                <b className="text-[13.5px]" style={{ color: TEXTO_PRIMARIO }}>R{c.codigo} · {c.autor}</b>
                <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>{nombreCuenta(c.cuenta_id)} · {hora(c.creado_en)}</span>
              </div>
              <span className="text-[13.5px]" style={{ color: TEXTO_PRIMARIO }}>"{c.texto}"</span>
              {c.motivo && <span className="text-[12px]" style={{ color: TEXTO_SECUNDARIO }}>La IA no sabe: {c.motivo}</span>}
              {puedeEditar && (
                <div className="flex gap-2 flex-wrap">
                  <input value={respuestas[c.id] || ''} onChange={(e) => setRespuestas({ ...respuestas, [c.id]: e.target.value })} placeholder="Tu respuesta (la IA la redacta y la publica)" className={`${claseCampo} flex-1 min-w-[220px]`} style={estiloCampo} />
                  <Boton variante="primario" onClick={() => responderYo(c)}>Responder</Boton>
                </div>
              )}
              <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>
                También puedes responder desde tu WhatsApp: <b>R{c.codigo} tu respuesta</b>.
                {c.responder_en && ` Si no respondes, a las ${hora(c.responder_en)} se publica: "${c.respaldo ?? ''}"`}
              </span>
            </Tarjeta>
          ))}
          <Tarjeta className="flex flex-col">
            {comentarios.filter((c) => c.accion !== 'preguntado').length === 0 ? (
              <EstadoVacio icono={Share2} titulo="Todavía no hay comentarios" texto="Cuando alguien comente en tus cuentas activas, aquí ves qué hizo la IA." />
            ) : (
              comentarios
                .filter((c) => c.accion !== 'preguntado')
                .map((c, i) => (
                  <div key={c.id} className="px-4 py-3 flex flex-col gap-1" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Etiqueta color={(ACCION[c.accion] ?? ACCION.ignorado).color}>{(ACCION[c.accion] ?? ACCION.ignorado).texto}</Etiqueta>
                      <b className="text-[13px]" style={{ color: TEXTO_PRIMARIO }}>{c.autor}</b>
                      <span className="text-[12px]" style={{ color: TEXTO_TERCIARIO }}>{nombreCuenta(c.cuenta_id)} · {hora(c.creado_en)}</span>
                    </div>
                    <span className="text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>"{c.texto}"</span>
                    {c.respuesta && <span className="text-[13px]" style={{ color: TEXTO_PRIMARIO }}>↳ {c.respuesta}</span>}
                    {c.motivo && c.accion !== 'respondido' && <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{c.motivo}</span>}
                  </div>
                ))
            )}
          </Tarjeta>
        </div>
      )}

      {pestana === 'cuentas' && (
        <div className="flex flex-col gap-3 max-w-3xl">
          <Tarjeta className="p-4 flex flex-col gap-2.5">
            <span className="text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}>1. Tu App de Meta {info?.app_id && <span className="text-[12.5px] font-normal" style={{ color: 'var(--ok)' }}>· guardada (ID {info.app_id})</span>}</span>
            <ol className="m-0 pl-5 text-[12.5px] leading-relaxed flex flex-col gap-1" style={{ color: TEXTO_SECUNDARIO }}>
              <li>Entra a <b>developers.facebook.com</b> con el Facebook que administra tus páginas → <b>Mis apps → Crear app</b> (tipo <b>Empresa</b>).</li>
              <li>Agrega <b>Inicio de sesión con Facebook para empresas</b>. En su configuración, en <b>URI de redireccionamiento de OAuth válidos</b>, pega esta dirección:</li>
            </ol>
            <div className="flex items-center gap-2 flex-wrap pl-5">
              <code className="text-[12px] rounded px-2 py-1" style={{ backgroundColor: 'var(--surface-2, var(--surface))', border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}>{volver}</code>
              <button onClick={() => copiar(volver)} className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--accent)' }}><Copy size={13} /> Copiar</button>
            </div>
            <ol start={3} className="m-0 pl-5 text-[12.5px] leading-relaxed flex flex-col gap-1" style={{ color: TEXTO_SECUNDARIO }}>
              <li>Si te pide una <b>Configuración</b>, créala con estos permisos y copia su ID: <span style={{ color: TEXTO_TERCIARIO }}>{PERMISOS}</span>.</li>
              <li>En <b>Configuración de la app → Básica</b> copia el <b>Identificador de la app</b> y la <b>Clave secreta</b>. En <b>URL de la política de privacidad</b> y en <b>URL de instrucciones para eliminar datos</b> pega:</li>
            </ol>
            <div className="flex items-center gap-2 flex-wrap pl-5">
              <code className="text-[12px] rounded px-2 py-1" style={{ backgroundColor: 'var(--surface-2, var(--surface))', border: `1px solid ${BORDE}`, color: TEXTO_PRIMARIO }}>{privacidad}</code>
              <button onClick={() => copiar(privacidad)} className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--accent)' }}><Copy size={13} /> Copiar</button>
            </div>
            <ol start={5} className="m-0 pl-5 text-[12.5px] leading-relaxed flex flex-col gap-1" style={{ color: TEXTO_SECUNDARIO }}>
              <li>Arriba de la página de tu app, cambia el <b>Modo de la app</b> de "Desarrollo" a <b>"Activo"</b>, para que tus respuestas las vea todo el mundo.</li>
              <li>Tus cuentas de Instagram tienen que ser <b>profesionales</b> (empresa o creador) y estar conectadas a su página de Facebook.</li>
            </ol>
            {puedeEditar && (
              <div className="grid gap-2 sm:grid-cols-3 mt-1">
                <input value={app.app_id} onChange={(e) => setApp({ ...app, app_id: e.target.value })} placeholder="Identificador de la app" aria-label="Identificador de la app" className={claseCampo} style={estiloCampo} />
                <input value={app.app_secret} onChange={(e) => setApp({ ...app, app_secret: e.target.value })} placeholder="Clave secreta de la app" aria-label="Clave secreta" type="password" autoComplete="off" className={claseCampo} style={estiloCampo} />
                <input value={app.config_id} onChange={(e) => setApp({ ...app, config_id: e.target.value })} placeholder="ID de configuración (si hay)" aria-label="ID de configuración" className={claseCampo} style={estiloCampo} />
                <Boton variante="primario" className="self-start" onClick={guardarApp} disabled={!app.app_id || !app.app_secret}>Guardar y probar</Boton>
              </div>
            )}
          </Tarjeta>

          <Tarjeta className="p-4 flex flex-col gap-2.5">
            <span className="text-[14.5px] font-bold" style={{ color: TEXTO_PRIMARIO }}>2. Conectar tus páginas e Instagram</span>
            <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>Se abre Facebook: marca las páginas (y sus cuentas de Instagram) que quieres que atienda la IA y acepta los permisos.</span>
            {info?.error && <span className="text-[12px]" style={{ color: 'var(--bad)' }}>Último error: {info.error}</span>}
            {puedeEditar && <Boton variante="primario" icono={Link2} className="self-start" onClick={conectar} disabled={!info?.app_id}>Conectar con Facebook</Boton>}
            {puedeEditar && (
              <details>
                <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>Plan B: pegar un token</summary>
                <span className="block text-[12px] my-1.5" style={{ color: TEXTO_TERCIARIO }}>
                  En developers.facebook.com → <b>Herramientas → Explorador de la API Graph</b>, elige tu app, agrega los permisos de arriba, pulsa <b>Generate Access Token</b> y pega aquí el token.
                </span>
                <div className="flex gap-2">
                  <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token de acceso" aria-label="Token de acceso" className={`${claseCampo} flex-1`} style={estiloCampo} />
                  <Boton onClick={conToken} disabled={!token.trim()}>Conectar</Boton>
                </div>
              </details>
            )}
          </Tarjeta>

          {cuentas.map((k0) => {
            const k = editando[k0.id] ?? k0;
            const cambiar = (c: Partial<Cuenta>) => setEditando({ ...editando, [k.id]: { ...k, ...c } });
            return (
              <Tarjeta key={k.id} className="p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] font-bold rounded px-1.5 py-0.5 text-white" style={{ backgroundColor: RED[k.red].color }}>{RED[k.red].texto}</span>
                  <b className="text-[14px] flex-1" style={{ color: TEXTO_PRIMARIO }}>{k.nombre}{k.usuario ? ` (@${k.usuario})` : ''}</b>
                  <Interruptor activo={k.activo} onCambiar={(v) => cambiar({ activo: v })} etiqueta="La IA atiende esta cuenta" deshabilitado={!puedeEditar} />
                </div>
                {k0.error && <span className="text-[12px]" style={{ color: 'var(--bad)' }}>{k0.error}</span>}
                {k0.activo && k0.revisado_en && !k0.error && <span className="text-[11.5px] flex items-center gap-1" style={{ color: 'var(--ok)' }}><Check size={12} /> Revisada a las {hora(k0.revisado_en)}</span>}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
                    Negocio (su ficha y su WhatsApp)
                    <select value={k.negocio_id ?? ''} disabled={!puedeEditar} onChange={(e) => cambiar({ negocio_id: e.target.value || null })} className={`${claseCampo} font-normal`} style={estiloCampo}>
                      <option value="">Elige el negocio…</option>
                      {negocios.negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
                    Comentarios negativos y spam
                    <select value={k.negativos} disabled={!puedeEditar} onChange={(e) => cambiar({ negativos: e.target.value as Cuenta['negativos'] })} className={`${claseCampo} font-normal`} style={estiloCampo}>
                      <option value="ocultar">Ocultarlos (recomendado)</option>
                      <option value="borrar">Borrarlos</option>
                      <option value="nada">No hacer nada (solo avisarme)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
                    WhatsApp al que los lleva
                    <input value={k.whatsapp} disabled={!puedeEditar} onChange={(e) => cambiar({ whatsapp: e.target.value })} placeholder="Vacío = el número del negocio" className={`${claseCampo} font-normal`} style={estiloCampo} />
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px] sm:mt-5" style={{ color: TEXTO_SECUNDARIO }}>
                    <input type="checkbox" checked={k.responder} disabled={!puedeEditar} onChange={(e) => cambiar({ responder: e.target.checked })} /> Responder los comentarios (si no, solo modera)
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>
                  Indicaciones para esta cuenta (opcional)
                  <textarea value={k.instrucciones} disabled={!puedeEditar} onChange={(e) => cambiar({ instrucciones: e.target.value })} rows={2} placeholder="Ej.: menciona que hay inscripciones abiertas este mes" className="rounded-lg outline-none text-[13px] font-normal bg-[var(--surface)] resize-y" style={estiloArea} />
                </label>
                {puedeEditar && editando[k.id] && (
                  <div className="flex gap-2">
                    <Boton variante="primario" onClick={() => guardarCuenta(k)} disabled={k.activo && !k.negocio_id}>Guardar</Boton>
                    <Boton variante="fantasma" onClick={() => { const { [k.id]: _, ...resto } = editando; setEditando(resto); }}>Cancelar</Boton>
                    {k.activo && !k.negocio_id && <span className="text-[12px] self-center" style={{ color: 'var(--warn)' }}>Elige su negocio para activarla.</span>}
                  </div>
                )}
              </Tarjeta>
            );
          })}
        </div>
      )}

      {pestana === 'aprendido' && (
        <div className="flex flex-col gap-3 max-w-3xl">
          <span className="text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            Lo que respondiste a preguntas que no estaban en la ficha. La IA lo usa en las redes y en WhatsApp de ese negocio. Puedes agregar o borrar.
          </span>
          {puedeEditar && !nuevo && <Boton icono={Plus} className="self-start" onClick={() => setNuevo({ pregunta: '', respuesta: '', negocio_id: '' })}>Agregar una respuesta</Boton>}
          {nuevo && (
            <Tarjeta className="p-4 flex flex-col gap-2">
              <input value={nuevo.pregunta} onChange={(e) => setNuevo({ ...nuevo, pregunta: e.target.value })} placeholder="Pregunta (ej. ¿tienen clases para adultos?)" className={claseCampo} style={estiloCampo} />
              <textarea value={nuevo.respuesta} onChange={(e) => setNuevo({ ...nuevo, respuesta: e.target.value })} rows={2} placeholder="Tu respuesta" className="rounded-lg outline-none text-[13px] bg-[var(--surface)]" style={estiloArea} />
              <select value={nuevo.negocio_id} onChange={(e) => setNuevo({ ...nuevo, negocio_id: e.target.value })} className={claseCampo} style={estiloCampo}>
                <option value="">Para todos los negocios</option>
                {negocios.negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
              </select>
              <div className="flex gap-2">
                <Boton variante="primario" onClick={guardarAprendido}>Guardar</Boton>
                <Boton variante="fantasma" onClick={() => setNuevo(null)}>Cancelar</Boton>
              </div>
            </Tarjeta>
          )}
          <Tarjeta className="flex flex-col">
            {aprendido.length === 0 ? (
              <EstadoVacio icono={MessageCircleQuestion} titulo="Todavía no aprendió nada" texto='Cuando la IA te pregunte algo y respondas ("R12 …"), aparece aquí.' />
            ) : (
              aprendido.map((a, i) => (
                <div key={a.id} className="px-4 py-3 flex gap-3" style={{ borderTop: i ? `1px solid ${BORDE}` : 'none' }}>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold" style={{ color: TEXTO_PRIMARIO }}>{a.pregunta}</span>
                    <span className="text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>{a.respuesta}</span>
                    <span className="text-[11.5px]" style={{ color: TEXTO_TERCIARIO }}>{negocios.negocios.find((n) => n.id === a.negocio_id)?.nombre ?? 'Todos los negocios'}</span>
                  </div>
                  {puedeEditar && <button onClick={() => borrarAprendido(a)} aria-label="Borrar" className="self-start p-1.5 rounded-md" style={{ color: TEXTO_TERCIARIO }}><Trash2 size={14} /></button>}
                </div>
              ))
            )}
          </Tarjeta>
        </div>
      )}
    </div>
  );
}
