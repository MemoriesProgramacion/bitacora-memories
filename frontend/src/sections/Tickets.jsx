// Tickets de novedades, dentro de la pestaña de novedades. Se radican con la etapa del proceso, una unidad
// opcional y hasta 5 archivos; quien lo atiende lo toma, lo asigna, lo escala o lo responde con anexos y el
// solicitante confirma la solución o la reabre. Cada movimiento avisa por correo y el servidor decide qué ve y
// qué puede hacer cada quien.
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listarTickets, crearTicket, gestionarTicket, asignablesTicket,
  ESTADOS_TICKET, NIVELES_TICKET, ACCIONES_TICKET, ETAPAS_TICKET, MAX_ARCHIVOS_TICKET, personalDeTicket, textoPersonal,
  cadenaTicket, faltasTicket, fechaLargaTicket, filtrarTickets, filtroInicial, mensajeVacio, opcionesAsignado,
  problemasArchivos, requiereAccion,
} from '../lib/tickets';
import { useComunicaciones } from '../hooks/useComunicaciones';
import { apiGeneral } from '../inventario/lib/api';
import { urlArchivo } from '../lib/api';
import { filasSelector } from '../lib/alistamiento';
import SelectorIniciativa from '../components/SelectorIniciativa';
import {
  inputCls, BloqueTitulo, Campo, FormHead, BtnMini, LinkBtn, Badge,
} from '../components/FormPiezas';

export { requiereAccion };

