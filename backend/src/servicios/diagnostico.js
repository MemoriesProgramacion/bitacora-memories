// Diagnóstico estructurado de la unidad productiva. Hay uno por unidad, dividido en secciones que se guardan
// por partes como borrador: la primera visita cubre la verificación en sitio, la socialización de la ruta y la
// caracterización de entrada, y la segunda cubre recursos, mercado y necesidades, entre otras.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { conRegistro, diferenciasCortas, clavesDe } from './actividad.js';
import { buscarUP } from './unidades.js';
import { archivosDe, modalidadDe, salidasCargadas, tieneFormato } from './catalogoVisitas.js';
import { faltantesCon, limpiarCon, vacio } from './secciones.js';
import { flujoRevision } from './revisionCLR.js';
const MODALIDADES = ['M1', 'M2', 'M3', 'M4'].map((m) => ({ codigo: m, nombre: m }));
const ZONAS = [{ codigo: 'urbana', nombre: 'Urbana' }, { codigo: 'rural', nombre: 'Rural' }];
const TIPOS_ACTIVIDAD = [
  { codigo: 'produccion', nombre: 'Producción o transformación' },
  { codigo: 'comercio', nombre: 'Comercio' },
  { codigo: 'servicios', nombre: 'Servicios' },
  { codigo: 'agropecuaria', nombre: 'Agropecuaria' },
  { codigo: 'mixta', nombre: 'Mixta' },
];
const PERIODOS = [
  { codigo: 'diario', nombre: 'Al día' }, { codigo: 'semanal', nombre: 'A la semana' }, { codigo: 'mensual', nombre: 'Al mes' },
];
export const CONCEPTOS = [
  { codigo: 'favorable', nombre: 'Favorable' },
  { codigo: 'favorable_ajustes', nombre: 'Favorable con ajustes' },
  { codigo: 'no_favorable', nombre: 'No favorable' },
];
// Estados del negocio, que también usa la caracterización de salida para compararlos.
export const ETAPAS_NEGOCIO = [
  { codigo: 'idea', nombre: 'Idea de negocio' }, { codigo: 'inicio', nombre: 'En inicio (menos de un año)' },
  { codigo: 'en_marcha', nombre: 'En marcha' }, { codigo: 'consolidado', nombre: 'Consolidado' },
];
export const ESTADOS_PRODUCCION = [
  { codigo: 'no_produce', nombre: 'No produce actualmente' }, { codigo: 'intermitente', nombre: 'Produce por temporadas o pedidos' },
  { codigo: 'continua', nombre: 'Produce de forma continua' },
];
export const ESTADOS_COMERCIALIZACION = [
  { codigo: 'no_vende', nombre: 'Aún no vende' }, { codigo: 'local', nombre: 'Vende en el barrio o la vereda' },
  { codigo: 'municipal', nombre: 'Vende en el municipio' }, { codigo: 'regional', nombre: 'Vende en la región o fuera de ella' },
];
export const CAMPOS_NEGOCIO = [
  { clave: 'etapa', etiqueta: 'Etapa del negocio', tipo: 'lista', opciones: ETAPAS_NEGOCIO, obligatorio: true },
  { clave: 'productos', etiqueta: 'Productos o servicios que ofrece', tipo: 'texto_largo', max: 2000, obligatorio: true },
  { clave: 'valor_agregado', etiqueta: 'Valor agregado (qué lo diferencia)', tipo: 'texto_largo', max: 2000, obligatorio: true },
  { clave: 'estado_produccion', etiqueta: 'Estado de la producción', tipo: 'lista', opciones: ESTADOS_PRODUCCION, obligatorio: true },
  { clave: 'estado_comercializacion', etiqueta: 'Estado de la comercialización', tipo: 'lista', opciones: ESTADOS_COMERCIALIZACION, obligatorio: true },
];
export const FORMATO_PLAN_NEGOCIO = 'Plan de negocios';
export const FORMATO_INNPULSA = 'Indicadores iniciales INNPULSA';

