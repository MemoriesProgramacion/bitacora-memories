// Lee columnas de un .xlsx en el navegador sin dependencias. La base maestra pesa unos 16 MB y su hoja up
// descomprimida pasa de 90 MB, así que no se arma el libro completo: se descomprime por flujo con
// DecompressionStream y de cada fila solo se guardan las columnas pedidas, buscadas por el nombre del
// encabezado y no por la letra.
const dec = new TextDecoder();

// Normaliza un encabezado: minúsculas, sin tildes, y espacios y guiones como guion bajo.
export function normalizarEncabezado(txt) {
  return String(txt ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function xmlTexto(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// Lee el índice central del ZIP.
async function indiceZip(file) {
  const cola = Math.min(file.size, 65557);
  const fin = new DataView(await file.slice(file.size - cola).arrayBuffer());
  let eocd = -1;
  for (let i = cola - 22; i >= 0; i--) {
    if (fin.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido.');
  const total = fin.getUint16(eocd + 10, true);
  const tamCentral = fin.getUint32(eocd + 12, true);
  const inicioCentral = fin.getUint32(eocd + 16, true);

  const cen = new DataView(
    await file.slice(inicioCentral, inicioCentral + tamCentral).arrayBuffer(),
  );
  const entradas = new Map();
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (cen.getUint32(p, true) !== 0x02014b50) break;
    const metodo = cen.getUint16(p + 10, true);
    const comprimido = cen.getUint32(p + 20, true);
    const largoNombre = cen.getUint16(p + 28, true);
    const largoExtra = cen.getUint16(p + 30, true);
    const largoComent = cen.getUint16(p + 32, true);
    const offset = cen.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(cen.buffer, cen.byteOffset + p + 46, largoNombre));
    entradas.set(nombre, { metodo, comprimido, offset });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return entradas;
}

// Devuelve el flujo de texto, ya descomprimido, de una entrada del ZIP.
async function flujoEntrada(file, entrada) {
  const cab = new DataView(await file.slice(entrada.offset, entrada.offset + 30).arrayBuffer());
  const inicio = entrada.offset + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
  let flujo = file.slice(inicio, inicio + entrada.comprimido).stream();
  if (entrada.metodo === 8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador no puede leer .xlsx. Usa Chrome, Edge o Firefox actualizados.');
    }
    flujo = flujo.pipeThrough(new DecompressionStream('deflate-raw'));
  } else if (entrada.metodo !== 0) {
    throw new Error('Compresión del .xlsx no soportada.');
  }
  return flujo.pipeThrough(new TextDecoderStream());
}

async function textoEntrada(file, entrada) {
  let s = '';
  const lector = (await flujoEntrada(file, entrada)).getReader();
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    s += value;
  }
  return s;
}

// Devuelve las hojas que contiene el libro.
async function hojasDelLibro(file, zip) {
  const leer = async (ruta) => {
    const e = zip.get(ruta);
    if (!e) throw new Error(`Falta ${ruta} dentro del .xlsx.`);
    return textoEntrada(file, e);
  };
  const libro = await leer('xl/workbook.xml');
  const rels = await leer('xl/_rels/workbook.xml.rels');

  const destinos = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const tgt = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && tgt) destinos[id] = tgt.startsWith('/') ? tgt.slice(1) : `xl/${tgt}`;
  }
  const hojas = [];
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = xmlTexto(/\bname="([^"]*)"/.exec(m[0])?.[1] || '');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    if (rid && destinos[rid]) hojas.push({ nombre, ruta: destinos[rid] });
  }
  return hojas;
}

async function textosCompartidos(file, zip) {
  const e = zip.get('xl/sharedStrings.xml');
  if (!e) return [];
  const xml = await textoEntrada(file, e);
  const lista = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const sin = m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let t = '';
    for (const x of sin.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += x[1];
    lista.push(xmlTexto(t));
  }
  return lista;
}

