// Sección de visitas con tres pestañas: programadas, las visitas sin cerrar; nueva, donde se elige la unidad y
// se programa la siguiente visita del proceso (caracterización, diagnóstico y acompañamiento); e historial, con
// las visitas cerradas en solo consulta. Cada visita tiene la fase de programar, con el alistamiento de
// documentos, y la de realizar y cerrar.
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { val, fullName, normDoc } from '../lib/utils';
import { EncabezadoSeccion, Card, Btn, Aviso, Chip, useBarraDeslizable } from '../components/UI';
import AsociadosUP from '../components/AsociadosUP';
import DiagnosticoUP from '../components/DiagnosticoUP';
import EvaluacionSalidaUP from '../components/EvaluacionSalidaUP';
import ModalidadVisita from '../components/ModalidadVisita';
import {
  TIPOS_VISITA, RESULTADOS_AGENDA as RESULTADOS, ESTADOS_VISITA as ESTADOS,
  NOTA_GENERAL, formatosDe, formatosFaltantes, gruposFormatos, modalidadUP, modalidadesTexto, conteoMinimos, contextoNombre,
  tipoDeVisita, formatosVacios, visitaAEstado, avanceUP, situacionVisita, salidasCargadas,
  hoyISO, estaAgendada, puedeRealizarse,
  listarTodasVisitas, guardarVisita, subirFormatoVisita, abrirSoporte, MAX_ARCHIVO_VISITA_MB,
  listarPlantillas, plantillaDe, urlFormato, descargarPlantilla, ROLES_REABREN, quitarSoporte, docUP, mensajeVisita, faltantesVirtual,
  deApi, pedirPlazoV3, textoPlazoV3, CAUSAS_VIRTUAL,
} from '../lib/visitas';
import { comprimirVideo, esArchivoVideo, CompresionCancelada, validarDuracionMaxima } from '../lib/comprimirVideo';

const TABS = [
  { id: 'programadas', label: 'Programadas' },
  { id: 'nueva',       label: 'Programar nueva' },
  { id: 'historial',   label: 'Historial' },
];

const INICIAL = {
  up: null, tipo: null, formatos: {}, llamada: null, resultado: null,
  intentos: '1', fecha: '', hora: '', historialAgenda: [],
  modalidadVisita: 'presencial', causaVirtual: '', justificacionVirtual: '', aprobacionVirtual: null,
  archivos: {}, estado: null, cerrada: false,
  confirmados: {}, fechaConfirmacion: null,
  id: null, creado_en: null,
};

// Resultados que caben cuando no hubo contacto.
const RESULTADOS_SIN_CONTACTO = ['nocontesta', 'errado'];

const SITUACIONES = {
  vencida:  { label: 'Vencida, sin cerrar', tono: 'bad' },
  soportes: { label: 'Pendiente de soportes', tono: 'warn' },
  hoy:      { label: 'Hoy',                 tono: 'warn' },
  proxima:  { label: 'Programada',          tono: 'ok' },
  sinfecha: { label: 'Sin fecha confirmada', tono: 'neutral' },
  cerrada:  { label: 'Cerrada',             tono: 'ok' },
};

// Devuelve el estado con que se cerró una visita.
function etiquetaCierre(est) {
  if (!est) return 'Cerrada';
  return est.id === 'revision' ? 'Cerrada en revisión' : est.label;
}

