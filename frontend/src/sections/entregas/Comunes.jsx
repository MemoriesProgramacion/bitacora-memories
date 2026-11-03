// Piezas compartidas de entregas: calendario mensual y barra de filtros con pastillas. Las usan el cronograma,
// de solo consulta, y la ruta, de edición, que solo se diferencian en el panel de la derecha.
import { useState, useMemo } from 'react';
import { abrirActa } from '../../lib/entregas';
import { Card, Chip } from '../../components/UI';
import {
  soloFecha, hoyISO, fechaLarga, fechaCorta, ESTADOS_HORA,
  lapsosRapidos, porDia, horaDeEntrega, horaLegible,
} from '../../lib/entregas';

// Paleta de estados del validador, replicada para no descuadrar la herramienta.
export const TONOS = {
  vacio:  { fondo: 'rgba(138,143,158,0.06)', borde: 'var(--color-borde)',             texto: 'var(--tono-vacio-txt)', punto: '#b3b7c1' },
  espera: { fondo: 'rgba(245,164,136,0.09)',  borde: 'rgba(245,164,136,0.40)', texto: 'var(--tono-espera-txt)', punto: '#E8A15F' },
  malo:   { fondo: 'rgba(209,77,106,0.06)',   borde: 'rgba(209,77,106,0.30)',  texto: 'var(--tono-malo-txt)', punto: '#d65a5a' },
  bueno:  { fondo: 'rgba(56,161,105,0.07)',  borde: 'rgba(56,161,105,0.32)', texto: 'var(--tono-bueno-txt)', punto: '#3f9a6a' },
};

const DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Niveles de la barra de filtros en cascada.
export const NIVELES = [
  { id: 'region',    label: 'Región' },
  { id: 'dpto',      label: 'Departamento' },
  { id: 'mpio',      label: 'Municipio' },
  { id: 'modalidad', label: 'Modalidad' },
  { id: 'nodo',      label: 'Nodo' },
];

// Aplica los filtros de los niveles anteriores al nivel indicado, sin incluirlo.
export function aplicarHasta(items, valores, nivel) {
  const hasta = NIVELES.findIndex((n) => n.id === nivel);
  return items.filter((it) => NIVELES.every((n, i) => (
    (hasta >= 0 && i >= hasta) || !valores[n.id] || it[n.id] === valores[n.id]
  )));
}

export function aplicarTodos(items, valores) {
  return items.filter((it) => NIVELES.every((n) => !valores[n.id] || it[n.id] === valores[n.id]));
}

