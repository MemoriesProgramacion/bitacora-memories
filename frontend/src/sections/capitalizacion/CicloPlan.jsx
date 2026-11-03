// Ciclo del plan de capitalización: por dónde va el plan y quién lo movió, el visto bueno de viabilidad, el
// resultado del comité, la subsanación con su plazo de 4 días hábiles, el 80 % de formación y la ficha técnica
// aprobada de cada activo antes de comprar. El servidor decide quién puede hacer cada cosa.
import { useState } from 'react';
import { CheckCircle2, FileDown, FileUp, History, RotateCcw, ShieldCheck } from 'lucide-react';
import { AreaTexto, Alerta, Boton, Campo, Confirmar, Dialogo, Entrada, Insignia, Seleccion, Tarjeta } from '../../inventario/componentes/ui';
import { ESTADOS_CARRITO, ORDEN_CICLO, textoHistorial, textoSubsanacion } from '../../lib/carrito';
import { hoyISO } from '../../lib/asociados';

const esPdf = (a) => !!a && /\.pdf$/i.test(a.name);
// Muestra un enlace a un soporte; etiqueta dice de qué es, porque varios dicen Soporte o Ficha en la misma
// pantalla.
const Enlace = ({ url, etiqueta, children }) => (
  <a href={`/api${url}`} target="_blank" rel="noopener noreferrer" aria-label={etiqueta} className="inline-flex items-center gap-1 font-semibold text-acento-txt underline">
    <FileDown size={15} aria-hidden="true" />{children}
  </a>
);

function CampoPdf({ etiqueta, archivo, onCambio }) {
  const malo = !!archivo && !esPdf(archivo);
  return (
    <Campo etiqueta={etiqueta} obligatorio error={malo ? 'Debe ser un PDF.' : undefined}>
      <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={malo || undefined} onChange={(e) => onCambio(e.target.files?.[0] || null)} />
    </Campo>
  );
}

// Formulario del visto bueno de viabilidad: si es viable pasa al comité y si no, devuelve el plan con las
// observaciones.
function FormViabilidad({ carrito, onCerrar }) {
  const [f, setF] = useState({ viable: '', fecha: hoyISO(), responsable: '', observaciones: '' });
  const [archivo, setArchivo] = useState(null);
  const faltaObs = f.viable === 'no' && !f.observaciones.trim();
  return (
    <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.viabilidad(f, archivo)) onCerrar(); }}>
      <Campo etiqueta="¿La interventoría dio el plan por viable?" obligatorio>
        <Seleccion required value={f.viable} onChange={(e) => setF((x) => ({ ...x, viable: e.target.value }))}>
          <option value="">Elige…</option><option value="si">Sí: pasa al comité</option><option value="no">No: se devuelve para corregirlo</option>
        </Seleccion>
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Fecha del visto bueno" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
        <Campo etiqueta="Responsable de la interventoría" obligatorio><Entrada required maxLength={200} value={f.responsable} onChange={(e) => setF((x) => ({ ...x, responsable: e.target.value }))} /></Campo>
      </div>
      <Campo etiqueta="Observaciones" obligatorio={f.viable === 'no'} error={faltaObs ? 'Escribe las observaciones: el plan no es viable.' : undefined}>
        <AreaTexto rows={3} maxLength={2000} value={f.observaciones} aria-invalid={faltaObs || undefined} onChange={(e) => setF((x) => ({ ...x, observaciones: e.target.value }))} />
      </Campo>
      <CampoPdf etiqueta="Soporte del visto bueno (PDF)" archivo={archivo} onCambio={setArchivo} />
      <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton tipo="submit" cargando={carrito.ocupado} disabled={!f.viable || !f.responsable.trim() || faltaObs || !esPdf(archivo)}>Registrar</Boton></div>
    </form>
  );
}

