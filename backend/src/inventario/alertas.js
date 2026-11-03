// Alertas de stock del inventario. Clasifica cada artículo según el mínimo configurado y según el ritmo de
// consumo de los últimos 30 días, y lo deja en el nivel más grave que cumpla.
import { consulta } from './db.js'

// Cantidad de días hacia atrás con los que se mide el consumo.
export const VENTANA_DIAS = 30
// Días de existencias restantes que definen cada nivel de alerta.
const DIAS_CRITICO = 7
const DIAS_BAJO = 15
const DIAS_ATENCION = 30

export const NIVELES = ['agotado', 'critico', 'bajo', 'atencion']

// Devuelve el nivel de alerta de un artículo, o null si está bien.
export function clasificar({ stock, minimo, salidas, tuvoMovimientos }) {
  const diario = salidas / VENTANA_DIAS
  const dias = diario > 0 ? stock / diario : null

  let nivel = null
  if (stock === 0) {
    if (minimo > 0 || tuvoMovimientos) nivel = 'agotado'
  } else if ((minimo > 0 && stock <= minimo / 2) || (dias !== null && dias <= DIAS_CRITICO)) {
    nivel = 'critico'
  } else if ((minimo > 0 && stock <= minimo) || (dias !== null && dias <= DIAS_BAJO)) {
    nivel = 'bajo'
  } else if (dias !== null && dias <= DIAS_ATENCION) {
    nivel = 'atencion'
  }
  return { nivel, diario, dias }
}

// Genera las frases que explican por qué salta la alerta.
function motivos({ nivel, stock, minimo, dias }) {
  if (nivel === 'agotado') return ['Agotado']
  const lista = []
  if (minimo > 0 && stock <= minimo) lista.push(`Quedan ${stock} y el mínimo es ${minimo}`)
  if (dias !== null && dias <= DIAS_ATENCION) {
    lista.push(`Al ritmo actual dura unos ${Math.max(1, Math.round(dias))} día(s)`)
  }
  return lista
}

// Calcula cuánto conviene pedir: lo que falta para tener el doble del mínimo o cubrir 30 días de consumo.
function sugerido({ stock, minimo, diario }) {
  const objetivo = Math.max(minimo * 2, Math.ceil(diario * VENTANA_DIAS))
  const faltan = objetivo - stock
  return faltan > 0 ? faltan : null
}

const ORDEN = Object.fromEntries(NIVELES.map((n, i) => [n, i]))

// Devuelve todas las alertas ordenadas de la más urgente a la menos urgente, con resumen por nivel y los kits
// que no se pueden armar.
export async function calcularAlertas() {
  const filas = await consulta(
    `SELECT a.id, a.nombre, a.codigo_barras, a.stock, a.minimo, a.precio::float AS precio,
            COALESCE(p.nombre, 'Sin proveedor') AS proveedor,
            COALESCE(c.salidas, 0)::float AS salidas,
            EXISTS (SELECT 1 FROM movimientos m WHERE m.articulo_id = a.id) AS tuvo_movimientos
       FROM articulos a
       LEFT JOIN proveedores p ON p.id = a.proveedor_id
       LEFT JOIN (
         SELECT articulo_id, SUM(cantidad) AS salidas
           FROM movimientos
          WHERE tipo = 'salida' AND fecha >= now() - make_interval(days => $1)
          GROUP BY articulo_id
       ) c ON c.articulo_id = a.id
      WHERE a.activo`,
    [VENTANA_DIAS],
  )

  const alertas = []
  for (const f of filas) {
    const { nivel, diario, dias } = clasificar({
      stock: f.stock, minimo: f.minimo, salidas: f.salidas, tuvoMovimientos: f.tuvo_movimientos,
    })
    if (!nivel) continue
    const pedir = sugerido({ stock: f.stock, minimo: f.minimo, diario })
    alertas.push({
      id: f.id,
      nombre: f.nombre,
      codigo_barras: f.codigo_barras,
      proveedor: f.proveedor,
      stock: f.stock,
      minimo: f.minimo,
      nivel,
      consumo_diario: Math.round(diario * 10) / 10,
      dias_restantes: dias === null ? null : Math.round(dias * 10) / 10,
      motivos: motivos({ nivel, stock: f.stock, minimo: f.minimo, dias }),
      sugerido: pedir,
      valor_reponer: pedir ? Math.round(pedir * f.precio) : null,
    })
  }

  alertas.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel]
    || (a.dias_restantes ?? Infinity) - (b.dias_restantes ?? Infinity)
    || (a.minimo ? a.stock / a.minimo : 1) - (b.minimo ? b.stock / b.minimo : 1))

  const resumen = { total: alertas.length }
  for (const n of NIVELES) resumen[n] = alertas.filter((a) => a.nivel === n).length

  return { resumen, alertas, kits_bloqueados: await kitsBloqueados() }
}

// Lista los kits sin armar a los que les falta algún artículo, indicando qué falta.
async function kitsBloqueados() {
  const filas = await consulta(
    `SELECT c.id, c.nombre, a.nombre AS articulo, ci.cantidad AS requiere, a.stock,
            (ci.cantidad - a.stock) AS faltan
       FROM combos c
       JOIN combo_items ci ON ci.combo_id = c.id
       JOIN articulos a ON a.id = ci.articulo_id
      WHERE NOT c.armado AND a.stock < ci.cantidad
      ORDER BY c.nombre, faltan DESC`,
  )
  const porKit = new Map()
  for (const f of filas) {
    if (!porKit.has(f.id)) porKit.set(f.id, { id: f.id, nombre: f.nombre, faltantes: [] })
    porKit.get(f.id).faltantes.push({
      articulo: f.articulo, requiere: f.requiere, stock: f.stock, faltan: f.faltan,
    })
  }
  return [...porKit.values()].slice(0, 30)
}
