// Utilidades compartidas del inventario: conversiones, formatos, respuestas JSON, validaciones y generación de
// imágenes de códigos de barras y QR.
import bwipjs from 'bwip-js'

// Convierte a entero de forma segura y devuelve un valor por defecto si no se puede.
export function aInt(valor, porDefecto = null) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.trunc(valor) : porDefecto
  if (typeof valor === 'boolean') return valor ? 1 : 0
  if (typeof valor === 'string' && /^\s*[+-]?\d+\s*$/.test(valor)) return parseInt(valor, 10)
  return porDefecto
}

// Convierte a decimal aceptando coma o punto.
export function aFloat(valor, porDefecto = 0) {
  if (valor === null || valor === undefined) return porDefecto
  let txt = String(valor).replace(/\$/g, '').replace(/ /g, '').trim()
  if (!txt) return porDefecto
  if (txt.includes(',')) txt = txt.replace(/\./g, '').replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(txt)) return porDefecto
  return parseFloat(txt)
}

// Devuelve un número con dos cifras, por ejemplo 07.
const dos = (n) => String(n).padStart(2, '0')

// Da formato AAAA-MM-DD HH:MM a una fecha.
export function fmtFecha(valor) {
  if (valor === null || valor === undefined) return ''
  if (valor instanceof Date) {
    return `${valor.getFullYear()}-${dos(valor.getMonth() + 1)}-${dos(valor.getDate())} ` +
      `${dos(valor.getHours())}:${dos(valor.getMinutes())}`
  }
  return String(valor)
}

// Da formato de pesos a un valor, por ejemplo $ 1.979.208.
export function pesos(valor) {
  const n = Number(valor || 0)
  return '$ ' + Math.round(n).toLocaleString('en-US').replace(/,/g, '.')
}

// Genera el código de barras de un artículo a partir de su id.
export const codigoArticulo = (id) => 'ART' + String(id).padStart(6, '0')
// Genera el código de un kit; los creados antes conservan su código anterior, y ambos son válidos.
export const codigoKit = (id) => 'KIT' + String(id).padStart(6, '0')

// Responde con éxito en formato JSON.
export function ok(res, mensaje = null, datos = {}) {
  const cuerpo = { ok: true }
  if (mensaje) cuerpo.mensaje = mensaje
  return res.json({ ...cuerpo, ...datos })
}

// Responde con un error en formato JSON.
export function error(res, mensaje, codigo = 400, datos = {}) {
  return res.status(codigo).json({ ok: false, error: mensaje, ...datos })
}

// Error esperado de una regla de negocio; dentro de una transacción la revierte y se convierte en respuesta
// JSON.
export class ErrorNegocio extends Error {
  constructor(mensaje, codigo = 400, datos = {}) {
    super(mensaje)
    this.name = 'ErrorNegocio'
    this.codigo = codigo
    this.datos = datos
  }
}

// Para router.param: responde 404 si el id no es un entero positivo.
export function soloEnteros(req, res, next, valor) {
  if (!/^\d{1,9}$/.test(valor)) return error(res, 'Recurso no encontrado.', 404)
  next()
}

// Responde un PDF para verlo en el navegador con el nombre indicado.
export function enviarPdf(res, buffer, nombre) {
  const ascii = nombre.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': buffer.length,
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
  })
  res.send(buffer)
}

// Devuelve el cuerpo JSON de la petición, siempre como objeto.
export function cuerpo(req) {
  const b = req.body
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

// Valida el largo máximo de varios campos de texto y devuelve el mensaje del primero que se pasa.
export function validarLargos(datos, limites) {
  for (const [campo, max] of Object.entries(limites)) {
    const v = datos[campo]
    if (v !== undefined && v !== null && String(v).length > max) {
      return `El campo "${campo}" no puede pasar de ${max} caracteres.`
    }
  }
  return null
}

// Indica si un número es finito y está dentro del rango dado.
export const enRango = (n, min, max) => Number.isFinite(n) && n >= min && n <= max

// Escapa los comodines de LIKE para buscar el texto de forma literal.
export const escaparLike = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c)

// Devuelve el texto recortado de un campo del cuerpo, o vacío.
export function texto(valor) {
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor)
  return ''
}

// Genera un PNG de código de barras Code128.
export function barcodePng(codigo, textoLegible = true) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: codigo,
    scale: 3,
    height: 14,
    includetext: textoLegible,
    textxalign: 'center',
    textsize: 10,
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: 'FFFFFF',
  })
}

// Genera un PNG de código QR con corrección de errores M, que tolera daño en la etiqueta.
export function qrPng(codigo, tamano = 10) {
  return bwipjs.toBuffer({
    bcid: 'qrcode',
    text: codigo,
    eclevel: 'M',
    scale: tamano,
    paddingwidth: 2,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
  })
}
