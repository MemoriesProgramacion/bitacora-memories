// Alertas de la ruta: lo que se está quedando atrás, como visitas sin cerrar después de su fecha, tercera
// visita pendiente un mes después de la entrega, talleres terminados sin el 80 %, subsanaciones vencidas,
// planes que se pasan del presupuesto, nodos cerca del tope de 50 unidades y actas de elementos defectuosos sin
// reemplazo. Las calcula el servidor en el alcance del usuario.
import { useEffect, useMemo, useState } from 'react';
import { BellOff, FileSpreadsheet } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Boton, Campo, Cargando, Insignia, Seleccion, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { descargarExcel } from '../../lib/exportarExcel';
import { NIVEL_ALERTA, columnasAlertas, tituloAlerta } from '../../lib/seguimiento';

// Pide las alertas y las muestra como tarjetas con su resumen y la opción de exportarlas.
export default function Alertas() {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [tipo, setTipo] = useState('');
  useEffect(() => {
    apiGeneral.get('/seguimiento/alertas').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [], tipos: {}, resumen: { por_tipo: {} } }); });
  }, [avisar]);
  const items = useMemo(() => (datos?.items || []).filter((a) => !tipo || a.tipo === tipo), [datos, tipo]);
  if (datos === null) return <Tarjeta><Cargando /></Tarjeta>;
  return (
    <Tarjeta titulo="Alertas de la ruta" acciones={
      <div className="flex flex-wrap items-end gap-2">
        <Campo etiqueta="Tipo" className="min-w-48">
          <Seleccion value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todas ({datos.items.length})</option>
            {Object.entries(datos.tipos).map(([k, t]) => <option key={k} value={k}>{t.nombre} ({datos.resumen.por_tipo[k] || 0})</option>)}
          </Seleccion>
        </Campo>
        {items.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('alertas-ruta', 'Alertas', columnasAlertas(), items)}>Excel</Boton>}
      </div>}>
      {!items.length ? <Vacio icono={BellOff}>{tipo ? 'No hay alertas de este tipo.' : 'No hay alertas en tu alcance.'}</Vacio> : (
        <ul className="grid gap-2">
          {items.map((a, i) => (
            <li key={`${a.tipo}-${a.id_unico || a.nodo}-${i}`} className="rounded-xl border border-borde bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-[14px] font-semibold text-marca">{tituloAlerta(a)}</span>
                <Insignia tono={NIVEL_ALERTA[a.nivel] || 'neutro'} ajustar>{a.nombre_tipo}</Insignia>
              </div>
              <p className="mt-1 break-words text-[13px]">{a.detalle}</p>
              <p className="mt-0.5 text-[12px] text-gris-txt">{a.region || 'Sin región'}{a.nodo ? ` · nodo ${a.nodo}` : ''}{a.desde ? ` · desde el ${a.desde}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
