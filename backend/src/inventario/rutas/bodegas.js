// API de bodegas, facturas de compra y traslados. La bodega principal recibe la mercancía de las facturas; la
// municipal depende de una principal, se alimenta con traslados y se asigna a una cuenta que solo la consulta.
// articulos.stock es el total y stock_bodega reparte la parte ya ubicada.
import { Router } from 'express'
import multer from 'multer'
import { consulta, una, conTransaccion, COD_UNICO } from '../db.js'
import { soloAdmin, loginRequerido, usuarioActual, limitador, actorActividad } from '../seguridad.js'
import { saldosBodegasInventario } from '../../servicios/saldosBodegas.js'
import { registrar, corto } from '../../servicios/actividad.js'

// Estados de plan a los que pueden asociarse las facturas de capitalización.
const PLAN_APROBADO = ['aprobado', 'en_compra', 'entregado']
import {
  ok, error, cuerpo, texto, aInt, aFloat, soloEnteros, enviarPdf, validarLargos, enRango, ErrorNegocio, codigoArticulo,
} from '../util.js'

const router = Router()
router.param('bid', soloEnteros)
router.param('fid', soloEnteros)

const MAX_PDF = 10 * 1024 * 1024
const MAX_LINEAS = 200
const MAX_CANTIDAD = 1_000_000
const MAX_VALOR = 99_999_999_999
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF, files: 1, fields: 4, fieldSize: 512 * 1024 },
})
const limiteFactura = limitador({
  ventanaMs: 10 * 60_000, max: 30, tipo: 'limite_factura',
  mensaje: 'Demasiadas facturas seguidas. Espera unos minutos.',
})

// Redondea un valor monetario a dos decimales.
const redondear = (n) => Math.round(n * 100) / 100

// Consulta que lista las bodegas activas con el nombre de su bodega principal, la cuenta asignada, las unidades
// en stock y la cantidad de artículos.
const SQL_BODEGAS = `
  SELECT b.id, b.nombre, b.tipo, b.departamento, b.municipio, b.region, b.principal_id, b.coordinador_sub, b.activa,
         p.nombre AS principal_nombre, c.nombre AS coordinador_nombre,
         COALESCE((SELECT SUM(s.cantidad) FROM stock_bodega s WHERE s.bodega_id = b.id), 0)::int AS unidades,
         (SELECT COUNT(*) FROM stock_bodega s WHERE s.bodega_id = b.id AND s.cantidad > 0)::int AS articulos
    FROM bodegas b
    LEFT JOIN bodegas p ON p.id = b.principal_id
    LEFT JOIN public.coordinadores c ON ('coordinador:' || c.id_coordinador) = b.coordinador_sub
   WHERE b.activa
   ORDER BY b.tipo, lower(b.nombre)`

// Lista las bodegas.
router.get('/bodegas', soloAdmin, async (req, res) => {
  const [bodegas, coordinadores, ubicado] = await Promise.all([
    consulta(SQL_BODEGAS),
    consulta(`SELECT id_coordinador AS id, nombre, usuario, region FROM public.coordinadores
               WHERE tipo = 'coordinador' AND activo ORDER BY lower(nombre)`),
    una(`SELECT (SELECT COALESCE(SUM(stock), 0) FROM articulos WHERE activo)::int AS total,
                (SELECT COALESCE(SUM(s.cantidad), 0) FROM stock_bodega s JOIN articulos a ON a.id = s.articulo_id
                  WHERE a.activo)::int AS ubicado`),
  ])
  const regiones = (await consulta("SELECT DISTINCT btrim(region) AS region FROM public.triadas WHERE btrim(region) <> '' AND region <> 'Por asignar' ORDER BY 1")).map((r) => r.region)
  ok(res, null, {
    bodegas, coordinadores, regiones,
    inventario: { total: ubicado.total, ubicado: ubicado.ubicado, sin_ubicar: Math.max(ubicado.total - ubicado.ubicado, 0) },
  })
})

