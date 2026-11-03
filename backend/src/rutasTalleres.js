// Rutas de los talleres: listado, creación y edición de talleres y sus módulos, registro del módulo realizado
// con la asistencia y las evidencias, soportes adicionales, entrega final por unidad y contenidos publicados.
// Toda escritura queda en el registro de actividad.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { pool, query, transaccion } from './db.js';
import { COLUMNAS_UP, condicionAlcance, nodosEnAlcance, normTexto } from './alcance.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from './errores.js';
import { registrarEvento } from './acceso/sesiones.js';
import { grupoVisible, listarGrupos, rutasGrupos } from './talleresGrupos.js';
import { registrar } from './servicios/actividad.js';
import { contenidoValido, tipoPorNombre } from './servicios/tipoArchivo.js';
import { datosParticipantes, limpiarIntegrantes } from './servicios/talleresFormacion.js';
import { bloquesSesion, convocar, formacionDeTaller, rutasFormacion } from './rutasFormacion.js';
import { confirmacionesDeModulo, rutasConvocatoria } from './convocatoriaLlamadas.js';

// Registra en la actividad cada escritura de talleres, enlazada a la unidad cuando corresponde.
const actividad = (req, accion, objeto, cambios = {}, idUnico = null) => registrar(req.usuario, { accion, objeto, cambios, idUnico });

const router = Router();
const ESCRITORES = ['coordinador', 'tallerista'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 10, fieldSize: 100_000 } });
// Secciones de evidencias del módulo realizado: formatos permitidos, cuántos archivos se cargan de una vez y
// peso máximo.
export const EVIDENCIAS = {
  informe: { campo: 'informe', titulo: 'Informe del módulo', ext: ['.pdf', '.docx'], formatos: 'PDF o Word (.docx)', max: 1, mb: 25 },
  foto: { campo: 'fotos', titulo: 'Fotos del módulo', ext: ['.jpg', '.jpeg', '.png'], formatos: 'JPG o PNG', max: 10, mb: 20 },
  video: { campo: 'videos', titulo: 'Videos del módulo', ext: ['.mp4', '.mov', '.webm'], formatos: 'MP4, MOV o WEBM', max: 3, mb: 200 },
};
const MB_ASISTENCIA = 20;
const MB_MAXIMO = Math.max(MB_ASISTENCIA, ...Object.values(EVIDENCIAS).map((d) => d.mb));
const MAX_SOPORTES_MODULO = 40;
// Carga que recibe los archivos del módulo en un temporal en disco y los lee de a uno al guardarlos en la base,
// para no mantener varios videos pesados en memoria.
const uploadModulo = multer({ dest: path.join(os.tmpdir(), 'bitacora-talleres'), limits: { fileSize: MB_MAXIMO * 1024 * 1024, files: 20, fields: 10, fieldSize: 100_000 } });
const bytesDe = (f) => (f.buffer ? Promise.resolve(f.buffer) : fs.readFile(f.path));
const texto = (v) => typeof v === 'string' ? v.trim() : '';
const idValido = (v) => /^\d{1,9}$/.test(String(v || ''));
const esTallerista = (u) => u?.rol === 'tallerista';
// Indica si el usuario puede programar eventos, asignar docentes y administrar grupos.
const esCoordinacion = (u) => Boolean(u?.general) || u?.rol === 'coordinador';
const soloCoordinacion = (u, mensaje) => { if (!esCoordinacion(u)) throw prohibido(mensaje); };
const territorioCache = Symbol('territorioTalleres');

router.use(async (req, _res, next) => {
  if (!req.usuario?.general && !ESCRITORES.includes(req.usuario?.rol)) return next(prohibido('No tienes acceso a Talleres de fortalecimiento.'));
  try { req.usuario[territorioCache] = await territorio(req.usuario); next(); } catch (e) { next(e); }
});

async function territorio(u) {
  if (u[territorioCache]) return u[territorioCache];
  const permitidos = await nodosEnAlcance(u);
  const { rows } = await query(`SELECT upper(btrim(nodo)) AS nodo, btrim(region) AS region FROM triadas
    WHERE region IS NOT NULL AND region <> 'Por asignar' AND ($1::text[] IS NULL OR upper(btrim(nodo)) = ANY($1)) ORDER BY region, nodo`, [permitidos]);
  return rows;
}

