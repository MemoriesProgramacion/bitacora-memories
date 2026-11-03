// Detalle de un lote de pedido, con dos formas de verlo: agrupado por código o por unidad productiva.
import { useState } from 'react'
import { ArrowLeft, Boxes, CircleDollarSign, FileText, Hash, Layers } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { fecha, pesos, urlPdfPedido } from '../lib/api'
import { useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, Boton, Cargando, Celda, EnlaceBoton, Fila, Indicador, Tabla, Tarjeta,
} from '../componentes/ui'

// Columnas que sirven tanto para el resumen general como para el desglose de cada unidad.
const CABECERAS = [
  'Código', 'Artículo', 'Tipo',
  { texto: 'Cant.', alinear: 'derecha' },
  { texto: 'Precio', alinear: 'derecha' },
  { texto: 'Subtotal', alinear: 'derecha' },
]

// Pide el lote y lo muestra en la vista elegida.
export default function PedidoVer() {
  const { id } = useParams()
  const { datos, cargando } = useDatos(`/pedidos/${id}`)
  const [vista, setVista] = useState('resumen')

  if (cargando) return <Cargando />
  if (!datos) return null

  const { lote, resumen, grupos, totales } = datos

  return (
    <>
      <Encabezado titulo={lote.nombre} descripcion={`Orden de pedido, cargada el ${fecha(lote.creado)}`}>
        <EnlaceBoton to="/inventario/pedidos" icono={ArrowLeft}>Volver</EnlaceBoton>
        <EnlaceBoton
          href={urlPdfPedido(lote.id)}
          target="_blank"
          rel="noopener noreferrer"
          variante="oscuro"
          icono={FileText}
        >
          Ver PDF
        </EnlaceBoton>
      </Encabezado>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Indicador etiqueta="Unidades productivas" valor={totales.unidades} icono={Layers} retardo={0} />
        <Indicador etiqueta="Códigos distintos" valor={totales.codigos} icono={Hash} retardo={60} />
        <Indicador etiqueta="Unidades totales" valor={totales.cantidad} icono={Boxes} retardo={120} />
        <Indicador etiqueta="Valor total" valor={pesos(totales.valor)} icono={CircleDollarSign} retardo={180} />
      </div>
      {totales.alertas > 0 && (
        <Alerta tono="aviso" className="mb-5">
          Hay {totales.alertas} diferencia(s) con los planes de capitalización aprobados. Revísalas en «Desglose por unidad productiva».
        </Alerta>
      )}

      <Tarjeta
        titulo={vista === 'resumen' ? 'Resumen general (agrupado por código)' : 'Desglose por unidad productiva'}
        acciones={
          <div role="group" aria-label="Vista" className="flex gap-1.5">
            <Boton
              variante={vista === 'resumen' ? 'principal' : 'fantasma'}
              aria-pressed={vista === 'resumen'}
              onClick={() => setVista('resumen')}
            >
              Resumen
            </Boton>
            <Boton
              variante={vista === 'up' ? 'principal' : 'fantasma'}
              aria-pressed={vista === 'up'}
              onClick={() => setVista('up')}
            >
              Por unidad
            </Boton>
          </div>
        }
      >
        {vista === 'resumen' ? (
          <Tabla cabeceras={CABECERAS} vacio="El lote no tiene ítems.">
            {resumen.map((r, i) => (
              <Fila key={`${r.codigo}-${i}`}>
                <Celda className="font-mono text-[12px] text-gris-txt">{r.codigo || '—'}</Celda>
                <Celda>{r.nombre}</Celda>
                <Celda className="text-gris-txt">{r.tipo}</Celda>
                <Celda alinear="derecha">{r.cantidad}</Celda>
                <Celda alinear="derecha" className="whitespace-nowrap">{pesos(r.precio)}</Celda>
                <Celda alinear="derecha" className="whitespace-nowrap font-semibold">
                  {pesos(r.subtotal)}
                </Celda>
              </Fila>
            ))}
          </Tabla>
        ) : (
          <div className="flex flex-col gap-6">
            {grupos.map((g) => (
              <div key={g.num_documento}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-[15px] font-semibold text-marca">UP_{g.num_documento}</h3>
                  <span className="rounded-full border border-acento-borde bg-acento-bg px-3 py-1 text-[13px] font-semibold text-acento-txt">
                    Subtotal {pesos(g.subtotal)}
                  </span>
                </div>
                {g.alertas?.length > 0 && (
                  <Alerta tono="aviso" className="mb-2">
                    <strong>Frente al plan aprobado:</strong>
                    <ul className="mt-1 list-disc pl-5">{g.alertas.map((a, i) => <li key={`${i}-${a}`}>{a}</li>)}</ul>
                  </Alerta>
                )}
                <Tabla cabeceras={CABECERAS}>
                  {g.items.map((it, i) => (
                    <Fila key={i}>
                      <Celda className="font-mono text-[12px] text-gris-txt">{it.codigo || '—'}</Celda>
                      <Celda>{it.nombre}</Celda>
                      <Celda className="text-gris-txt">{it.tipo}</Celda>
                      <Celda alinear="derecha">{it.cantidad}</Celda>
                      <Celda alinear="derecha" className="whitespace-nowrap">{pesos(it.precio)}</Celda>
                      <Celda alinear="derecha" className="whitespace-nowrap font-semibold">
                        {pesos(it.subtotal)}
                      </Celda>
                    </Fila>
                  ))}
                </Tabla>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </>
  )
}
