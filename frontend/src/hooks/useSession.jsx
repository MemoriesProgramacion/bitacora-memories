// Sesión única de la Bitácora, el inventario y la administración. El servidor guarda la sesión en una cookie
// que JavaScript no puede leer; aquí solo se refleja quién está conectado, qué módulos abre y el token CSRF que
// va en cada escritura.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { API_BASE } from '../lib/config';
import { fijarCsrf, tokenCsrf, renovarCsrf } from '../lib/csrf';
import { normVal, pick } from '../lib/utils';

const Ctx = createContext(null);

const ETIQUETAS = {
  superadmin: 'Coordinador general',
  coordinador: 'Coordinador local regional',
  tecnico_administrativo: 'Técnico administrativo regional de apoyo',
  tallerista: 'Tallerista',
  coordinador_compras: 'Profesional alianzas y conexión de mercados',
  coordinador_datos: 'Profesional de seguimiento e información',
  bodeguero: 'Profesional de logística y compra',
};

// Convierte los datos del servidor en la sesión del frontend.
function armarSesion(s, token) {
  if (!s) return null;
  const nombre = s.nombre || '';
  return {
    role: s.rol,
    usuario: s.usuario,
    origen: s.origen,
    modulos: s.modulos || [],
    nodo: s.nodo || null,
    nombre,
    cedula: s.cedula || '',
    triada: s.triada || '',
    region: s.region ?? '',
    departamento: s.departamento || '',
    modalidad: s.modalidad || '',
    correo: s.correo || '',
    telefono: s.telefono || '',
    cambiarClave: Boolean(s.cambiar_clave),
    rolReal: s.rol_real || null,
    soloLectura: s.rol === 'tecnico_administrativo',
    label: s.rol_real ? `${s.rol === 'gestor' ? `Gestor · ${s.nodo}` : (ETIQUETAS[s.rol] || s.rol)} (vista de solo lectura)`
      : s.rol === 'gestor' ? `Gestor · ${s.nodo}`
      : s.rol === 'coordinador_datos' ? (nombre || ETIQUETAS.coordinador_datos)
      : (ETIQUETAS[s.rol] || nombre || s.usuario),
    token,
  };
}

// Llama a la API de sesión mandando la cookie y, en las escrituras, el token CSRF, que se pide si todavía no
// hay.
async function pedir(ruta, opciones = {}, reintento = false) {
  const escritura = opciones.method && opciones.method !== 'GET';
  if (escritura && !tokenCsrf()) await renovarCsrf();
  const res = await fetch(`${API_BASE}${ruta}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...opciones,
    headers: {
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...(escritura && tokenCsrf() ? { 'X-CSRF-Token': tokenCsrf() } : {}),
    },
  });
  const datos = await res.json().catch(() => null);
  if (datos?.token) fijarCsrf(datos.token);
  if (escritura && !reintento && res.status === 400 && datos?.csrf) {
    await renovarCsrf();
    return pedir(ruta, opciones, true);
  }
  return { res, datos };
}

// Guarda quién está conectado y ofrece entrar, salir y refrescar a toda la aplicación.
export function ProveedorSesion({ children }) {
  const [session, setSession] = useState(null);
  const [empresa, setEmpresa] = useState('Fundación Memories');
  const [cargando, setCargando] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState('');

  const refrescar = useCallback(async () => {
    try {
      const { datos } = await pedir('/auth/sesion');
      setSession(armarSesion(datos?.sesion, tokenCsrf()));
      if (datos?.empresa) setEmpresa(datos.empresa);
    } catch {
      setSession(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { refrescar(); }, [refrescar]);

  useEffect(() => {
    const alCaducar = () => { setSession(null); refrescar(); };
    window.addEventListener('sesion-expirada', alCaducar);
    return () => window.removeEventListener('sesion-expirada', alCaducar);
  }, [refrescar]);

  const login = useCallback(async (usuario, clave, captcha) => {
    setError('');
    const u = String(usuario || '').trim();
    const c = String(clave || '');
    if (!u || !c) { setError('Ingresa usuario y contraseña.'); return null; }

    setVerificando(true);
    try {
      const { res, datos } = await pedir('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usuario: u, clave: c, captcha: captcha || '' }),
      });
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        setError(datos?.error || 'Usuario o contraseña incorrectos.');
        return null;
      }
      if (!res.ok || !datos?.ok) {
        console.error('[bitacora][E-LOGIN] Respuesta inesperada:', res.status, datos);
        setError(datos?.error || 'No se pudo conectar con el servidor. Intenta de nuevo.');
        return null;
      }
      const nueva = armarSesion(datos.sesion, datos.token);
      setSession(nueva);
      return nueva;
    } catch (err) {
      console.error('[bitacora][E-LOGIN] No se pudo validar la sesión:', err);
      setError('No se pudo conectar con el servidor. Intenta de nuevo.');
      return null;
    } finally {
      setVerificando(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await pedir('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      setError('');
    }
  }, []);

  const valor = useMemo(() => ({
    session, empresa, cargando, verificando, error, setError, login, logout, refrescar, setSession,
  }), [session, empresa, cargando, verificando, error, login, logout, refrescar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

// Atajo para leer la sesión desde cualquier componente.
export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession necesita <ProveedorSesion>');
  return ctx;
}

// Devuelve adónde va cada usuario después de entrar: lo primero que puede abrir.
export function rutaInicial(session) {
  const m = session?.modulos || [];
  if (m.includes('bitacora')) return '/';
  if (m.includes('inventario')) return '/inventario';
  if (m.includes('admin')) return '/admin';
  return '/login';
}

// Filtra los datos al nodo de la cuenta; la API ya entrega solo el suyo, pero el filtro se conserva por
// seguridad.
export function visibleData(allData, session) {
  if (session && session.role === 'gestor' && session.nodo) {
    const n = normVal(session.nodo);
    return allData.filter((up) => normVal(pick(up, ['nodo'])) === n);
  }
  return allData;
}
