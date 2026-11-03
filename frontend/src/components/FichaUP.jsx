// Ficha de la unidad productiva. Recibe el documento completo de la API traducido a los nombres planos por
// adaptarUP. El estado de seguimiento no vive en unidades_productivas sino en el expediente, por eso se lee del
// registro de auditoría mediante adaptarEtapas. Reúne datos, etapas, asociados, diagnóstico, formación,
// evaluación de salida, validación de entrega e historial.
import { useRef, useState, useEffect } from 'react';
import { val, pick, fullName, formatDateEs, normDoc } from '../lib/utils';
import { estadoUpLabel, isInactiva, hasRIT } from '../lib/etapas';
import { AUDIT_JOIN_KEY } from '../lib/config';
import {
  checkBeneficiario, documentosCargados, semaforoUP,
  docsDeTipo, tipoEntrega, infoTipo, urlVisorEntrega,
} from '../lib/validador';
import { Seccion, InfoItem, Btn } from './UI';
import Etapas from './Etapas';
import HistorialUP from './HistorialUP';
import { puedeVerHistorialUP, puedeEditarUP, puedeVerAsociados, puedeVerDiagnostico, puedeVerSoportesUP } from '../lib/permisos';
import AsociadosUP from './AsociadosUP';
import DiagnosticoUP from './DiagnosticoUP';
import CoherenciaUP from './CoherenciaUP';
import EvaluacionSalidaUP from './EvaluacionSalidaUP';
import FormacionUP from './FormacionUP';
import EstadoProgramaUP from './EstadoProgramaUP';
import EditarUP from './EditarUP';
import SoportesUP from './SoportesUP';

