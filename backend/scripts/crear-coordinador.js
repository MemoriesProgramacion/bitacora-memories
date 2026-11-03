// Crea o actualiza una cuenta de coordinación desde la terminal. Recibe usuario, clave, nombre y opciones de
// territorio (región, departamento, modalidad, nodo), y guarda la clave cifrada con hash.
import { pool } from '../src/db.js';
import { hashClave } from '../src/acceso/clave.js';

// Separa las opciones con formato --campo=valor de los argumentos que van por posición.
const opciones = {};
const args = process.argv.slice(2).filter((a) => {
  const m = /^--(region|departamento|modalidad|nodo)=(.*)$/.exec(a);
  if (m) opciones[m[1]] = m[2].trim() || null;
  return !m;
});
const ROLES = ['coordinador', 'tecnico_administrativo', 'coordinador_compras', 'coordinador_datos', 'tallerista'];
// Perfiles que necesitan al menos una opción de territorio para poder ver unidades.
const CON_TERRITORIO = ['coordinador', 'tecnico_administrativo', 'tallerista'];

try {
  if (args[0] === '--gestor') {
    const [, cedula, clave] = args;
    if (!cedula || !clave) throw new Error('Uso: --gestor <cedula> <clave>');
    const r = await pool.query('UPDATE gestores SET clave_hash = $2 WHERE cedula = $1', [cedula, await hashClave(clave)]);
    if (!r.rowCount) throw new Error(`No existe un gestor con cédula ${cedula}.`);
    console.log(`Clave actualizada para el gestor ${cedula}.`);
  } else {
    const [usuario, clave, nombre, rol = 'coordinador', cedula = null] = args;
    if (!usuario || !clave || !nombre) {
      throw new Error('Uso: <usuario> <clave> "<nombre>" [rol] [cedula]');
    }
    if (!ROLES.includes(rol)) throw new Error(`Rol inválido. Usa uno de: ${ROLES.join(', ')}`);
    if (clave.length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');
    const t = CON_TERRITORIO.includes(rol)
      ? { region: opciones.region ?? null, departamento: opciones.departamento ?? null,
        modalidad: opciones.modalidad ?? null, nodo: opciones.nodo?.toUpperCase() ?? null }
      : { region: null, departamento: null, modalidad: null, nodo: null };
    if (rol === 'tallerista') {
      if (!t.region) throw new Error('El Tallerista necesita --region con una región existente.');
      const { rows } = await pool.query('SELECT 1 FROM triadas WHERE lower(btrim(region)) = lower(btrim($1)) LIMIT 1', [t.region]);
      if (!rows.length) throw new Error('La región del Tallerista no existe.');
      t.departamento = null; t.modalidad = null; t.nodo = null;
    }
    if (CON_TERRITORIO.includes(rol) && !Object.values(t).some(Boolean)) {
      throw new Error('Este rol necesita --region, --departamento, --modalidad o --nodo.');
    }
    await pool.query(
      `INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula,
                                  region, departamento, modalidad, nodo)
       VALUES ('LOCAL-' || $1, $2, $1, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (usuario) DO UPDATE
         SET tipo = EXCLUDED.tipo, clave_hash = EXCLUDED.clave_hash, nombre = EXCLUDED.nombre,
             cedula = coalesce(EXCLUDED.cedula, coordinadores.cedula), activo = TRUE,
             region = EXCLUDED.region, departamento = EXCLUDED.departamento,
             modalidad = EXCLUDED.modalidad, nodo = EXCLUDED.nodo,
             fecha_actualizacion = now()`,
      [usuario, rol, await hashClave(clave), nombre, cedula, t.region, t.departamento, t.modalidad, t.nodo],
    );
    console.log(`Usuario "${usuario}" (${rol}) listo.`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