// Hace un campo obligatorio solo si otro campo de la sección tiene cierto valor.
const siCampo = (campo, valor) => ({ campo, valor });

// Define las secciones del diagnóstico, sus campos y su tipo: texto, texto largo, sí o no, lista, entero,
// pesos, fecha y lista de textos.
export const ESQUEMA = [
  {
    clave: 'verificacion', titulo: 'Verificación en sitio', visita: 'v1', brecha: 'ET1-02',
    ayuda: 'Lo que el gestor comprobó en la visita. Con un «No», la Visita 1 no se cierra como exitosa.',
    campos: [
      { clave: 'existe', etiqueta: '¿La unidad productiva existe en el lugar visitado?', tipo: 'sino', obligatorio: true },
      { clave: 'funciona', etiqueta: '¿Está en funcionamiento?', tipo: 'sino', obligatorio: true },
      { clave: 'informacion_veraz', etiqueta: '¿La información registrada es veraz?', tipo: 'sino', obligatorio: true },
      { clave: 'fecha', etiqueta: 'Fecha de la verificación', tipo: 'fecha', obligatorio: true },
      { clave: 'observacion', etiqueta: 'Observación', tipo: 'texto_largo', max: 2000, ayuda: 'Obligatoria si alguna respuesta es «No».' },
    ],
  },
  {
    clave: 'socializacion', titulo: 'Socialización de la ruta', visita: 'v1', brecha: 'ET1-28',
    campos: [
      { clave: 'realizada', etiqueta: 'Se presentó el equipo y se socializó la ruta del programa', tipo: 'sino', obligatorio: true },
      { clave: 'fecha', etiqueta: 'Fecha de la socialización', tipo: 'fecha', obligatorio: true },
    ],
  },
  {
    clave: 'identificacion', titulo: 'Identificación', visita: 'v1', brecha: 'ET1-12',
    campos: [
      { clave: 'nombre_iniciativa', etiqueta: 'Nombre de la iniciativa', tipo: 'texto', max: 300, obligatorio: true },
      { clave: 'modalidad', etiqueta: 'Tipo de unidad productiva (modalidad)', tipo: 'lista', opciones: MODALIDADES, obligatorio: true },
      { clave: 'departamento', etiqueta: 'Departamento', tipo: 'texto', max: 100, obligatorio: true },
      { clave: 'municipio', etiqueta: 'Municipio', tipo: 'texto', max: 100, obligatorio: true },
      { clave: 'direccion', etiqueta: 'Dirección o vereda', tipo: 'texto', max: 300, obligatorio: true },
      { clave: 'zona', etiqueta: 'Zona', tipo: 'lista', opciones: ZONAS, obligatorio: true },
    ],
  },
  {
    clave: 'formalizacion', titulo: 'Formalización', visita: 'v1', brecha: 'ET1-13',
    campos: [
      { clave: 'camara_comercio', etiqueta: '¿Tiene registro en Cámara de comercio?', tipo: 'sino', obligatorio: true },
      { clave: 'matricula', etiqueta: 'Número de matrícula mercantil', tipo: 'texto', max: 40, obligatorio: siCampo('camara_comercio', 'si') },
      { clave: 'rut', etiqueta: '¿Tiene RUT?', tipo: 'sino', obligatorio: true },
      { clave: 'nit', etiqueta: 'NIT o número del RUT', tipo: 'texto', max: 20, obligatorio: siCampo('rut', 'si'), ayuda: 'Solo números (con o sin dígito de verificación).' },
      { clave: 'fecha_certificado', etiqueta: 'Fecha de expedición del certificado de existencia y representación', tipo: 'fecha', ayuda: 'Exigida en M3 y M4 (o si se carga el certificado): máximo un mes antes de la Visita 1.' },
    ],
  },
  {
    clave: 'actividad', titulo: 'Actividad y productos', visita: 'v1', brecha: 'ET1-14',
    campos: [
      { clave: 'tipo_actividad', etiqueta: 'Tipo de actividad', tipo: 'lista', opciones: TIPOS_ACTIVIDAD, obligatorio: true },
      { clave: 'productos_servicios', etiqueta: 'Productos o servicios', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'volumen_produccion', etiqueta: 'Volumen de producción o ventas', tipo: 'entero', obligatorio: true },
      { clave: 'unidad_volumen', etiqueta: 'Unidad del volumen (kilos, unidades, servicios…)', tipo: 'texto', max: 60, obligatorio: true },
      { clave: 'periodo_volumen', etiqueta: 'Periodo del volumen', tipo: 'lista', opciones: PERIODOS, obligatorio: true },
      { clave: 'mercado_objetivo', etiqueta: 'Mercado objetivo', tipo: 'texto_largo', max: 2000, obligatorio: true },
    ],
  },
  {
    clave: 'recursos', titulo: 'Recursos y finanzas', visita: 'v2', brecha: 'ET1-16',
    ayuda: 'Cifras mensuales en pesos. La utilidad y el margen los calcula el servidor.',
    campos: [
      { clave: 'personas_trabajan', etiqueta: 'Personas que trabajan en la unidad', tipo: 'entero', obligatorio: true },
      { clave: 'recurso_humano', etiqueta: 'Recurso humano (roles y dedicación)', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'recurso_fisico', etiqueta: 'Recurso físico (local, maquinaria, equipos)', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'recurso_financiero', etiqueta: 'Recurso financiero (ahorros, créditos, capital de trabajo)', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'ingresos_mensuales', etiqueta: 'Ingresos mensuales', tipo: 'pesos', obligatorio: true },
      { clave: 'costos_mensuales', etiqueta: 'Costos y gastos mensuales', tipo: 'pesos', obligatorio: true },
    ],
  },
  {
    clave: 'indicadores', titulo: 'Línea base: ventas y clientes', visita: 'v2', brecha: 'ET1-18',
    ayuda: 'Con los recursos y finanzas forman la línea base, que se congela al cerrar la Visita 2 y se compara con la Visita 3.',
    campos: [
      { clave: 'ventas_mensuales', etiqueta: 'Ventas mensuales', tipo: 'pesos', obligatorio: true },
      { clave: 'clientes_mes', etiqueta: 'Clientes al mes', tipo: 'entero', obligatorio: true },
    ],
  },
  {
    clave: 'negocio', titulo: 'Estado del negocio', visita: 'v2', brecha: 'TR-04',
    ayuda: 'Cómo está el negocio al entrar al programa. Se vuelve a registrar en la Visita 3 para ver el cambio.',
    campos: CAMPOS_NEGOCIO,
  },
  {
    clave: 'mercado', titulo: 'Mercado y necesidades', visita: 'v2', brecha: 'ET1-17',
    campos: [
      { clave: 'condiciones_mercado', etiqueta: 'Condiciones del mercado (clientes, competencia, precios)', tipo: 'texto_largo', max: 2000, obligatorio: true },
      { clave: 'redes_alianzas', etiqueta: 'Redes y alianzas', tipo: 'texto_largo', max: 2000, obligatorio: true, ayuda: 'Si no tiene, escribe «Ninguna».' },
      { clave: 'necesidades', etiqueta: 'Necesidades identificadas', tipo: 'texto_largo', max: 2000, obligatorio: true },
    ],
  },
  {
    clave: 'foda', titulo: 'Matriz FODA', visita: 'v2', brecha: 'ET1-19',
    ayuda: 'Al menos un elemento en cada cuadrante (máximo 10).',
    campos: [
      { clave: 'fortalezas', etiqueta: 'Fortalezas', tipo: 'lista_textos', max: 300, max_items: 10, obligatorio: true },
      { clave: 'oportunidades', etiqueta: 'Oportunidades', tipo: 'lista_textos', max: 300, max_items: 10, obligatorio: true },
      { clave: 'debilidades', etiqueta: 'Debilidades', tipo: 'lista_textos', max: 300, max_items: 10, obligatorio: true },
      { clave: 'amenazas', etiqueta: 'Amenazas', tipo: 'lista_textos', max: 300, max_items: 10, obligatorio: true },
    ],
  },
  {
    clave: 'plan_fortalecimiento', titulo: 'Plan de fortalecimiento', visita: 'v2', brecha: 'ET1-21',
    campos: [
      { clave: 'objetivos', etiqueta: 'Objetivos', tipo: 'texto_largo', max: 3000, obligatorio: true },
      { clave: 'diagnostico_resumido', etiqueta: 'Diagnóstico resumido', tipo: 'texto_largo', max: 3000, obligatorio: true },
      { clave: 'estrategia', etiqueta: 'Estrategia', tipo: 'texto_largo', max: 3000, obligatorio: true },
      { clave: 'recursos', etiqueta: 'Recursos', tipo: 'texto_largo', max: 3000, obligatorio: true },
      { clave: 'capital_productivo', etiqueta: 'Capital productivo necesario', tipo: 'texto_largo', max: 3000, obligatorio: true },
      { clave: 'valor_capital', etiqueta: 'Valor estimado del capital productivo', tipo: 'pesos' },
    ],
  },
  {
    clave: 'concepto', titulo: 'Concepto técnico', visita: 'v2', brecha: 'FUN-GES-03',
    campos: [
      { clave: 'resultado', etiqueta: 'Concepto', tipo: 'lista', opciones: CONCEPTOS, obligatorio: true },
      { clave: 'justificacion', etiqueta: 'Justificación', tipo: 'texto_largo', max: 3000, obligatorio: true },
    ],
  },
];
const SECCION = Object.fromEntries(ESQUEMA.map((s) => [s.clave, s]));
export const SECCIONES_V1 = ESQUEMA.filter((s) => s.visita === 'v1').map((s) => s.clave);
export const SECCIONES_V2 = ESQUEMA.filter((s) => s.visita === 'v2').map((s) => s.clave);
// Secciones de la primera visita, cuyos hechos ya no cambian una vez cerrada.
const SOLO_EN_V1 = ['verificacion', 'socializacion'];

