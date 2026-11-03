// Script de desarrollo que crea datos de ejemplo para probar las entregas de kits: una bodega municipal por
// municipio con unidades productivas y un kit armado por cada unidad. Los artículos entran por factura a la
// bodega principal y pasan a las municipales por traslado.
import { pool as pg } from '../src/db.js';
import { pool, conTransaccion } from '../src/inventario/db.js';
import { iniciarEsquemaCompartido } from '../src/acceso/esquema.js';
import { iniciarEsquemaInventario } from '../src/inventario/db.js';
import { codigoArticulo, codigoKit } from '../src/inventario/util.js';

const P = '[Ejemplo Kits]';
const FACTURA = 'EJ-KITS-0001';
const KITS_POR_BODEGA = 2;
const CAPITALES = { 'Atlántico': 'Barranquilla', 'Bolívar': 'Cartagena', 'Cundinamarca': 'Bogotá', 'Valle del Cauca': 'Cali' };

// Contenido de cada kit: nombre, código, cantidad por kit, valor unitario e impuesto unitario.
const CONTENIDO = [
  [`${P} Báscula digital 40 kg`, 'EJK-BAS', 1, 180000, 34200],
  [`${P} Carpa plegable 3x3`, 'EJK-CAR', 1, 350000, 66500],
  [`${P} Mesa plegable`, 'EJK-MES', 1, 160000, 30400],
  [`${P} Silla plástica`, 'EJK-SIL', 2, 45000, 8550],
];

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

