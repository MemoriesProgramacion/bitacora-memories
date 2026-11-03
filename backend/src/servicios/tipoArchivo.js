// Verificación del tipo real de los archivos subidos. La extensión y el tipo MIME los pone quien sube el
// archivo y no bastan: aquí se leen los primeros bytes y se exige que la firma del contenido corresponda a la
// extensión; el MIME con que se guarda y se sirve sale de esta tabla y nunca del navegador.
import fs from 'node:fs/promises';
import path from 'node:path';
import { solicitudInvalida } from '../errores.js';

const BYTES_A_LEER = 1024;
const ascii = (b, desde, hasta) => b.subarray(desde, hasta).toString('latin1');
const empieza = (b, bytes) => b.length >= bytes.length && b.subarray(0, bytes.length).equals(Buffer.from(bytes));

// Familias de archivo, cada una con la regla que dice si un encabezado de bytes le corresponde.
const FIRMAS = {
  pdf: (b) => ascii(b, 0, BYTES_A_LEER).includes('%PDF-'),
  jpg: (b) => empieza(b, [0xff, 0xd8, 0xff]),
  png: (b) => empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: (b) => ['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6)),
  webp: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  bmp: (b) => ascii(b, 0, 2) === 'BM',
  iso: (b) => ascii(b, 4, 8) === 'ftyp',
  mov: (b) => ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(b, 4, 8)),
  avi: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'AVI ',
  asf: (b) => empieza(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]),
  mpeg: (b) => empieza(b, [0x00, 0x00, 0x01, 0xba]) || empieza(b, [0x00, 0x00, 0x01, 0xb3]),
  ts: (b) => (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47))
    || (b[4] === 0x47 && (b.length < 197 || b[196] === 0x47)),
  ebml: (b) => empieza(b, [0x1a, 0x45, 0xdf, 0xa3]),
  zip: (b) => empieza(b, [0x50, 0x4b, 0x03, 0x04]),
  ole: (b) => empieza(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  texto: (b) => !b.includes(0),
};

// Extensiones admitidas con la familia que debe tener el contenido y el MIME con que se sirve.
export const TIPOS = {
  '.pdf': { firma: 'pdf', mime: 'application/pdf' },
  '.jpg': { firma: 'jpg', mime: 'image/jpeg' },
  '.jpeg': { firma: 'jpg', mime: 'image/jpeg' },
  '.jfif': { firma: 'jpg', mime: 'image/jpeg' },
  '.png': { firma: 'png', mime: 'image/png' },
  '.gif': { firma: 'gif', mime: 'image/gif' },
  '.webp': { firma: 'webp', mime: 'image/webp' },
  '.bmp': { firma: 'bmp', mime: 'image/bmp' },
  '.heic': { firma: 'iso', mime: 'image/heic' },
  '.heif': { firma: 'iso', mime: 'image/heif' },
  '.mp4': { firma: 'iso', mime: 'video/mp4' },
  '.m4v': { firma: 'iso', mime: 'video/x-m4v' },
  '.3gp': { firma: 'iso', mime: 'video/3gpp' },
  '.mov': { firma: 'mov', mime: 'video/quicktime' },
  '.avi': { firma: 'avi', mime: 'video/x-msvideo' },
  '.mkv': { firma: 'ebml', mime: 'video/x-matroska' },
  '.webm': { firma: 'ebml', mime: 'video/webm' },
  '.wmv': { firma: 'asf', mime: 'video/x-ms-wmv' },
  '.mpeg': { firma: 'mpeg', mime: 'video/mpeg' },
  '.mpg': { firma: 'mpeg', mime: 'video/mpeg' },
  '.mts': { firma: 'ts', mime: 'video/mp2t' },
  '.m2ts': { firma: 'ts', mime: 'video/mp2t' },
  '.xlsx': { firma: 'zip', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.docx': { firma: 'zip', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xls': { firma: 'ole', mime: 'application/vnd.ms-excel' },
  '.doc': { firma: 'ole', mime: 'application/msword' },
  '.csv': { firma: 'texto', mime: 'text/csv; charset=utf-8' },
};

const extensionDe = (nombre) => path.extname(String(nombre ?? '')).toLowerCase();

// Devuelve el tipo admitido para un nombre de archivo, o null si la extensión no se admite.
export const tipoPorNombre = (nombre) => TIPOS[extensionDe(nombre)] || null;

// Devuelve los primeros bytes de un archivo en disco o de un Buffer.
async function encabezado(origen) {
  if (Buffer.isBuffer(origen)) return origen.subarray(0, BYTES_A_LEER);
  const f = await fs.open(origen, 'r');
  try {
    const b = Buffer.alloc(BYTES_A_LEER);
    const { bytesRead } = await f.read(b, 0, BYTES_A_LEER, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await f.close();
  }
}

// Indica si el contenido corresponde a la extensión del nombre, opcionalmente limitado a una lista de
// extensiones.
export async function contenidoValido(origen, nombre, permitidas = null) {
  const ext = extensionDe(nombre);
  const tipo = TIPOS[ext];
  if (!tipo || (permitidas && !permitidas.includes(ext))) return false;
  const b = await encabezado(origen);
  return b.length > 0 && FIRMAS[tipo.firma](b);
}

// Extensión que corresponde a cada familia cuando hay que deducirla del contenido.
const EXT_DE_FAMILIA = {
  pdf: '.pdf', jpg: '.jpg', png: '.png', gif: '.gif', webp: '.webp', bmp: '.bmp', avi: '.avi',
  ebml: '.mkv', asf: '.wmv', mpeg: '.mpeg', ts: '.mts', zip: '.xlsx', ole: '.xls',
};

// Devuelve la extensión que corresponde al contenido, o null si no se reconoce.
export async function extensionPorContenido(origen) {
  const b = await encabezado(origen);
  if (!b.length) return null;
  if (FIRMAS.iso(b)) {
    const marca = ascii(b, 8, 12);
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(marca)) return '.heic';
    return marca === 'qt  ' ? '.mov' : '.mp4';
  }
  if (FIRMAS.mov(b)) return '.mov';
  for (const [familia, ext] of Object.entries(EXT_DE_FAMILIA)) if (FIRMAS[familia](b)) return ext;
  return null;
}

// Lanza un error 400 si la extensión no se admite o el contenido no corresponde a ella; devuelve la firma y el
// MIME verificados.
export async function exigirContenido(origen, nombre, permitidas = null) {
  const ext = extensionDe(nombre);
  const visible = path.basename(String(nombre ?? '')) || 'el archivo';
  if (!TIPOS[ext] || (permitidas && !permitidas.includes(ext))) {
    throw solicitudInvalida(`Tipo de archivo no permitido: «${visible}».`);
  }
  if (!(await contenidoValido(origen, nombre))) {
    throw solicitudInvalida(`El contenido de «${visible}» no corresponde a un archivo ${ext}.`);
  }
  return TIPOS[ext];
}