// Limpia los datos de una sección, dejando solo los campos conocidos con su tipo; lanza un error 400 con el
// motivo.
export function limpiarSeccion(clave, datos = {}) {
  const s = SECCION[clave];
  if (!s) throw solicitudInvalida('Esa sección del diagnóstico no existe.');
  return limpiarCon(s, datos);
}

// Devuelve lo que le falta a una sección para estar completa.
export function faltantesSeccion(clave, datos) {
  const s = SECCION[clave];
  const d = datos || {};
  const faltan = faltantesCon(s, d);
  if (clave === 'verificacion' && ['existe', 'funciona', 'informacion_veraz'].some((k) => d[k] === 'no') && vacio(d.observacion)) {
    faltan.push(`${s.titulo} › Observación (hay una respuesta «No»)`);
  }
  if (clave === 'socializacion' && d.realizada === 'no') faltan.push(`${s.titulo} › La ruta debe socializarse en la Visita 1`);
  return faltan;
}

// Calcula en el servidor el nivel de formalización, la utilidad y el margen.
export function calculos(d = {}) {
  const f = d.formalizacion || {};
  const nivel = !f.camara_comercio || !f.rut ? null
    : f.camara_comercio === 'si' && f.rut === 'si' ? 'formal'
      : f.camara_comercio === 'si' || f.rut === 'si' ? 'parcial' : 'informal';
  const r = d.recursos || {};
  const hayCifras = Number.isFinite(r.ingresos_mensuales) && Number.isFinite(r.costos_mensuales);
  const utilidad = hayCifras ? r.ingresos_mensuales - r.costos_mensuales : null;
  const margen = hayCifras && r.ingresos_mensuales > 0 ? Math.round((utilidad / r.ingresos_mensuales) * 1000) / 10 : null;
  return { nivel_formalizacion: nivel, utilidad_mensual: utilidad, margen_porcentaje: margen };
}

