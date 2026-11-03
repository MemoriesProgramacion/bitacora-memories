// Órdenes de entrega: se arma una orden con kits de la bodega y abajo queda el listado de las ya generadas.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus, Trash2, X } from 'lucide-react'
import { api, fecha, urlPdfOrden } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Confirmar, EnlaceBoton, Entrada, Fila,
  Insignia, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

// Muestra el formulario de nueva orden y la lista de órdenes.
export default function Ordenes() {
  const { datos, cargando, recargar } = useDatos('/ordenes')
  const { ejecutar, ocupado } = useAccion(recargar)
  const navegar = useNavigate()

  const [destino, setDestino] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [lineas, setLineas] = useState([{ ref_id: '', cantidad: '1' }])
  const [aBorrar, setABorrar] = useState(null)

  const fijar = (i, campo, valor) =>
    setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)))

  const crear = async (e) => {
    e.preventDefault()
    const cuerpo = {
      destino,
      observaciones,
      lineas: lineas
        .filter((x) => x.ref_id && Number(x.cantidad) > 0)
        .map((x) => ({ ref_id: Number(x.ref_id), cantidad: Number(x.cantidad) })),
    }
    const r = await ejecutar(() => api.post('/ordenes', cuerpo))
    if (r?.id) {
      setDestino('')
      setObservaciones('')
      setLineas([{ ref_id: '', cantidad: '1' }])
      navegar(`/inventario/ordenes/${r.id}`)
    }
  }

  const borrar = async () => {
    const id = aBorrar?.id
    setABorrar(null)
    if (id) await ejecutar(() => api.del(`/ordenes/${id}`))
  }

  const combos = datos?.combos || []

  return (
    <>
      <Encabezado
        titulo="Órdenes de entrega"
        descripcion="Todo se entrega en Kit UP: ningún artículo sale suelto de la bodega."
      />

      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[380px_1fr] min-[1400px]:items-start">
        <Tarjeta titulo="Nueva orden">
          <form onSubmit={crear} className="form-doble">
            <Campo etiqueta="Destino / Cliente">
              <Entrada maxLength={200} value={destino} onChange={(e) => setDestino(e.target.value)} />
            </Campo>

            <div className="ancho-total flex flex-col gap-2.5">
              <span className="text-[13px] font-semibold text-gris-txt">Kit UP a entregar</span>
              {combos.length === 0 && (
                <Alerta>
                  No hay Kit UP armado con stock disponible. Ármalos primero en la sección Kit UP.
                </Alerta>
              )}
              {lineas.map((ln, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Seleccion
                    aria-label={`Kit UP de la línea ${i + 1}`}
                    value={ln.ref_id}
                    onChange={(e) => fijar(i, 'ref_id', e.target.value)}
                    className="min-w-0 flex-1"
                  >
                    <option value="">Elegir Kit UP</option>
                    {combos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} (disp. {c.stock})
                      </option>
                    ))}
                  </Seleccion>
                  <Entrada
                    type="number"
                    min="1"
                    aria-label={`Cantidad de la línea ${i + 1}`}
                    value={ln.cantidad}
                    onChange={(e) => fijar(i, 'cantidad', e.target.value)}
                    className="w-20 shrink-0"
                  />
                  {lineas.length > 1 && (
                    <Boton
                      variante="fantasma"
                      className="shrink-0 px-0 max-sm:size-11 sm:size-10"
                      onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))}
                      aria-label={`Quitar la línea ${i + 1}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </Boton>
                  )}
                </div>
              ))}
              <Boton
                variante="fantasma"
                icono={Plus}
                onClick={() => setLineas((xs) => [...xs, { ref_id: '', cantidad: '1' }])}
              >
                Agregar Kit UP
              </Boton>
            </div>

            <Campo etiqueta="Observaciones" className="ancho-total">
              <AreaTexto maxLength={2000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </Campo>

            <Boton tipo="submit" cargando={ocupado} disabled={combos.length === 0}>
              Generar orden
            </Boton>
          </form>
        </Tarjeta>

        <Tarjeta titulo={`Órdenes generadas (${datos?.ordenes?.length ?? 0})`}>
          {cargando ? (
            <Cargando />
          ) : (
            <Tabla
              cabeceras={['Número', 'Destino', 'Fecha', 'Estado', { texto: '', alinear: 'derecha' }]}
              vacio="Todavía no se ha generado ninguna orden."
              iconoVacio={FileText}
            >
              {(datos?.ordenes || []).map((o) => (
                <Fila key={o.id}>
                  <Celda>
                    <Link to={`/inventario/ordenes/${o.id}`} className="font-bold text-acento-txt hover:underline">
                      {o.numero}
                    </Link>
                  </Celda>
                  <Celda>{o.destino || '—'}</Celda>
                  <Celda className="whitespace-nowrap text-[13px] text-gris-txt">{fecha(o.fecha)}</Celda>
                  <Celda>
                    <Insignia tono="neutro">{(o.estado || '').toUpperCase()}</Insignia>
                  </Celda>
                  <Celda alinear="derecha">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <EnlaceBoton
                        href={urlPdfOrden(o.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        tamano="sm"
                        icono={FileText}
                      >
                        PDF
                      </EnlaceBoton>
                      <Boton
                        variante="peligro"
                        tamano="sm"
                        icono={Trash2}
                        onClick={() => setABorrar(o)}
                        disabled={ocupado}
                      >
                        Eliminar
                      </Boton>
                    </div>
                  </Celda>
                </Fila>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      </div>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="¿Eliminar orden?"
        texto={`Se eliminará ${aBorrar?.numero}. Ojo: eliminarla NO devuelve el stock de los Kit UP.`}
        onOk={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </>
  )
}
