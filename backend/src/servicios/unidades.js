// Unidades productivas y cuentas de campo. Cada usuario ve solo las unidades de su alcance y las respuestas
// conservan los nombres de campo que esperan los adaptadores del frontend.
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { esGestor } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, nodosEnAlcance } from '../alcance.js';
import { tenenciaDe } from './tenencia.js';
import { retiroDeUP } from './retiros.js';
import { cierreDeUP } from './alistamiento.js';

// Campos de contacto del representante que se quitan de la lista para quien no debe verlos.
const DATOS_PERSONALES_LISTA = ['rep_nombre1', 'rep_nombre2', 'rep_apellido1', 'rep_apellido2',
  'rep_telefono1', 'rep_telefono2', 'rep_correo1', 'rep_direccion'];
const sinDatosPersonales = (fila) => {
  const f = { ...fila };
  for (const c of DATOS_PERSONALES_LISTA) f[c] = null;
  return f;
};

const exigirBitacora = (usuario) => {
  if (usuario?.rol === ROLES.COMPRAS) throw prohibido('Tu rol no tiene acceso a la Bitácora.');
};

// Devuelve una fila liviana por unidad para la búsqueda y la lista.
export async function listarUnidades(usuario) {
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT up.id_origen          AS id,
            up.id_unico,
            t.nodo, t.region, t.triada,
            up.enlace_carpeta,
            up.nombre             AS up_nombre,
            up.modalidad          AS up_modalidad,
            up.sector             AS up_sector,
            up.departamento       AS up_departamento,
            up.municipio          AS up_municipio,
            up.habilitada         AS up_habilitada,
            up.resultado          AS up_resultado,
            r.documento           AS rep_documento,
            r.documento_inicial   AS rep_documento_inicial,
            r.nombre1             AS rep_nombre1,
            r.nombre2             AS rep_nombre2,
            r.apellido1           AS rep_apellido1,
            r.apellido2           AS rep_apellido2,
            r.telefono1           AS rep_telefono1,
            r.telefono2           AS rep_telefono2,
            r.correo1             AS rep_correo1,
            r.direccion           AS rep_direccion
       FROM unidades_productivas up
       LEFT JOIN triadas t        ON t.id_triada = up.id_triada
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE ${alcance}
      ORDER BY up.id_up`,
    params,
  );
  return { ok: true, items: usuario?.rol === ROLES.COMPRAS ? rows.map(sinDatosPersonales) : rows };
}

// Devuelve el documento completo de una unidad a partir de su id de origen o su ID único.
export async function obtenerUnidad(usuario, { id }) {
  exigirBitacora(usuario);
  if (!id) throw solicitudInvalida('Falta el parámetro id.');
  const params = [String(id)];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT up.*, t.nodo, t.region, t.triada,
            r.documento, r.documento_inicial, r.documentos_rit, r.documento_expedicion,
            r.fecha_nacimiento, r.nombre1, r.nombre2, r.apellido1, r.apellido2, r.sexo,
            r.telefono1, r.telefono2, r.correo1, r.correo2, r.tiene_correo2,
            r.direccion AS rep_direccion
       FROM unidades_productivas up
       LEFT JOIN triadas t        ON t.id_triada = up.id_triada
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE (up.id_origen = $1 OR up.id_unico = $1)
        AND ${alcance}
      LIMIT 1`,
    params,
  );
  if (!rows.length) throw noEncontrado('Unidad productiva no encontrada.');
  const x = rows[0];

  return {
    ok: true,
    item: {
      id: x.id_origen,
      id_unico: x.id_unico,
      nodo: x.nodo,
      region: x.region,
      triada: x.triada,
      tipo: x.tipo,
      enlace_carpeta: x.enlace_carpeta,
      datos_representante: {
        documento: x.documento,
        documento_inicial: x.documento_inicial,
        documentos_rit: x.documentos_rit
          ? x.documentos_rit.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
          : [],
        documento_expedicion: x.documento_expedicion,
        fecha_nacimiento: x.fecha_nacimiento,
        nombre1: x.nombre1,
        nombre2: x.nombre2,
        apellido1: x.apellido1,
        apellido2: x.apellido2,
        sexo: x.sexo,
        telefono1: x.telefono1,
        telefono2: x.telefono2,
        correo1: x.correo1,
        correo2: x.correo2,
        tiene_correo2: x.tiene_correo2,
        direccion: x.rep_direccion,
      },
      datos_up: {
        nombre: x.nombre,
        actividad: x.actividad,
        habilitada: x.habilitada,
        retirada_dps: x.retirada_dps,
        novedad_incapacitante: x.novedad_incapacitante,
        novedad_tipo: x.novedad_tipo,
        modalidad: x.modalidad,
        sector: x.sector,
        nit: x.nit,
        departamento: x.departamento,
        municipio: x.municipio,
        posicion_dpto: x.posicion_dpto,
        producto_servicio: x.producto_servicio,
        necesidades: x.necesidades,
        resultado: x.resultado,
        actualizacion_datos: x.actualizacion_datos,
        completa_coordinacion: x.completa_coordinacion,
        doc_interventoria: x.doc_interventoria,
        observaciones: x.observaciones,
        ciiu: x.ciiu,
        actividad_no_financiable: x.actividad_no_financiable,
      },
      tenencia: tenenciaDe(x),
      retiro: await retiroDeUP({ query }, x.id_up),
      cierre: await cierreDeUP({ query }, x.id_up),
      fecha_actualizacion: x.fecha_actualizacion,
    },
  };
}

