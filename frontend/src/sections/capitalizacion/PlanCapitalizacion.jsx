// Plan de capitalización de la iniciativa elegida: lo que el anexo pide además del carrito, es decir, el plan
// de negocio, las adecuaciones técnicas de la sede, las tres cotizaciones por activo con la elegida, la
// coherencia y pertinencia que evalúa la coordinación y el plan firmado por la unidad y el consultor. El
// servidor exige todo al enviar y al aprobar; aquí se ve qué falta.
import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, FileDown, FileSignature, Plus, Save, Trash2, X } from 'lucide-react';
import { apiGeneral, pesos, qs } from '../../inventario/lib/api';
import {
  Alerta, AreaTexto, Boton, Campo, Cargando, Dialogo, Entrada, Insignia, Seleccion, Tarjeta, Vacio, useAvisos,
} from '../../inventario/componentes/ui';
import SelectorIniciativa from '../../components/SelectorIniciativa';
import { CAMPOS_MERCADEO, ESTADOS_CARRITO, avanceCotizaciones, formularioAPlan, planAFormulario, problemasPara, textoTransporte, valorPesos } from '../../lib/carrito';
import { hoyISO } from '../../lib/asociados';
import { useCarrito } from './useCarrito';
import { CicloPlan, FichasTecnicas } from './CicloPlan';
import EntregaBeneficiario from './EntregaBeneficiario';

// Lista de textos editable, usada para las acciones de una dimensión y las necesidades de asistencia técnica.
function ListaTextos({ etiqueta, valores, onCambio, editable }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-semibold text-marca">{etiqueta} <span className="text-rojo-txt" aria-hidden="true">*</span></legend>
      {valores.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Entrada aria-label={`${etiqueta} ${i + 1}`} maxLength={500} value={v} disabled={!editable} className="min-w-0 flex-1"
            onChange={(e) => onCambio(valores.map((x, k) => (k === i ? e.target.value : x)))} />
          {editable && valores.length > 1 && (
            <Boton variante="fantasma" tamano="sm" icono={X} aria-label={`Quitar ${etiqueta.toLowerCase()} ${i + 1}`} onClick={() => onCambio(valores.filter((_, k) => k !== i))} />
          )}
        </div>
      ))}
      {editable && valores.length < 20 && <div><Boton variante="fantasma" tamano="sm" icono={Plus} onClick={() => onCambio([...valores, ''])}>Agregar</Boton></div>}
    </fieldset>
  );
}

