// API de órdenes de pedido cargadas desde Excel. Cada lote agrupa los artículos de varias unidades productivas
// identificadas por su número de documento, y se compara con el plan aprobado de cada una.
import { Router } from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import { consulta, una, conTransaccion, COD_UNICO } from '../db.js'
import { soloAdmin, limitador, registrarEvento, actorActividad } from '../seguridad.js'
import { registrar } from '../../servicios/actividad.js'
import {
  ok, error, aInt, aFloat, texto, soloEnteros, enviarPdf, validarLargos, ErrorNegocio,
} from '../util.js'
import { pdfPedido } from '../pdf.js'
import { validarXlsx, valorCelda } from '../excel.js'

const router = Router()
router.param('lid', soloEnteros)

const MAX_ARCHIVO = 10 * 1024 * 1024
const MAX_FILAS = 20_000
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVO, files: 1, fields: 5, fieldSize: 1024 },
})

// Limita por IP las cargas de Excel, que consumen procesador y memoria.
const limiteCarga = limitador({
  ventanaMs: 10 * 60_000, max: 15, tipo: 'limite_carga',
  mensaje: 'Demasiadas cargas seguidas. Espera unos minutos.',
})
const limitePdf = limitador({
  ventanaMs: 60_000, max: 30, tipo: 'limite_pdf', nombre: 'limite_pdf_pedidos',
  mensaje: 'Demasiados PDF seguidos. Espera un momento.',
})

// Columnas que se leen de la hoja del Excel.
const COLUMNAS_LOTE = [
  'num_documento', 'codigo_actual', 'nombre_carrito_actual',
  'tipo_segun_carrito_actual', 'cantidad', 'precio_actual',
]
const HOJA_LOTE = 'Desglosado items'

// Lee la hoja del Excel y devuelve las líneas y un aviso; lanza un error si falta algo.
async function leerExcelLote(buffer) {
  validarXlsx(buffer)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.getWorksheet(HOJA_LOTE)
  if (!ws) {
    throw new ErrorNegocio(
      `El Excel no tiene una hoja llamada '${HOJA_LOTE}'. Hojas encontradas: ` +
      wb.worksheets.map((h) => h.name).join(', '))
  }
  if (ws.actualRowCount === 0) throw new ErrorNegocio(`La hoja '${HOJA_LOTE}' esta vacia.`)
  if (ws.actualRowCount > MAX_FILAS) {
    throw new ErrorNegocio(`La hoja tiene mas de ${MAX_FILAS} filas. Divide el lote en archivos mas pequenos.`)
  }

  const cabecera = ws.getRow(1)
  const nombres = []
  for (let c = 1; c <= ws.columnCount; c++) {
    nombres[c] = String(valorCelda(cabecera.getCell(c).value) ?? '').trim()
  }
  const pos = {}
  for (const col of COLUMNAS_LOTE) {
    const i = nombres.indexOf(col)
    if (i === -1) throw new ErrorNegocio(`Falta la columna '${col}' en la hoja.`)
    pos[col] = i
  }

  const lineas = []
  let descartadas = 0
  ws.eachRow({ includeEmpty: false }, (fila, n) => {
    if (n === 1) return
    const v = (col) => valorCelda(fila.getCell(pos[col]).value)
    const doc = v('num_documento')
    if (doc === null || String(doc).trim() === '') {
      descartadas += 1
      return
    }
    const cod = v('codigo_actual')
    lineas.push({
      num_documento: String(doc).trim(),
      codigo: cod === null ? '' : String(cod).trim(),
      nombre: String(v('nombre_carrito_actual') ?? '').trim(),
      tipo: String(v('tipo_segun_carrito_actual') ?? '').trim(),
      cantidad: aInt(v('cantidad'), 0) || 0,
      precio: aFloat(v('precio_actual'), 0) || 0,
    })
  })
  if (!lineas.length) throw new ErrorNegocio('No se encontraron filas con num_documento en la hoja.')
  const aviso = descartadas ? `Se ignoraron ${descartadas} filas sin numero de documento.` : null
  return { lineas, aviso }
}

