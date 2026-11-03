// Informe detallado de la Bitácora. Convierte el resumen del panel, barras con número y porcentaje, en listas
// de quiénes están detrás de cada número y arma el Excel descargable. Todo trabaja sobre las filas que ya
// pasaron el filtro del panel, así el informe respeta región, departamento, modalidad, nodo y estado.
import { AUDIT_JOIN_KEY } from './config';
import { RUTA, pasoLogrado, pasoEstadoUP, estadoUpLabel, isInactiva } from './etapas';
import { val, fullName, uniqueSorted, countBy, formatDateEs } from './utils';
import { descargarLibro, ESTILO, estiloTono } from './exportarExcel';

export const SIN_INFO = 'Sin información';
export const SIN_DATO = 'Sin dato';

const ETIQUETAS_FILTRO = {
  region: 'Región', dpto: 'Departamento', modalidad: 'Modalidad', nodo: 'Nodo', estado: 'Estado de la UP',
};

// Devuelve la auditoría de una unidad.
export function audDe(up, auditIndex) {
  const id = up && up[AUDIT_JOIN_KEY] != null ? String(up[AUDIT_JOIN_KEY]).trim() : '';
  return auditIndex ? auditIndex[id] : undefined;
}

// Devuelve el estado de una unidad en un paso de la ruta y si suma en la barra de ese paso; en subsanaciones
// suman las pendientes, igual que en el panel.
export function estadoPaso(step, up, aud) {
  const e = pasoEstadoUP(step, up, aud);
  return {
    label: e?.label || SIN_INFO,
    tono: e?.tono || 'neutral',
    cuenta: pasoLogrado(step, up, aud),
  };
}

// Pasos de avance: todos menos los que cuentan pendientes.
export const PASOS_AVANCE = RUTA.filter((s) => !s.cuenta);

export function pasosCumplidos(up, aud) {
  return PASOS_AVANCE.filter((s) => pasoLogrado(s, up, aud)).length;
}

// Devuelve qué significa sumar en la barra de un paso.
export function textoCuenta(step) {
  return step.cuenta
    ? { si: 'Pendientes', no: 'Sin pendiente' }
    : { si: 'Cumplen', no: 'Les falta' };
}

export function estadoUpTexto(up) {
  return estadoUpLabel(up) || 'Sin estado';
}

export function tonoEstadoUp(up) {
  const i = isInactiva(up);
  return i === null ? 'neutral' : i ? 'bad' : 'ok';
}

// Devuelve el valor de un campo como lo agrupa el conteo, con null como sin dato.
export function valorCampo(up, campo) {
  return val(up[campo]) || SIN_DATO;
}

// Agrupa filas por una etiqueta y devuelve grupos del más grande al más pequeño, con sin información siempre al
// final.
export function agrupar(filas, fn) {
  const m = new Map();
  for (const up of filas) {
    const { label, tono } = fn(up);
    if (!m.has(label)) m.set(label, { label, tono, filas: [] });
    m.get(label).filas.push(up);
  }
  return [...m.values()].sort((a, b) => {
    const sa = a.label === SIN_INFO || a.label === 'Sin estado';
    const sb = b.label === SIN_INFO || b.label === 'Sin estado';
    if (sa !== sb) return sa ? 1 : -1;
    return b.filas.length - a.filas.length;
  });
}

// Devuelve el resumen por nodo de un conjunto de filas.
export function resumenPorNodo(filas, auditIndex) {
  const m = new Map();
  for (const up of filas) {
    const nodo = val(up.nodo) || SIN_DATO;
    if (!m.has(nodo)) {
      m.set(nodo, {
        nodo,
        gestor: val(up.nombre_gestor) || '',
        region: val(up.region) || '',
        total: 0, activas: 0, inactivas: 0,
        pasos: Object.fromEntries(RUTA.map((s) => [s.n, 0])),
        sumaAvance: 0,
      });
    }
    const r = m.get(nodo);
    const aud = audDe(up, auditIndex);
    r.total += 1;
    const i = isInactiva(up);
    if (i === false) r.activas += 1;
    if (i === true) r.inactivas += 1;
    for (const s of RUTA) if (pasoLogrado(s, up, aud)) r.pasos[s.n] += 1;
    r.sumaAvance += pasosCumplidos(up, aud);
  }
  return [...m.values()]
    .map((r) => ({ ...r, avance: r.total ? r.sumaAvance / (r.total * PASOS_AVANCE.length) : 0 }))
    .sort((a, b) => a.nodo.localeCompare(b.nodo, 'es', { numeric: true }));
}

// Ordena las listas de forma estable por nodo y luego por ID.
export function ordenar(filas) {
  return [...filas].sort((a, b) => (
    String(a.nodo || '').localeCompare(String(b.nodo || ''), 'es', { numeric: true })
    || String(a.ID_unico).localeCompare(String(b.ID_unico), 'es', { numeric: true })
  ));
}

