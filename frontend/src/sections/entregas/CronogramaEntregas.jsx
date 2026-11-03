// Cronograma de entregas, de solo consulta: calendario a la izquierda y entregas del día seleccionado a la
// derecha. Aquí no se edita nada, porque la edición vive en la ruta. Las entregas de cada día salen ordenadas
// por hora. El filtro es el mismo de la Bitácora más el estado de la entrega, y el botón de descarga exporta
// todas las entregas que cumplen el filtro.
import { useState, useEffect, useMemo } from 'react';
import { EncabezadoSeccion, Spinner, Aviso, Btn, Card } from '../../components/UI';
import {
  listarEntregas, porDia, hoyISO, soloFecha, ESTADOS_HORA, enLapso, horaInput, horaLegible,
} from '../../lib/entregas';
import { fullName, val } from '../../lib/utils';
import { estadoUpLabel } from '../../lib/etapas';
import { descargarExcel } from '../../lib/exportarExcel';
import FiltroBitacora, { useFiltroBitacora, describirFiltro } from '../../components/FiltroBitacora';
import {
  Calendario, TarjetaEntrega, PanelDia, SelectorLapso, PanelLapso,
} from './Comunes';

const ESTADOS = ['programada', 'confirmada', 'acta_revision', 'solicitud', 'reagendada', 'entregada', 'parcial']
  .map((v) => ({ v, l: ESTADOS_HORA[v].label }));

// Devuelve la fecha de una entrega, la programada en el Excel de entregas, que se usa para el calendario, el
// lapso y el Excel.
function fechaDe(e) {
  return soloFecha(e.fecha_programada) || '';
}

