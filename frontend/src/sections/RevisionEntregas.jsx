// Sección de revisión de entregas, exclusiva de un tipo de cuenta. Lista lo que las unidades han cargado en el
// validador de documentos de entrega y permite marcar cada soporte: aprobado, que queda listo y ya no se puede
// reemplazar, o por corregir, con observación obligatoria, que es lo único que el validador vuelve a pedir.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { EncabezadoSeccion, Card, Btn, Aviso, Chip, Spinner } from '../components/UI';
import { fetchApi } from '../lib/api';
import {
  REVISION_ENTREGAS_URL, REVISION_ENTREGA_URL, REVISION_ARCHIVO_URL, FETCH_TIMEOUT,
} from '../lib/config';

const FILTROS = [
  { id: 'en_revision',  label: 'En revisión' },
  { id: 'correcciones', label: 'Por corregir' },
  { id: 'completo',     label: 'Aprobadas' },
  { id: 'todas',        label: 'Todas' },
];

const ESTADO_ENTREGA = {
  en_revision:  { tono: 'warn', label: 'En revisión' },
  correcciones: { tono: 'bad',  label: 'Por corregir' },
  completo:     { tono: 'ok',   label: 'Aprobada' },
  pendiente:    { tono: 'neutral', label: 'Sin documentos' },
};

const ESTADO_DOC = {
  en_revision:  { tono: 'warn', label: 'En revisión' },
  por_corregir: { tono: 'bad',  label: 'Por corregir' },
  aprobado:     { tono: 'ok',   label: 'Aprobado' },
};

const POR_PAGINA = 30;

// Archivos de la cédula, que son solo de referencia y no se califican.
const REVISION_CLAVES_CEDULA = ['cedula_pdf', 'cedula_frontal', 'cedula_trasera'];

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function fecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

// Convierte un error en un mensaje para mostrar.
function mensajeError(err) {
  if (err?.code === 'E-SESION') return 'Tu sesión expiró. Sal y vuelve a iniciar sesión.';
  if (err?.code === 'E409') {
    return 'Esta entrega cambió mientras la revisabas (por ejemplo, el gestor volvió a subir un soporte). ' +
      'Recarga la lista y revísala de nuevo.';
  }
  if (err?.code === 'E403') return 'Tu usuario no tiene permiso para revisar entregas.';
  return (err?.detail || err?.message || 'No se pudo completar la operación.');
}

