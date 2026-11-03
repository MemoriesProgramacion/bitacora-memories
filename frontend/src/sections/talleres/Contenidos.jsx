// Contenidos de los módulos de los talleres: se publican con título, texto, enlace o archivo, y cada contenido
// necesita la aprobación del comité para quedar disponible.
import { useState } from 'react';
import { BookOpen, FileDown, Save, ShieldCheck } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { AreaTexto, Boton, Campo, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, useAvisos } from '../../inventario/componentes/ui';
import { hoyISO, fechaLegible } from '../../lib/asociados';
import MaterialEncuentro from './MaterialEncuentro';

// Formulario para publicar el contenido de un módulo.
function FormContenido({ c, region, modulo, ocupado, onGuardar, onCancelar }) {
  const [f, setF] = useState({ titulo: c?.titulo || `Módulo ${modulo}`, texto: c?.texto || '', enlace: c?.enlace || '' });
  const [archivo, setArchivo] = useState(null);
  const { avisar } = useAvisos();
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (archivo?.size > 10 * 1024 * 1024) { avisar('El PDF no puede superar 10 MB.', 'error'); return; }
      const datos = new FormData();
      Object.entries({ ...f, region, modulo }).forEach(([k,v]) => datos.append(k, v));
      if (archivo) datos.append('archivo', archivo);
      onGuardar(datos);
    }}>
      <fieldset disabled={ocupado} className="grid min-w-0 gap-4">
        <p className="text-[13px] text-gris-txt">Región: <strong>{region}</strong> · Módulo {modulo} · 3 horas</p>
        <Campo etiqueta="Título del contenido" obligatorio><Entrada required maxLength={150} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Campo>
        <Campo etiqueta="Contenido e instrucciones del módulo"><AreaTexto rows={6} maxLength={20000} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} /></Campo>
        <Campo etiqueta="Enlace a recursos o material de clase"><Entrada type="url" maxLength={2000} placeholder="https://…" value={f.enlace} onChange={(e) => setF({ ...f, enlace: e.target.value })} /></Campo>
        <Campo etiqueta="Material en PDF" ayuda={c?.adjunto_nombre ? `Actual: ${c.adjunto_nombre}. Si no eliges otro, se conserva.` : 'Opcional. Máximo 10 MB; incluye texto, un enlace o un PDF.'}>
          <Entrada type="file" accept="application/pdf,.pdf" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        </Campo>
        <div className="flex flex-wrap justify-end gap-2 border-t border-borde pt-4"><Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton><Boton tipo="submit" icono={Save} cargando={ocupado}>Publicar contenido</Boton></div>
      </fieldset>
    </form>
  );
}

// Formulario con el que el comité aprueba cada contenido, con la fecha y el acta; sin aprobación, el contenido
// no se usa.
function FormAprobacionComite({ c, ocupado, onGuardar, onCancelar }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [observacion, setObservacion] = useState('');
  const [archivo, setArchivo] = useState(null);
  const noEsPdf = !!archivo && !/\.pdf$/i.test(archivo.name);
  return (
    <form className="grid gap-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData();
      f.append('fecha', fecha);
      f.append('version', c.actualizado_en);
      if (observacion.trim()) f.append('observacion', observacion.trim());
      f.append('archivo', archivo);
      onGuardar(f);
    }}>
      <p className="text-[13px] text-gris-txt">{c.region} · Módulo {c.modulo} · {c.titulo}</p>
      <fieldset disabled={ocupado} className="grid gap-4">
        <Campo etiqueta="Fecha del Comité Técnico" obligatorio><Entrada type="date" required max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        <Campo etiqueta="Observación"><AreaTexto rows={2} maxLength={1000} value={observacion} onChange={(e) => setObservacion(e.target.value)} /></Campo>
        <Campo etiqueta="Acta del Comité (PDF)" obligatorio error={noEsPdf ? 'El acta debe ser un PDF.' : undefined}>
          <Entrada type="file" required accept="application/pdf,.pdf" aria-invalid={noEsPdf || undefined} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        </Campo>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton><Boton tipo="submit" icono={ShieldCheck} cargando={ocupado} disabled={!archivo || noEsPdf || !fecha}>Registrar aprobación</Boton></div>
    </form>
  );
}

