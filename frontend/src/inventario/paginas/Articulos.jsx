// Catálogo de artículos: búsqueda con paginación, alta, ajuste de stock y baja. La búsqueda y la página viven
// en la dirección.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, PackageSearch, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { api, pesos, qs } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Boton, Campo, Cargando, Celda, Confirmar, Dialogo, EnlaceBoton, Entrada, Fila, Insignia,
  Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'
import CampoUnspsc from '../../sections/capitalizacion/CampoUnspsc'

// Artículo en blanco para el formulario de alta.
const VACIO = { nombre: '', codigo_proveedor: '', proveedor_id: '', precio: '', minimo: '0', unspsc: '' }

// Muestra la lista de artículos con su formulario de alta y sus acciones.
export default function Articulos() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const pagina = Number(params.get('pagina') || 1)

  const ruta = useMemo(() => `/articulos${qs({ q, pagina: pagina > 1 ? pagina : '' })}`, [q, pagina])
  const { datos, cargando, recargar } = useDatos(ruta)
  const { ejecutar, ocupado } = useAccion(recargar)

  const [nuevo, setNuevo] = useState(VACIO)
  const [busqueda, setBusqueda] = useState(q)
  const [aBorrar, setABorrar] = useState(null)
  const [ajuste, setAjuste] = useState({})
  const [aClasificar, setAClasificar] = useState(null)

  const clasificar = async () => {
    const { id, unspsc } = aClasificar
    const r = await ejecutar(() => api.patch(`/articulos/${id}/unspsc`, { unspsc: unspsc.trim() || null }))
    if (r) setAClasificar(null)
  }

  const crear = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/articulos', nuevo))
    if (r) setNuevo(VACIO)
  }

  const buscar = (e) => {
    e.preventDefault()
    setParams(busqueda ? { q: busqueda } : {})
  }

  const guardarAjuste = async (id) => {
    const valor = ajuste[id]
    if (valor === undefined || valor === '') return
    const r = await ejecutar(() => api.post(`/articulos/${id}/ajuste`, { stock: valor }))
    if (r) setAjuste((a) => ({ ...a, [id]: '' }))
  }

  const borrar = async () => {
    const id = aBorrar?.id
    setABorrar(null)
    if (id) await ejecutar(() => api.del(`/articulos/${id}`))
  }

  const irPagina = (n) => {
    const p = { ...(q ? { q } : {}) }
    if (n > 1) p.pagina = String(n)
    setParams(p)
  }

  const total = datos?.total ?? 0
  const totalPaginas = datos?.total_paginas ?? 1

  return (
    <>
      <Encabezado titulo="Artículos" descripcion={`${total} artículo(s) activos en el catálogo.`}>
        <EnlaceBoton to="/inventario/etiquetas?tipo=articulo" icono={Tag}>Imprimir etiquetas</EnlaceBoton>
      </Encabezado>

      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[340px_1fr] min-[1400px]:items-start">
        <Tarjeta titulo="Nuevo artículo">
          <form onSubmit={crear} className="form-doble">
            <Campo etiqueta="Nombre">
              <Entrada
                required
                maxLength={200}
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Proveedor">
              <Seleccion
                value={nuevo.proveedor_id}
                onChange={(e) => setNuevo({ ...nuevo, proveedor_id: e.target.value })}
              >
                <option value="">Sin proveedor</option>
                {(datos?.proveedores || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Código del proveedor" ayuda="Opcional. Sirve para buscar con el lector.">
              <Entrada
                maxLength={60}
                value={nuevo.codigo_proveedor}
                onChange={(e) => setNuevo({ ...nuevo, codigo_proveedor: e.target.value })}
              />
            </Campo>
            <CampoUnspsc valor={nuevo.unspsc} onCambio={(v) => setNuevo({ ...nuevo, unspsc: v })} ayuda="Opcional. Clase de 6 dígitos del catálogo UNSPSC." />
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Precio">
                <Entrada
                  inputMode="decimal"
                  placeholder="0"
                  value={nuevo.precio}
                  onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
                />
              </Campo>
              <Campo etiqueta="Mínimo">
                <Entrada
                  type="number"
                  min="0"
                  value={nuevo.minimo}
                  onChange={(e) => setNuevo({ ...nuevo, minimo: e.target.value })}
                />
              </Campo>
            </div>
            <Boton tipo="submit" icono={Plus} cargando={ocupado}>Crear artículo</Boton>
            <p className="text-[12px] text-gris">
              El código de barras (ART000000) se asigna solo al guardar.
            </p>
          </form>
        </Tarjeta>

        <Tarjeta
          titulo="Catálogo"
          acciones={
            <form onSubmit={buscar} className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
              <Entrada
                type="search"
                maxLength={100}
                aria-label="Buscar por nombre o código"
                placeholder="Buscar por nombre o código…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="min-w-0 flex-1 sm:w-64 sm:flex-none"
              />
              <Boton tipo="submit" variante="fantasma" icono={Search} aria-label="Buscar">
                <span className="max-sm:sr-only">Buscar</span>
              </Boton>
              {q && (
                <Boton
                  variante="fantasma"
                  icono={X}
                  onClick={() => { setBusqueda(''); setParams({}) }}
                >
                  Limpiar
                </Boton>
              )}
            </form>
          }
        >
          {cargando ? (
            <Cargando />
          ) : (
            <>
              <Tabla
                cabeceras={[
                  'Artículo',
                  { texto: 'Precio', alinear: 'derecha' },
                  { texto: 'Stock', alinear: 'derecha' },
                  { texto: 'Ajustar stock', alinear: 'derecha' },
                  { texto: '', alinear: 'derecha' },
                ]}
                vacio={q ? 'Ningún artículo coincide con la búsqueda.' : 'Todavía no hay artículos. Crea el primero con el formulario.'}
                iconoVacio={PackageSearch}
              >
                {(datos?.articulos || []).map((a) => (
                  <Fila key={a.id}>
                    <Celda>
                      <div className="font-semibold">{a.nombre}</div>
                      <div className="font-mono text-[12px] text-gris-txt">{a.codigo_barras}</div>
                      <div className="text-[12px] text-gris">
                        {a.prov_nombre || 'Sin proveedor'}
                        {a.codigo_proveedor ? ` · cód. ${a.codigo_proveedor}` : ''}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-gris-txt">
                        {a.unspsc ? <span>UNSPSC {a.unspsc}</span> : <Insignia tono="alerta">Sin clase UNSPSC</Insignia>}
                        <button type="button" className="font-semibold text-marca underline disabled:opacity-50" disabled={ocupado}
                          onClick={() => setAClasificar({ id: a.id, nombre: a.nombre, unspsc: a.unspsc?.trim() || '' })}>
                          Clasificar
                        </button>
                      </div>
                    </Celda>
                    <Celda alinear="derecha" className="whitespace-nowrap">{pesos(a.precio)}</Celda>
                    <Celda alinear="derecha">
                      <Insignia
                        tono={
                          a.minimo > 0 && a.stock <= a.minimo
                            ? a.stock === 0 ? 'error' : 'alerta'
                            : 'neutro'
                        }
                      >
                        {a.stock}
                      </Insignia>
                      <div className="mt-1 text-[12px] text-gris">Mínimo {a.minimo}</div>
                    </Celda>
                    <Celda alinear="derecha">
                      <div className="flex items-center justify-end gap-1.5">
                        <Entrada
                          type="number"
                          min="0"
                          aria-label={`Nuevo stock de ${a.nombre}`}
                          placeholder={String(a.stock)}
                          value={ajuste[a.id] ?? ''}
                          onChange={(e) => setAjuste({ ...ajuste, [a.id]: e.target.value })}
                          className="w-24"
                        />
                        <Boton
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => guardarAjuste(a.id)}
                          disabled={ocupado || !(ajuste[a.id] ?? '')}
                        >
                          Ajustar
                        </Boton>
                      </div>
                    </Celda>
                    <Celda alinear="derecha">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <EnlaceBoton
                          to={`/inventario/etiquetas?tipo=articulo&id=${a.id}`}
                          tamano="sm"
                          icono={Tag}
                          title="Imprimir la etiqueta de este artículo"
                        >
                          <span className="min-[1400px]:max-[1535px]:sr-only">Etiqueta</span>
                        </EnlaceBoton>
                        <Boton
                          variante="peligro"
                          tamano="sm"
                          icono={Trash2}
                          title="Eliminar este artículo"
                          onClick={() => setABorrar(a)}
                          disabled={ocupado}
                        >
                          <span className="min-[1400px]:max-[1535px]:sr-only">Eliminar</span>
                        </Boton>
                      </div>
                    </Celda>
                  </Fila>
                ))}
              </Tabla>

              {totalPaginas > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4 text-[13px] text-gris-txt">
                  <span>Página {pagina} de {totalPaginas}</span>
                  <div className="flex gap-2">
                    <Boton variante="fantasma" icono={ChevronLeft} disabled={pagina <= 1} onClick={() => irPagina(pagina - 1)}>
                      Anterior
                    </Boton>
                    <Boton
                      variante="fantasma"
                      disabled={pagina >= totalPaginas}
                      onClick={() => irPagina(pagina + 1)}
                    >
                      Siguiente
                      <ChevronRight size={16} aria-hidden="true" />
                    </Boton>
                  </div>
                </div>
              )}
            </>
          )}
        </Tarjeta>
      </div>

      <Dialogo abierto={Boolean(aClasificar)} titulo={`Clase UNSPSC de ${aClasificar?.nombre || ''}`} onCerrar={() => setAClasificar(null)}>
        {aClasificar && (
          <div className="flex flex-col gap-4">
            <CampoUnspsc valor={aClasificar.unspsc} onCambio={(v) => setAClasificar((x) => ({ ...x, unspsc: v }))} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Boton variante="fantasma" onClick={() => setAClasificar(null)}>Cancelar</Boton>
              <Boton cargando={ocupado} onClick={clasificar}>Guardar</Boton>
            </div>
          </div>
        )}
      </Dialogo>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="¿Eliminar artículo?"
        texto={`"${aBorrar?.nombre}" desaparecerá de las listas. Su historial de movimientos se conserva.`}
        onOk={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </>
  )
}
