// Carga de datos desde la API. Pide en paralelo dos listas livianas, las unidades productivas con lo que se
// busca y se lista, y el estado de cada etapa para el avance de la ruta. Lo pesado, como archivos y
// comprobaciones, no viaja en la carga inicial sino al abrir una ficha.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  UNIDADES_URL, UNIDAD_URL, GESTORES_URL,
  DOCUMENTOS_URL, DOCUMENTO_URL, AUDIT_JOIN_KEY, ESTADOS_ENTREGA_URL,
} from '../lib/config';
import {
  fetchApi, adaptarFila, adaptarUP, camposGestor,
  adaptarEtapasFila, adaptarEtapas, AppError,
} from '../lib/api';
import { getCached, setCache } from '../lib/cache';
import { normDoc } from '../lib/utils';
import { cargasDeSesion } from '../lib/permisos';

// Los cuatro estados de la ruta que se leen de la fila de la unidad y no del registro de etapas.
const CLAVES_RUTA = ['PDF_carrito', 'plan_inversion', 'plan_negocio', 'comite_subsanaciones',
  'proceso_subsanacion'];

// Construye el índice de la ruta por unidad.
function buildRutaIndex(rows) {
  const idx = {};
  for (const r of rows) {
    const id = r && r[AUDIT_JOIN_KEY];
    if (id === undefined || id === null || id === '') continue;
    const extra = {};
    for (const k of CLAVES_RUTA) {
      if (r[k] !== undefined) extra[k] = r[k];
    }
    idx[String(id).trim()] = extra;
  }
  return idx;
}

// Construye el índice de auditoría por unidad.
function buildAuditIndex(rows) {
  const idx = {};
  for (const r of rows) {
    const id = r && r[AUDIT_JOIN_KEY];
    if (id !== undefined && id !== null && id !== '') {
      idx[String(id).trim()] = r;
    }
  }
  return idx;
}

// Calcula la clave de la caché por alcance, para que lo que ve una cuenta de campo no pise lo que ve otra en el
// mismo navegador.
function claveCache(session, sufijo) {
  const base = session && session.role === 'gestor'
    ? `nodo_${session.nodo}`
    : session && (session.role === 'coordinador' || session.role === 'tecnico_administrativo') ? `local_${session.usuario}`
    : !session ? 'coord' : session.role;
  return `${sufijo}_${session?.pruebas ? 'pruebas_' : ''}${base}`;
}