// Busca texto libre dentro de una lista del informe.
export function coincide(up, texto) {
  const t = texto.toLowerCase().trim();
  if (!t) return true;
  return [up.ID_unico, up.unidad_nombre, fullName(up), up.unidad_doc, up.integrante_doc_inicial,
    up.nodo, up.nombre_gestor, up.mpio, up.dpto]
    .some((v) => String(v ?? '').toLowerCase().includes(t));
}

const COLS_BASE = [
  { titulo: 'ID', valor: (u) => numeroSiSe(u.ID_unico), ancho: 8 },
  { titulo: 'Unidad productiva', valor: (u) => val(u.unidad_nombre) || '', ancho: 32 },
  { titulo: 'Beneficiario', valor: (u) => fullName(u), ancho: 30 },
  { titulo: 'Documento', valor: (u) => val(u.integrante_doc_inicial) || val(u.unidad_doc) || '', ancho: 14 },
  { titulo: 'Estado UP', valor: (u) => estadoUpTexto(u), ancho: 11,
    estilo: (u) => estiloTono(tonoEstadoUp(u)) },
  { titulo: 'Nodo', valor: (u) => val(u.nodo) || '', ancho: 11 },
  { titulo: 'Gestor', valor: (u) => val(u.nombre_gestor) || '', ancho: 26 },
  { titulo: 'Región', valor: (u) => val(u.region) || '', ancho: 12 },
  { titulo: 'Departamento', valor: (u) => val(u.dpto) || '', ancho: 16 },
  { titulo: 'Municipio', valor: (u) => val(u.mpio) || '', ancho: 18 },
  { titulo: 'Modalidad', valor: (u) => val(u.modalidad) || '', ancho: 16 },
];

function numeroSiSe(v) {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) ? n : (v ?? '');
}

// Devuelve las columnas del detalle: los datos de la unidad y un estado por cada paso de la ruta.
export function columnasDetalle(auditIndex, pasos = RUTA) {
  return [
    ...COLS_BASE,
    { titulo: `Pasos cumplidos (de ${PASOS_AVANCE.length})`,
      valor: (u) => pasosCumplidos(u, audDe(u, auditIndex)), ancho: 12 },
    ...pasos.map((s) => ({
      titulo: `${s.n} · ${s.label}`,
      valor: (u) => estadoPaso(s, u, audDe(u, auditIndex)).label,
      estilo: (u) => estiloTono(estadoPaso(s, u, audDe(u, auditIndex)).tono),
      ancho: 15,
    })),
  ];
}

function lineasFiltro(valores) {
  const activos = Object.entries(valores || {}).filter(([, v]) => v);
  if (!activos.length) return [['Filtros', 'Ninguno (todas las unidades)']];
  return activos.map(([k, v]) => [
    ETIQUETAS_FILTRO[k] || k,
    k === 'estado' ? (v === 'activa' ? 'Activas' : 'Inactivas') : v,
  ]);
}

function hojaResumen({ filas, auditIndex, etapasCargadas, filtro, usuario }) {
  const total = filas.length;
  const pct = (n) => ({ v: total ? n / total : 0, s: ESTILO.porcentaje });
  const t = (texto) => ({ v: texto, s: ESTILO.seccion });
  const R = [];

  R.push([{ v: 'Informe detallado · Bitácora Memories', s: ESTILO.titulo }]);
  R.push(['Generado', `${formatDateEs(new Date())}, ${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`]);
  if (usuario) R.push(['Por', usuario]);
  lineasFiltro(filtro).forEach((l) => R.push(l));
  if (!etapasCargadas) {
    R.push([{ v: 'Aviso', s: ESTILO.bad }, { v: 'Los datos de etapas no estaban cargados: los pasos documentales aparecen como "Sin información".', s: ESTILO.bad }]);
  }
  R.push([]);

  R.push([t('Indicador'), t('Unidades'), t('%')]);
  const act = filas.filter((u) => isInactiva(u) === false).length;
  const ina = filas.filter((u) => isInactiva(u) === true).length;
  R.push(['Unidades productivas', total, pct(total)]);
  R.push(['Activas', act, pct(act)]);
  R.push(['Inactivas', ina, pct(ina)]);
  R.push(['Departamentos', uniqueSorted(filas.map((u) => u.dpto)).length]);
  R.push(['Municipios', uniqueSorted(filas.map((u) => u.mpio)).length]);
  R.push(['Nodos', uniqueSorted(filas.map((u) => u.nodo)).length]);
  R.push([]);

  R.push([t('Ruta de atención'), t('Unidades'), t('%'), t('Qué cuenta')]);
  for (const s of RUTA) {
    const n = filas.filter((u) => pasoLogrado(s, u, audDe(u, auditIndex))).length;
    R.push([`${s.n} · ${s.label}`, n, pct(n), s.cuenta ? 'Pendientes por subsanar' : 'Paso cumplido']);
  }
  R.push([]);

  R.push([t('Por modalidad'), t('Unidades'), t('%')]);
  countBy(filas, 'modalidad').forEach((c) => R.push([c.label, c.n, pct(c.n)]));
  R.push([]);
  R.push([t('Por región'), t('Unidades'), t('%')]);
  countBy(filas, 'region').forEach((c) => R.push([c.label, c.n, pct(c.n)]));
  R.push([]);
  R.push([{ v: 'Hay una hoja por cada punto de la ruta (1. RIT, 2. Doc. Visita 1, …) con la lista de quiénes lo tienen y quiénes no. Todas las hojas traen filtros en el encabezado.', s: ESTILO.normal }]);

  return {
    nombre: 'Resumen',
    encabezado: false,
    columnas: [0, 1, 2, 3].map((i) => ({ titulo: '', valor: (r) => r[i] ?? '', ancho: [40, 14, 10, 26][i] })),
    filas: R,
  };
}

