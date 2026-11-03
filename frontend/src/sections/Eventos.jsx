// Sección de eventos, que persiste mediante el hook de comunicaciones.
import { useState, useMemo } from 'react';
import {
  TIPOS_EVENTO, RESPUESTAS_EVENTO, useGestores, todosNodos,
  nombreGestor, metaGestor, ordenGestores, destLabel,
  esPasado, diasHasta, fechaLarga, horaLegible, horaDecompuesta,
  horaCompuesta, cuandoRelativo, publicadoRelativo, hoyISO, plural, resp,
} from '../lib/comunicaciones';
import { useComunicaciones, usePedirGestores } from '../hooks/useComunicaciones';
import { nuevoIdEvento } from '../lib/eventos';
import Destinatarios, { destNuevo } from '../components/Destinatarios';
import {
  inputCls, BloqueTitulo, Campo, FormHead, FormPie,
  ListaPersonas, Confirmar, BtnMini, LinkBtn, Badge,
} from '../components/FormPiezas';
import { Aviso } from '../components/UI';
import Cierre from './eventos/Cierre';

// Muestra la lista de eventos, sus filtros y los controles para crear y responder.
export default function Eventos() {
  const { eventos, setEventos, esCoord, soloLectura, miNodo, avisar, pendientesEventos } = useComunicaciones();
  useGestores();
  usePedirGestores();
  const [vista, setVista] = useState('proximos');
  const [form, setForm] = useState(null);
  const [respAbierta, setRespAbierta] = useState({});
  const [confirmar, setConfirmar] = useState(null);

  const meIncluye = (e) => Object.prototype.hasOwnProperty.call(e.respuestas, miNodo);
  const visibles = eventos.filter((e) => esCoord || meIncluye(e));
  const proximos = visibles.filter((e) => !esPasado(e.fecha))
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const pasados = visibles.filter((e) => esPasado(e.fecha))
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  const lista = vista === 'proximos' ? proximos : pasados;

  function guardar(f) {
    const errores = {};
    if (!f.tipo) errores.tipo = true;
    if (!f.titulo.trim()) errores.titulo = true;
    if (!f.fecha) errores.fecha = true;
    if (!f.hora) errores.hora = true;
    if (!f.lugar.trim()) errores.lugar = true;
    if (!f.dest.sel.length) errores.dest = true;
    if (Object.keys(errores).length) { setForm({ ...f, errores }); return; }

    const datos = {
      titulo: f.titulo.trim(), tipo: f.tipo, fecha: f.fecha, hora: f.hora,
      modalidad: f.modalidad, lugar: f.lugar.trim(), descripcion: f.descripcion.trim(),
    };
    const n = f.dest.sel.length;

    if (f.editId) {
      setEventos((prev) => prev.map((e) => {
        if (e.id !== f.editId) return e;
        const nuevas = {};
        f.dest.sel.forEach((nodo) => { nuevas[nodo] = e.respuestas[nodo] || resp(); });
        return { ...e, ...datos, respuestas: nuevas };
      }));
      avisar(`Cambios guardados. Lo verán ${plural(n, 'gestor', 'gestores')}`);
    } else {
      const nuevas = {};
      f.dest.sel.forEach((nodo) => { nuevas[nodo] = resp(); });
      setEventos((prev) => [...prev, {
        ...datos, id: nuevoIdEvento(), respuestas: nuevas,
      }]);
      avisar(`Evento publicado para ${plural(n, 'gestor', 'gestores')}`);
    }
    setForm(null);
    setVista(esPasado(datos.fecha) ? 'pasados' : 'proximos');
  }

  return (
    <>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-marino">Eventos</h2>
          <p className="text-[13px] text-gris">
            {soloLectura ? 'Consulta los eventos de tu territorio.' : esCoord
              ? 'Convoca reuniones, elige exactamente a quién y revisa quién asiste.'
              : 'Confirma tu asistencia a las reuniones a las que te convocan.'}
          </p>
        </div>
        {esCoord && !soloLectura && !form && (
          <button type="button"
            onClick={() => setForm({
              editId: null, tipo: null, titulo: '', fecha: '', hora: '',
              horaH: '', horaM: '', horaAp: '', modalidad: 'Presencial',
              lugar: '', descripcion: '', dest: destNuevo(todosNodos()), errores: {},
            })}
            className="rounded-lg bg-marino px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-marino2">
            + Nuevo evento
          </button>
        )}
      </div>

      <Aviso className="mt-3">
          Aún no se envían notificaciones automáticas a los gestores.
      </Aviso>

      {esCoord && !soloLectura && form && (
        <FormEvento f={form} setF={setForm} onGuardar={guardar} onCancelar={() => setForm(null)} />
      )}

      {!esCoord && pendientesEventos > 0 && (
        <div className="mb-4 rounded-lg border border-acento/45 bg-acento/12 px-3.5 py-2.5 text-[13px] text-aviso-txt">
          Tienes <b>{pendientesEventos} evento{pendientesEventos === 1 ? '' : 's'}</b> esperando tu respuesta.
        </div>
      )}

      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-borde bg-card">
        {[['proximos', 'Próximos', proximos.length], ['pasados', 'Pasados', pasados.length], ...(esCoord ? [['cierre', 'Cierre por departamento', null]] : [])]
          .map(([id, label, n], i) => (
            <button key={id} type="button" onClick={() => setVista(id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold transition ${
                i < 2 || esCoord ? 'border-r border-borde last:border-r-0' : ''
              } ${vista === id ? 'bg-marino text-white' : 'text-gris hover:bg-bg'}`}>
              {label}
              {n !== null && <span className={`rounded-full px-1.5 text-[11px] ${
                vista === id ? 'bg-white/20' : 'bg-bg'
              }`}>{n}</span>}
            </button>
          ))}
      </div>

      {vista === 'cierre' ? <Cierre /> : !lista.length ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-gris">
          {vista === 'pasados' ? 'Todavía no hay eventos pasados.'
            : esCoord ? `No hay eventos próximos.${soloLectura ? '' : ' Crea uno con + Nuevo evento.'}`
            : 'No tienes eventos próximos. Cuando la coordinación te convoque, aparecerán aquí.'}
        </p>
      ) : lista.map((e) => (
        <TarjetaEvento key={e.id} e={e} pasado={vista === 'pasados'}
          esCoord={esCoord} soloLectura={soloLectura} miNodo={miNodo}
          filtro={respAbierta[e.id]}
          onFiltro={(grupo) => setRespAbierta((p) => {
            const actual = p[e.id];
            const next = { ...p };
            if (grupo === 'todas') { if (actual) delete next[e.id]; else next[e.id] = 'todas'; }
            else if (actual === grupo) delete next[e.id];
            else next[e.id] = grupo;
            return next;
          })}
          confirmar={confirmar === e.id}
          onPedirBorrar={() => setConfirmar(e.id)}
          onCancelarBorrar={() => setConfirmar(null)}
          onBorrar={() => {
            setEventos((prev) => prev.filter((x) => x.id !== e.id));
            setConfirmar(null);
            avisar('Evento eliminado');
          }}
          onEditar={() => {
            const hd = horaDecompuesta(e.hora);
            setForm({
              editId: e.id, tipo: e.tipo, titulo: e.titulo, fecha: e.fecha, hora: e.hora,
              horaH: hd.h, horaM: hd.m, horaAp: hd.ap, modalidad: e.modalidad,
              lugar: e.lugar, descripcion: e.descripcion,
              dest: destNuevo(Object.keys(e.respuestas)), errores: {},
            });
            setConfirmar(null);
          }}
          onResponder={(valor) => {
            setEventos((prev) => prev.map((x) => x.id !== e.id ? x : {
              ...x, respuestas: { ...x.respuestas, [miNodo]: { ...x.respuestas[miNodo], valor } },
            }));
            avisar(`Respuesta enviada: ${RESPUESTAS_EVENTO.find((r) => r.id === valor).label}`);
          }}
          onComentario={(texto, foto) => {
            setEventos((prev) => prev.map((x) => x.id !== e.id ? x : {
              ...x, respuestas: {
                ...x.respuestas,
                [miNodo]: { ...x.respuestas[miNodo], comentario: texto, foto: foto ?? x.respuestas[miNodo].foto },
              },
            }));
            avisar('Comentario enviado a la coordinación');
          }}
          onRecordar={(sin) => {
            setEventos((prev) => prev.map((x) => x.id !== e.id ? x : { ...x, recordado: hoyISO() }));
            avisar(`Recordatorio enviado a ${plural(sin, 'gestor', 'gestores')} (simulado)`);
          }}
        />
      ))}
    </>
  );
}

// Muestra un evento con sus destinatarios y respuestas.
function TarjetaEvento({
  e, pasado, esCoord, soloLectura, miNodo, filtro, onFiltro, confirmar,
  onPedirBorrar, onCancelarBorrar, onBorrar, onEditar,
  onResponder, onComentario, onRecordar,
}) {
  const [comentAbierto, setComentAbierto] = useState(false);
  const [draft, setDraft] = useState('');

  const destinatarios = Object.keys(e.respuestas);
  const tipo = TIPOS_EVENTO.find((t) => t.id === e.tipo) || { nombre: 'Evento' };
  const mia = esCoord ? null : e.respuestas[miNodo];
  const pendiente = !esCoord && !pasado && mia && !mia.valor;
  const dias = diasHasta(e.fecha);

  const tally = useMemo(() => {
    const t = { si: 0, porconfirmar: 0, no: 0, sin: 0 };
    destinatarios.forEach((n) => { t[e.respuestas[n].valor || 'sin']++; });
    return t;
  }, [e.respuestas, destinatarios]);

  function abrirComentario() {
    const abrir = !comentAbierto;
    setComentAbierto(abrir);
    if (abrir) setDraft(mia?.comentario || '');
  }

  return (
    <article id={`ev-${e.id}`}
      className={`mb-3 rounded-card border bg-card p-4 ${
        pendiente ? 'border-acento' : 'border-borde'
      } ${pasado ? 'opacity-75' : ''}`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{tipo.nombre}</Badge>
          {esCoord && <Badge tono="info" title="Destinatarios">{destLabel(destinatarios)}</Badge>}
          {pendiente && <Badge tono="warn">Falta tu respuesta</Badge>}
        </div>
        {esCoord && !soloLectura && (
          <div className="flex shrink-0 gap-2.5">
            <LinkBtn onClick={onEditar}>Editar</LinkBtn>
            <LinkBtn peligro onClick={onPedirBorrar}>Eliminar</LinkBtn>
          </div>
        )}
      </div>

      <h3 className="mb-2 text-base font-bold text-marino">{e.titulo}</h3>
      <p className="mb-1 text-[13px] text-texto">
        📅 {fechaLarga(e.fecha)}, {horaLegible(e.hora)}{' '}
        <span className={dias >= 0 && dias <= 3 ? 'font-semibold text-acento-txt' : 'text-gris'}>
          ({cuandoRelativo(e.fecha)})
        </span>
      </p>
      <p className="mb-2 text-[13px] text-texto">
        {e.modalidad === 'Virtual' ? '💻' : '📍'} {e.modalidad} — {e.lugar || 'Lugar por confirmar'}
      </p>
      {e.descripcion && <p className="mb-3 text-[13px] leading-relaxed text-gris">{e.descripcion}</p>}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RESPUESTAS_EVENTO.map((r) => {
          const tonos = {
            ok: 'border-verde-ok/35 bg-verde-ok/8 text-verde-ok',
            warn: 'border-acento/45 bg-acento/10 text-aviso-txt',
            bad: 'border-rojo/35 bg-rojo/8 text-rojo',
            neutral: 'border-borde bg-bg text-gris',
          };
          const contenido = (
            <>
              <span className="block text-lg font-bold leading-none">{tally[r.id]}</span>
              <span className="block text-[10px] uppercase tracking-wide">{r.corto}</span>
            </>
          );
          return esCoord ? (
            <button key={r.id} type="button" onClick={() => onFiltro(r.id)}
              aria-pressed={filtro === r.id} title="Ver quiénes"
              className={`rounded-lg border p-2 text-center transition ${tonos[r.tono]} ${
                filtro === r.id ? 'ring-2 ring-marino' : ''
              }`}>
              {contenido}
            </button>
          ) : (
            <div key={r.id} className={`rounded-lg border p-2 text-center ${tonos[r.tono]}`}>
              {contenido}
            </div>
          );
        })}
      </div>

      {esCoord ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LinkBtn aria-expanded={!!filtro} onClick={() => onFiltro('todas')}>
              {filtro ? '▴ Ocultar respuestas' : '▾ Ver respuestas por gestor'}
            </LinkBtn>
            <div className="flex flex-wrap items-center gap-2">
              {e.recordado && (
                <span className="text-[11px] italic text-gris">
                  Recordatorio enviado {publicadoRelativo(e.recordado).toLowerCase()}
                </span>
              )}
              {!soloLectura && !pasado && tally.sin > 0 && (
                <BtnMini onClick={() => onRecordar(tally.sin)}>
                  Recordar a {tally.sin === 1 ? 'quien no ha respondido' : `los ${tally.sin} sin responder`}
                </BtnMini>
              )}
            </div>
          </div>

          {filtro && (() => {
            let grupos = RESPUESTAS_EVENTO.map((r) => ({
              id: r.id, tono: r.tono, titulo: r.grupo,
              items: ordenGestores(destinatarios)
                .filter((n) => (e.respuestas[n].valor || 'sin') === r.id)
                .map((n) => ({
                  nodo: n, nombre: nombreGestor(n), meta: metaGestor(n),
                  extra: [e.respuestas[n].foto && `📷 ${e.respuestas[n].foto}`,
                          e.respuestas[n].comentario].filter(Boolean).join(' · '),
                })),
            }));
            grupos = filtro !== 'todas'
              ? grupos.filter((g) => g.id === filtro)
              : grupos.filter((g) => g.items.length);
            return (
              <ListaPersonas grupos={grupos} pie={filtro !== 'todas' && (
                <LinkBtn onClick={() => onFiltro('todas')}>Ver todas las respuestas</LinkBtn>
              )} />
            );
          })()}

          {confirmar && (
            <Confirmar
              texto="¿Eliminar este evento? Las personas convocadas dejarán de verlo y se perderán sus respuestas."
              onCancelar={onCancelarBorrar} onBorrar={onBorrar} />
          )}
        </>
      ) : !pasado ? (
        <>
          <div className="rounded-lg bg-bg p-3">
            <p className="mb-2 text-[13px] font-semibold text-texto">
              {mia.valor ? 'Tu respuesta (puedes cambiarla)' : '¿Asistirás?'}
            </p>
            <div className="flex flex-wrap gap-2">
              {RESPUESTAS_EVENTO.slice(0, 3).map((r) => {
                const sel = mia.valor === r.id;
                const tonos = {
                  ok: 'border-verde-ok bg-verde-ok/12 text-verde-ok',
                  warn: 'border-acento bg-acento/14 text-aviso-txt',
                  bad: 'border-rojo bg-rojo/10 text-rojo',
                };
                return (
                  <button key={r.id} type="button" aria-pressed={sel}
                    onClick={() => onResponder(r.id)}
                    className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition ${
                      sel ? `border-2 ${tonos[r.tono]}` : 'border-borde bg-card text-texto hover:border-acento'
                    }`}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2">
            <LinkBtn aria-expanded={comentAbierto} onClick={abrirComentario}>
              {comentAbierto ? '▴ Ocultar comentario o foto'
                : (mia.comentario || mia.foto) ? '✎ Ver o editar tu comentario'
                : '+ Agregar comentario o foto (opcional)'}
            </LinkBtn>
            {comentAbierto && (
              <div className="mt-2 rounded-lg border border-borde bg-bg p-3">
                <textarea rows="3" value={draft} onChange={(ev) => setDraft(ev.target.value)}
                  aria-label="Comentario para la coordinación"
                  placeholder="Ej. motivo si no puedes asistir, o algo que la coordinación deba saber…"
                  className={inputCls} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-md border border-borde bg-card px-2.5 py-1 text-[11px] font-semibold text-gris hover:border-acento">
                    📷 {mia.foto ? 'Cambiar foto' : 'Adjuntar foto de la unidad'}
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(ev) => {
                        if (ev.target.files[0]) onComentario(draft, ev.target.files[0].name);
                      }} />
                  </label>
                  {mia.foto && (
                    <>
                      <span className="text-[11px] italic text-gris">{mia.foto}</span>
                      <LinkBtn peligro onClick={() => onComentario(draft, '')}>Quitar</LinkBtn>
                    </>
                  )}
                </div>
                <div className="mt-2.5 flex justify-end gap-2">
                  <LinkBtn onClick={() => setComentAbierto(false)}>Cancelar</LinkBtn>
                  <button type="button"
                    onClick={() => { onComentario(draft.trim()); setComentAbierto(false); }}
                    className="rounded-lg bg-marino px-3 py-1.5 text-xs font-semibold text-white hover:bg-marino2">
                    Confirmar envío
                  </button>
                </div>
                <p className="mt-2 text-[11px] italic text-gris">
                  La coordinación verá tu comentario junto a tu respuesta solo después de que confirmes el envío.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-lg bg-bg p-3 text-[13px] text-texto">
          <b>Tu respuesta:</b>{' '}
          {{ si: 'Confirmaste tu asistencia', no: 'Indicaste que no podías asistir',
             porconfirmar: 'Quedó como "por confirmar"' }[mia?.valor] || 'No respondiste a este evento'}
          {mia?.comentario && ` — "${mia.comentario}"`}
          {mia?.foto && <span className="ml-1 italic text-gris">📷 {mia.foto}</span>}
        </div>
      )}
    </article>
  );
}

// Formulario para crear o editar un evento.
function FormEvento({ f, setF, onGuardar, onCancelar }) {
  const campo = (k, v) => setF({ ...f, [k]: v, errores: { ...f.errores, [k]: false } });
  const virtual = f.modalidad === 'Virtual';

  function setHora(parte, valor) {
    const next = { ...f, [`hora${parte}`]: valor };
    next.hora = horaCompuesta(
      parte === 'H' ? valor : next.horaH,
      parte === 'M' ? valor : next.horaM,
      parte === 'Ap' ? valor : next.horaAp
    );
    next.errores = { ...f.errores, hora: false };
    setF(next);
  }

  const horas = Array.from({ length: 12 }, (_, i) => i + 1);
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

  return (
    <section id="ev-form" className="mb-5 rounded-card border border-borde bg-card p-5"
      aria-label={f.editId ? 'Editar evento' : 'Nuevo evento'}>
      <FormHead titulo={f.editId ? 'Editar evento' : 'Nuevo evento'} onCancelar={onCancelar} />

      <div className="mb-5">
        <BloqueTitulo n={1} titulo="Qué se va a hacer" />
        <Campo label="Tipo de evento" error={f.errores.tipo && 'Elige el tipo de evento.'}>
          <div role="radiogroup" className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {TIPOS_EVENTO.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={f.tipo === t.id}
                onClick={() => campo('tipo', t.id)}
                className={`flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition ${
                  f.tipo === t.id ? 'border-verde-ok bg-verde-ok/8' : 'border-borde bg-bg hover:border-acento'
                }`}>
                <span className="text-[13px] font-bold text-marino">{t.nombre}</span>
                <span className="text-[11px] text-gris">{t.desc}</span>
              </button>
            ))}
          </div>
        </Campo>
        <Campo id="ev-titulo" label="Título" error={f.errores.titulo && 'Escribe un título para el evento.'}>
          <input id="ev-titulo" type="text" maxLength="120" value={f.titulo}
            onChange={(e) => campo('titulo', e.target.value)}
            placeholder="Ej. Asamblea trimestral — Nodo Atlántico" className={inputCls} />
        </Campo>
        <Campo id="ev-desc" label="Descripción" opcional>
          <textarea id="ev-desc" rows="3" value={f.descripcion}
            onChange={(e) => campo('descripcion', e.target.value)}
            placeholder="¿De qué trata la reunión? ¿Qué deben llevar o preparar?" className={inputCls} />
        </Campo>
      </div>

      <div className="mb-5">
        <BloqueTitulo n={2} titulo="Cuándo y dónde" />
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Campo id="ev-fecha" label="Fecha" error={f.errores.fecha && 'Indica la fecha del evento.'}>
            <input id="ev-fecha" type="date" value={f.fecha} min={f.editId ? undefined : hoyISO()}
              onChange={(e) => campo('fecha', e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Hora" error={f.errores.hora && 'Indica la hora, los minutos y si es a. m. o p. m.'}>
            <div className="flex gap-1.5">
              <select value={f.horaH} onChange={(e) => setHora('H', e.target.value)}
                aria-label="Hora" className={`${inputCls} cursor-pointer`}>
                <option value="">Hora</option>
                {horas.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <select value={f.horaM} onChange={(e) => setHora('M', e.target.value)}
                aria-label="Minutos" className={`${inputCls} cursor-pointer`}>
                <option value="">Min.</option>
                {mins.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={f.horaAp} onChange={(e) => setHora('Ap', e.target.value)}
                aria-label="a. m. o p. m." className={`${inputCls} cursor-pointer`}>
                <option value="">a. m. / p. m.</option>
                <option value="AM">a. m.</option>
                <option value="PM">p. m.</option>
              </select>
            </div>
          </Campo>
          <Campo label="Modalidad">
            <div role="radiogroup" className="inline-flex overflow-hidden rounded-lg border border-borde">
              {['Presencial', 'Virtual'].map((m, i) => (
                <button key={m} type="button" role="radio" aria-checked={f.modalidad === m}
                  onClick={() => setF({ ...f, modalidad: m })}
                  className={`px-4 py-2 text-[13px] font-semibold transition ${
                    i === 0 ? 'border-r border-borde' : ''
                  } ${f.modalidad === m ? 'bg-marino text-white' : 'bg-card text-gris hover:bg-bg'}`}>
                  {m}
                </button>
              ))}
            </div>
          </Campo>
          <Campo id="ev-lugar" label={virtual ? 'Enlace de la reunión' : 'Lugar'}
            error={f.errores.lugar && (virtual ? 'Indica el enlace de la reunión.' : 'Indica el lugar de la reunión.')}>
            <input id="ev-lugar" type="text" value={f.lugar}
              onChange={(e) => campo('lugar', e.target.value)}
              placeholder={virtual ? 'Enlace de Meet, Teams o «se envía por WhatsApp»' : 'Ej. Salón comunal, Luruaco'}
              className={inputCls} />
          </Campo>
        </div>
      </div>

      <div className="mb-2">
        <BloqueTitulo n={3} titulo="A quién se convoca"
          ayuda="Solo las personas marcadas verán el evento y podrán responder. Puedes marcar regiones completas y luego quitar o sumar personas una por una." />
        <Destinatarios d={f.dest} onChange={(dest) => setF({ ...f, dest, errores: { ...f.errores, dest: false } })} />
        {f.errores.dest && <p className="mt-1 text-[11px] font-semibold text-rojo">Selecciona al menos un gestor.</p>}
      </div>

      <FormPie sel={f.dest.sel} editando={!!f.editId}
        textoBoton={f.editId ? 'Guardar cambios' : 'Publicar evento'}
        onCancelar={onCancelar} onGuardar={() => onGuardar(f)} />
    </section>
  );
}
