// Seguimiento de la operación. Todo se calcula con lo que la plataforma registra (visitas, talleres, plan de
// capitalización, compras, entregas y cierre) y no con el cargue de Excel: avance de la ruta por unidad,
// indicadores contra metas, formación, alertas, panel, informes mensuales, exportación e índice documental.
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { COLUMNAS_UP, alcanceDe, condicionAlcance, exigirAlcance, normTexto } from '../alcance.js';
import { cumplimientoTalleres, PORCENTAJE_EXIGIDO } from './talleresFormacion.js';
import { APROBADOS, cargarCarrito, lineasDe, resumir, pesos } from './carrito.js';
import { TOTAL_PROGRAMA, metaDe, modalidadCorta } from './metas.js';
import { TOPE_UP_GESTOR } from './alistamiento.js';
import { CTE_UP_DE_KIT, ID_UP_DE_KIT, JOIN_UP_DE_KIT, LECTORES_DEFECTUOSOS, TIPOS_DEFECTO, actaPorId, pdfActa } from './defectuosos.js';
import { encolarCorreo } from './correo.js';
import { registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { datosDiagnostico } from './diagnostico.js';
import { comparacion, lineaBaseDe, resultadoCompleto } from './salida.js';
import { formacionDeUP } from './formacion.js';
import { diaColombia, hoyColombia } from './secciones.js';
import { CAUSALES } from './retiros.js';
import { leerVersion, mimeDe, urlArchivo, versionesDeUP } from './archivos.js';
import { fechasEntregaUPs } from './reglasVisitas.js';
import { leerCuenta } from '../acceso/cuentas.js';

const PANEL = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS];
const DETALLE = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS];
const POR_UP = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.GESTOR];
function exigir(usuario, roles, que) {
  if (!roles.includes(usuario?.rol)) throw prohibido(`Tu usuario no consulta ${que}.`);
}
// Convierte fechas y horas al día de Colombia en lugar de usar la zona de la sesión de Postgres.
const bogota = (col) => `(${col} AT TIME ZONE 'America/Bogota')`;

// Los pasos de la ruta de cada unidad.
export const PASOS = [
  { clave: 'rit', nombre: 'RIT', serie: 'identificacion' },
  { clave: 'visita1', nombre: 'Visita 1 cerrada', serie: 'diagnostico' },
  { clave: 'visita2', nombre: 'Visita 2 (diagnóstico) cerrada', serie: 'diagnostico' },
  { clave: 'formacion', nombre: '80 % de formación', serie: 'formacion' },
  { clave: 'plan', nombre: 'Plan de capitalización enviado', serie: 'capitalizacion' },
  { clave: 'viabilidad', nombre: 'Viabilidad de la interventoría', serie: 'capitalizacion' },
  { clave: 'aprobacion', nombre: 'Aprobado por el comité', serie: 'capitalizacion' },
  { clave: 'subsanacion', nombre: 'Subsanación pendiente', serie: 'capitalizacion', pendiente: true },
  { clave: 'compra', nombre: 'En compra', serie: 'capitalizacion' },
  { clave: 'entrega', nombre: 'Activos entregados', serie: 'entrega' },
  { clave: 'visita3', nombre: 'Visita 3 cerrada', serie: 'acompanamiento' },
  { clave: 'cierre', nombre: 'Asistió al evento de cierre', serie: 'acompanamiento' },
];
const PASOS_AVANCE = PASOS.filter((p) => !p.pendiente);
export const SERIES = {
  identificacion: 'Identificación', diagnostico: 'Diagnóstico', formacion: 'Formación', capitalizacion: 'Capitalización',
  entrega: 'Entrega', acompanamiento: 'Acompañamiento', novedades: 'Novedades', alistamiento: 'Alistamiento',
};
const ENVIADOS = ['enviado', 'revisado', 'viable', 'en_subsanacion', 'subsanado', 'aprobado', 'en_compra', 'entregado'];
const VIABLES = ['viable', 'en_subsanacion', 'subsanado', 'aprobado', 'en_compra', 'entregado'];
const N = (c) => `upper(translate(btrim(${c}), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))`;
const dia = (x) => (x ? diaColombia(x) : null);
const fechaHist = (h, estado) => { const x = (Array.isArray(h) ? h : []).filter((e) => e.a === estado).pop(); return x ? dia(x.en) : null; };
// Indica si la unidad está en el programa; sin dato cuenta como habilitada.
export const enPrograma = (f) => f.habilitada !== false && f.retirada_dps !== true;

// Devuelve las unidades del alcance con lo que la operación sabe de cada paso, todo en bloque.
async function filasUP(usuario, { region, departamento, modalidad, id_unico: idUnico } = {}) {
  const params = [];
  const alcance = usuario ? condicionAlcance(usuario, COLUMNAS_UP, params) : 'TRUE';
  params.push(txt(region) ? normTexto(region) : null); const pR = params.length;
  params.push(txt(departamento) ? normTexto(departamento) : null); const pD = params.length;
  params.push(modalidadCorta(modalidad)); const pM = params.length;
  params.push(txt(idUnico) || null); const pU = params.length;
  const deLaUnidad = (col) => `($${pU}::text IS NULL OR ${col} IN (SELECT u1.id_up FROM unidades_productivas u1 WHERE u1.id_unico = $${pU}))`;
  const { rows } = await query(
    `WITH vis AS (
       SELECT v.id_up, max(v.fecha_cierre) FILTER (WHERE v.tipo_visita = 'v1') AS v1, max(v.fecha_cierre) FILTER (WHERE v.tipo_visita = 'v2') AS v2,
              max(v.fecha_cierre) FILTER (WHERE v.tipo_visita = 'v3') AS v3
         FROM visitas v WHERE v.cerrada AND v.tipo_visita IN ('v1', 'v2', 'v3') AND ${deLaUnidad('v.id_up')} GROUP BY v.id_up
     ), cie AS (
       SELECT s.id_up, to_char(max(ev.fecha), 'YYYY-MM-DD') AS cierre FROM eventos_equipo_asistentes s JOIN eventos_equipo ev ON ev.id = s.evento_id
        WHERE ev.tipo = 'cierre' AND ${deLaUnidad('s.id_up')} GROUP BY s.id_up
     )
     SELECT up.id_up, up.id_unico, up.nombre, up.modalidad, up.departamento, up.municipio, up.habilitada, up.retirada_dps, t.nodo, t.region,
            ex.rit_tiene, vis.v1, vis.v2, vis.v3,
            c.estado AS plan_estado, c.historial AS plan_historial, c.subsanacion AS plan_subsanacion, c.saldo_disponible::float AS plan_saldo,
            cie.cierre, iu.doc->'logistica' AS logistica, e.linea_base, e.resultado
       FROM unidades_productivas up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
       LEFT JOIN expedientes_up ex ON ex.id_up = up.id_up
       LEFT JOIN up_evaluaciones e ON e.id_up = up.id_up
       LEFT JOIN vis ON vis.id_up = up.id_up
       LEFT JOIN cie ON cie.id_up = up.id_up
       LEFT JOIN items_ups iu ON iu.id_unico = up.id_unico AND iu.vigente
       LEFT JOIN LATERAL (SELECT k.estado, k.historial, k.subsanacion, k.saldo_disponible FROM carritos k WHERE k.id_up = up.id_up
                           ORDER BY (k.id_origen LIKE 'LOCAL-%') DESC, k.id_carrito DESC LIMIT 1) c ON TRUE
      WHERE (${alcance})
        AND ($${pR}::text IS NULL OR ${N('t.region')} = $${pR})
        AND ($${pD}::text IS NULL OR ${N('up.departamento')} = $${pD})
        AND ($${pM}::text IS NULL OR ${N('up.modalidad')} LIKE $${pM} || '%')
        AND ($${pU}::text IS NULL OR up.id_unico = $${pU})
      ORDER BY t.region NULLS LAST, t.nodo NULLS LAST, up.id_unico`, params);
  return rows;
}

// Calcula el porcentaje máximo que la unidad todavía puede alcanzar en un taller: lo cumplido más lo que sigue
// abierto.
const alcanzable = (x) => {
  const abiertas = x.modulos.filter((m) => !m.realizado).length + (x.encuesta_salida ? 0 : 1) + (x.entrega_final ? 0 : 1);
  return Math.round(((x.cumplidas + abiertas) / x.actividades) * 1000) / 10;
};

// Calcula el mejor cumplimiento de formación de cada unidad.
async function formacionPorUP(idsUp = null) {
  if (idsUp && !idsUp.length) return new Map();
  const { rows: talleres } = await query(
    `SELECT t.* FROM talleres_fortalecimiento t
      WHERE $1::text[] IS NULL OR t.id IN (SELECT t2.id FROM talleres_fortalecimiento t2 CROSS JOIN jsonb_array_elements(t2.participantes) p
                                            JOIN unnest($1::text[]) u(id) ON u.id = p->>'id_up')
      ORDER BY t.id`, [idsUp ? idsUp.map(String) : null]);
  const cumplimiento = await cumplimientoTalleres({ query }, talleres);
  const mejor = new Map();
  for (const t of talleres) {
    for (const x of Object.values(cumplimiento.get(t.id) || {})) {
      const previo = mejor.get(x.id_up);
      const terminado = x.modulos.every((m) => m.realizado);
      const max = Math.max(alcanzable(x), previo?.alcanzable ?? 0);
      if (!previo || x.porcentaje > previo.porcentaje) {
        mejor.set(x.id_up, { porcentaje: x.porcentaje, cumple: x.cumple_80, terminado, alcanzable: max, taller: t.nombre, modulos: x.modulos.map((m) => Boolean(m.valida)) });
      } else {
        previo.alcanzable = max;
      }
    }
  }
  return mejor;
}