// Calcula si cada visita tiene su diagnóstico completo y qué falta; la segunda incluye lo de la primera.
export function completitud(d = {}) {
  const de = (claves) => claves.flatMap((k) => faltantesSeccion(k, d[k]));
  const v1 = de(SECCIONES_V1);
  const v2 = [...v1, ...de(SECCIONES_V2)];
  const negativos = verificacionNegativa(d.verificacion);
  return {
    v1: { completo: !v1.length, faltan: v1, cierra_exitosa: !v1.length && !negativos.length, verificacion_negativa: negativos },
    v2: { completo: !v2.length, faltan: v2 },
  };
}

// Indica si la verificación en sitio dio un no y devuelve los aspectos negativos.
export function verificacionNegativa(v = {}) {
  const nombres = { existe: 'la unidad no existe en el lugar', funciona: 'no está en funcionamiento', informacion_veraz: 'la información no es veraz' };
  return Object.entries(nombres).filter(([k]) => v?.[k] === 'no').map(([, n]) => n);
}

function exigirLectura(usuario) {
  if (esGestor(usuario) || [ROLES.COORDINADOR, ROLES.TECNICO].includes(usuario?.rol)) return;
  throw prohibido('Tu rol no consulta el diagnóstico de la unidad productiva.');
}
function exigirEscritura(usuario) {
  if (esGestor(usuario) || usuario?.rol === ROLES.COORDINADOR) return;
  throw prohibido('Tu rol no diligencia el diagnóstico.');
}

