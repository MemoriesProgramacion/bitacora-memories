// Ventana para editar los datos de una unidad productiva en tres bloques: ficha, representante y expediente.
// Pide los valores actuales a la API y, al guardar, envía solo lo que cambió; el servidor vuelve a validar el
// permiso y cada campo.
import { useEffect, useMemo, useState } from 'react';
import { Btn, Aviso, Spinner } from './UI';
import { inputCls, Campo } from './FormPiezas';
import {
  CAMPOS_UP, CAMPOS_REPRESENTANTE, CAMPOS_EXPEDIENTE,
  cargarDatosEditables, armarCambios, hayCambios, guardarDatosUnidad,
} from '../lib/fichaUP';
import { cargarListas } from '../lib/clasificacion';

// Los tres bloques que se pueden editar.
const PESTANAS = [
  { id: 'up', nombre: 'Ficha', campos: CAMPOS_UP, id_campo: (c) => c.k },
  { id: 'representante', nombre: 'Representante', campos: CAMPOS_REPRESENTANTE, id_campo: (c) => c.k },
  { id: 'expediente', nombre: 'Expediente', campos: CAMPOS_EXPEDIENTE, id_campo: (c) => c.p },
];

function Entrada({ campo, id, valor, onChange, listas }) {
  const comun = { id, value: valor, onChange: (e) => onChange(e.target.value) };
  if (campo.tipo === 'lista') {
    return (
      <select {...comun} className={inputCls}>
        <option value="">Ninguna</option>
        {(listas?.[campo.lista] || []).map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
      </select>
    );
  }
  if (campo.tipo === 'ciiu') {
    return <input {...comun} type="text" inputMode="numeric" maxLength={4} pattern="\d{4}" placeholder="Ej. 1071" className={inputCls} />;
  }
  if (campo.tipo === 'sino') {
    return (
      <select {...comun} className={inputCls}>
        <option value="">Sin dato</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (campo.tipo === 'largo') return <textarea {...comun} rows={3} maxLength={5000} className={`${inputCls} resize-y`} />;
  if (campo.tipo === 'fecha') return <input {...comun} type="date" className={inputCls} />;
  if (campo.tipo === 'fechahora') return <input {...comun} type="datetime-local" className={inputCls} />;
  if (campo.tipo === 'entero') return <input {...comun} type="number" min="0" step="1" className={inputCls} />;
  if (campo.tipo === 'numero') return <input {...comun} type="number" step="any" className={inputCls} />;
  return <input {...comun} type="text" maxLength={300} className={inputCls} />;
}

// Muestra el diálogo de edición y envía los cambios.
export default function EditarUP({ idUnico, nombre, session, onCerrar, onGuardado }) {
  const [inicial, setInicial] = useState(null);
  const [valores, setValores] = useState(null);
  const [pestana, setPestana] = useState('up');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [listas, setListas] = useState(null);

  useEffect(() => { cargarListas().then(setListas).catch(() => setListas(null)); }, []);

  useEffect(() => {
    let vivo = true;
    cargarDatosEditables(idUnico, session)
      .then((d) => { if (vivo) { setInicial(d); setValores(structuredClone(d)); } })
      .catch((e) => { if (vivo) setError(e.publicMsg || 'No se pudieron cargar los datos de la unidad.'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [idUnico, session]);

  const cambios = useMemo(() => (inicial && valores ? armarCambios(inicial, valores) : null), [inicial, valores]);
  const pendientes = cambios ? Object.values(cambios).reduce((n, s) => n + Object.keys(s).length, 0) : 0;
  const pest = PESTANAS.find((p) => p.id === pestana);

  function poner(bloque, clave, v) {
    setError('');
    setValores((prev) => ({ ...prev, [bloque]: { ...prev[bloque], [clave]: v } }));
  }

  async function guardar() {
    if (!cambios || !hayCambios(cambios)) return;
    setGuardando(true);
    setError('');
    try {
      await guardarDatosUnidad(idUnico, cambios, session);
      onGuardado?.();
    } catch (e) {
      console.error('[bitacora][E-FICHA-UP] guardar:', e);
      setError(e.publicMsg || 'No se pudo guardar. Revisa los datos e intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" role="dialog"
      aria-modal="true" aria-label="Editar datos de la unidad">
      <div className="my-auto w-full max-w-3xl rounded-card border border-borde bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-borde px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-marino">Editar datos de la unidad</h3>
            <p className="truncate text-xs text-gris">{nombre ? `${nombre} · ` : ''}ID {idUnico}</p>
          </div>
          <button type="button" onClick={onCerrar} className="text-[13px] font-semibold text-gris hover:text-marino">Cerrar</button>
        </div>

        <div role="tablist" aria-label="Datos de la unidad" className="flex gap-1 border-b border-borde px-3">
          {PESTANAS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={pestana === p.id} onClick={() => setPestana(p.id)}
              className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold transition ${
                pestana === p.id ? 'border-marino text-marino' : 'border-transparent text-gris hover:text-marino'
              }`}>
              {p.nombre}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {cargando && <Spinner texto="Cargando datos…" />}
          {!cargando && error && !valores && <Aviso tono="bad">{error}</Aviso>}
          {valores && pest.id === 'expediente' && !valores.expediente && (
            <Aviso>Esta unidad todavía no tiene expediente documental: no hay datos de expediente que editar.</Aviso>
          )}
          {valores && valores[pest.id] && (
            <div className="grid gap-x-4 sm:grid-cols-2">
              {pest.campos.map((c) => {
                const clave = pest.id_campo(c);
                const idCampo = `ed-${pest.id}-${clave}`;
                const cambiado = valores[pest.id][clave] !== inicial[pest.id][clave];
                return (
                  <div key={clave} className={c.tipo === 'largo' ? 'sm:col-span-2' : ''}>
                    <Campo id={idCampo} label={`${c.label}${cambiado ? ' · modificado' : ''}`}>
                      <Entrada campo={c} id={idCampo} valor={valores[pest.id][clave]} listas={listas}
                        onChange={(v) => poner(pest.id, clave, v)} />
                    </Campo>
                  </div>
                );
              })}
            </div>
          )}
          {valores && error && <Aviso tono="bad">{error}</Aviso>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde px-5 py-3.5">
          <span className="text-xs text-gris">
            {pendientes ? `${pendientes} cambio${pendientes === 1 ? '' : 's'} sin guardar` : 'Sin cambios'}
          </span>
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={onCerrar} disabled={guardando}>Cancelar</Btn>
            <Btn onClick={guardar} disabled={!pendientes || guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
