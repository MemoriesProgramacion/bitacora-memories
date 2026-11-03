// Exporta a Excel (.xlsx) sin dependencias. Arma un archivo real en formato Office Open XML empaquetado en un
// ZIP, comprimido cuando el navegador lo permite, y lo descarga: una hoja con descargarExcel o varias con
// descargarLibro. Sirve para tablas planas con encabezado en negrilla, texto, números y colores.
const enc = new TextEncoder();

// Tabla para calcular el CRC32.
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Comprime con DEFLATE usando CompressionStream del navegador; si no existe, guarda sin comprimir.
async function deflar(datos) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([datos]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// Empaqueta los archivos en un ZIP.
async function zip(archivos) {
  const partes = [];
  const central = [];
  let offset = 0;

  for (const { nombre, contenido } of archivos) {
    const nom = enc.encode(nombre);
    const plano = enc.encode(contenido);
    const crc = crc32(plano);
    const comprimido = await deflar(plano);
    const usarDeflate = comprimido && comprimido.length < plano.length;
    const datos = usarDeflate ? comprimido : plano;
    const metodo = usarDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, metodo, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, plano.length, true);
    local.setUint16(26, nom.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nom, datos);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, metodo, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, datos.length, true);
    cen.setUint32(24, plano.length, true);
    cen.setUint16(28, nom.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nom);

    offset += 30 + nom.length + datos.length;
  }

  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Índices de estilo de celda, que se usan en la columna o en celdas con valor y estilo.
export const ESTILO = {
  normal: 0,
  encabezado: 1,
  negrilla: 2,
  porcentaje: 3,
  ok: 4,
  bad: 5,
  warn: 6,
  titulo: 7,
  seccion: 8,
};

// Convierte un tono de etapas.js (ok, bad, warn o neutral) en un estilo de celda.
export function estiloTono(tono) {
  return tono === 'ok' ? ESTILO.ok : tono === 'bad' ? ESTILO.bad
    : tono === 'warn' ? ESTILO.warn : ESTILO.normal;
}

function esc(s) {
  return String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetra(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function celda(ref, v, estilo = 0) {
  if (v && typeof v === 'object' && 'v' in v) { estilo = v.s ?? estilo; v = v.v; }
  const s = estilo ? ` s="${estilo}"` : '';
  if (v === null || v === undefined || v === '') return `<c r="${ref}"${s}/>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function nombreHojaValido(nombre, usados) {
  const base = String(nombre || 'Hoja').replace(/[\\/?*[\]:']/g, ' ').trim().slice(0, 31) || 'Hoja';
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`;
  usados.add(n.toLowerCase());
  return n;
}

// Genera el XML de una hoja a partir de su nombre, columnas, filas, autofiltro y encabezado.
function xmlHoja({ columnas, filas, autofiltro = true, encabezado = true }) {
  const ultima = colLetra(columnas.length - 1);
  const desfase = encabezado ? 1 : 0;

  const cab = encabezado
    ? `<row r="1">${columnas.map((c, i) => celda(`${colLetra(i)}1`, c.titulo, ESTILO.encabezado)).join('')}</row>`
    : '';
  const cuerpo = filas.map((f, r) => {
    const fila = r + 1 + desfase;
    return `<row r="${fila}">${columnas.map((c, i) => {
      const v = c.valor(f);
      const est = c.estilo ? c.estilo(f, v) : 0;
      return celda(`${colLetra(i)}${fila}`, v, est);
    }).join('')}</row>`;
  }).join('');

  const cols = columnas.map((c, i) => (
    `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 16}" customWidth="1"/>`
  )).join('');

  const conFiltro = encabezado && autofiltro && filas.length > 0;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (encabezado
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
    + `<cols>${cols}</cols>`
    + `<sheetData>${cab}${cuerpo}</sheetData>`
    + (conFiltro ? `<autoFilter ref="A1:${ultima}${filas.length + 1}"/>` : '')
    + '</worksheet>';
}

const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="4">'
  +   '<font><sz val="11"/><name val="Calibri"/></font>'
  +   '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  +   '<font><b/><sz val="11"/><color rgb="FF1A1F2E"/><name val="Calibri"/></font>'
  +   '<font><b/><sz val="14"/><color rgb="FF1A1F2E"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="7">'
  +   '<fill><patternFill patternType="none"/></fill>'
  +   '<fill><patternFill patternType="gray125"/></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FF1A1F2E"/><bgColor indexed="64"/></patternFill></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFE3F4EA"/><bgColor indexed="64"/></patternFill></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4E4"/><bgColor indexed="64"/></patternFill></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill>'
  +   '<fill><patternFill patternType="solid"><fgColor rgb="FFF0EDE8"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="9">'
  +   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  +   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  +   '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  +   '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  +   '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>'
  +   '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>'
  +   '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>'
  +   '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  +   '<xf numFmtId="0" fontId="2" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// Crea un libro con varias hojas y devuelve una Promise de Blob.
export function crearLibro(hojas) {
  const usados = new Set();
  const lista = hojas.map((h) => ({ ...h, nombre: nombreHojaValido(h.nombre, usados) }));

  const overrides = lista.map((_, i) => (
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  const sheets = lista.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const nombres = lista.map((h, i) => {
    if (h.encabezado === false || h.autofiltro === false || !h.filas.length) return '';
    const ultima = colLetra(h.columnas.length - 1);
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(h.nombre)}'!$A$1:$${ultima}$${h.filas.length + 1}</definedName>`;
  }).join('');
  const rels = lista.map((_, i) => (
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )).join('');

  const archivos = [
    { nombre: '[Content_Types].xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + overrides
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>' },
    { nombre: '_rels/.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets>${sheets}</sheets>`
      + (nombres ? `<definedNames>${nombres}</definedNames>` : '')
      + '</workbook>' },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rels
      + `<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>' },
    { nombre: 'xl/styles.xml', contenido: ESTILOS_XML },
    ...lista.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: xmlHoja(h) })),
  ];
  return zip(archivos);
}

// Crea un libro de una sola hoja, por compatibilidad.
export function crearExcel(nombreHoja, columnas, filas) {
  return crearLibro([{ nombre: nombreHoja || 'Hoja1', columnas, filas }]);
}

function descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Descarga un Excel de una hoja.
export async function descargarExcel(nombreArchivo, nombreHoja, columnas, filas) {
  descargarBlob(await crearExcel(nombreHoja, columnas, filas), nombreArchivo);
}

// Descarga un Excel con varias hojas.
export async function descargarLibro(nombreArchivo, hojas) {
  descargarBlob(await crearLibro(hojas), nombreArchivo);
}
