// Línea base y evaluación de salida de la unidad productiva. La línea base son los indicadores fijos tomados
// del diagnóstico de la segunda visita y se congela al cerrarla; en la tercera visita se miden los mismos
// indicadores y se completan caracterización, encuesta y uso de los activos para compararlos.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { conRegistro, diferenciasCortas, clavesDe } from './actividad.js';
import { buscarUP } from './unidades.js';
import { salidasCargadas } from './catalogoVisitas.js';
import { CAMPOS_NEGOCIO, calculos, datosDiagnostico, visitasDeUP } from './diagnostico.js';
import { faltantesCon, limpiarCon } from './secciones.js';
import { accionesRevision, flujoRevision, revisionDe } from './revisionCLR.js';

const ESTADOS_BIEN = [
  { codigo: 'en_uso', nombre: 'En uso' }, { codigo: 'sin_usar', nombre: 'Sin usar' },
  { codigo: 'danado', nombre: 'Dañado' }, { codigo: 'no_se_encuentra', nombre: 'No se encuentra' },
];
const CUMPLIMIENTO = [
  { codigo: 'cumple', nombre: 'Cumple' }, { codigo: 'parcial', nombre: 'Cumple parcialmente' }, { codigo: 'no_cumple', nombre: 'No cumple' },
];
const SI_NO = [{ codigo: 'si', nombre: 'Sí' }, { codigo: 'no', nombre: 'No' }];
const PERIODOS = [
  { codigo: 'diario', nombre: 'Al día' }, { codigo: 'semanal', nombre: 'A la semana' }, { codigo: 'mensual', nombre: 'Al mes' },
];
const TIPOS_ACTIVIDAD = [
  { codigo: 'produccion', nombre: 'Producción o transformación' }, { codigo: 'comercio', nombre: 'Comercio' },
  { codigo: 'servicios', nombre: 'Servicios' }, { codigo: 'agropecuaria', nombre: 'Agropecuaria' }, { codigo: 'mixta', nombre: 'Mixta' },
];

// Indicadores fijos de la línea base y del resultado; el valor calculado sale de los demás.
export const INDICADORES = [
  { clave: 'ventas_mensuales', etiqueta: 'Ventas mensuales', tipo: 'pesos' },
  { clave: 'clientes_mes', etiqueta: 'Clientes al mes', tipo: 'entero' },
  { clave: 'personas_trabajan', etiqueta: 'Personas que trabajan', tipo: 'entero' },
  { clave: 'ingresos_mensuales', etiqueta: 'Ingresos mensuales', tipo: 'pesos' },
  { clave: 'costos_mensuales', etiqueta: 'Costos y gastos mensuales', tipo: 'pesos' },
  { clave: 'utilidad_mensual', etiqueta: 'Utilidad mensual', tipo: 'pesos', calculado: true },
  { clave: 'volumen_produccion', etiqueta: 'Volumen de producción o ventas', tipo: 'entero' },
];
const MEDIDOS = INDICADORES.filter((i) => !i.calculado);
// El volumen se compara en su equivalente mensual y solo si la unidad es la misma.
const POR_MES = { diario: 30, semanal: 52 / 12, mensual: 1 };

export const PREGUNTAS_ENCUESTA = [
  { clave: 'acompanamiento', etiqueta: 'Acompañamiento del gestor' },
  { clave: 'formacion', etiqueta: 'Formación recibida' },
  { clave: 'bienes', etiqueta: 'Calidad de los bienes entregados' },
  { clave: 'oportunidad', etiqueta: 'Oportunidad de la entrega' },
  { clave: 'general', etiqueta: 'Satisfacción general con el programa' },
];

