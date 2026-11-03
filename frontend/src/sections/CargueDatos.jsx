// Sección de cargue de datos, exclusiva de un tipo de cuenta y de quien tiene acceso total. Hay tres cargues
// sobre los expedientes por etapas: la documentación completa, con la base maestra y el archivo de auditoría;
// el RIT, con cédula y nombre; y solo el proceso de subsanación. Los archivos se leen en el navegador y viajan
// por lotes.
import { useRef, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso } from '../components/UI';
import { leerFilasExcel, leerColumnasExcel } from '../lib/leerExcel';
import { COLUMNAS_MASTER, COLUMNAS_AUDITORIA, HOJA_MASTER, HOJA_AUDITORIA, PLANTILLAS }
  from '../lib/cargueDocs';
import { COLUMNAS_RIT, HOJA_RIT, prepararFilasRit, textoErrorRit } from '../lib/cargueRit';
import { fetchApi } from '../lib/api';
import { esAdmin } from '../lib/permisos';
import { CARGUE_URL, CARGUE_DOCUMENTOS_URL, CARGUE_RIT_URL, SIN_DATOS } from '../lib/config';
import { apiGeneral } from '../inventario/lib/api';
import HistorialMaster from './cargue/HistorialMaster';

const COLUMNA_ID = 'ID_unico';
const COLUMNA_SUBSANACION = 'proceso_subsanacion';
const LOTE_DOCS = 250;
// Tamaño de cada lote del proceso de subsanación, de unos 850 KB por petición.
const LOTE_SUBS = 500;
const LOTE_RIT = 250;

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
const idNum = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Sube la base maestra al histórico antes del cargue y devuelve el id que viaja en cada lote; si no se puede
// guardar, el cargue no arranca, porque toda actualización debe quedar en el histórico.
async function abrirHistorial(archivo, origen, filas) {
  const cuerpo = new FormData();
  cuerpo.append('origen', origen);
  cuerpo.append('filas', String(filas));
  cuerpo.append('archivo', archivo);
  try {
    return (await apiGeneral.post('/cargue/historial', cuerpo)).id;
  } catch (err) {
    const e = new Error(`No se pudo guardar la BASE MASTER en el histórico: ${err.message} No se actualizó nada.`);
    e.historial = true;
    throw e;
  }
}

// Muestra las pestañas de los tres cargues.
export default function CargueDatos({ session }) {
  return (
    <>
      <EncabezadoSeccion
        titulo="Cargue de datos"
        subtitulo={session?.nombre || 'Coordinador de datos'}
      />
      <CargueDocumentacion session={session} />
      <CargueSubsanacion session={session} />
      {esAdmin(session) && <HistorialMaster session={session} />}
    </>
  );
}

