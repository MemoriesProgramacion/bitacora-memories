// Visitas de la ruta: caracterización, diagnóstico y acompañamiento. Cada visita es un documento guardado
// completo en la columna documento (JSONB), con las secciones unidad, visita, situación, programación,
// alistamiento, realización, soportes, cierre y registro. Aquí se validan el alcance, la secuencia, los
// soportes y las reglas de cierre.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { query, transaccion } from '../db.js';
import { config, ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { esGestor, normNodo } from '../util.js';
import { condicionAlcanceFila, exigirAlcance, exigirAlcanceDeUP } from '../alcance.js';
import { eliminarArchivo, guardarArchivo, mimeDe } from './archivos.js';
import { contenidoValido } from './tipoArchivo.js';
import { conRegistro } from './actividad.js';
import { exigirMinimoParaCerrarV1 } from './asociados.js';
import { SECUENCIA, claseDeNombre, claseExigida, formatosFaltantes, salidasCargadas } from './catalogoVisitas.js';
import { exigirDiagnosticoParaCerrar, visitasDeUP } from './diagnostico.js';
import { congelarLineaBase, exigirSalidaParaCerrar } from './salida.js';
import {
  exigirCedulasParticipantes, exigirDatosDeCierre, exigirEntregaParaV3, exigirVigenciaCertificado,
  plazoV3, programacionLimpia, realizacionLimpia,
} from './reglasVisitas.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { exigirEnPrograma } from './unidades.js';

export const TIPOS_VISITA = ['v1', 'v2', 'v3', 'fort', 'cap', 'nov'];
export const MAX_ARCHIVO_MB = 80;
const MAX_DOCUMENTO_BYTES = 512 * 1024;

const EXT_PERMITIDAS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v', '.xlsx', '.xls',
]);
const EXT_FORMATOS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls']);
const FORMATOS_MAX_MB = 15;
const CONTENEDOR_SOPORTES = 'visitas';
const CONTENEDOR_FORMATOS = 'visitas-formatos';

const soloAlfanum = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '');
const ahoraIso = () => new Date().toISOString();
const marcaFecha = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const quienEs = (u) => u.nombre || u.nodo || u.sub || 'sistema';
const lista = (x) => (Array.isArray(x) ? x : []);
const soloObjeto = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

function exigirVisitas(u) {
  if (esGestor(u) && normNodo(u.nodo)) return;
  if (u?.rol === ROLES.COORDINADOR) return;
  throw prohibido('Tu rol no usa Visitas.');
}
const exigirCoordinador = (u) => {
  if (u?.rol !== ROLES.COORDINADOR) throw prohibido('Solo coordinación puede hacer esto.');
};

// Busca la unidad productiva por su ID único o por el documento de su representante, sin puntos ni guiones.
async function unidadDe(unidad = {}) {
  const idUnico = unidad.id_unico != null ? String(unidad.id_unico) : null;
  const doc = soloAlfanum(unidad.documento);
  const { rows } = await query(
    `SELECT up.id_up, up.id_unico, up.nombre, t.nodo, t.region, up.departamento, up.modalidad, r.documento, r.documento_inicial
       FROM unidades_productivas up
       LEFT JOIN triadas t        ON t.id_triada = up.id_triada
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE ($1::text IS NOT NULL AND up.id_unico = $1)
         OR ($2::text <> '' AND (regexp_replace(coalesce(r.documento, ''), '[^A-Za-z0-9]', '', 'g') = $2
                              OR regexp_replace(coalesce(r.documento_inicial, ''), '[^A-Za-z0-9]', '', 'g') = $2))
      ORDER BY (up.id_unico = coalesce($1, '')) DESC LIMIT 1`,
    [idUnico, doc],
  );
  return rows[0] || null;
}

// Limpia un soporte dejando solo los campos conocidos y acotados.
function soporte(s) {
  return {
    archivo: String(s?.archivo ?? '').slice(0, 300),
    blob: s?.blob ? String(s.blob).slice(0, 500) : null,
    peso_bytes: Number.isFinite(Number(s?.peso_bytes)) ? Number(s.peso_bytes) : null,
    cargado_en: s?.cargado_en || null,
    cargado_por: s?.cargado_por ? String(s.cargado_por).slice(0, 200) : null,
  };
}

