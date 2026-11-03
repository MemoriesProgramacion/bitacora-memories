// API del panel de inventario, proveedores, artículos, recepción de mercancía y ajuste de stock.
import crypto from 'node:crypto'
import { Router } from 'express'
import { consulta, una, conTransaccion, COD_UNICO } from '../db.js'
import { soloAdmin, loginRequerido, usuarioActual, actorActividad } from '../seguridad.js'
import { validarUnspsc } from '../../servicios/clasificacion.js'
import { registrar, diferencias, tope } from '../../servicios/actividad.js'
import { calcularAlertas } from '../alertas.js'
import { repartirSalida } from '../ubicado.js'
import {
  validarProveedor, SQL_INSERTAR_PROVEEDOR, SQL_LISTAR_PROVEEDORES, SQL_ACTUALIZAR_PROVEEDOR, SQL_FACTURAS_DE_PROVEEDOR,
  SQL_PROVEEDOR, CAMPOS_PROVEEDOR, valoresProveedor, mensajeDuplicado,
} from '../proveedor.js'
import {
  ok, error, cuerpo, texto, aInt, aFloat, codigoArticulo, soloEnteros,
  validarLargos, enRango, escaparLike,
} from '../util.js'

const MAX_CANTIDAD = 1_000_000
const MAX_STOCK = 100_000_000
const MAX_PRECIO = 99_999_999_999

// Quita el precio de un artículo para quien solo puede ver existencias.
const sinPrecio = (filas) => filas.map(({ precio, ...resto }) => resto)

const router = Router()
router.param('pid', soloEnteros)
router.param('aid', soloEnteros)

const ZONA = "'America/Bogota'"
const HOY = `(now() AT TIME ZONE ${ZONA})`
const MES_ACTUAL = `date_trunc('month', ${HOY})`
// Lista de los seis últimos meses, el actual incluido, para las gráficas.
const SEIS_MESES = `generate_series(${MES_ACTUAL} - interval '5 months', ${MES_ACTUAL}, interval '1 month')`

