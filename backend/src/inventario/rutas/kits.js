// API de los kits (combos): listado con la cantidad que se puede armar, creación, armado y borrado, además de
// las novedades de kits (dañado, incompleto) con fotos y el acta de elementos defectuosos.
import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { bodegaOperativa } from '../bodegaOperativa.js'
import { consulta, una, conTransaccion, pool, COD_UNICO, COD_CHECK } from '../db.js'
import { soloAdmin, loginRequerido, usuarioActual, registrarEvento, actorActividad } from '../seguridad.js'
import {
  ok, error, cuerpo, texto, aInt, codigoKit, soloEnteros, validarLargos, ErrorNegocio, enviarPdf,
} from '../util.js'
import { registrar } from '../../servicios/actividad.js'
import { TIPOS_DEFECTO, actaPorId, avisarDefectuoso, idUnicoDeKit, pdfActa } from '../../servicios/defectuosos.js'
import { diaColombia, fechaReal, hoyColombia } from '../../servicios/secciones.js'

const router = Router()
router.param('cid', soloEnteros)
router.param('nid', soloEnteros)
router.param('aid', soloEnteros)

// Calcula cuántos kits completos alcanzan con el stock de un artículo.
const capacidad = (it) => (it.cantidad > 0 ? Math.floor(it.stock / it.cantidad) : 0)

// Calcula cuántos kits se pueden armar según el stock; con bloqueo, las filas de artículos se bloquean en orden
// de id para evitar interbloqueos.
async function calcularArmables(cli, comboId, bloquear = false, bodegaId = null) {
  const items = await cli.q(
    `SELECT ci.cantidad, CASE WHEN a.activo THEN CASE WHEN $2::int IS NULL THEN a.stock
              ELSE COALESCE((SELECT s.cantidad FROM stock_bodega s WHERE s.articulo_id = a.id AND s.bodega_id = $2), 0) END
              ELSE 0 END AS stock, a.nombre, a.id AS art_id
     FROM (SELECT articulo_id, SUM(cantidad)::int AS cantidad FROM combo_items WHERE combo_id = $1 GROUP BY articulo_id) ci
     JOIN articulos a ON a.id = ci.articulo_id
     ORDER BY a.id${bloquear ? ' FOR UPDATE OF a' : ''}`,
    [comboId, bodegaId],
  )
  if (!items.length) return 0
  return Math.min(...items.map(capacidad))
}

// Lista los kits con sus componentes y cuántos se pueden armar.
router.get('/', loginRequerido, async (req, res) => {
  let bodega = null
  let aviso = ''
  if (usuarioActual(req).rol === 'bodeguero') {
    try { bodega = await bodegaOperativa(req) } catch (e) {
      if (e.codigo !== 403) throw e
      aviso = e.message
    }
  }
  const bodegaId = usuarioActual(req).rol === 'bodeguero' ? (bodega?.id || -1) : null
  const combos = await consulta(
    `SELECT c.*, EXISTS (SELECT 1 FROM entregas_kits e WHERE e.combo_id = c.id) AS entregado,
            (SELECT COUNT(*)::int FROM kit_novedad_kits n WHERE n.combo_id = c.id) AS novedades
       FROM combos c ORDER BY nombre`)

  const compRows = await consulta(
    `SELECT ci.combo_id, ci.cantidad,
            a.id AS art_id, a.nombre, a.codigo_barras,
            CASE WHEN a.activo THEN CASE WHEN $1::int IS NULL THEN a.stock
              ELSE COALESCE((SELECT s.cantidad FROM stock_bodega s WHERE s.articulo_id = a.id AND s.bodega_id = $1), 0) END
              ELSE 0 END AS stock
     FROM (SELECT combo_id, articulo_id, SUM(cantidad)::int AS cantidad FROM combo_items GROUP BY combo_id, articulo_id) ci
     JOIN articulos a ON a.id = ci.articulo_id
     ORDER BY ci.combo_id, a.id`, [bodegaId],
  )
  const porCombo = new Map()
  for (const r of compRows) {
    if (!porCombo.has(r.combo_id)) porCombo.set(r.combo_id, [])
    porCombo.get(r.combo_id).push(r)
  }

  const kits = combos.map((c) => {
    const items = porCombo.get(c.id) || []
    const detalle = items.map((it) => ({
      nombre: it.nombre, requiere: it.cantidad, stock: it.stock,
      alcanza_para: capacidad(it), art_id: it.art_id,
    }))
    return {
      combo: c,
      armables: items.length ? Math.min(...items.map(capacidad)) : 0,
      detalle,
      items,
    }
  })

  const articulos = usuarioActual(req).rol === 'admin'
    ? await consulta('SELECT * FROM articulos WHERE activo ORDER BY nombre')
    : []
  ok(res, null, { kits, articulos, bodega, aviso })
})