// Cargue de la documentación completa a partir de los dos Excel.
function CargueDocumentacion({ session }) {
  const [master, setMaster] = useState(null);
  const [auditoria, setAuditoria] = useState(null);
  const [leyendo, setLeyendo] = useState('');
  const [progreso, setProgreso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const rit = useCargueRit(session);
  const ocupado = !!leyendo || enviando || rit.ocupado;
  const listo = master && auditoria;

  async function leer(cual, file) {
    if (!file || ocupado) return;
    setError('');
    setResultado(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Los dos archivos deben ser .xlsx.');
      return;
    }
    setLeyendo(cual);
    setProgreso(0);
    try {
      const esMaster = cual === 'master';
      const r = await leerFilasExcel(file, {
        hojas: [esMaster ? HOJA_MASTER : HOJA_AUDITORIA],
        columnas: esMaster ? COLUMNAS_MASTER : COLUMNAS_AUDITORIA,
        alAvanzar: setProgreso,
      });
      const filas = r.filas.filter((f) => idNum(f.id_unico));
      const datos = { nombre: file.name, archivo: file, hoja: r.hoja, filas, faltantes: r.faltantes };
      if (esMaster) setMaster(datos); else setAuditoria(datos);
    } catch (err) {
      console.error('[cargue-docs] Lectura', err);
      setError(err.message || 'No se pudo leer el archivo.');
    } finally {
      setLeyendo('');
    }
  }

  function armarFilas() {
    const porId = new Map();
    for (const f of auditoria.filas) porId.set(idNum(f.id_unico), f);
    const filas = [];
    const sinAuditoria = [];
    const vistos = new Set();
    for (const f of master.filas) {
      const id = idNum(f.id_unico);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const a = porId.get(id) || null;
      if (!a) sinAuditoria.push(id);
      filas.push({ m: f, a });
    }
    const huerfanas = [...porId.keys()].filter((id) => !vistos.has(id));
    return { filas, sinAuditoria, huerfanas };
  }

  async function aplicar() {
    if (!listo || ocupado) return;
    const { filas, sinAuditoria, huerfanas } = armarFilas();
    setError('');
    setEnviando(true);
    setProgreso(0);
    const acum = { guardados: 0, fallidos: [], errores: [], sinAuditoria, huerfanas };
    try {
      const historial = await abrirHistorial(master.archivo, 'documentacion', filas.length);
      for (let i = 0; i < filas.length; i += LOTE_DOCS) {
        const resp = await fetchApi(CARGUE_DOCUMENTOS_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { filas: filas.slice(i, i + LOTE_DOCS), historial },
        });
        acum.guardados += resp.guardados || 0;
        acum.fallidos.push(...(resp.fallidos || []));
        for (const e of resp.errores || []) if (acum.errores.length < 3) acum.errores.push(e);
        setProgreso(Math.min(1, (i + LOTE_DOCS) / filas.length));
        setResultado({ ...acum, parcial: true });
      }
      setResultado({ ...acum, parcial: false });
    } catch (err) {
      console.error('[cargue-docs] Envío', err, err?.detail);
      if (err.historial) {
        setError(err.message);
        return;
      }
      const algoSubio = acum.guardados || acum.fallidos.length;
      const motivo = err?.detail ? ` ${err.detail}` : '';
      setResultado(algoSubio ? { ...acum, parcial: true } : null);
      setError(algoSubio
        ? `${err.publicMsg || 'Error'}: el cargue se detuvo a mitad. Lo que alcanzó a ` +
          `subir quedó guardado; puedes volver a aplicarlo completo sin problema.${motivo}`
        : `${err.publicMsg || 'Error'}: no se guardó nada.${motivo}`);
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setMaster(null);
    setAuditoria(null);
    setResultado(null);
    setError('');
    setProgreso(0);
  }

  const cruzadas = listo ? armarFilas() : null;

  return (
    <Card className="mb-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-marino">Documentación de las U.P.</h3>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gris">
            Carga los <b>dos</b> archivos: <b>BASE MASTER EP</b> (hoja {HOJA_MASTER}) y{' '}
            <b>auditoria_global_archivos</b> (hoja {HOJA_AUDITORIA}). Se cruzan por{' '}
            {COLUMNA_ID} y se rehace el expediente de cada unidad productiva: RIT,
            archivos y checks de cada etapa, cotizaciones, compra, entrega, visita 3,
            evento y los estados de la ruta, incluido el proceso de subsanación. No se
            toca nada más. El tercer recuadro es aparte: carga el <b>RIT</b> con cédula y
            nombre y marca el RIT de las U.P. que existan en la base.
          </p>
        </div>
        {(master || auditoria) && !ocupado && (
          <Btn variant="secondary" onClick={reiniciar}>Empezar de nuevo</Btn>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div>
          <Soltar
            titulo="BASE MASTER EP"
            detalle={`hoja ${HOJA_MASTER}`}
            datos={master}
            leyendo={leyendo === 'master'}
            progreso={progreso}
            deshabilitado={ocupado}
            onArchivo={(f) => leer('master', f)}
          />
          <EnlacePlantilla plantilla={PLANTILLAS.master} />
        </div>
        <div>
          <Soltar
            titulo="auditoria_global_archivos"
            detalle={`hoja ${HOJA_AUDITORIA}`}
            datos={auditoria}
            leyendo={leyendo === 'auditoria'}
            progreso={progreso}
            deshabilitado={ocupado}
            onArchivo={(f) => leer('auditoria', f)}
          />
          <EnlacePlantilla plantilla={PLANTILLAS.auditoria} />
        </div>
        <div>
          <Soltar
            titulo="RIT"
            detalle={`hoja ${HOJA_RIT} · cédula y nombre`}
            datos={rit.datos}
            leyendo={rit.leyendo}
            progreso={rit.progreso}
            deshabilitado={ocupado}
            onArchivo={rit.leer}
          />
          <EnlacePlantilla plantilla={PLANTILLAS.rit} />
        </div>
      </div>

      <PanelRit rit={rit} />

      {error && <Aviso tono="bad" className="mt-4 mb-0">{error}</Aviso>}

      {auditoria?.faltantes?.length > 0 && (
        <Aviso tono="warn" className="mt-4 mb-0">
          La hoja {HOJA_AUDITORIA} no trae estas columnas opcionales; esa parte del
          documento queda vacía: {auditoria.faltantes.join(', ')}.
        </Aviso>
      )}

      {listo && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Dato label="U.P. en el master" valor={fmt(master.filas.length)} />
            <Dato label="Filas de auditoría" valor={fmt(auditoria.filas.length)} />
            <Dato label="Sin fila de auditoría" valor={fmt(cruzadas.sinAuditoria.length)} />
            <Dato label="Auditoría sin U.P." valor={fmt(cruzadas.huerfanas.length)} />
          </div>

          {cruzadas.sinAuditoria.length > 0 && (
            <p className="mt-2 text-xs text-gris">
              Las U.P. sin fila de auditoría se guardan igual, con las etapas vacías.
            </p>
          )}

          {!enviando && (
            <Btn className="mt-4" onClick={aplicar}>
              Actualizar {fmt(cruzadas.filas.length)} documentos
            </Btn>
          )}
          {enviando && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-texto">
                Actualizando expedientes… {Math.round(progreso * 100)} %
              </p>
              <Barra valor={progreso} />
              <p className="mt-2 text-xs text-gris">
                No cierres la pestaña hasta que termine.
              </p>
            </div>
          )}
        </div>
      )}

      {resultado && (
        <Resultado
          titulo={resultado.parcial ? 'Cargue en curso' : 'Cargue terminado'}
          fin={!resultado.parcial}
          datos={[
            ['Documentos guardados', resultado.guardados],
            ['Sin fila de auditoría', resultado.sinAuditoria.length],
            ['Auditoría sin U.P.', resultado.huerfanas.length],
            ['Con error', resultado.fallidos.length],
          ]}
          fallidos={resultado.fallidos}
          errores={resultado.errores}
        />
      )}
    </Card>
  );
}

// Hook con el estado y las acciones del cargue del RIT.
function useCargueRit(session) {
  const [datos, setDatos] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const ocupado = leyendo || enviando;

  async function leer(file) {
    if (!file || ocupado) return;
    setError('');
    setResultado(null);
    setDatos(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError('El archivo del RIT debe ser .xlsx.');
      return;
    }
    setLeyendo(true);
    setProgreso(0);
    try {
      const r = await leerFilasExcel(file, {
        hojas: [HOJA_RIT], columnas: COLUMNAS_RIT, conNumeroFila: true, alAvanzar: setProgreso,
      });
      if (!r.filas.length) {
        setError(`La hoja "${r.hoja}" no tiene filas con datos debajo del encabezado (cedula, nombre).`);
        return;
      }
      const { filas, errores } = prepararFilasRit(r.filas);
      setDatos({ nombre: file.name, hoja: r.hoja, filas, previos: errores });
    } catch (err) {
      console.error('[cargue-rit] Lectura', err);
      setError(err.message || 'No se pudo leer el archivo.');
    } finally {
      setLeyendo(false);
    }
  }

  async function aplicar() {
    if (!datos || ocupado) return;
    const { filas } = datos;
    setError('');
    setEnviando(true);
    setProgreso(0);
    const acum = { actualizados: 0, sin_cambios: 0, errores: [...datos.previos], parcial: true };
    let envio = false;
    try {
      for (let i = 0; i < filas.length; i += LOTE_RIT) {
        const resp = await fetchApi(CARGUE_RIT_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { filas: filas.slice(i, i + LOTE_RIT) },
        });
        envio = true;
        acum.actualizados += resp.actualizados || 0;
        acum.sin_cambios += resp.sin_cambios || 0;
        acum.errores.push(...(resp.errores || []));
        setProgreso(Math.min(1, (i + LOTE_RIT) / filas.length));
        setResultado({ ...acum });
      }
      setResultado({ ...acum, parcial: false });
    } catch (err) {
      console.error('[cargue-rit] Envío', err, err?.detail);
      const motivo = err?.detail ? ` ${err.detail}` : '';
      setResultado(envio ? { ...acum } : null);
      setError(envio
        ? `${err.publicMsg || 'Error'}: el cargue del RIT se detuvo a mitad. Lo que alcanzó a ` +
          `subir quedó guardado; puedes volver a aplicarlo completo sin problema.${motivo}`
        : `${err.publicMsg || 'Error'}: no se actualizó ningún RIT.${motivo}`);
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setDatos(null);
    setResultado(null);
    setError('');
    setProgreso(0);
  }

  return { datos, leyendo, progreso, enviando, resultado, error, ocupado, leer, aplicar, reiniciar };
}

// Muestra el botón para aplicar, el avance y los errores con su fila.
function PanelRit({ rit }) {
  const { datos, resultado, error, enviando, progreso, ocupado } = rit;
  if (!datos && !resultado && !error) return null;
  const errores = resultado?.errores || [];

  return (
    <div className="mt-4 rounded-lg border border-borde p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-marino">RIT</p>
          {datos && <p className="mt-0.5 text-xs text-gris">{datos.nombre} · hoja {datos.hoja}</p>}
        </div>
        {(datos || resultado) && !ocupado && (
          <Btn variant="secondary" onClick={rit.reiniciar}>Cargar otro archivo</Btn>
        )}
      </div>

      {error && <Aviso tono="bad" className="mt-3 mb-0">{error}</Aviso>}

      {datos && !resultado && !enviando && (
        <div className="mt-3">
          <p className="text-xs text-gris">
            {fmt(datos.filas.length)} cédulas por empalmar con la base
            {datos.previos.length > 0 && ` · ${fmt(datos.previos.length)} repetidas en el archivo (se ignoran)`}.
          </p>
          <Btn className="mt-3" onClick={rit.aplicar} disabled={!datos.filas.length}>
            Actualizar RIT de {fmt(datos.filas.length)} cédulas
          </Btn>
        </div>
      )}

      {enviando && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-texto">Actualizando RIT… {Math.round(progreso * 100)} %</p>
          <Barra valor={progreso} />
          <p className="mt-2 text-xs text-gris">No cierres la pestaña hasta que termine.</p>
        </div>
      )}

      {resultado && (
        <div className="mt-3">
          {!resultado.parcial && (
            <Aviso tono={errores.length ? 'warn' : 'ok'} className="mb-3">
              {errores.length
                ? `Cargue del RIT terminado con ${fmt(errores.length)} fila(s) con error: no se actualizaron. Las demás sí.`
                : 'Cargue del RIT terminado: todas las cédulas empalmaron con la base.'}
            </Aviso>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Dato label="RIT actualizados" valor={fmt(resultado.actualizados)} />
            <Dato label="Ya tenían RIT" valor={fmt(resultado.sin_cambios)} />
            <Dato label="Filas con error" valor={fmt(errores.length)} />
          </div>
          {errores.length > 0 && <TablaErroresRit errores={errores} />}
        </div>
      )}
    </div>
  );
}

// Muestra la tabla de errores del cargue del RIT.
function TablaErroresRit({ errores }) {
  const ordenados = [...errores].sort((a, b) => (a.fila ?? 0) - (b.fila ?? 0));
  return (
    <div className="mt-3">
      <p className="text-xs text-rojo">
        Corrige estas filas en el Excel y vuelve a cargarlo (lo que ya quedó bien no se toca).
      </p>
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-borde">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg text-left text-[10px] uppercase tracking-wide text-gris">
            <tr>
              <th className="px-3 py-2">Fila</th>
              <th className="px-3 py-2">Columna</th>
              <th className="px-3 py-2">Cédula</th>
              <th className="px-3 py-2">Qué pasó</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((e, i) => (
              <tr key={i} className="border-t border-borde align-top" title={textoErrorRit(e)}>
                <td className="px-3 py-2 font-semibold tabular-nums">{e.fila ?? '?'}</td>
                <td className="px-3 py-2">{e.columna}</td>
                <td className="px-3 py-2 tabular-nums">{e.cedula || '—'}</td>
                <td className="px-3 py-2">{e.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Cargue solo del proceso de subsanación, con la base maestra sola.
function CargueSubsanacion({ session }) {
  const [archivo, setArchivo] = useState(null);
  const [lectura, setLectura] = useState(null);
  const [fase, setFase] = useState('espera');
  const [progreso, setProgreso] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const ocupado = fase === 'leyendo' || fase === 'subiendo';

  async function tomarArchivo(file) {
    if (!file || ocupado) return;
    setError('');
    setResultado(null);
    setLectura(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError('El archivo debe ser .xlsx.');
      return;
    }
    setArchivo(file);
    setFase('leyendo');
    setProgreso(0);
    try {
      const r = await leerColumnasExcel(file, {
        hojas: [HOJA_MASTER],
        columnas: [COLUMNA_ID, COLUMNA_SUBSANACION],
        alAvanzar: setProgreso,
      });
      setLectura(resumirSubsanacion(r));
      setFase('listo');
    } catch (err) {
      console.error('[cargue] Lectura del Excel', err);
      setError(err.message || 'No se pudo leer el archivo.');
      setFase('espera');
    }
  }

  async function aplicar() {
    if (!lectura || ocupado) return;
    setError('');
    setFase('subiendo');
    setProgreso(0);
    const acum = { actualizados: 0, sin_cambios: 0, no_encontrados: [], fallidos: [],
                   invalidos: 0, errores: [] };
    const filas = lectura.filas;
    try {
      const historial = await abrirHistorial(archivo, 'subsanacion', filas.length);
      for (let i = 0; i < filas.length; i += LOTE_SUBS) {
        const resp = await fetchApi(CARGUE_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { campo: COLUMNA_SUBSANACION, filas: filas.slice(i, i + LOTE_SUBS), historial },
        });
        acum.actualizados += resp.actualizados || 0;
        acum.sin_cambios += resp.sin_cambios || 0;
        acum.invalidos += resp.invalidos || 0;
        acum.no_encontrados.push(...(resp.no_encontrados || []));
        acum.fallidos.push(...(resp.fallidos || []));
        for (const e of resp.errores || []) if (acum.errores.length < 3) acum.errores.push(e);
        setProgreso(Math.min(1, (i + LOTE_SUBS) / filas.length));
      }
      setResultado(acum);
      setFase('hecho');
    } catch (err) {
      console.error('[cargue] Envío', err, err?.detail);
      if (err.historial) {
        setError(err.message);
        setFase('listo');
        return;
      }
      const algoSubio = acum.actualizados || acum.sin_cambios
        || acum.no_encontrados.length || acum.fallidos.length || acum.invalidos;
      const motivo = err?.detail ? ` ${err.detail}` : '';
      setResultado(algoSubio ? acum : null);
      setError(algoSubio
        ? `${err.publicMsg || 'Error'}: el cargue se detuvo a mitad. ` +
          'Lo que alcanzó a subir quedó guardado; puedes volver a aplicar sin problema ' +
          `(lo que ya esté igual no se toca).${motivo}`
        : `${err.publicMsg || 'Error'}: no se guardó nada.${motivo}`,
      );
      setFase('listo');
    }
  }

  function reiniciar() {
    setArchivo(null);
    setLectura(null);
    setResultado(null);
    setError('');
    setFase('espera');
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-marino">Solo proceso de subsanación</h3>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gris">
            Atajo para cuando únicamente cambió esa columna: con la BASE MASTER sola se
            actualiza <code className="text-xs">subsanaciones.proceso_subsanacion</code> por{' '}
            {COLUMNA_ID}, sin rehacer el resto del documento. Las celdas vacías quedan
            como “{SIN_DATOS}”.
          </p>
        </div>
        {fase !== 'espera' && !ocupado && (
          <Btn variant="secondary" onClick={reiniciar}>Cargar otro archivo</Btn>
        )}
      </div>

      {(fase === 'espera' || fase === 'leyendo') && (
        <div className="mt-4">
          <Soltar
            titulo="BASE MASTER EP"
            detalle={`hoja ${HOJA_MASTER} · columna ${COLUMNA_SUBSANACION}`}
            datos={lectura ? { nombre: archivo?.name, filas: lectura.filas } : null}
            leyendo={fase === 'leyendo'}
            progreso={progreso}
            deshabilitado={ocupado}
            onArchivo={tomarArchivo}
          />
          <EnlacePlantilla plantilla={PLANTILLAS.subsanacion} />
        </div>
      )}

      {error && <Aviso tono="bad" className="mt-4 mb-0">{error}</Aviso>}

      {lectura && fase !== 'espera' && (
        <div className="mt-4">
          <p className="text-xs text-gris">{archivo?.name} · hoja {lectura.hoja}</p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-borde">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-[10px] uppercase tracking-wide text-gris">
                <tr>
                  <th className="px-3 py-2">Valor que se guardará</th>
                  <th className="px-3 py-2 text-right">U.P.</th>
                </tr>
              </thead>
              <tbody>
                {lectura.conteo.map(([valor, n]) => (
                  <tr key={valor} className="border-t border-borde">
                    <td className={`px-3 py-2 ${valor === SIN_DATOS ? 'italic text-gris' : ''}`}>{valor}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fase === 'listo' && (
            <Btn className="mt-4" onClick={aplicar} disabled={!lectura.filas.length}>
              Actualizar {fmt(lectura.filas.length)} unidades
            </Btn>
          )}
          {fase === 'subiendo' && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-texto">Actualizando… {Math.round(progreso * 100)} %</p>
              <Barra valor={progreso} />
            </div>
          )}
        </div>
      )}

      {resultado && (
        <Resultado
          titulo="Cargue terminado"
          fin={fase === 'hecho'}
          datos={[
            ['Actualizadas', resultado.actualizados],
            ['Ya estaban iguales', resultado.sin_cambios],
            ['Sin expediente en la base', resultado.no_encontrados.length],
            ['Con error', resultado.fallidos.length],
          ]}
          fallidos={resultado.fallidos}
          errores={resultado.errores}
          extra={resultado.no_encontrados.length > 0 && (
            <details className="mt-3 text-xs text-gris">
              <summary className="cursor-pointer">
                {COLUMNA_ID} sin expediente en la base
              </summary>
              <p className="mt-2 break-words leading-relaxed">{resultado.no_encontrados.join(', ')}</p>
            </details>
          )}
        />
      )}
    </Card>
  );
}

// Resume los cambios de la subsanación para mostrarlos.
function resumirSubsanacion(r) {
  const porId = new Map();
  for (const f of r.filas) {
    const id = idNum(f[COLUMNA_ID]);
    if (id) porId.set(id, f[COLUMNA_SUBSANACION] || '');
  }
  const filas = [...porId].map(([id_unico, valor]) => ({ id_unico, valor }));
  const conteo = new Map();
  for (const { valor } of filas) {
    const v = valor || SIN_DATOS;
    conteo.set(v, (conteo.get(v) || 0) + 1);
  }
  return {
    hoja: r.hoja,
    filas,
    conteo: [...conteo].sort((a, b) => b[1] - a[1]),
  };
}

// Zona para soltar o elegir un archivo.
function Soltar({ titulo, detalle, datos, leyendo, progreso, deshabilitado, onArchivo }) {
  const inputRef = useRef(null);
  const [encima, setEncima] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !deshabilitado && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); onArchivo(e.dataTransfer.files?.[0]); }}
      className={`cursor-pointer rounded-card border-2 border-dashed px-4 py-7 text-center transition ${
        encima ? 'border-acento bg-[rgba(245,164,136,0.08)]'
               : datos ? 'border-[#38a169] bg-bg' : 'border-borde bg-bg hover:border-acento'
      }`}
    >
      <p className="text-sm font-semibold text-texto">
        {datos ? '✓ ' : ''}{titulo}
      </p>
      <p className="mt-1 text-[11px] text-gris">{detalle}</p>

      {leyendo ? (
        <>
          <p className="mt-2 text-xs text-texto">Leyendo…</p>
          <Barra valor={progreso} />
        </>
      ) : datos ? (
        <p className="mt-2 break-words text-xs text-gris">
          {datos.nombre} · {fmt(datos.filas.length)} filas
        </p>
      ) : (
        <p className="mt-2 text-xs text-gris">Suelta el .xlsx o haz clic para elegirlo</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => { onArchivo(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

// Enlace de descarga de la plantilla vacía, que el navegador baja directo desde public/plantillas.
function EnlacePlantilla({ plantilla }) {
  return (
    <a
      href={plantilla.href}
      download={plantilla.archivo}
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-marino underline-offset-2 hover:underline"
    >
      ↓ Descargar plantilla
    </a>
  );
}

// Muestra el resultado de un cargue.
function Resultado({ titulo, fin, datos, fallidos = [], errores = [], extra }) {
  return (
    <div className="mt-4">
      {fin && (
        <Aviso tono={fallidos.length ? 'warn' : 'ok'} className="mb-3">{titulo}</Aviso>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {datos.map(([label, valor]) => (
          <Dato key={label} label={label} valor={fmt(valor)} />
        ))}
      </div>
      {extra}
      {fallidos.length > 0 && (
        <div className="mt-3 text-xs">
          <p className="text-rojo">
            {fmt(fallidos.length)} no se pudieron guardar. Vuelve a aplicar el cargue para
            reintentarlas.
          </p>
          {errores.length > 0 && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-bg p-3 text-[11px] text-texto">
              {errores.join('\n')}
            </pre>
          )}
          <details className="mt-2 text-gris">
            <summary className="cursor-pointer">Ver {COLUMNA_ID} con error</summary>
            <p className="mt-2 break-words leading-relaxed">{fallidos.join(', ')}</p>
          </details>
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">{label}</div>
      <div className="text-lg font-bold tabular-nums text-marino">{valor}</div>
    </div>
  );
}

function Barra({ valor }) {
  return (
    <div className="mx-auto mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-borde">
      <div className="h-full rounded-full bg-acento transition-all"
           style={{ width: `${Math.round(valor * 100)}%` }} />
    </div>
  );
}