// Reúne los datos del panel: cifras generales, estado del inventario, valor por proveedor, movimientos por día,
// kits, órdenes y despachos del mes y alertas.
router.get('/panel', soloAdmin, async (req, res) => {
  const [
    cifras, estado, topValor, porProveedor, movsDia, kits, ordenesMes, despachosMes,
    porEmpresa, lotes, bajos, movs, alertasPanel,
  ] = await Promise.all([
    una(`SELECT
           (SELECT COUNT(*) FROM articulos WHERE activo)::int                       AS n_art,
           (SELECT COUNT(*) FROM proveedores)::int                                  AS n_prov,
           (SELECT COUNT(*) FROM combos)::int                                       AS n_kits,
           (SELECT COALESCE(SUM(stock), 0) FROM articulos WHERE activo)::int        AS total_stock,
           (SELECT COALESCE(SUM(stock * precio), 0) FROM articulos WHERE activo)::float AS valor_stock,
           (SELECT COUNT(*) FROM ordenes)::int                                      AS n_ordenes,
           (SELECT COUNT(*) FROM ordenes WHERE fecha AT TIME ZONE ${ZONA} >= ${MES_ACTUAL})::int AS ordenes_este_mes,
           (SELECT COUNT(*) FROM lotes)::int                                        AS n_lotes,
           (SELECT COUNT(*) FROM evidencias_transporte)::int                        AS n_despachos,
           (SELECT COALESCE(SUM(monto), 0) FROM evidencias_transporte)::float       AS monto_despachado`),
    una(`SELECT
           COUNT(*) FILTER (WHERE stock = 0)::int                                          AS agotados,
           COUNT(*) FILTER (WHERE stock > 0 AND minimo > 0 AND stock <= minimo)::int       AS por_reponer,
           COUNT(*) FILTER (WHERE stock > 0 AND (minimo = 0 OR stock > minimo))::int       AS normales
         FROM articulos WHERE activo`),
    consulta(
      `SELECT nombre, stock, (stock * precio)::float AS valor
         FROM articulos WHERE activo AND stock * precio > 0
        ORDER BY valor DESC LIMIT 8`,
    ),
    consulta(
      `SELECT COALESCE(p.nombre, 'Sin proveedor') AS nombre,
              COUNT(*)::int AS articulos,
              COALESCE(SUM(a.stock), 0)::int AS unidades,
              COALESCE(SUM(a.stock * a.precio), 0)::float AS valor
         FROM articulos a LEFT JOIN proveedores p ON p.id = a.proveedor_id
        WHERE a.activo GROUP BY 1 ORDER BY valor DESC, unidades DESC LIMIT 8`,
    ),
    consulta(
      `SELECT to_char(d, 'YYYY-MM-DD') AS dia,
              COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'entrada'), 0)::int AS entradas,
              COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'salida'), 0)::int  AS salidas
         FROM generate_series(${HOY}::date - 29, ${HOY}::date, interval '1 day') AS d
         LEFT JOIN movimientos m ON (m.fecha AT TIME ZONE ${ZONA})::date = d::date
        GROUP BY d ORDER BY d`,
    ),
    una(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE armado)::int AS armados,
                COALESCE(SUM(stock), 0)::int AS en_stock
           FROM combos`),
    consulta(
      `SELECT to_char(mes, 'YYYY-MM') AS mes,
              COUNT(DISTINCT o.id)::int AS ordenes,
              COALESCE(SUM(i.cantidad), 0)::int AS kits
         FROM ${SEIS_MESES} AS mes
         LEFT JOIN ordenes o ON date_trunc('month', o.fecha AT TIME ZONE ${ZONA}) = mes
         LEFT JOIN orden_items i ON i.orden_id = o.id
        GROUP BY mes ORDER BY mes`,
    ),
    consulta(
      `SELECT to_char(mes, 'YYYY-MM') AS mes,
              COUNT(e.id)::int AS despachos,
              COALESCE(SUM(e.monto), 0)::float AS monto
         FROM ${SEIS_MESES} AS mes
         LEFT JOIN evidencias_transporte e ON date_trunc('month', e.fecha_despacho AT TIME ZONE ${ZONA}) = mes
        GROUP BY mes ORDER BY mes`,
    ),
    consulta(
      `SELECT COALESCE(NULLIF(empresa, ''), 'Sin empresa') AS nombre,
              COUNT(*)::int AS despachos,
              COALESCE(SUM(monto), 0)::float AS monto
         FROM evidencias_transporte GROUP BY 1 ORDER BY monto DESC, despachos DESC LIMIT 5`,
    ),
    consulta(
      `SELECT * FROM (
         SELECT l.id, COALESCE(NULLIF(l.nombre, ''), 'Lote ' || l.numero) AS nombre,
                COUNT(DISTINCT i.num_documento)::int AS unidades,
                COALESCE(SUM(i.cantidad), 0)::int AS cantidad,
                COALESCE(SUM(i.cantidad * i.precio), 0)::float AS valor
           FROM lotes l LEFT JOIN lote_items i ON i.lote_id = l.id
          GROUP BY l.id ORDER BY l.id DESC LIMIT 6
       ) t ORDER BY id`,
    ),
    consulta(
      `SELECT * FROM articulos
       WHERE activo AND minimo > 0 AND stock <= minimo
       ORDER BY stock::float / minimo ASC, stock ASC LIMIT 10`,
    ),
    consulta(
      `SELECT m.*, a.nombre AS art_nombre FROM movimientos m
       LEFT JOIN articulos a ON a.id = m.articulo_id
       ORDER BY m.id DESC LIMIT 12`,
    ),
    calcularAlertas(),
  ])

  ok(res, null, {
    ...cifras,
    alertas: alertasPanel.resumen,
    estado,
    top_valor: topValor,
    por_proveedor: porProveedor,
    movs_dia: movsDia,
    kits,
    ordenes_mes: ordenesMes,
    despachos_mes: despachosMes,
    por_empresa: porEmpresa,
    lotes,
    bajos,
    movs,
  })
})

// Lista de alertas de stock.
router.get('/alertas', loginRequerido, async (req, res) => {
  const { resumen, alertas, kits_bloqueados } = await calcularAlertas()
  const esAdmin = usuarioActual(req).rol === 'admin'
  ok(res, null, {
    resumen,
    alertas: esAdmin ? alertas : alertas.map(({ valor_reponer, ...resto }) => resto),
    kits_bloqueados,
  })
})

// Cantidades de alertas por nivel, para la insignia de la pestaña.
router.get('/alertas/resumen', loginRequerido, async (req, res) => {
  ok(res, null, { resumen: (await calcularAlertas()).resumen })
})

// Lista de proveedores.
router.get('/proveedores', soloAdmin, async (req, res) => {
  ok(res, null, { proveedores: await consulta(SQL_LISTAR_PROVEEDORES) })
})

// Crea un proveedor.
router.post('/proveedores', soloAdmin, async (req, res) => {
  const p = validarProveedor(cuerpo(req))
  let fila
  try {
    ;[fila] = await consulta(SQL_INSERTAR_PROVEEDOR, valoresProveedor(p))
  } catch (e) {
    if (e.code === COD_UNICO) return error(res, mensajeDuplicado(e, p), 409)
    throw e
  }
  await registrar(actorActividad(req), {
    accion: 'inventario.proveedor_crear', objeto: { tipo: 'proveedor', id: fila.id },
    cambios: { campos: diferencias({}, fila, CAMPOS_PROVEEDOR) },
  })
  ok(res, `Proveedor '${p.nombre}' agregado.`, { id: fila.id })
})

// Edita un proveedor, también para completar datos de los creados antes.
router.put('/proveedores/:pid', soloAdmin, async (req, res) => {
  const datos = cuerpo(req)
  const p = validarProveedor(datos)
  const antes = await una(SQL_PROVEEDOR, [req.params.pid])
  if (!antes) return error(res, 'El proveedor no existe.', 404)
  let fila
  try {
    fila = await una(SQL_ACTUALIZAR_PROVEEDOR, [...valoresProveedor(p).map((v, i) => (i === 1 ? (texto(datos.codigo) || null) : v)), req.params.pid])
    if (!fila) return error(res, 'El proveedor no existe.', 404)
  } catch (e) {
    if (e.code === COD_UNICO) return error(res, mensajeDuplicado(e, p), 409)
    throw e
  }
  await registrar(actorActividad(req), {
    accion: 'inventario.proveedor_editar', objeto: { tipo: 'proveedor', id: fila.id },
    cambios: { campos: diferencias(antes, fila, CAMPOS_PROVEEDOR) },
  })
  ok(res, `Proveedor '${p.nombre}' actualizado.`)
})

router.get('/proveedores/:pid/facturas', soloAdmin, async (req, res) => {
  const proveedor = await una('SELECT id, nombre FROM proveedores WHERE id = $1', [req.params.pid])
  if (!proveedor) return error(res, 'El proveedor no existe.', 404)
  ok(res, null, { proveedor, facturas: await consulta(SQL_FACTURAS_DE_PROVEEDOR, [proveedor.id]) })
})

const POR_PAGINA = 50

// Lista paginada de artículos con filtros.
router.get('/articulos', soloAdmin, async (req, res) => {
  const q = texto(req.query.q)
  if (q.length > 100) return error(res, 'La busqueda no puede pasar de 100 caracteres.')
  const pagina = Math.min(100_000, Math.max(1, aInt(req.query.pagina, 1) || 1))
  const offset = (pagina - 1) * POR_PAGINA

  let filtro
  let params
  if (q) {
    const like = `%${escaparLike(q)}%`
    filtro = `WHERE a.activo
                AND (a.nombre ILIKE $1
                     OR a.codigo_barras ILIKE $1
                     OR a.codigo_proveedor ILIKE $1)`
    params = [like]
  } else {
    filtro = 'WHERE a.activo'
    params = []
  }

  const { c: total } = await una(`SELECT COUNT(*) AS c FROM articulos a ${filtro}`, params)

  const n = params.length
  const articulos = await consulta(
    `SELECT a.*, p.nombre AS prov_nombre FROM articulos a
     LEFT JOIN proveedores p ON p.id = a.proveedor_id
     ${filtro}
     ORDER BY a.nombre
     LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, POR_PAGINA, offset],
  )

  const proveedores = await consulta('SELECT * FROM proveedores ORDER BY nombre')
  ok(res, null, {
    articulos, proveedores, q, pagina, total,
    total_paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
  })
})

