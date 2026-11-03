// Crea un usuario usuario con acceso total o le cambia la clave si ya existe. Si no se indica clave, genera una
// al azar y la muestra una sola vez, porque queda guardada cifrada.
import { pool } from '../src/db.js';
import { iniciarEsquemaCompartido } from '../src/acceso/esquema.js';
import { iniciarEsquemaInventario } from '../src/inventario/db.js';
import { hashClave, claveAleatoria, validarClaveNueva } from '../src/acceso/clave.js';
import { buscarPorUsuario } from '../src/acceso/cuentas.js';

const [usuarioArg, nombreArg, claveArg] = process.argv.slice(2);

try {
  const usuario = String(usuarioArg || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
    throw new Error('Uso: npm run superadmin:crear -- <usuario> ["<nombre>"] [clave]  (usuario: 3 a 40 letras, números, . _ -)');
  }
  const clave = claveArg || claveAleatoria(16);
  const motivo = validarClaveNueva(clave, { usuario });
  if (motivo) throw new Error(motivo);

  await iniciarEsquemaCompartido();
  await iniciarEsquemaInventario();

  const otras = (await buscarPorUsuario(usuario)).filter((c) => c.origen !== 'superadmin');
  if (otras.length) throw new Error(`Ya existe un usuario "${usuario}" de tipo ${otras[0].origen}. Elige otro nombre.`);

  const hash = await hashClave(clave);
  await pool.query(
    `INSERT INTO superadmins (usuario, nombre, clave_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (usuario) DO UPDATE SET clave_hash = EXCLUDED.clave_hash, activo = TRUE`,
    [usuario, nombreArg || 'Superadministrador', hash],
  );
  await pool.query('DELETE FROM intentos_login WHERE usuario = $1', [usuario]);
  await pool.query(
    `INSERT INTO auditoria_claves (origen, usuario_texto, accion, hecho_por)
     VALUES ('superadmin', $1, 'creacion_script', 'consola')`,
    [usuario],
  );

  console.log('Superadmin listo:');
  console.log(`  usuario: ${usuario}`);
  console.log(`  clave:   ${clave}`);
  if (!claveArg) console.log('Anota la clave: no se vuelve a mostrar.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
