// Clasificación de la capitalización según el anexo: rubros capitalizables, causales de bien no financiable,
// actividades económicas no financiables, tenencia de la sede y catálogo de clases UNSPSC de 6 dígitos. Las
// listas viven aquí y no se siembran en la base.
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, prohibido, solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';
import { validarXlsx, valorCelda } from '../inventario/excel.js';
import { exigirContenido } from './tipoArchivo.js';
import { conRegistro } from './actividad.js';

// Rubros capitalizables del anexo.
export const RUBROS = [
  { codigo: 'dotacion_maquinaria', grupo: 'Dotación', nombre: 'Maquinaria y equipos nuevos (con traslado e instalación)' },
  { codigo: 'dotacion_insumos', grupo: 'Dotación', nombre: 'Insumos y materia prima (fondo rotatorio)' },
  { codigo: 'dotacion_cultural', grupo: 'Dotación', nombre: 'Elementos de la industria cultural' },
  { codigo: 'adecuaciones_locativas', grupo: 'Capital de fortalecimiento', nombre: 'Adecuaciones locativas (mejoras útiles)' },
  { codigo: 'empaques_etiquetas', grupo: 'Capital de fortalecimiento', nombre: 'Empaques y etiquetas' },
  { codigo: 'registros_licencias', grupo: 'Capital de fortalecimiento', nombre: 'Código de barras, INVIMA y licencias (no de software)' },
  { codigo: 'certificaciones', grupo: 'Capital de fortalecimiento', nombre: 'Certificaciones BPA, BPG, BPM y sellos' },
  { codigo: 'capital_semilla', grupo: 'Capital semilla', nombre: 'Capital semilla' },
  { codigo: 'equipos_computo', grupo: 'Equipos de cómputo', nombre: 'Equipos de cómputo (solo justificados)' },
];

// Bienes y gastos no financiables.
export const NO_FINANCIABLES = [
  { codigo: 'inmuebles', nombre: 'Compra de inmuebles o adecuaciones no indispensables' },
  { codigo: 'muebles_vehiculos', nombre: 'Muebles y vehículos ajenos al objeto de la unidad' },
  { codigo: 'servicios_estudios', nombre: 'Estudios de factibilidad, consultorías, formación o asesoría' },
  { codigo: 'pagos_obligaciones', nombre: 'Impuestos, parafiscales, servicios públicos, arriendo, salarios, hipotecas, deudas o dividendos' },
  { codigo: 'bienes_no_nuevos', nombre: 'Bienes de segunda, remanufacturados o recalibrados' },
  { codigo: 'franquicias', nombre: 'Franquicias' },
];

// Actividades económicas no financiables.
export const ACTIVIDADES_NO_FINANCIABLES = [
  { codigo: 'transporte_domicilios', nombre: 'Transporte y domicilios (salvo los ligados a entregar bienes financiables)' },
  { codigo: 'aseo_vigilancia', nombre: 'Aseo y vigilancia' },
  { codigo: 'alcohol_tabaco', nombre: 'Venta principal de alcohol y tabaco' },
  { codigo: 'servicios_profesionales', nombre: 'Servicios profesionales independientes' },
  { codigo: 'lenocinio_webcam', nombre: 'Lenocinio o webcam' },
  { codigo: 'juegos_azar', nombre: 'Juegos de azar' },
  { codigo: 'airbnb_inquilinatos', nombre: 'Airbnb e inquilinatos' },
  { codigo: 'esoterismo', nombre: 'Esoterismo' },
  { codigo: 'casas_refugio', nombre: 'Casas de refugio' },
  { codigo: 'sin_animo_lucro', nombre: 'Actividades sin ánimo de lucro' },
  { codigo: 'cambio_empeno', nombre: 'Casas de cambio o de empeño' },
  { codigo: 'moteles', nombre: 'Moteles' },
  { codigo: 'video_club', nombre: 'Video club' },
  { codigo: 'citas', nombre: 'Servicios de citas' },
  { codigo: 'sex_shops', nombre: 'Sex shops' },
  { codigo: 'ilicitas', nombre: 'Actividades ilícitas' },
];

// Tipos de tenencia de la sede; las adecuaciones locativas exigen sede propia, comodato de 5 años o más o
// arriendo de 3 años o más, con la certificación cargada.
export const TENENCIAS = [
  { codigo: 'propia', nombre: 'Propia', anios_minimos: null },
  { codigo: 'comodato', nombre: 'Comodato', anios_minimos: 5 },
  { codigo: 'arriendo', nombre: 'Arriendo', anios_minimos: 3 },
  { codigo: 'otra', nombre: 'Otra (permiso o posesión)', anios_minimos: null },
];

