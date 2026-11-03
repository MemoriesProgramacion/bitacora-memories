// Catálogo de productos del carrito. Todos los usuarios que usan el carrito lo consultan y solo la coordinación
// lo modifica, producto por producto o importando un Excel o CSV. Cada producto se clasifica con su clase
// UNSPSC y su rubro capitalizable, o con la causal por la que no es financiable.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { prohibido, solicitudInvalida, noEncontrado, HttpError } from '../errores.js';
import { txt, entero } from '../util.js';
import { validarXlsx, valorCelda } from '../inventario/excel.js';
import { exigirContenido } from './tipoArchivo.js';
import { conRegistro } from './actividad.js';
import { RUBROS, NO_FINANCIABLES, codigoDeLista, validarUnspsc, leerHoja } from './clasificacion.js';

const POR_PAGINA = 24;
const MAX_FILAS = 5000;
const MAX_BYTES = 10 * 1024 * 1024;

const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS, ROLES.GESTOR];

function exigirLectura(usuario) {
  if (!LECTORES.includes(usuario.rol)) throw prohibido('Tu usuario no usa el carrito.');
}

function exigirEdicion(usuario) {
  if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('Solo la coordinación modifica el catálogo.');
}

const COLUMNAS = `p.id_producto, p.id_origen, p.tipologia, p.sector, p.ciiu, p.proceso, p.item_por_actividad, p.tipo, p.nombre,
                  p.descripcion, p.precio::float AS precio, COALESCE(p.iva, 0)::float AS iva,
                  p.unspsc, u.nombre AS unspsc_nombre, p.rubro, p.no_financiable`;

