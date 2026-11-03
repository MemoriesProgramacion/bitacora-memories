// Logística de las entregas: alistamiento, despacho, entrega y novedades de cada unidad productiva. Usa el
// mismo documento de items_ups que la lista de compras; aquí solo se edita la parte de logística y los ítems se
// reenvían tal como llegaron. Funciona por pasos: se busca la unidad y se registra su logística.
import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, Btn, Aviso, Spinner, EncabezadoSeccion } from '../../components/UI';
import { fullName, normDoc, val } from '../../lib/utils';
import {
  obtenerListaCompra, guardarListaCompra,
  listarListasCompra, listarEntregas, progresoLista,
  semaforoEntrega, listaParaEntrega,
} from '../../lib/entregas';
import { TONOS, Pasos, Encabezado, SelectorUP, EtiquetaEstado } from './Comunes';
import FiltroBitacora, { useFiltroBitacora } from '../../components/FiltroBitacora';

const MAX_LISTADO = 50;

const PASOS = ['Unidad productiva', 'Logística'];

// Marcas de logística que se pueden activar: alistamiento, despacho y entrega.
const MARCAS = [['alistamiento', 'Alistamiento'], ['despachado', 'Despachado'], ['entregado', 'Entregado']];

function fechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Controla los pasos de búsqueda de la unidad y registro de su logística.
export default function Logistica({ data, session }) {
  const [busqueda, setBusqueda] = useState('');
  const [up, setUp] = useState(null);
  const [lista, setLista] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [resumen, setResumen] = useState([]);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState('');
  const [entregas, setEntregas] = useState([]);
  const [sucio, setSucio] = useState(false);

  const recargarResumen = useCallback(() => {
    listarListasCompra(session)
      .then((r) => { setResumen(r); setErrorResumen(''); })
      .catch((e) => {
        console.error('[bitacora][E-LOGISTICA] resumen de la lista de compras:', e);
        setErrorResumen(e.publicMsg || 'No se pudo cargar el listado de unidades.');
      })
      .finally(() => setCargandoResumen(false));
    listarEntregas(session).then(setEntregas).catch(() => setEntregas([]));
  }, [session]);

  useEffect(() => { recargarResumen(); }, [recargarResumen]);

  const indices = useMemo(() => {
    const l = {}; resumen.forEach((x) => { l[String(x.ID_unico)] = x; });
    const e = {}; entregas.forEach((x) => { e[String(x.ID_unico)] = x; });
    return { listas: l, entregas: e };
  }, [resumen, entregas]);

  const dataConPlan = useMemo(
    () => (data || []).filter((u) => indices.listas[String(u.ID_unico)]),
    [data, indices],
  );

  const filtro = useFiltroBitacora(dataConPlan);

  const sugerencias = useMemo(() => {
    const q = String(busqueda || '').trim().toLowerCase();
    if (q.length < 2) return filtro.filas.slice(0, MAX_LISTADO);
    const qd = normDoc(busqueda);
    return filtro.filas.filter((u) => (
      String(u.unidad_nombre || '').toLowerCase().includes(q)
      || String(u.ID_unico || '').startsWith(q)
      || (qd.length >= 3 && normDoc(u.unidad_doc || u.integrante_doc_inicial).startsWith(qd))
    )).slice(0, MAX_LISTADO);
  }, [busqueda, filtro.filas]);

  async function abrir(u) {
    setCargando(true); setAviso(null); setUp(u); setBusqueda(''); setSucio(false);
    try {
      setLista(await obtenerListaCompra(u, session));
    } catch (e) {
      console.error('[bitacora][E-LOGISTICA] abrir:', e);
      setAviso({ tono: 'bad', texto: e.publicMsg || 'No se pudo cargar la logística.' });
    } finally { setCargando(false); }
  }

  function cerrar() {
    setUp(null); setLista(null); setAviso(null); setSucio(false);
  }

  function cambiarLog(campo, valor) {
    setSucio(true);
    setLista((l) => ({ ...l, logistica: { ...l.logistica, [campo]: valor } }));
  }

  async function guardar() {
    setGuardando(true); setAviso(null);
    try {
      setLista(await guardarListaCompra(lista, session));
      setSucio(false);
      setAviso({ tono: 'ok', texto: 'Logística guardada.' });
      recargarResumen();
    } catch (e) {
      console.error('[bitacora][E-LOGISTICA] guardar:', e);
      setAviso({
        tono: 'bad',
        texto: /conflicto/.test(e?.detail || '')
          ? 'Otra persona guardó cambios en esta unidad mientras la tenías abierta. Vuelve a abrirla para ver lo último.'
          : e?.publicMsg || 'No se pudo guardar.',
      });
    } finally { setGuardando(false); }
  }

  const prog = progresoLista(lista);
  const entregaUP = indices.entregas[String(up?.ID_unico)];
  const sem = semaforoEntrega(lista, entregaUP);
  const todoComprado = prog.total > 0 && prog.hechos === prog.total;
  const entregaSinCompra = !!lista && prog.total > 0 && !todoComprado && listaParaEntrega(lista, entregaUP);
  const paso = !up ? 1 : 2;
  const log = lista?.logistica || {};

  return (
    <div>
      <EncabezadoSeccion
        titulo="Logística"
        subtitulo="Alistamiento, despacho, entrega y novedades de cada unidad productiva."
      />

      {!up && (
        <>
          <FiltroBitacora filtro={filtro} />
          {errorResumen && <Aviso tono="bad">{errorResumen}</Aviso>}
        </>
      )}

      <Card className="overflow-hidden">
        <Pasos pasos={PASOS} actual={paso} />

        <div className="p-4 sm:p-6">
          {!up && cargandoResumen && <Spinner texto="Cargando unidades…" />}
          {!up && !cargandoResumen && (
            <SelectorUP
              titulo="Buscar unidad productiva"
              ayuda="Solo aparecen las unidades con plan de compras. Escribe el nombre, el ID único o el documento del representante."
              etiqueta="Unidad productiva"
              valor={busqueda} onValor={setBusqueda}
              sugerencias={sugerencias}
              estado={(u) => semaforoEntrega(
                indices.listas[String(u.ID_unico)], indices.entregas[String(u.ID_unico)],
              )}
              onElegir={abrir}
            />
          )}

          {cargando && <Spinner texto="Cargando logística…" />}

          {!cargando && up && !lista && (
            <div className="mx-auto max-w-2xl">
              <button type="button" onClick={cerrar}
                className="mb-4 text-[12px] font-semibold text-gris hover:text-marino">
                ← Cambiar de unidad productiva
              </button>
              {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}
            </div>
          )}

          {!cargando && up && lista && (
            <div className="mx-auto max-w-2xl">
              <button type="button" onClick={cerrar}
                className="mb-4 text-[12px] font-semibold text-gris hover:text-marino">
                ← Cambiar de unidad productiva{sucio ? ' (hay cambios sin guardar)' : ''}
              </button>

              {aviso && <Aviso tono={aviso.tono}>{aviso.texto}</Aviso>}

              <div className="mb-4 rounded-card border border-borde bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[15px] font-bold text-marino">
                    {val(up.unidad_nombre) || lista.unidad_nombre || 'Sin nombre'}
                  </div>
                  <EtiquetaEstado tono={sem.tono}>{sem.label}</EtiquetaEstado>
                </div>
                <div className="mt-0.5 text-[12px] text-gris">
                  ID {up.ID_unico} · {val(up.nodo) || lista.nodo || '—'} · {lista.modalidad || val(up.modalidad) || '—'} · {fullName(up) || '—'}
                </div>
                <div className="mt-0.5 text-[12px] text-gris">
                  {[lista.municipio, lista.departamento].filter(Boolean).join(', ') || '—'}
                </div>
                <div className="mt-2 border-t border-borde pt-2 text-[12px] text-gris">
                  Compras: <b className="text-texto">{prog.hechos} de {prog.total}</b> ítems
                </div>
                {lista.actualizado_por && (
                  <div className="mt-0.5 text-[11px] text-gris">
                    Última actualización: {lista.actualizado_por} · {fechaHora(lista.fecha_actualizacion)}
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-card border border-borde bg-card">
                <Encabezado titulo="Logística" derecha={todoComprado ? 'Compra completa' : 'Compra en curso'} />
                {entregaSinCompra && (
                  <p className="border-b border-borde px-4 py-2 text-[12px] font-semibold" style={{ color: TONOS.malo.texto, background: TONOS.malo.fondo }}>
                    Ya está en etapa de entrega ({sem.label.toLowerCase()}), pero en la base hay {prog.hechos} de {prog.total} ítems comprados.
                  </p>
                )}
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap gap-4">
                    {MARCAS.map(([k, l]) => (
                      <label key={k} className="flex cursor-pointer items-center gap-2 text-[13px] text-texto">
                        <input type="checkbox" checked={!!log[k]} onChange={(e) => cambiarLog(k, e.target.checked)}
                          className="h-4 w-4 accent-[#3f9a6a]" />
                        {l}
                      </label>
                    ))}
                  </div>
                  <Campo label="Tipo de novedad">
                    <input value={log.tipo_novedad || ''} onChange={(e) => cambiarLog('tipo_novedad', e.target.value)}
                      className="w-full rounded-lg border border-borde bg-bg px-3 py-2 text-sm text-texto outline-none focus:border-acento" />
                  </Campo>
                  <Campo label="Descripción de la novedad">
                    <textarea rows={2} value={log.descripcion_novedad || ''} onChange={(e) => cambiarLog('descripcion_novedad', e.target.value)}
                      className="w-full rounded-lg border border-borde bg-bg px-3 py-2 text-sm text-texto outline-none focus:border-acento" />
                  </Campo>
                  <Campo label="Observaciones">
                    <textarea rows={2} value={log.observaciones || ''} onChange={(e) => cambiarLog('observaciones', e.target.value)}
                      className="w-full rounded-lg border border-borde bg-bg px-3 py-2 text-sm text-texto outline-none focus:border-acento" />
                  </Campo>
                  <Btn variant="secondary" onClick={guardar} disabled={guardando} className="w-full sm:w-auto">
                    {guardando ? 'Guardando…' : 'Guardar logística'}
                  </Btn>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// Envuelve un control de formulario con su etiqueta.
function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-texto">{label}</span>
      {children}
    </label>
  );
}
