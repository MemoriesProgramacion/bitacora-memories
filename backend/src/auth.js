// Middlewares de autenticación y autorización de la Bitácora. Traduce la sesión a req.usuario, que es lo que
// leen los servicios, y decide quién puede entrar a cada ruta.
import { ROLES } from './config.js';
import { noAutorizado, prohibido } from './errores.js';
import { simulacionDe } from './acceso/sesiones.js';
import { ROLES_POR_ORIGEN } from './acceso/cuentas.js';

const ORIGENES_BITACORA = new Set(['coordinador', 'gestor', 'superadmin']);
const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

export const MENSAJE_SOLO_LECTURA = 'Tu rol es de solo consulta: no puede crear, modificar ni eliminar.';
// Indica si el usuario solo puede consultar y no modificar datos.
export const esSoloLectura = (usuario) => usuario?.rol === ROLES.TECNICO;

// Middleware que exige una sesión con acceso a la Bitácora, la traduce a req.usuario y rechaza con 403 a quien
// solo tiene inventario.
export function autenticar() {
  return (req, _res, next) => {
    const cuenta = req.sesion?.cuenta;
    if (!cuenta) return next(noAutorizado());
    if (!ORIGENES_BITACORA.has(cuenta.origen)) {
      return next(prohibido('Tu usuario no tiene acceso a la Bitácora.'));
    }
    if (!(ROLES_POR_ORIGEN[cuenta.origen] || []).includes(cuenta.rol)) {
      return next(prohibido('Tu usuario no tiene un rol vigente en la Bitácora.'));
    }
    const p = cuenta.perfil || {};
    const superadmin = cuenta.origen === 'superadmin';
    const esDatos = cuenta.rol === ROLES.DATOS;
    const general = superadmin || esDatos;
    const sim = simulacionDe(cuenta);
    if (sim) {
      const simGeneral = [ROLES.DATOS, ROLES.COORDINADOR].includes(sim.rol);
      req.usuario = {
        sub: `${cuenta.origen}:${cuenta.id}`, rol: sim.rol === ROLES.DATOS ? ROLES.COORDINADOR : sim.rol, nodo: sim.nodo || null,
        nombre: p.nombre || cuenta.usuario, cedula: '', superadmin: false, general: simGeneral, esDatos: sim.rol === ROLES.DATOS,
        alcance: simGeneral ? null : undefined, sim: true,
      };
      return next();
    }
    req.usuario = {
      sub: `${cuenta.origen}:${cuenta.id}`,
      rol: general ? ROLES.COORDINADOR : cuenta.rol,
      nodo: p.nodo || null,
      nombre: p.nombre || cuenta.usuario,
      cedula: p.cedula || '',
      alcance: general ? null : {
        region: p.region || null,
        departamento: p.departamento || null,
        modalidad: p.modalidad || null,
        nodo: p.nodo || null,
      },
      superadmin,
      general,
      esDatos,
    };
    if (cuenta.rol === ROLES.TALLERISTA) {
      const ruta = req.originalUrl.split('?')[0].replace(/^\/api/, '');
      const permitido = (LECTURA.has(req.method) && ['/eventos', '/avisos', '/tickets', '/tickets/adjunto', '/config'].includes(ruta))
        || (req.method === 'POST' && ['/tickets', '/tickets/gestion'].includes(ruta)) || /^\/(?:talleres|encuentros-tic)(?:\/|$)/.test(ruta);
      if (!permitido) return next(prohibido('El Tallerista solo tiene acceso a Talleres, Entregas de encuentros, Eventos y Novedades.'));
    }
    const creaNovedad = (['PUT', 'DELETE'].includes(req.method) && req.path === '/avisos') || (req.method === 'POST' && ['/tickets', '/tickets/gestion'].includes(req.path));
    const verificaSoporte = req.method === 'POST' && req.path === '/seguimiento/soportes/verificar';
    if (req.usuario.rol === ROLES.TECNICO && !LECTURA.has(req.method) && req.path !== '/validador' && !creaNovedad && !verificaSoporte) {
      return next(prohibido(MENSAJE_SOLO_LECTURA));
    }
    return next();
  };
}

// Middleware que deja pasar solo a los tipos de cuenta indicados; el acceso total siempre pasa.
export function exigirRol(...roles) {
  return (req, _res, next) => {
    if (!req.usuario) return next(prohibido());
    if (req.usuario.general || roles.includes(req.usuario.rol)) return next();
    return next(prohibido());
  };
}
