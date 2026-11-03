// Pestaña de avisos de novedades, que persiste mediante el hook de comunicaciones. La coordinación publica
// avisos para las cuentas de campo de su alcance; algunas cuentas solo los crean, sin editar ni borrar, y las
// de campo los leen.
import { useState } from 'react';
import {
  CATEGORIAS_NOVEDAD, useGestores, todosNodos, nombreGestor, metaGestor,
  ordenGestores, destLabel, publicadoRelativo, hoyISO, plural,
} from '../lib/comunicaciones';
import { useComunicaciones, usePedirGestores } from '../hooks/useComunicaciones';
import { nuevoIdNovedad } from '../lib/avisos';
import Destinatarios, { destNuevo } from '../components/Destinatarios';
import {
  inputCls, BloqueTitulo, Campo, FormHead, FormPie,
  ListaPersonas, Confirmar, BtnMini, LinkBtn, Badge,
} from '../components/FormPiezas';
import { Aviso } from '../components/UI';

// Devuelve la fecha del aviso; si no trae fecha se muestra la de creación y, si tampoco hay, se dice.
const cuandoNovedad = (n) => (n.fecha ? publicadoRelativo(n.fecha)
  : n.creado_en ? publicadoRelativo(String(n.creado_en).slice(0, 10)) : 'Sin fecha');

