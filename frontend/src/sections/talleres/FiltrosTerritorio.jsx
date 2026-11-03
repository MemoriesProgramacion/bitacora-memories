// Filtros de territorio de los talleres por departamento, nodo y municipio. Se filtra por dónde están las
// unidades convocadas: un taller entra si alguna de sus unidades cumple. Las opciones dependen de lo que ya se
// eligió.
import { MapPin } from 'lucide-react';
import { Boton, Campo, Seleccion, Tarjeta } from '../../inventario/componentes/ui';

// Estado inicial del filtro, sin ningún campo elegido.
export const FILTRO_VACIO = { departamento: '', nodo: '', municipio: '' };
const CAMPOS = [['departamento', 'Departamento', 'Todos los departamentos'], ['nodo', 'Nodo', 'Todos los nodos'], ['municipio', 'Municipio', 'Todos los municipios']];

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
export const hayFiltro = (f) => Boolean(f.departamento || f.nodo || f.municipio);
// Indica si una ubicación con departamento, nodo y municipio coincide en cada campo elegido.
export const cumple = (u, f) => Boolean(u) && CAMPOS.every(([c]) => !f[c] || norm(u[c]) === norm(f[c]));
export const algunaCumple = (ubicaciones, f) => !hayFiltro(f) || (ubicaciones || []).some((u) => cumple(u, f));

function opciones(territorio, f, campo) {
  const unicas = new Map();
  for (const t of territorio) if (t[campo] && cumple(t, { ...f, [campo]: '' })) unicas.set(norm(t[campo]), t[campo]);
  return [...unicas.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

// Cambia un campo y suelta los otros que ya no existen con esa combinación, por ejemplo un nodo de otro
// departamento.
export function cambiarFiltro(territorio, filtro, campo, valor) {
  let f = { ...filtro, [campo]: valor };
  for (const [c] of CAMPOS) {
    if (c !== campo && f[c] && !opciones(territorio, f, c).some((o) => norm(o) === norm(f[c]))) f = { ...f, [c]: '' };
  }
  return f;
}

// Suelta los campos que no existen en el territorio dado, por ejemplo al cambiar de región en el formulario de
// grupo.
export function ajustarFiltro(territorio, filtro) {
  let f = filtro;
  for (const [c] of CAMPOS) if (f[c] && !opciones(territorio, f, c).some((o) => norm(o) === norm(f[c]))) f = { ...f, [c]: '' };
  return f;
}

// Muestra los tres selectores en una fila; compacto los muestra sin tarjeta, dentro de un formulario.
export function SelectoresTerritorio({ territorio, filtro, onCambiar, compacto = false }) {
  return <div className={`grid gap-3 ${compacto ? 'sm:grid-cols-3' : 'sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end'}`}>
    {CAMPOS.map(([c, etiqueta, todos]) => <Campo key={c} etiqueta={etiqueta}>
      <Seleccion value={filtro[c]} onChange={(e) => onCambiar(cambiarFiltro(territorio, filtro, c, e.target.value))}>
        <option value="">{todos}</option>
        {opciones(territorio, filtro, c).map((o) => <option key={o} value={o}>{o}</option>)}
      </Seleccion>
    </Campo>)}
    {!compacto && <Boton variante="fantasma" disabled={!hayFiltro(filtro)} onClick={() => onCambiar(FILTRO_VACIO)}>Limpiar filtros</Boton>}
  </div>;
}

// Muestra los filtros de territorio dentro de una tarjeta.
export default function FiltrosTerritorio({ territorio, filtro, onCambiar, resumen }) {
  return <Tarjeta className="mb-4">
    <div className="grid gap-2">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-marino"><MapPin size={15} aria-hidden="true" /> Filtrar por territorio de las UP</p>
      <SelectoresTerritorio territorio={territorio} filtro={filtro} onCambiar={onCambiar} />
      {resumen && <p aria-live="polite" className="text-[12px] leading-snug text-gris">{resumen}</p>}
    </div>
  </Tarjeta>;
}