// Hook que carga las listas, mantiene la caché y devuelve los datos y su estado.
export function useDatos(session) {
  const [allData, setAllData] = useState([]);
  const [auditIndex, setAuditIndex] = useState({});
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditEstado, setAuditEstado] = useState('cargando');
  const [auditReintento, setAuditReintento] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [reintento, setReintento] = useState(null);
  const [staleInfo, setStaleInfo] = useState(null);
  const iniciado = useRef(null);
  const rutaPorId = useRef({});
  const entregaPorDoc = useRef(null);

  const inyectarRuta = useCallback((filas) => {
    const mapa = rutaPorId.current;
    const ent = entregaPorDoc.current;
    if (!Object.keys(mapa).length && !ent) return filas;
    return filas.map((f) => {
      const extra = mapa[String(f.ID_unico)];
      if (!extra && !ent) return f;
      const sig = extra ? { ...f, ...extra } : { ...f };
      if (ent) {
        const doc = [f.integrante_doc_inicial, f.unidad_doc].map(normDoc).find((d) => d && ent[d]);
        sig.estado_entrega = doc ? ent[doc] : 'pendiente';
      }
      return sig;
    });
  }, []);

  const cargarEstadosEntrega = useCallback(async () => {
    if (!session?.token) return;
    try {
      const resp = await fetchApi(ESTADOS_ENTREGA_URL, { token: session.token });
      entregaPorDoc.current = resp.items || {};
      setAllData((prev) => (prev.length ? inyectarRuta(prev) : prev));
    } catch (err) {
      console.warn('[bitacora] No se pudo cargar el estado del validador de entrega:', err);
    }
  }, [session, inyectarRuta]);

  const cargarDocumentos = useCallback(async () => {
    if (!session?.token) return;
    if (!cargasDeSesion(session).rutaBitacora) {
      setAuditLoaded(true);
      setAuditEstado('ok');
      return;
    }

    try {
      const cached = await getCached(claveCache(session, 'etapas'));
      if (cached?.data?.length) {
        setAuditIndex(buildAuditIndex(cached.data));
        rutaPorId.current = buildRutaIndex(cached.data);
        setAllData((prev) => (prev.length ? inyectarRuta(prev) : prev));
        setAuditLoaded(true);
        setAuditEstado('ok');
      }
    } catch { }

    setAuditReintento(null);
    try {
      const resp = await fetchApi(DOCUMENTOS_URL, { token: session.token });
      const filas = (resp.items || []).map(adaptarEtapasFila);

      rutaPorId.current = buildRutaIndex(filas);
      setAllData((prev) => (prev.length ? inyectarRuta(prev) : prev));

      setAuditIndex(buildAuditIndex(filas));
      setAuditLoaded(true);
      setAuditEstado('ok');
      setCache(filas, claveCache(session, 'etapas'));
    } catch (err) {
      console.error('[bitacora][E-ETAPAS] No se pudieron cargar las etapas:', err);
      setAuditEstado((prev) => (prev === 'ok' ? 'ok' : 'error'));
    } finally {
      setAuditReintento(null);
    }
  }, [session, inyectarRuta]);

  const cargarUnidades = useCallback(async (enSegundoPlano) => {
    if (!session?.token) return false;
    try {
      const resp = await fetchApi(UNIDADES_URL, { token: session.token });
      const filas = (resp.items || []).map(adaptarFila);

      const porNodo = {};
      if (session.role === 'gestor') {
        porNodo[session.nodo] = camposGestor({
          nombre: session.nombre,
          cedula: session.cedula_mask,
          correo: session.correo,
          telefono: session.telefono,
          triada: session.triada,
        });
      } else {
        try {
          const g = await fetchApi(GESTORES_URL, { token: session.token });
          for (const item of g.items || []) porNodo[item.nodo] = camposGestor(item);
        } catch (err) {
          console.warn('[bitacora] No se pudieron cargar los gestores:', err);
        }
      }
      const data = inyectarRuta(
        filas.map((f) => ({ ...f, ...(porNodo[f.nodo] || {}) }))
      );

      setReintento(null);
      setAllData(data);
      setError(null);
      setStaleInfo(null);
      setCargando(false);
      setCache(data, claveCache(session, 'unidades'));
      return true;
    } catch (err) {
      setReintento(null);
      const info = err instanceof AppError
        ? err : new AppError('E-RED', 'Error de conexión', String(err));
      console.error(`[bitacora][${info.code}] ${info.detail}`, err);
      if (!enSegundoPlano) {
        setError(info);
        setCargando(false);
      } else {
        setStaleInfo((s) => (s ? { ...s, fallo: true } : s));
      }
      return false;
    }
  }, [session, inyectarRuta]);

  const cargarUnidad = useCallback(async (fila) => {
    if (!session?.token || !fila) return fila;
    const id = fila._id ?? String(fila.ID_unico);
    const params = { id, nodo: fila.nodo };

    const [up, doc] = await Promise.all([
      fetchApi(UNIDAD_URL, { token: session.token, params })
        .then((r) => adaptarUP(r.item))
        .catch((err) => {
          console.error('[bitacora][E-UP] No se pudo cargar la ficha:', err);
          return null;
        }),
      fetchApi(DOCUMENTO_URL, { token: session.token, params })
        .then((r) => adaptarEtapas(r.item))
        .catch((err) => {
          console.warn('[bitacora] Sin documentación completa para la U.P.:', err);
          return null;
        }),
    ]);

    if (doc) {
      setAuditIndex((prev) => ({ ...prev, [String(fila.ID_unico)]: doc }));
    }
    return up ? { ...fila, ...up } : fila;
  }, [session]);

  useEffect(() => {
    if (!session?.token) { setAllData([]); return; }
    const marca = `${session.role}:${session.usuario || ''}:${session.nodo || '*'}:${session.pruebas ? 'pruebas' : 'real'}`;
    if (iniciado.current === marca) return;
    iniciado.current = marca;
    entregaPorDoc.current = null;

    setCargando(true);
    (async () => {
      const cached = await getCached(claveCache(session, 'unidades'));
      if (cached?.data?.length) {
        setAllData(cached.data);
        setCargando(false);
        if (cached.stale) setStaleInfo({ time: cached.time });
      }
      cargarUnidades(!!cached?.data?.length);
      cargarDocumentos();
      cargarEstadosEntrega();
    })();
  }, [session, cargarUnidades, cargarDocumentos, cargarEstadosEntrega]);

  const reintentar = useCallback(async () => {
    setError(null);
    setCargando(true);
    cargarUnidades(false);
    if (!auditLoaded) {
      setAuditEstado('cargando');
      cargarDocumentos();
    }
  }, [cargarUnidades, cargarDocumentos, auditLoaded]);

  const recargar = useCallback(() => {
    cargarUnidades(true);
    cargarDocumentos();
  }, [cargarUnidades, cargarDocumentos]);

  const reintentarAuditoria = useCallback(() => {
    setAuditEstado('cargando');
    cargarDocumentos();
  }, [cargarDocumentos]);

  return {
    allData, auditIndex, auditLoaded, auditEstado, auditReintento,
    cargando, error, reintento, staleInfo,
    reintentar, reintentarAuditoria, cargarUnidad, recargar,
  };
}