// Secciones de la evaluación de salida; el uso de los activos tiene una fila por cada bien del plan aprobado.
export const ESQUEMA_SALIDA = [
  {
    clave: 'resultado', titulo: 'Indicadores de resultado', brecha: 'ET4-05',
    ayuda: 'Los mismos indicadores de la línea base, medidos en la Visita 3. La variación la calcula el servidor.',
    campos: [
      ...MEDIDOS.map((i) => ({ clave: i.clave, etiqueta: i.etiqueta, tipo: i.tipo, obligatorio: true })),
      { clave: 'unidad_volumen', etiqueta: 'Unidad del volumen (kilos, unidades, servicios…)', tipo: 'texto', max: 60, obligatorio: true },
      { clave: 'periodo_volumen', etiqueta: 'Periodo del volumen', tipo: 'lista', opciones: PERIODOS, obligatorio: true },
    ],
  },
  {
    clave: 'caracterizacion', titulo: 'Caracterización de salida', brecha: 'ET4-03',
    ayuda: 'Comparable con la caracterización de entrada (formalización y actividad).',
    campos: [
      { clave: 'camara_comercio', etiqueta: '¿Tiene registro en Cámara de comercio?', tipo: 'sino', obligatorio: true },
      { clave: 'rut', etiqueta: '¿Tiene RUT?', tipo: 'sino', obligatorio: true },
      { clave: 'tipo_actividad', etiqueta: 'Tipo de actividad', tipo: 'lista', opciones: TIPOS_ACTIVIDAD, obligatorio: true },
      { clave: 'productos_servicios', etiqueta: 'Productos o servicios', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'mercado_objetivo', etiqueta: 'Mercado objetivo', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'cambios', etiqueta: 'Cambios principales desde la entrada', tipo: 'texto_largo', max: 3000, obligatorio: true },
    ],
  },
  {
    clave: 'negocio', titulo: 'Estado del negocio a la salida', brecha: 'TR-04',
    ayuda: 'Los mismos datos del diagnóstico (etapa, productos, valor agregado, producción y comercialización), al salir.',
    campos: CAMPOS_NEGOCIO,
  },
  {
    clave: 'encuesta', titulo: 'Encuesta de satisfacción', brecha: 'ET4-04',
    ayuda: 'El beneficiario califica de 1 (muy insatisfecho) a 5 (muy satisfecho).',
    campos: [
      ...PREGUNTAS_ENCUESTA.map((p) => ({ clave: p.clave, etiqueta: p.etiqueta, tipo: 'escala', obligatorio: true })),
      { clave: 'comentario', etiqueta: 'Comentario del beneficiario', tipo: 'texto_largo', max: 2000 },
    ],
  },
  {
    clave: 'compromiso', titulo: 'Cumplimiento del acta de compromiso', brecha: 'ET4-02',
    campos: [
      { clave: 'cumplimiento', etiqueta: 'Cumplimiento', tipo: 'lista', opciones: CUMPLIMIENTO, obligatorio: true },
      { clave: 'observacion', etiqueta: 'Observación', tipo: 'texto_largo', max: 2000, obligatorio: { campo: 'cumplimiento', valor: ['parcial', 'no_cumple'] } },
    ],
  },
  {
    clave: 'recomendaciones', titulo: 'Recomendaciones a la unidad', brecha: 'ET4-11',
    campos: [{ clave: 'texto', etiqueta: 'Recomendaciones dadas en la Visita 3', tipo: 'texto_largo', max: 3000, obligatorio: true }],
  },
  {
    clave: 'uso_activos', titulo: 'Uso de los activos entregados', brecha: 'ET4-02', especial: 'bienes',
    ayuda: 'Una fila por cada bien del plan aprobado. Si el bien no está en uso, explica por qué.',
    estados: ESTADOS_BIEN, campos: [],
  },
];
const SECCION = Object.fromEntries(ESQUEMA_SALIDA.map((s) => [s.clave, s]));
const COLUMNAS = ESQUEMA_SALIDA.map((s) => s.clave);

function exigirLectura(usuario) {
  if (esGestor(usuario) || [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS].includes(usuario?.rol)) return;
  throw prohibido('Tu rol no consulta la evaluación de salida.');
}
function exigirEscritura(usuario) {
  if (esGestor(usuario) || usuario?.rol === ROLES.COORDINADOR) return;
  throw prohibido('Tu rol no diligencia la evaluación de salida.');
}
async function unidad(usuario, idUnico) {
  if (!txt(idUnico)) throw solicitudInvalida('Falta la unidad (id_unico).');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return up;
}

