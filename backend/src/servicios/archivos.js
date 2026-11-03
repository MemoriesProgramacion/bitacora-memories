// Almacén de archivos: los bytes se guardan en disco bajo STORAGE_DIR/<contenedor> y la tabla archivos lleva el
// registro. Cada contenedor lógico agrupa un tipo de documento, y cada archivo tiene una URL pública derivada
// de su contenedor y su nombre.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, transaccion } from '../db.js';
import { config } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { escaparLike } from '../util.js';
import { tieneAlcance, exigirAlcanceDeUP } from '../alcance.js';
import { exigirContenido, tipoPorNombre } from './tipoArchivo.js';

export const CONTENEDORES = ['carritos', 'entrega-activos', 'visitas', 'visitas-formatos', 'prellenados', 'novedades', 'actas-reagendamiento', 'tenencias', 'novedades-asociados'];

// Equivalencia entre el parámetro origen del visor antiguo y el contenedor.
const ORIGEN = { entrega: 'entrega-activos', visitas: 'visitas', carrito: 'carritos', carritos: 'carritos' };
export const contenedorDeOrigen = (origen) => ORIGEN[origen] || 'carritos';

// Obtiene el tipo MIME de un archivo a partir de su extensión, ya verificada contra el contenido al subirlo, y
// nunca del que declaró el navegador.
export const mimeDe = (nombre, defecto = 'application/octet-stream') => tipoPorNombre(nombre)?.mime || defecto;

// Arma la URL pública de un archivo.
export const urlArchivo = (contenedor, nombre) =>
  `/archivos/${contenedor}/${nombre.split('/').map(encodeURIComponent).join('/')}`;

// Carpetas del contenedor de carritos que administra el plan de capitalización con sus propias reglas.
const CARPETAS_DEL_PLAN = new Set(['cotizaciones', 'firmado', 'viabilidad', 'fichas', 'entrega']);
export const esArchivoDelPlan = (nombre) => nombreSeguro(nombre).split('/').some((p) => CARPETAS_DEL_PLAN.has(p.toLowerCase()));

// Devuelve un nombre sin rutas relativas ni caracteres de control.
export function nombreSeguro(nombre) {
  const limpio = String(nombre || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
  if (!limpio) throw solicitudInvalida('Nombre de archivo inválido.');
  if (limpio.length > 380) throw solicitudInvalida('Nombre de archivo demasiado largo.');
  return limpio;
}

async function moverArchivo(origen, destino) {
  await fs.mkdir(path.dirname(destino), { recursive: true });
  try {
    await fs.rename(origen, destino);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.copyFile(origen, destino);
    await fs.unlink(origen);
  }
}

// Bloquea el par contenedor y nombre hasta el final de la transacción para que dos cargas o un borrado no se
// crucen.
async function bloquearNombre(db, contenedor, nombre) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`archivos:${contenedor}/${nombre}`]);
}

