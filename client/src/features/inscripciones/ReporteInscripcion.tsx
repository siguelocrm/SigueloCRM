import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import { Boton, Tarjeta } from '../../components/ui';
import { claseCampo, estiloCampo } from '../seguimiento/estilos';
import { formatoMonto, type CampoPersonalizado, type Curso } from './tipos';

type Fila = { id: string; curso_id: string | null; telefono: string; estado: string; monto: number | null; transaccion: string | null; datos: Record<string, string>; creado_en: string; contactos: { nombre: string | null } | null };

// Inscritos y montos por curso, por mes. Se puede bajar en CSV (abre en Excel).
export default function ReporteInscripcion({ cursos, zona }: { cursos: Curso[]; zona: string }) {
  const mesActual = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit' }).format(new Date());
  const [mes, setMes] = useState(mesActual);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [campos, setCampos] = useState<CampoPersonalizado[]>([]);

  useEffect(() => {
    supabase.from('campos_personalizados').select('id, nombre, tipo').returns<CampoPersonalizado[]>().then(({ data }) => setCampos(data || []));
  }, []);

  useEffect(() => {
    const [y, m] = mes.split('-').map(Number);
    // Un día de margen a cada lado; el mes exacto se filtra en la zona del negocio.
    const desde = new Date(Date.UTC(y, m - 1, 1) - 86400000).toISOString();
    const hasta = new Date(Date.UTC(y, m, 1) + 86400000).toISOString();
    supabase
      .from('siguelo_pagos')
      .select('id, curso_id, telefono, estado, monto, transaccion, datos, creado_en, contactos(nombre)')
      .in('estado', ['datos', 'inscrito', 'revisar'])
      .gte('creado_en', desde)
      .lt('creado_en', hasta)
      .order('creado_en')
      .returns<Fila[]>()
      .then(({ data }) => setFilas((data || []).filter((f) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit' }).format(new Date(f.creado_en)) === mes)));
  }, [mes, zona]);

  const pagados = filas.filter((f) => f.estado !== 'revisar');
  const porCurso = useMemo(
    () =>
      cursos
        .map((k) => {
          const de = pagados.filter((f) => f.curso_id === k.id);
          return { k, inscritos: de.length, total: de.reduce((s, f) => s + Number(f.monto || 0), 0), revisar: filas.filter((f) => f.curso_id === k.id && f.estado === 'revisar').length };
        })
        .filter((x) => x.inscritos || x.revisar),
    [cursos, filas, pagados],
  );
  const nombreCampo = (id: string) => (id === 'nombre' ? 'Nombre completo' : campos.find((c) => c.id === id)?.nombre || 'Dato');
  const fecha = (iso: string) => new Intl.DateTimeFormat('es', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

  const bajarCSV = () => {
    const ids = [...new Set(pagados.flatMap((f) => Object.keys(f.datos || {})))];
    const celda = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [
      ['Fecha', 'Curso', 'Nombre', 'Teléfono', 'Monto', 'Transacción', 'Estado', ...ids.map(nombreCampo)].map(celda).join(';'),
      ...pagados.map((f) =>
        [fecha(f.creado_en), cursos.find((k) => k.id === f.curso_id)?.nombre ?? '', f.contactos?.nombre ?? '', `+${f.telefono.split('@')[0]}`, f.monto ?? '', f.transaccion ?? '', f.estado === 'inscrito' ? 'Inscrito' : 'Faltan datos', ...ids.map((id) => f.datos?.[id])]
          .map(celda)
          .join(';'),
      ),
    ];
    const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscritos-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} aria-label="Mes" className={claseCampo} style={estiloCampo} />
        <Boton tamano="sm" icono={Download} onClick={bajarCSV} disabled={!pagados.length}>Bajar en Excel (CSV)</Boton>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {porCurso.length === 0 && <span className="text-[13px]" style={{ color: TEXTO_TERCIARIO }}>No hay inscritos en este mes.</span>}
        {porCurso.map(({ k, inscritos, total, revisar }) => (
          <Tarjeta key={k.id} className="p-4 flex flex-col gap-1">
            <span className="text-[13px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{k.nombre}</span>
            <span className="text-[22px] font-bold num" style={{ color: TEXTO_PRIMARIO }}>{formatoMonto(total, k.moneda)}</span>
            <span className="text-[12.5px]" style={{ color: TEXTO_TERCIARIO }}>
              {inscritos} {inscritos === 1 ? 'inscrito' : 'inscritos'}{revisar ? ` · ${revisar} para revisar` : ''}
            </span>
          </Tarjeta>
        ))}
      </div>
      {pagados.length > 0 && (
        <Tarjeta className="overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ color: TEXTO_SECUNDARIO }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDE}` }}>
                {['Fecha', 'Nombre', 'Curso', 'Monto', 'Estado'].map((t) => <th key={t} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {pagados.map((f) => (
                <tr key={f.id} style={{ borderBottom: `1px solid ${BORDE}` }}>
                  <td className="px-3 py-2 whitespace-nowrap">{fecha(f.creado_en)}</td>
                  <td className="px-3 py-2" style={{ color: TEXTO_PRIMARIO }}>{f.contactos?.nombre || `+${f.telefono.split('@')[0]}`}</td>
                  <td className="px-3 py-2">{cursos.find((k) => k.id === f.curso_id)?.nombre ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap num">{formatoMonto(f.monto, cursos.find((k) => k.id === f.curso_id)?.moneda || 'Bs')}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.estado === 'inscrito' ? 'Inscrito' : 'Faltan datos'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </div>
  );
}