export const RUBRO_ADECUACIONES = 'adecuaciones_locativas';
export const RUBRO_COMPUTO = 'equipos_computo';

const porCodigo = (lista) => Object.fromEntries(lista.map((x) => [x.codigo, x]));
export const RUBRO = porCodigo(RUBROS);
export const NO_FINANCIABLE = porCodigo(NO_FINANCIABLES);
export const ACTIVIDAD_NO_FINANCIABLE = porCodigo(ACTIVIDADES_NO_FINANCIABLES);
export const TENENCIA = porCodigo(TENENCIAS);

// Normaliza etiquetas que llegan de un Excel: sin tildes, mayúsculas ni signos.
const clave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Devuelve el código de una lista a partir del código o del nombre escrito; vacío da null y lanza un error 400
// si no está en la lista.
export function codigoDeLista(lista, valor, campo) {
  const v = txt(valor);
  if (!v) return null;
  const k = clave(v);
  const x = lista.find((e) => e.codigo === v || clave(e.codigo) === k || clave(e.nombre) === k);
  if (!x) throw solicitudInvalida(`«${v.slice(0, 80)}» no es una opción válida para ${campo}.`);
  return x.codigo;
}

// Indica si la tenencia registrada habilita las adecuaciones locativas.
export function tenenciaHabilitaAdecuaciones(t) {
  if (!t?.tipo || !t.soporte) return false;
  if (t.tipo === 'propia') return true;
  const min = TENENCIA[t.tipo]?.anios_minimos;
  return min !== null && min !== undefined && Number(t.anios) >= min;
}

export const formatoUnspsc = (v) => /^\d{6}$/.test(String(v ?? ''));

// Valida un código UNSPSC de 6 dígitos que exista en el catálogo cargado; vacío da null.
export async function validarUnspsc(valor, db = { query }) {
  const v = txt(valor)?.replace(/\s+/g, '');
  if (!v) return null;
  if (!formatoUnspsc(v)) throw solicitudInvalida(`El código UNSPSC debe tener 6 dígitos: «${String(valor).slice(0, 20)}».`);
  const { rowCount } = await db.query('SELECT 1 FROM public.unspsc_clases WHERE codigo = $1', [v]);
  if (!rowCount) throw solicitudInvalida(`El código UNSPSC ${v} no está en el catálogo de clases cargado.`);
  return v;
}

const LECTORES_UNSPSC = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS, ROLES.GESTOR];

// Devuelve las listas del anexo y cuántas clases UNSPSC hay cargadas, para los formularios.
export async function listas(usuario) {
  if (!LECTORES_UNSPSC.includes(usuario?.rol)) throw prohibido('Tu rol no usa la clasificación de la capitalización.');
  const { rows: [{ n }] } = await query('SELECT count(*)::int AS n FROM unspsc_clases');
  return {
    ok: true,
    item: {
      rubros: RUBROS, no_financiables: NO_FINANCIABLES, actividades_no_financiables: ACTIVIDADES_NO_FINANCIABLES,
      tenencias: TENENCIAS, unspsc_cargadas: n,
    },
  };
}

// Busca clases UNSPSC por código o por nombre, con un máximo de 30 resultados.
export async function buscarUnspsc(usuario, { q } = {}) {
  if (!LECTORES_UNSPSC.includes(usuario?.rol)) throw prohibido('Tu rol no usa la clasificación de la capitalización.');
  const t = txt(q)?.slice(0, 80);
  if (!t) return { ok: true, items: [] };
  const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await query(
    `SELECT codigo, nombre FROM unspsc_clases
      WHERE codigo LIKE $1 || '%' OR nombre ILIKE $2
      ORDER BY (codigo LIKE $1 || '%') DESC, codigo LIMIT 30`,
    [t.replace(/\D/g, '') || '-', like],
  );
  return { ok: true, items: rows };
}

const MAX_FILAS_UNSPSC = 20000;
const MAX_BYTES_UNSPSC = 10 * 1024 * 1024;
const ALIAS_UNSPSC = {
  codigo: ['codigo', 'code', 'clase', 'codigo_clase', 'class', 'class_code', 'unspsc'],
  nombre: ['nombre', 'descripcion', 'title', 'class_title', 'nombre_clase', 'titulo'],
};
const normCab = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Lee el libro de Excel y responde 400 si el archivo está dañado o no es lo que dice su extensión.
export async function leerHoja(leer) {
  try {
    return await leer();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw solicitudInvalida('No se pudo leer el archivo: revisa que sea un Excel (.xlsx) o un CSV válido.');
  }
}

