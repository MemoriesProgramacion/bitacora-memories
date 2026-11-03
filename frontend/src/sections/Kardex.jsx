// Sección de kardex, de solo consulta: cómo se mueve la mercancía, que entra con una factura de compra, se
// traslada entre bodegas y se entrega a las unidades. Cada movimiento lleva su comprobante y el saldo de la
// bodega después de hacerlo. Tiene los movimientos con filtros y los saldos por bodega.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso, Spinner, Chip } from '../components/UI';
import { fetchApi } from '../lib/api';
import { API_BASE } from '../lib/config';

const TIPOS = [['', 'Todos los movimientos'], ['entrada', 'Entradas por factura'], ['traslado', 'Traslados'], ['entrega', 'Entregas a UP y de kits'],
  ['otros', 'Recepciones, kits y ajustes (sin ubicar)']];
const ETIQUETA = {
  entrada: 'Factura', traslado_salida: 'Traslado · sale', traslado_entrada: 'Traslado · entra', entrega_up: 'Entrega a UP',
  recepcion: 'Recepción', kit: 'Salida a kit', ajuste: 'Ajuste manual',
  entrega_kit: 'Entrega de kit',
};
const TONO = { entrada: 'ok', traslado_salida: 'warn', traslado_entrada: 'neutral', entrega_up: 'bad', entrega_kit: 'bad', recepcion: 'ok', kit: 'bad', ajuste: 'warn' };
const TIPO_BODEGA = { principal: 'Principal', municipal: 'Municipal', sin_ubicar: 'Sin ubicar' };
const VACIOS = { bodega: '', articulo: '', tipo: '', q: '', desde: '', hasta: '' };

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const pesos = (v) => (v === null || v === undefined ? '' : `$ ${Math.round(Number(v) || 0).toLocaleString('es-CO')}`);
const fechaHora = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const inputCls =
  'mt-1 w-full rounded-lg border border-borde bg-card px-3 py-2 text-[13px] font-normal normal-case tracking-normal text-texto outline-none focus:border-acento';
const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-gris';

// Muestra el recorrido de la mercancía para dejar claro qué comprobante es cada uno.
function Recorrido() {
  const paso = (n, titulo, texto) => (
    <div className="flex items-start gap-2 rounded-lg border border-borde px-3 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-marino text-[11px] font-bold text-acento">{n}</span>
      <div><div className="text-[13px] font-bold text-marino">{titulo}</div><div className="text-[12px] text-gris">{texto}</div></div>
    </div>
  );
  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-3">
      {paso(1, 'Factura de compra', 'La mercancía entra a una bodega principal.')}
      {paso(2, 'Traslado', 'Pasa de una bodega a otra, con su nota.')}
      {paso(3, 'Entrega a la UP', 'Sale de la bodega hacia la unidad productiva.')}
    </div>
  );
}

