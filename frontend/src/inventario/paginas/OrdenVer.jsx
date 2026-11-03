// Detalle de una orden de entrega: a dónde va, cuánto vale y qué kits lleva, con su QR.
import { ArrowLeft, Banknote, Boxes, CircleDot, FileText, MapPin } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { fecha, pesos, urlPdfOrden, urlQr } from '../lib/api'
import { useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, Cargando, Celda, EnlaceBoton, Fila, Indicador, Insignia, Tabla, Tarjeta,
} from '../componentes/ui'

// Pide la orden y la muestra con sus kits.
export default function OrdenVer() {
  const { id } = useParams()
  const { datos, cargando } = useDatos(`/ordenes/${id}`)

  if (cargando) return <Cargando />
  if (!datos) return null

  const { orden, items, monto } = datos

  return (
    <>
      <Encabezado titulo={orden.numero} descripcion={`Orden de entrega, ${fecha(orden.fecha)}`}>
        <EnlaceBoton to="/inventario/ordenes" icono={ArrowLeft}>Volver</EnlaceBoton>
        <EnlaceBoton
          href={urlPdfOrden(orden.id)}
          target="_blank"
          rel="noopener noreferrer"
          variante="oscuro"
          icono={FileText}
        >
          Ver PDF
        </EnlaceBoton>
      </Encabezado>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Destino" valor={orden.destino || '—'} icono={MapPin} retardo={0} />
        <Indicador etiqueta="Estado" valor={(orden.estado || '').toUpperCase()} icono={CircleDot} retardo={60} />
        <Indicador etiqueta="Kit UP entregados" valor={items.length} icono={Boxes} retardo={120} />
        <Indicador etiqueta="Valor de la orden" valor={pesos(monto)} icono={Banknote} retardo={180} />
      </div>

      <Tarjeta titulo="Contenido de la orden">
        <Tabla
          cabeceras={['Kit UP', 'Código', { texto: 'Cantidad', alinear: 'derecha' }, { texto: 'Etiqueta', alinear: 'derecha' }]}
          vacio="Esta orden no tiene líneas."
          iconoVacio={Boxes}
        >
          {items.map((it) => (
            <Fila key={it.id}>
              <Celda className="font-semibold">{it.nombre}</Celda>
              <Celda className="font-mono text-[12px] text-gris-txt">{it.codigo_barras}</Celda>
              <Celda alinear="derecha">
                <Insignia tono="ok">{it.cantidad}</Insignia>
              </Celda>
              <Celda alinear="derecha">
                <img
                  src={urlQr(it.codigo_barras, 4)}
                  alt={`QR ${it.codigo_barras}`}
                  width="64"
                  height="64"
                  loading="lazy"
                  className="ml-auto size-16 rounded-lg border border-borde bg-white p-0.5"
                />
              </Celda>
            </Fila>
          ))}
        </Tabla>

        {orden.observaciones && (
          <Alerta tono="info" className="mt-4">
            <strong className="text-marca">Observaciones:</strong> {orden.observaciones}
          </Alerta>
        )}
      </Tarjeta>
    </>
  )
}