// Calcula los 12 pasos de una unidad y su avance sobre los 11 que se logran.
export function pasosDe(f, form) {
  const e = f.plan_estado || null;
  const log = f.logistica || {};
  const p = {
    rit: { logrado: f.rit_tiene === true, fecha: null },
    visita1: { logrado: Boolean(f.v1), fecha: dia(f.v1) },
    visita2: { logrado: Boolean(f.v2), fecha: dia(f.v2) },
    formacion: { logrado: Boolean(form?.cumple), fecha: null, porcentaje: form ? form.porcentaje : null },
    plan: { logrado: ENVIADOS.includes(e), fecha: fechaHist(f.plan_historial, 'enviado') },
    viabilidad: { logrado: VIABLES.includes(e), fecha: fechaHist(f.plan_historial, 'viable') },
    aprobacion: { logrado: APROBADOS.includes(e), fecha: fechaHist(f.plan_historial, 'aprobado') },
    subsanacion: { logrado: e === 'en_subsanacion', fecha: f.plan_subsanacion?.plazo || null },
    compra: { logrado: ['en_compra', 'entregado'].includes(e) || log.comprado === true, fecha: fechaHist(f.plan_historial, 'en_compra') },
    entrega: { logrado: Boolean(f.entrega_fecha) || e === 'entregado' || log.entregado === true, fecha: f.entrega_fecha || null },
    visita3: { logrado: Boolean(f.v3), fecha: dia(f.v3) },
    cierre: { logrado: Boolean(f.cierre), fecha: f.cierre || null },
  };
  return { pasos: p, avance: PASOS_AVANCE.filter((x) => p[x.clave].logrado).length, de: PASOS_AVANCE.length };
}

const estadoPrograma = (f) => (f.retirada_dps ? 'retirada' : f.habilitada === false ? 'no_habilitada' : 'en_programa');

async function filasConPasos(usuario, filtros = {}) {
  const unaUP = Boolean(txt(filtros?.id_unico));
  const [filas, todas] = await Promise.all([filasUP(usuario, filtros), unaUP ? null : formacionPorUP()]);
  const [form, entregas] = await Promise.all([todas || formacionPorUP(filas.map((f) => f.id_up)), fechasEntregaUPs({ query }, filas.map((f) => f.id_unico))]);
  return filas.map((f) => {
    const g = { ...f, entrega_fecha: entregas.get(String(f.id_unico ?? '')) || null };
    return { ...g, formacion: form.get(f.id_up) || null, ...pasosDe(g, form.get(f.id_up)) };
  });
}

function resumenPasos(filas) {
  const activas = filas.filter(enPrograma);
  return PASOS.map((p) => {
    const n = activas.filter((f) => f.pasos[p.clave].logrado).length;
    return { clave: p.clave, nombre: p.nombre, n, porcentaje: activas.length ? Math.round((n / activas.length) * 1000) / 10 : 0 };
  });
}

// Devuelve cada unidad con sus 12 pasos y el resumen.
export async function rutaOperacion(usuario, filtros = {}) {
  exigir(usuario, DETALLE, 'el avance de la ruta por unidad');
  const filas = await filasConPasos(usuario, filtros);
  return {
    ok: true, pasos: PASOS, resumen: resumenPasos(filas), total: filas.filter(enPrograma).length,
    items: filas.map((f) => ({
      id_unico: f.id_unico, nombre: f.nombre, region: f.region, nodo: f.nodo, departamento: f.departamento, municipio: f.municipio,
      modalidad: modalidadCorta(f.modalidad), estado_programa: estadoPrograma(f), pasos: f.pasos, avance: f.avance, de: f.de,
      modulos: f.formacion ? f.formacion.modulos : null,
    })),
  };
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const promedio = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

function metricas(filas) {
  const activas = filas.filter(enPrograma);
  const n = activas.length;
  const cuenta = (clave) => activas.filter((f) => f.pasos[clave].logrado).length;
  const variaciones = activas.map((f) => (f.linea_base && f.resultado ? Object.fromEntries(comparacion(f.linea_base, resultadoCompleto(f.resultado)).map((c) => [c.clave, c])) : null)).filter(Boolean);
  const gestion = {};
  for (const clave of ['visita1', 'visita2', 'formacion', 'aprobacion', 'entrega', 'visita3', 'cierre']) gestion[clave] = { n: cuenta(clave), porcentaje: pct(cuenta(clave), n) };
  return {
    unidades: n,
    gestion,
    producto: {
      con_linea_base: activas.filter((f) => f.linea_base).length,
      con_salida: activas.filter((f) => f.resultado).length,
      variacion_ventas_pct: promedio(variaciones.map((v) => v.ventas_mensuales?.variacion_pct).filter(Number.isFinite)),
      variacion_clientes_pct: promedio(variaciones.map((v) => v.clientes_mes?.variacion_pct).filter(Number.isFinite)),
    },
  };
}

const AGRUPAR = { region: 'region', modalidad: 'modalidad', departamento: 'departamento' };
const SIN_DATO = { region: 'Sin región', modalidad: 'Sin modalidad', departamento: 'Sin departamento' };
const suma = (xs) => (xs.length ? xs.reduce((a, m) => a + m.meta, 0) : null);

// Devuelve las metas comparables con las unidades que se cuentan, según el alcance y los filtros.
async function metasComparables(usuario, filtros = {}) {
  const a = usuario ? alcanceDe(usuario) : null;
  if (a?.ninguno || a?.nodo) return { metas: [], departamento: null };
  const regiones = [a?.region, txt(filtros.region) ? normTexto(filtros.region) : null].filter(Boolean);
  const modalidades = [a?.modalidad ? modalidadCorta(a.modalidad) || a.modalidad : null, modalidadCorta(filtros.modalidad)].filter(Boolean);
  const departamentos = [a?.departamento, txt(filtros.departamento) ? normTexto(filtros.departamento) : null].filter(Boolean);
  const { rows } = await query('SELECT region, modalidad, departamento, meta FROM metas_cupos');
  const metas = rows.filter((m) => regiones.every((r) => normTexto(m.region) === r) && modalidades.every((x) => m.modalidad === x)
    && departamentos.every((d) => normTexto(m.departamento) === d));
  return { metas, departamento: departamentos[0] || null };
}

// Calcula los indicadores agrupados por región, modalidad o departamento con la meta de cupos y su
// cumplimiento.
function calcularIndicadores(filas, agrupar, { metas, departamento }) {
  const nivel = metas.filter((m) => (departamento ? Boolean(m.departamento) : !m.departamento));
  const clave = (f) => (agrupar === 'modalidad' ? (modalidadCorta(f.modalidad) || SIN_DATO.modalidad) : (f[agrupar] || SIN_DATO[agrupar]));
  const grupos = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!grupos.has(normTexto(k))) grupos.set(normTexto(k), { nombre: k, filas: [] });
    grupos.get(normTexto(k)).filas.push(f);
  }
  const metaGrupo = (g) => {
    if (agrupar === 'region') return suma(nivel.filter((m) => normTexto(m.region) === normTexto(g.nombre)));
    if (agrupar === 'modalidad') return suma(nivel.filter((m) => m.modalidad === g.nombre));
    return suma(metas.filter((m) => m.departamento && normTexto(m.departamento) === normTexto(g.nombre)));
  };
  const items = [...grupos.values()].map((g) => {
    const m = metricas(g.filas);
    const meta = metaGrupo(g);
    return { grupo: g.nombre, meta, cobertura_pct: meta ? pct(m.unidades, meta) : null, ...m };
  }).sort((a, b) => String(a.grupo).localeCompare(String(b.grupo), 'es'));
  const tot = metricas(filas);
  const totalMetas = nivel.reduce((a, m) => a + m.meta, 0);
  return { items, total: { ...tot, meta: totalMetas || null, cobertura_pct: totalMetas ? pct(tot.unidades, totalMetas) : null }, total_programa: TOTAL_PROGRAMA };
}

// Calcula la cobertura de cada región y modalidad con sus unidades, su meta y el porcentaje.
function coberturaRegionModalidad(filas, { metas, departamento }) {
  const nivel = metas.filter((m) => (departamento ? Boolean(m.departamento) : !m.departamento));
  const g = new Map();
  const poner = (region, modalidad) => {
    const k = `${normTexto(region)}|${modalidad}`;
    if (!g.has(k)) g.set(k, { region, modalidad, unidades: 0 });
    return g.get(k);
  };
  for (const m of nivel) poner(m.region, m.modalidad);
  for (const f of filas.filter(enPrograma)) poner(f.region || SIN_DATO.region, modalidadCorta(f.modalidad) || SIN_DATO.modalidad).unidades += 1;
  return [...g.values()].map((x) => {
    const meta = metaDe(nivel, { region: x.region, modalidad: x.modalidad, departamento: departamento || '' });
    return { ...x, meta, cobertura_pct: meta ? pct(x.unidades, meta) : null };
  }).sort((a, b) => `${a.region}|${a.modalidad}`.localeCompare(`${b.region}|${b.modalidad}`, 'es'));
}

// Indica que con un alcance por nodo no hay meta comparable, porque las metas van por región, modalidad y
// departamento.
const metasPorNodo = (usuario) => Boolean(usuario && alcanceDe(usuario)?.nodo);

// Devuelve los indicadores agrupados según los filtros recibidos.
export async function indicadores(usuario, { agrupar = 'region', ...entrada } = {}) {
  exigir(usuario, PANEL, 'los indicadores');
  const a = AGRUPAR[txt(agrupar)] || 'region';
  const filtros = entrada;
  const [filas, metas] = await Promise.all([filasConPasos(usuario, filtros), metasComparables(usuario, filtros)]);
  const r = calcularIndicadores(filas, a, metas);
  return { ok: true, agrupar: a, items: r.items, total: r.total, total_programa: r.total_programa,
    por_region_modalidad: coberturaRegionModalidad(filas, metas), metas_por_nodo: metasPorNodo(usuario) };
}

