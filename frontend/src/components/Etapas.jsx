// Etapas documentales de la unidad productiva: muestra, etapa por etapa, el estado de los documentos y sus
// archivos.
import { AUDIT_JOIN_KEY } from '../lib/config';
import {
  STAGES, RUTA, parseChecks, parseFiles, completaEstado,
  hasRIT, pasoEstadoUP, estPdfCarrito,
} from '../lib/etapas';
import { useEffect, useState } from 'react';
import { val } from '../lib/utils';
import { pedirFormacionUP, textoSesion } from '../lib/formacion';
import { Chip } from './UI';
import VisorPdf from './VisorPdf';

// Muestra el paso de talleres con lo registrado en la plataforma: asistencia válida por módulo y el 80 %.
function PasoTalleres({ idUnico }) {
  const [f, setF] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vigente = true;
    pedirFormacionUP(idUnico).then((d) => vigente && setF(d)).catch(() => vigente && setError(true));
    return () => { vigente = false; };
  }, [idUnico]);
  const c = f?.cumplimiento;
  const estado = !f ? null : !f.items.length ? { tono: 'bad', label: 'Sin talleres' }
    : c?.cumple_80 ? { tono: 'ok', label: 'Cumple el 80 %' } : { tono: 'bad', label: `${c?.porcentaje ?? 0} % · no alcanza el 80 %` };
  return (
    <Marco vacia={!f?.items?.length}>
      <Cabecera titulo="04 · Talleres (registro en la plataforma)"><BadgeEstado estado={estado} /></Cabecera>
      {error ? <p className="text-xs italic text-gris">No se pudo consultar la formación registrada en Talleres.</p>
        : !f ? <p className="text-xs italic text-gris">Consultando los talleres…</p>
        : !f.items.length ? <p className="text-xs italic text-gris">La unidad aún no participa en talleres de fortalecimiento.</p>
        : f.items.map((t) => (
          <p key={t.taller_id} className="text-xs leading-relaxed text-texto">
            <b>{t.taller}</b>: {t.encuentros.map((e) => `Módulo ${e.modulo} ${textoSesion(e).toLowerCase()}`).join(' · ')}
            {t.cumplimiento && ` · ${t.cumplimiento.cumplidas} de ${t.cumplimiento.actividades} actividades`}
          </p>
        ))}
    </Marco>
  );
}

// Componente principal que muestra todas las etapas de la unidad.
export default function Etapas({ up, auditIndex, auditLoaded, auditEstado, conFormacion = false }) {
  const id = up && up[AUDIT_JOIN_KEY] != null ? String(up[AUDIT_JOIN_KEY]).trim() : '';
  const aud = auditIndex[id];

  if (!aud) {
    if (!auditLoaded) {
      return auditEstado === 'error'
        ? <p className="text-[13px] italic text-gris">No se pudieron cargar los datos de etapas.</p>
        : (
          <p className="flex items-center gap-2 text-[13px] italic text-gris">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-borde border-t-acento" />
            Cargando etapas…
          </p>
        );
    }
    return <p className="text-[13px] italic text-gris">Sin información de etapas para este ID.</p>;
  }

  const principales = STAGES.filter((s) => !s.bajoPaso);

  return (
    <>
      {principales.map((st) => (st.titulo === '04 · Talleres' && conFormacion && up?.ID_unico != null
        ? <PasoTalleres key={st.titulo} idUnico={String(up.ID_unico)} />
        : <TarjetaEtapa key={st.titulo} st={st} aud={aud} />))}

      {RUTA.filter((s) => Number(s.n) >= 5).map((step) => {
        const num = step.n.length === 1 ? `0${step.n}` : step.n;
        const p = pasoEstadoUP(step, up, aud);
        const subs = STAGES.filter((s) => s.bajoPaso === step.n);
        return (
          <div key={step.n}>
            <TarjetaEstado titulo={`${num} · ${step.label}`} estado={p}>
              {step.fn === estPdfCarrito && <VisorPdf up={up} />}
            </TarjetaEstado>
            {subs.map((st) => <TarjetaEtapa key={st.titulo} st={st} aud={aud} />)}
          </div>
        );
      })}
    </>
  );
}

function Marco({ sub, vacia, children }) {
  return (
    <div className={`stage-card-pdf mb-2.5 rounded-lg p-3.5 ${
      sub
        ? 'ml-4 border border-dashed border-borde bg-transparent'
        : 'border-l-[3px] border-l-acento bg-bg'
    } ${vacia ? 'opacity-60' : ''}`}>
      {children}
    </div>
  );
}

