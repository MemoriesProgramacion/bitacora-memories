// Migración de una sola vez que pasa a los administradores del inventario a la tabla de cuentas de
// coordinación, conservando usuario, nombre, clave y estado, y deja el inventario solo con el perfil de bodega.
// Se puede repetir sin efectos duplicados.
import { pool } from '../src/db.js';

const cliente = await pool.connect();
try {
  await cliente.query('BEGIN');
  const { rows } = await cliente.query("SELECT id, usuario, nombre, clave_hash, activo FROM inventario.usuarios WHERE rol = 'admin' ORDER BY id");
  for (const a of rows) {
    const choque = await cliente.query('SELECT 1 FROM coordinadores WHERE lower(usuario) = lower($1)', [a.usuario]);
    if (choque.rowCount) throw new Error(`Ya existe un coordinador con el usuario "${a.usuario}": renombra uno de los dos y repite.`);
    await cliente.query(
      `INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, activo)
       VALUES ('LOGISTICA-' || $1::text, 'coordinador_compras', $1, $2, $3, $4)`,
      [a.usuario, a.clave_hash, a.nombre, a.activo],
    );
    await cliente.query('DELETE FROM inventario.usuarios WHERE id = $1', [a.id]);
    await cliente.query("DELETE FROM sesiones_app WHERE origen = 'inventario' AND cuenta_id = $1", [a.id]);
  }
  await cliente.query(`ALTER TABLE inventario.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
    ALTER TABLE inventario.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('bodeguero'))`);
  await cliente.query('COMMIT');
  console.log(rows.length ? `Pasaron a Profesional alianzas y conexión de mercados: ${rows.map((a) => a.usuario).join(', ')}.` : 'No había administradores del inventario.');
} catch (e) {
  await cliente.query('ROLLBACK');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cliente.release();
  await pool.end();
}
