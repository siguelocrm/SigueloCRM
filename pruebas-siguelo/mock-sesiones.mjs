// WhatsApp falso: guarda lo que se "envía" en vez de mandarlo.
export const enviados = [];
export const linea = { activa: true };
let n = 0;

const sock = (lineaId) => ({
  async sendMessage(jid, contenido) {
    if (linea.falla) throw new Error('Connection Closed (falso)');
    enviados.push({ jid, linea: lineaId, texto: contenido.text ?? contenido.caption, imagen: contenido.image?.url, documento: contenido.document?.url, en: Date.now() });
    return { key: { id: `WID-${++n}` } };
  },
});

export function obtenerSesion(lineaId) {
  return linea.activa ? { sock: sock(lineaId), estado: 'activo', qrDataUrl: null } : undefined;
}