function soportesLimpios(sop) {
  const salida = {};
  for (const [grupo, formatos] of Object.entries(soloObjeto(sop))) {
    if (grupo === 'soportes_quitados') continue;
    salida[String(grupo).slice(0, 80)] = Object.fromEntries(
      Object.entries(soloObjeto(formatos))
        .map(([nombre, items]) => [String(nombre).slice(0, 200), lista(items).slice(0, 50).map(soporte)]),
    );
  }
  return salida;
}

// Cuenta solo los soportes que el servidor recibió: con su blob, de esta unidad y registrados en la tabla de
// archivos.
async function soportesVerificados(db, sop, docUnidad, idUp, idVisita) {
  const deEstaVisita = new RegExp(`^${String(idVisita).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{14}_`);
  const vistos = new Set();
  const blobs = [];
  for (const [grupo, formatos] of Object.entries(sop)) {
    if (grupo === 'soportes_quitados' || !soloObjeto(formatos)) continue;
    for (const items of Object.values(formatos)) for (const s of items) if (s.blob) blobs.push(s.blob);
  }
  const existen = new Set(blobs.length
    ? (await db.query('SELECT nombre FROM archivos WHERE contenedor = $1 AND id_up = $2 AND nombre = ANY($3::text[])',
      [CONTENEDOR_SOPORTES, idUp, blobs])).rows.map((r) => r.nombre)
    : []);
  for (const [grupo, formatos] of Object.entries(sop)) {
    if (grupo === 'soportes_quitados' || !soloObjeto(formatos)) continue;
    for (const [formato, items] of Object.entries(formatos)) {
      formatos[formato] = items.filter((s) => {
        const blob = String(s.blob || '');
        const ok = blob.startsWith(`${docUnidad}/`) && deEstaVisita.test(path.posix.basename(blob)) && existen.has(blob) && !vistos.has(blob);
        if (ok) vistos.add(blob);
        return ok;
      });
    }
  }
  return sop;
}

