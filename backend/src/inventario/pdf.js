// Generación de los PDF del inventario (órdenes de entrega y de pedido) con pdfkit. Dibuja tablas con cabecera
// repetida entre páginas, firmas al pie y totales.
import PDFDocument from 'pdfkit'
import { config } from '../config.js'
import { fmtFecha, pesos } from './util.js'

// Convierte milímetros a puntos, que es la unidad de pdfkit.
const mm = (v) => (v * 72) / 25.4

// Paleta de colores del documento.
const COLOR = {
  texto: '#000000',
  blanco: '#ffffff',
  oscuro: '#3D3A78',
  oscuro2: '#4A4690',
  gris: '#8E8AA6',
  borde: '#E2DEEC',
  borde2: '#ECE9F3',
  crema: '#F8F6FB',
  crema2: '#F6F4FA',
  totales: '#F4F2F8',
  subtotal: '#FDF3EA',
}

// Crea un documento PDF tamaño A4 con los márgenes y el título indicados.
function nuevoDocumento({ margenV, margenH, titulo }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: mm(margenV), bottom: mm(margenV), left: mm(margenH), right: mm(margenH) },
    info: titulo ? { Title: titulo } : {},
  })
  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const listo = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  return { doc, listo }
}

const maxY = (doc) => doc.page.height - doc.page.margins.bottom
const anchoUtil = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right

// Pasa a una nueva página si la altura pedida no cabe en lo que queda.
function asegurar(doc, altura) {
  if (doc.y + altura > maxY(doc)) doc.addPage()
}

const fuente = (negrita) => (negrita ? 'Helvetica-Bold' : 'Helvetica')

// Define una celda con una o varias líneas de texto y su estilo.
function celda(texto, opc = {}) {
  const partes = Array.isArray(texto) ? texto : [{ t: texto, ...opc }]
  return {
    partes: partes.map((p) => ({ tam: 8, ...p, t: p.t === null || p.t === undefined ? '' : String(p.t) })),
    alinear: opc.alinear || 'left',
    span: opc.span || 1,
    fondo: opc.fondo,
  }
}

// Calcula el alto que necesita el texto de una celda para un ancho dado.
function alturaCelda(doc, c, ancho) {
  let h = 0
  for (const p of c.partes) {
    if (!p.t) continue
    doc.font(fuente(p.negrita)).fontSize(p.tam)
    h += doc.heightOfString(p.t, { width: ancho })
  }
  return h
}

// Escribe el texto de la celda centrado en vertical dentro de su caja.
function dibujarCelda(doc, c, x, y, ancho, alto, padH, color) {
  const w = ancho - 2 * padH
  let yy = y + (alto - alturaCelda(doc, c, w)) / 2
  for (const p of c.partes) {
    if (!p.t) continue
    doc.font(fuente(p.negrita)).fontSize(p.tam)
    const h = doc.heightOfString(p.t, { width: w })
    doc.fillColor(p.color || color || COLOR.texto)
      .text(p.t, x + padH, yy, { width: w, height: h + 4, align: c.alinear })
    yy += h
  }
}

const suma = (arr, desde, n) => arr.slice(desde, desde + n).reduce((a, b) => a + b, 0)

// Calcula la altura de una fila como la de su celda más alta.
function alturaFila(doc, fila, anchos, padH, padV) {
  let max = 0
  let i = 0
  for (const c of fila) {
    max = Math.max(max, alturaCelda(doc, c, suma(anchos, i, c.span) - 2 * padH))
    i += c.span
  }
  return max + 2 * padV
}

