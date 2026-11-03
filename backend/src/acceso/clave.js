// Manejo de claves: cifrado con scrypt, verificación y política de claves nuevas. También reconoce los formatos
// de hash anteriores para que nadie tenga que restablecer su clave.
import crypto from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Envuelve scrypt de Node en una promesa para usarlo con await.
function scrypt(clave, sal, n, r, p, largo = 64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      Buffer.from(clave, 'utf8'), sal, largo,
      { N: n, r, p, maxmem: 256 * n * r * p },
      (err, llave) => (err ? reject(err) : resolve(llave)),
    );
  });
}

// Versión con promesa de pbkdf2, que solo se usa para leer hashes antiguos.
function pbkdf2(clave, sal, vueltas, digest) {
  return new Promise((resolve, reject) => {
    const largo = crypto.createHash(digest).digest().length;
    crypto.pbkdf2(Buffer.from(clave, 'utf8'), sal, vueltas, largo, digest,
      (err, llave) => (err ? reject(err) : resolve(llave)));
  });
}

// Genera una sal al azar; cada clave guardada lleva la suya.
function salAleatoria(largo = 16) {
  const bytes = crypto.randomBytes(largo);
  let s = '';
  for (let i = 0; i < largo; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return s;
}

// Cifra una clave guardando en el hash los parámetros usados, para poder endurecerlos más adelante.
export async function hashClave(clave) {
  const sal = salAleatoria();
  const llave = await scrypt(String(clave), Buffer.from(sal, 'utf8'), N, R, P);
  return `scrypt:${N}:${R}:${P}$${sal}$${llave.toString('hex')}`;
}

// Comprueba una clave contra un hash guardado en cualquiera de los formatos soportados.
export async function verificarClave(hash, clave) {
  try {
    const texto = String(hash || '');
    const partes = texto.split('$');
    let calculado;
    let esperado;

    if (partes.length === 6 && partes[0] === 'scrypt') {
      const [, n, r, p, sal, h] = partes;
      esperado = Buffer.from(h, 'base64');
      calculado = await scrypt(String(clave), Buffer.from(sal, 'base64'),
        Number(n), Number(r), Number(p), esperado.length);
    } else if (partes.length === 3) {
      const [metodo, sal, h] = partes;
      const m = metodo.split(':');
      esperado = Buffer.from(h, 'hex');
      if (m[0] === 'scrypt') {
        calculado = await scrypt(String(clave), Buffer.from(sal, 'utf8'),
          Number(m[1]), Number(m[2]), Number(m[3]), esperado.length);
      } else if (m[0] === 'pbkdf2') {
        calculado = await pbkdf2(String(clave), Buffer.from(sal, 'utf8'), Number(m[2]), m[1]);
      } else {
        return false;
      }
    } else {
      return false;
    }
    return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

// Compara dos textos en tiempo constante para no revelar información por el tiempo de respuesta.
export function igualesSeguro(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Hash de relleno para verificar contra algo cuando el usuario no existe.
let hashFalso = null;
// Consume el mismo tiempo que una verificación real para no delatar qué usuarios existen.
export async function gastarTiempoDeVerificacion(clave) {
  hashFalso ??= await hashClave(crypto.randomBytes(24).toString('hex'));
  await verificarClave(hashFalso, String(clave));
}

// Genera una clave al azar sin caracteres que se confundan al leerlos.
export function claveAleatoria(largo = 16) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(largo);
  let s = '';
  for (let i = 0; i < largo; i++) s += letras[bytes[i] % letras.length];
  return s;
}

export const CLAVE_MIN = 12;
export const CLAVE_MAX = 128;

// Palabras habituales que no se aceptan como base de una clave.
const RAICES_COMUNES = new Set([
  'password', 'passw0rd', 'contrasena', 'clave', 'claveclave', 'admin', 'administrador',
  'administrator', 'root', 'qwerty', 'qwertyuiop', 'qwertyuiopasdfghjkl', 'asdfghjkl',
  'zxcvbnm', 'abcdefgh', 'abcdefghijkl', 'iloveyou', 'letmein', 'welcome', 'bienvenido',
  'monkey', 'dragon', 'master', 'login', 'princess', 'football', 'futbol', 'colombia',
  'inventario', 'bodega', 'dps', 'dpsinventario', 'dpsbodega', 'smartinventory',
  'bitacora', 'economiapopular', 'superadmin', 'usuario', 'bodeguero', 'cambiame',
  'cambiar', 'secreto', 'secret', 'cambiaesta', 'demo',
]);

// Deja solo letras y números en minúscula y sin tildes para comparar claves.
const normalizar = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

// Devuelve el motivo por el que una clave nueva no sirve, o null si es válida.
export function validarClaveNueva(clave, { usuario = '' } = {}) {
  if (typeof clave !== 'string') return 'La clave no es válida.';
  if (clave.length < CLAVE_MIN) return `La clave debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > CLAVE_MAX) return `La clave no puede pasar de ${CLAVE_MAX} caracteres.`;
  const n = normalizar(clave);
  const raiz = n.replace(/\d+$/, '');
  if (RAICES_COMUNES.has(n) || RAICES_COMUNES.has(raiz)) {
    return 'Esa clave es muy común. Elige una frase o combinación menos evidente.';
  }
  if (/^(.)\1+$/.test(n) || /^\d+$/.test(n)) {
    return 'La clave es demasiado simple (repite un carácter o son solo números).';
  }
  if ('abcdefghijklmnopqrstuvwxyz0123456789'.includes(n)
    || 'zyxwvutsrqponmlkjihgfedcba9876543210'.includes(n)) {
    return 'La clave no puede ser una secuencia (abcdef..., 123456...).';
  }
  const u = normalizar(String(usuario));
  if (u.length >= 3 && n.includes(u)) return 'La clave no puede contener el nombre de usuario.';
  return null;
}
