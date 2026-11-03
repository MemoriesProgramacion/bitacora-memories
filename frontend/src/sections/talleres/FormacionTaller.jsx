// Formación del grupo: la convocatoria, el 80 % de cada unidad (3 módulos válidos, la encuesta de apropiación
// de salida y la entrega final), las encuestas y los hallazgos.
import { useState } from 'react';
import { ClipboardList, FileDown, Mail, NotebookPen } from 'lucide-react';
import { apiGeneral } from '../../inventario/lib/api';
import { useAccion } from '../../inventario/lib/useDatos';
import { Alerta, AreaTexto, Boton, Campo, Dialogo, Insignia, Seleccion, Tarjeta } from '../../inventario/componentes/ui';
import { EtiquetaUP } from './GruposUP';
import { textoSesion, textoConvocatoria, encuestaDe, encuestasPermitidas, resultadoDe, promedio } from '../../lib/formacion';

// Muestra el cumplimiento de cada unidad y las encuestas y hallazgos del taller.
export default function FormacionTaller({ taller, recargar, puedeProgramar }) {
  const [encuestaUP, setEncuestaUP] = useState(null);
  const [hallazgosUP, setHallazgosUP] = useState(null);
  const { ejecutar, ocupado } = useAccion(recargar);
  const todos = Boolean(taller.grupo_completo);
  const c = taller.cumplimiento || {};
  const cumplen = taller.participantes.filter((p) => c[p.id_up]?.cumple_80).length;
  const permitidas = encuestasPermitidas(taller, puedeProgramar);
  const algunaEncuesta = permitidas.apropiacion_entrada || permitidas.apropiacion_salida || permitidas.satisfaccion.length > 0;

  return (
    <Tarjeta titulo="Formación y cumplimiento del 80 %"
      acciones={<Insignia tono={cumplen === taller.participantes.length && cumplen > 0 ? 'ok' : 'alerta'}>{cumplen}/{taller.participantes.length} UP cumplen el 80 %</Insignia>}>
      <div className="grid gap-4">
        <p className="text-[13px] text-gris-txt">
          Cada UP cumple cinco actividades: los tres módulos (con el mínimo de integrantes de su modalidad), la encuesta de apropiación de salida y la entrega final. Cumple con 4 de 5 (80 %).
        </p>
        {taller.convocatoria && !puedeProgramar && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Mail size={16} aria-hidden="true" className="text-gris-txt" />
            <span>{textoConvocatoria(taller.convocatoria)}</span>
          </div>
        )}
        {!taller.participantes.length ? <Alerta tono="aviso">El taller aún no tiene un grupo de UP.</Alerta> : (
          <ul className="grid gap-2">
            {taller.participantes.map((p) => {
              const x = c[p.id_up];
              return (
                <li key={p.id_up} className="grid min-w-0 gap-2 rounded-lg border border-borde p-3 text-[13px]">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 break-words"><EtiquetaUP up={p} /></div>
                    {x && <Insignia tono={x.cumple_80 ? 'ok' : 'alerta'}>{x.porcentaje} % · {x.cumplidas} de {x.actividades}</Insignia>}
                  </div>
                  {x && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
                      {x.modulos.map((m) => (
                        <div key={m.modulo}><dt className="text-[11px] text-gris-txt">Módulo {m.modulo}</dt><dd>{textoSesion(m)}</dd></div>
                      ))}
                      <div><dt className="text-[11px] text-gris-txt">Encuesta de salida</dt><dd>{x.encuesta_salida ? 'Registrada' : 'Pendiente'}</dd></div>
                      <div><dt className="text-[11px] text-gris-txt">Entrega final</dt><dd>{x.entrega_final ? 'Cargada' : 'Pendiente'}</dd></div>
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Boton tamano="sm" variante="fantasma" icono={ClipboardList} disabled={!algunaEncuesta} title={algunaEncuesta ? undefined : 'Las encuestas las registra el Tallerista del módulo o el de la entrega final.'} onClick={() => setEncuestaUP(p)}>Encuestas</Boton>
                    <Boton tamano="sm" variante="fantasma" icono={NotebookPen} disabled={!todos || !taller.puede_entregar} onClick={() => setHallazgosUP(p)}>Hallazgos y recomendaciones</Boton>
                    <a href={`/api/talleres/${taller.id}/informe/${p.id_up}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-acento-txt underline">
                      <FileDown size={16} aria-hidden="true" />Informe de resultados (PDF)
                    </a>
                  </div>
                  {!todos ? <p className="text-[12px] text-gris-txt">Los hallazgos se registran al terminar los tres módulos.</p>
                    : !taller.puede_entregar && <p className="text-[12px] text-gris-txt">Los hallazgos los registra el Tallerista de la entrega final.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Dialogo abierto={Boolean(encuestaUP)} titulo={`Encuestas · ${encuestaUP?.nombre || ''}`} ancho="max-w-2xl" onCerrar={() => !ocupado && setEncuestaUP(null)}>
        {encuestaUP && <FormEncuestas taller={taller} up={encuestaUP} permitidas={permitidas} ocupado={ocupado} onCerrar={() => setEncuestaUP(null)}
          onGuardar={(cuerpo) => ejecutar(() => apiGeneral.put(`/talleres/${taller.id}/encuestas/${encuestaUP.id_up}`, cuerpo))} />}
      </Dialogo>
      <Dialogo abierto={Boolean(hallazgosUP)} titulo={`Hallazgos y recomendaciones · ${hallazgosUP?.nombre || ''}`} ancho="max-w-2xl" onCerrar={() => !ocupado && setHallazgosUP(null)}>
        {hallazgosUP && <FormHallazgos inicial={resultadoDe(taller, hallazgosUP.id_up)} ocupado={ocupado} onCancelar={() => setHallazgosUP(null)}
          onGuardar={async (cuerpo) => {
            const r = await ejecutar(() => apiGeneral.put(`/talleres/${taller.id}/resultados/${hallazgosUP.id_up}`, cuerpo));
            if (r) setHallazgosUP(null);
          }} />}
      </Dialogo>
    </Tarjeta>
  );
}

const TIPOS = [
  { id: 'apropiacion_entrada', nombre: 'Apropiación de conocimientos · entrada', ayuda: 'Al iniciar el módulo 1.' },
  { id: 'apropiacion_salida', nombre: 'Apropiación de conocimientos · salida', ayuda: 'Al terminar el módulo 3.' },
  { id: 'satisfaccion', nombre: 'Satisfacción del módulo', ayuda: 'De un módulo al que asistió la UP.' },
];

// Formulario de encuestas fijas con respuestas de 1 a 5; el servidor exige la autorización de datos y el módulo
// que corresponde.
function FormEncuestas({ taller, up, permitidas, ocupado, onGuardar, onCerrar }) {
  const tipos = TIPOS.filter((t) => (t.id === 'satisfaccion' ? permitidas.satisfaccion.length > 0 : permitidas[t.id]));
  const [tipo, setTipo] = useState(tipos[0]?.id || 'apropiacion_entrada');
  const [modulo, setModulo] = useState(permitidas.satisfaccion[0] || 1);
  const preguntas = tipo === 'satisfaccion' ? taller.preguntas?.satisfaccion || [] : taller.preguntas?.apropiacion || [];
  const guardada = encuestaDe(taller, up.id_up, tipo, tipo === 'satisfaccion' ? modulo : 0);
  const [respuestas, setRespuestas] = useState(() => guardada || {});
  const cambiar = (t, m) => { setTipo(t); setModulo(m); setRespuestas(encuestaDe(taller, up.id_up, t, t === 'satisfaccion' ? m : 0) || {}); };
  const completa = preguntas.every((p) => respuestas[p.clave]);
  return (
    <form className="grid gap-4" onSubmit={(ev) => {
      ev.preventDefault();
      onGuardar({ tipo, respuestas: Object.fromEntries(preguntas.map((p) => [p.clave, Number(respuestas[p.clave])])), ...(tipo === 'satisfaccion' ? { modulo } : {}) });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Encuesta" ayuda={TIPOS.find((t) => t.id === tipo)?.ayuda}>
          <Seleccion value={tipo} onChange={(ev) => cambiar(ev.target.value, modulo)}>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Seleccion>
        </Campo>
        {tipo === 'satisfaccion' && (
          <Campo etiqueta="Módulo">
            <Seleccion value={modulo} onChange={(ev) => cambiar(tipo, Number(ev.target.value))}>
              {permitidas.satisfaccion.map((m) => <option key={m} value={m}>Módulo {m}</option>)}
            </Seleccion>
          </Campo>
        )}
      </div>
      {guardada && <p className="text-[12px] text-ok-txt">Ya registrada (promedio {promedio(guardada)} de 5). Si la guardas de nuevo, se reemplaza.</p>}
      <fieldset disabled={ocupado} className="grid gap-3">
        <legend className="text-[13px] font-semibold">Calificación de 1 (muy bajo) a 5 (muy alto)</legend>
        {preguntas.map((p) => (
          <Campo key={p.clave} etiqueta={p.etiqueta} obligatorio>
            <Seleccion value={respuestas[p.clave] || ''} onChange={(ev) => setRespuestas((r) => ({ ...r, [p.clave]: ev.target.value }))}>
              <option value="">Elige…</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Seleccion>
          </Campo>
        ))}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCerrar}>Cerrar</Boton>
        <Boton tipo="submit" cargando={ocupado} disabled={!completa}>Guardar encuesta</Boton>
      </div>
    </form>
  );
}

// Formulario de hallazgos y recomendaciones de una unidad en el taller.
function FormHallazgos({ inicial, ocupado, onGuardar, onCancelar }) {
  const [hallazgos, setHallazgos] = useState(inicial?.hallazgos || '');
  const [recomendaciones, setRecomendaciones] = useState(inicial?.recomendaciones || '');
  return (
    <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); onGuardar({ hallazgos: hallazgos.trim(), recomendaciones: recomendaciones.trim() }); }}>
      <fieldset disabled={ocupado} className="grid gap-4">
        <Campo etiqueta="Hallazgos de la unidad en la formación" obligatorio>
          <AreaTexto required rows={4} maxLength={4000} value={hallazgos} onChange={(ev) => setHallazgos(ev.target.value)} />
        </Campo>
        <Campo etiqueta="Recomendaciones" obligatorio>
          <AreaTexto required rows={4} maxLength={4000} value={recomendaciones} onChange={(ev) => setRecomendaciones(ev.target.value)} />
        </Campo>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="fantasma" onClick={onCancelar}>Cancelar</Boton>
        <Boton tipo="submit" cargando={ocupado} disabled={!hallazgos.trim() || !recomendaciones.trim()}>Guardar</Boton>
      </div>
    </form>
  );
}