// Devuelve el lote con su resumen, los grupos por unidad y los totales, o null si no existe.
async function resumenLote(loteId) {
  const lote = await una('SELECT * FROM lotes WHERE id = $1', [loteId])
  if (!lote) return null

  const resumen = await consulta(
    `SELECT codigo,
            MAX(nombre) AS nombre,
            MAX(tipo)   AS tipo,
            SUM(cantidad) AS cantidad,
            MAX(precio) AS precio,
            SUM(cantidad * precio) AS subtotal
     FROM lote_items WHERE lote_id = $1
     GROUP BY codigo
     ORDER BY MAX(nombre)`,
    [loteId],
  )

  const items = await consulta(
    `SELECT num_documento, codigo, nombre, tipo, cantidad, precio,
            (cantidad * precio) AS subtotal
     FROM lote_items WHERE lote_id = $1
     ORDER BY num_documento, nombre`,
    [loteId],
  )

  const grupos = []
  let actual = null
  for (const it of items) {
    if (actual === null || actual.num_documento !== it.num_documento) {
      actual = { num_documento: it.num_documento, items: [], subtotal: 0 }
      grupos.push(actual)
    }
    actual.items.push(it)
    actual.subtotal += Number(it.subtotal || 0)
  }

  const totales = {
    items: items.length,
    codigos: resumen.length,
    unidades: grupos.length,
    cantidad: resumen.reduce((a, r) => a + Number(r.cantidad || 0), 0),
    valor: resumen.reduce((a, r) => a + Number(r.subtotal || 0), 0),
  }
  for (const g of grupos) g.alertas = await alertasContraPlan(g)
  totales.alertas = grupos.reduce((a, g) => a + g.alertas.length, 0)
  return { lote, resumen, grupos, totales }
}

const PLAN_APROBADO = ['aprobado', 'en_compra', 'entregado']
// Normaliza un texto para comparar nombres de productos.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Detecta diferencias de un grupo del lote con el plan aprobado: unidad sin plan, producto fuera del plan o
// cantidades distintas.
export async function alertasContraPlan(grupo) {
  const doc = String(grupo.num_documento).replace(/[^A-Za-z0-9]/g, '')
  const up = await una(
    `SELECT up.id_up, up.id_unico FROM public.unidades_productivas up JOIN public.representantes r ON r.id_representante = up.id_representante
      WHERE regexp_replace(coalesce(r.documento, ''), '[^A-Za-z0-9]', '', 'g') = $1 LIMIT 1`, [doc])
  if (!up) return [`El documento ${grupo.num_documento} no corresponde a una unidad productiva registrada.`]
  const plan = await una(
    `SELECT id_carrito, estado FROM public.carritos WHERE id_up = $1 ORDER BY (id_origen LIKE 'LOCAL-%') DESC, id_carrito DESC LIMIT 1`, [up.id_up])
  if (!plan || !PLAN_APROBADO.includes(plan.estado)) return [`La unidad ${up.id_unico} no tiene un plan de capitalización aprobado por el comité.`]
  const lineas = await consulta(
    `SELECT cp.nombre_producto AS nombre, cp.cantidad::float AS cantidad, cp.precio_unitario::float AS precio, cat.id_origen AS codigo
       FROM public.carrito_productos cp LEFT JOIN public.catalogo_productos cat ON cat.id_producto = cp.id_producto
      WHERE cp.id_carrito = $1`, [plan.id_carrito])
  const alertas = []
  const pedidas = new Map()
  for (const it of grupo.items) {
    const l = lineas.find((x) => (it.codigo && x.codigo && norm(x.codigo) === norm(it.codigo)) || norm(x.nombre) === norm(it.nombre))
    if (!l) { alertas.push(`«${it.nombre || it.codigo}» no está en el plan aprobado de ${up.id_unico}.`); continue }
    pedidas.set(l, (pedidas.get(l) || 0) + Number(it.cantidad))
    if (Math.abs(Number(it.precio) - l.precio) > 0.5) alertas.push(`«${l.nombre}»: el precio del lote (${Math.round(Number(it.precio))}) no es el del plan aprobado (${Math.round(l.precio)}).`)
  }
  for (const [l, cantidad] of pedidas) {
    if (cantidad > l.cantidad) alertas.push(`«${l.nombre}»: el lote pide ${cantidad} y el plan aprobado tiene ${l.cantidad}.`)
  }
  return [...new Set(alertas)]
}

// Lista los lotes cargados.
router.get('/', soloAdmin, async (req, res) => {
  const lotes = await consulta(
    `SELECT l.*,
            (SELECT COUNT(*) FROM lote_items li WHERE li.lote_id = l.id) AS n_items,
            (SELECT COUNT(DISTINCT num_documento) FROM lote_items li
              WHERE li.lote_id = l.id) AS n_up
     FROM lotes l ORDER BY l.numero DESC`,
  )
  ok(res, null, { lotes })
})

