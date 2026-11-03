// API de entregas de kits a las unidades productivas: listado, registro de la entrega con su soporte, búsqueda
// y alta de responsables de entrega, y registro de la instalación y puesta en marcha.
import { Router } from 'express'
import multer from 'multer'
import { consulta, una, conTransaccion, COD_UNICO, COD_CHECK } from '../db.js'
import { loginRequerido, usuarioActual, registrarEvento, actorActividad } from '../seguridad.js'
import { bodegaOperativa } from '../bodegaOperativa.js'
import { ok, error, cuerpo, texto, aInt, soloEnteros, validarLargos, ErrorNegocio } from '../util.js'
import { registrar, corto } from '../../servicios/actividad.js'
import { idUnicoDeKit } from '../../servicios/defectuosos.js'
import { diaColombia, fechaReal, hoyColombia } from '../../servicios/secciones.js'

const router = Router()
router.use(loginRequerido)
router.param('eid', soloEnteros)
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 6, fieldSize: 4000 } })

router.get('/', async (req, res) => {
  let bodega
  try { bodega = await bodegaOperativa(req, req.query.bodega_id) }
  catch (e) {
    if (e.codigo === 403 && !req.query.bodega_id) return ok(res, null, { bodega: null, bodegas: [], kits: [], entregas: [], aviso: e.message })
    throw e
  }
  const esAdmin = usuarioActual(req).rol === 'admin'
  const bid = bodega?.id || null
  const [bodegas, kits, entregas] = await Promise.all([
    esAdmin ? consulta("SELECT id, nombre FROM bodegas WHERE activa AND tipo = 'municipal' ORDER BY nombre") : Promise.resolve([bodega]),
    bid ? consulta(
      `SELECT c.id, c.nombre, c.codigo_barras, c.armado,
              COALESCE(json_agg(json_build_object('articulo_id', a.id, 'nombre', a.nombre, 'cantidad', ci.cantidad,
                'disponible', COALESCE(s.cantidad, 0), 'activo', a.activo) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL), '[]') AS items
         FROM combos c LEFT JOIN (SELECT combo_id, articulo_id, SUM(cantidad)::int AS cantidad FROM combo_items GROUP BY combo_id, articulo_id) ci
           ON ci.combo_id = c.id LEFT JOIN articulos a ON a.id = ci.articulo_id
         LEFT JOIN stock_bodega s ON s.articulo_id = a.id AND s.bodega_id = $1
        WHERE NOT (c.armado AND c.descontado_al_armar) AND NOT EXISTS (SELECT 1 FROM entregas_kits e WHERE e.combo_id = c.id)
        GROUP BY c.id ORDER BY c.nombre`, [bid]) : Promise.resolve([]),
    consulta(
      `SELECT e.id, e.combo_id, e.bodega_id, c.nombre AS kit, c.codigo_barras, b.nombre AS bodega,
              e.responsable, e.adjunto_nombre, e.nota, e.creado_por, e.fecha,
              e.instalacion, (e.instalacion_soporte IS NOT NULL) AS instalacion_con_soporte,
              (SELECT json_agg(json_build_object('nombre', i.nombre, 'cantidad', i.cantidad) ORDER BY i.id)
                 FROM entrega_kit_items i WHERE i.entrega_id = e.id) AS items
         FROM entregas_kits e JOIN combos c ON c.id = e.combo_id JOIN bodegas b ON b.id = e.bodega_id
        WHERE ($1::int IS NULL OR e.bodega_id = $1) ORDER BY e.fecha DESC, e.id DESC LIMIT 300`, [bid]),
  ])
  ok(res, null, { bodega, bodegas, kits, entregas })
})

const TIPOS_DOC_RESPONSABLE = ['CC', 'CE', 'TI', 'PASAPORTE', 'PPT']
const DOC_RESPONSABLE = { PASAPORTE: /^[A-Z0-9]{5,15}$/ }

// Limpia el número de documento de un responsable de entrega para compararlo.
const normalizarDocumento = (v) => texto(v).replace(/[\s.]/g, '').toUpperCase()
const COLUMNAS_RESPONSABLE = 'id, tipo_documento, documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, nombre, telefono AS celular, correo'

