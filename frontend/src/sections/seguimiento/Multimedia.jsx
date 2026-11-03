// Fotos y videos del mes: cuántos se cargaron en el mes por serie documental y región, tomados del repositorio,
// de las fotos de las actas de elementos defectuosos, de los casos de éxito y de los eventos del equipo.
import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { Campo, Cargando, Celda, Fila, Seleccion, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { diaColombia } from '../../lib/carrito';
import { nombrePeriodo, periodosRecientes } from '../../lib/seguimiento';

// Pide los conteos del mes y los muestra por serie y región.
export default function Multimedia() {
  const { avisar } = useAvisos();
  const periodos = periodosRecientes(diaColombia(new Date().toISOString()), 24);
  const [periodo, setPeriodo] = useState(periodos[0]);
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    let vivo = true;
    setDatos(null);
    apiGeneral.get(`/seguimiento/multimedia${qs({ periodo })}`).then((r) => { if (vivo) setDatos(r); })
      .catch((err) => { if (vivo) { avisar(err.message, 'error'); setDatos({ items: [], total: { fotos: 0, videos: 0 } }); } });
    return () => { vivo = false; };
  }, [periodo, avisar]);
  return (
    <Tarjeta titulo="Fotos y videos cargados" acciones={
      <Campo etiqueta="Mes" className="min-w-44">
        <Seleccion value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{periodos.map((p) => <option key={p} value={p}>{nombrePeriodo(p)}</option>)}</Seleccion>
      </Campo>}>
      {datos === null ? <Cargando /> : (
        <>
          <p className="mb-3 text-[13px]">En {nombrePeriodo(periodo)}: <strong className="cifras">{datos.total.fotos.toLocaleString('es-CO')}</strong> fotos y <strong className="cifras">{datos.total.videos.toLocaleString('es-CO')}</strong> videos.</p>
          <Tabla cabeceras={['Serie', 'Región', { texto: 'Fotos', alinear: 'derecha' }, { texto: 'Videos', alinear: 'derecha' }]} vacio="No se cargaron fotos ni videos en el mes." iconoVacio={Camera}>
            {datos.items.map((x) => (
              <Fila key={`${x.serie}|${x.region}`}>
                <Celda><span className="font-semibold text-marca">{x.nombre_serie}</span></Celda>
                <Celda>{x.region}</Celda>
                <Celda alinear="derecha"><span className="cifras">{x.fotos}</span></Celda>
                <Celda alinear="derecha"><span className="cifras">{x.videos}</span></Celda>
              </Fila>
            ))}
          </Tabla>
        </>
      )}
    </Tarjeta>
  );
}
