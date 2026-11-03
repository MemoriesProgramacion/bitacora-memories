// Legalización por unidad productiva: los planes aprobados frente a sus facturas de capitalización del
// inventario. Muestra el total del plan, el facturado, la diferencia y el porcentaje legalizado.
import { useEffect, useState } from 'react';
import { FileSpreadsheet, Receipt } from 'lucide-react';
import { apiGeneral, pesos } from '../../inventario/lib/api';
import { Boton, Cargando, Celda, Fila, Insignia, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { columnasLegalizacion } from '../../lib/carrito';
import { descargarExcel } from '../../lib/exportarExcel';

// Cabeceras de la tabla de legalización.
const CABECERAS = [
  'ID único', 'Unidad productiva', 'Nodo', 'Estado',
  { texto: 'Plan', alinear: 'derecha' }, { texto: 'Facturado', alinear: 'derecha' },
  { texto: 'Diferencia', alinear: 'derecha' }, { texto: '% legalizado', alinear: 'derecha' }, 'Facturas',
];

// Pide los planes aprobados y muestra la tabla con la opción de exportarla.
export default function Legalizacion() {
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  useEffect(() => {
    apiGeneral.get('/capitalizacion/legalizacion').then((r) => setItems(r.items || []))
      .catch((err) => { avisar(err.message, 'error'); setItems([]); });
  }, [avisar]);

  return (
    <Tarjeta titulo="Legalización por unidad productiva"
      acciones={items?.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('legalizacion-capitalizacion', 'Legalización', columnasLegalizacion(), items)}>Excel</Boton>}>
      {items === null ? <Cargando /> : (
        <Tabla cabeceras={CABECERAS} vacio="No hay planes aprobados." iconoVacio={Receipt}>
          {items.map((f) => (
            <Fila key={f.id_unico}>
              <Celda className="font-mono text-[12px]">{f.id_unico}</Celda>
              <Celda className="break-words">{f.nombre}</Celda>
              <Celda className="text-gris-txt">{f.nodo || '—'}</Celda>
              <Celda>{f.nombre_estado}</Celda>
              <Celda alinear="derecha" className="cifras whitespace-nowrap">{pesos(f.total_plan)}</Celda>
              <Celda alinear="derecha" className="cifras whitespace-nowrap">{pesos(f.total_facturado)}</Celda>
              <Celda alinear="derecha" className={`cifras whitespace-nowrap ${f.diferencia > 0 ? 'text-rojo-txt' : ''}`}>{pesos(f.diferencia)}</Celda>
              <Celda alinear="derecha">
                {f.porcentaje == null ? '—' : <Insignia tono={f.porcentaje > 100 ? 'error' : f.porcentaje === 100 ? 'ok' : 'alerta'}>{f.porcentaje} %</Insignia>}
              </Celda>
              <Celda className="break-words text-[12px] text-gris-txt">{f.facturas.length ? f.facturas.map((x) => `${x.numero} (${x.fecha})`).join(', ') : 'Sin facturas'}</Celda>
            </Fila>
          ))}
        </Tabla>
      )}
    </Tarjeta>
  );
}
