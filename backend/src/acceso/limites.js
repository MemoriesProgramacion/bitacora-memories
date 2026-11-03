// Límites de peticiones y freno contra fuerza bruta. Los contadores se guardan en la base para sobrevivir a
// reinicios y compartirse entre instancias; si la base falla, el limitador deja pasar la petición y lo
// registra.
import { pool } from '../db.js';
import { registrarEvento } from './sesiones.js';
import { error } from '../inventario/util.js';

const LIMPIEZA_MS = 10 * 60_000;
setInterval(() => {
  pool.query("DELETE FROM limites_peticiones WHERE reinicia < now() - interval '1 hour'").catch(() => {});
  pool.query(`DELETE FROM fallos_login_ip WHERE fecha < now() - interval '1 hour'`).catch(() => {});
}, LIMPIEZA_MS).unref();

// Suma una petición a la ventana de una clave con un solo UPSERT para que dos instancias no se pisen.
async function contar(clave, ventanaMs) {
  const { rows } = await pool.query(
    `INSERT INTO limites_peticiones (clave, n, reinicia)
     VALUES ($1, 1, now() + $2 * interval '1 millisecond')
     ON CONFLICT (clave) DO UPDATE SET
       n        = CASE WHEN limites_peticiones.reinicia <= now() THEN 1 ELSE limites_peticiones.n + 1 END,
       avisado  = CASE WHEN limites_peticiones.reinicia <= now() THEN FALSE ELSE limites_peticiones.avisado END,
       reinicia = CASE WHEN limites_peticiones.reinicia <= now() THEN EXCLUDED.reinicia ELSE limites_peticiones.reinicia END
     RETURNING n, reinicia`,
    [clave, ventanaMs],
  );
  return rows[0];
}

// Crea un middleware de ventana fija que responde 429 al superar el máximo de peticiones.
export function limitador({ ventanaMs, max, mensaje, tipo = 'limite_peticiones', nombre = tipo, clave = (req) => req.ip }) {
  return async (req, res, next) => {
    const k = `${nombre}:${clave(req) ?? 'desconocida'}`;
    let c;
    try {
      c = await contar(k, ventanaMs);
    } catch (err) {
      console.error('[limites] No se pudo contar la petición:', err.message);
      return next();
    }
    if (c.n > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((new Date(c.reinicia).getTime() - Date.now()) / 1000))));
      const r = await pool.query(
        'UPDATE limites_peticiones SET avisado = TRUE WHERE clave = $1 AND NOT avisado', [k],
      ).catch(() => ({ rowCount: 0 }));
      if (r.rowCount) {
        registrarEvento(req, tipo, { exito: false, detalle: `${req.method} ${req.originalUrl}`.slice(0, 120) });
      }
      return error(res, mensaje || 'Demasiadas peticiones. Espera un momento e intenta de nuevo.', 429);
    }
    return next();
  };
}

const LOGIN_MAX_INTENTOS = 10;
const LOGIN_VENTANA_MS = 5 * 60 * 1000;

// Obtiene la IP de quien pide, o un nombre fijo si no se puede saber.
const ipDe = (req) => req.ip || 'desconocida';

// Indica si la IP acumuló demasiados fallos de ingreso en la ventana.
export async function ipBloqueada(req) {
  const { rows: [{ n }] } = await pool.query(
    `SELECT count(*)::int AS n FROM fallos_login_ip
      WHERE ip = $1 AND fecha > now() - $2 * interval '1 millisecond'`,
    [ipDe(req), LOGIN_VENTANA_MS],
  );
  return n >= LOGIN_MAX_INTENTOS;
}

// Anota un ingreso fallido de la IP.
export async function registrarFalloIp(req) {
  await pool.query('INSERT INTO fallos_login_ip (ip) VALUES ($1)', [ipDe(req)]);
}

// Borra los fallos de la IP tras un ingreso correcto.
export async function limpiarFallosIp(req) {
  await pool.query('DELETE FROM fallos_login_ip WHERE ip = $1', [ipDe(req)]);
}

// Vacía los contadores; solo se usa en pruebas.
export async function reiniciarLimites() {
  await pool.query('DELETE FROM limites_peticiones');
  await pool.query('DELETE FROM fallos_login_ip');
}
