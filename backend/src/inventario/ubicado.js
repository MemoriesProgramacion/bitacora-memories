// Reparte una salida de inventario entre lo sin ubicar y las bodegas para que lo ubicado nunca supere el total.
// Debe llamarse dentro de una transacción antes de bajar articulos.stock.
// Descuenta primero de lo sin ubicar y luego de las bodegas, principales primero y entre ellas la que más
// tiene; devuelve las partes descontadas.
export async function repartirSalida(cli, articuloId, cantidad) {
  const [a] = await cli.q('SELECT stock FROM articulos WHERE id = $1 FOR UPDATE', [articuloId])
  const [{ ubicado }] = await cli.q('SELECT COALESCE(SUM(cantidad), 0)::int AS ubicado FROM stock_bodega WHERE articulo_id = $1', [articuloId])
  const partes = []
  let resto = cantidad
  const libre = Math.max((a?.stock ?? 0) - ubicado, 0)
  if (libre > 0 && resto > 0) {
    const t = Math.min(resto, libre)
    partes.push({ bodega_id: null, cantidad: t })
    resto -= t
  }
  if (resto > 0) {
    const filas = await cli.q(
      `SELECT s.bodega_id, s.cantidad FROM stock_bodega s JOIN bodegas b ON b.id = s.bodega_id
        WHERE s.articulo_id = $1 AND s.cantidad > 0
        ORDER BY (b.tipo = 'principal') DESC, s.cantidad DESC, s.bodega_id FOR UPDATE OF s`, [articuloId])
    for (const f of filas) {
      if (resto <= 0) break
      const t = Math.min(resto, f.cantidad)
      await cli.q('UPDATE stock_bodega SET cantidad = cantidad - $1 WHERE bodega_id = $2 AND articulo_id = $3', [t, f.bodega_id, articuloId])
      partes.push({ bodega_id: f.bodega_id, cantidad: t })
      resto -= t
    }
  }
  return partes
}
