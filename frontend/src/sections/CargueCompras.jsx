// Sección de cargue de compras, exclusiva de un tipo de cuenta. Carga el Excel de entregas, cuyas hojas de
// aprobados, compras, cronograma, rutas y entregas arman la lista de compras y el cronograma de cada unidad. El
// archivo se lee en el navegador y solo viajan por lotes los documentos armados.
import { useRef, useState } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso } from '../components/UI';
import { leerFilasExcel } from '../lib/leerExcel';
import {
  HOJAS_COMPRAS, COLUMNAS_COMPRAS, HOJAS_OBLIGATORIAS, armarDocumentosCompras,
  armarEntregas, columnasClaveFaltantes,
} from '../lib/cargueCompras';
import { fetchApi } from '../lib/api';
import { CARGUE_COMPRAS_URL, CARGUE_ENTREGAS_URL } from '../lib/config';

const LOTE = 40;
// Tamaño de cada lote de entregas, de unos 600 KB por petición, porque los ítems traen la ficha técnica.
const LOTE_ENTREGAS = 300;

const fmt = (n) => Number(n || 0).toLocaleString('es-CO');

// Descripción de lo que aporta cada hoja del Excel.
const DESCRIPCION_HOJAS = {
  aprobado: 'Ítems que solicitó cada U.P. (columnas R–AG)',
  compras: 'Complementa los ítems de APROBADO (opcional)',
  cronograma: 'Programación de la entrega (interventoría)',
  rutas: 'Rutas con los gestores',
  entregas: 'Fechas vigentes y estado de la entrega',
};