async function unidad(usuario, idUnico) {
  if (!txt(idUnico)) throw solicitudInvalida('Falta la unidad (id_unico).');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return up;
}

const COLUMNAS = ['verificacion', 'socializacion', 'identificacion', 'formalizacion', 'actividad', 'recursos', 'indicadores', 'negocio', 'mercado', 'foda', 'plan_fortalecimiento', 'concepto'];

// Devuelve los datos del diagnóstico de la unidad como objeto por sección, o vacío.
export async function datosDiagnostico(db, idUp, bloquear = false) {
  const { rows: [d] } = await db.query(
    `SELECT * FROM up_diagnosticos WHERE id_up = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [idUp],
  );
  return d || null;
}
const secciones = (fila) => Object.fromEntries(COLUMNAS.map((k) => [k, fila?.[k] || null]));

// Devuelve el estado de las visitas de la unidad: creada, cerrada, salida, soportes y fechas.
export async function visitasDeUP(db, idUp) {
  const { rows } = await db.query(
    `SELECT id, tipo_visita, cerrada, fecha_cierre, documento FROM visitas
      WHERE id_up = $1 AND tipo_visita IN ('v1','v2','v3') ORDER BY creado_en`, [idUp],
  );
  const salida = {};
  for (const r of rows) {
    const doc = r.documento || {};
    const cerrada = doc.cierre ? !!doc.cierre.cerrada : !!r.cerrada;
    const fila = {
      id: r.id, creada: true, cerrada,
      fecha_visita: doc.programacion?.fecha_visita || null,
      fecha_cierre: doc.cierre?.fecha_cierre || r.fecha_cierre || null,
      soportes: doc.soportes || {},
      salida: cerrada ? salidasCargadas(r.tipo_visita, doc.soportes) : [],
    };
    const previa = salida[r.tipo_visita];
    if (previa && previa.cerrada && !cerrada) {
      previa.otras_abiertas = true;
      continue;
    }
    if (previa) fila.salida = [...new Set([...previa.salida, ...fila.salida])];
    salida[r.tipo_visita] = fila;
  }
  return salida;
}

// Indica si se puede editar la sección y devuelve el motivo si no.
function bloqueoEdicion(clave, fila, vis) {
  const estado = fila?.estado_revision || 'sin_enviar';
  if (estado === 'revisado') return 'El diagnóstico ya fue revisado por la coordinación: no se modifica.';
  if (estado === 'pendiente') return 'El diagnóstico está en revisión de la coordinación: espera su decisión.';
  if (estado !== 'devuelto' && vis.v2?.cerrada) return 'La Visita 2 ya está cerrada: el diagnóstico no se modifica.';
  if (SOLO_EN_V1.includes(clave) && vis.v1?.cerrada) return 'La Visita 1 ya está cerrada: la verificación y la socialización no se modifican.';
  return null;
}

// Devuelve el plan de negocio vinculado a la unidad: el último cargado en la segunda visita.
function planNegocio(vis, conEnlace) {
  const v2 = vis.v2;
  if (!v2) return null;
  const a = archivosDe(v2.soportes, FORMATO_PLAN_NEGOCIO).at(-1);
  if (!a) return null;
  return {
    archivo: a.archivo, cargado_en: a.cargado_en, cargado_por: a.cargado_por, visita_id: v2.id,
    url: conEnlace && a.blob ? `/visitas/archivo?id=${encodeURIComponent(v2.id)}&blob=${encodeURIComponent(a.blob)}` : null,
  };
}

// Devuelve las secciones, campos y opciones para dibujar los formularios.
export function esquemaDiagnostico() {
  return { ok: true, item: { secciones: ESQUEMA, conceptos: CONCEPTOS } };
}

// Devuelve las secciones, los cálculos, la completitud, la revisión y lo que el usuario puede hacer.
export async function obtenerDiagnostico(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await unidad(usuario, idUnico);
  const [fila, vis] = await Promise.all([datosDiagnostico({ query }, up.id_up), visitasDeUP({ query }, up.id_up)]);
  const d = secciones(fila);
  const escribe = esGestor(usuario) || usuario.rol === ROLES.COORDINADOR;
  const estado = fila?.estado_revision || 'sin_enviar';
  return {
    ok: true,
    item: {
      id_unico: up.id_unico,
      secciones: d,
      sugeridos: { identificacion: { nombre_iniciativa: up.unidad_nombre || null, modalidad: modalidadDe(up.modalidad) || null, departamento: up.departamento || null } },
      calculos: calculos(d),
      completitud: completitud(d),
      revision: {
        estado, observacion: fila?.revision_observacion || null, revisado_por: fila?.revisado_por || null,
        revisado_en: fila?.revisado_en || null, historial: fila?.revision_historial || [],
      },
      visitas: { v1_cerrada: !!vis.v1?.cerrada, v2_cerrada: !!vis.v2?.cerrada },
      plan_negocio: planNegocio(vis, esGestor(usuario) || usuario.rol === ROLES.COORDINADOR),
      innpulsa_cargado: !!vis.v2 && tieneFormato(vis.v2.soportes, FORMATO_INNPULSA),
      actualizado_por: fila?.actualizado_por || null, actualizado_en: fila?.actualizado_en || null,
      editables: escribe ? COLUMNAS.filter((k) => !bloqueoEdicion(k, fila, vis)) : [],
      puede_revisar: usuario.rol === ROLES.COORDINADOR && estado === 'pendiente',
      puede_devolver: usuario.rol === ROLES.COORDINADOR && ['pendiente', 'revisado'].includes(estado),
      puede_reenviar: escribe && estado === 'devuelto',
    },
  };
}

// Guarda una sección del diagnóstico como borrador por partes.
export function guardarSeccion(usuario, { id_unico: idUnico, seccion, datos } = {}) {
  const clave = txt(seccion);
  return conRegistro(
    usuario, { accion: 'diagnostico.guardar', objeto: { tipo: 'diagnostico', id: clave }, idUnico: txt(idUnico) },
    async () => {
      exigirEscritura(usuario);
      const up = await unidad(usuario, idUnico);
      if (!COLUMNAS.includes(clave)) throw solicitudInvalida('Esa sección del diagnóstico no existe.');
      const limpio = limpiarSeccion(clave, datos);
      return transaccion(async (db) => {
        await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
        const fila = await datosDiagnostico(db, up.id_up, true);
        const motivo = bloqueoEdicion(clave, fila, await visitasDeUP(db, up.id_up));
        if (motivo) throw new HttpError(409, motivo);
        const quien = usuario.nombre || usuario.sub || null;
        await db.query(
          `INSERT INTO up_diagnosticos (id_up, ${clave}, actualizado_por, actualizado_en) VALUES ($1, $2, $3, now())
           ON CONFLICT (id_up) DO UPDATE SET ${clave} = EXCLUDED.${clave}, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
          [up.id_up, JSON.stringify(limpio), quien],
        );
        return { ok: true, item: { seccion: clave, datos: limpio, faltan: faltantesSeccion(clave, limpio) }, _antes: fila?.[clave] || null };
      });
    },
    (r) => ({ seccion: clave, campos: diferenciasCortas(r._antes || {}, r.item.datos || {}, clavesDe(r._antes, r.item.datos)) }),
  ).then(({ _antes, ...r }) => r);
}

