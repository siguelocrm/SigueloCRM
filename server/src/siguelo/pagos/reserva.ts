import { tarifaVigente, textoHorario, type GrupoClub, type TarifaClub } from '../club/formato.js';
import type { DatosClub } from '../tipos.js';

// Arma la "reserva de vendedor" del sistema del club, igual que el panel de
// vendedores (vendedor_reservar): tutor, niños y sus cursos, total sugerido
// según las tarifas, lo pagado por QR y la foto. Sin base de datos ni red.

export const vacioClub = (): DatosClub => ({ tutor: null, estudiantes: [] });

const fechaValida = (f: string | null | undefined) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`));

// Junta lo nuevo con lo que ya se tenía (lo nuevo manda; lo vacío no borra).
export function mezclarDatosClub(antes: DatosClub | null | undefined, nuevo: Partial<DatosClub>): DatosClub {
  const a = antes ?? vacioClub();
  const lista = Array.isArray(nuevo.estudiantes) ? nuevo.estudiantes : [];
  const n = Math.max(a.estudiantes.length, lista.length);
  const estudiantes = Array.from({ length: n }, (_, i) => {
    const viejo = a.estudiantes[i] ?? { nombre: null, fecha_nacimiento: null, grupo: null };
    const x = lista[i] ?? {};
    return {
      nombre: (x.nombre && String(x.nombre).trim().replace(/\s+/g, ' ')) || viejo.nombre,
      fecha_nacimiento: fechaValida(x.fecha_nacimiento) ? x.fecha_nacimiento! : viejo.fecha_nacimiento,
      grupo: x.grupo || viejo.grupo,
    };
  });
  return { tutor: (nuevo.tutor && String(nuevo.tutor).trim()) || a.tutor, estudiantes };
}

// Lo que falta pedirle, en palabras para el cliente.
export function faltanClub(d: DatosClub | null | undefined): string[] {
  const x = d ?? vacioClub();
  const faltan: string[] = [];
  if (!x.tutor) faltan.push('Nombre del papá, mamá o tutor');
  if (!x.estudiantes.length) return [...faltan, 'Nombre completo del niño o niña', 'Su fecha de nacimiento', 'Curso y horario que elige'];
  x.estudiantes.forEach((e, i) => {
    const de = e.nombre ? ` de ${e.nombre.split(' ')[0]}` : x.estudiantes.length > 1 ? ` del niño/a ${i + 1}` : ' del niño o niña';
    if (!e.nombre) faltan.push(`Nombre completo${x.estudiantes.length > 1 ? ` del niño/a ${i + 1}` : ' del niño o niña'}`);
    if (!e.fecha_nacimiento) faltan.push(`Fecha de nacimiento${de}`);
    if (!e.grupo) faltan.push(`Curso y horario${de}`);
  });
  return faltan;
}

// 59170000001 → 70000001 (como guarda los celulares tu sistema).
export function celularLocal(telefono: string): string {
  const d = telefono.split('@')[0].replace(/\D/g, '');
  return d.length === 11 && d.startsWith('591') ? d.slice(3) : d;
}

export function edad(fechaNacimiento: string, hoy: string): number {
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  const [ha, hm, hd] = hoy.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

// Primer día de clase desde hoy (dias: 1 = lunes … 7 = domingo).
export function fechaInicio(dias: number[], hoy: string): string {
  const t = Date.parse(`${hoy}T12:00:00Z`);
  for (let i = 0; i < 14; i++) {
    const f = new Date(t + i * 86400000);
    const iso = f.getUTCDay() || 7;
    if (dias.includes(iso) || (iso === 7 && dias.includes(0))) return f.toISOString().slice(0, 10);
  }
  return hoy;
}

const mismosDias = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// Total sugerido: los cursos (de todos los hermanos) con los mismos días se cobran juntos con su tarifa
// (1 curso, 2 cursos, 3 cursos…). Es una sugerencia: al registrar la reserva, tu sistema lo vuelve a calcular.
export function totalSugerido(grupos: GrupoClub[], tarifas: TarifaClub[], hoy: string): { total: number; sinPrecio: boolean } {
  const vigentes = tarifas.filter((t) => tarifaVigente(t, hoy) && t.precios?.length);
  const porTarifa = new Map<string, { t: TarifaClub; n: number }>();
  let sinPrecio = false;
  for (const g of grupos) {
    const t = vigentes.filter((x) => mismosDias(x.dias, g.dias)).sort((a, b) => Number(!!a.promocion) - Number(!!b.promocion))[0];
    if (!t) {
      sinPrecio = true;
      continue;
    }
    const k = porTarifa.get(t.id) ?? { t, n: 0 };
    k.n++;
    porTarifa.set(t.id, k);
  }
  let total = 0;
  for (const { t, n } of porTarifa.values()) {
    const p = t.precios.map(Number);
    total += n <= p.length ? p[n - 1] : p[p.length - 1] + (n - p.length) * p[0];
  }
  return { total: Math.round(total * 100) / 100, sinPrecio };
}

export type ReservaClub = {
  id: string;
  branch_id: string;
  tipo: 'inscripcion';
  total_sugerido: number;
  pago_qr: number;
  foto_qr: string | null;
  nota: string | null;
  datos: {
    tutor: { nombre: string; celular: string; celular2: string | null };
    estudiantes: {
      clave: string;
      nombre: string;
      fecha_nacimiento: string;
      edad: number;
      direccion: null;
      cursos: { group_id: string; course_id: string; curso: string; horario: string; fecha_inicio: string; meses: number; precio: number | null }[];
    }[];
  };
};

export function armarReserva(p: {
  id: string;
  sucursal: string;
  datos: DatosClub;
  grupos: GrupoClub[]; // los de la sucursal
  tarifas: TarifaClub[];
  telefono: string;
  pagoQr: number;
  foto: string | null;
  nota: string | null;
  hoy: string;
  claves: () => string;
}): ReservaClub {
  const grupoDe = new Map(p.grupos.map((g) => [g.grupo, g]));
  const elegidos = p.datos.estudiantes.map((e) => grupoDe.get(e.grupo ?? '')).filter((g): g is GrupoClub => !!g);
  const { total } = totalSugerido(elegidos, p.tarifas, p.hoy);
  return {
    id: p.id,
    branch_id: p.sucursal,
    tipo: 'inscripcion',
    total_sugerido: total,
    // Como en el panel de vendedores: lo pagado por QR no puede pasar el total (y sin foto no se registra como QR).
    pago_qr: p.foto ? Math.min(p.pagoQr, total || p.pagoQr) : 0,
    foto_qr: p.foto,
    nota: p.nota,
    datos: {
      tutor: { nombre: p.datos.tutor ?? '', celular: celularLocal(p.telefono), celular2: null },
      estudiantes: p.datos.estudiantes.map((e) => {
        const g = grupoDe.get(e.grupo ?? '')!;
        return {
          clave: p.claves(),
          nombre: e.nombre ?? '',
          fecha_nacimiento: e.fecha_nacimiento ?? '',
          edad: e.fecha_nacimiento ? edad(e.fecha_nacimiento, p.hoy) : 0,
          direccion: null,
          cursos: [{ group_id: g.grupo, course_id: g.curso_id, curso: g.curso, horario: textoHorario(g), fecha_inicio: fechaInicio(g.dias, p.hoy), meses: 1, precio: null }],
        };
      }),
    },
  };
}