// Muestra la lista de entregas con sus filtros y el detalle de la elegida.
export default function RevisionEntregas({ session }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('en_revision');
  const [busqueda, setBusqueda] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [limite, setLimite] = useState(POR_PAGINA);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await fetchApi(REVISION_ENTREGAS_URL, { token: session.token });
      setItems(r.items || []);
    } catch (err) {
      console.error('[revision] No se pudo cargar la lista:', err);
      setError(mensajeError(err));
    } finally {
      setCargando(false);
    }
  }, [session]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setLimite(POR_PAGINA); }, [filtro, busqueda]);

  const conteo = useMemo(() => {
    const c = { en_revision: 0, correcciones: 0, completo: 0, todas: items.length };
    for (const it of items) if (c[it.estado] !== undefined) c[it.estado] += 1;
    return c;
  }, [items]);

  const visibles = useMemo(() => {
    const q = norm(busqueda.trim());
    const lista = items.filter((it) => {
      if (filtro !== 'todas' && it.estado !== filtro) return false;
      if (!q) return true;
      const up = it.up || {};
      return [it.cedula, it.cedula_p2, it.nombre, up.nombre, up.nodo, up.gestor, up.municipio, up.id_unico]
        .some((v) => norm(v).includes(q));
    });
    const asc = filtro === 'en_revision';
    return lista.sort((a, b) => (asc ? 1 : -1) * String(a.ultima_carga).localeCompare(String(b.ultima_carga)));
  }, [items, filtro, busqueda]);

  const actualizar = (item) => setItems((prev) => prev.map((x) => (x.cedula === item.cedula ? item : x)));

  return (
    <>
      <EncabezadoSeccion
        titulo="Revisión de entregas"
        subtitulo={`${session?.nombre || 'Revisión de entregas'} · Soportes cargados en el Validador de documentos de entrega`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => {
          const activo = filtro === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                activo ? 'border-marino bg-marino text-white' : 'border-borde bg-card text-texto hover:border-acento'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 ${activo ? 'text-acento' : 'text-gris'}`}>{conteo[f.id].toLocaleString('es-CO')}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por cédula, nombre, U.P., nodo o gestor"
          className="min-w-0 flex-1 rounded-lg border border-borde bg-card px-3.5 py-2.5 text-sm outline-none focus:border-acento"
        />
        <Btn variant="secondary" onClick={cargar} disabled={cargando}>Recargar</Btn>
      </div>

      {error && <Aviso tono="bad">{error}</Aviso>}

      {cargando && !items.length ? (
        <Spinner texto="Cargando entregas…" sub="Cruzando las cédulas con sus unidades productivas" />
      ) : !visibles.length ? (
        <Card className="p-8 text-center text-sm text-gris">
          {busqueda ? 'Ninguna entrega coincide con la búsqueda.' : 'No hay entregas en este estado.'}
        </Card>
      ) : (
        <div className="space-y-2.5">
          {visibles.slice(0, limite).map((it) => (
            <FilaEntrega
              key={it.cedula}
              item={it}
              abierta={abierta === it.cedula}
              onAbrir={() => setAbierta((a) => (a === it.cedula ? null : it.cedula))}
              session={session}
              onGuardado={actualizar}
            />
          ))}
          {visibles.length > limite && (
            <div className="pt-2 text-center">
              <Btn variant="secondary" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                Ver más ({(visibles.length - limite).toLocaleString('es-CO')} restantes)
              </Btn>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Muestra una entrega, que corresponde a un beneficiario, en la lista.
function FilaEntrega({ item, abierta, onAbrir, session, onGuardado }) {
  const est = ESTADO_ENTREGA[item.estado] || ESTADO_ENTREGA.pendiente;
  const up = item.up || {};
  const cargados = item.documentos.filter((d) => d.cargado);
  const n = (e) => cargados.filter((d) => d.estado === e).length;

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onAbrir} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-marino">{item.nombre || 'Sin nombre'}</div>
          <div className="mt-0.5 text-xs text-gris">
            C.C. {item.cedula}
            {up.nombre ? ` · ${up.nombre}` : ' · U.P. no encontrada'}
          </div>
          {(up.nodo || up.municipio) && (
            <div className="mt-0.5 text-xs text-gris">
              {[up.nodo && `Nodo ${up.nodo}`, up.gestor, up.municipio].filter(Boolean).join(' · ')}
            </div>
          )}
          <div className="mt-1.5 text-[11px] text-gris">
            {cargados.length} soporte(s) · {n('aprobado')} aprobado(s) · {n('por_corregir')} por corregir
            {item.ultima_carga && ` · última carga ${fecha(item.ultima_carga)}`}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Chip tono={est.tono}>{est.label}</Chip>
          <span className={`text-gris transition-transform ${abierta ? 'rotate-180' : ''}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </button>
      {abierta && <DetalleEntrega item={item} session={session} onGuardado={onGuardado} />}
    </Card>
  );
}

// Muestra los soportes de una entrega con su veredicto.
function DetalleEntrega({ item, session, onGuardado }) {
  const [decisiones, setDecisiones] = useState({});
  const [viendo, setViendo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState(null);

  useEffect(() => { setDecisiones({}); }, [item]);

  const cargados = item.documentos.filter((d) => d.cargado);
  const cambios = Object.keys(decisiones).length;
  const faltaObs = Object.entries(decisiones)
    .filter(([, d]) => d.estado === 'por_corregir' && !String(d.observacion || '').trim())
    .map(([k]) => item.documentos.find((x) => x.clave === k)?.label);

  function decidir(doc, estado) {
    setAviso(null);
    setDecisiones((prev) => {
      const sig = { ...prev };
      if (doc.estado === estado && !(estado === 'por_corregir')) {
        delete sig[doc.clave];
      } else {
        sig[doc.clave] = {
          estado,
          observacion: prev[doc.clave]?.observacion ?? (estado === 'por_corregir' ? doc.observacion : ''),
        };
      }
      return sig;
    });
  }

  function aprobarPendientes() {
    setAviso(null);
    setDecisiones((prev) => {
      const sig = { ...prev };
      for (const d of cargados) {
        if (d.estado === 'en_revision' && !sig[d.clave]) sig[d.clave] = { estado: 'aprobado', observacion: '' };
      }
      return sig;
    });
  }

  async function guardar() {
    if (!cambios || faltaObs.length || guardando) return;
    setGuardando(true);
    setError('');
    setAviso(null);
    const documentos = {};
    for (const [clave, d] of Object.entries(decisiones)) {
      const doc = item.documentos.find((x) => x.clave === clave);
      documentos[clave] = {
        estado: d.estado,
        observacion: String(d.observacion || '').trim(),
        fecha_carga: doc?.fecha_carga ?? '',
      };
    }
    try {
      const r = await fetchApi(REVISION_ENTREGA_URL, {
        token: session.token, metodo: 'POST', cuerpo: { cedula: item.cedula, documentos },
      });
      setAviso({ tono: 'ok', txt: 'Revisión guardada. El validador ya muestra este resultado.' });
      onGuardado({ ...r.item, up: r.item.up || item.up });
    } catch (err) {
      console.error('[revision] No se pudo guardar:', err);
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="border-t border-borde p-4">
      {item.cedula_archivos?.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-gris">Cédula (referencia):</span>
          {item.cedula_archivos.map((k) => (
            <Btn
              key={k}
              variant="secondary"
              className="!px-3 !py-1.5 !text-xs"
              onClick={() => setViendo(viendo === k ? null : k)}
            >
              {viendo === k ? 'Ocultar' : k === 'cedula_pdf' ? 'Ver cédula' : k === 'cedula_frontal' ? 'Ver frente' : 'Ver reverso'}
            </Btn>
          ))}
        </div>
      )}
      {REVISION_CLAVES_CEDULA.includes(viendo) && (
        <VisorArchivo session={session} cedula={item.cedula} clave={viendo} />
      )}

      <div className="space-y-2.5">
        {item.documentos.map((doc) => (
          <FilaSoporte
            key={doc.clave}
            doc={doc}
            decision={decisiones[doc.clave]}
            onDecidir={(e) => decidir(doc, e)}
            onObservacion={(txt) => setDecisiones((p) => ({ ...p, [doc.clave]: { ...p[doc.clave], observacion: txt } }))}
            viendo={viendo === doc.clave}
            onVer={() => setViendo(viendo === doc.clave ? null : doc.clave)}
            session={session}
            cedula={item.cedula}
          />
        ))}
      </div>

      {error && <Aviso tono="bad" className="mt-3">{error}</Aviso>}
      {aviso && <Aviso tono={aviso.tono} className="mt-3">{aviso.txt}</Aviso>}
      {faltaObs.length > 0 && (
        <p className="mt-3 text-xs text-rojo">Escribe qué hay que corregir en: {faltaObs.join(', ')}.</p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {cargados.some((d) => d.estado === 'en_revision') && (
          <Btn variant="secondary" onClick={aprobarPendientes} disabled={guardando}>Aprobar los pendientes</Btn>
        )}
        {cambios > 0 && (
          <Btn variant="ghost" onClick={() => setDecisiones({})} disabled={guardando}>Descartar</Btn>
        )}
        <Btn onClick={guardar} disabled={!cambios || faltaObs.length > 0 || guardando}>
          {guardando ? 'Guardando…' : `Guardar revisión${cambios ? ` (${cambios})` : ''}`}
        </Btn>
      </div>
    </div>
  );
}

// Muestra un soporte con sus acciones de aprobar o marcar por corregir.
function FilaSoporte({ doc, decision, onDecidir, onObservacion, viendo, onVer, session, cedula }) {
  if (!doc.cargado) {
    return (
      <div className="rounded-lg bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-texto">{doc.label}</span>
          <Chip>{doc.opcional ? 'No adjuntado (opcional)' : 'No cargado'}</Chip>
        </div>
      </div>
    );
  }

  const efectivo = decision?.estado || doc.estado;
  const est = ESTADO_DOC[efectivo] || ESTADO_DOC.en_revision;

  return (
    <div className={`rounded-lg border p-3 ${decision ? 'border-acento' : 'border-borde'} bg-bg`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-texto">{doc.label}</div>
          <div className="mt-0.5 text-[11px] text-gris">
            {doc.fecha_carga && `Cargado ${fecha(doc.fecha_carga)}`}
            {doc.fecha_revision && ` · Revisado ${fecha(doc.fecha_revision)}${doc.revisado_por ? ` por ${doc.revisado_por}` : ''}`}
          </div>
        </div>
        <Chip tono={est.tono}>{decision ? `${est.label} (sin guardar)` : est.label}</Chip>
      </div>

      {!decision && doc.estado === 'por_corregir' && doc.observacion && (
        <p className="mt-2 text-xs text-texto"><b>Observación:</b> {doc.observacion}</p>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Btn variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={onVer}>
          {viendo ? 'Ocultar' : doc.tipo === 'video' ? 'Ver video' : 'Ver documento'}
        </Btn>
        <Btn
          variant="secondary"
          className={`!px-3 !py-1.5 !text-xs ${efectivo === 'aprobado' ? '!border-ok !text-ok-txt' : ''}`}
          onClick={() => onDecidir('aprobado')}
        >
          ✓ Aprobar
        </Btn>
        <Btn
          variant="secondary"
          className={`!px-3 !py-1.5 !text-xs ${efectivo === 'por_corregir' ? '!border-rojo !text-rojo-txt' : ''}`}
          onClick={() => onDecidir('por_corregir')}
        >
          ✗ Por corregir
        </Btn>
      </div>

      {decision?.estado === 'por_corregir' && (
        <textarea
          value={decision.observacion || ''}
          onChange={(e) => onObservacion(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="¿Qué debe corregir el gestor? (obligatorio, lo verá en el validador)"
          className="mt-2.5 w-full rounded-lg border border-borde bg-card px-3 py-2 text-sm outline-none focus:border-acento"
        />
      )}

      {viendo && <VisorArchivo session={session} cedula={cedula} clave={doc.clave} />}
    </div>
  );
}

// Visor del archivo, que llega del servidor con la sesión de quien revisa porque la cédula vive en un
// contenedor privado.
function VisorArchivo({ session, cedula, clave }) {
  const [estado, setEstado] = useState({ cargando: true });

  useEffect(() => {
    let vivo = true;
    let url = '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT * 3);
    setEstado({ cargando: true });
    (async () => {
      try {
        const u = new URL(REVISION_ARCHIVO_URL, window.location.origin);
        u.searchParams.set('cedula', cedula);
        u.searchParams.set('clave', clave);
        const res = await fetch(u.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
        if (res.status === 401) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
        if (!res.ok) throw new Error(res.status === 404 ? 'El archivo no se encontró en el almacenamiento.' : `Error ${res.status}`);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (vivo) setEstado({ url, tipo: blob.type || '' });
      } catch (err) {
        if (vivo) setEstado({ error: err.name === 'AbortError' ? 'El archivo tardó demasiado en cargar.' : err.message });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      vivo = false;
      ctrl.abort();
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, cedula, clave]);

  if (estado.cargando) return <p className="mt-3 text-xs italic text-gris">Cargando archivo…</p>;
  if (estado.error) return <p className="mt-3 text-xs text-rojo">{estado.error}</p>;

  return (
    <div className="mt-3">
      <div className="mb-2 flex justify-end">
        <a
          href={estado.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-borde bg-card px-3 py-1.5 text-xs font-semibold text-texto hover:border-acento"
        >
          Abrir aparte
        </a>
      </div>
      {estado.tipo.startsWith('video/') ? (
        <video src={estado.url} controls className="max-h-[480px] w-full rounded-lg bg-black" />
      ) : estado.tipo.startsWith('image/') ? (
        <img src={estado.url} alt="Archivo cargado" className="max-h-[560px] w-full rounded-lg border border-borde bg-white object-contain" />
      ) : (
        <iframe src={estado.url} title="Soporte cargado" className="h-[560px] w-full rounded-lg border border-borde bg-white" />
      )}
    </div>
  );
}
