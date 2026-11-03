// API del validador de documentos de entrega. Envía por POST multipart a /api/validador con un campo action;
// exige sesión y cada cuenta opera solo las cédulas de su nodo. Los archivos se guardan en el servidor y quedan
// en revisión hasta que la coordinación los aprueba o los devuelve. La entrega se registra por tipo, y cada
// tipo exige sus propios soportes.
import { VALIDADOR_API_URL, VISOR_API_URL } from './config';
import { urlArchivo } from './api';
import { tokenCsrf, renovarCsrf, cabecerasSesion } from './csrf';
import { MAX_VIDEO_SEG, leerDuracionVideo } from './comprimirVideo';

// Límites de tamaño del video, de los PDF y del envío completo; deben coincidir con los del backend.
export const MAX_VIDEO_MB = 80;
export const MAX_PDF_MB = 15;
export const MAX_TOTAL_MB = 95;

// Soportes que exige el proceso; las claves y los nombres de campo deben coincidir exactamente con los del
// backend.
export const DOCS_ENTREGA = [
  { clave: 'orden_pedido',        label: 'Formato de Orden de Pedido',   campo: 'archivo_orden',        accept: '.pdf', blob: 'ORDEN DE PEDIDO' },
  { clave: 'entrega_activos',     label: 'Formato de Entrega de Activos', campo: 'archivo_entrega',      accept: '.pdf', blob: 'ENTREGA ACTIVOS' },
  { clave: 'recibo_satisfaccion', label: 'Recibo a Satisfacción',         campo: 'archivo_satisfaccion', accept: '.pdf', blob: 'SATISFACCION ENTREGA ACTIVOS' },
  {
    clave: 'registro_fotografico', label: 'Registro fotográfico de la entrega',
    campo: 'archivo_registro_fotografico', accept: '.pdf',
    blob: 'REGISTRO FOTOGRAFICO ENTREGA',
    ayuda: 'PDF generado en "Generador registro fotográfico"',
  },
{
  clave: 'video_entrega',
  label: 'Video de la entrega',
  campo: 'archivo_video',
  accept: 'video/*',
  blob: 'VIDEO ENTREGA',
  maxMB: MAX_VIDEO_MB,
  ayuda: `Obligatorio. Máx. ${MAX_VIDEO_SEG / 60} minutos. Se optimiza automáticamente al seleccionarlo.`,
},
  {
    clave: 'acta_parcial', label: 'Acta de novedad — entrega parcial',
    campo: 'archivo_acta_parcial', accept: '.pdf',
    blob: 'ACTA NOVEDAD ENTREGA PARCIAL',
    ayuda: 'PDF firmado del acta que soporta la entrega parcial',
  },
  {
    clave: 'acta_no_entrega', label: 'Acta de novedad — no entrega',
    campo: 'archivo_acta_no_entrega', accept: '.pdf',
    blob: 'ACTA NOVEDAD NO ENTREGA',
    ayuda: 'PDF firmado del acta que soporta la no entrega',
  },
];

// Tipos de entrega, cada uno con sus soportes exigidos.
export const TIPOS_ENTREGA = [
  {
    id: 'completa',
    label: 'Entrega completa',
    resumen: 'Se entregaron todos los activos.',
    detalle: 'Formatos firmados, registro fotográfico y video.',
    soportes: ['orden_pedido', 'entrega_activos', 'recibo_satisfaccion',
      'registro_fotografico', 'video_entrega'],
  },
  {
    id: 'parcial',
    label: 'Entrega parcial',
    resumen: 'Se entregó solo una parte de los activos.',
    detalle: 'Acta de novedad de entrega parcial y registro fotográfico.',
    soportes: ['acta_parcial', 'registro_fotografico'],
  },
  {
    id: 'no_entrega',
    label: 'No se pudo realizar la entrega',
    resumen: 'La entrega no se llevó a cabo.',
    detalle: 'Acta de novedad de no entrega.',
    soportes: ['acta_no_entrega'],
  },
];

export const TIPO_ENTREGA_POR_DEFECTO = 'completa';

// Devuelve el tipo guardado para esa unidad; lo anterior a este cambio es completa.
export function tipoEntrega(info) {
  const t = info?.tipo_entrega;
  return TIPOS_ENTREGA.some((x) => x.id === t) ? t : TIPO_ENTREGA_POR_DEFECTO;
}

export function infoTipo(tipo) {
  return TIPOS_ENTREGA.find((t) => t.id === tipo) || TIPOS_ENTREGA[0];
}

// Devuelve los soportes que exige un tipo, en orden y ya resueltos.
export function docsDeTipo(tipo) {
  return infoTipo(tipo).soportes
    .map((clave) => DOCS_ENTREGA.find((d) => d.clave === clave))
    .filter(Boolean);
}

