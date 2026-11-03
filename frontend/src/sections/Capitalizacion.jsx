// Capitalización con el carrito de compras interno. Aquí se arma el carrito de cada iniciativa con los
// productos del catálogo dentro de su presupuesto. La tienda muestra el catálogo y el carrito de la iniciativa
// elegida, carritos el seguimiento de todos, comité las sesiones de aprobación y legalización los planes
// aprobados frente a sus facturas.
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileCheck2, Gavel, Package, Receipt, Store } from 'lucide-react';
import { useBarraDeslizable } from '../components/UI';
import Encabezado from '../inventario/componentes/Encabezado';
import CatalogoAdmin from './capitalizacion/CatalogoAdmin';
import Carritos from './capitalizacion/Carritos';
import Tienda from './capitalizacion/Tienda';
import PlanCapitalizacion from './capitalizacion/PlanCapitalizacion';
import Comite from './capitalizacion/Comite';
import Legalizacion from './capitalizacion/Legalizacion';

// Muestra las pestañas de capitalización según los permisos de la cuenta.
export default function Capitalizacion({ data, session }) {
  const esCoordinacion = ['coordinador', 'superadmin', 'coordinador_datos'].includes(session.role);
  const [pestana, setPestana] = useState('tienda');
  const [idUnico, setIdUnico] = useState('');
  const barra = useBarraDeslizable(pestana);

  const filas = useMemo(() => data.filter((f) => f.habilitadas !== '0'), [data]);

  useEffect(() => {
    if (!idUnico && filas.length === 1) setIdUnico(filas[0].ID_unico);
  }, [filas, idUnico]);

  const pestanas = [
    ['tienda', 'Tienda', Store],
    ['plan', 'Plan de capitalización', FileCheck2],
    ['carritos', 'Carritos', ClipboardList],
    ['comite', 'Comité', Gavel],
    ['legalizacion', 'Legalización', Receipt],
    ...(esCoordinacion ? [['catalogo', 'Catálogo', Package]] : []),
  ];

  const abrirCarrito = (id) => { setIdUnico(id); setPestana('tienda'); };

  return (
    <>
      <Encabezado
        titulo="Capitalización"
        descripcion="Arma el carrito de compras de cada iniciativa con los productos del catálogo, dentro de su presupuesto."
      />

      <div ref={barra} className="barra-deslizable no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl bg-lienzo p-1" role="tablist" aria-label="Capitalización">
        {pestanas.map(([id, texto, Icono]) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-activa={pestana === id}
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className={`flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-[14px] font-semibold transition-colors ${
              pestana === id ? 'bg-card text-marca shadow-sm' : 'text-gris-txt hover:text-marca'
            }`}
          >
            <Icono size={16} aria-hidden="true" /> {texto}
          </button>
        ))}
      </div>

      {pestana === 'tienda' && <Tienda filas={filas} idUnico={idUnico} onElegir={(f) => setIdUnico(f.ID_unico)} />}
      {pestana === 'plan' && <PlanCapitalizacion filas={filas} idUnico={idUnico} onElegir={(f) => setIdUnico(f.ID_unico)} />}
      {pestana === 'carritos' && <Carritos filas={filas} onAbrir={abrirCarrito} />}
      {pestana === 'comite' && <Comite session={session} />}
      {pestana === 'legalizacion' && <Legalizacion />}
      {pestana === 'catalogo' && esCoordinacion && <CatalogoAdmin session={session} />}
    </>
  );
}
