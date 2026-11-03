// Copia en el servidor del catálogo de formatos de las visitas. Los nombres son las claves con que cada visita
// guarda sus soportes y deben coincidir con los del frontend. Aquí solo está lo que el servidor necesita para
// decidir: qué formato es obligatorio según la modalidad, los mínimos por clase de archivo, las actas de salida
// y sus dependencias.
const M2_M4 = ['M2', 'M3', 'M4'];

// Formatos de cada tipo de visita con sus reglas de obligatoriedad, mínimos y dependencias.
export const CATALOGO = {
  v1: {
    requiere: [],
    formatos: [
      { nombre: 'Acta de Compromiso' },
      { nombre: 'Acta de Visita 1' },
      { nombre: 'Imágenes de caracterización', minimos: { imagen: 4 } },
      { nombre: 'Video de caracterización', minimos: { video: 1 } },
      { nombre: 'Autorización para el tratamiento de datos personales' },
      { nombre: 'Acta de Novedades', opcional: true },
      { nombre: 'Acta de No Aceptación', opcional: true },
      { nombre: 'Acta de Retiro', opcional: true },
      { nombre: 'Cédula del representante legal' },
      { nombre: 'Cédulas de los asociados', modalidades: M2_M4 },
      { nombre: 'RUT', obligatorioEn: ['M3', 'M4'] },
      { nombre: 'Certificado de existencia o Cámara de comercio', obligatorioEn: ['M3', 'M4'] },
      { nombre: 'Tenencia', obligatorioEn: M2_M4 },
      { nombre: 'Soporte de la visita virtual', opcional: true },
    ],
    dependencias: [['Acta de Retiro', 'Acta de Novedades']],
    salidas: ['Acta de No Aceptación', 'Acta de Retiro'],
    exigeEnSalida: ['Acta de Visita 1'],
  },
  v2: {
    requiere: ['v1'],
    formatos: [
      { nombre: 'Acta de Visita 2' },
      { nombre: 'Diagnóstico de unidades productivas individuales (M1)', modalidades: ['M1'], alternativas: 'diagnostico' },
      { nombre: 'Diagnóstico de unidades productivas solidarias (M2, M3, M4)', modalidades: M2_M4, alternativas: 'diagnostico' },
      { nombre: 'Plan de negocios' },
      { nombre: 'Indicadores iniciales INNPULSA' },
      { nombre: 'Video de recorrido con entrevista', minimos: { video: 1 } },
      { nombre: 'Soporte de la visita virtual', opcional: true },
    ],
  },
  v3: {
    requiere: ['v2'],
    formatos: [
      { nombre: 'Bitácora' },
      { nombre: 'Acta de Visita 3' },
      { nombre: 'Registro fotográfico' },
      { nombre: 'Video de salida', minimos: { video: 1 } },
      { nombre: 'Soporte de la visita virtual', opcional: true },
    ],
  },
};

// Tipos de visita del proceso en orden; los demás son de legado y no siguen la secuencia.
export const SECUENCIA = ['v1', 'v2', 'v3'];

// Devuelve la modalidad normalizada de M1 a M4, o vacío si no se conoce.
export function modalidadDe(texto) {
  const m = /M\s*([1-4])/i.exec(String(texto || ''));
  return m ? `M${m[1]}` : '';
}

// Devuelve los archivos cargados de un formato, buscándolo en todos los grupos de soportes del documento.
export function archivosDe(soportes, nombre) {
  const salida = [];
  for (const [grupo, formatos] of Object.entries(soportes || {})) {
    if (grupo === 'soportes_quitados' || !formatos || typeof formatos !== 'object') continue;
    const items = formatos[nombre];
    if (Array.isArray(items)) salida.push(...items.filter((s) => s && (s.blob || s.archivo)));
  }
  return salida;
}
export const tieneFormato = (soportes, nombre) => archivosDe(soportes, nombre).length > 0;

const RE_VIDEO = /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/i;
const RE_IMAGEN = /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i;
// Determina la clase del archivo a partir del nombre verificado en el servidor y no del que declara el
// navegador.
const claseArchivo = (s) => {
  const n = String(s?.blob || s?.archivo || '');
  return RE_VIDEO.test(n) ? 'video' : RE_IMAGEN.test(n) ? 'imagen' : 'otro';
};

// Devuelve la clase de archivo que exige un formato: los de video solo reciben videos y las imágenes de
// caracterización, imágenes.
export function claseExigida(nombre) {
  for (const t of Object.values(CATALOGO)) {
    const f = t.formatos.find((x) => x.nombre === nombre);
    if (f?.minimos) return Object.keys(f.minimos)[0];
  }
  return null;
}
export const claseDeNombre = (nombre) => claseArchivo({ blob: nombre });

// Devuelve los formatos que aplican a la modalidad, con la obligatoriedad ya resuelta, con la misma regla que
// la pantalla.
export function formatosDe(tipo, modalidad) {
  const t = CATALOGO[tipo];
  if (!t) return [];
  const mod = modalidadDe(modalidad);
  return t.formatos
    .filter((f) => !f.modalidades || !mod || f.modalidades.includes(mod))
    .map((f) => {
      if (!mod && f.modalidades) return f.alternativas ? { ...f, alternativa: true } : { ...f, opcional: true };
      if (f.obligatorioEn) return { ...f, opcional: !mod || !f.obligatorioEn.includes(mod) };
      return f;
    });
}

// Devuelve las actas de salida (no aceptación y retiro) cargadas en la visita.
export const salidasCargadas = (tipo, soportes) => (CATALOGO[tipo]?.salidas || []).filter((n) => tieneFormato(soportes, n));

// Devuelve los formatos obligatorios que faltan, con la misma regla que la pantalla.
export function formatosFaltantes(tipo, modalidad, soportes) {
  const t = CATALOGO[tipo];
  if (!t) return [];
  const tiene = (n) => tieneFormato(soportes, n);
  const dependencias = (lista) => {
    for (const [si, entonces] of t.dependencias || []) {
      if (tiene(si) && !tiene(entonces) && !lista.includes(entonces)) lista.push(entonces);
    }
    return lista;
  };
  if (salidasCargadas(tipo, soportes).length) return dependencias((t.exigeEnSalida || []).filter((n) => !tiene(n)));
  const lista = formatosDe(tipo, modalidad);
  const faltan = [];
  for (const f of lista.filter((x) => !x.opcional && !x.alternativa)) {
    const archivos = archivosDe(soportes, f.nombre);
    if (!archivos.length) { faltan.push(f.nombre); continue; }
    const cortos = Object.entries(f.minimos || {})
      .map(([clase, pide]) => ({ clase, pide, tiene: archivos.filter((a) => claseArchivo(a) === clase).length }))
      .filter((c) => c.tiene < c.pide);
    if (cortos.length) faltan.push(`${f.nombre} (${cortos.map((c) => `lleva ${c.tiene} de ${c.pide}`).join(', ')})`);
  }
  const alternativas = lista.filter((f) => f.alternativa);
  if (alternativas.length && !alternativas.some((f) => tiene(f.nombre))) faltan.push(alternativas.map((f) => f.nombre).join(' o '));
  return dependencias(faltan);
}