const leer = async (db, idUp, bloquear = false) =>
  (await db.query(`SELECT * FROM up_evaluaciones WHERE id_up = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [idUp])).rows[0] || null;

const PLAN_APROBADO = ['aprobado', 'en_compra', 'entregado'];

// Devuelve el plan de capitalización vigente de la unidad y sus bienes si está aprobado.
export async function planYBienes(db, idUp) {
  const { rows: [plan] } = await db.query(
    `SELECT id_carrito, estado FROM carritos WHERE id_up = $1
      ORDER BY (id_origen LIKE 'LOCAL-%') DESC, id_carrito DESC LIMIT 1`,
    [idUp],
  );
  if (!plan || !PLAN_APROBADO.includes(plan.estado)) return { plan: plan || null, bienes: [] };
  const { rows } = await db.query(
    `SELECT id_carrito_producto AS id_linea, nombre_producto AS nombre, cantidad::float AS cantidad
       FROM carrito_productos WHERE id_carrito = $1 ORDER BY id_carrito_producto`,
    [plan.id_carrito],
  );
  return { plan, bienes: rows };
}

// Limpia el uso de los activos contra los bienes del plan aprobado.
function limpiarUsoActivos(datos, bienes) {
  const filas = Array.isArray(datos?.items) ? datos.items : [];
  const porLinea = new Map(bienes.map((b) => [Number(b.id_linea), b]));
  const items = [];
  for (const f of filas) {
    const b = porLinea.get(Number(f?.id_linea));
    if (!b) throw solicitudInvalida('Uso de los activos: uno de los bienes no está en el plan aprobado de la unidad.');
    const estado = txt(f.estado);
    if (estado && !ESTADOS_BIEN.some((e) => e.codigo === estado)) throw solicitudInvalida(`Uso de los activos › ${b.nombre}: "${estado}" no es un estado válido.`);
    const observacion = txt(f.observacion);
    if (observacion && observacion.length > 1000) throw solicitudInvalida(`Uso de los activos › ${b.nombre}: la observación admite máximo 1000 caracteres.`);
    if (items.some((x) => x.id_linea === b.id_linea)) throw solicitudInvalida(`Uso de los activos › ${b.nombre}: está repetido.`);
    items.push({ id_linea: b.id_linea, nombre: b.nombre, cantidad: b.cantidad, estado: estado || null, observacion: observacion || null });
  }
  return { items };
}

function faltantesUsoActivos(datos, { plan, bienes }) {
  if (!plan) return ['Uso de los activos › La unidad no tiene un plan de capitalización aprobado'];
  if (!PLAN_APROBADO.includes(plan.estado)) return [`Uso de los activos › El plan de capitalización está reabierto (${plan.estado}): debe aprobarlo de nuevo el comité`];
  const items = new Map((datos?.items || []).map((x) => [Number(x.id_linea), x]));
  const faltan = [];
  for (const b of bienes) {
    const x = items.get(Number(b.id_linea));
    if (!x?.estado) faltan.push(`Uso de los activos › ${b.nombre}`);
    else if (x.estado !== 'en_uso' && !x.observacion) faltan.push(`Uso de los activos › ${b.nombre}: explica por qué no está en uso`);
  }
  return faltan;
}

// Devuelve lo que falta para cerrar la tercera visita; sin línea base también falta.
export function faltantesSalida(fila, planBienes) {
  const faltan = [];
  if (!fila?.linea_base) faltan.push('La línea base de la Visita 2 (se congela al cerrarla)');
  for (const s of ESQUEMA_SALIDA) {
    if (s.especial === 'bienes') faltan.push(...faltantesUsoActivos(fila?.uso_activos, planBienes));
    else faltan.push(...faltantesCon(s, fila?.[s.clave]));
  }
  return faltan;
}

// Calcula la línea base a partir del diagnóstico: los indicadores medidos, la utilidad calculada y la unidad y
// el periodo del volumen.
export function lineaBaseDe(diag) {
  const r = diag?.recursos || {};
  const ind = diag?.indicadores || {};
  const act = diag?.actividad || {};
  return {
    ventas_mensuales: ind.ventas_mensuales ?? null,
    clientes_mes: ind.clientes_mes ?? null,
    personas_trabajan: r.personas_trabajan ?? null,
    ingresos_mensuales: r.ingresos_mensuales ?? null,
    costos_mensuales: r.costos_mensuales ?? null,
    utilidad_mensual: calculos({ recursos: r }).utilidad_mensual,
    volumen_produccion: act.volumen_produccion ?? null,
    unidad_volumen: act.unidad_volumen ?? null,
    periodo_volumen: act.periodo_volumen ?? null,
  };
}

// Devuelve el resultado con la utilidad calculada.
export function resultadoCompleto(res) {
  if (!res) return null;
  return { ...res, utilidad_mensual: calculos({ recursos: res }).utilidad_mensual };
}

const normalUnidad = (u) => String(u || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
// Calcula el volumen mensual equivalente, o null si falta el periodo.
const volumenMensual = (v, periodo) => (Number.isFinite(v) && POR_MES[periodo] ? Math.round(v * POR_MES[periodo] * 10) / 10 : null);

// Calcula la variación de cada indicador entre la línea base y la salida; el volumen se compara en su
// equivalente mensual.
export function comparacion(base, salida) {
  return INDICADORES.map((i) => {
    let b = base?.[i.clave];
    let s = salida?.[i.clave];
    let nota = null;
    if (i.clave === 'volumen_produccion' && Number.isFinite(b) && Number.isFinite(s)) {
      if (normalUnidad(base?.unidad_volumen) !== normalUnidad(salida?.unidad_volumen)) {
        nota = `Unidades distintas (${base?.unidad_volumen || '—'} y ${salida?.unidad_volumen || '—'}): no se comparan.`;
        b = null; s = null;
      } else {
        b = volumenMensual(b, base?.periodo_volumen);
        s = volumenMensual(s, salida?.periodo_volumen);
        nota = b === null || s === null ? 'Falta el periodo del volumen: no se compara.' : `Equivalente mensual (${base.unidad_volumen}).`;
      }
    }
    const hay = Number.isFinite(b) && Number.isFinite(s);
    return {
      clave: i.clave, etiqueta: i.etiqueta, tipo: i.tipo,
      base: Number.isFinite(b) ? b : null, salida: Number.isFinite(s) ? s : null,
      variacion: hay ? Math.round((s - b) * 10) / 10 : null,
      variacion_pct: hay && b !== 0 ? Math.round(((s - b) / Math.abs(b)) * 1000) / 10 : null,
      nota,
    };
  });
}

// Calcula el promedio de la encuesta con una cifra decimal, o null si está incompleta.
export function promedioEncuesta(enc) {
  const v = PREGUNTAS_ENCUESTA.map((p) => enc?.[p.clave]).filter((x) => Number.isInteger(x));
  return v.length === PREGUNTAS_ENCUESTA.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

// Indica si se puede editar: la tercera visita se diligencia con la segunda cerrada y la tercera abierta o
// devuelta.
function bloqueoEdicion(fila, vis) {
  const estado = fila?.estado_revision || 'sin_enviar';
  if (estado === 'revisado') return 'La evaluación de salida ya fue revisada por la coordinación: no se modifica.';
  if (estado === 'pendiente') return 'La evaluación de salida está en revisión de la coordinación: espera su decisión.';
  if (!vis.v2?.cerrada) return 'La evaluación de salida se diligencia en la Visita 3, después de cerrar la Visita 2.';
  if (estado !== 'devuelto' && vis.v3?.cerrada) return 'La Visita 3 ya está cerrada: la evaluación de salida no se modifica.';
  return null;
}

// Devuelve el esquema de la evaluación de salida para dibujar los formularios.
export function esquemaSalida() {
  return { ok: true, item: { secciones: ESQUEMA_SALIDA, indicadores: INDICADORES } };
}

// Devuelve la línea base, las secciones, la comparación, la satisfacción, los bienes, la revisión y los
// permisos.
export async function obtenerEvaluacion(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await unidad(usuario, idUnico);
  const db = { query };
  const [fila, vis, planBienes] = await Promise.all([leer(db, up.id_up), visitasDeUP(db, up.id_up), planYBienes(db, up.id_up)]);
  const escribe = esGestor(usuario) || usuario.rol === ROLES.COORDINADOR;
  const revision = revisionDe(fila);
  const faltan = faltantesSalida(fila, planBienes);
  return {
    ok: true,
    item: {
      id_unico: up.id_unico,
      linea_base: fila?.linea_base || null,
      linea_base_en: fila?.linea_base_en || null,
      linea_base_historial: fila?.linea_base_historial || [],
      secciones: Object.fromEntries(COLUMNAS.map((k) => [k, fila?.[k] || null])),
      comparacion: comparacion(fila?.linea_base, resultadoCompleto(fila?.resultado)),
      satisfaccion: promedioEncuesta(fila?.encuesta),
      plan: planBienes.plan ? { estado: planBienes.plan.estado } : null,
      bienes: planBienes.bienes,
      completitud: { completo: !faltan.length, faltan },
      revision,
      visitas: { v2_cerrada: !!vis.v2?.cerrada, v3_cerrada: !!vis.v3?.cerrada },
      editable: escribe && !bloqueoEdicion(fila, vis),
      motivo_bloqueo: escribe ? bloqueoEdicion(fila, vis) : null,
      ...accionesRevision(usuario, revision.estado, escribe),
    },
  };
}

// Guarda una sección de la evaluación de salida.
export function guardarSeccionSalida(usuario, { id_unico: idUnico, seccion, datos } = {}) {
  const clave = txt(seccion);
  return conRegistro(
    usuario, { accion: 'evaluacion.guardar', objeto: { tipo: 'evaluacion', id: clave }, idUnico: txt(idUnico) },
    async () => {
      exigirEscritura(usuario);
      const up = await unidad(usuario, idUnico);
      if (!COLUMNAS.includes(clave)) throw solicitudInvalida('Esa sección de la evaluación de salida no existe.');
      return transaccion(async (db) => {
        await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
        const fila = await leer(db, up.id_up, true);
        const motivo = bloqueoEdicion(fila, await visitasDeUP(db, up.id_up));
        if (motivo) throw new HttpError(409, motivo);
        const limpio = SECCION[clave].especial === 'bienes'
          ? limpiarUsoActivos(datos, (await planYBienes(db, up.id_up)).bienes)
          : limpiarCon(SECCION[clave], datos);
        const quien = usuario.nombre || usuario.sub || null;
        await db.query(
          `INSERT INTO up_evaluaciones (id_up, ${clave}, actualizado_por, actualizado_en) VALUES ($1, $2, $3, now())
           ON CONFLICT (id_up) DO UPDATE SET ${clave} = EXCLUDED.${clave}, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
          [up.id_up, JSON.stringify(limpio), quien],
        );
        return { ok: true, item: { seccion: clave, datos: limpio }, _antes: fila?.[clave] || null };
      });
    },
    (r) => ({ seccion: clave, campos: diferenciasCortas(r._antes || {}, r.item.datos || {}, clavesDe(r._antes, r.item.datos)) }),
  ).then(({ _antes, ...r }) => r);
}

