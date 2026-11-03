// Alta, ficha y edición de proveedores, con su documento, su contacto y sus facturas.
import { useState } from 'react'
import { Eye, FileText, Pencil, Plus, Truck } from 'lucide-react'
import { api, fecha, pesos } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

export const VACIO = {
  nombre: '', tipo_documento: 'NIT', numero_documento: '', contacto: '', telefono: '', correo: '',
  direccion: '', municipio: '', departamento: '',
}
const TIPOS = { NIT: 'NIT', CC: 'Cédula', CE: 'Céd. extranjería', PASAPORTE: 'Pasaporte' }
const documento = (p) => (p.numero_documento ? `${TIPOS[p.tipo_documento] || p.tipo_documento} ${p.numero_documento}` : '')

// Formulario de un proveedor, que sirve para crear y para editar.
export function FormularioProveedor({ valores, onChange, onEnviar, ocupado, textoBoton }) {
  const poner = (campo) => (e) => onChange({ ...valores, [campo]: e.target.value })
  return (
    <form onSubmit={onEnviar} className="form-doble">
      <Campo etiqueta="Nombre o razón social" obligatorio>
        <Entrada required maxLength={120} value={valores.nombre} onChange={poner('nombre')} />
      </Campo>
      <div className="grid grid-cols-[130px_1fr] gap-2">
        <Campo etiqueta="Documento" obligatorio>
          <Seleccion value={valores.tipo_documento} onChange={poner('tipo_documento')}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Número" obligatorio ayuda={valores.tipo_documento === 'NIT' ? 'Con dígito de verificación: 900123456-7' : undefined}>
          <Entrada required maxLength={20} value={valores.numero_documento} onChange={poner('numero_documento')} />
        </Campo>
      </div>
      <Campo etiqueta="Persona de contacto" obligatorio>
        <Entrada required maxLength={120} value={valores.contacto} onChange={poner('contacto')} />
      </Campo>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo etiqueta="Teléfono de contacto" obligatorio>
          <Entrada required type="tel" maxLength={20} value={valores.telefono} onChange={poner('telefono')} />
        </Campo>
        <Campo etiqueta="Correo electrónico" obligatorio>
          <Entrada required type="email" maxLength={150} value={valores.correo} onChange={poner('correo')} />
        </Campo>
      </div>
      <Campo etiqueta="Dirección" obligatorio>
        <Entrada required maxLength={200} value={valores.direccion} onChange={poner('direccion')} />
      </Campo>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo etiqueta="Municipio" obligatorio>
          <Entrada required maxLength={100} value={valores.municipio} onChange={poner('municipio')} />
        </Campo>
        <Campo etiqueta="Departamento">
          <Entrada maxLength={100} value={valores.departamento} onChange={poner('departamento')} />
        </Campo>
      </div>
      <Boton tipo="submit" icono={Plus} cargando={ocupado}>{textoBoton}</Boton>
    </form>
  )
}

// Muestra una fila de dato y valor de la ficha del proveedor.
const Dato = ({ etiqueta, children }) => (
  <div>
    <dt className="text-[12px] font-semibold text-gris-txt">{etiqueta}</dt>
    <dd className="text-[14px]">{children || <span className="text-gris">—</span>}</dd>
  </div>
)