// Crea un artículo con su código y stock inicial.
router.post('/articulos', soloAdmin, async (req, res) => {
  const datos = cuerpo(req)
  const largo = validarLargos(datos, { nombre: 200, codigo_proveedor: 60 })
  if (largo) return error(res, largo)
  const nombre = texto(datos.nombre)
  const codigoProv = texto(datos.codigo_proveedor)
  const proveedorId = aInt(datos.proveedor_id, null)
  const minimo = aInt(datos.minimo, 0) || 0
  const precio = Math.max(0, aFloat(datos.precio, 0))

  if (!nombre) return error(res, 'El nombre del articulo es obligatorio.')
  if (!enRango(minimo, 0, MAX_STOCK)) return error(res, 'El minimo debe estar entre 0 y 100.000.000.')
  if (!enRango(precio, 0, MAX_PRECIO)) return error(res, 'El precio no es valido.')
  if (proveedorId !== null && !(await una('SELECT id FROM proveedores WHERE id = $1', [proveedorId]))) {
    return error(res, 'El proveedor seleccionado no existe.')
  }
  let unspsc
  try {
    unspsc = await validarUnspsc(datos.unspsc)
  } catch (e) {
    return error(res, e.message, e.status || 400)
  }

  const artId = await conTransaccion(async (cli) => {
    const [fila] = await cli.q(
      `INSERT INTO articulos (nombre, codigo_proveedor, proveedor_id,
                              codigo_barras, precio, stock, minimo, unspsc)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       RETURNING id`,
      [nombre, codigoProv, proveedorId, 'PENDIENTE-' + crypto.randomBytes(6).toString('hex'),
        precio, minimo, unspsc],
    )
    await cli.q('UPDATE articulos SET codigo_barras = $1 WHERE id = $2',
      [codigoArticulo(fila.id), fila.id])
    return fila.id
  })
  const codigo = codigoArticulo(artId)
  await registrar(actorActividad(req), {
    accion: 'inventario.articulo_crear', objeto: { tipo: 'articulo', id: artId },
    cambios: { campos: diferencias({}, { nombre, codigo_barras: codigo, codigo_proveedor: codigoProv || null, proveedor_id: proveedorId, precio, minimo, unspsc },
      ['nombre', 'codigo_barras', 'codigo_proveedor', 'proveedor_id', 'precio', 'minimo', 'unspsc']) },
  })
  ok(res, `Articulo '${nombre}' creado con codigo de barras ${codigo}.`,
    { id: artId, codigo_barras: codigo })
})