// Muestra la lista de avisos, sus filtros y el formulario para publicar.
export default function Avisos() {
  const { novedades, setNovedades, esCoord, soloLectura, puedePublicarAvisos, miNodo, avisar } = useComunicaciones();
  useGestores();
  usePedirGestores();
  const [filtro, setFiltro] = useState('todas');
  const [form, setForm] = useState(null);
  const [lecturasAbiertas, setLecturasAbiertas] = useState({});
  const [confirmar, setConfirmar] = useState(null);

  const meIncluye = (n) => n.destinatarios.includes(miNodo);
  const visibles = novedades.filter((n) => esCoord || meIncluye(n))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id);

  const lista = visibles.filter((n) => {
    if (filtro === 'todas') return true;
    if (filtro === 'sinleer') return !n.lecturas[miNodo];
    return n.categoria === filtro;
  });

  const chips = [{ id: 'todas', nombre: 'Todas', n: visibles.length }];
  if (!esCoord) {
    chips.push({ id: 'sinleer', nombre: 'Sin leer', n: visibles.filter((n) => !n.lecturas[miNodo]).length });
  }
  CATEGORIAS_NOVEDAD.forEach((c) => {
    chips.push({ id: c.id, nombre: c.nombre, n: visibles.filter((n) => n.categoria === c.id).length });
  });

  function guardar(f) {
    const errores = {};
    if (!f.categoria) errores.categoria = true;
    if (!f.titulo.trim()) errores.titulo = true;
    if (!f.cuerpo.trim()) errores.cuerpo = true;
    if (!f.dest.sel.length) errores.dest = true;
    if (Object.keys(errores).length) { setForm({ ...f, errores }); return; }

    const n = f.dest.sel.length;
    if (f.editId) {
      setNovedades((prev) => prev.map((nov) => {
        if (nov.id !== f.editId) return nov;
        const lect = {};
        f.dest.sel.forEach((x) => { if (nov.lecturas[x]) lect[x] = nov.lecturas[x]; });
        return {
          ...nov, categoria: f.categoria, titulo: f.titulo.trim(),
          cuerpo: f.cuerpo.trim(), editada: true,
          destinatarios: [...f.dest.sel], lecturas: lect,
        };
      }));
      avisar(`Cambios guardados. La verán ${plural(n, 'gestor', 'gestores')}`);
    } else {
      setNovedades((prev) => [...prev, {
        id: nuevoIdNovedad(),
        titulo: f.titulo.trim(), categoria: f.categoria, cuerpo: f.cuerpo.trim(),
        fecha: hoyISO(), destinatarios: [...f.dest.sel], lecturas: {}, editable: true,
      }]);
      avisar(`Novedad publicada para ${plural(n, 'gestor', 'gestores')}`);
    }
    setForm(null);
    setFiltro('todas');
  }

  return (
    <>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-marino">Novedades</h2>
          <p className="text-[13px] text-gris">
            {puedePublicarAvisos
              ? 'Comparte avisos, logros y recordatorios con las personas que elijas.'
              : 'Avisos y recordatorios compartidos por la coordinación.'}
          </p>
        </div>
        {puedePublicarAvisos && !form && (
          <button type="button"
            onClick={() => setForm({
              editId: null, categoria: null, titulo: '', cuerpo: '',
              dest: destNuevo(todosNodos()), errores: {},
            })}
            className="rounded-lg bg-marino px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-marino2">
            + Nueva novedad
          </button>
        )}
      </div>

      <Aviso className="mt-3">
          Aún no se envían notificaciones automáticas a los gestores.
      </Aviso>

      {puedePublicarAvisos && form && (
        <FormNovedad f={form} setF={setForm} onGuardar={guardar} onCancelar={() => setForm(null)} />
      )}

      {visibles.length > 0 && (
        <div role="group" aria-label="Filtrar novedades" className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const act = filtro === c.id;
            const cat = CATEGORIAS_NOVEDAD.find((x) => x.id === c.id);
            const dots = { ok: 'bg-verde-ok', warn: 'bg-acento', bad: 'bg-rojo', info: 'bg-[#3182ce]' };
            return (
              <button key={c.id} type="button" aria-pressed={act} onClick={() => setFiltro(c.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  act ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-gris hover:border-acento'
                }`}>
                {cat && <span className={`h-2 w-2 rounded-full ${dots[cat.tono]}`} />}
                {c.nombre}
                <span className={`rounded-full px-1.5 text-[10px] ${act ? 'bg-white/20' : 'bg-bg'}`}>{c.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {!visibles.length ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-gris">
          {puedePublicarAvisos ? 'Todavía no hay novedades. Publica la primera con + Nueva novedad.'
            : 'Todavía no tienes novedades de la coordinación.'}
        </p>
      ) : !lista.length ? (
        <p className="rounded-card border border-dashed border-borde py-10 text-center text-[13px] text-gris">
          {filtro === 'sinleer' ? 'Estás al día: no tienes novedades sin leer.'
            : 'No hay novedades en esta categoría.'}
        </p>
      ) : lista.map((n) => (
        <TarjetaNovedad key={n.id} n={n} esCoord={esCoord} soloLectura={soloLectura} miNodo={miNodo}
          abierta={!!lecturasAbiertas[n.id]}
          onToggleLecturas={() => setLecturasAbiertas((p) => ({ ...p, [n.id]: !p[n.id] }))}
          confirmar={confirmar === n.id}
          onPedirBorrar={() => setConfirmar(n.id)}
          onCancelarBorrar={() => setConfirmar(null)}
          onBorrar={() => {
            setNovedades((prev) => prev.filter((x) => x.id !== n.id));
            setConfirmar(null);
            avisar('Novedad eliminada');
          }}
          onEditar={() => {
            setForm({
              editId: n.id, categoria: n.categoria, titulo: n.titulo, cuerpo: n.cuerpo,
              dest: destNuevo(n.destinatarios), errores: {},
            });
            setConfirmar(null);
          }}
          onMarcarLeida={() => setNovedades((prev) => prev.map((x) =>
            x.id !== n.id ? x : { ...x, lecturas: { ...x.lecturas, [miNodo]: { fecha_lectura: new Date().toISOString() } } }))}
          onRecordar={(faltan) => {
            setNovedades((prev) => prev.map((x) => x.id !== n.id ? x : { ...x, recordado: hoyISO() }));
            avisar(`Recordatorio enviado a ${plural(faltan, 'gestor', 'gestores')} (simulado)`);
          }}
        />
      ))}
    </>
  );
}

// Muestra un aviso con sus destinatarios, lecturas y acciones.
function TarjetaNovedad({
  n, esCoord, soloLectura, miNodo, abierta, onToggleLecturas, confirmar,
  onPedirBorrar, onCancelarBorrar, onBorrar, onEditar, onMarcarLeida, onRecordar, preview,
}) {
  const cat = CATEGORIAS_NOVEDAD.find((c) => c.id === n.categoria)
    || { nombre: n.categoria, tono: 'neutral' };
  const leida = !esCoord && !preview && !!n.lecturas[miNodo];
  const bordes = { bad: 'border-l-rojo', warn: 'border-l-acento', ok: 'border-l-verde-ok', info: 'border-l-[#3182ce]' };

  return (
    <article id={preview ? undefined : `nv-${n.id}`}
      className={`mb-3 rounded-card border border-l-4 bg-card p-4 ${bordes[cat.tono] || 'border-l-gris'} ${
        !esCoord && !leida && !preview ? 'border-acento' : 'border-borde'
      }`}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge tono={cat.tono}>{cat.nombre}</Badge>
          {esCoord && !preview && (
            <Badge tono="info" title="Destinatarios">{destLabel(n.destinatarios)}</Badge>
          )}
          {!esCoord && !leida && !preview && <Badge tono="accent">Nueva</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="text-[11px] text-gris">
            {cuandoNovedad(n)}{n.editada && ' · editada'}
          </span>
          {esCoord && n.editable && !preview && (
            <>
              <LinkBtn onClick={onEditar}>Editar</LinkBtn>
              <LinkBtn peligro onClick={onPedirBorrar}>Eliminar</LinkBtn>
            </>
          )}
        </div>
      </div>

      <h3 className="mb-1.5 text-base font-bold text-marino">
        {n.titulo || <span className="italic text-gris">Título de la novedad</span>}
      </h3>
      <p className="text-[13px] leading-relaxed text-texto">
        {n.cuerpo || <span className="italic text-gris">Aquí aparecerá el mensaje.</span>}
      </p>

      {preview ? null : esCoord ? (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-3">
            {(() => {
              const total = n.destinatarios.length;
              const leyeron = n.destinatarios.filter((x) => n.lecturas[x]);
              const faltan = total - leyeron.length;
              const pct = total ? Math.round((leyeron.length / total) * 100) : 0;
              return (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-bg">
                      <i className="block h-full rounded-full bg-verde-ok" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-xs text-gris">
                      Leída por <b className="text-texto">{leyeron.length} de {total}</b>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <LinkBtn aria-expanded={abierta} onClick={onToggleLecturas}>
                      {abierta ? '▴ Ocultar' : '▾ Ver quién'}
                    </LinkBtn>
                    {n.recordado && (
                      <span className="text-[11px] italic text-gris">
                        Recordatorio enviado {publicadoRelativo(n.recordado).toLowerCase()}
                      </span>
                    )}
                    {!soloLectura && faltan > 0 && (
                      <BtnMini onClick={() => onRecordar(faltan)}>
                        Recordar a {faltan === 1 ? 'quien no la ha leído' : `los ${faltan} que no la han leído`}
                      </BtnMini>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

          {abierta && (() => {
            const orden = ordenGestores(n.destinatarios);
            const mapa = (x) => ({ nodo: x, nombre: nombreGestor(x), meta: metaGestor(x) });
            return (
              <ListaPersonas grupos={[
                { tono: 'neutral', titulo: 'Aún no la leen', items: orden.filter((x) => !n.lecturas[x]).map(mapa) },
                { tono: 'ok', titulo: 'Ya la leyeron', items: orden.filter((x) => n.lecturas[x]).map(mapa) },
              ]} />
            );
          })()}

          {confirmar && (
            <Confirmar
              texto="¿Eliminar esta novedad? Dejará de verse para las personas que la recibieron."
              onCancelar={onCancelarBorrar} onBorrar={onBorrar} />
          )}
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-3">
          {leida ? (
            <span className="text-[13px] font-semibold text-verde-ok">✓ Leída</span>
          ) : (
            <>
              <span className="text-[11px] italic text-gris">Márcala cuando la hayas revisado.</span>
              <BtnMini onClick={onMarcarLeida}>Marcar como leída</BtnMini>
            </>
          )}
        </div>
      )}
    </article>
  );
}

// Formulario para crear o editar un aviso.
function FormNovedad({ f, setF, onGuardar, onCancelar }) {
  const campo = (k, v) => setF({ ...f, [k]: v, errores: { ...f.errores, [k]: false } });

  return (
    <section id="nv-form" className="mb-5 rounded-card border border-borde bg-card p-5"
      aria-label={f.editId ? 'Editar novedad' : 'Nueva novedad'}>
      <FormHead titulo={f.editId ? 'Editar novedad' : 'Nueva novedad'} onCancelar={onCancelar} />

      <div className="mb-5">
        <BloqueTitulo n={1} titulo="Qué tan importante es"
          ayuda="El color de la categoría le indica al gestor si debe actuar ya o solo enterarse." />
        <Campo label="Categoría" error={f.errores.categoria && 'Elige una categoría.'}>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORIAS_NOVEDAD.map((c) => {
              const sel = f.categoria === c.id;
              const bordes = { bad: 'border-t-rojo', warn: 'border-t-acento', ok: 'border-t-verde-ok', info: 'border-t-[#3182ce]' };
              return (
                <button key={c.id} type="button" role="radio" aria-checked={sel}
                  onClick={() => campo('categoria', c.id)}
                  className={`flex flex-col gap-0.5 rounded-lg border border-t-4 p-2.5 text-left transition ${bordes[c.tono]} ${
                    sel ? 'border-marino bg-card shadow-md' : 'border-borde bg-bg hover:border-acento'
                  }`}>
                  <span className="text-[13px] font-bold text-marino">{c.nombre}</span>
                  <span className="text-[11px] leading-snug text-gris">{c.desc}</span>
                </button>
              );
            })}
          </div>
        </Campo>
      </div>

      <div className="mb-5">
        <BloqueTitulo n={2} titulo="Mensaje" />
        <Campo id="nv-titulo" label="Título" error={f.errores.titulo && 'Escribe un título.'}>
          <input id="nv-titulo" type="text" maxLength="120" value={f.titulo}
            onChange={(e) => campo('titulo', e.target.value)}
            placeholder="Ej. Cambio en el horario de atención" className={inputCls} />
        </Campo>
        <Campo id="nv-cuerpo" label="Mensaje" error={f.errores.cuerpo && 'Escribe el mensaje.'}>
          <textarea id="nv-cuerpo" rows="4" value={f.cuerpo}
            onChange={(e) => campo('cuerpo', e.target.value)}
            placeholder="Escribe la novedad completa: qué pasa, qué se espera del gestor y hasta cuándo."
            className={inputCls} />
        </Campo>
      </div>

      <div className="mb-5">
        <BloqueTitulo n={3} titulo="A quién le llega"
          ayuda="Solo las personas marcadas verán la novedad. Después podrás ver quién ya la leyó y recordarles a los demás." />
        <Destinatarios d={f.dest} onChange={(dest) => setF({ ...f, dest, errores: { ...f.errores, dest: false } })} />
        {f.errores.dest && <p className="mt-1 text-[11px] font-semibold text-rojo">Selecciona al menos un gestor.</p>}
      </div>

      <div className="mb-2">
        <BloqueTitulo n={4} titulo="Así la verán los gestores" />
        <TarjetaNovedad preview esCoord={false} miNodo=""
          n={{ id: 0, titulo: f.titulo, cuerpo: f.cuerpo, categoria: f.categoria || 'info',
               fecha: hoyISO(), destinatarios: [], lecturas: {} }} />
      </div>

      <FormPie sel={f.dest.sel} editando={!!f.editId}
        textoBoton={f.editId ? 'Guardar cambios' : 'Publicar novedad'}
        onCancelar={onCancelar} onGuardar={() => onGuardar(f)} />
    </section>
  );
}
