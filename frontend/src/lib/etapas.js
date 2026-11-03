// Etapas documentales y ruta de atención. Los datos llegan del expediente por etapas traducidos por
// adaptarEtapas; los archivos y las comprobaciones vienen como listas, y parseFiles y parseChecks aceptan
// también el texto separado por comas.
import { val, pick, normVal, esErrorHoja } from './utils';

// Etapas documentales; bajoPaso indica que la etapa se dibuja anidada dentro de ese paso de la ruta.
export const STAGES = [
  { titulo: '00 · Documentación del beneficiario',
    check: 'CHECK_DOCS_00_DOCUMENTACION_BENEFICIARIO',
    conteo: 'CONTEO_DOCS_00_DOCUMENTACION_BENEFICIARIO',
    docs: 'DOCS_00_DOCUMENTACION_BENEFICIARIO',
    completa: 'DOC_COMPLETA_BENEFICIARIO_00' },
  { titulo: '01 · Visita 1', check: 'CHECK_DOCS_01_VISITA1',
    conteo: 'CONTEO_DOCS_01_VISITA1', docs: 'DOCS_01_VISITA1',
    completa: 'DOC_COMPLETA_VISITA_1', ritBlock: true },
  { titulo: '02 · Visita 2', check: 'CHECK_DOCS_02_VISITA2',
    conteo: 'CONTEO_DOCS_02_VISITA2', docs: 'DOCS_02_VISITA2',
    completa: 'DOC_COMPLETA_VISITA_2' },
  { titulo: '03 · Fortalecimiento', check: 'CHECK_DOCS_03_FORTALECIMIENTO',
    docs: 'DOCS_03_FORTALECIMIENTO', completa: 'DOC_COMPLETA_TRANSFERENCIA' },
  { titulo: '03.1 · Módulo 1', check: 'CHECK_DOCS_03_01_MODULO_1',
    docs: 'DOCS_03_01_MODULO_1', sub: true },
  { titulo: '03.2 · Módulo 2', check: 'CHECK_DOCS_03_02_MODULO_2',
    docs: 'DOCS_03_02_MODULO_2', sub: true },
  { titulo: '03.3 · Módulo 3', check: 'CHECK_DOCS_03_03_MODULO_3',
    docs: 'DOCS_03_03_MODULO_3', sub: true },
  { titulo: '04 · Talleres', docs: 'DOCS_04_TALLERES',
    check: 'CHECK_DOCS_04_TALLERES', completa: 'DOC_COMPLETA_TALLERES' },
  { titulo: '07.1 · Plan de inversión', check: 'CHECK_DOCS_04_01_APROBACION',
    docs: 'DOCS_04_01_APROBACION', completa: 'DOC_COMPLETA_CAPITALIZACION',
    sub: true, bajoPaso: '7' },
  { titulo: '07.2 · Cotizaciones', sub: true, bajoPaso: '7', docsList: [
    { label: 'Ganadora', key: 'DOCS_04_02_COTIZACION_GANADORA',
      check: 'CHECK_DOCS_04_02_COTIZACION_GANADORA' },
    { label: 'Proveedor 2', key: 'DOCS_04_02_COTIZACION_PROVEEDOR_2',
      check: 'CHECK_DOCS_04_02_PROVEEDOR_2' },
    { label: 'Proveedor 3', key: 'DOCS_04_02_COTIZACION_PROVEEDOR_3',
      check: 'CHECK_DOCS_04_02_PROVEEDOR_3' },
  ] },
  { titulo: '09.1 · Soportes de compra', sub: true, bajoPaso: '9',
    docs: 'DOCS_04_03_SOPORTES_COMPRA', check: 'CHECK_DOCS_COMPRAS' },
  { titulo: '10.1 · Soportes de entrega', sub: true, bajoPaso: '10',
    docs: 'DOCS_04_03_SOPORTES_ENTREGA', check: 'CHECK_DOCS_ENTREGAS' },
];

// Convierte un texto con marcas de presente o faltante en una lista de comprobaciones con label y ok o bad.
export function parseChecks(str) {
  if (Array.isArray(str)) return str.filter((c) => c && c.label);
  const v = val(str);
  if (!v) return [];
  return v.split('|').map((part) => {
    const t = part.trim();
    if (!t) return null;
    let ok = /[\u2705\u2611\u2714]/.test(t);
    let bad = /[\u274C\u274E\u2716\u2717\u2718]/.test(t);
    let label = t.replace(/[\u2705\u2611\u2714\u274C\u274E\u2716\u2717\u2718\uFE0F]/g, '').trim();
    if (!ok && !bad && /^x\s+/i.test(label)) {
      bad = true;
      label = label.replace(/^x\s+/i, '').trim();
    }
    if (!label) return null;
    return { label, ok, bad };
  }).filter(Boolean);
}