// Crea un kit con sus artículos y cantidades.
router.post('/', soloAdmin, async (req, res) => {
  const datos = cuerpo(req)
  const largo = validarLargos(datos, { nombre: 120 })
  if (largo) return error(res, largo)
  const nombre = texto(datos.nombre)
  if (!nombre) return error(res, 'El nombre del Kit UP es obligatorio.')

  const items = Array.isArray(datos.items) ? datos.items : []
  if (items.length > 200) return error(res, 'Un Kit UP admite como maximo 200 articulos distintos.')
  const pares = []
  for (const it of items) {
    const aid = aInt(it?.articulo_id)
    const cant = aInt(it?.cantidad, 0) || 0
    if (cant > 100_000) return error(res, 'La cantidad por articulo no puede pasar de 100.000.')
    if (aid !== null && cant > 0) pares.push([aid, cant])
  }
  if (!pares.length) return error(res, 'Agrega al menos un articulo con cantidad al Kit UP.')

  let comboId
  let idUnico = null
  try {
    comboId = await conTransaccion(async (cli) => {
      const [fila] = await cli.q(
        `INSERT INTO combos (nombre, codigo_barras, stock)
         VALUES ($1, $2, 0) RETURNING id`,
        [nombre, 'PENDIENTE-' + crypto.randomBytes(6).toString('hex')],
      )
      await cli.q('UPDATE combos SET codigo_barras = $1 WHERE id = $2', [codigoKit(fila.id), fila.id])
      for (const [aid, cant] of pares) {
        await cli.q(
          'INSERT INTO combo_items (combo_id, articulo_id, cantidad) VALUES ($1, $2, $3)',
          [fila.id, aid, cant],
        )
      }
      idUnico = await idUnicoDeKit(cli, nombre)
      return fila.id
    })
  } catch (e) {
    if (e.code === COD_UNICO) {
      return error(res, `Ya existe un Kit UP llamado '${nombre}'. Cada unidad productiva es unica.`, 409)
    }
    console.error('Error creando el Kit UP:', e)
    return error(res, 'No se pudo crear el Kit UP. Revisa que los articulos existan.')
  }

  const codigo = codigoKit(comboId)
  await registrar(actorActividad(req), {
    accion: 'kit.crear', objeto: { tipo: 'kit', id: comboId }, idUnico,
    cambios: { nombre, codigo_barras: codigo, items: pares },
  })
  ok(res, `Kit UP '${nombre}' creado con codigo ${codigo}.`, { id: comboId, codigo_barras: codigo })
})

