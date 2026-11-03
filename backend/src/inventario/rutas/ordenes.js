// API de órdenes de entrega y de evidencias de transporte.
import { Router } from 'express'
import { consulta, una, conTransaccion, COD_CHECK } from '../db.js'
import { soloAdmin, limitador, registrarEvento, actorActividad } from '../seguridad.js'
import { registrar, corto } from '../../servicios/actividad.js'
import {
  ok, error, cuerpo, texto, aInt, aFloat, soloEnteros, enviarPdf, validarLargos, enRango,
  ErrorNegocio,
} from '../util.js'
import { pdfOrden } from '../pdf.js'

const router = Router()
router.param('oid', soloEnteros)

// Limita por IP la generación de PDF, que consume procesador.
const limitePdf = limitador({
  ventanaMs: 60_000, max: 30, tipo: 'limite_pdf',
  mensaje: 'Demasiados PDF seguidos. Espera un momento.',
})

// Entrega el consecutivo de orden por año con un UPSERT atómico, de modo que dos órdenes simultáneas nunca
// repiten número.
async function siguienteNumeroOrden(cli) {
  const anio = new Date().getFullYear()
  const [fila] = await cli.q(
    `INSERT INTO contadores (anio, valor) VALUES ($1, 1)
     ON CONFLICT (anio) DO UPDATE SET valor = contadores.valor + 1
     RETURNING valor`,
    [anio],
  )
  return `OE-${anio}-${String(fila.valor).padStart(4, '0')}`
}

// Calcula el monto de una orden sumando el valor de los kits que la componen.
async function montoOrden(oid) {
  const fila = await una(
    `SELECT COALESCE(SUM(a.precio * ci.cantidad * oi.cantidad), 0) AS v
     FROM orden_items oi
     JOIN combo_items ci ON ci.combo_id = oi.ref_id
     JOIN articulos a    ON a.id = ci.articulo_id
     WHERE oi.orden_id = $1`,
    [oid],
  )
  return Number(fila.v || 0)
}

// Lista las órdenes de entrega.
router.get('/', soloAdmin, async (req, res) => {
  const ordenes = await consulta('SELECT * FROM ordenes ORDER BY id DESC')
  const articulos = await consulta('SELECT * FROM articulos WHERE activo AND stock > 0 ORDER BY nombre')
  const combos = await consulta('SELECT * FROM combos WHERE stock > 0 ORDER BY nombre')
  ok(res, null, { ordenes, articulos, combos })
})

// Crea una orden de entrega; todo se entrega en kits y ningún artículo sale suelto.
router.post('/', soloAdmin, async (req, res) => {
  const datos = cuerpo(req)
  const largo = validarLargos(datos, { destino: 200, observaciones: 2000 })
  if (largo) return error(res, largo)
  const destino = texto(datos.destino)
  const observaciones = texto(datos.observaciones)

  const entrada = Array.isArray(datos.lineas) ? datos.lineas : []
  if (entrada.length > 200) return error(res, 'Una orden admite como maximo 200 lineas.')
  const lineas = []
  for (const ln of entrada) {
    const refId = aInt(ln?.ref_id)
    const cant = aInt(ln?.cantidad, 0) || 0
    if (cant > 100_000) return error(res, 'La cantidad por linea no puede pasar de 100.000.')
    if (refId === null || cant <= 0) continue
    lineas.push(['combo', refId, cant])
  }
  if (!lineas.length) return error(res, 'Agrega al menos un Kit UP con cantidad a la orden.')

  let resultado
  try {
    resultado = await conTransaccion(async (cli) => {
      const ids = [...new Set(lineas.map((l) => l[1]))].sort((a, b) => a - b)
      const bloqueados = await cli.q(
        `SELECT id, nombre, stock, codigo_barras FROM combos
         WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
        [ids],
      )
      const porId = new Map(bloqueados.map((r) => [r.id, r]))

      for (const [, refId, cant] of lineas) {
        const r = porId.get(refId)
        if (!r || cant > r.stock) {
          throw new ErrorNegocio(
            `Stock insuficiente de '${r ? r.nombre : '?'}' (disponible: ${r ? r.stock : 0}).`, 409)
        }
      }

      const numero = await siguienteNumeroOrden(cli)
      const [orden] = await cli.q(
        `INSERT INTO ordenes (numero, destino, observaciones, estado)
         VALUES ($1, $2, $3, 'generada') RETURNING id`,
        [numero, destino, observaciones],
      )

      for (const [tipo, refId, cant] of lineas) {
        const r = porId.get(refId)
        await cli.q('UPDATE combos SET stock = stock - $1 WHERE id = $2', [cant, refId])
        await cli.q(
          `INSERT INTO orden_items (orden_id, tipo, ref_id, nombre, codigo_barras, cantidad)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orden.id, tipo, refId, r.nombre, r.codigo_barras, cant],
        )
      }
      return { id: orden.id, numero, kits: lineas.map(([, refId, cant]) => [porId.get(refId).nombre, cant]) }
    })
  } catch (e) {
    if (e.code === COD_CHECK) return error(res, 'Stock insuficiente: la orden no se genero.', 409)
    throw e
  }
  const { kits, ...orden } = resultado
  registrarEvento(req, 'orden_generada', { detalle: orden.numero })
  await registrar(actorActividad(req), {
    accion: 'inventario.orden_crear', objeto: { tipo: 'orden', id: orden.id },
    cambios: { numero: orden.numero, destino: corto(destino), kits },
  })
  ok(res, `Orden ${orden.numero} generada.`, orden)
})

