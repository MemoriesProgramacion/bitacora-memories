// Facturas de compra, como un programa de facturación: encabezado con el proveedor y las fechas, una tabla de
// líneas con su total y los totales abajo.
import { useMemo, useState } from 'react'
import { FileText, Plus, Trash2, X } from 'lucide-react'
import { api, fecha, pesos } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

// Estados de entrega del proveedor contra la factura, que calcula el servidor con lo recibido en bodega.
export const ENTREGA = {
  pendiente: { texto: 'Pendiente de entrega', tono: 'alerta' },
  parcial: { texto: 'Entrega parcial', tono: 'alerta' },
  entregada: { texto: 'Entregada', tono: 'ok' },
}
import { FormularioProveedor, VACIO as PROVEEDOR_VACIO } from './Proveedores'

const LINEA = { nombre: '', descripcion: '', sku: '', cantidad: '1', valor_unitario: '', valor_impuesto: '0', bodega_id: '' }
const hoy = () => new Date().toISOString().slice(0, 10)
const subtotalLinea = (l) => (Number(l.cantidad) || 0) * (Number(l.valor_unitario) || 0)
const totalLinea = (l) => subtotalLinea(l) + (Number(l.valor_impuesto) || 0)
const documento = (p) => (p?.numero_documento ? `${p.tipo_documento} ${p.numero_documento}` : '')

// Columnas de las líneas en pantalla ancha.
const COLUMNAS = 'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_76px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.9fr)_minmax(0,1.2fr)_minmax(0,1fr)_36px] lg:items-start lg:gap-2'

// Una celda de la línea; en celular lleva su nombre encima y en pantalla ancha lo lleva el encabezado de la
// tabla.
const Celdita = ({ etiqueta, children, className = '' }) => (
  <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
    <span className="text-[12px] font-semibold text-gris-txt lg:sr-only">{etiqueta}</span>
    {children}
  </label>
)

