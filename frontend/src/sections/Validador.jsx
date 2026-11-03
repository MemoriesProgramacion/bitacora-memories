// Validador de documentos de entrega, dentro de la Bitácora. El almacenamiento y el estado de cada soporte
// viven en el servidor y la coordinación aprueba o devuelve cada uno; aquí solo se consume esa API. Funciona en
// pasos: cédula, opciones, tipo de entrega, carga de soportes y resultado.
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  DOCS_ENTREGA, checkBeneficiario, guardarCorreos,
  descargarPrellenados, subirInicial, subirCorrecciones, descargarBase64,
  validarTipoSoporte, validarFormatoSoporte, validarSoporte, validarTamanoTotal,
  estaCargado, estaAprobado, documentosCargados, semaforoUP,
  urlVisorEntrega, esVideo,
  TIPOS_ENTREGA, docsDeTipo, tipoEntrega, infoTipo, puedeCambiarTipo, mb,
} from '../lib/validador';
import { comprimirVideo, esArchivoVideo, CompresionCancelada, validarDuracionMaxima } from '../lib/comprimirVideo';
import { val, fullName, normDoc } from '../lib/utils';
import { EncabezadoSeccion, Card, Btn, Aviso, Spinner } from '../components/UI';

// Paleta de estados del validador, con rgba planos para seguir la convención del proyecto.
const TONOS = {
  vacio:  { fondo: 'rgba(138,143,158,0.06)', borde: 'var(--color-borde)',             texto: 'var(--tono-vacio-txt)', punto: '#b3b7c1' },
  espera: { fondo: 'rgba(245,164,136,0.09)',  borde: 'rgba(245,164,136,0.40)', texto: 'var(--tono-espera-txt)', punto: '#E8A15F' },
  malo:   { fondo: 'rgba(209,77,106,0.06)',   borde: 'rgba(209,77,106,0.30)',  texto: 'var(--tono-malo-txt)', punto: '#d65a5a' },
  bueno:  { fondo: 'rgba(56,161,105,0.07)',  borde: 'rgba(56,161,105,0.32)', texto: 'var(--tono-bueno-txt)', punto: '#3f9a6a' },
};

