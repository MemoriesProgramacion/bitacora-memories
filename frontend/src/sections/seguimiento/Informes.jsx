// Informes de seguimiento: el consolidado del mes por región, departamento y modalidad, en pantalla, Excel y
// PDF; los informes mensuales guardados, que el servidor genera solo para el mes anterior; y el archivo de
// intercambio para KOKAN, que lleva datos personales y por eso solo lo descarga el nivel nacional.
import { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Send } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { Alerta, Boton, Campo, Cargando, Celda, Entrada, Fila, Seleccion, Tabla, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { urlArchivo } from '../../lib/api';
import { descargarExcel } from '../../lib/exportarExcel';
import { diaColombia } from '../../lib/carrito';
import { columnasConsolidado, columnasKokan, csvKokan, esGeneralSeg, nombrePeriodo, periodosRecientes, problemaRango } from '../../lib/seguimiento';

const ENLACE = 'inline-flex items-center gap-1 font-semibold text-acento-txt underline';
const MOSTRAR = ['visita1', 'visita2', 'sesiones', 'aprobacion', 'entrega', 'visita3', 'cierre', 'retiros'];

// Descarga un texto como archivo.
function descargarTexto(texto, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Muestra el consolidado del mes con su periodo y sus descargas.
function Consolidado({ periodos }) {
  const { avisar } = useAvisos();
  const [periodo, setPeriodo] = useState(periodos[1] || periodos[0]);
  const [c, setC] = useState(null);
  useEffect(() => {
    let vivo = true;
    setC(null);
    apiGeneral.get(`/seguimiento/mensual${qs({ periodo })}`).then((r) => { if (vivo) setC(r); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setC({ items: [], totales: null }); } });
    return () => { vivo = false; };
  }, [periodo, avisar]);
  const archivo = (formato) => urlArchivo(`/seguimiento/mensual/archivo${qs({ periodo, formato })}`);
  return (
    <Tarjeta titulo="Consolidado del mes" acciones={
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Mes" className="min-w-44">
          <Seleccion value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {periodos.map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}
          </Seleccion>
        </Campo>
        <a className={ENLACE} href={archivo('xlsx')} aria-label={`Informe de ${nombrePeriodo(periodo)} en Excel`}><FileSpreadsheet size={15} aria-hidden="true" />Excel</a>
        <a className={ENLACE} href={archivo('pdf')} target="_blank" rel="noopener noreferrer" aria-label={`Informe de ${nombrePeriodo(periodo)} en PDF`}><FileText size={15} aria-hidden="true" />PDF</a>
      </div>}>
      {c === null ? <Cargando /> : !c.totales ? <Alerta tono="error">No se pudo calcular el consolidado.</Alerta> : (
        <>
          <p className="mb-3 text-[13px]">
            {c.totales.unidades.toLocaleString('es-CO')} unidades en el programa. En {nombrePeriodo(c.periodo)}: {MOSTRAR.map((k) => `${c.metricas_mes[k].toLowerCase()} ${c.totales.periodo[k]}`).join(' · ')}.
          </p>
          <Tabla cabeceras={['Región · departamento · modalidad', { texto: 'Unidades', alinear: 'derecha' }, ...MOSTRAR.map((k) => ({ texto: c.metricas_mes[k], alinear: 'derecha' }))]} vacio="No hay unidades.">
            {c.items.map((g) => (
              <Fila key={`${g.region}|${g.departamento}|${g.modalidad}`}>
                <Celda><span className="font-semibold text-marca">{g.region}</span><span className="block text-[12px] text-gris-txt">{g.departamento} · {g.modalidad}</span></Celda>
                <Celda alinear="derecha"><span className="cifras">{g.unidades}</span></Celda>
                {MOSTRAR.map((k) => <Celda key={k} alinear="derecha"><span className="cifras">{g.periodo[k]}</span></Celda>)}
              </Fila>
            ))}
          </Tabla>
          {c.items.length > 0 && (
            <div className="mt-3 flex justify-end">
              <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel(`consolidado-${c.periodo}-detalle`, 'Consolidado', columnasConsolidado(c), c.items)}>Excel con todas las columnas</Boton>
            </div>
          )}
        </>
      )}
    </Tarjeta>
  );
}

