// Calendario de los talleres: muestra los módulos programados y las convocatorias de la coordinación por día,
// con la opción de cambiar de mes y de vista.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Boton, Tarjeta, Vacio } from '../../inventario/componentes/ui';
import { diaColombia, diasCalendario, fechaColombia, moverMes } from './fechas';

// Arma los eventos de talleres y convocatorias, y los muestra en la vista de día o de mes.
export default function Calendario({ talleres, convocatorias, onSeleccionar }) {
  const hoy = diaColombia(new Date().toISOString());
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [dia, setDia] = useState(hoy);
  const [vista, setVista] = useState('dia');
  const items = useMemo(() => [
    ...talleres.flatMap((t) => t.encuentros.map((e) => ({ id: `t-${e.id}`, titulo: t.nombre, inicio: e.inicio,
      fin: new Date(new Date(e.inicio).getTime() + 180 * 60_000).toISOString(), taller: t, encuentro: e, lugar: t.lugar,
      subtitulo: `${t.grupo_nombre || 'Grupo'} · Módulo ${e.modulo}`, realizado: Boolean(e.realizado_en) }))),
    ...convocatorias.filter((e) => e.fecha).map((e) => ({ id: `c-${e.id}`, titulo: e.titulo,
      inicio: `${e.fecha}T${e.hora || '00:00'}-05:00`, subtitulo: 'Convocatoria de coordinación', lugar: e.lugar, convocatoria: e })),
  ].filter((e) => !Number.isNaN(new Date(e.inicio).getTime())).sort((a,b) => new Date(a.inicio) - new Date(b.inicio)), [talleres, convocatorias]);
  const pasados = (e) => new Date(e.fin || e.inicio).getTime() < Date.now();
  const delDia = items.filter((e) => diaColombia(e.inicio) === dia);
  const lista = vista === 'dia' ? delDia : vista === 'proximos' ? items.filter((e) => !pasados(e)) : items.filter(pasados).reverse();
  const tituloMes = new Date(`${mes}-01T12:00:00-05:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  function cambiarMes(delta) { const m = moverMes(mes, delta); setMes(m); setDia(`${m}-01`); setVista('dia'); }
  return <div className="grid min-w-0 gap-4">
    <Tarjeta>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 aria-live="polite" className="text-base font-bold capitalize text-marino">{tituloMes}</h3>
        <div className="flex gap-1"><Boton variante="fantasma" icono={ChevronLeft} aria-label="Mes anterior" onClick={() => cambiarMes(-1)} /><Boton variante="fantasma" onClick={() => { setMes(hoy.slice(0,7)); setDia(hoy); setVista('dia'); }}>Hoy</Boton><Boton variante="fantasma" icono={ChevronRight} aria-label="Mes siguiente" onClick={() => cambiarMes(1)} /></div>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-borde">
        {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d) => <div key={d} className="border-b border-r border-borde py-2 text-center text-xs font-semibold text-gris-txt">{d}</div>)}
        {diasCalendario(mes).map((d) => {
          const eventos = items.filter((e) => diaColombia(e.inicio) === d);
          return <div key={d} className={`min-w-0 border-b border-r border-borde p-1 sm:min-h-24 sm:p-2 ${d === dia ? 'bg-marino/10' : d.startsWith(mes) ? '' : 'bg-lienzo text-gris'}`}>
            <button type="button" aria-label={`${d}, ${eventos.length} eventos`} aria-pressed={d === dia} onClick={() => { setDia(d); setVista('dia'); }}
              className={`flex min-h-10 w-full items-center justify-center gap-1 rounded-md text-xs font-semibold sm:min-h-7 sm:justify-start ${d === hoy ? 'font-bold text-acento-txt underline' : 'text-marino'} hover:bg-marino/10`}>
              {Number(d.slice(-2))}{eventos.length > 0 && <span className="rounded-full bg-marino px-1.5 text-[10px] text-white">{eventos.length}</span>}
            </button>
            <div className="hidden gap-1 sm:grid">{eventos.slice(0,2).map((e) => <button type="button" key={e.id} title={`${e.titulo} · ${e.subtitulo}`} onClick={() => onSeleccionar(e)}
              className={`truncate rounded px-1 py-1 text-left text-[11px] ${e.realizado ? 'bg-verde-ok/10 text-verde-ok' : 'bg-marino/10 text-marino'} hover:underline`}>{e.taller ? `M${e.encuentro.modulo} · ` : ''}{e.titulo}</button>)}</div>
          </div>;
        })}
      </div>
      <p className="mt-3 text-xs text-gris-txt">Hora de Colombia. Selecciona un día para ver sus eventos o un módulo para abrir su contenido.</p>
    </Tarjeta>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar eventos">
      {[['dia', `Día ${dia.split('-').reverse().join('/')}`],['proximos',`Próximos (${items.filter((e) => !pasados(e)).length})`],['pasados',`Pasados (${items.filter(pasados).length})`]].map(([id, nombre]) => <Boton key={id} variante={vista === id ? undefined : 'fantasma'} aria-pressed={vista === id} onClick={() => setVista(id)}>{nombre}</Boton>)}
    </div>
    {!lista.length ? <Tarjeta><Vacio icono={CalendarDays}>No hay eventos {vista === 'dia' ? 'para este día' : vista === 'pasados' ? 'pasados' : 'próximos'}.</Vacio></Tarjeta> : lista.map((e) => <Tarjeta key={e.id} titulo={e.titulo}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="grid gap-1 text-[13px] text-gris-txt"><p>{fechaColombia(e.inicio)}</p><p>{e.subtitulo} · {e.lugar || 'Lugar por confirmar'}{e.realizado ? ' · Realizado' : ''}</p></div><Boton variante="fantasma" onClick={() => onSeleccionar(e)}>{e.taller ? 'Abrir módulo y contenido' : 'Ver convocatoria'}</Boton></div>
    </Tarjeta>)}
  </div>;
}