try {
  await iniciarEsquemaCompartido();
  await iniciarEsquemaInventario();
  if ((await pool.query('SELECT 1 FROM facturas WHERE numero = $1', [FACTURA])).rowCount) {
    console.log('Los ejemplos de kits ya existen: no se repite nada.');
  } else {
    let ups = (await pg.query(
      `SELECT nombre_up, btrim(municipio) AS municipio, btrim(departamento) AS departamento
         FROM vw_unidades_productivas
        WHERE btrim(coalesce(municipio, '')) <> '' AND btrim(coalesce(departamento, '')) <> ''
        ORDER BY departamento, municipio, nombre_up`)).rows;
    if (!ups.length) {
      ups = [['Soledad', 'Atlántico'], ['Malambo', 'Atlántico'], ['Turbaco', 'Bolívar']]
        .map(([municipio, departamento], i) => ({ nombre_up: `Unidad productiva ${i + 1}`, municipio, departamento }));
    }

    const resumen = await conTransaccion(async (cli) => {
      const bodega = async (nombre, tipo, municipio, departamento, principal = null) => (await cli.q(
        'INSERT INTO bodegas (nombre, tipo, municipio, departamento, principal_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [`${P} ${nombre}`, tipo, municipio, departamento, principal]))[0].id;

      const principales = new Map();
      const municipales = new Map();
      for (const { municipio, departamento } of ups) {
        if (!principales.has(departamento)) {
          principales.set(departamento, await bodega(`Principal ${departamento}`, 'principal', CAPITALES[departamento] || null, departamento));
        }
        const llave = `${municipio}|${departamento}`;
        if (!municipales.has(llave)) {
          municipales.set(llave, {
            id: await bodega(`Municipal ${municipio}`, 'municipal', municipio, departamento, principales.get(departamento)),
            principal: principales.get(departamento),
          });
        }
      }

      const [prov] = await cli.q(
        `INSERT INTO proveedores (nombre, codigo, tipo_documento, numero_documento, contacto, telefono, correo, direccion, municipio, departamento)
         VALUES ('${P} Proveedor', 'EJEMPLO-PROV-KITS', 'NIT', '900000002-2', 'Jorge Pérez', '3002223344', 'kits@ejemplo.co', 'Carrera 45 # 70-12', 'Barranquilla', 'Atlántico')
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`);
      const [f] = await cli.q(
        `INSERT INTO facturas (numero, proveedor_id, total, adjunto, adjunto_nombre, creado_por)
         VALUES ($1, $2, 0, $3, 'factura-kits-ejemplo.pdf', 'Ejemplo') RETURNING id`, [FACTURA, prov.id, PDF]);
      const porPrincipal = new Map();
      for (const m of municipales.values()) porPrincipal.set(m.principal, (porPrincipal.get(m.principal) || 0) + 1);

      const articulos = {};
      let total = 0;
      for (const [nombre, sku, porKit, unitario, impuesto] of CONTENIDO) {
        const cantidadTotal = porKit * KITS_POR_BODEGA * municipales.size;
        const [a] = await cli.q(
          `INSERT INTO articulos (nombre, codigo_proveedor, proveedor_id, codigo_barras, precio, stock, minimo)
           VALUES ($1,$2,$3,$4,$5,$6,2) RETURNING id`, [nombre, sku, prov.id, `PENDIENTE-${sku}`, unitario, cantidadTotal]);
        await cli.q('UPDATE articulos SET codigo_barras = $1 WHERE id = $2', [codigoArticulo(a.id), a.id]);
        articulos[sku] = a.id;
        await cli.q(`INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo, referencia, proveedor_id, codigo_proveedor)
                     VALUES ($1,'entrada',$2,'factura',$3,$4,$5)`, [a.id, cantidadTotal, FACTURA, prov.id, sku]);
        for (const [principal, nMunicipales] of porPrincipal) {
          const cantidad = porKit * KITS_POR_BODEGA * nMunicipales;
          const linea = cantidad * (unitario + impuesto);
          total += linea;
          await cli.q('INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [principal, a.id, cantidad]);
          await cli.q(
            `INSERT INTO factura_items (factura_id, bodega_id, articulo_id, nombre, descripcion, sku, cantidad, valor_unitario, valor_impuesto, total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [f.id, principal, a.id, nombre, 'Dotación de Kit UP', sku, cantidad, unitario, cantidad * impuesto, linea]);
        }
      }
      await cli.q('UPDATE facturas SET total = $1 WHERE id = $2', [total, f.id]);

      for (const [llave, m] of municipales) {
        const [t] = await cli.q(
          'INSERT INTO traslados (origen_id, destino_id, nota, creado_por) VALUES ($1,$2,$3,\'Ejemplo\') RETURNING id',
          [m.principal, m.id, `${P} Dotación para Kits UP de ${llave.split('|')[0]}`]);
        for (const [, sku, porKit] of CONTENIDO) {
          const cantidad = porKit * KITS_POR_BODEGA;
          await cli.q('UPDATE stock_bodega SET cantidad = cantidad - $1 WHERE bodega_id = $2 AND articulo_id = $3', [cantidad, m.principal, articulos[sku]]);
          await cli.q('INSERT INTO stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [m.id, articulos[sku], cantidad]);
          await cli.q('INSERT INTO traslado_items (traslado_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [t.id, articulos[sku], cantidad]);
        }
      }

      const kits = [];
      for (const up of ups) {
        const nombre = `${P} Kit UP ${up.nombre_up} (${up.municipio})`;
        const [k] = await cli.q(
          'INSERT INTO combos (nombre, codigo_barras, stock, armado, armado_en, descontado_al_armar) VALUES ($1, $2, 1, TRUE, now(), FALSE) RETURNING id',
          [nombre, `PENDIENTE-KIT-${kits.length}-${Date.now()}`]);
        await cli.q('UPDATE combos SET codigo_barras = $1 WHERE id = $2', [codigoKit(k.id), k.id]);
        for (const [, sku, porKit] of CONTENIDO) {
          await cli.q('INSERT INTO combo_items (combo_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [k.id, articulos[sku], porKit]);
        }
        kits.push(nombre);
      }
      return { principales: principales.size, municipales: [...municipales.keys()].map((l) => l.replace('|', ', ')), kits };
    });

    console.log(`Bodegas principales: ${resumen.principales}`);
    console.log(`Bodegas municipales (${resumen.municipales.length}), cada una con existencias para ${KITS_POR_BODEGA} kits:`);
    for (const m of resumen.municipales) console.log(`  - ${P} Municipal ${m}`);
    console.log(`Kits UP armados (${resumen.kits.length}):`);
    for (const k of resumen.kits) console.log(`  - ${k}`);
    console.log(`Cada kit lleva: ${CONTENIDO.map(([n, , c]) => `${c} × ${n.replace(`${P} `, '')}`).join(', ')}.`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  await pg.end();
}
