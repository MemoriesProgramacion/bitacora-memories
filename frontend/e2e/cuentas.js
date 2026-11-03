// Las cuentas que crea backend/scripts/preparar-e2e.js (una por rol) y lo que cada una debe ver.
export const CLAVE = process.env.E2E_CLAVE || 'E2e-Clave-Segura-2026';

export const CUENTAS = {
  general: { usuario: 'e2e.jefe', clave: CLAVE, rol: 'Coordinador general', modulos: ['Bitácora', 'Inventario', 'Administración'] },
  clr: { usuario: 'e2e.clr', clave: CLAVE, rol: 'Coordinador local regional', modulos: ['Bitácora', 'Administración'] },
  gestor: { usuario: 'atlan1', clave: '1001001001', rol: 'Gestor', modulos: ['Bitácora'] },
  tecnico: { usuario: 'e2e.tecnico', clave: CLAVE, rol: 'Técnico administrativo regional de apoyo', modulos: ['Bitácora'] },
  compras: { usuario: 'e2e.compras', clave: CLAVE, rol: 'Profesional alianzas y conexión de mercados', modulos: ['Bitácora', 'Inventario', 'Administración'] },
  datos: { usuario: 'e2e.datos', clave: CLAVE, rol: 'Profesional de seguimiento e información', modulos: ['Bitácora', 'Inventario'] },
  tallerista: { usuario: 'e2e.tallerista', clave: CLAVE, rol: 'Tallerista', modulos: ['Bitácora'] },
};

// Secciones de la Bitácora que cada rol debe tener (y una que no) — las mismas de frontend/src/lib/permisos.js.
export const SECCIONES = {
  general: { ve: ['Bitácora', 'Seguimiento', 'Cargue de datos', 'Proveedores'], noVe: [] },
  clr: { ve: ['Bitácora', 'Visitas', 'Novedades', 'Seguimiento', 'Mi bodega'], noVe: ['Cargue de datos', 'Cargue de compras'] },
  gestor: { ve: ['Bitácora', 'Agenda', 'Visitas', 'Capitalización', 'Novedades', 'Seguimiento'], noVe: ['Proveedores', 'Mi bodega', 'Cargue de datos'] },
  tecnico: { ve: ['Bitácora', 'Agenda', 'Novedades', 'Seguimiento'], noVe: ['Visitas', 'Proveedores'] },
  compras: { ve: ['Entregas', 'Capitalización', 'Cargue de compras', 'Seguimiento'], noVe: ['Bitácora', 'Visitas', 'Novedades'] },
  datos: { ve: ['Bitácora', 'Cargue de datos', 'Datos cargados', 'Alistamiento', 'Seguimiento'], noVe: ['Kardex'] },
  tallerista: { ve: ['Talleres de fortalecimiento', 'Novedades'], noVe: ['Bitácora', 'Seguimiento', 'Visitas'] },
};