const flujo = flujoRevision({
  tabla: 'up_evaluaciones', accion: 'evaluacion', unidad, exigirEscritura,
  textos: { sujeto: 'La evaluación de salida', devuelto: 'una evaluación devuelta', revisado: 'revisada', completo: 'completa', visita: 'Visita 3' },
  completo: async (fila, db, up) => {
    const faltan = faltantesSalida(fila, await planYBienes(db, up.id_up));
    return { completo: !faltan.length, faltan };
  },
});
// Registra la decisión de la coordinación sobre la evaluación de salida.
export const revisarEvaluacion = flujo.revisar;
// Reenvía a revisión una evaluación devuelta.
export const reenviarEvaluacion = flujo.reenviar;

// Guarda la línea base con el diagnóstico actual y deja la anterior en el historial con el motivo.
async function guardarLineaBase(db, up, motivo, { exigir }) {
  const fila = await leer(db, up.id_up, true);
  if (['pendiente', 'revisado'].includes(fila?.estado_revision)) {
    if (!exigir) return null;
    throw new HttpError(409, 'La evaluación de salida ya se envió a revisión: la coordinación debe devolverla antes de cambiar la línea base.');
  }
  const base = lineaBaseDe(await datosDiagnostico(db, up.id_up));
  if (fila?.linea_base && JSON.stringify(fila.linea_base) === JSON.stringify(base)) return null;
  const historial = fila?.linea_base ? [{ linea_base: fila.linea_base, hasta: new Date().toISOString(), motivo }] : [];
  await db.query(
    `INSERT INTO up_evaluaciones (id_up, linea_base, linea_base_en, linea_base_historial) VALUES ($1, $2, now(), $3)
     ON CONFLICT (id_up) DO UPDATE SET linea_base = EXCLUDED.linea_base, linea_base_en = now(),
       linea_base_historial = up_evaluaciones.linea_base_historial || EXCLUDED.linea_base_historial`,
    [up.id_up, JSON.stringify(base), JSON.stringify(historial)],
  );
  return base;
}

