// Sección Bitácora. La búsqueda trabaja sobre la lista liviana que entrega la API; al abrir una unidad se pide
// su documento completo y recién ahí se muestra la ficha con todos los campos. El panel se queda montado aunque
// se abra una ficha y solo se oculta, para que al volver sigan puestos los filtros y el detalle que se estaba
// mirando.
import { useState, useMemo, useRef } from 'react';
import { val, fullName, buscarUnidades } from '../lib/utils';
import { estadoUpLabel, isInactiva } from '../lib/etapas';
import { EncabezadoSeccion, Card, Spinner, Btn } from '../components/UI';
import Dashboard from './Dashboard';
import FichaUP from '../components/FichaUP';
import { puedeVerInforme, puedeVerDetalle, puedeVerTableroEvaluacion } from '../lib/permisos';
import { Seccion } from '../components/UI';
import TableroEvaluacion from '../components/TableroEvaluacion';

// Muestra el buscador, el panel y la ficha de la unidad abierta.
export default function Bitacora({ data, auditIndex, auditLoaded, auditEstado, auditReintento,
  cargando, error, reintento, onReintentar, onReintentarAuditoria, onCargarUnidad, onRecargar, session }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [abriendo, setAbriendo] = useState(null);

  const scrollPrevio = useRef(0);
  function mostrarFicha(up) {
    scrollPrevio.current = window.scrollY;
    setSel(up);
    window.scrollTo(0, 0);
  }
  function volver() {
    setSel(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollPrevio.current));
  }

  async function abrirUP(up) {
    if (!onCargarUnidad) { mostrarFicha(up); return; }
    setAbriendo(up.ID_unico);
    try {
      mostrarFicha(await onCargarUnidad(up));
    } finally {
      setAbriendo(null);
    }
  }

  const resultados = useMemo(() => buscarUnidades(data, q), [q, data]);

  if (cargando) {
    return (
      <Spinner
        texto={reintento ? `Reintentando… (${reintento.intento} de ${reintento.total})` : 'Cargando datos...'}
        sub={reintento
          ? 'El servidor tardó en responder. La aplicación está volviendo a intentarlo sola.'
          : 'La primera carga puede tardar más dependiendo de la estabilidad de la conexión'}
      />
    );
  }

  if (error && !data.length) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold text-rojo">{error.publicMsg}</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-gris">
          No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.
        </p>
        <Btn onClick={onReintentar} variant="secondary" className="mt-3">Reintentar</Btn>
        <p className="mt-2.5 text-[10px] text-gris/50">Ref. {error.code}</p>
      </div>
    );
  }

  return (
    <>
      {sel && (
        <FichaUP
          up={sel}
          auditIndex={auditIndex}
          auditLoaded={auditLoaded}
          auditEstado={auditEstado}
          onVolver={volver}
          onActualizada={onRecargar}
          session={session}
        />
      )}
      {abriendo && !sel && q === '' && (
        <div className="fixed bottom-5 left-1/2 z-[60] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-full bg-marino px-4 py-2 text-xs font-semibold text-white shadow-lg">
          Abriendo ficha…
        </div>
      )}

      <div hidden={!!sel}>
      <EncabezadoSeccion titulo="Bitácora" subtitulo="Consulta de unidades productivas" />

      <Card className="mb-5 flex items-center gap-3 px-4 py-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" className="shrink-0 text-gris">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar ID, cédula, nombre o UP…"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 text-sm outline-none placeholder:text-gris"
        />
        <span className={`shrink-0 text-xs text-gris ${q ? '' : 'hidden sm:inline'}`}>
          {q ? `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}` : 'Escribe para buscar'}
        </span>
      </Card>

      {!q ? (
        <>
          <Dashboard data={data} auditIndex={auditIndex} auditLoaded={auditLoaded}
            auditEstado={auditEstado} auditReintento={auditReintento}
            onReintentarAuditoria={onReintentarAuditoria}
            informe={puedeVerInforme(session)}
            detalle={puedeVerDetalle(session)}
            usuario={session?.nombre || session?.label || ''}
            onAbrirUP={abrirUP} />
          {puedeVerTableroEvaluacion(session) && (
            <div className="no-print mt-5">
              <Seccion titulo="Indicadores de la ruta: línea base y salida" abierta={false}>
                <TableroEvaluacion />
              </Seccion>
            </div>
          )}
        </>
      ) : resultados.length === 0 ? (
        <p className="py-12 text-center text-sm text-gris">No se encontraron resultados</p>
      ) : (
        <div className="flex flex-col gap-2">
          {resultados.map((up) => {
            const inact = isInactiva(up);
            return (
              <button
                key={up.ID_unico}
                type="button"
                onClick={() => abrirUP(up)}
                disabled={abriendo === up.ID_unico}
                className="flex items-center justify-between gap-4 rounded-card border border-borde bg-card px-4 py-3 text-left transition hover:border-acento disabled:opacity-60"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-marino">
                    ID {up.ID_unico} — {val(up.unidad_nombre) || 'Sin nombre'}
                  </h3>
                  <p className="truncate text-xs text-gris">
                    {fullName(up)} · {val(up.mpio) || '—'}, {val(up.dpto) || '—'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  inact === null ? 'border-borde bg-card text-gris'
                    : inact ? 'border-rojo/35 bg-rojo/10 text-rojo'
                            : 'border-verde-ok/35 bg-verde-ok/12 text-verde-ok'
                }`}>
                  {abriendo === up.ID_unico ? 'Abriendo…' : (estadoUpLabel(up) || 'Sin estado')}
                </span>
              </button>
            );
          })}
        </div>
      )}
      </div>
    </>
  );
}
