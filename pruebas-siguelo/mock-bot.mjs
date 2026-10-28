// Bot falso: anota qué regla o flujo se activó en vez de mandar sus mensajes.
export const botActivados = [];

export async function enviarPasos(sock, lineaId, conversacionId, telefono, pasos) {
  botActivados.push({ tipo: 'pasos', lineaId, conversacionId, telefono, pasos });
}

export async function iniciarFlujo(sock, lineaId, empresaId, conversacionId, telefono, reglaId, flujo) {
  botActivados.push({ tipo: 'flujo', lineaId, conversacionId, telefono, reglaId, flujo });
}