// Muestra la tabla de movimientos con filtros y los saldos por bodega.
export default function Kardex({ session }) {
  const token = session?.token;
  const [vista, setVista] = useState('movimientos');
  const [f, setF] = useState(VACIOS);
  const [qAplicada, setQAplicada] = useState('');
  const [datos, setDatos] = useState(null);
  const [saldos, setSaldos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQAplicada(f.q), 350);
    return () => clearTimeout(t);
  }, [f.q]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const params = { bodega: f.bodega, articulo: f.articulo, tipo: f.tipo, desde: f.desde, hasta: f.hasta, q: qAplicada };
      const [k, s] = await Promise.all([
        fetchApi(`${API_BASE}/kardex`, { token, params }),
        fetchApi(`${API_BASE}/kardex/saldos`, { token, params: { bodega: f.bodega, articulo: f.articulo, q: qAplicada } }),
      ]);
      setDatos(k);
      setSaldos(s);
    } catch (e) {
      setError(e.publicMsg || 'No se pudo cargar el Kardex.');
    } finally {
      setCargando(false);
    }
  }, [token, f.bodega, f.articulo, f.tipo, f.desde, f.hasta, qAplicada]);
  useEffect(() => { cargar(); }, [cargar]);

  const poner = (campo) => (e) => setF({ ...f, [campo]: e.target.value });
  const hayFiltros = Object.values(f).some(Boolean);
  const porBodega = useMemo(() => {
    const grupos = new Map();
    for (const s of saldos?.saldos || []) {
      const clave = s.bodega_id ?? 'sin';
      if (!grupos.has(clave)) grupos.set(clave, { id: clave, nombre: s.bodega, tipo: s.tipo, filas: [] });
      grupos.get(clave).filas.push(s);
    }
    return [...grupos.values()];
  }, [saldos]);

  return (
    <>
      <EncabezadoSeccion titulo="Kardex" subtitulo="Cómo se mueve la mercancía: factura de compra, traslados y entregas a las UP, con el saldo de cada bodega" />
      <Recorrido />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelCls}>Bodega
            <select value={f.bodega} onChange={poner('bodega')} className={inputCls}>
              <option value="">Todas las bodegas</option>
              {(datos?.bodegas || []).map((b) => <option key={b.id} value={b.id}>{b.nombre}{b.tipo === 'municipal' ? ' (municipal)' : ''}</option>)}
              {datos?.con_sin_ubicar && <option value="sin">Sin ubicar (aún no está en una bodega)</option>}
            </select>
          </label>
          <label className={labelCls}>Artículo
            <select value={f.articulo} onChange={poner('articulo')} className={inputCls}>
              <option value="">Todos los artículos</option>
              {(datos?.articulos || []).map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.sku ? ` · ${a.sku}` : ''}</option>)}
            </select>
          </label>
          <label className={labelCls}>Tipo de movimiento
            <select value={f.tipo} onChange={poner('tipo')} className={inputCls}>
              {TIPOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label className={labelCls}>Buscar
            <input type="search" value={f.q} onChange={poner('q')} placeholder="Comprobante, artículo, SKU, UP…" className={inputCls} />
          </label>
          <label className={labelCls}>Desde
            <input type="date" value={f.desde} max={f.hasta || undefined} onChange={poner('desde')} className={inputCls} />
          </label>
          <label className={labelCls}>Hasta
            <input type="date" value={f.hasta} min={f.desde || undefined} onChange={poner('hasta')} className={inputCls} />
          </label>
          <div className="flex items-end sm:col-span-2">
            <Btn variant="secondary" disabled={!hayFiltros} onClick={() => { setF(VACIOS); setQAplicada(''); }}>Limpiar filtros</Btn>
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Vistas del Kardex" className="mb-3 flex gap-1 border-b border-borde">
        {[['movimientos', 'Movimientos'], ['saldos', 'Saldos por bodega']].map(([id, nombre]) => (
          <button key={id} type="button" role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-semibold transition ${vista === id ? 'border-marino text-marino' : 'border-transparent text-gris hover:text-marino'}`}>
            {nombre}
          </button>
        ))}
      </div>

      {error && <Aviso tono="bad">{error}</Aviso>}
      {cargando && !datos && <Spinner texto="Cargando el Kardex…" />}
      {datos && !datos.bodegas.length && (
        <Aviso>No tienes bodegas para consultar todavía. El Profesional alianzas y conexión de mercados te asigna una bodega municipal desde Inventario → Bodegas.</Aviso>
      )}

      {datos && vista === 'movimientos' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Chip>{fmt(datos.resumen.movimientos)} movimientos</Chip>
            <Chip tono="ok">{fmt(datos.resumen.entradas)} unidades entran</Chip>
            <Chip tono="bad">{fmt(datos.resumen.salidas)} unidades salen</Chip>
            <Chip>Valor entra {pesos(datos.resumen.valor_entradas)}</Chip>
            <Chip>Valor sale {pesos(datos.resumen.valor_salidas)}</Chip>
            {cargando && <Chip>Actualizando…</Chip>}
          </div>
          {datos.truncado && <Aviso>Se muestran los 500 movimientos más recientes. Usa los filtros para acotar.</Aviso>}
          {!datos.movimientos.length && datos.bodegas.length > 0 && (
            <Card className="p-8 text-center text-[13px] text-gris">No hay movimientos con esos filtros.</Card>
          )}
          {datos.movimientos.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
                {datos.movimientos.map((m, i) => (
                  <Card key={`${m.comprobante}-${m.articulo_id}-${m.bodega_id}-${i}`} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Chip tono={TONO[m.tipo]}>{ETIQUETA[m.tipo]}</Chip>
                      <span className="text-xs text-gris">{fechaHora(m.fecha)}</span>
                    </div>
                    <div className="mt-2 font-bold text-marino">{m.articulo}</div>
                    <div className="text-xs text-gris">{m.sku || 'Sin SKU'} · {m.bodega} · {m.comprobante}</div>
                    {m.detalle && <div className="mt-1 text-[12px] text-gris">{m.detalle}</div>}
                    <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-[13px]">
                      <span className={m.cantidad > 0 ? 'font-semibold text-verde-ok' : 'font-semibold text-rojo'}>{m.cantidad > 0 ? '+' : ''}{fmt(m.cantidad)}</span>
                      <span className="text-gris">{pesos(m.valor)}</span>
                      <span>Saldo: <strong>{fmt(m.saldo)}</strong></span>
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-borde bg-bg text-[11px] font-bold uppercase tracking-wide text-gris">
                      <th className="px-3 py-2.5">Fecha</th><th className="px-3 py-2.5">Comprobante</th><th className="px-3 py-2.5">Tipo</th>
                      <th className="px-3 py-2.5">Bodega</th><th className="px-3 py-2.5">Artículo</th><th className="px-3 py-2.5">Detalle</th>
                      <th className="px-3 py-2.5 text-right">V. unit.</th><th className="px-3 py-2.5 text-right">Entra</th>
                      <th className="px-3 py-2.5 text-right">Sale</th><th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.movimientos.map((m, i) => (
                      <tr key={`${m.comprobante}-${m.articulo_id}-${m.bodega_id}-${i}`} className="border-b border-borde align-top last:border-0 hover:bg-bg/60">
                        <td className="whitespace-nowrap px-3 py-2.5 text-gris">{fechaHora(m.fecha)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-marino">{m.comprobante}</td>
                        <td className="px-3 py-2.5"><Chip tono={TONO[m.tipo]}>{ETIQUETA[m.tipo]}</Chip></td>
                        <td className="px-3 py-2.5">{m.bodega}</td>
                        <td className="px-3 py-2.5"><div className="font-semibold">{m.articulo}</div><div className="text-[11px] text-gris">{m.sku || 'Sin SKU'}</div></td>
                        <td className="max-w-[260px] px-3 py-2.5 text-gris">{m.detalle || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-gris">{pesos(m.valor_unitario) || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-verde-ok">{m.cantidad > 0 ? fmt(m.cantidad) : ''}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-rojo">{m.cantidad < 0 ? fmt(-m.cantidad) : ''}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{fmt(m.saldo)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-gris">{pesos(m.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}

      {datos && vista === 'saldos' && saldos && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Chip>{fmt(saldos.unidades)} unidades</Chip>
            <Chip tono="ok">Valor {pesos(saldos.valor)}</Chip>
            <Chip>{porBodega.length} {porBodega.length === 1 ? 'bodega con existencias' : 'bodegas con existencias'}</Chip>
          </div>
          {!porBodega.length && <Card className="p-8 text-center text-[13px] text-gris">No hay existencias en las bodegas con esos filtros.</Card>}
          {porBodega.map((b) => (
            <Card key={b.id} className="mb-4 p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-bold text-marino">{b.nombre} <span className="text-xs font-normal text-gris">{TIPO_BODEGA[b.tipo]}</span></h3>
                <span className="text-[13px] text-gris">{fmt(b.filas.reduce((s, x) => s + x.saldo, 0))} unidades · {pesos(b.filas.reduce((s, x) => s + Number(x.valor || 0), 0))} · {b.filas.length} artículos</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="text-[11px] font-bold uppercase tracking-wide text-gris"><th className="py-1.5 pr-3">Artículo</th><th className="py-1.5 pr-3">SKU</th><th className="py-1.5 pr-3">Último movimiento</th><th className="py-1.5 pr-3 text-right">Costo prom.</th><th className="py-1.5 pr-3 text-right">Saldo</th><th className="py-1.5 text-right">Valor</th></tr></thead>
                  <tbody>
                    {b.filas.map((s) => (
                      <tr key={s.articulo_id} className="border-t border-borde">
                        <td className="py-2 pr-3 font-semibold">{s.articulo}</td><td className="py-2 pr-3">{s.sku || '—'}</td>
                        <td className="py-2 pr-3 text-gris">{fechaHora(s.ultimo_movimiento)}</td><td className="py-2 pr-3 text-right text-gris">{pesos(s.costo_promedio) || '—'}</td>
                        <td className="py-2 pr-3 text-right font-bold">{fmt(s.saldo)}</td><td className="py-2 text-right text-gris">{pesos(s.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
