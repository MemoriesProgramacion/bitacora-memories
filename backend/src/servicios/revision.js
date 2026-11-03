// Revisión de los soportes que cada beneficiario cargó en el validador de documentos de entrega. Quien revisa
// marca cada soporte como aprobado o por corregir con observación obligatoria; la marca se escribe en
// ciudadano_documentos, que es lo que lee el validador.
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { config } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { DOCS_ENTREGA, docsDeTipo, estadoGlobal } from './validador.js';
import { registrar, diferencias } from './actividad.js';
import { mimeDe } from './archivos.js';

const CLAVES_CEDULA = ['cedula_pdf', 'cedula_frontal', 'cedula_trasera'];
const quienEs = (u) => u.nombre || u.sub || 'sistema';

function exigirRevisor(u) {
  if (u?.general) return;
  throw prohibido('Tu usuario no tiene permiso para revisar entregas.');
}

// Convierte los estados de la base en los de la pantalla y viceversa.
const haciaPantalla = (e) => (e === 'rechazado' ? 'por_corregir' : e);

async function itemDe(idCiudadano, db = { query }) {
  const { rows: [c] } = await db.query(
    `SELECT c.id_ciudadano, c.cedula, c.nombre_completo, c.estado_validacion, c.tipo_entrega,
            up.id_unico, up.nombre AS up_nombre, up.municipio, t.nodo,
            (SELECT g.nombre FROM gestores g WHERE g.id_triada = up.id_triada AND g.activo ORDER BY g.id_gestor LIMIT 1) AS gestor
       FROM ciudadanos c
       LEFT JOIN unidades_productivas up ON up.id_up = c.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE c.id_ciudadano = $1`, [idCiudadano]);
  if (!c) return null;
  const { rows: docs } = await db.query(
    `SELECT td.codigo, cd.url, cd.estado, cd.observacion, cd.fecha_carga, cd.fecha_revision, cd.revisado_por
       FROM ciudadano_documentos cd JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
      WHERE cd.id_ciudadano = $1`, [idCiudadano]);
  const porClave = Object.fromEntries(docs.map((d) => [d.codigo, d]));
  const exigidos = docsDeTipo(c.tipo_entrega);
  const cargados = exigidos.map((d) => porClave[d.clave]).filter(Boolean);
  return {
    cedula: c.cedula,
    nombre: c.nombre_completo,
    tipo_entrega: c.tipo_entrega,
    estado: c.estado_validacion || estadoGlobal(docs, c.tipo_entrega),
    ultima_carga: cargados.map((d) => d.fecha_carga).filter(Boolean).sort().at(-1) || null,
    up: { id_unico: c.id_unico, nombre: c.up_nombre, nodo: c.nodo, gestor: c.gestor, municipio: c.municipio },
    cedula_archivos: CLAVES_CEDULA.filter((k) => porClave[k]),
    documentos: exigidos.map((d) => {
      const x = porClave[d.clave];
      return {
        clave: d.clave, label: d.label, tipo: d.tipo, cargado: !!x,
        estado: x ? haciaPantalla(x.estado) : null,
        observacion: x?.observacion || '',
        fecha_carga: x?.fecha_carga || null,
        fecha_revision: x?.fecha_revision || null,
        revisado_por: x?.revisado_por || null,
      };
    }),
  };
}

// Lista los beneficiarios que cargaron al menos un soporte de la entrega.
export async function listarRevision(usuario) {
  exigirRevisor(usuario);
  const { rows } = await query(
    `SELECT DISTINCT c.id_ciudadano
       FROM ciudadanos c
       JOIN ciudadano_documentos cd ON cd.id_ciudadano = c.id_ciudadano
       JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
      WHERE c.cedula IS NOT NULL AND td.codigo = ANY($1)`, [DOCS_ENTREGA.map((d) => d.clave)]);
  const items = [];
  for (const r of rows) items.push(await itemDe(r.id_ciudadano));
  return { ok: true, items: items.filter(Boolean) };
}