// Límite de búsquedas fallidas de responsables antes de bloquear la cuenta temporalmente, para frenar el
// barrido de documentos.
const MAX_FALLOS = 8
const BLOQUEO_MS = 15 * 60 * 1000
const fallos = new Map()
export const reiniciarFallosResponsables = () => fallos.clear()
// Devuelve los milisegundos que faltan para que termine el bloqueo de la cuenta, o 0 si no está bloqueada.
function bloqueoRestante(usuario) {
  const f = fallos.get(usuario)
  if (!f) return 0
  const ahora = Date.now()
  if (f.hasta && f.hasta > ahora) return f.hasta - ahora
  if (f.hasta || ahora - f.ultimo > BLOQUEO_MS) fallos.delete(usuario)
  return 0
}
// Suma una búsqueda fallida a la cuenta.
function anotarFallo(req) {
  const usuario = usuarioActual(req).usuario
  const f = fallos.get(usuario) || { n: 0, ultimo: 0, hasta: 0 }
  f.n += 1
  f.ultimo = Date.now()
  if (f.n >= MAX_FALLOS) {
    f.hasta = f.ultimo + BLOQUEO_MS
    registrarEvento(req, 'responsable_busqueda_bloqueada', { exito: false, detalle: usuario })
  }
  fallos.set(usuario, f)
}
// Lanza un error si la cuenta está bloqueada.
function frenar(req, res) {
  const ms = bloqueoRestante(usuarioActual(req).usuario)
  if (!ms) return false
  res.set('Retry-After', String(Math.ceil(ms / 1000)))
  error(res, `Demasiados intentos con documentos que no existen. Espera ${Math.ceil(ms / 60000)} minuto(s) para volver a buscar.`, 429)
  return true
}

// Busca un responsable de entrega por su documento.
router.get('/responsables/buscar', async (req, res) => {
  if (frenar(req, res)) return
  const documento = normalizarDocumento(req.query.documento)
  if (documento.length < 5 || documento.length > 20) return error(res, 'Escribe el número de documento completo.')
  const r = await una(`SELECT ${COLUMNAS_RESPONSABLE} FROM responsables_entrega WHERE documento = $1`, [documento])
  if (!r) {
    anotarFallo(req)
    return error(res, 'No hay un responsable registrado con ese número de documento.', 404)
  }
  fallos.delete(usuarioActual(req).usuario)
  ok(res, null, { responsable: r })
})

// Registra un responsable de entrega una sola vez para reutilizarlo.
router.post('/responsables', async (req, res) => {
  if (frenar(req, res)) return
  const d = cuerpo(req)
  const largo = validarLargos(d, { primer_nombre: 60, segundo_nombre: 60, primer_apellido: 60, segundo_apellido: 60, numero_documento: 20, celular: 20, correo: 150 })
  if (largo) return error(res, largo)
  const tipoDoc = texto(d.tipo_documento).toUpperCase()
  const documento = normalizarDocumento(d.numero_documento)
  const primer = texto(d.primer_nombre)
  const segundo = texto(d.segundo_nombre)
  const apellido1 = texto(d.primer_apellido)
  const apellido2 = texto(d.segundo_apellido)
  const celular = texto(d.celular).replace(/[\s()-]/g, '').replace(/^\+?57/, '')
  const correo = texto(d.correo).toLowerCase()
  const falla = (m) => error(res, m)
  if (!TIPOS_DOC_RESPONSABLE.includes(tipoDoc)) return falla('Elige el tipo de documento.')
  if (!(DOC_RESPONSABLE[tipoDoc] || /^\d{5,12}$/).test(documento)) return falla('El número de documento no es válido para ese tipo.')
  if (!primer) return falla('Escribe el primer nombre.')
  if (!apellido1) return falla('Escribe el primer apellido.')
  if (!/^3\d{9}$/.test(celular)) return falla('Escribe un celular colombiano de 10 dígitos (empieza por 3).')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return falla('Escribe un correo válido.')
  try {
    const responsable = await conTransaccion(async (cli) => {
      const b = await bodegaOperativa(req, d.bodega_id, cli)
      if (!b) throw new ErrorNegocio('Elige una bodega municipal.')
      const [r] = await cli.q(
        `INSERT INTO responsables_entrega (bodega_id, tipo_documento, documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, nombre, telefono, correo, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${COLUMNAS_RESPONSABLE}`,
        [b.id, tipoDoc, documento, primer, segundo || null, apellido1, apellido2 || null, [primer, segundo, apellido1, apellido2].filter(Boolean).join(' '), celular, correo, usuarioActual(req).usuario])
      return r
    })
    registrarEvento(req, 'responsable_entrega_creado', { detalle: String(responsable.id) })
    await registrar(actorActividad(req), {
      accion: 'kit.responsable', objeto: { tipo: 'responsable_entrega', id: responsable.id }, cambios: { nombre: responsable.nombre },
    })
    ok(res, 'Responsable de entrega registrado.', { responsable })
  } catch (e) {
    if (e.code === COD_UNICO) {
      anotarFallo(req)
      return error(res, 'Ya hay un responsable con ese número de documento. Búscalo escribiéndolo completo.', 409)
    }
    throw e
  }
})