// Devuelve cada unidad con su porcentaje de formación y el resumen por región y por modalidad.
export async function reporteFormacion(usuario, filtros = {}) {
  exigir(usuario, DETALLE, 'el reporte de formación');
  const filas = (await filasConPasos(usuario, filtros)).filter(enPrograma);
  const conFormacion = filas.filter((f) => f.formacion);
  const resumen = (campo) => {
    const g = new Map();
    for (const f of conFormacion) {
      const k = campo === 'modalidad' ? (modalidadCorta(f.modalidad) || 'Sin modalidad') : (f.region || 'Sin región');
      const x = g.get(k) || { grupo: k, en_formacion: 0, cumplen: 0 };
      x.en_formacion += 1; if (f.formacion.cumple) x.cumplen += 1;
      g.set(k, x);
    }
    return [...g.values()].map((x) => ({ ...x, porcentaje: pct(x.cumplen, x.en_formacion) })).sort((a, b) => a.grupo.localeCompare(b.grupo, 'es'));
  };
  return {
    ok: true,
    items: conFormacion.map((f) => ({ id_unico: f.id_unico, nombre: f.nombre, region: f.region, nodo: f.nodo, modalidad: modalidadCorta(f.modalidad),
      taller: f.formacion.taller, porcentaje: f.formacion.porcentaje, cumple: f.formacion.cumple, taller_terminado: f.formacion.terminado })),
    por_region: resumen('region'), por_modalidad: resumen('modalidad'),
    total: { unidades: filas.length, en_formacion: conFormacion.length, cumplen: conFormacion.filter((f) => f.formacion.cumple).length,
      porcentaje: pct(conFormacion.filter((f) => f.formacion.cumple).length, conFormacion.length) },
  };
}

// Días después de la fecha programada tras los que una visita sin cerrar genera una alerta.
export const DIAS_VISITA_ABIERTA = 15;
export const DIAS_V3 = 30;
export const TIPOS_ALERTA = {
  visita_abierta: { nombre: `Visita sin cerrar ${DIAS_VISITA_ABIERTA} días después de la fecha programada`, nivel: 'media' },
  v3_pendiente: { nombre: `Visita 3 pendiente: pasaron ${DIAS_V3} días de la entrega`, nivel: 'alta' },
  sin_80: { nombre: 'Taller terminado sin poder llegar al 80 % de formación', nivel: 'alta' },
  subsanacion_vencida: { nombre: 'Subsanación del plan vencida', nivel: 'alta' },
  excede_presupuesto: { nombre: 'Plan que se pasa del presupuesto', nivel: 'media' },
  gestor_cerca_tope: { nombre: `Gestor con ${Math.round(TOPE_UP_GESTOR * 0.9)} o más unidades (tope ${TOPE_UP_GESTOR})`, nivel: 'media' },
  defectuoso_abierto: { nombre: 'Acta de elementos defectuosos sin reemplazo', nivel: 'media' },
};
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Calcula las alertas de la ruta de las unidades del alcance.
async function calcularAlertas(usuario, conPasos = null) {
  const hoy = hoyColombia();
  const filas = (conPasos || await filasConPasos(usuario)).filter(enPrograma);
  const base = (f) => ({ id_unico: f.id_unico, unidad: f.nombre, region: f.region, nodo: f.nodo });
  const items = [];
  for (const f of filas) {
    const p = f.pasos;
    if (p.entrega.logrado && p.entrega.fecha && !p.visita3.logrado && sumarDias(p.entrega.fecha, DIAS_V3) <= hoy) {
      items.push({ tipo: 'v3_pendiente', ...base(f), detalle: `Entregado el ${p.entrega.fecha}; la Visita 3 va desde el ${sumarDias(p.entrega.fecha, DIAS_V3)}.`, desde: sumarDias(p.entrega.fecha, DIAS_V3) });
    }
    if (f.formacion?.terminado && !f.formacion.cumple && f.formacion.alcanzable < PORCENTAJE_EXIGIDO) {
      items.push({ tipo: 'sin_80', ...base(f), detalle: `${f.formacion.taller}: ${f.formacion.porcentaje} % de formación; ya no puede llegar al ${PORCENTAJE_EXIGIDO} % (máximo ${f.formacion.alcanzable} %).`, desde: null });
    }
    if (f.plan_estado === 'en_subsanacion' && f.plan_subsanacion?.plazo && f.plan_subsanacion.plazo < hoy) {
      items.push({ tipo: 'subsanacion_vencida', ...base(f), detalle: `El plazo venció el ${f.plan_subsanacion.plazo}.`, desde: f.plan_subsanacion.plazo });
    }
    if (Number.isFinite(f.plan_saldo) && f.plan_saldo < 0 && !APROBADOS.includes(f.plan_estado)) {
      items.push({ tipo: 'excede_presupuesto', ...base(f), detalle: `Se pasa por ${pesos(-f.plan_saldo)}.`, desde: null });
    }
  }
  const params = [];
  const alcance = usuario ? condicionAlcance(usuario, COLUMNAS_UP, params) : 'TRUE';
  params.push(sumarDias(hoy, -DIAS_VISITA_ABIERTA));
  const { rows: abiertas } = await query(
    `SELECT v.tipo_visita, v.documento->'programacion'->>'fecha_visita' AS fecha, up.id_unico, up.nombre, t.region, t.nodo
       FROM visitas v JOIN unidades_productivas up ON up.id_up = v.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE NOT v.cerrada AND v.tipo_visita IN ('v1', 'v2', 'v3') AND up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE AND (${alcance})
        AND (v.documento->'programacion'->>'fecha_visita') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND (v.documento->'programacion'->>'fecha_visita') < $${params.length}`, params);
  for (const v of abiertas) {
    items.push({ tipo: 'visita_abierta', id_unico: v.id_unico, unidad: v.nombre, region: v.region, nodo: v.nodo,
      detalle: `${v.tipo_visita.toUpperCase()} programada para el ${v.fecha} y sin cerrar.`, desde: v.fecha });
  }
  const pG = [];
  const alcanceG = usuario ? condicionAlcance(usuario, COLUMNAS_UP, pG) : 'TRUE';
  const { rows: gestores } = await query(
    `SELECT t.nodo, t.region, count(*)::int AS n FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada
      WHERE up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE AND (${alcanceG})
      GROUP BY t.nodo, t.region HAVING count(*) >= ${Math.round(TOPE_UP_GESTOR * 0.9)}`, pG);
  for (const g of gestores) items.push({ tipo: 'gestor_cerca_tope', id_unico: null, unidad: null, region: g.region, nodo: g.nodo, detalle: `El nodo ${g.nodo} tiene ${g.n} unidades habilitadas.`, desde: null });
  const pK = [];
  const alcanceK = usuario ? condicionAlcance(usuario, COLUMNAS_UP, pK) : 'TRUE';
  const { rows: actas } = await query(
    `WITH ${CTE_UP_DE_KIT}
     SELECT n.id, n.estado, n.creado, up.id_unico, up.nombre, t.region, t.nodo
       FROM inventario.kit_novedades n
       JOIN LATERAL (SELECT combo_id FROM inventario.kit_novedad_kits WHERE novedad_id = n.id ORDER BY combo_id LIMIT 1) k ON TRUE
       JOIN inventario.combos c ON c.id = k.combo_id
       ${JOIN_UP_DE_KIT('c.nombre')}
       LEFT JOIN public.unidades_productivas up ON up.id_unico = COALESCE(n.id_unico, ${ID_UP_DE_KIT()})
       LEFT JOIN public.triadas t ON t.id_triada = up.id_triada
      WHERE n.tipo = ANY($${pK.length + 1}::text[]) AND COALESCE(n.estado, 'reportada') IN ('reportada', 'devuelta') AND (${alcanceK})
        AND (up.id_up IS NULL OR (up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE))`, [...pK, TIPOS_DEFECTO]);
  for (const a of actas) {
    items.push({ tipo: 'defectuoso_abierto', id_unico: a.id_unico, unidad: a.nombre, region: a.region, nodo: a.nodo,
      detalle: `Acta ${String(a.id).padStart(5, '0')} ${(a.estado || 'reportada') === 'reportada' ? 'reportada' : 'devuelta al proveedor'} el ${dia(a.creado)}.`, desde: dia(a.creado) });
  }
  return items.map((x) => ({ ...x, nombre_tipo: TIPOS_ALERTA[x.tipo].nombre, nivel: TIPOS_ALERTA[x.tipo].nivel }));
}

// Resume las alertas por tipo y región.
function resumenAlertas(items) {
  const porTipo = Object.fromEntries(Object.keys(TIPOS_ALERTA).map((k) => [k, items.filter((x) => x.tipo === k).length]));
  const porRegion = {};
  for (const x of items) porRegion[x.region || 'Sin región'] = (porRegion[x.region || 'Sin región'] || 0) + 1;
  return { total: items.length, por_tipo: porTipo, por_region: porRegion };
}

// Devuelve cada alerta del alcance con el resumen por tipo y región.
export async function alertas(usuario) {
  exigir(usuario, PANEL, 'las alertas');
  const items = await calcularAlertas(usuario);
  return { ok: true, tipos: TIPOS_ALERTA, resumen: resumenAlertas(items), items };
}

// Devuelve el panel agregado y en tiempo real, sin datos personales.
export async function panel(usuario) {
  exigir(usuario, PANEL, 'el panel de seguimiento');
  const [filas, metas] = await Promise.all([filasConPasos(usuario), metasComparables(usuario)]);
  const porRegion = calcularIndicadores(filas, 'region', metas);
  const porModalidad = calcularIndicadores(filas, 'modalidad', metas);
  const items = await calcularAlertas(usuario, filas);
  const { rows: informes } = await query('SELECT id, periodo, generado_en FROM informes_mensuales ORDER BY periodo DESC LIMIT 12');
  return {
    ok: true, actualizado: new Date().toISOString(), total_programa: TOTAL_PROGRAMA,
    ruta: resumenPasos(filas), total: porRegion.total, por_region: porRegion.items, por_modalidad: porModalidad.items,
    por_region_modalidad: coberturaRegionModalidad(filas, metas), metas_por_nodo: metasPorNodo(usuario),
    alertas: resumenAlertas(items), tipos_alerta: TIPOS_ALERTA, informes,
  };
}

