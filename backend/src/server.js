// Punto de entrada del servidor: prepara el almacenamiento, inicia las tareas periódicas (limpieza de sesiones,
// cierre de tickets, informe mensual y envío de correo), levanta la aplicación y gestiona el apagado ordenado.
import fs from 'node:fs';
import { config } from './config.js';
import { crearApp } from './app.js';
import { pool, query } from './db.js';
import { pool as poolInventario, iniciarEsquemaInventario } from './inventario/db.js';
import { iniciarEsquemaCompartido } from './acceso/esquema.js';
import { iniciarEsquemaBitacora } from './servicios/esquema.js';
import { iniciarEnvioPeriodico } from './servicios/correo.js';
import { limpiarCaducados } from './acceso/sesiones.js';
import { generarInformeProgramado } from './servicios/seguimiento.js';
import { cerrarSinConfirmar } from './servicios/tickets.js';

process.on('unhandledRejection', (motivo) => console.error('[api] Promesa rechazada sin manejar:', motivo));

fs.mkdirSync(config.storageDir, { recursive: true });

try {
  await query('SELECT 1');
  await iniciarEsquemaCompartido();
  await iniciarEsquemaInventario();
  await iniciarEsquemaBitacora();
} catch (err) {
  console.error(`[db] No se pudo preparar PostgreSQL: ${err.message}`);
  console.error('[db] Revisa backend/.env (DATABASE_URL, o PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE).');
  process.exit(1);
}

// Borra sesiones vencidas y registros viejos al arrancar y cada 15 minutos.
const limpiar = () => limpiarCaducados().catch((e) => console.error('[api] No se pudo limpiar sesiones:', e.message));
await limpiar();
setInterval(limpiar, 15 * 60_000).unref();

// Deja como solucionados los tickets respondidos que no recibieron confirmación del solicitante en 5 días
// hábiles.
const cerrarTickets = () => cerrarSinConfirmar().catch((e) => console.error('[api] No se pudieron cerrar los tickets sin confirmar:', e.message));
cerrarTickets();
setInterval(cerrarTickets, 15 * 60_000).unref();

// Genera una sola vez el informe mensual del mes anterior y avisa al nivel nacional; se revisa al arrancar y
// cada 6 horas.
const informe = () => generarInformeProgramado().catch((e) => console.error('[api] No se pudo generar el informe mensual:', e.message));
informe();
setInterval(informe, 6 * 60 * 60_000).unref();

iniciarEnvioPeriodico();

const app = crearApp();
const servidor = app.listen(config.puerto, () => {
  console.log(`[api] Servidor escuchando en http://localhost:${config.puerto}`);
  console.log(`[api] Archivos en ${config.storageDir}`);
});

servidor.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `[api] El puerto ${config.puerto} ya está en uso. Cierra la otra ventana o cambia PORT.`
    : e);
  process.exit(1);
});

servidor.requestTimeout = 10 * 60 * 1000;

// Apagado ordenado: deja de recibir peticiones, cierra las conexiones a la base y fuerza la salida a los 10
// segundos si algo se cuelga.
function cerrar(senal) {
  console.log(`[api] ${senal} recibido, cerrando…`);
  servidor.close(() => Promise.all([pool.end(), poolInventario.end()]).finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));