// Hook que carga los tickets de la sesión una vez y los mantiene al día con lo que se crea o gestiona.
export function useTickets(session) {
  const [tickets, setTickets] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    listarTickets(session)
      .then((items) => { if (vivo) { setTickets(items); setError(false); } })
      .catch((e) => { console.error('[bitacora][E-TICKETS] cargar:', e); if (vivo) setError(true); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  const guardarLocal = useCallback((t) => setTickets((prev) => (
    prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [t, ...prev]
  )), []);

  return { tickets, cargando, error, guardarLocal };
}

const fechaHora = (iso) => (iso
  ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
  : '');
const GENERALES = ['superadmin', 'coordinador_datos'];

// Muestra la bandeja con sus filtros y el formulario para radicar.
export default function Tickets({ session, tickets, cargando, error, guardarLocal }) {
  const { avisar } = useComunicaciones();
  const [filtro, setFiltro] = useState(null);
  const [etapa, setEtapa] = useState('');
  const [asignado, setAsignado] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState(null);

  const esGeneral = GENERALES.includes(session?.role);
  const atiende = esGeneral || session?.role === 'coordinador';

  const orden = useMemo(
    () => [...tickets].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)),
    [tickets],
  );
  const filtrados = useMemo(() => filtrarTickets(orden, { etapa, asignado, q: busqueda }), [orden, etapa, asignado, busqueda]);

  useEffect(() => { if (!cargando) setFiltro((f) => f ?? filtroInicial(tickets)); }, [cargando, tickets]);

  const chips = [
    { id: 'atender', nombre: 'Por atender', n: filtrados.filter(requiereAccion).length },
    { id: 'todos', nombre: 'Todos', n: filtrados.length },
    ...Object.entries(ESTADOS_TICKET).map(([id, e]) => ({
      id, nombre: e.nombre, n: filtrados.filter((t) => t.estado === id).length,
    })),
  ];
  const filtroActivo = filtro ?? filtroInicial(orden);
  const lista = filtrados.filter((t) => {
    if (filtroActivo === 'todos') return true;
    if (filtroActivo === 'atender') return requiereAccion(t);
    return t.estado === filtroActivo;
  });
  const asignados = useMemo(() => opcionesAsignado(orden), [orden]);

  async function gestionar(t, accion, extra = {}, archivos = []) {
    try {
      guardarLocal(await gestionarTicket({ id: t.id, accion, ...extra }, archivos));
      avisar({
        tomar: 'Ticket en gestión', asignar: 'Ticket asignado', escalar: 'Ticket escalado al nivel nacional',
        resolver: 'Respuesta enviada al solicitante', confirmar: 'Solución confirmada', reabrir: 'Ticket reabierto',
      }[accion]);
      return '';
    } catch (e) {
      console.error('[bitacora][E-TICKETS] gestionar:', e);
      return e?.message || 'No se pudo actualizar el ticket. Recarga e intenta de nuevo.';
    }
  }

  const subtitulo = esGeneral
    ? 'Tickets de la coordinación local, los escalados y los que radica el nivel nacional. Asígnalos, respóndelos o confírmalos.'
    : session?.role === 'coordinador'
      ? 'Tickets de tu territorio: tómalos, asígnalos a una persona o a un rol de la región, respóndelos o escálalos.'
      : 'Reporta un problema o una petición; te avisamos por correo cada movimiento. También ves los que te asignan.';

  return (
    <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <p className="text-[13px] text-gris">{subtitulo}</p>
        {!form && (
          <button type="button"
            onClick={() => setForm({ titulo: '', etapa: '', descripcion: '', id_unico: '', region: '', archivos: [] })}
            className="rounded-lg bg-marino px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-marino2">
            + Nuevo ticket
          </button>
        )}
      </div>

      {form && (
        <FormTicket f={form} setF={setForm} session={session} haciaGeneral={atiende}
          onListo={(t) => { guardarLocal(t); setForm(null); setFiltro('todos'); avisar(atiende ? 'Ticket radicado al nivel nacional' : 'Ticket radicado a tu Coordinador local regional'); }}
          onCancelar={() => setForm(null)} />
      )}

      {tickets.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-[12px] font-semibold text-gris">Etapa del proceso
            <select value={etapa} onChange={(e) => setEtapa(e.target.value)} className={inputCls}>
              <option value="">Todas</option>
              {Object.entries(ETAPAS_TICKET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-gris">Asignado a
            <select value={asignado} onChange={(e) => setAsignado(e.target.value)} className={inputCls}>
              <option value="">Cualquiera</option>
              {asignados.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold text-gris">Buscar
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Consecutivo, título, unidad…" className={inputCls} />
          </label>
        </div>
      )}

      {tickets.length > 0 && (
        <div role="group" aria-label="Filtrar tickets por estado" className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const act = filtroActivo === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={act} onClick={() => setFiltro(c.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  act ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:border-acento'
                }`}>
                {c.nombre}
                <span className={`rounded-full px-1.5 text-[10px] ${act ? 'bg-white/20' : 'bg-bg'}`}>{c.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {cargando ? (
        <p className="py-10 text-center text-[13px] text-gris">Cargando tickets…</p>
      ) : error ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-rojo">
          No se pudieron cargar los tickets. Recarga la página.
        </p>
      ) : !tickets.length ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-gris">
          Todavía no hay tickets. Abre el primero con + Nuevo ticket.
        </p>
      ) : !lista.length ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-gris">
          {mensajeVacio(filtroActivo, orden.some(requiereAccion))}
        </p>
      ) : lista.map((t) => (
        <TarjetaTicket key={t.id} t={t} onGestionar={gestionar} />
      ))}
    </>
  );
}

const ENLACE = 'inline-flex max-w-full items-center gap-1 font-semibold text-acento-txt underline [overflow-wrap:anywhere]';

// Muestra los archivos adjuntos de un ticket.
function Archivos({ titulo, lista }) {
  if (!lista.length) return null;
  return (
    <div className="mt-2 text-xs">
      <span className="text-gris">{titulo}: </span>
      {lista.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ' · '}
          <a className={ENLACE} href={urlArchivo(`/tickets/adjunto?id=${a.id}`)} target="_blank" rel="noopener noreferrer">{a.nombre}</a>
        </span>
      ))}
    </div>
  );
}

// Muestra las salidas del ticket para el solicitante: radicado, respondido y solucionado.
function Cadena({ t }) {
  const pasos = cadenaTicket(t);
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Salidas del ticket">
      {pasos.map((p, i) => (
        <li key={p.clave} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-gris">→</span>}
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${p.hecho ? 'border-verde-ok/40 bg-verde-ok/10 text-verde-ok' : 'border-borde text-gris'}`}>
            {p.nombre}{p.cuando ? ` · ${fechaHora(p.cuando)}` : ''}<span className="sr-only">{p.hecho ? ' (hecho)' : ' (pendiente)'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// Muestra un ticket con su historial y las acciones permitidas.
function TarjetaTicket({ t, onGestionar }) {
  const [historial, setHistorial] = useState(false);
  const [nota, setNota] = useState('');
  const [archivos, setArchivos] = useState([]);
  const [error, setError] = useState('');
  const [errorAsignar, setErrorAsignar] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [opciones, setOpciones] = useState(null);
  const [destino, setDestino] = useState('');
  const idNota = `tk-nota-${t.id}`;
  const idAsignar = `tk-asignar-${t.id}`;

  const estado = ESTADOS_TICKET[t.estado] || { nombre: t.estado, tono: 'neutral' };
  const bordes = { bad: 'border-l-rojo', warn: 'border-l-acento', ok: 'border-l-verde-ok', info: 'border-l-[#3182ce]' };
  const p = t.puede || {};
  const gestionable = p.tomar || p.asignar || p.escalar || p.resolver;
  const radicacion = t.adjuntos.filter((a) => a.clase === 'radicacion');
  const respuesta = t.adjuntos.filter((a) => a.clase === 'respuesta');
  const malos = problemasArchivos(archivos);

  async function accion(a, extra = {}, conArchivos = []) {
    if (['escalar', 'resolver', 'reabrir'].includes(a) && !nota.trim()) { setError('Escribe una nota antes de continuar.'); return; }
    setError('');
    setErrorAsignar('');
    setOcupado(true);
    const fallo = await onGestionar(t, a, { nota: nota.trim() || undefined, ...extra }, conArchivos);
    setOcupado(false);
    if (fallo) (a === 'asignar' ? setErrorAsignar : setError)(fallo);
    else { setNota(''); setArchivos([]); setOpciones(null); setDestino(''); }
  }
  async function abrirAsignar() {
    setErrorAsignar('');
    try { setOpciones(await asignablesTicket(t.id)); } catch (e) { setErrorAsignar(e?.message || 'No se pudieron cargar las personas.'); }
  }

  return (
    <article className={`mb-3 rounded-card border border-l-4 border-borde bg-card p-4 ${bordes[estado.tono] || 'border-l-gris'}`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge tono={estado.tono}>{estado.nombre}</Badge>
          {t.nombre_etapa && <Badge tono="neutral" title="Etapa del proceso">{t.nombre_etapa}</Badge>}
          {!['respondido', 'resuelto'].includes(t.estado) && (
            <Badge tono="neutral" title="Quién lo atiende ahora">Atiende: {NIVELES_TICKET[t.nivel]}</Badge>
          )}
          {t.asignado && <Badge tono="info" title="Asignado a" ajustar>{t.asignado.tipo === 'cuenta' ? `${t.asignado.nombre} (${t.asignado.nombre_rol})` : `Cola: ${t.asignado.nombre_rol}`}</Badge>}
        </div>
        <span className="text-[11px] text-gris">{t.consecutivo} · {fechaHora(t.creado_en)}</span>
      </div>

      <h3 className="mb-1.5 text-base font-bold text-marino [overflow-wrap:anywhere]">{t.titulo}</h3>
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-texto [overflow-wrap:anywhere]">{t.descripcion}</p>
      {personalDeTicket(t) && (
        <p className="mt-2 rounded-lg border border-borde bg-bg px-2.5 py-2 text-xs text-texto [overflow-wrap:anywhere]">
          <b className="text-marino">Personal que sale:</b> {textoPersonal(personalDeTicket(t).sale)}
          {personalDeTicket(t).entra && <> · <b className="text-marino">Entra:</b> {personalDeTicket(t).entra}</>}
        </p>
      )}
      <p className="mt-2 text-[11px] text-gris">
        Radicó {t.creado_por} ({t.creado_por_rol}) · {t.region || 'Sin región'}{t.nodo ? ` · ${t.nodo}` : ''}
        {t.id_unico ? ` · Unidad ${t.id_unico}${t.unidad ? ` (${t.unidad})` : ''}` : ''}
      </p>
      <Archivos titulo="Archivos de la radicación" lista={radicacion} />
      <Archivos titulo="Anexos de la respuesta" lista={respuesta} />
      <Cadena t={t} />
      {t.estado === 'respondido' && t.confirmar_hasta && (
        <p className="mt-2 text-[11px] text-gris">{t.es_mio ? 'Confirma la solución o reábrelo' : 'El solicitante confirma o lo reabre'} hasta el {fechaLargaTicket(t.confirmar_hasta)}; si no, queda solucionado.</p>
      )}

      {(gestionable || p.confirmar || p.reabrir) && (
        <div className="mt-3 border-t border-borde pt-3">
          <Campo id={idNota} label="Nota" opcional={!p.escalar && !p.resolver && !p.reabrir} error={error}>
            <textarea id={idNota} rows="2" value={nota} maxLength={2000}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${idNota}-error` : undefined}
              onChange={(e) => { setNota(e.target.value); setError(''); }}
              placeholder={p.reabrir ? 'Si la reabres, cuenta qué falta.' : 'Qué hiciste, la respuesta o por qué lo escalas. Queda en el historial y en el correo.'}
              className={inputCls} />
          </Campo>
          {p.resolver && (
            <Campo id={`tk-anexos-${t.id}`} label={`Anexos de la respuesta (PDF, JPG o PNG; hasta ${MAX_ARCHIVOS_TICKET})`} opcional error={malos.join(' ') || undefined}>
              <input id={`tk-anexos-${t.id}`} type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                onChange={(e) => setArchivos([...(e.target.files || [])])} className={inputCls} />
            </Campo>
          )}
          {opciones && (
            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="grid gap-1 text-[12px] font-semibold text-gris">Asignar a
                <select value={destino} onChange={(e) => { setDestino(e.target.value); setErrorAsignar(''); }} className={inputCls}
                  aria-invalid={errorAsignar ? true : undefined} aria-describedby={errorAsignar ? `${idAsignar}-error` : undefined}>
                  <option value="">Elige una persona o un rol…</option>
                  {opciones.cuentas.length > 0 && (
                    <optgroup label="Personas del territorio">
                      {opciones.cuentas.map((c) => <option key={c.sub} value={`cuenta:${c.sub}`}>{c.nombre} · {c.nombre_rol}{c.nodo ? ` · ${c.nodo}` : ''}</option>)}
                    </optgroup>
                  )}
                  {opciones.roles.length > 0 && (
                    <optgroup label={`Un rol de ${opciones.region}`}>
                      {opciones.roles.map((r) => <option key={r.rol} value={`rol:${r.rol}`}>Cualquier {r.nombre_rol.toLowerCase()} de la región</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              <div className="flex gap-2">
                <BtnMini disabled={ocupado || !destino} onClick={() => accion('asignar', { asignado: destino })}>Asignar</BtnMini>
                <BtnMini disabled={ocupado} onClick={() => { setOpciones(null); setDestino(''); setErrorAsignar(''); }}>Cancelar</BtnMini>
              </div>
              {errorAsignar && <p id={`${idAsignar}-error`} role="alert" className="text-[12px] font-semibold text-rojo sm:col-span-2">{errorAsignar}</p>}
              {!opciones.cuentas.length && !opciones.roles.length && <p className="text-[12px] text-gris sm:col-span-2">No hay personas activas en el territorio del ticket.</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {p.tomar && <BtnMini disabled={ocupado} onClick={() => accion('tomar')}>Tomar</BtnMini>}
            {p.asignar && !opciones && <BtnMini disabled={ocupado} onClick={abrirAsignar}>Asignar…</BtnMini>}
            {p.resolver && <BtnMini disabled={ocupado || malos.length > 0} onClick={() => accion('resolver', {}, archivos)}>Resuelto: enviar respuesta</BtnMini>}
            {p.confirmar && <BtnMini disabled={ocupado} onClick={() => accion('confirmar')}>Confirmar solución</BtnMini>}
            {p.reabrir && <BtnMini peligro disabled={ocupado} onClick={() => accion('reabrir')}>Reabrir</BtnMini>}
            {p.escalar && <BtnMini peligro disabled={ocupado} onClick={() => accion('escalar')}>Escalar al nivel nacional</BtnMini>}
          </div>
          {!opciones && errorAsignar && <p id={`${idAsignar}-error`} role="alert" className="mt-2 text-[12px] font-semibold text-rojo">{errorAsignar}</p>}
        </div>
      )}

      <div className="mt-3 border-t border-borde pt-2">
        <LinkBtn aria-expanded={historial} onClick={() => setHistorial(!historial)}>
          {historial ? '▴ Ocultar historial' : `▾ Ver historial (${t.historial.length})`}
        </LinkBtn>
        {historial && (
          <ol className="mt-2 space-y-2">
            {t.historial.map((h, i) => (
              <li key={i} className="rounded-lg border border-borde bg-bg p-2.5 text-xs text-texto">
                <div className="font-semibold text-marino">{ACCIONES_TICKET[h.accion] || h.accion}{h.asignado ? `: ${h.asignado}` : ''}{h.anexos ? ` · ${h.anexos} archivo${h.anexos === 1 ? '' : 's'}` : ''}</div>
                <div className="text-gris">{h.por} ({h.rol}) · {fechaHora(h.cuando)}</div>
                {h.nota && <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{h.nota}</p>}
                {h.personal_sale?.length > 0 && <p className="mt-1 text-gris [overflow-wrap:anywhere]">Personal que sale: {textoPersonal(h.personal_sale)}{h.entra ? ` · Entra: ${h.entra}` : ''}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

// Formulario para radicar un ticket.
function FormTicket({ f, setF, session, haciaGeneral, onListo, onCancelar }) {
  const [unidades, setUnidades] = useState(null);
  const [errorUnidades, setErrorUnidades] = useState(false);
  const [intentoUnidades, setIntentoUnidades] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [falla, setFalla] = useState('');
  const [intentado, setIntentado] = useState(false);
  const esGeneral = GENERALES.includes(session?.role);
  const conUnidad = session?.role !== 'tallerista';
  useEffect(() => {
    if (!conUnidad) return undefined;
    let vivo = true;
    setUnidades(null);
    setErrorUnidades(false);
    apiGeneral.get('/unidades')
      .then((r) => { if (vivo) setUnidades(r.items || []); })
      .catch((e) => { console.error('[bitacora][E-TICKETS] unidades:', e); if (vivo) { setUnidades([]); setErrorUnidades(true); } });
    return () => { vivo = false; };
  }, [conUnidad, intentoUnidades]);
  const filas = useMemo(() => filasSelector(unidades), [unidades]);
  const regiones = useMemo(() => [...new Set((unidades || []).map((u) => u.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [unidades]);
  const campo = (k, v) => setF({ ...f, [k]: v });
  const faltas = faltasTicket(f, f.archivos);

  async function enviar() {
    if (faltas.length) { setIntentado(true); return; }
    setGuardando(true);
    setFalla('');
    try {
      const t = await crearTicket({ titulo: f.titulo.trim(), etapa: f.etapa, descripcion: f.descripcion.trim(), id_unico: f.id_unico,
        region: esGeneral && !f.id_unico ? f.region : '' }, f.archivos);
      onListo(t);
    } catch (e) {
      console.error('[bitacora][E-TICKETS] crear:', e);
      setFalla(e?.message || 'No se pudo radicar el ticket. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="mb-5 rounded-card border border-borde bg-card p-5" aria-label="Nuevo ticket">
      <FormHead titulo="Nuevo ticket" onCancelar={onCancelar} />
      <BloqueTitulo n={1} titulo="Qué necesitas"
        ayuda={haciaGeneral
          ? 'Le llegará al nivel nacional (Coordinador general y Profesional de seguimiento).'
          : 'Le llegará al Coordinador local regional de tu región. Si no puede resolverlo, lo asigna o lo escala.'} />
      <Campo id="tk-titulo" label="Título">
        <input id="tk-titulo" type="text" maxLength="150" value={f.titulo}
          onChange={(e) => campo('titulo', e.target.value)}
          placeholder="Ej. No puedo cargar los soportes de una visita" className={inputCls} />
      </Campo>
      <Campo id="tk-etapa" label="Etapa del proceso">
        <select id="tk-etapa" value={f.etapa} onChange={(e) => campo('etapa', e.target.value)} className={inputCls}>
          <option value="">Elige la etapa…</option>
          {Object.entries(ETAPAS_TICKET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Campo>
      <Campo id="tk-desc" label="Descripción">
        <textarea id="tk-desc" rows="4" maxLength="4000" value={f.descripcion}
          onChange={(e) => campo('descripcion', e.target.value)}
          placeholder="Cuéntanos qué pasa, con qué iniciativa y desde cuándo."
          className={inputCls} />
      </Campo>
      {conUnidad && (
        <div className="mb-3">
          {unidades === null ? <p className="text-[12px] text-gris">Cargando las unidades…</p> : errorUnidades ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-rojo">
              <span>No se pudieron cargar las unidades. Puedes radicar sin unidad o reintentar.</span>
              <LinkBtn onClick={() => setIntentoUnidades((n) => n + 1)}>Reintentar</LinkBtn>
            </div>
          ) : (
            <>
              <SelectorIniciativa filas={filas} valor={f.id_unico} onElegir={(x) => campo('id_unico', x.ID_unico)} etiqueta="Unidad productiva (si aplica)" />
              {f.id_unico && <LinkBtn onClick={() => campo('id_unico', '')}>Quitar la unidad</LinkBtn>}
            </>
          )}
        </div>
      )}
      {esGeneral && !f.id_unico && (
        <Campo id="tk-region" label="Región" opcional>
          <select id="tk-region" value={f.region} onChange={(e) => campo('region', e.target.value)} className={inputCls}>
            <option value="">Todo el programa</option>
            {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Campo>
      )}
      <Campo id="tk-archivos" label={`Archivos (PDF, JPG o PNG; hasta ${MAX_ARCHIVOS_TICKET})`} opcional error={problemasArchivos(f.archivos).join(' ') || undefined}>
        <input id="tk-archivos" type="file" multiple accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          onChange={(e) => campo('archivos', [...(e.target.files || [])])} className={inputCls} />
      </Campo>
      {((intentado && faltas.length > 0) || falla) && <p role="alert" className="mb-3 text-[12px] font-semibold text-rojo">{falla || `Falta: ${faltas.join(' ')}`}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar}
          className="rounded-lg border border-borde bg-card px-3.5 py-2 text-[13px] font-semibold text-texto hover:border-acento">
          Cancelar
        </button>
        <button type="button" disabled={guardando} onClick={enviar}
          className="rounded-lg bg-marino px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-marino2 disabled:opacity-50">
          {guardando ? 'Enviando…' : 'Radicar ticket'}
        </button>
      </div>
    </section>
  );
}