// Detalle de una orden con sus líneas.
router.get('/:oid', soloAdmin, async (req, res) => {
  const oid = Number(req.params.oid)
  const orden = await una('SELECT * FROM ordenes WHERE id = $1', [oid])
  if (!orden) return error(res, 'La orden no existe.', 404)
  const items = await consulta('SELECT * FROM orden_items WHERE orden_id = $1 ORDER BY id', [oid])
  ok(res, null, { orden, items, monto: await montoOrden(oid) })
})

// Elimina una orden.
router.delete('/:oid', soloAdmin, async (req, res) => {
  const oid = Number(req.params.oid)
  const { c: nEv } = await una(
    'SELECT COUNT(*) AS c FROM evidencias_transporte WHERE orden_id = $1', [oid],
  )
  if (nEv) {
    return error(res, `No se puede eliminar: la orden tiene ${nEv} evidencia(s) de transporte. ` +
      'Eliminalas primero si realmente deseas borrar la orden.', 409)
  }
  const fila = await una('DELETE FROM ordenes WHERE id = $1 RETURNING id, numero, destino, estado', [oid])
  if (!fila) return error(res, 'La orden ya no existe.', 404)
  registrarEvento(req, 'orden_eliminada', { detalle: fila.numero })
  await registrar(actorActividad(req), {
    accion: 'inventario.orden_eliminar', objeto: { tipo: 'orden', id: fila.id },
    cambios: { numero: fila.numero, destino: corto(fila.destino), estado: fila.estado },
  })
  ok(res, 'Orden eliminada (no revierte stock).')
})

// Genera el PDF de una orden.
router.get('/:oid/pdf', soloAdmin, limitePdf, async (req, res) => {
  const oid = Number(req.params.oid)
  const orden = await una('SELECT * FROM ordenes WHERE id = $1', [oid])
  if (!orden) return error(res, 'La orden no existe.', 404)
  const items = await consulta('SELECT * FROM orden_items WHERE orden_id = $1 ORDER BY id', [oid])

  const componentesDe = async (refId, veces) => {
    const filas = await consulta(
      `SELECT a.codigo_barras, a.nombre, a.precio, ci.cantidad
       FROM combo_items ci JOIN articulos a ON a.id = ci.articulo_id
       WHERE ci.combo_id = $1
       ORDER BY a.nombre`,
      [refId],
    )
    return filas.map((f) => {
      const totalCant = Number(f.cantidad) * Number(veces)
      const precio = Number(f.precio || 0)
      return {
        codigo: f.codigo_barras, nombre: f.nombre, cantidad: totalCant,
        precio, subtotal: precio * totalCant,
      }
    })
  }

  const conValores = req.sesion?.cuenta?.rol === 'superadmin'
  const buf = await pdfOrden(orden, items, componentesDe, { conValores })
  enviarPdf(res, buf, `Orden_${orden.numero}.pdf`)
})

