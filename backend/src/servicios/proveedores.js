// Proveedores desde la Bitácora. Se pueden ver, crear y editar proveedores y consultar las facturas de cada
// uno, que son los mismos proveedores y facturas que usa el inventario. Eliminar es una acción más restringida
// y un proveedor con artículos, recepciones o facturas no se elimina.
import { consulta, una, COD_UNICO, COD_FK } from '../inventario/db.js';
import { prohibido, noEncontrado, solicitudInvalida, HttpError } from '../errores.js';
import { txt, entero } from '../util.js';
import {
  validarProveedor, SQL_INSERTAR_PROVEEDOR, SQL_LISTAR_PROVEEDORES, SQL_ACTUALIZAR_PROVEEDOR, SQL_FACTURAS_DE_PROVEEDOR,
  SQL_PROVEEDOR, CAMPOS_PROVEEDOR, valoresProveedor, mensajeDuplicado,
} from '../inventario/proveedor.js';
import { registrar, diferencias } from './actividad.js';

const exigirAcceso = (u) => {
  if (!u?.general && u?.rol !== 'coordinador') throw prohibido('Los proveedores los gestiona el Coordinador local regional.');
};

// Lista los proveedores.
export async function listarProveedores(usuario) {
  exigirAcceso(usuario);
  return { ok: true, items: await consulta(SQL_LISTAR_PROVEEDORES) };
}

// Crea un proveedor validando sus datos.
export async function crearProveedor(usuario, datos = {}) {
  exigirAcceso(usuario);
  const p = validarProveedor(datos);
  let item;
  try {
    item = await una(SQL_INSERTAR_PROVEEDOR, valoresProveedor(p));
  } catch (e) {
    if (e.code === COD_UNICO) throw new HttpError(409, mensajeDuplicado(e, p));
    throw e;
  }
  await registrar(usuario, {
    accion: 'proveedores.crear', objeto: { tipo: 'proveedor', id: item.id },
    cambios: { campos: diferencias({}, item, CAMPOS_PROVEEDOR) },
  });
  return { ok: true, item };
}

// Cambia los datos de un proveedor, también para completar los de los creados antes de pedir el documento.
export async function actualizarProveedor(usuario, datos = {}) {
  exigirAcceso(usuario);
  const id = entero(datos.id);
  if (!id) throw solicitudInvalida('Falta el proveedor.');
  const p = validarProveedor(datos);
  const antes = await una(SQL_PROVEEDOR, [id]);
  if (!antes) throw noEncontrado('El proveedor no existe.');
  let fila;
  try {
    const valores = valoresProveedor(p);
    valores[1] = txt(datos.codigo) || null;
    fila = await una(SQL_ACTUALIZAR_PROVEEDOR, [...valores, id]);
  } catch (e) {
    if (e.code === COD_UNICO) throw new HttpError(409, mensajeDuplicado(e, p));
    throw e;
  }
  if (!fila) throw noEncontrado('El proveedor no existe.');
  await registrar(usuario, {
    accion: 'proveedores.editar', objeto: { tipo: 'proveedor', id: fila.id },
    cambios: { campos: diferencias(antes, fila, CAMPOS_PROVEEDOR) },
  });
  return { ok: true, item: fila };
}

// Lista las facturas de un proveedor.
export async function facturasDeProveedor(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const pid = entero(id);
  const proveedor = pid && await una('SELECT id, nombre FROM proveedores WHERE id = $1', [pid]);
  if (!proveedor) throw noEncontrado('El proveedor no existe.');
  return { ok: true, proveedor, facturas: await consulta(SQL_FACTURAS_DE_PROVEEDOR, [proveedor.id]) };
}

// Elimina un proveedor que nunca se usó; si tiene artículos, recepciones o facturas, se rechaza.
export async function eliminarProveedor(usuario, { id } = {}) {
  if (!usuario?.superadmin) throw prohibido('Solo el Coordinador general puede eliminar proveedores.');
  const pid = entero(id);
  if (!pid) throw solicitudInvalida('Falta el proveedor.');
  const { c: usados } = await una(
    `SELECT (SELECT COUNT(*) FROM articulos   WHERE proveedor_id = $1)
          + (SELECT COUNT(*) FROM movimientos WHERE proveedor_id = $1)
          + (SELECT COUNT(*) FROM facturas    WHERE proveedor_id = $1)
          + (SELECT COUNT(*) FROM public.carrito_linea_cotizaciones WHERE id_proveedor = $1) AS c`, [pid]);
  if (Number(usados)) throw new HttpError(409, 'No se puede eliminar: tiene artículos, recepciones, facturas o cotizaciones de planes de capitalización asociadas.');
  let fila;
  try {
    fila = await una('DELETE FROM proveedores WHERE id = $1 RETURNING id, nombre', [pid]);
  } catch (e) {
    if (e.code === COD_FK) throw new HttpError(409, 'No se puede eliminar: el proveedor está en uso.');
    throw e;
  }
  if (!fila) throw noEncontrado('El proveedor ya no existe.');
  await registrar(usuario, {
    accion: 'proveedores.eliminar', objeto: { tipo: 'proveedor', id: fila.id }, cambios: { nombre: fila.nombre },
  });
  return { ok: true, item: fila };
}

// Devuelve una factura con sus líneas, solo para lectura.
export async function detalleFactura(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const fid = entero(id);
  const factura = fid && await una(
    `SELECT f.id, f.numero, f.fecha, f.vencimiento, f.total, f.adjunto_nombre, f.creado_por, f.creado, p.nombre AS proveedor,
            (f.adjunto IS NOT NULL) AS tiene_adjunto
       FROM facturas f LEFT JOIN proveedores p ON p.id = f.proveedor_id WHERE f.id = $1`, [fid]);
  if (!factura) throw noEncontrado('La factura no existe.');
  const items = await consulta(
    `SELECT i.id, i.nombre, i.descripcion, i.sku, i.cantidad, i.valor_unitario, i.valor_impuesto, i.total, b.nombre AS bodega
       FROM factura_items i JOIN bodegas b ON b.id = i.bodega_id WHERE i.factura_id = $1 ORDER BY i.id`, [factura.id]);
  return { ok: true, factura, items };
}

// Devuelve el PDF de la factura con su nombre.
export async function adjuntoFactura(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const f = entero(id) && await una('SELECT adjunto, adjunto_nombre FROM facturas WHERE id = $1', [entero(id)]);
  if (!f || !f.adjunto) throw noEncontrado('La factura no tiene adjunto.');
  return { buffer: f.adjunto, nombre: f.adjunto_nombre || `factura-${id}.pdf` };
}
