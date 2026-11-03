// Expediente documental por etapas de cada unidad. Reconstruye, a partir de las tablas expedientes_up y
// expediente_etapas, la forma de documento que espera el frontend, y administra el cargue masivo de datos y su
// consulta, edición y eliminación.
import { query } from '../db.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';
import { ROLES } from '../config.js';
import { COLUMNAS_UP, condicionAlcance } from '../alcance.js';
import { registrar, registrarPorUnidad, corto, tope } from './actividad.js';
import { anotarLote } from './historialSubsanacion.js';

// Tope de unidades que se nombran en la fila de actividad de un cargue o borrado masivo; el antes y después de
// cada unidad va en su propia fila.
const TOPE_DETALLE = 200;

const exigirBitacora = (usuario) => {
  if (usuario?.rol === ROLES.COMPRAS) throw prohibido('Tu rol no tiene acceso a la Bitácora.');
};

// Devuelve una fila liviana por unidad con lo mínimo para el avance de la ruta.
export async function listarDocumentos(usuario) {
  exigirBitacora(usuario);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT e.id_origen AS id, up.id_unico, t.nodo,
            e.rit_tiene, e.evento_asistencia, e.pdf_carrito_estado,
            e.viabilidad_plan_inversion, e.aprobacion_plan_negocio,
            e.subsanaciones_comite, e.subsanaciones_proceso,
            coalesce(jsonb_object_agg(et.codigo, jsonb_build_object(
                'completa', ee.completa,
                'checks', CASE WHEN et.codigo IN ('compra', 'entrega') THEN ee.checks END
              )) FILTER (WHERE et.codigo IS NOT NULL), '{}'::jsonb) AS etapas
       FROM expedientes_up e
       JOIN unidades_productivas up   ON up.id_up = e.id_up
       LEFT JOIN triadas t            ON t.id_triada = up.id_triada
       LEFT JOIN expediente_etapas ee ON ee.id_expediente = e.id_expediente
       LEFT JOIN etapas et            ON et.id_etapa = ee.id_etapa
      WHERE ${alcance}
      GROUP BY e.id_expediente, up.id_unico, t.nodo
      ORDER BY e.id_expediente`,
    params,
  );

  const items = rows.map((r) => {
    const et = (c) => r.etapas[c] || {};
    return {
      id: r.id,
      id_unico: r.id_unico,
      nodo: r.nodo,
      tiene_rit: r.rit_tiene,
      evento: r.evento_asistencia,
      b00_completa: et('beneficiario').completa ?? null,
      v1_completa: et('visita1').completa ?? null,
      v2_completa: et('visita2').completa ?? null,
      fort_completa: et('fortalecimiento').completa ?? null,
      talleres_completa: et('talleres').completa ?? null,
      cap_completa: et('capitalizacion').completa ?? null,
      v3_completa: et('visita3').completa ?? null,
      compra_checks: et('compra').checks ?? null,
      entrega_checks: et('entrega').checks ?? null,
      pdf_carrito: r.pdf_carrito_estado,
      plan_inversion: r.viabilidad_plan_inversion,
      plan_negocio: r.aprobacion_plan_negocio,
      comite_subsanaciones: r.subsanaciones_comite,
      proceso_subsanacion: r.subsanaciones_proceso,
    };
  });
  return { ok: true, items };
}

// Arma el bloque de una etapa con solo los campos que tienen valor.
function bloqueEtapa(fila) {
  const b = {
    completa: fila.completa,
    archivos: fila.archivos ?? [],
    checks: fila.checks ?? [],
  };
  if (fila.total_archivos !== null) b.total_archivos = fila.total_archivos;
  if (fila.checklist !== null) b.checklist = fila.checklist;
  if (fila.fecha_reprogramacion !== null) b.fecha_reprogramacion = fila.fecha_reprogramacion;
  if (fila.estado_agendamiento !== null) b.estado_agendamiento = fila.estado_agendamiento;
  if (fila.modalidad !== null) b.modalidad = fila.modalidad;
  if (fila.resultado !== null) b.resultado = fila.resultado;
  if (fila.fecha !== null) {
    b[fila.codigo === 'visita1' ? 'fecha_visita' : 'fecha'] = fila.fecha;
  }
  return b;
}

// Devuelve el documento completo de una unidad a partir de su id de origen o ID único.
export async function obtenerDocumento(usuario, { id }) {
  exigirBitacora(usuario);
  if (!id) throw solicitudInvalida('Falta el parámetro id.');
  const params = [String(id)];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const cab = await query(
    `SELECT e.*, up.id_unico, t.nodo
       FROM expedientes_up e
       JOIN unidades_productivas up ON up.id_up = e.id_up
       LEFT JOIN triadas t          ON t.id_triada = up.id_triada
      WHERE (up.id_origen = $1 OR up.id_unico = $1 OR e.id_origen = $1)
        AND ${alcance}
      LIMIT 1`,
    params,
  );
  if (!cab.rows.length) throw noEncontrado('La U.P. no tiene expediente documental.');
  const e = cab.rows[0];

  const det = await query(
    `SELECT et.codigo, ee.*
       FROM expediente_etapas ee
       JOIN etapas et ON et.id_etapa = ee.id_etapa
      WHERE ee.id_expediente = $1
      ORDER BY et.orden`,
    [e.id_expediente],
  );

  const doc = {
    id: e.id_origen,
    id_unico: e.id_unico,
    nodo: e.nodo,
    doc_interventoria: e.doc_interventoria,
    observaciones: e.observaciones,
    control: {
      up_aprobada: e.up_aprobada,
      lote_up_aprobada: e.lote_up_aprobada,
      doc_completa_gestor: e.doc_completa_gestor,
      doc_completa_triada: e.doc_completa_triada,
      novedad_dps_gestor: e.novedad_dps_gestor,
      novedad_contacto_no_posible: e.novedad_contacto_no_posible,
    },
    rit: {
      tiene_rit: e.rit_tiene,
      fecha_enviado: e.rit_fecha_enviado,
      total_dias: e.rit_total_dias,
      ubicacion: e.rit_ubicacion,
      direccion: e.rit_direccion,
      latitud: e.rit_latitud,
      longitud: e.rit_longitud,
    },
    pdf_carrito: { estado: e.pdf_carrito_estado },
    viabilidad: { plan_inversion: e.viabilidad_plan_inversion },
    aprobacion: { plan_negocio: e.aprobacion_plan_negocio },
    subsanaciones: { comite: e.subsanaciones_comite, proceso_subsanacion: e.subsanaciones_proceso },
    evento: { asistencia: e.evento_asistencia },
    fecha_actualizacion: e.fecha_actualizacion,
  };

  for (const fila of det.rows) {
    const bloque = bloqueEtapa(fila);
    const [padre, hijo] = fila.codigo.split('.');
    if (!hijo) {
      doc[padre] = { ...(doc[padre] || {}), ...bloque };
    } else if (padre === 'fortalecimiento') {
      doc.fortalecimiento = doc.fortalecimiento || {};
      doc.fortalecimiento.modulos = { ...(doc.fortalecimiento.modulos || {}), [hijo]: bloque };
    } else {
      doc[padre] = { ...(doc[padre] || {}), [hijo]: bloque };
    }
  }

  return { ok: true, item: doc };
}

export const CAMPOS_CARGUE = {
  proceso_subsanacion: 'subsanaciones_proceso',
};

function exigirProfesionalDeDatos(usuario) {
  if (!usuario.general) {
    throw prohibido('Solo el Profesional de seguimiento e información puede cargar y administrar estos datos.');
  }
}

// Devuelve la columna de expedientes_up de un campo de cargue o un error 400 si el campo no está habilitado.
function columnaDeCargue(campo) {
  const columna = CAMPOS_CARGUE[campo];
  if (!columna) throw solicitudInvalida(`El campo "${campo}" no está habilitado para cargue.`);
  return columna;
}

// Aplica un cargue masivo de un campo y deja la entrada del histórico de la base maestra.
export async function aplicarCargue(usuario, { campo, filas, historial } = {}) {
  exigirProfesionalDeDatos(usuario);
  const columna = columnaDeCargue(campo);
  if (!Array.isArray(filas)) throw solicitudInvalida('"filas" debe ser una lista.');
  if (filas.length > 5000) throw solicitudInvalida('Máximo 5000 filas por envío.');

  let invalidos = 0;
  const porId = new Map();
  for (const f of filas) {
    const id = f && f.id_unico !== undefined && f.id_unico !== null ? String(f.id_unico).trim() : '';
    if (!id) { invalidos += 1; continue; }
    porId.set(id, txt(f.valor));
  }
  const ids = [...porId.keys()];
  const valores = ids.map((k) => porId.get(k));

  const { rows } = await query(
    `WITH datos AS (
        SELECT * FROM unnest($1::text[], $2::text[]) AS d (id_unico, valor)
     ), obj AS (
        SELECT d.id_unico, d.valor, e.id_expediente, e.${columna} AS actual
          FROM datos d
          LEFT JOIN unidades_productivas up ON up.id_unico = d.id_unico
          LEFT JOIN expedientes_up e        ON e.id_up = up.id_up
     ), upd AS (
        UPDATE expedientes_up e
           SET ${columna} = o.valor, fecha_actualizacion = now()
          FROM obj o
         WHERE e.id_expediente = o.id_expediente
           AND o.actual IS DISTINCT FROM o.valor
        RETURNING e.id_expediente
     )
     SELECT (SELECT count(*) FROM upd)::int AS actualizados,
            (SELECT count(*) FROM obj WHERE id_expediente IS NOT NULL
                AND actual IS NOT DISTINCT FROM valor)::int AS sin_cambios,
            (SELECT coalesce(json_agg(id_unico), '[]'::json) FROM obj
              WHERE id_expediente IS NULL) AS no_encontrados,
            (SELECT coalesce(json_agg(json_build_object('id_unico', c.id_unico, 'antes', c.actual, 'despues', c.valor)), '[]'::json)
               FROM (SELECT o.id_unico, o.actual, o.valor FROM obj o JOIN upd u ON u.id_expediente = o.id_expediente
                      ORDER BY o.id_unico) c) AS cambiados`,
    [ids, valores],
  );
  const r = rows[0];
  const lote = await registrar(usuario, {
    accion: 'cargue.aplicar', objeto: { tipo: 'campo', id: campo },
    cambios: {
      campo, actualizados: r.actualizados, sin_cambios: r.sin_cambios, invalidos, no_encontrados: r.no_encontrados.length,
      ids: tope(r.cambiados.map((c) => c.id_unico), TOPE_DETALLE),
    },
  });
  await registrarPorUnidad(usuario, {
    accion: 'cargue.aplicar', objeto: { tipo: 'campo', id: campo }, lote,
    filas: r.cambiados.map((c) => ({ idUnico: c.id_unico, campos: { [campo]: [corto(c.antes), corto(c.despues)] } })),
  });
  if (campo === 'proceso_subsanacion') {
    await anotarLote(usuario, historial, {
      cambios: r.cambiados, sin_cambios: r.sin_cambios, no_encontrados: r.no_encontrados.length,
    });
  }
  return {
    ok: true,
    actualizados: r.actualizados,
    sin_cambios: r.sin_cambios,
    invalidos,
    no_encontrados: r.no_encontrados,
    fallidos: [],
    errores: [],
  };
}

const POR_PAGINA = 50;

// Lista las unidades con el valor cargado de un campo, con filtros y paginación, el resumen con y sin dato y
// los valores existentes.
export async function listarCargados(usuario, { campo = 'proceso_subsanacion', q, estado, valor, pagina } = {}) {
  exigirProfesionalDeDatos(usuario);
  const col = columnaDeCargue(campo);
  const buscar = txt(q) ? `%${txt(q).slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const est = ['con', 'sin'].includes(estado) ? estado : 'todos';
  const pag = Math.max(1, Number.parseInt(pagina, 10) || 1);

  const { rows } = await query(
    `SELECT up.id_unico, up.nombre AS up_nombre, t.nodo, up.municipio,
            e.${col} AS valor, e.fecha_actualizacion,
            count(*) OVER ()::int AS total
       FROM expedientes_up e
       JOIN unidades_productivas up ON up.id_up = e.id_up
       LEFT JOIN triadas t          ON t.id_triada = up.id_triada
      WHERE ($1::text IS NULL OR up.id_unico ILIKE $1 ESCAPE '\\' OR up.nombre ILIKE $1 ESCAPE '\\'
             OR e.${col} ILIKE $1 ESCAPE '\\')
        AND ($2 = 'todos' OR ($2 = 'con' AND e.${col} IS NOT NULL) OR ($2 = 'sin' AND e.${col} IS NULL))
        AND ($3::text IS NULL OR e.${col} = $3)
      ORDER BY length(up.id_unico), up.id_unico
      LIMIT ${POR_PAGINA} OFFSET $4`,
    [buscar, est, txt(valor), (pag - 1) * POR_PAGINA],
  );
  const resumen = await query(
    `SELECT count(*)::int AS total, count(e.${col})::int AS con_dato FROM expedientes_up e`,
  );
  const valores = await query(
    `SELECT e.${col} AS valor, count(*)::int AS n FROM expedientes_up e
      WHERE e.${col} IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT 100`,
  );
  const total = rows[0]?.total ?? 0;
  return {
    ok: true,
    items: rows.map(({ total: _t, ...fila }) => fila),
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    por_pagina: POR_PAGINA,
    resumen: { total: resumen.rows[0].total, con_dato: resumen.rows[0].con_dato,
      sin_dato: resumen.rows[0].total - resumen.rows[0].con_dato },
    valores: valores.rows,
  };
}

// Cambia o agrega el valor cargado de una unidad.
export async function editarCargado(usuario, { campo = 'proceso_subsanacion', id_unico: idUnico, valor } = {}) {
  exigirProfesionalDeDatos(usuario);
  const col = columnaDeCargue(campo);
  const id = txt(idUnico);
  if (!id) throw solicitudInvalida('Falta la unidad (id_unico).');
  const nuevo = txt(valor);
  if (!nuevo) throw solicitudInvalida('Escribe el valor. Para dejarlo sin dato usa Eliminar.');
  if (nuevo.length > 500) throw solicitudInvalida('El valor es demasiado largo (máximo 500 caracteres).');

  const { rows } = await query(
    `WITH previo AS (
        SELECT e.id_expediente, e.${col} AS valor
          FROM expedientes_up e JOIN unidades_productivas up ON up.id_up = e.id_up
         WHERE up.id_unico = $1
     )
     UPDATE expedientes_up e SET ${col} = $2, fecha_actualizacion = now()
       FROM unidades_productivas up, previo p
      WHERE up.id_up = e.id_up AND up.id_unico = $1 AND p.id_expediente = e.id_expediente
      RETURNING up.id_unico, e.${col} AS valor, e.fecha_actualizacion, p.valor AS antes`,
    [id, nuevo],
  );
  if (!rows.length) throw noEncontrado('Esa unidad no existe o no tiene expediente.');
  const { antes, ...item } = rows[0];
  await registrar(usuario, {
    accion: 'cargue.editar', objeto: { tipo: 'campo', id: campo }, idUnico: item.id_unico,
    cambios: { campos: { [campo]: [corto(antes), corto(item.valor)] } },
  });
  return { ok: true, item };
}

// Borra el valor cargado de varias unidades, que vuelven a quedar sin dato, y devuelve cuántas cambiaron.
export async function eliminarCargados(usuario, { campo = 'proceso_subsanacion', ids } = {}) {
  exigirProfesionalDeDatos(usuario);
  const col = columnaDeCargue(campo);
  if (!Array.isArray(ids) || !ids.length) throw solicitudInvalida('Elige al menos una unidad.');
  if (ids.length > 5000) throw solicitudInvalida('Máximo 5000 unidades por envío.');
  const lista = [...new Set(ids.map((i) => txt(i)).filter(Boolean))];

  const { rows } = await query(
    `WITH previo AS (
        SELECT e.id_expediente, up.id_unico, e.${col} AS valor
          FROM expedientes_up e JOIN unidades_productivas up ON up.id_up = e.id_up
         WHERE up.id_unico = ANY($1) AND e.${col} IS NOT NULL
     ), upd AS (
        UPDATE expedientes_up e SET ${col} = NULL, fecha_actualizacion = now()
          FROM previo p
         WHERE e.id_expediente = p.id_expediente
        RETURNING e.id_expediente
     )
     SELECT p.id_unico, p.valor FROM previo p JOIN upd u ON u.id_expediente = p.id_expediente ORDER BY p.id_unico`,
    [lista],
  );
  const eliminados = rows.length;
  const lote = await registrar(usuario, {
    accion: 'cargue.eliminar', objeto: { tipo: 'campo', id: campo },
    cambios: { campo, eliminados, sin_cambios: lista.length - eliminados, ids: tope(rows.map((r) => r.id_unico), TOPE_DETALLE) },
  });
  await registrarPorUnidad(usuario, {
    accion: 'cargue.eliminar', objeto: { tipo: 'campo', id: campo }, lote,
    filas: rows.map((r) => ({ idUnico: r.id_unico, campos: { [campo]: [corto(r.valor), null] } })),
  });
  return { ok: true, eliminados, sin_cambios: lista.length - eliminados };
}