// Formulario del plan de negocio estructurado.
function PlanNegocio({ c, listas, carrito }) {
  const [f, setF] = useState(() => planAFormulario(c.plan_negocio, listas.dimensiones));
  const guardadoPlan = JSON.stringify(c.plan_negocio || null);
  useEffect(() => { setF(planAFormulario(c.plan_negocio, listas.dimensiones)); }, [c.id_unico, guardadoPlan]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = c.puede_editar;
  const fila = (clave, i, campo, valor) => setF((x) => ({ ...x, [clave]: x[clave].map((r, k) => (k === i ? { ...r, [campo]: valor } : r)) }));
  return (
    <Tarjeta titulo="Plan de negocio" acciones={c.plan_negocio ? <Insignia tono="ok">Guardado</Insignia> : <Insignia>Sin registrar</Insignia>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); carrito.planNegocio(formularioAPlan(f, listas.dimensiones)); }}>
        <fieldset disabled={carrito.ocupado} className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {listas.dimensiones.map((d) => (
              <ListaTextos key={d.clave} etiqueta={d.nombre} valores={f[d.clave]} editable={editable} onCambio={(v) => setF((x) => ({ ...x, [d.clave]: v }))} />
            ))}
          </div>
          <Campo etiqueta="Propuesta de valor" obligatorio>
            <AreaTexto rows={2} maxLength={2000} value={f.propuesta_valor} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, propuesta_valor: e.target.value }))} />
          </Campo>
          <ListaTextos etiqueta="Necesidades de asistencia técnica" valores={f.asistencia_tecnica} editable={editable} onCambio={(v) => setF((x) => ({ ...x, asistencia_tecnica: v }))} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-marca">Plan de mercadeo <span className="text-rojo-txt" aria-hidden="true">*</span><span className="sr-only"> (obligatorio)</span></legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CAMPOS_MERCADEO.map((c) => (
                <Campo key={c.clave} etiqueta={c.nombre}>
                  <AreaTexto rows={2} maxLength={1000} value={f.mercadeo[c.clave]} disabled={!editable}
                    onChange={(e) => setF((x) => ({ ...x, mercadeo: { ...x.mercadeo, [c.clave]: e.target.value } }))} />
                </Campo>
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-marca">Plan de acción <span className="text-rojo-txt" aria-hidden="true">*</span></legend>
            {f.plan_accion.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-borde p-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_10rem_auto] sm:items-end">
                <Campo etiqueta="Acción"><Entrada maxLength={500} value={r.accion} disabled={!editable} onChange={(e) => fila('plan_accion', i, 'accion', e.target.value)} /></Campo>
                <Campo etiqueta="Responsable"><Entrada maxLength={200} value={r.responsable} disabled={!editable} onChange={(e) => fila('plan_accion', i, 'responsable', e.target.value)} /></Campo>
                <Campo etiqueta="Fecha"><Entrada type="date" value={r.fecha} disabled={!editable} onChange={(e) => fila('plan_accion', i, 'fecha', e.target.value)} /></Campo>
                {editable && f.plan_accion.length > 1 && <Boton variante="fantasma" tamano="sm" icono={X} aria-label={`Quitar la acción ${i + 1}`} onClick={() => setF((x) => ({ ...x, plan_accion: x.plan_accion.filter((_, k) => k !== i) }))} />}
              </div>
            ))}
            {editable && <div><Boton variante="fantasma" tamano="sm" icono={Plus} onClick={() => setF((x) => ({ ...x, plan_accion: [...x.plan_accion, { accion: '', responsable: '', fecha: '' }] }))}>Agregar acción</Boton></div>}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-marca">Análisis de riesgos <span className="text-rojo-txt" aria-hidden="true">*</span></legend>
            {f.riesgos.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-borde p-2.5 sm:grid-cols-[minmax(0,2fr)_9rem_minmax(0,2fr)_auto] sm:items-end">
                <Campo etiqueta="Riesgo"><Entrada maxLength={500} value={r.riesgo} disabled={!editable} onChange={(e) => fila('riesgos', i, 'riesgo', e.target.value)} /></Campo>
                <Campo etiqueta="Nivel">
                  <Seleccion value={r.nivel} disabled={!editable} onChange={(e) => fila('riesgos', i, 'nivel', e.target.value)}>
                    <option value="">Elige…</option>{listas.niveles_riesgo.map((n) => <option key={n.codigo} value={n.codigo}>{n.nombre}</option>)}
                  </Seleccion>
                </Campo>
                <Campo etiqueta="Mitigación"><Entrada maxLength={1000} value={r.mitigacion} disabled={!editable} onChange={(e) => fila('riesgos', i, 'mitigacion', e.target.value)} /></Campo>
                {editable && f.riesgos.length > 1 && <Boton variante="fantasma" tamano="sm" icono={X} aria-label={`Quitar el riesgo ${i + 1}`} onClick={() => setF((x) => ({ ...x, riesgos: x.riesgos.filter((_, k) => k !== i) }))} />}
              </div>
            ))}
            {editable && <div><Boton variante="fantasma" tamano="sm" icono={Plus} onClick={() => setF((x) => ({ ...x, riesgos: [...x.riesgos, { riesgo: '', nivel: '', mitigacion: '' }] }))}>Agregar riesgo</Boton></div>}
          </fieldset>
        </fieldset>
        {editable && <div><Boton tipo="submit" icono={Save} cargando={carrito.ocupado}>Guardar plan de negocio</Boton></div>}
      </form>
    </Tarjeta>
  );
}

