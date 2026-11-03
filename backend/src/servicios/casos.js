// Casos de éxito, buenas prácticas y lecciones aprendidas por unidad, con tipo, título, descripción,
// resultados, fecha, fotos y un documento opcional. Los registra quien atiende la unidad y el nivel nacional
// los marca como documentados para el reporte.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, esGestor, txt } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { contenidoValido } from './tipoArchivo.js';
import { registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { exigirTamano } from './alistamiento.js';

export const TIPOS_CASO = { exito: 'Caso de éxito', buena_practica: 'Buena práctica', leccion: 'Lección aprendida' };
const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.GESTOR, ROLES.COMPRAS];
const MAX_ID = 2147483647;
const MAX_FOTOS = 10;
const nombreOriginal = (a) => Buffer.from(a?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 300);

function exigirLector(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta los casos de éxito.');
}
function exigirEditor(usuario) {
  if (![ROLES.GESTOR, ROLES.COORDINADOR].includes(usuario?.rol)) throw prohibido('Los casos de éxito los registran el gestor y la coordinación.');
}
async function adjunto(archivo, clase, permitidas, que) {
  exigirTamano(archivo, clase === 'documento', que);
  const nombre = nombreOriginal(archivo);
  if (!permitidas.includes(path.extname(nombre).toLowerCase()) || !(await contenidoValido(archivo.path, nombre, permitidas))) {
    throw solicitudInvalida(`${que} debe ser ${clase === 'documento' ? 'un PDF' : 'una imagen JPG o PNG'} válido.`);
  }
  const ext = path.extname(nombre).toLowerCase();
  return { clase, nombre, tipo: ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg', contenido: await fs.readFile(archivo.path) };
}

// Registra un caso con sus fotos y su documento adjunto.
export async function registrarCaso(usuario, campos = {}, archivos = {}) {
  exigirEditor(usuario);
  const up = await buscarUP({ idUnico: txt(campos.id_unico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  const tipo = txt(campos.tipo);
  if (!TIPOS_CASO[tipo]) throw solicitudInvalida('Elige el tipo: caso de éxito, buena práctica o lección aprendida.');
  const titulo = txt(campos.titulo)?.slice(0, 300);
  if (!titulo) throw solicitudInvalida('Escribe el título.');
  const descripcion = txt(campos.descripcion)?.slice(0, 5000);
  if (!descripcion) throw solicitudInvalida('Escribe la descripción.');
  const resultados = txt(campos.resultados)?.slice(0, 5000) || null;
  const fecha = String(campos.fecha || '').slice(0, 10);
  if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < '2000-01-01') throw solicitudInvalida('La fecha no es válida (no puede ser futura).');
  const fotos = Array.isArray(archivos?.fotos) ? archivos.fotos : [];
  if (fotos.length > MAX_FOTOS) throw solicitudInvalida(`Se admiten máximo ${MAX_FOTOS} fotos.`);
  const adjuntos = [];
  for (const f of fotos) adjuntos.push(await adjunto(f, 'foto', ['.jpg', '.jpeg', '.png'], 'Cada foto'));
  const doc = (Array.isArray(archivos?.documento) ? archivos.documento[0] : null) || null;
  if (doc) adjuntos.push(await adjunto(doc, 'documento', ['.pdf'], 'El documento'));
  const id = await transaccion(async (db) => {
    const { rows: [c] } = await db.query(
      `INSERT INTO casos_exito (id_up, id_unico, tipo, titulo, descripcion, resultados, fecha, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [up.id_up, up.id_unico, tipo, titulo, descripcion, resultados, fecha, usuario.nombre || usuario.sub]);
    for (const a of adjuntos) {
      await db.query('INSERT INTO casos_exito_adjuntos (caso_id, clase, nombre, tipo, contenido) VALUES ($1, $2, $3, $4, $5)', [c.id, a.clase, a.nombre, a.tipo, a.contenido]);
    }
    return c.id;
  });
  await registrar(usuario, { accion: 'caso.registrar', objeto: { tipo: 'caso_exito', id }, idUnico: up.id_unico, cambios: { tipo: TIPOS_CASO[tipo], titulo, adjuntos: adjuntos.length } });
  return { ok: true, item: { id, id_unico: up.id_unico, tipo, titulo, adjuntos: adjuntos.length } };
}

const SQL_CASOS = `SELECT c.id, c.id_unico, c.tipo, c.titulo, c.descripcion, c.resultados, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.documentado,
            c.documentado_por, c.documentado_en, c.registrado_por, c.creado_en, up.nombre AS unidad, up.modalidad, up.departamento, up.municipio, t.nodo, t.region,
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'clase', a.clase, 'nombre', a.nombre, 'tipo', a.tipo) ORDER BY a.clase, a.id)
                        FROM casos_exito_adjuntos a WHERE a.caso_id = c.id), '[]') AS adjuntos
       FROM casos_exito c JOIN unidades_productivas up ON up.id_up = c.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada`;

// Lista los casos del alcance, filtrables por tipo y por si están documentados.
export async function listarCasos(usuario, { tipo, documentado } = {}) {
  exigirLector(usuario);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(TIPOS_CASO[txt(tipo)] ? txt(tipo) : null);
  params.push(['si', 'no'].includes(txt(documentado)) ? txt(documentado) === 'si' : null);
  const { rows } = await query(
    `${SQL_CASOS} WHERE (${alcance}) AND ($${params.length - 1}::text IS NULL OR c.tipo = $${params.length - 1})
       AND ($${params.length}::boolean IS NULL OR c.documentado = $${params.length})
      ORDER BY c.fecha DESC, c.id DESC LIMIT 500`, params);
  return { ok: true, items: rows.map((c) => ({ ...c, nombre_tipo: TIPOS_CASO[c.tipo] })), tipos: TIPOS_CASO, puede_documentar: Boolean(usuario.general),
    puede_registrar: [ROLES.GESTOR, ROLES.COORDINADOR].includes(usuario.rol) };
}

// Marca el caso como documentado para el reporte, una sola vez.
export async function documentarCaso(usuario, { id } = {}) {
  if (!usuario?.general) throw prohibido('Los casos los marca como documentados el Coordinador general o el Profesional de seguimiento.');
  const cid = entero(id);
  if (!cid || cid < 1 || cid > MAX_ID) throw noEncontrado('El caso no existe.');
  const quien = usuario.nombre || usuario.sub;
  const caso = await transaccion(async (db) => {
    const { rows: [c] } = await db.query('SELECT id, id_unico, documentado, titulo FROM casos_exito WHERE id = $1 FOR UPDATE', [cid]);
    if (!c) throw noEncontrado('El caso no existe.');
    if (c.documentado) throw new HttpError(409, 'El caso ya está documentado.');
    await db.query('UPDATE casos_exito SET documentado = TRUE, documentado_por = $2, documentado_en = now() WHERE id = $1', [cid, quien]);
    return c;
  });
  await registrar(usuario, { accion: 'caso.documentar', objeto: { tipo: 'caso_exito', id: cid }, idUnico: caso.id_unico, cambios: { titulo: caso.titulo, campos: { documentado: [false, true] } } });
  return { ok: true, item: { id: cid, documentado: true, documentado_por: quien } };
}

// Devuelve una foto o el documento de un caso del alcance, con su contenido, nombre y tipo.
export async function adjuntoCaso(usuario, { id } = {}) {
  exigirLector(usuario);
  const aid = entero(id);
  if (!aid || aid < 1 || aid > MAX_ID) throw noEncontrado('El adjunto no existe.');
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(aid);
  const { rows: [a] } = await query(
    `SELECT a.contenido, a.nombre, a.tipo FROM casos_exito_adjuntos a JOIN casos_exito c ON c.id = a.caso_id
       JOIN unidades_productivas up ON up.id_up = c.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND a.id = $${params.length}`, params);
  if (!a) throw noEncontrado('El adjunto no existe.');
  return { buffer: a.contenido, nombre: a.nombre, tipo: a.tipo };
}

export const esGestorDe = esGestor;
