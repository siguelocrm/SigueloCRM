import { HORA } from '../horario.js';
import { normalizarTexto } from '../textos.js';
import type { ControlPago, CursoRow, LecturaComprobante } from '../tipos.js';

// Lectura y controles de un comprobante de pago (Fase 5). Viene del módulo de
// pagos del otro proyecto (services/payments.ts): la IA lee la imagen y acá se
// decide, sin IA, si el pago se confirma, se rechaza o queda para revisar.

export const PROMPT_COMPROBANTE = `Analiza el archivo adjunto. Determina si es un comprobante de pago (transferencia bancaria, pago por QR, depósito o billetera móvil).
Extrae los datos exactamente como aparecen. Revisa con cuidado señales de edición o falsificación (tipografías distintas, números desalineados, recortes, fondos alterados, fechas o montos sobrescritos, una pantalla que no corresponde al banco).
Responde SOLO con un JSON con esta forma:
{"es_comprobante": true/false, "monto": número o null, "moneda": "BOB", "USD"... o null, "fecha": "YYYY-MM-DD HH:mm" o null, "transaccion": "número de transacción/operación/comprobante" o null, "pagador": texto o null, "banco": texto o null, "destinatario": "nombre de quien recibe" o null, "cuenta_destino": texto o null, "glosa": "concepto o descripción" o null, "senales_edicion": ["..."], "confianza": número entre 0 y 1}`;

