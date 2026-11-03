// Lista de compras de las entregas. Lee y escribe en la tabla items_ups: un documento por unidad productiva con
// sus ítems aprobados, alimentado desde el cargue de compras. Solo aparecen las unidades que tienen ese
// documento. Funciona por pasos, como el validador: se busca la unidad y se marcan los ítems comprados.
import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, Btn, Aviso, Spinner, EncabezadoSeccion } from '../../components/UI';
import { fullName, normDoc, val } from '../../lib/utils';
import {
  obtenerListaCompra, guardarListaCompra,
  listarListasCompra, listarEntregas, progresoLista,
  semaforoEntrega, listaParaEntrega,
  horaLegible,
} from '../../lib/entregas';
import { TONOS, Pasos, Encabezado, SelectorUP, EtiquetaEstado } from './Comunes';
import FiltroBitacora, { useFiltroBitacora } from '../../components/FiltroBitacora';

// Cantidad máxima de unidades que se listan.
const MAX_LISTADO = 50;

const PASOS = ['Unidad productiva', 'Compras'];

const ESTADOS = [
  { id: 'todas', label: 'Todas' },
  { id: 'sin', label: 'Sin comprar' },
  { id: 'proceso', label: 'Comprando' },
  { id: 'completa', label: 'Compra completa' },
  { id: 'entregada', label: 'Entregadas' },
  { id: 'parcial', label: 'Entrega parcial' },
];

// Indica si una entrega está parcial.
const esParcial = (entrega) => entrega?.estado_hora === 'parcial';

// Etiquetas de los campos de la ficha técnica de un ítem.
const ETIQUETAS_FICHA = {
  descripcion_general: 'Descripción general',
  especificaciones_tecnicas: 'Especificaciones técnicas',
  dimensiones: 'Dimensiones',
  empaque: 'Empaque',
  peso: 'Peso',
  referencia: 'Referencia',
  material: 'Material',
  composicion: 'Composición',
  capacidad: 'Capacidad',
  potencia: 'Potencia',
  otras_especificaciones: 'Otras especificaciones',
  condiciones_limitantes: 'Condiciones limitantes',
  requerimientos_especiales: 'Requerimientos especiales',
};

