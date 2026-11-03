// Cargue del RIT (cédula y nombre). Define el Excel que se lee y arma las filas que viajan al servidor, para
// que cada error pueda decir en qué fila del Excel está.
export const HOJA_RIT = 'RIT';

export const COLUMNAS_RIT = [
  { alias: 'cedula', nombre: 'cedula' },
  { alias: 'nombre', nombre: 'nombre' },
];

// Devuelve la cédula sin puntos ni espacios.
const cedulaDe = (v) => String(v ?? '').trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();
// Compara dos nombres para saber si coinciden.
const mismoNombre = (a, b) => String(a).trim().replace(/\s+/g, ' ').toLowerCase()
  === String(b).trim().replace(/\s+/g, ' ').toLowerCase();

// Convierte las filas leídas del Excel en filas y errores; una cédula repetida se envía una sola vez y la
// repetida queda como error.
export function prepararFilasRit(leidas) {
  const filas = [];
  const errores = [];
  const vistas = new Map();
  for (const f of leidas) {
    const cedula = cedulaDe(f.cedula);
    const primera = cedula ? vistas.get(cedula) : null;
    if (primera) {
      const distinto = !mismoNombre(primera.nombre, f.nombre);
      errores.push({
        fila: f._fila, columna: 'cedula', cedula: f.cedula, nombre: f.nombre,
        motivo: `La cédula ${f.cedula} ya estaba en la fila ${primera.fila}${distinto ? ` con otro nombre («${primera.nombre}»)` : ''}. ` +
          'Se ignoró esta fila repetida.',
      });
      continue;
    }
    if (cedula) vistas.set(cedula, { fila: f._fila, nombre: f.nombre });
    filas.push({ fila: f._fila, cedula: f.cedula, nombre: f.nombre });
  }
  return { filas, errores };
}

// Devuelve el texto que se muestra por cada error, como Fila 7, columna nombre.
export const textoErrorRit = (e) => `Fila ${e.fila ?? '?'} · columna ${e.columna}: ${e.motivo}`;
