// Datos de un proveedor y su validación, compartidos por el inventario y la Bitácora. Incluye las consultas SQL
// para crear, editar y listar proveedores.
import { ErrorNegocio, texto } from './util.js'

export const TIPOS_DOCUMENTO = ['NIT', 'CC', 'CE', 'PASAPORTE']

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TELEFONO = /^[0-9+()\s-]{7,20}$/
// Formato válido del documento: NIT de 5 a 15 dígitos con dígito de verificación opcional, o cédula solo con
// dígitos.
const DOCUMENTO = {
  NIT: /^\d{5,15}(-\d)?$/,
  CC: /^\d{5,12}$/,
  CE: /^\d{5,12}$/,
  PASAPORTE: /^[A-Za-z0-9]{5,15}$/,
}
const LIMITES = { nombre: 120, contacto: 120, correo: 150, direccion: 200, municipio: 100, departamento: 100 }

// Valida el cuerpo y devuelve el proveedor limpio; lanza un error con el primer problema y el campo afectado.
export function validarProveedor(d = {}) {
  const falla = (campo, mensaje) => { throw new ErrorNegocio(mensaje, 400, { campo }) }
  const p = {
    nombre: texto(d.nombre),
    tipo_documento: texto(d.tipo_documento).toUpperCase(),
    numero_documento: texto(d.numero_documento).replace(/\s+/g, ''),
    contacto: texto(d.contacto),
    telefono: texto(d.telefono),
    correo: texto(d.correo).toLowerCase(),
    direccion: texto(d.direccion),
    municipio: texto(d.municipio),
    departamento: texto(d.departamento),
  }
  for (const [campo, max] of Object.entries(LIMITES)) {
    if (p[campo].length > max) falla(campo, `El campo «${campo}» no puede pasar de ${max} caracteres.`)
  }
  if (!p.nombre) falla('nombre', 'El nombre o razón social es obligatorio.')
  if (!TIPOS_DOCUMENTO.includes(p.tipo_documento)) falla('tipo_documento', 'Elige el tipo de documento: NIT, cédula (CC), cédula de extranjería (CE) o pasaporte.')
  if (!DOCUMENTO[p.tipo_documento].test(p.numero_documento)) {
    falla('numero_documento', p.tipo_documento === 'NIT'
      ? 'El NIT debe tener de 5 a 15 dígitos, con el dígito de verificación si lo tiene (900123456-7).'
      : 'El número de documento no es válido.')
  }
  if (!p.contacto) falla('contacto', 'Escribe el nombre de la persona de contacto.')
  if (!TELEFONO.test(p.telefono)) falla('telefono', 'El teléfono de contacto no es válido (7 a 20 números).')
  if (!CORREO.test(p.correo)) falla('correo', 'Escribe un correo válido, por ejemplo ventas@empresa.co.')
  if (!p.direccion) falla('direccion', 'La dirección es obligatoria.')
  if (!p.municipio) falla('municipio', 'El municipio es obligatorio.')
  for (const k of ['direccion', 'municipio', 'departamento']) if (!p[k]) p[k] = null
  const codigo = texto(d.codigo)
  if (codigo.length > 40) falla('codigo', 'El código no puede pasar de 40 caracteres.')
  p.codigo = codigo || `${p.tipo_documento}-${p.numero_documento}`
  return p
}

// Arma el mensaje cuando el documento o el código interno ya existen.
export const mensajeDuplicado = (e, p) => (String(e.constraint).includes('documento')
  ? `Ya existe un proveedor con ${p.tipo_documento} ${p.numero_documento}.`
  : `Ya existe un proveedor con el código '${p.codigo}'.`)

export const COLUMNAS_PROVEEDOR =
  'id, nombre, codigo, tipo_documento, numero_documento, contacto, telefono, correo, direccion, municipio, departamento, creado'

// Consulta de un proveedor por id.
export const SQL_PROVEEDOR = `SELECT ${COLUMNAS_PROVEEDOR} FROM proveedores WHERE id = $1`

// Campos que se comparan en el registro de actividad antes y después de editar.
export const CAMPOS_PROVEEDOR = COLUMNAS_PROVEEDOR.split(', ').filter((c) => !['id', 'creado'].includes(c))

export const SQL_INSERTAR_PROVEEDOR =
  `INSERT INTO proveedores (nombre, codigo, tipo_documento, numero_documento, contacto, telefono, correo, direccion, municipio, departamento)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNAS_PROVEEDOR}`

// Lista de proveedores con la cantidad de facturas de cada uno.
export const SQL_LISTAR_PROVEEDORES =
  `SELECT ${COLUMNAS_PROVEEDOR.split(', ').map((c) => `p.${c}`).join(', ')},
          (SELECT COUNT(*) FROM facturas f WHERE f.proveedor_id = p.id)::int AS facturas
     FROM proveedores p ORDER BY lower(p.nombre)`

// Actualiza todos los datos del proveedor; el código interno solo cambia si se escribe uno.
export const SQL_ACTUALIZAR_PROVEEDOR =
  `UPDATE proveedores SET nombre = $1, codigo = COALESCE($2, codigo), tipo_documento = $3, numero_documento = $4, contacto = $5,
          telefono = $6, correo = $7, direccion = $8, municipio = $9, departamento = $10
    WHERE id = $11 RETURNING ${COLUMNAS_PROVEEDOR}`

// Facturas de un proveedor, de la más reciente a la más antigua.
export const SQL_FACTURAS_DE_PROVEEDOR =
  `SELECT f.id, f.numero, f.fecha, f.vencimiento, f.total, f.adjunto_nombre, (f.adjunto IS NOT NULL) AS tiene_adjunto, f.creado,
          (SELECT COUNT(*) FROM factura_items i WHERE i.factura_id = f.id)::int AS lineas
     FROM facturas f WHERE f.proveedor_id = $1 ORDER BY f.creado DESC`

// Convierte el proveedor validado en la lista de parámetros de las consultas.
export const valoresProveedor = (p) =>
  [p.nombre, p.codigo, p.tipo_documento, p.numero_documento, p.contacto, p.telefono, p.correo, p.direccion, p.municipio, p.departamento]