// Controla los pasos del validador y la comunicación con la API.
export default function Validador({ data }) {
  const [paso, setPaso] = useState('cedula');
  const [tipo, setTipo] = useState('completa');
  const [cedula, setCedula] = useState('');
  const [info, setInfo] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState(null);
  const [prellenados, setPrellenados] = useState(null);

  const [correoGestor, setCorreoGestor] = useState('');
  const [correoPersonal, setCorreoPersonal] = useState('');

  const [modoCedula, setModoCedula] = useState('foto');
  const [archivos, setArchivos] = useState({});

  const corrigiendo = info?.estado_validacion === 'correcciones';
  const porCorregir = info?.por_corregir || [];

  const docsTipo = docsDeTipo(tipo);
  const faltantes = info
    ? docsDeTipo(tipoEntrega(info)).filter((d) => !d.opcional && !estaCargado(info, d.clave))
    : [];
  const enRevision = !corrigiendo && !!info && faltantes.length === 0;

  const cedulaYaCargada = (info?.documentos_cargados?.length || 0) > 0;

  const sugerencias = useMemo(() => {
    const q = normDoc(cedula);
    if (q.length < 3) return [];
    return data.filter((up) => normDoc(up.integrante_doc_inicial || up.unidad_doc).startsWith(q))
      .slice(0, 6);
  }, [cedula, data]);

  const [estadosSugeridos, setEstadosSugeridos] = useState({});
  const pedidosRef = useRef(new Set());
  useEffect(() => {
    sugerencias.forEach((up) => {
      const doc = normDoc(up.integrante_doc_inicial || up.unidad_doc);
      if (!doc || pedidosRef.current.has(doc)) return;
      pedidosRef.current.add(doc);
      checkBeneficiario(doc)
        .then((r) => setEstadosSugeridos((s) => ({
          ...s, [doc]: r.exito ? (r.estado_validacion || 'pendiente') : 'error',
        })))
        .catch(() => setEstadosSugeridos((s) => ({ ...s, [doc]: 'error' })));
    });
  }, [sugerencias]);

  function reiniciar() {
    setPaso('cedula'); setInfo(null); setError(''); setAviso(null);
    setPrellenados(null); setArchivos({}); setModoCedula('foto'); setTipo('completa');
    setCorreoGestor(''); setCorreoPersonal('');
  }

  async function consultar(doc) {
    const ced = normDoc(doc ?? cedula);
    if (!ced) { setError('Escribe el número de cédula del beneficiario.'); return; }

    const enAlcance = data.some(
      (up) => normDoc(up.integrante_doc_inicial || up.unidad_doc) === ced
    );
    if (!enAlcance) {
      setError('Esa cédula no pertenece a una unidad productiva de tu nodo.');
      return;
    }

    setCedula(ced); setError(''); setAviso(null); setPrellenados(null);
    setOcupado('Verificando en la base de datos…');
    try {
      const r = await checkBeneficiario(ced);
      if (!r.exito) { setError(r.mensaje || 'Beneficiario no encontrado.'); return; }
      setInfo(r);
      setArchivos({});
      setTipo(tipoEntrega(r));
      const todoCargado = docsDeTipo(tipoEntrega(r))
        .filter((d) => !d.opcional)
        .every((d) => estaCargado(r, d.clave));
      if (r.estado_validacion === 'completo') {
        setAviso({ tono: 'ok', estado: 'completo', soloLectura: true, titulo: 'Proceso completado',
          texto: 'Los documentos ya fueron aprobados. No se requieren acciones adicionales.' });
        setPaso('final');
      } else if (r.estado_validacion !== 'correcciones' && todoCargado) {
        setAviso({
          tono: 'warn', estado: 'en_revision', soloLectura: true,
          titulo: 'Documentación en revisión',
          texto: puedeCambiarTipo(r)
            ? 'Los soportes están cargados y en revisión. Como la entrega no fue completa, todavía puedes cambiar el tipo y volver a registrarla.'
            : 'Los soportes están cargados y en revisión. Podrás modificarlos cuando el revisor apruebe o señale correcciones.',
          puedeCambiar: puedeCambiarTipo(r),
        });
        setPaso('final');
      } else {
        setPaso('opciones');
      }
    } catch (e) {
      console.error('[bitacora][E-VALIDADOR] check:', e);
      setError('No se pudo consultar el validador. Revisa la conexión e intenta de nuevo.');
    } finally { setOcupado(''); }
  }

  async function irACarga() {
    setError('');
    if (correoGestor && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correoGestor)) {
      setError('El correo del gestor no es válido.'); return;
    }
    if (correoGestor || correoPersonal) {
      setOcupado('Guardando correos…');
      try { await guardarCorreos(cedula, correoGestor, correoPersonal); }
      catch (e) { console.error('[bitacora][E-VALIDADOR] correos:', e); }
      finally { setOcupado(''); }
    }
    setArchivos({});
    setPaso(corrigiendo ? 'carga' : 'tipo');
  }

  async function verPrellenados() {
    setError(''); setPrellenados(null);
    setOcupado('Buscando documentos prediligenciados…');
    try {
      const r = await descargarPrellenados(cedula);
      if (r.exito && r.documentos?.length) setPrellenados(r.documentos);
      else setError(r.mensaje || 'Documentos prediligenciados no encontrados o aún sin cargar.');
    } catch (e) {
      console.error('[bitacora][E-VALIDADOR] prellenados:', e);
      setError('No se pudieron consultar los documentos.');
    } finally { setOcupado(''); }
  }

  async function subir() {
    setError('');
    try {
      if (corrigiendo) {
        const faltan = porCorregir
          .map((d) => DOCS_ENTREGA.find((x) => x.clave === d.clave))
          .filter((doc) => doc && !archivos[doc.campo]);
        if (faltan.length) {
          setError('Falta subir: ' + faltan.map((f) => f.label).join(', ')); return;
        }
        const errTotalC = validarTamanoTotal(archivos);
        if (errTotalC) { setError(errTotalC); return; }
        setOcupado('Subiendo correcciones…');
        const r = await subirCorrecciones(cedula, porCorregir, archivos);
        if (!r.exito) { setError(r.mensaje || 'No se pudieron subir las correcciones.'); return; }
        setAviso({ tono: 'warn', estado: 'en_revision', titulo: 'Correcciones enviadas',
          texto: `Las correcciones de ${r.nombre} quedaron en revisión. Se notificará por correo.` });
        setPaso('final');
        return;
      }

      if (!cedulaYaCargada) {
        if (modoCedula === 'pdf') {
          const f = archivos.archivo_cedula_pdf;
          if (!f) { setError('Falta el PDF de la cédula.'); return; }
          if (!f.name.toLowerCase().endsWith('.pdf')) {
            setError('El archivo de la cédula debe ser un PDF. Si tienes fotos, elige la opción "Fotos".');
            return;
          }
        } else {
          if (!archivos.archivo_frontal) { setError('Falta la foto FRONTAL de la cédula.'); return; }
          if (!archivos.archivo_trasera) { setError('Falta la foto TRASERA de la cédula.'); return; }
        }
      }
      const cambioTipo = !!info && tipo !== tipoEntrega(info);
      const faltan = docsTipo.filter((d) =>
        !d.opcional &&
        !archivos[d.campo] &&
        !(estaCargado(info, d.clave) && (!cambioTipo || estaAprobado(info, d.clave)))
      );
      if (faltan.length) { setError('Falta: ' + faltan.map((f) => f.label).join(', ')); return; }
      for (const d of docsTipo) {
        const errTipo = validarTipoSoporte(d, archivos[d.campo]);
        if (errTipo) { setError(errTipo); return; }
      }
      const errTotal = validarTamanoTotal(archivos);
      if (errTotal) { setError(errTotal); return; }

      setOcupado('Analizando documentos…');
      const r = await subirInicial(cedula, { modoCedula, archivos, tipo });
      if (!r.exito) { setError(r.mensaje || 'No se pudieron subir los documentos.'); return; }
      setAviso({ tono: 'warn', estado: 'en_revision',
        titulo: tipo === 'completa' ? 'Documentos recibidos' : `Registro de ${infoTipo(tipo).label.toLowerCase()} recibido`,
        texto: `Los soportes de ${r.nombre} quedaron en revisión. Se notificará por correo si hay correcciones.` });
      setPaso('final');
    } catch (e) {
      console.error('[bitacora][E-VALIDADOR] upload:', e);
      setError(
        'No se pudo completar la subida. Suele pasar cuando los archivos pesan ' +
        'demasiado o la conexión se interrumpe: revisa el tamaño del video e intenta de nuevo. ' +
        `(Detalle: ${e?.message || 'sin detalle'})`
      );
    } finally { setOcupado(''); }
  }

  const tonoFinal = semaforoUP(aviso?.estado).tono;

  return (
    <>
      <EncabezadoSeccion
        titulo="Validador documentos entrega"
        subtitulo="Carga y verificación de los soportes de entrega de la unidad productiva."
      />

      <Card className="overflow-hidden shadow-[0_1px_2px_rgba(43,40,86,0.04),0_2px_8px_rgba(43,40,86,0.04)]">
        <div className="border-b border-borde bg-[var(--color-panel)] px-5 py-4 sm:px-7">
          <Pasos actual={paso} tonoFinal={paso === 'final' ? tonoFinal : null} />
        </div>

        <div className="px-4 py-5 sm:px-7 sm:py-6">
          {ocupado ? (
            <Spinner texto={ocupado} />
          ) : (
            <>
              {error && <Aviso tono="bad" className="mx-auto max-w-2xl">{error}</Aviso>}

              {paso === 'cedula' && (
                <PasoCedula
                  cedula={cedula} setCedula={setCedula} onConsultar={consultar}
                  sugerencias={sugerencias} estados={estadosSugeridos}
                />
              )}

              {paso === 'opciones' && (
                <PasoOpciones
                  info={info} corrigiendo={corrigiendo} porCorregir={porCorregir}
                  correoGestor={correoGestor} setCorreoGestor={setCorreoGestor}
                  correoPersonal={correoPersonal} setCorreoPersonal={setCorreoPersonal}
                  prellenados={prellenados} enRevision={enRevision} cedula={cedula}
                  onValidar={irACarga} onPrellenados={verPrellenados} onVolver={reiniciar}
                />
              )}

              {paso === 'tipo' && (
                <PasoTipo
                  info={info} tipo={tipo}
                  onElegir={(t) => { setTipo(t); setArchivos({}); setError(''); setPaso('carga'); }}
                  onVolver={() => { setPaso('opciones'); setError(''); }}
                />
              )}

              {paso === 'carga' && (
                <PasoCarga
                  info={info} corrigiendo={corrigiendo} porCorregir={porCorregir}
                  modoCedula={modoCedula} setModoCedula={setModoCedula}
                  pedirCedula={!cedulaYaCargada} cedula={cedula}
                  tipo={tipo} docsTipo={docsTipo}
                  archivos={archivos} setArchivos={setArchivos}
                  onSubir={subir}
                  onVolver={() => { setPaso(corrigiendo ? 'opciones' : 'tipo'); setError(''); }}
                />
              )}

              {paso === 'final' && aviso && (
                <PasoResultado
                  aviso={aviso} info={info} prellenados={prellenados} cedula={cedula}
                  onPrellenados={verPrellenados} onReiniciar={reiniciar}
                  onCambiarTipo={() => { setArchivos({}); setError(''); setPaso('tipo'); }}
                />
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}

const PASOS = [
  { id: 'cedula', label: 'Beneficiario' },
  { id: 'opciones', label: 'Opciones' },
  { id: 'tipo', label: 'Tipo de entrega' },
  { id: 'carga', label: 'Documentos' },
  { id: 'final', label: 'Resultado' },
];

function IconoCheck({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconoDoc({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}

function IconoVideo({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  );
}

function IconoCandado({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// Muestra el avance horizontal de los pasos; el cuarto toma el color del estado cuando se está en el resultado.
function Pasos({ actual, tonoFinal }) {
  const i = PASOS.findIndex((p) => p.id === actual);
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {PASOS.map((p, idx) => {
        const hecho = idx < i;
        const activo = idx === i;
        const t = activo && tonoFinal ? TONOS[tonoFinal] : null;
        const estiloCirculo = t
          ? { background: t.fondo, borderColor: t.borde, color: t.texto }
          : undefined;
        return (
          <li key={p.id} className={`flex items-center gap-2 sm:gap-3 ${idx < PASOS.length - 1 ? 'flex-1' : ''}`}>
            <span className="flex items-center gap-2">
              <span
                style={estiloCirculo}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${
                  t ? ''
                    : activo ? 'border-marino bg-marino text-white'
                    : hecho ? 'border-[rgba(56,161,105,0.35)] bg-[rgba(56,161,105,0.10)] text-verde-ok'
                    : 'border-borde bg-card text-gris'
                }`}>
                {hecho ? <IconoCheck className="h-3 w-3" /> : idx + 1}
              </span>
              <span className={`hidden whitespace-nowrap text-[13px] sm:inline ${
                activo ? 'font-semibold text-marino' : hecho ? 'text-texto' : 'text-gris'
              }`}>
                {p.label}
              </span>
            </span>
            {idx < PASOS.length - 1 && (
              <span className={`h-px flex-1 ${hecho ? 'bg-[rgba(56,161,105,0.35)]' : 'bg-borde'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

const inputCls =
  'w-full rounded-lg border border-campo bg-card px-3.5 py-2.5 text-sm text-texto outline-none transition ' +
  'placeholder:text-gris hover:border-gris focus:border-[var(--color-foco)] focus:shadow-[0_0_0_3px_var(--color-acento-borde)]';

function Etiqueta({ children, opcional }) {
  return (
    <label className="mb-1.5 block text-[13px] font-medium text-texto">
      {children}
      {opcional && <span className="ml-1.5 text-[12px] font-normal text-gris">Opcional</span>}
    </label>
  );
}

function BotonVolver({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="-ml-2 mb-5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-gris transition hover:bg-bg hover:text-marino">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {children}
    </button>
  );
}

function ChipEstado({ tono, children }) {
  const t = TONOS[tono] || TONOS.vacio;
  return (
    <span style={{ background: t.fondo, borderColor: t.borde, color: t.texto }}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.punto }} />
      {children}
    </span>
  );
}

// Muestra la cabecera con el nombre del beneficiario, reutilizada en los pasos 2 a 4.
function FichaBeneficiario({ info, children }) {
  const iniciales = (info?.nombre || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return (
    <div className="mb-6 flex items-center gap-3.5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marino text-[13px] font-semibold text-white">
        {iniciales}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold text-marino">{info?.nombre}</h3>
          {info?.tipo && (
            <span className="rounded border border-[rgba(245,164,136,0.45)] bg-[rgba(245,164,136,0.12)] px-1.5 py-px text-[11px] font-semibold text-aviso-txt">
              {info.tipo}
            </span>
          )}
        </div>
        {children && <div className="mt-0.5 text-[12px] text-gris">{children}</div>}
      </div>
    </div>
  );
}

// Paso en el que se busca al beneficiario por su cédula.
function PasoCedula({ cedula, setCedula, onConsultar, sugerencias, estados }) {
  return (
    <div className="mx-auto max-w-xl">
      <h3 className="text-[15px] font-semibold text-marino">Buscar beneficiario</h3>
      <p className="mb-5 text-[13px] text-gris">Escribe el número de identificación o elige una coincidencia de tu nodo.</p>

      <Etiqueta>Número de identificación</Etiqueta>
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input
          type="text" inputMode="numeric" value={cedula}
          onChange={(e) => setCedula(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConsultar(); }}
          placeholder="Ej. 1032456789" autoComplete="off" className={`${inputCls} pl-9`}
        />
      </div>

      {sugerencias.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[12px] text-gris">
            {sugerencias.length} coincidencia{sugerencias.length === 1 ? '' : 's'} en la bitácora
          </p>
          <ul className="space-y-2">
            {sugerencias.map((up) => {
              const doc = val(up.integrante_doc_inicial) || val(up.unidad_doc);
              const estado = estados?.[normDoc(doc)];
              const consultado = estado && estado !== 'error';
              const sem = semaforoUP(estado);
              const t = consultado ? TONOS[sem.tono] : TONOS.vacio;
              return (
                <li key={up.ID_unico}>
                  <button type="button" onClick={() => onConsultar(doc)}
                    style={{ background: consultado ? t.fondo : undefined, borderColor: t.borde, borderLeftColor: t.punto }}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border border-l-[3px] bg-card px-3.5 py-2.5 text-left transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(43,40,86,0.08)] focus-visible:-translate-y-0.5 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(43,40,86,0.10)] sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-snug text-texto sm:truncate">
                        {val(up.unidad_nombre) || 'Sin nombre'}
                      </span>
                      <span className="block truncate text-[12px] text-gris">{fullName(up)} · {doc}</span>
                    </span>
                    <span className="col-start-1 row-start-2 justify-self-start sm:col-start-2 sm:row-start-1">
                      {consultado
                        ? <ChipEstado tono={sem.tono}>{sem.label}</ChipEstado>
                        : <span className="text-[11px] text-[#b3b7c1]">Consultando…</span>}
                    </span>
                    <svg className="col-start-2 row-span-2 row-start-1 h-4 w-4 text-[#b3b7c1] transition group-hover:translate-x-0.5 group-hover:text-marino sm:col-start-3 sm:row-span-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Btn onClick={() => onConsultar()} className="w-full sm:w-auto sm:min-w-32">Continuar</Btn>
      </div>
    </div>
  );
}

// Paso con las opciones disponibles para el beneficiario.
function PasoOpciones({
  info, corrigiendo, porCorregir, correoGestor, setCorreoGestor,
  correoPersonal, setCorreoPersonal, prellenados, enRevision, cedula,
  onValidar, onPrellenados, onVolver,
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <BotonVolver onClick={onVolver}>Cambiar de beneficiario</BotonVolver>

      <FichaBeneficiario info={info}>
        {corrigiendo
          ? <ChipEstado tono="malo">{porCorregir.length} documento{porCorregir.length === 1 ? '' : 's'} por corregir</ChipEstado>
          : 'Configura las notificaciones antes de cargar los soportes.'}
      </FichaBeneficiario>

      <DocumentosCargadosResumen info={info} cedula={cedula} tono={corrigiendo ? 'malo' : 'espera'} />

      <section className="rounded-lg border border-borde p-4 sm:p-5">
        <h4 className="text-[14px] font-semibold text-marino">Notificaciones</h4>
        <p className="mb-4 text-[12px] text-gris">
          Estos correos recibirán el aviso de aprobación o de las correcciones por subsanar.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Etiqueta>Correo del gestor</Etiqueta>
            <input type="email" value={correoGestor} onChange={(e) => setCorreoGestor(e.target.value)}
              placeholder="gestor@ejemplo.com" className={inputCls} />
          </div>
          <div>
            <Etiqueta opcional>Correo personal adicional</Etiqueta>
            <input type="email" value={correoPersonal} onChange={(e) => setCorreoPersonal(e.target.value)}
              placeholder="personal@ejemplo.com" className={inputCls} />
          </div>
        </div>
      </section>

      {enRevision && (
        <Aviso tono="warn" className="mt-4">
          Los documentos de este beneficiario ya están cargados y en revisión.
        </Aviso>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2.5 border-t border-borde pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <Btn variant="secondary" onClick={onPrellenados}>Documentos prediligenciados</Btn>
        {!enRevision && (
          <Btn onClick={onValidar}>{corrigiendo ? 'Subir correcciones' : 'Validar documentos'}</Btn>
        )}
      </div>

      <ListaPrellenados prellenados={prellenados} />
    </div>
  );
}

function ListaPrellenados({ prellenados }) {
  if (!prellenados) return null;
  const lista = prellenados.filter((doc) => !doc.nombre?.toUpperCase().includes('VISITA'));
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-borde">
      <div className="bg-[var(--color-panel)] px-4 py-2.5 text-[13px] font-semibold text-marino">
        Documentos disponibles <span className="font-normal text-gris">({lista.length})</span>
      </div>
      <ul className="divide-y divide-borde">
        {lista.map((doc) => (
          <li key={doc.nombre}>
            <button type="button" onClick={() => descargarBase64(doc)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-texto transition hover:bg-bg">
              <IconoDoc className="h-4 w-4 shrink-0 text-gris" />
              <span className="min-w-0 flex-1 truncate">{doc.nombre}</span>
              <span className="text-[12px] font-medium text-marino">Descargar</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Lista los soportes ya cargados en la base, que es la única fuente de verdad; ver abre el archivo aquí mismo.
function DocumentosCargadosResumen({ info, cedula, tono = 'espera', etiqueta }) {
  const cargados = documentosCargados(info);
  const total = docsDeTipo(tipoEntrega(info)).length;
  const [abierto, setAbierto] = useState(null);
  if (!cargados.length) return null;
  const t = TONOS[tono];
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-borde">
      <div className="flex items-center justify-between gap-3 bg-[var(--color-panel)] px-4 py-2.5">
        <span className="text-[13px] font-semibold text-marino">Documentación cargada</span>
        <span className="text-[12px] text-gris">{cargados.length} de {total}</span>
      </div>
      <div className="h-1 bg-bg">
        <div className="h-full transition-all" style={{ width: `${(cargados.length / Math.max(total, 1)) * 100}%`, background: t.punto }} />
      </div>
      <ul className="divide-y divide-borde">
        {cargados.map((d) => {
          const url = urlVisorEntrega(d, info, cedula);
          const visible = abierto === d.clave;
          return (
            <li key={d.clave}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg text-gris">
                  {esVideo(d) ? <IconoVideo /> : <IconoDoc />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-texto">{d.label}</span>
                {etiqueta && <ChipEstado tono={tono}>{etiqueta}</ChipEstado>}
                {url ? (
                  <button type="button"
                    onClick={() => setAbierto(visible ? null : d.clave)}
                    className="shrink-0 rounded-md border border-borde bg-card px-2.5 py-1 text-[12px] font-medium text-marino transition hover:bg-bg">
                    {visible ? 'Ocultar' : 'Ver'}
                  </button>
                ) : <span className="w-8" />}
              </div>
              {visible && <VisorSoporte doc={d} url={url} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Visor del soporte: un iframe para los PDF y un reproductor para el video.
function VisorSoporte({ doc, url }) {
  const [fallo, setFallo] = useState(false);
  return (
    <div className="border-t border-borde bg-[var(--color-panel)] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-gris">{doc.label}</span>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="rounded-md border border-borde bg-card px-2.5 py-1 text-[12px] font-medium text-marino transition hover:bg-bg">
          Abrir aparte
        </a>
      </div>
      {esVideo(doc) ? (
        fallo ? (
          <p className="text-[12px] text-gris">
            El navegador no pudo reproducir este video. Ábrelo aparte para verlo o descargarlo.
          </p>
        ) : (
          <video src={url} controls preload="metadata" onError={() => setFallo(true)}
            className="w-full rounded-lg border border-borde bg-black" style={{ maxHeight: 420 }} />
        )
      ) : (
        <iframe src={`${url}#toolbar=1&navpanes=0`} title={doc.label} loading="lazy"
          className="no-print h-[520px] w-full rounded-lg border border-borde bg-white" />
      )}
    </div>
  );
}

// Paso final con el resultado; si llega desde la consulta es de solo lectura y el color de la tarjeta refleja
// el estado.
function PasoResultado({ aviso, info, prellenados, cedula, onPrellenados, onReiniciar, onCambiarTipo }) {
  const sem = semaforoUP(aviso.estado);
  const t = TONOS[sem.tono] || TONOS.bueno;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 rounded-xl border p-5" style={{ background: t.fondo, borderColor: t.borde }}>
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card"
            style={{ color: t.punto, boxShadow: `inset 0 0 0 1.5px ${t.borde}` }}>
            {sem.tono === 'bueno'
              ? <IconoCheck className="h-5 w-5" />
              : <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-semibold text-marino">{aviso.titulo}</h3>
              <ChipEstado tono={sem.tono}>{sem.label}</ChipEstado>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: t.texto }}>{aviso.texto}</p>
          </div>
        </div>
        {info && (
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-[13px]" style={{ borderColor: t.borde }}>
            <span className="font-semibold text-marino">{info.nombre}</span>
            {info.tipo && <span className="text-gris">· {info.tipo}</span>}
          </div>
        )}
      </div>

      {aviso.soloLectura && (
        <>
          <DocumentosCargadosResumen info={info} cedula={cedula} tono={sem.tono} etiqueta={sem.label} />
          <p className="-mt-2 mb-4 flex items-center gap-1.5 text-[12px] text-gris">
            <IconoCandado />
            {aviso.puedeCambiar
              ? `Registrada como ${infoTipo(tipoEntrega(info)).label.toLowerCase()}. Puedes volver a registrarla si la entrega cambió.`
              : 'Solo lectura. La edición se habilita cuando haya correcciones.'}
          </p>
        </>
      )}

      <div className="flex flex-col-reverse gap-2.5 border-t border-borde pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {aviso.soloLectura && (
          <Btn variant="secondary" onClick={onPrellenados}>Documentos prediligenciados</Btn>
        )}
        {aviso.puedeCambiar && onCambiarTipo && (
          <Btn variant="secondary" onClick={onCambiarTipo}>Cambiar tipo de entrega</Btn>
        )}
        <Btn onClick={onReiniciar}>Validar otro beneficiario</Btn>
      </div>

      <ListaPrellenados prellenados={prellenados} />
    </div>
  );
}

// Color del icono de cada tipo de entrega, que determina los soportes que se piden después.
const TONO_TIPO = { completa: 'bueno', parcial: 'espera', no_entrega: 'malo' };

// Paso en el que se elige cómo se dio la entrega.
function PasoTipo({ info, tipo, onElegir, onVolver }) {
  const actual = tipoEntrega(info);
  const yaRegistrada = (info?.documentos_cargados?.length || 0) > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <BotonVolver onClick={onVolver}>Volver</BotonVolver>

      <FichaBeneficiario info={info}>
        ¿Cómo se realizó la entrega? De esto dependen los soportes que se piden.
      </FichaBeneficiario>

      {yaRegistrada && (
        <Aviso tono="warn">
          Esta U.P. ya está registrada como <b>{infoTipo(actual).label.toLowerCase()}</b>.
          Si eliges otro tipo, se vuelven a pedir todos sus soportes y el registro
          anterior deja de tenerse en cuenta.
        </Aviso>
      )}

      <div className="flex flex-col gap-2.5">
        {TIPOS_ENTREGA.map((t) => {
          const esActual = t.id === actual && yaRegistrada;
          const elegido = t.id === tipo;
          const tt = TONOS[TONO_TIPO[t.id]] || TONOS.vacio;
          return (
            <button key={t.id} type="button" onClick={() => onElegir(t.id)}
              className={`group flex items-start gap-3.5 rounded-lg border p-4 text-left transition duration-150 hover:-translate-y-0.5 hover:border-marino hover:shadow-[0_4px_12px_rgba(43,40,86,0.08)] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(43,40,86,0.10)] ${
                elegido ? 'border-marino bg-[var(--color-panel)]' : 'border-borde bg-card'
              }`}>
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                style={{ background: tt.fondo, color: tt.punto, boxShadow: `inset 0 0 0 1px ${tt.borde}` }}>
                <IconoDoc />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-marino">{t.label}</span>
                  {esActual && <ChipEstado tono="espera">Registrada así</ChipEstado>}
                </span>
                <span className="mt-0.5 block text-[13px] text-texto">{t.resumen}</span>
                <span className="mt-1 block text-[12px] text-gris">
                  Soportes: {t.detalle} Más la cédula del beneficiario.
                </span>
              </span>
              <svg className="mt-1 h-4 w-4 shrink-0 text-[#b3b7c1] transition group-hover:translate-x-0.5 group-hover:text-marino"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Paso en el que se cargan los soportes que exige el tipo de entrega.
function PasoCarga({
  info, corrigiendo, porCorregir, modoCedula, setModoCedula, pedirCedula, cedula,
  tipo, docsTipo, archivos, setArchivos, onSubir, onVolver,
}) {
  const [erroresZona, setErroresZona] = useState({});
  const [notasZona, setNotasZona] = useState({});
  const [optimizando, setOptimizando] = useState(null);
  const [revisando, setRevisando] = useState('');
  const ctrlRef = useRef(null);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const set = async (campo, file) => {
    const doc = DOCS_ENTREGA.find((d) => d.campo === campo);
    if (doc && (!cambioTipo || estaAprobado(info, doc.clave)) && estaCargado(info, doc.clave) &&
        !porCorregir.some((p) => p.clave === doc.clave)) {
      return;
    }
    let err = '';
    let nota = '';
    let comprimido = false;
    if (file && doc) {
      err = validarFormatoSoporte(doc, file);
      if (!err && esVideo(doc) && esArchivoVideo(file)) {
        setRevisando(campo);
        try { err = await validarDuracionMaxima(file, doc.label); }
        finally { setRevisando(''); }
      }
      if (!err && esVideo(doc) && esArchivoVideo(file)) {
        const ctrl = new AbortController();
        ctrlRef.current = ctrl;
        let ultimo = -1;
        setOptimizando({ campo, progreso: 0 });
        try {
          const r = await comprimirVideo(file, {
            signal: ctrl.signal,
            onProgreso: (p) => {
              const pct = Math.floor(p * 100);
              if (pct !== ultimo) { ultimo = pct; setOptimizando({ campo, progreso: p }); }
            },
          });
          file = r.archivo;
          comprimido = r.comprimido;
          nota = r.comprimido
            ? `Optimizado: ${mb(r.antes)} MB → ${mb(r.despues)} MB`
            : r.motivo;
        } catch (e) {
          if (!(e instanceof CompresionCancelada)) throw e;
          file = null;
          nota = 'Optimización cancelada. Vuelve a seleccionar el video.';
        } finally {
          if (ctrlRef.current === ctrl) ctrlRef.current = null;
          setOptimizando(null);
        }
      }
      if (file && !err) {
        if (doc.minSeg) setRevisando(campo);
        try { err = await validarSoporte(doc, file, { comprimido }); }
        finally { setRevisando(''); }
      }
    }
    setErroresZona((e) => ({ ...e, [campo]: err }));
    setNotasZona((n) => ({ ...n, [campo]: err ? '' : nota }));
    setArchivos((a) => ({ ...a, [campo]: err ? null : file }));
  };
  const cambioTipo = !!info && tipo !== tipoEntrega(info);
  const docs = corrigiendo
    ? docsDeTipo(tipoEntrega(info)).filter((d) => porCorregir.some((p) => p.clave === d.clave))
    : docsTipo;

  return (
    <div className="mx-auto max-w-2xl">
      <BotonVolver onClick={onVolver}>Volver</BotonVolver>

      <FichaBeneficiario info={info}>
        {corrigiendo
          ? 'Corrige y vuelve a subir únicamente los documentos señalados.'
          : 'Adjunta los soportes de la entrega.'}
      </FichaBeneficiario>

      {!corrigiendo && pedirCedula && (
        <section className="mb-5">
          <h4 className="mb-2 text-[14px] font-semibold text-marino">Cédula del beneficiario</h4>
          <div className="mb-3 inline-flex rounded-lg border border-borde bg-bg p-0.5">
            {[['foto', 'Fotos (frente y reverso)'], ['pdf', 'Un solo PDF']].map(([id, label]) => (
              <button key={id} type="button"
                onClick={() => { setModoCedula(id); setArchivos({}); setErroresZona({}); }}
                className={`rounded-md px-3.5 py-1.5 text-[12px] font-medium transition ${
                  modoCedula === id ? 'bg-card text-marino shadow-[0_1px_2px_rgba(43,40,86,0.10)]'
                    : 'text-gris hover:text-texto'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {modoCedula === 'pdf' ? (
            <Zona label="Cédula (PDF)" campo="archivo_cedula_pdf" accept=".pdf"
              archivo={archivos.archivo_cedula_pdf} onFile={set} />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Zona label="Cédula, frente" campo="archivo_frontal" accept="image/*" ayuda="Foto (JPG o PNG)"
                archivo={archivos.archivo_frontal} onFile={set} />
              <Zona label="Cédula, reverso" campo="archivo_trasera" accept="image/*" ayuda="Foto (JPG o PNG)"
                archivo={archivos.archivo_trasera} onFile={set} />
            </div>
          )}
        </section>
      )}

      <h4 className="mb-2 text-[14px] font-semibold text-marino">
        {corrigiendo ? 'Soportes por corregir' : `Soportes · ${infoTipo(tipo).label}`}
      </h4>
      {docs.map((d) => {
        const obs = porCorregir.find((p) => p.clave === d.clave)?.observacion;
        const documentoYaCargado = (!cambioTipo || estaAprobado(info, d.clave)) && estaCargado(info, d.clave);
        const urlYaCargado = documentoYaCargado ? urlVisorEntrega(d, info, cedula) : '';

        return (
          <div key={d.clave}>
            {obs && (
              <p className="mb-1 rounded-md border border-[rgba(209,77,106,0.30)] bg-[rgba(209,77,106,0.05)] px-3 py-1.5 text-[12px] text-rojo-txt">
                Observación: {obs}
              </p>
            )}
            <Zona label={d.label} campo={d.campo} accept={d.accept || '.pdf'}
              ayuda={d.ayuda} opcional={d.opcional}
              error={erroresZona[d.campo]} nota={notasZona[d.campo]}
              progreso={optimizando?.campo === d.campo ? optimizando.progreso : null}
              revisando={revisando === d.campo}
              onCancelar={() => ctrlRef.current?.abort()}
              archivo={archivos[d.campo]} onFile={set}
              yaCargado={documentoYaCargado} urlYaCargado={urlYaCargado}
              porCorregir={porCorregir.some((p) => p.clave === d.clave)}
              bloqueado={documentoYaCargado &&
                !porCorregir.some((p) => p.clave === d.clave)}
            />
          </div>
        );
      })}

      <div className="mt-6 flex flex-col-reverse items-stretch gap-3 border-t border-borde pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-gris">
          {optimizando
            ? 'Optimizando el video. No cierres ni cambies de pestaña.'
            : 'El análisis puede tardar unos segundos.'}
        </p>
        <Btn onClick={onSubir} disabled={!!optimizando || !!revisando}>
          {corrigiendo ? 'Subir correcciones' : 'Subir y validar'}
        </Btn>
      </div>
    </div>
  );
}

// Zona para soltar o elegir un archivo.
function Zona({ label, campo, accept, ayuda, opcional, error, nota, progreso, revisando, onCancelar, archivo, onFile, yaCargado, urlYaCargado, porCorregir, bloqueado }) {
  const optimizando = progreso != null;
  const tono = error ? 'malo'
    : archivo ? 'bueno'
    : porCorregir ? 'malo'
    : yaCargado ? 'espera'
    : null;
  const t = tono ? TONOS[tono] : null;
  const Caja = bloqueado || optimizando ? 'div' : 'label';
  const esVideo = accept === 'video/*';

  const estado = optimizando ? `Optimizando video… ${Math.floor(progreso * 100)} %`
    : revisando ? 'Revisando duración del video…'
    : archivo ? archivo.name
    : porCorregir ? 'Debe corregirse. Selecciona el archivo corregido.'
    : bloqueado ? 'Enviado y en revisión'
    : ayuda || 'PDF';

  return (
    <div className="mb-2.5">
      <Caja
        style={t ? { background: t.fondo, borderColor: t.borde } : undefined}
        className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 transition ${
          t ? '' : 'border-dashed border-campo bg-card hover:border-marino hover:bg-[var(--color-panel)]'
        } ${bloqueado ? 'cursor-default' : 'cursor-pointer'}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card"
          style={{ color: t ? t.punto : 'var(--color-gris)', boxShadow: `inset 0 0 0 1px ${t ? t.borde : 'var(--color-borde)'}` }}>
          {archivo ? <IconoCheck className="h-4 w-4" /> : esVideo ? <IconoVideo /> : <IconoDoc />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-marino">
            {label}
            {opcional && <span className="ml-1.5 text-[11px] font-normal text-gris">Opcional</span>}
          </span>
          <span className="block truncate text-[12px]" style={{ color: t ? t.texto : 'var(--color-gris)' }}>
            {estado}
          </span>
        </span>
        {bloqueado ? (
          <span className="flex shrink-0 items-center gap-2">
            {urlYaCargado && (
              <a href={urlYaCargado} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-md px-2 py-1 text-[12px] font-medium text-marino hover:bg-card">Ver</a>
            )}
            <span style={{ color: t?.texto }}><IconoCandado /></span>
          </span>
        ) : optimizando ? (
          <button type="button" onClick={onCancelar}
            className="shrink-0 rounded-md border border-borde bg-card px-2.5 py-1 text-[12px] font-medium text-rojo-txt hover:bg-bg">
            Cancelar
          </button>
        ) : (
          <span className="shrink-0 rounded-md border border-borde bg-card px-2.5 py-1 text-[12px] font-medium text-marino">
            {archivo ? 'Cambiar' : 'Seleccionar'}
          </span>
        )}
        {!bloqueado && !optimizando && (
          <input type="file" accept={accept} className="hidden"
            onChange={(e) => {
              onFile(campo, e.target.files[0] || null);
              e.target.value = '';
            }} />
        )}
      </Caja>
      {!bloqueado && yaCargado && urlYaCargado && !archivo && (
        <a href={urlYaCargado} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-block text-[12px] font-medium text-marino hover:underline">
          Ver documento cargado
        </a>
      )}
      {optimizando && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-borde">
          <div className="h-full rounded-full bg-marino transition-[width] duration-300"
            style={{ width: `${Math.max(2, Math.floor(progreso * 100))}%` }} />
        </div>
      )}
      {!optimizando && nota && !error && <p className="mt-1 text-[12px] text-gris">{nota}</p>}
      {error && <p className="mt-1 text-[12px] text-rojo-txt">{error}</p>}
    </div>
  );
}