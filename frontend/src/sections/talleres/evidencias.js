// Evidencias del módulo realizado: tres secciones obligatorias, cada una con sus formatos, cuántos archivos se
// suben de una vez y el peso máximo, y la planilla de asistencia firmada. Debe coincidir con EVIDENCIAS de
// backend/src/rutasTalleres.js.
// Las tres secciones de evidencias con sus formatos, cantidad y peso máximo.
export const EVIDENCIAS = [
  { tipo: 'informe', campo: 'informe', titulo: 'Informe del módulo', formatos: 'PDF o Word (.docx)', ext: ['.pdf', '.docx'], max: 1, mb: 25,
    acepta: 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx' },
  { tipo: 'foto', campo: 'fotos', titulo: 'Fotos del módulo', formatos: 'JPG o PNG', ext: ['.jpg', '.jpeg', '.png'], max: 10, mb: 20,
    acepta: 'image/jpeg,image/png,.jpg,.jpeg,.png' },
  { tipo: 'video', campo: 'videos', titulo: 'Videos del módulo', formatos: 'MP4, MOV o WEBM', ext: ['.mp4', '.mov', '.webm'], max: 3, mb: 200,
    acepta: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm' },
];

// Peso máximo de cada archivo de la planilla de asistencia firmada.
export const MB_ASISTENCIA = 20;

// Devuelve el texto de ayuda de una sección de evidencia.
export const ayudaEvidencia = (d) => `${d.max === 1 ? 'Un archivo' : `De 1 a ${d.max} archivos`} ${d.formatos}; máximo ${d.mb} MB cada uno.`;

// Devuelve el primer problema de los archivos elegidos para una sección, o vacío si están bien.
export function problemaEvidencia(d, archivos) {
  if (!archivos.length) return `${d.titulo}: es obligatorio.`;
  if (archivos.length > d.max) return `${d.titulo}: máximo ${d.max} archivo(s) por vez.`;
  const malo = archivos.find((f) => !d.ext.includes((f.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()));
  if (malo) return `${d.titulo}: «${malo.name}» no es ${d.formatos}.`;
  const pesado = archivos.find((f) => f.size > d.mb * 1024 * 1024);
  if (pesado) return `${d.titulo}: «${pesado.name}» supera los ${d.mb} MB.`;
  return '';
}
