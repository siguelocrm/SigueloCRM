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
    const q = new URLSearchParams(location.search);
    if (q.get('tema') === 'claro') document.documentElement.dataset.theme = 'light';
    const vista = q.get('vista');
    const Pagina = vista === 'negocios' ? <Negocios /> : vista === 'embudo' ? <Pipeline onAbrirChat={() => {}} /> : vista === 'ia' ? <IA onAbrirChat={(t) => { window.__chat = t; }} /> : vista === 'inscripciones' ? <Inscripciones onAbrirChat={(t) => { window.__chat = t; }} /> : vista === 'usuarios' ? <UsuariosSiguelo /> : <Seguimiento />;
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
