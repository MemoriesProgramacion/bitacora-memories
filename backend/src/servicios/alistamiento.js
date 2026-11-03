// Alistamiento y cierre: carga de las cuentas de campo, con un tope de 50 unidades habilitadas por cuenta, y
// eventos del equipo (transferencia metodológica y cierres por departamento) con sus soportes y asistentes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { ROLES, config } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { COLUMNAS_UP, alcanceDe, condicionAlcance, exigirAlcance, nodosEnAlcance, normTexto } from '../alcance.js';
import { contenidoValido } from './tipoArchivo.js';
import { registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { fechaReal, hoyColombia } from './secciones.js';

export const TOPE_UP_GESTOR = 50;
export const TIPOS_EVENTO = { transferencia: 'Transferencia metodológica', kit_gestor: 'Entrega de kit al gestor', cierre: 'Evento de cierre por departamento' };
const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO];
const MAX_ID = 2147483647;
const MAX_FOTOS = 20;
const IMAGENES = ['.jpg', '.jpeg', '.png'];
const quienEs = (u) => u.nombre || u.sub || 'sistema';
// Recupera el nombre UTF-8 original de un archivo, que multer entrega en latin1.
const nombreOriginal = (a) => Buffer.from(a?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 300);
const unidadesHabilitadas = "up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE";

function exigirLector(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta el alistamiento.');
}
function exigirCoordinacion(usuario, que = 'Esto lo registra la coordinación.') {
  if (usuario?.rol !== ROLES.COORDINADOR) throw prohibido(que);
}
const exigirGeneral = (u) => { if (!u?.general) throw prohibido('La transferencia metodológica la registra el Coordinador general o el Profesional de seguimiento.'); };

function fechaValida(f, que) {
  const x = String(f || '').slice(0, 10);
  if (!fechaReal(x) || x > hoyColombia() || x < '2000-01-01') throw solicitudInvalida(`La fecha ${que} no es válida (no puede ser futura).`);
  return x;
}

export const MAX_MB_FOTO = 5;
// Revisa el tamaño de un archivo subido contra el máximo permitido para su tipo.
export function exigirTamano(archivo, esPdf, que) {
  const mb = esPdf ? config.maxMbPdf : MAX_MB_FOTO;
  if ((archivo?.size || 0) > mb * 1024 * 1024) throw new HttpError(413, `${que} supera los ${mb} MB.`);
}
// Revisa el tamaño y el contenido de un archivo subido y lo lee para guardarlo.
async function adjunto(archivo, clase, permitidas, que) {
  exigirTamano(archivo, permitidas.includes('.pdf'), que);
  const nombre = nombreOriginal(archivo);
  if (!permitidas.includes(path.extname(nombre).toLowerCase()) || !(await contenidoValido(archivo.path, nombre, permitidas))) {
    throw solicitudInvalida(`${que} debe ser ${permitidas.includes('.pdf') && permitidas.length === 1 ? 'un PDF' : 'una imagen JPG o PNG'} válido.`);
  }
  const tipo = path.extname(nombre).toLowerCase() === '.pdf' ? 'application/pdf' : path.extname(nombre).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return { clase, nombre, tipo, contenido: await fs.readFile(archivo.path) };
}

// Lista las cuentas de campo del alcance con cuántas unidades habilitadas atienden frente al tope de 50.
export async function cargaGestores(usuario) {
  exigirLector(usuario);
  const nodos = await nodosEnAlcance(usuario);
  const { rows } = await query(
    `SELECT g.id_gestor, g.nombre, g.activo, g.correo, t.nodo, t.region, t.triada,
            (SELECT count(*)::int FROM unidades_productivas up WHERE up.id_triada = t.id_triada AND ${unidadesHabilitadas}) AS unidades,
            (SELECT count(*)::int FROM unidades_productivas up WHERE up.id_triada = t.id_triada) AS registradas
       FROM gestores g JOIN triadas t ON t.id_triada = g.id_triada
      WHERE ($1::text[] IS NULL OR upper(btrim(t.nodo)) = ANY($1))
      ORDER BY g.activo DESC, t.region, t.nodo, g.nombre`, [nodos]);
  const sinNodo = nodos === null
    ? (await query(`SELECT count(*)::int AS n FROM unidades_productivas up WHERE up.id_triada IS NULL AND ${unidadesHabilitadas}`)).rows[0].n : null;
  return { ok: true, items: rows.map((g) => ({ ...g, tope: TOPE_UP_GESTOR, excede: g.unidades > TOPE_UP_GESTOR, lleno: g.unidades >= TOPE_UP_GESTOR })), sin_nodo: sinNodo, tope: TOPE_UP_GESTOR };
}

