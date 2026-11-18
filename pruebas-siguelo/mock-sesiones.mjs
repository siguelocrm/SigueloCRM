// WhatsApp falso: guarda lo que se "envía" en vez de mandarlo.
export const enviados = [];
export const linea = { activa: true };
let n = 0;

const sock = (lineaId) => ({
  async onWhatsApp(jid) {
    return (linea.sinWhatsapp || []).includes(String(jid).split('@')[0]) ? [] : [{ jid, exists: true }];
  },
  async sendMessage(jid, contenido) {
    // falla: un error real (número bloqueado...). caidas: cuántas veces más se "cae la conexión" (se recupera sola).
    if (linea.falla) throw new Error(typeof linea.falla === 'string' ? linea.falla : 'Error de envío (falso)');
    if (linea.caidas > 0) {
      linea.caidas--;
      throw new Error('Connection Closed');
    }
    enviados.push({ jid, linea: lineaId, texto: contenido.text ?? contenido.caption, imagen: contenido.image?.url, documento: contenido.document?.url, ubicacion: contenido.location, en: Date.now() });
    return { key: { id: `WID-${++n}` } };
  },
});

export function obtenerSesion(lineaId) {
  return linea.activa ? { sock: sock(lineaId), estado: 'activo', qrDataUrl: null } : undefined;
}