// Muestra el formulario de factura y la lista de facturas registradas.
export default function Facturas() {
  const { datos, cargando, recargar } = useDatos('/facturas')
  const { datos: proveedores, recargar: recargarProveedores } = useDatos('/proveedores')
  const { datos: bodegas } = useDatos('/bodegas')
  const { ejecutar, ocupado } = useAccion(recargar)
  const [abierta, setAbierta] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [cab, setCab] = useState({ numero: '', proveedor_id: '', fecha: hoy(), vencimiento: hoy() })
  const [cap, setCap] = useState({ capitalizacion: false, id_unico: '', bienes_nuevos: false, entrega_pendiente: false })
  const [lineas, setLineas] = useState([{ ...LINEA }])
  const [pdf, setPdf] = useState(null)
  const [nuevoProveedor, setNuevoProveedor] = useState(null)

  const principales = (bodegas?.bodegas || []).filter((b) => b.tipo === 'principal')
  const listaProveedores = proveedores?.proveedores || []
  const proveedor = listaProveedores.find((p) => String(p.id) === cab.proveedor_id)
  const totales = useMemo(() => {
    const subtotal = lineas.reduce((s, l) => s + subtotalLinea(l), 0)
    const impuestos = lineas.reduce((s, l) => s + (Number(l.valor_impuesto) || 0), 0)
    return { subtotal, impuestos, total: subtotal + impuestos }
  }, [lineas])
  const poner = (i, campo, valor) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))

  const limpiar = () => {
    setCab({ numero: '', proveedor_id: '', fecha: hoy(), vencimiento: hoy() })
    setCap({ capitalizacion: false, id_unico: '', bienes_nuevos: false, entrega_pendiente: false })
    setLineas([{ ...LINEA }])
    setPdf(null)
  }
  const guardar = async (e) => {
    e.preventDefault()
    const f = new FormData()
    f.append('datos', JSON.stringify({ ...cab, lineas, capitalizacion: cap.capitalizacion, entrega_pendiente: cap.entrega_pendiente,
      ...(cap.capitalizacion ? { id_unico: cap.id_unico.trim(), bienes_nuevos: cap.bienes_nuevos } : {}) }))
    if (pdf) f.append('adjunto', pdf)
    const r = await ejecutar(() => api.post('/facturas', f))
    if (r) { limpiar(); setAbierta(false) }
  }
  const ver = async (f) => setDetalle(await api.get(`/facturas/${f.id}`))
  const crearProveedor = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/proveedores', nuevoProveedor))
    if (!r) return
    await recargarProveedores()
    setCab((c) => ({ ...c, proveedor_id: String(r.id) }))
    setNuevoProveedor(null)
  }

  return (
    <>
      <Encabezado titulo="Facturas" descripcion="Registra las facturas de compra y a qué bodega principal va cada mercancía." />
      {!abierta && <div className="mb-4"><Boton icono={Plus} onClick={() => setAbierta(true)}>Nueva factura</Boton></div>}

      {abierta && (
        <Tarjeta titulo="Nueva factura de compra">
          {!principales.length && <Alerta tono="aviso" className="mb-3">Primero crea una bodega principal en Bodegas.</Alerta>}
          <form onSubmit={guardar} className="grid gap-5">
            <div className="grid gap-4 border-b border-campo pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-10">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Campo etiqueta="Proveedor" obligatorio className="min-w-[240px] flex-1">
                    <Seleccion required value={cab.proveedor_id} onChange={(e) => setCab({ ...cab, proveedor_id: e.target.value })}>
                      <option value="">Elige el proveedor…</option>
                      {listaProveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </Seleccion>
                  </Campo>
                  <button type="button" onClick={() => setNuevoProveedor({ ...PROVEEDOR_VACIO })}
                    className="mb-2.5 inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-acento-txt hover:underline">
                    <Plus size={14} aria-hidden="true" /> Nuevo proveedor
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Identificación">
                    <Entrada readOnly tabIndex={-1} value={documento(proveedor)} placeholder="Se llena al elegir el proveedor" />
                  </Campo>
                  <Campo etiqueta="Teléfono">
                    <Entrada readOnly tabIndex={-1} value={proveedor?.telefono || ''} placeholder="—" />
                  </Campo>
                </div>
              </div>
              <div className="grid gap-3">
                <Campo etiqueta="Número de factura" obligatorio>
                  <Entrada required maxLength={60} value={cab.numero} onChange={(e) => setCab({ ...cab, numero: e.target.value })} />
                </Campo>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Fecha" obligatorio>
                    <Entrada required type="date" value={cab.fecha} onChange={(e) => setCab({ ...cab, fecha: e.target.value })} />
                  </Campo>
                  <Campo etiqueta="Vencimiento">
                    <Entrada type="date" min={cab.fecha} value={cab.vencimiento} onChange={(e) => setCab({ ...cab, vencimiento: e.target.value })} />
                  </Campo>
                </div>
              </div>
            </div>

            <fieldset className="grid gap-3 rounded-lg border border-campo p-4">
              <legend className="px-1 text-[13px] font-semibold text-gris-txt">Capitalización y entrega</legend>
              <label className="flex min-h-11 items-center gap-2 text-[14px]">
                <input type="checkbox" checked={cap.capitalizacion} onChange={(e) => setCap({ ...cap, capitalizacion: e.target.checked })} />
                Es una factura de capitalización de una unidad productiva
              </label>
              {cap.capitalizacion && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="ID de la unidad productiva" obligatorio ayuda="Debe tener el plan de capitalización aprobado por el comité.">
                    <Entrada required maxLength={50} value={cap.id_unico} onChange={(e) => setCap({ ...cap, id_unico: e.target.value })} />
                  </Campo>
                  <label className="flex min-h-11 items-center gap-2 self-end text-[14px]">
                    <input type="checkbox" required checked={cap.bienes_nuevos} onChange={(e) => setCap({ ...cap, bienes_nuevos: e.target.checked })} />
                    Declaro que los bienes facturados son nuevos <span className="text-rojo-txt" aria-hidden="true">*</span>
                  </label>
                </div>
              )}
              <label className="flex min-h-11 items-center gap-2 text-[14px]">
                <input type="checkbox" checked={cap.entrega_pendiente} onChange={(e) => setCap({ ...cap, entrega_pendiente: e.target.checked })} />
                La mercancía aún no llega: queda pendiente de entrega y entra al stock al recibirla en Recepción
              </label>
            </fieldset>

            <div>
              <div className={`${COLUMNAS} hidden rounded-t-lg border-b-2 border-campo bg-lienzo px-3 py-2 text-[13px] font-semibold text-gris-txt`} aria-hidden="true">
                <span>Concepto</span><span>SKU</span><span>Cant.</span><span>Valor unitario</span><span>Impuesto ($)</span>
                <span>Bodega de destino</span><span>Observaciones</span><span className="text-right">Total</span><span />
              </div>
              {lineas.map((l, i) => (
                <div key={i} className={`${COLUMNAS} grid gap-3 border-b border-campo px-3 py-3 max-lg:mb-3 max-lg:rounded-lg max-lg:border`}>
                  <Celdita etiqueta="Concepto">
                    <Entrada required maxLength={200} aria-label={`Concepto de la línea ${i + 1}`} value={l.nombre} onChange={(e) => poner(i, 'nombre', e.target.value)} />
                  </Celdita>
                  <Celdita etiqueta="SKU">
                    <Entrada required maxLength={60} aria-label={`SKU de la línea ${i + 1}`} value={l.sku} onChange={(e) => poner(i, 'sku', e.target.value)} />
                  </Celdita>
                  <Celdita etiqueta="Cantidad">
                    <Entrada required type="number" min="1" step="1" aria-label={`Cantidad de la línea ${i + 1}`} value={l.cantidad} onChange={(e) => poner(i, 'cantidad', e.target.value)} />
                  </Celdita>
                  <Celdita etiqueta="Valor unitario">
                    <Entrada required type="number" min="0" step="any" aria-label={`Valor unitario de la línea ${i + 1}`} value={l.valor_unitario} onChange={(e) => poner(i, 'valor_unitario', e.target.value)} />
                  </Celdita>
                  <Celdita etiqueta="Valor del impuesto ($)">
                    <Entrada type="number" min="0" step="any" aria-label={`Impuesto de la línea ${i + 1}`} value={l.valor_impuesto} onChange={(e) => poner(i, 'valor_impuesto', e.target.value)} />
                  </Celdita>
                  <Celdita etiqueta="Bodega principal de destino">
                    <Seleccion required aria-label={`Bodega de la línea ${i + 1}`} value={l.bodega_id} onChange={(e) => poner(i, 'bodega_id', e.target.value)}>
                      <option value="">Elige…</option>
                      {principales.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                    </Seleccion>
                  </Celdita>
                  <Celdita etiqueta="Observaciones">
                    <Entrada maxLength={1000} placeholder="Descripción" aria-label={`Observaciones de la línea ${i + 1}`} value={l.descripcion} onChange={(e) => poner(i, 'descripcion', e.target.value)} />
                  </Celdita>
                  <div className="flex items-center justify-between gap-2 lg:block lg:pt-2.5 lg:text-right">
                    <span className="text-[12px] font-semibold text-gris-txt lg:sr-only">Total de la línea</span>
                    <strong aria-label={`Total de la línea ${i + 1}`}>{pesos(totalLinea(l))}</strong>
                  </div>
                  <div className="flex justify-end lg:pt-0.5">
                    {lineas.length > 1 && (
                      <button type="button" aria-label={`Quitar la línea ${i + 1}`} title="Quitar la línea"
                        onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-acento-txt transition hover:bg-lienzo">
                        <X size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="mt-3">
                <Boton variante="fantasma" icono={Plus} onClick={() => setLineas((ls) => [...ls, { ...LINEA }])}>Agregar línea</Boton>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:gap-10">
              <Campo etiqueta="Factura en PDF (máx. 10 MB)" ayuda={pdf ? pdf.name : 'Opcional, pero recomendado.'}>
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => setPdf(e.target.files?.[0] || null)} />
              </Campo>
              <dl className="grid gap-1.5 rounded-lg border border-campo p-4 text-[14px]">
                <div className="flex justify-between"><dt className="text-gris-txt">Subtotal</dt><dd>{pesos(totales.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-gris-txt">Impuestos</dt><dd>{pesos(totales.impuestos)}</dd></div>
                <div className="mt-1 flex justify-between border-t border-campo pt-2 text-[17px] font-bold"><dt>Total</dt><dd>{pesos(totales.total)}</dd></div>
              </dl>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-campo pt-4">
              <Boton variante="fantasma" onClick={() => { limpiar(); setAbierta(false) }}>Cancelar</Boton>
              <Boton tipo="submit" cargando={ocupado} disabled={!principales.length || (cap.capitalizacion && (!cap.id_unico.trim() || !cap.bienes_nuevos))}>Registrar factura</Boton>
            </div>
          </form>
        </Tarjeta>
      )}

      <Tarjeta titulo={`Registradas (${datos?.facturas?.length ?? 0})`} className="mt-4">
        {cargando ? <Cargando /> : (
          <Tabla cabeceras={['Número', 'Proveedor', 'Unidad productiva', 'Fecha', 'Entrega', 'Líneas', { texto: 'Total', alinear: 'derecha' }, '']}
            vacio="Todavía no hay facturas." iconoVacio={FileText}>
            {(datos?.facturas || []).map((f) => (
              <Fila key={f.id}>
                <Celda etiqueta="Número"><strong>{f.numero}</strong></Celda>
                <Celda etiqueta="Proveedor">{f.proveedor || '—'}</Celda>
                <Celda etiqueta="Unidad productiva">{f.id_unico || '—'}</Celda>
                <Celda etiqueta="Fecha">{String(f.fecha).slice(0, 10)}</Celda>
                <Celda etiqueta="Entrega"><Insignia tono={ENTREGA[f.estado_entrega]?.tono}>{ENTREGA[f.estado_entrega]?.texto || '—'}</Insignia></Celda>
                <Celda etiqueta="Líneas">{f.lineas}</Celda>
                <Celda etiqueta="Total" alinear="derecha">{pesos(f.total)}</Celda>
                <Celda alinear="derecha"><Boton tamano="sm" variante="fantasma" onClick={() => ver(f)}>Ver</Boton></Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <Dialogo abierto={Boolean(nuevoProveedor)} titulo="Nuevo proveedor" onCerrar={() => setNuevoProveedor(null)} ancho="max-w-xl">
        {nuevoProveedor && (
          <FormularioProveedor valores={nuevoProveedor} onChange={setNuevoProveedor} onEnviar={crearProveedor} ocupado={ocupado} textoBoton="Guardar y usar en la factura" />
        )}
      </Dialogo>

      <Dialogo abierto={Boolean(detalle)} titulo={detalle ? `Factura ${detalle.factura.numero}` : ''} onCerrar={() => setDetalle(null)} ancho="max-w-4xl">
        {detalle && (
          <>
            <dl className="mb-4 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              <div><dt className="inline text-gris-txt">Proveedor: </dt><dd className="inline font-semibold">{detalle.factura.proveedor || '—'}</dd></div>
              <div><dt className="inline text-gris-txt">Identificación: </dt>
                <dd className="inline">{detalle.factura.proveedor_documento ? `${detalle.factura.proveedor_tipo_documento} ${detalle.factura.proveedor_documento}` : '—'}</dd></div>
              <div><dt className="inline text-gris-txt">Fecha: </dt><dd className="inline">{String(detalle.factura.fecha).slice(0, 10)}</dd></div>
              <div><dt className="inline text-gris-txt">Vencimiento: </dt><dd className="inline">{detalle.factura.vencimiento ? String(detalle.factura.vencimiento).slice(0, 10) : '—'}</dd></div>
              <div><dt className="inline text-gris-txt">Registrada: </dt><dd className="inline">{detalle.factura.creado_por || '—'} · {fecha(detalle.factura.creado)}</dd></div>
              <div><dt className="inline text-gris-txt">Unidad productiva: </dt><dd className="inline">{detalle.factura.id_unico ? `${detalle.factura.id_unico}${detalle.factura.bienes_nuevos ? ' · bienes nuevos declarados' : ''}` : 'No es de capitalización'}</dd></div>
              <div><dt className="inline text-gris-txt">Entrega del proveedor: </dt><dd className="inline"><Insignia tono={ENTREGA[detalle.factura.estado_entrega]?.tono}>{ENTREGA[detalle.factura.estado_entrega]?.texto}</Insignia></dd></div>
              {detalle.factura.tiene_adjunto && (
                <div><dt className="inline text-gris-txt">Adjunto: </dt>
                  <dd className="inline"><a className="font-semibold underline" href={`/api/inv/facturas/${detalle.factura.id}/adjunto`} target="_blank" rel="noreferrer">Ver PDF</a></dd></div>
              )}
            </dl>
            <Tabla cabeceras={['Concepto', 'Observaciones', 'SKU', 'Cant.', 'Recibido', 'V. unitario', 'Impuesto', 'Total', 'Bodega']} vacio="Sin líneas.">
              {detalle.items.map((i) => (
                <Fila key={i.id}>
                  <Celda etiqueta="Concepto">{i.nombre}</Celda>
                  <Celda etiqueta="Observaciones">{i.descripcion || '—'}</Celda>
                  <Celda etiqueta="SKU">{i.sku}</Celda>
                  <Celda etiqueta="Cantidad">{i.cantidad}</Celda>
                  <Celda etiqueta="Recibido">{i.recibido}</Celda>
                  <Celda etiqueta="V. unitario">{pesos(i.valor_unitario)}</Celda>
                  <Celda etiqueta="Impuesto">{pesos(i.valor_impuesto)}</Celda>
                  <Celda etiqueta="Total">{pesos(i.total)}</Celda>
                  <Celda etiqueta="Bodega">{i.bodega}</Celda>
                </Fila>
              ))}
            </Tabla>
            <p className="mt-3 text-right text-[16px]">Total: <strong>{pesos(detalle.factura.total)}</strong></p>
            {detalle.recepciones?.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-[13px] font-semibold text-gris-txt">Recepciones contra la factura</h4>
                <ul className="grid gap-1 text-[13px]">
                  {detalle.recepciones.map((r) => <li key={r.id}>{fecha(r.fecha)} · {r.nombre}: {r.cantidad} · {r.recibido_por || '—'}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Dialogo>
    </>
  )
}