// Formulario de las adecuaciones técnicas de la sede.
function Adecuaciones({ c, listas, carrito }) {
  const desde = (a) => Object.fromEntries(listas.puntos_adecuacion.map((p) => [p.clave, { estado: a?.[p.clave]?.estado || '', observacion: a?.[p.clave]?.observacion || '' }]));
  const [f, setF] = useState(() => desde(c.adecuaciones));
  const guardadas = JSON.stringify(desde(c.adecuaciones));
  useEffect(() => { setF(desde(c.adecuaciones)); }, [c.id_unico, guardadas]); // eslint-disable-line react-hooks/exhaustive-deps
  const sinCambios = JSON.stringify(f) === guardadas;
  const editable = c.puede_editar;
  const noCumple = listas.puntos_adecuacion.some((p) => c.adecuaciones?.[p.clave]?.estado === 'no_cumple');
  return (
    <Tarjeta titulo="Adecuaciones técnicas de la sede"
      acciones={!c.adecuaciones ? <Insignia>Sin verificar</Insignia> : noCumple ? <Insignia tono="error">Hay puntos que no cumplen</Insignia> : <Insignia tono="ok">Verificadas</Insignia>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); carrito.adecuaciones(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { estado: v.estado || null, observacion: v.observacion }]))); }}>
        <p className="text-[13px] text-gris-txt">Antes de la compra: si la sede tiene lo que necesitan los activos. Un «No cumple» impide aprobar el plan hasta corregirlo.</p>
        <fieldset disabled={carrito.ocupado || !editable} className="grid gap-3 lg:grid-cols-3">
          {listas.puntos_adecuacion.map((p) => (
            <div key={p.clave} className="grid gap-2 rounded-lg border border-borde p-3">
              <Campo etiqueta={p.nombre} obligatorio>
                <Seleccion value={f[p.clave].estado} onChange={(e) => setF((x) => ({ ...x, [p.clave]: { ...x[p.clave], estado: e.target.value } }))}>
                  <option value="">Elige…</option>{listas.estados_adecuacion.map((s) => <option key={s.codigo} value={s.codigo}>{s.nombre}</option>)}
                </Seleccion>
              </Campo>
              <Campo etiqueta="Observación" obligatorio={f[p.clave].estado === 'no_cumple'}>
                <AreaTexto rows={2} maxLength={1000} value={f[p.clave].observacion} onChange={(e) => setF((x) => ({ ...x, [p.clave]: { ...x[p.clave], observacion: e.target.value } }))} />
              </Campo>
            </div>
          ))}
        </fieldset>
        {c.adecuaciones?.registrado_por && <p className="text-[12px] text-gris-txt">Registradas por {c.adecuaciones.registrado_por}.</p>}
        {editable && c.firma && !sinCambios && <p className="text-[12px] text-aviso-txt">Cambiar las adecuaciones cambia el plan: habrá que firmarlo de nuevo.</p>}
        {editable && <div><Boton tipo="submit" icono={Save} cargando={carrito.ocupado}
          disabled={sinCambios || listas.puntos_adecuacion.some((p) => f[p.clave].estado === 'no_cumple' && !f[p.clave].observacion.trim())}>Guardar adecuaciones</Boton></div>}
      </form>
    </Tarjeta>
  );
}

// Formulario de una cotización nueva para la línea: proveedor registrado, valor unitario, fecha y PDF.
function FormCotizacion({ linea, proveedores, ocupado, onGuardar, onCancelar }) {
  const usados = new Set(linea.cotizaciones.map((x) => x.id_proveedor));
  const [f, setF] = useState({ id_proveedor: '', valor_unitario: '', fecha: hoyISO() });
  const [archivo, setArchivo] = useState(null);
  const noEsPdf = !!archivo && !/\.pdf$/i.test(archivo.name);
  const valor = valorPesos(f.valor_unitario);
  const disponibles = proveedores.filter((p) => !usados.has(p.id));
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onGuardar({ id_linea: linea.id, ...f, valor_unitario: valor }, archivo); }}>
      <p className="text-[13px] text-gris-txt">{linea.nombre} · {linea.cantidad} unidad(es)</p>
      {!disponibles.length && <Alerta tono="aviso">No hay proveedores registrados disponibles para esta línea: la coordinación los crea en Proveedores.</Alerta>}
      <Campo etiqueta="Proveedor" obligatorio ayuda="Proveedores registrados; los crea la coordinación en Proveedores.">
        <Seleccion required value={f.id_proveedor} onChange={(e) => setF((x) => ({ ...x, id_proveedor: e.target.value }))}>
          <option value="">Elige…</option>
          {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.numero_documento ? ` · ${p.numero_documento}` : ''}</option>)}
        </Seleccion>
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Valor unitario (sin IVA)" obligatorio error={f.valor_unitario && valor === null ? 'Escribe el valor en pesos, por ejemplo 1.500.000 o 1500000,50.' : undefined}
          ayuda={valor !== null ? `Se registra como ${pesos(Number(valor))}.` : 'Puntos para los miles y coma para los decimales.'}>
          <Entrada required inputMode="decimal" value={f.valor_unitario} aria-invalid={(f.valor_unitario && valor === null) || undefined}
            onChange={(e) => setF((x) => ({ ...x, valor_unitario: e.target.value.replace(/[^\d.,]/g, '') }))} />
        </Campo>
        <Campo etiqueta="Fecha de la cotización" obligatorio><Entrada required type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
      </div>
      <Campo etiqueta="Cotización en PDF" obligatorio error={noEsPdf ? 'La cotización debe ser un PDF.' : undefined}>
        <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={noEsPdf || undefined} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
      </Campo>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton>
        <Boton tipo="submit" cargando={ocupado} disabled={!f.id_proveedor || valor === null || !archivo || noEsPdf}>Agregar cotización</Boton>
      </div>
    </form>
  );
}