// Búsqueda paginada con filtros que también devuelve las tipologías y sectores existentes para armar los
// filtros de la pantalla.
export async function listarCatalogo(usuario, { q, tipologia, sector, rubro, pagina } = {}) {
  exigirLectura(usuario);
  const buscar = txt(q) ? `%${txt(q).slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const pag = Math.max(1, entero(pagina) || 1);
  const soloFinanciables = usuario.rol === ROLES.GESTOR;

  const { rows } = await query(
    `SELECT ${COLUMNAS}, count(*) OVER()::int AS total
       FROM catalogo_productos p
       LEFT JOIN unspsc_clases u ON u.codigo = p.unspsc
      WHERE p.activo
        AND ($1::text IS NULL OR p.nombre ILIKE $1 OR p.descripcion ILIKE $1
             OR p.item_por_actividad ILIKE $1 OR p.id_origen ILIKE $1 OR p.unspsc LIKE $1)
        AND ($2::text IS NULL OR p.tipologia = $2)
        AND ($3::text IS NULL OR p.sector = $3)
        AND ($5::text IS NULL OR p.rubro = $5)
        AND (NOT $6::boolean OR p.no_financiable IS NULL)
      ORDER BY p.nombre
      LIMIT ${POR_PAGINA} OFFSET $4`,
    [buscar, txt(tipologia), txt(sector), (pag - 1) * POR_PAGINA, txt(rubro), soloFinanciables],
  );
  const total = rows[0]?.total || 0;

  const [tip, sec] = await Promise.all([
    query('SELECT DISTINCT tipologia AS v FROM catalogo_productos WHERE activo AND tipologia IS NOT NULL ORDER BY 1'),
    query('SELECT DISTINCT sector AS v FROM catalogo_productos WHERE activo AND sector IS NOT NULL ORDER BY 1'),
  ]);

  return {
    ok: true,
    items: rows.map(({ total: _t, ...p }) => p),
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    facetas: { tipologias: tip.rows.map((r) => r.v), sectores: sec.rows.map((r) => r.v) },
  };
}

// Interpreta un número escrito por una persona, como 1250000, $ 1.250.000, 1.250,50 o 1,250.50.
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}(\.|$)/.test(s) && !s.includes(',')) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Interpreta el IVA como porcentaje: 19, 19% o 0,19.
function porcentaje(v) {
  const n = numero(v);
  if (n === null) return 0;
  return n > 0 && n < 1 ? Math.round(n * 100) : n;
}

// Valida los datos de un producto, de un formulario o de una fila de Excel.
async function producto(d, db = { query }, { importacion = false } = {}) {
  const nombre = txt(d.nombre)?.slice(0, 300);
  const precio = numero(d.precio);
  const iva = porcentaje(d.iva);
  if (!nombre) throw solicitudInvalida('El producto necesita un nombre.');
  if (precio === null || precio < 0 || precio > 9_999_999_999) throw solicitudInvalida('El precio no es válido.');
  if (iva < 0 || iva > 100) throw solicitudInvalida('El IVA debe estar entre 0 y 100.');
  const rubro = codigoDeLista(RUBROS, d.rubro, 'el rubro');
  const noFinanciable = codigoDeLista(NO_FINANCIABLES, d.no_financiable, 'la causal de no financiable');
  if (rubro && noFinanciable) {
    throw solicitudInvalida('Un producto no financiable no tiene rubro capitalizable: deja solo uno de los dos.');
  }
  const corto = (v, n) => (txt(v) ? txt(v).slice(0, n) : null);
  return {
    nombre, precio, iva,
    tipologia: corto(d.tipologia, 150),
    sector: corto(d.sector, 150),
    proceso: corto(d.proceso, 150),
    tipo: corto(d.tipo, 100),
    ciiu: corto(d.ciiu, 10),
    item: corto(d.item_por_actividad, 150),
    descripcion: corto(d.descripcion, 2000),
    unspsc: await validarUnspsc(d.unspsc, db),
    rubro,
    no_financiable: noFinanciable,
    trae: {
      unspsc: importacion ? txt(d.unspsc) !== null : d.unspsc !== undefined,
      rubro: (importacion ? Boolean(rubro) : d.rubro !== undefined) || Boolean(noFinanciable),
      no_financiable: (importacion ? Boolean(noFinanciable) : d.no_financiable !== undefined) || Boolean(rubro),
    },
  };
}

// Genera un código estable para un producto sin código, de modo que volver a importarlo actualice en lugar de
// duplicar.
const codigoDerivado = (p) =>
  `CAT-${crypto.createHash('sha1').update(`${p.nombre}|${p.tipologia}|${p.sector}`).digest('hex').slice(0, 12)}`;

// Consulta que crea o actualiza un producto del catálogo.
const UPSERT = `
  INSERT INTO catalogo_productos
    (id_origen, tipologia, sector, ciiu, proceso, item_por_actividad, tipo, nombre, descripcion,
     precio, iva, unspsc, rubro, no_financiable, fecha_cargue, activo)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), TRUE)
  ON CONFLICT (id_origen) DO UPDATE SET
    tipologia = EXCLUDED.tipologia, sector = EXCLUDED.sector, ciiu = EXCLUDED.ciiu,
    proceso = EXCLUDED.proceso, item_por_actividad = EXCLUDED.item_por_actividad,
    tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion,
    precio = EXCLUDED.precio, iva = EXCLUDED.iva,
    -- La clasificación solo cambia si el archivo o el formulario la trae: reimportar un catálogo
    -- sin esas columnas no borra lo que ya se clasificó.
    unspsc = CASE WHEN $15::boolean THEN EXCLUDED.unspsc ELSE catalogo_productos.unspsc END,
    rubro = CASE WHEN $16::boolean THEN EXCLUDED.rubro ELSE catalogo_productos.rubro END,
    no_financiable = CASE WHEN $17::boolean THEN EXCLUDED.no_financiable ELSE catalogo_productos.no_financiable END,
    fecha_cargue = now(), activo = TRUE
  RETURNING id_producto, (xmax = 0) AS creado`;

const valoresUpsert = (idOrigen, p) =>
  [idOrigen, p.tipologia, p.sector, p.ciiu, p.proceso, p.item, p.tipo, p.nombre, p.descripcion, p.precio, p.iva,
    p.unspsc, p.rubro, p.no_financiable, p.trae.unspsc, p.trae.rubro, p.trae.no_financiable];

const CAMPOS_REGISTRO = ['nombre', 'precio', 'iva', 'tipologia', 'sector', 'proceso', 'tipo', 'unspsc', 'rubro', 'no_financiable'];
const resumenProducto = (p) => Object.fromEntries(CAMPOS_REGISTRO.map((k) => [k, p[k] ?? null]));

// Crea un producto o, si trae id, lo modifica.
export async function guardarProducto(usuario, datos = {}) {
  exigirEdicion(usuario);
  const p = await producto(datos);
  const idProducto = entero(datos.id_producto);

  return conRegistro(
    usuario, { accion: idProducto ? 'catalogo.editar' : 'catalogo.crear', objeto: { tipo: 'producto', id: idProducto ?? txt(datos.codigo) ?? p.nombre } },
    async () => {
      if (idProducto) {
        const r = await query(
          `UPDATE catalogo_productos
              SET tipologia = $2, sector = $3, ciiu = $4, proceso = $5, item_por_actividad = $6,
                  tipo = $7, nombre = $8, descripcion = $9, precio = $10, iva = $11,
                  unspsc = CASE WHEN $15::boolean THEN $12::char(6) ELSE unspsc END,
                  rubro = CASE WHEN $16::boolean THEN $13::varchar ELSE rubro END,
                  no_financiable = CASE WHEN $17::boolean THEN $14::varchar ELSE no_financiable END, activo = TRUE
            WHERE id_producto = $1 RETURNING id_producto`,
          [idProducto, p.tipologia, p.sector, p.ciiu, p.proceso, p.item, p.tipo, p.nombre, p.descripcion, p.precio, p.iva,
            p.unspsc, p.rubro, p.no_financiable, p.trae.unspsc, p.trae.rubro, p.trae.no_financiable],
        );
        if (!r.rows.length) throw noEncontrado('El producto no existe.');
        return { ok: true, id_producto: idProducto };
      }
      const codigo = txt(datos.codigo)?.slice(0, 100) || codigoDerivado(p);
      const { rows } = await query(UPSERT, valoresUpsert(codigo, p));
      return { ok: true, id_producto: rows[0].id_producto, creado: rows[0].creado };
    },
    () => ({ despues: resumenProducto(p) }),
  );
}

// Deja de ofrecer el producto pero lo conserva para los carritos que ya lo tienen.
export async function eliminarProducto(usuario, { id } = {}) {
  exigirEdicion(usuario);
  return conRegistro(
    usuario, { accion: 'catalogo.retirar', objeto: { tipo: 'producto', id: entero(id) } },
    async () => {
      const r = await query('UPDATE catalogo_productos SET activo = FALSE WHERE id_producto = $1', [entero(id)]);
      if (!r.rowCount) throw noEncontrado('El producto no existe.');
      return { ok: true };
    },
  );
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Nombres de columna reconocidos al importar, sin tildes ni mayúsculas.
const ALIAS = {
  codigo: ['codigo', 'id', 'id_origen', 'sku', 'referencia'],
  nombre: ['nombre', 'producto', 'nombre_producto', 'item'],
  precio: ['precio', 'precio_unitario', 'valor', 'precio_sin_iva'],
  iva: ['iva', 'porcentaje_iva'],
  tipologia: ['tipologia'],
  sector: ['sector'],
  proceso: ['proceso'],
  tipo: ['tipo'],
  descripcion: ['descripcion'],
  ciiu: ['ciiu'],
  item_por_actividad: ['item_por_actividad', 'item_actividad'],
  unspsc: ['unspsc', 'codigo_unspsc', 'clase_unspsc'],
  rubro: ['rubro', 'rubro_capitalizable'],
  no_financiable: ['no_financiable', 'causal_no_financiable'],
};

// Lee la primera hoja y devuelve las filas como objetos con las claves de ALIAS.
async function leerFilas(archivo, buffer) {
  const wb = new ExcelJS.Workbook();
  let hoja;
  if (/\.csv$/i.test(archivo)) {
    const texto = buffer.toString('utf8').replace(/^﻿/, '');
    const primera = texto.split(/\r?\n/, 1)[0] || '';
    const delimiter = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
    hoja = await leerHoja(() => wb.csv.read(Readable.from([texto]), { parserOptions: { delimiter } }));
  } else if (/\.xlsx$/i.test(archivo)) {
    validarXlsx(buffer);
    await leerHoja(() => wb.xlsx.load(buffer));
    hoja = wb.worksheets[0];
  } else {
    throw solicitudInvalida('El archivo debe ser un Excel (.xlsx) o un CSV.');
  }
  if (!hoja || hoja.actualRowCount < 2) throw solicitudInvalida('El archivo no tiene filas para importar.');
  if (hoja.actualRowCount > MAX_FILAS + 1) {
    throw solicitudInvalida(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en partes.`);
  }

  const cabecera = hoja.getRow(1);
  const posicion = {};
  for (let c = 1; c <= hoja.columnCount; c++) {
    const nombre = norm(valorCelda(cabecera.getCell(c).value));
    for (const [clave, alias] of Object.entries(ALIAS)) {
      if (alias.includes(nombre) && !(clave in posicion)) posicion[clave] = c;
    }
  }
  if (!('nombre' in posicion) || !('precio' in posicion)) {
    throw solicitudInvalida('Faltan las columnas "nombre" y "precio" en la primera fila.');
  }

  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (fila, n) => {
    if (n === 1) return;
    const dato = { _fila: n };
    for (const [clave, c] of Object.entries(posicion)) dato[clave] = valorCelda(fila.getCell(c).value);
    filas.push(dato);
  });
  return filas;
}

