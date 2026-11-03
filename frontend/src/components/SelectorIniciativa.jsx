// Selector de iniciativa (unidad productiva) con búsqueda: se escribe parte del nombre, del código, del
// municipio o del representante y salen las coincidencias. Lo usan la agenda y el carrito de compras.
import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { representante } from '../lib/agenda';

// Cantidad máxima de coincidencias que se muestran; el resto se alcanza escribiendo más.
const MAX_RESULTADOS = 30;

// Muestra el campo de búsqueda y la lista de coincidencias.
export default function SelectorIniciativa({ filas, valor, onElegir, etiqueta = 'Iniciativa', disabled = false }) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);

  const elegida = useMemo(() => filas.find((f) => f.ID_unico === valor) || null, [filas, valor]);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    const lista = t
      ? filas.filter((f) => [f.unidad_nombre, f.ID_unico, f.mpio, f.nodo, representante(f)]
        .some((v) => String(v || '').toLowerCase().includes(t)))
      : filas;
    return lista.slice(0, MAX_RESULTADOS);
  }, [filas, q]);

  const elegir = (fila) => {
    onElegir(fila);
    setAbierto(false);
    setQ('');
  };

  if (elegida && !abierto) {
    return (
      <div>
        <span className="mb-1.5 block text-[13px] font-semibold text-gris-txt">{etiqueta}</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-campo bg-card px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-semibold text-marca">{elegida.unidad_nombre || `Iniciativa ${elegida.ID_unico}`}</div>
            <div className="truncate text-[12px] text-gris-txt">
              {elegida.ID_unico} · {[elegida.mpio, elegida.dpto].filter(Boolean).join(', ') || 'Sin ubicación'}
              {representante(elegida) ? ` · ${representante(elegida)}` : ''}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-acento-txt hover:bg-lienzo"
            >
              Cambiar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-semibold text-gris-txt" htmlFor="buscar-iniciativa">{etiqueta}</label>
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
        <input
          id="buscar-iniciativa"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busca por nombre, código, municipio o representante"
          autoComplete="off"
          autoFocus={abierto}
          className="min-h-11 w-full rounded-lg border border-campo bg-card py-2 pr-3 pl-10 text-[16px] text-marca outline-none transition focus:border-acento focus:ring-4 focus:ring-acento/20 sm:min-h-10 sm:text-[14px]"
        />
        {elegida && (
          <button type="button" onClick={() => setAbierto(false)} aria-label="Cancelar el cambio"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-gris hover:text-marca">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-borde bg-card" role="listbox" aria-label="Iniciativas">
        {resultados.length === 0 && (
          <li className="px-3.5 py-3 text-[13px] text-gris-txt">Ninguna iniciativa coincide con la búsqueda.</li>
        )}
        {resultados.map((f) => (
          <li key={f.ID_unico} role="option" aria-selected={f.ID_unico === valor}>
            <button
              type="button"
              onClick={() => elegir(f)}
              className="flex w-full items-center justify-between gap-3 border-b border-borde/70 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-lienzo"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-marca">{f.unidad_nombre || `Iniciativa ${f.ID_unico}`}</span>
                <span className="block truncate text-[12px] text-gris-txt">
                  {f.ID_unico} · {f.nodo || 'Sin nodo'} · {f.mpio || 'Sin municipio'}
                  {representante(f) ? ` · ${representante(f)}` : ''}
                </span>
              </span>
              {f.ID_unico === valor && <Check size={16} aria-hidden="true" className="shrink-0 text-ok" />}
            </button>
          </li>
        ))}
      </ul>
      {filas.length > MAX_RESULTADOS && !q && (
        <p className="mt-1.5 text-[12px] text-gris-txt">Se muestran las primeras {MAX_RESULTADOS}. Escribe para filtrar.</p>
      )}
    </div>
  );
}
