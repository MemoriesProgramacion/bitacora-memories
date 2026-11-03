// Evaluación de salida de la unidad productiva, en la tercera visita y en la ficha: indicadores de resultado
// frente a la línea base congelada, caracterización de salida, encuesta de satisfacción, cumplimiento del acta
// de compromiso y uso de cada bien del plan aprobado. Qué se puede editar o revisar lo dice el servidor.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Alerta, Boton, Cargando, Entrada, Insignia, Seleccion, useAvisos } from '../inventario/componentes/ui';
import { aEnvio } from '../lib/secciones';
import { ESTADOS_REVISION } from '../lib/diagnostico';
import {
  bloqueosSalida, cargarEsquemaSalida, faltantesSalida, faltantesUsoActivos, guardarSeccionSalida, pedirEvaluacion,
  reenviarEvaluacion, revisarEvaluacion, textoIndicador, textoVariacion,
} from '../lib/salida';
import { PanelRevision, SeccionEditable, useAvisoSalida } from './FormularioSecciones';

// Carga la evaluación y muestra sus secciones; avisa el estado mediante onEstado.
export default function EvaluacionSalidaUP({ idUnico, conRevision = false, onEstado }) {
  const { avisar } = useAvisos();
  const [esquema, setEsquema] = useState(null);
  const [datos, setDatos] = useState(null);
  const [errorEsquema, setErrorEsquema] = useState('');
  const [errorDatos, setErrorDatos] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [abiertas, setAbiertas] = useState({});
  const [sucias, setSucias] = useState({});
  const [guardados, setGuardados] = useState({});
  const [ultima, setUltima] = useState(null);
  useAvisoSalida(Object.values(sucias).some(Boolean));

  const recargar = useCallback(async (trasGuardar = false) => {
    try {
      setDatos(await pedirEvaluacion(idUnico));
      setErrorDatos('');
    } catch (err) {
      if (trasGuardar) avisar(`Se guardó, pero no se pudo actualizar la vista: ${err.message}`, 'error');
      else setErrorDatos(err.message || 'No se pudo cargar la evaluación de salida.');
    }
  }, [idUnico, avisar]);
  const pedirEsquema = useCallback(() => {
    setErrorEsquema('');
    cargarEsquemaSalida().then(setEsquema).catch((err) => setErrorEsquema(err.message || 'No se pudo cargar el formulario de la evaluación.'));
  }, []);
  useEffect(() => {
    setDatos(null);
    setSucias({});
    recargar();
    pedirEsquema();
  }, [recargar, pedirEsquema]);

  const avisarEstado = useRef(onEstado);
  avisarEstado.current = onEstado;
  useEffect(() => {
    if (!datos) return;
    const titulos = Object.fromEntries((esquema?.secciones || []).map((s) => [s.clave, s.titulo]));
    const sinGuardar = [...new Set(Object.entries(sucias).filter(([, v]) => v).map(([k]) => titulos[k.replace(/_filas$/, '')] || k))];
    avisarEstado.current?.(bloqueosSalida(datos, sinGuardar));
  }, [datos, sucias, esquema]);

  const accion = async (fn, exito) => {
    setOcupado(true);
    try {
      await fn();
      avisar(exito);
      await recargar(true);
      return true;
    } catch (err) {
      avisar(err.message, 'error');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const error = errorEsquema || errorDatos;
  if (error) {
    return (
      <Alerta tono="error">
        {error}{' '}
        <button type="button" className="font-semibold underline" onClick={() => { if (errorEsquema) pedirEsquema(); if (errorDatos) recargar(); }}>Reintentar</button>
      </Alerta>
    );
  }
  if (!datos || !esquema) return <Cargando texto="Cargando evaluación de salida" />;

  const estado = ESTADOS_REVISION[datos.revision.estado] || ESTADOS_REVISION.sin_enviar;
  const editable = datos.editable;
  const guardar = async (s, valor) => {
    if (await accion(() => guardarSeccionSalida(idUnico, s.clave, valor), `${s.titulo}: guardado.`)) {
      setGuardados((g) => ({ ...g, [s.clave]: (g[s.clave] || 0) + 1 }));
      setUltima(s.clave);
    }
  };
  const marcarSucia = (clave) => (v) => setSucias((x) => (x[clave] === v ? x : { ...x, [clave]: v }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Insignia ajustar tono={datos.completitud.completo ? 'ok' : 'alerta'}>
          {datos.completitud.completo ? 'Evaluación completa' : `Faltan ${datos.completitud.faltan.length} dato(s) para cerrar la Visita 3`}
        </Insignia>
        <Insignia tono={estado.tono}>Revisión: {estado.texto}</Insignia>
        {datos.satisfaccion !== null && <Insignia tono="neutro">Satisfacción: {datos.satisfaccion.toLocaleString('es-CO')} de 5</Insignia>}
      </div>
      {datos.completitud.faltan.length > 0 && (
        <details className="text-[12px] text-gris-txt">
          <summary className="cursor-pointer font-semibold text-marca">Ver qué falta</summary>
          <ul className="mt-1.5 list-disc pl-5">{datos.completitud.faltan.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      {datos.motivo_bloqueo && !datos.visitas.v3_cerrada && datos.revision.estado === 'sin_enviar' && (
        <Alerta tono="info">{datos.motivo_bloqueo}</Alerta>
      )}
      {datos.revision.estado === 'devuelto' && datos.revision.observacion && (
        <Alerta tono="error"><b>Devuelta por la coordinación:</b> {datos.revision.observacion}</Alerta>
      )}

      <Comparacion datos={datos} />

      {esquema.secciones.map((s) => (
        <SeccionEditable
          key={`${s.clave}:${guardados[s.clave] || 0}:${JSON.stringify(datos.secciones[s.clave])}`}
          enfocar={ultima === s.clave}
          seccion={s}
          guardado={datos.secciones[s.clave]}
          editable={editable}
          abierta={Boolean(abiertas[s.clave])}
          onAlternar={() => setAbiertas((a) => ({ ...a, [s.clave]: !a[s.clave] }))}
          ocupado={ocupado}
          faltantes={s.especial === 'bienes' ? (_, d) => faltantesUsoActivos(datos.bienes, d) : faltantesSalida}
          onSucio={marcarSucia(s.clave)}
          onGuardar={(f) => guardar(s, aEnvio(s, f))}
        >
          {s.especial === 'bienes' && (
            <UsoActivos seccion={s} bienes={datos.bienes} guardado={datos.secciones.uso_activos} editable={editable} ocupado={ocupado}
              onSucio={marcarSucia('uso_activos_filas')} onGuardar={(items) => guardar(s, { items })} />
          )}
        </SeccionEditable>
      ))}

      {conRevision && (
        <PanelRevision
          datos={datos} ocupado={ocupado} completo={datos.completitud.completo}
          onRevisar={() => accion(() => revisarEvaluacion(idUnico, 'revisado'), 'Evaluación marcada como revisada.')}
          onDevolver={(obs) => accion(() => revisarEvaluacion(idUnico, 'devuelto', obs), 'Evaluación devuelta al gestor.')}
          onReenviar={() => accion(() => reenviarEvaluacion(idUnico), 'Evaluación reenviada a revisión.')}
        />
      )}
    </div>
  );
}

// Muestra la línea base frente a la salida con la variación de cada indicador.
function Comparacion({ datos }) {
  if (!datos.linea_base) {
    return <Alerta tono="info">La línea base se congela al cerrar la Visita 2; todavía no hay con qué comparar.</Alerta>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-borde">
      <table className="w-full min-w-[480px] text-[13px]">
        <caption className="sr-only">Indicadores: línea base, salida y variación</caption>
        <thead>
          <tr className="bg-lienzo/70 text-left text-[12px] text-gris-txt">
            <th scope="col" className="px-3 py-2 font-semibold">Indicador</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Línea base</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Salida</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Variación</th>
          </tr>
        </thead>
        <tbody>
          {datos.comparacion.map((c) => (
            <tr key={c.clave} className="border-t border-borde/70">
              <th scope="row" className="px-3 py-2 text-left font-medium text-marca">{c.etiqueta}</th>
              <td className="cifras px-3 py-2 text-right">{textoIndicador(c.tipo, c.base)}</td>
              <td className="cifras px-3 py-2 text-right">{textoIndicador(c.tipo, c.salida)}</td>
              <td className={`cifras px-3 py-2 text-right font-semibold ${c.variacion_pct > 0 ? 'text-ok-txt' : c.variacion_pct < 0 ? 'text-rojo-txt' : 'text-gris-txt'}`}>
                {textoVariacion(c.variacion_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Muestra una fila por bien del plan aprobado con su estado y, si no está en uso, el motivo.
function UsoActivos({ seccion, bienes, guardado, editable, ocupado, onGuardar, onSucio }) {
  const inicial = () => bienes.map((b) => {
    const x = (guardado?.items || []).find((y) => Number(y.id_linea) === Number(b.id_linea));
    return { id_linea: b.id_linea, estado: x?.estado || '', observacion: x?.observacion || '' };
  });
  const [filas, setFilas] = useState(inicial);
  const normal = (xs) => JSON.stringify(xs.map((x) => [x.id_linea, x.estado || null, String(x.observacion || '').trim() || null]));
  const sucio = editable && normal(filas) !== normal(inicial());
  const avisar = useRef(onSucio);
  avisar.current = onSucio;
  useEffect(() => { avisar.current?.(sucio); }, [sucio]);
  useEffect(() => () => avisar.current?.(false), []);
  if (!bienes.length) return <p className="text-[13px] text-gris-txt">La unidad no tiene un plan de capitalización aprobado: no hay bienes que verificar.</p>;
  const nombre = (id) => bienes.find((b) => Number(b.id_linea) === Number(id))?.nombre;
  const cambiar = (i, campo, valor) => setFilas((xs) => xs.map((x, k) => (k === i ? { ...x, [campo]: valor } : x)));
  return (
    <div className="flex flex-col gap-2.5">
      {filas.map((x, i) => (
        <div key={x.id_linea} className="grid gap-2 rounded-lg bg-lienzo/60 p-2.5 sm:grid-cols-[1fr_180px]">
          <span className="text-[13px] font-semibold text-marca">{nombre(x.id_linea)}</span>
          {editable ? (
            <Seleccion aria-label={`Estado de ${nombre(x.id_linea)}`} value={x.estado} onChange={(e) => cambiar(i, 'estado', e.target.value)}>
              <option value="">Elige…</option>
              {seccion.estados.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
            </Seleccion>
          ) : <span className="text-[13px] text-gris-txt">{seccion.estados.find((e) => e.codigo === x.estado)?.nombre || '—'}</span>}
          {x.estado && x.estado !== 'en_uso' && (editable ? (
            <Entrada className="sm:col-span-2" aria-label={`Por qué ${nombre(x.id_linea)} no está en uso`} placeholder="Por qué no está en uso"
              maxLength={1000} value={x.observacion} onChange={(e) => cambiar(i, 'observacion', e.target.value)} />
          ) : <span className="text-[12px] text-gris-txt sm:col-span-2">{x.observacion || '—'}</span>)}
        </div>
      ))}
      {editable && (
        <div>
          <Boton tamano="sm" icono={Check} cargando={ocupado}
            onClick={() => onGuardar(filas.map((x) => ({ id_linea: x.id_linea, estado: x.estado || null, observacion: x.observacion.trim() || null })))}>
            Guardar uso de los activos
          </Boton>
        </div>
      )}
    </div>
  );
}