// Muestra un activo del plan con sus cotizaciones y su evaluación.
function Activo({ l, c, minimo, carrito, onCotizar }) {
  const [eligiendo, setEligiendo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [evaluando, setEvaluando] = useState(false);
  const [ev, setEv] = useState({ coherente: '', pertinente: '', observacion: '' });
  const avance = avanceCotizaciones(l, minimo);
  const editable = c.puede_editar;
  const abrirEvaluacion = () => {
    setEv({ coherente: l.evaluacion ? String(l.evaluacion.coherente) : '', pertinente: l.evaluacion ? String(l.evaluacion.pertinente) : '', observacion: l.evaluacion?.observacion || '' });
    setEvaluando(true);
  };
  const algunNo = ev.coherente === 'false' || ev.pertinente === 'false';
  return (
    <li className="grid min-w-0 gap-3 rounded-xl border border-borde p-3.5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words text-[14px] font-semibold text-marca">{l.nombre}</div>
          <div className="cifras text-[12px] text-gris-txt">{l.cantidad} × {pesos(l.precio)}{l.iva ? ` + ${l.iva} % IVA` : ''} = {pesos(l.total)}</div>
        </div>
        <Insignia tono={avance.completo ? 'ok' : 'alerta'}>{avance.n} de {avance.minimo} cotizaciones{avance.completo ? ' · elegida' : ''}</Insignia>
      </div>
      {l.cotizaciones.length > 0 ? (
        <ul className="grid gap-1.5">
          {l.cotizaciones.map((q) => (
            <li key={q.id} className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] ${q.elegida ? 'border-ok bg-ok/5' : 'border-borde'}`}>
              <span className="min-w-0 break-words">
                <strong>{q.proveedor_nombre}</strong> · <span className="cifras">{pesos(q.valor_unitario)}</span> c/u · {q.fecha}
                {q.mas_barata && <> · <Insignia tono="ok">Más barata</Insignia></>}
                {q.elegida && <> · <Insignia tono="ok">Elegida</Insignia></>}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <a href={`/api${q.soporte_url}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-acento-txt underline"><FileDown size={15} aria-hidden="true" />PDF</a>
                {editable && !q.elegida && <Boton tamano="sm" variante="fantasma" disabled={carrito.ocupado} onClick={() => (q.mas_barata ? carrito.elegirCotizacion(q.id) : (setMotivo(''), setEligiendo(q)))}>Elegir</Boton>}
                {editable && <Boton tamano="sm" variante="fantasma" icono={Trash2} aria-label={`Quitar la cotización de ${q.proveedor_nombre}`} disabled={carrito.ocupado} onClick={() => carrito.quitarCotizacion(q.id)} />}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-gris-txt">Sin cotizaciones. Se necesitan {minimo} de proveedores distintos.</p>}
      {l.justificacion_cotizacion && <p className="text-[12px] text-gris-txt">Justificación de la elegida: {l.justificacion_cotizacion}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-2.5 text-[13px]">
        {editable && <Boton tamano="sm" variante="fantasma" icono={Plus} onClick={() => onCotizar(l)}>Agregar cotización</Boton>}
        {l.evaluacion ? (
          <span className={l.evaluacion.coherente && l.evaluacion.pertinente ? 'text-ok-txt' : 'text-rojo-txt'}>
            Coherente: {l.evaluacion.coherente ? 'Sí' : 'No'} · Pertinente: {l.evaluacion.pertinente ? 'Sí' : 'No'}
            {l.evaluacion.observacion ? ` · ${l.evaluacion.observacion}` : ''} ({l.evaluacion.evaluado_por})
          </span>
        ) : <span className="text-gris-txt">Sin evaluación de coherencia y pertinencia.</span>}
        {c.puede_evaluar && <Boton tamano="sm" variante="fantasma" icono={ClipboardCheck} onClick={abrirEvaluacion}>Evaluar coherencia y pertinencia</Boton>}
      </div>
      {l.faltas_aprobacion?.length > 0 && <p className="text-[12px] text-aviso-txt">Para aprobar: {l.faltas_aprobacion.join('; ')}.</p>}

      <Dialogo abierto={Boolean(eligiendo)} titulo="Elegir una cotización que no es la más barata" onCerrar={() => setEligiendo(null)}>
        {eligiendo && (
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.elegirCotizacion(eligiendo.id, motivo.trim())) setEligiendo(null); }}>
            <p className="text-[13px]">{eligiendo.proveedor_nombre} · {pesos(eligiendo.valor_unitario)} c/u. Su valor pasa a ser el precio de la línea.</p>
            <Campo etiqueta="Justificación" obligatorio><AreaTexto required rows={3} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setEligiendo(null)}>Cancelar</Boton><Boton tipo="submit" cargando={carrito.ocupado} disabled={!motivo.trim()}>Elegir</Boton></div>
          </form>
        )}
      </Dialogo>
      <Dialogo abierto={evaluando} titulo={`Coherencia y pertinencia · ${l.nombre}`} onCerrar={() => setEvaluando(false)}>
        {evaluando && (
          <form className="grid gap-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await carrito.evaluar(l.id, { coherente: ev.coherente === 'true', pertinente: ev.pertinente === 'true', observacion: ev.observacion.trim() })) setEvaluando(false);
          }}>
            <Campo etiqueta="¿Es coherente con la actividad económica?" obligatorio>
              <Seleccion required value={ev.coherente} onChange={(e) => setEv((x) => ({ ...x, coherente: e.target.value }))}><option value="">Elige…</option><option value="true">Sí</option><option value="false">No</option></Seleccion>
            </Campo>
            <Campo etiqueta="¿Es pertinente (lo mínimo necesario)?" obligatorio>
              <Seleccion required value={ev.pertinente} onChange={(e) => setEv((x) => ({ ...x, pertinente: e.target.value }))}><option value="">Elige…</option><option value="true">Sí</option><option value="false">No</option></Seleccion>
            </Campo>
            <Campo etiqueta="Observación" obligatorio={algunNo}><AreaTexto rows={2} maxLength={1000} value={ev.observacion} onChange={(e) => setEv((x) => ({ ...x, observacion: e.target.value }))} /></Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setEvaluando(false)}>Cancelar</Boton>
              <Boton tipo="submit" cargando={carrito.ocupado} disabled={!ev.coherente || !ev.pertinente || (algunNo && !ev.observacion.trim())}>Guardar evaluación</Boton></div>
          </form>
        )}
      </Dialogo>
    </li>
  );
}