// Arma un kit descontando del stock sus artículos.
router.post('/:cid/armar', loginRequerido, async (req, res) => {
  const cid = Number(req.params.cid)
  let nombre
  let bodegaArmado = null
  try {
    nombre = await conTransaccion(async (cli) => {
      const bodega = usuarioActual(req).rol === 'bodeguero' ? await bodegaOperativa(req, undefined, cli) : null
      bodegaArmado = bodega?.id || null
      const [combo] = await cli.q('SELECT * FROM combos WHERE id = $1 FOR UPDATE', [cid])
      if (!combo) throw new ErrorNegocio('El Kit UP no existe.', 404)

      if (combo.armado) {
        throw new ErrorNegocio(
          `'${combo.nombre}' ya tiene su Kit UP armado. Cada unidad productiva se arma una sola vez.`,
          409)
      }

      if ((await calcularArmables(cli, cid, true, bodega?.id || null)) < 1) {
        throw new ErrorNegocio(`Stock insuficiente para armar el Kit UP de '${combo.nombre}'.`, 409)
      }

      await cli.q('UPDATE combos SET stock = 1, armado = TRUE, armado_en = now(), descontado_al_armar = FALSE WHERE id = $1', [cid])
      return combo.nombre
    })
  } catch (e) {
    if (e.code === COD_CHECK) {
      return error(res, 'Stock insuficiente: la operacion se cancelo completa.', 409)
    }
    throw e
  }
  registrarEvento(req, 'kit_armado', { detalle: nombre })
  await registrar(actorActividad(req), {
    accion: 'kit.armar', objeto: { tipo: 'kit', id: cid }, idUnico: await idUnicoDeKit(pool, nombre),
    cambios: { nombre, bodega: bodegaArmado, campos: { armado: [false, true] } },
  })
  ok(res, `Kit UP de '${nombre}' armado.`)
})

// Elimina un kit que aún no está armado; los armados quedan en el registro.
router.delete('/:cid', soloAdmin, async (req, res) => {
  const cid = Number(req.params.cid)
  const combo = await una('SELECT armado, nombre, codigo_barras FROM combos WHERE id = $1', [cid])
  if (!combo) return error(res, 'El Kit UP no existe.', 404)
  if (combo.armado) {
    return error(res, 'No se puede eliminar un Kit UP ya armado; queda en el registro.', 409)
  }
  if (await una('SELECT 1 FROM kit_novedad_kits k JOIN kit_novedades n ON n.id = k.novedad_id WHERE k.combo_id = $1 AND n.estado IS NOT NULL LIMIT 1', [cid])) {
    return error(res, 'No se puede eliminar un Kit UP con actas de elementos defectuosos; quedan en el registro.', 409)
  }
  await consulta('DELETE FROM combos WHERE id = $1', [cid])
  await registrar(actorActividad(req), {
    accion: 'kit.eliminar', objeto: { tipo: 'kit', id: cid }, idUnico: await idUnicoDeKit(pool, combo.nombre),
    cambios: { nombre: combo.nombre, codigo_barras: combo.codigo_barras },
  })
  ok(res, 'Kit UP eliminado.')
})

// Tipos de novedad que se pueden registrar sobre un kit.
const TIPOS_NOVEDAD = ['danado', 'incompleto', 'otro']
const MAX_FOTO = 10 * 1024 * 1024
const MAX_ARTICULOS_NOVEDAD = 20
// Configuración de la carga de fotos, una por artículo, en campos con nombre foto_<id del artículo>.
const subidaFotos = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FOTO, files: MAX_ARTICULOS_NOVEDAD, fields: 5, fieldSize: 5000 } })
const CAMPO_FOTO = /^foto_(\d{1,9})$/

// Devuelve los artículos del kit con su cantidad, sumando los componentes repetidos.
const articulosDelKit = (cid, q = consulta) => q(
  `SELECT a.id AS articulo_id, a.nombre, SUM(ci.cantidad)::int AS cantidad
     FROM combo_items ci JOIN articulos a ON a.id = ci.articulo_id
    WHERE ci.combo_id = $1 GROUP BY a.id, a.nombre ORDER BY a.nombre`, [cid])

// Acepta solo imágenes JPG o PNG reales, mirando el contenido y no solo el nombre.
function tipoFoto(f, nombre) {
  const b = f.buffer
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  throw new ErrorNegocio(`La foto de «${nombre}» debe ser una imagen JPG o PNG válida de máximo 10 MB.`)
}

