// Grupos de unidades productivas de los talleres: se crean con un nombre, una región y las unidades elegidas
// mediante una búsqueda con filtros de territorio.
import { useEffect, useState } from 'react';
import { Pencil, Plus, Save, Search, Trash2, Users } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Alerta, Boton, Campo, Entrada, Seleccion, Tarjeta, Vacio } from '../../inventario/componentes/ui';
import { FILTRO_VACIO, SelectoresTerritorio, ajustarFiltro, hayFiltro } from './FiltrosTerritorio';
import { regionIgual } from './fechas';

// Muestra una unidad con su código, nombre, representante, documento y nodo.
export function EtiquetaUP({ up }) {
  return <span className="min-w-0"><strong className="block break-words">{up.id_unico || up.id_up} · {up.nombre || 'UP sin nombre'}</strong>
    <span className="block text-xs text-gris-txt">{up.representante || 'Sin representante'}{up.documento ? ` · ${up.documento}` : ''} · {up.nodo}{up.municipio ? ` · ${up.municipio}` : ''}</span></span>;
}

// Formulario para crear o editar un grupo con búsqueda de unidades por región y territorio.
function FormGrupo({ grupo, datos, filtroInicial, ocupado, onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState(grupo?.nombre || '');
  const [region, setRegion] = useState(grupo?.region || (datos.regiones.length === 1 ? datos.regiones[0] : ''));
  const [seleccion, setSeleccion] = useState(grupo?.ups || []);
  const [buscar, setBuscar] = useState('');
  const [territorio, setTerritorio] = useState(filtroInicial || FILTRO_VACIO);
  const opcionesTerritorio = (datos.territorio_ups || []).filter((t) => !region || regionIgual(t.region, region));
  const [resultado, setResultado] = useState({ items: [], hay_mas: false });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setResultado({ items: [], hay_mas: false }); setError('');
    if (!region) return;
    const abort = new AbortController();
    setCargando(true);
    const timer = setTimeout(() => {
      apiGeneral.get(`/talleres/ups${qs({ buscar, region, ...territorio })}`, { signal: abort.signal })
        .then((r) => { if (!abort.signal.aborted) setResultado(r); })
        .catch((e) => { if (!abort.signal.aborted) setError(e.message); })
        .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [buscar, region, territorio]);
  return <form onSubmit={(ev) => { ev.preventDefault(); onGuardar({ nombre, region, ups: seleccion.map((up) => up.id_up) }); }}>
    <fieldset disabled={ocupado} className="grid min-w-0 gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre del grupo de UP" obligatorio><Entrada required maxLength={150} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        <Campo etiqueta="Región" obligatorio><Seleccion required value={region} onChange={(e) => { const r = e.target.value; setRegion(r); setSeleccion([]); setTerritorio((f) => ajustarFiltro((datos.territorio_ups || []).filter((t) => !r || regionIgual(t.region, r)), f)); }}>
          <option value="">Elige una región…</option>{datos.regiones.map((r) => <option key={r}>{r}</option>)}
        </Seleccion></Campo>
      </div>
      <Campo etiqueta="Buscar UP de la región" ayuda="Busca por código, nombre de la UP, documento, representante, municipio o nodo.">
        <div className="relative"><Search size={16} className="absolute left-3 top-3 text-gris" aria-hidden="true" /><Entrada className="pl-9" disabled={!region} maxLength={100} value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar una unidad productiva…" /></div>
      </Campo>
      {datos.filtros_territorio && <SelectoresTerritorio compacto territorio={opcionesTerritorio} filtro={territorio} onCambiar={setTerritorio} />}
      {error && <Alerta tono="error">{error}</Alerta>}
      <div aria-live="polite" className="text-[13px] text-gris-txt">{cargando ? 'Buscando UP…' : !region ? 'Selecciona la región para consultar sus UP.' : resultado.hay_mas ? 'Se muestran 50 resultados. Escribe más datos para encontrar la UP.' : `${resultado.items.length} UP encontradas.`}</div>
      <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
        {resultado.items.map((up) => {
          const elegida = seleccion.some((s) => s.id_up === up.id_up);
          return <label key={up.id_up} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 text-[13px] ${elegida ? 'border-marino bg-marino/5' : 'border-borde'}`}>
            <input type="checkbox" className="mt-1" checked={elegida} disabled={!elegida && seleccion.length >= 40} onChange={(e) => setSeleccion((prev) => e.target.checked ? [...prev, up] : prev.filter((u) => u.id_up !== up.id_up))} />
            <EtiquetaUP up={up} />
          </label>;
        })}
      </div>
      <div className="border-t border-borde pt-4">
        <h3 className="mb-2 text-sm font-semibold text-marino">UP del grupo · {seleccion.length}/40</h3>
        <p className="mb-3 text-[13px] text-gris-txt">Cada UP cuenta como un cupo del grupo. Este grupo se podrá elegir al programar los módulos.</p>
        <ul className="grid gap-2">{seleccion.map((up) => <li key={up.id_up} className="flex items-center justify-between gap-2 rounded-lg border border-borde p-3 text-[13px]">
          <EtiquetaUP up={up} /><Boton variante="fantasma" icono={Trash2} aria-label={`Quitar UP ${up.id_unico || up.id_up}`} onClick={() => setSeleccion((prev) => prev.filter((u) => u.id_up !== up.id_up))} />
        </li>)}</ul>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4"><Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton><Boton tipo="submit" icono={Save} cargando={ocupado} disabled={!seleccion.length}>Guardar grupo de UP</Boton></div>
    </fieldset>
  </form>;
}

// Muestra la lista de grupos con sus acciones.
export default function GruposUP({ datos, filtro = null, recargar, onProgramar }) {
  const [form, setForm] = useState(null);
  const { ejecutar, ocupado } = useAccion(recargar);
  if (form) return <Tarjeta titulo={form.id ? 'Editar grupo de UP' : 'Nuevo grupo de UP'}><FormGrupo grupo={form} datos={datos} filtroInicial={form.id ? null : filtro} ocupado={ocupado} onCancelar={() => setForm(null)} onGuardar={async (d) => {
    const r = await ejecutar(() => form.id ? apiGeneral.put(`/talleres/grupos/${form.id}`, d) : apiGeneral.post('/talleres/grupos', d));
    if (r) setForm(null);
  }} /></Tarjeta>;
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-gris-txt">Agrupa hasta 40 UP de una misma región. Las UP pueden pertenecer a distintos nodos de esa región.</p><Boton icono={Plus} disabled={!datos.regiones.length} onClick={() => setForm({})}>Crear grupo de UP</Boton></div>
    {!datos.grupos.length && <Tarjeta><Vacio icono={Users}>{filtro && hayFiltro(filtro) ? 'Ningún grupo tiene UP en el territorio elegido.' : 'Todavía no hay grupos. Crea uno seleccionando las UP registradas en tu región.'}</Vacio></Tarjeta>}
    {datos.grupos.map((g) => <Tarjeta key={g.id} titulo={g.nombre} acciones={<span className="text-[13px] text-gris-txt">{g.ups.length}/40 UP</span>}>
      <p className="mb-3 text-[13px] text-gris-txt">{g.region}{g.utilizado ? ' · Con módulos programados' : ''}</p>
      <details className="mb-3 text-[13px]"><summary className="cursor-pointer font-semibold text-marino">Ver UP del grupo</summary><ul className="mt-3 grid gap-3 sm:grid-cols-2">{g.ups.map((up) => <li key={up.id_up}><EtiquetaUP up={up} /></li>)}</ul></details>
      <div className="flex flex-wrap gap-2">{g.editable && <Boton variante="fantasma" icono={Pencil} onClick={() => setForm(g)}>Editar grupo</Boton>}<Boton onClick={() => onProgramar(g)}>Programar módulos</Boton></div>
    </Tarjeta>)}
  </div>;
}
