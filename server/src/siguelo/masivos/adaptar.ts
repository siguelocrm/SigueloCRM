import { db } from '../db.js';
import { configDeEmpresa, llamar } from '../ia/config.js';
import { recortarTexto } from '../textos.js';

// "Que la IA adapte el mensaje si corresponde": cada mensaje del masivo queda lo más fiel posible al
// original, pero con lo que este cliente ya contó (el curso que le interesa, la edad del niño...).
// Si no hay nada útil, o la IA falla, sale el mensaje original.

const recortar = (t: string, n: number) => recortarTexto(t, n);

export async function adaptarParaCliente(empresaId: string, contactoId: string | null, conversacionId: string | null, nombre: string | null, original: string): Promise<string> {
  const c = await configDeEmpresa(empresaId);
  if (!c) return original;
  const [{ data: lecturas }, { data: campos }, { data: mensajes }] = await Promise.all([
    contactoId ? db.from('siguelo_ia_lecturas').select('resumen, interes').eq('contacto_id', contactoId).limit(5) : Promise.resolve({ data: [] }),
    contactoId ? db.from('contacto_campos').select('campo_id, valor').eq('contacto_id', contactoId) : Promise.resolve({ data: [] }),
    conversacionId
      ? db.from('mensajes').select('remitente, tipo, contenido, creado_en').eq('conversacion_id', conversacionId).order('creado_en', { ascending: false }).limit(15)
      : Promise.resolve({ data: [] }),
  ]);
  const { data: nombresCampos } = campos?.length ? await db.from('campos_personalizados').select('id, nombre').eq('empresa_id', empresaId) : { data: [] };
  const datos = [
    ...(lecturas || []).flatMap((l) => [l.interes && `Le interesa: ${l.interes}`, l.resumen && `Resumen de su chat: ${l.resumen}`]),
    ...(campos || []).filter((x) => x.valor?.trim()).map((x) => `${(nombresCampos || []).find((n) => n.id === x.campo_id)?.nombre ?? 'Dato'}: ${x.valor}`),
  ].filter(Boolean) as string[];
  const chat = [...(mensajes || [])]
    .reverse()
    .filter((m) => m.tipo === 'texto' && m.contenido?.trim())
    .map((m) => `${m.remitente === 'cliente' ? 'Cliente' : 'Nosotros'}: ${recortar(m.contenido!.trim(), 200)}`);
  if (!datos.length && !chat.length) return original; // nada que agregar
  const r = await llamar(c, [
    {
      role: 'system',
      content: `Adaptas un mensaje de WhatsApp de un envío masivo a un cliente. Reglas:
- Debe quedar lo MÁS FIEL posible al original: el mismo propósito, la misma información, los mismos datos (precios, fechas, links), el mismo largo aproximado y el mismo estilo y emojis.
- Solo agrega o ajusta detalles con lo que este cliente ya contó (por ejemplo, el curso que le interesa, la edad o el nombre de su hijo). Si nada de eso viene al caso, devuélvelo igual.
- No inventes nada que no esté en el original o en sus datos. No cambies precios, fechas ni links.
Responde SOLO con JSON: {"mensaje": "el mensaje para este cliente"}`,
    },
    {
      role: 'user',
      content: `MENSAJE ORIGINAL:\n"""\n${original}\n"""\n\nCLIENTE: ${nombre || '(sin nombre)'}\n${datos.length ? `LO QUE SABEMOS:\n${datos.join('\n')}\n` : ''}${chat.length ? `SU CHAT (lo último):\n${chat.join('\n')}` : ''}`,
    },
  ]);
  const texto = r.ok && typeof r.json.mensaje === 'string' ? r.json.mensaje.trim() : '';
  // Un resultado vacío o demasiado distinto en largo no se usa.
  return texto && texto.length < original.length * 2.5 + 200 ? texto : original;
}
