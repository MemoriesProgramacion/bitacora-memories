// Sección de entregas: contenedor de apartados en pestañas. Qué pestañas ve cada tipo de cuenta lo define
// vistasEntregas() en lib/permisos.js. Los apartados son reagendamientos por confirmar, lista de compras,
// logística, cronograma de entregas, ruta, defectuosos, registro fotográfico y validador.
import { useState, useMemo } from 'react';
import { vistasEntregas } from '../lib/permisos';
import { useBarraDeslizable } from '../components/UI';
import Validador from './Validador';
import Reagendamientos from './entregas/Reagendamientos';
import ListaCompras from './entregas/ListaCompras';
import Logistica from './entregas/Logistica';
import CronogramaEntregas from './entregas/CronogramaEntregas';
import PrevisionPriorizacion from './entregas/PrevisionPriorizacion';
import Defectuosos from './entregas/Defectuosos';
import RegistroFotografico from './RegistroFotografico';

// Apartados de la sección de entregas.
const TABS = [
  { id: 'reagenda',  label: 'Reagendamientos' },
  { id: 'compras',   label: 'Lista de compras' },
  { id: 'logistica', label: 'Logística' },
  { id: 'defectuosos', label: 'Elementos defectuosos' },
  { id: 'crono',     label: 'Cronograma de entregas' },
  { id: 'prevision', label: 'Ruta' },
  { id: 'validador', label: 'Validador de entregas' },
  { id: 'registrofoto',   label: 'Registro fotográfico' },
];

// Muestra las pestañas permitidas y el apartado activo.
export default function Entregas({ data, session }) {
  const permitidas = useMemo(() => {
    const v = vistasEntregas(session);
    if (session?.role === 'coordinador_compras') return v;
    if (session?.soloLectura) return v;
    return [...v, 'validador', 'registrofoto'];
  }, [session]);

  const tabs = TABS.filter((t) => permitidas.includes(t.id));
  const [vista, setVista] = useState(tabs[0]?.id || 'validador');
  const activa = permitidas.includes(vista) ? vista : tabs[0]?.id;
  const barra = useBarraDeslizable(activa);

  return (
    <div>
      <div ref={barra} className="barra-deslizable no-scrollbar mb-4 flex gap-0.5 overflow-x-auto border-b border-borde sm:mb-5">
        {tabs.map((t) => (
          <button
            key={t.id} type="button" onClick={() => setVista(t.id)} data-activa={activa === t.id}
            className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2.5 text-[13px] font-semibold transition sm:px-4 ${
              activa === t.id
                ? 'border-acento text-marino'
                : 'border-transparent text-gris hover:text-texto'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activa === 'reagenda'  && <Reagendamientos session={session} />}
      {activa === 'compras'   && <ListaCompras data={data} session={session} />}
      {activa === 'logistica' && <Logistica data={data} session={session} />}
      {activa === 'defectuosos' && <Defectuosos />}
      {activa === 'crono'     && <CronogramaEntregas data={data} session={session} />}
      {activa === 'prevision' && (
        <PrevisionPriorizacion
          data={data} session={session}
          onIrValidador={() => setVista('validador')}
        />
      )}
      {activa === 'validador' && <Validador data={data} />}
      {activa === 'registrofoto' && <RegistroFotografico session={session} />}
    </div>
  );
}