// Router de las evidencias de transporte, que registran el despacho de una orden.
export const evidencias = Router()
evidencias.param('oid', soloEnteros)
evidencias.param('eid', soloEnteros)

evidencias.get('/', soloAdmin, async (req, res) => {
  const lista = await consulta(
    `SELECT e.*, o.numero AS orden_numero, o.destino AS orden_destino
     FROM evidencias_transporte e
     JOIN ordenes o ON o.id = e.orden_id
     ORDER BY e.fecha_despacho DESC, e.id DESC`,
  )
  const ordenes = await consulta('SELECT id, numero, destino FROM ordenes ORDER BY id DESC')
  ok(res, null, { evidencias: lista, ordenes })
})

// Monto calculado de una orden para autocompletar el formulario.
evidencias.get('/monto-orden/:oid', soloAdmin, async (req, res) => {
  const oid = Number(req.params.oid)
  if (!(await una('SELECT id FROM ordenes WHERE id = $1', [oid]))) {
    return error(res, 'La orden no existe.', 404, { monto: 0 })
  }
  ok(res, null, { monto: Math.round((await montoOrden(oid)) * 100) / 100 })
})

// Registra una evidencia de transporte.
evidencias.post('/', soloAdmin, async (req, res) => {
  const datos = cuerpo(req)
  const largo = validarLargos(datos, {
    placa: 15, transportista: 120, empresa: 120, observaciones: 2000, fecha_despacho: 40, monto: 30,
  })
  if (largo) return error(res, largo)
  const oid = aInt(datos.orden_id, 0)
  const placa = texto(datos.placa).toUpperCase()
  const transportista = texto(datos.transportista)
  const empresa = texto(datos.empresa)
  const observaciones = texto(datos.observaciones)
  const fechaTxt = texto(datos.fecha_despacho)
  const montoTxt = datos.monto ? texto(datos.monto) : ''

  if (!oid) return error(res, 'Selecciona la orden de entrega que se va a transportar.')
  if (!(await una('SELECT id FROM ordenes WHERE id = $1', [oid]))) {
    return error(res, 'La orden seleccionada no existe.')
  }
  if (!placa) return error(res, 'La placa del vehiculo es obligatoria.')
  if (!/^[A-Z0-9 -]{3,15}$/.test(placa)) {
    return error(res, 'La placa solo puede llevar letras, numeros, espacios o guiones (3 a 15 caracteres).')
  }

  let monto = montoTxt ? aFloat(montoTxt, null) : null
  if (monto === null) monto = await montoOrden(oid)
  if (!enRango(monto, 0, 99_999_999_999)) return error(res, 'El monto no es valido.')

  let ev
  try {
    ev = await una(
      `INSERT INTO evidencias_transporte
       (orden_id, placa, transportista, empresa, monto, observaciones, fecha_despacho)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())) RETURNING id, fecha_despacho`,
      [oid, placa, transportista, empresa, monto, observaciones, fechaTxt || null],
    )
  } catch {
    return error(res, 'No se pudo guardar la evidencia. Revisa los datos (la fecha debe ser valida).')
  }
  await registrar(actorActividad(req), {
    accion: 'inventario.evidencia_crear', objeto: { tipo: 'evidencia_transporte', id: ev.id },
    cambios: { orden: oid, placa, transportista: corto(transportista), empresa: corto(empresa), monto, fecha_despacho: ev.fecha_despacho },
  })
  ok(res, 'Evidencia de transporte registrada.')
})

evidencias.delete('/:eid', soloAdmin, async (req, res) => {
  const fila = await una(
    'DELETE FROM evidencias_transporte WHERE id = $1 RETURNING id, orden_id, placa, monto', [Number(req.params.eid)],
  )
  if (!fila) return error(res, 'La evidencia ya no existe.', 404)
  await registrar(actorActividad(req), {
    accion: 'inventario.evidencia_eliminar', objeto: { tipo: 'evidencia_transporte', id: fila.id },
    cambios: { orden: fila.orden_id, placa: fila.placa, monto: fila.monto },
  })
  ok(res, 'Evidencia eliminada.')
})

export default router
