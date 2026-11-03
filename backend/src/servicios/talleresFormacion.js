// Reglas de la formación que calcula y exige el servidor: cada sesión de 180 minutos se divide en 120
// teórico-prácticos y 60 de evaluación, la sesión puede ser presencial o virtual con aprobación, la asistencia
// se valida contra el mínimo de integrantes de la modalidad y se calcula el cumplimiento del 80 %.
import { solicitudInvalida } from '../errores.js';
import { modalidadDe, tieneFormato } from './catalogoVisitas.js';

export const MINIMO_INTEGRANTES = { M1: 1, M2: 3, M3: 5, M4: 5 };
export const MINUTOS_TEORICO = 120;
export const MINUTOS_EVALUACION = 60;
export const ACTIVIDADES_FORMACION = 5;
export const PORCENTAJE_EXIGIDO = 80;
export const FORMATO_AUTORIZACION = 'Autorización para el tratamiento de datos personales';

export const PREGUNTAS_APROPIACION = [
  { clave: 'costos_precios', etiqueta: 'Costos, precios y punto de equilibrio' },
  { clave: 'registros', etiqueta: 'Registros contables y manejo del dinero del negocio' },
  { clave: 'mercadeo', etiqueta: 'Mercadeo, clientes y ventas' },
  { clave: 'formalizacion', etiqueta: 'Formalización y obligaciones de la unidad' },
  { clave: 'plan_negocio', etiqueta: 'Plan de negocio y trabajo asociativo' },
];
export const PREGUNTAS_SATISFACCION = [
  { clave: 'contenidos', etiqueta: 'Contenidos del módulo' },
  { clave: 'metodologia', etiqueta: 'Metodología' },
  { clave: 'tallerista', etiqueta: 'Desempeño del Tallerista' },
  { clave: 'logistica', etiqueta: 'Lugar y logística' },
];
export const TIPOS_ENCUESTA = ['apropiacion_entrada', 'apropiacion_salida', 'satisfaccion'];

// Calcula los bloques de la sesión a partir de su inicio: 2 horas teórico-prácticas y 1 hora de evaluación.
export function bloquesSesion(inicio) {
  const t0 = new Date(inicio).getTime();
  if (!Number.isFinite(t0)) return null;
  const iso = (ms) => new Date(ms).toISOString();
  const corte = t0 + MINUTOS_TEORICO * 60_000;
  return {
    teorico_practico: { inicio: iso(t0), fin: iso(corte), minutos: MINUTOS_TEORICO },
    evaluacion: { inicio: iso(corte), fin: iso(corte + MINUTOS_EVALUACION * 60_000), minutos: MINUTOS_EVALUACION },
  };
}

// Devuelve los integrantes y el mínimo de cada unidad del taller.
export async function datosParticipantes(db, taller) {
  const ids = (taller.participantes || []).map((p) => p.id_up).filter(Boolean);
  if (!ids.length) return {};
  const [{ rows: ups }, { rows: asociados }] = await Promise.all([
    db.query('SELECT id_up, id_unico, modalidad FROM unidades_productivas WHERE id_up = ANY($1::int[])', [ids]),
    db.query(`SELECT id, id_up, nombre, documento, es_representante FROM up_asociados WHERE id_up = ANY($1::int[]) AND activo
               ORDER BY es_representante DESC, nombre`, [ids]),
  ]);
  return Object.fromEntries(ups.map((u) => [u.id_up, participante(u,
    asociados.filter((a) => a.id_up === u.id_up).map((a) => ({ id: a.id, nombre: a.nombre, documento: a.documento, es_representante: a.es_representante })))]));
}

// Devuelve la unidad inscrita con su modalidad y el mínimo de integrantes.
function participante(u, integrantes) {
  const mod = modalidadDe(u.modalidad) || 'M1';
  return { id_up: u.id_up, id_unico: u.id_unico, modalidad: mod, minimo: MINIMO_INTEGRANTES[mod] ?? 1, integrantes };
}

const codigoUP = (idUp) => `up:${idUp}`;
const idDeCodigo = (c) => (/^up:\d+$/.test(String(c)) ? Number(String(c).slice(3)) : null);

