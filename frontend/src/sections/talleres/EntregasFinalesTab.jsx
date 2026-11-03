// Pestaña de entregas finales: el docente asignado ve los grupos que ya terminaron y carga el PDF de cada
// unidad, y la coordinación ve todos los grupos.
import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Boton, Campo, Entrada, Seleccion, Tarjeta, Vacio } from '../../inventario/componentes/ui';
import EntregasFinales from './EntregasFinales';
import { regionIgual } from './fechas';

// Muestra el docente que carga las entregas finales del grupo, por defecto el del último módulo, y la
// coordinación lo puede cambiar.
function Responsable({ taller, talleristas, recargar }) {
  const [sub, setSub] = useState(taller.entrega_final_sub || '');
  const { ejecutar, ocupado } = useAccion(recargar);
  return (
    <form className="mb-4 text-[13px]" onSubmit={(ev) => { ev.preventDefault(); ejecutar(() => apiGeneral.put(`/talleres/${taller.id}/entrega-final-docente`, { tallerista_sub: sub })); }}>
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Docente que carga las entregas finales" className="min-w-0 flex-1 basis-64">
          <Seleccion required value={sub} onChange={(ev) => setSub(ev.target.value)}>
            <option value="">Elige el Tallerista…</option>
            {talleristas.filter((t) => regionIgual(t.region, taller.region)).map((t) => <option key={t.sub} value={t.sub}>{t.nombre}</option>)}
          </Seleccion>
        </Campo>
        <Boton tipo="submit" variante="fantasma" cargando={ocupado} disabled={!sub || sub === taller.entrega_final_sub}>Asignar docente</Boton>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-gris">Por defecto, el del último módulo. Cámbialo si renuncia o no puede.</p>
    </form>
  );
}

const plano = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Busca por nombre de la unidad, código de la iniciativa, representante, documento, nodo y nombre del grupo.
const coincide = (taller, up, q) => !q || plano([up.nombre, up.id_unico, up.representante, up.documento, up.nodo, taller.nombre, taller.grupo_nombre].join(' ')).includes(q);

// Muestra los grupos terminados con sus entregas finales.
export default function EntregasFinalesTab({ datos, recargar }) {
  const coordina = datos.puede_programar;
  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState('todas');
  const todos = datos.talleres.filter((t) => t.puede_entregar && (coordina || t.grupo_completo));
  const q = plano(busca.trim());
  const conEntrega = (t) => new Set(t.entregas_finales.map((f) => f.id_up));
  const grupos = todos.map((t) => {
    const hechas = conEntrega(t);
    const visibles = t.participantes.filter((up) => coincide(t, up, q) && (estado === 'todas' || (estado === 'sin' ? !hechas.has(up.id_up) : hechas.has(up.id_up))));
    return { t, visibles };
  }).filter(({ t, visibles }) => (!q && estado === 'todas') || (t.grupo_completo && visibles.length));
  const filtrando = Boolean(q) || estado !== 'todas';
  if (!todos.length) {
    return <Tarjeta><Vacio icono={PackageCheck}>{coordina ? 'Aún no hay grupos programados.' : 'Aquí aparecerán los grupos cuya entrega final te asignen, cuando terminen sus tres módulos.'}</Vacio></Tarjeta>;
  }
  return (
    <div className="grid gap-4">
      <Tarjeta>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:items-end">
          <Campo etiqueta="Buscar">
            <Entrada type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ej.: Tienda, 1045000001, Atlántico…" />
          </Campo>
          <Campo etiqueta="Mostrar">
            <Seleccion value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todas">Todas las UP</option>
              <option value="sin">Sin entrega final</option>
              <option value="con">Con entrega final</option>
            </Seleccion>
          </Campo>
          <Boton variante="fantasma" disabled={!filtrando} onClick={() => { setBusca(''); setEstado('todas'); }}>Limpiar filtros</Boton>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-gris">Busca por nombre de la iniciativa (UP), código, representante, documento, nodo o grupo.</p>
      </Tarjeta>
      {!grupos.length && <Tarjeta><Vacio icono={PackageCheck}>Ninguna UP coincide con la búsqueda{estado === 'sin' ? ' entre las que no tienen entrega final' : ''}.</Vacio></Tarjeta>}
      {grupos.map(({ t, visibles }) => (
        <EntregasFinales key={t.id} taller={t} recargar={recargar} puedeReemplazar={coordina} visibles={filtrando ? visibles : null}
          encabezado={coordina ? <Responsable taller={t} talleristas={datos.talleristas} recargar={recargar} /> : null} />
      ))}
    </div>
  );
}
