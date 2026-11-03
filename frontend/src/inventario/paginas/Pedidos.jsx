// Órdenes de pedido: cada lote nace de un Excel con los artículos de varias unidades productivas.
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, FileText, Trash2, Upload } from 'lucide-react'
import { api, fecha, urlPdfPedido } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Boton, Campo, Cargando, Celda, Confirmar, EnlaceBoton, Entrada, Fila, Tabla, Tarjeta, useAvisos,
} from '../componentes/ui'

// Tope del Excel en megas, el mismo del servidor.
const MAX_MB = 10

// Muestra la carga del Excel y la lista de lotes.
export default function Pedidos() {
  const { datos, cargando, recargar } = useDatos('/pedidos')
  const { ejecutar, ocupado } = useAccion(recargar)
  const { avisar } = useAvisos()
  const navegar = useNavigate()
  const refArchivo = useRef(null)
  const [nombre, setNombre] = useState('')
  const [aBorrar, setABorrar] = useState(null)

  const cargar = async (e) => {
    e.preventDefault()
    const archivo = refArchivo.current?.files?.[0]
    if (!archivo) return
    if (archivo.size > MAX_MB * 1024 * 1024) {
      avisar(`El archivo pesa más de ${MAX_MB} MB.`, 'error')
      return
    }
    const fd = new FormData()
    fd.append('archivo', archivo)
    fd.append('nombre', nombre)
    const r = await ejecutar(() => api.post('/pedidos/cargar', fd))
    if (r?.id) {
      setNombre('')
      if (refArchivo.current) refArchivo.current.value = ''
      navegar(`/inventario/pedidos/${r.id}`)
    }
  }

  const borrar = async () => {
    const id = aBorrar?.id
    setABorrar(null)
    if (id) await ejecutar(() => api.del(`/pedidos/${id}`))
  }

  return (
    <>
      <Encabezado
        titulo="Órdenes de pedido"
        descripcion="Cada lote se carga desde un Excel y agrupa los ítems de varias unidades productivas."
      />

      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[360px_1fr] min-[1400px]:items-start">
        <Tarjeta titulo="Cargar lote desde Excel">
          <form onSubmit={cargar} className="form-doble">
            <Campo etiqueta="Nombre del lote" ayuda="Si lo dejas vacío se numera solo (Lote 1, Lote 2…).">
              <Entrada maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Campo>
            <Campo
              etiqueta="Archivo de Excel"
              className="ancho-total"
              ayuda="Debe tener la hoja «Desglosado items» con las columnas num_documento, codigo_actual, nombre_carrito_actual, tipo_segun_carrito_actual, cantidad y precio_actual."
            >
              <input
                ref={refArchivo}
                type="file"
                accept=".xlsx,.xlsm"
                required
                className="w-full cursor-pointer rounded-lg border border-dashed border-campo bg-lienzo px-3 py-3 text-[14px] text-gris-txt transition-colors duration-150 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-marca file:px-3.5 file:py-2 file:text-[13px] file:font-semibold file:text-white file:transition-colors hover:border-slate-500 hover:bg-card file:hover:bg-marca-hover"
              />
            </Campo>
            <Boton tipo="submit" icono={Upload} cargando={ocupado}>
              {ocupado ? 'Cargando' : 'Cargar lote'}
            </Boton>
            <p className="text-[12px] text-gris">Tamaño máximo del archivo: {MAX_MB} MB.</p>
          </form>
        </Tarjeta>

        <Tarjeta titulo={`Lotes cargados (${datos?.lotes?.length ?? 0})`}>
          {cargando ? (
            <Cargando />
          ) : (
            <Tabla
              cabeceras={[
                'N.º', 'Lote', 'Archivo',
                { texto: 'Ítems', alinear: 'derecha' },
                { texto: 'Unidades', alinear: 'derecha' },
                'Creado',
                { texto: '', alinear: 'derecha' },
              ]}
              vacio="Todavía no se ha cargado ningún lote. Sube un Excel con el formulario."
              iconoVacio={ClipboardList}
            >
              {(datos?.lotes || []).map((l) => (
                <Fila key={l.id}>
                  <Celda className="font-mono text-[12px] text-gris-txt">{l.numero}</Celda>
                  <Celda>
                    <Link to={`/inventario/pedidos/${l.id}`} className="font-bold text-acento-txt hover:underline">
                      {l.nombre}
                    </Link>
                  </Celda>
                  <Celda className="max-w-[200px] truncate text-[13px] text-gris-txt" title={l.archivo}>
                    {l.archivo || '—'}
                  </Celda>
                  <Celda alinear="derecha">{l.n_items}</Celda>
                  <Celda alinear="derecha">{l.n_up}</Celda>
                  <Celda className="whitespace-nowrap text-[13px] text-gris-txt">{fecha(l.creado)}</Celda>
                  <Celda alinear="derecha">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <EnlaceBoton
                        href={urlPdfPedido(l.id)}
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
                        onClick={() => setABorrar(l)}
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
        titulo="¿Eliminar lote?"
        texto={`Se eliminará "${aBorrar?.nombre}" con todos sus ítems.`}
        onOk={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </>
  )
}