// Muestra los contenidos de cada módulo con su aprobación.
export default function Contenidos({ datos, region, setRegion, recargar }) {
  const [editando, setEditando] = useState(null);
  const [aprobando, setAprobando] = useState(null);
  const { ejecutar, ocupado } = useAccion(recargar);
  const elegida = datos.regiones.includes(region) ? region : datos.regiones[0] || '';
  return (
    <div className="grid gap-4">
      <Campo etiqueta="Región del contenido" className="max-w-md">
        <Seleccion value={elegida} onChange={(e) => setRegion(e.target.value)}>{datos.regiones.map((r) => <option key={r} value={r}>{r}</option>)}</Seleccion>
      </Campo>
      {[1,2,3].map((modulo) => {
        const c = datos.contenidos.find((x) => x.region === elegida && x.modulo === modulo);
        return (
          <Tarjeta key={modulo} titulo={`Módulo ${modulo} · 3 horas`}
            acciones={<span className="flex flex-wrap items-center gap-2">
              {c && <Insignia tono={c.aprobado ? 'ok' : 'alerta'}>{c.aprobado ? 'Aprobado por el Comité Técnico' : 'Pendiente del Comité Técnico'}</Insignia>}
              {datos.puede_publicar && elegida && <Boton variante="fantasma" icono={BookOpen} onClick={() => setEditando({ region: elegida, modulo, c })}>{c ? 'Editar contenido' : 'Cargar contenido'}</Boton>}
            </span>}>
            <div className="grid gap-3">
              <MaterialEncuentro c={c} />
              {c && datos.puede_publicar && (
                <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-3 text-[13px]">
                  {c.aprobado && c.aprobacion
                    ? <span>Comité del {fechaLegible(c.aprobacion.fecha)} · registrado por {c.aprobacion.registrada_por}{c.aprobacion.observacion ? ` · ${c.aprobacion.observacion}` : ''}</span>
                    : <span className="text-gris-txt">Los Talleristas lo ven cuando el Comité Técnico lo apruebe.</span>}
                  {c.tiene_acta && <a href={`/api/talleres/contenidos/${c.id}/acta`} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={16} aria-hidden="true" />Acta del Comité</a>}
                  {datos.puede_aprobar_contenidos && !c.aprobado && <Boton tamano="sm" icono={ShieldCheck} onClick={() => setAprobando(c)}>Registrar aprobación del Comité</Boton>}
                </div>
              )}
            </div>
          </Tarjeta>
        );
      })}
      <Dialogo abierto={Boolean(editando)} titulo="Contenido del módulo" ancho="max-w-2xl" onCerrar={() => { if (!ocupado) setEditando(null); }}>
        {editando && <>
          {editando.c?.aprobado && <p className="mb-3 text-[13px] text-aviso-txt">Si publicas cambios, el contenido vuelve a requerir la aprobación del Comité Técnico y los Talleristas no lo verán mientras tanto.</p>}
          <FormContenido {...editando} ocupado={ocupado} onCancelar={() => setEditando(null)} onGuardar={async (f) => {
            const r = await ejecutar(() => apiGeneral.put('/talleres/contenidos/publicar', f));
            if (r) setEditando(null);
          }} />
        </>}
      </Dialogo>
      <Dialogo abierto={Boolean(aprobando)} titulo="Aprobación del Comité Técnico" onCerrar={() => { if (!ocupado) setAprobando(null); }}>
        {aprobando && <FormAprobacionComite c={aprobando} ocupado={ocupado} onCancelar={() => setAprobando(null)} onGuardar={async (f) => {
          const r = await ejecutar(() => apiGeneral.put(`/talleres/contenidos/${aprobando.id}/aprobacion`, f));
          if (r) setAprobando(null);
        }} />}
      </Dialogo>
    </div>
  );
}
