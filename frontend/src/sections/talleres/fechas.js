// Funciones de fecha y de apoyo de los talleres: conversión entre el campo de fecha y hora y el formato ISO de
// Colombia, comparación de regiones sin tildes y generación del calendario mensual.
// Convierte una fecha ISO en el valor del campo de fecha y hora, en hora de Colombia.
export const fechaInput = (iso) => iso ? new Date(new Date(iso).getTime() - 5 * 60 * 60_000).toISOString().slice(0, 16) : '';
// Da formato legible a una fecha ISO en hora de Colombia.
export const fechaColombia = (iso) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
// Convierte el valor del campo de fecha y hora en ISO con el huso de Colombia.
export const inicioISO = (v) => `${v}:00-05:00`;
// Devuelve el día en hora de Colombia de una fecha ISO.
export const diaColombia = (iso) => fechaInput(iso).slice(0, 10);
// Compara dos regiones sin tildes, mayúsculas ni espacios.
export const regionIgual = (a, b) => String(a || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  === String(b || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// Devuelve la clave de asistencia de una unidad: su id si lo tiene o su documento.
export const claveAsistente = (up) => up.id_up ? `up:${up.id_up}` : up.documento;

// Devuelve las 42 fechas, de seis semanas desde el lunes, que se muestran en el calendario de un mes.
export function diasCalendario(mes) {
  const [a, m] = mes.split('-').map(Number);
  const primero = new Date(Date.UTC(a, m - 1, 1));
  const desdeLunes = (primero.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(a, m - 1, 1 - desdeLunes + i)).toISOString().slice(0, 10));
}
// Devuelve el mes que resulta de sumar o restar meses a uno dado.
export function moverMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
