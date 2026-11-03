// Formación en los talleres. La calcula el servidor: los bloques de la sesión, el mínimo de integrantes por
// modalidad, la validez de cada sesión, las encuestas y el 80 %. Aquí se presentan esos datos, se avisa antes
// de enviar y se arman las columnas del Excel de cumplimiento.
import { apiGeneral, qs } from '../inventario/lib/api';

// Pide al servidor la formación de una unidad.
export const pedirFormacionUP = async (idUnico) => (await apiGeneral.get(`/formacion${qs({ id_unico: idUnico })}`)).item;
// Pide al servidor el cumplimiento de formación del territorio.
export const pedirCumplimientoTerritorio = () => apiGeneral.get('/talleres/cumplimiento');

// Devuelve la hora de Colombia, como 2:00 p. m., de una fecha ISO.
export const horaColombia = (iso) => new Intl.DateTimeFormat('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(iso));

// Devuelve el texto de los bloques de la sesión: teórico-práctica y evaluación con sus horas.
export function textoBloques(b) {
  if (!b) return '';
  return `Teórico-práctica ${horaColombia(b.teorico_practico.inicio)}–${horaColombia(b.teorico_practico.fin)} · Evaluación ${horaColombia(b.evaluacion.inicio)}–${horaColombia(b.evaluacion.fin)}`;
}

// Devuelve la información de la unidad en el taller (integrantes, modalidad y mínimo), por id.
export const infoUP = (taller, idUp) => taller?.participantes_info?.[idUp] || taller?.participantes_info?.[String(idUp)] || null;

// Indica si la selección de integrantes llega al mínimo de la modalidad, que en M1 se cumple con que la unidad
// asista; devuelve si es suficiente y el texto.
export function validezSeleccion(info, seleccionados = []) {
  if (!info) return { suficiente: true, texto: '' };
  if (info.modalidad === 'M1') return { suficiente: true, texto: 'M1: asiste la persona inscrita.' };
  const n = seleccionados.length;
  const integrantes = `${n} ${n === 1 ? 'integrante' : 'integrantes'}`;
  return {
    suficiente: n >= info.minimo,
    texto: n >= info.minimo
      ? `${integrantes} (mínimo ${info.minimo}): la sesión cuenta.`
      : `${integrantes} de un mínimo de ${info.minimo} (${info.modalidad}): se guarda, pero la sesión no cuenta para su cumplimiento.`,
  };
}

// Devuelve el texto del estado de una sesión para una unidad según el cálculo del servidor.
export function textoSesion(m) {
  if (!m?.realizado) return 'Pendiente';
  if (m.valida) return 'Cuenta';
  if (m.asistio) return `No cuenta (${m.integrantes} de ${m.minimo})`;
  return 'No asistió';
}

// Devuelve el estado de la convocatoria por correo, como 3 enviados, 1 pendiente y 1 fallido.
export function textoConvocatoria(c) {
  if (!c) return '';
  const total = (c.enviados || 0) + (c.pendientes || 0) + (c.fallidos || 0);
  if (!total) return 'Convocatoria: aún no hay correos en la bandeja de salida.';
  const partes = [
    c.enviados ? `${c.enviados} ${c.enviados === 1 ? 'enviado' : 'enviados'}` : '',
    c.pendientes ? `${c.pendientes} ${c.pendientes === 1 ? 'pendiente' : 'pendientes'}` : '',
    c.fallidos ? `${c.fallidos} ${c.fallidos === 1 ? 'fallido' : 'fallidos'}` : '',
  ].filter(Boolean);
  return `Convocatoria por correo: ${partes.join(' · ')}.`;
}

// Devuelve las respuestas guardadas de una encuesta de la unidad en el taller, o null.
export const encuestaDe = (taller, idUp, tipo, modulo = 0) =>
  (taller?.encuestas || []).find((x) => x.id_up === Number(idUp) && x.tipo === tipo && Number(x.modulo) === Number(modulo))?.respuestas || null;

// Devuelve las encuestas que puede registrar el usuario, con la misma regla del servidor.
export function encuestasPermitidas(taller, esCoordinacion = false) {
  const todo = esCoordinacion || Boolean(taller?.puede_entregar);
  const mios = (taller?.encuentros || []).map((e) => e.modulo);
  return {
    apropiacion_entrada: todo || mios.includes(1),
    apropiacion_salida: todo || mios.includes(3),
    satisfaccion: todo ? [1, 2, 3] : [1, 2, 3].filter((m) => mios.includes(m)),
  };
}

// Devuelve los hallazgos y recomendaciones guardados de la unidad en el taller, o null.
export const resultadoDe = (taller, idUp) => (taller?.resultados || []).find((x) => x.id_up === Number(idUp)) || null;

// Devuelve el texto de la apropiación de conocimientos: entrada, salida y variación en la escala de 1 a 5.
export function textoApropiacion(a) {
  if (!a || (a.entrada == null && a.salida == null)) return 'Apropiación de conocimientos: sin encuestas registradas.';
  const n = (x) => (x == null ? '—' : String(x).replace('.', ','));
  const v = a.variacion == null ? '—' : `${a.variacion > 0 ? '+' : ''}${n(a.variacion)}`;
  return `Apropiación de conocimientos: entrada ${n(a.entrada)} · salida ${n(a.salida)} · variación ${v} (escala 1 a 5).`;
}

// Calcula el promedio de 1 a 5 con un decimal, o null si no hay respuestas.
export function promedio(respuestas) {
  const v = Object.values(respuestas || {}).map(Number).filter((n) => n >= 1 && n <= 5);
  return v.length ? Math.round((v.reduce((a, n) => a + n, 0) / v.length) * 10) / 10 : null;
}

// Devuelve las columnas del Excel de cumplimiento del territorio.
export function columnasCumplimiento() {
  const sesion = (n) => (f) => textoSesion(f.modulos?.find((m) => m.modulo === n));
  return [
    { titulo: 'Taller', valor: (f) => f.taller, ancho: 28 },
    { titulo: 'Región', valor: (f) => f.region, ancho: 14 },
    { titulo: 'Nodo', valor: (f) => f.nodo, ancho: 10 },
    { titulo: 'ID', valor: (f) => f.id_unico, ancho: 12 },
    { titulo: 'Unidad productiva', valor: (f) => f.nombre, ancho: 30 },
    { titulo: 'Modalidad', valor: (f) => f.modalidad, ancho: 10 },
    { titulo: 'Módulo 1', valor: sesion(1), ancho: 18 },
    { titulo: 'Módulo 2', valor: sesion(2), ancho: 18 },
    { titulo: 'Módulo 3', valor: sesion(3), ancho: 18 },
    { titulo: 'Encuesta de apropiación de salida', valor: (f) => (f.encuesta_salida ? 'Sí' : 'No'), ancho: 14 },
    { titulo: 'Entrega final', valor: (f) => (f.entrega_final ? 'Sí' : 'No'), ancho: 12 },
    { titulo: 'Actividades cumplidas', valor: (f) => `${f.cumplidas} de ${f.actividades}`, ancho: 12 },
    { titulo: 'Cumplimiento (%)', valor: (f) => f.porcentaje, ancho: 12 },
    { titulo: 'Cumple el 80 %', valor: (f) => (f.cumple_80 ? 'Sí' : 'No'), ancho: 12 },
  ];
}