// Clasifica un artículo con su clase UNSPSC o la quita; el cambio queda en la actividad.
router.patch('/articulos/:aid/unspsc', soloAdmin, async (req, res) => {
  const aid = aInt(req.params.aid, null)
  const previo = aid && await una('SELECT id, nombre, unspsc FROM articulos WHERE id = $1 AND activo', [aid])
  if (!previo) return error(res, 'El artículo no existe.', 404)
  let unspsc
  try {
    unspsc = await validarUnspsc(cuerpo(req).unspsc)
  } catch (e) {
    return error(res, e.message, e.status || 400)
  }
  await consulta('UPDATE articulos SET unspsc = $2 WHERE id = $1', [aid, unspsc])
  await registrar(actorActividad(req), {
    accion: 'inventario.articulo_unspsc', objeto: { tipo: 'articulo', id: aid },
    cambios: { campos: { unspsc: [previo.unspsc?.trim() || null, unspsc] } },
  })
  ok(res, unspsc ? `Artículo '${previo.nombre}' clasificado con la clase UNSPSC ${unspsc}.` : 'Se quitó la clase UNSPSC del artículo.',
    { id: aid, unspsc })
})

// Da de baja un artículo, que queda inactivo, siempre que no forme parte de un kit.
router.delete('/articulos/:aid', soloAdmin, async (req, res) => {
  const aid = Number(req.params.aid)
  const { c: enCombo } = await una(
    'SELECT COUNT(*) AS c FROM combo_items WHERE articulo_id = $1', [aid],
  )
  if (enCombo) return error(res, 'No se puede eliminar: el articulo forma parte de un combo.', 409)
  const previo = await una('SELECT nombre, activo, stock FROM articulos WHERE id = $1', [aid])
  await consulta('UPDATE articulos SET activo = FALSE WHERE id = $1', [aid])
  if (previo) {
    await registrar(actorActividad(req), {
      accion: 'inventario.articulo_eliminar', objeto: { tipo: 'articulo', id: aid },
      cambios: { nombre: previo.nombre, stock: previo.stock, campos: previo.activo ? { activo: [true, false] } : {} },
    })
  }
  ok(res, 'Articulo eliminado.')
})

