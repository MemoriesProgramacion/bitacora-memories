// Tablero de indicadores de la ruta: línea base de la segunda visita, salida de la tercera y variación de los
// indicadores de las unidades del alcance de quien consulta, con la satisfacción y el estado de la revisión. Lo
// calcula el servidor y se descarga a Excel.
import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Alerta, Boton, Campo, Cargando, Celda, Fila, Insignia, Seleccion, Tabla, useAvisos } from '../inventario/componentes/ui';
import { descargarExcel } from '../lib/exportarExcel';
import { ESTADOS_REVISION } from '../lib/diagnostico';
import { cargarEsquemaSalida, columnasTablero, pedirTablero, textoIndicador, textoVariacion } from '../lib/salida';
import { hoyISO } from '../lib/asociados';

const MODALIDADES = ['M1', 'M2', 'M3', 'M4'];

// Pide el tablero al servidor, lo muestra con filtros y permite descargarlo.
export default function TableroEvaluacion() {
  const { avisar } = useAvisos();
  const [filtros, setFiltros] = useState({ region: '', modalidad: '' });
  const [resp, setResp] = useState(null);
  const [indicadores, setIndicadores] = useState([]);
  const [error, setError] = useState('');
  const [regiones, setRegiones] = useState([]);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setResp(null);
    setError('');
    pedirTablero(filtros)
      .then((r) => {
        if (!vigente) return;
        setResp(r);
        setRegiones((prev) => [...new Set([...prev, ...r.items.map((i) => i.region).filter(Boolean)])].sort());
      })
      .catch((err) => vigente && setError(err.message || 'No se pudo cargar el tablero.'));
    return () => { vigente = false; };
  }, [filtros, intento]);
  const cargar = useCallback(() => setIntento((n) => n + 1), []);
  useEffect(() => { cargarEsquemaSalida().then((e) => setIndicadores(e.indicadores)).catch(() => {}); }, []);

  const r = resp?.resumen;

  const exportar = async () => {
    try {
      await descargarExcel(`indicadores-ruta-${hoyISO()}.xlsx`, 'Indicadores', columnasTablero(indicadores), resp.items);
    } catch (err) {
      avisar(err.message || 'No se pudo generar el Excel.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Región" className="w-full sm:w-48">
          <Seleccion value={filtros.region} onChange={(e) => setFiltros((f) => ({ ...f, region: e.target.value }))}>
            <option value="">Todas</option>
            {regiones.map((x) => <option key={x} value={x}>{x}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Modalidad" className="w-full sm:w-40">
          <Seleccion value={filtros.modalidad} onChange={(e) => setFiltros((f) => ({ ...f, modalidad: e.target.value }))}>
            <option value="">Todas</option>
            {MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}
          </Seleccion>
        </Campo>
        <Boton tamano="sm" variante="fantasma" icono={Download} disabled={!resp?.items.length || !indicadores.length} onClick={exportar}>
          Descargar Excel
        </Boton>
      </div>
      {error ? (
        <Alerta tono="error">{error} <button type="button" className="font-semibold underline" onClick={cargar}>Reintentar</button></Alerta>
      ) : !resp ? <Cargando texto="Cargando indicadores" /> : (
        <>
          <div className="flex flex-wrap gap-2">
            <Insignia>{r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}</Insignia>
            <Insignia>{r.con_linea_base} con línea base</Insignia>
            <Insignia>{r.con_salida} con salida</Insignia>
            <Insignia tono={r.variacion_ventas_promedio_pct > 0 ? 'ok' : 'neutro'}>Variación de ventas promedio: {textoVariacion(r.variacion_ventas_promedio_pct)}</Insignia>
            <Insignia>Satisfacción promedio: {r.satisfaccion_promedio === null ? '—' : `${r.satisfaccion_promedio.toLocaleString('es-CO')} de 5`}</Insignia>
          </div>
          <p className="text-[12px] text-gris">Los promedios cuentan solo las evaluaciones enviadas o revisadas ({r.enviadas}).</p>
          {r.truncado && <Alerta tono="aviso">Se muestran las primeras 5.000 unidades: filtra por región o modalidad para ver el resto.</Alerta>}
          <Tabla cabeceras={['Unidad', 'Región', 'Ventas base', 'Ventas salida', 'Variación', 'Clientes', 'Satisfacción', 'Revisión']}
            vacio="Todavía no hay unidades con línea base en este filtro.">
            {resp.items.map((i) => {
              const v = i.indicadores.ventas_mensuales;
              const cl = i.indicadores.clientes_mes;
              const est = ESTADOS_REVISION[i.estado_revision] || ESTADOS_REVISION.sin_enviar;
              return (
                <Fila key={i.id_unico}>
                  <Celda><span className="font-semibold text-marca">{i.nombre || i.id_unico}</span> <span className="text-[12px] text-gris">· {i.id_unico}</span></Celda>
                  <Celda>{i.region || '—'}</Celda>
                  <Celda alinear="derecha"><span className="cifras">{textoIndicador('pesos', v.base)}</span></Celda>
                  <Celda alinear="derecha"><span className="cifras">{textoIndicador('pesos', v.salida)}</span></Celda>
                  <Celda alinear="derecha"><span className="cifras font-semibold">{textoVariacion(v.variacion_pct)}</span></Celda>
                  <Celda alinear="derecha"><span className="cifras">{textoIndicador('entero', cl.base)} → {textoIndicador('entero', cl.salida)}</span></Celda>
                  <Celda alinear="derecha"><span className="cifras">{i.satisfaccion === null ? '—' : i.satisfaccion.toLocaleString('es-CO')}</span></Celda>
                  <Celda><Insignia tono={est.tono}>{est.texto}</Insignia></Celda>
                </Fila>
              );
            })}
          </Tabla>
        </>
      )}
    </div>
  );
}
