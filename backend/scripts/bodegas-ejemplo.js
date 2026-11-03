// Script de desarrollo que llena la base con datos de ejemplo de bodegas: crea bodegas principales y
// municipales, una factura con su PDF, un traslado y kits armados con artículos de la bodega municipal. Se
// ejecuta con npm run bodegas:ejemplo y puede recibir el usuario al que se asigna la bodega municipal.
import { pool as pg } from '../src/db.js';
import { pool, conTransaccion } from '../src/inventario/db.js';
import { iniciarEsquemaCompartido } from '../src/acceso/esquema.js';
import { iniciarEsquemaInventario } from '../src/inventario/db.js';
import { codigoArticulo, codigoKit } from '../src/inventario/util.js';

// PDF mínimo válido que se adjunta a la factura de ejemplo.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

try {
  await iniciarEsquemaCompartido();
  await iniciarEsquemaInventario();
  if ((await pool.query("SELECT 1 FROM bodegas WHERE nombre LIKE '[Ejemplo]%'")).rowCount) {
    console.log('Los ejemplos ya existen: no se repite nada.');
  } else {
    await conTransaccion(async (cli) => {
      const bodega = async (nombre, tipo, municipio, departamento, principal = null) => (await cli.q(
        'INSERT INTO bodegas (nombre, tipo, municipio, departamento, principal_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [`[Ejemplo] ${nombre}`, tipo, municipio, departamento, principal]))[0].id;
      const norte = await bodega('Principal Norte', 'principal', 'Barranquilla', 'Atlántico');
      const centro = await bodega('Principal Centro', 'principal', 'Bogotá', 'Cundinamarca');
      await bodega('Principal Sur', 'principal', 'Cali', 'Valle del Cauca');
      const soledad = await bodega('Municipal Soledad', 'municipal', 'Soledad', 'Atlántico', norte);
      await bodega('Municipal Soacha', 'municipal', 'Soacha', 'Cundinamarca', centro);
      const regiones = (await cli.q("SELECT DISTINCT btrim(region) AS r FROM public.triadas WHERE btrim(region) <> '' AND region <> 'Por asignar' ORDER BY 1")).map((x) => x.r);
      if (regiones.length) {
        await cli.q("UPDATE bodegas SET region = $1 WHERE nombre IN ('[Ejemplo] Principal Norte', '[Ejemplo] Municipal Soledad')", [regiones[0]]);
        await cli.q("UPDATE bodegas SET region = $1 WHERE nombre LIKE '[Ejemplo]%' AND region IS NULL", [regiones[1] || regiones[0]]);
      }

      const [prov] = await cli.q(
        `INSERT INTO proveedores (nombre, codigo, tipo_documento, numero_documento, contacto, telefono, correo, direccion, municipio, departamento)
         VALUES ('[Ejemplo] Proveedor', 'EJEMPLO-PROV', 'NIT', '900000001-1', 'Marta Ruiz', '3001112233', 'ventas@ejemplo.co', 'Calle 10 # 20-30', 'Barranquilla', 'Atlántico')
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`);
      const articulo = async (nombre, sku, unitario, cantidad) => {
        const [a] = await cli.q(
          `INSERT INTO articulos (nombre, codigo_proveedor, proveedor_id, codigo_barras, precio, stock, minimo)
           VALUES ($1,$2,$3,$4,$5,$6,5) RETURNING id`,
          [nombre, sku, prov.id, `PENDIENTE-${sku}`, unitario, cantidad]);
        await cli.q('UPDATE articulos SET codigo_barras = $1 WHERE id = $2', [codigoArticulo(a.id), a.id]);
        return a.id;
      };
      const lineas = [
        ['[Ejemplo] Teclado USB', 'Teclado en español', 'EJ-TEC', 40, 28000, 5320, norte],
        ['[Ejemplo] Mouse óptico', 'Mouse USB', 'EJ-MOU', 40, 15000, 2850, norte],
        ['[Ejemplo] Impresora', 'Impresora láser', 'EJ-IMP', 6, 520000, 98800, centro],
      ];
      let total = 0;
      const [f] = await cli.q(
        `INSERT INTO facturas (numero, proveedor_id, total, adjunto, adjunto_nombre, creado_por)
         VALUES ('EJ-0001', $1, 0, $2, 'factura-ejemplo.pdf', 'Ejemplo') RETURNING id`, [prov.id, PDF]);
      const ids = {};
      for (const [nombre, descripcion, sku, cantidad, unitario, impuesto, bodegaId] of lineas) {
        const aid = await articulo(nombre, sku, unitario, cantidad);
        ids[sku] = aid;
        const linea = cantidad * unitario + impuesto;
        total += linea;
        await cli.q('INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [bodegaId, aid, cantidad]);
        await cli.q(`INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, proveedor_id, codigo_proveedor)
                     VALUES ($1,'entrada',$2,'factura','EJ-0001',$3,$4)`, [aid, cantidad, prov.id, sku]);
        await cli.q(
          `INSERT INTO factura_items (factura_id, bodega_id, articulo_id, nombre, descripcion, sku, cantidad, valor_unitario, valor_impuesto, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [f.id, bodegaId, aid, nombre, descripcion, sku, cantidad, unitario, impuesto, linea]);
      }
      await cli.q('UPDATE facturas SET total = $1 WHERE id = $2', [total, f.id]);

      const [t] = await cli.q(
        "INSERT INTO traslados (origen_id, destino_id, nota, creado_por) VALUES ($1,$2,'[Ejemplo] Dotación inicial de la bodega de Soledad','Ejemplo') RETURNING id",
        [norte, soledad]);
      for (const [sku, cantidad] of [['EJ-TEC', 10], ['EJ-MOU', 10]]) {
        await cli.q('UPDATE stock_bodega SET cantidad = cantidad - $1 WHERE bodega_id = $2 AND articulo_id = $3', [cantidad, norte, ids[sku]]);
        await cli.q('INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [soledad, ids[sku], cantidad]);
        await cli.q('INSERT INTO traslado_items (traslado_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [t.id, ids[sku], cantidad]);
      }
    });
    console.log('Ejemplos creados: 3 bodegas principales, 2 municipales, 1 factura con PDF y 1 traslado.');
  }

  const { rows: tec } = await pool.query("SELECT id FROM articulos WHERE codigo_proveedor = 'EJ-TEC'");
  const { rows: mou } = await pool.query("SELECT id FROM articulos WHERE codigo_proveedor = 'EJ-MOU'");
  if (tec.length && mou.length && !(await pool.query("SELECT 1 FROM combos WHERE nombre LIKE '[Ejemplo]%'")).rowCount) {
    await conTransaccion(async (cli) => {
      for (const nombre of ['[Ejemplo] Kit UP 1', '[Ejemplo] Kit UP 2', '[Ejemplo] Kit UP 3']) {
        const [k] = await cli.q(
          "INSERT INTO combos (nombre, codigo_barras, stock, armado, armado_en, descontado_al_armar) VALUES ($1, $2, 1, TRUE, now(), FALSE) RETURNING id",
          [nombre, `PENDIENTE-${nombre}`]);
        await cli.q('UPDATE combos SET codigo_barras = $1 WHERE id = $2', [codigoKit(k.id), k.id]);
        for (const aid of [tec[0].id, mou[0].id]) {
          await cli.q('INSERT INTO combo_items (combo_id, articulo_id, cantidad) VALUES ($1,$2,2)', [k.id, aid]);
        }
      }
    });
    console.log('Kits de ejemplo creados: 3 Kit UP armados (2 teclados y 2 mouse cada uno).');
  }

  const usuario = process.argv[2];
  if (usuario) {
    const { rows: [c] } = await pg.query("SELECT id_coordinador FROM coordinadores WHERE lower(usuario) = lower($1) AND tipo = 'coordinador'", [usuario]);
    if (!c) console.log(`No hay un Coordinador local regional con el usuario «${usuario}»: no se asignó la bodega.`);
    else {
      await pool.query("UPDATE bodegas SET coordinador_sub = $1 WHERE nombre = '[Ejemplo] Municipal Soledad'", [`coordinador:${c.id_coordinador}`]);
      console.log(`Bodega «[Ejemplo] Municipal Soledad» asignada a ${usuario}.`);
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  await pg.end();
}
