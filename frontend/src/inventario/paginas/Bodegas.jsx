// Bodegas principales, que reciben la mercancía de las facturas, y municipales, que cuelgan de una principal y
// se asignan a una cuenta que solo consulta.
import { useState } from 'react'
import { Plus, Warehouse } from 'lucide-react'
import { api } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  Alerta, Boton, Campo, Cargando, Celda, Dialogo, Entrada, Fila, Insignia, Seleccion, Tabla, Tarjeta,
} from '../componentes/ui'

const VACIA = { nombre: '', tipo: 'principal', departamento: '', municipio: '', principal_id: '', region: '' }

// Muestra las bodegas, su formulario de alta y la asignación de región y de cuenta.
export default function Bodegas() {
  const { datos, cargando, recargar } = useDatos('/bodegas')
  const { ejecutar, ocupado } = useAccion(recargar)
  const [nueva, setNueva] = useState(VACIA)
  const [detalle, setDetalle] = useState(null)

  const bodegas = datos?.bodegas || []
  const principales = bodegas.filter((b) => b.tipo === 'principal')
  const inv = datos?.inventario

  const crear = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/bodegas', nueva))
    if (r) setNueva(VACIA)
  }
  const ver = async (b) => setDetalle(await api.get(`/bodegas/${b.id}`))
  const poner = (b, region) => ejecutar(() => api.post(`/bodegas/${b.id}/region`, { region }))
  const asignar =(b, coordinadorId) => ejecutar(() => api.post(`/bodegas/${b.id}/coordinador`, { coordinador_id: coordinadorId || null }))

  return (
    <>
      <Encabezado titulo="Bodegas" descripcion="Principales (reciben las facturas) y municipales (se alimentan con traslados)." />
      {inv?.sin_ubicar > 0 && (
        <Alerta tono="aviso" className="mb-4">
          {inv.sin_ubicar.toLocaleString('es-CO')} de {inv.total.toLocaleString('es-CO')} unidades del inventario todavía no están
          ubicadas en una bodega: se ubican al registrar facturas.
        </Alerta>
      )}

      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[340px_1fr] min-[1400px]:items-start">
        <Tarjeta titulo="Nueva bodega">
          <form onSubmit={crear} className="form-doble">
            <Campo etiqueta="Nombre" obligatorio>
              <Entrada required maxLength={120} value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Tipo" obligatorio>
              <Seleccion value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value, principal_id: '' })}>
                <option value="principal">Principal</option>
                <option value="municipal">Municipal</option>
              </Seleccion>
            </Campo>
            {nueva.tipo === 'municipal' && (
              <Campo etiqueta="Cuelga de la bodega principal" obligatorio>
                <Seleccion required value={nueva.principal_id} onChange={(e) => setNueva({ ...nueva, principal_id: e.target.value })}>
                  <option value="">Elige…</option>
                  {principales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Seleccion>
              </Campo>
            )}
            <Campo etiqueta="Región">
              <Seleccion value={nueva.region} onChange={(e) => setNueva({ ...nueva, region: e.target.value })}>
                <option value="">Sin región</option>
                {(datos?.regiones || []).map((r) => <option key={r} value={r}>{r}</option>)}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Departamento">
              <Entrada maxLength={100} value={nueva.departamento} onChange={(e) => setNueva({ ...nueva, departamento: e.target.value })} />
            </Campo>
            <Campo etiqueta="Municipio" obligatorio={nueva.tipo === 'municipal'}>
              <Entrada required={nueva.tipo === 'municipal'} maxLength={100} value={nueva.municipio}
                onChange={(e) => setNueva({ ...nueva, municipio: e.target.value })} />
            </Campo>
            <Boton tipo="submit" icono={Plus} cargando={ocupado}>Crear bodega</Boton>
          </form>
        </Tarjeta>

        <Tarjeta titulo={`Bodegas (${bodegas.length})`}>
          {cargando ? <Cargando /> : (
            <Tabla
              cabeceras={['Bodega', 'Tipo', 'Municipio', 'Región', 'Coordinador local regional', 'Unidades', '']}
              vacio="Todavía no hay bodegas. Crea la primera principal con el formulario."
              iconoVacio={Warehouse}
            >
              {bodegas.map((b) => (
                <Fila key={b.id}>
                  <Celda etiqueta="Bodega">
                    <strong>{b.nombre}</strong>
                    {b.principal_nombre && <div className="text-[12px] text-gris">de {b.principal_nombre}</div>}
                  </Celda>
                  <Celda etiqueta="Tipo">
                    <Insignia tono={b.tipo === 'principal' ? 'ok' : 'neutro'}>{b.tipo === 'principal' ? 'Principal' : 'Municipal'}</Insignia>
                  </Celda>
                  <Celda etiqueta="Municipio">{[b.municipio, b.departamento].filter(Boolean).join(', ') || '—'}</Celda>
                  <Celda etiqueta="Región">
                    <Seleccion aria-label={`Región de ${b.nombre}`} value={b.region || ''} onChange={(e) => poner(b, e.target.value)}>
                      <option value="">Sin región</option>
                      {(datos.regiones || []).map((r) => <option key={r} value={r}>{r}</option>)}
                    </Seleccion>
                  </Celda>
                  <Celda etiqueta="Coordinador">
                    {b.tipo === 'municipal' ? (
                      <Seleccion aria-label={`Coordinador de ${b.nombre}`}
                        value={datos.coordinadores.find((c) => `coordinador:${c.id}` === b.coordinador_sub)?.id || ''}
                        onChange={(e) => asignar(b, e.target.value)}>
                        <option value="">Sin asignar</option>
                        {datos.coordinadores.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.region ? ` · ${c.region}` : ''}</option>)}
                      </Seleccion>
                    ) : '—'}
                  </Celda>
                  <Celda etiqueta="Unidades">{b.unidades.toLocaleString('es-CO')} ({b.articulos} art.)</Celda>
                  <Celda alinear="derecha"><Boton tamano="sm" variante="fantasma" onClick={() => ver(b)}>Ver existencias</Boton></Celda>
                </Fila>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      </div>

      <Dialogo abierto={Boolean(detalle)} titulo={detalle ? `Existencias · ${detalle.bodega.nombre}` : ''} onCerrar={() => setDetalle(null)} ancho="max-w-2xl">
        {detalle && (
          <Tabla cabeceras={['Artículo', 'SKU', { texto: 'Cantidad', alinear: 'derecha' }]} vacio="Esta bodega no tiene existencias.">
            {detalle.existencias.map((e) => (
              <Fila key={e.id}>
                <Celda etiqueta="Artículo">{e.nombre}</Celda>
                <Celda etiqueta="SKU">{e.sku || e.codigo_barras}</Celda>
                <Celda etiqueta="Cantidad" alinear="derecha">{e.cantidad.toLocaleString('es-CO')}</Celda>
              </Fila>
            ))}
          </Tabla>
        )}
      </Dialogo>
    </>
  )
}
