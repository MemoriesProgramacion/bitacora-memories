// Alcance territorial del usuario: calcula qué unidades productivas puede ver o modificar según su nodo,
// región, departamento y modalidad, y ofrece condiciones SQL y verificaciones para aplicarlo en cada consulta.
import { query } from './db.js';
import { ROLES, ROLES_CON_TERRITORIO } from './config.js';
import { prohibido } from './errores.js';

export const CAMPOS_ALCANCE = ['region', 'departamento', 'modalidad', 'nodo'];

// Normaliza un texto para comparar: sin tildes, sin espacios sobrantes y en mayúsculas.
export const normTexto = (v) => (v === undefined || v === null ? ''
  : String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase());

// Aplica esa misma normalización dentro de una consulta SQL.
export const sqlNorm = (col) =>
  `upper(translate(btrim(${col}), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))`;

// Devuelve las restricciones territoriales del usuario ya normalizadas, o null si no tiene ninguna.
export function alcanceDe(usuario) {
  if (!usuario) return { ninguno: true };
  if (usuario.rol === ROLES.GESTOR) return { nodo: normTexto(usuario.nodo) };
  if (ROLES_CON_TERRITORIO.includes(usuario.rol) && !usuario.superadmin && !usuario.general) {
    const asignado = usuario.alcance || {};
    const a = {};
    for (const c of CAMPOS_ALCANCE) {
      const v = normTexto(asignado[c]);
      if (v) a[c] = v;
    }
    return Object.keys(a).length ? a : { ninguno: true };
  }
  return null;
}

// Indica si el usuario ve solo una parte del territorio.
export const tieneAlcance = (usuario) => alcanceDe(usuario) !== null;

// Arma la condición SQL que limita una consulta al territorio del usuario.
export function condicionAlcance(usuario, cols, params) {
  const a = alcanceDe(usuario);
  if (!a) return 'TRUE';
  if (a.ninguno) return 'FALSE';
  const partes = [];
  for (const c of CAMPOS_ALCANCE) {
    if (a[c] === undefined) continue;
    if (!cols[c]) throw new Error(`condicionAlcance: falta la columna de "${c}".`);
    params.push(a[c]);
    partes.push(`${sqlNorm(cols[c])} = $${params.length}`);
  }
  return partes.join(' AND ');
}

// Arma la condición para tablas que apuntan a la unidad productiva por su id y guardan el nodo.
export function condicionAlcanceFila(usuario, { idUp, nodo }, params) {
  const a = alcanceDe(usuario);
  if (!a) return 'TRUE';
  if (a.ninguno) return 'FALSE';
  const soloNodo = Object.keys(a).every((c) => c === 'nodo');
  if (soloNodo) return condicionAlcance(usuario, { nodo }, params);
  const interna = condicionAlcance(usuario, {
    nodo: 't_a.nodo', region: 't_a.region', departamento: 'u_a.departamento', modalidad: 'u_a.modalidad',
  }, params);
  return `EXISTS (SELECT 1 FROM unidades_productivas u_a
                    LEFT JOIN triadas t_a ON t_a.id_triada = u_a.id_triada
                   WHERE u_a.id_up = ${idUp} AND ${interna})`;
}

export const COLUMNAS_UP = {
  nodo: 't.nodo', region: 't.region', departamento: 'up.departamento', modalidad: 'up.modalidad',
};

// Indica si una unidad productiva está dentro del alcance del usuario.
export function enAlcance(usuario, up) {
  const a = alcanceDe(usuario);
  if (!a) return true;
  if (a.ninguno) return false;
  return CAMPOS_ALCANCE.every((c) => a[c] === undefined || (a[c] !== '' && normTexto(up?.[c]) === a[c]));
}

// Lanza un error 403 si la unidad queda fuera del alcance.
export function exigirAlcance(usuario, up, mensaje) {
  if (enAlcance(usuario, up)) return;
  const gestor = usuario?.rol === ROLES.GESTOR;
  throw prohibido(mensaje || (gestor
    ? 'Ese registro no pertenece a tu nodo.'
    : 'Ese registro está fuera de tu alcance.'));
}

// Lanza un error 403 si la unidad de un registro guardado queda fuera del alcance.
export async function exigirAlcanceDeUP(usuario, idUp, nodo) {
  if (!tieneAlcance(usuario)) return;
  const { rows } = await query(
    `SELECT t.nodo, t.region, up.departamento, up.modalidad
       FROM unidades_productivas up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE up.id_up = $1`,
    [idUp ?? null],
  );
  exigirAlcance(usuario, rows[0] || { nodo });
}

// Devuelve los nodos que el usuario puede ver, o null si puede ver todos.
export async function nodosEnAlcance(usuario) {
  const a = alcanceDe(usuario);
  if (!a) return null;
  if (a.ninguno) return [];
  if (a.nodo !== undefined && Object.keys(a).length === 1) return a.nodo ? [a.nodo] : [];
  const params = [];
  const condicion = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT DISTINCT upper(btrim(t.nodo)) AS nodo
       FROM triadas t
       LEFT JOIN unidades_productivas up ON up.id_triada = t.id_triada
      WHERE ${condicion}`,
    params,
  );
  return rows.map((r) => r.nodo);
}