async function filasUnspsc(nombreArchivo, bytes) {
  const wb = new ExcelJS.Workbook();
  let hoja;
  if (/\.csv$/i.test(nombreArchivo)) {
    const texto = bytes.toString('utf8').replace(/^﻿/, '');
    const primera = texto.split(/\r?\n/, 1)[0] || '';
    const delimiter = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
    hoja = await leerHoja(() => wb.csv.read(Readable.from([texto]), { parserOptions: { delimiter } }));
  } else {
    validarXlsx(bytes);
    await leerHoja(() => wb.xlsx.load(bytes));
    hoja = wb.worksheets[0];
  }
  if (!hoja || hoja.actualRowCount < 2) throw solicitudInvalida('El archivo no tiene filas para importar.');
  if (hoja.actualRowCount > MAX_FILAS_UNSPSC + 1) {
    throw solicitudInvalida(`El archivo tiene más de ${MAX_FILAS_UNSPSC} filas.`);
  }
  const posicion = {};
  const cab = hoja.getRow(1);
  for (let c = 1; c <= hoja.columnCount; c++) {
    const n = normCab(valorCelda(cab.getCell(c).value));
    for (const [k, alias] of Object.entries(ALIAS_UNSPSC)) if (alias.includes(n) && !(k in posicion)) posicion[k] = c;
  }
  if (!('codigo' in posicion) || !('nombre' in posicion)) {
    throw solicitudInvalida('Faltan las columnas «código» y «nombre» en la primera fila.');
  }
  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (fila, n) => {
    if (n === 1) return;
    filas.push({
      _fila: n,
      codigo: String(valorCelda(fila.getCell(posicion.codigo).value) ?? '').replace(/\D/g, ''),
      nombre: txt(valorCelda(fila.getCell(posicion.nombre).value))?.slice(0, 300) || null,
    });
  });
  return filas;
}

// Importa el catálogo de clases UNSPSC desde Excel o CSV con código y nombre; es un catálogo nacional.
export async function importarUnspsc(usuario, archivo) {
  if (!usuario?.general) throw prohibido('Solo el Coordinador general y el Profesional de seguimiento cargan el catálogo UNSPSC.');
  if (!archivo) throw solicitudInvalida('Falta el archivo.');
  if (archivo.size > MAX_BYTES_UNSPSC) throw solicitudInvalida('El archivo pesa más de 10 MB.');
  const nombreArchivo = Buffer.from(archivo.originalname || '', 'latin1').toString('utf8');
  const bytes = await fs.readFile(archivo.path);
  await exigirContenido(bytes, nombreArchivo, ['.xlsx', '.csv']);
  const filas = await filasUnspsc(nombreArchivo, bytes);

  return conRegistro(
    usuario, { accion: 'catalogo.unspsc_importar', objeto: { tipo: 'catalogo_unspsc', id: nombreArchivo.slice(0, 100) } },
    () => transaccion(async (db) => {
      let creadas = 0;
      let actualizadas = 0;
      const errores = [];
      for (const f of filas) {
        if (!formatoUnspsc(f.codigo) || !f.nombre) {
          if (errores.length < 15) {
            errores.push({ fila: f._fila, motivo: !f.nombre ? 'La fila no tiene nombre.' : 'El código no tiene 6 dígitos (no es una clase).' });
          }
          continue;
        }
        const { rows: [r] } = await db.query(
          `INSERT INTO unspsc_clases (codigo, nombre) VALUES ($1, $2)
           ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, fecha_cargue = now()
           RETURNING (xmax = 0) AS creada`,
          [f.codigo, f.nombre],
        );
        if (r.creada) creadas += 1; else actualizadas += 1;
      }
      const omitidas = filas.length - creadas - actualizadas;
      return {
        ok: true,
        mensaje: `Catálogo UNSPSC importado: ${creadas} clases nuevas, ${actualizadas} actualizadas, ${omitidas} filas omitidas.`,
        creadas, actualizadas, omitidas, errores,
      };
    }),
    (r) => ({ creadas: r.creadas, actualizadas: r.actualizadas, omitidas: r.omitidas }),
  );
}
