// Seguimiento, indicadores y reportes. Todo sale de la operación registrada en la plataforma y no del cargue de
// Excel: el panel con los indicadores contra las metas, la ruta de 12 pasos por unidad, las alertas, la
// formación, los informes, el tablero de evaluación, las metas, los casos, la gestión comercial y lo
// multimedia.
import { lazy, Suspense, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Camera, FileBarChart, GraduationCap, Handshake, Route, Target, TrendingUp, Trophy } from 'lucide-react';
import { useBarraDeslizable } from '../components/UI';
import Encabezado from '../inventario/componentes/Encabezado';
import { Cargando, Tarjeta } from '../inventario/componentes/ui';
import { pestanaPorTecla, pestanasSeguimiento } from '../lib/seguimiento';

const Panel = lazy(() => import('./seguimiento/Panel'));
const Ruta = lazy(() => import('./seguimiento/Ruta'));
const Alertas = lazy(() => import('./seguimiento/Alertas'));
const Formacion = lazy(() => import('./seguimiento/Formacion'));
const Informes = lazy(() => import('./seguimiento/Informes'));
const TableroEvaluacion = lazy(() => import('../components/TableroEvaluacion'));
const Metas = lazy(() => import('./seguimiento/Metas'));
const Casos = lazy(() => import('./seguimiento/Casos'));
const Comercial = lazy(() => import('./seguimiento/Comercial'));
const Multimedia = lazy(() => import('./seguimiento/Multimedia'));

// Pestañas de seguimiento.
const PESTANAS = {
  panel: ['Panel', BarChart3],
  ruta: ['Ruta por unidad', Route],
  alertas: ['Alertas', AlertTriangle],
  formacion: ['Formación 80 %', GraduationCap],
  salida: ['Indicadores de salida', TrendingUp],
  informes: ['Informes', FileBarChart],
  metas: ['Metas', Target],
  casos: ['Casos de éxito', Trophy],
  comercial: ['Gestión comercial', Handshake],
  multimedia: ['Fotos y videos', Camera],
};

// Devuelve el id de cada pestaña y de su panel, con el patrón de pestañas de WAI-ARIA; solo se pinta el panel
// de la pestaña activa.
const idTab = (id) => `seguimiento-tab-${id}`;
const idPanel = (id) => `seguimiento-panel-${id}`;

// Muestra las pestañas permitidas y el panel activo.
export default function Seguimiento({ data = [], session }) {
  const ids = pestanasSeguimiento(session);
  const [elegida, setPestana] = useState(ids[0]);
  const pestana = ids.includes(elegida) ? elegida : ids[0];
  const barra = useBarraDeslizable(pestana);
  const filas = useMemo(() => data.filter((f) => f.habilitadas !== '0'), [data]);
  const conTeclado = (e) => {
    const destino = pestanaPorTecla(ids, pestana, e.key);
    if (!destino) return;
    e.preventDefault();
    setPestana(destino);
    document.getElementById(idTab(destino))?.focus();
  };

  return (
    <>
      <Encabezado
        titulo="Seguimiento"
        descripcion="Indicadores, avance de la ruta, alertas e informes calculados con lo que registra la plataforma."
      />
      <div ref={barra} className="barra-deslizable no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl bg-lienzo p-1" role="tablist" aria-label="Seguimiento">
        {ids.map((id) => {
          const [texto, Icono] = PESTANAS[id];
          return (
            <button
              key={id}
              id={idTab(id)}
              type="button"
              role="tab"
              data-activa={pestana === id}
              aria-selected={pestana === id}
              aria-controls={pestana === id ? idPanel(id) : undefined}
              tabIndex={pestana === id ? 0 : -1}
              onClick={() => setPestana(id)}
              onKeyDown={conTeclado}
              className={`flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                pestana === id ? 'bg-card text-marca shadow-sm' : 'text-gris-txt hover:text-marca'
              }`}
            >
              <Icono size={16} aria-hidden="true" /> {texto}
            </button>
          );
        })}
      </div>
      {pestana && (
        <div role="tabpanel" id={idPanel(pestana)} aria-labelledby={idTab(pestana)} tabIndex={0} className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-acento">
          <Suspense fallback={<Cargando />}>
            {pestana === 'panel' && <Panel />}
            {pestana === 'ruta' && <Ruta />}
            {pestana === 'alertas' && <Alertas />}
            {pestana === 'formacion' && <Formacion />}
            {pestana === 'salida' && <Tarjeta titulo="Línea base, salida y variación por unidad"><TableroEvaluacion /></Tarjeta>}
            {pestana === 'informes' && <Informes session={session} />}
            {pestana === 'metas' && <Metas />}
            {pestana === 'casos' && <Casos filas={filas} />}
            {pestana === 'comercial' && <Comercial filas={filas} />}
            {pestana === 'multimedia' && <Multimedia />}
          </Suspense>
        </div>
      )}
    </>
  );
}