// Nombre de cada visita de la secuencia del proceso.
const NOMBRE_VISITA = { v1: 'Visita 1', v2: 'Visita 2', v3: 'Visita 3' };
// Exige que la visita anterior esté cerrada: la segunda requiere la primera y la tercera la segunda; no se
// registran visitas si la unidad salió del programa.
async function exigirSecuencia(db, idUp, tipo, { nueva = false, id = null } = {}) {
  if (!SECUENCIA.includes(tipo)) return;
  const { rows: [u] } = await db.query('SELECT id_unico, retirada_dps, novedad_tipo FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [idUp]);
  exigirEnPrograma(u, 'registran más visitas');
  const vis = await visitasDeUP(db, idUp);
  const conSalida = SECUENCIA.find((t) => vis[t]?.cerrada && vis[t].salida.length && vis[t].id !== id);
  if (conSalida) {
    throw new HttpError(409, `La unidad salió del programa en la ${NOMBRE_VISITA[conSalida]} (${vis[conSalida].salida[0]}): no se registran más visitas.`);
  }
  if (vis[tipo]?.cerrada && vis[tipo].id !== id) {
    throw new HttpError(409, `La ${NOMBRE_VISITA[tipo]} de esta unidad ya está cerrada: para corregirla, la coordinación la reabre.`);
  }
  if (nueva && vis[tipo]?.creada) {
    throw new HttpError(409, `La unidad ya tiene la ${NOMBRE_VISITA[tipo]} abierta: continúala desde «Programadas» (para cambiar la fecha, reprográmala).`);
  }
  const anterior = SECUENCIA[SECUENCIA.indexOf(tipo) - 1];
  if (anterior && !vis[anterior]?.cerrada) {
    throw new HttpError(409, `Primero debe cerrarse la ${NOMBRE_VISITA[anterior]}: la ruta va Visita 1 → Visita 2 → Visita 3.`);
  }
}

function situacionDe(d) {
  if (d.cierre.cerrada) return 'CERRADA';
  if (d.realizacion.estado === 'PENDIENTE_SOPORTES') return 'PENDIENTE_SOPORTES';
  if (d.programacion.resultado_llamada === 'AGENDADA' && d.programacion.fecha_visita) return 'PROGRAMADA';
  return 'SIN_FECHA';
}

const iso = (f) => (f instanceof Date ? f.toISOString() : f || null);
// Construye el documento de una visita anterior a la columna documento a partir de sus columnas.
function documentoAntiguo(r) {
  return {
    id: r.id, nodo: r.nodo_gestor,
    unidad: { id_unico: r.id_unico, nombre: r.unidad_nombre || '', documento: r.unidad_doc, modalidad: r.modalidad || '' },
    visita: { tipo: r.tipo_visita, nombre: r.tipo_visita_label || NOMBRE_VISITA[r.tipo_visita] || '', carpeta: '' },
    situacion: 'CERRADA',
    programacion: {}, alistamiento: {},
    realizacion: { estado: r.estado_visita || null, modalidad: 'PRESENCIAL' },
    soportes: {},
    cierre: { cerrada: true, fecha_cierre: iso(r.fecha_cierre), cerrada_por: null, reaperturas: [] },
    registro: { creado_en: iso(r.creado_en), creado_por: null, actualizado_en: iso(r.fecha_actualizacion), actualizado_por: null },
  };
}

// Lista las visitas visibles para el usuario.
export async function listarVisitas(usuario, { unidad_doc: unidadDoc } = {}) {
  exigirVisitas(usuario);
  const params = [soloAlfanum(unidadDoc)];
  const alcance = condicionAlcanceFila(usuario, { idUp: 'visitas.id_up', nodo: 'visitas.nodo_gestor' }, params);
  const { rows } = await query(
    `SELECT visitas.documento, visitas.id, visitas.id_unico, visitas.unidad_doc, visitas.unidad_nombre, visitas.nodo_gestor,
            visitas.tipo_visita, visitas.tipo_visita_label, visitas.estado_visita, visitas.fecha_cierre, visitas.creado_en,
            visitas.fecha_actualizacion, up.modalidad
       FROM visitas LEFT JOIN unidades_productivas up ON up.id_up = visitas.id_up
      WHERE (visitas.documento IS NOT NULL OR visitas.cerrada)
        AND ($1::text = '' OR visitas.unidad_doc = $1)
        AND ${alcance}
      ORDER BY visitas.creado_en, visitas.id`,
    params,
  );
  return { ok: true, items: rows.map((r) => r.documento || documentoAntiguo(r)) };
}

// Devuelve la visita de una unidad y tipo.
async function visitaDe(usuario, id, db = { query }, bloquear = false) {
  const { rows } = await db.query(
    `SELECT * FROM visitas WHERE id = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [String(id || '')],
  );
  const v = rows[0];
  if (!v || !v.documento) throw noEncontrado('visita no encontrada');
  await exigirAlcanceDeUP(usuario, v.id_up, v.nodo_gestor);
  return v;
}

const SQL_GUARDAR = `
  INSERT INTO visitas (id, id_up, id_unico, unidad_doc, unidad_nombre, nodo_gestor, tipo_visita, tipo_visita_label,
                       estado_visita, cerrada, fecha_cierre, documento, creado_en, fecha_actualizacion)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
  ON CONFLICT (id) DO UPDATE SET
    id_up = EXCLUDED.id_up, id_unico = EXCLUDED.id_unico, unidad_nombre = EXCLUDED.unidad_nombre,
    nodo_gestor = EXCLUDED.nodo_gestor, tipo_visita_label = EXCLUDED.tipo_visita_label,
    estado_visita = EXCLUDED.estado_visita, cerrada = EXCLUDED.cerrada, fecha_cierre = EXCLUDED.fecha_cierre,
    documento = EXCLUDED.documento, fecha_actualizacion = now()`;

// Crea o actualiza una visita; una visita cerrada solo se modifica reabriéndola con un motivo.
export function guardarVisita(usuario, cuerpo = {}) {
  const meta = { accion: cuerpo.reabrir === true ? 'visitas.reabrir' : 'visitas.guardar', objeto: { tipo: 'visita', id: cuerpo.visita?.id ?? null } };
  return conRegistro(
    usuario, meta,
    async () => {
      const r = await guardarVisitaInterna(usuario, cuerpo);
      meta.idUnico = r.item.unidad.id_unico;
      return r;
    },
    (r) => ({
      tipo: r.item.visita.tipo, cerrada: r.item.cierre.cerrada,
      ...(cuerpo.reabrir === true ? { motivo: String(cuerpo.motivo || '').slice(0, 300) } : {}),
      ...(r.aviso ? { aprobacion_descartada: true } : {}),
    }),
  );
}

// Aplica las reglas y guarda la visita dentro de una transacción.
async function guardarVisitaInterna(usuario, cuerpo = {}) {
  exigirVisitas(usuario);
  const d = soloObjeto(cuerpo.visita);
  const id = String(d.id || '');
  const tipo = String(d.visita?.tipo || '');
  const docUnidad = soloAlfanum(d.unidad?.documento);

  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw solicitudInvalida('La visita necesita un id válido.');
  if (!TIPOS_VISITA.includes(tipo)) throw solicitudInvalida('Tipo de visita no válido.');
  if (!docUnidad) throw solicitudInvalida('la unidad no tiene documento');
  if (!id.startsWith(`${docUnidad}_${tipo}`)) throw solicitudInvalida('el documento no corresponde a la unidad');
  if (JSON.stringify(d).length > MAX_DOCUMENTO_BYTES) throw new HttpError(413, 'La visita es demasiado grande.');

  const up = await unidadDe(d.unidad);
  if (!up) throw solicitudInvalida('unidad no encontrada');
  if (![soloAlfanum(up.documento), soloAlfanum(up.documento_inicial)].includes(docUnidad)) {
    throw solicitudInvalida('el documento no corresponde a la unidad');
  }
  exigirAlcance(usuario, up);

  const reabrir = cuerpo.reabrir === true;
  const motivo = String(cuerpo.motivo || '').trim().slice(0, 1000);
  if (reabrir) {
    exigirCoordinador(usuario);
    if (!motivo) throw solicitudInvalida('Escribe el motivo de la reapertura.');
  }

  const quien = quienEs(usuario);
  const ahora = ahoraIso();

  const doc = await transaccion(async (db) => {
    const previa = (await db.query('SELECT * FROM visitas WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (previa) await exigirAlcanceDeUP(usuario, previa.id_up, previa.nodo_gestor);
    const antes = previa?.documento || null;
    if ((antes ? antes.cierre?.cerrada : previa?.cerrada) && !reabrir) throw new HttpError(409, 'visita cerrada');
    if (reabrir && !(antes ? antes.cierre?.cerrada : previa?.cerrada)) throw solicitudInvalida('Esa visita no está cerrada.');

    const cierre = {
      cerrada: !!d.cierre?.cerrada, fecha_cierre: null, cerrada_por: null,
      reaperturas: lista(antes?.cierre?.reaperturas),
    };
    if (reabrir) {
      cierre.reaperturas.push({
        reabierta_en: ahora, reabierta_por: quien, motivo,
        cerrada_antes_en: antes?.cierre?.fecha_cierre ?? iso(previa.fecha_cierre), cerrada_antes_por: antes?.cierre?.cerrada_por ?? null,
      });
      cierre.cerrada = false;
    }
    if (!previa || (cierre.cerrada && !reabrir)) await exigirSecuencia(db, up.id_up, tipo, { nueva: !previa, id });
    const soportesNuevos = await soportesVerificados(db, soportesLimpios(d.soportes), docUnidad, up.id_up, id);
    const programacion = programacionLimpia(soloObjeto(d.programacion));
    const realizacion = realizacionLimpia(soloObjeto(d.realizacion), antes?.realizacion);
    if (tipo === 'v3' && !reabrir && (!previa || programacion.fecha_visita !== (antes?.programacion?.fecha_visita ?? null))) {
      await exigirEntregaParaV3(db, up, programacion.fecha_visita);
    }
    const aprobacionDescartada = (realizacion.aprobaciones_descartadas?.length || 0) > (antes?.realizacion?.aprobaciones_descartadas?.length || 0);
    if (!reabrir && cierre.cerrada) {
      const conSalida = salidasCargadas(tipo, soportesNuevos).length > 0;
      if (SECUENCIA.includes(tipo)) exigirDatosDeCierre({ tipo, programacion, realizacion, soportes: soportesNuevos });
      const faltanFormatos = SECUENCIA.includes(tipo) ? formatosFaltantes(tipo, up.modalidad, soportesNuevos) : [];
      if (faltanFormatos.length) {
        throw solicitudInvalida(`Para cerrar la ${NOMBRE_VISITA[tipo]} faltan los formatos: ${faltanFormatos.join(', ')}.`);
      }
      if (tipo === 'v1' && !conSalida) {
        await exigirMinimoParaCerrarV1(db, up.id_up, up.modalidad);
        await exigirCedulasParticipantes(db, up, soportesNuevos);
        await exigirVigenciaCertificado(db, up, soportesNuevos, programacion.fecha_visita);
      }
      await exigirDiagnosticoParaCerrar(db, up, tipo, soportesNuevos);
      await congelarLineaBase(db, up, tipo, soportesNuevos);
      await exigirSalidaParaCerrar(db, up, tipo, soportesNuevos);
      cierre.fecha_cierre = ahora;
      cierre.cerrada_por = quien;
    }

    const nuevo = {
      id,
      nodo: up.nodo,
      unidad: {
        id_unico: up.id_unico, nombre: up.nombre || String(d.unidad?.nombre || ''),
        documento: docUnidad, modalidad: String(d.unidad?.modalidad || '').slice(0, 40),
      },
      visita: {
        tipo, nombre: String(d.visita?.nombre || '').slice(0, 200), carpeta: String(d.visita?.carpeta || '').slice(0, 200),
      },
      programacion,
      alistamiento: soloObjeto(d.alistamiento),
      realizacion,
      soportes: soportesNuevos,
      cierre,
      registro: {
        creado_en: antes?.registro?.creado_en || ahora,
        creado_por: antes?.registro?.creado_por || quien,
        actualizado_en: ahora,
        actualizado_por: quien,
      },
    };
    if (antes?.soportes?.soportes_quitados) nuevo.soportes.soportes_quitados = antes.soportes.soportes_quitados;
    nuevo.situacion = situacionDe(nuevo);

    await db.query(SQL_GUARDAR, [
      id, up.id_up, up.id_unico, docUnidad, up.nombre, up.nodo, tipo, nuevo.visita.nombre,
      nuevo.realizacion.estado, cierre.cerrada, cierre.fecha_cierre, JSON.stringify(nuevo),
    ]);
    return { nuevo, aprobacionDescartada };
  });
  return {
    ok: true, item: doc.nuevo,
    ...(doc.aprobacionDescartada ? { aviso: 'Cambiaste la modalidad, la causa o la justificación: la aprobación de la interventoría se descartó y la coordinación debe registrarla de nuevo.' } : {}),
  };
}

// Sube el archivo de un formato o, con la acción quitar, quita uno ya subido.
export function subirArchivoVisita(usuario, campos = {}, archivo) {
  const quitar = String(campos.accion || '') === 'quitar';
  return conRegistro(
    usuario, { accion: quitar ? 'visitas.quitar_soporte' : 'visitas.subir_soporte', objeto: { tipo: 'visita', id: campos.visita_id ?? null } },
    () => subirArchivoVisitaInterna(usuario, campos, archivo),
    () => ({ formato: String(campos.formato || '').slice(0, 200), archivo: String(archivo?.originalname || campos.blob || '').slice(0, 200) }),
  );
}

async function subirArchivoVisitaInterna(usuario, campos = {}, archivo) {
  exigirVisitas(usuario);
  if (String(campos.accion || '') === 'quitar') return quitarSoporte(usuario, campos);

  const visitaId = String(campos.visita_id || '');
  const formato = String(campos.formato || '').slice(0, 200);
  if (!visitaId || !formato) throw solicitudInvalida('Faltan visita_id o formato.');
  if (!archivo) throw solicitudInvalida('Falta el archivo.');

  const v = await visitaDe(usuario, visitaId);
  if (v.documento.cierre?.cerrada) throw new HttpError(409, 'visita cerrada');
  if (archivo.size > MAX_ARCHIVO_MB * 1024 * 1024) throw new HttpError(413, 'archivo muy pesado');
  if (!EXT_PERMITIDAS.has(path.extname(archivo.originalname || '').toLowerCase())
    || !(await contenidoValido(archivo.path, archivo.originalname))) {
    throw solicitudInvalida('tipo de archivo no permitido');
  }
  const clase = claseExigida(formato);
  if (clase && claseDeNombre(archivo.originalname) !== clase) {
    throw solicitudInvalida(clase === 'video'
      ? `El formato «${formato}» debe ser un video (MP4, MOV, AVI, MKV, WEBM, 3GP o M4V).`
      : `El formato «${formato}» debe ser una imagen (JPG, PNG, HEIC, WEBP, GIF o BMP).`);
  }

  const carpeta = String(v.documento.visita?.carpeta || 'SIN_CARPETA').replace(/[\\/]/g, '_');
  const nombre = `${v.unidad_doc}/${carpeta}/${v.id}_${marcaFecha()}_${randomBytes(3).toString('hex')}_${path.basename(archivo.originalname)}`;
  const r = await guardarArchivo({ contenedor: CONTENEDOR_SOPORTES, nombre, archivo, idUp: v.id_up, usuario });
  return { ok: true, url: r.url, blob: r.nombre };
}

// Quita un soporte sin borrarlo del disco: se renombra con la marca de eliminado y la fecha y se anota quién lo
// quitó.
async function quitarSoporte(usuario, { visita_id: visitaId, blob }) {
  if (!visitaId || !blob) throw solicitudInvalida('Faltan visita_id o blob.');
  const item = await transaccion(async (db) => {
    const v = await visitaDe(usuario, visitaId, db, true);
    const doc = v.documento;
    if (doc.cierre?.cerrada) throw new HttpError(409, 'visita cerrada');

    let encontrado = null;
    for (const [grupo, formatos] of Object.entries(doc.soportes || {})) {
      if (grupo === 'soportes_quitados') continue;
      for (const [formato, items] of Object.entries(formatos)) {
        const i = items.findIndex((s) => s.blob === blob);
        if (i >= 0) { encontrado = { formato, soporte: items[i] }; items.splice(i, 1); }
      }
    }
    if (!encontrado) throw noEncontrado('Ese archivo no está en la visita.');

    const renombrado = `${blob}_ELIMINADO_${marcaFecha()}`;
    await db.query(
      'UPDATE archivos SET nombre = $3 WHERE contenedor = $1 AND nombre = $2 AND id_up IS NOT DISTINCT FROM $4',
      [CONTENEDOR_SOPORTES, blob, renombrado, v.id_up]);
    doc.soportes.soportes_quitados = [...lista(doc.soportes.soportes_quitados), {
      formato: encontrado.formato, archivo: encontrado.soporte.archivo, blob_original: blob, blob_actual: renombrado,
      quitado_en: ahoraIso(), quitado_por: quienEs(usuario),
    }];
    doc.registro = { ...doc.registro, actualizado_en: ahoraIso(), actualizado_por: quienEs(usuario) };
    await db.query('UPDATE visitas SET documento = $2, fecha_actualizacion = now() WHERE id = $1', [v.id, JSON.stringify(doc)]);
    return doc;
  });
  return { ok: true, item };
}

// Devuelve la ruta, el tipo y el nombre de un soporte de la visita, solo si el usuario ve esa visita.
export async function obtenerSoporte(usuario, { id, blob }) {
  exigirVisitas(usuario);
  const v = await visitaDe(usuario, id);
  const nombre = String(blob || '');
  if (!nombre.startsWith(`${v.unidad_doc}/`)) throw noEncontrado('Archivo no encontrado.');
  const { rows } = await query(
    'SELECT ruta_relativa, mime FROM archivos WHERE contenedor = $1 AND nombre = $2 AND id_up IS NOT DISTINCT FROM $3',
    [CONTENEDOR_SOPORTES, nombre, v.id_up]);
  if (!rows.length) throw noEncontrado('Archivo no encontrado.');
  const ruta = path.join(config.storageDir, rows[0].ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  return { ruta, mime: mimeDe(nombre), nombre: path.posix.basename(nombre) };
}

// Lista los formatos en blanco que sube la coordinación y que se descargan al agendar.
export async function listarFormatos(usuario) {
  exigirVisitas(usuario);
  const { rows } = await query(
    'SELECT nombre, tamano, fecha_carga FROM archivos WHERE contenedor = $1 ORDER BY nombre', [CONTENEDOR_FORMATOS]);
  return { ok: true, items: rows.map((r) => ({ nombre: r.nombre, tamano: r.tamano, fecha_carga: r.fecha_carga })) };
}

export async function obtenerFormato(usuario, { nombre }) {
  exigirVisitas(usuario);
  const { rows } = await query(
    'SELECT ruta_relativa, mime FROM archivos WHERE contenedor = $1 AND nombre = $2', [CONTENEDOR_FORMATOS, String(nombre || '')]);
  if (!rows.length) throw noEncontrado('El formato ya no está disponible.');
  const ruta = path.join(config.storageDir, rows[0].ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  return { ruta, mime: mimeDe(nombre), nombre: String(nombre) };
}

// Sube un formato en blanco en PDF, Word o Excel.
export function subirFormato(usuario, campos, archivo) {
  return conRegistro(
    usuario, { accion: 'visitas.subir_formato', objeto: { tipo: 'formato', id: archivo?.originalname ?? null } },
    () => subirFormatoInterno(usuario, campos, archivo),
    (r) => ({ nombre: r.item.nombre }),
  );
}

async function subirFormatoInterno(usuario, _campos, archivo) {
  exigirVisitas(usuario);
  exigirCoordinador(usuario);
  if (!archivo) throw solicitudInvalida('Falta el archivo.');
  const nombre = path.basename(String(archivo.originalname || '')).replace(/[\u0000-\u001f<>:"|?*\\/]/g, '').trim();
  if (!nombre || !EXT_FORMATOS.has(path.extname(nombre).toLowerCase())) {
    throw solicitudInvalida('El formato debe ser PDF, Word o Excel.');
  }
  if (!(await contenidoValido(archivo.path, nombre))) {
    throw solicitudInvalida('El contenido del formato no corresponde a un PDF, Word o Excel.');
  }
  if (archivo.size > FORMATOS_MAX_MB * 1024 * 1024) throw new HttpError(413, `El formato supera los ${FORMATOS_MAX_MB} MB.`);
  const r = await guardarArchivo({ contenedor: CONTENEDOR_FORMATOS, nombre, archivo, usuario });
  return { ok: true, item: { nombre: r.nombre } };
}

// Elimina un formato en blanco.
export function eliminarFormato(usuario, { nombre } = {}) {
  return conRegistro(
    usuario, { accion: 'visitas.quitar_formato', objeto: { tipo: 'formato', id: nombre ?? null } },
    () => eliminarFormatoInterno(usuario, { nombre }),
  );
}

async function eliminarFormatoInterno(usuario, { nombre }) {
  exigirVisitas(usuario);
  exigirCoordinador(usuario);
  const borrados = await eliminarArchivo({ contenedor: CONTENEDOR_FORMATOS, nombre: String(nombre || '') });
  if (!borrados) throw noEncontrado('Formato no encontrado.');
  return { ok: true };
}

// Registra la aprobación de una visita virtual por causa externa, con su fecha y soporte.
export function registrarAprobacionVirtual(usuario, campos = {}, archivo) {
  const meta = { accion: 'visitas.aprobacion_virtual', objeto: { tipo: 'visita', id: campos.visita_id ?? null } };
  return conRegistro(
    usuario, meta,
    async () => {
      exigirVisitas(usuario);
      exigirCoordinador(usuario);
      const visitaId = String(campos.visita_id || '');
      const fecha = String(campos.fecha || '').slice(0, 10);
      const aprobadaPor = String(campos.aprobada_por || '').trim().slice(0, 200);
      const observacion = String(campos.observacion || '').trim().slice(0, 1000) || null;
      if (!visitaId) throw solicitudInvalida('Falta la visita.');
      if (!fechaReal(fecha) || fecha > hoyColombia()) throw solicitudInvalida('La fecha de la aprobación no es válida (no puede ser futura).');
      if (!aprobadaPor) throw solicitudInvalida('Escribe quién aprobó en la interventoría.');
      if (!archivo) throw solicitudInvalida('Adjunta el soporte de la aprobación de la interventoría en PDF.');
      if (path.extname(archivo.originalname || '').toLowerCase() !== '.pdf') throw solicitudInvalida('El soporte de la aprobación debe ser un PDF.');
      return transaccion(async (db) => {
        const v = await visitaDe(usuario, visitaId, db, true);
        const doc = v.documento;
        meta.idUnico = doc.unidad?.id_unico;
        if (doc.cierre?.cerrada) throw new HttpError(409, 'visita cerrada');
        if (doc.realizacion?.modalidad !== 'VIRTUAL') throw new HttpError(409, 'La visita no está marcada como virtual: guárdala como virtual antes de registrar la aprobación.');
        if (!doc.realizacion.causa_virtual || !doc.realizacion.justificacion_virtual) {
          throw new HttpError(409, 'La visita virtual aún no tiene guardadas la causa externa y la justificación: el gestor las registra antes de la aprobación.');
        }
        if (!(await contenidoValido(archivo.path, archivo.originalname))) throw solicitudInvalida('El soporte de la aprobación no es un PDF válido.');
        const carpeta = String(doc.visita?.carpeta || 'SIN_CARPETA').replace(/[\\/]/g, '_');
        const r = await guardarArchivo({
          contenedor: CONTENEDOR_SOPORTES, archivo, idUp: v.id_up, usuario,
          nombre: `${v.unidad_doc}/${carpeta}/APROBACION_INTERVENTORIA_${v.id}_${marcaFecha()}_${randomBytes(3).toString('hex')}.pdf`,
        }, db);
        const aprobacion = {
          fecha, aprobada_por: aprobadaPor, observacion, soporte: r.nombre,
          causa_virtual: doc.realizacion.causa_virtual, justificacion_virtual: doc.realizacion.justificacion_virtual,
          registrada_por: quienEs(usuario), registrada_en: ahoraIso(),
        };
        doc.realizacion = { ...doc.realizacion, aprobacion_interventoria: aprobacion };
        await db.query('UPDATE visitas SET documento = $2, fecha_actualizacion = now() WHERE id = $1', [v.id, JSON.stringify(doc)]);
        return { ok: true, item: doc, _cambios: { aprobacion: { fecha, aprobada_por: aprobadaPor }, id_unico: doc.unidad?.id_unico } };
      });
    },
    (r) => ({ ...r._cambios.aprobacion }),
  ).then(({ _cambios, ...r }) => r);
}

// Devuelve la entrega registrada y la fecha mínima de la tercera visita de la unidad, para avisarlo antes de
// programarla.
export async function plazoVisita3(usuario, { id_unico: idUnico } = {}) {
  exigirVisitas(usuario);
  if (!idUnico) throw solicitudInvalida('Falta el ID de la unidad productiva.');
  const up = await unidadDe({ id_unico: idUnico });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return { ok: true, item: await plazoV3({ query }, up) };
}
