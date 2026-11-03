// Lo que la convocatoria confirmó por llamada: textos y tonos compartidos por la tarjeta de la convocatoria y
// la lista de asistencia de cada módulo.
// Texto y tono de cada situación de confirmación.
export const CONFIRMACION = {
  asistira: ['ok', 'Confirmó asistencia'],
  no_asistira: ['error', 'Dijo que no asistirá'],
  no_contesto: ['alerta', 'No contestó la llamada'],
  agendada: ['alerta', 'Llamada agendada'],
  vencida: ['error', 'Llamada vencida sin resultado'],
  sin_efecto: ['neutro', 'Llamada sin efecto'],
  por_llamar: ['neutro', 'Sin confirmar por llamada'],
};

// Devuelve Módulo 2 o Todo el taller, cuando la llamada vale para los tres módulos.
export const textoModulo = (m) => (m ? `Módulo ${m}` : 'Todo el taller');

// Devuelve el módulo que una llamada agendada debe preceder: el suyo o, si es de todo el taller, el primero que
// no se ha realizado; null si ya no hay módulo pendiente.
export function moduloLimite(encuentros = [], modulo) {
  if (modulo) return encuentros.find((e) => e.modulo === Number(modulo) && !e.realizado_en) || null;
  return [...encuentros].filter((e) => !e.realizado_en).sort((a, b) => a.modulo - b.modulo)[0] || null;
}

// Cuenta cuántas unidades del grupo quedan en cada situación para un módulo: asistirá, no asistirá y sin
// confirmar.
export function resumenConfirmaciones(participantes, confirmaciones = {}) {
  const r = { asistira: 0, no_asistira: 0, sin_confirmar: 0 };
  for (const p of participantes) {
    const s = confirmaciones[p.id_up]?.situacion;
    if (s === 'asistira' || s === 'no_asistira') r[s] += 1; else r.sin_confirmar += 1;
  }
  return r;
}
