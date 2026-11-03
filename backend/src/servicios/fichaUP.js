// Edición de los datos de una unidad productiva. Actualiza tres bloques con los mismos nombres que devuelven
// obtenerUnidad y obtenerDocumento: datos_up (ficha de la unidad), datos_representante y expediente (cabecera
// del expediente).
import { transaccion } from '../db.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';
import { conRegistro, MODIFICADO } from './actividad.js';
import { ACTIVIDADES_NO_FINANCIABLES, codigoDeLista } from './clasificacion.js';

// Datos personales del representante: en la actividad solo queda que cambiaron, no su valor.
const REP_SENSIBLES = ['telefono1', 'telefono2', 'correo1', 'correo2', 'direccion', 'fecha_nacimiento', 'sexo'].map((c) => `representantes.${c}`);
const sinDatosPersonales = (cambios) => Object.fromEntries(
  Object.entries(cambios || {}).map(([k, v]) => [k, REP_SENSIBLES.includes(k) ? MODIFICADO : v]));

const T = (max) => ({ tipo: 'texto', max });
const B = { tipo: 'bool' };
const N = { tipo: 'entero' };
const D = { tipo: 'fecha' };
const TS = { tipo: 'fechahora' };
const NUM = { tipo: 'numero', min: -180, max: 180 };

// Equivalencia de cada campo del cuerpo con su columna y su tipo.
const UP = {
  nombre: { col: 'nombre', ...T(300) }, actividad: { col: 'actividad', ...T(300) },
  habilitada: { col: 'habilitada', ...B },
  novedad_incapacitante: { col: 'novedad_incapacitante', ...B },
  modalidad: { col: 'modalidad', ...T(100) }, sector: { col: 'sector', ...T(150) }, nit: { col: 'nit', ...T(30) },
  departamento: { col: 'departamento', ...T(100) }, municipio: { col: 'municipio', ...T(100) },
  producto_servicio: { col: 'producto_servicio', ...T(500) }, necesidades: { col: 'necesidades', ...T(5000) },
  resultado: { col: 'resultado', ...T(200) }, actualizacion_datos: { col: 'actualizacion_datos', ...T(100) },
  doc_interventoria: { col: 'doc_interventoria', ...T(200) }, observaciones: { col: 'observaciones', ...T(5000) },
  enlace_carpeta: { col: 'enlace_carpeta', ...T(1000) },
  ciiu: { col: 'ciiu', tipo: 'ciiu' },
  actividad_no_financiable: {
    col: 'actividad_no_financiable', tipo: 'lista', lista: ACTIVIDADES_NO_FINANCIABLES, nombre: 'la actividad no financiable',
  },
};

const REP = {
  nombre1: { col: 'nombre1', ...T(60) }, nombre2: { col: 'nombre2', ...T(60) },
  apellido1: { col: 'apellido1', ...T(60) }, apellido2: { col: 'apellido2', ...T(60) },
  sexo: { col: 'sexo', ...T(20) }, fecha_nacimiento: { col: 'fecha_nacimiento', ...D },
  documento_expedicion: { col: 'documento_expedicion', ...T(100) },
  telefono1: { col: 'telefono1', ...T(30) }, telefono2: { col: 'telefono2', ...T(30) },
  correo1: { col: 'correo1', ...T(150) }, correo2: { col: 'correo2', ...T(150) },
  tiene_correo2: { col: 'tiene_correo2', ...B }, direccion: { col: 'direccion', ...T(300) },
};

// Campos del expediente, que se edita con la misma forma anidada con que se lee.
const EXP = {
  doc_interventoria: { col: 'doc_interventoria', ...T(200) }, observaciones: { col: 'observaciones', ...T(5000) },
  'control.up_aprobada': { col: 'up_aprobada', ...B }, 'control.lote_up_aprobada': { col: 'lote_up_aprobada', ...T(50) },
  'control.doc_completa_gestor': { col: 'doc_completa_gestor', ...B }, 'control.doc_completa_triada': { col: 'doc_completa_triada', ...B },
  'control.novedad_dps_gestor': { col: 'novedad_dps_gestor', ...T(500) },
  'control.novedad_contacto_no_posible': { col: 'novedad_contacto_no_posible', ...B },
  'rit.tiene_rit': { col: 'rit_tiene', ...B }, 'rit.fecha_enviado': { col: 'rit_fecha_enviado', ...TS },
  'rit.total_dias': { col: 'rit_total_dias', ...N }, 'rit.ubicacion': { col: 'rit_ubicacion', ...T(300) },
  'rit.direccion': { col: 'rit_direccion', ...T(300) },
  'rit.latitud': { col: 'rit_latitud', ...NUM, min: -90, max: 90 }, 'rit.longitud': { col: 'rit_longitud', ...NUM },
  'pdf_carrito.estado': { col: 'pdf_carrito_estado', ...T(100) },
  'viabilidad.plan_inversion': { col: 'viabilidad_plan_inversion', ...T(200) },
  'aprobacion.plan_negocio': { col: 'aprobacion_plan_negocio', ...T(200) },
  'subsanaciones.comite': { col: 'subsanaciones_comite', ...T(5000) },
  'subsanaciones.proceso_subsanacion': { col: 'subsanaciones_proceso', ...T(5000) },
  'evento.asistencia': { col: 'evento_asistencia', ...T(100) },
};

// Aplana un objeto anidado a llaves con puntos, por ejemplo control.up_aprobada.
function aplanar(obj) {
  const salida = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      for (const [k2, v2] of Object.entries(v)) salida[`${k}.${k2}`] = v2;
    } else salida[k] = v;
  }
  return salida;
}