// Identifica el tipo real del archivo adjunto a partir de su contenido.
function tipoAdjunto(f) {
  if (!f) throw new ErrorNegocio('El adjunto de la entrega es obligatorio.')
  const b = f.buffer
  if (/\.pdf$/i.test(f.originalname) && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (/\.png$/i.test(f.originalname) && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png'
  if (/\.jpe?g$/i.test(f.originalname) && b.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'image/jpeg'
  throw new ErrorNegocio('El adjunto debe ser un PDF, JPG o PNG válido de máximo 10 MB.')
}

// Obtiene el kit de la entrega, que llega como combo_id o como lista de un elemento.
function idsDeKits(d) {
  const crudo = texto(d.combo_ids)
  let lista = []
  if (crudo.startsWith('[')) { try { lista = JSON.parse(crudo) } catch { lista = [] } }
  else if (crudo) lista = crudo.split(',')
  else if (d.combo_id !== undefined) lista = [d.combo_id]
  return [...new Set((Array.isArray(lista) ? lista : []).map((x) => aInt(x, null)).filter((x) => x !== null))]
}

// Registra la entrega de un kit con su adjunto, de máximo 10 MB.
router.post('/', (req, res, next) => subida.single('adjunto')(req, res, (e) => {
  if (e?.code === 'LIMIT_FILE_SIZE') return error(res, 'El adjunto supera el máximo de 10 MB.', 413)
  next(e)
}), async (req, res) => {
  const d = cuerpo(req)
  const tipo = tipoAdjunto(req.file)
  const ids = idsDeKits(d)
  if (!ids.length) return error(res, 'Elige el kit.')
  if (ids.length > 1) return error(res, 'Cada entrega es de una sola unidad productiva: registra un kit por entrega.')
  const rid = aInt(d.responsable_id)
  if (!rid) return error(res, 'Elige el responsable de la entrega.')
  const largo = validarLargos(d, { nota: 2000 })
  if (largo) return error(res, largo)
  const u = usuarioActual(req)
  try {
    const r = await conTransaccion(async (cli) => {
      const b = await bodegaOperativa(req, d.bodega_id, cli)
      if (!b) throw new ErrorNegocio('Elige una bodega municipal.')
      const [responsable] = await cli.q(`SELECT ${COLUMNAS_RESPONSABLE} FROM responsables_entrega WHERE id = $1 FOR SHARE`, [rid])
      if (!responsable) throw new ErrorNegocio('El responsable no existe.')
      const [c] = await cli.q('SELECT * FROM combos WHERE id = $1 FOR UPDATE', [ids[0]])
      if (!c) throw new ErrorNegocio('El Kit UP no existe.', 404)
      if ((await cli.q('SELECT 1 FROM entregas_kits WHERE combo_id = $1', [c.id])).length) throw new ErrorNegocio('Este kit ya fue entregado.', 409)
      if (c.armado && c.descontado_al_armar) {
        throw new ErrorNegocio('Este kit fue armado con el flujo anterior y su stock ya fue descontado. No se puede descontar otra vez.', 409)
      }
      const items = await cli.q('SELECT articulo_id, SUM(cantidad)::int AS cantidad FROM combo_items WHERE combo_id = $1 GROUP BY articulo_id ORDER BY articulo_id', [c.id])
      if (!items.length) throw new ErrorNegocio('El kit no tiene artículos.')
      const aids = items.map((i) => i.articulo_id)
      const articulos = await cli.q('SELECT id, nombre, stock, activo FROM articulos WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [aids])
      const porId = new Map(articulos.map((a) => [a.id, a]))
      const locales = await cli.q('SELECT articulo_id, cantidad FROM stock_bodega WHERE bodega_id = $1 AND articulo_id = ANY($2::int[]) ORDER BY articulo_id FOR UPDATE', [b.id, aids])
      const enBodega = new Map(locales.map((s) => [s.articulo_id, s.cantidad]))
      for (const it of items) {
        const a = porId.get(it.articulo_id)
        if (!a?.activo || a.stock < it.cantidad || (enBodega.get(it.articulo_id) || 0) < it.cantidad) {
          throw new ErrorNegocio(`La bodega «${b.nombre}» no tiene existencias suficientes de «${a?.nombre || it.articulo_id}» para entregar el kit.`, 409)
        }
      }
      const [entrega] = await cli.q(
        `INSERT INTO entregas_kits (combo_id, bodega_id, responsable_id, responsable, adjunto, adjunto_nombre, adjunto_tipo, nota, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.id, b.id, rid, JSON.stringify(responsable), req.file.buffer, req.file.originalname.replace(/[\r\n\\/]/g, '_').slice(0, 200), tipo, texto(d.nota), u.nombre])
      for (const it of items) {
        await cli.q('UPDATE stock_bodega SET cantidad = cantidad - $1 WHERE bodega_id = $2 AND articulo_id = $3', [it.cantidad, b.id, it.articulo_id])
        await cli.q('UPDATE articulos SET stock = stock - $1 WHERE id = $2', [it.cantidad, it.articulo_id])
        await cli.q('INSERT INTO entrega_kit_items (entrega_id, articulo_id, nombre, cantidad) VALUES ($1,$2,$3,$4)', [entrega.id, it.articulo_id, porId.get(it.articulo_id).nombre, it.cantidad])
        await cli.q("INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, bodega_id) VALUES ($1, 'salida', $2, 'entrega_kit', $3, $4)", [it.articulo_id, it.cantidad, c.codigo_barras, b.id])
      }
      await cli.q('UPDATE combos SET stock = 0, armado = TRUE, armado_en = COALESCE(armado_en, now()), descontado_al_armar = FALSE WHERE id = $1', [c.id])
      return {
        id: entrega.id, kit: c, bodega: b, responsable: { id: responsable.id, nombre: responsable.nombre },
        items: items.map((it) => [porId.get(it.articulo_id).nombre, it.cantidad]), idUnico: await idUnicoDeKit(cli, c.nombre),
      }
    })
    const id = r.id
    registrarEvento(req, 'kit_entregado', { detalle: String(id) })
    await registrar(actorActividad(req), {
      accion: 'kit.entrega', objeto: { tipo: 'entrega_kit', id }, idUnico: r.idUnico,
      cambios: {
        kit: r.kit.nombre, codigo_barras: r.kit.codigo_barras, bodega: r.bodega.nombre, responsable: r.responsable,
        items: r.items, nota: corto(texto(d.nota)) || null, adjunto: corto(req.file.originalname, 200),
      },
    })
    ok(res, 'Entrega de kit registrada. Se descontaron los artículos de la bodega municipal.', { id })
  } catch (e) {
    if (e.code === COD_UNICO) return error(res, 'Este kit ya fue entregado.', 409)
    if (e.code === COD_CHECK) return error(res, 'Stock insuficiente. La entrega se canceló completa.', 409)
    throw e
  }
})

// Descarga el soporte de una entrega.
router.get('/:eid/adjunto', async (req, res) => {
  const b = await bodegaOperativa(req)
  const e = await una(
    `SELECT COALESCE(e.adjunto, o.adjunto) AS adjunto, e.adjunto_nombre, e.adjunto_tipo
       FROM entregas_kits e LEFT JOIN entregas_kits o ON o.id = e.adjunto_de
      WHERE e.id = $1 AND ($2::int IS NULL OR e.bodega_id = $2)`, [Number(req.params.eid), b?.id || null])
  if (!e) return error(res, 'La entrega no existe.', 404)
  res.attachment(e.adjunto_nombre)
  res.type(e.adjunto_tipo).send(e.adjunto)
})

const subidaInstalacion = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, fieldSize: 8000 } })

// Valida una fecha real, no futura y no anterior al límite dado; lanza un error de negocio si no cumple.
function fechaDesde(valor, desde, que) {
  const f = texto(valor).slice(0, 10)
  if (!fechaReal(f) || f > hoyColombia()) throw new ErrorNegocio(`La fecha ${que} no es válida (no puede ser futura).`)
  if (desde && f < desde) throw new ErrorNegocio(`La fecha ${que} no puede ser anterior al ${desde}.`)
  return f
}
const siNo = (v, que) => {
  const x = texto(v).toLowerCase()
  if (!['si', 'no'].includes(x)) throw new ErrorNegocio(`Indica si ${que} (sí o no).`)
  return x === 'si'
}

// Registra la instalación y puesta en marcha del kit entregado.
router.post('/:eid/instalacion', (req, res, next) => subidaInstalacion.single('soporte')(req, res, (e) => {
  if (e?.code === 'LIMIT_FILE_SIZE') return error(res, 'El soporte supera el máximo de 10 MB.', 413)
  next(e)
}), async (req, res) => {
  const d = cuerpo(req)
  const largo = validarLargos(d, { capacitacion_por: 200, capacitacion_recibe: 200, observaciones: 2000 })
  if (largo) return error(res, largo)
  const u = usuarioActual(req)
  const r = await conTransaccion(async (cli) => {
    const b = await bodegaOperativa(req, undefined, cli)
    const [e] = await cli.q(
      `SELECT e.id, e.bodega_id, e.fecha, e.instalacion_soporte IS NOT NULL AS tiene_soporte, c.nombre AS kit
         FROM entregas_kits e JOIN combos c ON c.id = e.combo_id WHERE e.id = $1 FOR UPDATE OF e`, [Number(req.params.eid)])
    if (!e || (b && e.bodega_id !== b.id)) throw new ErrorNegocio('La entrega no existe.', 404)
    const entregado = diaColombia(e.fecha)
    const aplica = siNo(d.aplica, 'aplica la instalación')
    const observaciones = texto(d.observaciones) || null
    let instalacion = { aplica, observaciones, registrada_por: u.nombre, registrada_en: new Date().toISOString() }
    let soporte = null
    if (aplica) {
      const fechaInstalacion = fechaDesde(d.fecha_instalacion, entregado, 'de instalación')
      const fechaPuesta = fechaDesde(d.fecha_puesta_marcha, fechaInstalacion, 'de puesta en marcha')
      const capacitacion = siNo(d.capacitacion, 'hubo capacitación de uso')
      instalacion = { ...instalacion, fecha_instalacion: fechaInstalacion, fecha_puesta_marcha: fechaPuesta, capacitacion }
      if (capacitacion) {
        const por = texto(d.capacitacion_por)
        const recibe = texto(d.capacitacion_recibe)
        if (!por) throw new ErrorNegocio('Escribe quién dio la capacitación de uso.')
        if (!recibe) throw new ErrorNegocio('Escribe quién recibió la capacitación de uso.')
        instalacion = { ...instalacion, capacitacion_fecha: fechaDesde(d.capacitacion_fecha, entregado, 'de la capacitación'), capacitacion_por: por, capacitacion_recibe: recibe }
      }
      if (req.file) soporte = { buffer: req.file.buffer, tipo: tipoAdjunto(req.file), nombre: Buffer.from(req.file.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 200) }
      else if (!e.tiene_soporte) throw new ErrorNegocio('Adjunta el soporte de la instalación (PDF, JPG o PNG).')
    }
    if (soporte) {
      await cli.q('UPDATE entregas_kits SET instalacion = $2, instalacion_soporte = $3, instalacion_soporte_tipo = $4, instalacion_soporte_nombre = $5 WHERE id = $1',
        [e.id, JSON.stringify(instalacion), soporte.buffer, soporte.tipo, soporte.nombre])
    } else if (aplica) {
      await cli.q('UPDATE entregas_kits SET instalacion = $2 WHERE id = $1', [e.id, JSON.stringify(instalacion)])
    } else {
      await cli.q('UPDATE entregas_kits SET instalacion = $2, instalacion_soporte = NULL, instalacion_soporte_tipo = NULL, instalacion_soporte_nombre = NULL WHERE id = $1',
        [e.id, JSON.stringify(instalacion)])
    }
    return { e, instalacion, idUnico: await idUnicoDeKit(cli, e.kit) }
  })
  registrarEvento(req, 'kit_instalacion', { detalle: String(r.e.id) })
  await registrar(actorActividad(req), {
    accion: 'kit.instalacion', objeto: { tipo: 'entrega_kit', id: r.e.id }, idUnico: r.idUnico,
    cambios: { aplica: r.instalacion.aplica, fecha_instalacion: r.instalacion.fecha_instalacion || null, capacitacion: r.instalacion.capacitacion ?? null },
  })
  ok(res, r.instalacion.aplica ? 'Instalación y puesta en marcha registradas.' : 'Registrado: la instalación no aplica para esta entrega.', { id: r.e.id })
})

router.get('/:eid/instalacion/soporte', async (req, res) => {
  const b = await bodegaOperativa(req)
  const e = await una(
    'SELECT instalacion_soporte AS adjunto, instalacion_soporte_tipo AS tipo, instalacion_soporte_nombre AS nombre FROM entregas_kits WHERE id = $1 AND ($2::int IS NULL OR bodega_id = $2)',
    [Number(req.params.eid), b?.id || null])
  if (!e?.adjunto) return error(res, 'El soporte no existe.', 404)
  res.attachment(e.nombre || 'soporte-instalacion')
  res.type(e.tipo).send(e.adjunto)
})

export default router
