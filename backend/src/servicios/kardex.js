// Kardex de inventario, de solo consulta: cómo se mueve la mercancía, con el saldo de cada bodega después de
// cada movimiento y su comprobante. Entra con una factura a una bodega principal, se traslada entre bodegas y
// se entrega a una unidad productiva.
import { consulta } from '../inventario/db.js';
import { prohibido } from '../errores.js';
import { txt, entero } from '../util.js';

const TIPOS = {
  entrada: 'Entrada por factura', traslado_salida: 'Traslado (sale)', traslado_entrada: 'Traslado (entra)', entrega_up: 'Entrega a UP',
  recepcion: 'Recepción', kit: 'Salida a kit', ajuste: 'Ajuste manual',
  entrega_kit: 'Entrega de kit',
};
const GRUPOS = {
  entrada: ['entrada'], traslado: ['traslado_salida', 'traslado_entrada'], entrega: ['entrega_up', 'entrega_kit'], otros: ['recepcion', 'kit', 'ajuste'],
};
const LIMITE = 500;

// Consulta de todos los movimientos con el saldo acumulado de su bodega y artículo; los filtros se aplican
// después para que el saldo siga siendo el real.
const SQL_KARDEX = `
  WITH costo AS (
    SELECT articulo_id, SUM(cantidad * valor_unitario) / NULLIF(SUM(cantidad), 0) AS costo FROM factura_items GROUP BY articulo_id
  ), mov AS (
    SELECT f.creado AS fecha, 1 AS orden, 'entrada' AS tipo, 'Factura ' || f.numero AS comprobante, f.id AS doc_id,
           i.bodega_id, i.articulo_id, i.cantidad::int AS cantidad, i.valor_unitario AS valor_unitario,
           COALESCE(p.nombre, '') AS detalle, i.id AS ln
      FROM factura_items i JOIN facturas f ON f.id = i.factura_id LEFT JOIN proveedores p ON p.id = f.proveedor_id
     WHERE NOT f.entrega_pendiente
    UNION ALL
    -- Una factura «pendiente de entrega» (E9) entra a la bodega con cada recepción contra la factura, no al registrarla.
    SELECT r.fecha, 1, 'entrada', 'Factura ' || f.numero || ' · recepción', f.id,
           i.bodega_id, i.articulo_id, r.cantidad::int, i.valor_unitario,
           COALESCE(p.nombre, '') || ' · Recibido por ' || COALESCE(r.recibido_por, ''), r.id
      FROM factura_recepciones r JOIN factura_items i ON i.id = r.item_id JOIN facturas f ON f.id = r.factura_id
      LEFT JOIN proveedores p ON p.id = f.proveedor_id
     WHERE f.entrega_pendiente
    UNION ALL
    SELECT t.fecha, 2, 'traslado_salida', 'Traslado ' || lpad(t.id::text, 5, '0'), t.id, t.origen_id, ti.articulo_id, -ti.cantidad, NULL,
           'Hacia ' || d.nombre || CASE WHEN t.nota <> '' THEN ' · ' || t.nota ELSE '' END, ti.id
      FROM traslado_items ti JOIN traslados t ON t.id = ti.traslado_id JOIN bodegas d ON d.id = t.destino_id
    UNION ALL
    SELECT t.fecha, 2, 'traslado_entrada', 'Traslado ' || lpad(t.id::text, 5, '0'), t.id, t.destino_id, ti.articulo_id, ti.cantidad, NULL,
           'Desde ' || o.nombre || CASE WHEN t.nota <> '' THEN ' · ' || t.nota ELSE '' END, ti.id
      FROM traslado_items ti JOIN traslados t ON t.id = ti.traslado_id JOIN bodegas o ON o.id = t.origen_id
    UNION ALL
    SELECT e.fecha, 3, 'entrega_up', 'Entrega ' || lpad(e.id::text, 5, '0'), e.id, e.bodega_id, ei.articulo_id, -ei.cantidad, NULL,
           'UP ' || e.id_unico || COALESCE(' · ' || e.unidad_nombre, ''), ei.id
      FROM entrega_up_items ei JOIN entregas_up e ON e.id = ei.entrega_id
    UNION ALL
    SELECT e.fecha, 3, 'entrega_kit', 'Entrega de kit ' || lpad(e.id::text, 5, '0'), e.id,
           e.bodega_id, i.articulo_id, -i.cantidad, NULL,
           c.nombre || ' · Responsable: ' || (e.responsable->>'nombre'), i.id
      FROM entrega_kit_items i JOIN entregas_kits e ON e.id = i.entrega_id JOIN combos c ON c.id = e.combo_id
    UNION ALL
    -- Lo que mueve el total del inventario sin pasar por una bodega (las facturas y las entregas a UP ya están arriba).
    SELECT mv.fecha, 0,
           CASE WHEN mv.motivo = 'kit' THEN 'kit' WHEN mv.motivo = 'ajuste' THEN 'ajuste' ELSE 'recepcion' END,
           CASE WHEN mv.motivo = 'kit' THEN 'Kit ' || COALESCE(mv.referencia, '') WHEN mv.motivo = 'ajuste' THEN 'Ajuste manual'
                ELSE 'Recepción' || COALESCE(' ' || mv.referencia, '') END,
           mv.id, mv.bodega_id, mv.articulo_id,
           CASE WHEN mv.tipo = 'salida' THEN -mv.cantidad ELSE mv.cantidad END, NULL, COALESCE(pr.nombre, ''), mv.id
      FROM movimientos mv LEFT JOIN proveedores pr ON pr.id = mv.proveedor_id
     WHERE mv.motivo IN ('recepcion', 'kit', 'ajuste')
  )
  SELECT m.fecha, m.orden, m.tipo, m.comprobante, m.doc_id, m.bodega_id, COALESCE(b.nombre, 'Sin ubicar') AS bodega,
         m.articulo_id, a.nombre AS articulo, a.codigo_proveedor AS sku, m.cantidad, m.valor_unitario, c.costo AS costo_promedio,
         ROUND(ABS(m.cantidad) * COALESCE(m.valor_unitario, c.costo, 0), 2) AS valor, m.detalle,
         SUM(m.cantidad) OVER (PARTITION BY m.bodega_id, m.articulo_id ORDER BY m.fecha, m.orden, m.doc_id, m.ln, m.tipo
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::int AS saldo
    FROM mov m LEFT JOIN bodegas b ON b.id = m.bodega_id JOIN articulos a ON a.id = m.articulo_id LEFT JOIN costo c ON c.articulo_id = m.articulo_id`;