function limpiar(campo, spec, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  switch (spec.tipo) {
    case 'texto': {
      const s = txt(v);
      if (s && s.length > spec.max) throw solicitudInvalida(`«${campo}» admite máximo ${spec.max} caracteres.`);
      return s || null;
    }
    case 'bool':
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 'false') return v === 'true';
      throw solicitudInvalida(`«${campo}» debe ser Sí o No.`);
    case 'entero': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000) throw solicitudInvalida(`«${campo}» debe ser un número entero.`);
      return n;
    }
    case 'numero': {
      const n = Number(v);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) throw solicitudInvalida(`«${campo}» está fuera de rango.`);
      return n;
    }
    case 'fecha':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw solicitudInvalida(`«${campo}» debe ser una fecha AAAA-MM-DD.`);
      return String(v);
    case 'fechahora':
      if (Number.isNaN(Date.parse(v))) throw solicitudInvalida(`«${campo}» debe ser una fecha válida.`);
      return new Date(v).toISOString();
    case 'ciiu': {
      const c = String(v).replace(/\s+/g, '');
      if (!/^\d{4}$/.test(c)) throw solicitudInvalida(`«${campo}» debe ser una clase CIIU de 4 dígitos.`);
      return c;
    }
    case 'lista':
      return codigoDeLista(spec.lista, v, spec.nombre);
    default:
      throw solicitudInvalida(`«${campo}» no se puede editar.`);
  }
}

// Valida un bloque contra su lista y devuelve la columna con su valor solo de lo que llegó.
function bloque(nombre, entrada, spec) {
  const plano = nombre === 'expediente' ? aplanar(entrada) : (entrada || {});
  const salida = {};
  for (const [campo, valor] of Object.entries(plano)) {
    const s = spec[campo];
    if (!s) throw solicitudInvalida(`«${campo}» no se puede editar en ${nombre}.`);
    const limpio = limpiar(campo, s, valor);
    if (limpio !== undefined) salida[s.col] = limpio;
  }
  return salida;
}

// Hace el UPDATE de una tabla con solo las columnas que cambian y devuelve el antes y el después.
async function actualizar(db, tabla, claveCol, claveVal, cambios, extra = '') {
  const cols = Object.keys(cambios);
  if (!cols.length) return {};
  const lista = cols.map((c) => `"${c}"`).join(', ');
  const { rows: [antes] } = await db.query(`SELECT ${lista} FROM ${tabla} WHERE ${claveCol} = $1 FOR UPDATE`, [claveVal]);
  const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
  await db.query(`UPDATE ${tabla} SET ${sets}${extra} WHERE ${claveCol} = $1`, [claveVal, ...cols.map((c) => cambios[c])]);
  const { rows: [despues] } = await db.query(`SELECT ${lista} FROM ${tabla} WHERE ${claveCol} = $1`, [claveVal]);
  const dif = {};
  for (const c of cols) {
    const a = antes?.[c] instanceof Date ? antes[c].toISOString() : antes?.[c] ?? null;
    const d = despues?.[c] instanceof Date ? despues[c].toISOString() : despues?.[c] ?? null;
    if (String(a) !== String(d)) dif[`${tabla}.${c}`] = [a, d];
  }
  return dif;
}

// Valida y guarda los cambios de la ficha, el representante y el expediente de una unidad.
export async function editarUnidad(usuario, cuerpo = {}) {
  if (!usuario?.general) throw prohibido('Solo el Coordinador general y el Profesional de seguimiento e información editan los datos de la unidad.');
  const idUnico = txt(cuerpo.id_unico);
  if (!idUnico) throw solicitudInvalida('Falta la unidad (id_unico).');
  const cambiosUp = bloque('datos_up', cuerpo.datos_up, UP);
  const cambiosRep = bloque('datos_representante', cuerpo.datos_representante, REP);
  const cambiosExp = bloque('expediente', cuerpo.expediente, EXP);
  if (!Object.keys(cambiosUp).length && !Object.keys(cambiosRep).length && !Object.keys(cambiosExp).length) {
    throw solicitudInvalida('No hay cambios para guardar.');
  }

  return conRegistro(
    usuario, { accion: 'unidad.editar', objeto: { tipo: 'unidad', id: idUnico }, idUnico },
    () => transaccion(async (db) => {
      const { rows: [up] } = await db.query(
        'SELECT id_up, id_representante FROM unidades_productivas WHERE id_unico = $1 FOR UPDATE', [idUnico]);
      if (!up) throw noEncontrado('La unidad productiva no existe.');
      const cambios = {};
      Object.assign(cambios, await actualizar(db, 'unidades_productivas', 'id_up', up.id_up, cambiosUp, ', fecha_actualizacion = now()'));
      if (Object.keys(cambiosRep).length) {
        if (!up.id_representante) throw solicitudInvalida('Esta unidad no tiene representante registrado.');
        Object.assign(cambios, await actualizar(db, 'representantes', 'id_representante', up.id_representante, cambiosRep));
      }
      if (Object.keys(cambiosExp).length) {
        const { rowCount } = await db.query('SELECT 1 FROM expedientes_up WHERE id_up = $1', [up.id_up]);
        if (!rowCount) throw solicitudInvalida('Esta unidad no tiene expediente documental.');
        Object.assign(cambios, await actualizar(db, 'expedientes_up', 'id_up', up.id_up, cambiosExp, ', fecha_actualizacion = now()'));
      }
      return { ok: true, id_unico: idUnico, cambios };
    }),
    (r) => ({ campos: sinDatosPersonales(r.cambios) }),
  );
}