// Interpreta la lista JSON de artículos de una novedad.
function articulosPedidos(valor) {
  let lista
  try { lista = JSON.parse(texto(valor) || '[]') } catch { return null }
  if (!Array.isArray(lista)) return null
  return lista.map((x) => ({ articulo_id: aInt(x?.articulo_id, null), cantidad: aInt(x?.cantidad, null) }))
}

router.get('/:cid/novedades', loginRequerido, async (req, res) => {
  const cid = Number(req.params.cid)
  const combo = await una('SELECT id, nombre FROM combos WHERE id = $1', [cid])
  if (!combo) return error(res, 'El Kit UP no existe.', 404)
  const [articulos, novedades, proveedores] = await Promise.all([
    articulosDelKit(cid),
    consulta(
      `SELECT n.id, n.tipo, n.texto, n.creado_por, n.creado, n.foto IS NOT NULL AS con_foto,
              n.id_unico, n.estado, n.reporte, n.devolucion, n.reemplazo, n.reemplazo_soporte IS NOT NULL AS reemplazo_con_soporte,
              COALESCE((SELECT json_agg(json_build_object('articulo_id', na.articulo_id, 'nombre', na.nombre, 'cantidad', na.cantidad,
                                                          'con_foto', na.foto IS NOT NULL) ORDER BY na.nombre)
                          FROM kit_novedad_articulos na WHERE na.novedad_id = n.id), '[]') AS articulos,
              COALESCE((SELECT json_agg(c2.nombre ORDER BY c2.nombre) FROM kit_novedad_kits k2
                          JOIN combos c2 ON c2.id = k2.combo_id WHERE k2.novedad_id = n.id AND k2.combo_id <> $1), '[]') AS tambien
         FROM kit_novedades n JOIN kit_novedad_kits k ON k.novedad_id = n.id
        WHERE k.combo_id = $1 ORDER BY n.creado DESC, n.id DESC LIMIT 100`, [cid]),
    consulta('SELECT id, nombre FROM proveedores ORDER BY lower(nombre) LIMIT 1000'),
  ])
  ok(res, null, { kit: { ...combo, articulos }, novedades, proveedores })
})

