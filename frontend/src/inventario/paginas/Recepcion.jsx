// Recepción de mercancía: se marcan las cantidades que llegan, a mano o escaneando, y se registra la entrada de
// un proveedor.
import { useCallback, useMemo, useRef, useState } from 'react'
import { PackageCheck, Plus, ScanBarcode, Search } from 'lucide-react'
import { api } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import EscanerCamara from '../componentes/EscanerCamara'
import RecepcionFacturas from './RecepcionFacturas'
import {
  Boton, Campo, Cargando, Celda, Entrada, Fila, Insignia, Seleccion,
  Tabla, Tarjeta, useAvisos,
} from '../componentes/ui'

// Muestra la lista de artículos con el escáner y registra la recepción.
export default function Recepcion() {
  const { datos, cargando, recargar } = useDatos('/recepcion')
  const { ejecutar, ocupado } = useAccion(recargar)
  const { avisar } = useAvisos()

  const [proveedorId, setProveedorId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [lineas, setLineas] = useState({})
  const [codigo, setCodigo] = useState('')
  const [filtro, setFiltro] = useState('')
  const refLector = useRef(null)

  const articulos = datos?.articulos || []

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase()
    if (!t) return articulos
    return articulos.filter(
      (a) =>
        a.nombre.toLowerCase().includes(t) ||
        (a.codigo_barras || '').toLowerCase().includes(t) ||
        (a.codigo_proveedor || '').toLowerCase().includes(t),
    )
  }, [articulos, filtro])

  const fijar = (id, campo, valor) =>
    setLineas((ls) => ({ ...ls, [id]: { ...(ls[id] || {}), [campo]: valor } }))

  const conCantidad = Object.entries(lineas).filter(([, v]) => Number(v?.cantidad) > 0)

  const sumarPorCodigo = useCallback(
    async (code, { devolverFoco = true } = {}) => {
      const limpio = (code || '').trim()
      if (!limpio) return
      try {
        const r = await api.get(`/recepcion/buscar?code=${encodeURIComponent(limpio)}`)
        if (!r.encontrado) {
          avisar(`No se encontró ningún artículo con el código "${limpio}".`, 'error')
          return
        }
        setLineas((ls) => {
          const actual = Number(ls[r.id]?.cantidad || 0)
          avisar(`${r.nombre}: ${actual + 1} unidad(es) por recibir.`)
          return { ...ls, [r.id]: { ...(ls[r.id] || {}), cantidad: String(actual + 1) } }
        })
      } catch (err) {
        avisar(err.message, 'error')
      } finally {
        if (devolverFoco) refLector.current?.focus()
      }
    },
    [avisar],
  )

  const escanear = (e) => {
    e.preventDefault()
    const code = codigo
    setCodigo('')
    sumarPorCodigo(code)
  }

  const desdeCamara = useCallback(
    (code) => sumarPorCodigo(code, { devolverFoco: false }),
    [sumarPorCodigo],
  )

  const registrar = async () => {
    const cuerpo = {
      proveedor_id: proveedorId,
      referencia,
      lineas: conCantidad.map(([id, v]) => ({
        articulo_id: Number(id),
        cantidad: Number(v.cantidad),
        codigo_proveedor: v.codigo_proveedor || '',
      })),
    }
    const r = await ejecutar(() => api.post('/recepcion', cuerpo))
    if (r) {
      setLineas({})
      setReferencia('')
    }
  }

  return (
    <>
      <Encabezado
        titulo="Recepción de mercancía"
        descripcion="Escanea o escribe las cantidades que llegan y registra la entrada."
      >
        <Boton
          icono={PackageCheck}
          cargando={ocupado}
          onClick={registrar}
          disabled={conCantidad.length === 0 || !proveedorId}
        >
          Registrar recepción ({conCantidad.length})
        </Boton>
      </Encabezado>

      <div className="mb-5"><RecepcionFacturas onRecibido={recargar} /></div>

      <div className="mb-5 grid gap-4 sm:gap-5 xl:grid-cols-2">
        <Tarjeta titulo="Datos de la entrada">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Proveedor" ayuda="Obligatorio: toda entrada debe decir de quién llegó.">
              <Seleccion value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} required>
                <option value="">Selecciona el proveedor</option>
                {(datos?.proveedores || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Referencia" ayuda="Número de factura o remisión (opcional).">
              <Entrada maxLength={100} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Lector de códigos">
          <form onSubmit={escanear} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
            <Campo
              etiqueta="Escanea o escribe un código"
              ayuda="Cada lectura suma una unidad al artículo. Sirve QR y código de barras."
              className="min-w-0 flex-1 max-sm:basis-full"
            >
              <Entrada
                ref={refLector}
                autoFocus
                maxLength={64}
                autoComplete="off"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="ART000123"
              />
            </Campo>
            <Boton tipo="submit" variante="oscuro" icono={ScanBarcode} className="max-sm:w-full sm:mb-[22px]">
              Sumar
            </Boton>
          </form>
          <div className="mt-4">
            <EscanerCamara onCodigo={desdeCamara} />
          </div>
        </Tarjeta>
      </div>

      <Tarjeta
        titulo="Artículos"
        acciones={
          <div className="relative w-full sm:w-72">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris"
            />
            <Entrada
              type="search"
              aria-label="Filtrar la lista de artículos"
              placeholder="Filtrar la lista…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="pl-10"
            />
          </div>
        }
      >
        {cargando ? (
          <Cargando />
        ) : (
          <Tabla
            cabeceras={[
              'Artículo', 'Proveedor',
              { texto: 'Stock actual', alinear: 'derecha' },
              { texto: 'Código del proveedor', alinear: 'derecha' },
              { texto: 'Cantidad que llega', alinear: 'derecha' },
            ]}
            vacio="No hay artículos activos. Créalos primero en la sección Artículos."
            iconoVacio={Plus}
          >
            {visibles.map((a) => {
              const ln = lineas[a.id] || {}
              const activa = Number(ln.cantidad) > 0
              return (
                <Fila key={a.id} className={activa ? 'bg-acento-bg/70 hover:bg-acento-bg' : ''}>
                  <Celda>
                    <div className="font-semibold">{a.nombre}</div>
                    <div className="font-mono text-[12px] text-gris-txt">{a.codigo_barras}</div>
                  </Celda>
                  <Celda className="text-gris-txt">{a.prov_nombre || '—'}</Celda>
                  <Celda alinear="derecha">
                    <Insignia tono={a.stock === 0 ? 'error' : 'neutro'}>{a.stock}</Insignia>
                  </Celda>
                  <Celda alinear="derecha">
                    <Entrada
                      placeholder="opcional"
                      maxLength={60}
                      aria-label={`Código del proveedor para ${a.nombre}`}
                      value={ln.codigo_proveedor ?? ''}
                      onChange={(e) => fijar(a.id, 'codigo_proveedor', e.target.value)}
                      className="w-36"
                    />
                  </Celda>
                  <Celda alinear="derecha">
                    <Entrada
                      type="number"
                      min="0"
                      max="1000000"
                      inputMode="numeric"
                      aria-label={`Cantidad que llega de ${a.nombre}`}
                      value={ln.cantidad ?? ''}
                      onChange={(e) => fijar(a.id, 'cantidad', e.target.value)}
                      className="w-24"
                    />
                  </Celda>
                </Fila>
              )
            })}
          </Tabla>
        )}
      </Tarjeta>
    </>
  )
}