function pesos(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

function fechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Devuelve el estado de una lista de compras.
function estadoDe(fila) {
  if (!fila) return 'sin';
  if (fila.logistica?.entregado === true) return 'entregada';
  const p = progresoLista(fila);
  if (p.total && p.hechos === p.total) return 'completa';
  if (p.hechos > 0) return 'proceso';
  return 'sin';
}

// Controla los pasos de búsqueda de la unidad y marcado de ítems comprados.
export default function ListaCompras({ data, session }) {
  const [busqueda, setBusqueda] = useState('');
  const [up, setUp] = useState(null);
  const [lista, setLista] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState('');
  const [aviso, setAviso] = useState(null);
  const [resumen, setResumen] = useState([]);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState('');
  const [entregas, setEntregas] = useState([]);
  const [estado, setEstado] = useState('todas');
  const [sucio, setSucio] = useState(false);
  const [abiertos, setAbiertos] = useState({});

  const recargarResumen = useCallback(() => {
    listarListasCompra(session)
      .then((r) => { setResumen(r); setErrorResumen(''); })
      .catch((e) => {
        console.error('[bitacora][E-COMPRAS] resumen de la lista de compras:', e);
        setErrorResumen(e.publicMsg || 'No se pudo cargar el resumen de compras.');
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

  const filasEstado = useMemo(() => (
    estado === 'todas' ? filtro.filas
      : estado === 'parcial' ? filtro.filas.filter((u) => esParcial(indices.entregas[String(u.ID_unico)]))
      : filtro.filas.filter((u) => estadoDe(indices.listas[String(u.ID_unico)]) === estado)
  ), [filtro.filas, estado, indices]);

  const general = useMemo(() => {
    const g = { ups: 0, sin: 0, proceso: 0, completa: 0, entregada: 0, parcial: 0, items: 0, comprados: 0, valor: 0 };
    filtro.filas.forEach((u) => {
      const r = indices.listas[String(u.ID_unico)];
      if (!r) return;
      g.ups += 1;
      g[estadoDe(r)] += 1;
      if (esParcial(indices.entregas[String(u.ID_unico)])) g.parcial += 1;
      g.items += r.total_items || 0;
      g.comprados += r.items_comprados || 0;
      g.valor += Number(r.resumen?.valor_total) || 0;
    });
    g.pct = g.items ? Math.round((g.comprados / g.items) * 100) : 0;
    return g;
  }, [filtro.filas, indices]);

  const sugerencias = useMemo(() => {
    const q = String(busqueda || '').trim().toLowerCase();
    if (q.length < 2) return filasEstado.slice(0, MAX_LISTADO);
    const qd = normDoc(busqueda);
    return filasEstado.filter((u) => (
      String(u.unidad_nombre || '').toLowerCase().includes(q)
      || String(u.ID_unico || '').startsWith(q)
      || (qd.length >= 3 && normDoc(u.unidad_doc || u.integrante_doc_inicial).startsWith(qd))
    )).slice(0, MAX_LISTADO);
  }, [busqueda, filasEstado]);

  async function abrir(u) {
    setCargando(true); setAviso(null); setUp(u); setBusqueda(''); setSucio(false); setAbiertos({});
    try {
      const l = await obtenerListaCompra(u, session);
      setLista(l);
    } catch (e) {
      console.error('[bitacora][E-COMPRAS] abrir lista:', e);
      setAviso({ tono: 'bad', texto: e.publicMsg || 'No se pudo cargar la lista de compras.' });
    } finally { setCargando(false); }
  }

  function cerrar() {
    setUp(null); setLista(null); setAviso(null); setSucio(false);
  }

  function marcar(id) {
    setSucio(true);
    setLista((l) => ({
      ...l, items: l.items.map((i) => (i.id === id ? { ...i, comprado: !i.comprado } : i)),
    }));
  }

  function marcarTodos(valor) {
    setSucio(true);
    setLista((l) => ({ ...l, items: l.items.map((i) => ({ ...i, comprado: valor })) }));
  }

  function mensajeError(e, porDefecto) {
    if (/conflicto/.test(e?.detail || '')) {
      return 'Otra persona guardó cambios en esta unidad mientras la tenías abierta. Vuelve a abrirla para ver lo último.';
    }
    return e?.publicMsg || porDefecto;
  }

  async function guardar() {
    setGuardando('Guardando…'); setAviso(null);
    try {
      setLista(await guardarListaCompra(lista, session));
      setSucio(false);
      setAviso({ tono: 'ok', texto: 'Avance guardado.' });
      recargarResumen();
    } catch (e) {
      console.error('[bitacora][E-COMPRAS] guardar:', e);
      setAviso({ tono: 'bad', texto: mensajeError(e, 'No se pudo guardar.') });
    } finally { setGuardando(''); }
  }

  const entregaUP = indices.entregas[String(up?.ID_unico)];
  const sem = semaforoEntrega(lista, entregaUP);
  const prog = progresoLista(lista);
  const faltan = prog.total - prog.hechos;
  const entregaSinCompra = !!lista && faltan > 0 && listaParaEntrega(lista, entregaUP);
  const paso = !up ? 1 : 2;
  const apr = lista?.aprobacion || {};

  return (
    <div>
      <EncabezadoSeccion
        titulo="Lista de compras"
        subtitulo="Ítems del plan de compras de cada unidad productiva."
      />

      {!up && (
        <>
          <FiltroBitacora filtro={filtro} />

          {errorResumen && <Aviso tono="bad">{errorResumen}</Aviso>}

          {!cargandoResumen && !errorResumen && (
            <Card className="mb-3.5 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Dato label="UP con plan de compras" valor={general.ups.toLocaleString('es-CO')} />
                <Dato label="Ítems comprados" valor={`${general.comprados.toLocaleString('es-CO')} de ${general.items.toLocaleString('es-CO')}`} extra={`${general.pct}%`} />
                <Dato label="Compra completa" valor={(general.completa + general.entregada).toLocaleString('es-CO')} extra={`${general.entregada} entregadas`} />
                <Dato label="Valor del plan" valor={pesos(general.valor)} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg">
                <div className="h-full transition-all" style={{ width: `${general.pct}%`, background: '#3f9a6a' }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ESTADOS.map((e) => {
                  const n = e.id === 'todas' ? general.ups : general[e.id];
                  const activa = estado === e.id;
                  return (
                    <button
                      key={e.id} type="button" onClick={() => setEstado(e.id)}
                      className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                        activa ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:border-acento'
                      }`}
                    >
                      {e.label} · {n}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {(filtro.activo || estado !== 'todas') && (
            <p className="mb-3.5 text-[12px] text-gris">
              <b className="text-texto">{filasEstado.length.toLocaleString('es-CO')}</b> unidades productivas con el filtro actual
              {filasEstado.length > MAX_LISTADO && !busqueda.trim()
                ? ` · se muestran las primeras ${MAX_LISTADO}; escribe para buscar dentro del filtro`
                : ''}
            </p>
          )}
        </>
      )}

      <Card className="overflow-hidden">
        <Pasos pasos={PASOS} actual={paso} />

        <div className="p-4 sm:p-6">
          {!up && cargandoResumen && <Spinner texto="Cargando planes de compra…" />}
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

          {cargando && <Spinner texto="Cargando lista de compras…" />}

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
                  <b className="text-texto">{lista.items.length}</b> ítems ·{' '}
                  <b className="text-texto">{lista.resumen.total_unidades ?? '—'}</b> unidades ·{' '}
                  valor del plan <b className="text-texto">{pesos(lista.resumen.valor_total)}</b>
                </div>
                {(apr.comite || apr.concepto_interventoria) && (
                  <div className="mt-0.5 text-[12px] text-gris">
                    Comité {val(apr.comite) || '—'} · {val(apr.resultado_comite) || '—'} · concepto {val(apr.concepto_interventoria) || '—'}
                  </div>
                )}
                {lista.actualizado_por && (
                  <div className="mt-0.5 text-[11px] text-gris">
                    Última actualización: {lista.actualizado_por} · {fechaHora(lista.fecha_actualizacion)}
                  </div>
                )}
                {lista.ultimo_cargue && (
                  <div className="mt-0.5 text-[11px] text-gris">
                    Último cargue de MASTER ENTREGAS: {fechaHora(lista.ultimo_cargue.fecha)}
                  </div>
                )}
              </div>

              <DatosMaster master={lista.master} />

              <div className="overflow-hidden rounded-card border border-borde bg-card">
                <Encabezado titulo="Compras realizadas" derecha={`${prog.hechos} de ${prog.total}`} />
                <div className="h-1 bg-bg">
                  <div className="h-full transition-all"
                    style={{ width: `${prog.pct}%`, background: TONOS.bueno.punto }} />
                </div>
                {entregaSinCompra && (
                  <p className="border-b border-borde px-4 py-2 text-[12px] font-semibold" style={{ color: TONOS.malo.texto, background: TONOS.malo.fondo }}>
                    Esta unidad ya está en etapa de entrega ({sem.label.toLowerCase()}), pero en la base
                    {faltan === 1 ? ' falta 1 ítem' : ` faltan ${faltan} ítems`} por marcar como comprado.
                  </p>
                )}
                <div className="flex justify-end gap-3 border-b border-borde px-4 py-2 text-[12px] font-semibold">
                  <button type="button" className="text-gris hover:text-marino" onClick={() => marcarTodos(true)}>Marcar todos</button>
                  <button type="button" className="text-gris hover:text-marino" onClick={() => marcarTodos(false)}>Desmarcar todos</button>
                </div>
                <div>
                  {lista.items.map((i) => {
                    const abierto = !!abiertos[i.id];
                    const ficha = Object.entries(i.ficha || {});
                    return (
                      <div key={i.id} className="border-b border-borde bg-card last:border-0">
                        <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                          <input
                            type="checkbox" checked={!!i.comprado} onChange={() => marcar(i.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[#3f9a6a]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-texto">
                              {i.item_n ?? i.idx + 1}. {i.nombre}
                            </span>
                            <span className="block text-[11px] text-gris">
                              {[i.codigo, i.tipo].filter(Boolean).join(' · ')}
                            </span>
                            <span className="block text-[11px] text-gris">
                              {i.cantidad ?? '—'} × {pesos(i.precio)} = <b className="text-texto">{pesos(i.total)}</b>
                            </span>
                            {i.compra && (
                              <span className="block text-[11px] text-gris">
                                {i.compra.comprado ? 'Marcado' : 'Desmarcado'} por {i.compra.por || '—'} · {fechaHora(i.compra.fecha)}
                              </span>
                            )}
                          </span>
                          {i.comprado ? (
                            <EtiquetaEstado tono="bueno">Comprado</EtiquetaEstado>
                          ) : entregaSinCompra && (
                            <EtiquetaEstado tono="malo">Sin comprar</EtiquetaEstado>
                          )}
                        </label>
                        {ficha.length > 0 && (
                          <div className="px-4 pb-3 pl-11">
                            <button type="button"
                              onClick={() => setAbiertos((a) => ({ ...a, [i.id]: !a[i.id] }))}
                              className="text-[11px] font-semibold text-gris hover:text-marino">
                              {abierto ? 'Ocultar ficha técnica' : 'Ver ficha técnica'}
                            </button>
                            {abierto && (
                              <dl className="mt-2 space-y-1.5 rounded-lg bg-bg p-3 text-[12px]">
                                {i.nombre_solicitado && i.nombre_solicitado !== i.nombre && (
                                  <div><dt className="font-semibold text-gris">Nombre solicitado</dt><dd className="text-texto">{i.nombre_solicitado}</dd></div>
                                )}
                                {ficha.map(([k, v]) => (
                                  <div key={k}>
                                    <dt className="font-semibold text-gris">{ETIQUETAS_FICHA[k] || k}</dt>
                                    <dd className="whitespace-pre-line break-words text-texto">{v}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="border-t border-borde px-4 py-2.5 text-[11px] text-gris">
                  Ítems aprobados (MASTER ENTREGAS · 1. APROBADO). «Comprado» se actualiza con cada Cargue de compras (1. APROBADO, columna AI «COMPRADO» = 1).
                </p>
                <div className="border-t border-borde p-4">
                  <Btn variant="secondary" onClick={guardar} disabled={!!guardando} className="w-full sm:w-auto">
                    {guardando === 'Guardando…' ? 'Guardando…' : 'Guardar avance'}
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

function Dato({ label, valor, extra }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gris">{label}</div>
      <div className="text-[15px] font-bold text-texto">{valor}</div>
      {extra && <div className="text-[11px] text-gris">{extra}</div>}
    </div>
  );
}

// Bloques de lo que trae el Excel de entregas: cronograma, ruta y estado de la entrega, que son de solo
// lectura.
const BLOQUES_MASTER = [
  ['cronograma', 'Cronograma (interventoría)', [
    ['estado_programacion', 'Estado de programación'],
    ['fecha_programada', 'Fecha programada'],
    ['fecha_entrega_efectiva', 'Entrega efectiva'],
    ['proveedor', 'Proveedor'],
    ['estado_documentacion', 'Estado documentación'],
    ['plazo_documentacion', 'Plazo documentación'],
  ]],
  ['entrega', 'Entrega', [
    ['estado_up', 'Estado de la UP'],
    ['estado_entrega', 'Estado de la entrega'],
    ['fecha_entrega_vigente', 'Fecha vigente'],
    ['fecha_reprogramada', 'Fecha reprogramada'],
    ['obs_cronograma', 'Observación cronograma'],
    ['observaciones_entrega', 'Observaciones de la entrega'],
  ]],
  ['ruta', 'Ruta', [
    ['ruta', 'Ruta'],
    ['fecha_ruta', 'Fecha'],
    ['hora_visita', 'Hora de visita'],
    ['hora_salida', 'Hora de salida'],
    ['punto_encuentro', 'Punto de encuentro'],
    ['coordinador', 'Coordinador'],
    ['telefono_gestor', 'Teléfono gestor'],
    ['telefono_up', 'Teléfono UP'],
    ['direccion_up', 'Dirección UP'],
  ]],
];

// Muestra los datos que trae el Excel de entregas.
function DatosMaster({ master }) {
  const bloques = BLOQUES_MASTER
    .map(([k, titulo, campos]) => [titulo, campos.filter(([c]) => master?.[k]?.[c])
      .map(([c, l]) => [l, c.startsWith('hora_') ? horaLegible(master[k][c]) : master[k][c]])])
    .filter(([, filas]) => filas.length);
  if (!bloques.length) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-card border border-borde bg-card">
      <Encabezado titulo="Programación y entrega" derecha="MASTER ENTREGAS" />
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        {bloques.map(([titulo, filas]) => (
          <div key={titulo}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-marino">{titulo}</div>
            <dl className="space-y-1.5 text-[12px]">
              {filas.map(([l, v]) => (
                <div key={l}>
                  <dt className="text-gris">{l}</dt>
                  <dd className="break-words font-medium text-texto">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
