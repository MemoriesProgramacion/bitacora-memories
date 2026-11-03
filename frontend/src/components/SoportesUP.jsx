// Expediente documental de la unidad en su ficha: todos los soportes (repositorio, talleres, eventos, retiros,
// comité, facturas, kits, defectuosos, casos y gestiones comerciales) por serie documental, con lo que falta en
// cada etapa, sus versiones anteriores y quién los verificó.
import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, CircleCheck, CircleDashed, FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { apiGeneral, qs } from '../inventario/lib/api';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Insignia, Vacio, useAvisos } from '../inventario/componentes/ui';
import { urlArchivo } from '../lib/api';
import { diaColombia } from '../lib/carrito';
import { descargarExcel } from '../lib/exportarExcel';
import { columnasSoportes, porSerie, textoSoporte, textoVersion } from '../lib/seguimiento';

const ENLACE = 'inline-flex items-center gap-1 font-semibold text-acento-txt underline';

// Marca un soporte como verificado o, si ya lo está, actualiza la verificación; el servidor la reemplaza con la
// nueva fecha.
function Verificar({ soporte, idUnico, onListo, onCerrar }) {
  const { avisar } = useAvisos();
  const [observacion, setObservacion] = useState(soporte.verificacion?.observacion || '');
  const [ocupado, setOcupado] = useState(false);
  const yaVerificado = Boolean(soporte.verificacion);
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await apiGeneral.post('/seguimiento/soportes/verificar', { id_unico: idUnico, origen: soporte.origen, ref: soporte.ref, observacion });
      avisar(yaVerificado ? 'Verificación actualizada.' : 'Soporte verificado.');
      onListo();
    } catch (err) {
      avisar(err.message, 'error');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={enviar}>
      <p className="break-words text-[13px]"><strong>{soporte.tipo}</strong> · {soporte.nombre}</p>
      {yaVerificado && <p className="text-[12px] text-gris-txt">Lo verificó {soporte.verificacion.verificado_por} el {diaColombia(soporte.verificacion.verificado_en)}. Al guardar, la verificación queda a tu nombre con la fecha de hoy.</p>}
      <Campo etiqueta="Observación (opcional)"><AreaTexto rows={3} maxLength={1000} value={observacion} onChange={(e) => setObservacion(e.target.value)} /></Campo>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" icono={BadgeCheck} cargando={ocupado}>{yaVerificado ? 'Actualizar la verificación' : 'Marcar como verificado'}</Boton>
      </div>
    </form>
  );
}

