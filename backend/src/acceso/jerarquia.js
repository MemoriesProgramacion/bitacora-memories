// Reglas de quién puede administrar a quién. Quien tiene acceso total administra todas las cuentas; quien tiene
// acceso territorial solo las de su territorio y de niveles inferiores; el acceso de logística solo crea y
// desbloquea cuentas de bodega.
import { ROLES } from '../config.js';
import { enAlcance } from '../alcance.js';
import { ORIGENES, listarOrigen } from './cuentas.js';

export const ROLES_BAJO_REGIONAL = [
  ROLES.TECNICO, ROLES.TALLERISTA, ROLES.COMPRAS, ROLES.DATOS, 'bodeguero', ROLES.GESTOR,
];

// Arma quién actúa (tipo de cuenta, si tiene acceso total y su alcance) a partir de la cuenta de la sesión.
export function actorDe(cuenta) {
  const superadmin = cuenta?.rol === 'superadmin';
  const p = cuenta?.perfil || {};
  return {
    rol: superadmin ? ROLES.COORDINADOR : cuenta?.rol,
    superadmin,
    alcance: superadmin ? null : {
      region: p.region || null, departamento: p.departamento || null, modalidad: p.modalidad || null, nodo: p.nodo || null,
    },
  };
}

// Indica si quien actúa tiene acceso territorial.
export const esRegional = (u) => u?.rol === ROLES.COORDINADOR && !u.superadmin && !u.general;

// Indica si quien actúa tiene acceso de compras y logística.
export const esLogistica = (u) => u?.rol === ROLES.COMPRAS && !u.superadmin && !u.general;

// Indica si puede entrar a la consola de administración.
export const puedeAdministrar = (u) => Boolean(u?.superadmin) || esRegional(u) || esLogistica(u);

// Indica si puede crear o asignar un tipo de cuenta concreto.
export const puedeAsignarRol = (actor, rol) => actor.superadmin
  || (esRegional(actor) && ROLES_BAJO_REGIONAL.includes(rol))
  || (esLogistica(actor) && rol === 'bodeguero');

// Indica si puede ver y editar una cuenta, según su territorio y tipo.
export function puedeGestionar(actor, c) {
  if (actor.superadmin) return true;
  if (esLogistica(actor)) return c.rol === 'bodeguero';
  if (!esRegional(actor) || !ROLES_BAJO_REGIONAL.includes(c.rol)) return false;
  if ([ROLES.TECNICO, ROLES.TALLERISTA].includes(c.rol)) {
    return enAlcance(actor, { nodo: c.nodo, region: c.region, departamento: c.departamento, modalidad: c.modalidad });
  }
  if (c.rol === ROLES.GESTOR) {
    const { modalidad: _m, ...sinModalidad } = actor.alcance;
    return enAlcance({ ...actor, alcance: sinModalidad }, { nodo: c.nodo, region: c.region, departamento: c.departamento });
  }
  return true;
}

// Filtra las cuentas que quien actúa puede administrar.
export async function cuentasGestionables(actor, propia = null) {
  const todas = (await Promise.all(ORIGENES.map(listarOrigen))).flat();
  const lista = todas.filter((c) => puedeGestionar(actor, c));
  if (propia && esRegional(actor)) {
    const yo = todas.find((c) => c.origen === propia.origen && c.id === propia.id);
    if (yo) lista.push(yo);
  }
  return lista;
}

// Arma la clave origen:id con la que una cuenta aparece en eventos y sesiones.
export const claveDeCuenta = (c) => `${c.origen}:${c.id}`;