function hojaPorNodo(filas, auditIndex) {
  const datos = resumenPorNodo(filas, auditIndex);
  return {
    nombre: 'Por nodo',
    columnas: [
      { titulo: 'Nodo', valor: (r) => r.nodo, ancho: 11 },
      { titulo: 'Gestor', valor: (r) => r.gestor, ancho: 26 },
      { titulo: 'Región', valor: (r) => r.region, ancho: 12 },
      { titulo: 'Unidades', valor: (r) => r.total, ancho: 10 },
      { titulo: 'Activas', valor: (r) => r.activas, ancho: 9 },
      { titulo: 'Inactivas', valor: (r) => r.inactivas, ancho: 9 },
      { titulo: 'Avance promedio', valor: (r) => r.avance, ancho: 11,
        estilo: () => ESTILO.porcentaje },
      ...RUTA.map((s) => ({
        titulo: `${s.n} · ${s.label}${s.cuenta ? ' (pend.)' : ''}`,
        valor: (r) => r.pasos[s.n],
        ancho: 12,
        estilo: (r) => (s.cuenta && r.pasos[s.n] > 0 ? ESTILO.bad : ESTILO.normal),
      })),
    ],
    filas: datos,
  };
}

// Arma una hoja por punto de la ruta con quiénes están en cada estado: primero los que suman en la barra, luego
// el resto y al final sin información.
export function hojaPaso(step, filas, auditIndex) {
  const grupos = agrupar(filas, (up) => estadoPaso(step, up, audDe(up, auditIndex)));
  const suma = (g) => g.filas.some((up) => pasoLogrado(step, up, audDe(up, auditIndex)));
  const orden = [...grupos.filter(suma), ...grupos.filter((g) => !suma(g))];
  const lista = orden.flatMap((g) => ordenar(g.filas).map((up) => ({ up, g })));
  return {
    nombre: `${step.n}. ${step.label}`,
    columnas: [
      { titulo: step.label, valor: (r) => r.g.label, ancho: 22, estilo: (r) => estiloTono(r.g.tono) },
      ...COLS_BASE.map((c) => ({ ...c, valor: (r) => c.valor(r.up), estilo: c.estilo && ((r) => c.estilo(r.up)) })),
    ],
    filas: lista,
  };
}

function nombreArchivo(prefijo, partes) {
  const hoy = new Date();
  const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return [prefijo, ...partes.filter(Boolean), iso].join('_').replace(/[^\wÀ-ÿ-]+/g, '_');
}

// Descarga el informe completo: resumen, por nodo, detalle por unidad y una hoja por punto.
export function descargarInformeBitacora({ filas, auditIndex, etapasCargadas, filtro, etiquetaFiltro, usuario }) {
  const orden = ordenar(filas);
  return descargarLibro(nombreArchivo('informe_bitacora', [etiquetaFiltro]), [
    hojaResumen({ filas: orden, auditIndex, etapasCargadas, filtro, usuario }),
    hojaPorNodo(orden, auditIndex),
    { nombre: 'Detalle por UP', columnas: columnasDetalle(auditIndex), filas: orden },
    ...RUTA.map((s) => hojaPaso(s, orden, auditIndex)),
  ]);
}

// Descarga solo un punto de la ruta, desde el botón dentro del punto desplegado.
export function descargarPaso({ step, filas, auditIndex, etiquetaFiltro }) {
  return descargarLibro(nombreArchivo('bitacora', [etiquetaFiltro, `${step.n}_${step.label}`]), [
    hojaPaso(step, filas, auditIndex),
    hojaPorNodo(filas, auditIndex),
  ]);
}

// Descarga la lista puntual del panel de detalle tal como se ve en pantalla; si viene paso, su estado va
// primero después de los datos de la unidad.
export function descargarListaDetalle({ filas, auditIndex, titulo, grupo, paso, etiquetaFiltro }) {
  const pasos = paso ? [paso, ...RUTA.filter((s) => s !== paso)] : RUTA;
  return descargarLibro(nombreArchivo('bitacora', [etiquetaFiltro, titulo, grupo]), [
    { nombre: String(titulo || 'Detalle').slice(0, 31), columnas: columnasDetalle(auditIndex, pasos), filas: ordenar(filas) },
    hojaPorNodo(filas, auditIndex),
  ]);
}