// Valida un periodo AAAA-MM y devuelve su primer día y el primer día del mes siguiente.
function limitesPeriodo(periodo) {
  const p = txt(periodo);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p || '')) throw solicitudInvalida('El periodo debe ser un mes AAAA-MM.');
  const [a, m] = p.split('-').map(Number);
  const hasta = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  return { periodo: p, desde: `${p}-01`, hasta };
}
const enRango = (fecha, { desde, hasta }) => Boolean(fecha) && fecha >= desde && fecha < hasta;
export const METRICAS_MES = {
  visita1: 'Visitas 1 cerradas', visita2: 'Visitas 2 cerradas', visita3: 'Visitas 3 cerradas', sesiones: 'Unidades que asistieron a una sesión de formación',
  aprobacion: 'Planes aprobados por el comité', compra: 'Planes que pasaron a compra', entrega: 'Entregas', cierre: 'Asistentes a eventos de cierre',
  retiros: 'Retiros', reemplazos: 'Reemplazos', casos: 'Casos de éxito y lecciones', comerciales: 'Gestiones comerciales',
};
// Métricas sin fecha propia, como el 80 % de formación, que se cuentan a la fecha de generación.
export const ACUMULADO_SIN_FECHA = ['formacion'];
export const METRICAS_ACUMULADO = { visita1: 'V1 cerradas', visita2: 'V2 cerradas', formacion: 'Con 80 % de formación a la fecha de generación', aprobacion: 'Planes aprobados', entrega: 'Entregadas', visita3: 'V3 cerradas', cierre: 'En evento de cierre' };
const notaAcumulado = (r) => `El acumulado cuenta lo logrado antes del ${r.hasta}; el 80 % de formación y las unidades en el programa son a la fecha de generación del informe.`;

// Calcula el consolidado del periodo por región, departamento y modalidad: lo hecho en el mes y el acumulado.
export async function consolidadoMensual(usuario, { periodo } = {}) {
  if (usuario) exigir(usuario, DETALLE, 'el informe mensual');
  const r = limitesPeriodo(periodo);
  const filas = await filasConPasos(usuario);
  const ids = filas.map((f) => f.id_up);
  const contarPor = async (sql) => new Map((await query(sql, [ids, r.desde, r.hasta])).rows.map((x) => [x.id_up, x.n]));
  const enMes = (col) => `${bogota(col)} >= $2::date AND ${bogota(col)} < $3::date`;
  const [sesiones, retiros, reemplazos, casos, comerciales] = await Promise.all([
    contarPor(`SELECT (p->>'id_up')::int AS id_up, count(DISTINCT e.id)::int AS n FROM talleres_encuentros e JOIN talleres_fortalecimiento t ON t.id = e.taller_id,
                 jsonb_array_elements(t.participantes) p WHERE (p->>'id_up')::int = ANY($1::int[]) AND e.asistencia ? ('up:' || (p->>'id_up'))
                 AND ${enMes('e.realizado_en')} GROUP BY 1`),
    contarPor(`SELECT id_up, count(*)::int AS n FROM up_retiros WHERE tipo = 'retiro' AND id_up = ANY($1::int[]) AND ${enMes('creado_en')} GROUP BY 1`),
    contarPor(`SELECT id_up, count(*)::int AS n FROM up_retiros WHERE tipo = 'reemplazo' AND id_up = ANY($1::int[]) AND ${enMes('creado_en')} GROUP BY 1`),
    contarPor('SELECT id_up, count(*)::int AS n FROM casos_exito WHERE id_up = ANY($1::int[]) AND fecha >= $2::date AND fecha < $3::date GROUP BY 1'),
    contarPor('SELECT id_up, count(*)::int AS n FROM gestiones_comerciales WHERE id_up = ANY($1::int[]) AND fecha >= $2::date AND fecha < $3::date GROUP BY 1'),
  ]);
  const grupos = new Map();
  for (const f of filas) {
    const clave = [f.region || 'Sin región', f.departamento || 'Sin departamento', modalidadCorta(f.modalidad) || 'Sin modalidad'];
    const k = clave.map(normTexto).join('|');
    if (!grupos.has(k)) {
      grupos.set(k, { region: clave[0], departamento: clave[1], modalidad: clave[2], unidades: 0,
        periodo: Object.fromEntries(Object.keys(METRICAS_MES).map((m) => [m, 0])), acumulado: Object.fromEntries(Object.keys(METRICAS_ACUMULADO).map((m) => [m, 0])) });
    }
    const g = grupos.get(k);
    if (enPrograma(f)) {
      g.unidades += 1;
      for (const m of Object.keys(METRICAS_ACUMULADO)) {
        const x = f.pasos[m];
        if (x.logrado && (ACUMULADO_SIN_FECHA.includes(m) || (x.fecha && x.fecha < r.hasta))) g.acumulado[m] += 1;
      }
    }
    for (const m of ['visita1', 'visita2', 'visita3', 'aprobacion', 'compra', 'entrega', 'cierre']) if (enRango(f.pasos[m].fecha, r)) g.periodo[m] += 1;
    if (sesiones.get(f.id_up)) g.periodo.sesiones += 1;
    g.periodo.retiros += retiros.get(f.id_up) || 0;
    g.periodo.reemplazos += reemplazos.get(f.id_up) || 0;
    g.periodo.casos += casos.get(f.id_up) || 0;
    g.periodo.comerciales += comerciales.get(f.id_up) || 0;
  }
  const items = [...grupos.values()].sort((a, b) => `${a.region}|${a.departamento}|${a.modalidad}`.localeCompare(`${b.region}|${b.departamento}|${b.modalidad}`, 'es'));
  const suma = (campo, m) => items.reduce((a, g) => a + g[campo][m], 0);
  const totales = { unidades: items.reduce((a, g) => a + g.unidades, 0),
    periodo: Object.fromEntries(Object.keys(METRICAS_MES).map((m) => [m, suma('periodo', m)])),
    acumulado: Object.fromEntries(Object.keys(METRICAS_ACUMULADO).map((m) => [m, suma('acumulado', m)])) };
  return { ok: true, periodo: r.periodo, desde: r.desde, hasta: r.hasta, metricas_mes: METRICAS_MES, metricas_acumulado: METRICAS_ACUMULADO,
    acumulado_sin_fecha: ACUMULADO_SIN_FECHA, nota: notaAcumulado(r), items, totales };
}

// Genera el Excel del informe mensual.
async function excelMensual(c) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Bitácora Memories';
  const hoja = libro.addWorksheet(`Informe ${c.periodo}`);
  hoja.columns = [
    { header: 'Región', key: 'region', width: 16 }, { header: 'Departamento', key: 'departamento', width: 18 }, { header: 'Modalidad', key: 'modalidad', width: 10 },
    { header: 'Unidades en el programa a la fecha de generación', key: 'unidades', width: 14 },
    ...Object.entries(c.metricas_mes).map(([k, v]) => ({ header: `${v} (mes)`, key: `m_${k}`, width: 14 })),
    ...Object.entries(c.metricas_acumulado).map(([k, v]) => ({ header: `${v} (acumulado)`, key: `a_${k}`, width: 14 })),
  ];
  const fila = (g) => ({ region: g.region, departamento: g.departamento, modalidad: g.modalidad, unidades: g.unidades,
    ...Object.fromEntries(Object.keys(c.metricas_mes).map((k) => [`m_${k}`, g.periodo[k]])),
    ...Object.fromEntries(Object.keys(c.metricas_acumulado).map((k) => [`a_${k}`, g.acumulado[k]])) });
  for (const g of c.items) hoja.addRow(fila(g));
  const total = hoja.addRow(fila({ region: 'Total', departamento: '', modalidad: '', ...c.totales }));
  total.font = { bold: true };
  hoja.addRow([]);
  hoja.addRow([c.nota || notaAcumulado(c)]).font = { italic: true };
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from(await libro.xlsx.writeBuffer());
}

// Genera el PDF del informe mensual.
async function pdfMensual(c) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `Informe técnico mensual ${c.periodo}` } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));
  doc.fontSize(15).text(`Informe técnico mensual · ${c.periodo}`);
  doc.fontSize(9).fillColor('#555').text(`Fundación Memories · del ${c.desde} al ${c.hasta} (sin incluir) · generado el ${diaColombia(new Date())} con la operación registrada en la plataforma`).fillColor('#000');
  doc.moveDown(0.6).fontSize(11).text('Totales del programa');
  doc.fontSize(9).text(`Unidades en el programa (a la fecha de generación): ${c.totales.unidades}`);
  doc.text(`En el mes: ${Object.entries(c.metricas_mes).map(([k, v]) => `${v}: ${c.totales.periodo[k]}`).join(' · ')}`);
  doc.text(`Acumulado al ${c.hasta} (sin incluir): ${Object.entries(c.metricas_acumulado).map(([k, v]) => `${v}: ${c.totales.acumulado[k]}`).join(' · ')}`);
  doc.fillColor('#555').text(c.nota || notaAcumulado(c)).fillColor('#000');
  doc.moveDown(0.6).fontSize(11).text('Por región, departamento y modalidad');
  doc.fontSize(8);
  for (const g of c.items) {
    if (doc.y > 540) doc.addPage();
    doc.font('Helvetica-Bold').text(`${g.region} · ${g.departamento} · ${g.modalidad} · ${g.unidades} unidades`).font('Helvetica');
    doc.text(`Mes: ${Object.entries(c.metricas_mes).map(([k, v]) => `${v} ${g.periodo[k]}`).join(' · ')}`);
    doc.text(`Acumulado: ${Object.entries(c.metricas_acumulado).map(([k, v]) => `${v} ${g.acumulado[k]}`).join(' · ')}`);
    doc.moveDown(0.3);
  }
  doc.end();
  await fin;
  return Buffer.concat(partes);
}