// Limpia la asistencia por integrante: para cada unidad presente, los ids de sus asociados activos que
// asistieron.
export function limpiarIntegrantes(entrada, asistencia, participantes) {
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const salida = {};
  for (const codigo of asistencia) {
    const idUp = idDeCodigo(codigo);
    if (!idUp) continue;
    const p = participantes[idUp];
    if (!p) continue;
    const marcados = datos[idUp] ?? datos[String(idUp)] ?? [];
    if (!Array.isArray(marcados) || marcados.length > 100) throw solicitudInvalida('La asistencia por integrante no es válida.');
    const validos = new Set(p.integrantes.map((i) => i.id));
    const ids = [...new Set(marcados.map(Number))];
    if (ids.some((id) => !validos.has(id))) throw solicitudInvalida(`La asistencia de ${p.id_unico} incluye a alguien que no es asociado activo de la unidad.`);
    salida[idUp] = ids;
  }
  return salida;
}

// Indica si la sesión cuenta para la unidad: asistió y llegó al mínimo de su modalidad; en M1 basta con que
// asista.
export function sesionValida(encuentro, info) {
  if (!encuentro?.realizado_en || !info) return { asistio: false, valida: false, integrantes: 0 };
  const asistio = (encuentro.asistencia || []).includes(codigoUP(info.id_up));
  const integrantes = (encuentro.asistencia_integrantes?.[info.id_up] || []).length;
  const valida = asistio && (info.modalidad === 'M1' || integrantes >= info.minimo);
  return { asistio, valida, integrantes };
}

// Valida las respuestas de una encuesta: todas las preguntas con números enteros de 1 a 5.
export function limpiarRespuestas(tipo, respuestas) {
  if (!TIPOS_ENCUESTA.includes(tipo)) throw solicitudInvalida('El tipo de encuesta no es válido.');
  const preguntas = tipo === 'satisfaccion' ? PREGUNTAS_SATISFACCION : PREGUNTAS_APROPIACION;
  const r = respuestas && typeof respuestas === 'object' ? respuestas : {};
  const salida = {};
  for (const p of preguntas) {
    const v = r[p.clave];
    const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\s*[1-5]\s*$/.test(v));
    const n = ok ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 5) throw solicitudInvalida(`Encuesta › ${p.etiqueta}: califica de 1 a 5.`);
    salida[p.clave] = n;
  }
  if (r.comentario !== undefined && r.comentario !== null && r.comentario !== '') {
    const c = String(r.comentario).trim();
    if (c.length > 1000) throw solicitudInvalida('El comentario de la encuesta admite máximo 1000 caracteres.');
    if (c) salida.comentario = c;
  }
  return salida;
}

