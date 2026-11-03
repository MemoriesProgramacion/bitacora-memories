// API de imágenes de códigos de barras y QR, y de los datos para imprimir etiquetas.
import { Router } from 'express'
import { consulta } from '../db.js'
import { loginRequerido } from '../seguridad.js'
import { ok, error, aInt, barcodePng, qrPng } from '../util.js'

const router = Router()

// Tope de etiquetas por petición, porque cada una genera una imagen en el servidor.
const MAX_ETIQUETAS = 200

// Responde una imagen PNG con caché de un día, porque el código siempre da la misma imagen.
function enviarPng(res, png) {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' })
  res.send(png)
}

// Imagen del código de barras Code128 de un código.
router.get('/barcode/:code.png', loginRequerido, async (req, res) => {
  const code = req.params.code
  if (code.length > 64) return error(res, 'Codigo demasiado largo.')
  const legible = req.query.hr !== '0'
  let png
  try {
    png = await barcodePng(code, legible)
  } catch {
    return error(res, 'Ese texto no se puede representar como codigo de barras.')
  }
  enviarPng(res, png)
})

// Imagen del código QR de un código.
router.get('/qr/:code.png', loginRequerido, async (req, res) => {
  const code = req.params.code
  if (code.length > 64) return error(res, 'Codigo demasiado largo.')
  const tamano = Math.min(Math.max(aInt(req.query.t, 10) || 10, 4), 20)
  enviarPng(res, await qrPng(code, tamano))
})

// Lista de etiquetas a imprimir; el dibujo lo hace el frontend.
router.get('/etiquetas', loginRequerido, async (req, res) => {
  const tipo = req.query.tipo || 'articulo'
  const ids = [].concat(req.query.id ?? []).map((v) => aInt(v)).filter((v) => v !== null)
  const copias = Math.min(20, Math.max(1, aInt(req.query.copias, 1) || 1))
  if (ids.length > 1000) return error(res, 'Demasiados articulos seleccionados.')

  const tabla = tipo === 'combo' ? 'combos' : 'articulos'
  const condiciones = []
  const params = []
  if (tabla === 'articulos') condiciones.push('activo')
  if (ids.length) {
    params.push(ids)
    condiciones.push('id = ANY($1::int[])')
  }
  const filas = await consulta(
    `SELECT nombre, codigo_barras FROM ${tabla}
     ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''}
     ORDER BY nombre`,
    params,
  )

  const etiquetas = []
  let recortado = false
  for (const r of filas) {
    for (let i = 0; i < copias; i++) {
      if (etiquetas.length >= MAX_ETIQUETAS) {
        recortado = true
        break
      }
      etiquetas.push({ nombre: r.nombre, codigo: r.codigo_barras })
    }
    if (recortado) break
  }

  ok(res, null, { etiquetas, tipo, recortado, maximo: MAX_ETIQUETAS })
})

export default router