function Cabecera({ titulo, children }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[13px] font-semibold text-texto">{titulo}</span>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </div>
  );
}

function BadgeCount({ children, alerta }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
      alerta ? 't-bad' : 'border-borde bg-card text-gris'
    }`}>
      {children}
    </span>
  );
}

function BadgeEstado({ estado }) {
  if (!estado) return null;
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
      estado.tono === 'ok'
        ? 'border-[rgba(56,161,105,0.35)] bg-[rgba(56,161,105,0.12)] text-verde-ok'
        : 'border-[rgba(229,62,62,0.35)] bg-[rgba(229,62,62,0.1)] text-rojo'
    }`}>
      {estado.label}
    </span>
  );
}

function Archivos({ files }) {
  if (!files.length) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer select-none text-xs text-gris hover:text-texto">
        {files.length} archivo{files.length === 1 ? '' : 's'}
      </summary>
      <ul className="mt-1.5 list-disc pl-5 text-xs leading-relaxed text-texto [word-break:break-word]">
        {files.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </details>
  );
}

// Muestra una etapa con sus campos y archivos.
function TarjetaEtapa({ st, aud }) {
  if (st.docsList) {
    let faltantes = 0;
    const grupos = st.docsList.map((d) => {
      const fs = parseFiles(aud[d.key]);
      const cks = d.check ? parseChecks(aud[d.check]) : [];
      cks.forEach((c) => { if (c.bad) faltantes++; });
      if (!fs.length && !cks.length) return null;
      return (
        <div key={d.label} className="mt-2">
          <span className="mb-1 inline-block text-[11px] font-semibold text-acento-txt">{d.label}</span>
          {cks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {cks.map((c, i) => (
                <Chip key={i} tono={c.ok ? 'ok' : c.bad ? 'bad' : 'neutral'}>{c.label}</Chip>
              ))}
            </div>
          )}
          <Archivos files={fs} />
        </div>
      );
    }).filter(Boolean);

    if (!grupos.length) return null;
    return (
      <Marco sub={st.sub}>
        <Cabecera titulo={st.titulo}>
          {faltantes > 0 && (
            <BadgeCount alerta>{faltantes} faltante{faltantes === 1 ? '' : 's'}</BadgeCount>
          )}
        </Cabecera>
        {grupos}
      </Marco>
    );
  }

  const checks = st.check ? parseChecks(aud[st.check]) : [];
  const files = st.docs ? parseFiles(aud[st.docs]) : [];
  const conteo = st.conteo ? val(aud[st.conteo]) : null;
  const vacia = !checks.length && !files.length;
  const nFaltan = checks.filter((c) => c.bad).length;
  const rit = st.ritBlock ? hasRIT(aud) : null;

  return (
    <Marco sub={st.sub} vacia={vacia}>
      <Cabecera titulo={st.titulo}>
        <BadgeEstado estado={completaEstado(aud, st.completa)} />
        {nFaltan > 0 ? (
          <BadgeCount alerta>{nFaltan} faltante{nFaltan === 1 ? '' : 's'}</BadgeCount>
        ) : conteo ? (
          <BadgeCount>{conteo} doc{conteo === '1' ? '' : 's'}</BadgeCount>
        ) : files.length ? (
          <BadgeCount>{files.length} doc{files.length === 1 ? '' : 's'}</BadgeCount>
        ) : null}
      </Cabecera>

      {st.ritBlock && rit !== null && (
        <div className="mb-2">
          <span className="mb-1 inline-block text-[11px] font-semibold text-acento-txt">01.1 · RIT</span>
          <div><Chip tono={rit ? 'ok' : 'bad'}>RIT</Chip></div>
        </div>
      )}

      {checks.length > 0 ? (
        <>
          {st.ritBlock && (
            <span className="mb-1 inline-block text-[11px] font-semibold text-acento-txt">
              01.2 · Documentación Visita 1
            </span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {checks.map((c, i) => (
              <Chip key={i} tono={c.ok ? 'ok' : c.bad ? 'bad' : 'neutral'}>{c.label}</Chip>
            ))}
          </div>
        </>
      ) : vacia ? (
        <p className="text-xs italic text-gris">Sin documentos aún</p>
      ) : null}

      <Archivos files={files} />
    </Marco>
  );
}

function TarjetaEstado({ titulo, estado, children }) {
  return (
    <Marco vacia={!estado}>
      <Cabecera titulo={titulo} />
      {estado ? (
        <Chip tono={estado.tono}>{estado.label}</Chip>
      ) : (
        <p className="text-xs italic text-gris">Sin información</p>
      )}
      {children}
    </Marco>
  );
}
