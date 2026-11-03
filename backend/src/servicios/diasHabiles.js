// Cálculo de días hábiles en Colombia: lunes a viernes sin los festivos nacionales, incluidos los fijos, los
// trasladados al lunes siguiente y los que dependen de la Pascua. Se usa para el plazo de 4 días hábiles de
// subsanación de un plan no aprobado.
const iso = (d) => d.toISOString().slice(0, 10);
const dia = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
const masDias = (d, n) => new Date(d.getTime() + n * 86400000);
// Traslada una fecha al lunes siguiente si no cae en lunes.
const alLunes = (d) => { const s = d.getUTCDay(); return s === 1 ? d : masDias(d, ((8 - s) % 7) || 7); };

// Calcula el domingo de Pascua con el algoritmo de Meeus, Jones y Butcher del calendario gregoriano.
export function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const diaMes = ((h + l - 7 * m + 114) % 31) + 1;
  return dia(anio, mes, diaMes);
}

const cache = new Map();
// Devuelve los festivos nacionales de un año en formato AAAA-MM-DD.
export function festivosColombia(anio) {
  if (cache.has(anio)) return cache.get(anio);
  const p = pascua(anio);
  const fechas = [
    dia(anio, 1, 1), dia(anio, 5, 1), dia(anio, 7, 20), dia(anio, 8, 7), dia(anio, 12, 8), dia(anio, 12, 25),
    ...[[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => alLunes(dia(anio, m, d))),
    masDias(p, -3), masDias(p, -2), masDias(p, 43), masDias(p, 64), masDias(p, 71),
  ];
  const conjunto = new Set(fechas.map(iso));
  cache.set(anio, conjunto);
  return conjunto;
}

// Indica si una fecha es día hábil: lunes a viernes y no festivo.
export function esHabil(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  const s = d.getUTCDay();
  return s !== 0 && s !== 6 && !festivosColombia(d.getUTCFullYear()).has(fecha);
}

// Devuelve la fecha que resulta de sumar n días hábiles, sin contar la fecha de partida.
export function sumarDiasHabiles(fecha, n) {
  let d = new Date(`${fecha}T00:00:00Z`);
  let faltan = n;
  while (faltan > 0) {
    d = masDias(d, 1);
    if (esHabil(iso(d))) faltan -= 1;
  }
  return iso(d);
}