function fmtFecha(f) {
  if (!f) return '—';
  const d = new Date(`${f}T00:00`);
  if (Number.isNaN(d.getTime())) return f;
  return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Componente principal: mantiene el estado de la visita en edición y coordina guardado, carga de archivos y
// cierre.
export default function Visitas({ data, session }) {
  const [vista, setVista] = useState('programadas');
  const barraTabs = useBarraDeslizable(vista);
  const [todas, setTodas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [v, setV] = useState(null);
  const [fase, setFase] = useState('programar');
  const agendaGuardada = useRef(null);
  const [aviso, setAviso] = useState('');
  const [exito, setExito] = useState('');
  const [guardando, setGuardando] = useState('');
  const [avanceGuardado, setAvanceGuardado] = useState(false);
  const set = (patch) => setV((prev) => ({ ...prev, ...patch }));
  const vRef = useRef(v);
  vRef.current = v;
  const cola = useRef(Promise.resolve());
  const ultimoError = useRef('');
  const sinGuardar = useRef(false);
  const [errorCierre, setErrorCierre] = useState('');
  const [errorProgramacion, setErrorProgramacion] = useState('');
  const ctrlVideo = useRef(null);
  const [optimizando, setOptimizando] = useState(false);
  const [conVideo, setConVideo] = useState(false);
  const [pctVideo, setPctVideo] = useState(null);
  useEffect(() => () => ctrlVideo.current?.abort(), []);

  const recargar = useCallback(async () => {
    setCargando(true);
    try { setTodas(await listarTodasVisitas(data, session)); }
    catch (e) {
      console.error('[bitacora][E-VISITAS] listar:', e);
      setTodas([]);
      setExito('');
      setAviso(e.publicMsg || 'No se pudieron cargar las visitas.');
    }
    finally { setCargando(false); }
  }, [data, session]);
  useEffect(() => { recargar(); }, [recargar]);

  const [plantillas, setPlantillas] = useState(null);
  useEffect(() => {
    let vivo = true;
    listarPlantillas(session)
      .then((m) => { if (vivo) setPlantillas(m); })
      .catch((e) => { console.warn('[bitacora][E-FORMATOS] listar:', e); if (vivo) setPlantillas({}); });
    return () => { vivo = false; };
  }, [session]);
  async function bajarPlantilla(nombre) {
    try { await descargarPlantilla(nombre, session); }
    catch (e) { mostrarError(e.message || 'No se pudo descargar el formato.'); }
  }

  function mostrarError(msg) { setAviso(msg); setTimeout(() => setAviso(''), 5000); }

  async function verSoporte(a) {
    if (!a?.blob || !vRef.current?.id) return;
    try { await abrirSoporte(vRef.current.id, a.blob, session); }
    catch (e) { mostrarError(e.message || 'No se pudo abrir el archivo.'); }
  }
  function mostrarExito(msg) { setExito(msg); setTimeout(() => setExito(''), 5000); }

  function guardar(patch = {}, extra = {}) {
    const tarea = cola.current.then(async () => {
      const estado = { ...vRef.current, ...patch };
      if (!estado.up || !estado.tipo) return null;
      setGuardando('Guardando…');
      try {
        const doc = await guardarVisita(estado, session, extra);
        const sello = {
          id: doc.id, creado_en: doc.creado_en, reaperturas: doc.cierre?.reaperturas || [],
          aprobacionVirtual: doc.realizacion_extra?.aprobacion ?? null,
        };
        if (doc.aviso) mostrarError(doc.aviso);
        vRef.current = { ...estado, ...sello };
        setV((prev) => (prev ? { ...prev, ...patch, ...sello } : prev));
        setTodas((prev) => {
          const i = prev.findIndex((x) => x.id === doc.id);
          return i === -1 ? [...prev, doc] : prev.map((x, k) => (k === i ? doc : x));
        });
        return doc;
      } catch (e) {
        console.error('[bitacora][E-VISITA] guardar:', e);
        ultimoError.current = mensajeVisita(e, 'No se pudo guardar la visita. Intenta de nuevo.');
        mostrarError(ultimoError.current);
        return null;
      } finally { setGuardando(''); }
    });
    cola.current = tarea.catch(() => null);
    return tarea;
  }

  async function subirFormato(f, archivos) {
    let id = vRef.current.id;
    if (!id) { const doc = await guardar(); if (!doc) return; id = doc.id; }
    const ctrl = new AbortController();
    ctrlVideo.current = ctrl;
    setConVideo(archivos.some(esArchivoVideo));
    try {
      const subidos = [];
      const nVideos = archivos.filter(esArchivoVideo).length;
      let iVideo = 0;
      for (const original of archivos) {
        let archivo = original;
        let comprimido = false;
        if (esArchivoVideo(original)) {
          iVideo += 1;
          const cual = nVideos > 1 ? ` ${iVideo} de ${nVideos}` : '';
          setGuardando(`Revisando duración del video${cual}…`);
          const errDur = await validarDuracionMaxima(original, original.name);
          if (errDur) { mostrarError(errDur); break; }
          let ultimo = -1;
          setGuardando(`Optimizando video${cual}… 0 %`);
          setOptimizando(true);
          try {
            const r = await comprimirVideo(original, {
              signal: ctrl.signal,
              onProgreso: (p) => {
                const pct = Math.floor(p * 100);
                if (pct !== ultimo) { ultimo = pct; setPctVideo(pct); setGuardando(`Optimizando video${cual}… ${pct} %`); }
              },
            });
            archivo = r.archivo;
            comprimido = r.comprimido;
          } catch (e) {
            if (e instanceof CompresionCancelada) {
              mostrarError('Se canceló la optimización; ese video no se subió.');
              break;
            }
            throw e;
          } finally { setOptimizando(false); setPctVideo(null); }
        }
        if (archivo.size > MAX_ARCHIVO_VISITA_MB * 1024 * 1024) {
          const pesa = (archivo.size / (1024 * 1024)).toFixed(1);
          const consejo = !esArchivoVideo(archivo) ? 'Reduce su peso y vuelve a subirlo.'
            : comprimido ? 'Recórtalo y vuelve a subirlo.'
            : 'No se pudo optimizar en este navegador: recórtalo o grábalo en 720p.';
          mostrarError(`"${archivo.name}" pesa ${pesa} MB y el máximo es ${MAX_ARCHIVO_VISITA_MB} MB. ${consejo}`);
          break;
        }
        setGuardando(`Subiendo ${f.nombre}…`);
        const subido = await subirFormatoVisita({
          visitaId: id, formato: f.nombre, multiple: !!f.multiple, archivo, session,
        });
        subidos.push(archivo === original ? subido : { ...subido, tamano_original: original.size });
      }
      if (!subidos.length) return;
      const previo = vRef.current.archivos[f.nombre];
      const valor = f.multiple
        ? [...(Array.isArray(previo) ? previo : []), ...subidos]
        : subidos[0];
      await guardar({ archivos: { ...vRef.current.archivos, [f.nombre]: valor } });
    } catch (e) {
      console.error('[bitacora][E-VISITA] archivo:', e);
      mostrarError(mensajeVisita(e, 'No se pudo subir el archivo.'));
    } finally {
      if (ctrlVideo.current === ctrl) ctrlVideo.current = null;
      setConVideo(false);
      setGuardando('');
    }
  }

  async function quitarArchivo(f, i) {
    const previo = vRef.current.archivos[f.nombre];
    const lista = Array.isArray(previo) ? previo : previo ? [previo] : [];
    const a = lista[i];
    if (!a) return;
    if (a.blob) {
      const tarea = cola.current.then(async () => {
        setGuardando('Quitando archivo…');
        try {
          const doc = await quitarSoporte({ visitaId: vRef.current.id, blob: a.blob, session });
          if (!doc) return false;
          const { archivos } = visitaAEstado(doc);
          vRef.current = { ...vRef.current, archivos };
          setV((prev) => (prev ? { ...prev, archivos } : prev));
          setTodas((prev) => prev.map((x) => (x.id === doc.id ? doc : x)));
          return true;
        } catch (e) {
          console.error('[bitacora][E-VISITA] quitar:', e);
          mostrarError(mensajeVisita(e, 'No se pudo quitar el archivo.'));
          return true;
        } finally { setGuardando(''); }
      });
      cola.current = tarea.catch(() => null);
      if (await tarea) return;
    }
    const resto = lista.filter((_, k) => k !== i);
    const valor = f.multiple ? resto : false;
    await guardar({ archivos: { ...vRef.current.archivos, [f.nombre]: valor } });
  }

  function upDe(doc) {
    return data.find((u) => docUP(u.unidad_doc) === docUP(doc.unidad_doc)) || {
      ID_unico: doc.id_unico, unidad_nombre: doc.unidad_nombre,
      unidad_doc: doc.unidad_doc, nodo: doc.nodo_gestor,
    };
  }

  function abrir(doc) {
    const estado = { ...INICIAL, up: upDe(doc), ...visitaAEstado(doc) };
    agendaGuardada.current = { fecha: estado.fecha, hora: estado.hora, resultado: estado.resultado };
    setV(estado);
    setFase(estado.cerrada ? 'resumen' : puedeRealizarse(estado) ? 'realizar' : 'programar');
    setAviso('');
  }

  function nueva(up, t) {
    agendaGuardada.current = null;
    setV({ ...INICIAL, up, tipo: t.id, formatos: formatosVacios(t), archivos: formatosVacios(t) });
    setFase('programar');
    setAviso('');
  }

  const PREGUNTA_SIN_GUARDAR = 'Hay cambios sin guardar en el diagnóstico o la evaluación de salida. ¿Salir sin guardarlos?';
  const confirmaSalir = () => !sinGuardar.current || window.confirm(PREGUNTA_SIN_GUARDAR);

  function volver(msg) {
    if (ctrlVideo.current) return;
    if (!msg && !confirmaSalir()) return;
    sinGuardar.current = false;
    setV(null);
    setErrorCierre('');
    setErrorProgramacion('');
    if (msg) { setVista('programadas'); mostrarExito(msg); }
  }

  function cambiarFase(f) {
    if (fase === 'realizar' && f !== 'realizar' && !confirmaSalir()) return;
    setFase(f);
  }

  function alAprobar(item) {
    const doc = deApi(item);
    const aprobacionVirtual = doc.realizacion_extra?.aprobacion ?? null;
    vRef.current = { ...vRef.current, aprobacionVirtual };
    set({ aprobacionVirtual });
    setTodas((prev) => prev.map((x) => (x.id === doc.id ? doc : x)));
  }

  useEffect(() => { setErrorCierre(''); }, [v?.archivos, v?.estado, v?.modalidadVisita, fase]);

  function conHistorial(estado, motivo) {
    const prev = agendaGuardada.current;
    if (!prev?.fecha || prev.resultado !== 'agendada') return estado.historialAgenda;
    if (!motivo && estado.resultado === 'agendada' && estado.fecha === prev.fecha && estado.hora === prev.hora) {
      return estado.historialAgenda;
    }
    return [...estado.historialAgenda, {
      fecha: prev.fecha, hora: prev.hora || null,
      motivo: motivo || (estado.resultado === 'agendada' ? 'reagendada' : estado.resultado),
      en: new Date().toISOString(), por: session?.nombre || null,
    }];
  }

  async function guardarProgramacion() {
    if (!v.llamada) return mostrarError('Indica si se logró contactar al beneficiario.');
    if (!v.resultado) return mostrarError('Registra el resultado del agendamiento.');
    let fechaConfirmacion = v.fechaConfirmacion;
    if (v.resultado === 'agendada') {
      if (!v.fecha || !v.hora) return mostrarError('Define la fecha y la hora acordadas.');
      const cambio = v.fecha !== agendaGuardada.current?.fecha;
      if (cambio && v.fecha < hoyISO()) return mostrarError('La fecha de la visita no puede ser anterior a hoy.');
      fechaConfirmacion = new Date().toISOString();
    }
    const historialAgenda = conHistorial(v);
    setErrorProgramacion('');
    ultimoError.current = '';
    const doc = await guardar({ historialAgenda, fechaConfirmacion });
    if (!doc) return setErrorProgramacion(ultimoError.current || 'No se pudo guardar la programación. Intenta de nuevo.');
    volver(v.resultado === 'agendada'
      ? `Visita programada para el ${fmtFecha(v.fecha)} a las ${v.hora}.`
      : 'Se guardó el intento de contacto. La visita sigue sin fecha confirmada.');
  }

  async function reprogramar() {
    const historialAgenda = conHistorial(v, 'no se realizó');
    const doc = await guardar({
      historialAgenda, llamada: null, resultado: null, fecha: '', hora: '', estado: null,
    });
    if (!doc) return;
    agendaGuardada.current = null;
    setFase('programar');
    mostrarExito('Se registró que la visita no se realizó. Programa una nueva fecha.');
  }

  async function cerrar() {
    setErrorCierre('');
    if (!puedeRealizarse(v)) return setErrorCierre(`La visita solo se puede cerrar desde el ${fmtFecha(v.fecha)}.`);
    if (v.estado !== 'exitosa') return setErrorCierre('Solo se cierra una visita exitosa, con todos sus formatos.');
    const faltan = formatosFaltantes(tipoDeVisita(v.tipo), v.up, v.archivos);
    if (v.estado === 'exitosa' && faltan.length) {
      return setErrorCierre(`Para cerrarla como exitosa faltan: ${faltan.join(', ')}.`);
    }
    ultimoError.current = '';
    const doc = await guardar({ cerrada: true });
    if (!doc) return setErrorCierre(ultimoError.current || 'No se pudo cerrar la visita. Intenta de nuevo.');
    setFase('resumen');
    mostrarExito('Visita cerrada.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function reabrir(motivo) {
    const doc = await guardar({ cerrada: false }, { reabrir: true, motivo });
    if (!doc) return;
    setFase(puedeRealizarse(vRef.current) ? 'realizar' : 'programar');
    mostrarExito('Visita reabierta. Corrige lo necesario y vuelve a cerrarla.');
  }

  async function elegirEstado(estado) {
    set({ estado });
    if (!(await guardar({ estado }))) return;
    setAvanceGuardado(true);
    setTimeout(() => setAvanceGuardado(false), 2500);
  }

  const ocupado = !!guardando;
  const avance = v?.up
    ? avanceUP(todas.filter((x) => docUP(x.unidad_doc) === docUP(v.up.unidad_doc)))
    : [];

  return (
    <>
      <EncabezadoSeccion
        titulo="Visitas"
        subtitulo="Programación y registro de las visitas a las unidades productivas."
      />

      {exito && <Aviso tono="ok">{exito}</Aviso>}
      {!v && aviso && <Aviso tono="bad">{aviso}</Aviso>}
      {conVideo && (
        <ModalVideo texto={guardando} pct={pctVideo} optimizando={optimizando}
          onCancelar={() => ctrlVideo.current?.abort()} />
      )}

      {v ? (
        <Editor
          v={v} set={set} fase={fase} setFase={cambiarFase} aviso={aviso} errorCierre={errorCierre}
          errorProgramacion={errorProgramacion} session={session} onAprobada={alAprobar}
          onSinGuardar={(x) => { sinGuardar.current = x; }}
          guardando={guardando} optimizando={optimizando} ocupado={ocupado}
          onCancelarVideo={() => ctrlVideo.current?.abort()}
          onVolver={() => volver()} onGuardarProgramacion={guardarProgramacion}
          onElegirEstado={elegirEstado}
          onDejarPendiente={async () => {
            if (!confirmaSalir()) return;
            if (await guardar()) volver('La visita quedó pendiente de soportes.');
          }}
          onGuardarVisita={(patch) => guardar(patch)}
          esCoordinacion={ROLES_REABREN.includes(session?.role)}
          avanceGuardado={avanceGuardado}
          onReprogramar={reprogramar} onCerrar={cerrar} onSubirFormato={subirFormato}
          onQuitarArchivo={quitarArchivo} avance={avance} onNueva={nueva} onAbrir={abrir}
          onVer={verSoporte} plantillas={plantillas} onPlantilla={bajarPlantilla}
          onReabrir={ROLES_REABREN.includes(session?.role) ? reabrir : null}
        />
      ) : (
        <>
          <div ref={barraTabs} className="barra-deslizable no-scrollbar mb-4 flex gap-0.5 overflow-x-auto border-b border-borde sm:mb-5">
            {TABS.map((t) => (
              <button
                key={t.id} type="button" onClick={() => setVista(t.id)} data-activa={vista === t.id}
                className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2.5 text-[13px] font-semibold transition sm:px-4 ${
                  vista === t.id ? 'border-acento text-marino' : 'border-transparent text-gris hover:text-texto'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {vista === 'programadas' && (
            <ListaVisitas todas={todas} cargando={cargando} cerradas={false}
              onAbrir={abrir} onRecargar={recargar} onNueva={() => setVista('nueva')} />
          )}
          {vista === 'nueva' && (
            <ProgramarNueva data={data} session={session} todas={todas} cargando={cargando}
              onNueva={nueva} onAbrir={abrir} />
          )}
          {vista === 'historial' && (
            <ListaVisitas todas={todas} cargando={cargando} cerradas
              onAbrir={abrir} onRecargar={recargar} />
          )}
        </>
      )}
    </>
  );
}

// Modal que cubre la pantalla mientras se revisa, optimiza y sube un video.
function ModalVideo({ texto, pct, optimizando, onCancelar }) {
  const conPct = optimizando && pct != null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog" aria-modal="true" aria-labelledby="modal-video-titulo">
      <div className="w-full max-w-sm rounded-card border border-borde bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-borde border-t-acento" aria-hidden="true" />
          <h3 id="modal-video-titulo" className="text-[15px] font-bold text-marino">
            {optimizando ? 'Optimizando el video' : 'Procesando el video'}
          </h3>
        </div>
        <p className="mb-3 text-[13px] text-texto" aria-live="polite">{texto || 'Preparando…'}</p>
        <div className="h-2 overflow-hidden rounded-full bg-bg">
          <div className={`h-full rounded-full bg-acento transition-[width] duration-300 ${conPct ? '' : 'w-1/3 animate-pulse'}`}
            style={conPct ? { width: `${Math.max(2, pct)}%` } : undefined} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gris">
          Puede tardar unos minutos según el largo del video. No cierres esta ventana ni cambies de pestaña.
        </p>
        {optimizando && (
          <div className="mt-4 text-right">
            <Btn variant="secondary" onClick={onCancelar}>Cancelar</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

const GRUPOS = [
  { id: 'vencida',  titulo: 'Vencidas sin cerrar' },
  { id: 'soportes', titulo: 'Pendientes de soportes' },
  { id: 'hoy',      titulo: 'Para hoy' },
  { id: 'proxima',  titulo: 'Próximas' },
  { id: 'sinfecha', titulo: 'Sin fecha confirmada' },
];

// Muestra la lista de visitas de una pestaña, agrupadas por situación.
function ListaVisitas({ todas, cargando, cerradas, onAbrir, onRecargar, onNueva }) {
  const [filtro, setFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const hoy = hoyISO();

  const base = useMemo(() => {
    const t = filtro.toLowerCase().trim();
    return todas
      .map((d) => ({ d, sit: situacionVisita(d, hoy) }))
      .filter(({ sit }) => (cerradas ? sit === 'cerrada' : sit !== 'cerrada'))
      .filter(({ d }) => !t ||
        String(d.unidad_nombre || '').toLowerCase().includes(t) ||
        String(d.id_unico ?? '').toLowerCase().includes(t) ||
        String(d.unidad_doc || '').includes(t) ||
        String(tipoDeVisita(d.tipo_visita)?.nombre || '').toLowerCase().includes(t));
  }, [todas, filtro, cerradas, hoy]);

  const tiposPresentes = TIPOS_VISITA
    .map((t) => ({ t, n: base.filter(({ d }) => d.tipo_visita === t.id).length }))
    .filter(({ n }) => n > 0);
  const tipoActivo = tiposPresentes.some(({ t }) => t.id === tipoFiltro) ? tipoFiltro : 'todos';
  const filas = tipoActivo === 'todos' ? base : base.filter(({ d }) => d.tipo_visita === tipoActivo);

  const clave = (d) => `${d.contacto_control?.fecha || '9999'} ${d.contacto_control?.hora || ''}`;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por unidad, ID, documento o tipo…" className={`${inputCls} flex-1`} />
        <Btn variant="secondary" onClick={onRecargar} disabled={cargando}>Actualizar</Btn>
      </div>

      {tiposPresentes.length > 1 && (
        <div className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[{ id: 'todos', corto: 'Todas', n: base.length },
            ...tiposPresentes.map(({ t, n }) => ({ id: t.id, corto: t.corto || t.nombre, n }))].map((o) => {
            const sel = tipoActivo === o.id;
            return (
              <button key={o.id} type="button" onClick={() => setTipoFiltro(o.id)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  sel ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:border-acento hover:text-texto'
                }`}>
                {o.corto} <span className={sel ? 'text-acento' : 'text-gris'}>{o.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {cargando ? (
        <p className="py-6 text-center text-[13px] italic text-gris">Cargando visitas…</p>
      ) : !filas.length ? (
        <div className="py-6 text-center text-[13px] text-gris">
          <p className="italic">{cerradas ? 'No hay visitas cerradas.' : 'No hay visitas pendientes.'}</p>
          {onNueva && <Btn className="mt-3" onClick={onNueva}>Programar una visita</Btn>}
        </div>
      ) : cerradas ? (
        <div className="flex flex-col gap-2">
          {filas
            .sort((a, b) => String(b.d.cierre?.fecha_cierre || '').localeCompare(String(a.d.cierre?.fecha_cierre || '')))
            .map(({ d }) => <FilaVisita key={d.id} d={d} sit="cerrada" onAbrir={onAbrir} />)}
        </div>
      ) : (
        GRUPOS.map((g) => {
          const grupo = filas.filter((f) => f.sit === g.id).sort((a, b) => clave(a.d).localeCompare(clave(b.d)));
          if (!grupo.length) return null;
          return (
            <div key={g.id} className="mb-4 last:mb-0">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                {g.titulo} ({grupo.length})
              </p>
              <div className="flex flex-col gap-2">
                {grupo.map(({ d, sit }) => <FilaVisita key={d.id} d={d} sit={sit} onAbrir={onAbrir} />)}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}

// Muestra una visita en la lista.
function FilaVisita({ d, sit, onAbrir }) {
  const c = d.contacto_control || {};
  const s = SITUACIONES[sit];
  const est = ESTADOS.find((e) => e.id === String(d.estado_visita).toLowerCase());
  const res = RESULTADOS.find((r) => r.id === String(c.resultado_agendamiento).toLowerCase());
  return (
    <button type="button" onClick={() => onAbrir(d)}
      className="flex flex-col gap-1.5 rounded-lg border border-borde bg-bg p-3 text-left transition hover:border-acento sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-texto">
          {val(d.unidad_nombre) || 'Sin nombre'} <span className="font-normal text-gris">· ID {d.id_unico}</span>
        </span>
        <span className="block text-[11px] text-gris">
          {tipoDeVisita(d.tipo_visita)?.nombre || d.tipo_visita_label}
          {c.fecha && <> · {fmtFecha(c.fecha)}{c.hora && ` · ${c.hora}`}</>}
          {sit === 'sinfecha' && res && <> · {res.label}</>}
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="whitespace-nowrap rounded-full border border-marino/30 bg-marino/8 px-2.5 py-1 text-xs font-semibold text-marino">
          {tipoDeVisita(d.tipo_visita)?.corto || d.tipo_visita_label}
        </span>
        {sit === 'cerrada'
          ? <Chip tono={est?.tono === 'warn' ? 'warn' : 'ok'}>{etiquetaCierre(est)}</Chip>
          : <Chip tono={s.tono}>{s.label}</Chip>}
      </span>
    </button>
  );
}

// Pestaña para programar una visita nueva: elige la unidad, muestra el avance del proceso y el tipo.
function ProgramarNueva({ data, session, todas, cargando, onNueva, onAbrir }) {
  const [filtro, setFiltro] = useState('');
  const [up, setUp] = useState(null);

  const lista = useMemo(() => {
    const t = filtro.toLowerCase().trim();
    if (!t) return data.slice(0, 40);
    const tDoc = normDoc(t);
    return data.filter((u) =>
      String(u.ID_unico).toLowerCase().includes(t) ||
      String(u.unidad_nombre || '').toLowerCase().includes(t) ||
      (tDoc && normDoc(u.unidad_doc || u.integrante_doc_inicial).includes(tDoc))
    ).slice(0, 40);
  }, [filtro, data]);

  const avance = useMemo(() => {
    if (!up) return [];
    return avanceUP(todas.filter((x) => docUP(x.unidad_doc) === docUP(up.unidad_doc)));
  }, [up, todas]);

  if (up) {
    return (
      <Card className="p-4 sm:p-5">
        <button type="button" onClick={() => setUp(null)}
          className="mb-3 text-xs font-semibold text-marino hover:underline">← Cambiar unidad productiva</button>
        <h3 className="text-[15px] font-bold text-marino">{val(up.unidad_nombre) || 'Sin nombre'}</h3>
        <p className="mb-4 text-xs text-gris">ID {up.ID_unico} · {val(up.mpio) || '—'}, {val(up.dpto) || '—'}</p>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Proceso de la unidad</p>
        {!docUP(up.unidad_doc) ? (
          <Aviso tono="bad">
            Esta unidad productiva no tiene documento registrado, así que no se le pueden programar visitas.
            Avisa a coordinación para que lo corrijan en la base.
          </Aviso>
        ) : cargando ? (
          <p className="text-[13px] italic text-gris">Cargando visitas…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {avance[0]?.salida && (
              <Aviso tono="bad" className="mb-1">
                Esta unidad productiva salió del programa con el <b>{avance[0].salida}</b>. No se programan más visitas.
              </Aviso>
            )}
            {avance.map(({ tipo: t, estado, abierta, faltan }, i) => (
              <div key={t.id} className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                estado === 'hecha' ? 'border-verde-ok/35 bg-verde-ok/8'
                  : estado === 'bloqueada' || estado === 'fuera' ? 'border-borde bg-bg opacity-60' : 'border-borde bg-bg'
              }`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    estado === 'hecha' ? 'bg-verde-ok text-white' : 'border-[1.5px] border-borde bg-card text-gris'
                  }`}>{estado === 'hecha' ? '✓' : i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-marino">{t.nombre}</span>
                    <span className="block text-[11px] leading-relaxed text-gris">
                      {estado === 'bloqueada' ? `Primero debe cerrarse: ${faltan.join(', ')}.`
                        : estado === 'hecha' ? 'Visita cerrada.'
                        : estado === 'fuera' ? 'No aplica: la unidad salió del programa.'
                        : estado === 'abierta' ? (situacionVisita(abierta) === 'soportes' ? 'Realizada, pendiente de soportes.'
                          : abierta.contacto_control?.fecha
                          ? `Programada para el ${fmtFecha(abierta.contacto_control.fecha)}.`
                          : 'Pendiente de fecha.')
                        : t.desc}
                    </span>
                  </span>
                </div>
                {estado === 'abierta' && <Btn variant="secondary" onClick={() => onAbrir(abierta)}>Continuar</Btn>}
                {estado === 'disponible' && <Btn onClick={() => onNueva(up, t)}>Programar</Btn>}
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5">
      <p className="mb-3 text-[13px] text-gris">
        {session?.role === 'gestor'
          ? `Elige la unidad productiva. Se muestran únicamente las unidades de tu nodo (${session.nodo}).`
          : 'Elige la unidad productiva. Como coordinador ves todas las unidades.'}
      </p>
      {!data.length ? (
        <p className="text-[13px] italic text-gris">No hay unidades productivas disponibles para tu usuario.</p>
      ) : (
        <>
          <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por nombre, ID o documento…" className={`${inputCls} mb-3`} />
          <div className="grid max-h-[400px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {lista.map((u) => (
              <button key={u.ID_unico} type="button" onClick={() => setUp(u)}
                className="flex flex-col gap-0.5 rounded-lg border border-borde bg-bg p-2.5 text-left transition hover:border-acento">
                <span className="truncate text-[13px] font-semibold text-texto">{val(u.unidad_nombre) || 'Sin nombre'}</span>
                <span className="text-[11px] text-gris">ID {u.ID_unico} · {val(u.mpio) || '—'}, {val(u.dpto) || '—'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Editor de una visita con las fases de programar, realizar y cerrar, y resumen.
function Editor({
  v, set, fase, setFase, aviso, errorCierre, errorProgramacion, session, onAprobada, onSinGuardar, onGuardarVisita, esCoordinacion,
  guardando, optimizando, ocupado, onCancelarVideo,
  onVolver, onGuardarProgramacion, onElegirEstado, onDejarPendiente, avanceGuardado, onReprogramar, onCerrar, onSubirFormato,
  onQuitarArchivo, avance, onNueva, onAbrir, onVer, plantillas, onPlantilla, onReabrir,
}) {
  const tipo = tipoDeVisita(v.tipo);
  const habilitada = puedeRealizarse(v);
  const fases = [
    { id: 'programar', n: 1, label: 'Programar', hecho: estaAgendada(v) },
    { id: 'realizar',  n: 2, label: 'Realizar y cerrar', hecho: false },
  ];

  return (
    <>
      <button type="button" onClick={onVolver} disabled={optimizando}
        className="mb-3 text-xs font-semibold text-marino hover:underline disabled:opacity-40">← Volver a las visitas</button>

      <Card className="mb-3 p-4">
        <p className="text-[15px] font-bold text-marino">
          {val(v.up?.unidad_nombre) || 'Sin nombre'} <span className="text-[13px] font-normal text-gris">· ID {v.up?.ID_unico}</span>
        </p>
        <p className="text-xs text-gris">
          {tipo?.nombre}{tipo && <> · Carpeta {tipo.carpeta}</>}
          {' · '}{modalidadUP(v.up) ? `Modalidad ${modalidadUP(v.up)}` : 'Modalidad sin registrar'}
          {v.fecha && estaAgendada(v) && <> · {fmtFecha(v.fecha)} · {v.hora}</>}
        </p>
        {v.reaperturas?.length > 0 && (
          <p className="mt-1 text-[11px] font-semibold text-[var(--tono-warn-txt)]">
            Reabierta {v.reaperturas.length === 1 ? 'una vez' : `${v.reaperturas.length} veces`}
            {' · '}última por {v.reaperturas.at(-1).reabierta_por || '—'}
            {v.reaperturas.at(-1).motivo && v.reaperturas.at(-1).motivo !== 'Sin datos asignados'
              && <>: «{v.reaperturas.at(-1).motivo}»</>}
          </p>
        )}
      </Card>

      {!v.cerrada && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {fases.map((f) => {
            const activa = fase === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setFase(f.id)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition ${
                  activa ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:border-acento'
                }`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  activa ? 'bg-acento text-marino' : f.hecho ? 'bg-verde-ok text-white' : 'border border-borde'
                }`}>{f.hecho && !activa ? '✓' : f.n}</span>
                {f.label}
                {f.id === 'realizar' && !habilitada && <span aria-hidden>🔒</span>}
              </button>
            );
          })}
        </div>
      )}

      <Card className="min-h-[260px] p-4 sm:p-5">
        {aviso && <Aviso tono="bad">{aviso}</Aviso>}
        {guardando && (
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-gris">
            {guardando}
            {optimizando && (
              <>
                <span className="font-normal">No cierres ni cambies de pestaña.</span>
                <button type="button" onClick={onCancelarVideo}
                  className="font-semibold text-rojo-txt hover:underline">Cancelar</button>
              </>
            )}
          </p>
        )}
        {v.cerrada || fase === 'resumen'
          ? <Resumen v={v} tipo={tipo} avance={avance} onNueva={onNueva} onAbrir={onAbrir} onVer={onVer}
              onReabrir={onReabrir} ocupado={ocupado} />
          : fase === 'programar'
            ? <FaseProgramar v={v} set={set} tipo={tipo} ocupado={ocupado} onGuardar={onGuardarProgramacion}
                plantillas={plantillas} onPlantilla={onPlantilla} error={errorProgramacion} session={session} />
            : <FaseRealizar v={v} set={set} tipo={tipo} ocupado={ocupado} habilitada={habilitada}
                onElegirEstado={onElegirEstado}
                onDejarPendiente={onDejarPendiente} avanceGuardado={avanceGuardado} onReprogramar={onReprogramar}
                onCerrar={onCerrar} onSubirFormato={onSubirFormato} onQuitarArchivo={onQuitarArchivo} onVer={onVer}
                errorCierre={errorCierre} onSinGuardar={onSinGuardar} onGuardarVisita={onGuardarVisita} esCoordinacion={esCoordinacion}
                onAprobada={onAprobada} onIrProgramar={() => setFase('programar')} />}
      </Card>
    </>
  );
}

function Subtitulo({ children }) {
  return <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-gris first:mt-0">{children}</h3>;
}

function Campo({ label, children }) {
  return (
    <div className="mt-3.5 flex-1">
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gris">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-borde bg-card px-3 py-2.5 text-[13px] outline-none focus:border-acento';

function OpcionBtn({ sel, tono, onClick, children }) {
  const tonos = {
    ok: 'border-verde-ok bg-verde-ok/12 text-verde-ok',
    warn: 'border-acento bg-acento/14 text-[var(--tono-warn-txt)]',
    bad: 'border-rojo bg-rojo/10 text-rojo',
  };
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-4 py-2.5 text-[13px] font-semibold transition ${
        sel ? `border-2 ${tonos[tono] || ''}` : 'border-borde bg-card text-texto hover:border-acento'
      }`}>
      {children}
    </button>
  );
}

// Muestra el formato con su número oficial delante, si lo tiene.
function NombreFormato({ f }) {
  return (
    <>
      {f.codigo && <span className="mr-1.5 rounded bg-marino/10 px-1.5 py-0.5 text-[10px] font-bold text-marino">{f.codigo}</span>}
      {f.nombre}
      {modalidadesTexto(f) && <span className="ml-1 text-[11px] text-gris">({modalidadesTexto(f)})</span>}
      {f.opcional && <span className="ml-1 text-[11px] text-gris">· opcional</span>}
      {f.alternativa && <span className="ml-1 text-[11px] text-gris">· basta uno de los dos</span>}
    </>
  );
}

// Muestra las visitas cerradas.
function Historial({ items }) {
  if (!items?.length) return null;
  return (
    <>
      <Subtitulo>Fechas anteriores</Subtitulo>
      <ul className="flex flex-col gap-1 text-xs text-gris">
        {items.map((h, i) => (
          <li key={i}>
            {fmtFecha(h.fecha)}{h.hora && ` · ${h.hora}`} — <b>{h.motivo}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

const DIAS_RAPIDOS = 14;
const HORAS_RAPIDAS = ['07:00', '08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

function sumarDias(iso, n) {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtFechaLarga(f) {
  const d = new Date(`${f}T00:00`);
  if (Number.isNaN(d.getTime())) return f;
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtHora(h) {
  const [hh, mm] = String(h || '').split(':').map(Number);
  if (Number.isNaN(hh)) return h || '';
  const sufijo = hh < 12 ? 'a. m.' : 'p. m.';
  return `${((hh + 11) % 12) + 1}:${String(mm || 0).padStart(2, '0')} ${sufijo}`;
}

const chipCls = (sel) => `shrink-0 rounded-lg border px-3 py-2 text-center transition ${
  sel ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-texto hover:border-acento'
}`;

// Selector de fecha con los casos comunes a un clic; min es la primera fecha posible y por defecto es hoy.
function SelectorFecha({ valor, onCambio, min = '' }) {
  const hoy = min && min > hoyISO() ? min : hoyISO();
  const dias = Array.from({ length: DIAS_RAPIDOS }, (_, i) => sumarDias(hoy, i));
  const fuera = valor && !dias.includes(valor);
  return (
    <>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {dias.map((d) => {
          const fecha = new Date(`${d}T00:00`);
          const sel = valor === d;
          return (
            <button key={d} type="button" onClick={() => onCambio(d)} className={`${chipCls(sel)} min-w-[62px]`}>
              <span className={`block text-[10px] font-semibold uppercase ${sel ? 'text-acento' : 'text-gris'}`}>
                {d === hoyISO() ? 'Hoy' : d === sumarDias(hoyISO(), 1) ? 'Mañana' : fecha.toLocaleDateString('es-CO', { weekday: 'short' })}
              </span>
              <span className="block text-lg font-bold leading-tight">{fecha.getDate()}</span>
              <span className={`block text-[10px] ${sel ? 'text-white/80' : 'text-gris'}`}>
                {fecha.toLocaleDateString('es-CO', { month: 'short' })}
              </span>
            </button>
          );
        })}
      </div>
      <label className="mt-2 inline-flex items-center gap-2 text-xs text-gris">
        Otra fecha:
        <input type="date" value={fuera ? valor : ''} min={hoy} onChange={(e) => onCambio(e.target.value)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-acento ${
            fuera ? 'border-marino text-texto' : 'border-borde bg-card'
          }`} />
      </label>
    </>
  );
}

// Selector de hora con los casos comunes a un clic.
function SelectorHora({ valor, onCambio }) {
  const fuera = valor && !HORAS_RAPIDAS.includes(valor);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {HORAS_RAPIDAS.map((h) => (
          <button key={h} type="button" onClick={() => onCambio(h)}
            className={`${chipCls(valor === h)} text-[13px] font-semibold`}>
            {fmtHora(h)}
          </button>
        ))}
      </div>
      <label className="mt-2 inline-flex items-center gap-2 text-xs text-gris">
        Otra hora:
        <input type="time" value={fuera ? valor : ''} onChange={(e) => onCambio(e.target.value)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-acento ${
            fuera ? 'border-marino text-texto' : 'border-borde bg-card'
          }`} />
      </label>
    </>
  );
}

// Documentos de la visita en las tres columnas de la tabla: obligatorios, opcionales y del beneficiario.
const GRUPOS_CARGUE = [
  { id: 'obligatorios', titulo: 'Documentos de la visita obligatorios' },
  { id: 'opcionales',   titulo: 'Documentos de la visita opcionales' },
  { id: 'beneficiario', titulo: 'Documentos del beneficiario' },
];
const COLUMNAS_LG = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' };

// Muestra los documentos de la visita para descargar el formato en blanco de cada uno; no se marca nada para
// agendar.
function Alistamiento({ tipo, up, plantillas, onPlantilla }) {
  const grupos = gruposFormatos(tipo, up);
  const columnas = GRUPOS_CARGUE.filter((g) => grupos[g.id].length);
  const mod = modalidadUP(up);
  const lista = (items, g) => (
    <ul className="flex flex-col gap-1.5">
      {items.map((f) => (
        <li key={f.nombre} className="rounded-md border border-borde bg-card px-2.5 py-2 text-[13px]">
          <span className="block text-texto">
            {f.codigo && <span className="mr-1.5 rounded bg-marino/10 px-1.5 py-0.5 text-[10px] font-bold text-marino">{f.codigo}</span>}
            {f.nombre}
            {f.minimos?.imagen && <span className="text-gris"> ({f.minimos.imagen})</span>}
            {g.id !== 'beneficiario' && modalidadesTexto(f) && (
              <span className="text-gris"> ({modalidadesTexto(f)})</span>
            )}
            {(g.id === 'beneficiario' || f.alternativa) && (
              <span className="mt-0.5 block text-[11px] text-gris">
                <b className={f.opcional ? 'text-gris' : 'text-marino'}>
                  {f.alternativa ? 'Basta uno de los dos' : f.opcional ? 'Opcional' : 'Obligatorio'}
                </b>
                {g.id === 'beneficiario' && modalidadesTexto(f) && <> · obligatorio para {modalidadesTexto(f)}</>}
              </span>
            )}
          </span>
          <Plantilla f={f} plantillas={plantillas} onPlantilla={onPlantilla} />
        </li>
      ))}
    </ul>
  );
  const porModalidad = (g) => [
    ['Obligatorios', grupos.beneficiarioObligatorios],
    ['Opcionales', grupos.beneficiarioOpcionales],
  ].filter(([, items]) => items.length).map(([titulo, items]) => (
    <div key={titulo} className="mt-2.5 first:mt-0">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-marino">{titulo}{mod ? ` en ${mod}` : ''}</p>
      {lista(items, g)}
    </div>
  ));
  return (
    <>
      <Subtitulo>Documentos para la visita</Subtitulo>
      <p className="mb-2.5 text-xs leading-relaxed text-gris">
        Estos son los documentos de la visita; descarga el formato en blanco de los que lo tienen. Los obligatorios
        y los opcionales dependen de la modalidad de la unidad
        {mod ? <> (<b className="text-texto">{mod}</b>)</> : null}.
      </p>
      {!mod && (
        <Aviso tono="warn">
          Esta unidad no tiene modalidad registrada: los documentos que dependen de la modalidad se
          muestran como opcionales y de los diagnósticos basta uno.
        </Aviso>
      )}
      <div className={`grid grid-cols-1 gap-3 ${COLUMNAS_LG[columnas.length]}`}>
        {columnas.map((g) => (
          <div key={g.id} className="rounded-lg border border-borde bg-bg p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">{g.titulo}</p>
            {g.id === 'beneficiario' ? porModalidad(g) : lista(grupos[g.id], g)}
          </div>
        ))}
      </div>
    </>
  );
}

const extDe = (n) => (/\.([a-z0-9]{2,5})$/i.exec(n || '')?.[1] || '').toUpperCase();

const CLASE_DESCARGA = 'inline-flex items-center gap-1 rounded-md border border-marino/25 bg-card px-2 py-0.5 text-[11px] '
  + 'font-semibold text-marino transition hover:border-marino hover:bg-marino/5';

function IconoDescarga() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

// Muestra la descarga del formato en blanco, el que viene con la aplicación o, si el documento no lo trae, el
// que sube la coordinación.
function Plantilla({ f, plantillas, onPlantilla }) {
  const propio = urlFormato(f);
  if (propio) {
    return (
      <span className="mt-1 flex flex-wrap gap-1.5">
        <a href={propio} download={f.formato} title={`Descargar ${f.formato}`} className={CLASE_DESCARGA}>
          <IconoDescarga />
          Descargar formato
        </a>
      </span>
    );
  }
  if (!f.plantilla) return null;
  if (plantillas === null) return <span className="mt-1 block text-[11px] italic text-gris">Buscando formato…</span>;
  const archivos = plantillaDe(f, plantillas);
  if (!archivos.length) {
    return <span className="mt-1 block text-[11px] italic text-gris">Formato no disponible por el momento</span>;
  }
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {archivos.map((n) => (
        <button key={n} type="button" title={`Descargar ${n}`} onClick={() => onPlantilla(n)} className={CLASE_DESCARGA}>
          <IconoDescarga />
          Descargar formato{archivos.length > 1 ? ` (${extDe(n)})` : ''}
        </button>
      ))}
    </span>
  );
}

// Fase de programación: llamada, resultado, fecha y alistamiento.
function FaseProgramar({ v, set, tipo, ocupado, onGuardar, plantillas, onPlantilla, error, session }) {
  const resultados = RESULTADOS.filter((r) =>
    RESULTADOS_SIN_CONTACTO.includes(r.id) === (v.llamada === 'no'));
  const [plazo, setPlazo] = useState(null);
  const idUnico = v.tipo === 'v3' && v.up?.ID_unico != null ? String(v.up.ID_unico) : '';
  useEffect(() => {
    if (!idUnico) return undefined;
    let vivo = true;
    pedirPlazoV3(idUnico, session).then((p) => { if (vivo) setPlazo(p); }).catch(() => { if (vivo) setPlazo(null); });
    return () => { vivo = false; };
  }, [idUnico, session]);
  return (
    <>
      {idUnico && plazo && (
        <Aviso tono={plazo.fecha_entrega ? 'warn' : 'bad'} className="mb-3">{textoPlazoV3(plazo)}</Aviso>
      )}
      <Subtitulo>Contacto con el beneficiario</Subtitulo>
      {v.up && (
        <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-borde bg-bg p-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Beneficiario', fullName(v.up)],
            ['Teléfono', val(v.up.unidad_tel1)],
            ['Teléfono 2', val(v.up.unidad_tel2)],
            ['Correo', val(v.up.unidad_mail1)],
            ['Dirección', val(v.up.unidad_direccion)],
          ].map(([k, val_]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gris">{k}</span>
              <b className="text-[13px] text-texto">{val_ || '—'}</b>
            </div>
          ))}
        </div>
      )}
      <p className="mb-2.5 mt-4 text-sm font-semibold text-texto">¿Se logró contactar al beneficiario?</p>
      <div className="flex flex-wrap items-end gap-2.5">
        <OpcionBtn sel={v.llamada === 'si'} tono="ok" onClick={() => set({ llamada: 'si', ...(RESULTADOS_SIN_CONTACTO.includes(v.resultado) ? { resultado: null } : {}) })}>Sí, se contactó</OpcionBtn>
        <OpcionBtn sel={v.llamada === 'no'} tono="bad"
          onClick={() => set({ llamada: 'no', ...(RESULTADOS_SIN_CONTACTO.includes(v.resultado) ? {} : { resultado: null }) })}>
          No se logró contactar
        </OpcionBtn>
        <label className="ml-auto flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
          Intentos
          <input type="number" min="1" value={v.intentos}
            onChange={(e) => set({ intentos: e.target.value })} className={`${inputCls} w-20`} />
        </label>
      </div>

      {v.llamada && (
        <>
          <Subtitulo>Resultado del agendamiento</Subtitulo>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {resultados.map((r) => (
              <OpcionBtn key={r.id} sel={v.resultado === r.id} tono={r.tono}
                onClick={() => set({ resultado: r.id })}>{r.label}</OpcionBtn>
            ))}
          </div>
          {v.resultado === 'agendada' && (
            <>
              <Campo label="Fecha de la visita">
                <SelectorFecha valor={v.fecha} onCambio={(fecha) => set({ fecha })} min={idUnico ? plazo?.desde || '' : ''} />
              </Campo>
              <Campo label="Hora">
                <SelectorHora valor={v.hora} onCambio={(hora) => set({ hora })} />
              </Campo>
              <div className={`mt-3.5 rounded-lg border px-3.5 py-2.5 text-[13px] ${
                v.fecha && v.hora ? 'border-verde-ok/35 bg-verde-ok/10 text-verde-ok' : 'border-borde bg-bg text-gris'
              }`}>
                {v.fecha && v.hora
                  ? <>Visita el <b>{fmtFechaLarga(v.fecha)}</b> a las <b>{fmtHora(v.hora)}</b></>
                  : !v.fecha ? 'Elige el día de la visita.' : 'Elige la hora de la visita.'}
              </div>
            </>
          )}
        </>
      )}

      <Historial items={v.historialAgenda} />

      {tipo && (
        <Alistamiento tipo={tipo} up={v.up} plantillas={plantillas} onPlantilla={onPlantilla} />
      )}

      <p className="mt-4 border-l-[3px] border-borde pl-2.5 text-xs italic text-gris">
        El recordatorio automático al gestor y al beneficiario aún no está conectado.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rojo/40 bg-rojo/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-rojo">{error}</p>
      )}
      <Btn onClick={onGuardar} disabled={ocupado} className="mt-4 w-full">Guardar programación</Btn>
    </>
  );
}

// Devuelve la extensión del archivo en mayúsculas para la etiqueta.
function extension(nombre) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(nombre || '');
  return m ? m[1].toUpperCase() : 'ARCH';
}

function fmtPeso(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Muestra un archivo ya cargado con su tipo, nombre y peso, y las opciones de ver y quitar; la papelera pide
// confirmar en el lugar.
function FilaArchivo({ a, ocupado, onQuitar, onVer }) {
  const [confirmando, setConfirmando] = useState(false);
  const ext = extension(a.nombre);
  const color = ext === 'PDF' ? 'bg-rojo/10 text-rojo'
    : ['MP4', 'MOV', 'WEBM', 'MKV', 'AVI', '3GP', 'M4V'].includes(ext) ? 'bg-marino/10 text-marino'
    : ['XLSX', 'XLS'].includes(ext) ? 'bg-verde-ok/12 text-verde-ok'
    : 'bg-acento/15 text-[var(--tono-warn-txt)]';
  if (confirmando) {
    return (
      <li className="flex flex-col gap-2 rounded-md border border-rojo/50 bg-card px-3 py-2 sm:flex-row sm:items-center">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-texto">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-rojo" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
          </svg>
          <span className="min-w-0 truncate">¿Quitar <b>{a.nombre || 'este archivo'}</b>?</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setConfirmando(false)} autoFocus
            className="flex-1 rounded-md border border-borde bg-card px-3.5 py-1.5 text-xs font-semibold text-texto transition hover:border-marino sm:flex-none">
            Cancelar
          </button>
          <button type="button" disabled={ocupado}
            onClick={() => { setConfirmando(false); onQuitar(); }}
            className="flex-1 rounded-md border border-rojo bg-rojo px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40 sm:flex-none">
            Sí, quitar
          </button>
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-borde bg-card py-1.5 pl-2 pr-1">
      <span className={`w-11 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold ${color}`}>{ext}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-texto" title={a.nombre}>{a.nombre || 'Archivo adjunto'}</span>
        {a.tamano > 0 && <span className="block text-[10px] text-gris">{fmtPeso(a.tamano)}</span>}
      </span>
      {a.blob && (
        <button type="button" onClick={() => onVer(a)}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-marino hover:bg-bg">Ver</button>
      )}
      <button type="button" onClick={() => setConfirmando(true)} disabled={ocupado}
        title="Quitar archivo" aria-label={`Quitar ${a.nombre || 'archivo'}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gris transition hover:bg-rojo/10 hover:text-rojo disabled:opacity-40">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        </svg>
      </button>
    </li>
  );
}

// Fase de realizar y cerrar la visita con sus formatos y validaciones.
function FaseRealizar({
  v, set, tipo, ocupado, habilitada, onElegirEstado, avanceGuardado, onDejarPendiente, onReprogramar, onCerrar, onSubirFormato, onQuitarArchivo,
  onIrProgramar, onVer, errorCierre, onSinGuardar, onGuardarVisita, esCoordinacion, onAprobada,
}) {
  const [bloqueos, setBloqueos] = useState({});
  const avisarBloqueo = useCallback((clave, lista) => setBloqueos((b) => ({ ...b, [clave]: lista })), []);
  const haySinGuardar = Object.values(bloqueos).flat().some((x) => x.startsWith('cambios sin guardar'));
  const avisarSinGuardar = useRef(onSinGuardar);
  avisarSinGuardar.current = onSinGuardar;
  useEffect(() => { avisarSinGuardar.current?.(haySinGuardar); }, [haySinGuardar]);
  useEffect(() => () => avisarSinGuardar.current?.(false), []);
  if (!habilitada) {
    return (
      <div className="py-6 text-center">
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-gris">
          {estaAgendada(v)
            ? <>Esta fase se habilita el día de la visita: <b className="text-texto">{fmtFecha(v.fecha)}</b>.</>
            : 'Primero programa la visita con una fecha acordada.'}
        </p>
        {!estaAgendada(v) && <Btn className="mt-3" onClick={onIrProgramar}>Ir a programar</Btn>}
      </div>
    );
  }
  const faltan = formatosFaltantes(tipo, v.up, v.archivos);
  const salidas = salidasCargadas(tipo, v.archivos);
  const pendientesCierre = [...(salidas.length ? [] : Object.values(bloqueos).flat()), ...faltantesVirtual(v, v.archivos)];
  const exigidosEnSalida = [...(tipo.exigeEnSalida || []), ...salidas,
    ...(tipo.dependencias || []).filter(([si]) => salidas.includes(si)).map(([, entonces]) => entonces)];
  return (
    <>
      <Subtitulo>Cargue de formatos</Subtitulo>
      {salidas.length > 0 && (
        <Aviso tono="bad">
          Se cargó el <b>{salidas.join(' y el ')}</b>: la visita se cierra con{' '}
          {exigidosEnSalida.join(', ')}. Al cerrarla, la unidad productiva sale del programa y no se
          programan más visitas. Si fue un error, quita el acta.
        </Aviso>
      )}
      {GRUPOS_CARGUE.map((g) => {
        const items = gruposFormatos(tipo, v.up)[g.id];
        if (!items.length) return null;
        return (
      <div key={g.id} className="mb-4 last:mb-0">
      <p className="mb-2 text-xs font-semibold text-marino">{g.titulo}</p>
      <div className="flex flex-col gap-2">
        {items.map((f) => {
          const archivo = v.archivos[f.nombre];
          const lista = Array.isArray(archivo) ? archivo : archivo ? [archivo] : [];
          const ok = lista.length > 0;
          const completo = ok && conteoMinimos(f, archivo).every((c) => c.tiene >= c.pide);
          const sugerido = f.nombreArchivo ? f.nombreArchivo(contextoNombre(v.up)) : '';
          return (
            <div key={f.nombre} className={`rounded-lg border px-3.5 py-2.5 ${
              completo ? 'border-verde-ok bg-verde-ok/8' : ok ? 'border-acento/60 bg-bg' : 'border-borde bg-bg'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-texto">
                  <NombreFormato f={f} />
                  {f.subcarpeta && <span className="ml-1 text-[11px] text-gris">· {f.subcarpeta}</span>}
                  {salidas.length > 0 && !f.opcional && !exigidosEnSalida.includes(f.nombre) && (
                    <span className="ml-1 text-[11px] font-semibold text-gris">· no se exige</span>
                  )}
                </span>
                <label className={`shrink-0 cursor-pointer rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold ${
                  ocupado ? 'pointer-events-none opacity-50' : ''
                } ${ok ? 'border-verde-ok text-verde-ok' : 'border-borde text-gris hover:border-acento hover:text-marino'}`}>
                  {ok ? (f.multiple ? 'Agregar más' : 'Reemplazar') : 'Adjuntar archivo'}
                  <input type="file" className="hidden" accept={f.accept} multiple={!!f.multiple}
                    disabled={ocupado}
                    onChange={(e) => {
                      const files = [...e.target.files];
                      e.target.value = '';
                      if (files.length) onSubirFormato(f, files);
                    }} />
                </label>
              </div>
              {f.desc && <p className="mt-1 text-[11px] leading-relaxed text-gris">{f.desc}</p>}
              {f.minimos && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {conteoMinimos(f, archivo).map((c) => (
                    <Chip key={c.clase} tono={c.tiene >= c.pide ? 'ok' : 'warn'}>
                      {Math.min(c.tiene, c.pide)} de {c.pide} {c.etiqueta}
                    </Chip>
                  ))}
                </p>
              )}
              {sugerido && (
                <p className="mt-1 text-[11px] text-gris">
                  Nombre del archivo: <b className="text-texto">{sugerido}</b>
                </p>
              )}
              {ok && (
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {lista.map((a, k) => (
                    <FilaArchivo key={k} a={a} ocupado={ocupado} onQuitar={() => onQuitarArchivo(f, k)} onVer={onVer} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      </div>
        );
      })}
      <p className="mt-3.5 border-l-[3px] border-acento pl-2.5 text-xs text-gris">
        {tipo.nota && <>{tipo.nota}<br /></>}
        {NOTA_GENERAL} Carpeta: <b>{tipo.carpeta}</b>.
      </p>

      {v.tipo === 'v1' && v.up?.ID_unico != null && (
        <>
          <Subtitulo>Asociados de la unidad</Subtitulo>
          <AsociadosUP idUnico={String(v.up.ID_unico)} onEstado={(r) => avisarBloqueo('asociados',
            r && r.minimo != null && r.total < r.minimo ? [`asociados: faltan ${r.minimo - r.total} para el mínimo de la modalidad ${r.modalidad}`] : [])} />
        </>
      )}

      {(v.tipo === 'v1' || v.tipo === 'v2') && v.up?.ID_unico != null && (
        <>
          <Subtitulo>{v.tipo === 'v1' ? 'Verificación, socialización y caracterización' : 'Diagnóstico y concepto técnico'}</Subtitulo>
          <DiagnosticoUP idUnico={String(v.up.ID_unico)} visita={v.tipo} onEstado={(lista) => avisarBloqueo('diagnostico', lista)} />
        </>
      )}

      {v.tipo === 'v3' && v.up?.ID_unico != null && (
        <>
          <Subtitulo>Evaluación de salida</Subtitulo>
          <EvaluacionSalidaUP idUnico={String(v.up.ID_unico)} onEstado={(lista) => avisarBloqueo('evaluacion', lista)} />
        </>
      )}

      <Subtitulo>Modalidad de la visita</Subtitulo>
      <ModalidadVisita v={v} set={set} ocupado={ocupado} esCoordinacion={esCoordinacion} onGuardar={onGuardarVisita} onAprobada={onAprobada} />

      <Subtitulo>
        Estado de la visita
        {avanceGuardado && <span className="ml-2 normal-case tracking-normal text-verde-ok">✓ Guardado</span>}
      </Subtitulo>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ESTADOS.map((e) => (
          <button key={e.id} type="button" onClick={() => onElegirEstado(e.id)}
            className={`flex flex-col gap-1.5 rounded-lg border border-t-4 p-3.5 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
              e.tono === 'ok' ? 'border-t-verde-ok' : e.tono === 'warn' ? 'border-t-acento' : 'border-t-rojo'
            } ${v.estado === e.id ? 'border-marino bg-card shadow-md' : 'border-borde bg-bg'}`}>
            <span className="text-sm font-bold text-marino">{e.label}</span>
            <span className="text-xs leading-relaxed text-gris">{e.desc}</span>
          </button>
        ))}
      </div>

      {v.estado === 'exitosa' && faltan.length > 0 && (
        <Aviso tono="warn" className="mt-3">
          Para cerrarla como exitosa faltan: {faltan.join(', ')}.
        </Aviso>
      )}
      {v.estado === 'exitosa' && pendientesCierre.length > 0 && (
        <Aviso tono="warn" className="mt-3">
          Para cerrarla también falta: {pendientesCierre.join('; ')}.
        </Aviso>
      )}
      {errorCierre && (
        <p role="alert" className="mt-3 rounded-lg border border-rojo/40 bg-rojo/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-rojo">
          {errorCierre}
        </p>
      )}

      {v.estado === 'norealizada' ? (
        <Btn onClick={onReprogramar} disabled={ocupado} className="mt-4 w-full">Registrar y reprogramar</Btn>
      ) : v.estado === 'revision' ? (
        <>
          <p className="mt-4 rounded-lg border border-acento/45 bg-acento/10 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--tono-warn-txt)]">
            La visita queda abierta en <b>Programadas → Pendientes de soportes</b>. Cuando cargues
            todos los formatos, márcala como exitosa y ciérrala.
          </p>
          <Btn variant="secondary" onClick={onDejarPendiente} disabled={ocupado} className="mt-3 w-full">
            Dejar pendiente y volver
          </Btn>
        </>
      ) : (
        <Btn onClick={onCerrar}
          disabled={ocupado || !v.estado || (v.estado === 'exitosa' && (faltan.length > 0 || pendientesCierre.length > 0))}
          className="mt-4 w-full">
          Cerrar visita
        </Btn>
      )}
    </>
  );
}

// Muestra el resumen de una visita.
function Resumen({ v, tipo, avance, onNueva, onAbrir, onVer, onReabrir, ocupado }) {
  const est = ESTADOS.find((e) => e.id === v.estado);
  const lista = tipo ? formatosDe(tipo, v.up) : [];
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-verde-ok text-lg text-white">✓</span>
        <div>
          <p className="text-[15px] font-bold text-marino">Visita cerrada</p>
          <p className="text-xs text-gris">{etiquetaCierre(est)}{v.id && <> · {v.id}</>}</p>
        </div>
      </div>
      <div className="rounded-lg border border-borde bg-bg px-4">
        {[
          ['Fecha y hora', `${fmtFecha(v.fecha)}${v.hora ? ` · ${v.hora}` : ''}`],
          ['Contacto', v.llamada === 'si' ? 'Contactado' : v.llamada === 'no' ? 'Sin contacto' : '—'],
          ['Intentos', v.intentos || '—'],
          ['Modalidad', v.modalidadVisita === 'virtual' ? 'Virtual por causa externa' : 'Presencial'],
          ...(v.modalidadVisita === 'virtual' ? [
            ['Causa externa', CAUSAS_VIRTUAL.find((c) => c.codigo === v.causaVirtual)?.nombre || '—'],
            ['Justificación', v.justificacionVirtual || '—'],
            ['Aprobación de la interventoría', v.aprobacionVirtual
              ? `${v.aprobacionVirtual.aprobada_por} · ${fmtFecha(v.aprobacionVirtual.fecha)}${v.aprobacionVirtual.registrada_por ? ` · registrada por ${v.aprobacionVirtual.registrada_por}` : ''}`
              : 'Sin aprobación registrada'],
          ] : []),
        ].map(([k, val_], i, arr) => (
          <div key={k} className={`flex flex-col justify-between gap-1 py-2.5 sm:flex-row sm:gap-3.5 ${
            i < arr.length - 1 ? 'border-b border-borde' : ''
          }`}>
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gris">{k}</span>
            <b className="whitespace-pre-line text-[13px] text-texto sm:text-right">{val_}</b>
          </div>
        ))}
      </div>
      {v.modalidadVisita === 'virtual' && v.aprobacionVirtual?.soporte && (
        <button type="button" onClick={() => onVer({ blob: v.aprobacionVirtual.soporte })}
          className="mt-2 text-xs font-semibold text-marino hover:underline">Ver soporte de la aprobación de la interventoría</button>
      )}
      <Subtitulo>Formatos cargados</Subtitulo>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {lista.map((f) => {
          const a = v.archivos[f.nombre];
          const arch = Array.isArray(a) ? a : a ? [a] : [];
          return (
            <li key={f.nombre} className={arch.length ? 'text-texto' : 'text-gris'}>
              {arch.length ? '✓ ' : '— '}<NombreFormato f={f} />
              {arch.map((x, k) => x.blob && (
                <button key={k} type="button" onClick={() => onVer(x)}
                  className="ml-2 text-xs font-semibold text-marino hover:underline">Ver{arch.length > 1 ? ` ${k + 1}` : ''}</button>
              ))}
            </li>
          );
        })}
      </ul>
      <Historial items={v.historialAgenda} />
      {salidasCargadas(tipo, v.archivos).length > 0 && (
        <Aviso tono="bad" className="mt-4">
          Con esta visita la unidad productiva salió del programa ({salidasCargadas(tipo, v.archivos).join(', ')}).
        </Aviso>
      )}
      {onReabrir && <Reabrir onReabrir={onReabrir} ocupado={ocupado} />}
      <SiguientePaso up={v.up} avance={avance} onNueva={onNueva} onAbrir={onAbrir} />
    </>
  );
}

// Reabre la visita con un motivo que queda registrado.
function Reabrir({ onReabrir, ocupado }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!abierto) {
    return (
      <div className="mt-5 text-right">
        <Btn variant="secondary" onClick={() => setAbierto(true)}>Reabrir visita</Btn>
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-lg border border-acento/45 bg-acento/10 p-3.5">
      <p className="mb-2 text-[13px] font-semibold text-texto">¿Por qué se reabre la visita?</p>
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300}
        placeholder="Ej.: el acta de visita quedó sin firma"
        className={`${inputCls} resize-y`} />
      <p className="mt-1.5 text-[11px] text-gris">
        Queda registrado quién la reabrió, cuándo y el motivo. La visita vuelve a quedar abierta hasta que se cierre otra vez.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Btn variant="secondary" onClick={() => { setAbierto(false); setMotivo(''); }}>Cancelar</Btn>
        <Btn disabled={ocupado || !motivo.trim()} onClick={() => onReabrir(motivo.trim())}>Reabrir</Btn>
      </div>
    </div>
  );
}

// Indica qué sigue en el proceso de la unidad después de esta visita.
function SiguientePaso({ up, avance, onNueva, onAbrir }) {
  if (!avance?.length) return null;
  if (avance[0]?.salida) return null;
  const pendientes = avance.filter((a) => a.estado === 'disponible' || a.estado === 'abierta');
  const completo = avance.every((a) => a.estado === 'hecha');
  return (
    <div className="mt-5 rounded-lg border border-acento/45 bg-acento/10 p-3.5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--tono-warn-txt)]">Siguiente paso del proceso</p>
      {completo && !pendientes.some((a) => a.estado === 'abierta') ? (
        <p className="text-[13px] text-texto">Esta unidad productiva ya cerró todas las visitas del proceso.</p>
      ) : !pendientes.length ? (
        <p className="text-[13px] text-texto">No hay visitas disponibles todavía para esta unidad.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendientes.map(({ tipo: t, estado, abierta }) => (
            <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-borde bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-marino">{t.nombre}</span>
                <span className="block text-[11px] text-gris">
                  {estado === 'abierta'
                    ? (situacionVisita(abierta) === 'soportes' ? 'Realizada, pendiente de soportes.'
                      : abierta.contacto_control?.fecha ? `Ya programada para el ${fmtFecha(abierta.contacto_control.fecha)}.` : 'Ya iniciada, pendiente de fecha.')
                    : t.desc}
                </span>
              </span>
              {estado === 'abierta'
                ? <Btn variant="secondary" onClick={() => onAbrir(abierta)}>Continuar</Btn>
                : <Btn onClick={() => onNueva(up, t)}>Programar</Btn>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