// Dibuja una tabla cuya primera fila es la cabecera y se repite en cada página.
function dibujarTabla(doc, filas, o) {
  const padH = o.padH ?? 6
  const padV = o.padV ?? 3
  const x0 = o.x ?? doc.page.margins.left
  const anchos = o.anchos
  const total = suma(anchos, 0, anchos.length)

  const fila = (f, idx) => {
    const h = alturaFila(doc, f, anchos, padH, padV)
    const ult = idx === filas.length - 1
    const y = doc.y
    let x = x0
    let i = 0
    for (const c of f) {
      const w = suma(anchos, i, c.span)
      let fondo = c.fondo
      if (!fondo) {
        if (o.cabecera && idx === 0) fondo = o.fondoCab
        else if (o.fondoUltima && ult) fondo = o.fondoUltima
        else if (o.fondoFilas) fondo = o.fondoFilas[(idx - (o.cabecera ? 1 : 0)) % o.fondoFilas.length]
        else if (o.fondoTodo) fondo = o.fondoTodo
      }
      if (fondo) doc.rect(x, y, w, h).fill(fondo)
      const colorTxt = o.cabecera && idx === 0 ? COLOR.blanco : o.colorTexto
      dibujarCelda(doc, c, x, y, w, h, padH, colorTxt)
      if (o.rejilla) {
        doc.lineWidth(o.rejilla).rect(x, y, w, h).stroke(o.interior || o.borde || COLOR.borde)
      }
      x += w
      i += c.span
    }
    doc.y = y + h
  }

  const inicioPagina = doc.page
  const inicioY = doc.y
  filas.forEach((f, idx) => {
    if (doc.y + alturaFila(doc, f, anchos, padH, padV) > maxY(doc)) {
      doc.addPage()
      if (o.cabecera && idx > 0) fila(filas[0], 0)
    }
    fila(f, idx)
  })
  if (o.marco && doc.page === inicioPagina) {
    doc.lineWidth(o.marco).rect(x0, inicioY, total, doc.y - inicioY).stroke(o.borde || COLOR.borde)
  }
}

// Calcula la altura total de una tabla para mantener un bloque junto.
function alturaTabla(doc, filas, o) {
  return filas.reduce(
    (a, f) => a + alturaFila(doc, f, o.anchos, o.padH ?? 6, o.padV ?? 3), 0)
}

// Escribe un párrafo de una o varias líneas a todo el ancho útil.
function parrafo(doc, t, { tam = 10, negrita = false, color = COLOR.texto, antes = 0, despues = 0, align = 'left' } = {}) {
  doc.font(fuente(negrita)).fontSize(tam)
  const w = anchoUtil(doc)
  const h = doc.heightOfString(t, { width: w })
  asegurar(doc, antes + h)
  const y = doc.y + antes
  doc.fillColor(color).text(t, doc.page.margins.left, y, { width: w, height: h + 4, align })
  doc.y = y + h + despues
}

// Baja el cursor un trecho en blanco.
const espacio = (doc, h) => {
  doc.y += h
}

// Anchos de columna del pedido y de cada kit de la orden de entrega.
const COLS_PEDIDO = [24, 62, 36, 14, 22, 22].map(mm)
const COLS_KIT = [26, 68, 20, 28, 28].map(mm)
const COLS_KIT_SIN_VALORES = [34, 106, 30].map(mm)