// Convierte un texto separado por comas en una lista de nombres de archivo.
export function parseFiles(str) {
  if (Array.isArray(str)) return str.filter(Boolean);
  const v = val(str);
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

// Devuelve el estado documental de la etapa: 1 completa, 0 por subsanar o vacío si está vacía.
export function completaEstado(aud, key) {
  if (!key || !aud) return null;
  const v = val(aud[key]);
  if (v === null) return null;
  const n = String(v).trim().toUpperCase();
  if (['1', '1.0', 'TRUE', 'SI', 'SÍ'].includes(n)) return { label: 'Completa', tono: 'ok' };
  if (['0', '0.0', 'FALSE', 'NO'].includes(n)) return { label: 'Subsanar', tono: 'bad' };
  return { label: 'Vacía', tono: 'bad' };
}

export function hasRIT(aud) {
  if (!aud) return null;
  const v = val(pick(aud, ['TIENE_RIT', 'RIT']));
  if (v === null) return null;
  const n = normVal(v);
  if (['1', '1.0', 'TRUE', 'SI'].includes(n)) return true;
  if (['0', '0.0', 'FALSE', 'NO'].includes(n)) return false;
  return null;
}

const PLAN_INV_KEYS = ['plan_inversion'];
const PLAN_NEG_KEYS = ['plan_negocio'];
const CARRITO_KEYS  = ['PDF_carrito', 'PDF_CARRITO'];
// Claves de las subsanaciones, que se leen del proceso de subsanación cargado en la base maestra.
const SUBSANA_KEYS  = ['proceso_subsanacion'];

function leer(up, keys) {
  const v = val(pick(up, keys));
  if (v === null || esErrorHoja(v)) return null;
  return v;
}

export function estPlanInversion(up) {
  const v = leer(up, PLAN_INV_KEYS);
  if (!v) return null;
  const n = normVal(v);
  if (n.includes('NO VIABILIDAD')) return { label: 'No Viabilidad', tono: 'bad' };
  if (n.includes('VIABILIDAD'))    return { label: 'Viabilidad', tono: 'ok' };
  if (n.includes('SUBSANACION'))   return { label: 'Solicitud Subsanación', tono: 'warn' };
  if (n.includes('ACLARACION'))    return { label: 'Solicitud Aclaración', tono: 'warn' };
  if (n.includes('NO RPN'))        return { label: 'No RPN', tono: 'bad' };
  return { label: v, tono: 'warn' };
}

export function estPlanNegocio(up) {
  const v = leer(up, PLAN_NEG_KEYS);
  if (!v) return null;
  const n = normVal(v);
  if (n.includes('NO APROBADO')) return { label: 'No Aprobado', tono: 'bad' };
  if (n.includes('APROBADO'))    return { label: 'Aprobado', tono: 'ok' };
  return { label: v, tono: 'warn' };
}

export function estPdfCarrito(up) {
  const v = leer(up, CARRITO_KEYS);
  if (!v) return null;
  const n = normVal(v);
  if (n.includes('PROCESADO')) return { label: 'Procesado', tono: 'ok' };
  if (n.includes('PENDIENTE')) return { label: 'Pendiente', tono: 'warn' };
  return { label: v, tono: 'warn' };
}

// Interpreta el valor del proceso de subsanación: pendiente, en proceso, completa o no aplica.
export function estSubsanacion(up) {
  const v = leer(up, SUBSANA_KEYS);
  if (!v) return null;
  const n = normVal(v);
  if (n.includes('PENDIENTE'))  return { label: 'Pendiente de Proceso de Subsanación', tono: 'bad' };
  if (n.includes('EN PROCESO')) return { label: 'En Proceso de Subsanación', tono: 'warn' };
  if (n.includes('COMPLETA') || n.includes('SUBSANADO')) return { label: 'Subsanación Completa', tono: 'ok' };
  if (n.includes('NO APLICA'))  return { label: 'No Aplica', tono: 'neutral' };
  return { label: v, tono: 'warn' };
}

// Cuenta las unidades pendientes de subsanación sobre el total filtrado, para la barra de subsanaciones.
export function subsanacionPendiente(up) {
  const v = leer(up, SUBSANA_KEYS);
  return !!v && normVal(v).includes('PENDIENTE');
}

// Estados del validador de documentos de entrega, que llegan en cada fila como estado_entrega.
const ESTADOS_ENTREGA = {
  aprobado:     { label: 'Aprobado', tono: 'ok' },
  completo:     { label: 'Aprobado', tono: 'ok' },
  revision:     { label: 'En revisión', tono: 'warn' },
  en_revision:  { label: 'En revisión', tono: 'warn' },
  correcciones: { label: 'Por corregir', tono: 'bad' },
  pendiente:    { label: 'Sin documentos', tono: 'neutral' },
};

export function estEntregaValidador(up) {
  const e = up && up.estado_entrega;
  return e ? ESTADOS_ENTREGA[e] || { label: e, tono: 'warn' } : null;
}

// Los 12 pasos de la ruta de atención; el orden de esta lista manda tanto en el resumen como en la ficha.
export const RUTA = [
  { n: '1',  label: 'RIT',            tipo: 'rit' },
  { n: '2',  label: 'Doc. Visita 1',  tipo: 'doc', key: 'DOC_COMPLETA_VISITA_1' },
  { n: '3',  label: 'Doc. Visita 2',  tipo: 'doc', key: 'DOC_COMPLETA_VISITA_2' },
  { n: '4',  label: 'Talleres',       tipo: 'doc', key: 'DOC_COMPLETA_TRANSFERENCIA' },
  { n: '5',  label: 'PDF Carrito',    tipo: 'estado', fn: estPdfCarrito },
  { n: '6',  label: 'Viabilidad',     tipo: 'estado', fn: estPlanInversion },
  { n: '7',  label: 'Aprobación',     tipo: 'estado', fn: estPlanNegocio },
  { n: '8',  label: 'Subsanaciones',  tipo: 'estado', fn: estSubsanacion,
    cuenta: subsanacionPendiente },
  { n: '9',  label: 'Doc. Compra',    tipo: 'doc', key: 'DOC_COMPLETA_COMPRA' },
  { n: '10', label: 'Doc. Entrega',   tipo: 'doc', key: 'DOC_COMPLETA_ENTREGA', validador: true },
  { n: '11', label: 'Doc. Visita 3',  tipo: 'doc', key: 'DOC_COMPLETA_VISITA_3' },
  { n: '12', label: 'Evento',         tipo: 'evento' },
];

// Indica si la unidad cumplió un paso, para el avance del resumen; si el paso trae cuenta, esa función decide
// qué unidades suman.
export function pasoLogrado(step, up, aud) {
  if (step.cuenta) return step.cuenta(up, aud);
  if (step.tipo === 'estado') {
    const p = step.fn(up);
    return !!(p && p.tono === 'ok');
  }
  if (!aud) return false;
  if (step.tipo === 'rit') return hasRIT(aud) === true;
  if (step.tipo === 'evento') {
    const e = val(aud.EVENTO);
    return e !== null && normVal(e) === 'ASISTE';
  }
  const v = val(aud[step.key]);
  if (v === null) return false;
  const n = String(v).trim().toUpperCase();
  return ['1', '1.0', 'TRUE', 'SI', 'SÍ'].includes(n);
}

// Traduce un paso de la ruta a un estado que se pueda mostrar en la ficha.
export function pasoEstadoUP(step, up, aud) {
  if (step.tipo === 'estado') return step.fn(up);
  if (!aud) return null;

  if (step.tipo === 'rit') {
    const r = hasRIT(aud);
    if (r === null) return null;
    return r ? { label: 'Con RIT', tono: 'ok' } : { label: 'Sin RIT', tono: 'bad' };
  }
  if (step.tipo === 'evento') {
    const e = val(aud.EVENTO);
    if (e === null) return null;
    return normVal(e) === 'ASISTE'
      ? { label: 'Asiste', tono: 'ok' }
      : { label: e, tono: 'bad' };
  }
  const v = val(aud[step.key]);
  if (v === null) return null;
  const n = String(v).trim().toUpperCase();
  if (['1', '1.0', 'TRUE', 'SI', 'SÍ'].includes(n)) return { label: 'Completa', tono: 'ok' };
  if (['0', '0.0', 'FALSE', 'NO'].includes(n)) return { label: 'Subsanar', tono: 'bad' };
  return null;
}

// Estado de la unidad según el campo habilitadas: 1 activa y 0 inactiva.
const ESTADO_UP_KEYS = ['habilitadas', 'HABILITADAS'];

export function isInactiva(up) {
  const v = val(pick(up, ESTADO_UP_KEYS));
  if (v === null) return null;
  const n = v.trim().toUpperCase();
  if (['1', '1.0', 'TRUE', 'SI', 'SÍ'].includes(n)) return false;
  if (['0', '0.0', 'FALSE', 'NO'].includes(n)) return true;
  return null;
}

export function estadoUpLabel(up) {
  const i = isInactiva(up);
  if (i === null) return null;
  return i ? 'Inactiva' : 'Activa';
}
