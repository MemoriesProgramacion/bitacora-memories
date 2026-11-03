// Mi bodega, de solo consulta: quien tiene asignada una bodega municipal ve el inventario y los traslados de
// esa bodega, y quien tiene acceso total ve todas. El inventario completo, las facturas y los precios no se
// entregan por aquí.
import { consulta } from '../inventario/db.js';
import { prohibido } from '../errores.js';

// Indica si el usuario tiene acceso total.
const esGeneral = (u) => !!u?.general;
// Indica si el usuario tiene acceso territorial.
const esRegional = (u) => u?.rol === 'coordinador' && !u.general;

// Devuelve las bodegas que el usuario puede consultar, con su inventario y traslados.
export async function misBodegas(usuario) {
  if (!esGeneral(usuario) && !esRegional(usuario)) throw prohibido('Esta pantalla es del Coordinador local regional.');
  const bodegas = await consulta(
    `SELECT b.id, b.nombre, b.tipo, b.departamento, b.municipio, p.nombre AS principal
       FROM bodegas b LEFT JOIN bodegas p ON p.id = b.principal_id
      WHERE b.activa AND ($1::boolean OR b.coordinador_sub = $2)
      ORDER BY b.tipo, lower(b.nombre)`,
    [esGeneral(usuario), usuario.sub],
  );
  const ids = bodegas.map((b) => b.id);
  const [existencias, traslados] = ids.length ? await Promise.all([
    consulta(
      `SELECT s.bodega_id, a.id AS articulo_id, a.nombre, a.codigo_proveedor AS sku, s.cantidad
         FROM stock_bodega s JOIN articulos a ON a.id = s.articulo_id
        WHERE s.bodega_id = ANY($1::int[]) AND s.cantidad > 0 ORDER BY lower(a.nombre)`, [ids]),
    consulta(
      `SELECT t.id, t.nota, t.fecha, t.origen_id, t.destino_id, o.nombre AS origen, d.nombre AS destino,
              (SELECT json_agg(json_build_object('nombre', a.nombre, 'cantidad', i.cantidad) ORDER BY a.nombre)
                 FROM traslado_items i JOIN articulos a ON a.id = i.articulo_id WHERE i.traslado_id = t.id) AS items
         FROM traslados t JOIN bodegas o ON o.id = t.origen_id JOIN bodegas d ON d.id = t.destino_id
        WHERE t.origen_id = ANY($1::int[]) OR t.destino_id = ANY($1::int[])
        ORDER BY t.fecha DESC LIMIT 200`, [ids]),
  ]) : [[], []];
  return {
    ok: true,
    bodegas: bodegas.map((b) => ({
      ...b,
      existencias: existencias.filter((e) => e.bodega_id === b.id),
      traslados: traslados.filter((t) => t.origen_id === b.id || t.destino_id === b.id),
    })),
  };
}
