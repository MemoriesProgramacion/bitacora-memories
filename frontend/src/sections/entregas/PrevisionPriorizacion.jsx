// Ruta de entregas de la cuenta de campo, antes previsión y priorización. Usa el mismo calendario del
// cronograma limitado a las entregas del nodo. La fecha programada viene del Excel de entregas; al seleccionar
// una tarjeta se confirman teléfono, dirección y hora, o se pide reagendar con motivo obligatorio. Todo queda
// en entregas_ups y al confirmar el flujo salta al validador.
import { useState } from 'react';
import { Card, Btn, Aviso } from '../../components/UI';
import {
  confirmarHora, solicitarReagendamiento, guardarContacto, soloFecha, fechaLarga,
  ESTADOS_HORA, editablePorGestor, horaInput, horaLegible, validarActa, MAX_ACTA_MB, rechazoVigente,
} from '../../lib/entregas';
import CronogramaEntregas from './CronogramaEntregas';
import { TarjetaEntrega, BotonActa } from './Comunes';

// Muestra el calendario del nodo y el detalle de la entrega elegida.
export default function PrevisionPriorizacion({ data, session, onIrValidador }) {
  const [sel, setSel] = useState(null);

  return (
    <CronogramaEntregas
      data={data} session={session} soloNodo={session?.nodo || null} conExcel={false}
    >
      {({ entregas, recargar }) => (
        <div className="flex flex-col gap-2">
          {entregas.map((e) => (
            <div key={e.id}>
              <TarjetaEntrega
                entrega={e} up={e._up}
                activa={sel?.id === e.id}
                onClick={() => setSel(sel?.id === e.id ? null : e)}
              />
              {sel?.id === e.id && (
                <Detalle
                  entrega={e} session={session}
                  onGuardado={() => { recargar(); }}
                  onCerrar={() => setSel(null)}
                  onIrValidador={onIrValidador}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </CronogramaEntregas>
  );
}

// Texto de cada acción del historial de una entrega.
const ACCIONES_HISTORIAL = {
  confirmar: 'Confirmó',
  solicitar_reagendamiento: 'Pidió reagendar',
  acta_aprobada: 'Reagendamiento aprobado por coordinación',
  acta_rechazada: 'Reagendamiento rechazado por coordinación',
  reagendada: 'Reagendada en MASTER ENTREGAS',
  solicitud_retirada: 'Retiró la solicitud',
  contacto: 'Actualizó teléfono y dirección',
};

// Muestra el detalle de una entrega con la confirmación y la solicitud de reagendamiento.
function Detalle({ entrega, session, onGuardado, onCerrar, onIrValidador }) {
  const up = entrega._up || {};
  const [telefono, setTelefono] = useState(entrega.telefono || up.unidad_tel1 || '');
  const [direccion, setDireccion] = useState(entrega.direccion || up.unidad_direccion || '');
  const [hora, setHora] = useState(entrega.hora || horaInput(entrega.hora_excel));
  const [modo, setModo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [acta, setActa] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState(null);
  const [listo, setListo] = useState(false);

  const est = ESTADOS_HORA[entrega.estado_hora] || ESTADOS_HORA.programada;
  const esGestor = session?.role === 'gestor';
  const enGestor = esGestor && editablePorGestor(entrega);
  const sol = entrega.solicitud_reagendamiento;
  const rechazo = rechazoVigente(entrega);

  function error(e, porDefecto) {
    if (/conflicto/.test(e?.detail || '')) return 'La entrega cambió mientras la tenías abierta. Ciérrala y vuelve a abrirla.';
    return e?.publicMsg || e?.message || porDefecto;
  }

  async function accionContacto() {
    if (!telefono.trim()) {
      setAviso({ tono: 'bad', texto: 'Completa el teléfono.' });
      return;
    }
    if (!direccion.trim()) {
      setAviso({ tono: 'bad', texto: 'Completa la dirección.' });
      return;
    }
    setOcupado('contacto'); setAviso(null);
    try {
      await guardarContacto(entrega, { telefono, direccion }, session);
      setAviso({ tono: 'ok', texto: 'Teléfono y dirección guardados.' });
      onGuardado();
    } catch (e) {
      setAviso({ tono: 'bad', texto: error(e, 'No se pudo guardar.') });
    } finally { setOcupado(''); }
  }

  async function accionConfirmar() {
    if (!telefono.trim() || !direccion.trim() || !hora) {
      setAviso({ tono: 'bad', texto: 'Completa teléfono, dirección y hora antes de confirmar.' });
      return;
    }
    setOcupado('hora'); setAviso(null);
    try {
      await confirmarHora(entrega, { telefono, direccion, hora }, session);
      setAviso({ tono: 'ok', texto: `Entrega confirmada para el ${fechaLarga(entrega.fecha_programada)} a las ${horaLegible(hora)}.` });
      setListo(true); onGuardado();
    } catch (e) {
      setAviso({ tono: 'bad', texto: error(e, 'No se pudo confirmar.') });
    } finally { setOcupado(''); }
  }

  async function accionSolicitar() {
    if (!motivo.trim()) {
      setAviso({ tono: 'bad', texto: 'El motivo del reagendamiento es obligatorio.' });
      return;
    }
    const errorActa = validarActa(acta);
    if (errorActa) {
      setAviso({ tono: 'bad', texto: errorActa });
      return;
    }
    setOcupado('hora'); setAviso(null);
    try {
      await solicitarReagendamiento(entrega,
        { motivo, fecha_sugerida: nuevaFecha, telefono, direccion, acta }, session);
      setAviso({
        tono: 'ok',
        texto: 'Solicitud enviada a coordinación de compras. La nueva fecha llegará con la próxima actualización de MASTER ENTREGAS.',
      });
      setModo(null); setMotivo(''); setActa(null); onGuardado();
    } catch (e) {
      setAviso({ tono: 'bad', texto: error(e, 'No se pudo enviar la solicitud.') });
    } finally { setOcupado(''); }
  }

  const input = 'w-full rounded-lg border border-borde bg-bg px-3 py-2 text-sm text-texto outline-none focus:border-acento disabled:cursor-not-allowed disabled:text-gris disabled:opacity-100';
  const etiqueta = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gris';

  return (
    <Card className="mt-2 border-acento p-4">
      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

      <div className="mb-3 rounded-lg border border-borde bg-bg p-3.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gris">Fecha programada</span>
          <span className="text-[11px] font-bold text-marino">{est.label}</span>
        </div>
        <p className="text-[13px] font-semibold text-texto">
          {entrega.fecha_programada ? fechaLarga(entrega.fecha_programada) : 'Sin fecha en MASTER ENTREGAS'}
        </p>
        {entrega.hora_excel && (
          <p className="mt-0.5 text-[11px] text-gris">Hora de la ruta: {horaLegible(entrega.hora_excel)}</p>
        )}
        {entrega.confirmacion && (
          <p className="mt-0.5 text-[11px] text-gris">
            Última confirmación: {fechaLarga(entrega.confirmacion.fecha)} a las {horaLegible(entrega.confirmacion.hora)}
            {entrega.confirmacion.fecha !== entrega.fecha_programada ? ' (la fecha cambió: vuelve a confirmar)' : ''}
          </p>
        )}
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ opacity: enGestor ? 1 : 0.55 }}>
        <div>
          <label className={etiqueta}>Teléfono</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} disabled={!enGestor}
            inputMode="tel" placeholder="—" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label className={etiqueta}>Dirección de la UP</label>
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} disabled={!enGestor}
            placeholder="—" className={input} />
        </div>
        <div>
          <label className={etiqueta}>Hora de entrega</label>
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} disabled={!enGestor}
            className={input} />
        </div>
      </div>

      {rechazo && (
        <Aviso tono="bad">
          Coordinación rechazó tu reagendamiento ({soloFecha(rechazo.en)}): {rechazo.observacion || 'sin observación'}.
          Si todavía necesitas reagendar, vuelve a solicitarlo con un acta corregida.
        </Aviso>
      )}

      {!enGestor ? (
        <div className="rounded-lg border border-borde bg-bg p-3.5">
          {sol ? (
            <>
              <p className="text-[12px] text-gris">
                {sol.acta_estado === 'en_revision'
                  ? 'Esperando revisión: coordinación está revisando tu acta de reagendamiento. Si la aprueba, pasa a reagendamiento; si la rechaza, la entrega vuelve aquí con el motivo.'
                  : 'Reagendamiento aprobado. Esperando la nueva fecha en MASTER ENTREGAS: cuando llegue, la entrega vuelve aquí para que la confirmes.'}
              </p>
              <div className="mt-2.5 rounded-lg border border-borde bg-card p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">Motivo enviado</div>
                <p className="text-[12px] text-texto">{sol.motivo || '—'}</p>
                <div className="mt-2 text-[11px] text-gris">
                  Fecha sugerida: <b className="text-texto">{soloFecha(sol.fecha_sugerida) || 'sin sugerir'}</b>
                </div>
                <div className="mt-2"><BotonActa entrega={entrega} acta={sol.acta} session={session} /></div>
              </div>
            </>
          ) : (
            <p className="text-[12px] text-gris">
              {!esGestor
                ? 'Solo el gestor del nodo confirma o reagenda esta entrega.'
                : entrega.fecha_programada
                ? 'Esta entrega ya figura como realizada en MASTER ENTREGAS.'
                : 'Esta entrega aún no tiene fecha programada en MASTER ENTREGAS.'}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Btn onClick={accionConfirmar} disabled={!!ocupado}>
              {ocupado === 'hora' && !modo ? 'Confirmando…' : 'Confirmar teléfono, dirección y hora'}
            </Btn>
            <Btn variant="secondary" onClick={accionContacto} disabled={!!ocupado}>
              {ocupado === 'contacto' ? 'Guardando…' : 'Solo guardar teléfono y dirección'}
            </Btn>
            <Btn variant="secondary" onClick={() => setModo(modo === 'reagendar' ? null : 'reagendar')} disabled={!!ocupado}>
              Solicitar reagendamiento
            </Btn>
          </div>

          {modo === 'reagendar' && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-borde bg-bg p-3.5">
              <p className="text-[11px] text-gris">
                La solicitud va a coordinación de compras, que fija la nueva fecha en MASTER ENTREGAS.
              </p>
              <div>
                <label className={etiqueta}>Fecha que sugieres (opcional)</label>
                <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} className={input} />
              </div>
              <div>
                <label className={etiqueta}>Motivo del reagendamiento *</label>
                <textarea
                  value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                  placeholder="Obligatorio: explica por qué no se puede entregar en la fecha programada."
                  className={input}
                />
              </div>
              <div>
                <label className={etiqueta}>Acta de reagendamiento (PDF) *</label>
                <input
                  type="file" accept="application/pdf,.pdf"
                  onChange={(e) => setActa(e.target.files?.[0] || null)}
                  className="block w-full text-[12px] text-texto file:mr-3 file:rounded-lg file:border file:border-borde file:bg-card file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-marino hover:file:border-marino"
                />
                <p className="mt-1 text-[11px] text-gris">
                  {acta ? `${acta.name} · ${(acta.size / 1024 / 1024).toFixed(1)} MB` : `Obligatoria. Solo PDF, hasta ${MAX_ACTA_MB} MB.`}
                </p>
              </div>
              <Btn onClick={accionSolicitar} disabled={!!ocupado || !motivo.trim() || !acta}>
                {ocupado === 'hora' ? 'Enviando…' : 'Enviar solicitud a coordinación'}
              </Btn>
            </div>
          )}
        </>
      )}

      {entrega.historial.length > 0 && (
        <div className="mt-3 border-t border-borde pt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gris">Historial</div>
          {[...entrega.historial].reverse().map((h, i) => (
            <div key={i} className="mb-1 text-[11px] text-gris">
              <b className="text-texto">{ACCIONES_HISTORIAL[h.accion] || h.accion}</b>
              {' · '}{soloFecha(h.en)}
              {h.accion === 'confirmar' ? ` · ${soloFecha(h.fecha)} ${horaLegible(h.hora)}` : ''}
              {h.accion === 'reagendada' ? ` · ${soloFecha(h.fecha_anterior)} → ${soloFecha(h.fecha_nueva)}` : ''}
              {h.motivo && h.accion !== 'reagendada' ? ` · ${h.motivo}` : ''}
              {h.observacion ? ` · ${h.observacion}` : ''}
              {h.acta && h.accion === 'solicitar_reagendamiento' && (
                <span className="ml-2"><BotonActa entrega={entrega} acta={h.acta} session={session}>Ver acta</BotonActa></span>
              )}
            </div>
          ))}
        </div>
      )}

      {(listo || entrega.estado_hora === 'confirmada') && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Btn onClick={() => onIrValidador && onIrValidador(entrega)}>
            Ir al validador de documentos
          </Btn>
          <Btn variant="ghost" onClick={onCerrar}>Cerrar</Btn>
        </div>
      )}
    </Card>
  );
}