router.get('/bodegas/:bid', soloAdmin, async (req, res) => {
  const bodega = (await consulta(SQL_BODEGAS)).find((b) => b.id === Number(req.params.bid))
  if (!bodega) return error(res, 'La bodega no existe.', 404)
  const existencias = await consulta(
    `SELECT a.id, a.nombre, a.codigo_barras, a.codigo_proveedor AS sku, s.cantidad
       FROM stock_bodega s JOIN articulos a ON a.id = s.articulo_id
      WHERE s.bodega_id = $1 AND s.cantidad > 0 ORDER BY lower(a.nombre)`, [bodega.id])
  ok(res, null, { bodega, existencias })
})

// Crea una bodega principal o municipal.
router.post('/bodegas', soloAdmin, async (req, res) => {
  const d = cuerpo(req)
  const largo = validarLargos(d, { nombre: 120, departamento: 100, municipio: 100 })
  if (largo) return error(res, largo)
  const nombre = texto(d.nombre)
  const tipo = texto(d.tipo)
  if (!nombre) return error(res, 'El nombre de la bodega es obligatorio.')
  if (!['principal', 'municipal'].includes(tipo)) return error(res, 'El tipo debe ser principal o municipal.')
  let principalId = null
  if (tipo === 'municipal') {
    principalId = aInt(d.principal_id, null)
    const p = principalId === null ? null : await una("SELECT id FROM bodegas WHERE id = $1 AND tipo = 'principal' AND activa", [principalId])
    if (!p) return error(res, 'Una bodega municipal debe colgar de una bodega principal que exista.')
    if (!texto(d.municipio)) return error(res, 'La bodega municipal necesita su municipio.')
  }
  const region = texto(d.region)
  if (region && !(await regionValida(region))) return error(res, 'Esa región no existe.')
  try {
    const fila = await una(
      `INSERT INTO bodegas (nombre, tipo, departamento, municipio, region, principal_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nombre, tipo, texto(d.departamento) || null, texto(d.municipio) || null, region || null, principalId])
    await registrar(actorActividad(req), {
      accion: 'inventario.bodega_crear', objeto: { tipo: 'bodega', id: fila.id },
      cambios: { campos: { nombre: [null, nombre], tipo: [null, tipo], departamento: [null, texto(d.departamento) || null],
        municipio: [null, texto(d.municipio) || null], region: [null, region || null], principal_id: [null, principalId] } },
    })
    ok(res, `Bodega '${nombre}' creada.`, { id: fila.id })
  } catch (e) {
    if (e.code === COD_UNICO) return error(res, 'Ya existe una bodega con ese nombre.', 409)
    throw e
  }
})

// Comprueba que la región sea una de las existentes en el programa.
const regionValida = async (region) => Boolean(await una(
  "SELECT 1 FROM public.triadas WHERE lower(btrim(region)) = lower(btrim($1)) AND region <> 'Por asignar' LIMIT 1", [region]))

// Cambia o quita la región de una bodega, de la que depende quién ve sus saldos.
router.post('/bodegas/:bid/region', soloAdmin, async (req, res) => {
  const region = texto(cuerpo(req).region)
  if (region && !(await regionValida(region))) return error(res, 'Esa región no existe.')
  const r = await una(
    `WITH previo AS (SELECT id, region FROM bodegas WHERE id = $2 AND activa)
     UPDATE bodegas b SET region = $1 FROM previo p WHERE b.id = p.id RETURNING b.id, b.nombre, p.region AS antes`,
    [region || null, req.params.bid])
  if (!r) return error(res, 'La bodega no existe.', 404)
  await registrar(actorActividad(req), {
    accion: 'inventario.bodega_region', objeto: { tipo: 'bodega', id: r.id },
    cambios: { nombre: r.nombre, campos: (r.antes ?? null) === (region || null) ? {} : { region: [r.antes ?? null, region || null] } },
  })
  ok(res, region ? 'Región actualizada.' : 'Se quitó la región.')
})

// Devuelve los saldos de productos por bodega.
router.get('/saldos-bodegas', loginRequerido, async (req, res) => {
  res.json(await saldosBodegasInventario(req.query))
})

// Asigna o quita la cuenta que consulta una bodega municipal.
router.post('/bodegas/:bid/coordinador', soloAdmin, async (req, res) => {
  const b = await una('SELECT id, nombre, tipo, coordinador_sub FROM bodegas WHERE id = $1 AND activa', [req.params.bid])
  if (!b) return error(res, 'La bodega no existe.', 404)
  if (b.tipo !== 'municipal') return error(res, 'Solo las bodegas municipales se asignan a un coordinador.')
  const cid = aInt(cuerpo(req).coordinador_id, null)
  let sub = null
  if (cid !== null) {
    const c = await una("SELECT id_coordinador FROM public.coordinadores WHERE id_coordinador = $1 AND tipo = 'coordinador' AND activo", [cid])
    if (!c) return error(res, 'Ese coordinador no existe o no es un Coordinador local regional.')
    sub = `coordinador:${cid}`
  }
  await consulta('UPDATE bodegas SET coordinador_sub = $1 WHERE id = $2', [sub, b.id])
  await registrar(actorActividad(req), {
    accion: 'inventario.bodega_coordinador', objeto: { tipo: 'bodega', id: b.id },
    cambios: { nombre: b.nombre, campos: (b.coordinador_sub ?? null) === sub ? {} : { coordinador_sub: [b.coordinador_sub ?? null, sub] } },
  })
  ok(res, sub ? 'Bodega asignada al coordinador.' : 'Se quitó la asignación.')
})

router.get('/facturas', soloAdmin, async (req, res) => {
  const facturas = await consulta(
    `SELECT f.id, f.numero, f.fecha, f.vencimiento, f.total, f.adjunto_nombre, f.creado_por, f.creado, p.nombre AS proveedor,
            f.id_unico, f.bienes_nuevos, f.entrega_pendiente,
            (SELECT COUNT(*) FROM factura_items i WHERE i.factura_id = f.id)::int AS lineas,
            COALESCE((SELECT SUM(i.cantidad) FROM factura_items i WHERE i.factura_id = f.id), 0)::int AS cantidad,
            COALESCE((SELECT SUM(i.recibido) FROM factura_items i WHERE i.factura_id = f.id), 0)::int AS recibido,
            (f.adjunto IS NOT NULL) AS tiene_adjunto
       FROM facturas f LEFT JOIN proveedores p ON p.id = f.proveedor_id
      ORDER BY f.creado DESC LIMIT 300`)
  ok(res, null, { facturas: facturas.map(conEstadoEntrega) })
})

// Agrega a cada factura su estado de entrega: pendiente, parcial o entregada, según lo recibido en bodega.
function conEstadoEntrega(f) {
  const cantidad = Number(f.cantidad || 0)
  const recibido = Number(f.recibido || 0)
  const estado = recibido <= 0 ? 'pendiente' : recibido < cantidad ? 'parcial' : 'entregada'
  return { ...f, estado_entrega: estado }
}

router.get('/facturas-por-recibir', loginRequerido, async (req, res) => {
  const esAdmin = usuarioActual(req).rol === 'admin'
  const facturas = await consulta(
    `SELECT f.id, f.numero, f.fecha, f.id_unico, p.nombre AS proveedor,
            COALESCE((SELECT SUM(i.cantidad) FROM factura_items i WHERE i.factura_id = f.id), 0)::int AS cantidad,
            COALESCE((SELECT SUM(i.recibido) FROM factura_items i WHERE i.factura_id = f.id), 0)::int AS recibido
       FROM facturas f LEFT JOIN proveedores p ON p.id = f.proveedor_id
      WHERE EXISTS (SELECT 1 FROM factura_items i WHERE i.factura_id = f.id AND i.recibido < i.cantidad)
      ORDER BY f.fecha, f.id LIMIT 300`)
  const items = await consulta(
    `SELECT i.id, i.factura_id, i.nombre, i.sku, i.cantidad, i.recibido, b.nombre AS bodega${esAdmin ? ', i.valor_unitario' : ''}
       FROM factura_items i JOIN bodegas b ON b.id = i.bodega_id
      WHERE i.factura_id = ANY($1::int[]) ORDER BY i.id`, [facturas.map((x) => x.id)])
  ok(res, null, { facturas: facturas.map((x) => ({ ...conEstadoEntrega(x), items: items.filter((i) => i.factura_id === x.id) })) })
})

// Registra la recepción contra la factura, sumando al stock lo que llega de cada línea sin pasar de lo
// facturado.
router.post('/facturas/:fid/recepcion', loginRequerido, async (req, res) => {
  const d = cuerpo(req)
  const lineas = Array.isArray(d.lineas) ? d.lineas : []
  if (!lineas.length || lineas.length > MAX_LINEAS) return error(res, 'Indica lo recibido de al menos una línea de la factura.')
  const usuario = usuarioActual(req)
  const factura = await una('SELECT id, numero, proveedor_id, id_unico FROM facturas WHERE id = $1', [req.params.fid])
  if (!factura) return error(res, 'La factura no existe.', 404)
  const recibidas = []
  await conTransaccion(async (cli) => {
    for (const ln of lineas) {
      const itemId = aInt(ln?.item_id, null)
      const cantidad = aInt(ln?.cantidad, 0) || 0
      if (itemId === null || cantidad <= 0) continue
      if (!enRango(itemId, 1, 2147483647)) throw new ErrorNegocio('Una de las líneas no es de esta factura.', 404)
      if (cantidad > MAX_CANTIDAD) throw new ErrorNegocio('La cantidad recibida por línea no puede pasar de 1.000.000.')
      const [it] = await cli.q('SELECT * FROM factura_items WHERE id = $1 AND factura_id = $2 FOR UPDATE', [itemId, factura.id])
      if (!it) throw new ErrorNegocio('Una de las líneas no es de esta factura.', 404)
      if (it.recibido + cantidad > it.cantidad) {
        throw new ErrorNegocio(`«${it.nombre}»: se facturaron ${it.cantidad} y ya se recibieron ${it.recibido}; no se pueden recibir ${cantidad} más.`, 409)
      }
      await cli.q('UPDATE factura_items SET recibido = recibido + $2 WHERE id = $1', [it.id, cantidad])
      await cli.q('UPDATE articulos SET stock = stock + $1 WHERE id = $2', [cantidad, it.articulo_id])
      await cli.q(
        `INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)
         ON CONFLICT (bodega_id, articulo_id) DO UPDATE SET cantidad = stock_bodega.cantidad + EXCLUDED.cantidad`,
        [it.bodega_id, it.articulo_id, cantidad])
      await cli.q(
        `INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, proveedor_id, codigo_proveedor)
         VALUES ($1,'entrada',$2,'recepcion factura',$3,$4,$5)`, [it.articulo_id, cantidad, factura.numero, factura.proveedor_id, it.sku])
      await cli.q('INSERT INTO factura_recepciones (factura_id, item_id, cantidad, recibido_por) VALUES ($1,$2,$3,$4)',
        [factura.id, it.id, cantidad, usuario?.nombre || null])
      recibidas.push([it.nombre, cantidad])
    }
  })
  if (!recibidas.length) return error(res, 'Indica la cantidad recibida de al menos una línea.')
  await registrar(actorActividad(req), {
    accion: 'factura.recepcion', objeto: { tipo: 'factura', id: factura.id }, idUnico: factura.id_unico || null, cambios: { lineas: recibidas } })
  ok(res, `Recepción registrada contra la factura ${factura.numero}.`)
})

router.get('/facturas/:fid', soloAdmin, async (req, res) => {
  const factura = await una(
    `SELECT f.id, f.numero, f.fecha, f.vencimiento, f.total, f.adjunto_nombre, f.creado_por, f.creado, p.nombre AS proveedor,
            p.tipo_documento AS proveedor_tipo_documento, p.numero_documento AS proveedor_documento, p.telefono AS proveedor_telefono,
            (f.adjunto IS NOT NULL) AS tiene_adjunto, f.id_unico, f.bienes_nuevos, f.entrega_pendiente
       FROM facturas f LEFT JOIN proveedores p ON p.id = f.proveedor_id WHERE f.id = $1`, [req.params.fid])
  if (!factura) return error(res, 'La factura no existe.', 404)
  const items = await consulta(
    `SELECT i.id, i.nombre, i.descripcion, i.sku, i.cantidad, i.recibido, i.valor_unitario, i.valor_impuesto, i.total,
            b.nombre AS bodega
       FROM factura_items i JOIN bodegas b ON b.id = i.bodega_id WHERE i.factura_id = $1 ORDER BY i.id`, [factura.id])
  const recepciones = await consulta(
    `SELECT r.id, r.item_id, i.nombre, r.cantidad, r.recibido_por, r.fecha FROM factura_recepciones r
       JOIN factura_items i ON i.id = r.item_id WHERE r.factura_id = $1 ORDER BY r.fecha, r.id`, [factura.id])
  const cantidad = items.reduce((a, i) => a + Number(i.cantidad), 0)
  const recibido = items.reduce((a, i) => a + Number(i.recibido), 0)
  ok(res, null, { factura: conEstadoEntrega({ ...factura, cantidad, recibido }), items, recepciones })
})

router.get('/facturas/:fid/adjunto', soloAdmin, async (req, res) => {
  const f = await una('SELECT adjunto, adjunto_nombre FROM facturas WHERE id = $1', [req.params.fid])
  if (!f || !f.adjunto) return error(res, 'La factura no tiene adjunto.', 404)
  enviarPdf(res, f.adjunto, f.adjunto_nombre || `factura-${req.params.fid}.pdf`)
})

// Valida una línea del cuerpo y devuelve sus valores limpios; el total lo calcula el servidor.
function lineaValida(ln, n, bodegasPrincipales) {
  const nombre = texto(ln?.nombre)
  const descripcion = texto(ln?.descripcion)
  const sku = texto(ln?.sku)
  const cantidad = aInt(ln?.cantidad, 0) || 0
  const unitario = redondear(aFloat(ln?.valor_unitario, NaN))
  const impuesto = redondear(aFloat(ln?.valor_impuesto, 0))
  const bodegaId = aInt(ln?.bodega_id, null)
  const donde = `Línea ${n}:`
  if (!nombre) throw new ErrorNegocio(`${donde} falta el nombre.`)
  if (nombre.length > 200 || descripcion.length > 1000 || sku.length > 60) throw new ErrorNegocio(`${donde} algún texto es demasiado largo.`)
  if (!sku) throw new ErrorNegocio(`${donde} falta el SKU.`)
  if (!enRango(cantidad, 1, MAX_CANTIDAD)) throw new ErrorNegocio(`${donde} la cantidad debe estar entre 1 y 1.000.000.`)
  if (!enRango(unitario, 0, MAX_VALOR)) throw new ErrorNegocio(`${donde} el valor unitario no es válido.`)
  if (!enRango(impuesto, 0, MAX_VALOR)) throw new ErrorNegocio(`${donde} el valor del impuesto no es válido.`)
  if (!bodegasPrincipales.has(bodegaId)) throw new ErrorNegocio(`${donde} elige la bodega principal a la que va la mercancía.`)
  return { nombre, descripcion: descripcion || null, sku, cantidad, unitario, impuesto, bodegaId,
    total: redondear(cantidad * unitario + impuesto) }
}

// Registra una factura de compra con sus líneas y su archivo adjunto; exige elegir el proveedor.
router.post('/facturas', soloAdmin, limiteFactura, subida.single('adjunto'), async (req, res) => {
  let d
  try { d = JSON.parse(req.body?.datos || '{}') } catch { return error(res, 'Los datos de la factura no son válidos.') }
  if (!d || typeof d !== 'object') return error(res, 'Los datos de la factura no son válidos.')
  const numero = texto(d.numero)
  if (!numero || numero.length > 60) return error(res, 'El número de la factura es obligatorio (máximo 60 caracteres).')
  const proveedorId = aInt(d.proveedor_id, null)
  if (proveedorId === null || !(await una('SELECT id FROM proveedores WHERE id = $1', [proveedorId]))) {
    return error(res, 'Selecciona el proveedor de la factura.')
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(texto(d.fecha)) ? texto(d.fecha) : null
  const vencimiento = /^\d{4}-\d{2}-\d{2}$/.test(texto(d.vencimiento)) ? texto(d.vencimiento) : null
  if (vencimiento && fecha && vencimiento < fecha) return error(res, 'El vencimiento no puede ser anterior a la fecha de la factura.')
  const lineas = Array.isArray(d.lineas) ? d.lineas : []
  if (!lineas.length) return error(res, 'La factura necesita al menos una línea.')
  if (lineas.length > MAX_LINEAS) return error(res, `Una factura admite como máximo ${MAX_LINEAS} líneas.`)
  const archivo = req.file
  if (archivo && (archivo.buffer.subarray(0, 5).toString('latin1') !== '%PDF-' || !/\.pdf$/i.test(archivo.originalname || ''))) {
    return error(res, 'El adjunto debe ser un archivo PDF.')
  }
  const capitalizacion = d.capitalizacion === true
  const idUnico = capitalizacion ? texto(d.id_unico) : ''
  if (capitalizacion) {
    if (!idUnico) return error(res, 'La factura de capitalización necesita la unidad productiva (ID).')
    const plan = await una(
      `SELECT c.estado FROM public.carritos c JOIN public.unidades_productivas up ON up.id_up = c.id_up
        WHERE up.id_unico = $1 ORDER BY (c.id_origen LIKE 'LOCAL-%') DESC, c.id_carrito DESC LIMIT 1`, [idUnico])
    if (!plan || !PLAN_APROBADO.includes(plan.estado)) {
      return error(res, `La unidad ${idUnico} no tiene un plan de capitalización aprobado por el comité.`)
    }
    if (d.bienes_nuevos !== true) return error(res, 'Declara que los bienes de la factura de capitalización son nuevos.')
  }
  const pendiente = d.entrega_pendiente === true

  const principales = new Set((await consulta("SELECT id FROM bodegas WHERE tipo = 'principal' AND activa")).map((b) => b.id))
  const usuario = usuarioActual(req)
  try {
    const id = await conTransaccion(async (cli) => {
      await cli.q('SELECT pg_advisory_xact_lock(7002)')
      const limpias = lineas.map((ln, i) => lineaValida(ln, i + 1, principales))
      const total = redondear(limpias.reduce((s, l) => s + l.total, 0))
      const [f] = await cli.q(
        `INSERT INTO facturas (numero, proveedor_id, fecha, vencimiento, total, adjunto, adjunto_nombre, creado_por, id_unico, bienes_nuevos, entrega_pendiente)
         VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4::date,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [numero, proveedorId, fecha, vencimiento, total, archivo?.buffer ?? null,
          archivo ? String(archivo.originalname).slice(0, 200) : null, usuario?.nombre || null,
          idUnico || null, capitalizacion ? true : null, pendiente])
      for (const l of limpias) {
        let [art] = await cli.q(
          'SELECT id FROM articulos WHERE activo AND (codigo_proveedor = $1 OR codigo_barras = $1) ORDER BY id LIMIT 1', [l.sku])
        if (!art) {
          ;[art] = await cli.q(
            `INSERT INTO articulos (nombre, codigo_proveedor, proveedor_id, codigo_barras, precio, stock, minimo)
             VALUES ($1,$2,$3,$4,$5,0,0) RETURNING id`,
            [l.nombre, l.sku, proveedorId, 'PENDIENTE-' + Math.random().toString(36).slice(2, 12), l.unitario])
          await cli.q('UPDATE articulos SET codigo_barras = $1 WHERE id = $2', [codigoArticulo(art.id), art.id])
        }
        if (!pendiente) {
          await cli.q('UPDATE articulos SET stock = stock + $1 WHERE id = $2', [l.cantidad, art.id])
          await cli.q(
            `INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)
             ON CONFLICT (bodega_id, articulo_id) DO UPDATE SET cantidad = stock_bodega.cantidad + EXCLUDED.cantidad`,
            [l.bodegaId, art.id, l.cantidad])
          await cli.q(
            `INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, proveedor_id, codigo_proveedor)
             VALUES ($1,'entrada',$2,'factura',$3,$4,$5)`, [art.id, l.cantidad, numero, proveedorId, l.sku])
        }
        await cli.q(
          `INSERT INTO factura_items (factura_id, bodega_id, articulo_id, nombre, descripcion, sku, cantidad,
                                      valor_unitario, valor_impuesto, total, recibido)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [f.id, l.bodegaId, art.id, l.nombre, l.descripcion, l.sku, l.cantidad, l.unitario, l.impuesto, l.total, pendiente ? 0 : l.cantidad])
      }
      return f.id
    })
    await registrar(actorActividad(req), {
      accion: idUnico ? 'factura.capitalizacion' : 'factura.registrar', objeto: { tipo: 'factura', id }, idUnico: idUnico || null,
      cambios: { numero, proveedor: proveedorId, pendiente, lineas: lineas.length, adjunto: archivo ? corto(String(archivo.originalname), 200) : null } })
    ok(res, `Factura ${numero} registrada${pendiente ? ': pendiente de entrega del proveedor' : ''}.`, { id })
  } catch (e) {
    if (e.code === COD_UNICO) return error(res, 'Ya registraste una factura con ese número para ese proveedor.', 409)
    throw e
  }
})

router.get('/traslados', soloAdmin, async (req, res) => {
  const traslados = await consulta(
    `SELECT t.id, t.nota, t.creado_por, t.fecha, o.nombre AS origen, d.nombre AS destino,
            (SELECT json_agg(json_build_object('nombre', a.nombre, 'cantidad', i.cantidad) ORDER BY a.nombre)
               FROM traslado_items i JOIN articulos a ON a.id = i.articulo_id WHERE i.traslado_id = t.id) AS items
       FROM traslados t JOIN bodegas o ON o.id = t.origen_id JOIN bodegas d ON d.id = t.destino_id
      ORDER BY t.fecha DESC LIMIT 300`)
  ok(res, null, { traslados })
})

// Traslada artículos entre dos bodegas distintas y exige una nota del traslado.
router.post('/traslados', soloAdmin, async (req, res) => {
  const d = cuerpo(req)
  const nota = texto(d.nota)
  if (!nota || nota.length > 2000) return error(res, 'La nota del traslado es obligatoria (máximo 2000 caracteres).')
  const origenId = aInt(d.origen_id, null)
  const destinoId = aInt(d.destino_id, null)
  if (origenId === null || destinoId === null || origenId === destinoId) {
    return error(res, 'Elige una bodega de origen y otra distinta de destino.')
  }
  const pedidas = new Map()
  for (const ln of Array.isArray(d.items) ? d.items : []) {
    const aid = aInt(ln?.articulo_id, null)
    const cant = aInt(ln?.cantidad, 0) || 0
    if (aid === null || cant <= 0) continue
    if (cant > MAX_CANTIDAD) return error(res, 'La cantidad por línea no puede pasar de 1.000.000.')
    pedidas.set(aid, (pedidas.get(aid) || 0) + cant)
  }
  if (!pedidas.size) return error(res, 'Agrega al menos un artículo con cantidad.')
  if (pedidas.size > 200) return error(res, 'Un traslado admite como máximo 200 artículos.')
  const usuario = usuarioActual(req)
  const id = await conTransaccion(async (cli) => {
    const bodegas = await cli.q('SELECT id FROM bodegas WHERE id = ANY($1::int[]) AND activa', [[origenId, destinoId]])
    if (bodegas.length !== 2) throw new ErrorNegocio('Alguna de las bodegas no existe.')
    const [t] = await cli.q(
      'INSERT INTO traslados (origen_id, destino_id, nota, creado_por) VALUES ($1,$2,$3,$4) RETURNING id',
      [origenId, destinoId, nota, usuario?.nombre || null])
    for (const [aid, cant] of [...pedidas].sort((a, b) => a[0] - b[0])) {
      const [s] = await cli.q(
        'SELECT s.cantidad, a.nombre FROM stock_bodega s JOIN articulos a ON a.id = s.articulo_id WHERE s.bodega_id = $1 AND s.articulo_id = $2 FOR UPDATE',
        [origenId, aid])
      if (!s || s.cantidad < cant) {
        const nombre = s?.nombre || (await cli.q('SELECT nombre FROM articulos WHERE id = $1', [aid]))[0]?.nombre || `#${aid}`
        throw new ErrorNegocio(`La bodega de origen no tiene ${cant} de «${nombre}» (hay ${s?.cantidad ?? 0}).`, 409)
      }
      await cli.q('UPDATE stock_bodega SET cantidad = cantidad - $1 WHERE bodega_id = $2 AND articulo_id = $3', [cant, origenId, aid])
      await cli.q(
        `INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)
         ON CONFLICT (bodega_id, articulo_id) DO UPDATE SET cantidad = stock_bodega.cantidad + EXCLUDED.cantidad`,
        [destinoId, aid, cant])
      await cli.q('INSERT INTO traslado_items (traslado_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [t.id, aid, cant])
    }
    return t.id
  })
  await registrar(actorActividad(req), {
    accion: 'inventario.traslado', objeto: { tipo: 'traslado', id },
    cambios: { origen: origenId, destino: destinoId, nota: corto(nota), items: [...pedidas].sort((a, b) => a[0] - b[0]) },
  })
  ok(res, 'Traslado registrado.', { id })
})

export default router
