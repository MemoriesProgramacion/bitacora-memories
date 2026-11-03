// Lista de departamentos y cálculo de nodos. El nodo de una cuenta de campo son las cinco primeras letras del
// departamento más un consecutivo (por ejemplo ATLAN1, ATLAN2), que se asigna solo al crearlo.
export const DEPARTAMENTOS = [
  'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar', 'Boyacá', 'Caldas',
  'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía',
  'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander',
  'Putumayo', 'Quindío', 'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre',
  'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada',
];

// Convierte el nombre de un departamento en su código de cinco letras sin tildes ni espacios.
export function codigoDeDepartamento(nombre) {
  return String(nombre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 5);
}

const POR_CODIGO = new Map(DEPARTAMENTOS.map((d) => [codigoDeDepartamento(d), d]));

// Devuelve el departamento al que pertenece un nodo, o null si no se reconoce.
export function departamentoDeNodo(nodo) {
  const m = /^([A-Z]{3,5})\d+$/i.exec(String(nodo || ''));
  return m ? POR_CODIGO.get(m[1].toUpperCase()) || null : null;
}

// Devuelve el departamento tal como está en la lista, o null si no existe.
export function departamentoValido(nombre) {
  const limpio = String(nombre || '').trim();
  return DEPARTAMENTOS.includes(limpio) ? limpio : null;
}

// Calcula el nodo de la próxima cuenta de campo de un departamento: el consecutivo más alto existente más uno.
export async function siguienteNodo(db, departamento) {
  const codigo = codigoDeDepartamento(departamento);
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(substring(nodo FROM '[0-9]+$')::int), 0) AS ultimo
       FROM triadas WHERE upper(nodo) ~ ('^' || $1 || '[0-9]+$')`,
    [codigo],
  );
  return `${codigo}${rows[0].ultimo + 1}`;
}

// Lista cada departamento con el nodo que se asignaría a la siguiente cuenta de campo.
export async function departamentosConSiguiente(db) {
  const { rows } = await db.query(
    `SELECT upper(substring(nodo FROM '^[A-Za-z]+')) AS codigo,
            MAX(substring(nodo FROM '[0-9]+$')::int) AS ultimo,
            count(*)::int AS nodos
       FROM triadas WHERE nodo ~ '^[A-Za-z]+[0-9]+$' GROUP BY 1`,
  );
  const usados = new Map(rows.map((r) => [r.codigo, r]));
  return DEPARTAMENTOS.map((nombre) => {
    const codigo = codigoDeDepartamento(nombre);
    const u = usados.get(codigo);
    return { nombre, codigo, gestores: u?.nodos || 0, siguiente: `${codigo}${(u?.ultimo || 0) + 1}` };
  });
}
