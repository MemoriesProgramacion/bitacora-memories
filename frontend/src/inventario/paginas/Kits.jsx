// Kits: listado con lo que se puede armar, creación y armado. Preparar un kit no descuenta artículos; la salida
// se registra en Entregas de kits.
import { useState } from 'react'
import { Boxes, Hammer, Plus, Tag, Trash2, TriangleAlert, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, fecha, urlQr } from '../lib/api'
import { useSesion } from '../lib/sesion'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import NovedadesKit from '../componentes/NovedadesKit'
import {
  Alerta, Boton, Campo, Cargando, Celda, Confirmar, EnlaceBoton, Entrada, Fila, Insignia, Seleccion,
  Tabla, Tarjeta, Vacio,
} from '../componentes/ui'

// Formulario de creación: nombre del kit y sus artículos con su cantidad.
function FormNuevoKit({ articulos, alCrear, ocupado }) {
  const [nombre, setNombre] = useState('')
  const [items, setItems] = useState([{ articulo_id: '', cantidad: '1' }])

  const fijar = (i, campo, valor) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)))

  const enviar = async (e) => {
    e.preventDefault()
    const ok = await alCrear({
      nombre,
      items: items
        .filter((x) => x.articulo_id && Number(x.cantidad) > 0)
        .map((x) => ({ articulo_id: Number(x.articulo_id), cantidad: Number(x.cantidad) })),
    })
    if (ok) {
      setNombre('')
      setItems([{ articulo_id: '', cantidad: '1' }])
    }
  }

  return (
    <form onSubmit={enviar} className="form-doble">
      <Campo etiqueta="Nombre de la unidad productiva" ayuda="Cada nombre es único: un Kit UP por unidad.">
        <Entrada
          required
          maxLength={120}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="UP_00123"
        />
      </Campo>

      <div className="ancho-total flex flex-col gap-2.5">
        <span className="text-[13px] font-semibold text-gris-txt">Artículos que lo componen</span>
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <Seleccion
              aria-label={`Artículo de la línea ${i + 1}`}
              value={it.articulo_id}
              onChange={(e) => fijar(i, 'articulo_id', e.target.value)}
              className="min-w-0 flex-1"
            >
              <option value="">Elegir artículo</option>
              {articulos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre} (stock {a.stock})
                </option>
              ))}
            </Seleccion>
            <Entrada
              type="number"
              min="1"
              aria-label={`Cantidad de la línea ${i + 1}`}
              value={it.cantidad}
              onChange={(e) => fijar(i, 'cantidad', e.target.value)}
              className="w-20 shrink-0"
            />
            {items.length > 1 && (
              <Boton
                variante="fantasma"
                className="shrink-0 px-0 max-sm:size-11 sm:size-10"
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
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
          onClick={() => setItems((xs) => [...xs, { articulo_id: '', cantidad: '1' }])}
        >
          Agregar artículo
        </Boton>
      </div>

      <Boton tipo="submit" cargando={ocupado}>Crear Kit UP</Boton>
    </form>
  )
}