// Calcula las combinaciones de departamento, nodo y municipio que existen entre las unidades del territorio,
// para los filtros.
async function territorioUps(u, nodos) {
  const params = [nodos];
  const alcance = condicionAlcance(u, COLUMNAS_UP, params);
  const { rows } = await query(`SELECT DISTINCT btrim(t.region) AS region, upper(btrim(t.nodo)) AS nodo,
      nullif(btrim(up.departamento), '') AS departamento, nullif(btrim(up.municipio), '') AS municipio
    FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada
    WHERE upper(btrim(t.nodo)) = ANY($1::text[]) AND ${alcance}
    ORDER BY 3, 2, 4`, params);
  return rows;
}
// Devuelve dónde están las unidades convocadas de cada taller, sin repetir, para filtrar por ese dato.
async function ubicacionesDe(talleres) {
  const ids = [...new Set(talleres.flatMap((t) => (t.participantes || []).map((p) => Number(p.id_up)).filter((id) => Number.isInteger(id) && id > 0)))];
  if (!ids.length) return talleres;
  const { rows } = await query(`SELECT up.id_up, nullif(btrim(up.departamento), '') AS departamento, upper(btrim(t.nodo)) AS nodo,
      nullif(btrim(up.municipio), '') AS municipio
    FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada WHERE up.id_up = ANY($1::int[])`, [ids]);
  const porUp = new Map(rows.map(({ id_up: id, ...r }) => [id, r]));
  return talleres.map((t) => {
    const unicas = new Map();
    for (const p of t.participantes || []) {
      const x = porUp.get(Number(p.id_up));
      if (x) unicas.set(`${x.departamento}|${x.nodo}|${x.municipio}`, x);
    }
    return { ...t, ubicaciones: [...unicas.values()] };
  });
}
async function tallerVisible(u, id, db = pool, bloquear = false) {
  if (!idValido(id)) throw noEncontrado('El taller no existe.');
  const { rows: [t] } = await db.query(`SELECT * FROM talleres_fortalecimiento WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`, [id]);
  const nodos = await territorio(u);
  if (!t || !nodos.some((n) => n.nodo === t.nodo && normTexto(n.region) === normTexto(t.region))
    || (esTallerista(u) && normTexto(t.region) !== normTexto(u.alcance?.region))) {
    throw noEncontrado('El taller no existe o está fuera de tu alcance.');
  }
  if (esTallerista(u) && t.entrega_final_sub !== u.sub && !(await db.query('SELECT 1 FROM talleres_encuentros WHERE taller_id = $1 AND tallerista_sub = $2', [t.id, u.sub])).rowCount) {
    throw noEncontrado('El taller no existe o está fuera de tu alcance.');
  }
  if (t.grupo_id) await grupoVisible(u, t.grupo_id, db);
  return t;
}

async function completar(talleres, db = pool, u = null) {
  if (!talleres.length) return [];
  const formacion = await Promise.all(talleres.map((t) => formacionDeTaller(db, t)));
  const ids = talleres.map((t) => t.id);
  const { rows: encuentros } = await db.query('SELECT * FROM talleres_encuentros WHERE taller_id = ANY($1::int[]) ORDER BY taller_id, modulo', [ids]);
  const { rows: soportes } = await db.query(`SELECT s.id, s.encuentro_id, s.nombre, s.mime, s.tipo, s.creado_por, s.creado_en FROM talleres_soportes s
    JOIN talleres_encuentros e ON e.id = s.encuentro_id WHERE e.taller_id = ANY($1::int[]) ORDER BY s.id`, [ids]);
  const { rows: finales } = await db.query('SELECT id, taller_id, id_up, nombre, creado_por, creado_en FROM talleres_entregas_finales WHERE taller_id = ANY($1::int[]) ORDER BY id', [ids]);
  const { rows: llamadas } = await db.query(`SELECT taller_id, id_up, modulo, inicio, estado, asistira, discapacidad, discapacidad_detalle
    FROM talleres_convocatoria_llamadas WHERE taller_id = ANY($1::int[]) AND estado <> 'cancelada' ORDER BY id DESC`, [ids]);
  return talleres.map((t, i) => {
    const todos = encuentros.filter((e) => e.taller_id === t.id);
    const mia = !esTallerista(u) || t.entrega_final_sub === u.sub;
    return { ...t, ...formacion[i], grupo_completo: todos.length === 3 && todos.every((e) => e.realizado_en), puede_entregar: mia,
      entregas_finales: mia ? finales.filter((f) => f.taller_id === t.id) : [],
      encuentros: todos.filter((e) => !esTallerista(u) || e.tallerista_sub === u.sub)
        .map((e) => ({ ...e, bloques: bloquesSesion(e.inicio), mio: !esTallerista(u) || e.tallerista_sub === u.sub, soportes: soportes.filter((s) => s.encuentro_id === e.id),
          confirmaciones: confirmacionesDeModulo(llamadas.filter((l) => l.taller_id === t.id), e.modulo, todos) })) };
  });
}

function campo(v, nombre, max, obligatorio = true) {
  const s = texto(v);
  if ((obligatorio && !s) || s.length > max) throw solicitudInvalida(`Revisa ${nombre} (máximo ${max} caracteres).`);
  return s;
}

function inicioValido(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) || !/(Z|[+-]\d{2}:\d{2})$/.test(v)
    || Number.isNaN(new Date(v).getTime()) || Number(v.slice(11, 13)) > 23) throw solicitudInvalida('Indica la fecha y hora de cada módulo, con su zona horaria.');
  const dia = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== v.slice(0, 10)) throw solicitudInvalida('La fecha del módulo no existe en el calendario.');
  return new Date(v).toISOString();
}

function programacion(datos) {
  if (!Array.isArray(datos) || datos.length !== 3) throw solicitudInvalida('Programa exactamente tres módulos de tres horas.');
  const fechas = [1, 2, 3].map((modulo) => {
    const e = datos.find((x) => x?.modulo === modulo);
    if (!e || (e.duracion_minutos !== undefined && e.duracion_minutos !== 180)) throw solicitudInvalida('Cada módulo dura tres horas (180 minutos).');
    const sub = texto(e.tallerista_sub);
    if (!/^coordinador:\d+$/.test(sub)) throw solicitudInvalida(`Asigna el Tallerista que dicta el módulo ${modulo}.`);
    return { modulo, inicio: inicioValido(e.inicio), tallerista_sub: sub };
  });
  for (let i = 1; i < fechas.length; i++) {
    if (new Date(fechas[i].inicio) - new Date(fechas[i - 1].inicio) < 180 * 60_000) throw solicitudInvalida('Los módulos deben seguir el orden 1, 2 y 3, sin superponerse.');
  }
  return fechas;
}