const flujo = flujoRevision({
  tabla: 'up_diagnosticos', accion: 'diagnostico', unidad, exigirEscritura,
  textos: { sujeto: 'El diagnóstico', devuelto: 'un diagnóstico devuelto', revisado: 'revisado', visita: 'Visita 2' },
  completo: (fila) => completitud(secciones(fila)).v2,
  alDecidir: async (db, up, decision) => {
    if (decision !== 'revisado') return;
    const { recongelarLineaBase } = await import('./salida.js');
    await recongelarLineaBase(db, up);
  },
});
// Registra la decisión de la coordinación sobre el diagnóstico: revisado o devuelto.
export const revisarDiagnostico = flujo.revisar;
// Reenvía a revisión un diagnóstico devuelto que ya está completo.
export const reenviarDiagnostico = flujo.reenviar;

// Exige el diagnóstico completo para cerrar la visita; con un acta de salida la visita se cierra sin estas
// exigencias.
export async function exigirDiagnosticoParaCerrar(db, up, tipo, soportes) {
  if (!['v1', 'v2'].includes(tipo) || salidasCargadas(tipo, soportes).length) return;
  const fila = await datosDiagnostico(db, up.id_up, true);
  const d = secciones(fila);
  const c = completitud(d);
  if (tipo === 'v1') {
    const negativos = verificacionNegativa(d.verificacion);
    if (negativos.length) {
      throw solicitudInvalida(`La verificación en sitio dice que ${negativos.join(', ')}: la Visita 1 no se cierra como exitosa. Para cerrarla, carga el Acta de No Aceptación, o el Acta de Retiro con su Acta de Novedades.`);
    }
    if (!c.v1.completo) throw solicitudInvalida(`Para cerrar la Visita 1 falta en el diagnóstico: ${c.v1.faltan.join('; ')}.`);
    return;
  }
  const faltan = [...c.v2.faltan];
  if (!tieneFormato(soportes, FORMATO_PLAN_NEGOCIO)) faltan.push(`el formato «${FORMATO_PLAN_NEGOCIO}»`);
  if (!tieneFormato(soportes, FORMATO_INNPULSA)) faltan.push(`el formato «${FORMATO_INNPULSA}»`);
  if (faltan.length) throw solicitudInvalida(`Para cerrar la Visita 2 falta: ${faltan.join('; ')}.`);
  const estado = fila?.estado_revision || 'sin_enviar';
  if (estado === 'sin_enviar' || estado === 'devuelto') {
    await db.query("UPDATE up_diagnosticos SET estado_revision = 'pendiente' WHERE id_up = $1", [up.id_up]);
  }
}