// Importa el catálogo desde Excel o CSV: si un código ya existe actualiza nombre y precio, si no lo crea, y
// nunca borra lo que no venga en el archivo.
export async function importarCatalogo(usuario, archivo) {
  exigirEdicion(usuario);
  if (!archivo) throw solicitudInvalida('Falta el archivo.');
  if (archivo.size > MAX_BYTES) throw solicitudInvalida('El archivo pesa más de 10 MB.');
  const nombreArchivo = Buffer.from(archivo.originalname || '', 'latin1').toString('utf8');
  const bytes = await fs.readFile(archivo.path);
  await exigirContenido(bytes, nombreArchivo, ['.xlsx', '.csv']);
  const filas = await leerFilas(nombreArchivo, bytes);

  return conRegistro(
    usuario, { accion: 'catalogo.importar', objeto: { tipo: 'catalogo', id: nombreArchivo.slice(0, 100) } },
    async () => {
      let creados = 0;
      let actualizados = 0;
      const errores = [];
      await transaccion(async (db) => {
        for (const f of filas) {
          let p;
          try {
            p = await producto(f, db, { importacion: true });
          } catch (e) {
            if (!(e instanceof HttpError)) throw e;
            if (errores.length < 15) errores.push({ fila: f._fila, motivo: e.message });
            continue;
          }
          const codigo = txt(f.codigo)?.slice(0, 100) || codigoDerivado(p);
          const r = await db.query(UPSERT, valoresUpsert(codigo, p));
          if (r.rows[0].creado) creados += 1; else actualizados += 1;
        }
      });

      const omitidos = filas.length - creados - actualizados;
      return {
        ok: true,
        mensaje: `Catálogo importado: ${creados} nuevos, ${actualizados} actualizados.`,
        creados, actualizados, omitidos, errores,
      };
    },
    (r) => ({ creados: r.creados, actualizados: r.actualizados, omitidos: r.omitidos }),
  );
}