// Comprueba que cada docente esté activo y sea de la región del taller, y devuelve los encuentros con su
// nombre.
async function conDocentes(encuentros, region, db) {
  const { rows } = await db.query(`SELECT 'coordinador:' || id_coordinador AS sub, nombre, region FROM coordinadores
    WHERE tipo = 'tallerista' AND activo AND 'coordinador:' || id_coordinador = ANY($1::text[])`, [[...new Set(encuentros.map((e) => e.tallerista_sub))]]);
  return encuentros.map((e) => {
    const t = rows.find((x) => x.sub === e.tallerista_sub);
    if (!t || normTexto(t.region) !== normTexto(region)) throw solicitudInvalida(`El Tallerista del módulo ${e.modulo} debe estar activo y asignado a la región del taller.`);
    return { ...e, tallerista_nombre: t.nombre };
  });
}

async function datosTaller(req, db) {
  soloCoordinacion(req.usuario, 'Los eventos de fortalecimiento los programa la coordinación.');
  const d = req.body || {};
  const nodos = await territorio(req.usuario);
  const n = nodos.find((x) => x.nodo === texto(d.nodo).toUpperCase());
  if (!n) throw prohibido('Elige un nodo de tu región o territorio.');
  const grupo = await grupoVisible(req.usuario, d.grupo_id, db, true);
  if (normTexto(grupo.region) !== normTexto(n.region)) throw prohibido('El grupo y el lugar del taller deben pertenecer a la misma región.');
  const encuentros = await conDocentes(programacion(d.encuentros), n.region, db);
  return {
    nombre: campo(d.nombre, 'el nombre del grupo o taller', 150), nodo: n.nodo, region: n.region,
    municipio: campo(d.municipio, 'el municipio', 100), lugar: campo(d.lugar, 'el lugar', 200),
    tallerista_sub: encuentros[0].tallerista_sub, tallerista_nombre: encuentros[0].tallerista_nombre, grupo_id: grupo.id, grupo_nombre: grupo.nombre,
    entrega_final_sub: encuentros[2].tallerista_sub, entrega_final_nombre: encuentros[2].tallerista_nombre,
    participantes: grupo.ups.map((up) => ({ id_up: up.id_up, id_unico: up.id_unico, nombre: up.nombre,
      representante: up.representante, documento: up.documento, nodo: up.nodo })),
    encuentros,
  };
}

router.get('/', async (req, res) => {
  const nodos = await territorio(req.usuario);
  const regiones = [...new Set(nodos.map((n) => n.region))];
  const [talleres, personas, contenidos, grupos] = await Promise.all([
    query(`SELECT * FROM talleres_fortalecimiento WHERE nodo = ANY($1::text[])
      AND ($2::text IS NULL OR entrega_final_sub = $2 OR EXISTS (SELECT 1 FROM talleres_encuentros e WHERE e.taller_id = talleres_fortalecimiento.id AND e.tallerista_sub = $2))
      ORDER BY creado_en DESC, id DESC`, [nodos.map((n) => n.nodo), esTallerista(req.usuario) ? req.usuario.sub : null]),
    query("SELECT 'coordinador:' || id_coordinador AS sub, nombre, region FROM coordinadores WHERE tipo = 'tallerista' AND activo ORDER BY nombre"),
    query(`SELECT id, region, modulo, titulo, texto, enlace, adjunto_nombre, adjunto IS NOT NULL AS tiene_adjunto, publicado_por, actualizado_en,
      aprobado, aprobacion, acta_comite IS NOT NULL AS tiene_acta
      FROM talleres_contenidos WHERE region = ANY($1::text[]) AND (aprobado OR NOT $2) ORDER BY region, modulo`, [regiones, esTallerista(req.usuario)]),
    listarGrupos(req.usuario, regiones),
  ]);
  const propios = talleres.rows.filter((t) => (!t.grupo_id || grupos.some((g) => g.id === t.grupo_id))
    && nodos.some((n) => n.nodo === t.nodo && normTexto(n.region) === normTexto(t.region)));
  const general = Boolean(req.usuario?.general);
  const listos = await completar(propios, pool, req.usuario);
  res.json({ ok: true, talleres: general ? await ubicacionesDe(listos) : listos, nodos, regiones, grupos: esTallerista(req.usuario) ? [] : grupos,
    filtros_territorio: general, territorio_ups: general ? await territorioUps(req.usuario, nodos.map((n) => n.nodo)) : [],
    talleristas: personas.rows.filter((p) => regiones.some((r) => normTexto(r) === normTexto(p.region)) && (!esTallerista(req.usuario) || p.sub === req.usuario.sub)),
    contenidos: contenidos.rows, puede_publicar: esCoordinacion(req.usuario), puede_programar: esCoordinacion(req.usuario),
    puede_aprobar_contenidos: Boolean(req.usuario?.general),
    aviso: !nodos.length ? 'No tienes una región o territorio válido asignado. Solicita su asignación a la coordinación.' : '' });
});

rutasGrupos(router, territorio);

