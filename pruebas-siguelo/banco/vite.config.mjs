// Banco de pruebas: la pantalla Seguimiento real del CRM con Supabase y sesión falsos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..').split(path.sep).join('/');
const CLIENTE = RAIZ + '/client';
const AQUI = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const { default: react } = await import(pathToFileURL(RAIZ + '/node_modules/@vitejs/plugin-react/dist/index.js').href);
const { default: tailwindcss } = await import(pathToFileURL(RAIZ + '/node_modules/@tailwindcss/vite/dist/index.mjs').href);

const VIRTUALES = {
  [CLIENTE + '/src/__banco.tsx']: `
    import './index.css';
    import { createRoot } from 'react-dom/client';
    import { ToastProvider } from './components/ui';
    import Seguimiento from './features/seguimiento/Seguimiento';
    import Negocios from './features/negocios/Negocios';
    import Pipeline from './features/pipeline/Pipeline';
    import IA from './features/ia/IA';
    import Inscripciones from './features/inscripciones/Inscripciones';
    import UsuariosSiguelo from './features/usuarios/UsuariosSiguelo';
    import Redes from './features/redes/Redes';
    import Masivos from './features/masivos/Masivos';
    import ResponderIA from './features/bandeja/ResponderIA';
    import Agencia from './features/agencia/Agencia';
    import ListaConversaciones from './features/bandeja/ListaConversaciones';
    import { useConversaciones } from './features/bandeja/hooks/useConversaciones';
    import { createElement } from 'react';
    // en minúscula: así React Refresh no lo toma como componente del archivo virtual
    function bancoBandeja() {
      const conv = useConversaciones({ id: 'u1', empresa_id: 'e1', rol: 'dueno', nombre: 'Gus' });
      return <div style={{ display: 'flex', height: '100%', width: '100%' }}><ListaConversaciones conversaciones={conv.conversaciones} ultimosMensajes={conv.ultimosMensajes} lineas={conv.lineas} etiquetasPorTelefono={conv.etiquetasPorTelefono} contactoPorTelefono={conv.contactoPorTelefono} pendientes={conv.pendientes} ultimoDelCliente={conv.ultimoDelCliente} esVendedor={false} miId="u1" seleccionadaId="b2" onSeleccionar={() => {}} colorLinea={conv.colorLinea} nombreLinea={conv.nombreLinea} compacta={true} consulta={conv.consulta} onConsulta={conv.setConsulta} conteos={conv.conteos} etiquetasDisponibles={conv.etiquetasDisponibles} hayMas={conv.hayMas} cargando={conv.cargando} cargandoMas={conv.cargandoMas} onCargarMas={conv.cargarMas} /><div style={{ flex: 1 }} /></div>;
    }
    const q = new URLSearchParams(location.search);
    if (q.get('tema') === 'claro') document.documentElement.dataset.theme = 'light';
    const vista = q.get('vista');
    const Pagina = vista === 'bandeja' ? createElement(bancoBandeja) : vista === 'negocios' ? <Negocios /> : vista === 'embudo' ? <Pipeline onAbrirChat={() => {}} /> : vista === 'ia' ? <IA onAbrirChat={(t) => { window.__chat = t; }} /> : vista === 'inscripciones' ? <Inscripciones onAbrirChat={(t) => { window.__chat = t; }} /> : vista === 'usuarios' ? <UsuariosSiguelo /> : vista === 'redes' ? <Redes /> : vista === 'masivos' ? <Masivos /> : vista === 'agencia' ? <Agencia /> : vista === 'responder' ? <div style={{ width: 520, margin: 24, padding: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}><div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0"><div className="inline-flex shrink-0 rounded-[10px] p-0.5 text-[13px]" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}><span className="rounded-lg px-3 py-[3px] font-semibold" style={{ background: 'var(--surface)' }}>Responder</span><span className="px-3 py-[3px]">Nota interna</span></div><ResponderIA seleccionada={{ id: 'cv9', linea_id: 'l1', contacto_telefono: '59170000055', contacto_nombre: 'Leo', estado: 'abierto', agente_asignado_id: null, ultima_actividad: '' }} mensajes={[{ id: 'm1', conversacion_id: 'cv9', remitente: 'cliente', agente_id: null, tipo: 'audio', contenido: null, media_url: null, creado_en: new Date(Date.now() - 5 * 60000).toISOString(), whatsapp_id: null, estado_entrega: 'entregado' }]} contactoId="c9" /></div></div> : <Seguimiento />;
    createRoot(document.getElementById('root')).render(
      <ToastProvider><div style={{ height: '100dvh', display: 'flex', background: 'var(--bg)', fontFamily: 'var(--fuente-sans)' }}>{Pagina}</div></ToastProvider>
    );`,
  [CLIENTE + '/src/__mock_supabase.ts']: fs.readFileSync(AQUI + '/mock-supabase.ts', 'utf8'),
  [CLIENTE + '/src/__mock_auth.ts']: fs.readFileSync(AQUI + '/mock-auth.ts', 'utf8'),
};

function banco() {
  return {
    name: 'banco-de-pruebas',
    enforce: 'pre',
    resolveId(fuente, importador) {
      if (fuente === '/src/__banco.tsx') return CLIENTE + '/src/__banco.tsx';
      if (importador && /supabaseClient(\.ts)?$/.test(fuente)) return CLIENTE + '/src/__mock_supabase.ts';
      if (importador && /AuthContext(\.tsx)?$/.test(fuente)) return CLIENTE + '/src/__mock_auth.ts';
      return null;
    },
    load(id) {
      return VIRTUALES[id.replace(/\\/g, '/')] ?? null;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/banco')) return next();
        const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Banco de pruebas</title></head><body><div id="root"></div><script type="module" src="/src/__banco.tsx"></script></body></html>');
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
    },
  };
}

export default {
  root: CLIENTE,
  envDir: AQUI, // sin las claves reales
  plugins: [banco(), react(), tailwindcss()],
  server: { port: 5199, strictPort: true, fs: { allow: [RAIZ, AQUI] } },
};
