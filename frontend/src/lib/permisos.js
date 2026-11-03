// Permisos por tipo de cuenta en el frontend. Define qué secciones de la Bitácora abre cada tipo de cuenta, qué
// apartados de entregas ve y quién puede ver el informe, el detalle, los asociados, el diagnóstico, los
// soportes, el tablero y el historial. El servidor vuelve a exigir cada permiso.
export const ROL_ADMIN = 'superadmin';

// Indica si la cuenta tiene acceso total.
export function esAdmin(session) {
  return session?.role === ROL_ADMIN;
}

// Indica si la cuenta ve y hace en la Bitácora y el inventario lo mismo que quien tiene acceso total, salvo la
// consola de administración.
export const esGeneral = (session) => esAdmin(session) || session?.role === 'coordinador_datos';

// Indica si la cuenta puede editar los datos de una unidad productiva: ficha, representante y expediente.
export const puedeEditarUP = (session) => esGeneral(session);

export const SECCIONES_GESTOR = ['bitacora', 'agenda', 'capitalizacion', 'visitas', 'eventos', 'novedades', 'entregas', 'seguimiento'];

export const SECCIONES_TECNICO = ['bitacora', 'agenda', 'eventos', 'novedades', 'capitalizacion', 'entregas', 'saldos', 'seguimiento'];
export const SECCIONES_TALLERISTA = ['talleres', 'novedades'];

export const SECCIONES_COORDINADOR_COMPRAS = ['entregas', 'capitalizacion', 'carguecompras', 'kardex', 'saldos', 'seguimiento'];

// Secciones exclusivas que solo ven los tipos de cuenta listados, ni siquiera el acceso territorial.
export const SECCIONES_EXCLUSIVAS = {
  carguedatos: ['coordinador_datos'],
  revisionentregas: [],
  carguecompras: ['coordinador_compras'],
  datoscargados: ['coordinador_datos'],
  kardex: ['coordinador', 'coordinador_compras'],
  saldos: ['coordinador', 'tecnico_administrativo', 'coordinador_compras'],
  proveedores: ['coordinador'],
  mibodega: ['coordinador'],
  talleres: ['coordinador', 'tallerista'],
};

// Indica si la cuenta puede ver una sección.
export function puedeVer(seccion, session) {
  if (!session) return false;
  if (seccion === 'kardex' && session.role === 'coordinador_datos') return false;
  if (seccion === 'alistamiento') return session.role === 'coordinador_datos';
  if (esGeneral(session)) return true;
  const exclusiva = SECCIONES_EXCLUSIVAS[seccion];
  if (exclusiva && !exclusiva.includes(session.role)) return false;
  if (session.role === 'gestor') return SECCIONES_GESTOR.includes(seccion);
  if (session.role === 'coordinador_compras') return SECCIONES_COORDINADOR_COMPRAS.includes(seccion);
  if (session.role === 'tecnico_administrativo') return SECCIONES_TECNICO.includes(seccion);
  if (session.role === 'tallerista') return SECCIONES_TALLERISTA.includes(seccion);
  if (session.role === 'coordinador') return true;
  return false;
}

// Devuelve qué datos compartidos se piden al servidor al abrir la Bitácora, solo los de las secciones que la
// cuenta tiene, porque el servidor rechaza los demás.
export function cargasDeSesion(session) {
  return {
    rutaBitacora: puedeVer('bitacora', session),
    eventos: puedeVer('eventos', session) || puedeVer('talleres', session),
    avisos: puedeVer('novedades', session),
  };
}

// Apartados que ve cada tipo de cuenta dentro de la sección de entregas.
export const VISTAS_POR_ROL = {
  coordinador_compras: ['reagenda', 'compras', 'crono', 'logistica', 'defectuosos'],
  gestor:              ['prevision'],
  coordinador:         ['reagenda', 'compras', 'crono', 'prevision', 'logistica', 'defectuosos'],
  tecnico_administrativo: ['crono', 'defectuosos'],
};

export function vistasEntregas(session) {
  if (!session) return [];
  return VISTAS_POR_ROL[session.role] || VISTAS_POR_ROL.coordinador;
}

export const ROLES_INFORME = ['coordinador', ROL_ADMIN, 'coordinador_datos'];
export const puedeVerInforme = (session) => !!session && ROLES_INFORME.includes(session.role);

export const ROLES_DETALLE = [...ROLES_INFORME, 'gestor'];
export const puedeVerDetalle = (session) => !!session && ROLES_DETALLE.includes(session.role);

// Tipos de cuenta que ven los asociados de la unidad; qué puede escribir cada uno lo dice el servidor.
export const ROLES_ASOCIADOS = [ROL_ADMIN, 'coordinador', 'coordinador_datos', 'gestor', 'tecnico_administrativo'];
export const puedeVerAsociados = (session) => !!session && ROLES_ASOCIADOS.includes(session.role);
// Indica si la cuenta ve el diagnóstico de la unidad y la lista de comprobación de coherencia, para los mismos
// tipos de cuenta.
export const puedeVerDiagnostico = puedeVerAsociados;
// Indica si la cuenta ve el expediente documental de la unidad y su informe, para los mismos tipos de cuenta.
export const puedeVerSoportesUP = puedeVerAsociados;
// Tipos de cuenta que ven el tablero de indicadores de la ruta.
export const ROLES_TABLERO_EVALUACION = [ROL_ADMIN, 'coordinador', 'coordinador_datos', 'tecnico_administrativo'];
export const puedeVerTableroEvaluacion = (session) => !!session && ROLES_TABLERO_EVALUACION.includes(session.role);

export const ROLES_HISTORIAL_UP = [ROL_ADMIN, 'coordinador', 'coordinador_datos', 'gestor'];
export const puedeVerHistorialUP = (session) => !!session && ROLES_HISTORIAL_UP.includes(session.role);

// Devuelve la primera sección que abre cada tipo de cuenta al iniciar sesión, y a la que vuelve si intenta
// entrar a una que no tiene habilitada.
export function seccionInicial(session) {
  if (session?.role === 'tallerista') return 'talleres';
  if (session?.role === 'coordinador_compras') return SECCIONES_COORDINADOR_COMPRAS[0];
  if (session?.role === 'gestor') return SECCIONES_GESTOR[0];
  return 'bitacora';
}
