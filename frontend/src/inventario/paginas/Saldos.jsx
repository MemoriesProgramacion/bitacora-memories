// Saldos por bodega en el inventario: la misma pantalla de la Bitácora con la ruta del inventario.
import SaldosBodegas from '../../sections/SaldosBodegas'
import { api, qs } from '../lib/api'

// Pide los saldos a la ruta del inventario.
const cargar = (p) => api.get(`/saldos-bodegas${qs(p)}`)

// Muestra la pantalla de saldos de la Bitácora.
export default function Saldos() {
  return <SaldosBodegas cargar={cargar} />
}
