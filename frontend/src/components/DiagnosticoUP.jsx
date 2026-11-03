// Diagnóstico de la unidad productiva. En la primera visita muestra la verificación en sitio, la socialización
// de la ruta y la caracterización; en la segunda, recursos y finanzas, línea base, mercado, FODA, plan de
// fortalecimiento y concepto; en la ficha, todo con la revisión de la coordinación. Cada sección se guarda por
// separado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alerta, Cargando, Insignia, useAvisos } from '../inventario/componentes/ui';
import { urlArchivo } from '../lib/api';
import {
  ESTADOS_REVISION, NIVELES_FORMALIZACION, aEnvio, bloqueosDeCierre, cargarEsquema, faltantes, guardarSeccion,
  pedirDiagnostico, pesos, reenviar, revisar, seccionesDe,
} from '../lib/diagnostico';
import { Dato, PanelRevision, SeccionEditable, useAvisoSalida } from './FormularioSecciones';

// Carga el diagnóstico de la unidad y muestra las secciones que corresponden.
export default function DiagnosticoUP({ idUnico, visita = null, conRevision = false, onEstado }) {
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
  const haySucias = Object.values(sucias).some(Boolean);
  useAvisoSalida(haySucias);

  const recargar = useCallback(async (trasGuardar = false) => {
    try {
      setDatos(await pedirDiagnostico(idUnico));
      setErrorDatos('');
    } catch (err) {
      if (trasGuardar) avisar(`Se guardó, pero no se pudo actualizar la vista: ${err.message}`, 'error');
      else setErrorDatos(err.message || 'No se pudo cargar el diagnóstico.');
    }
  }, [idUnico, avisar]);
  const pedirEsquema = useCallback(() => {
    setErrorEsquema('');
    cargarEsquema().then(setEsquema).catch((err) => setErrorEsquema(err.message || 'No se pudo cargar el formulario del diagnóstico.'));
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
    const sinGuardar = (esquema?.secciones || []).filter((s) => sucias[s.clave]).map((s) => s.titulo);
    avisarEstado.current?.(bloqueosDeCierre(datos, visita, sinGuardar));
  }, [datos, visita, sucias, esquema]);

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
  if (!datos || !esquema) return <Cargando texto="Cargando diagnóstico" />;

  const comp = visita === 'v1' ? datos.completitud.v1 : datos.completitud.v2;
  const secciones = seccionesDe(esquema, null).filter((s) => !visita || s.visita === visita
    || (visita === 'v2' && s.visita === 'v1' && faltantes(s, datos.secciones[s.clave]).length > 0));
  const estado = ESTADOS_REVISION[datos.revision.estado] || ESTADOS_REVISION.sin_enviar;
  const c = datos.calculos;
  const negativos = datos.completitud.v1.verificacion_negativa || [];
  const nombresSucias = secciones.filter((s) => sucias[s.clave]).map((s) => s.titulo);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Insignia ajustar tono={comp.completo ? 'ok' : 'alerta'}>
          {comp.completo ? 'Diagnóstico completo' : `Faltan ${comp.faltan.length} dato(s)`}
          {visita ? ` para cerrar la ${visita === 'v1' ? 'Visita 1' : 'Visita 2'}` : ''}
        </Insignia>
        {visita !== 'v1' && <Insignia tono={estado.tono}>Revisión: {estado.texto}</Insignia>}
      </div>
      {comp.faltan.length > 0 && (
        <details className="text-[12px] text-gris-txt">
          <summary className="cursor-pointer font-semibold text-marca">Ver qué falta</summary>
          <ul className="mt-1.5 list-disc pl-5">{comp.faltan.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}

      {visita !== 'v2' && negativos.length > 0 && (
        <Alerta tono="error">
          La verificación en sitio dice que {negativos.join(', ')}: la Visita 1 no se cierra como exitosa. Para cerrarla, carga el Acta de No Aceptación, o el Acta de Retiro con su Acta de Novedades.
        </Alerta>
      )}

      {visita !== 'v1' && datos.revision.estado === 'devuelto' && datos.revision.observacion && (
        <Alerta tono="error">
          <b>Devuelto por la coordinación{datos.revision.revisado_por ? ` (${datos.revision.revisado_por})` : ''}:</b> {datos.revision.observacion}
        </Alerta>
      )}

      {nombresSucias.length > 0 && (
        <Alerta tono="aviso">Tienes cambios sin guardar en: {nombresSucias.join(', ')}.</Alerta>
      )}

      {visita !== 'v1' && (c.nivel_formalizacion || c.utilidad_mensual !== null) && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Dato etiqueta="Nivel de formalización" valor={NIVELES_FORMALIZACION[c.nivel_formalizacion] || '—'} />
          <Dato etiqueta="Utilidad mensual" valor={pesos(c.utilidad_mensual)} />
          <Dato etiqueta="Margen" valor={c.margen_porcentaje === null ? '—' : `${c.margen_porcentaje.toLocaleString('es-CO')} %`} />
        </div>
      )}

      {visita !== 'v1' && (
        <p className="text-[13px] text-gris-txt">
          Plan de negocio:{' '}
          {datos.plan_negocio
            ? (datos.plan_negocio.url
              ? <a className="font-semibold text-marca underline" href={urlArchivo(datos.plan_negocio.url)} target="_blank" rel="noopener noreferrer">{datos.plan_negocio.archivo}</a>
              : <b className="text-marca">{datos.plan_negocio.archivo}</b>)
            : 'se carga en la Visita 2 (formato «Plan de negocios»).'}
          {' · '}Indicadores iniciales INNPULSA: <b className="text-marca">{datos.innpulsa_cargado ? 'cargados' : 'pendientes'}</b>
        </p>
      )}

      {secciones.map((s) => (
        <SeccionEditable
          key={`${s.clave}:${guardados[s.clave] || 0}:${JSON.stringify(datos.secciones[s.clave])}`}
          enfocar={ultima === s.clave}
          seccion={s}
          guardado={datos.secciones[s.clave]}
          sugerido={datos.sugeridos?.[s.clave]}
          editable={datos.editables.includes(s.clave)}
          abierta={Boolean(abiertas[s.clave])}
          onAlternar={() => setAbiertas((a) => ({ ...a, [s.clave]: !a[s.clave] }))}
          ocupado={ocupado}
          faltantes={faltantes}
          onSucio={(v) => setSucias((x) => (x[s.clave] === v ? x : { ...x, [s.clave]: v }))}
          onGuardar={async (f) => {
            if (await accion(() => guardarSeccion(idUnico, s.clave, aEnvio(s, f)), `${s.titulo}: guardado.`)) {
              setGuardados((g) => ({ ...g, [s.clave]: (g[s.clave] || 0) + 1 }));
              setUltima(s.clave);
            }
          }}
        />
      ))}

      {conRevision && (
        <PanelRevision
          datos={datos} ocupado={ocupado} completo={datos.completitud.v2.completo}
          onRevisar={() => accion(() => revisar(idUnico, 'revisado'), 'Diagnóstico marcado como revisado.')}
          onDevolver={(obs) => accion(() => revisar(idUnico, 'devuelto', obs), 'Diagnóstico devuelto al gestor.')}
          onReenviar={() => accion(() => reenviar(idUnico), 'Diagnóstico reenviado a revisión.')}
        />
      )}
    </div>
  );
}