// Genera el informe del mes en Excel o PDF en el momento.
export async function archivoMensual(usuario, { periodo, formato } = {}) {
  const c = await consolidadoMensual(usuario, { periodo });
  return txt(formato) === 'pdf'
    ? { buffer: await pdfMensual(c), nombre: `informe-mensual-${c.periodo}.pdf`, tipo: 'application/pdf' }
    : { buffer: await excelMensual(c), nombre: `informe-mensual-${c.periodo}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

// Devuelve el mes anterior al día de Colombia, por ejemplo 2026-10-24 da 2026-09.
export function mesAnterior(hoy = hoyColombia()) {
  const [a, m] = hoy.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

// Devuelve el día del primer registro de la operación en la plataforma, o null si no hay ninguno.
async function primeraOperacion() {
  const { rows: [r] } = await query(
    `SELECT to_char(${bogota(`LEAST(
       (SELECT min(fecha) FROM actividad WHERE usuario_rol IS DISTINCT FROM 'sistema'),
       (SELECT min(fecha_cierre) FROM visitas WHERE cerrada),
       (SELECT min(realizado_en) FROM talleres_encuentros),
       (SELECT min(fecha) FROM inventario.entregas_kits),
       (SELECT min(creado_en) FROM up_retiros),
       (SELECT min(fecha)::timestamp AT TIME ZONE 'America/Bogota' FROM eventos_equipo),
       (SELECT min(fecha)::timestamp AT TIME ZONE 'America/Bogota' FROM casos_exito),
       (SELECT min(fecha)::timestamp AT TIME ZONE 'America/Bogota' FROM gestiones_comerciales))`)}, 'YYYY-MM-DD') AS dia`);
  return r?.dia || null;
}

// Trabajo programado: si el informe del mes anterior no existe, lo genera para todo el programa, lo guarda y
// avisa por correo al nivel nacional.
export async function generarInformeProgramado({ hoy = hoyColombia() } = {}) {
  const periodo = mesAnterior(hoy);
  const { rows: [{ n }] } = await query('SELECT count(*)::int AS n FROM unidades_productivas');
  if (!n) return { periodo, generado: false };
  const { rows: ya } = await query('SELECT 1 FROM informes_mensuales WHERE periodo = $1', [periodo]);
  if (ya.length) return { periodo, generado: false };
  const primera = await primeraOperacion();
  if (!primera || limitesPeriodo(periodo).hasta <= primera) return { periodo, generado: false };
  const c = await consolidadoMensual(null, { periodo });
  const [xlsx, pdf] = await Promise.all([excelMensual(c), pdfMensual(c)]);
  const id = await transaccion(async (db) => {
    const { rows: [r] } = await db.query(
      `INSERT INTO informes_mensuales (periodo, xlsx, pdf, resumen, generado_por) VALUES ($1, $2, $3, $4, 'Trabajo programado')
       ON CONFLICT (periodo) DO NOTHING RETURNING id`, [periodo, xlsx, pdf, JSON.stringify(c.totales)]);
    if (!r) return null;
    const { rows: correos } = await db.query(
      `SELECT correo FROM superadmins WHERE activo AND correo IS NOT NULL
        UNION SELECT correo FROM coordinadores WHERE activo AND tipo = 'coordinador_datos' AND correo IS NOT NULL`);
    await encolarCorreo(db, {
      para: correos.map((x) => x.correo), origen: 'informe_mensual', referencia: periodo,
      asunto: `Informe técnico mensual ${periodo} disponible`,
      texto: `El informe técnico mensual de ${periodo} quedó listo en la Bitácora (Seguimiento › Informes), en Excel y PDF.\n\nUnidades en el programa: ${c.totales.unidades}. En el mes: ${Object.entries(c.metricas_mes).map(([k, v]) => `${v}: ${c.totales.periodo[k]}`).join('; ')}.`,
    });
    await db.query(
      `INSERT INTO actividad (accion, resultado, usuario_sub, usuario_nombre, usuario_rol, objeto_tipo, objeto_id, cambios)
       VALUES ('informe.mensual', 'ok', 'sistema', 'Trabajo programado', 'sistema', 'informe_mensual', $1, $2)`,
      [String(r.id), JSON.stringify({ periodo, campos: { informe: [null, periodo] } })]);
    return r.id;
  });
  if (!id) return { periodo, generado: false };
  return { periodo, generado: true, id };
}

// Lista los informes mensuales guardados.
export async function listarInformes(usuario) {
  exigir(usuario, PANEL, 'los informes');
  const { rows } = await query('SELECT id, periodo, resumen, generado_por, generado_en FROM informes_mensuales ORDER BY periodo DESC LIMIT 60');
  return { ok: true, items: rows };
}

// Devuelve el archivo de un informe mensual guardado, en Excel o PDF.
export async function informeArchivo(usuario, { id, formato } = {}) {
  exigir(usuario, PANEL, 'los informes');
  const iid = entero(id);
  if (!iid || iid < 1 || iid > 2147483647) throw noEncontrado('El informe no existe.');
  const pdf = txt(formato) === 'pdf';
  const { rows: [r] } = await query(`SELECT periodo, ${pdf ? 'pdf' : 'xlsx'} AS archivo FROM informes_mensuales WHERE id = $1`, [iid]);
  if (!r) throw noEncontrado('El informe no existe.');
  return { buffer: r.archivo, nombre: `informe-mensual-${r.periodo}.${pdf ? 'pdf' : 'xlsx'}`,
    tipo: pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

// Diccionario de los campos del archivo de intercambio.
export const DICCIONARIO_KOKAN = [
  { campo: 'tipo_documento', descripcion: 'Tipo de documento del representante (CC por defecto)', formato: 'Texto' },
  { campo: 'documento', descripcion: 'Número de documento del representante, sin puntos', formato: 'Texto' },
  { campo: 'nombre_representante', descripcion: 'Nombres y apellidos del representante', formato: 'Texto' },
  { campo: 'id_unico', descripcion: 'ID único de la unidad productiva en la Bitácora', formato: 'Texto' },
  { campo: 'nombre_unidad', descripcion: 'Nombre de la unidad productiva', formato: 'Texto' },
  { campo: 'region', descripcion: 'Región del programa', formato: 'Texto' },
  { campo: 'departamento', descripcion: 'Departamento', formato: 'Texto' },
  { campo: 'municipio', descripcion: 'Municipio', formato: 'Texto' },
  { campo: 'modalidad', descripcion: 'Modalidad de la unidad (M1 a M4)', formato: 'M1 | M2 | M3 | M4' },
  { campo: 'etapa', descripcion: 'Etapa de la ruta (serie documental)', formato: 'Identificación | Diagnóstico | Formación | Capitalización | Entrega | Acompañamiento' },
  { campo: 'actividad', descripcion: 'Actividad de la ruta', formato: 'Texto (uno de los 12 pasos)' },
  { campo: 'fecha', descripcion: 'Fecha en que se cumplió la actividad (vacía si la actividad no tiene fecha)', formato: 'AAAA-MM-DD' },
  { campo: 'estado', descripcion: 'Estado de la actividad (solo se exportan las cumplidas)', formato: 'Cumplida' },
];

// Exporta una fila por unidad y actividad cumplida para el archivo de intercambio.
export async function exportarKokan(usuario, { desde, hasta } = {}) {
  if (!usuario?.general) throw prohibido('La exportación a KOKAN la hace el Coordinador general o el Profesional de seguimiento.');
  const d = txt(desde)?.slice(0, 10) || null;
  const h = txt(hasta)?.slice(0, 10) || null;
  if ((d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) || (h && !/^\d{4}-\d{2}-\d{2}$/.test(h))) throw solicitudInvalida('Las fechas deben ser AAAA-MM-DD.');
  const filas = await filasConPasos(usuario);
  const { rows: reps } = await query(
    `SELECT up.id_up, r.documento, concat_ws(' ', r.nombre1, r.nombre2, r.apellido1, r.apellido2) AS nombre
       FROM unidades_productivas up LEFT JOIN representantes r ON r.id_representante = up.id_representante WHERE up.id_up = ANY($1::int[])`,
    [filas.map((f) => f.id_up)]);
  const rep = new Map(reps.map((r) => [r.id_up, r]));
  const items = [];
  for (const f of filas) {
    for (const p of PASOS) {
      const x = f.pasos[p.clave];
      if (p.pendiente || !x.logrado) continue;
      if ((d || h) && (!x.fecha || (d && x.fecha < d) || (h && x.fecha > h))) continue;
      items.push({ tipo_documento: 'CC', documento: rep.get(f.id_up)?.documento || '', nombre_representante: rep.get(f.id_up)?.nombre || '',
        id_unico: f.id_unico, nombre_unidad: f.nombre || '', region: f.region || '', departamento: f.departamento || '', municipio: f.municipio || '',
        modalidad: modalidadCorta(f.modalidad) || '', etapa: SERIES[p.serie], actividad: p.nombre, fecha: x.fecha || '', estado: 'Cumplida' });
    }
  }
  await registrar(usuario, { accion: 'kokan.exportar', objeto: { tipo: 'kokan', id: null }, idUnico: null, cambios: { desde: d, hasta: h, filas: items.length } });
  return { ok: true, items, diccionario: DICCIONARIO_KOKAN };
}

async function unidadDe(usuario, idUnico) {
  exigir(usuario, POR_UP, 'los soportes ni el informe de la unidad');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return up;
}

// Genera el PDF de una unidad con su estado inicial, necesidades, potencialidades y recomendaciones.
export async function informeTecnicoUP(usuario, { id_unico: idUnico } = {}) {
  const up = await unidadDe(usuario, idUnico);
  const db = { query };
  const [diag, form, carrito, { rows: [ev] }, [fila]] = await Promise.all([
    datosDiagnostico(db, up.id_up), formacionDeUP(db, up.id_up), cargarCarrito(db, up.id_up),
    query('SELECT * FROM up_evaluaciones WHERE id_up = $1', [up.id_up]), filasConPasos(null, { id_unico: up.id_unico }),
  ]);
  const lineas = carrito ? await lineasDe(db, carrito.id_carrito) : [];
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Informe técnico ${up.id_unico}` } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));
  const titulo = (t) => { if (doc.y > 660) doc.addPage(); doc.moveDown(0.6).fontSize(12).fillColor('#000').text(t).fontSize(10); };
  const linea = (etq, v) => doc.text(`${etq}: ${v === null || v === undefined || v === '' ? '—' : v}`);
  const lista = (xs) => (xs?.length ? xs.forEach((x) => doc.text(`· ${x}`)) : doc.text('—'));
  doc.fontSize(15).text('Informe técnico de la unidad productiva');
  doc.fontSize(10).fillColor('#555').text(`${up.unidad_nombre || ''} (ID ${up.id_unico}) · ${up.departamento || ''} · Nodo ${up.nodo || '—'} · Región ${up.region || '—'} · Modalidad ${modalidadCorta(up.modalidad) || '—'}`).fillColor('#000');
  if (fila) doc.text(`Avance de la ruta: ${fila.avance} de ${fila.de} pasos.`);
  titulo('Estado inicial (diagnóstico)');
  const id = diag?.identificacion || {}; const act = diag?.actividad || {}; const neg = diag?.negocio || {};
  linea('Iniciativa', id.nombre_iniciativa); linea('Tipo de actividad', act.tipo_actividad); linea('Productos o servicios', act.productos_servicios);
  linea('Mercado objetivo', act.mercado_objetivo); linea('Etapa del negocio', neg.etapa); linea('Valor agregado', neg.valor_agregado);
  const lb = lineaBaseDe(diag);
  linea('Línea base: ventas mensuales', lb.ventas_mensuales != null ? pesos(lb.ventas_mensuales) : null); linea('Clientes al mes', lb.clientes_mes);
  linea('Personas que trabajan', lb.personas_trabajan); linea('Utilidad mensual', lb.utilidad_mensual != null ? pesos(lb.utilidad_mensual) : null);
  titulo('Necesidades');
  linea('Necesidades identificadas', diag?.mercado?.necesidades);
  titulo('Potencialidades (FODA)');
  doc.font('Helvetica-Bold').text('Fortalezas').font('Helvetica'); lista(diag?.foda?.fortalezas);
  doc.font('Helvetica-Bold').text('Oportunidades').font('Helvetica'); lista(diag?.foda?.oportunidades);
  doc.font('Helvetica-Bold').text('Debilidades').font('Helvetica'); lista(diag?.foda?.debilidades);
  doc.font('Helvetica-Bold').text('Amenazas').font('Helvetica'); lista(diag?.foda?.amenazas);
  titulo('Plan de fortalecimiento');
  linea('Objetivos', diag?.plan_fortalecimiento?.objetivos); linea('Estrategia', diag?.plan_fortalecimiento?.estrategia);
  linea('Concepto técnico', diag?.concepto?.resultado);
  titulo('Formación');
  linea('Cumplimiento', form?.cumplimiento ? `${form.cumplimiento.porcentaje} %${form.cumplimiento.cumple_80 ? ' (cumple el 80 %)' : ''}` : 'Sin taller');
  titulo('Plan de capitalización');
  linea('Estado', carrito?.estado);
  if (lineas.length) {
    const r = resumir(carrito, lineas);
    linea('Total de los activos', pesos(r.total));
    lista(lineas.map((l) => `${l.nombre} × ${l.cantidad}`));
  }
  linea('Entrega', fila?.pasos.entrega.logrado ? (fila.pasos.entrega.fecha || 'Entregado') : 'Pendiente');
  titulo('Salida');
  const comp = ev?.linea_base && ev?.resultado ? comparacion(ev.linea_base, resultadoCompleto(ev.resultado)) : [];
  if (comp.length) comp.filter((x) => x.variacion !== null).forEach((x) => doc.text(`· ${x.etiqueta}: de ${x.base} a ${x.salida} (${x.variacion_pct ?? '—'} %)`));
  else doc.text('Sin evaluación de salida.');
  titulo('Recomendaciones');
  doc.text(ev?.recomendaciones?.texto || '—');
  doc.end();
  await fin;
  return { buffer: Buffer.concat(partes), nombre: `informe-tecnico-${String(up.id_unico).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, tipo: 'application/pdf' };
}

function serieDeArchivo(contenedor, nombre) {
  if (contenedor === 'visitas') return /05_ACOMPA|_v3[/_]|VISITA_3/i.test(nombre) ? 'acompanamiento' : 'diagnostico';
  if (contenedor === 'carritos') return /\/entrega\//.test(nombre) ? 'entrega' : 'capitalizacion';
  if (contenedor === 'entrega-activos') return 'entrega';
  if (['prellenados', 'tenencias'].includes(contenedor)) return 'identificacion';
  if (['novedades', 'novedades-asociados', 'actas-reagendamiento'].includes(contenedor)) return 'novedades';
  return 'diagnostico';
}

const COORD_Y_TECNICO = [ROLES.COORDINADOR, ROLES.TECNICO];
const LECTORES_ORIGEN = {
  evento: COORD_Y_TECNICO,
  retiro: COORD_Y_TECNICO,
  taller_final: [ROLES.COORDINADOR],
  taller_soporte: [ROLES.COORDINADOR],
  factura: [ROLES.COORDINADOR],
  kit_defectuoso: LECTORES_DEFECTUOSOS,
  kit_entrega: [ROLES.COORDINADOR],
  kit_instalacion: [ROLES.COORDINADOR],
};
const leeOrigen = (usuario, origen) => !LECTORES_ORIGEN[origen] || LECTORES_ORIGEN[origen].includes(usuario?.rol);
// Calcula la huella de la versión de un soporte; la verificación vale solo para la versión revisada y la huella
// no sale en la respuesta.
const huellaDe = (...partes) => crypto.createHash('sha256').update(partes.map((p) => (p instanceof Date ? p.toISOString() : String(p ?? ''))).join('|')).digest('hex');

// Devuelve todos los soportes de la unidad que el usuario puede leer, de todas las tablas, con su serie, tipo,
// fecha, autor, versiones anteriores y verificación.
async function indiceDe(up, usuario) {
  const lee = (origen) => leeOrigen(usuario, origen);
  const nada = Promise.resolve({ rows: [] });
  const [archivos, anteriores, finales, encuentros, eventos, retiros, comites, facturas, kits, defectos, casos, comerciales] = await Promise.all([
    query('SELECT a.contenedor, a.nombre, a.mime, a.fecha_carga AS fecha, a.subido_por, a.ruta_relativa FROM archivos a WHERE a.id_up = $1 ORDER BY a.fecha_carga', [up.id_up]),
    versionesDeUP(up.id_up),
    lee('taller_final') ? query('SELECT id, nombre, creado_en AS fecha, creado_por FROM talleres_entregas_finales WHERE id_up = $1', [up.id_up]) : nada,
    lee('taller_soporte') ? query(`SELECT s.id, s.nombre, s.mime, s.creado_en AS fecha, s.creado_por, e.modulo, t.nombre AS taller FROM talleres_soportes s
             JOIN talleres_encuentros e ON e.id = s.encuentro_id JOIN talleres_fortalecimiento t ON t.id = e.taller_id
            WHERE t.participantes @> $1::jsonb`, [JSON.stringify([{ id_up: up.id_up }])]) : nada,
    lee('evento') ? query(`SELECT a.id, a.clase, a.nombre, a.tipo, ev.tipo AS evento, ev.creado_en AS fecha, ev.registrado_por FROM eventos_equipo_adjuntos a
             JOIN eventos_equipo ev ON ev.id = a.evento_id WHERE ev.id IN (SELECT evento_id FROM eventos_equipo_asistentes WHERE id_up = $1)`, [up.id_up]) : nada,
    lee('retiro') ? query('SELECT id, tipo, acta_nombre, comite_acta_nombre, creado_en AS fecha, registrado_por FROM up_retiros WHERE id_up = $1 OR id_up_entra = $1', [up.id_up]) : nada,
    query(`SELECT c.id, c.acta_nombre, c.creado_en AS fecha, c.registrado_por FROM comites_aprobacion c
             WHERE c.id IN (SELECT comite_id FROM comite_planes WHERE id_up = $1)`, [up.id_up]),
    lee('factura') ? query('SELECT id, numero, adjunto_nombre, creado AS fecha, creado_por FROM inventario.facturas WHERE id_unico = $1 AND adjunto IS NOT NULL', [up.id_unico]) : nada,
    query(`WITH ${CTE_UP_DE_KIT}
           SELECT e.id, e.adjunto_nombre, e.instalacion_soporte_nombre, e.fecha, e.creado_por,
                  CASE WHEN e.instalacion_soporte IS NOT NULL THEN md5(e.instalacion_soporte) END AS huella_instalacion
             FROM inventario.entregas_kits e JOIN inventario.combos c ON c.id = e.combo_id ${JOIN_UP_DE_KIT('c.nombre')}
            WHERE ${ID_UP_DE_KIT()} = $1`, [up.id_unico]),
    lee('kit_defectuoso') ? query(`WITH ${CTE_UP_DE_KIT}
           SELECT n.id, n.creado AS fecha, n.creado_por, (n.reemplazo_soporte IS NOT NULL) AS con_reemplazo,
                  (SELECT count(*)::int FROM inventario.kit_novedad_articulos na WHERE na.novedad_id = n.id AND na.foto IS NOT NULL) AS fotos,
                  md5(concat_ws('|', COALESCE(n.estado, 'reportada'), n.reporte::text, n.devolucion::text, n.reemplazo::text,
                                (n.reemplazo_soporte IS NOT NULL)::text)) AS huella
             FROM inventario.kit_novedades n
             JOIN LATERAL (SELECT combo_id FROM inventario.kit_novedad_kits WHERE novedad_id = n.id ORDER BY combo_id LIMIT 1) k ON TRUE
             JOIN inventario.combos c ON c.id = k.combo_id ${JOIN_UP_DE_KIT('c.nombre')}
            WHERE n.tipo = ANY($2::text[]) AND COALESCE(n.id_unico, ${ID_UP_DE_KIT()}) = $1`, [up.id_unico, TIPOS_DEFECTO]) : nada,
    query(`SELECT a.id, a.clase, a.nombre, a.tipo, c.creado_en AS fecha, c.registrado_por, c.titulo FROM casos_exito_adjuntos a
             JOIN casos_exito c ON c.id = a.caso_id WHERE c.id_up = $1`, [up.id_up]),
    query('SELECT id, soporte_nombre, soporte_tipo, creado_en AS fecha, registrado_por, tipo FROM gestiones_comerciales WHERE id_up = $1 AND soporte IS NOT NULL', [up.id_up]),
  ]);
  const items = [];
  const enlaceDe = (origen, ref) => `/seguimiento/soportes/archivo?id_unico=${encodeURIComponent(up.id_unico)}&origen=${origen}&ref=${encodeURIComponent(ref)}`;
  const enlace = (x) => (x.origen === 'archivo' ? x.url : enlaceDe(x.origen, x.ref));
  const iso = (f) => (f ? new Date(f).toISOString() : null);
  const poner = (x, ...huella) => items.push({ ...x, url: enlace(x), fecha: iso(x.fecha), nombre_serie: SERIES[x.serie], huella: huellaDe(x.origen, x.ref, ...huella) });
  for (const a of archivos.rows) {
    const ref = `${a.contenedor}/${a.nombre}`;
    const previas = (anteriores.get(ref) || []).map((v) => ({ id: v.id, fecha: iso(v.fecha), subido_por: v.subido_por, reemplazado_en: iso(v.reemplazado_en),
      reemplazado_por: v.reemplazado_por, url: enlaceDe('version', String(v.id)) }));
    poner({ origen: 'archivo', ref, serie: serieDeArchivo(a.contenedor, a.nombre), tipo: `Repositorio (${a.contenedor})`, nombre: a.nombre.split('/').pop(), mime: a.mime, fecha: a.fecha,
      subido_por: a.subido_por, versiones: previas.length, anteriores: previas, url: urlArchivo(a.contenedor, a.nombre) }, a.ruta_relativa);
  }
  for (const x of finales.rows) poner({ origen: 'taller_final', ref: String(x.id), serie: 'formacion', tipo: 'Entrega final del taller', nombre: x.nombre, fecha: x.fecha, subido_por: x.creado_por, url: null }, x.fecha);
  for (const x of encuentros.rows) poner({ origen: 'taller_soporte', ref: String(x.id), serie: 'formacion', tipo: `Soporte del módulo ${x.modulo} (${x.taller})`, nombre: x.nombre, mime: x.mime, fecha: x.fecha, subido_por: x.creado_por, url: null }, x.fecha);
  for (const x of eventos.rows) poner({ origen: 'evento', ref: String(x.id), serie: x.evento === 'cierre' ? 'acompanamiento' : 'alistamiento', tipo: `Evento de ${x.evento === 'cierre' ? 'cierre' : x.evento} · ${x.clase}`, nombre: x.nombre, mime: x.tipo, fecha: x.fecha, subido_por: x.registrado_por, url: `/alistamiento/eventos/adjunto?id=${x.id}` }, x.fecha);
  for (const x of retiros.rows) {
    poner({ origen: 'retiro', ref: `${x.id}/retiro`, serie: 'novedades', tipo: x.tipo === 'reemplazo' ? 'Acta de reemplazo' : 'Acta de retiro', nombre: x.acta_nombre, mime: 'application/pdf', fecha: x.fecha, subido_por: x.registrado_por, url: `/retiros/acta?id=${x.id}&cual=retiro` }, x.fecha);
    if (x.comite_acta_nombre) poner({ origen: 'retiro', ref: `${x.id}/comite`, serie: 'novedades', tipo: 'Acta del Comité Técnico (reemplazo)', nombre: x.comite_acta_nombre, mime: 'application/pdf', fecha: x.fecha, subido_por: x.registrado_por, url: `/retiros/acta?id=${x.id}&cual=comite` }, x.fecha);
  }
  for (const x of comites.rows) poner({ origen: 'comite', ref: String(x.id), serie: 'capitalizacion', tipo: 'Acta del comité de aprobación', nombre: x.acta_nombre, mime: 'application/pdf', fecha: x.fecha, subido_por: x.registrado_por, url: `/comites/acta?id=${x.id}` }, x.fecha);
  for (const x of facturas.rows) poner({ origen: 'factura', ref: String(x.id), serie: 'capitalizacion', tipo: `Factura ${x.numero} (Inventario)`, nombre: x.adjunto_nombre, fecha: x.fecha, subido_por: x.creado_por, url: null }, x.fecha);
  for (const x of kits.rows) {
    if (lee('kit_entrega')) poner({ origen: 'kit_entrega', ref: String(x.id), serie: 'entrega', tipo: 'Soporte de la entrega del kit (Inventario)', nombre: x.adjunto_nombre, fecha: x.fecha, subido_por: x.creado_por, url: null }, x.fecha);
    if (x.instalacion_soporte_nombre && lee('kit_instalacion')) poner({ origen: 'kit_instalacion', ref: String(x.id), serie: 'entrega', tipo: 'Soporte de la instalación (Inventario)', nombre: x.instalacion_soporte_nombre, fecha: x.fecha, subido_por: x.creado_por, url: null }, x.huella_instalacion);
  }
  for (const x of defectos.rows) poner({ origen: 'kit_defectuoso', ref: String(x.id), serie: 'entrega', tipo: `Acta de elementos defectuosos (${x.fotos} foto/s${x.con_reemplazo ? ', con reemplazo' : ''})`, nombre: `Acta ${String(x.id).padStart(5, '0')}`, fecha: x.fecha, subido_por: x.creado_por, url: `/entregas/defectuosos/acta?id=${x.id}` }, x.huella, x.fotos);
  for (const x of casos.rows) poner({ origen: 'caso', ref: String(x.id), serie: 'acompanamiento', tipo: `${x.clase === 'foto' ? 'Foto' : 'Documento'} del caso «${x.titulo}»`, nombre: x.nombre, mime: x.tipo, fecha: x.fecha, subido_por: x.registrado_por, url: `/casos/adjunto?id=${x.id}` }, x.fecha);
  for (const x of comerciales.rows) poner({ origen: 'comercial', ref: String(x.id), serie: 'acompanamiento', tipo: 'Soporte de gestión comercial', nombre: x.soporte_nombre, mime: x.soporte_tipo, fecha: x.fecha, subido_por: x.registrado_por, url: `/comercial/soporte?id=${x.id}` }, x.fecha);
  const { rows: verificados } = items.length ? await query(
    `SELECT origen, ref, verificado_por, verificado_en, observacion, huella FROM soportes_verificados
      WHERE (origen, ref) IN (SELECT o, r FROM unnest($1::text[], $2::text[]) AS x(o, r))`,
    [items.map((x) => x.origen), items.map((x) => x.ref)]) : { rows: [] };
  const ver = new Map(verificados.map((v) => [`${v.origen}|${v.ref}`, v]));
  const nombre = await nombresDeCedulas(items.flatMap((x) => [x.subido_por, ...(x.anteriores || []).flatMap((a) => [a.subido_por, a.reemplazado_por])]));
  return items.map((x) => {
    const v = ver.get(`${x.origen}|${x.ref}`);
    const vigente = v && v.huella === x.huella;
    const anteriores = x.anteriores?.map((a) => ({ ...a, subido_por: nombre(a.subido_por), reemplazado_por: nombre(a.reemplazado_por) }));
    return { ...x, subido_por: nombre(x.subido_por), ...(anteriores ? { anteriores } : {}),
      verificacion: vigente ? { origen: v.origen, ref: v.ref, verificado_por: v.verificado_por, verificado_en: v.verificado_en, observacion: v.observacion } : null };
  });
}

const RE_CEDULA = /^\d{5,15}$/;
const RE_CUENTA = /^(superadmin|coordinador|inventario|gestor):(\d{1,10})$/;
// Convierte las cédulas o claves de cuenta de quienes cargaron soportes en sus nombres.
async function nombresDeCedulas(valores) {
  const textos = [...new Set(valores.map((v) => String(v ?? '').trim()).filter(Boolean))];
  const cedulas = textos.filter((v) => RE_CEDULA.test(v));
  const m = new Map();
  if (cedulas.length) {
    const { rows } = await query(
      `SELECT cedula, nombre FROM gestores WHERE cedula = ANY($1::text[])
       UNION ALL SELECT cedula, nombre FROM coordinadores WHERE cedula = ANY($1::text[])`, [cedulas]);
    for (const r of rows) if (r.nombre && !m.has(r.cedula)) m.set(r.cedula, r.nombre);
  }
  for (const v of textos.filter((x) => RE_CUENTA.test(x))) {
    const [, origen, id] = RE_CUENTA.exec(v);
    const c = await leerCuenta(origen, Number(id)).catch(() => null);
    if (c?.nombre) m.set(v, c.nombre);
  }
  return (v) => {
    const t = String(v ?? '').trim();
    if (RE_CEDULA.test(t) || RE_CUENTA.test(t) || /^[a-z_]+:\d+$/.test(t)) return m.get(t) || null;
    return v ?? null;
  };
}

const sinHuella = ({ huella, ...x }) => x;

export async function soportesUP(usuario, { id_unico: idUnico } = {}) {
  const up = await unidadDe(usuario, idUnico);
  const db = { query };
  const [items, [fila], carrito, { rows: [comite] }, { rows: [final] }, { rows: [factura] }] = await Promise.all([
    indiceDe(up, usuario), filasConPasos(null, { id_unico: up.id_unico }), cargarCarrito(db, up.id_up),
    query('SELECT 1 AS si FROM comite_planes WHERE id_up = $1 LIMIT 1', [up.id_up]),
    query('SELECT 1 AS si FROM talleres_entregas_finales WHERE id_up = $1 LIMIT 1', [up.id_up]),
    query('SELECT 1 AS si FROM inventario.facturas WHERE id_unico = $1 LIMIT 1', [up.id_unico]),
  ]);
  const p = fila?.pasos || {};
  const eb = carrito?.entrega_beneficiario || {};
  const checklist = {
    identificacion: [['RIT', p.rit?.logrado]],
    diagnostico: [['Visita 1 cerrada (con sus formatos)', p.visita1?.logrado], ['Visita 2 cerrada (diagnóstico y formatos)', p.visita2?.logrado]],
    formacion: [['Entrega final del taller', Boolean(final)], ['80 % de formación', p.formacion?.logrado]],
    capitalizacion: [['Plan firmado', Boolean(carrito?.firma?.soporte)], ['Acta del comité de aprobación', Boolean(comite)], ['Factura de capitalización', Boolean(factura)]],
    entrega: [['Recomendaciones de uso', Boolean(eb.recomendaciones)], ['Acta de recibido de facturas y garantías', Boolean(eb.acta_recibido)], ['Entrega registrada', p.entrega?.logrado]],
    acompanamiento: [['Visita 3 cerrada', p.visita3?.logrado], ['Asistencia al evento de cierre', p.cierre?.logrado]],
  };
  const completitud = Object.entries(checklist).map(([serie, xs]) => ({
    serie, nombre_serie: SERIES[serie], items: xs.map(([nombre, ok]) => ({ nombre, presente: Boolean(ok) })),
    soportes: items.filter((x) => x.serie === serie).length, completa: xs.every(([, ok]) => Boolean(ok)),
  }));
  return { ok: true, unidad: { id_unico: up.id_unico, nombre: up.unidad_nombre, nodo: up.nodo, region: up.region },
    items: items.map(sinHuella), completitud, series: SERIES, puede_verificar: [ROLES.TECNICO, ROLES.COORDINADOR].includes(usuario.rol) };
}

export async function verificarSoporte(usuario, { id_unico: idUnico, origen, ref, observacion } = {}) {
  if (![ROLES.TECNICO, ROLES.COORDINADOR].includes(usuario?.rol)) throw prohibido('Los soportes los verifica el técnico administrativo de apoyo o la coordinación.');
  const up = await unidadDe(usuario, idUnico);
  const items = await indiceDe(up, usuario);
  const s = items.find((x) => x.origen === txt(origen) && x.ref === txt(ref));
  if (!s) throw noEncontrado('Ese soporte no está en el expediente de la unidad.');
  const quien = usuario.nombre || usuario.sub;
  const obs = txt(observacion)?.slice(0, 1000) || null;
  await query(
    `INSERT INTO soportes_verificados (origen, ref, id_up, observacion, verificado_por, huella) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (origen, ref) DO UPDATE SET id_up = EXCLUDED.id_up, observacion = EXCLUDED.observacion, verificado_por = EXCLUDED.verificado_por,
       huella = EXCLUDED.huella, verificado_en = now()`,
    [s.origen, s.ref, up.id_up, obs, quien, s.huella]);
  await registrar(usuario, { accion: 'soporte.verificar', objeto: { tipo: 'soporte', id: `${s.origen}:${s.ref}`.slice(0, 120) }, idUnico: up.id_unico,
    cambios: { soporte: s.nombre, serie: s.nombre_serie,
      campos: { verificado: [Boolean(s.verificacion), true], observacion: [s.verificacion?.observacion ?? null, obs] } } });
  return { ok: true, item: { origen: s.origen, ref: s.ref, verificado_por: quien, observacion: obs } };
}

const BYTES = {
  taller_final: 'SELECT archivo AS contenido, nombre FROM talleres_entregas_finales WHERE id = $1',
  taller_soporte: 'SELECT archivo AS contenido, nombre FROM talleres_soportes WHERE id = $1',
  evento: 'SELECT contenido, nombre FROM eventos_equipo_adjuntos WHERE id = $1',
  comite: 'SELECT acta AS contenido, acta_nombre AS nombre FROM comites_aprobacion WHERE id = $1',
  factura: 'SELECT adjunto AS contenido, adjunto_nombre AS nombre FROM inventario.facturas WHERE id = $1',
  kit_entrega: `SELECT COALESCE(e.adjunto, o.adjunto) AS contenido, e.adjunto_nombre AS nombre FROM inventario.entregas_kits e
                  LEFT JOIN inventario.entregas_kits o ON o.id = e.adjunto_de WHERE e.id = $1`,
  kit_instalacion: 'SELECT instalacion_soporte AS contenido, instalacion_soporte_nombre AS nombre FROM inventario.entregas_kits WHERE id = $1',
  caso: 'SELECT contenido, nombre FROM casos_exito_adjuntos WHERE id = $1',
  comercial: 'SELECT soporte AS contenido, soporte_nombre AS nombre FROM gestiones_comerciales WHERE id = $1',
};

export async function archivoSoporte(usuario, { id_unico: idUnico, origen, ref } = {}) {
  const up = await unidadDe(usuario, idUnico);
  const indice = await indiceDe(up, usuario);
  if (txt(origen) === 'version') {
    const vid = entero(ref);
    const visible = vid && indice.some((x) => x.origen === 'archivo' && x.anteriores.some((v) => v.id === vid));
    if (!visible) throw noEncontrado('Esa versión no está en el expediente de la unidad.');
    return leerVersion(vid);
  }
  const s = indice.find((x) => x.origen === txt(origen) && x.ref === txt(ref));
  if (!s || s.origen === 'archivo') throw noEncontrado('Ese soporte no está en el expediente de la unidad.');
  if (s.origen === 'kit_defectuoso') {
    const acta = await actaPorId(Number(s.ref), { fotos: true });
    if (!acta) throw noEncontrado('El acta no existe.');
    return { ...(await pdfActa(acta)), tipo: 'application/pdf' };
  }
  if (s.origen === 'retiro') {
    const [id, cual] = s.ref.split('/');
    const col = cual === 'comite' ? 'comite_acta' : 'acta';
    const { rows: [r] } = await query(`SELECT ${col} AS contenido, ${col}_nombre AS nombre FROM up_retiros WHERE id = $1`, [Number(id)]);
    if (!r?.contenido) throw noEncontrado('El acta no existe.');
    return { buffer: r.contenido, nombre: r.nombre, tipo: 'application/pdf' };
  }
  const { rows: [r] } = await query(BYTES[s.origen], [Number(s.ref)]);
  if (!r?.contenido) throw noEncontrado('El soporte no tiene archivo.');
  const nombre = r.nombre || s.nombre || 'soporte';
  return { buffer: r.contenido, nombre, tipo: mimeDe(nombre) };
}

export async function multimediaMensual(usuario, { periodo } = {}) {
  exigir(usuario, [ROLES.COORDINADOR, ROLES.TECNICO], 'el reporte de fotos y videos');
  const r = limitesPeriodo(periodo);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(r.desde, r.hasta);
  const d = params.length - 1;
  const h = params.length;
  const enMes = (col) => `${bogota(col)} >= $${d}::date AND ${bogota(col)} < $${h}::date`;
  const { rows: archivos } = await query(
    `SELECT a.contenedor, a.nombre, a.mime, t.region FROM archivos a JOIN unidades_productivas up ON up.id_up = a.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND (a.mime LIKE 'image/%' OR a.mime LIKE 'video/%') AND ${enMes('a.fecha_carga')}`, params);
  const { rows: otras } = await query(
    `WITH ${CTE_UP_DE_KIT},
     -- Novedades de los kits: la foto de cada artículo y la foto general de las novedades antiguas; la U.P. es la de la
     -- novedad o la de su kit (SQL_UP_DE_KIT).
     novedades AS (
       SELECT COALESCE(n.id_unico, ${ID_UP_DE_KIT()}) AS id_unico,
              (n.foto IS NOT NULL)::int + (SELECT count(*)::int FROM inventario.kit_novedad_articulos na WHERE na.novedad_id = n.id AND na.foto IS NOT NULL) AS fotos
         FROM inventario.kit_novedades n
         LEFT JOIN LATERAL (SELECT combo_id FROM inventario.kit_novedad_kits WHERE novedad_id = n.id ORDER BY combo_id LIMIT 1) k ON TRUE
         LEFT JOIN inventario.combos c ON c.id = k.combo_id ${JOIN_UP_DE_KIT('c.nombre')}
        WHERE ${enMes('n.creado')}
     )
     SELECT 'entrega' AS serie, t.region, sum(x.fotos)::int AS fotos, 0 AS videos FROM novedades x
       JOIN unidades_productivas up ON up.id_unico = x.id_unico LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND x.fotos > 0 GROUP BY t.region
     UNION ALL
     SELECT 'acompanamiento', t.region, count(*)::int, 0 FROM casos_exito_adjuntos a JOIN casos_exito c ON c.id = a.caso_id
       JOIN unidades_productivas up ON up.id_up = c.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND a.clase = 'foto' AND ${enMes('c.creado_en')} GROUP BY t.region
     UNION ALL
     SELECT CASE WHEN ev.tipo = 'cierre' THEN 'acompanamiento' ELSE 'alistamiento' END, NULL, count(*)::int, 0 FROM eventos_equipo_adjuntos a
       JOIN eventos_equipo ev ON ev.id = a.evento_id WHERE a.clase = 'foto' AND ${enMes('ev.creado_en')}
        AND (ev.tipo = 'transferencia' OR EXISTS (SELECT 1 FROM eventos_equipo_asistentes s JOIN unidades_productivas up ON up.id_up = s.id_up
              LEFT JOIN triadas t ON t.id_triada = up.id_triada WHERE s.evento_id = ev.id AND (${alcance})))
      GROUP BY 1
     UNION ALL
     -- Fotos y videos de los encuentros de los talleres (planillas y soportes), con la región del taller; cuentan si alguna
     -- unidad inscrita está en el alcance.
     SELECT 'formacion', tf.region, count(*) FILTER (WHERE s.mime LIKE 'image/%')::int, count(*) FILTER (WHERE s.mime LIKE 'video/%')::int
       FROM talleres_soportes s JOIN talleres_encuentros e ON e.id = s.encuentro_id JOIN talleres_fortalecimiento tf ON tf.id = e.taller_id
      WHERE (s.mime LIKE 'image/%' OR s.mime LIKE 'video/%') AND ${enMes('s.creado_en')}
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(tf.participantes) p JOIN unidades_productivas up ON up.id_up = (p->>'id_up')::int
              LEFT JOIN triadas t ON t.id_triada = up.id_triada WHERE (${alcance}))
      GROUP BY tf.region`, params);
  const grupos = new Map();
  const sumar = (serie, region, fotos, videos) => {
    const k = `${serie}|${region || 'Sin región'}`;
    const g = grupos.get(k) || { serie, nombre_serie: SERIES[serie], region: region || 'Sin región', fotos: 0, videos: 0 };
    g.fotos += fotos; g.videos += videos; grupos.set(k, g);
  };
  for (const a of archivos) sumar(serieDeArchivo(a.contenedor, a.nombre), a.region, a.mime.startsWith('image/') ? 1 : 0, a.mime.startsWith('video/') ? 1 : 0);
  for (const o of otras) sumar(o.serie, o.region, o.fotos, o.videos || 0);
  const items = [...grupos.values()].sort((a, b) => `${a.serie}|${a.region}`.localeCompare(`${b.serie}|${b.region}`, 'es'));
  return { ok: true, periodo: r.periodo, items, total: { fotos: items.reduce((a, x) => a + x.fotos, 0), videos: items.reduce((a, x) => a + x.videos, 0) } };
}

export { CAUSALES };