// "1.234,56" / "1,234.56" / "150,00" / "Bs 150" → número
export function leerMonto(crudo: unknown): number | null {
  if (crudo == null) return null;
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null;
  let s = String(crudo).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const punto = s.lastIndexOf('.');
  const coma = s.lastIndexOf(',');
  if (punto >= 0 && coma >= 0) {
    const decimal = punto > coma ? '.' : ',';
    s = s.replace(decimal === '.' ? /,/g : /\./g, '').replace(decimal, '.');
  } else if (coma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (punto >= 0 && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const textoONull = (x: unknown) => (x == null || String(x).trim() === '' ? null : String(x).trim().slice(0, 200));

export function validarLectura(j: Record<string, unknown>): LecturaComprobante {
  const confianza = Number(j.confianza);
  return {
    es_comprobante: j.es_comprobante === true,
    monto: leerMonto(j.monto),
    moneda: textoONull(j.moneda),
    fecha: textoONull(j.fecha),
    transaccion: textoONull(j.transaccion),
    pagador: textoONull(j.pagador),
    banco: textoONull(j.banco),
    destinatario: textoONull(j.destinatario),
    cuenta_destino: textoONull(j.cuenta_destino),
    glosa: textoONull(j.glosa),
    senales_edicion: Array.isArray(j.senales_edicion) ? j.senales_edicion.map(String).filter((x) => x.trim()).slice(0, 10) : [],
    confianza: Number.isFinite(confianza) ? Math.min(1, Math.max(0, confianza)) : 0.5,
  };
}

// ¿Son la misma persona? Tolera el orden y nombres incompletos ("Juan Pérez" = "PEREZ GOMEZ JUAN").
export function mismosNombres(a: string, b: string): boolean {
  const pa = normalizarTexto(a).split(' ').filter((w) => w.length > 2);
  const pb = new Set(normalizarTexto(b).split(' ').filter((w) => w.length > 2));
  if (!pa.length || !pb.size) return false;
  const iguales = pa.filter((w) => pb.has(w)).length;
  return iguales >= Math.min(2, pa.length, pb.size);
}

// El número de transacción, sin espacios ni guiones, para comparar.
export const transaccionNormal = (t: string | null | undefined): string | null => {
  const x = String(t || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return x.length >= 4 ? x : null;
};

const monedaNormal = (m: string | null | undefined): string => {
  const x = String(m || '').toUpperCase().replace(/[^A-Z$]/g, '');
  if (/^(BS|BOB|BOLIVIANOS?)$/.test(x)) return 'BOB';
  if (/^(US|USD|\$|US\$|DOLARES?)$/.test(x)) return 'USD';
  return x;
};
export const formatoMonto = (monto: number | null | undefined, moneda: string) =>
  monto == null ? '—' : `${moneda} ${Number(monto).toLocaleString('es', { maximumFractionDigits: 2 })}`;

export type Veredicto = { resultado: 'ok' | 'rechazar' | 'revisar'; motivo: string; controles: ControlPago[] };
type Control = ControlPago & { grave: boolean; paraCliente?: string };

// Los controles automáticos. Un control "grave" que falla rechaza el pago
// (y se le explica al cliente); uno que no se pudo comprobar lo deja para revisar.
export function controlar(
  l: LecturaComprobante,
  curso: Pick<CursoRow, 'precio' | 'moneda' | 'destinatario' | 'cuenta' | 'max_horas'> | null,
  extra: { pagadoEn: number | null; ahora: number; repetido: boolean; yaInscrito: boolean },
): Veredicto {
  const cs: Control[] = [];
  const add = (c: Control) => cs.push(c);

  if (curso) {
    const moneda = curso.moneda || 'Bs';
    if (l.monto == null) add({ codigo: 'monto', nombre: 'Monto', ok: false, grave: false, detalle: 'No se pudo leer el monto' });
    else if (!(Number(curso.precio) > 0)) {
      // Sin precio fijo (por ejemplo, un curso del club: el total depende de cuántos cursos toma).
      add({ codigo: 'monto', nombre: 'Monto', ok: l.monto > 0, grave: false, detalle: `Pagó ${formatoMonto(l.monto, moneda)} (el total lo calcula tu sistema del club)` });
    } else {
      const ok = l.monto + 0.001 >= Number(curso.precio);
      add({
        codigo: 'monto',
        nombre: 'Monto',
        ok,
        grave: true,
        detalle: `Precio ${formatoMonto(curso.precio, moneda)}, pagó ${formatoMonto(l.monto, moneda)}`,
        paraCliente: `el monto (${formatoMonto(l.monto, moneda)}) no alcanza al precio (${formatoMonto(curso.precio, moneda)})`,
      });
    }
    if (l.moneda && monedaNormal(l.moneda) !== monedaNormal(moneda)) {
      add({ codigo: 'moneda', nombre: 'Moneda', ok: false, grave: false, detalle: `El comprobante está en ${l.moneda} y el curso en ${moneda}` });
    }

    const nombres = curso.destinatario.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    const cuenta = curso.cuenta.replace(/\D/g, '');
    if (nombres.length || cuenta.length >= 4) {
      const leida = (l.cuenta_destino || '').replace(/\D/g, '');
      const porNombre = !!l.destinatario && nombres.some((n) => mismosNombres(n, l.destinatario!));
      const porCuenta = cuenta.length >= 4 && leida.length >= 4 && (leida.endsWith(cuenta.slice(-4)) || cuenta.endsWith(leida.slice(-4)));
      const ilegible = !l.destinatario && leida.length < 4;
      add({
        codigo: 'destinatario',
        nombre: 'Destinatario',
        ok: porNombre || porCuenta,
        grave: !ilegible,
        detalle: ilegible ? 'No se pudo leer a quién se pagó' : `Pagado a: ${[l.destinatario, l.cuenta_destino].filter(Boolean).join(' · ')}`,
        paraCliente: 'el pago no fue hecho a nuestra cuenta',
      });
    }
  }

  if (extra.pagadoEn == null) add({ codigo: 'fecha', nombre: 'Fecha', ok: false, grave: false, detalle: 'No se pudo leer la fecha' });
  else {
    const horas = (extra.ahora - extra.pagadoEn) / HORA;
    const max = curso?.max_horas ?? 72;
    const futura = horas < -1;
    const vieja = horas > max;
    add({
      codigo: 'fecha',
      nombre: 'Fecha',
      ok: !futura && !vieja,
      grave: vieja,
      detalle: vieja ? `Es de hace ${Math.round(horas)} h (máximo ${max} h)` : futura ? 'La fecha es posterior a hoy' : 'Reciente',
      paraCliente: `el comprobante es antiguo (de hace ${horas > 48 ? `${Math.round(horas / 24)} días` : `${Math.round(horas)} horas`})`,
    });
  }

  if (!transaccionNormal(l.transaccion)) add({ codigo: 'repetido', nombre: 'No repetido', ok: false, grave: false, detalle: 'No se encontró el número de transacción' });
  else
    add({
      codigo: 'repetido',
      nombre: 'No repetido',
      ok: !extra.repetido,
      grave: true,
      detalle: extra.repetido ? `La transacción ${l.transaccion} ya se usó en otro pago` : `Transacción ${l.transaccion}`,
      paraCliente: 'ese comprobante ya fue usado antes',
    });

  add({
    codigo: 'edicion',
    nombre: 'Sin señales de edición',
    ok: !l.senales_edicion.length && l.confianza >= 0.6,
    grave: false,
    detalle: l.senales_edicion.length ? l.senales_edicion.join('; ') : `Confianza ${Math.round(l.confianza * 100)}%`,
  });
  if (extra.yaInscrito) add({ codigo: 'inscrito', nombre: 'Primera inscripción', ok: false, grave: false, detalle: 'Ya estaba inscrito en este curso' });

  const controles = cs.map(({ codigo, nombre, ok, detalle }) => ({ codigo, nombre, ok, detalle }));
  const grave = cs.find((c) => !c.ok && c.grave);
  if (grave) return { resultado: 'rechazar', motivo: grave.paraCliente || grave.detalle, controles };
  if (!curso) return { resultado: 'revisar', motivo: 'No se sabe de qué curso es (ninguno tiene ese precio)', controles };
  const dudas = cs.filter((c) => !c.ok);
  if (dudas.length) return { resultado: 'revisar', motivo: dudas.map((c) => c.detalle).join(' · '), controles };
  return { resultado: 'ok', motivo: '', controles };
}

// ¿De qué curso es? El único del negocio, o el que tiene ese precio, o el que nombra la glosa.
export function elegirCurso<T extends Pick<CursoRow, 'id' | 'nombre' | 'precio'>>(candidatos: T[], l: LecturaComprobante): T | null {
  if (candidatos.length === 1) return candidatos[0];
  if (l.monto != null) {
    const porPrecio = candidatos.filter((c) => Math.abs(Number(c.precio) - l.monto!) < 0.01);
    if (porPrecio.length === 1) return porPrecio[0];
  }
  const glosa = normalizarTexto(l.glosa);
  if (glosa) {
    const porNombre = candidatos.filter((c) => normalizarTexto(c.nombre) && glosa.includes(normalizarTexto(c.nombre)));
    if (porNombre.length === 1) return porNombre[0];
  }
  return null;
}
