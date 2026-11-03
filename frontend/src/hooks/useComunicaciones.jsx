// Estado compartido de eventos y novedades. Vive arriba para que los contadores de las pestañas y las dos
// secciones trabajen sobre los mismos datos. En eventos se compara la lista anterior con la nueva y se manda a
// guardar solo lo que cambió.
import {
  createContext, useContext, useState, useMemo, useCallback, useEffect, useRef,
} from 'react';
import { esPasado, cargarGestores } from '../lib/comunicaciones';
import {
  listarEventos, guardarEvento, eliminarEvento, guardarRespuesta,
} from '../lib/eventos';
import { listarNovedades, guardarNovedad, eliminarNovedad, marcarLeida } from '../lib/avisos';
import { puedeVer, esAdmin, cargasDeSesion } from '../lib/permisos';

const Ctx = createContext(null);

// Compara dos listas por id y por referencia, porque las pantallas crean un objeto nuevo solo para el elemento
// que modifican.
function diferencias(antes, despues) {
  const previo = new Map(antes.map((x) => [String(x.id), x]));
  const nuevo = new Map(despues.map((x) => [String(x.id), x]));
  const cambiados = despues.filter((x) => previo.get(String(x.id)) !== x);
  const eliminados = antes.filter((x) => !nuevo.has(String(x.id))).map((x) => x.id);
  return { cambiados, eliminados, previo };
}

// Devuelve un setX que además persiste los cambios en el servidor.
function useListaPersistente(cargar, alCambiar, deps) {
  const [lista, setLista] = useState([]);
  const ref = useRef([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    cargar()
      .then((items) => { if (vivo) { ref.current = items; setLista(items); } })
      .catch((e) => console.error('[bitacora][E-COMUNICACIONES] cargar:', e))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setPersistente = useCallback((valor) => {
    const antes = ref.current;
    const despues = typeof valor === 'function' ? valor(antes) : valor;
    ref.current = despues;
    setLista(despues);
    alCambiar(antes, despues);
  }, [alCambiar]);

  return [lista, setPersistente, cargando];
}

// Proveedor que carga y comparte la lista de eventos, las novedades y los avisos.
export function ComunicacionesProvider({ session, children }) {
  const [toast, setToast] = useState('');

  const esCoord = !session || session.role !== 'gestor';
  const soloLectura = Boolean(session?.soloLectura) || session?.role === 'tallerista';
  const puedePublicarAvisos = esCoord && session?.role !== 'tallerista';

  const miNodo = useMemo(() => session?.nodo ? String(session.nodo).trim().toUpperCase() : '', [session]);

  const avisar = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const falloGuardado = useCallback((e) => {
    console.error('[bitacora][E-COMUNICACIONES] guardar:', e);
    avisar(e?.publicMsg === 'Tu sesión expiró'
      ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
      : 'No se pudo guardar el cambio. Recarga e intenta de nuevo.');
  }, [avisar]);

  const persistirEventos = useCallback((antes, despues) => {
    if (session?.role === 'tallerista') return;
    const { cambiados, eliminados, previo } = diferencias(antes, despues);
    if (esCoord) {
      cambiados.forEach((e) => guardarEvento(e, session).catch(falloGuardado));
      eliminados.forEach((id) => eliminarEvento(id, session).catch(falloGuardado));
      return;
    }
    cambiados.forEach((e) => {
      const r = e.respuestas?.[miNodo];
      if (r && r !== previo.get(String(e.id))?.respuestas?.[miNodo]) {
        guardarRespuesta(e.id, miNodo, r, session).catch(falloGuardado);
      }
    });
  }, [esCoord, miNodo, session, falloGuardado]);

  const [eventos, setEventos, cargandoEventos] = useListaPersistente(
    () => (cargasDeSesion(session).eventos ? listarEventos(session) : Promise.resolve([])),
    persistirEventos, [session?.token],
  );

  const persistirNovedades = useCallback((antes, despues) => {
    if (session?.role === 'tallerista') return;
    const { cambiados, eliminados, previo } = diferencias(antes, despues);
    if (esCoord) {
      cambiados.forEach((n) => guardarNovedad(n, session).catch(falloGuardado));
      eliminados.forEach((id) => eliminarNovedad(id, session).catch(falloGuardado));
      return;
    }
    cambiados.forEach((n) => {
      const antesLeida = !!previo.get(String(n.id))?.lecturas?.[miNodo];
      if (!antesLeida && n.lecturas?.[miNodo]) {
        marcarLeida(n.id, miNodo, session).catch(falloGuardado);
      }
    });
  }, [esCoord, miNodo, session, falloGuardado]);

  const [novedades, setNovedades, cargandoNovedades] = useListaPersistente(
    () => (cargasDeSesion(session).avisos ? listarNovedades(session) : Promise.resolve([])),
    persistirNovedades, [session?.token],
  );

  useEffect(() => {
    const cargas = cargasDeSesion(session);
    if (esCoord && session?.role !== 'tallerista' && (cargas.eventos || cargas.avisos)) cargarGestores(session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, esCoord]);

  const pendientesEventos = useMemo(() => {
    if (esCoord) return 0;
    return eventos.filter((e) =>
      Object.prototype.hasOwnProperty.call(e.respuestas || {}, miNodo) &&
      !esPasado(e.fecha) && !e.respuestas[miNodo].valor).length;
  }, [eventos, esCoord, miNodo]);

  const sinLeerNovedades = useMemo(() => {
    if (esCoord) return 0;
    return novedades.filter((n) =>
      (n.destinatarios || []).includes(miNodo) && !(n.lecturas || {})[miNodo]).length;
  }, [novedades, esCoord, miNodo]);

  const value = {
    session,
    eventos, setEventos, cargandoEventos,
    novedades, setNovedades, cargandoNovedades,
    esCoord, soloLectura, puedePublicarAvisos, miNodo, avisar, toast,
    pendientesEventos, sinLeerNovedades,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Atajo para leer el estado compartido desde cualquier componente.
export function useComunicaciones() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useComunicaciones debe usarse dentro de ComunicacionesProvider');
  return ctx;
}

// Pide la lista de cuentas de campo al montarse para las pantallas que las muestran; no repite el pedido en la
// misma sesión y lo reintenta si falló.
export function usePedirGestores() {
  const session = useContext(Ctx)?.session ?? null;
  const pedir = useCallback(() => { cargarGestores(session); }, [session]);
  useEffect(() => { pedir(); }, [pedir]);
  return pedir;
}

// Mensaje flotante de confirmación.
export function Toast() {
  const { toast } = useComunicaciones();
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-marino px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
      {toast}
    </div>
  );
}
