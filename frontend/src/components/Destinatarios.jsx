// Selector de destinatarios compartido por eventos y novedades. Los conteos y la opción de todos se calculan
// por conjuntos contra la lista viva: un nodo guardado cuya cuenta ya no está activa no cuenta como de la lista
// y se muestra siempre como una etiqueta que se puede quitar.
import { useMemo } from 'react';
import {
  useGestores, useCargaGestores, nodosDeRegion, nombreGestor,
  ordenGestores, destLabel, norm, unicos, plural,
} from '../lib/comunicaciones';
import { usePedirGestores } from '../hooks/useComunicaciones';

// Crea el estado inicial vacío del selector.
export const destNuevo = (sel) => ({
  sel: [...sel], q: '', region: '', dpto: '', modalidad: '', abiertos: {}, verChips: false,
});

// Muestra el selector de nodos con búsqueda, conteos y las etiquetas de los elegidos.
export default function Destinatarios({ d, onChange }) {
  const set = (patch) => onChange({ ...d, ...patch });
  const lista = useGestores();
  const carga = useCargaGestores();
  const reintentar = usePedirGestores();
  const total = lista.length;
  const deLista = useMemo(() => new Set(lista.map((g) => g.nodo)), [lista]);
  const selLista = [...new Set(d.sel)].filter((x) => deLista.has(x));
  const huerfanos = [...new Set(d.sel)].filter((x) => !deLista.has(x));
  const n = selLista.length;

  const filtrados = useMemo(() => {
    const q = norm(d.q);
    return lista.filter((g) => {
      if (d.region && g.region !== d.region) return false;
      if (d.dpto && g.dpto !== d.dpto) return false;
      if (d.modalidad && !g.modalidades.includes(d.modalidad)) return false;
      if (q && !norm(`${g.nombre} ${g.nodo} ${g.dpto}`).includes(q)) return false;
      return true;
    });
  }, [lista, d.q, d.region, d.dpto, d.modalidad]);

  const filtrando = !!(d.q || d.region || d.dpto || d.modalidad);
  const esta = (nodo) => d.sel.includes(nodo);

  function toggle(nodo) {
    set({ sel: esta(nodo) ? d.sel.filter((x) => x !== nodo) : [...d.sel, nodo] });
  }

  function toggleGrupo(region) {
    const miembros = filtrados.filter((g) => g.region === region).map((g) => g.nodo);
    const todos = miembros.every(esta);
    set({
      sel: todos
        ? d.sel.filter((x) => !miembros.includes(x))
        : [...new Set([...d.sel, ...miembros])],
    });
  }

  function lote(agregar) {
    const nodos = filtrados.map((g) => g.nodo);
    set({
      sel: agregar
        ? [...new Set([...d.sel, ...nodos])]
        : d.sel.filter((x) => !nodos.includes(x)),
    });
  }

  function filtro(campo, valor) {
    const next = { ...d, [campo]: valor };
    if (campo === 'region' && next.dpto) {
      const valido = lista.some((g) => g.dpto === next.dpto && (!valor || g.region === valor));
      if (!valido) next.dpto = '';
    }
    onChange(next);
  }

  const dptos = unicos(lista.filter((g) => !d.region || g.region === d.region).map((g) => g.dpto));
  const mods = unicos(lista.flatMap((g) => g.modalidades));
  const elegidos = n < total ? ordenGestores(selLista) : [];
  const maxChips = d.verChips ? elegidos.length : 8;

  return (
    <div className="overflow-hidden rounded-xl border border-borde">
      <div className="border-b border-borde bg-bg p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] text-texto" aria-live="polite">
            <b>{n}</b> de {total} gestores
            {n > 0 && (
              <span className="ml-2 rounded-full bg-marino px-2 py-0.5 text-[11px] font-semibold text-acento">
                {destLabel(selLista)}
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            <BtnMini onClick={() => set({ sel: [...new Set([...d.sel, ...lista.map((g) => g.nodo)])] })}
              disabled={n === total}>
              Seleccionar todos
            </BtnMini>
            <BtnMini onClick={() => set({ sel: [] })} disabled={!d.sel.length}>Quitar todos</BtnMini>
          </div>
        </div>

        {!d.sel.length ? (
          <p className="mt-2 text-xs italic text-gris">
            Marca una región completa o busca a las personas que quieres incluir.
          </p>
        ) : (huerfanos.length > 0 || elegidos.length > 0) ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {huerfanos.map((nodo) => (
              <span key={nodo} title="Este nodo ya no tiene un gestor activo en tu alcance."
                className="inline-flex items-center gap-1 rounded-full border border-acento bg-card px-2 py-0.5 text-[11px] text-texto">
                {nodo} · sin gestor activo
                <button type="button" onClick={() => toggle(nodo)}
                  aria-label={`Quitar ${nodo}, sin gestor activo`}
                  className="text-gris hover:text-rojo">×</button>
              </span>
            ))}
            {elegidos.slice(0, maxChips).map((nodo) => (
              <span key={nodo}
                className="inline-flex items-center gap-1 rounded-full border border-borde bg-card px-2 py-0.5 text-[11px] text-texto">
                {nombreGestor(nodo)}
                <button type="button" onClick={() => toggle(nodo)}
                  aria-label={`Quitar a ${nombreGestor(nodo)}`}
                  className="text-gris hover:text-rojo">×</button>
              </span>
            ))}
            {elegidos.length > 8 && (
              <button type="button" onClick={() => set({ verChips: !d.verChips })}
                className="text-[11px] font-semibold text-acento-txt hover:underline">
                {d.verChips ? 'Ver menos' : `+${elegidos.length - 8} más`}
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2.5 border-b border-borde p-3.5">
        <div className="min-w-[180px] flex-1">
          <Label>Buscar persona</Label>
          <input type="search" value={d.q} onChange={(e) => set({ q: e.target.value })}
            placeholder="Nombre, nodo o departamento" autoComplete="off" className={inputCls} />
        </div>
        {[
          ['region', 'Región', unicos(lista.map((g) => g.region))],
          ['dpto', 'Departamento', dptos],
          ['modalidad', 'Modalidad', mods],
        ].map(([campo, label, opciones]) => (
          <div key={campo} className="min-w-[130px] flex-1">
            <Label>{label}</Label>
            <select value={d[campo]} onChange={(e) => filtro(campo, e.target.value)}
              className={`${inputCls} cursor-pointer`}>
              <option value="">Todas</option>
              {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      {filtrando && (() => {
        const yaEstan = filtrados.filter((g) => esta(g.nodo)).length;
        const faltan = filtrados.length - yaEstan;
        return (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde bg-acento/8 px-3.5 py-2">
            <span className="text-xs text-texto">
              {plural(filtrados.length, 'gestor coincide', 'gestores coinciden')} con el filtro
            </span>
            <div className="flex gap-1.5">
              <BtnMini onClick={() => lote(true)} disabled={!faltan}>
                {!faltan ? 'Ya están todos'
                  : faltan === filtrados.length ? `Agregar los ${faltan}`
                  : `Agregar ${faltan} que ${faltan === 1 ? 'falta' : 'faltan'}`}
              </BtnMini>
              <BtnMini onClick={() => lote(false)} disabled={!yaEstan}>Quitar {yaEstan}</BtnMini>
              <BtnMini onClick={() => set({ q: '', region: '', dpto: '', modalidad: '' })}>
                Limpiar filtros
              </BtnMini>
            </div>
          </div>
        );
      })()}

      <div className="max-h-[320px] overflow-y-auto">
        {!total && carga === 'error' ? (
          <div role="alert" className="flex flex-wrap items-center justify-center gap-2 p-4 text-center">
            <span className="text-[13px] font-semibold text-rojo">No se pudieron cargar los gestores.</span>
            <BtnMini onClick={reintentar}>Reintentar</BtnMini>
          </div>
        ) : !filtrados.length ? (
          <p className="p-4 text-center text-[13px] italic text-gris">
            {total ? 'Ningún gestor coincide con el filtro.'
              : carga === 'cargando' ? 'Cargando gestores…'
              : 'Todavía no hay gestores activos en tu alcance.'}
          </p>
        ) : (
          unicos(filtrados.map((g) => g.region)).map((region) => {
            const miembros = filtrados.filter((g) => g.region === region);
            const enRegion = nodosDeRegion(region);
            const selRegion = enRegion.filter(esta).length;
            const selVisibles = miembros.filter((g) => esta(g.nodo)).length;
            const estado = selVisibles === 0 ? 'no'
              : selVisibles === miembros.length ? 'si' : 'mixto';
            const abierto = filtrando || !!d.abiertos[region];

            return (
              <div key={region} className="border-b border-borde last:border-b-0">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button type="button" role="checkbox"
                    aria-checked={estado === 'si' ? 'true' : estado === 'mixto' ? 'mixed' : 'false'}
                    onClick={() => toggleGrupo(region)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <Check estado={estado} />
                    <span className="truncate text-[13px] font-semibold text-texto">{region}</span>
                    <span className="shrink-0 text-[11px] text-gris">
                      {selRegion} de {enRegion.length} seleccionados
                      {filtrando && miembros.length !== enRegion.length && ` · ${miembros.length} en el filtro`}
                    </span>
                  </button>
                  {!filtrando && (
                    <button type="button" aria-expanded={abierto}
                      onClick={() => set({ abiertos: { ...d.abiertos, [region]: !abierto } })}
                      className="shrink-0 text-[11px] font-semibold text-gris hover:text-marino">
                      {abierto ? 'Ocultar ▴' : 'Ver personas ▾'}
                    </button>
                  )}
                </div>

                {abierto && miembros.map((g) => {
                  const marcado = esta(g.nodo);
                  return (
                    <button key={g.nodo} type="button" role="checkbox" aria-checked={marcado}
                      onClick={() => toggle(g.nodo)}
                      className="flex w-full items-center gap-2.5 border-t border-borde/60 px-3 py-2 pl-8 text-left hover:bg-bg">
                      <Check estado={marcado ? 'si' : 'no'} />
                      <span className="shrink-0 text-[13px] text-texto">{g.nombre}</span>
                      <span className="truncate text-[11px] text-gris">
                        {g.nodo} · {g.dpto} · {g.modalidades.join(', ')} · {g.ups} UP
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-borde bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-acento';

function Label({ children }) {
  return (
    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gris">
      {children}
    </label>
  );
}

function BtnMini({ children, ...props }) {
  return (
    <button type="button"
      className="rounded-md border border-borde bg-card px-2.5 py-1 text-[11px] font-semibold text-gris transition hover:border-acento hover:text-marino disabled:opacity-40 disabled:hover:border-borde disabled:hover:text-gris"
      {...props}>
      {children}
    </button>
  );
}

// Muestra una casilla de verificación con su etiqueta.
function Check({ estado }) {
  return (
    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-[1.5px] text-[11px] font-bold text-white ${
      estado === 'si' ? 'border-verde-ok bg-verde-ok'
        : estado === 'mixto' ? 'border-acento bg-acento' : 'border-borde bg-card'
    }`}>
      {estado === 'si' ? '✓' : estado === 'mixto' ? '–' : ''}
    </span>
  );
}
