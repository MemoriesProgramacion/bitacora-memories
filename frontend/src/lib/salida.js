// Línea base y evaluación de salida. El servidor define las secciones de la tercera visita, congela la línea
// base al cerrar la segunda y calcula la variación. Aquí van las llamadas, lo que falta por sección y las
// columnas del tablero para exportarlo a Excel.
import { apiGeneral, qs } from '../inventario/lib/api';
import { faltantesCampos, pesos } from './secciones';
import { ESTADOS_REVISION } from './diagnostico';

let esquemaEnCurso = null;
// Pide el esquema de la evaluación de salida una sola vez.
export function cargarEsquemaSalida() {
  if (!esquemaEnCurso) {
    esquemaEnCurso = apiGeneral.get('/evaluacion/esquema').then((r) => r.item).catch((err) => {
      esquemaEnCurso = null;
      throw err;
    });
  }
  return esquemaEnCurso;
}

export const pedirEvaluacion = async (idUnico) => (await apiGeneral.get(`/evaluacion${qs({ id_unico: idUnico })}`)).item;
export const guardarSeccionSalida = (idUnico, seccion, datos) => apiGeneral.post('/evaluacion', { id_unico: idUnico, seccion, datos });
export const revisarEvaluacion = (idUnico, decision, observacion) => apiGeneral.post('/evaluacion/revisar', { id_unico: idUnico, decision, observacion });
export const reenviarEvaluacion = (idUnico) => apiGeneral.post('/evaluacion/reenviar', { id_unico: idUnico });
export const pedirTablero = (filtros = {}) => apiGeneral.get(`/evaluacion/tablero${qs(filtros)}`);

// Devuelve lo que falta en una sección de la evaluación, las de campos; el uso de activos se revisa aparte.
export const faltantesSalida = (seccion, d) => faltantesCampos(seccion, d);

// Devuelve lo que falta del uso de los activos: un estado por bien y, si no está en uso, por qué.
export function faltantesUsoActivos(bienes, datos) {
  const items = new Map((datos?.items || []).map((x) => [Number(x.id_linea), x]));
  return bienes.flatMap((b) => {
    const x = items.get(Number(b.id_linea));
    if (!x?.estado) return [b.nombre];
    if (x.estado !== 'en_uso' && !String(x.observacion || '').trim()) return [`${b.nombre}: explica por qué no está en uso`];
    return [];
  });
}

// Devuelve lo que impide cerrar la tercera visita según la evaluación, para el botón de cierre.
export function bloqueosSalida(datos, sinGuardar = []) {
  if (!datos) return [];
  const lista = datos.completitud.completo ? [] : [`evaluación de salida: ${datos.completitud.faltan.length} dato(s)`];
  if (sinGuardar.length) lista.push(`${TEXTO_SIN_GUARDAR} ${sinGuardar.join(', ')}`);
  return lista;
}

// Inicio del aviso de cambios sin guardar, que Visitas usa para preguntar antes de salir.
export const TEXTO_SIN_GUARDAR = 'cambios sin guardar en:';

// Devuelve la variación para mostrar, como +50 %, −12,5 % o un guion.
export function textoVariacion(pct) {
  if (pct === null || pct === undefined) return '—';
  const signo = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${signo}${Math.abs(pct).toLocaleString('es-CO')} %`;
}

// Devuelve el valor de un indicador según su tipo.
export const textoIndicador = (tipo, v) => (v === null || v === undefined ? '—' : tipo === 'pesos' ? pesos(v) : Number(v).toLocaleString('es-CO'));

// Devuelve las columnas del tablero para Excel.
export function columnasTablero(indicadores) {
  const base = [
    { titulo: 'ID', valor: (f) => f.id_unico, ancho: 12 },
    { titulo: 'Unidad productiva', valor: (f) => f.nombre, ancho: 32 },
    { titulo: 'Región', valor: (f) => f.region, ancho: 14 },
    { titulo: 'Nodo', valor: (f) => f.nodo, ancho: 12 },
    { titulo: 'Modalidad', valor: (f) => f.modalidad, ancho: 22 },
  ];
  const porIndicador = indicadores.flatMap((i) => [
    { titulo: `${i.etiqueta} (línea base)`, valor: (f) => f.indicadores[i.clave]?.base ?? '', ancho: 18 },
    { titulo: `${i.etiqueta} (salida)`, valor: (f) => f.indicadores[i.clave]?.salida ?? '', ancho: 18 },
    { titulo: `${i.etiqueta} (variación %)`, valor: (f) => f.indicadores[i.clave]?.variacion_pct ?? '', ancho: 16 },
  ]);
  return [...base, ...porIndicador,
    { titulo: 'Satisfacción (1 a 5)', valor: (f) => f.satisfaccion ?? '', ancho: 14 },
    { titulo: 'Revisión', valor: (f) => (ESTADOS_REVISION[f.estado_revision] || ESTADOS_REVISION.sin_enviar).texto, ancho: 14 }];
}
