// Enlace para descargar un formato en blanco que viene con la aplicación, el mismo de las visitas, desde los
// módulos donde se usa ese documento. El archivo sale del catálogo de visitas por su nombre, así que hay un
// solo lugar donde cambia.
import { FileDown } from 'lucide-react';
import { TIPOS_VISITA, urlFormato } from '../lib/visitas';

// Clases de estilo del enlace de descarga.
const CLASE = 'inline-flex items-center gap-1 rounded-md border border-marino/25 bg-card px-2 py-0.5 text-[12px] '
  + 'font-semibold text-marino transition hover:border-marino hover:bg-marino/5';

// Busca en el catálogo de visitas el formato con ese nombre, por ejemplo Acta de Retiro o Acta de Novedades.
export const formatoDeCatalogo = (nombre) =>
  TIPOS_VISITA.flatMap((t) => t.formatos || []).find((f) => f.nombre === nombre) || null;

// Muestra el enlace de descarga; si el documento no está en el catálogo se pasa archivo, el nombre del PDF
// dentro de public/plantillas/visitas.
export default function DescargaFormato({ nombre, archivo, etiqueta }) {
  const f = archivo ? { formato: archivo } : formatoDeCatalogo(nombre);
  const url = urlFormato(f);
  if (!url) return null;
  return (
    <a href={url} download={f.formato} title={`Descargar ${f.formato}`} className={CLASE}>
      <FileDown size={14} aria-hidden="true" />
      {etiqueta || `Descargar formato de ${String(nombre || '').toLowerCase()}`}
    </a>
  );
}
