// Muestra el contenido publicado de un módulo de taller, o un aviso si aún no está publicado o espera la
// aprobación del comité.
import { FileDown } from 'lucide-react';
import { fechaColombia } from './fechas';

// Muestra el título, el texto, el enlace, el adjunto y quién lo publicó.
export default function MaterialEncuentro({ c }) {
  if (!c) return <p className="text-[13px] text-gris-txt">El contenido de este módulo aún no está publicado o espera la aprobación del Comité Técnico.</p>;
  return <div className="grid gap-2 rounded-lg border border-borde bg-lienzo p-3 text-[13px]">
    <strong>{c.titulo}</strong>{c.texto && <p className="whitespace-pre-wrap">{c.texto}</p>}
    {c.enlace && <a href={c.enlace} target="_blank" rel="noreferrer" className="font-semibold text-acento-txt underline">Abrir contenido del módulo</a>}
    {c.tiene_adjunto && <a href={`/api/talleres/contenidos/${c.id}/archivo`} className="inline-flex items-center gap-2 font-semibold text-acento-txt underline"><FileDown size={16} />Descargar {c.adjunto_nombre}</a>}
    <p className="text-xs text-gris">Publicado por {c.publicado_por} · {fechaColombia(c.actualizado_en)}</p>
  </div>;
}
