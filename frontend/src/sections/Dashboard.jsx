// Panel resumen general. Para quienes tienen permiso, cada barra y cada indicador se puede abrir y muestra
// quiénes son las unidades detrás del número; solo algunos tipos de cuenta descargan a Excel. Todo respeta el
// filtro del panel.
import { useState, useCallback } from 'react';
import { uniqueSorted, countBy } from '../lib/utils';
import { isInactiva, RUTA, pasoLogrado, estEntregaValidador } from '../lib/etapas';
import FiltroBitacora, { useFiltroBitacora, describirFiltro } from '../components/FiltroBitacora';
import { Card, Btn } from '../components/UI';
import DetalleInforme, { IconoDescarga } from '../components/DetalleInforme';
import DetallePaso from '../components/DetallePaso';
import { descargarInformeBitacora, valorCampo, textoCuenta, audDe } from '../lib/informeBitacora';

// Muestra los indicadores y las barras de la ruta con el filtro y el detalle.
export default function Dashboard({ data, auditIndex, auditLoaded, auditEstado, auditReintento,
  onReintentarAuditoria, informe, detalle: puedeAbrir, usuario, onAbrirUP }) {
  const filtro = useFiltroBitacora(data);
  const rows = filtro.filas;
  const [detalle, setDetalle] = useState(null);
  const [pasoAbierto, setPasoAbierto] = useState(null);
  const [generando, setGenerando] = useState(false);
  const cerrar = useCallback(() => setDetalle(null), []);

  const nActivas = rows.filter((r) => isInactiva(r) === false).length;
  const nInactivas = rows.filter((r) => isInactiva(r) === true).length;

  const textoFiltro = describirFiltro(filtro.valores).replace(/_/g, ' · ');
  const sub = (n) => `${n.toLocaleString('es-CO')} unidad${n === 1 ? '' : 'es'}`
    + (textoFiltro ? ` · Filtro: ${textoFiltro}` : ' · Sin filtros');

  const abrir = puedeAbrir ? (d) => setDetalle(d) : undefined;

  const abrirCampo = abrir && ((campo, nombre) => (label) => {
    const filas = rows.filter((r) => valorCampo(r, campo) === label);
    abrir({ titulo: `${nombre}: ${label}`, subtitulo: sub(filas.length), filas });
  });

  const abrirPaso = abrir && ((step) => {
    const t = textoCuenta(step);
    abrir({
      titulo: `${step.n} · ${step.label}`,
      subtitulo: `${sub(rows.length)} · La barra cuenta: ${t.si.toLowerCase()}`,
      filas: rows, paso: step,
    });
  });

  const etapasListas = auditLoaded || auditEstado === 'error';

  async function descargarInforme() {
    setGenerando(true);
    try {
      await descargarInformeBitacora({
        filas: rows, auditIndex, etapasCargadas: auditLoaded,
        filtro: filtro.valores, etiquetaFiltro: describirFiltro(filtro.valores), usuario,
      });
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div className="mb-5">
      <FiltroBitacora filtro={filtro} />

      {informe && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-card border border-borde bg-card px-3.5 py-2.5">
          <p className="min-w-[240px] flex-1 text-xs text-gris">
            <b className="text-marino">Informe detallado:</b> toca un punto de la ruta (RIT, Doc. Visita 1…)
            para ver quiénes lo tienen y quiénes no. El Excel trae una hoja por cada punto
            {filtro.activo ? ', con los filtros aplicados.' : '.'}
          </p>
          <Btn onClick={descargarInforme} disabled={!rows.length || !etapasListas || generando}
            className="px-3.5 py-2 text-xs"
            title={etapasListas ? 'Descargar informe en Excel' : 'Esperando los datos de etapas…'}>
            <IconoDescarga /> {!etapasListas ? 'Cargando etapas…' : generando ? 'Generando…' : 'Descargar informe'}
          </Btn>
        </div>
      )}

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Unidades productivas" value={rows.length} destacado
          onClick={abrir && (() => abrir({ titulo: 'Unidades productivas', subtitulo: sub(rows.length), filas: rows }))} />
        <Kpi label="Activas" value={nActivas}
          onClick={abrir && (() => {
            const f = rows.filter((r) => isInactiva(r) === false);
            abrir({ titulo: 'Unidades activas', subtitulo: sub(f.length), filas: f });
          })} />
        <Kpi label="Inactivas" value={nInactivas}
          onClick={abrir && (() => {
            const f = rows.filter((r) => isInactiva(r) === true);
            abrir({ titulo: 'Unidades inactivas', subtitulo: sub(f.length), filas: f });
          })} />
        <Kpi label="Departamentos" value={uniqueSorted(rows.map((r) => r.dpto)).length} />
        <Kpi label="Municipios" value={uniqueSorted(rows.map((r) => r.mpio)).length} />
        <Kpi label="Modalidades" value={uniqueSorted(rows.map((r) => r.modalidad)).length} />
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="p-3.5">
          <Titulo>Unidades por modalidad</Titulo>
          <Barras items={countBy(rows, 'modalidad')} total={rows.length}
            onClick={abrirCampo && abrirCampo('modalidad', 'Modalidad')} />
        </Card>
        <Card className="p-3.5">
          <Titulo>Unidades por región</Titulo>
          <Barras items={countBy(rows, 'region')} total={rows.length}
            onClick={abrirCampo && abrirCampo('region', 'Región')} />
        </Card>
      </div>

      <Card className="p-3.5">
        <Titulo>Ruta de atención · avance del total filtrado</Titulo>
        {!auditLoaded ? (
          <EstadoEtapas estado={auditEstado} reintento={auditReintento}
            onReintentar={onReintentarAuditoria} />
        ) : (
          <div className="flex flex-col gap-2">
            {puedeAbrir && (
              <p className="-mt-1 mb-1 text-[11px] text-gris">Toca un punto para ver quiénes lo tienen y quiénes no.</p>
            )}
            {RUTA.map((step) => {
              const hechas = rows.filter((up) => pasoLogrado(step, up, audDe(up, auditIndex))).length;
              const pct = rows.length ? Math.round((hechas / rows.length) * 100) : 0;
              const pendiente = step.label === 'Subsanaciones';
              const Fila = abrirPaso ? 'button' : 'div';
              const abierto = pasoAbierto === step.n;
              return (
                <div key={step.n}>
                <Fila
                  {...(abrirPaso ? {
                    type: 'button',
                    onClick: () => setPasoAbierto(abierto ? null : step.n),
                    'aria-expanded': abierto,
                    title: abierto ? 'Ocultar detalle' : `Ver quiénes: ${step.label}`,
                  } : {})}
                  className={`grid w-full items-center gap-1.5 sm:gap-2 ${
                    abrirPaso
                      ? `group grid-cols-[22px_84px_minmax(0,1fr)_64px_14px] sm:grid-cols-[24px_88px_1fr_76px_16px] -mx-1.5 cursor-pointer rounded-lg border border-transparent px-1.5 py-0.5 text-left transition hover:border-gris hover:bg-bg hover:shadow-lg motion-safe:hover:scale-[1.017] ${abierto ? 'bg-bg' : ''}`
                      : 'grid-cols-[22px_84px_minmax(0,1fr)_64px] sm:grid-cols-[24px_88px_1fr_76px]'}`}>
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-marino text-[11px] font-bold text-white">
                    {step.n}
                  </span>
                  <span className="truncate text-xs font-medium text-texto">{step.label}</span>
                  <div className="h-3.5 overflow-hidden rounded-full bg-bg">
                    <div className={`h-full rounded-full transition-all ${pendiente ? 'bg-rojo' : 'bg-acento'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-right text-xs font-semibold text-texto">
                    {hechas.toLocaleString('es-CO')} <i className="not-italic text-[11px] font-normal text-gris">{pct}%</i>
                  </span>
                  {abrirPaso && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className={`text-gris transition-transform group-hover:text-marino ${abierto ? 'rotate-180' : ''}`} aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </Fila>
                {abierto && step.validador && (
                  <BarrasValidador
                    filas={rows.filter((up) => pasoLogrado(step, up, audDe(up, auditIndex)))}
                  />
                )}
                {abierto && (
                  <DetallePaso
                    step={step}
                    filas={rows}
                    auditIndex={auditIndex}
                    etiquetaFiltro={describirFiltro(filtro.valores)}
                    onAbrirUP={onAbrirUP}
                    onVerPanel={informe ? () => abrirPaso(step) : undefined}
                    descargas={informe}
                  />
                )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {detalle && (
        <DetalleInforme
          detalle={detalle}
          auditIndex={auditIndex}
          etiquetaFiltro={describirFiltro(filtro.valores)}
          onCerrar={cerrar}
          onAbrirUP={onAbrirUP}
          descargas={informe}
        />
      )}
    </div>
  );
}

// Bajo la barra de documentos de entrega desplegada, cuántas entregas están aprobadas, por corregir y en
// revisión en el validador.
const SUB_VALIDADOR = [
  { label: 'Aprobadas',    estado: 'Aprobado',     color: 'bg-verde-ok' },
  { label: 'Por corregir', estado: 'Por corregir', color: 'bg-rojo' },
  { label: 'En revisión',  estado: 'En revisión',  color: 'bg-acento' },
];

// Muestra las barras del estado de los documentos de entrega en el validador.
function BarrasValidador({ filas }) {
  const total = filas.length;
  const cuenta = (estado) => filas.filter((up) => estEntregaValidador(up)?.label === estado).length;
  const conEstado = filas.some((up) => up.estado_entrega);
  return (
    <div className="mb-1 mt-1.5 flex flex-col gap-1 pl-[30px] sm:pl-[32px]">
      {SUB_VALIDADOR.map((b) => {
        const n = cuenta(b.estado);
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={b.label}
            className="grid grid-cols-[84px_minmax(0,1fr)_64px] items-center gap-1.5 sm:grid-cols-[88px_1fr_76px] sm:gap-2">
            <span className="truncate text-[11px] text-gris">{b.label}</span>
            <div className="h-2 overflow-hidden rounded-full bg-bg">
              <div className={`h-full rounded-full transition-all ${b.color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right text-[11px] font-semibold text-texto">
              {n.toLocaleString('es-CO')} <i className="not-italic font-normal text-gris">{pct}%</i>
            </span>
          </div>
        );
      })}
      {total > 0 && !conEstado && (
        <p className="text-[11px] italic text-gris">Aún no hay datos del validador para estas entregas.</p>
      )}
    </div>
  );
}

function Titulo({ children }) {
  return (
    <div className="mb-3 text-xs font-bold uppercase tracking-wide text-marino">{children}</div>
  );
}

// Muestra un indicador clave con su cifra.
function Kpi({ label, value, destacado, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button', onClick, title: `Ver quiénes: ${label}` } : {})}
      className={`flex flex-col gap-1.5 rounded-card border p-3.5 text-left ${
      destacado ? 'border-marino bg-marino' : 'border-borde bg-card'
    } ${onClick ? 'transition hover:border-acento' : ''}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${
        destacado ? 'text-white/75' : 'text-gris'
      }`}>{label}</span>
      <span className={`text-2xl font-bold leading-none ${
        destacado ? 'text-acento' : 'text-marino'
      }`}>{value.toLocaleString('es-CO')}</span>
    </Tag>
  );
}

// Muestra las barras de avance de la ruta.
function Barras({ items, total, onClick }) {
  const [todas, setTodas] = useState(false);
  if (!items.length) return <p className="text-[13px] italic text-gris">Sin datos</p>;
  const max = items[0].n || 1;
  const lista = todas ? items : items.slice(0, 8);
  const Fila = onClick ? 'button' : 'div';
  return (
    <div className="flex flex-col gap-2">
      {lista.map((it) => {
        const pct = total ? Math.round((it.n / total) * 100) : 0;
        return (
          <Fila key={it.label}
            {...(onClick ? { type: 'button', onClick: () => onClick(it.label), title: `Ver quiénes: ${it.label}` } : {})}
            className={`grid items-center gap-1.5 sm:gap-2 ${
              onClick
                ? 'group grid-cols-[72px_minmax(0,1fr)_64px_14px] sm:grid-cols-[80px_1fr_76px_16px] -mx-1.5 cursor-pointer rounded-lg border border-transparent px-1.5 py-0.5 text-left transition hover:border-gris hover:bg-bg hover:shadow-lg motion-safe:hover:scale-[1.035]'
                : 'grid-cols-[72px_minmax(0,1fr)_64px] sm:grid-cols-[80px_1fr_76px]'}`}>
            <span className="truncate text-xs text-texto" title={it.label}>{it.label}</span>
            <div className="h-4 overflow-hidden rounded-full bg-bg">
              <div className="h-full rounded-full bg-marino transition-all"
                   style={{ width: `${Math.max(2, Math.round((it.n / max) * 100))}%` }} />
            </div>
            <span className="text-right text-xs font-semibold text-texto">
              {it.n.toLocaleString('es-CO')} <i className="not-italic text-[11px] font-normal text-gris">{pct}%</i>
            </span>
            {onClick && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className="text-gris transition group-hover:text-marino" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </Fila>
        );
      })}
      {items.length > 8 && (
        <button type="button" onClick={() => setTodas((t) => !t)}
          className="self-start text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:underline">
          {todas ? 'Ver menos' : `Ver las ${items.length} opciones`}
        </button>
      )}
    </div>
  );
}

// Avisa el estado de carga de las etapas y distingue entre todavía cargando y falló, para que no parezca que el
// dato no existe.
function EstadoEtapas({ estado, reintento, onReintentar }) {
  if (estado === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-gris">
          No se pudieron cargar los datos de etapas.
        </p>
        {onReintentar && (
          <button type="button" onClick={onReintentar}
            className="rounded-lg border border-borde bg-card px-3 py-1.5 text-xs font-semibold text-texto hover:border-acento">
            Reintentar etapas
          </button>
        )}
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[13px] text-gris">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-borde border-t-acento" />
      {reintento
        ? `Cargando etapas… reintentando (${reintento.intento} de ${reintento.total})`
        : 'Cargando datos de etapas…'}
    </p>
  );
}