// Componente principal de la ficha.
export default function FichaUP({ up, auditIndex, auditLoaded, auditEstado, onVolver, onActualizada, session }) {
  const ref = useRef(null);
  const [editando, setEditando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const g = (k) => val(up[k]) || '';
  const inact = isInactiva(up);

  const audId = up && up[AUDIT_JOIN_KEY] != null ? String(up[AUDIT_JOIN_KEY]).trim() : '';
  const aud = auditIndex?.[audId] || {};
  const a = (k) => val(aud[k]) || '';
  const fecha = (k) => {
    const v = a(k);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m) return v;
    return formatDateEs(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  };
  const rit = hasRIT(aud);
  const ritTexto = rit === true ? 'Sí' : rit === false ? 'No' : '';
  const sino = (k) => {
    const v = aud[k];
    if (v === true) return 'Sí';
    if (v === false) return 'No';
    return '';
  };

  async function descargarPDF() {
    setGenerando(true);
    const el = ref.current;
    el.classList.add('pdf-export');
    const cerrados = [...el.querySelectorAll('details')].filter((d) => !d.open);
    cerrados.forEach((d) => { d.open = true; });

    try {
      const { default: html2pdf } = await import('html2pdf.js');
      await html2pdf().set({
        margin: [14, 12, 16, 12],
        filename: `Informe_UP_${up.ID_unico}_${(up.unidad_nombre || 'UP').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2.5,
          useCORS: true,
          backgroundColor: '#ffffff',
          onclone: normalizarColores,
        },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      }).from(el).toPdf().get('pdf').then((pdf) => {
        const total = pdf.internal.getNumberOfPages();
        const w = pdf.internal.pageSize.getWidth();
        const h = pdf.internal.pageSize.getHeight();
        for (let i = 1; i <= total; i++) {
          pdf.setPage(i);
          pdf.setFontSize(7.5);
          pdf.setTextColor(138, 143, 158);
          pdf.text('Fundación Memories — Bitácora Memories', 12, h - 7);
          pdf.text(`Página ${i} de ${total}`, w - 12, h - 7, { align: 'right' });
        }
      }).save();
    } catch (err) {
      console.error('[bitacora] Error al generar el PDF:', err);
      alert('No se pudo generar el PDF.');
    } finally {
      cerrados.forEach((d) => { d.open = false; });
      el.classList.remove('pdf-export');
      setGenerando(false);
    }
  }

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onVolver}
          className="text-[13px] font-semibold text-gris hover:text-marino"
        >
          ← Volver a resultados
        </button>
        {puedeEditarUP(session) && up.ID_unico != null && (
          <Btn variant="secondary" className="!px-3.5 !py-2 !text-[13px]" onClick={() => setEditando(true)}>
            Editar datos de la unidad
          </Btn>
        )}
      </div>
      {editando && (
        <EditarUP
          idUnico={String(up.ID_unico)} nombre={up.unidad_nombre} session={session}
          onCerrar={() => setEditando(false)}
          onGuardado={() => { setEditando(false); onActualizada?.(); onVolver?.(); }}
        />
      )}

      <div ref={ref}>
        <div className="pdf-cabecera mb-4 hidden [.pdf-export_&]:block">
          <div className="flex items-start justify-between gap-4 border-b-2 border-marino pb-2.5">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-gris">
                Fundación Memories
              </div>
              <h1 className="text-[17px] font-bold text-marino">Informe de unidad productiva</h1>
            </div>
            <div className="text-right text-[9px] leading-snug text-gris">
              <div>Bitácora Memories</div>
              <div>Generado el {formatDateEs(new Date())}</div>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 sm:grid-cols-4 gap-y-1.5">
            {[
              ['Unidad productiva', g('unidad_nombre') || 'Sin nombre'],
              ['ID único', g('ID_unico')],
              ['Modalidad', g('modalidad')],
              ['Región', g('region')],
              ['Departamento', g('dpto')],
              ['Municipio', g('mpio')],
              ['Nodo', g('nodo')],
              ['Estado', estadoUpLabel(up) || 'Sin estado'],
            ].map(([k, v]) => (
              <div key={k} className="border-l-2 border-acento pl-2">
                <div className="text-[8px] font-bold uppercase tracking-wide text-gris">{k}</div>
                <div className="text-[10px] font-semibold text-texto">{v || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="no-print mb-4 flex items-start justify-between gap-4 rounded-card bg-marino p-5">
          <div>
            <h2 className="text-lg font-bold text-white">{g('unidad_nombre') || 'Sin nombre'}</h2>
            <p className="text-[13px] text-[rgba(255,255,255,0.6)]">
              ID {g('ID_unico')} · {g('modalidad')} · Región {g('region')}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
            inact === null ? 'bg-[#3a4050] text-[#c9ccd4]'
              : inact ? 'bg-[#5c2626] text-[#ffb3b3]' : 'bg-[#1f4d35] text-[#8fe0b0]'
          }`}>
            {estadoUpLabel(up) || 'Sin estado'}
          </span>
        </div>

        <Seccion titulo="Datos de identificación">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Nombre completo" value={fullName(up)} />
            <InfoItem label="Documento" value={g('integrante_doc_inicial')} />
            <InfoItem label="Fecha de expedición" value={g('integrante_doc_expedicion')} />
            <InfoItem label="Fecha de nacimiento" value={g('integrante_nacimiento')} />
            <InfoItem label="Sexo" value={g('integrante_sexo')} />
            <InfoItem label="Departamento" value={g('dpto')} />
            <InfoItem label="Municipio" value={g('mpio')} />
            <InfoItem label="Dirección" value={g('unidad_direccion')} />
            <InfoItem label="Teléfono 1" value={g('unidad_tel1')} />
            <InfoItem label="Teléfono 2" value={g('unidad_tel2')} />
            <InfoItem label="Correo" value={g('unidad_mail1')} />
            <InfoItem label="Correo 2" value={g('unidad_mail2')} />
            <InfoItem label="Documentos RIT" value={g('integrantes_RIT')} />
            <InfoItem label="Sector" value={g('unidad_sector')} />
            <InfoItem label="Actividad" value={g('unidad_actividad')} />
            <InfoItem label="NIT" value={g('nit')} />
            <InfoItem label="Doc. unidad" value={g('unidad_doc')} />
            <InfoItem label="Modalidad" value={g('modalidad')} />
          </div>
        </Seccion>

        <Seccion titulo="Gestor asignado">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Cédula gestor" value={g('cedula_gestor')} />
            <InfoItem label="Nombre" value={g('nombre_gestor')} />
            <InfoItem label="Correo" value={g('correo_gestor')} />
            <InfoItem label="Teléfono" value={g('telefono_gestor')} />
            <InfoItem label="Tríada" value={g('triada')} />
            <InfoItem label="Nodo" value={g('nodo')} />
          </div>
        </Seccion>

        <Seccion titulo="Estado de seguimiento">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Estado de la UP" value={estadoUpLabel(up)} />
            <InfoItem label="Actualización" value={g('ACTUALIZACION')} />
            <InfoItem label="Resultado" value={g('RESULTADO')} />
            <InfoItem label="Tipo de novedad" value={g('novedades_tipo')} />
            <InfoItem label="Fecha visita" value={fecha('V1_FECHA_VISITA')} />
            <InfoItem label="Reprogramación" value={fecha('V1_FECHA_REPROGRAMACION')} />
            <InfoItem label="Agendamiento" value={a('V1_ESTADO_AGENDAMIENTO')} />
            <InfoItem label="Modalidad visita" value={a('V1_MODALIDAD')} />
            <InfoItem label="RIT" value={ritTexto} />
            <InfoItem label="Fecha enviado RIT" value={fecha('RIT_FECHA_ENVIADO')} />
            <InfoItem label="Días desde el RIT" value={a('RIT_TOTAL_DIAS')} />
            <InfoItem label="Dirección del RIT" value={a('RIT_DIRECCION')} />
          </div>
        </Seccion>

        <Seccion titulo="Control y aprobación">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="U.P. aprobada" value={sino('UP_APROBADA')} />
            <InfoItem label="Lote de aprobación" value={a('LOTE_UP_APROBADA')} />
            <InfoItem label="Doc. completa gestor" value={sino('DOC_COMPLETA_GESTOR')} />
            <InfoItem label="Doc. completa tríada" value={sino('DOC_COMPLETA_TRIADA')} />
            <InfoItem label="Novedad DPS (gestor)" value={a('NOVEDAD_DPS_GESTOR')} />
            <InfoItem label="Contacto no posible" value={a('NOVEDAD_CONTACTO_NO_POSIBLE')} />
            <InfoItem label="Doc. interventoría" value={g('doc_interventoria')} />
          </div>
        </Seccion>

        {(up._retiro || up._cierre) && (
          <div className="no-print">
            <EstadoProgramaUP retiro={up._retiro} cierre={up._cierre} />
          </div>
        )}

        {puedeVerAsociados(session) && up.ID_unico != null && (
          <div className="no-print">
            <Seccion titulo="Asociados de la unidad">
              <AsociadosUP idUnico={String(up.ID_unico)} />
            </Seccion>
          </div>
        )}

        {puedeVerDiagnostico(session) && up.ID_unico != null && (
          <div className="no-print">
            <Seccion titulo="Diagnóstico de la unidad" abierta={false} mantener>
              <DiagnosticoUP idUnico={String(up.ID_unico)} conRevision />
            </Seccion>
            <Seccion titulo="Evaluación de salida" abierta={false} mantener>
              <EvaluacionSalidaUP idUnico={String(up.ID_unico)} conRevision />
            </Seccion>
            <Seccion titulo="Coherencia de la carpeta" abierta={false}>
              <CoherenciaUP idUnico={String(up.ID_unico)} />
            </Seccion>
            <Seccion titulo="Formación en los talleres" abierta={false}>
              <FormacionUP idUnico={String(up.ID_unico)} />
            </Seccion>
          </div>
        )}

        {puedeVerSoportesUP(session) && up.ID_unico != null && (
          <div className="no-print">
            <Seccion titulo="Expediente documental" abierta={false}>
              <SoportesUP idUnico={String(up.ID_unico)} />
            </Seccion>
          </div>
        )}

        <Seccion titulo="Validación de documentos de entrega">
          <ValidacionEntrega up={up} />
        </Seccion>

        <Seccion titulo="Revisión documental por etapas">
          <Etapas up={up} auditIndex={auditIndex} auditLoaded={auditLoaded} auditEstado={auditEstado} conFormacion={puedeVerDiagnostico(session)} />
        </Seccion>

        <Seccion titulo="Observaciones">
          <Observaciones up={up} />
        </Seccion>

        {puedeVerHistorialUP(session) && (
          <div className="no-print">
            <Seccion titulo="Historial de cambios">
              <HistorialUP up={up} session={session} />
            </Seccion>
          </div>
        )}
      </div>

      <div className="no-print mt-4 flex flex-wrap gap-2.5">
        <Btn onClick={descargarPDF} disabled={generando}>
          {generando ? 'Generando PDF…' : 'Descargar PDF'}
        </Btn>
        {enlaceCarpeta(up) && (
          <a
            href={enlaceCarpeta(up)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-borde bg-card px-4 py-2.5 text-sm font-semibold text-texto hover:border-acento"
          >
            Abrir carpeta
          </a>
        )}
      </div>
    </div>
  );
}

// Colores de las etiquetas de estado de la validación de documentos de entrega.
const TONO_CHIP = {
  vacio: 'bg-bg text-gris',
  espera: 'bg-acento/25 text-aviso-txt',
  malo: 'bg-rojo/15 text-rojo',
  bueno: 'bg-verde-ok/15 text-verde-ok',
};

// Muestra el estado de la validación de documentos de entrega de la unidad.
function ValidacionEntrega({ up }) {
  const cedula = normDoc(val(up.integrante_doc_inicial) || val(up.unidad_doc) || '');
  const [estado, setEstado] = useState('cargando');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let vigente = true;
    if (!cedula) { setEstado('vacio'); return undefined; }
    setEstado('cargando'); setInfo(null);
    checkBeneficiario(cedula)
      .then((r) => {
        if (!vigente) return;
        if (r?.exito) { setInfo(r); setEstado('ok'); }
        else setEstado('vacio');
      })
      .catch((err) => {
        console.error('[bitacora][E-VALIDACION] check:', err);
        if (vigente) setEstado('error');
      });
    return () => { vigente = false; };
  }, [cedula]);

  if (estado === 'cargando') {
    return <p className="text-[13px] text-gris">Consultando el estado de validación…</p>;
  }
  if (estado === 'error') {
    return <p className="text-[13px] text-gris">No se pudo consultar el estado de validación.</p>;
  }
  if (estado === 'vacio' || !info) {
    return (
      <p className="text-[13px] text-gris">
        Esta unidad productiva todavía no tiene un proceso de validación de entrega.
      </p>
    );
  }

  const sem = semaforoUP(info.estado_validacion);
  const cargados = documentosCargados(info);
  const porCorregir = info.por_corregir || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONO_CHIP[sem.tono]}`}>
          {sem.label}
        </span>
        <span className="text-[12px] text-gris">
          {cargados.length} de {docsDeTipo(tipoEntrega(info)).length} soportes cargados
          {' · '}{infoTipo(tipoEntrega(info)).label}
        </span>
      </div>

      {porCorregir.length > 0 && (
        <div className="mb-3 rounded-lg border border-rojo/35 bg-rojo/6 p-3">
          <p className="mb-1 text-[13px] font-semibold text-rojo">
            Documentos por corregir ({porCorregir.length})
          </p>
          <ul className="space-y-0.5">
            {porCorregir.map((p) => (
              <li key={p.clave} className="text-[12px] text-texto">
                ⚠ {p.label}{p.observacion ? ` — ${p.observacion}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {cargados.length > 0 ? (
        <ul className="space-y-1">
          {cargados.map((d) => (
            <li key={d.clave} className="flex items-center justify-between gap-3 text-[13px] text-texto">
              <span>✓ {d.label}</span>
              {urlVisorEntrega(d, info, cedula) && (
                <a href={urlVisorEntrega(d, info, cedula)} target="_blank" rel="noopener noreferrer"
                  className="no-print shrink-0 text-[11px] font-semibold text-marino hover:underline">
                  Ver documento
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-gris">Todavía no se ha cargado ningún soporte de entrega.</p>
      )}
    </div>
  );
}

function Observaciones({ up }) {
  const g = (k) => val(up[k]) || '';
  const items = [
    ['Observaciones generales', g('OBSERVACIONES') || g('observaciones')],
    ['Producto o servicio', g('Quéproductooservicioestásd')],
    ['Necesidades o dificultades', g('Quénecesidadesodificultades')],
  ].filter(([, v]) => v);

  if (!items.length) return <p className="text-[13px] italic text-gris">Sin observaciones</p>;

  return items.map(([t, v]) => <Observacion key={t} titulo={t} texto={v} />);
}

// Muestra una observación recortada en pantalla y completa en el PDF.
function Observacion({ titulo, texto, limite = 280 }) {
  const [abierto, setAbierto] = useState(false);
  const esLargo = texto.length > limite;
  return (
    <div className="mb-2.5 rounded-lg bg-bg p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gris">{titulo}</div>
      <p className={`text-[13px] leading-relaxed text-texto ${
        esLargo && !abierto ? 'line-clamp-4' : ''
      } [.pdf-export_&]:line-clamp-none`}>
        {texto}
      </p>
      {esLargo && (
        <button type="button" onClick={() => setAbierto((v) => !v)}
          className="no-print mt-1.5 text-[11px] font-bold uppercase tracking-wide text-acento-txt hover:underline">
          {abierto ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  );
}

// Fija en el clon cada color en un formato que html2canvas entienda, porque no interpreta oklab, oklch ni
// color-mix que genera Tailwind 4.
function normalizarColores(doc) {
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor'];
  const origen = document.querySelectorAll('*');
  const clon = doc.querySelectorAll('*');
  for (let i = 0; i < clon.length && i < origen.length; i++) {
    const calculado = window.getComputedStyle(origen[i]);
    for (const prop of PROPS) {
      const v = calculado[prop];
      if (!v) continue;
      if (/oklab|oklch|color-mix|lab\(|lch\(/.test(v)) {
        clon[i].style[prop] = prop === 'backgroundColor' ? 'transparent' : 'rgb(43,40,86)';
      } else if (v.startsWith('rgb')) {
        clon[i].style[prop] = v;
      }
    }
  }
}

// Busca el enlace de la carpeta de forma tolerante: puede venir con espacios, sin protocolo o con el nombre de
// columna distinto.
function enlaceCarpeta(up) {
  const raw = val(pick(up, ['enlace_carpeta', 'ENLACE_CARPETA', 'enlace carpeta', 'link_carpeta']));
  if (!raw) return null;
  const url = String(raw).trim();
  if (!url || url === '-') return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[\w-]+(\.[\w-]+)+\//.test(url) || url.startsWith('www.')) return `https://${url}`;
  return null;
}