// Muestra los pasos del ciclo del plan.
function Pasos({ estado }) {
  const actual = { devuelto: 'borrador', en_subsanacion: 'viable', subsanado: 'viable' }[estado] || estado;
  const i = ORDEN_CICLO.indexOf(actual);
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Pasos del ciclo del plan">
      {ORDEN_CICLO.map((e, k) => (
        <li key={e} aria-current={k === i ? 'step' : undefined}
          className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${k < i ? 'border-ok bg-ok/10 text-ok-txt' : k === i ? 'border-acento bg-acento-bg text-acento-txt' : 'border-borde text-gris-txt'}`}>
          {ESTADOS_CARRITO[e].texto}
        </li>
      ))}
    </ol>
  );
}

// Muestra el estado del ciclo del plan con sus acciones.
export function CicloPlan({ c, carrito }) {
  const [viabilidad, setViabilidad] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const v = c.viabilidad;
  const s = c.subsanacion;
  const estado = ESTADOS_CARRITO[c.estado];
  return (
    <Tarjeta titulo="Ciclo del plan" acciones={<Insignia tono={estado.tono}>{estado.texto}</Insignia>}>
      <div className="grid gap-3 text-[13px]">
        <Pasos estado={c.estado} />
        {c.formacion && (
          <p className={c.formacion.cumple ? 'text-ok-txt' : 'text-rojo-txt'}>
            Formación de la unidad: {c.formacion.porcentaje} %{c.formacion.cumple ? ' (cumple el 80 %).' : ': sin el 80 % no se presenta al comité ni pasa a compra.'}
          </p>
        )}
        <div className="grid gap-1 rounded-lg border border-borde p-3">
          <strong className="text-marca">Viabilidad de la interventoría</strong>
          {v ? (
            <p className="break-words">
              {v.viable ? 'Viable' : 'No viable'} · {v.fecha} · {v.responsable}{v.observaciones ? ` · ${v.observaciones}` : ''}
              {v.soporte_url && <> · <Enlace url={v.soporte_url} etiqueta="Soporte del visto bueno de la interventoría">Soporte</Enlace></>}
            </p>
          ) : <p className="text-gris-txt">Sin registrar. Se registra cuando la coordinación marca el plan como revisado.</p>}
          {c.puede_viabilidad && <div><Boton tamano="sm" icono={ShieldCheck} onClick={() => setViabilidad(true)}>Registrar la viabilidad</Boton></div>}
        </div>
        <div className="grid gap-1 rounded-lg border border-borde p-3">
          <strong className="text-marca">Comité de aprobación</strong>
          {c.comite ? (
            <p>Comité del {c.comite.fecha}: calificaciones {c.comite.calificaciones.join(', ')} · promedio {c.comite.promedio} ·{' '}
              <span className={c.comite.resultado === 'aprobado' ? 'font-semibold text-ok-txt' : 'font-semibold text-rojo-txt'}>{c.comite.resultado === 'aprobado' ? 'Aprobado' : 'No aprobado'}</span>
              {c.comite.observacion ? ` · ${c.comite.observacion}` : ''}</p>
          ) : <p className="text-gris-txt">El plan viable lo califica el comité (pestaña «Comité»).</p>}
        </div>
        {s && (
          <div className="grid gap-1 rounded-lg border border-borde p-3">
            <strong className="text-marca">Subsanación</strong>
            {c.estado === 'en_subsanacion' ? <Alerta tono={s.vencida ? 'error' : 'aviso'}>{textoSubsanacion(s)}</Alerta>
              : <p className="text-gris-txt">Desde el comité del {s.desde}; plazo hasta el {s.plazo}.</p>}
            {s.reaperturas?.length > 0 && <p className="text-gris-txt">Reabierta {s.reaperturas.length} vez/veces: {s.reaperturas.map((r) => r.motivo).join('; ')}.</p>}
            {c.puede_reabrir_subsanacion && <div><Boton tamano="sm" variante="fantasma" icono={RotateCcw} onClick={() => { setMotivo(''); setReabriendo(true); }}>Reabrir la subsanación</Boton></div>}
          </div>
        )}
        {c.historial?.length > 0 && (
          <details className="rounded-lg border border-borde p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-marca"><History size={15} aria-hidden="true" />Historial del plan ({c.historial.length})</summary>
            <ol className="mt-2 grid gap-1">
              {[...c.historial].reverse().map((h, i) => <li key={i} className="break-words text-gris-txt">{textoHistorial(h)}</li>)}
            </ol>
          </details>
        )}
      </div>
      <Dialogo abierto={viabilidad} titulo="Viabilidad de la interventoría" onCerrar={() => setViabilidad(false)}>
        {viabilidad && <FormViabilidad carrito={carrito} onCerrar={() => setViabilidad(false)} />}
      </Dialogo>
      <Dialogo abierto={reabriendo} titulo="Reabrir la subsanación vencida" onCerrar={() => setReabriendo(false)}>
        {reabriendo && (
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.reabrirSubsanacion(motivo.trim())) setReabriendo(false); }}>
            <p>La unidad vuelve a tener 4 días hábiles desde hoy para subsanar el plan.</p>
            <Campo etiqueta="Motivo" obligatorio><AreaTexto required rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setReabriendo(false)}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={!motivo.trim()}>Reabrir</Boton></div>
          </form>
        )}
      </Dialogo>
    </Tarjeta>
  );
}

// Muestra la ficha técnica de cada activo del plan aprobado y su aprobación; sin todas aprobadas no se compra.
export function FichasTecnicas({ c, lineas, carrito }) {
  const [subiendo, setSubiendo] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [aprobando, setAprobando] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [f, setF] = useState({ fecha: hoyISO(), aprobada_por: '' });
  if (!['aprobado', 'en_compra', 'entregado'].includes(c.estado) || !lineas.length) return null;
  const aprobadas = lineas.filter((l) => l.ficha_tecnica?.aprobacion).length;
  const cerrar = () => { setSubiendo(null); setAprobando(null); setArchivo(null); };
  return (
    <Tarjeta titulo="Fichas técnicas de los activos" acciones={<Insignia tono={aprobadas === lineas.length ? 'ok' : 'alerta'}>{aprobadas} de {lineas.length} aprobadas</Insignia>}>
      <ul className="grid gap-2 text-[13px]">
        {lineas.map((l) => {
          const ft = l.ficha_tecnica;
          return (
            <li key={l.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-borde px-3 py-2">
              <span className="min-w-0 break-words">
                <strong>{l.nombre}</strong>
                {ft ? <> · <Enlace url={ft.soporte_url} etiqueta={`Ficha técnica de ${l.nombre}`}>Ficha</Enlace></> : ' · sin ficha técnica'}
                {ft?.aprobacion && <> · <CheckCircle2 size={14} aria-hidden="true" className="inline text-ok" /> aprobada el {ft.aprobacion.fecha} por {ft.aprobacion.aprobada_por} · <Enlace url={ft.aprobacion.soporte_url} etiqueta={`Soporte de la aprobación de la ficha de ${l.nombre}`}>Soporte</Enlace></>}
              </span>
              {c.puede_fichas && (
                <span className="flex flex-wrap gap-2">
                  <Boton tamano="sm" variante="fantasma" icono={FileUp} onClick={() => { setArchivo(null); if (ft?.aprobacion) setConfirmando(l); else setSubiendo(l); }}>{ft ? 'Reemplazar la ficha' : 'Cargar la ficha'}</Boton>
                  {ft && !ft.aprobacion && <Boton tamano="sm" icono={ShieldCheck} onClick={() => { setArchivo(null); setF({ fecha: hoyISO(), aprobada_por: '' }); setAprobando(l); }}>Registrar la aprobación</Boton>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {c.puede_fichas && <p className="mt-2 text-[12px] text-gris-txt">{aprobadas > 0 ? 'Reemplazar una ficha aprobada quita su aprobación. ' : ''}Sin todas aprobadas el plan no pasa a compra.</p>}
      <Confirmar abierto={Boolean(confirmando)} titulo="¿Reemplazar una ficha técnica aprobada?" icono={FileUp}
        texto={`La ficha de «${confirmando?.nombre || ''}» ya tiene la aprobación de la interventoría. Al reemplazarla, la aprobación se quita y hay que registrarla de nuevo.`}
        etiquetaOk="Reemplazar" onCancelar={() => setConfirmando(null)}
        onOk={() => { const l = confirmando; setConfirmando(null); setTimeout(() => setSubiendo(l), 250); }} />
      <Dialogo abierto={Boolean(subiendo)} titulo={`Ficha técnica · ${subiendo?.nombre || ''}`} onCerrar={cerrar}>
        {subiendo && (
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.fichaTecnica(subiendo.id, archivo)) cerrar(); }}>
            <CampoPdf etiqueta="Ficha técnica (PDF)" archivo={archivo} onCambio={setArchivo} />
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={cerrar}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={!esPdf(archivo)}>Cargar</Boton></div>
          </form>
        )}
      </Dialogo>
      <Dialogo abierto={Boolean(aprobando)} titulo={`Aprobación de la ficha · ${aprobando?.nombre || ''}`} onCerrar={cerrar}>
        {aprobando && (
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.aprobarFicha({ id_linea: aprobando.id, ...f }, archivo)) cerrar(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Fecha de la aprobación" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
              <Campo etiqueta="Aprobada por (interventoría)" obligatorio><Entrada required maxLength={200} value={f.aprobada_por} onChange={(e) => setF((x) => ({ ...x, aprobada_por: e.target.value }))} /></Campo>
            </div>
            <CampoPdf etiqueta="Soporte de la aprobación (PDF)" archivo={archivo} onCambio={setArchivo} />
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={cerrar}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={!f.aprobada_por.trim() || !esPdf(archivo)}>Registrar</Boton></div>
          </form>
        )}
      </Dialogo>
    </Tarjeta>
  );
}
