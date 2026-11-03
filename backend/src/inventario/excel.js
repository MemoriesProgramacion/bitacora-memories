// Lectura segura de archivos Excel (.xlsx), usada por la carga de órdenes de pedido y por la importación del
// catálogo del carrito.
import { ErrorNegocio } from './util.js'

// Tamaño máximo permitido al descomprimir el archivo, porque un .xlsx es un ZIP.
const MAX_DESCOMPRIMIDO = 150 * 1024 * 1024

// Comprueba que el archivo sea realmente un ZIP y que no declare un tamaño descomprimido desproporcionado,
// leyendo solo su directorio central.
export function validarXlsx(buf) {
  const invalido = () => new ErrorNegocio('El archivo no es un Excel (.xlsx) válido.')
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw invalido()
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw invalido()
  const entradas = buf.readUInt16LE(eocd + 10)
  let pos = buf.readUInt32LE(eocd + 16)
  if (entradas > 2000) throw new ErrorNegocio('El Excel tiene demasiadas partes internas.')
  let total = 0
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw invalido()
    const tam = buf.readUInt32LE(pos + 24)
    if (tam === 0xffffffff) throw new ErrorNegocio('El Excel es demasiado grande al abrirlo.')
    total += tam
    if (total > MAX_DESCOMPRIMIDO) throw new ErrorNegocio('El Excel es demasiado grande al abrirlo.')
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32)
  }
}

// Devuelve el valor plano de una celda de ExcelJS (fórmulas, texto enriquecido, enlaces).
export function valorCelda(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    if ('result' in v) return valorCelda(v.result)
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return valorCelda(v.text)
    if ('error' in v) return null
    return String(v)
  }
  return v
}