// Guarda un archivo subido y lo registra; si ya existía uno con el mismo contenedor y nombre, lo reemplaza.
export async function guardarArchivo({ contenedor, nombre, archivo, idUp = null, usuario = null }, db = null) {
  if (!CONTENEDORES.includes(contenedor)) throw solicitudInvalida('Contenedor desconocido.');
  if (!archivo?.path) throw solicitudInvalida('Falta el archivo.');
  const nombreFinal = nombreSeguro(nombre);
  const { mime } = await exigirContenido(archivo.path, nombreFinal);
  const relativa = path.posix.join(contenedor,
    `${crypto.randomUUID()}${path.extname(nombreFinal).toLowerCase()}`);
  const destino = path.join(config.storageDir, relativa);
  await moverArchivo(archivo.path, destino);

  const quien = usuario ? (usuario.cedula || usuario.nombre || usuario.sub) : null;
  const registrar = async (cli) => {
    await bloquearNombre(cli, contenedor, nombreFinal);
    const previo = await cli.query(
      'SELECT ruta_relativa, mime, tamano, id_up, subido_por, fecha_carga FROM archivos WHERE contenedor = $1 AND nombre = $2 FOR UPDATE',
      [contenedor, nombreFinal],
    );
    if (previo.rows.length) {
      const p = previo.rows[0];
      await cli.query(
        `INSERT INTO archivos_versiones (contenedor, nombre, ruta_relativa, mime, tamano, id_up, subido_por, fecha_carga, reemplazado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [contenedor, nombreFinal, p.ruta_relativa, p.mime, p.tamano, p.id_up, p.subido_por, p.fecha_carga, quien]);
    }
    await cli.query(
      `INSERT INTO archivos (contenedor, nombre, ruta_relativa, mime, tamano, id_up, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (contenedor, nombre) DO UPDATE
         SET ruta_relativa = EXCLUDED.ruta_relativa, mime = EXCLUDED.mime,
             tamano = EXCLUDED.tamano, id_up = coalesce(EXCLUDED.id_up, archivos.id_up),
             subido_por = EXCLUDED.subido_por, fecha_carga = now()`,
      [contenedor, nombreFinal, relativa, mime, archivo.size ?? null, idUp, quien],
    );
    return previo.rows.length > 0;
  };
  let reemplazado;
  try {
    reemplazado = db ? await registrar(db) : await transaccion(registrar);
  } catch (err) {
    await fs.unlink(destino).catch(() => {});
    throw err;
  }
  return { contenedor, nombre: nombreFinal, url: urlArchivo(contenedor, nombreFinal), reemplazado };
}

// Borra un archivo con sus versiones anteriores, filas y bytes, y devuelve cuántos se borraron.
export async function eliminarArchivo({ contenedor, nombre }) {
  const rutas = await transaccion(async (db) => {
    await bloquearNombre(db, contenedor, nombre);
    const { rows } = await db.query('DELETE FROM archivos WHERE contenedor = $1 AND nombre = $2 RETURNING ruta_relativa', [contenedor, nombre]);
    if (!rows.length) return [];
    const { rows: versiones } = await db.query(
      'DELETE FROM archivos_versiones WHERE contenedor = $1 AND nombre = $2 RETURNING ruta_relativa', [contenedor, nombre]);
    return [...rows, ...versiones].map((r) => r.ruta_relativa);
  });
  for (const r of rutas) {
    const ruta = path.join(config.storageDir, r);
    if (ruta.startsWith(config.storageDir + path.sep)) await fs.unlink(ruta).catch(() => {});
  }
  return rutas.length;
}

// Devuelve las versiones anteriores de los archivos vigentes de una unidad, de la más reciente a la más
// antigua.
export async function versionesDeUP(idUp) {
  const { rows } = await query(
    `SELECT v.id, v.contenedor, v.nombre, v.fecha_carga AS fecha, v.subido_por, v.reemplazado_en, v.reemplazado_por
       FROM archivos_versiones v JOIN archivos a ON a.contenedor = v.contenedor AND a.nombre = v.nombre
      WHERE a.id_up = $1 ORDER BY v.reemplazado_en DESC, v.id DESC`, [idUp]);
  const salida = new Map();
  for (const v of rows) {
    const k = `${v.contenedor}/${v.nombre}`;
    if (!salida.has(k)) salida.set(k, []);
    salida.get(k).push({ id: v.id, fecha: v.fecha, subido_por: v.subido_por, reemplazado_en: v.reemplazado_en, reemplazado_por: v.reemplazado_por });
  }
  return salida;
}

// Devuelve los bytes de una versión anterior para descargarla; el alcance lo exige quien llama.
export async function leerVersion(id) {
  const { rows: [v] } = await query('SELECT nombre, ruta_relativa FROM archivos_versiones WHERE id = $1', [id]);
  if (!v) throw noEncontrado('La versión no existe.');
  const ruta = path.join(config.storageDir, v.ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  const buffer = await fs.readFile(ruta).catch(() => null);
  if (!buffer) throw noEncontrado('El archivo de esa versión ya no está en el almacenamiento.');
  return { buffer, nombre: path.posix.basename(v.nombre), tipo: mimeDe(v.nombre) };
}

// Comprueba que las cuentas con territorio solo lean archivos de unidades dentro de su alcance.
async function verificarAlcance(usuario, fila) {
  if (!tieneAlcance(usuario)) return;
  if (!fila.id_up) throw prohibido('Ese archivo está fuera de tu alcance.');
  await exigirAlcanceDeUP(usuario, fila.id_up);
}

// Lista archivos por prefijo para el visor.
export async function listarPorPrefijo(usuario, { contenedor = 'carritos', prefijo }) {
  if (!prefijo) throw solicitudInvalida('Falta el parámetro id.');
  const { rows } = await query(
    `SELECT nombre, id_up, tamano, fecha_carga FROM archivos
      WHERE contenedor = $1 AND nombre LIKE $2 ESCAPE '\\'
      ORDER BY nombre`,
    [contenedor, `${escaparLike(prefijo)}%`],
  );
  const visibles = [];
  for (const r of rows) {
    try { await verificarAlcance(usuario, r); visibles.push(r); } catch { }
  }
  return {
    blobs: visibles.map((r) => ({
      name: r.nombre, size: r.tamano, last_modified: r.fecha_carga,
      url: urlArchivo(contenedor, r.nombre),
    })),
  };
}

// Devuelve la ruta absoluta, el tipo y el nombre para enviar el archivo.
export async function obtenerArchivo(usuario, { contenedor, nombre }) {
  const { rows } = await query(
    'SELECT * FROM archivos WHERE contenedor = $1 AND nombre = $2',
    [contenedor, String(nombre || '')],
  );
  if (!rows.length) throw noEncontrado('Archivo no encontrado.');
  await verificarAlcance(usuario, rows[0]);
  const ruta = path.join(config.storageDir, rows[0].ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  return { ruta, mime: mimeDe(rows[0].nombre), nombre: rows[0].nombre };
}

// Lee el archivo completo en base64, para los formatos prediligenciados.
export async function leerBase64(contenedor, prefijo) {
  const { rows } = await query(
    `SELECT nombre, ruta_relativa, mime FROM archivos
      WHERE contenedor = $1 AND nombre LIKE $2 ESCAPE '\\' ORDER BY nombre`,
    [contenedor, `${escaparLike(prefijo)}%`],
  );
  const salida = [];
  for (const r of rows) {
    const bytes = await fs.readFile(path.join(config.storageDir, r.ruta_relativa));
    salida.push({ nombre: path.posix.basename(r.nombre), mime: mimeDe(r.nombre), contenido: bytes.toString('base64') });
  }
  return salida;
}