router.post('/', async (req, res) => {
  const item = await transaccion(async (db) => {
    const d = await datosTaller(req, db);
    const { rows: [t] } = await db.query(`INSERT INTO talleres_fortalecimiento
      (nombre, nodo, region, municipio, lugar, tallerista_sub, tallerista_nombre, participantes, creado_por, grupo_id, grupo_nombre, entrega_final_sub, entrega_final_nombre)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [d.nombre, d.nodo, d.region, d.municipio, d.lugar, d.tallerista_sub, d.tallerista_nombre, JSON.stringify(d.participantes), req.usuario.sub, d.grupo_id, d.grupo_nombre, d.entrega_final_sub, d.entrega_final_nombre]);
    for (const e of d.encuentros) await db.query('INSERT INTO talleres_encuentros (taller_id, modulo, inicio, tallerista_sub, tallerista_nombre) VALUES ($1,$2,$3,$4,$5)', [t.id, e.modulo, e.inicio, e.tallerista_sub, e.tallerista_nombre]);
    const correos = await convocar(db, t);
    return { ...(await completar([t], db, req.usuario))[0], correos_convocatoria: correos };
  });
  registrarEvento(req, 'taller_programado', { detalle: String(item.id) });
  await actividad(req, 'talleres.programar', { tipo: 'taller', id: item.id }, { nombre: item.nombre, correos: item.correos_convocatoria });
  res.json({ ok: true, item, mensaje: `Taller programado: tres módulos de tres horas. Convocatoria en la bandeja de salida: ${item.correos_convocatoria} correo(s).` });
});

router.put('/:id', async (req, res) => {
  soloCoordinacion(req.usuario, 'Los eventos de fortalecimiento los programa la coordinación.');
  const item = await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const { rowCount } = await db.query('SELECT 1 FROM talleres_encuentros WHERE taller_id = $1 AND realizado_en IS NOT NULL', [t.id]);
    if (rowCount) throw solicitudInvalida('El grupo ya tiene asistencia registrada. Puedes reprogramar sus módulos pendientes sin cambiar la lista de participantes.');
    const d = await datosTaller(req, db);
    const { rows: antes } = await db.query('SELECT modulo, inicio FROM talleres_encuentros WHERE taller_id = $1', [t.id]);
    const { rows: [actual] } = await db.query(`UPDATE talleres_fortalecimiento SET nombre=$2,nodo=$3,region=$4,municipio=$5,lugar=$6,
      tallerista_sub=$7,tallerista_nombre=$8,participantes=$9,grupo_id=$10,grupo_nombre=$11,entrega_final_sub=$12,entrega_final_nombre=$13,actualizado_en=now() WHERE id=$1 RETURNING *`,
    [t.id, d.nombre, d.nodo, d.region, d.municipio, d.lugar, d.tallerista_sub, d.tallerista_nombre, JSON.stringify(d.participantes), d.grupo_id, d.grupo_nombre, d.entrega_final_sub, d.entrega_final_nombre]);
    for (const e of d.encuentros) await db.query('UPDATE talleres_encuentros SET inicio=$3, tallerista_sub=$4, tallerista_nombre=$5 WHERE taller_id=$1 AND modulo=$2', [t.id, e.modulo, e.inicio, e.tallerista_sub, e.tallerista_nombre]);
    const ids = (x) => (x || []).map((p) => p.id_up ?? p.documento).map(String).sort().join(',');
    const cambioFechas = d.encuentros.some((e) => new Date(antes.find((a) => a.modulo === e.modulo)?.inicio || 0).toISOString() !== new Date(e.inicio).toISOString());
    const correos = cambioFechas || ids(t.participantes) !== ids(d.participantes) || t.lugar !== d.lugar || t.municipio !== d.municipio || t.nombre !== d.nombre ? await convocar(db, actual) : null;
    return { ...(await completar([actual], db, req.usuario))[0], correos_convocatoria: correos };
  });
  registrarEvento(req, 'taller_actualizado', { detalle: String(item.id) });
  await actividad(req, 'talleres.actualizar', { tipo: 'taller', id: item.id }, { nombre: item.nombre, correos: item.correos_convocatoria });
  res.json({ ok: true, item, mensaje: item.correos_convocatoria === null ? 'Programación y grupo actualizados.'
    : `Programación y grupo actualizados. Convocatoria reprogramada en la bandeja de salida: ${item.correos_convocatoria} correo(s).` });
});

router.put('/:id/encuentros/:modulo', async (req, res) => {
  soloCoordinacion(req.usuario, 'Los eventos de fortalecimiento los reprograma la coordinación.');
  const r = await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const { rows } = await db.query('SELECT * FROM talleres_encuentros WHERE taller_id=$1 ORDER BY modulo', [t.id]);
    const e = rows.find((x) => String(x.modulo) === req.params.modulo);
    if (!e || e.realizado_en) throw solicitudInvalida('Solo se pueden reprogramar módulos pendientes.');
    const inicio = req.body?.inicio === undefined ? new Date(e.inicio).toISOString() : inicioValido(req.body.inicio);
    const docente = req.body?.tallerista_sub === undefined ? e.tallerista_sub : texto(req.body.tallerista_sub);
    programacion(rows.map((x) => ({ modulo: x.modulo, tallerista_sub: x.id === e.id ? docente : x.tallerista_sub, inicio: x.id === e.id ? inicio : new Date(x.inicio).toISOString() })));
    const [asignado] = await conDocentes([{ modulo: e.modulo, tallerista_sub: docente }], t.region, db);
    await db.query('UPDATE talleres_encuentros SET inicio=$2, tallerista_sub=$3, tallerista_nombre=$4 WHERE id=$1', [e.id, inicio, asignado.tallerista_sub, asignado.tallerista_nombre]);
    if (e.modulo === 3 && t.entrega_final_sub === e.tallerista_sub) await db.query('UPDATE talleres_fortalecimiento SET entrega_final_sub=$2, entrega_final_nombre=$3 WHERE id=$1', [t.id, asignado.tallerista_sub, asignado.tallerista_nombre]);
    await db.query('UPDATE talleres_fortalecimiento SET actualizado_en=now() WHERE id=$1', [t.id]);
    const cambioFecha = inicio !== new Date(e.inicio).toISOString();
    return { taller: t.id, modulo: e.modulo, correos: cambioFecha ? await convocar(db, t) : null };
  });
  await actividad(req, 'talleres.reprogramar', { tipo: 'encuentro', id: `${r.taller}:${r.modulo}` }, { correos: r.correos });
  res.json({ ok: true, mensaje: r.correos === null ? 'Módulo actualizado.' : 'Módulo reprogramado y convocatoria actualizada en la bandeja de salida.' });
});

function archivoValido(f, soloPdf = false) {
  if (!f?.buffer?.length) throw solicitudInvalida('Adjunta un soporte válido.');
  const b = f.buffer;
  if (/\.pdf$/i.test(f.originalname) && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (!soloPdf && /\.png$/i.test(f.originalname) && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (!soloPdf && /\.jpe?g$/i.test(f.originalname) && b.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
  throw solicitudInvalida(soloPdf ? 'El material adjunto debe ser un PDF válido.' : 'Los soportes deben ser PDF, JPG o PNG válidos.');
}
const nombreArchivo = (f) => f.originalname.replace(/[\r\n\\/]/g, '_').slice(0, 200);
const cargar = (middleware) => (req, res, next) => {
  res.on('close', () => {
    const lista = Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
    for (const f of [...lista, req.file]) if (f?.path) fs.unlink(f.path).catch(() => {});
  });
  middleware(req, res, (e) => {
    if (e?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, error: `Archivo demasiado pesado. Máximos: informe ${EVIDENCIAS.informe.mb} MB, fotos y asistencia ${EVIDENCIAS.foto.mb} MB, videos ${EVIDENCIAS.video.mb} MB.` });
    }
    if (e?.code === 'LIMIT_UNEXPECTED_FILE' || e?.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ ok: false, error: 'Revisa la cantidad de archivos: informe 1, fotos hasta 10 y videos hasta 3 por vez.' });
    }
    next(e);
  });
};
// Valida los archivos de una sección de evidencias por extensión, contenido y peso, y devuelve sus tipos MIME.
async function evidencias(tipo, archivos) {
  const d = EVIDENCIAS[tipo];
  if (!archivos?.length) {
    throw solicitudInvalida(`${d.titulo}: es obligatorio. Adjunta ${d.max === 1 ? 'el archivo' : `de 1 a ${d.max} archivos`} en ${d.formatos}.`);
  }
  if (archivos.length > d.max) throw solicitudInvalida(`${d.titulo}: máximo ${d.max} archivo(s) por vez.`);
  const mimes = [];
  for (const f of archivos) {
    const ext = (f.originalname.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    if (!d.ext.includes(ext) || !f.size || !(await contenidoValido(f.buffer || f.path, f.originalname, d.ext))) {
      throw solicitudInvalida(`${d.titulo}: «${nombreArchivo(f)}» no es un archivo ${d.formatos} válido.`);
    }
    if (f.size > d.mb * 1024 * 1024) throw new HttpError(413, `${d.titulo}: «${nombreArchivo(f)}» supera los ${d.mb} MB.`);
    mimes.push(tipoPorNombre(f.originalname).mime);
  }
  return mimes;
}
const archivosDe = (req, campo) => req.files?.[campo] || [];

const camposModulo = [{ name: 'soportes', maxCount: 5 }, ...Object.values(EVIDENCIAS).map((d) => ({ name: d.campo, maxCount: d.max }))];
// Registra el módulo realizado: la asistencia firmada, la asistencia por unidad y las tres secciones de
// evidencias, todas obligatorias.
router.post('/:id/encuentros/:modulo/realizar', cargar(uploadModulo.fields(camposModulo)), async (req, res) => {
  const planillas = archivosDe(req, 'soportes');
  if (!planillas.length) throw solicitudInvalida('Adjunta la asistencia firmada en físico (PDF, JPG o PNG).');
  if (planillas.some((f) => f.size > MB_ASISTENCIA * 1024 * 1024)) throw new HttpError(413, `La asistencia firmada admite un máximo de ${MB_ASISTENCIA} MB por archivo.`);
  for (const f of planillas) f.buffer = await fs.readFile(f.path);
  const mimes = planillas.map((f) => archivoValido(f));
  const evidenciasModulo = [];
  for (const [tipo, d] of Object.entries(EVIDENCIAS)) {
    const archivos = archivosDe(req, d.campo);
    const tipos = await evidencias(tipo, archivos);
    archivos.forEach((f, i) => evidenciasModulo.push({ tipo, f, mime: tipos[i] }));
  }
  let asistencia;
  try { asistencia = JSON.parse(req.body?.asistencia); } catch { throw solicitudInvalida('La asistencia no es válida.'); }
  if (!Array.isArray(asistencia) || !asistencia.length || asistencia.length > 40 || new Set(asistencia).size !== asistencia.length) throw solicitudInvalida('Marca entre 1 y 40 asistentes, sin repetir personas.');
  const observaciones = campo(req.body?.observaciones, 'las observaciones', 2000, false);
  const evaluacion = campo(req.body?.evaluacion, 'la actividad de evaluación de la tercera hora', 2000, false);
  let integrantesEntrada = {};
  if (req.body?.integrantes !== undefined) {
    try { integrantesEntrada = JSON.parse(req.body.integrantes); } catch { throw solicitudInvalida('La asistencia por integrante no es válida.'); }
  }
  const resultado = await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const { rows: [e] } = await db.query('SELECT * FROM talleres_encuentros WHERE taller_id=$1 AND modulo=$2 FOR UPDATE', [t.id, idValido(req.params.modulo) ? req.params.modulo : null]);
    if (!e) throw noEncontrado('El módulo no existe.');
    if (esTallerista(req.usuario) && e.tallerista_sub !== req.usuario.sub) throw prohibido('Este módulo lo dicta otro Tallerista.');
    if (e.realizado_en) throw solicitudInvalida('Este módulo ya tiene su asistencia y soportes registrados.');
    if (!evaluacion) throw solicitudInvalida('Describe la actividad de evaluación de la tercera hora de la sesión.');
    if (new Date(e.inicio).getTime() + 180 * 60_000 > Date.now()) throw solicitudInvalida('Registra el taller realizado después de terminar las tres horas del módulo.');
    if (asistencia.some((doc) => typeof doc !== 'string' || !t.participantes.some((p) => (p.id_up ? `up:${p.id_up}` : p.documento) === doc))) throw solicitudInvalida('La asistencia solo puede incluir UP de este grupo.');
    if (e.modalidad === 'VIRTUAL' && !e.aprobacion_virtual) throw solicitudInvalida('La sesión es virtual: falta la aprobación de la interventoría (la registra la coordinación).');
    const integrantes = limpiarIntegrantes(integrantesEntrada, asistencia, await datosParticipantes(db, t));
    await db.query('UPDATE talleres_encuentros SET asistencia=$2,observaciones=$3,realizado_en=now(),registrado_por=$4,asistencia_integrantes=$5,evaluacion_descripcion=$6 WHERE id=$1',
      [e.id, JSON.stringify(asistencia), observaciones, req.usuario.sub, JSON.stringify(integrantes), evaluacion]);
    for (let i = 0; i < planillas.length; i++) await db.query("INSERT INTO talleres_soportes (encuentro_id,nombre,mime,archivo,creado_por,tipo) VALUES ($1,$2,$3,$4,$5,'asistencia')", [e.id, nombreArchivo(planillas[i]), mimes[i], planillas[i].buffer, req.usuario.sub]);
    for (const x of evidenciasModulo) await db.query('INSERT INTO talleres_soportes (encuentro_id,nombre,mime,archivo,creado_por,tipo) VALUES ($1,$2,$3,$4,$5,$6)', [e.id, nombreArchivo(x.f), x.mime, await bytesDe(x.f), req.usuario.sub, x.tipo]);
    await db.query('UPDATE talleres_fortalecimiento SET actualizado_en=now() WHERE id=$1', [t.id]);
    return { asistentes: asistencia.length };
  });
  registrarEvento(req, 'taller_realizado', { detalle: `${req.params.id}: módulo ${req.params.modulo}` });
  await actividad(req, 'talleres.realizar', { tipo: 'encuentro', id: `${req.params.id}:${req.params.modulo}` }, {
    asistentes: resultado.asistentes, informe: archivosDe(req, 'informe').length, fotos: archivosDe(req, 'fotos').length, videos: archivosDe(req, 'videos').length,
  });
  res.json({ ok: true, mensaje: 'Asistencia, informe, fotos y videos registrados.' });
});

router.get('/soportes/:sid', async (req, res) => {
  if (!idValido(req.params.sid)) throw noEncontrado('El soporte no existe.');
  const { rows: [s] } = await query(`SELECT s.*, e.taller_id, e.tallerista_sub FROM talleres_soportes s JOIN talleres_encuentros e ON e.id=s.encuentro_id WHERE s.id=$1`, [req.params.sid]);
  if (!s) throw noEncontrado('El soporte no existe.');
  await tallerVisible(req.usuario, s.taller_id);
  if (esTallerista(req.usuario) && s.tallerista_sub !== req.usuario.sub) throw noEncontrado('El soporte no existe.');
  res.attachment(s.nombre).type(s.mime).send(s.archivo);
});

// Agrega más evidencias a un módulo en cualquier momento, por sección: informe, foto o video.
router.post('/:id/encuentros/:modulo/soportes', cargar(uploadModulo.array('soportes', 10)), async (req, res) => {
  const tipo = texto(req.body?.tipo);
  if (!Object.hasOwn(EVIDENCIAS, tipo)) throw solicitudInvalida('Elige la sección: informe, fotos o videos.');
  const mimes = await evidencias(tipo, req.files);
  await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const { rows: [e] } = await db.query('SELECT * FROM talleres_encuentros WHERE taller_id=$1 AND modulo=$2 FOR UPDATE', [t.id, idValido(req.params.modulo) ? req.params.modulo : null]);
    if (!e) throw noEncontrado('El módulo no existe.');
    if (esTallerista(req.usuario) && e.tallerista_sub !== req.usuario.sub) throw prohibido('Este módulo lo dicta otro Tallerista.');
    if (!e.realizado_en) throw solicitudInvalida('El informe, las fotos y los videos se cargan al registrar el módulo realizado.');
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM talleres_soportes WHERE encuentro_id=$1', [e.id]);
    if (n + req.files.length > MAX_SOPORTES_MODULO) throw solicitudInvalida(`Un módulo admite hasta ${MAX_SOPORTES_MODULO} archivos.`);
    for (let i = 0; i < req.files.length; i++) await db.query('INSERT INTO talleres_soportes (encuentro_id,nombre,mime,archivo,creado_por,tipo) VALUES ($1,$2,$3,$4,$5,$6)', [e.id, nombreArchivo(req.files[i]), mimes[i], await bytesDe(req.files[i]), req.usuario.sub, tipo]);
    await db.query('UPDATE talleres_fortalecimiento SET actualizado_en=now() WHERE id=$1', [t.id]);
  });
  registrarEvento(req, 'taller_soporte_anexado', { detalle: `${req.params.id}: módulo ${req.params.modulo}` });
  await actividad(req, 'talleres.soporte_anexar', { tipo: 'encuentro', id: `${req.params.id}:${req.params.modulo}` }, { seccion: tipo, archivos: req.files.length });
  res.json({ ok: true, mensaje: 'Archivos anexados al módulo.' });
});

router.delete('/soportes/:sid', async (req, res) => {
  soloCoordinacion(req.usuario, 'Solo la coordinación puede quitar archivos de un módulo.');
  if (!idValido(req.params.sid)) throw noEncontrado('El soporte no existe.');
  await transaccion(async (db) => {
    const { rows: [s] } = await db.query('SELECT s.id, s.tipo, s.encuentro_id, e.taller_id, e.realizado_en FROM talleres_soportes s JOIN talleres_encuentros e ON e.id=s.encuentro_id WHERE s.id=$1 FOR UPDATE OF s, e', [req.params.sid]);
    if (!s) throw noEncontrado('El soporte no existe.');
    await tallerVisible(req.usuario, s.taller_id, db);
    if (s.tipo === 'aprobacion_virtual') throw new HttpError(409, 'El soporte de la aprobación de la interventoría no se quita: queda en el registro de la sesión.');
    if (s.realizado_en && (s.tipo === 'asistencia' || Object.hasOwn(EVIDENCIAS, s.tipo))) {
      const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM talleres_soportes WHERE encuentro_id=$1 AND tipo=$2', [s.encuentro_id, s.tipo]);
      if (n <= 1) throw new HttpError(409, 'Es el único archivo de esa sección y es obligatoria: anexa el que lo reemplaza antes de quitarlo.');
    }
    await db.query('DELETE FROM talleres_soportes WHERE id=$1', [s.id]);
  });
  registrarEvento(req, 'taller_soporte_quitado', { detalle: req.params.sid });
  await actividad(req, 'talleres.soporte_quitar', { tipo: 'soporte', id: req.params.sid });
  res.json({ ok: true, mensaje: 'Archivo quitado.' });
});

// Carga la entrega final de una unidad en PDF cuando su grupo termina los tres encuentros.
router.post('/:id/entregas-finales/:idup', cargar(upload.single('archivo')), async (req, res) => {
  if (!req.file) throw solicitudInvalida('Adjunta el PDF de la entrega final.');
  archivoValido(req.file, true);
  if (!idValido(req.params.idup)) throw noEncontrado('Esa UP no pertenece al grupo.');
  const idUp = Number(req.params.idup);
  const { idUnico, reemplazo } = await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const { rows: encuentros } = await db.query('SELECT realizado_en FROM talleres_encuentros WHERE taller_id=$1', [t.id]);
    if (encuentros.length !== 3 || encuentros.some((e) => !e.realizado_en)) throw solicitudInvalida('La entrega final se carga cuando el grupo termina sus tres módulos.');
    if (!t.participantes.some((p) => p.id_up === idUp)) throw noEncontrado('Esa UP no pertenece al grupo.');
    if (esTallerista(req.usuario) && t.entrega_final_sub !== req.usuario.sub) throw prohibido('La entrega final la carga el docente asignado a este grupo.');
    const { rowCount } = await db.query('SELECT 1 FROM talleres_entregas_finales WHERE taller_id=$1 AND id_up=$2', [t.id, idUp]);
    if (rowCount && !esCoordinacion(req.usuario)) throw solicitudInvalida('Esta UP ya tiene su entrega final. La coordinación puede reemplazarla.');
    await db.query(`INSERT INTO talleres_entregas_finales (taller_id,id_up,nombre,archivo,creado_por) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (taller_id,id_up) DO UPDATE SET nombre=EXCLUDED.nombre,archivo=EXCLUDED.archivo,creado_por=EXCLUDED.creado_por,creado_en=now()`,
    [t.id, idUp, nombreArchivo(req.file), req.file.buffer, req.usuario.sub]);
    await db.query('UPDATE talleres_fortalecimiento SET actualizado_en=now() WHERE id=$1', [t.id]);
    const { rows: [up] } = await db.query('SELECT id_unico FROM unidades_productivas WHERE id_up=$1', [idUp]);
    return { idUnico: up?.id_unico ?? null, reemplazo: rowCount > 0 };
  });
  registrarEvento(req, 'taller_entrega_final', { detalle: `${req.params.id}: UP ${idUp}` });
  await actividad(req, 'talleres.entrega_final', { tipo: 'taller', id: req.params.id }, { id_up: idUp, reemplazo, archivo: nombreArchivo(req.file) }, idUnico);
  res.json({ ok: true, mensaje: 'Entrega final registrada.' });
});

// Reasigna al docente que carga las entregas finales de un taller.
router.put('/:id/entrega-final-docente', async (req, res) => {
  soloCoordinacion(req.usuario, 'Solo la coordinación asigna al docente de la entrega final.');
  const item = await transaccion(async (db) => {
    const t = await tallerVisible(req.usuario, req.params.id, db, true);
    const [docente] = await conDocentes([{ modulo: 3, tallerista_sub: texto(req.body?.tallerista_sub) }], t.region, db);
    const { rows: [actual] } = await db.query('UPDATE talleres_fortalecimiento SET entrega_final_sub=$2, entrega_final_nombre=$3, actualizado_en=now() WHERE id=$1 RETURNING *',
      [t.id, docente.tallerista_sub, docente.tallerista_nombre]);
    return (await completar([actual], db, req.usuario))[0];
  });
  registrarEvento(req, 'taller_entrega_final_docente', { detalle: `${req.params.id}: ${item.entrega_final_sub}` });
  await actividad(req, 'talleres.docente_entrega_final', { tipo: 'taller', id: item.id }, { tallerista: item.entrega_final_nombre });
  res.json({ ok: true, item, mensaje: 'Docente de la entrega final asignado.' });
});

router.get('/entregas-finales/:eid', async (req, res) => {
  if (!idValido(req.params.eid)) throw noEncontrado('La entrega final no existe.');
  const { rows: [f] } = await query('SELECT * FROM talleres_entregas_finales WHERE id=$1', [req.params.eid]);
  if (!f) throw noEncontrado('La entrega final no existe.');
  const t = await tallerVisible(req.usuario, f.taller_id);
  if (esTallerista(req.usuario) && t.entrega_final_sub !== req.usuario.sub) throw noEncontrado('La entrega final no existe.');
  res.attachment(f.nombre).type('application/pdf').send(f.archivo);
});

router.put('/contenidos/publicar', cargar(upload.single('archivo')), async (req, res) => {
  if (esTallerista(req.usuario)) throw prohibido('Los contenidos los publica la coordinación.');
  const regiones = [...new Set((await territorio(req.usuario)).map((n) => n.region))];
  const region = regiones.find((r) => normTexto(r) === normTexto(req.body?.region));
  if (!region) throw prohibido('Esa región está fuera de tu alcance.');
  const modulo = Number(req.body?.modulo);
  if (![1,2,3].includes(modulo)) throw solicitudInvalida('Elige el módulo 1, 2 o 3.');
  const titulo = campo(req.body?.titulo, 'el título', 150);
  const contenido = campo(req.body?.texto, 'el contenido', 20_000, false);
  const enlace = campo(req.body?.enlace, 'el enlace', 2000, false);
  if (enlace) {
    let url;
    try { url = new URL(enlace); } catch { throw solicitudInvalida('El enlace no es válido.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw solicitudInvalida('Usa un enlace HTTP o HTTPS.');
  }
  if (req.file) archivoValido(req.file, true);
  const { rows: [previo] } = await query('SELECT adjunto IS NOT NULL AS adjunto FROM talleres_contenidos WHERE region=$1 AND modulo=$2', [region, modulo]);
  if (!contenido && !enlace && !req.file && !previo?.adjunto) throw solicitudInvalida('Incluye contenido, un enlace o un PDF para el módulo.');
  await query(`INSERT INTO talleres_contenidos (region,modulo,titulo,texto,enlace,adjunto,adjunto_nombre,publicado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (region,modulo) DO UPDATE SET titulo=EXCLUDED.titulo,texto=EXCLUDED.texto,enlace=EXCLUDED.enlace,
    adjunto=COALESCE(EXCLUDED.adjunto,talleres_contenidos.adjunto),adjunto_nombre=COALESCE(EXCLUDED.adjunto_nombre,talleres_contenidos.adjunto_nombre),
    publicado_por=EXCLUDED.publicado_por,actualizado_en=now(),aprobado=FALSE,aprobacion=NULL,acta_comite=NULL,acta_comite_nombre=NULL`, [region, modulo, titulo, contenido, enlace, req.file?.buffer || null, req.file ? nombreArchivo(req.file) : null, req.usuario.nombre]);
  registrarEvento(req, 'taller_contenido_publicado', { detalle: `${region}: módulo ${modulo}` });
  await actividad(req, 'talleres.contenido_publicar', { tipo: 'contenido', id: `${region}:${modulo}` }, { titulo });
  res.json({ ok: true, mensaje: 'Contenido guardado: queda pendiente de la aprobación del Comité Técnico para que lo vean los Talleristas.' });
});

router.get('/contenidos/:cid/archivo', async (req, res) => {
  if (!idValido(req.params.cid)) throw noEncontrado('El contenido no existe.');
  const { rows: [c] } = await query('SELECT region,adjunto,adjunto_nombre,aprobado FROM talleres_contenidos WHERE id=$1', [req.params.cid]);
  if (!c || !(await territorio(req.usuario)).some((n) => normTexto(n.region) === normTexto(c.region)) || !c.adjunto) throw noEncontrado('El contenido no existe o está fuera de tu región.');
  if (esTallerista(req.usuario) && !c.aprobado) throw noEncontrado('El contenido todavía no está aprobado por el Comité Técnico.');
  res.attachment(c.adjunto_nombre).type('application/pdf').send(c.adjunto);
});

rutasFormacion(router, { tallerVisible, territorio, esTallerista, esCoordinacion, soloCoordinacion, archivoValido, nombreArchivo, cargar, upload });
rutasConvocatoria(router, { tallerVisible, soloCoordinacion });

export default router;
