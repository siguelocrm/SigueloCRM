import { db } from '../db.js';
import { HORA } from '../horario.js';
import { registrar } from '../registro.js';
import { transcribir } from './openai.js';

// Las notas de voz del cliente (y las tuyas, cuando respondes una pregunta con un audio):
// antes de que la IA lea el chat, se pasan a texto con OpenAI. El texto queda guardado en
// el mensaje (se ve debajo del audio en la bandeja) y la IA lo lee como lo que dijo.

const MAX_POR_LECTURA = 4; // las últimas notas de voz sin transcribir de ese chat
const RECIENTES_MS = 48 * HORA;

type MensajeAudio = { id: string; remitente: string; tipo: string; contenido: string | null; media_url?: string | null; creado_en: string };

// Transcribe los audios de esta lista que todavía no tienen texto (cambia su `contenido`).
export async function transcribirAudios(clave: string, empresaId: string, contactoId: string | null, mensajes: MensajeAudio[]): Promise<void> {
  const pendientes = mensajes
    .filter((m) => m.tipo === 'audio' && m.remitente === 'cliente' && !m.contenido?.trim() && m.media_url && Date.now() - new Date(m.creado_en).getTime() < RECIENTES_MS)
    .slice(-MAX_POR_LECTURA);
  await Promise.all(
    pendientes.map(async (m) => {
      const r = await transcribir(clave, m.media_url!);
      if (!r.ok) {
        await registrar(empresaId, contactoId, 'ia_error', `IA: no se pudo escuchar una nota de voz (${r.mensaje}).`);
        return;
      }
      const texto = r.texto || '(audio sin palabras)';
      m.contenido = texto;
      const { error } = await db.from('mensajes').update({ contenido: texto }).eq('id', m.id).eq('tipo', 'audio');
      if (error) console.error('IA: no se pudo guardar la transcripción:', error.message);
    }),
  );
}

// Cómo ve la IA un mensaje (las notas de voz, con lo que dijo).
export function textoParaIA(m: { tipo: string; contenido: string | null }): string {
  if (m.tipo === 'texto') return m.contenido || '';
  if (m.tipo === 'audio') return m.contenido?.trim() ? `[nota de voz] ${m.contenido.trim()}` : '[nota de voz que no se pudo escuchar]';
  return `[${m.tipo}] ${m.contenido || ''}`.trim();
}
