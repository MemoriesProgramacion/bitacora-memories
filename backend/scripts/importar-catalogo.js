// Sincroniza el catálogo de productos con la tabla de artículos usando el código de barras como llave: crea los
// nuevos, actualiza nombre y precio de los existentes y deja intactos los que no aparecen en el catálogo. Nunca
// borra ni toca el stock.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { SCHEMA, pool, consulta } from '../src/inventario/db.js'

// Carpeta raíz del repositorio, un nivel arriba de backend.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Expresión que acepta solo caracteres imprimibles, compatibles con el código de barras Code128.
const CODIGO_VALIDO = /^[\x20-\x7E]{1,48}$/

// Da formato de pesos colombianos a un valor, por ejemplo $ 1.250.000.
const pesos = (v) => '$ ' + Math.round(v).toLocaleString('en-US').replace(/,/g, '.')
const centavos = (v) => Math.round(Number(v) * 100) / 100

// Extrae el arreglo JSON que contiene el archivo del catálogo.
function leerCatalogo(ruta) {
  const crudo = fs.readFileSync(ruta, 'utf8')
  const inicio = crudo.indexOf('[')
  const fin = crudo.lastIndexOf(']')
  if (inicio === -1 || fin === -1) throw new Error('No se encontro el arreglo de productos en el archivo.')
  return JSON.parse(crudo.slice(inicio, fin + 1))
}

// Valida y normaliza cada fila; devuelve las filas válidas y las descartadas con su motivo.
function preparar(productos) {
  const filas = []
  const descartados = []
  const vistos = new Set()

  for (const p of productos) {
    const codigo = String(p?.id ?? '').trim()
    const nombre = String(p?.nombre ?? '').trim()

    if (!codigo || !nombre) {
      descartados.push([codigo || '(sin id)', 'sin id o sin nombre'])
      continue
    }
    if (!CODIGO_VALIDO.test(codigo)) {
      descartados.push([codigo, 'el id no sirve como codigo de barras'])
      continue
    }
    if (vistos.has(codigo)) {
      descartados.push([codigo, 'id repetido dentro del archivo'])
      continue
    }

    let precio = Number(p.precio)
    if (!Number.isFinite(precio) || precio < 0) precio = 0

    vistos.add(codigo)
    filas.push({ codigo, nombre, precio: centavos(precio) })
  }
  return { filas, descartados }
}

// Clasifica cada fila como nueva, modificada o sin cambios frente a lo que ya hay en la base.
async function comparar(filas) {
  const actuales = new Map(
    (await consulta('SELECT codigo_barras, nombre, precio FROM articulos')).map((r) => [r.codigo_barras, r]),
  )
  const nuevos = []
  const cambios = []
  let iguales = 0

  for (const f of filas) {
    const viejo = actuales.get(f.codigo)
    if (!viejo) {
      nuevos.push(f)
      continue
    }
    const dif = {}
    if (viejo.nombre !== f.nombre) dif.nombre = [viejo.nombre, f.nombre]
    if (centavos(viejo.precio) !== f.precio) dif.precio = [centavos(viejo.precio), f.precio]
    if (Object.keys(dif).length) cambios.push({ ...f, dif })
    else iguales += 1
  }

  const codigosCatalogo = new Set(filas.map((f) => f.codigo))
  const huerfanos = [...actuales.keys()].filter((c) => !codigosCatalogo.has(c))
  return { nuevos, cambios, iguales, huerfanos }
}

