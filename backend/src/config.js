// Configuración del backend. Todos los valores salen de variables de entorno (archivo .env en desarrollo); la
// lista completa está en .env.example.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile?.(path.join(raiz, '.env'));
} catch { }

// Lee un número del entorno y usa el valor por defecto si falta o no es válido.
function numero(nombre, defecto) {
  const v = Number(process.env[nombre]);
  return Number.isFinite(v) && v > 0 ? v : defecto;
}

const produccion = process.env.NODE_ENV === 'production';

// Objeto con la configuración leída del entorno: puerto, conexión a la base de datos y demás parámetros del
// servidor.
export const config = {
  produccion,
  puerto: numero('PORT', 4000),

  databaseUrl: process.env.DATABASE_URL || null,
  dbSsl: process.env.DB_SSL === 'true',

  empresa: process.env.EMPRESA || 'Fundación Memories',

  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  turnstileVerifyUrl: process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify',

  cookieSecure: ['1', 'true', 'si'].includes(String(process.env.COOKIE_SECURE || '').toLowerCase()),
  confiarProxy: ['1', 'true', 'si'].includes(String(process.env.CONFIAR_PROXY || '').toLowerCase()),
  sesionInactividadMin: numero('SESION_INACTIVIDAD_MIN', 60),
  sesionMaxHoras: numero('SESION_MAX_HORAS', 12),

  origenesPermitidos: [
    ...(produccion ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
    ...String(process.env.CORS_ORIGIN || process.env.ORIGENES_PERMITIDOS || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  ],

  storageDir: path.resolve(raiz, process.env.STORAGE_DIR || 'storage'),

  maxMbVideo: numero('MAX_MB_VIDEO', 80),
  maxMbPdf: numero('MAX_MB_PDF', 15),
  maxMbArchivo: numero('MAX_MB_ARCHIVO', 100),
};

// Texto de relleno que traían los datos de origen para celdas vacías; se guarda como NULL.
export const SIN_DATOS = 'Sin datos asignados';

// Identificadores de los tipos de cuenta de la Bitácora tal como se guardan en la base.
export const ROLES = {
  COORDINADOR: 'coordinador',
  COMPRAS: 'coordinador_compras',
  DATOS: 'coordinador_datos',
  TECNICO: 'tecnico_administrativo',
  TALLERISTA: 'tallerista',
  GESTOR: 'gestor',
};

// Tipos de cuenta que tienen territorio asignado (región, departamento, modalidad o nodo).
export const ROLES_CON_TERRITORIO = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.TALLERISTA];

// Tipos de cuenta del módulo de inventario.
export const ROLES_INV = { ADMIN: 'admin', BODEGUERO: 'bodeguero' };
export const ROL_SUPERADMIN = 'superadmin';

// Devuelve qué módulos abre cada tipo de cuenta; el servidor lo vuelve a validar en cada petición.
export function modulosDeRol(rol) {
  if (rol === ROL_SUPERADMIN) return ['bitacora', 'inventario', 'admin'];
  if (rol === ROLES.DATOS) return ['bitacora', 'inventario'];
  if (rol === ROLES.COMPRAS) return ['bitacora', 'inventario', 'admin'];
  if (rol === ROLES.COORDINADOR) return ['bitacora', 'admin'];
  if (rol === ROLES_INV.ADMIN || rol === ROLES_INV.BODEGUERO) return ['inventario'];
  return ['bitacora'];
}
