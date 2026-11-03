// Saldos de productos por bodega, de solo consulta: una tabla de productos contra bodegas con las unidades que
// hay hoy en cada una. El servidor decide qué bodegas se ven según el tipo de cuenta, incluido lo que aún está
// sin ubicar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso, Spinner, Chip } from '../components/UI';

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const TIPO = { principal: 'Principal', municipal: 'Municipal', sin_ubicar: 'Aún sin bodega' };

const inputCls =
  'mt-1 w-full rounded-lg border border-borde bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal text-texto outline-none focus:border-acento';
const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-gris';

// Pide los saldos y muestra la tabla con sus filtros.
export default function SaldosBodegas({ cargar }) {
  const [bodega, setBodega] = useState('');
  const [q, setQ] = useState('');
  const [qAplicada, setQAplicada] = useState('');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQAplicada(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const traer = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setDatos(await cargar({ bodega, q: qAplicada }));
    } catch (e) {
      setError(e.publicMsg || e.message || 'No se pudieron cargar los saldos.');
    } finally {
      setCargando(false);
    }
  }, [cargar, bodega, qAplicada]);
  useEffect(() => { traer(); }, [traer]);

  const hayFiltros = Boolean(bodega || q);
  const columnas = datos?.bodegas || [];
  const porColumna = useMemo(() => Object.fromEntries(columnas.map((b) => [String(b.id), b.unidades])), [columnas]);

  return (
    <>
      <EncabezadoSeccion titulo="Saldos por bodega" subtitulo="Cuántas unidades de cada producto hay hoy en cada bodega" />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <label className={labelCls}>Bodega
            <select value={bodega} onChange={(e) => setBodega(e.target.value)} className={inputCls}>
              <option value="">{datos?.todas ? 'Todas las bodegas' : 'Todas las bodegas de mi región'}</option>
              {(datos?.opciones || []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </label>
          <label className={labelCls}>Buscar producto
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o SKU…" className={inputCls} />
          </label>
          <Btn variant="secondary" disabled={!hayFiltros} onClick={() => { setBodega(''); setQ(''); setQAplicada(''); }}>Limpiar filtros</Btn>
        </div>
      </Card>

      {error && <Aviso tono="bad">{error}</Aviso>}
      {cargando && !datos && <Spinner texto="Cargando saldos…" />}
      {datos && !datos.opciones.length && (
        <Aviso>
          {datos.todas ? 'Todavía no hay bodegas creadas.' : 'No hay bodegas de tu región todavía. Las crea el Profesional alianzas y conexión de mercados y les asigna la región.'}
        </Aviso>
      )}

      {datos && datos.opciones.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Chip>{fmt(datos.unidades)} unidades</Chip>
            <Chip>{datos.productos.length} {datos.productos.length === 1 ? 'producto' : 'productos'}</Chip>
            <Chip>{columnas.length} {columnas.length === 1 ? 'bodega' : 'bodegas'}</Chip>
            {cargando && <Chip>Actualizando…</Chip>}
          </div>

          {!datos.productos.length && <Card className="p-8 text-center text-[13px] text-gris">No hay productos con saldo con esos filtros.</Card>}

          {datos.productos.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
                {datos.productos.map((p) => (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="font-bold text-marino">{p.nombre}</div><div className="text-xs text-gris">{p.sku || 'Sin SKU'}</div></div>
                      <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-gris">Total</div><div className="text-lg font-bold">{fmt(p.total)}</div></div>
                    </div>
                    <ul className="mt-2 divide-y divide-borde text-[13px]">
                      {columnas.filter((b) => p.saldos[String(b.id)]).map((b) => (
                        <li key={b.id} className="flex justify-between gap-3 py-1.5"><span>{b.nombre}</span><strong>{fmt(p.saldos[String(b.id)])}</strong></li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>

              <Card className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-max text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-borde bg-bg align-bottom text-[11px] font-bold uppercase tracking-wide text-gris">
                      <th className="sticky left-0 z-10 bg-bg px-4 py-2.5">Producto</th>
                      {columnas.map((b) => (
                        <th key={b.id} className="min-w-[120px] px-3 py-2.5 text-right" title={b.nombre}>
                          <div className="normal-case tracking-normal text-texto">{b.nombre}</div>
                          <div className="font-normal normal-case tracking-normal">{TIPO[b.tipo]}{b.municipio ? ` · ${b.municipio}` : ''}</div>
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.productos.map((p) => (
                      <tr key={p.id} className="border-b border-borde hover:bg-bg/60">
                        <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
                          <div className="font-semibold text-marino">{p.nombre}</div><div className="text-[11px] text-gris">{p.sku || 'Sin SKU'}</div>
                        </td>
                        {columnas.map((b) => (
                          <td key={b.id} className="px-3 py-2.5 text-right">
                            {p.saldos[String(b.id)] ? <strong>{fmt(p.saldos[String(b.id)])}</strong> : <span className="text-gris">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right font-bold text-marino">{fmt(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-bg text-[13px] font-bold">
                      <td className="sticky left-0 z-10 bg-bg px-4 py-2.5">Total de unidades</td>
                      {columnas.map((b) => <td key={b.id} className="px-3 py-2.5 text-right">{fmt(porColumna[String(b.id)])}</td>)}
                      <td className="px-4 py-2.5 text-right text-marino">{fmt(datos.unidades)}</td>
                    </tr>
                  </tfoot>
                </table>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