// Muestra la carga del plan firmado por la unidad y el consultor.
function Firma({ c, carrito }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ codigo_plan: '', firma_up_nombre: '', firma_up_fecha: hoyISO(), firma_consultor_nombre: '', firma_consultor_fecha: hoyISO() });
  const [archivo, setArchivo] = useState(null);
  const noEsPdf = !!archivo && !/\.pdf$/i.test(archivo.name);
  const codigoValido = /^[0-9A-F]{12}$/.test(f.codigo_plan);
  const firma = c.firma;
  const abrir = () => { setArchivo(null); setF((x) => ({ ...x, codigo_plan: '' })); setAbierto(true); };
  return (
    <Tarjeta titulo="Firma del plan"
      acciones={!firma ? <Insignia>Sin firmar</Insignia> : firma.vigente ? <Insignia tono="ok">Firmado</Insignia> : <Insignia tono="error">El plan cambió después de firmado</Insignia>}>
      <div className="grid gap-3 text-[13px]">
        <p className="text-gris-txt">Descarga el plan, fírmalo con la unidad productiva y carga el PDF firmado con el código que trae impreso al pie. Si el plan cambia después de descargarlo, hay que descargarlo y firmarlo de nuevo.</p>        <div className="flex flex-wrap gap-2">
          <a href={`/api/carritos/plan-pdf${qs({ id_unico: c.id_unico })}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-borde px-3 text-[13px] font-semibold text-marca hover:border-acento">
            <FileDown size={16} aria-hidden="true" />Descargar el plan para firmar (PDF)
          </a>
          {c.puede_editar && <Boton variante="fantasma" icono={FileSignature} onClick={abrir}>Cargar el plan firmado</Boton>}
        </div>
        {firma && (
          <p className="break-words">
            <CheckCircle2 size={15} aria-hidden="true" className="mr-1 inline text-ok" />
            Firma de la U.P.: {firma.firma_up?.nombre} ({firma.firma_up?.fecha}) · Firma del consultor: {firma.firma_consultor?.nombre} ({firma.firma_consultor?.fecha}) ·{' '}
            <a href={`/api${firma.soporte_url}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-acento-txt underline">Ver el plan firmado</a>
          </p>
        )}
      </div>
      <Dialogo abierto={abierto} titulo="Plan firmado por la unidad productiva y el consultor" onCerrar={() => setAbierto(false)}>
        {abierto && (
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await carrito.firmar(f, archivo)) { setAbierto(false); setArchivo(null); } }}>
            <Campo etiqueta="Código del plan" obligatorio ayuda="Está impreso al pie del PDF que se firmó (12 letras y números). Si el plan cambió después de descargarlo, el servidor lo rechaza."
              error={f.codigo_plan && !codigoValido ? 'El código tiene 12 caracteres: números y letras de la A a la F.' : undefined}>
              <Entrada required maxLength={12} autoComplete="off" className="font-mono uppercase tracking-wider" value={f.codigo_plan} aria-invalid={(f.codigo_plan && !codigoValido) || undefined}
                onChange={(e) => setF((x) => ({ ...x, codigo_plan: e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '') }))} />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Firma de la unidad productiva (nombre)" obligatorio><Entrada required maxLength={200} value={f.firma_up_nombre} onChange={(e) => setF((x) => ({ ...x, firma_up_nombre: e.target.value }))} /></Campo>
              <Campo etiqueta="Fecha de la firma de la U.P." obligatorio><Entrada required type="date" max={hoyISO()} value={f.firma_up_fecha} onChange={(e) => setF((x) => ({ ...x, firma_up_fecha: e.target.value }))} /></Campo>
              <Campo etiqueta="Firma del consultor (nombre)" obligatorio><Entrada required maxLength={200} value={f.firma_consultor_nombre} onChange={(e) => setF((x) => ({ ...x, firma_consultor_nombre: e.target.value }))} /></Campo>
              <Campo etiqueta="Fecha de la firma del consultor" obligatorio><Entrada required type="date" max={hoyISO()} value={f.firma_consultor_fecha} onChange={(e) => setF((x) => ({ ...x, firma_consultor_fecha: e.target.value }))} /></Campo>
            </div>
            <Campo etiqueta="Plan firmado (PDF)" obligatorio error={noEsPdf ? 'El plan firmado debe ser un PDF.' : undefined}>
              <Entrada required type="file" accept="application/pdf,.pdf" aria-invalid={noEsPdf || undefined} onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            </Campo>
            <div className="flex flex-wrap justify-end gap-2"><Boton variante="fantasma" onClick={() => setAbierto(false)}>Cancelar</Boton>
              <Boton tipo="submit" cargando={carrito.ocupado} disabled={!archivo || noEsPdf || !codigoValido || !f.firma_up_nombre.trim() || !f.firma_consultor_nombre.trim()}>Cargar</Boton></div>
          </form>
        )}
      </Dialogo>
    </Tarjeta>
  );
}