// Muestra las zonas para soltar el archivo, valida las hojas, envía los lotes y muestra el avance y el
// resultado.
export default function CargueCompras({ session }) {
  const [archivo, setArchivo] = useState(null);
  const [leyendo, setLeyendo] = useState('');
  const [progreso, setProgreso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const ocupado = !!leyendo || enviando;

  async function leer(file) {
    if (!file || ocupado) return;
    setError('');
    setResultado(null);
    setArchivo(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError('El archivo debe ser .xlsx (MASTER ENTREGAS).');
      return;
    }
    const hojas = {};
    const omitidas = [];
    try {
      for (const k of Object.keys(HOJAS_COMPRAS)) {
        setLeyendo(k);
        setProgreso(0);
        try {
          const r = await leerFilasExcel(file, {
            hojas: [HOJAS_COMPRAS[k]],
            columnas: COLUMNAS_COMPRAS[k],
            alAvanzar: setProgreso,
          });
          hojas[k] = { hoja: r.hoja, filas: r.filas, faltantes: r.faltantes };
        } catch (err) {
          if (HOJAS_OBLIGATORIAS.includes(k)) throw err;
          console.warn('[cargue-compras] Hoja omitida', k, err);
          omitidas.push(HOJAS_COMPRAS[k]);
        }
      }
      const filas = Object.fromEntries(Object.entries(hojas).map(([k, v]) => [k, v.filas]));
      const armado = armarDocumentosCompras(filas);
      const faltanClave = columnasClaveFaltantes(
        Object.fromEntries(Object.entries(hojas).map(([k, v]) => [k, v.faltantes || []])),
      );
      setArchivo({
        nombre: file.name, hojas, omitidas, ...armado, entregas: armarEntregas(filas), faltanClave,
      });
    } catch (err) {
      console.error('[cargue-compras] Lectura', err);
      setError(err.message || 'No se pudo leer el archivo.');
    } finally {
      setLeyendo('');
    }
  }

  async function aplicar() {
    if (!archivo || ocupado || archivo.faltanClave?.length) return;
    const { docs } = archivo;
    const entregas = archivo.entregas || [];
    const total = docs.length + entregas.length;
    setError('');
    setEnviando(true);
    setProgreso(0);
    const acum = {
      guardados: 0, nuevos: 0, fallidos: [], errores: [], retiradas: 0,
      entregas: 0, entregasSinNodo: [], entregasFallidas: [],
    };
    try {
      for (let i = 0; i < docs.length; i += LOTE) {
        const resp = await fetchApi(CARGUE_COMPRAS_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { archivo: archivo.nombre, docs: docs.slice(i, i + LOTE) },
        });
        acum.guardados += resp.guardados || 0;
        acum.nuevos += resp.nuevos || 0;
        acum.fallidos.push(...(resp.fallidos || []));
        for (const e of resp.errores || []) if (acum.errores.length < 3) acum.errores.push(e);
        setProgreso(Math.min(1, (i + LOTE) / total));
        setResultado({ ...acum, parcial: true });
      }
      if (docs.length) {
        const resp = await fetchApi(CARGUE_COMPRAS_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { archivo: archivo.nombre, vigentes: docs.map((d) => d.id) },
        });
        acum.retiradas = resp.retiradas || 0;
      }
      for (let i = 0; i < entregas.length; i += LOTE_ENTREGAS) {
        const resp = await fetchApi(CARGUE_ENTREGAS_URL, {
          token: session?.token,
          metodo: 'POST',
          cuerpo: { entregas: entregas.slice(i, i + LOTE_ENTREGAS) },
        });
        acum.entregas += (resp.guardadas || 0) + (resp.sin_cambios || 0);
        acum.entregasSinNodo.push(...(resp.sin_nodo || []));
        acum.entregasFallidas.push(...(resp.fallidas || []));
        for (const e of resp.errores || []) if (acum.errores.length < 3) acum.errores.push(e);
        setProgreso(Math.min(1, (docs.length + i + LOTE_ENTREGAS) / total));
        setResultado({ ...acum, parcial: true });
      }
      setResultado({ ...acum, parcial: false });
    } catch (err) {
      console.error('[cargue-compras] Envío', err, err?.detail);
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
    setArchivo(null);
    setResultado(null);
    setError('');
    setProgreso(0);
  }

  const info = archivo?.info;

  return (
    <>
      <EncabezadoSeccion
        titulo="Cargue de compras"
        subtitulo={session?.nombre || 'Profesional alianzas y conexión de mercados'}
      />

      <Card className="mb-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-marino">MASTER ENTREGAS</h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-gris">
              Carga el Excel <b>MASTER ENTREGAS</b>. Las unidades productivas con plan de compras son
              las de la hoja <b>{HOJAS_COMPRAS.aprobado}</b> (una por cédula, columna G); de ahí salen
              sus ítems, y se marcan como comprados los que tienen <b>1</b> en la columna AI{' '}
              <b>COMPRADO</b>. Lo que solo está en {HOJAS_COMPRAS.compras} no entra.
              El cronograma, las rutas y el estado de las entregas actualizan la Lista de compras y
              el Cronograma de entregas, donde cada gestor confirma teléfono, dirección y hora. El
              Excel manda sobre «comprado» y sobre la fecha programada; lo que confirman los
              gestores se conserva.
            </p>
          </div>
          {archivo && !ocupado && (
            <Btn variant="secondary" onClick={reiniciar}>Empezar de nuevo</Btn>
          )}
        </div>

        <div className="mt-4">
          <Soltar
            archivo={archivo}
            leyendo={leyendo}
            progreso={progreso}
            deshabilitado={ocupado}
            onArchivo={leer}
          />
        </div>

        {error && <Aviso tono="bad" className="mt-4 mb-0">{error}</Aviso>}

        {archivo?.faltanClave?.length > 0 && (
          <Aviso tono="bad" className="mt-4 mb-0">
            No se puede cargar: al Excel le faltan estas columnas o les cambiaron el nombre. Sin
            ellas se borrarían las fechas del cronograma. Corrige el Excel y vuelve a cargarlo:{' '}
            <b>{archivo.faltanClave.join(' · ')}</b>.
          </Aviso>
        )}

        {archivo?.omitidas?.length > 0 && (
          <Aviso tono="warn" className="mt-4 mb-0">
            No se encontraron estas hojas, así que esa información no se actualiza (se conserva la
            anterior): {archivo.omitidas.join(', ')}.
          </Aviso>
        )}

        {archivo && (
          <div className="mt-4">
            <div className="overflow-hidden rounded-lg border border-borde">
              {Object.keys(HOJAS_COMPRAS).map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-borde px-3.5 py-2 text-[12px] last:border-0">
                  <span className="min-w-0">
                    <b className="text-texto">{HOJAS_COMPRAS[k]}</b>
                    <span className="text-gris"> · {DESCRIPCION_HOJAS[k]}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-gris">
                    {archivo.hojas[k] ? `${fmt(archivo.hojas[k].filas.length)} filas` : 'No encontrada'}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Dato label="U.P. con plan (cédulas)" valor={fmt(info.cedulas)} />
              <Dato label="Ítems aprobados" valor={fmt(info.items)} />
              <Dato label="Ítems comprados" valor={fmt(info.itemsComprados)} />
              <Dato label="U.P. con compras" valor={fmt(info.upConCompras)} />
            </div>
            <p className="mt-2 text-xs text-gris">
              {info.cedulas !== archivo.docs.length && (
                <>Ojo: hay {fmt(archivo.docs.length)} ID_unico pero {fmt(info.cedulas)} cédulas distintas en APROBADO. </>
              )}
              {info.soloCompras.length > 0 && (
                <>{fmt(info.soloCompras.length)} U.P. de COMPRAS no están en APROBADO y no entran (si ya estaban en la lista, dejan de mostrarse). </>
              )}
              {info.itemsSoloCompras > 0 && (
                <>{fmt(info.itemsSoloCompras)} ítems de COMPRAS no tienen par en APROBADO y no entran. </>
              )}
              Con cronograma: {fmt(info.conCronograma)} · con ruta: {fmt(info.conRuta)} · con
              registro de entrega: {fmt(info.conEntrega)}.
            </p>
            {archivo.entregas ? (
              <p className="mt-1 text-xs text-gris">
                Cronograma de entregas: se actualizan <b className="text-texto">{fmt(archivo.entregas.length)}</b>{' '}
                U.P. (todas las del CRONOGRAMA, también las que aún no están en APROBADO).
              </p>
            ) : (
              <Aviso tono="warn" className="mt-2 mb-0">
                Faltan hojas de CRONOGRAMA, ENTREGAS o RUTAS: el cronograma de entregas no se
                actualiza en este cargue.
              </Aviso>
            )}

            {!enviando && !resultado?.parcial && !archivo.faltanClave?.length && (
              <Btn className="mt-4" onClick={aplicar}>
                Actualizar {fmt(archivo.docs.length)} unidades productivas
              </Btn>
            )}
            {enviando && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-texto">
                  Actualizando la lista de compras… {Math.round(progreso * 100)} %
                </p>
                <Barra valor={progreso} />
                <p className="mt-2 text-xs text-gris">No cierres la pestaña hasta que termine.</p>
              </div>
            )}
          </div>
        )}

        {resultado && (
          <div className="mt-4">
            {!resultado.parcial && (
              <Aviso tono={resultado.fallidos.length ? 'warn' : 'ok'} className="mb-3">
                Cargue terminado. Ya puedes verlo en Entregas › Lista de compras.
              </Aviso>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Dato label="U.P. guardadas" valor={fmt(resultado.guardados)} />
              <Dato label="Nuevas en la lista" valor={fmt(resultado.nuevos)} />
              <Dato label="Retiradas (no están en APROBADO)" valor={fmt(resultado.retiradas)} />
              <Dato label="Con error" valor={fmt(resultado.fallidos.length + resultado.entregasFallidas.length)} />
              <Dato label="Entregas en el cronograma" valor={fmt(resultado.entregas)} />
            </div>
            {resultado.entregasSinNodo.length > 0 && (
              <details className="mt-2 text-xs text-gris">
                <summary className="cursor-pointer">
                  {fmt(resultado.entregasSinNodo.length)} entregas sin nodo en la bitácora (ningún gestor las ve)
                </summary>
                <p className="mt-2 break-words leading-relaxed">{resultado.entregasSinNodo.join(', ')}</p>
              </details>
            )}
            {resultado.fallidos.length > 0 && (
              <div className="mt-3 text-xs">
                <p className="text-rojo">
                  {fmt(resultado.fallidos.length)} no se pudieron guardar. Vuelve a aplicar el cargue
                  para reintentarlas.
                </p>
                {resultado.errores.length > 0 && (
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-bg p-3 text-[11px] text-texto">
                    {resultado.errores.join('\n')}
                  </pre>
                )}
                <details className="mt-2 text-gris">
                  <summary className="cursor-pointer">Ver ID_unico con error</summary>
                  <p className="mt-2 break-words leading-relaxed">{resultado.fallidos.join(', ')}</p>
                </details>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

// Zona para soltar o elegir un archivo.
function Soltar({ archivo, leyendo, progreso, deshabilitado, onArchivo }) {
  const inputRef = useRef(null);
  const [encima, setEncima] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !deshabilitado && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !deshabilitado && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault(); setEncima(false);
        if (!deshabilitado) onArchivo(e.dataTransfer.files?.[0]);
      }}
      className={`cursor-pointer rounded-card border-2 border-dashed px-4 py-7 text-center transition ${
        encima ? 'border-acento bg-[rgba(245,164,136,0.08)]'
               : archivo ? 'border-[#38a169] bg-bg' : 'border-borde bg-bg hover:border-acento'
      }`}
    >
      <p className="text-sm font-semibold text-texto">{archivo ? '✓ ' : ''}MASTER ENTREGAS</p>
      <p className="mt-1 text-[11px] text-gris">
        hojas {Object.values(HOJAS_COMPRAS).join(' · ')}
      </p>

      {leyendo ? (
        <>
          <p className="mt-2 text-xs text-texto">Leyendo {HOJAS_COMPRAS[leyendo]}…</p>
          <Barra valor={progreso} />
        </>
      ) : archivo ? (
        <p className="mt-2 break-words text-xs text-gris">{archivo.nombre}</p>
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

function Dato({ label, valor }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">{label}</div>
      <div className="text-lg font-bold tabular-nums text-marino">{valor}</div>
    </div>
  );
}

// Barra de avance del cargue.
function Barra({ valor }) {
  return (
    <div className="mx-auto mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-borde">
      <div className="h-full rounded-full bg-acento transition-all"
           style={{ width: `${Math.round(valor * 100)}%` }} />
    </div>
  );
}
