// Traslados entre bodegas con un único formulario. La API compartida conserva la validación de permisos,
// existencias y registro de movimientos.
import { useEffect, useState } from 'react'
import { ArrowRightLeft, History, Plus, Search, Trash2 } from 'lucide-react'
import { api, fecha } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Celda, Entrada, Fila, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

const ITEM = { articulo_id: '', cantidad: '1' }
const VACIO = { origen_id: '', destino_id: '', nota: '' }
const COLUMNAS = 'lg:grid lg:grid-cols-[32px_minmax(0,3fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_44px] lg:items-start lg:gap-3'
const numero = (n) => Number(n || 0).toLocaleString('es-CO')
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' })
const normalizar = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Celda de la tabla de líneas del traslado.
function CeldaFormulario({ etiqueta, children, className = '' }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-semibold text-gris-txt lg:sr-only">{etiqueta}</span>
      {children}
    </label>
  )
}

// Muestra el formulario de traslado y la lista de traslados.
export default function Traslados() {
  const { datos, cargando, recargar } = useDatos('/traslados')
  const { datos: bod, recargar: recargarBodegas } = useDatos('/bodegas')
  const { ejecutar, ocupado } = useAccion(() => Promise.all([recargar(), recargarBodegas()]))
  const [vista, setVista] = useState('formulario')
  const [f, setF] = useState({ ...VACIO })
  const [items, setItems] = useState([{ ...ITEM }])
  const [existencias, setExistencias] = useState([])
  const [cargandoExistencias, setCargandoExistencias] = useState(false)
  const [errorExistencias, setErrorExistencias] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const bodegas = bod?.bodegas || []
  const traslados = datos?.traslados || []
  const unidades = items.reduce((total, item) => total + (item.articulo_id ? Number(item.cantidad) || 0 : 0), 0)
  const productos = existencias.filter((e) => normalizar(`${e.nombre} ${e.sku || ''}`).includes(normalizar(busqueda.trim())))

  useEffect(() => {
    let vigente = true
    setItems([{ ...ITEM }])
    setExistencias([])
    setBusqueda('')
    setErrorExistencias('')
    setCargandoExistencias(Boolean(f.origen_id))
    if (f.origen_id) {
      api.get(`/bodegas/${f.origen_id}`)
        .then((r) => { if (vigente) setExistencias(r.existencias) })
        .catch((e) => { if (vigente) setErrorExistencias(e.message || 'No se pudieron cargar las existencias.') })
        .finally(() => { if (vigente) setCargandoExistencias(false) })
    }
    return () => { vigente = false }
  }, [f.origen_id])

  const poner = (i, campo, valor) => setItems((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  const limpiar = () => {
    setF({ ...VACIO })
    setItems([{ ...ITEM }])
    setBusqueda('')
  }
  const guardar = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/traslados', { ...f, items }))
    if (r) { limpiar(); setVista('historial') }
  }

  return (
    <>
      <Encabezado titulo="Traslados" descripcion="Notas de traslado de inventario entre bodegas.">
        <Boton variante="fantasma" icono={vista === 'formulario' ? History : Plus} disabled={ocupado}
          onClick={() => setVista(vista === 'formulario' ? 'historial' : 'formulario')}>
          {vista === 'formulario' ? 'Ver historial' : 'Nueva nota de traslado'}
        </Boton>
      </Encabezado>

      {vista === 'formulario' ? (
        <Tarjeta titulo="Nueva nota de traslado entre bodegas">
          <form onSubmit={guardar}>
            <fieldset disabled={ocupado} className="m-0 grid min-w-0 gap-5 border-0 p-0">
              {bod && bodegas.length < 2 && (
                <Alerta tono="aviso">Para registrar un traslado necesitas al menos dos bodegas activas. Créalas en Bodegas.</Alerta>
              )}

              <div className="grid gap-4 border-b border-campo pb-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_minmax(0,1fr)]">
                <Campo etiqueta="Fecha de elaboración" ayuda="Se asigna al registrar la nota.">
                  <Entrada type="date" readOnly value={hoy()} />
                </Campo>
                <Campo etiqueta="Sale de · Bodega de origen" obligatorio>
                  <Seleccion required value={f.origen_id} onChange={(e) => setF({ ...f, origen_id: e.target.value,
                    destino_id: e.target.value === f.destino_id ? '' : f.destino_id })}>
                    <option value="">Elige la bodega de origen…</option>
                    {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </Seleccion>
                </Campo>
                <Campo etiqueta="Entra a · Bodega de destino" obligatorio>
                  <Seleccion required value={f.destino_id} onChange={(e) => setF({ ...f, destino_id: e.target.value })}>
                    <option value="">Elige la bodega de destino…</option>
                    {bodegas.filter((b) => String(b.id) !== f.origen_id).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                  </Seleccion>
                </Campo>
              </div>

              <div className="min-w-0">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-marca">Productos a trasladar</h3>
                    <p className="mt-1 text-[13px] text-gris-txt">Las cantidades disponibles corresponden a la bodega de origen.</p>
                  </div>
                  <Campo etiqueta="Buscar producto" className="sm:w-72">
                    <div className="relative">
                      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gris" />
                      <Entrada type="search" className="pl-9" placeholder="Nombre o SKU" value={busqueda}
                        disabled={!existencias.length} onChange={(e) => setBusqueda(e.target.value)} />
                    </div>
                  </Campo>
                </div>

                {cargandoExistencias && <div className="mb-3" role="status">Cargando existencias…</div>}
                {errorExistencias && <Alerta tono="error" className="mb-3">{errorExistencias}</Alerta>}
                {f.origen_id && !cargandoExistencias && !errorExistencias && !existencias.length && (
                  <Alerta tono="aviso" className="mb-3">La bodega de origen no tiene productos disponibles para trasladar.</Alerta>
                )}
                {busqueda.trim() && existencias.length > 0 && !productos.length && (
                  <p className="mb-3 text-[13px] text-gris-txt" role="status">No hay productos que coincidan con la búsqueda.</p>
                )}

                <div className={`${COLUMNAS} hidden rounded-t-lg border-b-2 border-campo bg-lienzo px-3 py-2 text-[13px] font-semibold text-gris-txt`} aria-hidden="true">
                  <span>#</span><span>Producto</span><span>Código / SKU</span><span className="text-right">Disponible</span>
                  <span>Cant. a trasladar</span><span />
                </div>
                {items.map((l, i) => {
                  const articulo = existencias.find((e) => String(e.id) === l.articulo_id)
                  return (
                    <div key={i} className={`${COLUMNAS} grid gap-3 border-b border-borde px-3 py-4 max-lg:mb-3 max-lg:rounded-lg max-lg:border max-lg:sm:grid-cols-2`}>
                      <span className="pt-2 text-[13px] font-semibold text-gris-txt max-lg:sm:col-span-2">
                        <span className="lg:sr-only">Producto </span>{i + 1}
                      </span>
                      <CeldaFormulario etiqueta="Producto" className="max-lg:sm:col-span-2">
                        <Seleccion required aria-label={`Producto ${i + 1}`} value={l.articulo_id}
                          disabled={!existencias.length || cargandoExistencias}
                          onChange={(e) => poner(i, 'articulo_id', e.target.value)}>
                          <option value="">{f.origen_id ? 'Elige el producto…' : 'Elige primero la bodega de origen'}</option>
                          {existencias.filter((e) => productos.includes(e) || String(e.id) === l.articulo_id).map((e) => (
                            <option key={e.id} value={e.id} disabled={items.some((item, j) => j !== i && item.articulo_id === String(e.id))}>
                              {e.nombre}{e.sku ? ` · ${e.sku}` : ''}
                            </option>
                          ))}
                        </Seleccion>
                      </CeldaFormulario>
                      <CeldaFormulario etiqueta="Código / SKU">
                        <Entrada readOnly aria-label={`SKU del producto ${i + 1}`} value={articulo?.sku || ''} placeholder="—" />
                      </CeldaFormulario>
                      <CeldaFormulario etiqueta="Disponible">
                        <Entrada readOnly aria-label={`Disponible del producto ${i + 1}`} className="text-right"
                          value={articulo ? numero(articulo.cantidad) : ''} placeholder="—" />
                      </CeldaFormulario>
                      <CeldaFormulario etiqueta="Cantidad a trasladar">
                        <Entrada required type="number" min="1" max={articulo?.cantidad} step="1"
                          aria-label={`Cantidad ${i + 1}`} value={l.cantidad} onChange={(e) => poner(i, 'cantidad', e.target.value)} />
                      </CeldaFormulario>
                      <div className="flex justify-end">
                        <Boton variante="fantasma" tamano="sm" icono={Trash2} disabled={items.length === 1}
                          aria-label={`Quitar el producto ${i + 1}`} title="Quitar producto"
                          onClick={() => setItems((ls) => ls.filter((_, j) => j !== i))} />
                      </div>
                    </div>
                  )
                })}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <Boton variante="fantasma" icono={Plus} disabled={!existencias.length || items.length >= existencias.length || items.length >= 200}
                    onClick={() => setItems((ls) => [...ls, { ...ITEM }])}>Agregar producto</Boton>
                  <p className="text-[13px] text-gris-txt" aria-live="polite">
                    Total a trasladar: <strong className="text-marca">{numero(unidades)} unidades</strong>
                  </p>
                </div>
              </div>

              <Campo etiqueta="Observaciones" obligatorio className="lg:max-w-3xl" ayuda="Indica el motivo del traslado, quién recibe y los datos del transporte.">
                <AreaTexto required maxLength={2000} rows={4} placeholder="Escribe la nota del traslado…"
                  value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
              </Campo>

              <div className="flex flex-wrap justify-end gap-3 border-t border-borde pt-5">
                <Boton variante="fantasma" onClick={limpiar}>Limpiar formulario</Boton>
                <Boton tipo="submit" icono={ArrowRightLeft} cargando={ocupado}
                  disabled={!f.origen_id || !f.destino_id || cargandoExistencias || !existencias.length || items.some((l) => !l.articulo_id)}>
                  Registrar traslado
                </Boton>
              </div>
            </fieldset>
          </form>
        </Tarjeta>
      ) : (
        <Tarjeta titulo={`Historial de traslados (${traslados.length})`}>
          {cargando ? <Cargando /> : (
            <Tabla cabeceras={['Comprobante', 'Fecha', 'Origen → destino', 'Artículos', 'Observaciones', 'Por']} vacio="Todavía no hay traslados." iconoVacio={ArrowRightLeft}>
              {traslados.map((t) => (
                <Fila key={t.id}>
                  <Celda etiqueta="Comprobante"><strong>Traslado {String(t.id).padStart(5, '0')}</strong></Celda>
                  <Celda etiqueta="Fecha">{fecha(t.fecha)}</Celda>
                  <Celda etiqueta="Ruta">{t.origen} → {t.destino}</Celda>
                  <Celda etiqueta="Artículos">{(t.items || []).map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}</Celda>
                  <Celda etiqueta="Observaciones">{t.nota}</Celda>
                  <Celda etiqueta="Por">{t.creado_por || '—'}</Celda>
                </Fila>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      )}
    </>
  )
}
