// Detalle de un punto de la ruta, que se despliega bajo la barra. Al tocar un punto de la ruta de atención
// muestra, en columnas lado a lado, quiénes lo tienen y quiénes no, trabajando sobre las filas ya filtradas del
// panel.
import { useMemo, useState } from 'react';
import { val, fullName } from '../lib/utils';
import { pasoLogrado } from '../lib/etapas';
import {
  agrupar, audDe, estadoPaso, ordenar, coincide, descargarPaso,
} from '../lib/informeBitacora';
import { IconoDescarga } from './DetalleInforme';

const PAGINA = 40;
const TONO_CAJA = { ok: 't-ok', bad: 't-bad', warn: 't-warn', neutral: 't-neutral' };

// Muestra las columnas de unidades con y sin el paso, con sus acciones.
export default function DetallePaso({
  step, filas, auditIndex, etiquetaFiltro, onAbrirUP, onVerPanel, descargas,
}) {
  const [q, setQ] = useState('');
  const [bajando, setBajando] = useState(false);

  const grupos = useMemo(() => {
    const g = agrupar(filas, (up) => estadoPaso(step, up, audDe(up, auditIndex)));
    const suma = (x) => x.filas.some((up) => pasoLogrado(step, up, audDe(up, auditIndex)));
    return [...g.filter(suma), ...g.filter((x) => !suma(x))];
  }, [step, filas, auditIndex]);

  async function descargar() {
    setBajando(true);
    try { await descargarPaso({ step, filas, auditIndex, etiquetaFiltro }); }
    finally { setBajando(false); }
  }

  const total = filas.length;
  const cols = grupos.length >= 3 ? 'lg:grid-cols-3' : '';

  return (
    <div className="mb-2 mt-1 rounded-lg border border-borde bg-bg p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar en ${step.label}: ID, nombre, cédula, nodo, gestor…`}
          className="min-w-[200px] flex-1 rounded-lg border border-borde bg-card px-3 py-2 text-[13px] outline-none focus:border-acento" />
        {onVerPanel && (
          <button type="button" onClick={onVerPanel}
            className="h-[36px] rounded-lg border border-borde bg-card px-3 text-xs font-semibold text-texto hover:border-acento">
            Ver por nodo
          </button>
        )}
        {descargas && (
          <button type="button" onClick={descargar} disabled={bajando || !total}
            className="inline-flex h-[36px] items-center gap-1.5 rounded-lg bg-marino px-3 text-xs font-semibold text-white hover:bg-marino2 disabled:opacity-40">
            <IconoDescarga /> {bajando ? 'Generando…' : `Descargar ${step.label}`}
          </button>
        )}
      </div>

      {!grupos.length ? (
        <p className="py-6 text-center text-sm text-gris">Sin unidades con este filtro</p>
      ) : (
        <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${cols}`}>
          {grupos.map((g) => (
            <Columna key={g.label} grupo={g} total={total} q={q} onAbrirUP={onAbrirUP} />
          ))}
        </div>
      )}
    </div>
  );
}

// Muestra una columna de unidades con su título.
function Columna({ grupo, total, q, onAbrirUP }) {
  const [limite, setLimite] = useState(PAGINA);
  const lista = useMemo(
    () => ordenar(grupo.filas.filter((up) => coincide(up, q))),
    [grupo, q],
  );
  const pct = total ? Math.round((grupo.filas.length / total) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-borde bg-card">
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${TONO_CAJA[grupo.tono] || TONO_CAJA.neutral}`}>
        <span className="truncate text-xs font-bold uppercase tracking-wide">{grupo.label}</span>
        <span className="shrink-0 text-sm font-bold">
          {grupo.filas.length.toLocaleString('es-CO')} <span className="text-[11px] font-normal">{pct}%</span>
        </span>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {!lista.length ? (
          <p className="px-3 py-4 text-center text-xs text-gris">Sin coincidencias</p>
        ) : lista.slice(0, limite).map((up) => {
          const doc = val(up.integrante_doc_inicial) || val(up.unidad_doc);
          return (
            <button key={up.ID_unico} type="button" onClick={() => onAbrirUP(up)}
              title="Abrir ficha"
              className="block w-full border-b border-borde px-3 py-2 text-left last:border-b-0 hover:bg-bg">
              <div className="truncate text-[13px] font-semibold text-marino">
                {fullName(up) || 'Sin nombre'}
                {doc && <span className="font-normal text-gris"> · CC {doc}</span>}
              </div>
              <div className="truncate text-[11px] text-gris">
                ID {up.ID_unico} · {val(up.unidad_nombre) || 'Sin nombre'} · Nodo {val(up.nodo) || '—'}
                {val(up.nombre_gestor) && <> · {up.nombre_gestor}</>}
              </div>
            </button>
          );
        })}
      </div>

      {lista.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + PAGINA)}
          className="border-t border-borde px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:bg-bg">
          Ver {Math.min(PAGINA, lista.length - limite)} más · quedan {(lista.length - limite).toLocaleString('es-CO')}
        </button>
      )}
    </div>
  );
}
