// Sesiones, protección CSRF y registro de eventos de seguridad. La cookie lleva un identificador aleatorio y en
// la base solo se guarda su huella SHA-256, de modo que cerrar sesión la invalida al instante.
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { config, modulosDeRol } from '../config.js';
import { error } from '../inventario/util.js';

const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Nombre de la cookie con prefijo __Host-, que el navegador solo acepta por HTTPS y sin dominio.
export const NOMBRE_COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
const OPCIONES_COOKIE = {
  httpOnly: true,
  sameSite: 'strict',
  secure: config.cookieSecure,
  path: '/',
};

const ANONIMA_MIN = 30;

// Calcula la huella SHA-256 del identificador; en la base nunca se guarda el identificador.
const huella = (token) => crypto.createHash('sha256').update(token).digest('hex');
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;

// Lee una cookie a mano para no depender de otro paquete.
function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;
  for (const par of cabecera.split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === nombre) {
      try {
        return decodeURIComponent(par.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Quita saltos de línea y caracteres de control de un texto antes de registrarlo.
const limpiarTexto = (s, max) =>
  (s === null || s === undefined ? null : String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max));

// Guarda un evento de seguridad en la base y lo imprime como línea JSON para un recolector externo.
export function registrarEvento(req, tipo, { exito = true, origen, cuentaId, usuarioTexto, rol, detalle } = {}) {
  const c = req.sesion?.cuenta;
  const e = {
    tipo,
    exito,
    origen: origen ?? c?.origen ?? null,
    cuenta_id: cuentaId ?? c?.id ?? null,
    usuario_texto: limpiarTexto(usuarioTexto ?? c?.usuario, 100),
    rol: rol ?? c?.rol ?? null,
    ip: limpiarTexto(req.ip, 60),
    agente: limpiarTexto(req.get?.('user-agent'), 200),
    detalle: limpiarTexto(detalle, 300),
  };
  console.log(JSON.stringify({ evento: 'seguridad', fecha: new Date().toISOString(), ...e }));
  pool
    .query(
      `INSERT INTO eventos_seguridad (tipo, exito, origen, cuenta_id, usuario_texto, rol, ip, agente, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.tipo, e.exito, e.origen, e.cuenta_id, e.usuario_texto, e.rol, e.ip, e.agente, e.detalle],
    )
    .catch((err) => console.error('[seguridad] No se pudo guardar el evento:', err.message));
}

// Extrae de la sesión los datos del modo de vista de otro perfil.
export function simulacionDe(cuenta) {
  return cuenta?.rol === 'superadmin' && cuenta.perfil?.sim?.rol ? cuenta.perfil.sim : null;
}

// Datos de la sesión que viajan al navegador, sin información sensible.
export function perfilPublico(cuenta) {
  if (!cuenta) return null;
  const sim = simulacionDe(cuenta);
  return {
    ...cuenta.perfil,
    ...(sim ? { nodo: sim.nodo || null, rol_real: cuenta.rol } : {}),
    origen: cuenta.origen,
    rol: sim ? sim.rol : cuenta.rol,
    usuario: cuenta.usuario,
    modulos: sim ? ['bitacora'] : modulosDeRol(cuenta.rol),
    cambiar_clave: Boolean(cuenta.cambiarClave),
  };
}

// Middleware que carga en req.sesion la sesión de la cookie, si es válida.
export async function cargarSesion(req, res, next) {
  try {
    req.sesion = null;
    const token = leerCookie(req, NOMBRE_COOKIE);
    if (!token) return next();
    if (!TOKEN_VALIDO.test(token)) {
      res.clearCookie(NOMBRE_COOKIE, OPCIONES_COOKIE);
      return next();
    }

    const { rows: [fila] } = await pool.query(
      `SELECT s.id_hash, s.csrf, s.origen, s.cuenta_id, s.usuario_texto, s.rol, s.perfil,
              EXTRACT(EPOCH FROM (now() - s.ultimo_uso)) AS inactiva_seg,
              EXTRACT(EPOCH FROM (now() - s.creado))     AS edad_seg,
              CASE s.origen
                WHEN 'superadmin' THEN (SELECT activo FROM public.superadmins WHERE id = s.cuenta_id)
                WHEN 'coordinador' THEN (SELECT activo FROM public.coordinadores WHERE id_coordinador = s.cuenta_id)
                WHEN 'gestor' THEN (SELECT activo FROM public.gestores WHERE id_gestor = s.cuenta_id)
                WHEN 'inventario' THEN (SELECT activo FROM inventario.usuarios WHERE id = s.cuenta_id)
              END AS activo,
              CASE WHEN s.origen = 'inventario'
                   THEN (SELECT cambiar_clave FROM inventario.usuarios WHERE id = s.cuenta_id)
                   ELSE FALSE END AS cambiar_clave
         FROM sesiones_app s WHERE s.id_hash = $1`,
      [huella(token)],
    );

    const logueada = Boolean(fila?.origen);
    const limiteInactividad = (logueada ? config.sesionInactividadMin : ANONIMA_MIN) * 60;
    const vigente = fila
      && fila.inactiva_seg <= limiteInactividad
      && fila.edad_seg <= config.sesionMaxHoras * 3600
      && (!logueada || fila.activo === true);

    if (!vigente) {
      if (fila) await pool.query('DELETE FROM sesiones_app WHERE id_hash = $1', [fila.id_hash]);
      res.clearCookie(NOMBRE_COOKIE, OPCIONES_COOKIE);
      return next();
    }

    if (fila.inactiva_seg > 60) {
      await pool.query('UPDATE sesiones_app SET ultimo_uso = now() WHERE id_hash = $1', [fila.id_hash]);
    }
    req.sesion = {
      hash: fila.id_hash,
      csrf: fila.csrf,
      cuenta: logueada
        ? {
            origen: fila.origen,
            id: fila.cuenta_id,
            usuario: fila.usuario_texto,
            rol: fila.rol,
            perfil: fila.perfil || {},
            cambiarClave: fila.cambiar_clave === true,
          }
        : null,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

// Crea la sesión (también la anónima, que solo guarda el token CSRF) y envía la cookie.
async function crearSesion(req, res, cuenta) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sesiones_app (id_hash, csrf, origen, cuenta_id, usuario_texto, rol, perfil, ip, agente)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      huella(token), csrf, cuenta?.origen ?? null, cuenta?.id ?? null, cuenta?.usuario ?? null,
      cuenta?.rol ?? null, cuenta ? JSON.stringify(cuenta.perfil || {}) : null,
      limpiarTexto(req.ip, 60), limpiarTexto(req.get('user-agent'), 200),
    ],
  );
  res.cookie(NOMBRE_COOKIE, token, OPCIONES_COOKIE);
  req.sesion = { hash: huella(token), csrf, cuenta: cuenta ? { ...cuenta, cambiarClave: Boolean(cuenta.cambiarClave) } : null };
}

// Devuelve el token CSRF de la sesión, creando una anónima si hace falta.
export async function csrfToken(req, res) {
  if (!req.sesion) await crearSesion(req, res, null);
  return req.sesion.csrf;
}

// Descarta la sesión anterior y emite una nueva para evitar fijación de sesión.
export async function iniciarSesion(req, res, cuenta) {
  if (req.sesion) await pool.query('DELETE FROM sesiones_app WHERE id_hash = $1', [req.sesion.hash]);
  await crearSesion(req, res, cuenta);
}

// Borra la fila de la sesión actual y su cookie.
export async function cerrarSesion(req, res) {
  if (req.sesion) await pool.query('DELETE FROM sesiones_app WHERE id_hash = $1', [req.sesion.hash]);
  res.clearCookie(NOMBRE_COOKIE, OPCIONES_COOKIE);
  req.sesion = null;
}

// Cierra todas las sesiones de una cuenta, por ejemplo al cambiar la clave.
export async function cerrarSesionesDe(origen, cuentaId, exceptoHash = null) {
  const r = await pool.query(
    'DELETE FROM sesiones_app WHERE origen = $1 AND cuenta_id = $2 AND id_hash IS DISTINCT FROM $3',
    [origen, cuentaId, exceptoHash],
  );
  return r.rowCount;
}

// Borra sesiones vencidas y eventos de más de 180 días; se ejecuta cada 15 minutos.
export async function limpiarCaducados() {
  await pool.query(
    `DELETE FROM sesiones_app
      WHERE creado < now() - make_interval(hours => $1)
         OR (origen IS NOT NULL AND ultimo_uso < now() - make_interval(mins => $2))
         OR (origen IS NULL AND ultimo_uso < now() - make_interval(mins => $3))`,
    [config.sesionMaxHoras, config.sesionInactividadMin, ANONIMA_MIN],
  );
  await pool.query("DELETE FROM eventos_seguridad WHERE fecha < now() - interval '180 days'");
  await pool.query("DELETE FROM intentos_login WHERE ultimo < now() - interval '1 day'");
}

// Middleware que exige el token CSRF en las peticiones que modifican datos.
export function protegerCsrf(req, res, next) {
  if (!METODOS_ESCRITURA.has(req.method)) return next();

  const origen = req.get('Origin');
  if (origen && origen !== `${req.protocol}://${req.get('host')}`
      && !config.origenesPermitidos.includes(origen)) {
    registrarEvento(req, 'origen_invalido', { exito: false, detalle: `Origin: ${origen}` });
    return error(res, 'Origen de la petición no permitido.', 403);
  }

  const enviado = Buffer.from(String(req.get('X-CSRF-Token') || ''));
  const real = Buffer.from(String(req.sesion?.csrf || ''));
  if (real.length === 0 || enviado.length !== real.length || !crypto.timingSafeEqual(enviado, real)) {
    registrarEvento(req, 'csrf_invalido', { exito: false, detalle: `${req.method} ${req.path}` });
    return error(res, 'Tu sesión expiró o el formulario caducó. Vuelve a intentarlo.', 400, { csrf: true });
  }
  return next();
}

// Middleware que exige una sesión iniciada.
export function sesionRequerida(req, res, next) {
  if (!req.sesion?.cuenta) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });
  return next();
}

// Middleware que deja pasar solo a quienes pueden usar la consola de administración.
export function soloAdministracion(req, res, next) {
  const c = req.sesion?.cuenta;
  if (!c) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });
  const entra = c.rol === 'superadmin' || (c.origen === 'coordinador' && ['coordinador', 'coordinador_compras'].includes(c.rol));
  if (!entra) {
    registrarEvento(req, 'acceso_denegado', { exito: false, detalle: `${req.method} ${req.originalUrl}`.slice(0, 120) });
    return error(res, 'No tienes permiso para esta sección.', 403, { rol: true });
  }
  return next();
}

// Middleware que deja pasar solo al usuario con acceso total.
export function soloSuperadmin(req, res, next) {
  const c = req.sesion?.cuenta;
  if (!c) return error(res, 'Debes iniciar sesión.', 401, { sesion: false });
  if (c.rol !== 'superadmin') {
    registrarEvento(req, 'acceso_denegado', { exito: false, detalle: `${req.method} ${req.originalUrl}`.slice(0, 120) });
    return error(res, 'No tienes permiso para esta sección.', 403, { rol: true });
  }
  return next();
}
