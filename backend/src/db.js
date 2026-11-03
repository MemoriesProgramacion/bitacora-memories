// Conexión a PostgreSQL mediante un pool y utilidades para consultar y ejecutar transacciones.
import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// Pool de conexiones compartido por toda la aplicación.
export const pool = new pg.Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {}),
  ...(config.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en una conexión inactiva:', err.message);
});

// Ejecuta una consulta simple y devuelve el resultado completo de pg.
export function query(texto, params) {
  return pool.query(texto, params);
}

// Ejecuta una función dentro de una transacción y hace ROLLBACK si lanza un error.
export async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (err) {
    try { await cliente.query('ROLLBACK'); } catch { }
    throw err;
  } finally {
    cliente.release();
  }
}
