// Reagendamientos por confirmar: entregas que las cuentas de campo pidieron mover. Primero se revisa el acta en
// PDF que adjuntaron: aprobarla la pasa a reagendamiento y rechazarla, con observación, cierra la solicitud y
// la entrega vuelve a la cuenta de campo. La nueva fecha no se fija aquí: se actualiza en el Excel de entregas
// y, al volver a cargarlo, la solicitud se cierra sola.
import { useState, useEffect, useCallback } from 'react';
import { Card, Aviso, Spinner, EncabezadoSeccion, Btn } from '../../components/UI';
import { listarSolicitudes, soloFecha, fechaLarga, revisarActa } from '../../lib/entregas';
import { descargarExcel } from '../../lib/exportarExcel';
import { TONOS, BotonActa } from './Comunes';

// Muestra la bandeja de solicitudes por revisar.
export default function Reagendamientos({ session }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);

  const recargar = useCallback(() => {
    setCargando(true);
    listarSolicitudes(session)
      .then(setItems)
      .catch((e) => {
        console.error('[bitacora][E-ENTREGAS] solicitudes:', e);
        setAviso({ tono: 'bad', texto: e.publicMsg || 'No se pudieron cargar las solicitudes.' });
      })
      .finally(() => setCargando(false));
  }, [session]);

  useEffect(() => { recargar(); }, [recargar]);

  function exportar() {
    descargarExcel(`reagendamientos_${new Date().toISOString().slice(0, 10)}`, 'Reagendamientos', [
      { titulo: 'ID único', ancho: 12, valor: (e) => e.ID_unico },
      { titulo: 'Unidad productiva', ancho: 34, valor: (e) => e.unidad_nombre },
      { titulo: 'Nodo', ancho: 12, valor: (e) => e.nodo },
      { titulo: 'Fecha programada', ancho: 16, valor: (e) => soloFecha(e.solicitud_reagendamiento?.fecha_anterior) },
      { titulo: 'Fecha sugerida', ancho: 16, valor: (e) => soloFecha(e.solicitud_reagendamiento?.fecha_sugerida) },
      { titulo: 'Motivo', ancho: 50, valor: (e) => e.solicitud_reagendamiento?.motivo || '' },
      { titulo: 'Solicitó', ancho: 24, valor: (e) => e.solicitud_reagendamiento?.gestor || '' },
      { titulo: 'Solicitado el', ancho: 16, valor: (e) => soloFecha(e.solicitud_reagendamiento?.solicitado_en) },
      { titulo: 'Acta adjunta', ancho: 12, valor: (e) => (e.solicitud_reagendamiento?.acta ? 'Sí' : 'No') },
      { titulo: 'Estado del acta', ancho: 16, valor: (e) => ({ en_revision: 'En revisión', aprobada: 'Aprobada' }[e.solicitud_reagendamiento?.acta_estado] || 'Sin acta') },
      { titulo: 'Revisó', ancho: 24, valor: (e) => e.solicitud_reagendamiento?.acta_revisado_por || '' },
      { titulo: 'Teléfono', ancho: 16, valor: (e) => e.telefono },
      { titulo: 'Dirección', ancho: 36, valor: (e) => e.direccion },
    ], items);
  }

  if (cargando) return <Spinner texto="Cargando solicitudes…" />;

  const porRevisar = items.filter((e) => e.estado_hora === 'acta_revision');
  const aprobadas = items.filter((e) => e.estado_hora !== 'acta_revision');

  return (
    <div>
      <EncabezadoSeccion
        titulo="Reagendamientos"
        subtitulo="Primero revisa el acta de reagendamiento de cada solicitud. Los aprobados esperan la nueva fecha en MASTER ENTREGAS: al volver a cargarlo, la solicitud se cierra sola."
      />

      {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

      {items.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-semibold text-marino">No hay reagendamientos pendientes</p>
          <p className="mt-1 text-[12px] text-gris">
            Cuando un gestor solicite mover una entrega, aparecerá aquí.
          </p>
        </Card>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <div className="flex justify-end">
            <Btn variant="secondary" onClick={exportar} className="py-2 text-[13px]">Descargar Excel</Btn>
          </div>
          {porRevisar.length > 0 && (
            <h3 className="mt-1 text-[13px] font-bold text-marino">Reagendamientos por revisar ({porRevisar.length})</h3>
          )}
          {porRevisar.map((e) => <Solicitud key={e.id} entrega={e} session={session} onRevisada={recargar} />)}
          {aprobadas.length > 0 && (
            <h3 className="mt-3 text-[13px] font-bold text-marino">Aprobados, esperando nueva fecha en el Excel ({aprobadas.length})</h3>
          )}
          {aprobadas.map((e) => <Solicitud key={e.id} entrega={e} session={session} onRevisada={recargar} />)}
        </div>
      )}
    </div>
  );
}

