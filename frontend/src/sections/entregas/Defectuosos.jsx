// Elementos defectuosos en las entregas: las actas que la bodega registró sobre los kits de las unidades del
// territorio, que el servidor filtra por alcance. Quien coordina el territorio recibe el aviso por correo y
// aquí da por recibido el reporte; la devolución al proveedor y el reemplazo los registra la bodega en el
// inventario.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileDown, FileSpreadsheet, PackageX } from 'lucide-react';
import { apiGeneral, qs } from '../../inventario/lib/api';
import { Alerta, Boton, Cargando, Insignia, Tarjeta, Vacio, useAvisos } from '../../inventario/componentes/ui';
import { ESTADOS_DEFECTO, columnasDefectuosos, textoSeguimiento } from '../../lib/entregaFinal';
import { descargarExcel } from '../../lib/exportarExcel';
import { diaColombia } from '../../lib/carrito';

// Muestra las actas con su estado y la acción de dar por recibido el reporte.
export default function Defectuosos() {
  const { avisar } = useAvisos();
  const [items, setItems] = useState(null);
  const [estado, setEstado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const recargar = useCallback(() => {
    apiGeneral.get(`/entregas/defectuosos${qs({ estado })}`).then((r) => setItems(r.items || []))
      .catch((err) => { avisar(err.message, 'error'); setItems([]); });
  }, [avisar, estado]);
  useEffect(() => { recargar(); }, [recargar]);

  const recibir = async (n) => {
    setOcupado(true);
    try {
      await apiGeneral.post('/entregas/defectuosos/recibido', { id: n.id });
      avisar(`Reporte del acta ${String(n.id).padStart(5, '0')} dado por recibido.`);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Actas de elementos defectuosos"
        acciones={items?.length > 0 && <Boton variante="fantasma" icono={FileSpreadsheet} onClick={() => descargarExcel('elementos-defectuosos', 'Elementos defectuosos', columnasDefectuosos(), items)}>Excel</Boton>}>
        <Alerta tono="info">La bodega registra el acta al encontrar elementos dañados o incompletos en la entrega del kit; el Coordinador local regional de la unidad recibe el aviso y da por recibido el reporte. La devolución al proveedor y el reemplazo se registran en el Inventario sobre la misma acta.</Alerta>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {[['', 'Todas'], ...Object.entries(ESTADOS_DEFECTO).map(([k, e]) => [k, e.texto])].map(([clave, texto]) => (
            <button key={clave || 'todas'} type="button" onClick={() => setEstado(clave)} aria-pressed={estado === clave}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${estado === clave ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-marca hover:border-acento'}`}>
              {texto}
            </button>
          ))}
        </div>
      </Tarjeta>
      {items === null ? <Tarjeta><Cargando /></Tarjeta> : !items.length ? <Tarjeta><Vacio icono={PackageX}>No hay actas de elementos defectuosos{estado ? ' en ese estado' : ''}.</Vacio></Tarjeta> : (
        <ul className="grid gap-3">
          {items.map((n) => (
            <li key={n.id}>
              <Tarjeta titulo={`Acta ${String(n.id).padStart(5, '0')} · ${n.id_unico ? `${n.unidad || ''} (${n.id_unico})` : 'U.P. sin identificar'}`}
                acciones={<Insignia tono={ESTADOS_DEFECTO[n.estado]?.tono}>{n.nombre_estado}</Insignia>}>
                <div className="grid gap-2 text-[13px]">
                  <p className="break-words text-gris-txt">{diaColombia(n.creado)} · kit {n.kit} · {n.nombre_tipo} · nodo {n.nodo || '—'} · reportó {n.creado_por}</p>
                  <p className="break-words"><strong>Elementos:</strong> {(n.articulos || []).map((a) => `${a.cantidad} × ${a.nombre}`).join(', ')}</p>
                  <p className="whitespace-pre-wrap break-words">{n.texto}</p>
                  <p className="text-gris-txt">{textoSeguimiento(n)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/api/entregas/defectuosos/acta?id=${n.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Acta ${n.id} en PDF`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={15} aria-hidden="true" />Acta (PDF)</a>
                    {n.puede_recibir && <Boton tamano="sm" icono={CheckCircle2} cargando={ocupado} onClick={() => recibir(n)}>Dar por recibido el reporte</Boton>}
                  </div>
                </div>
              </Tarjeta>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