// Congela la línea base con el diagnóstico al cerrar la segunda visita.
export async function congelarLineaBase(db, up, tipo, soportes) {
  if (tipo !== 'v2' || salidasCargadas(tipo, soportes).length) return;
  await guardarLineaBase(db, up, 'cierre de la Visita 2', { exigir: true });
}

// Vuelve a tomar la línea base del diagnóstico cuando la coordinación lo marca como revisado después de una
// devolución.
export async function recongelarLineaBase(db, up) {
  const vis = await visitasDeUP(db, up.id_up);
  if (!vis.v2?.cerrada) return null;
  return guardarLineaBase(db, up, 'diagnóstico revisado por la coordinación', { exigir: false });
}

// Exige la evaluación de salida completa para cerrar la tercera visita, que pasa a revisión.
export async function exigirSalidaParaCerrar(db, up, tipo, soportes) {
  if (tipo !== 'v3' || salidasCargadas(tipo, soportes).length) return;
  const fila = await leer(db, up.id_up, true);
  const faltan = faltantesSalida(fila, await planYBienes(db, up.id_up));
  if (faltan.length) throw solicitudInvalida(`Para cerrar la Visita 3 falta en la evaluación de salida: ${faltan.join('; ')}.`);
  if (['sin_enviar', 'devuelto'].includes(fila.estado_revision || 'sin_enviar')) {
    await db.query("UPDATE up_evaluaciones SET estado_revision = 'pendiente' WHERE id_up = $1", [up.id_up]);
  }
}