// Muestra una solicitud con su acta y las acciones de aprobar o rechazar.
function Solicitud({ entrega, session, onRevisada }) {
  const sol = entrega.solicitud_reagendamiento || {};
  const enRevision = entrega.estado_hora === 'acta_revision';
  const [rechazando, setRechazando] = useState(false);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  async function decidir(decision) {
    setOcupado(true); setError('');
    try {
      await revisarActa(entrega, decision, obs, session);
      onRevisada();
    } catch (e) {
      setError(/conflicto/.test(e?.detail || '') ? 'La solicitud cambió mientras la revisabas. Recarga la bandeja.' : (e.publicMsg || e.message || 'No se pudo guardar la revisión.'));
      setOcupado(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-card border border-l-[3px]"
      style={{ borderColor: TONOS.malo.borde, borderLeftColor: TONOS.malo.punto, background: 'var(--color-card)' }}>
      <div className="flex items-start justify-between gap-3 border-b border-borde px-4 py-3"
        style={{ background: TONOS.malo.fondo }}>
        <div className="min-w-0">
          <div className="text-[14px] font-bold leading-snug text-marino sm:truncate">
            {entrega.unidad_nombre || `UP ${entrega.ID_unico}`}
          </div>
          <div className="text-[11px] text-gris">
            ID {entrega.ID_unico}{entrega.nodo ? ` · ${entrega.nodo}` : ''}
            {sol.gestor ? ` · Solicitó ${sol.gestor}` : ''}
            {sol.solicitado_en ? ` · ${soloFecha(sol.solicitado_en)}` : ''}
          </div>
        </div>
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
          style={{ borderColor: TONOS.malo.borde, color: TONOS.malo.texto, background: 'var(--color-card)' }}>
          {enRevision ? 'Esperando revisión' : 'Esperando nueva fecha'}
        </span>
      </div>

      <div className="p-4">
        <div className="rounded-lg border border-borde bg-bg p-3.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">
            Motivo del gestor
          </div>
          <p className="text-[13px] text-texto">{sol.motivo || '—'}</p>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gris">
            <span>Fecha programada: <b className="text-texto">{sol.fecha_anterior ? fechaLarga(sol.fecha_anterior) : '—'}</b></span>
            <span>Fecha sugerida: <b className="text-texto">{soloFecha(sol.fecha_sugerida) || 'sin sugerir'}</b></span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gris">
            <span>Tel: {entrega.telefono || '—'}</span>
            <span>Dir: {entrega.direccion || '—'}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {sol.acta
              ? <BotonActa entrega={entrega} acta={sol.acta} session={session} />
              : <span className="text-[11px] text-gris">Solicitud anterior al acta obligatoria: sin acta adjunta.</span>}
            {sol.acta_estado === 'aprobada' && (
              <span className="text-[11px] text-gris">
                Reagendamiento aprobado por {sol.acta_revisado_por || '—'}{sol.acta_revisado_en ? ` · ${soloFecha(sol.acta_revisado_en)}` : ''}
              </span>
            )}
          </div>
        </div>

        {enRevision && (
          <div className="mt-3 flex flex-col gap-2">
            {error && <Aviso tono="bad">{error}</Aviso>}
            {rechazando ? (
              <>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-gris" htmlFor={`obs-${entrega.id}`}>
                  Por qué se rechaza el reagendamiento *
                </label>
                <textarea id={`obs-${entrega.id}`} rows={2} value={obs} onChange={(e) => setObs(e.target.value)}
                  placeholder="Obligatorio: el gestor verá este motivo."
                  className="w-full rounded-lg border border-borde bg-bg px-3 py-2 text-sm text-texto outline-none focus:border-acento" />
                <div className="flex flex-wrap gap-2">
                  <Btn onClick={() => decidir('rechazar')} disabled={ocupado || !obs.trim()}>
                    {ocupado ? 'Guardando…' : 'Rechazar y devolver al gestor'}
                  </Btn>
                  <Btn variant="ghost" onClick={() => { setRechazando(false); setObs(''); }} disabled={ocupado}>Cancelar</Btn>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => decidir('aprobar')} disabled={ocupado || !sol.acta}>
                  {ocupado ? 'Guardando…' : 'Aprobar reagendamiento'}
                </Btn>
                <Btn variant="secondary" onClick={() => setRechazando(true)} disabled={ocupado}>Rechazar reagendamiento</Btn>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