// Indica si se puede cambiar el tipo: una entrega completa ya enviada solo cambia cuando el revisor la
// devuelve, y las parciales y de no entrega se pueden replantear después.
export function puedeCambiarTipo(info) {
  if (!info) return true;
  const hayCargados = (info.documentos_cargados?.length || 0) > 0;
  if (!hayCargados) return true;
  if (info.estado_validacion === 'correcciones') return true;
  return tipoEntrega(info) !== 'completa';
}

const EXT_VIDEO = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp'];

// Indica si ese documento ya está cargado según la base; un soporte aprobado por el revisor no se vuelve a
// pedir ni se reemplaza.
export function estaAprobado(info, clave) {
  const lista = info?.documentos_cargados;
  return Array.isArray(lista) && lista.some((d) => d?.clave === clave && d?.estado === 'aprobado');
}

export function estaCargado(info, clave) {
  const lista = info?.documentos_cargados;
  if (!Array.isArray(lista)) return false;
  return lista.some((doc) =>
    typeof doc === 'string' ? doc === clave : doc?.clave === clave
  );
}

// Devuelve la URL del archivo ya cargado, si el backend la entrega.
export function urlDocumento(info, clave) {
  if (info?.urls_archivos?.[clave]) return info.urls_archivos[clave];
  const lista = info?.documentos_cargados;
  if (!Array.isArray(lista)) return null;
  const doc = lista.find((d) => d && typeof d === 'object' && d.clave === clave);
  return doc?.url || null;
}

// Devuelve la lista de documentos ya cargados, con su URL si existe, para pintar el resumen de documentación
// cargada de una unidad.
export function documentosCargados(info) {
  return docsDeTipo(tipoEntrega(info))
    .filter((d) => estaCargado(info, d.clave))
    .map((d) => ({ ...d, url: urlDocumento(info, d.clave) }));
}

// Semáforo de la unidad dentro del validador; pendiente significa que no hay ningún soporte guardado y por eso
// va en blanco.
export const SEMAFORO = {
  pendiente:   { tono: 'vacio',  label: 'Sin documentos' },
  en_revision: { tono: 'espera', label: 'En revisión' },
  correcciones:{ tono: 'malo',   label: 'Por corregir' },
  completo:    { tono: 'bueno',  label: 'Aprobado' },
  aprobado:    { tono: 'bueno',  label: 'Aprobado' },
};

export function semaforoUP(estado) {
  return SEMAFORO[estado] || SEMAFORO.pendiente;
}

// Valida en el navegador que el archivo corresponda al tipo esperado del soporte sin mirar el peso; devuelve
// vacío si está bien o el mensaje.
export function validarFormatoSoporte(doc, file) {
  if (!file) return '';
  const nombre = (file.name || '').toLowerCase();
  if (doc.accept === '.pdf' && !nombre.endsWith('.pdf')) {
    return `"${doc.label}" debe ser un archivo PDF.`;
  }
  if (doc.accept === 'video/*') {
    const esVideo = (file.type || '').startsWith('video/') ||
      EXT_VIDEO.some((e) => nombre.endsWith(e));
    if (!esVideo) {
      return `"${doc.label}" debe ser un archivo de video (${EXT_VIDEO.map((e) => e.slice(1)).join(', ')}).`;
    }
  }
  return '';
}

// Valida el tipo y el peso del soporte; comprimido indica que el video ya se optimizó en el navegador.
export function validarTipoSoporte(doc, file, { comprimido = false } = {}) {
  if (!file) return '';
  const errFormato = validarFormatoSoporte(doc, file);
  if (errFormato) return errFormato;

  const tope = doc.maxMB || (doc.accept === '.pdf' ? MAX_PDF_MB : 0);
  if (tope && file.size > tope * 1024 * 1024) {
    return `"${doc.label}" pesa ${mb(file.size)} MB y el máximo es ${tope} MB. ` +
      (doc.accept !== 'video/*'
        ? 'Vuelve a exportar el PDF con menor peso.'
        : comprimido
          ? 'Recórtalo y vuelve a seleccionarlo.'
          : 'No se pudo optimizar en este navegador: recórtalo o grábalo en 720p.');
  }
  return '';
}

// Hace la validación completa de un soporte: tipo, peso y, si aplica, duración.
export async function validarSoporte(doc, file, opciones) {
  const err = validarTipoSoporte(doc, file, opciones);
  if (err || !file || !doc.minSeg) return err;
  const dur = await leerDuracionVideo(file);
  if (Number.isFinite(dur) && dur < doc.minSeg) {
    const m = Math.floor(dur / 60);
    const s = String(Math.round(dur % 60)).padStart(2, '0');
    return `"${doc.label}" dura ${m}:${s} y el mínimo es ${doc.minSeg / 60} minutos.`;
  }
  return '';
}