// Muestra el calendario, los filtros y el panel de entregas.
export default function CronogramaEntregas({
  data, session, soloNodo = null, conExcel = true, children,
}) {
  const [entregas, setEntregas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [dia, setDia] = useState(hoyISO());
  const [estadoEntrega, setEstadoEntrega] = useState('');
  const [lapso, setLapso] = useState(null);
  const [recarga, setRecarga] = useState(0);

  const esGestor = session?.role === 'gestor';
  const nodoConsulta = soloNodo || (esGestor ? session?.nodo || null : null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    listarEntregas(session, nodoConsulta ? { nodo: nodoConsulta } : {})
      .then((r) => { if (vivo) { setEntregas(r); setError(''); } })
      .catch((e) => {
        console.error('[bitacora][E-ENTREGAS] listar:', e);
        if (vivo) setError(e.publicMsg || 'No se pudieron cargar las entregas.');
      })
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [session, nodoConsulta, recarga]);

  const indice = useMemo(() => {
    const m = {};
    data.forEach((u) => { m[String(u.ID_unico)] = u; });
    return m;
  }, [data]);

  const enriquecidas = useMemo(() => entregas
    .filter((e) => !esGestor || indice[String(e.ID_unico)])
    .map((e) => {
    const up = indice[String(e.ID_unico)] || {};
    return {
      ...e,
      unidad_nombre: e.unidad_nombre || up.unidad_nombre || '',
      nodo: e.nodo || up.nodo || '',
      region: up.region || '',
      dpto: up.dpto || '',
      mpio: up.mpio || '',
      modalidad: up.modalidad || '',
      _up: up,
    };
  }), [entregas, indice, esGestor]);

  const baseFiltro = useMemo(() => {
    if (!soloNodo) return data;
    const ids = new Set(entregas.map((e) => String(e.ID_unico)));
    return data.filter((u) => ids.has(String(u.ID_unico)));
  }, [data, entregas, soloNodo]);

  const filtro = useFiltroBitacora(baseFiltro, { municipio: true });

  const filtradas = useMemo(() => enriquecidas.filter((e) => (
    (!filtro.activo || filtro.pasa(indice[String(e.ID_unico)]))
    && (!estadoEntrega || e.estado_hora === estadoEntrega)
  )), [enriquecidas, filtro, indice, estadoEntrega]);

  const enVista = useMemo(
    () => filtradas.filter((e) => enLapso(fechaDe(e), lapso)),
    [filtradas, lapso],
  );

  function exportar() {
    const filas = [...enVista].sort((x, y) => (
      fechaDe(x).localeCompare(fechaDe(y))
      || String(x.ID_unico).localeCompare(String(y.ID_unico), 'es', { numeric: true })
    ));
    const etiqueta = [describirFiltro(filtro.valores), estadoEntrega, lapso?.etiqueta]
      .filter(Boolean).join('_');
    const nombre = `${soloNodo ? 'ruta' : 'cronograma_entregas'}`
      + `${etiqueta ? `_${etiqueta}` : ''}_${hoyISO()}`;
    descargarExcel(
      nombre.replace(/[^\wÀ-ÿ-]+/g, '_'),
      soloNodo ? 'Ruta' : 'Cronograma',
      COLUMNAS_EXCEL, filas,
    );
  }

  const conRuta = useMemo(() => enVista.filter((e) => (
    e.excel?.ruta?.fecha || e.excel?.ruta?.punto_encuentro || e.excel?.ruta?.hora_visita
  )), [enVista]);

  function exportarRutas() {
    const filas = [...conRuta].sort((x, y) => (
      (x.excel.ruta.fecha || fechaDe(x)).localeCompare(y.excel.ruta.fecha || fechaDe(y))
      || (x.nodo || '').localeCompare(y.nodo || '')
      || (horaInput(x.excel.ruta.hora_visita) || '99').localeCompare(horaInput(y.excel.ruta.hora_visita) || '99')
    ));
    const etiqueta = [describirFiltro(filtro.valores), lapso?.etiqueta].filter(Boolean).join('_');
    descargarExcel(
      `rutas_entrega${etiqueta ? `_${etiqueta}` : ''}_${hoyISO()}`.replace(/[^\wÀ-ÿ-]+/g, '_'),
      'Rutas', COLUMNAS_RUTA, filas,
    );
  }

  const mapa = useMemo(() => porDia(filtradas), [filtradas]);
  const delDia = mapa[dia] || [];

  function irADia(iso) {
    setLapso(null);
    setDia(iso);
  }

  if (cargando) return <Spinner texto="Cargando cronograma…" />;

  return (
    <div>
      <EncabezadoSeccion
        titulo={soloNodo ? 'Ruta' : 'Cronograma de entregas'}
        subtitulo={soloNodo
          ? 'Entregas de tu nodo, en orden de hora. Selecciona un día y luego una entrega para confirmar o reagendar.'
          : 'Consulta de entregas programadas, en orden de hora. Selecciona un día para ver el detalle.'}
      />

      {error && <Aviso tono="bad">{error}</Aviso>}

      <FiltroBitacora
        filtro={filtro}
        onLimpiar={() => setEstadoEntrega('')}
        extraEtiqueta={ESTADOS.find((o) => o.v === estadoEntrega)?.l}
        extra={(
          <div className="flex min-w-[150px] flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-gris">
              Estado de la entrega
            </label>
            <select
              className="cursor-pointer rounded-lg border border-borde bg-card px-2.5 py-2 text-[13px] outline-none focus:border-acento"
              value={estadoEntrega}
              onChange={(e) => setEstadoEntrega(e.target.value)}
            >
              <option value="">Todas</option>
              {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        )}
      />

      <SelectorLapso lapso={lapso} onLapso={setLapso} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-gris">
          <b className="text-texto">{enVista.length.toLocaleString('es-CO')}</b>
          {' '}de {enriquecidas.length.toLocaleString('es-CO')} entregas
          {lapso ? ` en «${lapso.etiqueta}»` : ' con el filtro actual'}
        </p>
        {conExcel && (
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={exportarRutas} disabled={!conRuta.length}
              className="py-2 text-[13px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
              Descargar rutas ({conRuta.length.toLocaleString('es-CO')})
            </Btn>
            <Btn variant="secondary" onClick={exportar} disabled={!enVista.length}
              className="py-2 text-[13px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
              Descargar Excel
            </Btn>
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ESTADOS.map((o) => {
          const n = enVista.filter((e) => e.estado_hora === o.v).length;
          return (
            <div key={o.v} className="rounded-lg border border-borde bg-card px-3 py-2.5 text-center">
              <div className="text-lg font-bold text-marino">{n}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gris">{o.l}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 md:sticky md:top-16">
          <Calendario mapaDias={mapa} seleccionado={dia} onSeleccionar={irADia} />
          <OrigenHora />
        </div>

        {lapso ? (
          <PanelLapso entregas={enVista} etiqueta={lapso.etiqueta}>
            {children
              ? (lista) => children({ entregas: lista, recargar: () => setRecarga((n) => n + 1) })
              : undefined}
          </PanelLapso>
        ) : (
          <PanelDia fecha={dia} entregas={delDia}>
            {children
              ? children({ entregas: delDia, recargar: () => setRecarga((n) => n + 1) })
              : (
                <div className="flex flex-col gap-2">
                  {delDia.map((e) => (
                    <TarjetaEntrega key={e.id} entrega={e} up={e._up} />
                  ))}
                </div>
              )}
          </PanelDia>
        )}
      </div>
    </div>
  );
}

// Muestra de dónde sale la hora de una entrega, en el mismo orden de horaDeEntrega.
function OrigenHora() {
  return (
    <Card className="p-4 text-[12px] text-gris">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-marino">
        De dónde sale la hora
      </div>
      <ol className="list-decimal space-y-1 pl-4">
        <li><b className="text-texto">Confirmada</b>: la que confirma el gestor en la pestaña Ruta.</li>
        <li><b className="text-texto">Ruta</b>: si no hay confirmación, la de MASTER ENTREGAS: hoja 4. RUTAS
          (columna hora_visita) y, si está vacía, hoja 5. ENTREGAS (columna hora_ruta).</li>
        <li><b className="text-texto">Sin hora</b>: ninguna de las anteriores; va al final del día.</li>
      </ol>
      <p className="mt-2">Las entregas de cada día se ordenan por esa hora.</p>
    </Card>
  );
}

// Columnas del Excel de la hoja de rutas del Excel de entregas.
const COLUMNAS_RUTA = [
  { titulo: 'Fecha de la ruta',     ancho: 16, valor: (e) => e.excel.ruta.fecha || fechaDe(e) },
  { titulo: 'Hora de visita',       ancho: 14, valor: (e) => horaLegible(e.hora || e.excel.ruta.hora_visita) },
  { titulo: 'Hora confirmada por el gestor', ancho: 16, valor: (e) => (e.hora ? 'Sí' : 'No') },
  { titulo: 'Hora de salida',       ancho: 14, valor: (e) => horaLegible(e.excel.ruta.hora_salida) },
  { titulo: 'Punto de encuentro',   ancho: 30, valor: (e) => e.excel.ruta.punto_encuentro },
  { titulo: 'Ruta',                 ancho: 26, valor: (e) => e.excel.ruta.ruta },
  { titulo: 'Región',               ancho: 14, valor: (e) => e.excel.ruta.region || e.region },
  { titulo: 'Nodo',                 ancho: 12, valor: (e) => e.nodo },
  { titulo: 'Gestor',               ancho: 26, valor: (e) => e.excel.ruta.gestor_nombre },
  { titulo: 'Teléfono gestor',      ancho: 16, valor: (e) => e.excel.ruta.telefono_gestor },
  { titulo: 'Coordinador',          ancho: 24, valor: (e) => e.excel.ruta.coordinador },
  { titulo: 'Teléfono coordinador', ancho: 16, valor: (e) => e.excel.ruta.telefono_coordinador },
  { titulo: 'ID único',             ancho: 12, valor: (e) => val(e.ID_unico) || '' },
  { titulo: 'Unidad productiva',    ancho: 34, valor: (e) => e.unidad_nombre || '' },
  { titulo: 'Representante',        ancho: 30, valor: (e) => fullName(e._up) },
  { titulo: 'Teléfono UP',          ancho: 18, valor: (e) => val(e.telefono || e._up?.unidad_tel1) || '' },
  { titulo: 'Dirección UP',         ancho: 36, valor: (e) => val(e.direccion || e._up?.unidad_direccion) || '' },
  { titulo: 'Departamento',         ancho: 18, valor: (e) => e.dpto },
  { titulo: 'Municipio',            ancho: 20, valor: (e) => e.mpio },
  { titulo: 'Fecha programada',     ancho: 16, valor: (e) => fechaDe(e) },
  { titulo: 'Estado de la entrega', ancho: 20, valor: (e) => (ESTADOS_HORA[e.estado_hora] || ESTADOS_HORA.programada).label },
];

// Columnas del Excel de entregas que se descarga.
const COLUMNAS_EXCEL = [
  { titulo: 'Fecha programada',   ancho: 17, valor: (e) => fechaDe(e) },
  { titulo: 'Estado de la entrega', ancho: 20, valor: (e) => (ESTADOS_HORA[e.estado_hora] || ESTADOS_HORA.programada).label },
  { titulo: 'Hora',               ancho: 12, valor: (e) => horaLegible(e.hora || e.hora_excel) },
  { titulo: 'Hora confirmada por el gestor', ancho: 16, valor: (e) => (e.hora ? 'Sí' : 'No') },
  { titulo: 'ID único',           ancho: 12, valor: (e) => val(e.ID_unico) || '' },
  { titulo: 'Unidad productiva',  ancho: 34, valor: (e) => e.unidad_nombre || '' },
  { titulo: 'Representante',      ancho: 30, valor: (e) => fullName(e._up) },
  { titulo: 'Documento',          ancho: 16, valor: (e) => val(e._up?.integrante_doc_inicial || e._up?.unidad_doc) || '' },
  { titulo: 'Región',             ancho: 16, valor: (e) => e.region },
  { titulo: 'Departamento',       ancho: 18, valor: (e) => e.dpto },
  { titulo: 'Municipio',          ancho: 20, valor: (e) => e.mpio },
  { titulo: 'Modalidad',          ancho: 18, valor: (e) => e.modalidad },
  { titulo: 'Nodo',               ancho: 18, valor: (e) => e.nodo },
  { titulo: 'Estado de la UP',    ancho: 14, valor: (e) => estadoUpLabel(e._up) || '' },
  { titulo: 'Teléfono',           ancho: 16, valor: (e) => val(e.telefono || e._up?.unidad_tel1) || '' },
  { titulo: 'Dirección',          ancho: 36, valor: (e) => val(e.direccion || e._up?.unidad_direccion) || '' },
  { titulo: 'Estado programación (Excel)', ancho: 22, valor: (e) => val(e.excel?.estado_programacion) || '' },
  { titulo: 'Estado entrega (Excel)', ancho: 20, valor: (e) => val(e.excel?.estado_entrega) || '' },
  { titulo: 'Ruta',               ancho: 26, valor: (e) => val(e.excel?.ruta?.ruta) || '' },
  { titulo: 'Punto de encuentro', ancho: 26, valor: (e) => val(e.excel?.ruta?.punto_encuentro) || '' },
  { titulo: 'Motivo reagendamiento', ancho: 36, valor: (e) => e.solicitud_reagendamiento?.motivo || '' },
  { titulo: 'Fecha sugerida',     ancho: 14, valor: (e) => soloFecha(e.solicitud_reagendamiento?.fecha_sugerida) },
];