// Devuelve las bodegas que el usuario puede ver, incluida la opción sin ubicar.
async function alcance(usuario) {
  if (usuario?.superadmin || (usuario?.general && !usuario?.esDatos) || usuario?.rol === 'coordinador_compras') return { todas: true, ids: null };
  if (usuario?.rol === 'coordinador' && !usuario.general) {
    return { todas: false, ids: (await consulta('SELECT id FROM bodegas WHERE activa AND coordinador_sub = $1', [usuario.sub])).map((b) => b.id) };
  }
  throw prohibido('El Kardex es del Coordinador general, el Coordinador local regional y el Profesional alianzas y conexión de mercados.');
}

const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(txt(v) || '') ? txt(v) : null);
const comodin = (q) => (q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%` : null);

// Lista los movimientos con filtros y su saldo acumulado.
export async function kardex(usuario, p = {}) {
  const { todas, ids: asignadas } = await alcance(usuario);
  const bodegas = await consulta(
    `SELECT id, nombre, tipo, municipio FROM bodegas WHERE activa AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY tipo, lower(nombre)`, [asignadas]);
  const ids = bodegas.map((b) => b.id);
  const soloSinUbicar = p.bodega === 'sin';
  if (soloSinUbicar && !todas) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  const bodegaId = soloSinUbicar ? null : entero(p.bodega);
  if (bodegaId && !ids.includes(bodegaId)) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  const q = txt(p.q);

  const params = [ids, bodegaId || null, entero(p.articulo) || null, GRUPOS[p.tipo] || null, fechaValida(p.desde), fechaValida(p.hasta),
    comodin(q), todas, soloSinUbicar];
  const filtros = `(bodega_id = ANY($1::int[]) OR ($8::boolean AND bodega_id IS NULL))
    AND ($2::int IS NULL OR bodega_id = $2) AND (NOT $9::boolean OR bodega_id IS NULL) AND ($3::int IS NULL OR articulo_id = $3)
    AND ($4::text[] IS NULL OR tipo = ANY($4))
    AND ($5::date IS NULL OR (fecha AT TIME ZONE 'America/Bogota')::date >= $5)
    AND ($6::date IS NULL OR (fecha AT TIME ZONE 'America/Bogota')::date <= $6)
    AND ($7::text IS NULL OR articulo ILIKE $7 OR sku ILIKE $7 OR comprobante ILIKE $7 OR detalle ILIKE $7)`;

  const [movimientos, resumen, articulos] = await Promise.all([
    consulta(`SELECT * FROM (${SQL_KARDEX}) k WHERE ${filtros} ORDER BY fecha DESC, orden DESC, doc_id DESC, articulo, saldo DESC LIMIT ${LIMITE + 1}`, params),
    consulta(`SELECT COALESCE(SUM(GREATEST(cantidad, 0)), 0)::int AS entradas, COALESCE(SUM(GREATEST(-cantidad, 0)), 0)::int AS salidas,
                     COALESCE(SUM(valor) FILTER (WHERE cantidad > 0), 0)::numeric AS valor_entradas,
                     COALESCE(SUM(valor) FILTER (WHERE cantidad < 0), 0)::numeric AS valor_salidas, COUNT(*)::int AS movimientos
                FROM (${SQL_KARDEX}) k WHERE ${filtros}`, params),
    consulta(`SELECT DISTINCT articulo_id AS id, articulo AS nombre, sku FROM (${SQL_KARDEX}) k
               WHERE bodega_id = ANY($1::int[]) OR ($2::boolean AND bodega_id IS NULL) ORDER BY articulo`, [ids, todas]),
  ]);
  return {
    ok: true,
    bodegas, articulos, tipos: TIPOS,
    con_sin_ubicar: todas,
    resumen: resumen[0],
    truncado: movimientos.length > LIMITE,
    movimientos: movimientos.slice(0, LIMITE),
  };
}

// Devuelve el saldo actual de cada artículo en cada bodega, valorado con el costo promedio del artículo.
export async function saldos(usuario, p = {}) {
  const { todas, ids } = await alcance(usuario);
  const soloSinUbicar = p.bodega === 'sin';
  if (soloSinUbicar && !todas) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  const bodegaId = soloSinUbicar ? null : entero(p.bodega);
  if (bodegaId && ids && !ids.includes(bodegaId)) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  const patron = comodin(txt(p.q));
  const costo = `(SELECT SUM(fi.cantidad * fi.valor_unitario) / NULLIF(SUM(fi.cantidad), 0) FROM factura_items fi WHERE fi.articulo_id = a.id)`;
  const filas = await consulta(
    `SELECT s.bodega_id, b.nombre AS bodega, b.tipo, a.id AS articulo_id, a.nombre AS articulo, a.codigo_proveedor AS sku, s.cantidad AS saldo,
            ${costo} AS costo_promedio, ROUND(s.cantidad * COALESCE(${costo}, 0), 2) AS valor,
            (SELECT MAX(k.fecha) FROM (${SQL_KARDEX}) k WHERE k.bodega_id = s.bodega_id AND k.articulo_id = s.articulo_id) AS ultimo_movimiento
       FROM stock_bodega s JOIN bodegas b ON b.id = s.bodega_id AND b.activa JOIN articulos a ON a.id = s.articulo_id
      WHERE s.cantidad > 0 AND ($1::int[] IS NULL OR s.bodega_id = ANY($1)) AND ($2::int IS NULL OR s.bodega_id = $2) AND NOT $4::boolean
        AND ($3::text IS NULL OR a.nombre ILIKE $3 OR a.codigo_proveedor ILIKE $3) AND ($6::int IS NULL OR a.id = $6)
      UNION ALL
    -- «Sin ubicar»: lo que el inventario tiene de más que lo repartido en bodegas.
    SELECT NULL, 'Sin ubicar', 'sin_ubicar', a.id, a.nombre, a.codigo_proveedor,
           (a.stock - COALESCE((SELECT SUM(s2.cantidad) FROM stock_bodega s2 WHERE s2.articulo_id = a.id), 0))::int,
           ${costo}, ROUND((a.stock - COALESCE((SELECT SUM(s2.cantidad) FROM stock_bodega s2 WHERE s2.articulo_id = a.id), 0)) * COALESCE(${costo}, 0), 2),
           (SELECT MAX(k.fecha) FROM (${SQL_KARDEX}) k WHERE k.bodega_id IS NULL AND k.articulo_id = a.id)
      FROM articulos a
     WHERE $5::boolean AND a.activo AND ($2::int IS NULL) AND ($3::text IS NULL OR a.nombre ILIKE $3 OR a.codigo_proveedor ILIKE $3)
       AND ($6::int IS NULL OR a.id = $6)
       AND (a.stock - COALESCE((SELECT SUM(s2.cantidad) FROM stock_bodega s2 WHERE s2.articulo_id = a.id), 0)) > 0
    ORDER BY 3, 2, 5`,
    [ids, bodegaId || null, patron, soloSinUbicar, todas, entero(p.articulo) || null]);
  const sinFiltroSin = soloSinUbicar ? filas.filter((f) => f.bodega_id === null) : filas;
  return {
    ok: true, saldos: sinFiltroSin,
    unidades: sinFiltroSin.reduce((s, f) => s + f.saldo, 0),
    valor: sinFiltroSin.reduce((s, f) => s + Number(f.valor || 0), 0),
  };
}
