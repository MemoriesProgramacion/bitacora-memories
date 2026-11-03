// Metas de cupos: meta de unidades por región y modalidad, con un desglose opcional por departamento. Las
// registra el nivel nacional, que reemplaza la lista completa y queda en la actividad, y la coordinación local
// ve las de su región. Si las metas no suman el total del programa, 6.334 unidades, el servidor lo avisa.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Save, Target, Trash2 } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { Alerta, Boton, Cargando, Celda, Entrada, Fila, Seleccion, Tabla, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { MODALIDADES, metasParaEnviar, problemasMetas, totalMetas } from '../../lib/seguimiento';

// Crea una fila vacía de meta.
const fila = () => ({ region: '', modalidad: 'M1', departamento: '', meta: '' });

// Muestra la tabla de metas y la edición para quien tiene permiso.
export default function Metas() {
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const recargar = useCallback(() => {
    apiGeneral.get('/metas').then(setDatos).catch((err) => { avisar(err.message, 'error'); setDatos({ items: [], total_programa: 6334, total_metas: 0 }); });
  }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);
  if (datos === null) return <Tarjeta><Cargando /></Tarjeta>;

  const editar = () => setEdicion(datos.items.length
    ? datos.items.map((m) => ({ region: m.region, modalidad: m.modalidad, departamento: m.departamento || '', meta: String(m.meta) })) : [fila()]);
  const poner = (i, k) => (e) => setEdicion((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const problemas = edicion ? problemasMetas(edicion) : [];
  const guardar = async () => {
    setOcupado(true);
    try {
      const r = await apiGeneral.post('/metas', { metas: metasParaEnviar(edicion) });
      avisar(r.aviso ? `Metas guardadas. ${r.aviso}` : 'Metas guardadas.');
      setEdicion(null);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };

  if (edicion) {
    return (
      <Tarjeta titulo="Editar las metas de cupos" acciones={<Boton variante="fantasma" icono={Plus} onClick={() => setEdicion((xs) => [...xs, fila()])}>Agregar fila</Boton>}>
        <Alerta tono="info">Deja el departamento vacío para la meta de la región y modalidad. Las filas con departamento son un desglose y no se suman al total.</Alerta>
        <ul className="mt-3 grid gap-3">
          {edicion.map((m, i) => (
            <li key={i}>
              <fieldset className="grid gap-2 rounded-xl border border-borde p-3 sm:grid-cols-[1fr_7rem_1fr_7rem_auto] sm:items-end">
                <legend className="px-1 text-[12px] font-semibold text-gris-txt">Fila {i + 1}</legend>
                <label className="grid gap-1 text-[12px] font-medium text-gris-txt">Región<Entrada value={m.region} maxLength={100} onChange={poner(i, 'region')} /></label>
                <label className="grid gap-1 text-[12px] font-medium text-gris-txt">Modalidad
                  <Seleccion value={m.modalidad} onChange={poner(i, 'modalidad')}>{MODALIDADES.map((x) => <option key={x} value={x}>{x}</option>)}</Seleccion>
                </label>
                <label className="grid gap-1 text-[12px] font-medium text-gris-txt">Departamento (opcional)<Entrada value={m.departamento} maxLength={100} onChange={poner(i, 'departamento')} /></label>
                <label className="grid gap-1 text-[12px] font-medium text-gris-txt">Meta<Entrada inputMode="numeric" value={m.meta} onChange={poner(i, 'meta')} /></label>
                <Boton variante="fantasma" icono={Trash2} aria-label={`Quitar la fila ${i + 1}`} onClick={() => setEdicion((xs) => xs.filter((_, j) => j !== i))}>Quitar</Boton>
              </fieldset>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px]">Total por región y modalidad: <strong className="cifras">{totalMetas(edicion).toLocaleString('es-CO')}</strong> de {datos.total_programa.toLocaleString('es-CO')} del programa.</p>
        {problemas.length > 0 && <Alerta tono="error" className="mt-2">{problemas.join(' ')}</Alerta>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Boton variante="fantasma" onClick={() => setEdicion(null)}>Cancelar</Boton>
          <Boton icono={Save} cargando={ocupado} disabled={problemas.length > 0} onClick={guardar}>Guardar las metas</Boton>
        </div>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Metas de cupos" acciones={datos.puede_editar && <Boton icono={Pencil} onClick={editar}>Editar</Boton>}>
      <p className="mb-3 text-[13px]">Las metas por región y modalidad suman <strong className="cifras">{datos.total_metas.toLocaleString('es-CO')}</strong> de {datos.total_programa.toLocaleString('es-CO')} unidades del programa.</p>
      <Tabla cabeceras={['Región', 'Modalidad', 'Departamento', { texto: 'Meta', alinear: 'derecha' }]} vacio="Todavía no hay metas registradas." iconoVacio={Target}>
        {datos.items.map((m) => (
          <Fila key={m.id}>
            <Celda><span className="font-semibold text-marca">{m.region}</span></Celda>
            <Celda>{m.modalidad}</Celda>
            <Celda>{m.departamento || 'Toda la región'}</Celda>
            <Celda alinear="derecha"><span className="cifras">{m.meta.toLocaleString('es-CO')}</span></Celda>
          </Fila>
        ))}
      </Tabla>
    </Tarjeta>
  );
}
