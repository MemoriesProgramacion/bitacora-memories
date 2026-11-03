// Sección de mi bodega, de solo consulta: muestra el inventario y los traslados de la bodega municipal asignada
// a la cuenta, o de todas las bodegas si tiene acceso total. Las bodegas, facturas y traslados se gestionan
// desde el inventario.
import { useEffect, useState } from 'react';
import { EncabezadoSeccion, Card, Aviso, Spinner } from '../components/UI';
import { fetchApi } from '../lib/api';
import { API_BASE } from '../lib/config';

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// Pide las bodegas de la cuenta y muestra su inventario y traslados.
export default function MiBodega({ session }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    fetchApi(`${API_BASE}/mi-bodega`, { token: session?.token })
      .then((r) => { if (vivo) setDatos(r.bodegas); })
      .catch((e) => { if (vivo) setError(e.publicMsg || 'No se pudo cargar la bodega.'); });
    return () => { vivo = false; };
  }, [session?.token]);

  return (
    <>
      <EncabezadoSeccion titulo="Mi bodega" subtitulo="Inventario y traslados de la bodega municipal asignada" />
      {error && <Aviso tono="bad">{error}</Aviso>}
      {!datos && !error && <Spinner texto="Cargando bodega…" />}
      {datos && !datos.length && (
        <Aviso>
          Todavía no tienes una bodega municipal asignada. El Profesional alianzas y conexión de mercados la asigna desde
          Inventario → Bodegas.
        </Aviso>
      )}
      {(datos || []).map((b) => (
        <Card key={b.id} className="mb-5 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-bold text-marino">{b.nombre}</h3>
            <span className="text-xs text-gris">
              {b.tipo === 'principal' ? 'Bodega principal' : `Bodega municipal${b.principal ? ` · de ${b.principal}` : ''}`}
              {b.municipio ? ` · ${b.municipio}` : ''}
            </span>
          </div>

          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
            Inventario ({fmt(b.existencias.reduce((s, e) => s + e.cantidad, 0))} unidades)
          </h4>
          {b.existencias.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="text-gris"><th className="py-1.5 pr-3">Artículo</th><th className="py-1.5 pr-3">SKU</th><th className="py-1.5 text-right">Cantidad</th></tr></thead>
                <tbody>
                  {b.existencias.map((e) => (
                    <tr key={e.articulo_id} className="border-t border-borde">
                      <td className="py-1.5 pr-3">{e.nombre}</td><td className="py-1.5 pr-3">{e.sku || '—'}</td>
                      <td className="py-1.5 text-right font-semibold">{fmt(e.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-[13px] text-gris">Esta bodega todavía no tiene existencias.</p>}

          <h4 className="mb-1.5 mt-5 text-[11px] font-bold uppercase tracking-wide text-gris">Traslados</h4>
          {b.traslados.length ? (
            <ul className="grid gap-2">
              {b.traslados.map((t) => (
                <li key={t.id} className="rounded-lg border border-borde px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{t.origen} → {t.destino}</strong><span className="text-gris">{fecha(t.fecha)}</span>
                  </div>
                  <div>{(t.items || []).map((i) => `${fmt(i.cantidad)} × ${i.nombre}`).join(', ')}</div>
                  {t.nota && <div className="text-gris">Nota: {t.nota}</div>}
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-gris">Sin traslados registrados.</p>}
        </Card>
      ))}
    </>
  );
}
