// Utilidades compartidas del backend para limpiar y validar valores recibidos.
import { SIN_DATOS, ROLES } from './config.js';

// Devuelve un texto limpio para guardar; vacío, sin datos o indefinido dan null.
export function txt(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === SIN_DATOS) return null;
  return s;
}

// Convierte a booleano de forma tolerante: true y false, 1 y 0, sí y no, true y false como texto.
export function bool(v) {
  if (v === true || v === false) return v;
  if (v === undefined || v === null || v === '' || v === SIN_DATOS) return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 's', 'x'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return null;
}

export function entero(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Devuelve una fecha AAAA-MM-DD, aceptando también ISO completo, o null si no es válida.
export function fecha(v) {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Devuelve una fecha y hora en ISO, o null si no es válida.
export function fechaHora(v) {
  const s = txt(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const normNodo = (n) => (n === undefined || n === null ? '' : String(n).trim().toUpperCase());

export const esGestor = (u) => u?.rol === ROLES.GESTOR;
export const esCoordinacion = (u) => !!u && u.rol !== ROLES.GESTOR;

// Escapa los comodines de LIKE.
export const escaparLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