// Guarda el estado y la observación de cada soporte revisado de un beneficiario.
export async function guardarRevision(usuario, cuerpo = {}) {
  exigirRevisor(usuario);
  const cedula = String(cuerpo.cedula || '').replace(/\D/g, '');
  const decisiones = Object.entries(cuerpo.documentos && typeof cuerpo.documentos === 'object' ? cuerpo.documentos : {});
  if (!cedula) throw solicitudInvalida('Falta la cédula.');
  if (!decisiones.length) throw solicitudInvalida('No hay cambios para guardar.');

  const ref = { idCiudadano: null, idUnico: null, antes: {}, despues: {} };
  const item = await transaccion(async (db) => {
    const { rows: [c] } = await db.query('SELECT id_ciudadano, id_up, tipo_entrega FROM ciudadanos WHERE cedula = $1 FOR UPDATE', [cedula]);
    if (!c) throw noEncontrado('Beneficiario no encontrado.');
    ref.idCiudadano = c.id_ciudadano;
    if (c.id_up) ref.idUnico = (await db.query('SELECT id_unico FROM unidades_productivas WHERE id_up = $1', [c.id_up])).rows[0]?.id_unico ?? null;
    for (const [clave, d] of decisiones) {
      if (!docsDeTipo(c.tipo_entrega).some((x) => x.clave === clave)) throw solicitudInvalida(`Soporte desconocido: ${clave}.`);
      if (!['aprobado', 'por_corregir'].includes(d?.estado)) throw solicitudInvalida('El estado debe ser aprobado o por corregir.');
      const obs = String(d.observacion ?? '').trim().slice(0, 2000);
      if (d.estado === 'por_corregir' && !obs) throw solicitudInvalida('Escribe la observación para el gestor.');

      const { rows: [actual] } = await db.query(
        `SELECT cd.fecha_carga, cd.estado FROM ciudadano_documentos cd JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
          WHERE cd.id_ciudadano = $1 AND td.codigo = $2 FOR UPDATE OF cd`, [c.id_ciudadano, clave]);
      if (!actual) throw solicitudInvalida('Ese soporte aún no se ha cargado.');
      ref.antes[clave] = actual.estado ?? null;
      ref.despues[clave] = d.estado === 'aprobado' ? 'aprobado' : 'rechazado';
      if (d.fecha_carga && new Date(d.fecha_carga).getTime() !== new Date(actual.fecha_carga).getTime()) {
        throw new HttpError(409, 'Este soporte cambió mientras lo revisabas.');
      }
      await db.query(
        `UPDATE ciudadano_documentos cd
            SET estado = $3, observacion = $4, fecha_revision = now(), revisado_por = $5
           FROM tipos_documento td
          WHERE td.id_tipo_documento = cd.id_tipo_documento AND cd.id_ciudadano = $1 AND td.codigo = $2`,
        [c.id_ciudadano, clave, d.estado === 'aprobado' ? 'aprobado' : 'rechazado', d.estado === 'aprobado' ? null : obs, quienEs(usuario)]);
    }
    const { rows: docs } = await db.query(
      `SELECT td.codigo, cd.estado FROM ciudadano_documentos cd JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
        WHERE cd.id_ciudadano = $1`, [c.id_ciudadano]);
    const estado = estadoGlobal(docs, c.tipo_entrega);
    await db.query(
      `UPDATE ciudadanos SET estado_validacion = $2::text,
              fecha_validacion = CASE WHEN $2::text = 'completo' THEN now() ELSE fecha_validacion END
        WHERE id_ciudadano = $1`, [c.id_ciudadano, estado]);
    return itemDe(c.id_ciudadano, db);
  });
  await registrar(usuario, {
    accion: 'revision.guardar', objeto: { tipo: 'beneficiario', id: ref.idCiudadano }, idUnico: ref.idUnico,
    cambios: {
      documentos: Object.fromEntries(decisiones.map(([k, d]) => [k, d.estado])),
      campos: diferencias(ref.antes, ref.despues, Object.keys(ref.despues)),
    },
  });
  return { ok: true, item };
}

// Devuelve la ruta, el tipo y el nombre del archivo de un soporte o de la cédula, para mostrarlo a quien
// revisa.
export async function obtenerArchivoRevision(usuario, { cedula, clave }) {
  exigirRevisor(usuario);
  const ced = String(cedula || '').replace(/\D/g, '');
  if (![...DOCS_ENTREGA.map((d) => d.clave), ...CLAVES_CEDULA].includes(String(clave))) throw solicitudInvalida('Soporte desconocido.');
  const { rows: [d] } = await query(
    `SELECT cd.url FROM ciudadano_documentos cd
       JOIN ciudadanos c ON c.id_ciudadano = cd.id_ciudadano
       JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
      WHERE c.cedula = $1 AND td.codigo = $2`, [ced, String(clave)]);
  const m = /^\/archivos\/([^/]+)\/(.+)$/.exec(d?.url || '');
  if (!m) throw noEncontrado('El archivo no se encontró en el almacenamiento.');
  const contenedor = m[1];
  const nombre = m[2].split('/').map(decodeURIComponent).join('/');
  const { rows: [f] } = await query('SELECT ruta_relativa, mime FROM archivos WHERE contenedor = $1 AND nombre = $2', [contenedor, nombre]);
  if (!f) throw noEncontrado('El archivo no se encontró en el almacenamiento.');
  const ruta = path.join(config.storageDir, f.ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  return { ruta, mime: mimeDe(nombre), nombre: path.posix.basename(nombre) };
}
