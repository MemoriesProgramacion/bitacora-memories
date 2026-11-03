// Piezas compartidas de los formularios por secciones del diagnóstico y de la evaluación de salida: una sección
// desplegable que se edita y guarda por separado, el campo según su tipo, la tarjeta de dato y el panel de
// revisión. Los campos y sus reglas los manda el servidor.
import { useEffect, useRef, useState } from 'react';
import { Check, Plus, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react';
import { AreaTexto, Boton, Campo, Dialogo, Entrada, Insignia, Seleccion } from '../inventario/componentes/ui';
import { hoyISO, fechaLegible } from '../lib/asociados';
import { aEnvio, aFormulario, esObligatorio, hayCambios, textoValor } from '../lib/secciones';

export function Dato({ etiqueta, valor }) {
  return (
    <div className="rounded-xl border border-borde bg-lienzo/60 p-3">
      <div className="text-[12px] font-medium text-gris-txt">{etiqueta}</div>
      <div className="cifras mt-1 text-[16px] font-semibold text-marca">{valor}</div>
    </div>
  );
}

// Sección desplegable; con editable muestra el formulario y el botón de guardar, y si no, los valores.
export function SeccionEditable({ seccion, guardado, sugerido, editable, abierta, onAlternar, ocupado, onGuardar, faltantes, onSucio, enfocar, children }) {
  const base = guardado || sugerido;
  const [f, setF] = useState(() => aFormulario(seccion, base));
  const faltanGuardado = faltantes(seccion, guardado);
  const actual = aEnvio(seccion, f);
  const faltanAhora = faltantes(seccion, actual);
  const sucio = editable && hayCambios(seccion, f, base);
  const soloSugerido = editable && !guardado && !!sugerido;
  const avisar = useRef(onSucio);
  avisar.current = onSucio;
  useEffect(() => { avisar.current?.(sucio); }, [sucio]);
  useEffect(() => () => avisar.current?.(false), []);
  const cabecera = useRef(null);
  useEffect(() => { if (enfocar) cabecera.current?.focus(); }, [enfocar]);
  const cambiar = (clave, valor) => setF((x) => ({ ...x, [clave]: valor }));

  return (
    <div className="rounded-xl border border-borde">
      <button ref={cabecera} type="button" onClick={onAlternar} aria-expanded={abierta}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-left">
        <span className="text-[14px] font-semibold text-marca">{seccion.titulo}</span>
        <span className="flex flex-wrap gap-1.5">
          {sucio && <Insignia tono="alerta">Sin guardar</Insignia>}
          {!sucio && soloSugerido && <Insignia tono="neutro">Datos sugeridos: revísalos y guárdalos</Insignia>}
          <Insignia tono={faltanGuardado.length ? 'alerta' : 'ok'}>
            {faltanGuardado.length ? `Faltan ${faltanGuardado.length}` : 'Completa'}
          </Insignia>
        </span>
      </button>
      <div hidden={!abierta} className="flex flex-col gap-3 border-t border-borde p-3.5">
        {seccion.ayuda && <p className="text-[12px] text-gris">{seccion.ayuda}</p>}
        {children}
        {seccion.campos.length > 0 && (editable ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {seccion.campos.map((c) => (
                <CampoEsquema key={c.clave} c={c} valor={f[c.clave]} onCambio={(v) => cambiar(c.clave, v)} obligatorio={esObligatorio(c, actual)} />
              ))}
            </div>
            {faltanAhora.length > 0 && (
              <p className="text-[12px] text-aviso-txt">Para completar la sección falta: {faltanAhora.join(', ')}. Puedes guardar lo que llevas.</p>
            )}
            <div>
              <Boton tamano="sm" icono={Check} cargando={ocupado} onClick={() => onGuardar(f)}>Guardar sección</Boton>
            </div>
          </>
        ) : (
          <dl className="grid gap-2.5 sm:grid-cols-2">
            {seccion.campos.map((c) => (
              <div key={c.clave} className={`rounded-lg bg-lienzo/60 p-2.5 ${c.tipo === 'texto_largo' || c.tipo === 'lista_textos' ? 'sm:col-span-2' : ''}`}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gris">{c.etiqueta}</dt>
                <dd className="mt-0.5 break-words text-[13px] text-marca">{textoValor(c, guardado?.[c.clave])}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}

// Dibuja un campo según su tipo; las cifras van como texto porque el servidor entiende 1.500.000 y 1500,75.
export function CampoEsquema({ c, valor, onCambio, obligatorio }) {
  const ancho = c.tipo === 'texto_largo' || c.tipo === 'lista_textos' ? 'sm:col-span-2' : '';
  if (c.tipo === 'lista_textos') {
    const items = valor || [''];
    return (
      <fieldset className={`flex flex-col gap-2 ${ancho}`}>
        <legend className="mb-1 text-[13px] font-semibold text-gris-txt">
          {c.etiqueta}
          {obligatorio && (
            <>
              <span aria-hidden="true" className="ml-0.5 text-rojo-txt">*</span>
              <span className="sr-only"> (obligatorio)</span>
            </>
          )}
        </legend>
        {items.map((x, i) => (
          <div key={i} className="flex gap-2">
            <Entrada value={x} maxLength={c.max} aria-label={`${c.etiqueta} ${i + 1}`}
              onChange={(e) => onCambio(items.map((y, k) => (k === i ? e.target.value : y)))} />
            {items.length > 1 && (
              <Boton tamano="sm" variante="fantasma" icono={Trash2} aria-label={`Quitar ${c.etiqueta.toLowerCase()} ${i + 1}`}
                onClick={() => onCambio(items.filter((_, k) => k !== i))} />
            )}
          </div>
        ))}
        {items.length < c.max_items && (
          <div>
            <Boton tamano="sm" variante="fantasma" icono={Plus} onClick={() => onCambio([...items, ''])}>Agregar</Boton>
          </div>
        )}
      </fieldset>
    );
  }
  let control;
  if (c.tipo === 'sino' || c.tipo === 'lista' || c.tipo === 'escala') {
    const opciones = c.tipo === 'sino' ? [{ codigo: 'si', nombre: 'Sí' }, { codigo: 'no', nombre: 'No' }]
      : c.tipo === 'escala' ? [1, 2, 3, 4, 5].map((n) => ({ codigo: String(n), nombre: `${n}${n === 1 ? ' · muy insatisfecho' : n === 5 ? ' · muy satisfecho' : ''}` }))
        : c.opciones;
    control = (
      <Seleccion value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">Elige…</option>
        {opciones.map((o) => <option key={o.codigo} value={o.codigo}>{o.nombre}</option>)}
      </Seleccion>
    );
  } else if (c.tipo === 'texto_largo') {
    control = <AreaTexto rows={3} maxLength={c.max} value={valor} onChange={(e) => onCambio(e.target.value)} />;
  } else if (c.tipo === 'fecha') {
    control = <Entrada type="date" max={hoyISO()} value={valor} onChange={(e) => onCambio(e.target.value)} />;
  } else if (c.tipo === 'entero' || c.tipo === 'pesos') {
    control = (
      <Entrada inputMode={c.tipo === 'pesos' ? 'decimal' : 'numeric'} autoComplete="off" value={valor} maxLength={20}
        placeholder={c.tipo === 'pesos' ? 'Ej. 1.500.000' : 'Ej. 120'} onChange={(e) => onCambio(e.target.value)} />
    );
  } else {
    control = <Entrada value={valor} maxLength={c.max} onChange={(e) => onCambio(e.target.value)} />;
  }
  return (
    <Campo etiqueta={c.etiqueta} ayuda={c.ayuda} obligatorio={obligatorio} className={ancho}>
      {control}
    </Campo>
  );
}

// Panel de revisión de la coordinación: marcar revisado, devolver con observación o reenviar, con su historial.
export function PanelRevision({ datos, ocupado, onRevisar, onDevolver, onReenviar, completo }) {
  const [devolviendo, setDevolviendo] = useState(false);
  const [obs, setObs] = useState('');
  return (
    <>
      {(datos.puede_revisar || datos.puede_devolver || datos.puede_reenviar) && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-borde p-3.5">
          <span className="w-full text-[13px] font-semibold text-marca">Revisión de la coordinación</span>
          {datos.puede_revisar && <Boton tamano="sm" icono={Check} cargando={ocupado} onClick={onRevisar}>Marcar revisado</Boton>}
          {datos.puede_devolver && (
            <Boton tamano="sm" variante="peligro" icono={Undo2} disabled={ocupado} onClick={() => { setObs(''); setDevolviendo(true); }}>Devolver al gestor</Boton>
          )}
          {datos.puede_reenviar && (
            <Boton tamano="sm" icono={Send} cargando={ocupado} disabled={!completo} onClick={onReenviar}>Reenviar a revisión</Boton>
          )}
        </div>
      )}
      {datos.revision.historial.length > 0 && (
        <details className="rounded-xl border border-borde p-3.5">
          <summary className="cursor-pointer text-[13px] font-semibold text-marca">Historial de revisión ({datos.revision.historial.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-gris-txt">
            {datos.revision.historial.map((h, i) => (
              <li key={i}>
                <b className="text-marca">{h.decision === 'revisado' ? 'Revisado' : 'Devuelto'}</b> · {fechaLegible(h.en)} · {h.por || '—'}
                {h.observacion && <> · {h.observacion}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Dialogo abierto={devolviendo} titulo="Devolver al gestor" onCerrar={() => !ocupado && setDevolviendo(false)}>
        <div className="flex flex-col gap-4">
          <Campo etiqueta="Qué debe corregir el gestor" obligatorio>
            <AreaTexto rows={4} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
          </Campo>
          <div className="flex flex-wrap justify-end gap-2">
            <Boton variante="fantasma" onClick={() => setDevolviendo(false)} disabled={ocupado}>Cancelar</Boton>
            <Boton variante="peligro" icono={RotateCcw} cargando={ocupado} disabled={!obs.trim()}
              onClick={async () => { if (await onDevolver(obs.trim())) setDevolviendo(false); }}>Devolver</Boton>
          </div>
        </div>
      </Dialogo>
    </>
  );
}

// Hook que, mientras haya cambios sin guardar, hace que el navegador pregunte antes de cerrar o recargar la
// página.
export function useAvisoSalida(activo) {
  useEffect(() => {
    if (!activo) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [activo]);
}