// Muestra la lista de informes mensuales guardados.
function Guardados() {
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  useEffect(() => {
    apiGeneral.get('/seguimiento/informes').then((r) => setItems(r.items || [])).catch((err) => { avisar(err.message, 'error'); setItems([]); });
  }, [avisar]);
  const archivo = (id, formato) => urlArchivo(`/seguimiento/informes/archivo${qs({ id, formato })}`);
  return (
    <Tarjeta titulo="Informes mensuales guardados">
      <p className="mb-3 text-[12px] text-gris-txt">El informe de cada mes se genera solo al empezar el mes siguiente y se avisa por correo al Coordinador general y al Profesional de seguimiento.</p>
      {items === null ? <Cargando /> : !items.length ? <Vacio icono={FileDown}>Todavía no hay informes guardados.</Vacio> : (
        <ul className="grid gap-2">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-borde p-3">
              <span className="min-w-0"><span className="font-semibold text-marca">{nombrePeriodo(x.periodo)}</span>
                <span className="block text-[12px] text-gris-txt">Generado el {diaColombia(x.generado_en)} · {x.generado_por} · {x.resumen?.unidades?.toLocaleString('es-CO') ?? '—'} unidades</span></span>
              <span className="flex flex-wrap gap-3">
                <a className={ENLACE} href={archivo(x.id, 'xlsx')} aria-label={`Informe guardado de ${nombrePeriodo(x.periodo)} en Excel`}><FileSpreadsheet size={15} aria-hidden="true" />Excel</a>
                <a className={ENLACE} href={archivo(x.id, 'pdf')} target="_blank" rel="noopener noreferrer" aria-label={`Informe guardado de ${nombrePeriodo(x.periodo)} en PDF`}><FileText size={15} aria-hidden="true" />PDF</a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

// Muestra el formulario para descargar el archivo de intercambio con un rango de fechas.
function Kokan() {
  const { avisar } = useAvisos();
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [ocupado, setOcupado] = useState('');
  const problema = problemaRango(desde, hasta);
  const exportar = async (formato) => {
    setOcupado(formato);
    try {
      const r = await apiGeneral.get(`/seguimiento/kokan${qs({ desde, hasta })}`);
      if (!r.items.length) { avisar('No hay actividades cumplidas en ese rango.', 'error'); return; }
      const nombre = `kokan-${desde || 'inicio'}-a-${hasta || 'hoy'}`;
      if (formato === 'csv') descargarTexto(csvKokan(r.items, r.diccionario), `${nombre}.csv`, 'text/csv;charset=utf-8');
      else await descargarExcel(nombre, 'KOKAN', columnasKokan(r.diccionario), r.items);
      avisar(`Archivo para KOKAN con ${r.items.length.toLocaleString('es-CO')} filas.`);
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado('');
    }
  };
  return (
    <Tarjeta titulo="Exportar a KOKAN">
      <Alerta tono="aviso">El archivo lleva el documento y el nombre del representante (Ley 1581): guárdalo solo donde lo exige el DPS. La descarga queda registrada.</Alerta>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Desde" ayuda="Vacío: desde el inicio."><Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-invalid={Boolean(problema) || undefined} /></Campo>
        <Campo etiqueta="Hasta" ayuda="Vacío: hasta hoy." error={problema || undefined}><Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-invalid={Boolean(problema) || undefined} /></Campo>
      </div>
      <p className="mt-2 text-[12px] text-gris-txt">Una fila por unidad y actividad cumplida de la ruta, con su fecha. Con un rango, salen solo las actividades con fecha dentro de él.</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" icono={Send} cargando={ocupado === 'csv'} disabled={Boolean(problema) || Boolean(ocupado)} onClick={() => exportar('csv')}>CSV</Boton>
        <Boton icono={FileSpreadsheet} cargando={ocupado === 'xlsx'} disabled={Boolean(problema) || Boolean(ocupado)} onClick={() => exportar('xlsx')}>Excel</Boton>
      </div>
    </Tarjeta>
  );
}

// Reúne el consolidado, los informes guardados y la descarga de intercambio.
export default function Informes({ session }) {
  const periodos = periodosRecientes(diaColombia(new Date().toISOString()), 24);
  return (
    <div className="grid gap-5">
      <Consolidado periodos={periodos} />
      <Guardados />
      {esGeneralSeg(session) && <Kokan />}
    </div>
  );
}