// Formatos de celda que son fechas: una celda de fecha guarda un número y, sin mirar el estilo, se mandaría ese
// número a la base en vez de la fecha.
const FMT_FECHA_BASE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36,
  45, 46, 47, 50, 57]);

async function estilosFecha(file, zip) {
  const e = zip.get('xl/styles.xml');
  if (!e) return new Set();
  const xml = await textoEntrada(file, e);

  const personalizados = new Map();
  for (const m of xml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1]);
    const code = xmlTexto(/\bformatCode="([^"]*)"/.exec(m[0])?.[1] || '');
    if (!Number.isNaN(id)) personalizados.set(id, code);
  }
  const esFecha = (id) => {
    if (FMT_FECHA_BASE.has(id)) return true;
    const code = personalizados.get(id);
    if (!code) return false;
    const limpio = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    return /[ymdYMD]/.test(limpio) && !/^[^ymdYMD]*$/.test(limpio);
  };

  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const fechas = new Set();
  if (!xfs) return fechas;
  let i = 0;
  for (const m of xfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1] || 0);
    if (esFecha(id)) fechas.add(i);
    i++;
  }
  return fechas;
}

// Convierte una serie de Excel en AAAA-MM-DD, con el sistema 1900 y su error del año bisiesto.
function fechaDeSerie(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Convierte una fracción de día de Excel en HH:MM.
function horaDeSerie(n) {
  const min = Math.round(n * 1440) % 1440;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Devuelve el valor de una celda como texto.
function valorCelda(atributos, interior, compartidos, fechas) {
  if (!interior) return '';
  const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] || 'n';
  if (tipo === 'inlineStr') {
    let t = '';
    for (const x of interior.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += x[1];
    return xmlTexto(t);
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(interior)?.[1];
  if (v === undefined) return '';
  if (tipo === 's') return compartidos[Number(v)] ?? '';
  if (tipo === 'n') {
    const num = Number(v);
    const estilo = Number(/\bs="(\d+)"/.exec(atributos)?.[1] ?? -1);
    if (fechas && fechas.has(estilo) && num > 0) {
      if (num < 1) return horaDeSerie(num);
      const f = fechaDeSerie(num);
      if (f) return f;
    }
    return Number.isInteger(num) ? String(num) : v;
  }
  return xmlTexto(v);
}

const RE_CELDA = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const letraDe = (atributos) => /\br="([A-Z]+)\d+"/.exec(atributos)?.[1];

// Recorre la hoja fila por fila; alFila recibe las celdas de las letras pedidas y el número de la fila, y si
// devuelve false se deja de leer.
async function recorrerHoja(file, entrada, compartidos, fechas, letras, alFila, alAvanzar) {
  const lector = (await flujoEntrada(file, entrada)).getReader();
  const quiere = letras ? new Set(letras) : null;
  const totalAprox = entrada.comprimido * 6;
  let leido = 0;
  let buf = '';
  let numero = 0;
  try {
    for (;;) {
      const { value, done } = await lector.read();
      if (value) { buf += value; leido += value.length; }
      const corte = done ? buf.length : buf.lastIndexOf('</row>') + 6;
      if (corte > 5) {
        const bloque = buf.slice(0, corte);
        buf = buf.slice(corte);
        for (const fila of bloque.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
          numero = Number(/\br="(\d+)"/.exec(fila[1])?.[1]) || numero + 1;
          const celdas = {};
          for (const c of fila[2].matchAll(RE_CELDA)) {
            const letra = letraDe(c[1]);
            if (!letra || (quiere && !quiere.has(letra))) continue;
            celdas[letra] = valorCelda(c[1], c[2], compartidos, fechas);
          }
          if (alFila(celdas, numero) === false) return;
        }
        if (alAvanzar) alAvanzar(Math.min(0.99, leido / totalAprox));
      }
      if (done) break;
    }
  } finally {
    lector.cancel().catch(() => {});
  }
}

// Convierte el encabezado de la primera fila en un mapa de alias a letra; ocurrencia sirve para las hojas que
// repiten un nombre.
function ubicarColumnas(encabezado, columnas) {
  const porNombre = new Map();
  const letras = Object.keys(encabezado).sort(
    (a, b) => (a.length - b.length) || a.localeCompare(b),
  );
  for (const letra of letras) {
    const n = normalizarEncabezado(encabezado[letra]);
    if (!n) continue;
    if (!porNombre.has(n)) porNombre.set(n, []);
    porNombre.get(n).push(letra);
  }
  const out = {};
  for (const col of columnas) {
    const lista = porNombre.get(normalizarEncabezado(col.nombre)) || [];
    const letra = lista[(col.ocurrencia || 1) - 1];
    if (letra) out[col.alias] = letra;
  }
  return out;
}

// Lee las filas pedidas de una hoja del libro, con sus columnas buscadas por nombre.
export async function leerFilasExcel(file, { hojas = [], columnas, alAvanzar, conNumeroFila = false } = {}) {
  const zip = await indiceZip(file);
  const libro = await hojasDelLibro(file, zip);
  const compartidos = await textosCompartidos(file, zip);
  const fechas = await estilosFecha(file, zip);

  const pref = hojas.map(normalizarEncabezado);
  const orden = [
    ...pref.map((p) => libro.find((h) => normalizarEncabezado(h.nombre) === p)).filter(Boolean),
    ...libro.filter((h) => !pref.includes(normalizarEncabezado(h.nombre))),
  ];
  const obligatorias = columnas.filter((c) => !c.opcional).map((c) => c.alias);
  let faltaronEnLaHoja = null;

  for (const hoja of orden) {
    const entrada = zip.get(hoja.ruta);
    if (!entrada) continue;

    let encabezado = null;
    await recorrerHoja(file, entrada, compartidos, fechas, null, (celdas) => {
      encabezado = celdas;
      return false;
    });
    if (!encabezado) continue;
    const letras = ubicarColumnas(encabezado, columnas);
    const faltan = obligatorias.filter((al) => !letras[al]);
    if (faltan.length) {
      if (!faltaronEnLaHoja) faltaronEnLaHoja = { hoja: hoja.nombre, faltan };
      continue;
    }

    const alias = Object.keys(letras);
    const filas = [];
    let primera = true;
    await recorrerHoja(file, entrada, compartidos, fechas, Object.values(letras), (celdas, numero) => {
      if (primera) { primera = false; return; }
      const fila = conNumeroFila ? { _fila: numero } : {};
      let vacia = true;
      for (const a of alias) {
        const v = (celdas[letras[a]] ?? '').trim();
        fila[a] = v;
        if (v) vacia = false;
      }
      if (!vacia) filas.push(fila);
    }, alAvanzar);
    if (alAvanzar) alAvanzar(1);

    return {
      hoja: hoja.nombre,
      letras,
      filas,
      faltantes: columnas.filter((c) => !letras[c.alias]).map((c) => c.alias),
    };
  }

  if (faltaronEnLaHoja) {
    const nombres = faltaronEnLaHoja.faltan
      .map((al) => (columnas.find((c) => c.alias === al) || {}).nombre || al);
    throw new Error(
      `A la hoja "${faltaronEnLaHoja.hoja}" le faltan estas columnas: ${nombres.join(', ')}.`,
    );
  }
  throw new Error(
    `No se encontró una hoja con las columnas ${obligatorias.join(', ')}.`,
  );
}

// Forma corta: lee columnas por nombre, todas obligatorias.
export async function leerColumnasExcel(file, { hojas, columnas, alAvanzar } = {}) {
  const r = await leerFilasExcel(file, {
    hojas,
    columnas: columnas.map((nombre) => ({ alias: nombre, nombre })),
    alAvanzar,
  });
  return { hoja: r.hoja, letras: r.letras, filas: r.filas };
}
