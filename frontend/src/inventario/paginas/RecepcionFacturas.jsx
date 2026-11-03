// Recepción contra la factura: las facturas registradas como pendientes de entrega se reciben línea por línea,
// sin pasar de lo facturado.
import { useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useAccion, useDatos } from '../lib/useDatos'
import { Boton, Cargando, Entrada, Insignia, Tarjeta, Vacio } from '../componentes/ui'
import { ENTREGA } from './Facturas'

// Muestra las facturas por recibir y registra la recepción de cada línea.
export default function RecepcionFacturas({ onRecibido }) {
  const { datos, cargando, recargar } = useDatos('/facturas-por-recibir')
  const { ejecutar, ocupado } = useAccion(async () => { await recargar(); await onRecibido?.() })
  const [cantidades, setCantidades] = useState({})

  const recibir = async (f) => {
    const lineas = f.items.map((i) => ({ item_id: i.id, cantidad: Number(cantidades[i.id] || 0) })).filter((l) => l.cantidad > 0)
    const r = await ejecutar(() => api.post(`/facturas/${f.id}/recepcion`, { lineas }))
    if (r) setCantidades((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !f.items.some((i) => String(i.id) === id))))
  }

  if (cargando && !datos) return <Tarjeta titulo="Facturas por recibir"><Cargando /></Tarjeta>
  const facturas = datos?.facturas || []
  return (
    <Tarjeta titulo={`Facturas por recibir (${facturas.length})`}>
      {!facturas.length ? <Vacio icono={PackageCheck}>No hay facturas pendientes de entrega del proveedor.</Vacio> : (
        <ul className="grid gap-3">
          {facturas.map((f) => {
            const hay = f.items.some((i) => Number(cantidades[i.id]) > 0)
            return (
              <li key={f.id} className="grid min-w-0 gap-2 rounded-lg border border-campo p-3 text-[13px]">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-semibold">Factura {f.numero} · {f.proveedor || '—'}{f.id_unico ? ` · UP ${f.id_unico}` : ''}</span>
                  <Insignia tono={ENTREGA[f.estado_entrega]?.tono}>{ENTREGA[f.estado_entrega]?.texto} · {f.recibido} de {f.cantidad}</Insignia>
                </div>
                <ul className="grid gap-2">
                  {f.items.map((i) => {
                    const falta = i.cantidad - i.recibido
                    return (
                      <li key={i.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-words">{i.nombre} · {i.sku} · {i.bodega} · recibido {i.recibido} de {i.cantidad}</span>
                        {falta > 0 && (
                          <Entrada type="number" min="0" max={falta} step="1" className="w-24" aria-label={`Cantidad recibida de ${i.nombre}`}
                            value={cantidades[i.id] ?? ''} onChange={(e) => setCantidades((c) => ({ ...c, [i.id]: e.target.value }))} />
                        )}
                      </li>
                    )
                  })}
                </ul>
                <div><Boton tamano="sm" icono={PackageCheck} cargando={ocupado} disabled={!hay} onClick={() => recibir(f)}>Registrar recepción contra la factura</Boton></div>
              </li>
            )
          })}
        </ul>
      )}
    </Tarjeta>
  )
}