const TOPE_TABLERO = 5000;
// Devuelve las unidades del alcance con línea base, salida, variación y satisfacción.
export async function tableroEvaluacion(usuario, { region, modalidad } = {}) {
  if (![ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS].includes(usuario?.rol)) throw prohibido('El tablero de indicadores es de la coordinación y del Profesional alianzas y conexión de mercados.');
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(txt(region) || null, txt(modalidad) || null);
  const { rows } = await query(
    `SELECT up.id_unico, up.nombre, t.nodo, t.region, up.modalidad, up.departamento,
            e.linea_base, e.resultado, e.encuesta, e.estado_revision
       FROM up_evaluaciones e
       JOIN unidades_productivas up ON up.id_up = e.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE ${alcance}
        AND ($${params.length - 1}::text IS NULL OR lower(t.region) = lower($${params.length - 1}))
        AND ($${params.length}::text IS NULL OR up.modalidad ILIKE $${params.length} || '%')
      ORDER BY t.region, up.id_unico
      LIMIT ${TOPE_TABLERO + 1}`,
    params,
  );
  const truncado = rows.length > TOPE_TABLERO;
  const resultado = SECCION.resultado;
  const items = rows.slice(0, TOPE_TABLERO).map((r) => {
    const comp = Object.fromEntries(comparacion(r.linea_base, resultadoCompleto(r.resultado)).map((c) => [c.clave, c]));
    return {
      id_unico: r.id_unico, nombre: r.nombre, nodo: r.nodo, region: r.region, modalidad: r.modalidad, departamento: r.departamento,
      indicadores: comp, satisfaccion: promedioEncuesta(r.encuesta), estado_revision: r.estado_revision || 'sin_enviar',
      con_salida: !!r.resultado && !faltantesCon(resultado, r.resultado).length,
    };
  });
  const enviadas = items.filter((i) => ['pendiente', 'revisado'].includes(i.estado_revision));
  const promedio = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    ok: true,
    items,
    resumen: {
      unidades: items.length,
      con_linea_base: items.filter((i) => i.indicadores.ventas_mensuales.base !== null).length,
      con_salida: items.filter((i) => i.con_salida).length,
      enviadas: enviadas.length,
      variacion_ventas_promedio_pct: promedio(enviadas.map((i) => i.indicadores.ventas_mensuales.variacion_pct).filter((x) => x !== null)),
      satisfaccion_promedio: promedio(enviadas.map((i) => i.satisfaccion).filter((x) => x !== null)),
      truncado,
    },
  };
}
