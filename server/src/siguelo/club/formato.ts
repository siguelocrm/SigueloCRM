// Formato de los datos del sistema del club (sin red ni base de datos): días,
// horarios, cupos y tarifas, y el texto que lee la IA.

export type SucursalClub = { id: string; nombre: string; departamento?: string | null; ubicacion?: string | null; whatsapp?: string | null };
// Un grupo: curso en una sucursal, con sus días (1 = lunes … 6 = sábado, 7 = domingo), horario y cupo.
export type GrupoClub = { grupo: string; curso: string; curso_id: string; dias: number[]; hora_inicio: string; hora_fin: string; cupo: string | null; quedan: number | null; descripcion?: string | null };
// precios[0] = 1 curso, precios[1] = 2 cursos…
export type TarifaClub = { id: string; nombre: string; dias: number[]; clases: number; precios: number[]; desde: string | null; hasta: string | null; promocion?: boolean };
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const textoDias = (dias: number[]) => [...dias].sort((a, b) => a - b).map((d) => DIAS[d === 0 ? 7 : d] || '?').join('/');
export const textoHorario = (g: Pick<GrupoClub, 'dias' | 'hora_inicio' | 'hora_fin'>) => `${textoDias(g.dias)} · ${g.hora_inicio} a ${g.hora_fin}`;
export const lleno = (g: GrupoClub) => g.cupo === 'lleno' || g.quedan === 0;
const textoCupo = (g: GrupoClub) => (lleno(g) ? 'LLENO' : g.quedan != null ? `quedan ${g.quedan} cupos` : 'hay cupo');
const fmt = (n: number) => `Bs ${Number(n).toLocaleString('es', { maximumFractionDigits: 2 })}`;

export const tarifaVigente = (t: TarifaClub, hoy: string) => (!t.desde || t.desde <= hoy) && (!t.hasta || t.hasta >= hoy);

export function textoParaIA(sucursal: string, grupos: GrupoClub[], tarifas: TarifaClub[], hoy: string): string {
  const porCurso = new Map<string, GrupoClub[]>();
  for (const g of grupos) porCurso.set(g.curso, [...(porCurso.get(g.curso) || []), g]);
  const cursos = [...porCurso.entries()].map(
    ([curso, gs]) => `- ${curso}: ${gs.sort((a, b) => textoDias(a.dias).localeCompare(textoDias(b.dias)) || a.hora_inicio.localeCompare(b.hora_inicio)).map((g) => `${textoHorario(g)} (${textoCupo(g)})`).join('; ')}`,
  );
  const precios = tarifas
    .filter((t) => tarifaVigente(t, hoy))
    .map((t) => `- ${t.nombre} — ${textoDias(t.dias)}, ${t.clases} clases al mes: ${t.precios.map((p, i) => `${i + 1} ${i ? 'cursos' : 'curso'} ${fmt(p)}`).join(' · ')}${t.promocion ? ' (promoción)' : ''}`);
  return `Sucursal ${sucursal}.
Cursos y horarios (días · horario · cupo):
${cursos.join('\n') || '(sin grupos activos)'}
Mensualidades vigentes:
${precios.join('\n') || '(sin tarifas cargadas)'}`;
}
