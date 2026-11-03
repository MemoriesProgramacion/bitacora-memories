// Panel de detalle del informe de la Bitácora. Se abre al hacer clic en una barra o indicador del panel y
// muestra quiénes son las unidades detrás del número, separadas por estado, agrupadas por nodo, con búsqueda,
// acceso a la ficha y descarga a Excel.
import { useEffect, useMemo, useRef, useState } from 'react';
import { val, fullName } from '../lib/utils';
import {
  agrupar, audDe, estadoPaso, estadoUpTexto, tonoEstadoUp, textoCuenta,
  resumenPorNodo, ordenar, coincide, descargarListaDetalle, SIN_DATO,
} from '../lib/informeBitacora';
import { Btn, Chip } from './UI';

// Cantidad de filas que se muestran por página.
const PAGINA = 100;

// Muestra el detalle de las unidades de un indicador con sus filtros.
export default function DetalleInforme({
  detalle, auditIndex, etiquetaFiltro, onCerrar, onAbrirUP, descargas,
}) {
  const { titulo, subtitulo, filas, paso } = detalle;

  const [grupoSel, setGrupoSel] = useState(null);
  const [nodoSel, setNodoSel] = useState(null);
  const [q, setQ] = useState('');
  const [vista, setVista] = useState('unidades');
  const [limite, setLimite] = useState(PAGINA);

  const raiz = useRef(null);
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape' && raiz.current && raiz.current.getClientRects().length > 0) onCerrar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const estadoDe = useMemo(() => (
    paso
      ? (up) => estadoPaso(paso, up, audDe(up, auditIndex))
      : (up) => ({ label: estadoUpTexto(up), tono: tonoEstadoUp(up) })
  ), [paso, auditIndex]);

  const grupos = useMemo(() => agrupar(filas, estadoDe), [filas, estadoDe]);

  const conteoPaso = useMemo(() => {
    if (!paso) return null;
    const si = filas.filter((up) => estadoDe(up).cuenta).length;
    return { ...textoCuenta(paso), nSi: si, nNo: filas.length - si };
  }, [paso, filas, estadoDe]);

  const base = useMemo(() => {
    const g = grupoSel ? grupos.find((x) => x.label === grupoSel) : null;
    return g ? g.filas : filas;
  }, [grupoSel, grupos, filas]);

  const visibles = useMemo(() => ordenar(base.filter((up) => (
    (!nodoSel || (val(up.nodo) || SIN_DATO) === nodoSel) && coincide(up, q)
  ))), [base, nodoSel, q]);

  const porNodo = useMemo(
    () => resumenPorNodo(base.filter((up) => coincide(up, q)), auditIndex)
      .sort((a, b) => b.total - a.total),
    [base, q, auditIndex],
  );

  useEffect(() => { setLimite(PAGINA); }, [grupoSel, nodoSel, q]);

  function descargar() {
    descargarListaDetalle({
      filas: visibles, auditIndex, paso, etiquetaFiltro,
      titulo, grupo: [grupoSel, nodoSel].filter(Boolean).join('_'),
    });
  }

  return (
    <div ref={raiz} className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" aria-label="Cerrar" onClick={onCerrar}
        className="absolute inset-0 cursor-default bg-[rgba(43,40,86,0.45)]" />

      <div className="relative flex h-full w-full max-w-3xl flex-col bg-bg shadow-2xl">
        <div className="border-b border-borde bg-card px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-widest text-acento">Detalle</div>
              <h3 className="line-clamp-2 text-base font-bold leading-snug text-marino sm:truncate sm:text-lg">{titulo}</h3>
              <p className="text-xs text-gris">{subtitulo}</p>
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar detalle"
              className="rounded-lg p-2 text-gris hover:bg-bg hover:text-texto">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {conteoPaso && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Mini label={conteoPaso.si} n={conteoPaso.nSi} total={filas.length}
                tono={paso.cuenta ? 'bad' : 'ok'} />
              <Mini label={conteoPaso.no} n={conteoPaso.nNo} total={filas.length}
                tono={paso.cuenta ? 'ok' : 'bad'} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Filtro activo={!grupoSel} onClick={() => setGrupoSel(null)}>
              Todas <b>{filas.length.toLocaleString('es-CO')}</b>
            </Filtro>
            {grupos.map((g) => (
              <Filtro key={g.label} activo={grupoSel === g.label} tono={g.tono}
                onClick={() => setGrupoSel(grupoSel === g.label ? null : g.label)}>
                {g.label} <b>{g.filas.length.toLocaleString('es-CO')}</b>
              </Filtro>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar ID, nombre, documento, gestor, municipio…"
              className="min-w-[200px] flex-1 rounded-lg border border-borde bg-card px-3 py-2 text-[13px] outline-none focus:border-acento" />
            <div className="flex h-[36px] overflow-hidden rounded-lg border border-borde bg-card">
              {[['unidades', 'Unidades'], ['nodos', 'Por nodo']].map(([v, l], i) => (
                <button key={v} type="button" onClick={() => setVista(v)}
                  className={`px-3 text-xs font-semibold ${i === 0 ? 'border-r border-borde' : ''} ${
                    vista === v ? 'bg-marino text-white' : 'text-gris hover:bg-bg hover:text-texto'}`}>
                  {l}
                </button>
              ))}
            </div>
            {descargas && (
              <Btn variant="secondary" onClick={descargar} disabled={!visibles.length}
                className="h-[36px] px-3 py-0 text-xs" title="Descarga en Excel exactamente la lista que estás viendo">
                <IconoDescarga /> Descargar lista
              </Btn>
            )}
          </div>

          {nodoSel && (
            <div className="mt-2 flex items-center gap-2 text-xs text-gris">
              Mostrando solo el nodo <b className="text-texto">{nodoSel}</b>
              <button type="button" onClick={() => setNodoSel(null)}
                className="font-semibold text-acento hover:underline">Quitar</button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {vista === 'nodos' ? (
            <TablaNodos datos={porNodo} total={base.length}
              onElegir={(n) => { setNodoSel(n); setVista('unidades'); }} />
          ) : !visibles.length ? (
            <p className="py-12 text-center text-sm text-gris">No hay unidades con esta selección</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-gris">
                {visibles.length.toLocaleString('es-CO')} unidad{visibles.length === 1 ? '' : 'es'} · clic para abrir la ficha
              </p>
              <div className="flex flex-col gap-1.5">
                {visibles.slice(0, limite).map((up) => {
                  const e = estadoDe(up);
                  return (
                    <button key={up.ID_unico} type="button" onClick={() => onAbrirUP(up)}
                      className="flex items-center justify-between gap-3 rounded-lg border border-borde bg-card px-3.5 py-2.5 text-left transition hover:border-acento hover:shadow-md motion-safe:hover:scale-[1.015]">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-marino">
                          ID {up.ID_unico} — {val(up.unidad_nombre) || 'Sin nombre'}
                        </div>
                        <div className="truncate text-xs text-texto">
                          {fullName(up) || '—'}
                          {val(up.integrante_doc_inicial || up.unidad_doc) && (
                            <span className="text-gris"> · CC {up.integrante_doc_inicial || up.unidad_doc}</span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-gris">
                          Nodo {val(up.nodo) || '—'}
                          {val(up.nombre_gestor) && <> · {up.nombre_gestor}</>}
                          {' · '}{val(up.mpio) || '—'}, {val(up.dpto) || '—'}
                        </div>
                      </div>
                      <Chip tono={e.tono} className="shrink-0">{e.label}</Chip>
                    </button>
                  );
                })}
              </div>
              {visibles.length > limite && (
                <div className="mt-3 text-center">
                  <Btn variant="secondary" onClick={() => setLimite((l) => l + PAGINA)} className="text-xs">
                    Mostrar {Math.min(PAGINA, visibles.length - limite)} más
                    <span className="text-gris">({(visibles.length - limite).toLocaleString('es-CO')} restantes)</span>
                  </Btn>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({ label, n, total, tono }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className={`rounded-lg border px-3 py-2 ${tono === 'ok' ? 't-ok' : 't-bad'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold leading-tight">
        {n.toLocaleString('es-CO')} <span className="text-xs font-normal">{pct}%</span>
      </div>
    </div>
  );
}

function Filtro({ activo, tono = 'neutral', onClick, children }) {
  const tonos = { ok: 't-ok', bad: 't-bad', warn: 't-warn', neutral: 't-neutral' };
  return (
    <button type="button" onClick={onClick} aria-pressed={activo}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
        activo ? 'border-marino bg-marino text-white' : `${tonos[tono]} hover:border-marino`}`}>
      {children}
    </button>
  );
}

// Muestra las unidades agrupadas por nodo.
function TablaNodos({ datos, total, onElegir }) {
  if (!datos.length) return <p className="py-12 text-center text-sm text-gris">Sin datos</p>;
  const max = datos[0].total || 1;
  return (
    <div className="overflow-hidden rounded-card border border-borde bg-card">
      <div className="grid grid-cols-[80px_1fr_110px] gap-2 border-b border-borde bg-bg px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gris">
        <span>Nodo</span><span>Gestor</span><span className="text-right">Unidades</span>
      </div>
      {datos.map((r) => {
        const pct = total ? Math.round((r.total / total) * 100) : 0;
        return (
          <button key={r.nodo} type="button" onClick={() => onElegir(r.nodo)}
            className="grid w-full grid-cols-[80px_1fr_110px] items-center gap-2 border-b border-borde px-3.5 py-2 text-left last:border-b-0 hover:bg-bg">
            <span className="truncate text-xs font-semibold text-marino">{r.nodo}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-texto">{r.gestor || '—'}</span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-bg">
                <span className="block h-full rounded-full bg-acento" style={{ width: `${Math.max(3, (r.total / max) * 100)}%` }} />
              </span>
            </span>
            <span className="text-right text-xs font-semibold text-texto">
              {r.total.toLocaleString('es-CO')} <i className="not-italic text-[11px] font-normal text-gris">{pct}%</i>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Dibuja el icono de descarga.
export function IconoDescarga() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
