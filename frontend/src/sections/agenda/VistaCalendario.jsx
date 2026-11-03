// Vistas de calendario de la agenda: semana y día, con una rejilla de horas, y mes. Solo dibujan las citas que
// reciben; abrir, crear o mover una cita lo decide la agenda.
import { useEffect, useMemo, useRef } from 'react';
import {
  DIAS_CORTOS, ESTADOS, TIPOS, claveDia, distribuir, horaCorta, horaTexto, inicioDeDia, inicioSemana,
  mismoDia, sumarDias,
} from '../../lib/agenda';

// Alto en píxeles de cada hora de la rejilla.
const PX_HORA = 80;
const HORA_MIN = 7;
const HORA_MAX = 19;

// Muestra una cita como un bloque de color con la hora, la iniciativa y el número.
function Bloque({ cita, estilo, onAbrir, compacto }) {
  const e = ESTADOS[cita.estado];
  const Icono = TIPOS[cita.tipo]?.icono;
  const cancelada = cita.estado === 'cancelada';
  return (
    <button
      type="button"
      onClick={(ev) => { ev.stopPropagation(); onAbrir(cita); }}
      title={`${horaTexto(cita.ini)} · ${cita.up_nombre || cita.id_unico}${cita.telefono ? ` · ${cita.telefono}` : ''}`}
      className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-[filter] hover:brightness-95 focus-visible:z-20 ${cancelada ? 'opacity-60' : ''}`}
      style={{ ...estilo, background: e.fondo, borderLeftColor: e.borde }}
    >
      <span className={`flex items-center gap-1 font-semibold text-marca ${cancelada ? 'line-through' : ''}`}>
        {Icono && !compacto && <Icono size={11} aria-hidden="true" className="shrink-0" />}
        <span className="cifras shrink-0">{compacto ? horaCorta(cita.ini) : horaTexto(cita.ini)}</span>
        {compacto && <span className="truncate font-medium">{cita.up_nombre || cita.id_unico}</span>}
      </span>
      {!compacto && <span className={`block truncate font-medium text-marca ${cancelada ? 'line-through' : ''}`}>{cita.up_nombre || cita.id_unico}</span>}
      {!compacto && cita.telefono && <span className="cifras block truncate text-gris-txt">{cita.telefono}</span>}
    </button>
  );
}

// Muestra la semana, de 7 columnas, o el día, de una, con la rejilla de horas y las citas acomodadas.
export function VistaSemana({ fecha, dias: cuantos, citas, onAbrir, onHueco }) {
  const hoy = new Date();
  const dias = useMemo(() => (cuantos === 7
    ? Array.from({ length: 7 }, (_, i) => sumarDias(inicioSemana(fecha), i))
    : [inicioDeDia(fecha)]), [fecha, cuantos]);

  const porDia = useMemo(() => dias.map((d) => citas.filter((c) => mismoDia(c.ini, d))), [dias, citas]);

  const { desde, hasta } = useMemo(() => {
    const todas = porDia.flat();
    const minimo = Math.min(HORA_MIN, ...todas.map((c) => c.ini.getHours()));
    const maximo = Math.max(HORA_MAX, ...todas.map((c) => Math.ceil((c.fin.getHours() * 60 + c.fin.getMinutes()) / 60)));
    return { desde: minimo, hasta: Math.min(24, maximo) };
  }, [porDia]);

  const alto = (hasta - desde) * PX_HORA;
  const horas = Array.from({ length: hasta - desde }, (_, i) => desde + i);
  const contenedor = useRef(null);

  useEffect(() => {
    const todas = porDia.flat();
    const primera = todas.length ? Math.min(...todas.map((c) => c.ini.getHours())) : 8;
    if (contenedor.current) contenedor.current.scrollTop = Math.max(0, (Math.min(primera, 8) - desde) * PX_HORA);
  }, [porDia, desde]);

  const columnas = `52px repeat(${dias.length}, minmax(${dias.length === 7 ? 92 : 200}px, 1fr))`;

  const clicEnHueco = (dia) => (e) => {
    const caja = e.currentTarget.getBoundingClientRect();
    const minutos = Math.floor((((e.clientY - caja.top) / PX_HORA) * 60) / 30) * 30;
    const d = new Date(dia);
    d.setHours(desde, minutos, 0, 0);
    if (onHueco) onHueco(d);
  };

  return (
    <div ref={contenedor} className="max-h-[68vh] overflow-auto rounded-lg border border-borde bg-card">
      <div style={{ minWidth: dias.length === 7 ? 52 + 7 * 92 : 0 }}>
        <div className="sticky top-0 z-10 grid border-b border-borde bg-card" style={{ gridTemplateColumns: columnas }}>
          <div />
          {dias.map((d, i) => {
            const esHoy = mismoDia(d, hoy);
            const n = porDia[i].filter((c) => c.estado === 'agendada').length;
            return (
              <div key={claveDia(d)} className="border-l border-borde px-2 py-2 text-center">
                <div className="text-[11px] font-medium uppercase text-gris-txt">{DIAS_CORTOS[(d.getDay() + 6) % 7]}</div>
                <div className={`mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-[15px] font-bold ${esHoy ? 'bg-acento text-marino' : 'text-marca'}`}>
                  {d.getDate()}
                </div>
                <div className="mt-0.5 text-[11px] text-gris-txt">{n ? `${n} por hacer` : ' '}</div>
              </div>
            );
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: columnas }}>
          <div className="relative" style={{ height: alto }}>
            {horas.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] text-gris-txt" style={{ top: (h - desde) * PX_HORA, display: h === desde ? 'none' : undefined }}>
                {new Date(2000, 0, 1, h).toLocaleTimeString('es-CO', { hour: 'numeric' })}
              </div>
            ))}
          </div>

          {dias.map((d, i) => {
            const esHoy = mismoDia(d, hoy);
            const ahora = (hoy.getHours() - desde) * 60 + hoy.getMinutes();
            return (
              <div
                key={claveDia(d)}
                className={`relative border-l border-borde ${onHueco ? 'cursor-cell' : ''}`}
                style={{
                  height: alto,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_HORA - 1}px, var(--color-borde) ${PX_HORA - 1}px, var(--color-borde) ${PX_HORA}px)`,
                  backgroundColor: esHoy ? 'rgba(245, 164, 136, 0.06)' : undefined,
                }}
                onClick={clicEnHueco(d)}
                role="presentation"
              >
                {distribuir(porDia[i]).map(({ cita, col, columnas: n }) => {
                  const inicioMin = (cita.ini.getHours() - desde) * 60 + cita.ini.getMinutes();
                  const dur = (cita.fin - cita.ini) / 60000;
                  const altoBloque = Math.max((dur / 60) * PX_HORA - 2, 26);
                  return (
                    <Bloque
                      key={cita.id}
                      cita={cita}
                      onAbrir={onAbrir}
                      compacto={altoBloque < 56 || n > 2}
                      estilo={{
                        top: (inicioMin / 60) * PX_HORA + 1,
                        height: altoBloque,
                        left: `calc(${(col / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                      }}
                    />
                  );
                })}
                {esHoy && ahora >= 0 && ahora <= (hasta - desde) * 60 && (
                  <div className="pointer-events-none absolute right-0 left-0 z-10 flex items-center" style={{ top: (ahora / 60) * PX_HORA }}>
                    <span className="-ml-1 size-2 rounded-full bg-rojo" />
                    <span className="h-px flex-1 bg-rojo" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Muestra el mes con una casilla por día y sus primeras citas; el más N abre ese día.
export function VistaMes({ fecha, citas, onAbrir, onDia }) {
  const hoy = new Date();
  const primero = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
  const inicio = inicioSemana(primero);
  const semanas = Math.ceil(((primero.getDay() + 6) % 7 + new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate()) / 7);

  const porDia = useMemo(() => {
    const mapa = new Map();
    for (const c of citas) {
      const k = claveDia(c.ini);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(c);
    }
    return mapa;
  }, [citas]);

  return (
    <div className="overflow-x-auto rounded-lg border border-borde bg-card">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 border-b border-borde bg-lienzo/60">
          {DIAS_CORTOS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase text-gris-txt">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: semanas * 7 }, (_, i) => {
            const d = sumarDias(inicio, i);
            const delMes = d.getMonth() === fecha.getMonth();
            const lista = (porDia.get(claveDia(d)) || []).sort((a, b) => a.ini - b.ini);
            const esHoy = mismoDia(d, hoy);
            return (
              <div
                key={claveDia(d)}
                className={`min-h-[104px] cursor-pointer border-b border-l border-borde p-1.5 transition-colors hover:bg-lienzo/50 ${delMes ? '' : 'bg-lienzo/40'}`}
                onClick={() => onDia(d)}
                role="presentation"
              >
                <div className={`mb-1 flex size-6 items-center justify-center rounded-full text-[12px] font-semibold ${esHoy ? 'bg-acento text-marino' : delMes ? 'text-marca' : 'text-gris'}`}>
                  {d.getDate()}
                </div>
                <div className="flex flex-col gap-1">
                  {lista.slice(0, 3).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onAbrir(c); }}
                      className={`truncate rounded border-l-[3px] px-1 py-0.5 text-left text-[11px] text-marca ${c.estado === 'cancelada' ? 'line-through opacity-60' : ''}`}
                      style={{ background: ESTADOS[c.estado].fondo, borderLeftColor: ESTADOS[c.estado].borde }}
                      title={`${horaTexto(c.ini)} · ${c.up_nombre || c.id_unico}`}
                    >
                      <span className="cifras font-semibold">{horaTexto(c.ini)}</span> {c.up_nombre || c.id_unico}
                    </button>
                  ))}
                  {lista.length > 3 && (
                    <span className="px-1 text-[11px] font-semibold text-acento-txt">+{lista.length - 3} más</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