const promedio = (r, preguntas) => {
  const v = preguntas.map((p) => r?.[p.clave]).filter(Number.isInteger);
  return v.length === preguntas.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

// Calcula el promedio de entrada y de salida de la apropiación y su variación en puntos y por pregunta.
export function variacionApropiacion(entrada, salida) {
  const e = promedio(entrada, PREGUNTAS_APROPIACION);
  const s = promedio(salida, PREGUNTAS_APROPIACION);
  return {
    entrada: e, salida: s, variacion: e !== null && s !== null ? Math.round((s - e) * 10) / 10 : null,
    por_pregunta: PREGUNTAS_APROPIACION.map((p) => ({
      clave: p.clave, etiqueta: p.etiqueta, entrada: entrada?.[p.clave] ?? null, salida: salida?.[p.clave] ?? null,
      variacion: Number.isInteger(entrada?.[p.clave]) && Number.isInteger(salida?.[p.clave]) ? salida[p.clave] - entrada[p.clave] : null,
    })),
  };
}

export const promedioSatisfaccion = (r) => promedio(r, PREGUNTAS_SATISFACCION);

// Indica si la unidad tiene cargada la autorización de tratamiento de datos en su primera visita.
export async function autorizacionDatosCargada(db, idUp) {
  const { rows } = await db.query("SELECT documento FROM visitas WHERE id_up = $1 AND tipo_visita = 'v1' AND documento IS NOT NULL", [idUp]);
  return rows.some((r) => tieneFormato(r.documento.soportes, FORMATO_AUTORIZACION));
}

// Calcula el cumplimiento de la formación de cada unidad del taller: las 5 actividades, el porcentaje y si
// llega al 80 %.
export async function cumplimientoTaller(db, taller, participantes = null) {
  const info = participantes || await datosParticipantes(db, taller);
  const [{ rows: encuentros }, { rows: encuestas }, { rows: finales }] = await Promise.all([
    db.query('SELECT modulo, asistencia, asistencia_integrantes, realizado_en FROM talleres_encuentros WHERE taller_id = $1 ORDER BY modulo', [taller.id]),
    db.query("SELECT id_up FROM talleres_encuestas WHERE taller_id = $1 AND tipo = 'apropiacion_salida'", [taller.id]),
    db.query('SELECT id_up FROM talleres_entregas_finales WHERE taller_id = $1', [taller.id]),
  ]);
  return calcularCumplimiento(info, encuentros, encuestas, finales);
}

// Calcula el cumplimiento de muchos talleres en bloque con pocas consultas, para el seguimiento del programa.
export async function cumplimientoTalleres(db, talleres) {
  const salida = new Map();
  if (!talleres.length) return salida;
  const idsTaller = talleres.map((t) => t.id);
  const idsUp = [...new Set(talleres.flatMap((t) => (t.participantes || []).map((p) => Number(p.id_up)).filter((id) => Number.isInteger(id) && id > 0)))];
  const [{ rows: ups }, { rows: encuentros }, { rows: encuestas }, { rows: finales }] = await Promise.all([
    idsUp.length ? db.query('SELECT id_up, id_unico, modalidad FROM unidades_productivas WHERE id_up = ANY($1::int[])', [idsUp]) : { rows: [] },
    db.query('SELECT taller_id, modulo, asistencia, asistencia_integrantes, realizado_en FROM talleres_encuentros WHERE taller_id = ANY($1::int[]) ORDER BY taller_id, modulo', [idsTaller]),
    db.query("SELECT taller_id, id_up FROM talleres_encuestas WHERE taller_id = ANY($1::int[]) AND tipo = 'apropiacion_salida'", [idsTaller]),
    db.query('SELECT taller_id, id_up FROM talleres_entregas_finales WHERE taller_id = ANY($1::int[])', [idsTaller]),
  ]);
  const porUp = new Map(ups.map((u) => [u.id_up, u]));
  const porTaller = (filas) => {
    const m = new Map();
    for (const x of filas) { if (!m.has(x.taller_id)) m.set(x.taller_id, []); m.get(x.taller_id).push(x); }
    return m;
  };
  const [enc, sal, fin] = [porTaller(encuentros), porTaller(encuestas), porTaller(finales)];
  for (const t of talleres) {
    const ids = [...new Set((t.participantes || []).map((p) => Number(p.id_up)).filter((id) => porUp.has(id)))];
    const info = Object.fromEntries(ids.map((id) => [id, participante(porUp.get(id), [])]));
    salida.set(t.id, calcularCumplimiento(info, enc.get(t.id) || [], sal.get(t.id) || [], fin.get(t.id) || []));
  }
  return salida;
}

// Calcula las 5 actividades de cada unidad con lo registrado del taller.
function calcularCumplimiento(info, encuentros, encuestas, finales) {
  const salida = {};
  for (const p of Object.values(info)) {
    const modulos = [1, 2, 3].map((m) => {
      const e = encuentros.find((x) => x.modulo === m);
      return { modulo: m, realizado: !!e?.realizado_en, minimo: p.minimo, ...sesionValida(e, p) };
    });
    const encuestaSalida = encuestas.some((x) => x.id_up === p.id_up);
    const entregaFinal = finales.some((x) => x.id_up === p.id_up);
    const cumplidas = modulos.filter((m) => m.valida).length + (encuestaSalida ? 1 : 0) + (entregaFinal ? 1 : 0);
    const porcentaje = Math.round((cumplidas / ACTIVIDADES_FORMACION) * 1000) / 10;
    salida[p.id_up] = {
      id_up: p.id_up, id_unico: p.id_unico, modalidad: p.modalidad, modulos, encuesta_salida: encuestaSalida, entrega_final: entregaFinal,
      cumplidas, actividades: ACTIVIDADES_FORMACION, porcentaje, cumple_80: porcentaje >= PORCENTAJE_EXIGIDO,
    };
  }
  return salida;
}
