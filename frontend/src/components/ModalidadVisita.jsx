// Modalidad de la visita: presencial, o virtual por una causa externa con su justificación, el formato de
// soporte de la visita virtual y su aprobación con un PDF. El servidor no cierra una visita virtual sin todo
// eso. La modalidad y la causa se guardan al elegirlas y la justificación al salir del campo.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Entrada, Seleccion, useAvisos } from '../inventario/componentes/ui';
import { apiGeneral } from '../inventario/lib/api';
import { urlArchivo } from '../lib/api';
import { hoyISO, fechaLegible } from '../lib/asociados';
import { CAUSAS_VIRTUAL, FORMATO_SOPORTE_VIRTUAL } from '../lib/visitas';

// Muestra los controles de modalidad, causa, justificación, soporte y aprobación de la visita.
export default function ModalidadVisita({ v, set, ocupado, esCoordinacion, onGuardar, onAprobada }) {
  const { avisar } = useAvisos();
  const [aprobando, setAprobando] = useState(false);
  const [estado, setEstado] = useState('');
  const justificacionGuardada = useRef(v.justificacionVirtual || '');
  const aprobadaRef = useRef(null);
  const enfocarAprobada = useRef(false);
  const virtual = v.modalidadVisita === 'virtual';
  const ap = v.aprobacionVirtual;
  const listaParaAprobar = !!(v.id && virtual && v.causaVirtual && justificacionGuardada.current.trim());

  useEffect(() => {
    if (!ap || !enfocarAprobada.current) return undefined;
    enfocarAprobada.current = false;
    const t = setTimeout(() => aprobadaRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [ap]);

  async function guardarYa(patch, texto) {
    set(patch);
    setEstado('Guardando…');
    const doc = await onGuardar(patch);
    if (doc && 'justificacionVirtual' in patch) justificacionGuardada.current = patch.justificacionVirtual || '';
    if (doc && 'modalidadVisita' in patch && patch.modalidadVisita !== 'virtual') justificacionGuardada.current = '';
    setEstado(doc ? texto : '');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Modalidad de la visita">
          <Seleccion value={v.modalidadVisita || 'presencial'} disabled={ocupado}
            onChange={(e) => guardarYa({ modalidadVisita: e.target.value }, 'Modalidad guardada.')}>
            <option value="presencial">Presencial</option>
            <option value="virtual">Virtual por causa externa</option>
          </Seleccion>
        </Campo>
        {virtual && (
          <Campo etiqueta="Causa externa" obligatorio>
            <Seleccion value={v.causaVirtual || ''} disabled={ocupado}
              onChange={(e) => guardarYa({ causaVirtual: e.target.value }, 'Causa guardada.')}>
              <option value="">Elige…</option>
              {CAUSAS_VIRTUAL.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </Seleccion>
          </Campo>
        )}
      </div>
      {virtual && (
        <>
          <Campo etiqueta="Justificación" obligatorio ayuda={`Se guarda al salir del campo. Carga también el formato «${FORMATO_SOPORTE_VIRTUAL}» en la lista de formatos opcionales.`}>
            <AreaTexto rows={2} maxLength={2000} value={v.justificacionVirtual || ''} disabled={ocupado}
              onChange={(e) => set({ justificacionVirtual: e.target.value })}
              onBlur={(e) => { if (e.target.value !== justificacionGuardada.current) guardarYa({ justificacionVirtual: e.target.value }, 'Justificación guardada.'); }} />
          </Campo>
          {ap && (
            <p className="text-[12px] text-gris-txt">
              Si cambias la modalidad, la causa o la justificación, la aprobación de la interventoría se descarta y la coordinación debe registrarla de nuevo.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {ap ? (
              <span ref={aprobadaRef} tabIndex={-1} className="flex items-center gap-1.5 text-[13px] text-ok-txt outline-none">
                <CheckCircle2 size={16} aria-hidden="true" />
                Aprobada por la interventoría ({ap.aprobada_por}, {fechaLegible(ap.fecha)})
                {ap.soporte && v.id && (
                  <a className="font-semibold underline" target="_blank" rel="noopener noreferrer"
                    href={urlArchivo(`/visitas/archivo?id=${encodeURIComponent(v.id)}&blob=${encodeURIComponent(ap.soporte)}`)}>Ver soporte</a>
                )}
              </span>
            ) : esCoordinacion ? (
              <>
                <Boton tamano="sm" disabled={ocupado || !listaParaAprobar} onClick={() => setAprobando(true)}>Registrar aprobación de la interventoría</Boton>
                {!listaParaAprobar && <span className="text-[12px] text-aviso-txt">Se registra cuando la visita tenga guardadas la causa y la justificación.</span>}
              </>
            ) : (
              <span className="text-[13px] text-aviso-txt">Pendiente: la coordinación registra la aprobación de la interventoría.</span>
            )}
          </div>
        </>
      )}
      <p role="status" className="min-h-[1rem] text-[12px] text-gris-txt">{estado}</p>
      <Dialogo abierto={aprobando} titulo="Aprobación de la interventoría" onCerrar={() => setAprobando(false)}>
        {aprobando && (
          <FormAprobacion visitaId={v.id} onCancelar={() => setAprobando(false)}
            onHecho={(item) => {
              enfocarAprobada.current = true;
              onAprobada?.(item);
              setAprobando(false);
              avisar('Aprobación de la interventoría registrada.');
            }} />
        )}
      </Dialogo>
    </div>
  );
}

// Formulario para registrar la aprobación de la visita virtual con su fecha y su soporte en PDF.
function FormAprobacion({ visitaId, onCancelar, onHecho }) {
  const { avisar } = useAvisos();
  const [fecha, setFecha] = useState(hoyISO());
  const [aprobadaPor, setAprobadaPor] = useState('');
  const [observacion, setObservacion] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const noEsPdf = !!archivo && !/\.pdf$/i.test(archivo.name);
  const listo = fecha && aprobadaPor.trim() && archivo && !noEsPdf;

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append('visita_id', visitaId);
      cuerpo.append('fecha', fecha);
      cuerpo.append('aprobada_por', aprobadaPor.trim());
      if (observacion.trim()) cuerpo.append('observacion', observacion.trim());
      cuerpo.append('archivo', archivo);
      const r = await apiGeneral.post('/visitas/aprobacion-virtual', cuerpo);
      onHecho(r.item);
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-3">
      <Alerta tono="info">La aprobación vale para la causa y la justificación guardadas en la visita, y queda registrada con tu nombre.</Alerta>
      <Campo etiqueta="Fecha de la aprobación" obligatorio>
        <Entrada type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      <Campo etiqueta="Quién aprobó en la interventoría" obligatorio>
        <Entrada maxLength={200} value={aprobadaPor} onChange={(e) => setAprobadaPor(e.target.value)} />
      </Campo>
      <Campo etiqueta="Observación">
        <AreaTexto rows={2} maxLength={1000} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
      </Campo>
      <Campo etiqueta="Soporte de la aprobación (PDF)" obligatorio error={noEsPdf ? 'El soporte debe ser un PDF.' : undefined}>
        <input type="file" accept=".pdf,application/pdf" className="text-[13px] text-gris-txt" aria-invalid={noEsPdf || undefined} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
      </Campo>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCancelar} disabled={enviando}>Cancelar</Boton>
        <Boton tipo="submit" cargando={enviando} disabled={!listo}>Registrar aprobación</Boton>
      </div>
    </form>
  );
}