export function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// Valida que el envío completo, con cédula, PDFs y video, quepa en una sola petición; si se pasa, el servidor
// responde 413.
export function validarTamanoTotal(archivos) {
  const total = Object.values(archivos || {})
    .filter(Boolean)
    .reduce((s, f) => s + (f.size || 0), 0);
  if (total > MAX_TOTAL_MB * 1024 * 1024) {
    return `Los archivos suman ${mb(total)} MB y el envío no puede pasar de ${MAX_TOTAL_MB} MB. ` +
      'Verifica el tamaño de los archivos adjuntos.';
  }
  return '';
}

// Devuelve el nombre exacto del archivo, el de la URL guardada si existe o el reconstruido con la convención.
export function nombreBlob(doc, info, cedula) {
  const url = urlDocumento(info, doc.clave);
  if (url) {
    try {
      const ruta = url.split('?')[0].split('/').pop();
      if (ruta) return decodeURIComponent(ruta);
    } catch { }
  }
  if (!doc.blob || !cedula) return '';
  return `${doc.blob}_${cedula}.pdf`;
}

// Devuelve la URL servida por la API, apta para iframe y video.
export function urlVisorEntrega(doc, info, cedula) {
  const nombre = nombreBlob(doc, info, cedula);
  if (!nombre || !VISOR_API_URL) return '';
  return urlArchivo(`${VISOR_API_URL}?action=get&origen=entrega&blobName=${encodeURIComponent(nombre)}`);
}

export function esVideo(doc) {
  return doc?.accept === 'video/*';
}

// Envía la petición multipart al validador.
async function enviar(formData) {
  if (!tokenCsrf()) await renovarCsrf();
  const res = await fetch(VALIDADOR_API_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: cabecerasSesion(),
    body: formData,
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { }

  if (!res.ok) {
    if (res.status === 413) {
      return { exito: false, mensaje:
        `Los archivos superan el tamaño que admite el servidor (máx. ${MAX_TOTAL_MB} MB en total).` };
    }
    if (res.status === 403 && data?.detalle) return { exito: false, mensaje: data.detalle };
    const detalle = data?.mensaje || texto.slice(0, 300).trim();
    return { exito: false, mensaje: `El servidor respondió ${res.status}. ${detalle}`.trim() };
  }
  if (!data) throw new Error('El servidor devolvió una respuesta vacía o no válida.');
  return data;
}

// Consulta el estado del beneficiario y devuelve su nombre, tipo, estado de validación y los soportes por
// corregir.
export async function checkBeneficiario(cedula) {
  const fd = new FormData();
  fd.append('action', 'check');
  fd.append('cedula', cedula);
  return enviar(fd);
}

export async function guardarCorreos(cedula, correoGestor, correoPersonal) {
  const fd = new FormData();
  fd.append('action', 'guardar_correo');
  fd.append('cedula', cedula);
  fd.append('correo_gestor', correoGestor || '');
  fd.append('correo_personal', correoPersonal || '');
  return enviar(fd);
}

// Devuelve los documentos prellenados con su nombre, tipo y contenido en base64.
export async function descargarPrellenados(cedula) {
  const fd = new FormData();
  fd.append('action', 'descargar_prellenados');
  fd.append('cedula', cedula);
  return enviar(fd);
}

// Hace la carga inicial: cédula en fotos o PDF y todos los soportes.
export async function subirInicial(cedula, { modoCedula, archivos, tipo }) {
  const fd = new FormData();
  fd.append('action', 'upload');
  fd.append('cedula', cedula);
  fd.append('modo_cedula', modoCedula);
  fd.append('tipo_entrega', tipo || TIPO_ENTREGA_POR_DEFECTO);
  if (modoCedula === 'pdf') {
    fd.append('archivo_cedula_pdf', archivos.archivo_cedula_pdf);
  } else {
    fd.append('archivo_frontal', archivos.archivo_frontal);
    fd.append('archivo_trasera', archivos.archivo_trasera);
  }
  for (const d of docsDeTipo(tipo || TIPO_ENTREGA_POR_DEFECTO)) {
    if (archivos[d.campo]) fd.append(d.campo, archivos[d.campo]);
  }
  return enviar(fd);
}

// Hace la corrección reenviando solo los documentos observados.
export async function subirCorrecciones(cedula, porCorregir, archivos) {
  const fd = new FormData();
  fd.append('action', 'upload');
  fd.append('cedula', cedula);
  for (const d of porCorregir) {
    const doc = DOCS_ENTREGA.find((x) => x.clave === d.clave);
    if (doc && archivos[doc.campo]) fd.append(doc.campo, archivos[doc.campo]);
  }
  return enviar(fd);
}

// Convierte el base64 que devuelve el backend en un archivo descargable.
export function descargarBase64(doc) {
  const bytes = Uint8Array.from(atob(doc.contenido), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: doc.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}