// Devuelve la cuenta de campo de cada nodo para completar las columnas de la lista; la cédula solo se entrega a
// la coordinación.
export async function listarGestores(usuario) {
  if (esGestor(usuario)) throw prohibido();
  const conCedula = usuario.rol === ROLES.COORDINADOR || usuario.rol === ROLES.TECNICO;
  const nodos = await nodosEnAlcance(usuario);
  const { rows } = await query(
    `WITH por_nodo AS (
       SELECT upper(btrim(tu.nodo)) AS nodo,
              mode() WITHIN GROUP (ORDER BY up.departamento) AS departamento,
              -- La modalidad llega como texto libre («M1», «M1 - Individual»): se agrupa por su código, como modalidadDe.
              array_remove(array_agg(DISTINCT coalesce('M' || substring(up.modalidad from '(?i)M\\s*([1-4])'),
                                                         nullif(btrim(up.modalidad), ''))), NULL) AS modalidades,
              count(*) FILTER (WHERE up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE)::int AS ups
         FROM unidades_productivas up
         JOIN triadas tu ON tu.id_triada = up.id_triada
        GROUP BY 1)
     SELECT DISTINCT ON (t.nodo)
            t.nodo, t.region, t.triada, g.nombre, g.cedula, g.correo, g.telefono,
            p.departamento, coalesce(p.modalidades, '{}') AS modalidades, coalesce(p.ups, 0) AS ups
       FROM gestores g
       JOIN triadas t ON t.id_triada = g.id_triada
       LEFT JOIN por_nodo p ON p.nodo = upper(btrim(t.nodo))
      WHERE g.activo AND ($1::text[] IS NULL OR upper(btrim(t.nodo)) = ANY($1))
      ORDER BY t.nodo, g.id_gestor`,
    [nodos],
  );
  return {
    ok: true,
    items: rows.map((g) => (conCedula ? g : { ...g, cedula: null })),
  };
}

// Devuelve la base de la herramienta de registro fotográfico: cuentas de campo por nodo y unidades por nodo con
// su representante.
export async function datosRegistroFotografico(usuario) {
  if (!esGestor(usuario) && usuario?.rol !== ROLES.COORDINADOR) {
    throw prohibido('Tu rol no usa el registro fotográfico.');
  }
  const nodos = await nodosEnAlcance(usuario);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const [g, u] = await Promise.all([
    query(
      `SELECT DISTINCT ON (upper(btrim(t.nodo))) upper(btrim(t.nodo)) AS nodo, g.nombre
         FROM gestores g JOIN triadas t ON t.id_triada = g.id_triada
        WHERE g.activo AND ($1::text[] IS NULL OR upper(btrim(t.nodo)) = ANY($1))
        ORDER BY upper(btrim(t.nodo)), g.id_gestor`,
      [nodos],
    ),
    query(
      `SELECT upper(btrim(t.nodo)) AS nodo, up.id_unico, up.nombre, coalesce(r.documento, r.documento_inicial) AS cedula
         FROM unidades_productivas up
         JOIN triadas t             ON t.id_triada = up.id_triada
         LEFT JOIN representantes r ON r.id_representante = up.id_representante
        WHERE ${alcance}
        ORDER BY up.nombre`,
      params,
    ),
  ]);
  const ups = {};
  for (const r of u.rows) (ups[r.nodo] ||= []).push([r.id_unico, r.nombre || '', r.cedula || '']);
  return { ok: true, item: { gestores: g.rows.map((r) => [r.nodo, r.nombre]), ups } };
}

// Impide registrar visitas, citas o cambios del plan a una unidad retirada.
export function exigirEnPrograma(up, que = 'registran más visitas, citas ni cambios del plan') {
  if (up?.retirada_dps) {
    throw new HttpError(409, `La unidad ${up.id_unico} está retirada del programa${up.novedad_tipo ? ` (${up.novedad_tipo})` : ''}: no se ${que}.`);
  }
}

// Busca una unidad por su ID único o por su documento y devuelve sus datos de ubicación, o null.
export async function buscarUP({ idUnico, documento }) {
  if (!idUnico && !documento) return null;
  const { rows } = await query(
    `SELECT up.id_up, up.id_unico, t.nodo, t.region, up.departamento, up.modalidad,
            up.nombre AS unidad_nombre, up.retirada_dps, up.novedad_tipo
       FROM unidades_productivas up
       LEFT JOIN triadas t        ON t.id_triada = up.id_triada
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE ($1::text IS NOT NULL AND (up.id_unico = $1 OR up.id_origen = $1))
         OR ($2::text IS NOT NULL AND (r.documento = $2 OR r.documento_inicial = $2))
      ORDER BY (up.id_unico = coalesce($1, '')) DESC
      LIMIT 1`,
    [idUnico ? String(idUnico) : null, documento ? String(documento) : null],
  );
  return rows[0] || null;
}