// Registra una novedad de un kit con sus artículos y fotos.
router.post('/novedades', loginRequerido, (req, res, next) => subidaFotos.any()(req, res, (e) => {
  if (e?.code === 'LIMIT_FILE_SIZE') return error(res, 'Alguna de las fotos supera el máximo de 10 MB.', 413)
  if (e?.code === 'LIMIT_FILE_COUNT') return error(res, `Una novedad admite como máximo ${MAX_ARTICULOS_NOVEDAD} fotos.`)
  next(e)
}), async (req, res) => {
  const d = cuerpo(req)
  const largo = validarLargos(d, { texto: 2000 })
  if (largo) return error(res, largo)
  const descripcion = texto(d.texto)
  if (!descripcion) return error(res, 'Describe el estado del kit.')
  const tipo = TIPOS_NOVEDAD.includes(texto(d.tipo)) ? texto(d.tipo) : null
  if (!tipo) return error(res, 'Elige el tipo de novedad.')
  const cid = aInt(d.kit_id, null)
  if (!cid) return error(res, 'Elige el kit.')
  const pedidos = articulosPedidos(d.articulos)
  if (!pedidos) return error(res, 'La lista de artículos no es válida.')
  if (!pedidos.length) return error(res, 'Elige al menos un artículo del kit.')
  if (pedidos.length > MAX_ARTICULOS_NOVEDAD) return error(res, `Una novedad admite como máximo ${MAX_ARTICULOS_NOVEDAD} artículos.`)
  const kit = await una('SELECT id, nombre FROM combos WHERE id = $1', [cid])
  if (!kit) return error(res, 'El Kit UP no existe.', 404)
  const delKit = new Map((await articulosDelKit(cid)).map((a) => [a.articulo_id, a]))
  const vistos = new Set()
  for (const p of pedidos) {
    const a = delKit.get(p.articulo_id)
    if (!a) return error(res, 'Alguno de los artículos no hace parte del kit.')
    if (vistos.has(p.articulo_id)) return error(res, `«${a.nombre}» está repetido en la novedad.`)
    vistos.add(p.articulo_id)
    if (!p.cantidad || p.cantidad < 1 || p.cantidad > a.cantidad) {
      return error(res, `La cantidad afectada de «${a.nombre}» debe estar entre 1 y ${a.cantidad}.`)
    }
  }
  const fotos = new Map()
  for (const f of req.files || []) {
    const aid = Number(CAMPO_FOTO.exec(f.fieldname)?.[1])
    if (!vistos.has(aid) || fotos.has(aid)) return error(res, 'Cada foto debe ser de uno de los artículos elegidos, una por artículo.')
    fotos.set(aid, { buffer: f.buffer, tipo: tipoFoto(f, delKit.get(aid).nombre), nombre: String(f.originalname || 'foto').replace(/[\r\n\\/]/g, '_').slice(0, 200) })
  }
  const sinFoto = pedidos.find((p) => !fotos.has(p.articulo_id))
  if (sinFoto) return error(res, `Adjunta la foto de «${delKit.get(sinFoto.articulo_id).nombre}».`)
  const u = usuarioActual(req)
  const defecto = TIPOS_DEFECTO.includes(tipo)
  let idUnico = null
  let avisado = null
  const id = await conTransaccion(async (cli) => {
    idUnico = await idUnicoDeKit(cli, kit.nombre)
    const [n] = await cli.q('INSERT INTO kit_novedades (tipo, texto, creado_por, id_unico, estado) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [tipo, descripcion, u.nombre, idUnico, defecto ? 'reportada' : null])
    await cli.q('INSERT INTO kit_novedad_kits (novedad_id, combo_id) VALUES ($1,$2)', [n.id, kit.id])
    for (const p of pedidos) {
      const f = fotos.get(p.articulo_id)
      await cli.q(
        `INSERT INTO kit_novedad_articulos (novedad_id, articulo_id, nombre, cantidad, foto, foto_nombre, foto_tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [n.id, p.articulo_id, delKit.get(p.articulo_id).nombre, p.cantidad, f.buffer, f.nombre, f.tipo])
    }
    if (defecto && idUnico) {
      avisado = Boolean(await avisarDefectuoso(cli, { id: n.id, idUnico, kit: kit.nombre, tipo, texto: descripcion, por: u.nombre,
        articulos: pedidos.map((p) => ({ cantidad: p.cantidad, nombre: delKit.get(p.articulo_id).nombre })) }))
    }
    return n.id
  })
  const resumen = pedidos.map((p) => `${p.cantidad} × ${delKit.get(p.articulo_id).nombre}`).join(', ')
  registrarEvento(req, 'kit_novedad', { detalle: `${kit.nombre}: ${resumen} (${tipo})`.slice(0, 120) })
  await registrar(actorActividad(req), { accion: defecto ? 'kit_defectuoso.reportar' : 'kit_novedad.registrar', objeto: { tipo: 'kit_novedad', id },
    idUnico, cambios: { kit: kit.nombre, tipo, articulos: resumen, ...(defecto ? { aviso_coordinacion: avisado === true } : {}) } })
  const sinAviso = !idUnico ? ' No se encontró la unidad productiva del kit: no se avisó a la coordinación.'
    : avisado ? '' : ' La unidad no tiene un Coordinador local regional activo con correo: no se envió el aviso (el acta se ve en Entregas › Elementos defectuosos).'
  ok(res, defecto ? `Acta de elementos defectuosos registrada en «${kit.nombre}».${sinAviso}` : `Novedad registrada en «${kit.nombre}».`, { id })
})

// Envía una foto guardada como respuesta.
const enviarFoto = (res, f) => {
  if (!f?.foto) return error(res, 'La foto no existe.', 404)
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  res.type(f.foto_tipo).send(f.foto)
}

router.get('/:cid/novedades/:nid/foto', loginRequerido, async (req, res) => {
  enviarFoto(res, await una(
    `SELECT n.foto, n.foto_tipo FROM kit_novedades n JOIN kit_novedad_kits k ON k.novedad_id = n.id
      WHERE n.id = $1 AND k.combo_id = $2`, [Number(req.params.nid), Number(req.params.cid)]))
})

router.get('/:cid/novedades/:nid/articulos/:aid/foto', loginRequerido, async (req, res) => {
  enviarFoto(res, await una(
    `SELECT na.foto, na.foto_tipo FROM kit_novedad_articulos na JOIN kit_novedad_kits k ON k.novedad_id = na.novedad_id
      WHERE na.novedad_id = $1 AND k.combo_id = $2 AND na.articulo_id = $3`,
    [Number(req.params.nid), Number(req.params.cid), Number(req.params.aid)]))
})

const subidaSoporte = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FOTO, files: 1, fields: 4, fieldSize: 8000 } })

// Valida una fecha real, no futura y no anterior a un límite.
function fechaEntre(valor, desde, que) {
  const f = texto(valor).slice(0, 10)
  if (!fechaReal(f) || f > hoyColombia()) throw new ErrorNegocio(`La fecha ${que} no es válida (no puede ser futura).`)
  if (desde && f < desde) throw new ErrorNegocio(`La fecha ${que} no puede ser anterior al ${desde}.`)
  return f
}

function tipoSoporte(f) {
  if (!f) throw new ErrorNegocio('Adjunta el soporte del reemplazo (PDF, JPG o PNG).')
  const b = f.buffer
  if (/\.pdf$/i.test(f.originalname) && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
  throw new ErrorNegocio('El soporte del reemplazo debe ser un PDF, JPG o PNG válido de máximo 10 MB.')
}

// Obtiene bloqueada el acta de una novedad dañada o incompleta para poder actualizarla.
async function actaParaActualizar(cli, nid, req) {
  await bodegaOperativa(req, undefined, cli)
  const [n] = await cli.q('SELECT * FROM kit_novedades WHERE id = $1 FOR UPDATE', [nid])
  if (!n || !TIPOS_DEFECTO.includes(n.tipo)) throw new ErrorNegocio('El acta de elementos defectuosos no existe.', 404)
  return n
}

router.get('/:cid/novedades/:nid/acta', loginRequerido, async (req, res) => {
  const enKit = await una('SELECT 1 FROM kit_novedad_kits WHERE novedad_id = $1 AND combo_id = $2', [Number(req.params.nid), Number(req.params.cid)])
  const n = enKit && await actaPorId(req.params.nid, { fotos: true })
  if (!n) return error(res, 'El acta de elementos defectuosos no existe.', 404)
  const { buffer, nombre } = await pdfActa(n)
  enviarPdf(res, buffer, nombre)
})

// Registra la devolución de los elementos defectuosos a un proveedor, con guía y nota.
router.post('/novedades/:nid/devolucion', loginRequerido, async (req, res) => {
  const d = cuerpo(req)
  const largo = validarLargos(d, { guia: 100, nota: 1000 })
  if (largo) return error(res, largo)
  const pid = aInt(d.proveedor_id, null)
  if (!pid) return error(res, 'Elige el proveedor al que se devuelven los elementos.')
  const u = usuarioActual(req)
  const r = await conTransaccion(async (cli) => {
    const n = await actaParaActualizar(cli, Number(req.params.nid), req)
    if ((n.estado || 'reportada') !== 'reportada') throw new ErrorNegocio('La devolución ya está registrada.', 409)
    const [p] = await cli.q('SELECT id, nombre FROM proveedores WHERE id = $1', [pid])
    if (!p) throw new ErrorNegocio('El proveedor no existe.', 404)
    const devolucion = { proveedor_id: p.id, proveedor: p.nombre, fecha: fechaEntre(d.fecha, diaColombia(n.creado), 'de la devolución'),
      guia: texto(d.guia) || null, nota: texto(d.nota) || null, registrada_por: u.nombre, registrada_en: new Date().toISOString() }
    await cli.q("UPDATE kit_novedades SET devolucion = $2, estado = 'devuelta' WHERE id = $1", [n.id, JSON.stringify(devolucion)])
    return { n, devolucion }
  })
  registrarEvento(req, 'kit_defectuoso_devuelto', { detalle: String(r.n.id) })
  await registrar(actorActividad(req), { accion: 'kit_defectuoso.devolucion', objeto: { tipo: 'kit_novedad', id: r.n.id }, idUnico: r.n.id_unico,
    cambios: { proveedor: r.devolucion.proveedor, fecha: r.devolucion.fecha, campos: { estado: [r.n.estado || 'reportada', 'devuelta'] } } })
  ok(res, 'Devolución al proveedor registrada.', { id: r.n.id })
})

// Registra el reemplazo de los elementos defectuosos con su soporte.
router.post('/novedades/:nid/reemplazo', loginRequerido, (req, res, next) => subidaSoporte.single('soporte')(req, res, (e) => {
  if (e?.code === 'LIMIT_FILE_SIZE') return error(res, 'El soporte supera el máximo de 10 MB.', 413)
  next(e)
}), async (req, res) => {
  const d = cuerpo(req)
  const largo = validarLargos(d, { nota: 1000 })
  if (largo) return error(res, largo)
  const u = usuarioActual(req)
  const r = await conTransaccion(async (cli) => {
    const n = await actaParaActualizar(cli, Number(req.params.nid), req)
    if (n.estado !== 'devuelta') {
      throw new ErrorNegocio(n.estado === 'reemplazada' ? 'El reemplazo ya está registrado.' : 'Registra primero la devolución al proveedor.', 409)
    }
    const reemplazo = { fecha: fechaEntre(d.fecha, n.devolucion?.fecha, 'del reemplazo'), nota: texto(d.nota) || null,
      soporte_nombre: Buffer.from(req.file?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 200),
      registrado_por: u.nombre, registrado_en: new Date().toISOString() }
    const tipo = tipoSoporte(req.file)
    await cli.q("UPDATE kit_novedades SET reemplazo = $2, reemplazo_soporte = $3, reemplazo_soporte_tipo = $4, estado = 'reemplazada' WHERE id = $1",
      [n.id, JSON.stringify(reemplazo), req.file.buffer, tipo])
    return { n, reemplazo }
  })
  registrarEvento(req, 'kit_defectuoso_reemplazado', { detalle: String(r.n.id) })
  await registrar(actorActividad(req), { accion: 'kit_defectuoso.reemplazo', objeto: { tipo: 'kit_novedad', id: r.n.id }, idUnico: r.n.id_unico,
    cambios: { fecha: r.reemplazo.fecha, campos: { estado: ['devuelta', 'reemplazada'] } } })
  ok(res, 'Reemplazo entregado a la unidad registrado.', { id: r.n.id })
})

router.get('/:cid/novedades/:nid/reemplazo/soporte', loginRequerido, async (req, res) => {
  const f = await una(
    `SELECT n.reemplazo_soporte AS adjunto, n.reemplazo_soporte_tipo AS tipo, n.reemplazo->>'soporte_nombre' AS nombre
       FROM kit_novedades n JOIN kit_novedad_kits k ON k.novedad_id = n.id WHERE n.id = $1 AND k.combo_id = $2`,
    [Number(req.params.nid), Number(req.params.cid)])
  if (!f?.adjunto) return error(res, 'El soporte no existe.', 404)
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  res.attachment(f.nombre || 'soporte-reemplazo')
  res.type(f.tipo).send(f.adjunto)
})

export default router