// Pide el índice de soportes de la unidad y lo muestra por serie, con la opción de exportarlo.
export default function SoportesUP({ idUnico }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [verificando, setVerificando] = useState(null);
  const cargar = useCallback(() => {
    setError('');
    apiGeneral.get(`/seguimiento/soportes${qs({ id_unico: idUnico })}`).then(setDatos)
      .catch((err) => setError(err.message || 'No se pudo cargar el expediente de la unidad.'));
  }, [idUnico]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  if (error) return <Alerta tono="error">{error} <Boton variante="fantasma" tamano="sm" onClick={cargar}>Reintentar</Boton></Alerta>;
  if (!datos) return <Cargando texto="Cargando el expediente" />;
  const grupos = porSerie(datos.items, datos.series);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-gris-txt">{datos.items.length} soportes. Cada etapa muestra lo que debe tener el expediente.</p>
        <span className="flex flex-wrap items-center gap-3">
          {datos.items.length > 0 && <Boton variante="fantasma" tamano="sm" icono={FileSpreadsheet} onClick={() => descargarExcel(`expediente-${idUnico}`, 'Expediente', columnasSoportes(), datos.items)}>Excel del expediente</Boton>}
          <a className={ENLACE} href={urlArchivo(`/seguimiento/informe-up${qs({ id_unico: idUnico })}`)} target="_blank" rel="noopener noreferrer"><FileText size={15} aria-hidden="true" />Informe técnico de la unidad (PDF)</a>
        </span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {datos.completitud.map((c) => (
          <li key={c.serie} className="rounded-xl border border-borde p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-marca">{c.nombre_serie}</span>
              <Insignia tono={c.completa ? 'ok' : 'alerta'}>{c.completa ? 'Completa' : 'Incompleta'}</Insignia>
            </div>
            <ul className="mt-2 grid gap-1">
              {c.items.map((x) => (
                <li key={x.nombre} className="flex items-start gap-1.5">
                  {x.presente ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok-txt" aria-hidden="true" /> : <CircleDashed size={15} className="mt-0.5 shrink-0 text-gris" aria-hidden="true" />}
                  <span className={x.presente ? '' : 'text-gris-txt'}>{x.nombre}<span className="sr-only">{x.presente ? ': está' : ': falta'}</span></span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {!grupos.length ? <Vacio>La unidad todavía no tiene soportes cargados.</Vacio> : grupos.map((g) => (
        <section key={g.clave} aria-label={`Soportes de ${g.nombre}`} className="grid gap-2">
          <h4 className="text-[13px] font-semibold text-marca">{g.nombre} ({g.items.length})</h4>
          <ul className="grid gap-2">
            {g.items.map((x) => (
              <li key={`${x.origen}|${x.ref}`} className="grid gap-1 rounded-xl border border-borde p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a className={`${ENLACE} min-w-0 break-all`} href={urlArchivo(x.url)} target="_blank" rel="noopener noreferrer"><FileDown size={15} aria-hidden="true" className="shrink-0" />{x.nombre || x.tipo}</a>
                  <span className="flex flex-wrap items-center gap-2">
                    {x.verificacion && <Insignia tono="ok" ajustar>Verificado por {x.verificacion.verificado_por} el {diaColombia(x.verificacion.verificado_en)}</Insignia>}
                    {datos.puede_verificar && (
                      <Boton variante="fantasma" tamano="sm" icono={BadgeCheck} onClick={() => setVerificando(x)}
                        aria-label={`${x.verificacion ? 'Actualizar verificación' : 'Verificar'}: ${x.nombre || x.tipo}`}>
                        {x.verificacion ? 'Actualizar verificación' : 'Verificar'}
                      </Boton>
                    )}
                  </span>
                </div>
                <p className="break-words text-gris-txt">{x.tipo}{textoSoporte(x) ? ` · ${textoSoporte(x)}` : ''}{x.versiones ? ` · ${x.versiones} ${x.versiones === 1 ? 'versión anterior' : 'versiones anteriores'}` : ''}</p>
                {x.verificacion?.observacion && <p className="break-words text-[12px]">Observación: {x.verificacion.observacion}</p>}
                {x.anteriores?.length > 0 && (
                  <details className="text-[12px]">
                    <summary className="cursor-pointer font-semibold text-gris-txt">Ver las versiones anteriores ({x.anteriores.length})</summary>
                    <ol className="mt-1 grid gap-1">
                      {x.anteriores.map((v, i) => (
                        <li key={v.id} className="break-words">
                          <a className={ENLACE} href={urlArchivo(v.url)} target="_blank" rel="noopener noreferrer"
                            aria-label={`Versión ${x.anteriores.length - i} de ${x.nombre}`}><FileDown size={14} aria-hidden="true" />Versión {x.anteriores.length - i}</a>
                          {' · '}{textoVersion(v)}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialogo abierto={Boolean(verificando)} titulo={verificando?.verificacion ? 'Actualizar la verificación' : 'Verificar el soporte'} onCerrar={() => setVerificando(null)}>
        {verificando && <Verificar soporte={verificando} idUnico={idUnico} onCerrar={() => setVerificando(null)} onListo={() => { setVerificando(null); cargar(); }} />}
      </Dialogo>
    </div>
  );
}
