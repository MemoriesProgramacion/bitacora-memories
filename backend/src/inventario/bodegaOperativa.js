// Obtiene la bodega con la que opera una cuenta, leyendo siempre su asignación actual de la base y nunca una
// enviada por el navegador.
import { consulta } from './db.js'
import { usuarioActual } from './seguridad.js'
import { ErrorNegocio } from './util.js'

// Devuelve la bodega asignada a la cuenta, bloqueándola dentro de una escritura para que no cambie a mitad de
// la operación.
export async function bodegaOperativa(req, solicitada, cli = null) {
  const q = cli ? cli.q.bind(cli) : consulta
  const u = usuarioActual(req)
  if (u.rol === 'bodeguero') {
    const [b] = await q(
      `SELECT b.id, b.nombre, b.tipo FROM usuarios u JOIN bodegas b ON b.id = u.bodega_id
        WHERE u.id = $1 AND u.activo AND b.activa AND b.tipo = 'municipal'${cli ? ' FOR SHARE OF u, b' : ''}`, [u.id])
    if (!b) throw new ErrorNegocio('Debes tener una bodega municipal activa asignada. Solicita la asignación en Administración → Usuarios.', 403)
    if (solicitada !== undefined && solicitada !== '' && String(solicitada) !== String(b.id)) {
      throw new ErrorNegocio('Solo puedes operar en tu bodega municipal asignada.', 403)
    }
    return b
  }
  if (!solicitada) return null
  if (!/^\d{1,9}$/.test(String(solicitada))) throw new ErrorNegocio('Elige una bodega municipal activa.')
  const [b] = await q(`SELECT id, nombre, tipo FROM bodegas WHERE id = $1 AND activa AND tipo = 'municipal'${cli ? ' FOR SHARE' : ''}`, [solicitada])
  if (!b) throw new ErrorNegocio('Elige una bodega municipal activa.')
  return b
}
