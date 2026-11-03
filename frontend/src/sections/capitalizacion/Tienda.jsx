// Tienda interna: el catálogo de productos para buscar y agregar y, al lado, el carrito de la iniciativa
// elegida. En el celular el carrito queda debajo y una barra fija lleva hasta él.
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PackagePlus, Search, ShoppingCart, Store } from 'lucide-react';
import { apiGeneral, pesos, qs } from '../../inventario/lib/api';
import {
  Boton, Cargando, Entrada, Insignia, Seleccion, Tarjeta, Vacio, useAvisos,
} from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import PanelCarrito from './PanelCarrito';
import { useCarrito } from './useCarrito';

// Muestra un producto con su precio y el botón para agregarlo.
function Producto({ p, enCarrito, puedeAgregar, motivo, ocupado, onAgregar }) {
  const [cantidad, setCantidad] = useState(1);
  const conIva = p.precio * (1 + p.iva / 100);
  const bloqueo = p.no_financiable ? 'Este producto no es financiable según el Anexo.' : null;
  return (
    <article className="flex flex-col justify-between gap-3 rounded-xl border border-borde bg-card p-4 shadow-tarjeta">
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {p.tipologia && <Insignia>{p.tipologia}</Insignia>}
          {enCarrito > 0 && <Insignia tono="ok">En el carrito: {enCarrito}</Insignia>}
          {bloqueo && <Insignia tono="error">No financiable</Insignia>}
        </div>
        <h3 className="text-[14px] font-semibold text-marca">{p.nombre}</h3>
        {p.descripcion && <p className="mt-1 line-clamp-2 text-[12px] text-gris-txt">{p.descripcion}</p>}
        <div className="mt-2 text-[11px] text-gris-txt">{[p.sector, p.proceso, p.tipo].filter(Boolean).join(' · ')}</div>
      </div>
      <div>
        <div className="cifras text-[18px] font-bold text-marca">{pesos(conIva)}</div>
        <div className="cifras text-[12px] text-gris-txt">{pesos(p.precio)} + {p.iva} % IVA</div>
        <div className="mt-2.5 flex items-center gap-2">
          <Entrada
            type="number" min="1" max="100000" inputMode="numeric"
            aria-label={`Cantidad de ${p.nombre}`}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
            className="w-20 shrink-0"
          />
          <Boton icono={PackagePlus} disabled={!puedeAgregar || ocupado || Boolean(bloqueo)} title={bloqueo || (puedeAgregar ? undefined : motivo)}
            onClick={() => onAgregar(p.id_producto, cantidad)} className="flex-1">
            Agregar
          </Boton>
        </div>
      </div>
    </article>
  );
}

// Muestra el buscador del catálogo y el carrito.
export default function Tienda({ filas, idUnico, onElegir }) {
  const { avisar } = useAvisos();
  const carrito = useCarrito(idUnico);
  const [q, setQ] = useState('');
  const [tipologia, setTipologia] = useState('');
  const [sector, setSector] = useState('');
  const [pagina, setPagina] = useState(1);
  const [catalogo, setCatalogo] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    const espera = setTimeout(async () => {
      setCargando(true);
      try {
        const r = await apiGeneral.get(`/catalogo${qs({ q, tipologia, sector, pagina })}`);
        if (vigente) setCatalogo(r);
      } catch (err) {
        if (vigente) avisar(err.message, 'error');
      } finally {
        if (vigente) setCargando(false);
      }
    }, q ? 300 : 0);
    return () => { vigente = false; clearTimeout(espera); };
  }, [q, tipologia, sector, pagina, avisar]);

  const filtrar = (poner) => (e) => { poner(e.target.value); setPagina(1); };

  const cantidades = useMemo(
    () => new Map((carrito.vista?.lineas || []).map((l) => [l.id_producto, l.cantidad])),
    [carrito.vista],
  );

  const puedeAgregar = Boolean(idUnico && carrito.vista?.carrito.puede_editar);
  const motivo = !idUnico
    ? 'Elige primero la iniciativa'
    : 'Este carrito no se puede modificar en su estado actual';
  const resumen = carrito.vista?.resumen;

  return (
    <div className="flex flex-col gap-5">
      <Tarjeta>
        <SelectorIniciativa filas={filas} valor={idUnico} onElegir={onElegir} etiqueta="Carrito de la iniciativa" />
      </Tarjeta>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Catálogo de productos">
          <div className="mb-4 grid gap-2.5 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
              <Entrada type="search" aria-label="Buscar productos" placeholder="Buscar un producto…" value={q}
                onChange={filtrar(setQ)} className="pl-10" />
            </div>
            <Seleccion value={tipologia} onChange={filtrar(setTipologia)} aria-label="Filtrar por tipología" className="sm:w-48">
              <option value="">Todas las tipologías</option>
              {(catalogo?.facetas.tipologias || []).map((t) => <option key={t} value={t}>{t}</option>)}
            </Seleccion>
            <Seleccion value={sector} onChange={filtrar(setSector)} aria-label="Filtrar por sector" className="sm:w-44">
              <option value="">Todos los sectores</option>
              {(catalogo?.facetas.sectores || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </Seleccion>
          </div>

          {cargando && !catalogo ? (
            <Cargando />
          ) : catalogo?.items.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {catalogo.items.map((p) => (
                  <Producto key={p.id_producto} p={p} enCarrito={cantidades.get(p.id_producto) || 0}
                    puedeAgregar={puedeAgregar} motivo={motivo} ocupado={carrito.ocupado} onAgregar={carrito.agregar} />
                ))}
              </div>
              {catalogo.paginas > 1 && (
                <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-gris-txt">
                  <span>Página {catalogo.pagina} de {catalogo.paginas} · {catalogo.total} productos</span>
                  <div className="flex gap-2">
                    <Boton variante="fantasma" icono={ChevronLeft} disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>Anterior</Boton>
                    <Boton variante="fantasma" disabled={pagina >= catalogo.paginas} onClick={() => setPagina((n) => n + 1)}>
                      Siguiente <ChevronRight size={16} aria-hidden="true" />
                    </Boton>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Tarjeta>
              <Vacio icono={Store}>
                {q || tipologia || sector
                  ? 'Ningún producto coincide con la búsqueda.'
                  : 'El catálogo todavía está vacío. La coordinación lo carga desde la pestaña "Catálogo".'}
              </Vacio>
            </Tarjeta>
          )}
        </section>

        <div id="carrito-panel" className="lg:sticky lg:top-16">
          {idUnico ? (
            <PanelCarrito carrito={carrito} />
          ) : (
            <Tarjeta titulo="Carrito">
              <Vacio icono={ShoppingCart}>Elige una iniciativa para ver o armar su carrito.</Vacio>
            </Tarjeta>
          )}
        </div>
      </div>

      {idUnico && resumen && (
        <button
          type="button"
          onClick={() => document.getElementById('carrito-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between gap-3 rounded-xl bg-marino px-4 py-3 text-white shadow-elevada lg:hidden"
        >
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <ShoppingCart size={18} aria-hidden="true" /> Ver carrito ({carrito.vista.lineas.length})
          </span>
          <span className="cifras text-[15px] font-bold">{pesos(resumen.total)}</span>
        </button>
      )}
    </div>
  );
}
