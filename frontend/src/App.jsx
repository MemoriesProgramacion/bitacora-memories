// Componente raíz del frontend: define las rutas de la aplicación, carga bajo demanda el inventario y la
// administración y protege las pantallas que exigen sesión.
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSession, rutaInicial } from './hooks/useSession';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import CambiarClavePage from './pages/CambiarClavePage';
import { PantallaCarga, SinPermiso } from './inventario/componentes/ui';
import { ROLES } from './admin/etiquetas';

// Módulo de inventario cargado solo cuando alguien lo abre.
const Inventario = lazy(() => import('./inventario/Inventario'));
const Admin = lazy(() => import('./admin/Admin'));

// Devuelve el módulo al que pertenece una ruta.
function moduloDeRuta(ruta) {
  if (ruta.startsWith('/inventario')) return 'inventario';
  if (ruta.startsWith('/admin')) return 'admin';
  return 'bitacora';
}

// Nombre de cada módulo tal como se lee en el aviso de permisos.
const NOMBRE_MODULO = {
  bitacora: 'la Bitácora',
  inventario: 'el Inventario',
  admin: 'la Administración',
};

// Envuelve las pantallas que exigen sesión y permiso para abrir el módulo; si no lo tiene, avisa en vez de
// mostrar una pantalla vacía.
function Privada({ modulo, children }) {
  const { session, cargando } = useSession();
  const ubicacion = useLocation();

  if (cargando) return <PantallaCarga />;
  if (!session) return <Navigate to="/login" state={{ desde: ubicacion.pathname }} replace />;
  if (session.cambiarClave && ubicacion.pathname !== '/cambiar-clave') {
    return <Navigate to="/cambiar-clave" replace />;
  }
  if (modulo && !session.modulos.includes(modulo)) {
    return (
      <SinPermiso
        completa
        rol={ROLES[session.role] || session.role}
        destino={NOMBRE_MODULO[modulo]}
        volverA={rutaInicial(session)}
      />
    );
  }
  return children;
}

// Redirige las direcciones que no existen al inicio del usuario, o al ingreso si no hay sesión.
function RutaDesconocida() {
  const { session, cargando } = useSession();
  if (cargando) return <PantallaCarga />;
  return <Navigate to={session ? rutaInicial(session) : '/login'} replace />;
}

// Arma el enrutador con las pantallas públicas y privadas.
export default function App() {
  const { session, login, logout, error, verificando, cargando } = useSession();
  const ubicacion = useLocation();

  const destinoTrasLogin = () => {
    if (session.cambiarClave) return '/cambiar-clave';
    const desde = ubicacion.state?.desde;
    const interna = desde && desde.startsWith('/') && !desde.startsWith('//');
    return interna && session.modulos.includes(moduloDeRuta(desde)) ? desde : rutaInicial(session);
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={cargando ? <PantallaCarga /> : session
          ? <Navigate to={destinoTrasLogin()} replace />
          : <LoginPage onLogin={login} error={error} verificando={verificando} />}
      />
      <Route path="/cambiar-clave" element={<Privada><CambiarClavePage /></Privada>} />
      <Route
        path="/"
        element={<Privada modulo="bitacora"><HomePage session={session} onLogout={logout} /></Privada>}
      />
      <Route
        path="/inventario/*"
        element={(
          <Privada modulo="inventario">
            <Suspense fallback={<PantallaCarga />}><Inventario /></Suspense>
          </Privada>
        )}
      />
      <Route
        path="/admin/*"
        element={(
          <Privada modulo="admin">
            <Suspense fallback={<PantallaCarga />}><Admin /></Suspense>
          </Privada>
        )}
      />
      <Route path="*" element={<RutaDesconocida />} />
    </Routes>
  );
}
