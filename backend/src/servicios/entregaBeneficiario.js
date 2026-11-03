// Entrega al beneficiario: con el plan en compra, quien atiende la unidad deja los soportes de la entrega: el
// documento de recomendaciones de uso y el acta de recibido de la copia de las facturas y de los soportes de
// garantía.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { transaccion } from '../db.js';
import { ROLES, config } from '../config.js';
import { HttpError, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { guardarArchivo } from './archivos.js';
import { contenidoValido } from './tipoArchivo.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { NOMBRE_ESTADO, cargarCarrito, conRegistroCarrito, exigirCarritoEnPrograma, exigirLectura, iniciativa, vista } from './carrito.js';

const quienEs = (u) => u.nombre || u.nodo || u.sub || 'sistema';
const marca = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const soloAlfanum = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_');

// Comprueba que el archivo sea un PDF válido.
async function pdfValido(archivo, que) {
  if (!archivo) throw solicitudInvalida(`Adjunta ${que} en PDF.`);
  if (archivo.size > config.maxMbPdf * 1024 * 1024) throw new HttpError(413, `El PDF supera los ${config.maxMbPdf} MB.`);
  if (path.extname(archivo.originalname || '').toLowerCase() !== '.pdf' || !(await contenidoValido(archivo.path, archivo.originalname))) {
    throw solicitudInvalida(`${que.charAt(0).toUpperCase()}${que.slice(1)} debe ser un PDF válido.`);
  }
}
// Recupera el nombre UTF-8 original de un archivo, que multer entrega en latin1.
const nombreOriginal = (archivo) => Buffer.from(archivo?.originalname || '', 'latin1').toString('utf8').slice(0, 300);

// Obtiene la unidad y su plan bloqueado, comprobando quién escribe y que el plan esté en compra.
async function planEnCompra(db, usuario, up) {
  const carrito = await cargarCarrito(db, up.id_up, true);
  exigirCarritoEnPrograma(carrito);
  if (carrito?.estado !== 'en_compra') {
    throw new HttpError(409, `La entrega al beneficiario se registra con el plan en compra (este está ${NOMBRE_ESTADO[carrito?.estado || 'borrador']}).`);
  }
  return carrito;
}

function exigirEditor(usuario) {
  exigirLectura(usuario);
  if (![ROLES.GESTOR, ROLES.COORDINADOR].includes(usuario.rol)) {
    throw prohibido('La entrega al beneficiario la registran el gestor del nodo y la coordinación.');
  }
}

async function guardar(db, usuario, up, carrito, cambio) {
  const entrega = { ...(carrito.entrega_beneficiario || {}), ...cambio };
  await db.query('UPDATE carritos SET entrega_beneficiario = $2 WHERE id_carrito = $1', [carrito.id_carrito, JSON.stringify(entrega)]);
  return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
}

// Guarda el documento de recomendaciones de uso y buenas prácticas entregado a la unidad, reemplazando el
// anterior.
export async function cargarRecomendaciones(usuario, campos = {}, archivo) {
  exigirEditor(usuario);
  const up = await iniciativa(usuario, campos.id_unico);
  await pdfValido(archivo, 'el documento de recomendaciones de uso');
  return conRegistroCarrito(usuario, 'carrito.recomendaciones', up.id_unico, () => transaccion(async (db) => {
    const carrito = await planEnCompra(db, usuario, up);
    const r = await guardarArchivo({ contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/entrega/${marca()}_${randomBytes(3).toString('hex')}_RECOMENDACIONES.pdf` }, db);
    return guardar(db, usuario, up, carrito, { recomendaciones: {
      soporte: r.nombre, soporte_nombre: nombreOriginal(archivo), cargado_por: quienEs(usuario), cargado_en: new Date().toISOString(),
    } });
  }), () => ({ recomendaciones: nombreOriginal(archivo) }));
}

// Registra el acta de recibido de la copia de las facturas y de los soportes de garantía, firmada por quien
// recibe en la unidad.
export async function registrarActaRecibido(usuario, campos = {}, archivo) {
  exigirEditor(usuario);
  const up = await iniciativa(usuario, campos.id_unico);
  const fecha = String(campos.fecha || '').slice(0, 10);
  if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < '2000-01-01') throw solicitudInvalida('La fecha del acta de recibido no es válida (no puede ser futura).');
  const recibe = txt(campos.recibe_nombre)?.slice(0, 200);
  if (!recibe) throw solicitudInvalida('Escribe el nombre de quien recibe en la unidad productiva.');
  const documento = String(campos.recibe_documento || '').replace(/[\s.]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{5,15}$/.test(documento)) throw solicitudInvalida('Escribe el número de documento de quien recibe (5 a 15 letras o números).');
  const garantias = txt(campos.garantias)?.slice(0, 2000);
  if (!garantias) throw solicitudInvalida('Escribe los soportes de garantía que se entregaron (o «Sin garantía» si el bien no la tiene).');
  let ids;
  try { ids = typeof campos.facturas === 'string' ? JSON.parse(campos.facturas) : campos.facturas; } catch { ids = null; }
  ids = Array.isArray(ids) ? [...new Set(ids.map((x) => entero(x)).filter((x) => x && x > 0 && x <= 2147483647))] : [];
  if (!ids.length) throw solicitudInvalida('Marca las facturas cuya copia se entregó.');
  await pdfValido(archivo, 'el acta de recibido firmada');
  return conRegistroCarrito(usuario, 'carrito.acta_recibido', up.id_unico, () => transaccion(async (db) => {
    const carrito = await planEnCompra(db, usuario, up);
    const { rows: facturas } = await db.query(
      `SELECT id, numero, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM inventario.facturas WHERE id = ANY($1::int[]) AND id_unico = $2 ORDER BY fecha, id`,
      [ids, up.id_unico]);
    if (facturas.length !== ids.length) {
      throw solicitudInvalida('Alguna de las facturas no es una factura de capitalización de esta unidad productiva.');
    }
    const r = await guardarArchivo({ contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/entrega/${marca()}_${randomBytes(3).toString('hex')}_ACTA_RECIBIDO.pdf` }, db);
    return guardar(db, usuario, up, carrito, { acta_recibido: {
      fecha, recibe_nombre: recibe, recibe_documento: documento, garantias, facturas,
      soporte: r.nombre, soporte_nombre: nombreOriginal(archivo), registrada_por: quienEs(usuario), registrada_en: new Date().toISOString(),
    } });
  }), () => ({ fecha, recibe: recibe, facturas: ids.length }));
}
