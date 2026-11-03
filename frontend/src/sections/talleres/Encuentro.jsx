// Módulo de un taller, de 180 minutos: 2 horas teórico-prácticas y 1 de evaluación. Es presencial o virtual con
// aprobación. Muestra la lista de asistencia por unidad, las evidencias y los materiales, y permite registrar
// el módulo realizado con la asistencia firmada y las tres evidencias obligatorias.
import { useState } from 'react';
import { CalendarDays, Check, CheckCircle2, Save } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import Adjuntos from './Adjuntos';
import { fechaColombia, fechaInput, inicioISO, claveAsistente, regionIgual } from './fechas';
import MaterialEncuentro from './MaterialEncuentro';
import { EVIDENCIAS, MB_ASISTENCIA, ayudaEvidencia, problemaEvidencia } from './evidencias';
import { CONFIRMACION, resumenConfirmaciones, textoModulo } from './confirmacion';
import { EtiquetaUP } from './GruposUP';
import { CAUSAS_VIRTUAL } from '../../lib/visitas';
import { infoUP, textoBloques, textoSesion, validezSeleccion } from '../../lib/formacion';
import { hoyISO } from '../../lib/asociados';
import DescargaFormato from '../../components/DescargaFormato';

// Muestra un módulo con su modalidad, su asistencia, sus evidencias y el formulario para registrarlo como
// realizado.
export default function Encuentro({ taller, e, contenido, recargar, puedeProgramar = false, talleristas = [] }) {
  const [abierto, setAbierto] = useState(false);
  const [programando, setProgramando] = useState(false);
  const [inicio, setInicio] = useState(fechaInput(e.inicio));
  const [docente, setDocente] = useState(e.tallerista_sub || '');
  const [asistencia, setAsistencia] = useState([]);
  const [integrantes, setIntegrantes] = useState({});
  const [archivos, setArchivos] = useState([]);
  const [evidencias, setEvidencias] = useState({ informe: [], foto: [], video: [] });
  const [observaciones, setObservaciones] = useState('');
  const [evaluacion, setEvaluacion] = useState('');
  const { ejecutar, ocupado } = useAccion(recargar);
  const { avisar } = useAvisos();
  const terminado = new Date(e.inicio).getTime() + 180 * 60_000 <= Date.now();
  const virtual = e.modalidad === 'VIRTUAL';
  const faltaAprobacion = virtual && !e.aprobacion_virtual;
  const puedeModalidad = !e.realizado_en && (puedeProgramar || e.mio);

  const marcarUP = (clave, si) => setAsistencia((v) => (si ? [...v, clave] : v.filter((d) => d !== clave)));
  const marcarIntegrante = (idUp, idAsociado, si) => setIntegrantes((m) => {
    const actual = m[idUp] || [];
    return { ...m, [idUp]: si ? [...actual, idAsociado] : actual.filter((x) => x !== idAsociado) };
  });

  const guardar = async (ev) => {
    ev.preventDefault();
    if (archivos.length > 5 || archivos.some((f) => f.size > MB_ASISTENCIA * 1024 * 1024)) { avisar(`Asistencia firmada: de 1 a 5 archivos de máximo ${MB_ASISTENCIA} MB cada uno.`, 'error'); return; }
    const problema = EVIDENCIAS.map((d) => problemaEvidencia(d, evidencias[d.tipo])).find(Boolean);
    if (problema) { avisar(problema, 'error'); return; }
    const presentes = Object.fromEntries(Object.entries(integrantes).filter(([idUp]) => asistencia.includes(`up:${idUp}`)));
    const f = new FormData();
    f.append('asistencia', JSON.stringify(asistencia));
    f.append('integrantes', JSON.stringify(presentes));
    f.append('observaciones', observaciones);
    f.append('evaluacion', evaluacion);
    archivos.forEach((a) => f.append('soportes', a));
    EVIDENCIAS.forEach((d) => evidencias[d.tipo].forEach((a) => f.append(d.campo, a)));
    const r = await ejecutar(() => apiGeneral.post(`/talleres/${taller.id}/encuentros/${e.modulo}/realizar`, f));
    if (r) setAbierto(false);
  };

  return (
    <Tarjeta titulo={`Módulo ${e.modulo} · 3 horas`}
      acciones={<span className="flex flex-wrap gap-1.5">
        {virtual && <Insignia tono={faltaAprobacion ? 'alerta' : 'ok'}>{faltaAprobacion ? 'Virtual: falta la aprobación' : 'Virtual aprobada'}</Insignia>}
        <Insignia tono={e.realizado_en ? 'ok' : 'alerta'}>{e.realizado_en ? 'Realizado' : 'Programado'}</Insignia>
      </span>}>
      <div className="grid gap-4">
        <p className="text-sm font-semibold text-marino">{fechaColombia(e.inicio)} — {fechaColombia(new Date(new Date(e.inicio).getTime() + 180 * 60_000).toISOString())}</p>
        {e.bloques && <p className="text-[13px] text-gris-txt">{textoBloques(e.bloques)}</p>}
        <p className="text-[13px] text-gris-txt">Grupo: <strong className="text-texto">{taller.grupo_nombre || taller.nombre}</strong> · Docente asignado: <strong className="text-texto">{e.tallerista_nombre || 'Sin asignar'}</strong></p>
        <MaterialEncuentro c={contenido} />
        {contenido && contenido.aprobado === false && <p><Insignia tono="alerta">Pendiente del Comité Técnico: el Tallerista no lo ve</Insignia></p>}
        {puedeModalidad && <Modalidad key={`${e.modalidad}|${e.causa_virtual || ''}|${e.justificacion_virtual || ''}`} taller={taller} e={e} puedeAprobar={puedeProgramar} recargar={recargar} />}
        {!puedeModalidad && virtual && e.aprobacion_virtual && (
          <p className="flex items-center gap-1.5 text-[13px] text-ok-txt"><CheckCircle2 size={16} aria-hidden="true" />Sesión virtual aprobada por la interventoría ({e.aprobacion_virtual.aprobada_por}).</p>
        )}
        {e.realizado_en ? (
          <>
            <p className="text-sm"><strong>{e.asistencia.length}</strong> UP asistentes · {taller.participantes.length - e.asistencia.length} ausentes. Registrado el {fechaColombia(e.realizado_en)}.</p>
            {e.evaluacion_descripcion && <p className="text-[13px]"><span className="text-gris-txt">Evaluación (tercera hora):</span> {e.evaluacion_descripcion}</p>}
            <details className="rounded-lg border border-borde p-3 text-[13px]">
              <summary className="cursor-pointer font-semibold">Ver lista de asistencia</summary>
              <ul className="mt-2 grid gap-2">{taller.participantes.map((p) => {
                const m = taller.cumplimiento?.[p.id_up]?.modulos?.find((x) => x.modulo === e.modulo);
                return (
                  <li key={claveAsistente(p)} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.asistencia.includes(claveAsistente(p)) ? 'Presente' : 'Ausente'}</span>
                    <span>· {p.id_unico || p.documento} · {p.nombre}{p.representante ? ` · ${p.representante}` : ''}</span>
                    {m && <Insignia tono={m.valida ? 'ok' : m.asistio ? 'alerta' : 'neutro'}>{textoSesion(m)}</Insignia>}
                  </li>
                );
              })}</ul>
            </details>
            {e.observaciones && <p className="whitespace-pre-wrap text-[13px]">{e.observaciones}</p>}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {puedeProgramar && <Boton variante="fantasma" icono={CalendarDays} onClick={() => { setInicio(fechaInput(e.inicio)); setDocente(e.tallerista_sub || ''); setProgramando(!programando); }}>Reprogramar o cambiar docente</Boton>}
              <Boton icono={Check} aria-expanded={abierto} disabled={!terminado || !taller.participantes.length || faltaAprobacion} onClick={() => setAbierto(!abierto)}>Registrar asistencia del módulo</Boton>
            </div>
            {!terminado && <p className="text-[13px] text-gris-txt">El registro de asistencia se habilita al terminar las tres horas del módulo.</p>}
            {faltaAprobacion && <Alerta tono="aviso">La sesión es virtual: la coordinación debe registrar la aprobación de la interventoría antes de la asistencia.</Alerta>}
            {!taller.participantes.length && <Alerta tono="aviso">Selecciona un grupo de UP antes de registrar la asistencia.</Alerta>}
            {programando && (
              <form className="flex flex-wrap items-end gap-3 border-t border-borde pt-3" onSubmit={async (ev) => {
                ev.preventDefault();
                const r = await ejecutar(() => apiGeneral.put(`/talleres/${taller.id}/encuentros/${e.modulo}`, { inicio: inicioISO(inicio), tallerista_sub: docente }));
                if (r) setProgramando(false);
              }}>
                <Campo etiqueta="Nuevo inicio (hora de Colombia)"><Entrada required type="datetime-local" value={inicio} onChange={(ev) => setInicio(ev.target.value)} /></Campo>
                <Campo etiqueta="Docente del módulo"><Seleccion required value={docente} onChange={(ev) => setDocente(ev.target.value)}>
                  <option value="">Elige el Tallerista…</option>{talleristas.filter((t) => regionIgual(t.region, taller.region)).map((t) => <option key={t.sub} value={t.sub}>{t.nombre}</option>)}
                </Seleccion></Campo>
                <Boton tipo="submit" cargando={ocupado}>Guardar fecha</Boton>
              </form>
            )}
            {abierto && (
              <form onSubmit={guardar}>
                <fieldset disabled={ocupado} className="grid gap-4 border-t border-borde pt-4">
                  <legend className="text-sm font-semibold">Asistencia · {asistencia.length}/{taller.participantes.length}</legend>
                  <ResumenConvocatoria taller={taller} e={e} />
                  <div className="grid gap-2 lg:grid-cols-2">
                    {taller.participantes.map((p) => {
                      const clave = claveAsistente(p);
                      const presente = asistencia.includes(clave);
                      const info = infoUP(taller, p.id_up);
                      const sel = integrantes[p.id_up] || [];
                      const v = validezSeleccion(info, sel);
                      return (
                        <div key={clave} className="rounded-lg border border-borde p-3 text-[13px]">
                          <label className="flex min-h-11 cursor-pointer items-center gap-3">
                            <input type="checkbox" checked={presente} onChange={(ev) => marcarUP(clave, ev.target.checked)} />
                            <EtiquetaUP up={p} />
                          </label>
                          <ConfirmacionUP c={e.confirmaciones?.[p.id_up]} />
                          {presente && info && info.modalidad !== 'M1' && (
                            <fieldset className="mt-2 grid gap-1 border-t border-borde pt-2">
                              <legend className="text-[12px] font-semibold text-gris-txt">Integrantes que asistieron ({info.modalidad}: mínimo {info.minimo})</legend>
                              {info.integrantes.length === 0 && <p className="text-[12px] text-aviso-txt">La unidad no tiene asociados registrados: regístralos en la Visita 1.</p>}
                              {info.integrantes.map((i) => (
                                <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                                  <input type="checkbox" checked={sel.includes(i.id)} onChange={(ev) => marcarIntegrante(p.id_up, i.id, ev.target.checked)} />
                                  <span>{i.nombre}{i.es_representante ? ' (representante)' : ''}</span>
                                </label>
                              ))}
                              <p role="status" aria-live="polite" className={`text-[12px] ${v.suficiente ? 'text-ok-txt' : 'text-aviso-txt'}`}>{v.texto}</p>
                            </fieldset>
                          )}
                          {presente && info?.modalidad === 'M1' && <p className="mt-1 text-[12px] text-gris-txt">{v.texto}</p>}
                        </div>
                      );
                    })}
                  </div>
                  <Campo etiqueta="Actividad de evaluación de la tercera hora" obligatorio ayuda="Qué se hizo en la hora de evaluación del módulo.">
                    <AreaTexto required rows={2} maxLength={2000} value={evaluacion} onChange={(ev) => setEvaluacion(ev.target.value)} />
                  </Campo>
                  <Campo etiqueta="Asistencia firmada en físico" obligatorio ayuda={`Planilla firmada por las UP en el módulo, escaneada o en foto. De 1 a 5 archivos PDF, JPG o PNG; máximo ${MB_ASISTENCIA} MB cada uno.`}>
                    <Entrada required type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(ev) => setArchivos(Array.from(ev.target.files || []))} />
                    <span className="mt-1.5 block"><DescargaFormato archivo="17_Lista_de_Asistencia.pdf" etiqueta="Descargar formato de lista de asistencia" /></span>
                  </Campo>
                  <fieldset className="grid gap-3 rounded-lg border border-borde p-3">
                    <legend className="px-1 text-sm font-semibold">Evidencias del módulo · las tres son obligatorias</legend>
                    <div className="grid gap-4 lg:grid-cols-3">
                      {EVIDENCIAS.map((d) => (
                        <Campo key={d.tipo} etiqueta={d.titulo} obligatorio ayuda={ayudaEvidencia(d)}>
                          <Entrada required type="file" multiple={d.max > 1} accept={d.acepta}
                            onChange={(ev) => { const lista = Array.from(ev.target.files || []); setEvidencias((v) => ({ ...v, [d.tipo]: lista })); }} />
                        </Campo>
                      ))}
                    </div>
                  </fieldset>
                  <Campo etiqueta="Observaciones"><AreaTexto maxLength={2000} value={observaciones} onChange={(ev) => setObservaciones(ev.target.value)} /></Campo>
                  <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setAbierto(false)}>Cancelar</Boton><Boton tipo="submit" cargando={ocupado} disabled={!asistencia.length || !archivos.length || !evaluacion.trim() || EVIDENCIAS.some((d) => !evidencias[d.tipo].length)}>Registrar módulo realizado</Boton></div>
                </fieldset>
              </form>
            )}
          </>
        )}
        <Adjuntos taller={taller} e={e} recargar={recargar} puedeEditar={puedeProgramar} />
      </div>
    </Tarjeta>
  );
}

