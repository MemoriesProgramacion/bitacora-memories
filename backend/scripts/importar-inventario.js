// Copia una sola vez los datos de la base antigua de inventario a la base unificada, conservando los
// identificadores para que kits, órdenes y movimientos sigan apuntando a lo mismo.
import pg from 'pg';
import { pool, conTransaccion, iniciarEsquemaInventario } from '../src/inventario/db.js';

// Tablas a copiar, ordenadas para respetar las llaves foráneas.
const TABLAS = [
  'proveedores', 'articulos', 'movimientos', 'combos', 'combo_items', 'ordenes',
  'orden_items', 'evidencias_transporte', 'lotes', 'lote_items', 'contadores', 'usuarios',
];

const e = process.env;
const origen = new pg.Pool(
  e.ORIGEN_DATABASE_URL
    ? { connectionString: e.ORIGEN_DATABASE_URL }
    : {
        host: e.ORIGEN_PGHOST || 'localhost',
        port: Number(e.ORIGEN_PGPORT || 5432),
        database: e.ORIGEN_PGDATABASE || 'dps_inventario',
        user: e.ORIGEN_PGUSER || 'dps',
        password: e.ORIGEN_PGPASSWORD,
      },
);

try {
  await iniciarEsquemaInventario();

  const resumen = await conTransaccion(async (cli) => {
    const copiadas = {};
    for (const tabla of TABLAS) {
      const { rows: colsDestino } = await cli.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'inventario' AND table_name = $1`, [tabla]);
      const { rows: filas } = await origen.query(`SELECT * FROM ${tabla}`).catch(() => ({ rows: [] }));
      if (!filas.length) { copiadas[tabla] = 0; continue; }
      const destino = new Set(colsDestino.map((c) => c.column_name));
      const columnas = Object.keys(filas[0]).filter((c) => destino.has(c));

      let n = 0;
      for (const fila of filas) {
        const r = await cli.query(
          `INSERT INTO inventario.${tabla} (${columnas.join(', ')}) OVERRIDING SYSTEM VALUE
           VALUES (${columnas.map((_, i) => `$${i + 1}`).join(', ')})
           ON CONFLICT DO NOTHING`,
          columnas.map((c) => fila[c]),
        );
        n += r.rowCount;
      }
      copiadas[tabla] = n;

      if (columnas.includes('id') && tabla !== 'contadores') {
        await cli.query(
          `SELECT setval(pg_get_serial_sequence('inventario.${tabla}', 'id'),
                         greatest((SELECT coalesce(max(id), 0) FROM inventario.${tabla}), 1))`,
        );
      }
    }
    return copiadas;
  });

  console.log('Filas copiadas al esquema inventario:');
  for (const [t, n] of Object.entries(resumen)) console.log(`  ${t.padEnd(24)} ${n}`);
} catch (err) {
  console.error(`No se pudo importar: ${err.message}`);
  process.exitCode = 1;
} finally {
  await origen.end();
  await pool.end();
}