// Fija el stock de un artículo en una cantidad nueva y registra la diferencia.
router.post('/articulos/:aid/ajuste', soloAdmin, async (req, res) => {
  const aid = Number(req.params.aid)
  const nuevo = aInt(cuerpo(req).stock)
  if (nuevo === null || !enRango(nuevo, 0, MAX_STOCK)) return error(res, 'Cantidad invalida.')

  const antes = await conTransaccion(async (cli) => {
    const [actual] = await cli.q('SELECT stock, nombre FROM articulos WHERE id = $1 FOR UPDATE', [aid])
    if (!actual) return null
    const diff = nuevo - actual.stock
    const partes = diff < 0 ? await repartirSalida(cli, aid, -diff) : [{ bodega_id: null, cantidad: diff }]
    await cli.q('UPDATE articulos SET stock = $1 WHERE id = $2', [nuevo, aid])
    for (const p of partes) {
      await cli.q(
        `INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, bodega_id)
         VALUES ($1, 'ajuste', $2, 'ajuste', 'ajuste manual', $3)`,
        [aid, diff < 0 ? -p.cantidad : p.cantidad, p.bodega_id],
      )
    }
    return { stock: actual.stock, nombre: actual.nombre, partes }
  })
  if (!antes) return error(res, 'El articulo no existe.', 404)
  await registrar(actorActividad(req), {
    accion: 'inventario.articulo_ajuste', objeto: { tipo: 'articulo', id: aid },
    cambios: {
      nombre: antes.nombre, campos: { stock: [antes.stock, nuevo] },
      bodegas: tope(antes.partes.filter((p) => p.bodega_id !== null).map((p) => [p.bodega_id, p.cantidad])),
    },
  })
  ok(res, 'Stock ajustado.')
})

router.get('/recepcion', loginRequerido, async (req, res) => {
  const articulos = await consulta(
    `SELECT a.*, p.nombre AS prov_nombre FROM articulos a
     LEFT JOIN proveedores p ON p.id = a.proveedor_id
     WHERE a.activo
     ORDER BY a.nombre`,
  )
  const proveedores = await consulta('SELECT id, nombre FROM proveedores ORDER BY nombre')
  const esAdmin = usuarioActual(req).rol === 'admin'
  ok(res, null, { articulos: esAdmin ? articulos : sinPrecio(articulos), proveedores })
})

