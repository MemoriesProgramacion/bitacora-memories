import { describe, it, expect } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { normalizarEncabezado, leerFilasExcel, leerColumnasExcel } from '../src/lib/leerExcel';

// ------------------------------------------------------------------
// Un .xlsx mínimo armado en memoria: ZIP con workbook, rels, estilos,
// textos compartidos y las hojas. Así se prueba el lector real sin
// guardar archivos de Excel en el repo.
// ------------------------------------------------------------------
function zip(archivos, { comprimir = true } = {}) {
  const enc = new TextEncoder();
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const nom = enc.encode(nombre);
    const crudo = enc.encode(contenido);
    const datos = comprimir ? deflateRawSync(crudo) : crudo;
    const metodo = comprimir ? 8 : 0;
    const crc = crc32(crudo);

    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(8, metodo, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, datos.length, true);
    loc.setUint32(22, crudo.length, true);
    loc.setUint16(26, nom.length, true);
    locales.push(new Uint8Array(loc.buffer), nom, datos);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(10, metodo, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, datos.length, true);
    cen.setUint32(24, crudo.length, true);
    cen.setUint16(28, nom.length, true);
    cen.setUint32(42, offset, true);
    centrales.push(new Uint8Array(cen.buffer), nom);

    offset += 30 + nom.length + datos.length;
  }
  const tamCentral = centrales.reduce((s, b) => s + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, Object.keys(archivos).length, true);
  fin.setUint16(10, Object.keys(archivos).length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);
  return new Blob([...locales, ...centrales, new Uint8Array(fin.buffer)]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// filas: [[valor, ...], ...]. Un valor puede ser texto (va a textos
// compartidos), número, null (celda vacía) o { v, s } con estilo.
function hoja(filas, compartidos) {
  const xml = filas.map((fila, i) => {
    const r = i + 1;
    const celdas = fila.map((val, j) => {
      const ref = `${String.fromCharCode(65 + j)}${r}`;
      if (val === null) return '';
      if (typeof val === 'object') return `<c r="${ref}" s="${val.s}"><v>${val.v}</v></c>`;
      if (typeof val === 'number') return `<c r="${ref}"><v>${val}</v></c>`;
      if (val.startsWith('inline:')) {
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(val.slice(7))}</t></is></c>`;
      }
      let k = compartidos.indexOf(val);
      if (k < 0) { compartidos.push(val); k = compartidos.length - 1; }
      return `<c r="${ref}" t="s"><v>${k}</v></c>`;
    }).join('');
    return `<row r="${r}">${celdas}</row>`;
  }).join('');
  return `<worksheet><sheetData>${xml}</sheetData></worksheet>`;
}

// hojas: { nombre: filas }.
// Estilos: s="1" es fecha (numFmtId 14), s="2" es una hora (h:mm).
function libro(hojas, opciones) {
  const compartidos = [];
  const archivos = {};
  const nombres = Object.keys(hojas);
  nombres.forEach((nombre, i) => {
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = hoja(hojas[nombre], compartidos);
  });
  archivos['xl/workbook.xml'] = `<workbook><sheets>${nombres.map((n, i) =>
    `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  archivos['xl/_rels/workbook.xml.rels'] = `<Relationships>${nombres.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`;
  archivos['xl/styles.xml'] = '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="h:mm"/></numFmts>'
    + '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';
  archivos['xl/sharedStrings.xml'] = `<sst>${compartidos.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`;
  return zip(archivos, opciones);
}

const col = (alias, nombre = alias, extra = {}) => ({ alias, nombre, ...extra });

describe('normalizarEncabezado', () => {
  it('minúsculas, sin tildes y con espacios o guiones como "_"', () => {
    expect(normalizarEncabezado('ESTADO_DOCUMENTACIÓN')).toBe('estado_documentacion');
    expect(normalizarEncabezado('  Descripción general ')).toBe('descripcion_general');
    expect(normalizarEncabezado('Gestor-Nodo  zona')).toBe('gestor_nodo_zona');
  });

  it('vacío o nulo da texto vacío', () => {
    expect(normalizarEncabezado(null)).toBe('');
    expect(normalizarEncabezado(undefined)).toBe('');
    expect(normalizarEncabezado('   ')).toBe('');
  });
});

describe('leerFilasExcel', () => {
  it('ubica las columnas por nombre, no por letra', async () => {
    const file = libro({
      up: [
        ['nombre', 'otra', 'ID_unico'],
        ['Ana', 'x', 7],
        ['Luis', 'y', 8],
      ],
    });
    const r = await leerFilasExcel(file, {
      hojas: ['up'],
      columnas: [col('id_unico', 'ID_unico'), col('nombre')],
    });
    expect(r.hoja).toBe('up');
    expect(r.letras).toEqual({ id_unico: 'C', nombre: 'A' });
    expect(r.filas).toEqual([
      { id_unico: '7', nombre: 'Ana' },
      { id_unico: '8', nombre: 'Luis' },
    ]);
  });

  it('con conNumeroFila cada fila trae su número en el Excel, también tras una fila vacía', async () => {
    const file = libro({ RIT: [['cedula', 'nombre'], ['1001', 'Ana'], [null, null], ['1003', 'Luis']] });
    const r = await leerFilasExcel(file, {
      columnas: [col('cedula'), col('nombre')], conNumeroFila: true,
    });
    expect(r.filas).toEqual([
      { _fila: 2, cedula: '1001', nombre: 'Ana' },
      { _fila: 4, cedula: '1003', nombre: 'Luis' },
    ]);
  });

  it('el encabezado se reconoce aunque cambien tildes, mayúsculas o espacios', async () => {
    const file = libro({ up: [['id unico', 'DESCRIPCION GENERAL'], [1, 'Silla']] });
    const r = await leerFilasExcel(file, {
      columnas: [col('id', 'ID_unico'), col('desc', 'Descripción general')],
    });
    expect(r.filas).toEqual([{ id: '1', desc: 'Silla' }]);
  });

  it('lee textos compartidos, textos en línea y entidades XML', async () => {
    const file = libro({ up: [['id', 'texto'], [1, 'A & B <C>'], [2, 'inline:Dato "en línea"']] });
    const r = await leerFilasExcel(file, { columnas: [col('id'), col('texto')] });
    expect(r.filas.map((f) => f.texto)).toEqual(['A & B <C>', 'Dato "en línea"']);
  });

  it('las celdas con formato de fecha salen como AAAA-MM-DD y las horas como HH:MM', async () => {
    const file = libro({
      up: [
        ['id', 'fecha', 'hora', 'numero'],
        [1, { v: 46302, s: 1 }, { v: 0.5, s: 2 }, 46302],
        [2, { v: 46302.75, s: 1 }, { v: 0.395833333, s: 2 }, 3.5],
      ],
    });
    const r = await leerFilasExcel(file, {
      columnas: [col('id'), col('fecha'), col('hora'), col('numero')],
    });
    expect(r.filas).toEqual([
      { id: '1', fecha: '2026-10-07', hora: '12:00', numero: '46302' },
      { id: '2', fecha: '2026-10-07', hora: '09:30', numero: '3.5' },
    ]);
  });

  it('omite las filas vacías y recorta espacios', async () => {
    const file = libro({ up: [['id', 'nombre'], [1, '  Ana  '], [null, null], ['   ', null], [2, 'Luis']] });
    const r = await leerFilasExcel(file, { columnas: [col('id'), col('nombre')] });
    expect(r.filas).toEqual([{ id: '1', nombre: 'Ana' }, { id: '2', nombre: 'Luis' }]);
  });

  it('las celdas que faltan en una fila salen como texto vacío', async () => {
    const file = libro({ up: [['id', 'nombre', 'nodo'], [1, null, 'NODO1']] });
    const r = await leerFilasExcel(file, { columnas: [col('id'), col('nombre'), col('nodo')] });
    expect(r.filas).toEqual([{ id: '1', nombre: '', nodo: 'NODO1' }]);
  });

  it('ocurrencia elige el segundo encabezado repetido', async () => {
    const file = libro({ up: [['id', 'observaciones', 'observaciones'], [1, 'primera', 'segunda']] });
    const r = await leerFilasExcel(file, {
      columnas: [col('id'), col('obs1', 'observaciones'), col('obs2', 'observaciones', { ocurrencia: 2 })],
    });
    expect(r.filas).toEqual([{ id: '1', obs1: 'primera', obs2: 'segunda' }]);
  });

  it('una columna opcional que no está va en faltantes', async () => {
    const file = libro({ up: [['id'], [1]] });
    const r = await leerFilasExcel(file, {
      columnas: [col('id'), col('docs', 'documentos', { opcional: true })],
    });
    expect(r.faltantes).toEqual(['docs']);
    expect(r.filas).toEqual([{ id: '1' }]);
  });

  it('prefiere la hoja pedida y, si no está, busca en las demás', async () => {
    const file = libro({
      otra: [['id', 'nombre'], [9, 'otra']],
      'UP ': [['id', 'nombre'], [1, 'preferida']],
    });
    const r = await leerFilasExcel(file, { hojas: ['up'], columnas: [col('id'), col('nombre')] });
    expect(r.hoja).toBe('UP ');

    const renombrada = libro({ resumen: [['total'], [3]], datos: [['id', 'nombre'], [1, 'Ana']] });
    const r2 = await leerFilasExcel(renombrada, { hojas: ['up'], columnas: [col('id'), col('nombre')] });
    expect(r2.hoja).toBe('datos');
  });

  it('si falta una columna obligatoria, dice cuál y en qué hoja', async () => {
    const file = libro({ up: [['id', 'otra'], [1, 'x']] });
    await expect(leerFilasExcel(file, {
      hojas: ['up'],
      columnas: [col('id'), col('estado', 'ESTADO_ENTREGA')],
    })).rejects.toThrow('A la hoja "up" le faltan estas columnas: ESTADO_ENTREGA.');
  });

  it('un archivo que no es .xlsx da un error claro', async () => {
    const file = new Blob(['esto no es un zip']);
    await expect(leerFilasExcel(file, { columnas: [col('id')] }))
      .rejects.toThrow('El archivo no es un .xlsx válido.');
  });

  it('también lee un .xlsx sin compresión', async () => {
    const file = libro({ up: [['id', 'nombre'], [1, 'Ana']] }, { comprimir: false });
    const r = await leerFilasExcel(file, { columnas: [col('id'), col('nombre')] });
    expect(r.filas).toEqual([{ id: '1', nombre: 'Ana' }]);
  });

  it('avisa el avance y termina en 1', async () => {
    const file = libro({ up: [['id'], [1], [2]] });
    const avances = [];
    await leerFilasExcel(file, { columnas: [col('id')], alAvanzar: (f) => avances.push(f) });
    expect(avances.at(-1)).toBe(1);
    expect(avances.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
});

describe('leerColumnasExcel', () => {
  it('forma corta: columnas por nombre, todas obligatorias', async () => {
    const file = libro({ up: [['ID_unico', 'nodo'], [5, 'NODO2']] });
    const r = await leerColumnasExcel(file, { columnas: ['ID_unico', 'nodo'] });
    expect(r).toEqual({ hoja: 'up', letras: { ID_unico: 'A', nodo: 'B' }, filas: [{ ID_unico: '5', nodo: 'NODO2' }] });
    await expect(leerColumnasExcel(file, { columnas: ['ID_unico', 'ruta'] }))
      .rejects.toThrow('le faltan estas columnas: ruta');
  });
});