// Muestra la lista de proveedores con su ficha y su formulario.
export default function Proveedores() {
  const { datos, cargando, recargar } = useDatos('/proveedores')
  const { ejecutar, ocupado } = useAccion(recargar)
  const [nuevo, setNuevo] = useState(null)
  const [editando, setEditando] = useState(null)
  const [viendo, setViendo] = useState(null)
  const [facturas, setFacturas] = useState(null)

  const crear = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/proveedores', nuevo))
    if (r) setNuevo(null)
  }
  const guardarEdicion = async (e) => {
    e.preventDefault()
    const { id, ...valores } = editando
    const r = await ejecutar(() => api.put(`/proveedores/${id}`, valores))
    if (r) setEditando(null)
  }
  const abrirEdicion = (p) => setEditando({
    id: p.id, nombre: p.nombre, tipo_documento: p.tipo_documento || 'NIT', numero_documento: p.numero_documento || '',
    contacto: p.contacto || '', telefono: p.telefono || '', correo: p.correo || '', direccion: p.direccion || '',
    municipio: p.municipio || '', departamento: p.departamento || '',
  })
  const verFacturas = async (p) => setFacturas({ ...(await api.get(`/proveedores/${p.id}/facturas`)), detalle: null })
  const verFactura = async (f) => setFacturas({ ...facturas, detalle: await api.get(`/facturas/${f.id}`) })

  const lista = datos?.proveedores || []
  return (
    <>
      <Encabezado titulo="Proveedores" descripcion="De quién llega la mercancía a la bodega, con su documento, su contacto y sus facturas." />
      <div className="mb-4">
        <Boton icono={Plus} onClick={() => setNuevo({ ...VACIO })}>Crear proveedor</Boton>
      </div>

      <Tarjeta titulo={`Registrados (${lista.length})`}>
        {cargando ? (
          <Cargando />
        ) : (
          <Tabla
            cabeceras={['Proveedor', 'Documento', 'Contacto', { texto: 'Facturas', alinear: 'derecha' }, { texto: 'Acciones', alinear: 'derecha' }]}
            vacio="Todavía no hay proveedores. Crea el primero con el botón de arriba."
            iconoVacio={Truck}
          >
            {lista.map((p) => (
              <Fila key={p.id}>
                <Celda etiqueta="Proveedor" className="font-semibold">
                  {p.nombre}
                  <div className="font-mono text-[11px] font-normal text-gris-txt">{p.codigo}</div>
                </Celda>
                <Celda etiqueta="Documento" className="whitespace-nowrap text-[13px]">
                  {documento(p) || <span className="text-gris">Sin documento</span>}
                </Celda>
                <Celda etiqueta="Contacto" className="text-[13px]">
                  {p.contacto || <span className="text-gris">Sin contacto</span>}
                  {p.telefono && <div>{p.telefono}</div>}
                  {p.correo && <div className="break-all text-gris-txt">{p.correo}</div>}
                </Celda>
                <Celda etiqueta="Facturas" alinear="derecha">
                  {p.facturas > 0 ? (
                    <button type="button" onClick={() => verFacturas(p)} aria-label={`Ver las ${p.facturas} facturas de ${p.nombre}`}
                      className="cursor-pointer font-semibold underline decoration-dotted underline-offset-2 hover:text-acento-txt">
                      {p.facturas}
                    </button>
                  ) : <span className="text-gris">0</span>}
                </Celda>
                <Celda alinear="derecha">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Boton tamano="sm" variante="fantasma" icono={Eye} onClick={() => setViendo(p)} aria-label={`Ver a ${p.nombre}`}>Ver</Boton>
                    <Boton tamano="sm" variante="fantasma" icono={Pencil} onClick={() => abrirEdicion(p)} aria-label={`Editar a ${p.nombre}`}>Editar</Boton>                  </div>
                </Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <Dialogo abierto={Boolean(nuevo)} titulo="Crear proveedor" onCerrar={() => setNuevo(null)} ancho="max-w-xl">
        {nuevo && <FormularioProveedor valores={nuevo} onChange={setNuevo} onEnviar={crear} ocupado={ocupado} textoBoton="Guardar proveedor" />}
      </Dialogo>

      <Dialogo abierto={Boolean(editando)} titulo={`Editar a ${editando?.nombre || ''}`} onCerrar={() => setEditando(null)} ancho="max-w-xl">
        {editando && <FormularioProveedor valores={editando} onChange={setEditando} onEnviar={guardarEdicion} ocupado={ocupado} textoBoton="Guardar cambios" />}
      </Dialogo>

      <Dialogo abierto={Boolean(viendo)} titulo={viendo?.nombre || ''} onCerrar={() => setViendo(null)} ancho="max-w-xl">
        {viendo && (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Dato etiqueta="Documento">{documento(viendo)}</Dato>
              <Dato etiqueta="Código interno">{viendo.codigo}</Dato>
              <Dato etiqueta="Persona de contacto">{viendo.contacto}</Dato>
              <Dato etiqueta="Teléfono">{viendo.telefono}</Dato>
              <Dato etiqueta="Correo">{viendo.correo}</Dato>
              <Dato etiqueta="Dirección">{viendo.direccion}</Dato>
              <Dato etiqueta="Municipio">{[viendo.municipio, viendo.departamento].filter(Boolean).join(', ')}</Dato>
              <Dato etiqueta="Creado">{fecha(viendo.creado)}</Dato>
              <Dato etiqueta="Facturas registradas">{String(viendo.facturas)}</Dato>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Boton variante="fantasma" icono={Pencil} onClick={() => { abrirEdicion(viendo); setViendo(null) }}>Editar</Boton>
              {viendo.facturas > 0 && (
                <Boton variante="fantasma" icono={FileText} onClick={() => { verFacturas(viendo); setViendo(null) }}>Ver sus facturas</Boton>
              )}
            </div>
          </>
        )}
      </Dialogo>

      <Dialogo abierto={Boolean(facturas)} titulo={facturas ? `Facturas de ${facturas.proveedor.nombre}` : ''} onCerrar={() => setFacturas(null)} ancho="max-w-4xl">
        {facturas && !facturas.detalle && (
          <Tabla cabeceras={['Factura', 'Fecha', 'Líneas', { texto: 'Total', alinear: 'derecha' }]} vacio="Este proveedor no tiene facturas.">
            {facturas.facturas.map((f) => (
              <Fila key={f.id}>
                <Celda etiqueta="Factura">
                  <button type="button" onClick={() => verFactura(f)} className="cursor-pointer font-semibold underline decoration-dotted underline-offset-2">
                    {f.numero}
                  </button>
                </Celda>
                <Celda etiqueta="Fecha">{String(f.fecha).slice(0, 10)}</Celda>
                <Celda etiqueta="Líneas">{f.lineas}</Celda>
                <Celda etiqueta="Total" alinear="derecha">{pesos(f.total)}</Celda>
              </Fila>
            ))}
          </Tabla>
        )}
        {facturas?.detalle && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Boton tamano="sm" variante="fantasma" onClick={() => setFacturas({ ...facturas, detalle: null })}>← Volver a las facturas</Boton>
              <span className="text-[13px] text-gris">
                Factura <strong>{facturas.detalle.factura.numero}</strong> · {String(facturas.detalle.factura.fecha).slice(0, 10)} · registrada por{' '}
                {facturas.detalle.factura.creado_por || '—'}
                {facturas.detalle.factura.tiene_adjunto && (
                  <> · <a className="font-semibold underline" href={`/api/inv/facturas/${facturas.detalle.factura.id}/adjunto`} target="_blank" rel="noreferrer">Ver PDF</a></>
                )}
              </span>
            </div>
            <Tabla cabeceras={['Nombre', 'Descripción', 'SKU', 'Cant.', 'V. unitario', 'Impuesto', 'Total', 'Bodega']} vacio="Sin líneas.">
              {facturas.detalle.items.map((i) => (
                <Fila key={i.id}>
                  <Celda etiqueta="Nombre">{i.nombre}</Celda>
                  <Celda etiqueta="Descripción">{i.descripcion || '—'}</Celda>
                  <Celda etiqueta="SKU">{i.sku}</Celda>
                  <Celda etiqueta="Cantidad">{i.cantidad}</Celda>
                  <Celda etiqueta="V. unitario">{pesos(i.valor_unitario)}</Celda>
                  <Celda etiqueta="Impuesto">{pesos(i.valor_impuesto)}</Celda>
                  <Celda etiqueta="Total">{pesos(i.total)}</Celda>
                  <Celda etiqueta="Bodega">{i.bodega}</Celda>
                </Fila>
              ))}
            </Tabla>
            <p className="mt-3 text-right text-[15px]">Total: <strong>{pesos(facturas.detalle.factura.total)}</strong></p>
          </>
        )}
      </Dialogo>
    </>
  )
}
