import { createHmac } from 'node:crypto';
import type { RedSocial } from '../tipos.js';

// La API de Meta (Graph API) para tus páginas de Facebook y tus cuentas de
// Instagram de empresa (conectadas a una página): iniciar sesión con Facebook,
// leer los comentarios nuevos, responder, ocultar y borrar. Con una App de Meta
// propia alcanza el "acceso estándar" (sirve para cuentas que son tuyas).

export const VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const ESPERA_MS = 20_000;

export type AppMeta = { app_id: string; app_secret: string; config_id?: string | null };

// Permisos que se piden al conectar (comentarios de páginas e Instagram).
export const PERMISOS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'business_management',
  'instagram_basic',
  'instagram_manage_comments',
];

export class ErrorMeta extends Error {
  constructor(mensaje: string, readonly codigo: number) {
    super(mensaje);
  }
}

function explicar(e: { message?: string; code?: number; error_subcode?: number } | undefined, estado: number): ErrorMeta {
  const m = e?.message || `Meta respondió ${estado}`;
  const c = Number(e?.code ?? 0);
  if (c === 190) return new ErrorMeta('El permiso de Facebook venció o se quitó: vuelve a conectar la cuenta.', c);
  if (c === 10 || c === 200 || (c >= 200 && c < 300)) return new ErrorMeta(`Falta un permiso en Facebook: ${m}`, c);
  if ([4, 17, 32, 613].includes(c)) return new ErrorMeta('Facebook pidió esperar un rato (demasiadas consultas).', c);
  return new ErrorMeta(m, c);
}

// Llama a la API. Con el secreto de la app firma el pedido (appsecret_proof), como recomienda Meta.
export async function graph(metodo: 'GET' | 'POST' | 'DELETE', ruta: string, params: Record<string, string | number | boolean>, token: string, secreto?: string): Promise<any> {
  const p = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
  p.set('access_token', token);
  if (secreto) p.set('appsecret_proof', createHmac('sha256', secreto).update(token).digest('hex'));
  const url = `${GRAPH}${ruta}`;
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r =
      metodo === 'GET'
        ? await fetch(`${url}?${p}`, { signal: control.signal })
        : await fetch(url, { method: metodo, body: p, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: control.signal });
    const datos: any = await r.json().catch(() => null);
    if (!r.ok || datos?.error) throw explicar(datos?.error, r.status);
    return datos;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ErrorMeta('Facebook tardó demasiado en responder.', 0);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Iniciar sesión con Facebook ----------

export function urlLogin(app: AppMeta, volver: string, estado: string): string {
  const p = new URLSearchParams({ client_id: app.app_id, redirect_uri: volver, state: estado, response_type: 'code' });
  // Con "Facebook Login para empresas" se usa la configuración; si no, la lista de permisos.
  if (app.config_id) p.set('config_id', app.config_id);
  else p.set('scope', PERMISOS.join(','));
  return `https://www.facebook.com/${VERSION}/dialog/oauth?${p}`;
}

export async function tokenDeCodigo(app: AppMeta, codigo: string, volver: string): Promise<string> {
  const d = await graph('GET', '/oauth/access_token', { client_id: app.app_id, client_secret: app.app_secret, redirect_uri: volver, code: codigo }, app.app_id + '|' + app.app_secret);
  return d.access_token;
}

// Un token de usuario de larga duración: las páginas que salen de él no vencen.
export async function tokenLargo(app: AppMeta, token: string): Promise<string> {
  const d = await graph('GET', '/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: app.app_id, client_secret: app.app_secret, fb_exchange_token: token }, token);
  return d.access_token;
}

export type CuentaMeta = { red: RedSocial; externo_id: string; nombre: string; usuario: string | null; token: string };

// Las páginas que administra la persona, y la cuenta de Instagram de empresa de cada una.
export async function cuentasDe(app: AppMeta, tokenUsuario: string): Promise<CuentaMeta[]> {
  const d = await graph('GET', '/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: 100 }, tokenUsuario, app.app_secret);
  const cuentas: CuentaMeta[] = [];
  for (const p of d.data || []) {
    if (!p.access_token) continue;
    cuentas.push({ red: 'facebook', externo_id: p.id, nombre: p.name, usuario: null, token: p.access_token });
    const ig = p.instagram_business_account;
    if (ig?.id) cuentas.push({ red: 'instagram', externo_id: ig.id, nombre: ig.name || ig.username || p.name, usuario: ig.username ?? null, token: p.access_token });
  }
  return cuentas;
}

// ---------- Comentarios ----------

export type ComentarioMeta = {
  externo_id: string;
  publicacion_id: string;
  publicacion: string;
  autor: string;
  autor_id: string | null;
  texto: string;
  publicado_en: string;
  respuesta_a: string | null; // si responde a otro comentario
};

// Los comentarios de las últimas publicaciones (los más nuevos primero).
export async function comentarios(red: RedSocial, cuentaId: string, token: string, secreto?: string): Promise<ComentarioMeta[]> {
  const lista: ComentarioMeta[] = [];
  if (red === 'facebook') {
    const d = await graph(
      'GET',
      `/${cuentaId}/feed`,
      { fields: 'id,message,created_time,comments.filter(stream).order(reverse_chronological).limit(25){id,message,created_time,from{id,name},parent{id}}', limit: 10 },
      token,
      secreto,
    );
    for (const post of d.data || []) {
      for (const c of post.comments?.data || []) {
        lista.push({
          externo_id: c.id,
          publicacion_id: post.id,
          publicacion: String(post.message || '').slice(0, 500),
          autor: c.from?.name || 'Alguien',
          autor_id: c.from?.id ?? null,
          texto: String(c.message || ''),
          publicado_en: c.created_time,
          respuesta_a: c.parent?.id ?? null,
        });
      }
    }
  } else {
    const d = await graph(
      'GET',
      `/${cuentaId}/media`,
      { fields: 'id,caption,timestamp,comments.limit(25){id,text,timestamp,username,from{id,username},replies.limit(25){id,text,timestamp,username,from{id,username}}}', limit: 10 },
      token,
      secreto,
    );
    for (const m of d.data || []) {
      const agregar = (c: any, padre: string | null) =>
        lista.push({
          externo_id: c.id,
          publicacion_id: m.id,
          publicacion: String(m.caption || '').slice(0, 500),
          autor: c.username ? `@${c.username}` : c.from?.username ? `@${c.from.username}` : 'Alguien',
          autor_id: c.from?.id ?? null,
          texto: String(c.text || ''),
          publicado_en: c.timestamp,
          respuesta_a: padre,
        });
      for (const c of m.comments?.data || []) {
        agregar(c, null);
        for (const r of c.replies?.data || []) agregar(r, c.id);
      }
    }
  }
  return lista;
}

export async function responder(red: RedSocial, comentarioId: string, texto: string, token: string, secreto?: string): Promise<string> {
  const d = await graph('POST', red === 'facebook' ? `/${comentarioId}/comments` : `/${comentarioId}/replies`, { message: texto }, token, secreto);
  return d.id;
}

export async function ocultar(red: RedSocial, comentarioId: string, token: string, secreto?: string): Promise<void> {
  await graph('POST', `/${comentarioId}`, red === 'facebook' ? { is_hidden: true } : { hide: true }, token, secreto);
}

export async function borrar(comentarioId: string, token: string, secreto?: string): Promise<void> {
  await graph('DELETE', `/${comentarioId}`, {}, token, secreto);
}