// Genera el PDF de una orden de pedido (lote).
export async function pdfPedido(lote, resumen, grupos, totales) {
  const { doc, listo } = nuevoDocumento({
    margenV: 16, margenH: 15, titulo: `Orden de pedido - ${lote.nombre}`,
  })

  dibujarTabla(doc, [[
    celda(config.empresa, { negrita: true, tam: 20, alinear: 'center' }),
    celda([{ t: 'ORDEN DE PEDIDO', tam: 10 }, { t: lote.nombre, tam: 10, negrita: true }],
      { alinear: 'right' }),
  ]], { anchos: [mm(100), mm(80)] })
  parrafo(doc, `Generado: ${fmtFecha(lote.creado)}`, { color: COLOR.gris })
  espacio(doc, 10)

  const caja = (n, texto) => celda(
    [{ t: n, negrita: true, tam: 8.5 }, { t: texto, tam: 8.5 }], { alinear: 'center' })
  dibujarTabla(doc, [[
    caja(totales.unidades, 'unidades productivas'),
    caja(totales.codigos, 'codigos distintos'),
    caja(totales.cantidad, 'unidades totales'),
    caja(pesos(totales.valor), 'valor total'),
  ]], {
    anchos: [45, 45, 45, 45].map(mm), padV: 8, fondoTodo: COLOR.totales,
    rejilla: 0.5, borde: COLOR.borde,
  })
  espacio(doc, 14)

  parrafo(doc, 'Resumen general (agrupado por codigo)',
    { tam: 12, negrita: true, color: COLOR.oscuro, antes: 10, despues: 4 })
  const cab = ['Codigo', 'Articulo', 'Tipo', 'Cant.', 'Precio', 'Subtotal']
  const filaCab = (fondo) => cab.map((t, i) => celda(t, { negrita: true, alinear: i >= 3 ? 'right' : 'left', fondo }))
  const filaDatos = (codigo, nombre, tipo, cant, precio, subtotal) => [
    celda(codigo || '-'),
    celda(nombre || '', { tam: 8.5 }),
    celda(tipo || '', { tam: 8.5 }),
    celda(String(Math.trunc(cant || 0)), { alinear: 'right' }),
    celda(pesos(precio), { alinear: 'right' }),
    celda(pesos(subtotal), { alinear: 'right' }),
  ]
  dibujarTabla(doc, [
    filaCab(),
    ...resumen.map((r) => filaDatos(r.codigo, r.nombre, r.tipo, r.cantidad, r.precio, r.subtotal)),
  ], {
    anchos: COLS_PEDIDO, cabecera: true, fondoCab: COLOR.oscuro,
    fondoFilas: [COLOR.blanco, COLOR.crema], rejilla: 0.4, borde: COLOR.borde,
  })
  doc.addPage()

  parrafo(doc, 'Desglose por unidad productiva',
    { tam: 12, negrita: true, color: COLOR.oscuro, antes: 10, despues: 4 })
  espacio(doc, 4)
  for (const g of grupos) {
    const filas = [
      filaCab(),
      ...g.items.map((it) => filaDatos(it.codigo, it.nombre, it.tipo, it.cantidad, it.precio, it.subtotal)),
      [
        celda('', { span: 4 }),
        celda('Subtotal UP', { negrita: true, alinear: 'right' }),
        celda(pesos(g.subtotal), { negrita: true, alinear: 'right' }),
      ],
    ]
    const opciones = {
      anchos: COLS_PEDIDO, cabecera: true, fondoCab: COLOR.oscuro2,
      fondoFilas: [COLOR.blanco, COLOR.crema], fondoUltima: COLOR.subtotal,
      rejilla: 0.4, borde: COLOR.borde,
    }
    const altoTitulo = 12 * 1.2 + 10 + 4
    const alto = altoTitulo + alturaTabla(doc, filas, opciones) + 10
    if (g.items.length <= 12) asegurar(doc, alto)
    else asegurar(doc, altoTitulo + alturaTabla(doc, filas.slice(0, 3), opciones))
    parrafo(doc, `UP_${g.num_documento}`,
      { tam: 12, negrita: true, color: COLOR.oscuro, antes: 10, despues: 4 })
    dibujarTabla(doc, filas, opciones)
    espacio(doc, 10)
  }

  doc.end()
  return listo
}

