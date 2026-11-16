import { useCallback, useEffect, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { llamarBackend } from '../../lib/backend';
import { Boton, EncabezadoPagina, EstadoVacio, Tarjeta } from '../../components/ui';
import { BORDE, TEXTO_PRIMARIO, TEXTO_SECUNDARIO, TEXTO_TERCIARIO } from '../../lib/tema';
import Etiqueta from '../seguimiento/Etiqueta';
import Acceso from './Acceso';
import Cuentas from './Cuentas';
import FormVenta from './FormVenta';
import Planes from './Planes';
import { fecha, monto, type DatosAgencia } from './comun';

// Agencia (SígueloCRM): tus ventas, tus planes y las cuentas del CRM que das a tus clientes.
// Solo la ve el dueño principal de tus cuentas de agencia; los clientes nunca.

type Pestana = 'ventas' | 'cuentas' | 'planes';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const claveMes = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
};

export default function Agencia() {
  const [datos, setDatos] = useState<DatosAgencia | null>(null);
  const [error, setError] = useState('');
  const [pestana, setPestana] = useState<Pestana>('ventas');
  const [vendiendo, setVendiendo] = useState(false);
  const [acceso, setAcceso] = useState<{ nombre: string; usuario: string; contrasena: string } | null>(null);

  const cargar = useCallback(async () => {
    const r = await llamarBackend('/siguelo/agencia', null, 'GET').catch(() => ({ ok: false, data: null, error: 'No se pudo conectar con el servidor del CRM.' }));
    if (!r.ok) return setError(r.error || 'No se pudo cargar.');
    setError('');
    setDatos({ planes: r.data.planes || [], cuentas: r.data.cuentas || [], ventas: r.data.ventas || [] });
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const ventas = datos?.ventas ?? [];
  const ahora = new Date();
  const esteMes = claveMes(ahora.toISOString());
  const mesPasado = claveMes(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15).toISOString());
  const totalMes = (clave: string) => ventas.filter((v) => claveMes(v.fecha) === clave).reduce((s, v) => s + Number(v.monto || 0), 0);
  const clientes = (datos?.cuentas ?? []).filter((c) => !c.propia);
  const activas = clientes.filter((c) => c.estado === 'activa');
  const porVencer = activas.filter((c) => c.vence_en && new Date(c.vence_en).getTime() - Date.now() < 7 * 86400000);
  const moneda = ventas[0]?.moneda ?? 'Bs';
  // Los últimos 6 meses, del más viejo al de ahora.
  const meses = Array.from({ length: 6 }, (_, i) => new Date(ahora.getFullYear(), ahora.getMonth() - 5 + i, 15));
  const maxMes = Math.max(1, ...meses.map((m) => totalMes(claveMes(m.toISOString()))));

  const tiles = [
    { titulo: 'Vendiste este mes', valor: monto(totalMes(esteMes), moneda), nota: `${monto(totalMes(mesPasado), moneda)} el mes pasado` },
    { titulo: 'Ventas este mes', valor: String(ventas.filter((v) => claveMes(v.fecha) === esteMes).length), nota: `${ventas.length} en total` },
    { titulo: 'Clientes con CRM activo', valor: String(activas.length), nota: `${clientes.length - activas.length} vencidas o en pausa` },
    { titulo: 'Vencen en 7 días', valor: String(porVencer.length), nota: porVencer.length ? porVencer.map((c) => c.nombre).slice(0, 2).join(', ') : 'Ninguna por ahora', alerta: porVencer.length > 0 },
  ];

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <EncabezadoPagina
        titulo="Agencia"
        subtitulo="Tus ventas, tus planes y los accesos al CRM de tus clientes. Cada cliente tiene su cuenta aparte: no ve nada tuyo ni de otros."
        accion={<Boton variante="primario" icono={Plus} onClick={() => { setPestana('ventas'); setVendiendo(true); }} disabled={!datos}>Registrar venta</Boton>}
      />
      {error && (
        <Tarjeta className="p-4 text-[13px]" style={{ color: TEXTO_SECUNDARIO }}>
          {error}
        </Tarjeta>
      )}
      {datos && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {tiles.map((t) => (
              <Tarjeta key={t.titulo} className="p-3.5 flex flex-col gap-0.5">
                <span className="text-[12px] font-semibold" style={{ color: TEXTO_SECUNDARIO }}>{t.titulo}</span>
                <span className="num text-[22px] font-bold" style={{ color: t.alerta ? 'var(--warn)' : TEXTO_PRIMARIO }}>{t.valor}</span>
                <span className="text-[11.5px] truncate" style={{ color: TEXTO_TERCIARIO }}>{t.nota}</span>
              </Tarjeta>
            ))}
          </div>

          <div role="tablist" className="flex gap-1 overflow-x-auto shrink-0" style={{ borderBottom: `1px solid ${BORDE}` }}>
            {([['ventas', 'Ventas'], ['cuentas', `Cuentas (${datos.cuentas.length})`], ['planes', `Planes (${datos.planes.filter((p) => p.activo).length})`]] as const).map(([id, texto]) => (
              <button key={id} role="tab" aria-selected={pestana === id} onClick={() => setPestana(id)} className="px-3 py-2 text-[13px] whitespace-nowrap -mb-px" style={{ color: pestana === id ? 'var(--accent)' : TEXTO_SECUNDARIO, fontWeight: pestana === id ? 600 : 500, borderBottom: `2px solid ${pestana === id ? 'var(--accent)' : 'transparent'}` }}>
                {texto}
              </button>
            ))}
          </div>

          {pestana === 'ventas' && (
            <div className="flex flex-col gap-3">
              {acceso && <Acceso {...acceso} onCerrar={() => setAcceso(null)} />}
              {vendiendo && (
                <FormVenta
                  planes={datos.planes}
                  cuentas={datos.cuentas}
                  onCerrar={() => setVendiendo(false)}
                  onGuardada={(a) => { setVendiendo(false); setAcceso(a); cargar(); }}
                />
              )}
              {!datos.planes.length && !vendiendo && (
                <Tarjeta className="p-4 text-[13px] flex flex-wrap items-center gap-2" style={{ color: TEXTO_SECUNDARIO }}>
                  <span className="flex-1 min-w-[200px]">Primero crea tus planes (qué incluye cada uno y si trae el CRM de WhatsApp). También puedes registrar una venta "sin plan".</span>
                  <Boton tamano="sm" onClick={() => setPestana('planes')}>Ir a Planes</Boton>
                </Tarjeta>
              )}
              {ventas.length > 0 && (
                <Tarjeta className="p-4 flex flex-col gap-2">
                  <span className="text-[13px] font-bold" style={{ color: TEXTO_PRIMARIO }}>Lo que vendiste por mes</span>
                  <div className="flex items-end gap-2" style={{ height: 96 }}>
                    {meses.map((m) => {
                      const total = totalMes(claveMes(m.toISOString()));
                      return (
                        <div key={m.toISOString()} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${MESES[m.getMonth()]}: ${monto(total, moneda)}`}>
                          <span className="num text-[10.5px]" style={{ color: TEXTO_TERCIARIO }}>{total ? Math.round(total).toLocaleString('es-BO') : ''}</span>
                          <span className="w-full rounded-t-md" style={{ height: `${Math.max(2, (total / maxMes) * 60)}px`, backgroundColor: claveMes(m.toISOString()) === esteMes ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 35%, transparent)' }} />
                          <span className="text-[11px]" style={{ color: TEXTO_SECUNDARIO }}>{MESES[m.getMonth()]}</span>
                        </div>
                      );
                    })}
                  </div>
                </Tarjeta>
              )}
              {!ventas.length && !vendiendo && datos.planes.length > 0 && (
                <Tarjeta className="flex">
                  <EstadoVacio icono={Receipt} titulo="Todavía no registraste ventas" texto="Cada vez que un cliente te paga, regístralo aquí: queda tu ingreso del mes y, si el plan trae el CRM, se crea su acceso." accion={<Boton variante="primario" icono={Plus} onClick={() => setVendiendo(true)}>Registrar venta</Boton>} />
                </Tarjeta>
              )}
              {ventas.length > 0 && (
                <Tarjeta className="flex flex-col">
                  {ventas.map((v) => {
                    const cuenta = datos.cuentas.find((c) => c.empresa_id === v.cuenta_id);
                    return (
                      <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDE}` }}>
                        <span className="flex flex-col min-w-0 flex-1">
                          <span className="text-[13.5px] font-semibold truncate" style={{ color: TEXTO_PRIMARIO }}>{v.cliente}</span>
                          <span className="text-[12px] truncate" style={{ color: TEXTO_TERCIARIO }}>
                            {fecha(v.fecha)} · {v.plan_nombre || 'Sin plan'}
                            {v.hasta && ` · hasta el ${fecha(v.hasta)}`}
                            {v.telefono && ` · +${v.telefono}`}
                            {v.notas && ` · ${v.notas}`}
                          </span>
                        </span>
                        {cuenta && <Etiqueta color="var(--accent)">CRM: {cuenta.usuario}</Etiqueta>}
                        <span className="num text-[14px] font-bold shrink-0" style={{ color: TEXTO_PRIMARIO }}>{monto(v.monto, v.moneda)}</span>
                      </div>
                    );
                  })}
                </Tarjeta>
              )}
            </div>
          )}
          {pestana === 'cuentas' && <Cuentas cuentas={datos.cuentas} planes={datos.planes} onCambio={cargar} />}
          {pestana === 'planes' && <Planes planes={datos.planes} onCambio={cargar} />}
        </>
      )}
    </div>
  );
}
