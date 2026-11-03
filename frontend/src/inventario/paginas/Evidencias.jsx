// Evidencias de transporte: quién llevó cada orden, en qué vehículo y por cuánto.
import { useState } from 'react'
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react'
import { api, fecha, pesos } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import Encabezado from '../componentes/Encabezado'
import {
  AreaTexto, Boton, Campo, Cargando, Celda, Confirmar, Entrada, Fila,
  Seleccion, Tabla, Tarjeta, useAvisos,
} from '../componentes/ui'

// Formulario en blanco, usado al empezar y después de guardar.
const VACIO = {
  orden_id: '', placa: '', transportista: '', empresa: '',
  monto: '', fecha_despacho: '', observaciones: '',
}

// Muestra el formulario de registro y la lista de evidencias.
export default function Evidencias() {
  const { datos, cargando, recargar } = useDatos('/evidencias')
  const { ejecutar, ocupado } = useAccion(recargar)
  const { avisar } = useAvisos()
  const [form, setForm] = useState(VACIO)
  const [aBorrar, setABorrar] = useState(null)

  const elegirOrden = async (orden_id) => {
    setForm((f) => ({ ...f, orden_id }))
    if (!orden_id) return
    try {
      const r = await api.get(`/evidencias/monto-orden/${orden_id}`)
      setForm((f) => ({ ...f, orden_id, monto: String(r.monto ?? '') }))
    } catch (err) {
      avisar(err.message, 'error')
    }
  }

  const crear = async (e) => {
    e.preventDefault()
    const r = await ejecutar(() => api.post('/evidencias', form))
    if (r) setForm(VACIO)
  }

  const borrar = async () => {
    const id = aBorrar?.id
    setABorrar(null)
    if (id) await ejecutar(() => api.del(`/evidencias/${id}`))
  }

  const campo = (clave) => ({
    value: form[clave],
    onChange: (e) => setForm({ ...form, [clave]: e.target.value }),
  })

  return (
    <>
      <Encabezado
        titulo="Evidencias de transporte"
        descripcion="Respaldo del despacho: vehículo, transportista, empresa y monto."
      />

      <div className="grid gap-4 sm:gap-5 min-[1400px]:grid-cols-[380px_1fr] min-[1400px]:items-start">
        <Tarjeta titulo="Nueva evidencia">
          <form onSubmit={crear} className="form-doble">
            <Campo etiqueta="Orden de entrega">
              <Seleccion value={form.orden_id} onChange={(e) => elegirOrden(e.target.value)} required>
                <option value="">Elegir orden</option>
                {(datos?.ordenes || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero}{o.destino ? ` - ${o.destino}` : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Placa del vehículo">
              <Entrada required maxLength={15} placeholder="ABC123" autoCapitalize="characters" {...campo('placa')} />
            </Campo>
            <div className="ancho-total grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Transportista">
                <Entrada maxLength={120} {...campo('transportista')} />
              </Campo>
              <Campo etiqueta="Empresa">
                <Entrada maxLength={120} {...campo('empresa')} />
              </Campo>
            </div>
            <Campo etiqueta="Monto" ayuda="Se calcula de los Kit UP de la orden; puedes ajustarlo.">
              <Entrada inputMode="decimal" maxLength={30} {...campo('monto')} />
            </Campo>
            <Campo etiqueta="Fecha y hora del despacho" ayuda="Si lo dejas vacío se usa el momento actual.">
              <Entrada type="datetime-local" {...campo('fecha_despacho')} />
            </Campo>
            <Campo etiqueta="Observaciones" className="ancho-total">
              <AreaTexto maxLength={2000} {...campo('observaciones')} />
            </Campo>
            <Boton tipo="submit" icono={Plus} cargando={ocupado}>Registrar evidencia</Boton>
          </form>
        </Tarjeta>

        <Tarjeta titulo={`Despachos registrados (${datos?.evidencias?.length ?? 0})`}>
          {cargando ? (
            <Cargando />
          ) : (
            <Tabla
              cabeceras={[
                'Despacho', 'Orden', 'Placa', 'Transportista', 'Empresa',
                { texto: 'Monto', alinear: 'derecha' },
                { texto: '', alinear: 'derecha' },
              ]}
              vacio="Todavía no hay evidencias de transporte."
              iconoVacio={ClipboardCheck}
            >
              {(datos?.evidencias || []).map((e) => (
                <Fila key={e.id}>
                  <Celda className="whitespace-nowrap text-[13px] text-gris-txt">
                    {fecha(e.fecha_despacho)}
                  </Celda>
                  <Celda>
                    <div className="font-bold">{e.orden_numero}</div>
                    {e.orden_destino && (
                      <div className="text-[12px] text-gris">{e.orden_destino}</div>
                    )}
                  </Celda>
                  <Celda className="font-mono font-semibold">{e.placa}</Celda>
                  <Celda className="text-gris-txt">{e.transportista || '—'}</Celda>
                  <Celda className="text-gris-txt">{e.empresa || '—'}</Celda>
                  <Celda alinear="derecha" className="whitespace-nowrap font-semibold">
                    {pesos(e.monto)}
                  </Celda>
                  <Celda alinear="derecha">
                    <Boton
                      variante="peligro"
                      tamano="sm"
                      icono={Trash2}
                      onClick={() => setABorrar(e)}
                      disabled={ocupado}
                    >
                      Eliminar
                    </Boton>
                  </Celda>
                </Fila>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      </div>

      <Confirmar
        abierto={Boolean(aBorrar)}
        titulo="¿Eliminar evidencia?"
        texto={`Se eliminará el despacho de ${aBorrar?.orden_numero} con placa ${aBorrar?.placa}.`}
        onOk={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </>
  )
}