// Muestra la modalidad del módulo, presencial o virtual por causa externa, y la aprobación que registra la
// coordinación.
function Modalidad({ taller, e, puedeAprobar, recargar }) {
  const [modalidad, setModalidad] = useState(e.modalidad || 'PRESENCIAL');
  const [causa, setCausa] = useState(e.causa_virtual || '');
  const [justificacion, setJustificacion] = useState(e.justificacion_virtual || '');
  const [aprobando, setAprobando] = useState(false);
  const { ejecutar, ocupado } = useAccion(recargar);
  const cambio = modalidad !== (e.modalidad || 'PRESENCIAL') || (modalidad === 'VIRTUAL' && (causa !== (e.causa_virtual || '') || justificacion.trim() !== (e.justificacion_virtual || '')));
  const incompleta = modalidad === 'VIRTUAL' && (!causa || !justificacion.trim());
  return (
    <div className="grid gap-3 rounded-lg border border-borde p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Modalidad de la sesión">
          <Seleccion value={modalidad} onChange={(ev) => setModalidad(ev.target.value)}>
            <option value="PRESENCIAL">Presencial</option><option value="VIRTUAL">Virtual por causa externa</option>
          </Seleccion>
        </Campo>
        {modalidad === 'VIRTUAL' && (
          <Campo etiqueta="Causa externa" obligatorio>
            <Seleccion required value={causa} onChange={(ev) => setCausa(ev.target.value)}>
              <option value="">Elige…</option>{CAUSAS_VIRTUAL.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </Seleccion>
          </Campo>
        )}
      </div>
      {modalidad === 'VIRTUAL' && (
        <Campo etiqueta="Justificación" obligatorio><AreaTexto required rows={2} maxLength={2000} value={justificacion} onChange={(ev) => setJustificacion(ev.target.value)} /></Campo>
      )}
      {e.aprobacion_virtual && (
        <p className="text-[12px] text-gris-txt">Si cambias la modalidad, la causa o la justificación, la aprobación de la interventoría se descarta y la coordinación debe registrarla de nuevo.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Boton tamano="sm" variante="fantasma" icono={Save} cargando={ocupado} disabled={!cambio || incompleta} title={incompleta ? 'Elige la causa y escribe la justificación.' : undefined}
          onClick={() => ejecutar(() => apiGeneral.put(`/talleres/${taller.id}/encuentros/${e.modulo}/modalidad`, { modalidad, causa_virtual: causa, justificacion_virtual: justificacion }))}>
          Guardar modalidad
        </Boton>
        {e.modalidad === 'VIRTUAL' && (e.aprobacion_virtual
          ? <span className="flex items-center gap-1.5 text-[13px] text-ok-txt"><CheckCircle2 size={16} aria-hidden="true" />Aprobada por la interventoría ({e.aprobacion_virtual.aprobada_por})</span>
          : puedeAprobar ? <Boton tamano="sm" onClick={() => setAprobando(true)}>Registrar aprobación de la interventoría</Boton>
            : <span className="text-[13px] text-aviso-txt">Pendiente: la coordinación registra la aprobación de la interventoría.</span>)}
      </div>
      <Dialogo abierto={aprobando} titulo="Aprobación de la interventoría" onCerrar={() => !ocupado && setAprobando(false)}>
        {aprobando && <FormAprobacionSesion ocupado={ocupado} onCancelar={() => setAprobando(false)} onGuardar={async (f) => {
          const r = await ejecutar(() => apiGeneral.post(`/talleres/${taller.id}/encuentros/${e.modulo}/aprobacion-virtual`, f));
          if (r) setAprobando(false);
        }} />}
      </Dialogo>
    </div>
  );
}

// Formulario para registrar la aprobación de una sesión virtual.
function FormAprobacionSesion({ ocupado, onGuardar, onCancelar }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [aprobadaPor, setAprobadaPor] = useState('');
  const [observacion, setObservacion] = useState('');
  const [archivo, setArchivo] = useState(null);
  return (
    <form className="grid gap-3" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData();
      f.append('fecha', fecha); f.append('aprobada_por', aprobadaPor.trim());
      if (observacion.trim()) f.append('observacion', observacion.trim());
      f.append('archivo', archivo);
      onGuardar(f);
    }}>
      <Campo etiqueta="Fecha de la aprobación" obligatorio><Entrada type="date" max={hoyISO()} required value={fecha} onChange={(ev) => setFecha(ev.target.value)} /></Campo>
      <Campo etiqueta="Quién aprobó en la interventoría" obligatorio><Entrada required maxLength={200} value={aprobadaPor} onChange={(ev) => setAprobadaPor(ev.target.value)} /></Campo>
      <Campo etiqueta="Observación"><AreaTexto rows={2} maxLength={1000} value={observacion} onChange={(ev) => setObservacion(ev.target.value)} /></Campo>
      <Campo etiqueta="Soporte de la aprobación (PDF)" obligatorio><Entrada required type="file" accept="application/pdf,.pdf" onChange={(ev) => setArchivo(ev.target.files?.[0] || null)} /></Campo>
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton><Boton tipo="submit" cargando={ocupado} disabled={!aprobadaPor.trim() || !archivo}>Registrar aprobación</Boton></div>
    </form>
  );
}

// Muestra lo que la convocatoria confirmó por llamada para este módulo: la unidad sigue en la lista, pero se
// sabe quién confirmó y quién dijo que no.
function ConfirmacionUP({ c }) {
  const [tono, texto] = CONFIRMACION[c?.situacion || 'por_llamar'];
  return (
    <div className="mt-1 grid gap-1 pl-7">
      <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Insignia tono={tono}>{texto}</Insignia>
        {c && <span className="text-gris-txt">Llamada: {textoModulo(c.modulo)}</span>}
      </span>
      {c?.discapacidad_detalle && <p className="text-[12px] text-aviso-txt">Asistirá una persona con discapacidad: {c.discapacidad_detalle}</p>}
    </div>
  );
}

// Muestra cuántas unidades del grupo confirmaron, no asistirán o siguen sin confirmar.
function ResumenConvocatoria({ taller, e }) {
  const r = resumenConfirmaciones(taller.participantes, e.confirmaciones);
  return (
    <p className="text-[13px] text-gris-txt">
      Convocatoria por llamada para este módulo: <strong className="text-texto">{r.asistira}</strong> confirmaron asistencia ·{' '}
      <strong className="text-texto">{r.no_asistira}</strong> dijeron que no asistirán · <strong className="text-texto">{r.sin_confirmar}</strong> sin confirmar.
      Todas las UP del grupo siguen en la lista: marca la asistencia real.
    </p>
  );
}
