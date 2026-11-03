// Textos legibles para lo que devuelve la consola de administración. Los identificadores son los de la base y
// no cambian; aquí está el nombre con el que se ve cada uno.
// Nombre legible de cada tipo de cuenta, del que depende lo que ve al entrar.
export const ROLES = {
  superadmin: 'Coordinador general',
  coordinador: 'Coordinador local regional',
  tecnico_administrativo: 'Técnico administrativo regional de apoyo',
  tallerista: 'Tallerista',
  coordinador_compras: 'Profesional alianzas y conexión de mercados',
  coordinador_datos: 'Profesional de seguimiento e información',
  bodeguero: 'Profesional de logística y compra',
  gestor: 'Gestor',
};

// Nombres de la actividad, que además incluye sistema, el de los trabajos programados.
export const ROLES_ACTIVIDAD = { ...ROLES, sistema: 'Proceso automático' };
// Devuelve el nombre legible de un tipo de cuenta.
export const nombreRol = (rol) => ROLES_ACTIVIDAD[rol] || rol;

// Qué abre cada tipo de cuenta, para avisar antes de cambiarlo.
export const ACCESO_DE_ROL = {
  superadmin: 'Bitácora, inventario y administración, sin límite de territorio',
  coordinador: 'Bitácora (sin inventario), solo lo de su región, departamento, modalidad y nodo',
  tecnico_administrativo: 'Bitácora en modo consulta (no modifica nada), solo lo de su región, departamento, modalidad y nodo',
  coordinador_compras: 'Bitácora: Entregas y compras; inventario completo; administra a los profesionales de logística y compra',
  coordinador_datos: 'Bitácora: seguimiento y cargue de datos',
  bodeguero: 'Inventario: operación de bodega',
  tallerista: 'Talleres de fortalecimiento, contenidos, Eventos y Novedades de su región',
  gestor: 'Bitácora: sus unidades productivas',
};

// Nombre legible de cada tipo de evento del registro de accesos.
const EVENTOS = {
  login_ok: 'Ingreso correcto',
  login_fallo: 'Ingreso fallido',
  logout: 'Cierre de sesión',
  usuario_bloqueado: 'Usuario bloqueado',
  login_usuario_bloqueado: 'Intento con usuario bloqueado',
  login_bloqueado_ip: 'IP bloqueada por intentos',
  cambio_clave: 'Clave cambiada por el usuario',
  cambio_clave_fallo: 'Cambio de clave fallido',
  acceso_denegado: 'Acceso denegado',
  csrf_invalido: 'Petición rechazada (token)',
  origen_invalido: 'Petición rechazada (origen)',
  limite_general: 'Límite de peticiones',
  limite_login: 'Límite de ingresos',
  limite_cambio_clave: 'Límite de cambios de clave',
  admin_usuario_creado: 'Usuario creado',
  admin_usuario_editado: 'Usuario editado',
  admin_rol_cambiado: 'Rol cambiado',
  admin_usuario_estado: 'Usuario activado o desactivado',
  admin_clave_asignada: 'Clave asignada por el administrador',
  admin_clave_restablecida: 'Clave restablecida a la cédula',
  admin_sesiones_cerradas: 'Sesiones cerradas por el administrador',
  admin_sesion_cerrada: 'Sesión cerrada por el administrador',
  admin_desbloqueo: 'Usuario desbloqueado',
  kit_armado: 'Kit armado',
  kit_entregado: 'Entrega de kit registrada',
  kit_novedad: 'Novedad de kit registrada',
  responsable_entrega_creado: 'Responsable de entrega creado',
  responsable_busqueda_bloqueada: 'Búsqueda de responsables bloqueada (demasiados intentos)',
  admin_bodega_asignada: 'Bodega municipal asignada',
  taller_programado: 'Taller de fortalecimiento programado',
  taller_grupo_guardado: 'Grupo de UP para talleres guardado',
  taller_actualizado: 'Programación de taller actualizada',
  taller_realizado: 'Asistencia y soportes del taller registrados',
  taller_contenido_publicado: 'Contenido de fortalecimiento publicado',
  orden_generada: 'Orden de entrega generada',
  orden_eliminada: 'Orden eliminada',
  lote_cargado: 'Lote de pedido cargado',
  lote_eliminado: 'Lote eliminado',
};

// Devuelve el nombre legible de un tipo de evento.
export const nombreEvento = (tipo) => EVENTOS[tipo] || tipo;

// Qué significa cada anotación del historial de cambios de clave.
const ACCIONES_CLAVE = {
  creacion: 'Cuenta creada con clave',
  creacion_cedula: 'Cuenta creada (su clave es la cédula)',
  creacion_script: 'Cuenta creada desde la consola del servidor',
  cambio_propio: 'La cambió el propio usuario',
  cambio_admin: 'La asignó un administrador',
  restablecer_cedula: 'Volvió a ser la cédula',
};

// Devuelve el texto de una acción del historial de claves.
export const nombreAccionClave = (a) => ACCIONES_CLAVE[a] || a;

// Resume el user-agent en un texto como Chrome en Windows o Safari en iPhone.
export function resumirAgente(ua) {
  if (!ua) return '—';
  const navegador = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl/i.test(ua) ? 'curl' : 'Otro';
  const sistema = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iPhone/iPad'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return sistema ? `${navegador} en ${sistema}` : navegador;
}

// Da formato legible a una fecha y hora local, por ejemplo 07/10/2026 21:05.
export function fechaHora(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

// Genera una clave al azar de 16 caracteres sin símbolos que se confundan al leerlos.
export function generarClave(largo = 16) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(largo);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => letras[b % letras.length]).join('');
}