// Muestra las secciones del plan de la iniciativa elegida.
export default function PlanCapitalizacion({ filas, idUnico, onElegir }) {
  const carrito = useCarrito(idUnico);
  const [cotizando, setCotizando] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const { avisar } = useAvisos();
  useEffect(() => {
    apiGeneral.get('/carritos/proveedores').then((r) => setProveedores(r.items || []))
      .catch((err) => avisar(err.message || 'No se pudieron cargar los proveedores.', 'error'));
  }, [avisar]);
  const { vista, cargando } = carrito;
  const c = vista?.carrito;
  const estado = c ? ESTADOS_CARRITO[c.estado] : null;
  const faltanAprobar = vista ? problemasPara(vista.clasificacion, 'aprobar') : [];
  const enPreparacion = c && ['borrador', 'enviado', 'devuelto', 'en_subsanacion', 'subsanado'].includes(c.estado);

  return (
    <div className="grid gap-5">
      <Tarjeta titulo="Iniciativa">
        <SelectorIniciativa filas={filas} valor={idUnico} onElegir={onElegir} etiqueta="Plan de la iniciativa" />
      </Tarjeta>
      {!idUnico ? <Tarjeta><Vacio>Elige una iniciativa para ver su plan de capitalización.</Vacio></Tarjeta>
        : cargando && !vista ? <Tarjeta><Cargando /></Tarjeta>
        : !vista ? null : !c.existe ? <Tarjeta><Vacio>La iniciativa aún no tiene plan: agrega los activos en la Tienda.</Vacio></Tarjeta> : (
          <>
            <Tarjeta titulo={`${c.nombre_up || `Iniciativa ${c.id_unico}`} · ${c.modalidad || 'sin modalidad'}`} acciones={<Insignia tono={estado.tono}>{estado.texto}</Insignia>}>
              <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-gris-txt">Tope de la modalidad</dt><dd className="cifras font-semibold">{vista.resumen.tope_modalidad == null ? 'Sin modalidad registrada' : pesos(vista.resumen.tope_modalidad)}</dd></div>
                <div><dt className="text-gris-txt">Presupuesto del plan</dt><dd className="cifras font-semibold">{vista.resumen.presupuesto_maximo == null ? '—' : pesos(vista.resumen.presupuesto_maximo)}</dd></div>
                <div><dt className="text-gris-txt">Total de los activos</dt><dd className="cifras font-semibold">{pesos(vista.resumen.total)}</dd></div>
                <div><dt className="text-gris-txt">Transporte</dt><dd>{textoTransporte(vista.resumen, c)}</dd></div>
                {c.modalidad === 'M1' && <div><dt className="text-gris-txt">Libro contable</dt><dd>{c.libro_contable ? 'Incluido en el plan' : 'Falta incluirlo (se marca en el carrito, pestaña Tienda)'}</dd></div>}
              </dl>
              {!enPreparacion ? null : faltanAprobar.length > 0 ? (
                <Alerta tono="aviso" className="mt-3">
                  <strong>Para enviar y revisar el plan falta:</strong>
                  <ul className="mt-1 list-disc pl-5">{faltanAprobar.map((p) => <li key={p}>{p}</li>)}</ul>
                </Alerta>
              ) : <Alerta tono="info" className="mt-3">El plan tiene todo lo que pide el Anexo.</Alerta>}
            </Tarjeta>
            <CicloPlan c={c} carrito={carrito} />
            <PlanNegocio c={c} listas={vista.listas} carrito={carrito} />
            <Adecuaciones c={c} listas={vista.listas} carrito={carrito} />
            <Tarjeta titulo="Activos: cotizaciones y evaluación">
              {!vista.lineas.length ? <Vacio>El plan no tiene activos.</Vacio> : (
                <ul className="grid gap-3">
                  {vista.lineas.map((l) => <Activo key={l.id} l={l} c={c} minimo={vista.listas.min_cotizaciones} carrito={carrito} onCotizar={setCotizando} />)}
                </ul>
              )}
            </Tarjeta>
            <Firma c={c} carrito={carrito} />
            <FichasTecnicas c={c} lineas={vista.lineas} carrito={carrito} />
            <EntregaBeneficiario c={c} carrito={carrito} />
          </>
        )}
      <Dialogo abierto={Boolean(cotizando)} titulo="Cotización del activo" onCerrar={() => setCotizando(null)}>
        {cotizando && <FormCotizacion linea={cotizando} proveedores={proveedores} ocupado={carrito.ocupado} onCancelar={() => setCotizando(null)}
          onGuardar={async (campos, archivo) => { if (await carrito.cotizar(campos, archivo)) setCotizando(null); }} />}
      </Dialogo>
    </div>
  );
}
