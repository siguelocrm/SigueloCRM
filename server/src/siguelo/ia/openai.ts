// Llamadas a OpenAI (la IA de la Fase 3). Igual que fondo/fondo.js de la
// extensión: Chat Completions pidiendo la respuesta en JSON, y si el modelo
// no acepta un parámetro, se reintenta sin él.

const API = 'https://api.openai.com/v1';
const ESPERA_MAX_MS = 45_000;

// Un mensaje puede llevar partes: texto, una imagen o un PDF (para leer comprobantes).
export type ParteChat =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'file'; file: { filename: string; file_data: string } };
export type MensajeChat = { role: 'system' | 'user' | 'assistant'; content: string | ParteChat[] };
export type Uso = { entrada: number; salida: number };
export type ResultadoChat = { ok: true; json: Record<string, unknown>; uso: Uso } | { ok: false; mensaje: string };

type Respuesta = { estado: number; datos: any; error?: string };

async function pedir(ruta: string, clave: string, cuerpo?: unknown): Promise<Respuesta> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ESPERA_MAX_MS);
  try {
    const r = await fetch(API + ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${clave}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: control.signal,
    });
    let datos = null;
    try {
      datos = await r.json();
    } catch {
      datos = null;
    }
    return { estado: r.status, datos };
  } catch (err) {
    const e = err as Error;
    return { estado: 0, datos: null, error: e.name === 'AbortError' ? 'La IA tardó demasiado en responder.' : `Sin conexión con OpenAI (${e.message}).` };
  } finally {
    clearTimeout(t);
  }
}

function explicar(res: Respuesta): string {
  if (res.error) return res.error;
  const m: string = res.datos?.error?.message || '';
  if (res.estado === 401) return 'La clave de OpenAI no es válida o fue revocada.';
  if (res.estado === 429) return /quota|billing|credit/i.test(m) ? 'Tu cuenta de OpenAI no tiene saldo disponible.' : 'OpenAI pidió esperar (demasiadas solicitudes).';
  if (res.estado === 404) return `El modelo elegido no existe o tu cuenta no tiene acceso: ${m}`;
  return `OpenAI respondió con error ${res.estado}: ${m}`;
}

// Saca el JSON de la respuesta (por si el modelo agrega texto alrededor).
export function leerJSON(texto: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(texto);
    return j && typeof j === 'object' ? j : null;
  } catch {
    const m = /\{[\s\S]*\}/.exec(String(texto || ''));
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

export async function chatJSON(clave: string, modelo: string, mensajes: MensajeChat[]): Promise<ResultadoChat> {
  const cuerpo: Record<string, unknown> = { model: modelo, messages: mensajes, response_format: { type: 'json_object' } };
  if (/^(gpt-[5-9]|o\d)/.test(modelo)) cuerpo.reasoning_effort = 'low';
  let res: Respuesta = { estado: 0, datos: null };
  for (let intento = 0; intento < 3; intento++) {
    res = await pedir('/chat/completions', clave, cuerpo);
    const m: string = res.datos?.error?.message || '';
    if (res.estado === 400 && cuerpo.reasoning_effort && /reasoning/i.test(m)) {
      delete cuerpo.reasoning_effort;
      continue;
    }
    if (res.estado === 400 && cuerpo.response_format && /response_format|json/i.test(m)) {
      delete cuerpo.response_format;
      continue;
    }
    break;
  }
  if (res.estado !== 200 || !res.datos?.choices) return { ok: false, mensaje: explicar(res) };
  const texto: string = res.datos.choices[0]?.message?.content || '';
  const json = leerJSON(texto);
  if (!json) return { ok: false, mensaje: 'La IA no devolvió una respuesta válida.' };
  const u = res.datos.usage || {};
  return { ok: true, json, uso: { entrada: u.prompt_tokens || 0, salida: u.completion_tokens || 0 } };
}

// Modelos de chat que puede usar la cuenta (sirve también para probar la clave).
export async function listarModelos(clave: string): Promise<{ ok: true; modelos: string[] } | { ok: false; mensaje: string }> {
  const res = await pedir('/models', clave);
  if (res.estado !== 200 || !res.datos) return { ok: false, mensaje: explicar(res) };
  const ids: string[] = (res.datos.data || [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|transcribe|tts|image|search|embedding/.test(id));
  return { ok: true, modelos: ids.sort() };
}
