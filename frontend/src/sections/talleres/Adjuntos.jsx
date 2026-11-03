// Archivos de un módulo de taller, por secciones: informe, fotos y videos, que son obligatorias y se cargan al
// registrar el módulo realizado; después se pueden anexar más. También muestra la asistencia firmada y otros
// soportes.
import { useState } from 'react';
import { FileDown, FileText, Image, Paperclip, Trash2, Video } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Boton, Entrada, Insignia, useAvisos } from '../../inventario/componentes/ui';
import { fechaColombia } from './fechas';
import { EVIDENCIAS, ayudaEvidencia, problemaEvidencia } from './evidencias';

// Icono de cada sección de evidencia.
const ICONOS = { informe: FileText, foto: Image, video: Video };

// Muestra los archivos de un módulo por sección y permite anexar más.
export default function Adjuntos({ taller, e, recargar, puedeEditar }) {
  const { ejecutar, ocupado } = useAccion(recargar);
  const de = (tipo) => e.soportes.filter((s) => s.tipo === tipo);
  const otros = e.soportes.filter((s) => !EVIDENCIAS.some((d) => d.tipo === s.tipo));
  const quitar = (s) => { if (window.confirm(`¿Quitar «${s.nombre}» de este módulo?`)) ejecutar(() => apiGeneral.del(`/talleres/soportes/${s.id}`)); };
  return (
    <section aria-label={`Evidencias del módulo ${e.modulo}`} className="grid gap-3 border-t border-borde pt-4">
      <h4 className="text-sm font-semibold text-marino">Evidencias del módulo</h4>
      {!e.realizado_en && <p className="text-[13px] text-gris-txt">El informe, las fotos y los videos son obligatorios y se cargan al registrar el módulo realizado.</p>}
      <div className="grid gap-3 lg:grid-cols-3">
        {EVIDENCIAS.map((d) => (
          <SeccionEvidencia key={d.tipo} d={d} lista={de(d.tipo)} taller={taller} e={e} ocupado={ocupado} ejecutar={ejecutar}
            puedeAnexar={Boolean(e.realizado_en) && (puedeEditar || e.mio)} puedeQuitar={puedeEditar} onQuitar={quitar} />
        ))}
      </div>
      {otros.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-borde p-3">
          <h5 className="text-[13px] font-semibold">Asistencia firmada y otros soportes</h5>
          <ListaSoportes lista={otros} e={e} ocupado={ocupado} puedeQuitar={puedeEditar} onQuitar={quitar} />
        </div>
      )}
    </section>
  );
}

// Muestra una sección de evidencia con sus archivos y su formulario de carga.
function SeccionEvidencia({ d, lista, taller, e, ocupado, ejecutar, puedeAnexar, puedeQuitar, onQuitar }) {
  const [archivos, setArchivos] = useState([]);
  const [clave, setClave] = useState(0);
  const { avisar } = useAvisos();
  const Icono = ICONOS[d.tipo];
  const anexar = async (ev) => {
    ev.preventDefault();
    const problema = problemaEvidencia(d, archivos);
    if (problema) { avisar(problema, 'error'); return; }
    const f = new FormData();
    f.append('tipo', d.tipo);
    archivos.forEach((a) => f.append('soportes', a));
    const r = await ejecutar(() => apiGeneral.post(`/talleres/${taller.id}/encuentros/${e.modulo}/soportes`, f));
    if (r) { setArchivos([]); setClave((k) => k + 1); }
  };
  return (
    <div className="grid content-start gap-2 rounded-lg border border-borde p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="flex items-center gap-1.5 text-[13px] font-semibold"><Icono size={16} aria-hidden="true" />{d.titulo}</h5>
        {lista.length ? <Insignia tono="ok">{lista.length} archivo{lista.length === 1 ? '' : 's'}</Insignia>
          : <Insignia tono="alerta">{e.realizado_en ? 'Falta' : 'Obligatorio'}</Insignia>}
      </div>
      <p className="text-[12px] text-gris-txt">{d.formatos} · máximo {d.mb} MB por archivo</p>
      {lista.length > 0 && <ListaSoportes lista={lista} e={e} ocupado={ocupado} puedeQuitar={puedeQuitar} onQuitar={onQuitar} />}
      {puedeAnexar && (
        <form onSubmit={anexar} className="grid gap-2 border-t border-borde pt-2">
          <Entrada key={clave} type="file" multiple={d.max > 1} accept={d.acepta} aria-label={`Anexar a ${d.titulo}`}
            onChange={(ev) => setArchivos(Array.from(ev.target.files || []))} />
          <p className="text-[12px] text-gris-txt">{ayudaEvidencia(d)}</p>
          <Boton tipo="submit" tamano="sm" variante="fantasma" icono={Paperclip} cargando={ocupado} disabled={!archivos.length}>Anexar</Boton>
        </form>
      )}
    </div>
  );
}

// Muestra la lista de soportes de una sección.
function ListaSoportes({ lista, e, ocupado, puedeQuitar, onQuitar }) {
  return (
    <ul className="grid gap-2">
      {lista.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <a href={`/api/talleres/soportes/${s.id}`} className="inline-flex min-w-0 items-center gap-1.5 break-all font-semibold text-acento-txt underline"><FileDown size={16} aria-hidden="true" />{s.nombre}</a>
            {s.tipo === 'asistencia' && <Insignia tono="ok">Asistencia firmada</Insignia>}
            {s.tipo === 'aprobacion_virtual' && (e.aprobacion_virtual?.soporte_id === s.id
              ? <Insignia tono="ok">Aprobación de la interventoría</Insignia>
              : <Insignia>Aprobación anterior (descartada)</Insignia>)}
          </span>
          <span className="flex items-center gap-2 text-gris-txt">{s.creado_en && fechaColombia(s.creado_en)}
            {puedeQuitar && s.tipo !== 'aprobacion_virtual' && <Boton tamano="sm" variante="fantasma" icono={Trash2} disabled={ocupado} aria-label={`Quitar ${s.nombre}`}
              onClick={() => onQuitar(s)}>Quitar</Boton>}
          </span>
        </li>
      ))}
    </ul>
  );
}