// Genera el PDF de una orden de entrega con los artículos de cada kit, sus valores y las firmas.
export async function pdfOrden(orden, items, componentesDe, { conValores = true } = {}) {
  const { doc, listo } = nuevoDocumento({ margenV: 18, margenH: 18 })

  dibujarTabla(doc, [[
    celda(config.empresa, { negrita: true, tam: 20, alinear: 'center' }),
    celda([{ t: 'ORDEN DE ENTREGA', tam: 10 }, { t: orden.numero, tam: 10, negrita: true }],
      { alinear: 'right' }),
  ]], { anchos: [mm(95), mm(75)] })
  espacio(doc, 6)
  parrafo(doc, 'Sistema de inventario y bodega', { color: COLOR.gris })
  espacio(doc, 12)

  const dato = (etiqueta, valor) => [
    celda(etiqueta, { negrita: true, tam: 10, fondo: COLOR.crema2 }),
    celda(valor, { tam: 10 }),
  ]
  dibujarTabla(doc, [
    dato('Destino / Cliente:', orden.destino || '-'),
    dato('Fecha:', fmtFecha(orden.fecha)),
    dato('Estado:', String(orden.estado || '').toUpperCase()),
  ], {
    anchos: [mm(40), mm(130)], padH: 6, padV: 6, rejilla: 0.5, interior: COLOR.borde2,
    marco: 0.5, borde: COLOR.borde,
  })
  espacio(doc, 16)

  let totalGeneral = 0
  let totalArticulos = 0
  for (const it of items) {
    const comp = await componentesDe(it.ref_id, it.cantidad)
    const subtotalKit = comp.reduce((a, c) => a + c.subtotal, 0)
    totalGeneral += subtotalKit
    totalArticulos += comp.reduce((a, c) => a + c.cantidad, 0)

    const filasCab = [[
      celda(it.nombre, { negrita: true, tam: 10, color: COLOR.blanco }),
      celda([{ t: `Cod: ${it.codigo_barras}  •  Cantidad: ${it.cantidad}`, tam: 10, color: COLOR.blanco }],
        { alinear: 'right' }),
    ]]
    const opCab = { anchos: [mm(105), mm(65)], padH: 8, padV: 6, fondoTodo: COLOR.oscuro }

    const titulos = conValores ? ['Codigo', 'Articulo', 'Cantidad', 'Precio unit.', 'Subtotal'] : ['Codigo', 'Articulo', 'Cantidad']
    const encabezado = titulos.map((t, i) =>
      celda(t, { negrita: true, tam: 8.5, alinear: i === 2 ? 'center' : i >= 3 ? 'right' : 'left' }))
    const filas = [encabezado]
    if (comp.length) {
      for (const c of comp) {
        filas.push([
          celda(c.codigo, { tam: 8.5 }),
          celda(c.nombre, { tam: 8.5 }),
          celda(String(c.cantidad), { tam: 8.5, alinear: 'center' }),
          ...(conValores ? [
            celda(pesos(c.precio), { tam: 8.5, alinear: 'right' }),
            celda(pesos(c.subtotal), { tam: 8.5, alinear: 'right' }),
          ] : []),
        ])
      }
      if (conValores) {
        filas.push([
          celda('', { span: 3 }),
          celda('Subtotal del kit', { tam: 8.5, negrita: true, alinear: 'right' }),
          celda(pesos(subtotalKit), { tam: 8.5, negrita: true, alinear: 'right' }),
        ])
      }
    } else {
      filas.push([
        celda(''),
        celda('Este kit no tiene articulos registrados.', { tam: 8.5, alinear: 'left' }),
        ...(conValores ? [celda(''), celda(''), celda('')] : [celda('')]),
      ])
    }
    const opTabla = {
      anchos: conValores ? COLS_KIT : COLS_KIT_SIN_VALORES, padV: 4, cabecera: true, fondoCab: COLOR.oscuro2,
      fondoFilas: [COLOR.blanco, COLOR.crema2], rejilla: 0.4, borde: COLOR.borde,
      fondoUltima: comp.length && conValores ? COLOR.subtotal : undefined,
    }

    const alto = alturaTabla(doc, filasCab, opCab) + alturaTabla(doc, filas, opTabla) + 12
    if (comp.length <= 10) asegurar(doc, alto)
    else asegurar(doc, alturaTabla(doc, filasCab, opCab) + alturaTabla(doc, filas.slice(0, 3), opTabla))
    dibujarTabla(doc, filasCab, opCab)
    dibujarTabla(doc, filas, opTabla)
    espacio(doc, 12)
  }

  const filaTotal = [conValores ? [
    celda('TOTAL DE LA ORDEN', { negrita: true, tam: 10, color: COLOR.blanco }),
    celda(`${totalArticulos} articulos`, { negrita: true, tam: 10, alinear: 'right', color: COLOR.blanco }),
    celda(pesos(totalGeneral), { negrita: true, tam: 10, alinear: 'right', color: COLOR.blanco }),
  ] : [
    celda('TOTAL DE ARTICULOS', { negrita: true, tam: 10, color: COLOR.blanco }),
    celda(`${totalArticulos} articulos`, { negrita: true, tam: 10, alinear: 'right', color: COLOR.blanco }),
  ]]
  const opTotal = { anchos: conValores ? [mm(90), mm(45), mm(35)] : [mm(110), mm(60)], padH: 10, padV: 8, fondoTodo: COLOR.oscuro }
  asegurar(doc, alturaTabla(doc, filaTotal, opTotal) + 10)
  dibujarTabla(doc, filaTotal, opTotal)
  espacio(doc, 10)

  if (orden.observaciones) {
    parrafo(doc, `Observaciones: ${orden.observaciones}`, { despues: 24 })
  } else {
    espacio(doc, 30)
  }

  const filasFirmas = [
    [celda('_____________________________', { tam: 10, alinear: 'center' }),
      celda('_____________________________', { tam: 10, alinear: 'center' })],
    [celda('Entregado por', { tam: 9, alinear: 'center', color: COLOR.gris }),
      celda('Recibido por', { tam: 9, alinear: 'center', color: COLOR.gris })],
  ]
  const opFirmas = { anchos: [mm(85), mm(85)] }
  asegurar(doc, alturaTabla(doc, filasFirmas, opFirmas))
  dibujarTabla(doc, filasFirmas, opFirmas)

  doc.end()
  return listo
}