// Carga un lote desde un Excel enviado como multipart.
router.post('/cargar', soloAdmin, limiteCarga, subida.single('archivo'), async (req, res) => {
  const archivo = req.file
  const largo = validarLargos(req.body || {}, { nombre: 120 })
  if (largo) return error(res, largo)
  const nombreLote = texto(req.body?.nombre)

  if (!archivo || !archivo.originalname) {
    return error(res, 'Selecciona un archivo de Excel para cargar el lote.')
  }
  const nombreArchivo = Buffer.from(archivo.originalname, 'latin1').toString('utf8')
    .replace(/[\u0000-\u001f\u007f\\/]+/g, '_').slice(0, 200)
  if (!/\.(xlsx|xlsm)$/i.test(nombreArchivo)) return error(res, 'El archivo debe ser un Excel (.xlsx).')

  let leido
  try {
    leido = await leerExcelLote(archivo.buffer)
  } catch (e) {
    if (e instanceof ErrorNegocio) return error(res, `No se pudo leer el Excel: ${e.message}`)
    return error(res, 'El archivo no se pudo procesar. Verifica que sea un Excel valido.')
  }
  const { lineas, aviso } = leido

  let lote = null
  for (let intento = 0; intento < 3 && lote === null; intento++) {
    try {
      lote = await conTransaccion(async (cli) => {
        const [nuevo] = await cli.q(
          `INSERT INTO lotes (numero, nombre, archivo)
           SELECT COALESCE(MAX(numero), 0) + 1,
                  COALESCE(NULLIF($1::text, ''),
                           'Lote ' || (COALESCE(MAX(numero), 0) + 1)::text),
                  $2::text
           FROM lotes
           RETURNING id, numero, nombre`,
          [nombreLote, nombreArchivo],
        )
        await cli.q(
          `INSERT INTO lote_items (lote_id, num_documento, codigo, nombre, tipo, cantidad, precio)
           SELECT $1, d, c, n, t, q, p
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::numeric[])
                AS x(d, c, n, t, q, p)`,
          [
            nuevo.id,
            lineas.map((l) => l.num_documento),
            lineas.map((l) => l.codigo),
            lineas.map((l) => l.nombre),
            lineas.map((l) => l.tipo),
            lineas.map((l) => l.cantidad),
            lineas.map((l) => l.precio),
          ],
        )
        return nuevo
      })
    } catch (e) {
      if (e.code === COD_UNICO) continue
      console.error('Error guardando el lote:', e)
      return error(res, 'Ocurrio un error guardando el lote. No se guardo nada.', 500)
    }
  }
  if (lote === null) {
    return error(res, 'No se pudo crear el lote (varias cargas simultaneas). Intenta de nuevo.', 409)
  }

  const nUp = new Set(lineas.map((l) => l.num_documento)).size
  let msg = `${lote.nombre} creado: ${lineas.length} items en ${nUp} unidades productivas.`
  if (aviso) msg += ' ' + aviso
  registrarEvento(req, 'lote_cargado', { detalle: `${lote.nombre} (${lineas.length} items)` })
  await registrar(actorActividad(req), {
    accion: 'inventario.pedido_cargar', objeto: { tipo: 'lote', id: lote.id },
    cambios: { numero: lote.numero, nombre: lote.nombre, archivo: nombreArchivo, items: lineas.length, unidades: nUp },
  })
  ok(res, msg, { id: lote.id })
})

// Detalle de un lote.
router.get('/:lid', soloAdmin, async (req, res) => {
  const r = await resumenLote(Number(req.params.lid))
  if (!r) return error(res, 'El lote no existe.', 404)
  ok(res, null, {
    lote: r.lote,
    resumen: r.resumen,
    grupos: r.grupos.map((g) => ({
      num_documento: g.num_documento, subtotal: g.subtotal, items: g.items, alertas: g.alertas || [],
    })),
    totales: r.totales,
  })
})

// Elimina un lote.
router.delete('/:lid', soloAdmin, async (req, res) => {
  const fila = await una('DELETE FROM lotes WHERE id = $1 RETURNING id, numero, nombre, archivo', [Number(req.params.lid)])
  if (!fila) return error(res, 'El lote ya no existe.', 404)
  registrarEvento(req, 'lote_eliminado', { detalle: fila.nombre })
  await registrar(actorActividad(req), {
    accion: 'inventario.pedido_eliminar', objeto: { tipo: 'lote', id: fila.id },
    cambios: { numero: fila.numero, nombre: fila.nombre, archivo: fila.archivo },
  })
  ok(res, 'Lote eliminado.')
})

// Genera el PDF del lote.
router.get('/:lid/pdf', soloAdmin, limitePdf, async (req, res) => {
  const r = await resumenLote(Number(req.params.lid))
  if (!r) return error(res, 'El lote no existe.', 404)
  const buf = await pdfPedido(r.lote, r.resumen, r.grupos, r.totales)
  enviarPdf(res, buf, `Orden_pedido_${(r.lote.nombre || 'lote').replace(/ /g, '_')}.pdf`)
})

export default router
