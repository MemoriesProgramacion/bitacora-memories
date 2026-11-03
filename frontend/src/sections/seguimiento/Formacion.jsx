// Reporte del 80 %: las unidades con taller de fortalecimiento y su porcentaje de formación, el mejor de sus
// talleres, con el resumen por región y por modalidad. El servidor calcula el 80 % con las sesiones, la
// encuesta de salida y la entrega final.
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, GraduationCap } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Boton, Cargando, Celda, Fila, Insignia, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { descargarExcel } from '../../lib/exportarExcel';
import { columnasFormacion, pct } from '../../lib/seguimiento';

// Muestra el resumen de formación por región y por modalidad.
function Resumen({ titulo, filas }) {
  return (
    <Tarjeta titulo={titulo}>
      <Tabla cabeceras={['Grupo', { texto: 'En formación', alinear: 'derecha' }, { texto: 'Cumplen el 80 %', alinear: 'derecha' }, { texto: '%', alinear: 'derecha' }]} vacio="Sin unidades en formación.">
        {filas.map((g) => (
          <Fila key={g.grupo}>
            <Celda><span className="font-semibold text-marca">{g.grupo}</span></Celda>
            <Celda alinear="derecha"><span className="cifras">{g.en_formacion}</span></Celda>
            <Celda alinear="derecha"><span className="cifras">{g.cumplen}</span></Celda>
            <Celda alinear="derecha"><span className="cifras">{pct(g.porcentaje)}</span></Celda>
          </Fila>
        ))}
      </Tabla>
    </Tarjeta>
  );
}

// Pide el reporte y muestra el resumen y la lista de unidades.
export default function Formacion() {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [soloFaltan, setSoloFaltan] = useState(false);
  useEffect(() => {
    apiGeneral.get('/seguimiento/formacion').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [], por_region: [], por_modalidad: [], total: {} }); });
  }, [avisar]);
  const items = useMemo(() => (datos?.items || []).filter((f) => !soloFaltan || !f.cumple), [datos, soloFaltan]);
  if (datos === null) return <Tarjeta><Cargando /></Tarjeta>;
  const t = datos.total;
  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Cumplimiento del 80 % de formación" acciones={items.length > 0 && (
        <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('reporte-80-formacion', 'Formación', columnasFormacion(), items)}>Excel</Boton>
      )}>
        <p className="text-[13px]">
          <strong className="cifras">{(t.cumplen || 0).toLocaleString('es-CO')}</strong> de <strong className="cifras">{(t.en_formacion || 0).toLocaleString('es-CO')}</strong> unidades en formación cumplen el 80 % ({pct(t.porcentaje)}). Hay {(t.unidades || 0).toLocaleString('es-CO')} unidades en el programa.
        </p>
      </Tarjeta>
      <div className="grid gap-5 lg:grid-cols-2">
        <Resumen titulo="Por región" filas={datos.por_region} />
        <Resumen titulo="Por modalidad" filas={datos.por_modalidad} />
      </div>
      <Tarjeta titulo="Por unidad" acciones={
        <label className="inline-flex items-center gap-2 text-[13px] font-medium text-gris-txt">
          <input type="checkbox" className="size-4 accent-acento" checked={soloFaltan} onChange={(e) => setSoloFaltan(e.target.checked)} /> Solo las que no cumplen
        </label>}>
        <Tabla cabeceras={['Unidad', 'Territorio', 'Taller', { texto: 'Formación', alinear: 'derecha' }, 'Estado']} vacio="No hay unidades para mostrar." iconoVacio={GraduationCap}>
          {items.map((f) => (
            <Fila key={f.id_unico}>
              <Celda><span className="font-semibold text-marca">{f.id_unico}</span><span className="block break-words text-[12px] text-gris-txt">{f.nombre}</span></Celda>
              <Celda><span className="text-[13px]">{f.region || '—'} · {f.nodo || '—'} · {f.modalidad || '—'}</span></Celda>
              <Celda><span className="break-words text-[13px]">{f.taller}</span></Celda>
              <Celda alinear="derecha"><span className="cifras font-semibold">{pct(f.porcentaje)}</span></Celda>
              <Celda><Insignia tono={f.cumple ? 'ok' : f.taller_terminado ? 'error' : 'alerta'}>{f.cumple ? 'Cumple' : f.taller_terminado ? 'No cumplió' : 'En curso'}</Insignia></Celda>
            </Fila>
          ))}
        </Tabla>
      </Tarjeta>
    </div>
  );
}
