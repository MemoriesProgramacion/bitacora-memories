// Sección de novedades con pestañas: avisos, tickets, retiros y reemplazos, y unidades. Cada pestaña la ve el
// tipo de cuenta que corresponde.
import { useState } from 'react';
import Avisos from './Avisos';
import Tickets, { useTickets, requiereAccion } from './Tickets';
import Retiros from './novedades/Retiros';
import Unidades from './novedades/Unidades';
import { esAdmin } from '../lib/permisos';

// Tipos de cuenta que ven la pestaña de retiros y reemplazos de unidades: la coordinación los registra y otra
// cuenta los consulta.
const VE_RETIROS = ['coordinador', 'superadmin', 'coordinador_datos', 'tecnico_administrativo'];

// Muestra las pestañas permitidas y la vista elegida.
export default function Novedades({ session }) {
  const [vista, setVista] = useState('avisos');
  const { tickets, cargando, error, guardarLocal } = useTickets(session);
  const porAtender = tickets.filter(requiereAccion).length;

  const vistas = [
    { id: 'avisos', nombre: 'Avisos' },
    { id: 'tickets', nombre: 'Tickets', n: porAtender },
    ...(VE_RETIROS.includes(session?.role) ? [{ id: 'retiros', nombre: 'Retiros y reemplazos' }] : []),
    ...(esAdmin(session) ? [{ id: 'unidades', nombre: 'Unidades' }] : []),
  ];

  return (
    <>
      <div role="tablist" aria-label="Novedades" className="mb-4 flex gap-1 border-b border-borde">
        {vistas.map((v) => {
          const act = vista === v.id;
          return (
            <button key={v.id} type="button" role="tab" aria-selected={act} onClick={() => setVista(v.id)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-[13px] font-semibold transition ${
                act ? 'border-marino text-marino' : 'border-transparent text-gris hover:text-marino'
              }`}>
              {v.nombre}
              {v.n > 0 && <span className="rounded-full bg-acento px-1.5 text-[10px] text-marino">{v.n}</span>}
            </button>
          );
        })}
      </div>
      {vista === 'avisos' && <Avisos />}
      {vista === 'tickets' && <Tickets session={session} tickets={tickets} cargando={cargando} error={error} guardarLocal={guardarLocal} />}
      {vista === 'retiros' && <Retiros session={session} />}
      {vista === 'unidades' && esAdmin(session) && <Unidades />}
    </>
  );
}
