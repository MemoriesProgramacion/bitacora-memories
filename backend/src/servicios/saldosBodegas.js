// Saldos de productos por bodega, de solo consulta: una tabla de productos contra bodegas con la cantidad que
// hay hoy en cada una. Según el acceso de la cuenta se ven todas las bodegas, incluido lo que está sin ubicar,
// o solo las de su región.
import { consulta } from '../inventario/db.js';
import { prohibido } from '../errores.js';
import { txt, entero } from '../util.js';
import { normTexto } from '../alcance.js';

const comodin = (q) => (q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%` : null);

// Devuelve las bodegas que puede ver quien tiene un territorio.
async function bodegasDeTerritorio(usuario) {
  const a = usuario.alcance || {};
  const regiones = new Set();
  const deptos = new Set();
  if (a.region) regiones.add(normTexto(a.region));
  if (a.departamento) deptos.add(normTexto(a.departamento));
  if (!a.region && !a.departamento && a.nodo) {
    for (const r of await consulta('SELECT DISTINCT region FROM public.triadas WHERE upper(btrim(nodo)) = upper(btrim($1))', [a.nodo])) {
      if (r.region) regiones.add(normTexto(r.region));
    }
  }
  const deptosDeRegion = new Set();
  if (regiones.size) {
    const filas = await consulta(
      `SELECT DISTINCT t.region, up.departamento FROM public.triadas t
         JOIN public.unidades_productivas up ON up.id_triada = t.id_triada WHERE up.departamento IS NOT NULL`);
    for (const f of filas) if (regiones.has(normTexto(f.region))) deptosDeRegion.add(normTexto(f.departamento));
  }
  const todas = await consulta('SELECT id, nombre, tipo, municipio, departamento, region, coordinador_sub FROM bodegas WHERE activa ORDER BY tipo, lower(nombre)');
  return todas.filter((b) => (usuario.rol === 'coordinador' && b.coordinador_sub === usuario.sub)
    || (b.region && regiones.has(normTexto(b.region)))
    || (b.departamento && deptos.has(normTexto(b.departamento)))
    || (!b.region && b.departamento && deptosDeRegion.has(normTexto(b.departamento))));
}

// Arma la tabla de saldos con filtros de bodega y búsqueda, y rechaza las bodegas que el usuario no puede
// consultar.
async function armar(bodegas, conSinUbicar, p = {}) {
  const ids = bodegas.map((b) => b.id);
  const bodegaId = p.bodega === 'sin' ? 'sin' : entero(p.bodega);
  if (bodegaId && bodegaId !== 'sin' && !ids.includes(bodegaId)) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  if (bodegaId === 'sin' && !conSinUbicar) throw prohibido('Esa bodega no está entre las que puedes consultar.');
  const patron = comodin(txt(p.q));
  const filas = await consulta(
    `SELECT s.bodega_id::text AS columna, a.id, a.nombre, a.codigo_proveedor AS sku, s.cantidad::int AS cantidad
       FROM stock_bodega s JOIN articulos a ON a.id = s.articulo_id AND a.activo
      WHERE s.cantidad > 0 AND s.bodega_id = ANY($1::int[]) AND ($2::text IS NULL OR s.bodega_id::text = $2)
        AND ($3::text IS NULL OR a.nombre ILIKE $3 OR a.codigo_proveedor ILIKE $3)
     UNION ALL
    SELECT 'sin', a.id, a.nombre, a.codigo_proveedor,
           (a.stock - COALESCE((SELECT SUM(s2.cantidad) FROM stock_bodega s2 WHERE s2.articulo_id = a.id), 0))::int
      FROM articulos a
     WHERE $4::boolean AND a.activo AND ($2::text IS NULL OR $2 = 'sin') AND ($3::text IS NULL OR a.nombre ILIKE $3 OR a.codigo_proveedor ILIKE $3)
       AND (a.stock - COALESCE((SELECT SUM(s2.cantidad) FROM stock_bodega s2 WHERE s2.articulo_id = a.id), 0)) > 0`,
    [ids, bodegaId === null ? null : String(bodegaId), patron, conSinUbicar]);

  const productos = new Map();
  const porColumna = {};
  for (const f of filas) {
    if (!productos.has(f.id)) productos.set(f.id, { id: f.id, nombre: f.nombre, sku: f.sku, total: 0, saldos: {} });
    const pr = productos.get(f.id);
    pr.saldos[f.columna] = f.cantidad;
    pr.total += f.cantidad;
    porColumna[f.columna] = (porColumna[f.columna] || 0) + f.cantidad;
  }
  const columnas = bodegas.filter((b) => !bodegaId || bodegaId === 'sin' ? bodegaId !== 'sin' : b.id === bodegaId)
    .map(({ coordinador_sub: _c, ...b }) => ({ ...b, unidades: porColumna[String(b.id)] || 0 }));
  const sin = conSinUbicar && (!bodegaId || bodegaId === 'sin') ? { id: 'sin', nombre: 'Sin ubicar', tipo: 'sin_ubicar', unidades: porColumna.sin || 0 } : null;
  return {
    ok: true,
    todas: conSinUbicar,
    bodegas: sin ? [...columnas, sin] : columnas,
    opciones: [...bodegas.map((b) => ({ id: b.id, nombre: b.nombre })), ...(conSinUbicar ? [{ id: 'sin', nombre: 'Sin ubicar' }] : [])],
    productos: [...productos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    unidades: filas.reduce((s, f) => s + f.cantidad, 0),
  };
}

const TODAS = 'SELECT id, nombre, tipo, municipio, departamento, region FROM bodegas WHERE activa ORDER BY tipo, lower(nombre)';

// Devuelve los saldos desde la Bitácora según el alcance de la cuenta.
export async function saldosBodegas(usuario, p = {}) {
  if (usuario?.general || usuario?.rol === 'coordinador_compras') return armar(await consulta(TODAS), true, p);
  if (usuario?.rol === 'coordinador' || usuario?.rol === 'tecnico_administrativo') return armar(await bodegasDeTerritorio(usuario), false, p);
  throw prohibido('Tu rol no consulta los saldos por bodega.');
}

// Devuelve los saldos de todas las bodegas desde el inventario.
export async function saldosBodegasInventario(p = {}) {
  return armar(await consulta(TODAS), true, p);
}
