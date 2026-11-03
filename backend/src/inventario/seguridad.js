// Control de acceso al módulo de inventario. La sesión, el CSRF y los límites son los de toda la aplicación;
// aquí solo se decide quién entra y con qué alcance: acceso completo, o solo recepción y armado de kits.
import { error } from './util.js';
import { registrarEvento } from '../acceso/sesiones.js';

export { registrarEvento };
export { limitador } from '../acceso/limites.js';

const ROLES_INVENTARIO = new Set(['admin', 'bodeguero', 'superadmin', 'coordinador_datos', 'coordinador_compras']);

// Calcula el tipo de acceso efectivo dentro del inventario para la cuenta de la sesión.
function rolInventario(cuenta) {
  if (!cuenta) return null;
  if (['superadmin', 'coordinador_datos', 'coordinador_compras'].includes(cuenta.rol)) return 'admin';
  return cuenta.rol;
}

// Devuelve el usuario actual visto desde el inventario, o null.
export function usuarioActual(req) {
  const c = req.sesion?.cuenta;
  if (!c || !ROLES_INVENTARIO.has(c.rol)) return null;
  return { id: c.id, usuario: c.usuario, nombre: c.perfil?.nombre || c.usuario, rol: rolInventario(c) };
}

// Identifica quién hace un cambio para el registro de actividad, con el mismo origen:id que usa la Bitácora.
export function actorActividad(req) {
  const c = req.sesion?.cuenta;
  return { sub: c ? `${c.origen}:${c.id}` : null, nombre: c?.perfil?.nombre || c?.usuario || null, rol: c?.rol || null };
}

// Middleware que exige una sesión con acceso al inventario.
export function loginRequerido(req, res, next) {
  const c = req.sesion?.cuenta;
  if (!c) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });
  if (!ROLES_INVENTARIO.has(c.rol)) {
    registrarEvento(req, 'acceso_denegado', { exito: false, detalle: `inventario ${req.method} ${req.originalUrl}`.slice(0, 120) });
    return error(res, 'Tu usuario no tiene acceso al inventario.', 403, { rol: true });
  }
  if (c.cambiarClave) {
    return error(res, 'Debes cambiar tu clave antes de continuar.', 403, { cambiar_clave: true });
  }
  return next();
}

// Middleware reservado al acceso completo del inventario.
export const soloAdmin = [
  loginRequerido,
  (req, res, next) => {
    if (usuarioActual(req).rol !== 'admin') {
      registrarEvento(req, 'acceso_denegado', { exito: false, detalle: `${req.method} ${req.originalUrl}`.slice(0, 120) });
      return error(res, 'No tienes permiso para acceder a esa sección.', 403, { rol: true });
    }
    return next();
  },
];