// Busca un artículo por código de barras para el lector.
router.get('/recepcion/buscar', loginRequerido, async (req, res) => {
  const code = texto(req.query.code)
  if (code.length > 64) return error(res, 'Codigo demasiado largo.')
  const row = await una(
    `SELECT id, nombre, codigo_barras, stock FROM articulos
     WHERE activo AND (codigo_barras = $1 OR codigo_proveedor = $1)
     ORDER BY (codigo_barras = $1) DESC
     LIMIT 1`,
    [code],
  )
  if (row) {
    return ok(res, null, {
      encontrado: true, id: row.id, nombre: row.nombre,
      codigo: row.codigo_barras, stock: row.stock,
    })
  }
  ok(res, null, { encontrado: false })
})

// Registra una recepción de mercancía de un proveedor y suma al stock.
router.post('/recepcion', loginRequerido, async (req, res) => {
  const datos = cuerpo(req)
  const largo = validarLargos(datos, { referencia: 100 })
  if (largo) return error(res, largo)
  const referencia = texto(datos.referencia)
  const proveedorId = aInt(datos.proveedor_id, null)
  const lineas = Array.isArray(datos.lineas) ? datos.lineas : []
  if (lineas.length > 500) return error(res, 'Una recepcion admite como maximo 500 lineas.')

  if (proveedorId === null) {
    return error(res, 'Debes seleccionar el proveedor desde el cual se recibe la mercancia.')
  }
  if (!(await una('SELECT id FROM proveedores WHERE id = $1', [proveedorId]))) {
    return error(res, 'El proveedor seleccionado no existe.')
  }

  const pedidas = []
  for (const ln of lineas) {
    const aid = aInt(ln?.articulo_id)
    const cant = aInt(ln?.cantidad, 0) || 0
    const codProv = texto(ln?.codigo_proveedor)
    if (codProv.length > 60) return error(res, 'El codigo del proveedor no puede pasar de 60 caracteres.')
    if (aid === null || cant <= 0) continue
    if (cant > MAX_CANTIDAD) return error(res, 'La cantidad por linea no puede pasar de 1.000.000.')
    pedidas.push([aid, cant, codProv])
  }

  const validos = new Set()
  if (pedidas.length) {
    const filas = await consulta(
      'SELECT id FROM articulos WHERE activo AND id = ANY($1::int[])',
      [pedidas.map((p) => p[0])],
    )
    for (const f of filas) validos.add(f.id)
  }

  let total = 0
  let descartadas = 0
  const recibidas = []
  try {
    await conTransaccion(async (cli) => {
      for (const [aid, cant, codProv] of pedidas) {
        if (!validos.has(aid)) {
          descartadas += 1
          continue
        }
        recibidas.push([aid, cant])
        await cli.q('UPDATE articulos SET stock = stock + $1 WHERE id = $2', [cant, aid])
        await cli.q(
          `INSERT INTO movimientos
           (articulo_id, tipo, cantidad, motivo, referencia, proveedor_id, codigo_proveedor)
           VALUES ($1, 'entrada', $2, 'recepcion', $3, $4, $5)`,
          [aid, cant, referencia, proveedorId, codProv || null],
        )
        total += 1
      }
    })
  } catch (e) {
    console.error('Error registrando la recepcion:', e)
    return error(res, 'Ocurrio un error registrando la recepcion. No se guardo nada.', 500)
  }

  if (total) {
    await registrar(actorActividad(req), {
      accion: 'inventario.recepcion', objeto: { tipo: 'recepcion', id: referencia || null },
      cambios: { proveedor: proveedorId, referencia: referencia || null, lineas: tope(recibidas), n: total, descartadas },
    })
    let msg = `Recepcion registrada: ${total} articulo(s) actualizados.`
    if (descartadas) {
      msg += ` Se ignoraron ${descartadas} linea(s) de articulos inexistentes o inactivos.`
    }
    return ok(res, msg, { actualizados: total, descartadas })
  }
  if (descartadas) {
    return error(res, 'No se registro nada: los articulos indicados no existen o ' +
      `estan inactivos (${descartadas} linea(s)).`)
  }
  error(res, 'No se ingreso ninguna cantidad valida.')
})

export default router