// Flujo principal: lee el catálogo, compara con la base, muestra el resumen y escribe los cambios solo si se
// confirma o no se pidió simulación.
async function main() {
  const args = process.argv.slice(2)
  const si = args.includes('--si')
  const simular = args.includes('--simular')
  const archivo = args.find((a) => !a.startsWith('--')) || 'productos.js'

  let ruta = archivo
  if (!path.isAbsolute(ruta) && !fs.existsSync(ruta)) ruta = path.join(RAIZ, archivo)
  if (!fs.existsSync(ruta)) {
    console.log(`No se encontro el archivo: ${ruta}`)
    return 1
  }

  console.log(`Leyendo ${path.basename(ruta)}...`)
  const { filas, descartados } = preparar(leerCatalogo(ruta))
  console.log(`  ${filas.length} productos validos en el archivo`)
  if (descartados.length) {
    console.log(`  ${descartados.length} descartados:`)
    for (const [c, motivo] of descartados.slice(0, 10)) console.log(`     - ${c}: ${motivo}`)
    if (descartados.length > 10) console.log(`     ... y ${descartados.length - 10} mas`)
  }
  if (!filas.length) {
    console.log('No hay nada que sincronizar.')
    return 1
  }

  console.log('\nComparando con PostgreSQL...')
  await pool.query(SCHEMA)
  const { nuevos, cambios, iguales, huerfanos } = await comparar(filas)

  console.log('\n  RESUMEN')
  console.log('  ----------------------------------------')
  console.log(`  Articulos nuevos por crear : ${nuevos.length}`)
  console.log(`  Articulos por actualizar   : ${cambios.length}`)
  console.log(`  Sin cambios                : ${iguales}`)
  console.log('  En la base pero no en el')
  console.log(`  catalogo (se dejan igual)  : ${huerfanos.length}`)
  console.log('  ----------------------------------------')

  if (nuevos.length) {
    console.log('\n  Ejemplos de articulos nuevos:')
    for (const f of nuevos.slice(0, 5)) {
      console.log(`     + ${f.codigo.padEnd(12)} ${f.nombre.slice(0, 48).padEnd(48)} ${pesos(f.precio)}`)
    }
    if (nuevos.length > 5) console.log(`     ... y ${nuevos.length - 5} mas`)
  }

  if (cambios.length) {
    console.log('\n  Ejemplos de cambios:')
    for (const f of cambios.slice(0, 8)) {
      console.log(`     ~ ${f.codigo}`)
      if (f.dif.nombre) {
        console.log(`         nombre: ${f.dif.nombre[0].slice(0, 42)}`)
        console.log(`              -> ${f.dif.nombre[1].slice(0, 42)}`)
      }
      if (f.dif.precio) console.log(`         precio: ${pesos(f.dif.precio[0])} -> ${pesos(f.dif.precio[1])}`)
    }
    if (cambios.length > 8) console.log(`     ... y ${cambios.length - 8} cambios mas`)
  }

  if (huerfanos.length) {
    console.log('\n  Estos articulos estan en la base pero ya no en el catalogo.')
    console.log('  NO se borran: pueden tener stock, estar en un Kit UP o en')
    console.log('  ordenes ya entregadas. Revisalos tu si quieres darlos de baja:')
    for (const c of huerfanos.slice(0, 10)) console.log(`     ? ${c}`)
    if (huerfanos.length > 10) console.log(`     ... y ${huerfanos.length - 10} mas`)
  }

  if (!nuevos.length && !cambios.length) {
    console.log('\nLa base ya esta al dia. No hay nada que hacer.')
    return 0
  }

  if (simular) {
    console.log('\n(--simular) No se escribio nada en la base de datos.')
    return 0
  }

  console.log('\n  Se conservan intactos: stock, stock minimo, proveedor,')
  console.log('  Kit UP, movimientos y ordenes de entrega.')
  if (!si) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const resp = await rl.question('\n  Escribe SI para aplicar estos cambios: ')
    rl.close()
    if (resp.trim().toUpperCase() !== 'SI') {
      console.log('Cancelado. No se toco nada.')
      return 1
    }
  }

  await pool.query(
    `INSERT INTO articulos (nombre, codigo_barras, precio, stock, minimo)
     SELECT n, c, p, 0, 0
     FROM unnest($1::text[], $2::text[], $3::numeric[]) AS x(n, c, p)
     ON CONFLICT (codigo_barras) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           precio = EXCLUDED.precio`,
    [filas.map((f) => f.nombre), filas.map((f) => f.codigo), filas.map((f) => f.precio)],
  )
  const [{ c: total }] = await consulta('SELECT COUNT(*) AS c FROM articulos')

  console.log('\nListo.')
  console.log(`  ${nuevos.length} creados, ${cambios.length} actualizados.`)
  console.log(`  ${total} articulos en la base en total.`)
  if (nuevos.length) console.log('  Los nuevos entraron con stock 0: cargalos desde Recepcion.')
  return 0
}

main()
  .then((codigo) => pool.end().finally(() => process.exit(codigo)))
  .catch(async (e) => {
    console.error(e.message || e)
    await pool.end().catch(() => {})
    process.exit(1)
  })
