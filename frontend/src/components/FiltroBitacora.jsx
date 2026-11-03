// Filtro reutilizable de la Bitácora: región, departamento, modalidad, nodo y estado de la unidad. Trabaja
// sobre la base de la bitácora y es en cascada: cada desplegable solo ofrece valores que siguen existiendo con
// los demás filtros, y los incompatibles se limpian solos.
import { useState, useMemo, useCallback } from 'react';
import { val, uniqueSorted } from '../lib/utils';
import { isInactiva } from '../lib/etapas';
import { Card } from './UI';
import { useSession } from '../hooks/useSession';

const CAMPOS = { region: 'region', dpto: 'dpto', modalidad: 'modalidad', nodo: 'nodo' };
const CAMPOS_CON_MPIO = { region: 'region', dpto: 'dpto', mpio: 'mpio', modalidad: 'modalidad', nodo: 'nodo' };
const ETIQUETAS = { region: 'Región', dpto: 'Departamento', mpio: 'Municipio', modalidad: 'Modalidad', nodo: 'Nodo' };
export const FILTRO_VACIO = { region: '', dpto: '', modalidad: '', nodo: '', estado: '' };

// Indica si una fila cumple el filtro; se exporta para las pruebas.
export function cumple(up, filtros, excepto, campos = CAMPOS) {
  if (!up) return false;
  if (excepto !== 'estado' && filtros.estado) {
    const inact = isInactiva(up);
    if (filtros.estado === 'activa' && inact !== false) return false;
    if (filtros.estado === 'inactiva' && inact !== true) return false;
  }
  for (const k of Object.keys(campos)) {
    if (k === excepto) continue;
    if (filtros[k] && val(up[campos[k]]) !== filtros[k]) return false;
  }
  return true;
}

// Hook que mantiene el estado del filtro y devuelve las filas filtradas y las opciones.
export function useFiltroBitacora(data, { municipio = false } = {}) {
  const CAMPOS_F = municipio ? CAMPOS_CON_MPIO : CAMPOS;
  const vacio = municipio ? { ...FILTRO_VACIO, mpio: '' } : FILTRO_VACIO;
  const [f, setF] = useState(vacio);

  const filtrar = useCallback(
    (filtros, excepto) => data.filter((up) => cumple(up, filtros, excepto, CAMPOS_F)),
    [data, CAMPOS_F]
  );

  const filas = useMemo(() => filtrar(f), [filtrar, f]);

  const opcionesDe = useCallback(
    (k) => uniqueSorted(filtrar(f, k).map((r) => r[CAMPOS_F[k]])),
    [filtrar, f, CAMPOS_F]
  );

  function cambiar(key, value) {
    const next = { ...f, [key]: value };
    for (let pasada = 0; pasada < 4; pasada++) {
      let algo = false;
      for (const k of Object.keys(CAMPOS_F)) {
        if (k === key || !next[k]) continue;
        const validas = uniqueSorted(filtrar(next, k).map((r) => r[CAMPOS_F[k]]));
        if (!validas.includes(next[k])) { next[k] = ''; algo = true; }
      }
      if (!algo) break;
    }
    setF(next);
  }

  const activo = Object.values(f).some(Boolean);
  const pasa = useCallback((up) => cumple(up, f, null, CAMPOS_F), [f, CAMPOS_F]);

  return {
    valores: f, filas, activo, pasa, opcionesDe, cambiar,
    campos: Object.keys(CAMPOS_F),
    limpiar: () => setF(vacio),
  };
}

// Devuelve un texto legible del filtro actual, por ejemplo para nombres de archivo.
export function describirFiltro(valores) {
  const partes = ['region', 'dpto', 'mpio', 'modalidad', 'nodo']
    .map((k) => valores[k]).filter(Boolean);
  if (valores.estado) partes.push(valores.estado === 'activa' ? 'activas' : 'inactivas');
  return partes.join('_');
}

// Muestra los desplegables; en celular arranca plegado y su cabecera dice qué hay aplicado.
export default function FiltroBitacora({ filtro, extra, extraEtiqueta, onLimpiar, className = 'mb-3.5' }) {
  const { valores: f, opcionesDe, cambiar, limpiar } = filtro;
  const { session } = useSession();
  const fijos = ['coordinador', 'tecnico_administrativo'].includes(session?.role)
    ? { region: session.region, dpto: session.departamento, modalidad: session.modalidad, nodo: session.nodo }
    : {};
  const campos = (filtro.campos || Object.keys(CAMPOS)).filter((k) => !fijos[k]);
  const [abierto, setAbierto] = useState(false);
  const aplicados = [...campos.map((k) => f[k]),
    f.estado && (f.estado === 'activa' ? 'Activas' : 'Inactivas'), extraEtiqueta].filter(Boolean);

  return (
    <Card className={`${className} p-3.5`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 text-left sm:hidden"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-gris">
            Filtros{aplicados.length > 0 && <span className="text-acento-txt"> · {aplicados.length}</span>}
          </span>
          <span className="block truncate text-[13px] font-semibold text-texto">
            {aplicados.length ? aplicados.join(' · ') : 'Todas las unidades'}
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 text-gris transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div className={`${abierto ? 'mt-3 flex' : 'hidden'} flex-wrap items-end gap-2.5 sm:mt-0 sm:flex`}>
      {campos.map((k) => [k, ETIQUETAS[k]]).map(([k, label]) => (
        <div key={k} className="flex min-w-[140px] flex-1 flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gris">
            {label}
          </label>
          <select
            value={f[k]}
            onChange={(e) => cambiar(k, e.target.value)}
            className="cursor-pointer rounded-lg border border-borde bg-card px-2.5 py-2 text-[13px] outline-none focus:border-acento"
          >
            <option value="">Todas</option>
            {opcionesDe(k).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      ))}

      <div className="flex min-w-[210px] flex-col gap-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-gris">
          Estado de la UP
        </label>
        <div className="flex h-[34px] overflow-hidden rounded-lg border border-borde bg-card">
          {[['', 'Todas'], ['activa', 'Activas'], ['inactiva', 'Inactivas']].map(([v, l], i) => (
            <button
              key={v}
              type="button"
              onClick={() => cambiar('estado', v)}
              className={`flex-1 whitespace-nowrap px-2.5 text-xs font-semibold transition ${
                i < 2 ? 'border-r border-borde' : ''
              } ${f.estado === v ? 'bg-marino text-white' : 'text-gris hover:bg-bg hover:text-texto'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {extra}

      <button
        type="button"
        onClick={() => { limpiar(); onLimpiar && onLimpiar(); }}
        className="h-[34px] rounded-lg border border-borde bg-bg px-3.5 text-xs font-semibold text-gris hover:border-gris hover:text-texto"
      >
        Limpiar
      </button>
      </div>
    </Card>
  );
}