// Muestra la barra de filtros en cascada.
export function BarraFiltros({ items, valores, onCambio, onLimpiar, extra }) {
  const activos = Object.values(valores).filter(Boolean).length;

  const niveles = useMemo(() => NIVELES.map((n) => {
    const base = aplicarHasta(items, valores, n.id);
    const opciones = [...new Set(base.map((it) => it[n.id]).filter(Boolean))].sort();
    return { ...n, opciones };
  }).filter((n) => n.opciones.length > 0), [items, valores]);

  function cambiar(id, v) {
    const i = NIVELES.findIndex((n) => n.id === id);
    const limpios = { ...valores, [id]: v };
    NIVELES.slice(i + 1).forEach((n) => { limpios[n.id] = ''; });
    onCambio(limpios);
  }

  const campo = 'w-full rounded-lg border border-borde bg-bg px-2.5 py-2 text-[13px] text-texto outline-none focus:border-acento disabled:opacity-45';

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gris">Filtros</span>
        {activos > 0 && (
          <button
            type="button" onClick={onLimpiar}
            className="text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:underline"
          >
            Limpiar ({activos})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {niveles.map((n, i) => {
          const prev = niveles[i - 1];
          const bloqueado = !!prev && !valores[prev.id] && prev.opciones.length > 1;
          return (
            <div key={n.id} className="min-w-[140px] flex-1">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gris">
                {n.label}
              </label>
              <select
                className={campo} disabled={bloqueado}
                value={valores[n.id] || ''}
                onChange={(e) => cambiar(n.id, e.target.value)}
              >
                <option value="">{bloqueado ? `Elige ${prev.label.toLowerCase()}` : 'Todos'}</option>
                {n.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        })}
        {extra}
      </div>
    </Card>
  );
}

// Muestra una pastilla de filtro.
export function Pastilla({ activa, children, onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        activa
          ? 'border-acento bg-acento text-marino'
          : 'border-borde bg-bg text-gris hover:border-acento hover:text-texto'
      }`}
    >
      {children}
    </button>
  );
}

// Selector de lapso con pastillas rápidas y un rango personalizado.
export function SelectorLapso({ lapso, onLapso }) {
  const rapidos = useMemo(() => lapsosRapidos(), []);
  const [desde, setDesde] = useState(lapso?.desde || '');
  const [hasta, setHasta] = useState(lapso?.hasta || '');

  function elegirRapido(r) {
    setDesde(r.desde || ''); setHasta(r.hasta || '');
    onLapso({ desde: r.desde, hasta: r.hasta, etiqueta: r.etiqueta });
  }

  function aplicarPersonalizado() {
    if (!desde && !hasta) return;
    const etiqueta = desde && hasta
      ? `${desde} a ${hasta}`
      : desde ? `Desde ${desde}` : `Hasta ${hasta}`;
    onLapso({ desde: desde || null, hasta: hasta || null, etiqueta });
  }

  function limpiar() {
    setDesde(''); setHasta('');
    onLapso(null);
  }

  const campo = 'rounded-lg border border-borde bg-bg px-2.5 py-1.5 text-[12px] text-texto outline-none focus:border-acento';

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gris">
          Lapso de entregas
        </span>
        {lapso && (
          <button
            type="button" onClick={limpiar}
            className="text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:underline"
          >
            Ver por día (quitar lapso)
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {rapidos.map((r) => (
          <Pastilla key={r.id} activa={lapso?.etiqueta === r.etiqueta} onClick={() => elegirRapido(r)}>
            {r.etiqueta}
          </Pastilla>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gris">Desde</label>
          <input type="date" className={`${campo} w-full`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gris">Hasta</label>
          <input type="date" className={`${campo} w-full`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <button
          type="button" onClick={aplicarPersonalizado} disabled={!desde && !hasta}
          className="w-full rounded-lg border border-borde bg-card px-3 py-2 text-[12px] font-semibold text-texto hover:border-acento disabled:opacity-40 sm:w-auto sm:py-1.5"
        >
          Aplicar rango
        </button>
      </div>
    </Card>
  );
}

// Calendario mensual con las entregas de cada día.
export function Calendario({ mapaDias, seleccionado, onSeleccionar }) {
  const inicio = seleccionado || hoyISO();
  const [ancla, setAncla] = useState(() => {
    const [a, m] = inicio.split('-').map(Number);
    return { anio: a, mes: m - 1 };
  });

  const celdas = useMemo(() => {
    const primero = new Date(ancla.anio, ancla.mes, 1);
    const dias = new Date(ancla.anio, ancla.mes + 1, 0).getDate();
    const offset = (primero.getDay() + 6) % 7;
    const out = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= dias; d++) {
      out.push(`${ancla.anio}-${String(ancla.mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
  }, [ancla]);

  const mover = (delta) => setAncla((a) => {
    const m = a.mes + delta;
    return { anio: a.anio + Math.floor(m / 12), mes: ((m % 12) + 12) % 12 };
  });

  const hoy = hoyISO();

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => mover(-1)}
          className="rounded-lg border border-borde px-2.5 py-1 text-sm text-gris hover:border-acento hover:text-texto">‹</button>
        <span className="text-sm font-bold text-marino">{MESES[ancla.mes]} {ancla.anio}</span>
        <button type="button" onClick={() => mover(1)}
          className="rounded-lg border border-borde px-2.5 py-1 text-sm text-gris hover:border-acento hover:text-texto">›</button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {DIAS.map((d) => (
          <div key={d} className="py-1 text-center text-[10px] font-semibold uppercase text-gris">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {celdas.map((iso, i) => {
          if (!iso) return <div key={`v${i}`} />;
          const n = Number(iso.slice(8));
          const entregas = mapaDias[iso] || [];
          const activo = iso === seleccionado;
          const esHoy = iso === hoy;
          return (
            <button
              key={iso} type="button" onClick={() => onSeleccionar(iso)}
              className={`relative flex h-11 flex-col items-center justify-center rounded-lg border text-sm transition ${
                activo
                  ? 'border-acento bg-acento font-bold text-marino'
                  : entregas.length
                    ? 'border-borde bg-bg font-semibold text-texto hover:border-acento'
                    : 'border-transparent text-gris hover:bg-bg'
              }`}
            >
              <span className={esHoy && !activo ? 'underline decoration-acento decoration-2 underline-offset-2' : ''}>{n}</span>
              {entregas.length > 0 && (
                <span className={`mt-0.5 text-[9px] font-bold ${activo ? 'text-marino' : 'text-acento'}`}>
                  {entregas.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// Muestra el estado de una entrega, que es el único elemento con color en las tarjetas y fichas.
export function EtiquetaEstado({ tono, children, className = '' }) {
  const t = TONOS[tono] || TONOS.vacio;
  return (
    <span className={`inline-flex min-w-[158px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}
      style={{ borderColor: t.borde, color: t.texto, background: t.fondo }}>
      <b style={{ color: t.punto }}>●</b> {children}
    </span>
  );
}

// Muestra una entrega en el panel del día.
export function TarjetaEntrega({ entrega, activa, onClick, up }) {
  const est = ESTADOS_HORA[entrega.estado_hora] || ESTADOS_HORA.programada;
  const hora = horaDeEntrega(entrega);
  const [horaNum, ...sufijo] = hora ? horaLegible(hora).split(' ') : [];
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick}
      className={`flex w-full items-stretch gap-3 rounded-card border bg-card p-3.5 text-left transition ${
        activa ? 'border-marino shadow-[0_0_0_3px_rgba(43,40,86,0.08)]' : 'border-borde'
      } ${onClick ? 'hover:border-marino' : 'cursor-default'}`}
    >
      <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-borde pr-3">
        <span className={`text-[15px] font-bold leading-none ${hora ? 'text-marino' : 'text-gris'}`}>
          {horaNum || '--:--'}
        </span>
        {sufijo.length > 0 && (
          <span className="mt-0.5 text-[10px] font-bold leading-none text-marino">{sufijo.join(' ')}</span>
        )}
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gris">
          {entrega.hora ? 'Confirmada' : hora ? 'Ruta' : 'Sin hora'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-bold leading-snug text-marino sm:truncate">
              {entrega.unidad_nombre || `UP ${entrega.ID_unico}`}
            </div>
            <div className="mt-0.5 text-[11px] text-gris">
              ID {entrega.ID_unico}{entrega.nodo ? ` · ${entrega.nodo}` : ''}{entrega.mpio ? ` · ${entrega.mpio}` : ''}
            </div>
          </div>
          <EtiquetaEstado tono={est.tono}>{est.label}</EtiquetaEstado>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-gris sm:grid-cols-2 sm:gap-2">
          <span>Tel: {entrega.telefono || up?.unidad_tel1 || '—'}</span>
          <span className="sm:truncate">Dir: {entrega.direccion || up?.unidad_direccion || '—'}</span>
        </div>
      </div>
    </button>
  );
}

// Muestra las entregas del día seleccionado.
export function PanelDia({ fecha, entregas, children, vacio = 'No hay entregas programadas este día.' }) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-base font-bold text-marino first-letter:uppercase">{fechaLarga(fecha)}</h3>
        <p className="text-[12px] text-gris">
          {entregas.length} {entregas.length === 1 ? 'entrega programada' : 'entregas programadas'}
        </p>
      </div>
      {entregas.length === 0
        ? <Card className="p-6 text-center text-sm text-gris">{vacio}</Card>
        : children}
    </div>
  );
}

// Muestra la lista de unidades agrupada por día dentro de un rango.
export function PanelLapso({
  entregas, etiqueta, children,
  vacio = 'No hay entregas programadas en este lapso.',
}) {
  const agrupadas = useMemo(() => {
    const mapa = porDia(entregas);
    return Object.keys(mapa).sort().map((fecha) => [fecha, mapa[fecha]]);
  }, [entregas]);

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-base font-bold text-marino first-letter:uppercase">{etiqueta || 'Lapso seleccionado'}</h3>
        <p className="text-[12px] text-gris">
          {entregas.length} {entregas.length === 1 ? 'entrega programada' : 'entregas programadas'}
          {agrupadas.length > 0 && ` · ${agrupadas.length} ${agrupadas.length === 1 ? 'día' : 'días'} con entregas`}
        </p>
      </div>

      {agrupadas.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gris">{vacio}</Card>
      ) : (
        <div className="flex flex-col gap-4">
          {agrupadas.map(([fecha, lista]) => (
            <div key={fecha}>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-block text-[12px] font-bold text-marino first-letter:uppercase">{fechaCorta(fecha)}</span>
                <span className="rounded-full bg-acento px-2 py-0.5 text-[10px] font-bold text-marino">
                  {lista.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {children
                  ? children(lista, fecha)
                  : lista.map((e) => <TarjetaEntrega key={e.id} entrega={e} up={e._up} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { soloFecha, Chip };

// Botón para ver el acta en PDF de un reagendamiento, que va con la sesión.
export function BotonActa({ entrega, acta, session, children = 'Ver acta de reagendamiento' }) {
  const [estado, setEstado] = useState('');
  if (!acta) return null;
  async function ver() {
    setEstado('abriendo');
    try { await abrirActa(entrega, acta, session); setEstado(''); } catch (e) { setEstado(e.message); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={ver} disabled={estado === 'abriendo'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-borde bg-card px-2.5 py-1 text-[12px] font-semibold text-marino hover:border-marino disabled:opacity-60">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        {estado === 'abriendo' ? 'Abriendo…' : children}
      </button>
      {estado && estado !== 'abriendo' && <span className="text-[11px] text-rojo-txt">{estado}</span>}
    </span>
  );
}

// Muestra los pasos con el lenguaje visual del validador.
export function Pasos({ pasos, actual }) {
  return (
    <div className="flex items-center gap-2 border-b border-borde px-4 py-3.5 sm:px-6 sm:py-4">
      {pasos.map((p, i) => {
        const n = i + 1;
        const hecho = actual > n;
        const activo = actual === n;
        return (
          <div key={p} className={`flex items-center gap-2 ${i < pasos.length - 1 ? 'flex-1' : ''}`}>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
              style={{
                background: activo ? 'var(--color-marino)' : hecho ? TONOS.bueno.fondo : 'rgba(138,143,158,0.08)',
                color: activo ? '#fff' : hecho ? TONOS.bueno.texto : '#b3b7c1',
                border: `1px solid ${activo ? 'var(--color-marino)' : hecho ? TONOS.bueno.borde : 'var(--color-borde)'}`,
              }}
            >
              {hecho ? '✓' : n}
            </span>
            <span className={`whitespace-nowrap text-[13px] font-semibold ${activo ? 'text-marino' : 'hidden text-gris sm:inline'}`}>
              {p}
            </span>
            {i < pasos.length - 1 && <span className="h-px flex-1 bg-borde" />}
          </div>
        );
      })}
    </div>
  );
}

export function Encabezado({ titulo, derecha }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-borde px-4 py-2.5"
      style={{ background: 'rgba(138,143,158,0.06)' }}>
      <span className="text-[13px] font-bold text-marino">{titulo}</span>
      {derecha && <span className="shrink-0 text-[11px] font-semibold text-gris">{derecha}</span>}
    </div>
  );
}

// Buscador con coincidencias de la bitácora; estado(up) devuelve el tono y la etiqueta y decide el color de
// cada fila.
export function SelectorUP({ titulo, ayuda, etiqueta, valor, onValor, sugerencias, estado, onElegir }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h3 className="text-[15px] font-bold text-marino">{titulo}</h3>
      <p className="mb-4 text-[13px] text-gris">{ayuda}</p>

      <label className="mb-1.5 block text-[13px] font-semibold text-texto">{etiqueta}</label>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b3b7c1]"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={valor} onChange={(e) => onValor(e.target.value)}
          placeholder="Nombre, ID único o documento"
          className="w-full rounded-lg border border-borde bg-card py-2.5 pl-9 pr-3 text-sm text-texto outline-none focus:border-acento"
        />
      </div>

      {sugerencias.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] text-gris">
            {sugerencias.length} coincidencia{sugerencias.length === 1 ? '' : 's'} en la bitácora
          </p>
          <ul className="space-y-2">
            {sugerencias.map((u) => {
              const sem = estado(u);
              return (
                <li key={u.ID_unico}>
                  <button
                    type="button" onClick={() => onElegir(u)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border border-borde bg-card px-3.5 py-2.5 text-left transition duration-150 hover:-translate-y-0.5 hover:border-marino hover:shadow-[0_4px_12px_rgba(43,40,86,0.08)] sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-snug text-texto sm:truncate">
                        {u.unidad_nombre || 'Sin nombre'}
                      </span>
                      <span className="block truncate text-[12px] text-gris">
                        ID {u.ID_unico} · {u.nodo || '—'} · {u.unidad_sector || ''}
                      </span>
                    </span>
                    <EtiquetaEstado tono={sem.tono} className="col-start-1 row-start-2 justify-self-start sm:col-start-2 sm:row-start-1">
                      {sem.label}
                    </EtiquetaEstado>
                    <svg className="col-start-2 row-span-2 row-start-1 h-4 w-4 text-[#b3b7c1] transition group-hover:translate-x-0.5 group-hover:text-marino sm:col-start-3 sm:row-span-1"
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