// Comprueba que la tríada de destino exista y esté en el alcance del usuario.
async function triadaDestino(db, usuario, nodo) {
  const n = normTexto(nodo);
  if (!n) throw solicitudInvalida('Elige el nodo al que pasa la unidad.');
  const { rows: [t] } = await db.query('SELECT id_triada, nodo, region FROM triadas WHERE upper(btrim(nodo)) = $1 ORDER BY id_triada LIMIT 1 FOR UPDATE', [n]);
  if (!t) throw noEncontrado('Ese nodo no existe.');
  const nodos = await nodosEnAlcance(usuario);
  if (nodos !== null && !nodos.includes(normTexto(t.nodo))) throw prohibido('Ese nodo está fuera de tu alcance.');
  return t;
}

// Mueve una unidad al nodo de otra cuenta de campo, sin dejar pasar el tope de 50 unidades habilitadas.
export async function moverUP(usuario, { id_unico: idUnico, nodo, motivo } = {}) {
  exigirCoordinacion(usuario, 'Las unidades las asigna la coordinación.');
  const nota = txt(motivo)?.slice(0, 1000);
  if (!nota) throw solicitudInvalida('Escribe el motivo del cambio de nodo.');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  let de = null;
  let a = null;
  await transaccion(async (db) => {
    const { rows: [fila] } = await db.query('SELECT id_up, id_triada, habilitada, retirada_dps FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
    const t = await triadaDestino(db, usuario, nodo);
    if (fila.id_triada === t.id_triada) throw new HttpError(409, `La unidad ya está en el nodo ${t.nodo}.`);
    const cuenta = fila.habilitada !== false && fila.retirada_dps !== true;
    if (cuenta) {
      const { rows: [{ n }] } = await db.query(
        `SELECT count(*)::int AS n FROM unidades_productivas up WHERE up.id_triada = $1 AND ${unidadesHabilitadas}`, [t.id_triada]);
      if (n >= TOPE_UP_GESTOR) {
        throw solicitudInvalida(`El gestor del nodo ${t.nodo} ya atiende ${n} unidades: el máximo por gestor es ${TOPE_UP_GESTOR}.`);
      }
    }
    await db.query('UPDATE unidades_productivas SET id_triada = $2, fecha_actualizacion = now() WHERE id_up = $1', [up.id_up, t.id_triada]);
    await db.query('UPDATE visitas SET nodo_gestor = $2 WHERE id_up = $1', [up.id_up, t.nodo]);
    await db.query('UPDATE agenda_citas SET nodo = $2 WHERE id_up = $1', [up.id_up, t.nodo]);
    for (const tabla of ['items_ups', 'entregas_ups', 'listas_compra', 'entregas']) {
      await db.query(`UPDATE ${tabla} SET nodo = $3 WHERE id_up = $1 OR id_unico = $2`, [up.id_up, up.id_unico, t.nodo]);
    }
    de = up.nodo || null;
    a = t.nodo;
  });
  await registrar(usuario, { accion: 'up.mover_nodo', objeto: { tipo: 'unidad', id: up.id_unico }, idUnico: up.id_unico, cambios: { motivo: nota, campos: { nodo: [de, a] } } });
  return { ok: true, item: { id_unico: up.id_unico, nodo: a, nodo_anterior: de } };
}

// Lista al equipo activo para marcar quién asistió a la transferencia metodológica.
export async function equipo(usuario) {
  exigirLector(usuario);
  const { rows } = await query(
    `SELECT 'coordinador:' || id_coordinador AS sub, nombre, tipo AS rol, region FROM coordinadores WHERE activo
      UNION ALL
     SELECT 'gestor:' || g.id_gestor, g.nombre, 'gestor', t.region FROM gestores g LEFT JOIN triadas t ON t.id_triada = g.id_triada WHERE g.activo
     ORDER BY 3, 2`);
  return { ok: true, items: rows };
}

function listaJson(valor, que) {
  let xs;
  try { xs = typeof valor === 'string' ? JSON.parse(valor || '[]') : valor; } catch { throw solicitudInvalida(`La lista de ${que} no es válida.`); }
  if (!Array.isArray(xs) || xs.length > 2000) throw solicitudInvalida(`La lista de ${que} no es válida.`);
  return xs;
}

// Arma la condición SQL de los eventos que ve cada usuario según su nivel.
async function visibles(usuario, params) {
  if (alcanceDe(usuario) === null) return 'TRUE';
  const nodos = await nodosEnAlcance(usuario);
  params.push(nodos || []);
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  return `(e.tipo = 'transferencia'
        OR (e.tipo = 'kit_gestor' AND upper(btrim(e.nodo)) = ANY($${params.indexOf(nodos || []) + 1}::text[]))
        OR (e.tipo = 'cierre' AND EXISTS (SELECT 1 FROM unidades_productivas up LEFT JOIN triadas t ON t.id_triada = up.id_triada
             WHERE upper(translate(btrim(up.departamento), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = upper(translate(btrim(e.departamento), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AND ${alcance})))`;
}

// Lista los eventos del equipo visibles para el usuario, con sus adjuntos sin contenido y sus asistentes.
export async function listarEventos(usuario, { tipo } = {}) {
  exigirLector(usuario);
  const params = [];
  const cond = await visibles(usuario, params);
  const t = TIPOS_EVENTO[txt(tipo)] ? txt(tipo) : null;
  params.push(t);
  const { rows } = await query(
    `SELECT e.*, to_char(e.fecha, 'YYYY-MM-DD') AS fecha, g.nombre AS gestor,
            COALESCE((SELECT json_agg(json_build_object('id', a.id, 'clase', a.clase, 'nombre', a.nombre, 'tipo', a.tipo) ORDER BY a.clase, a.id)
                        FROM eventos_equipo_adjuntos a WHERE a.evento_id = e.id), '[]') AS adjuntos,
            COALESCE((SELECT json_agg(json_build_object('clase', s.clase, 'ref', s.ref, 'nombre', s.nombre) ORDER BY s.nombre)
                        FROM eventos_equipo_asistentes s WHERE s.evento_id = e.id), '[]') AS asistentes
       FROM eventos_equipo e LEFT JOIN gestores g ON g.id_gestor = e.id_gestor
      WHERE (${cond}) AND ($${params.length}::text IS NULL OR e.tipo = $${params.length})
      ORDER BY e.fecha DESC, e.id DESC LIMIT 300`, params);
  return { ok: true, items: rows.map((e) => ({ ...e, nombre_tipo: TIPOS_EVENTO[e.tipo] })) };
}

// Devuelve el contenido, el nombre y el tipo de un adjunto de un evento visible.
export async function adjuntoEvento(usuario, { id } = {}) {
  exigirLector(usuario);
  const aid = entero(id);
  if (!aid || aid < 1 || aid > MAX_ID) throw noEncontrado('El adjunto no existe.');
  const params = [];
  const cond = await visibles(usuario, params);
  params.push(aid);
  const { rows: [a] } = await query(
    `SELECT a.contenido, a.nombre, a.tipo FROM eventos_equipo_adjuntos a JOIN eventos_equipo e ON e.id = a.evento_id
      WHERE (${cond}) AND a.id = $${params.length}`, params);
  if (!a) throw noEncontrado('El adjunto no existe.');
  return { buffer: a.contenido, nombre: a.nombre, tipo: a.tipo };
}

// Registra un evento del equipo con sus archivos: lista, acta, presentación y fotos.
export async function registrarEvento(usuario, campos = {}, archivos = {}) {
  const tipo = txt(campos.tipo);
  if (!TIPOS_EVENTO[tipo]) throw solicitudInvalida('Elige el tipo de evento: transferencia, kit_gestor o cierre.');
  if (tipo === 'transferencia') exigirGeneral(usuario); else exigirCoordinacion(usuario, 'Este evento lo registra la coordinación.');
  const fecha = fechaValida(campos.fecha, 'del evento');
  const lugar = txt(campos.lugar)?.slice(0, 300) || null;
  const descripcion = txt(campos.descripcion)?.slice(0, 5000) || null;
  const uno = (clase) => (Array.isArray(archivos?.[clase]) ? archivos[clase][0] : archivos?.[clase]) || null;
  const fotos = Array.isArray(archivos?.fotos) ? archivos.fotos : [];
  if (fotos.length > MAX_FOTOS) throw solicitudInvalida(`Se admiten máximo ${MAX_FOTOS} fotos.`);

  const adjuntos = [];
  const asistentes = [];
  let gestor = null;
  let departamento = null;
  const datos = {};
  if (tipo === 'kit_gestor') {
    const gid = entero(campos.id_gestor);
    if (!gid || gid < 1 || gid > MAX_ID) throw solicitudInvalida('Elige el gestor que recibe el kit.');
    const { rows: [g] } = await query('SELECT g.id_gestor, g.nombre, t.nodo FROM gestores g LEFT JOIN triadas t ON t.id_triada = g.id_triada WHERE g.id_gestor = $1', [gid]);
    if (!g) throw noEncontrado('El gestor no existe.');
    const nodos = await nodosEnAlcance(usuario);
    if (nodos !== null && !nodos.includes(normTexto(g.nodo))) throw prohibido('Ese gestor está fuera de tu alcance.');
    gestor = g;
    datos.contenido = txt(campos.contenido)?.slice(0, 2000);
    if (!datos.contenido) throw solicitudInvalida('Describe el contenido del kit entregado al gestor.');
    if (!uno('acta')) throw solicitudInvalida('Adjunta el acta de entrega del kit en PDF.');
    adjuntos.push(await adjunto(uno('acta'), 'acta', ['.pdf'], 'El acta de entrega'));
  } else {
    if (!lugar) throw solicitudInvalida('Escribe el lugar del evento.');
    if (!uno('lista')) throw solicitudInvalida('Adjunta la lista de asistencia en PDF.');
    adjuntos.push(await adjunto(uno('lista'), 'lista', ['.pdf'], 'La lista de asistencia'));
    if (!fotos.length) throw solicitudInvalida('Adjunta al menos una foto del evento (JPG o PNG).');
    for (const f of fotos) adjuntos.push(await adjunto(f, 'foto', IMAGENES, 'Cada foto'));
    const refs = [...new Set(listaJson(campos.asistentes, 'asistentes').map((x) => txt(x)).filter(Boolean))];
    if (tipo === 'transferencia') {
      if (!refs.length) throw solicitudInvalida('Marca a los integrantes del equipo que asistieron.');
      const { items } = await equipo(usuario);
      for (const r of refs) {
        const p = items.find((x) => x.sub === r);
        if (!p) throw solicitudInvalida(`«${r}» no es un integrante activo del equipo.`);
        asistentes.push({ clase: 'usuario', ref: p.sub, nombre: p.nombre, id_up: null });
      }
    } else {
      departamento = txt(campos.departamento)?.slice(0, 100);
      if (!departamento) throw solicitudInvalida('Escribe el departamento del evento de cierre.');
      const a = alcanceDe(usuario);
      if (a?.departamento && a.departamento !== normTexto(departamento)) throw prohibido('Ese departamento está fuera de tu alcance.');
      if (!uno('presentacion')) throw solicitudInvalida('Adjunta la presentación de resultados en PDF.');
      adjuntos.push(await adjunto(uno('presentacion'), 'presentacion', ['.pdf'], 'La presentación de resultados'));
      if (!refs.length) throw solicitudInvalida('Marca las unidades productivas que asistieron al cierre.');
      for (const r of refs) {
        const up = await buscarUP({ idUnico: r });
        if (!up) throw solicitudInvalida(`La unidad «${r}» no existe.`);
        exigirAlcance(usuario, up);
        if (normTexto(up.departamento) !== normTexto(departamento)) throw solicitudInvalida(`La unidad «${r}» no es del departamento ${departamento}.`);
        if (!asistentes.some((s) => s.id_up === up.id_up)) asistentes.push({ clase: 'up', ref: up.id_unico, nombre: up.unidad_nombre, id_up: up.id_up });
      }
    }
  }

  const id = await transaccion(async (db) => {
    const { rows: [e] } = await db.query(
      `INSERT INTO eventos_equipo (tipo, fecha, lugar, descripcion, departamento, id_gestor, nodo, datos, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tipo, fecha, lugar, descripcion, departamento, gestor?.id_gestor || null, gestor?.nodo || null, JSON.stringify(datos), quienEs(usuario)]);
    for (const a of adjuntos) {
      await db.query('INSERT INTO eventos_equipo_adjuntos (evento_id, clase, nombre, tipo, contenido) VALUES ($1, $2, $3, $4, $5)', [e.id, a.clase, a.nombre, a.tipo, a.contenido]);
    }
    for (const s of asistentes) {
      await db.query('INSERT INTO eventos_equipo_asistentes (evento_id, clase, ref, nombre, id_up) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [e.id, s.clase, s.ref, s.nombre, s.id_up]);
    }
    return e.id;
  });
  await registrar(usuario, { accion: `alistamiento.${tipo}`, objeto: { tipo: 'evento_equipo', id }, idUnico: null,
    cambios: { fecha, lugar, departamento, gestor: gestor?.nombre || null, adjuntos: adjuntos.length, asistentes: asistentes.length } });
  for (const s of asistentes.filter((x) => x.clase === 'up')) {
    await registrar(usuario, { accion: 'up.cierre', objeto: { tipo: 'unidad', id: s.ref }, idUnico: s.ref, cambios: { evento: id, fecha, departamento } });
  }
  return { ok: true, item: { id, tipo, fecha, adjuntos: adjuntos.length, asistentes: asistentes.length } };
}

// Devuelve el cierre al que asistió una unidad, para su ficha, o null.
export async function cierreDeUP(db, idUp) {
  const { rows: [c] } = await db.query(
    `SELECT e.id, to_char(e.fecha, 'YYYY-MM-DD') AS fecha, e.lugar, e.departamento FROM eventos_equipo_asistentes s
       JOIN eventos_equipo e ON e.id = s.evento_id WHERE s.id_up = $1 AND e.tipo = 'cierre' ORDER BY e.fecha DESC LIMIT 1`, [idUp]);
  return c || null;
}