// Muestra los kits con sus acciones de armar, novedades y borrado.
export default function Kits() {
  const { esAdmin } = useSesion()
  const { datos, cargando, recargar } = useDatos('/kits')
  const { ejecutar, ocupado } = useAccion(recargar)
  const [aBorrar, setABorrar] = useState(null)
  const [conNovedad, setConNovedad] = useState(null)

  const crear = async (cuerpo) => Boolean(await ejecutar(() => api.post('/kits', cuerpo)))
  const armar = (id) => ejecutar(() => api.post(`/kits/${id}/armar`))

  const borrar = async () => {
    const id = aBorrar?.id
    setABorrar(null)
    if (id) await ejecutar(() => api.del(`/kits/${id}`))
  }

  const kits = datos?.kits || []

  return (
    <>
      <Encabezado
        titulo="Kit UP"
        descripcion="Prepara el kit de cada unidad productiva. El inventario se descuenta al registrar la entrega con su responsable y adjunto."
      >
        <EnlaceBoton to="/inventario/etiquetas?tipo=combo" icono={Tag}>Imprimir etiquetas</EnlaceBoton>
        <EnlaceBoton to="/inventario/entregas-kits">Registrar entrega de kit</EnlaceBoton>
      </Encabezado>

      {datos?.aviso && <Alerta tono="aviso" className="mb-4">{datos.aviso}</Alerta>}
      {datos?.bodega && <p className="mb-4 text-[13px] text-gris-txt">Existencias de tu bodega: <strong>{datos.bodega.nombre}</strong></p>}
      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[360px_1fr] min-[1400px]:items-start">
        {esAdmin && (
          <Tarjeta titulo="Nuevo Kit UP">
            <FormNuevoKit articulos={datos?.articulos || []} alCrear={crear} ocupado={ocupado} />
          </Tarjeta>
        )}

        <div className={`min-w-0 ${esAdmin ? '' : 'xl:col-span-2'}`}>
          {cargando ? (
            <Cargando />
          ) : kits.length === 0 ? (
            <Tarjeta titulo="Kit UP registrados">
              <Vacio icono={Boxes}>Todavía no hay ningún Kit UP.</Vacio>
            </Tarjeta>
          ) : (
            <div className="grid gap-4">
              {kits.map(({ combo, armables, detalle }) => (
                <Tarjeta
                  key={combo.id}
                  titulo={combo.nombre}
                  acciones={
                    <>
                      {combo.entregado ? (
                        <Insignia tono="ok">Entregado</Insignia>
                      ) : combo.armado ? (
                        <Insignia tono="ok">{combo.descontado_al_armar ? 'Armado anterior · stock ya descontado' : 'Preparado'} {fecha(combo.armado_en)}</Insignia>
                      ) : armables >= 1 ? (
                        <Insignia tono="alerta">Alcanza para {armables}</Insignia>
                      ) : (
                        <Insignia tono="error">Stock insuficiente</Insignia>
                      )}
                      <Boton
                        variante="fantasma"
                        icono={TriangleAlert}
                        onClick={() => setConNovedad(combo)}
                        aria-label={`Novedades de ${combo.nombre}`}
                      >
                        Novedad{combo.novedades > 0 ? ` (${combo.novedades})` : ''}
                      </Boton>
                      {!combo.armado && (
                        <Boton
                          icono={Hammer}
                          onClick={() => armar(combo.id)}
                          disabled={ocupado || armables < 1}
                        >
                          Preparar Kit UP
                        </Boton>
                      )}
                      {esAdmin && !combo.armado && (
                        <Boton
                          variante="peligro"
                          icono={Trash2}
                          onClick={() => setABorrar(combo)}
                          disabled={ocupado}
                        >
                          Eliminar
                        </Boton>
                      )}
                    </>
                  }
                >
                  <div className="flex flex-col gap-5 sm:flex-row">
                    <div className="flex shrink-0 flex-col items-center gap-1.5 text-center">
                      <img
                        src={urlQr(combo.codigo_barras, 5)}
                        alt={`QR ${combo.codigo_barras}`}
                        width="112"
                        height="112"
                        loading="lazy"
                        className="size-28 rounded-xl border border-borde bg-white p-1"
                      />
                      <div className="font-mono text-[12px] text-gris-txt">{combo.codigo_barras}</div>
                      <Link
                        to={`/inventario/etiquetas?tipo=combo&id=${combo.id}`}
                        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-acento-txt hover:underline"
                      >
                        <Tag size={14} aria-hidden="true" />
                        Etiqueta del Kit UP
                      </Link>
                    </div>

                    <div className="min-w-0 flex-1">
                      <Tabla
                        cabeceras={[
                          'Artículo',
                          { texto: 'Requiere', alinear: 'derecha' },
                          { texto: 'Stock', alinear: 'derecha' },
                          { texto: 'Alcanza para', alinear: 'derecha' },
                        ]}
                        vacio="Este Kit UP no tiene artículos registrados."
                      >
                        {detalle.map((d) => (
                          <Fila key={d.art_id}>
                            <Celda>{d.nombre}</Celda>
                            <Celda alinear="derecha">{d.requiere}</Celda>
                            <Celda alinear="derecha">{d.stock}</Celda>
                            <Celda alinear="derecha">
                              <Insignia tono={d.alcanza_para === 0 ? 'error' : 'neutro'}>
                                {d.alcanza_para}
                              </Insignia>
                            </Celda>
                          </Fila>
                        ))}
                      </Tabla>
                    </div>
                  </div>
                </Tarjeta>
              ))}
            </div>
          )}
        </div>
      </div>

      {conNovedad && <NovedadesKit kit={conNovedad} onCerrar={() => setConNovedad(null)} alCambiar={recargar} />}

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="¿Eliminar Kit UP?"
        texto={`Se eliminará "${aBorrar?.nombre}" y sus líneas. Solo se puede si aún no está armado.`}
        onOk={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </>
  )
}
