// Consola de administración: usuarios de los dos programas, tipos de cuenta, claves, sesiones abiertas y
// registro de ingresos. El servidor vuelve a exigir el permiso y el alcance en cada petición.
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import MarcoApp from '../components/MarcoApp';
import { Cargando } from '../inventario/componentes/ui';

const Resumen = lazy(() => import('./Resumen'));
const Usuarios = lazy(() => import('./Usuarios'));
const Accesos = lazy(() => import('./Accesos'));
const Sesiones = lazy(() => import('./Sesiones'));
const Auditoria = lazy(() => import('./Auditoria'));
const Actividad = lazy(() => import('./Actividad'));
const Avisos = lazy(() => import('./Avisos'));
const Uso = lazy(() => import('./Uso'));
const Calidad = lazy(() => import('./Calidad'));
const Alistamiento = lazy(() => import('./Alistamiento'));

// Pestañas de la consola; el id es el primer tramo de la ruta y vacío corresponde al resumen.
const PESTANAS = [
  { id: '',         label: 'Resumen',          to: '/admin' },
  { id: 'usuarios', label: 'Usuarios',         to: '/admin/usuarios' },
  { id: 'alistamiento', label: 'Alistamiento', to: '/admin/alistamiento' },
  { id: 'accesos',  label: 'Inicios de sesión', to: '/admin/accesos' },
  { id: 'sesiones', label: 'Sesiones abiertas', to: '/admin/sesiones' },
  { id: 'claves',   label: 'Cambios de clave',  to: '/admin/claves' },
  { id: 'actividad', label: 'Actividad',        to: '/admin/actividad' },
  { id: 'uso',      label: 'Usuarios activos', to: '/admin/uso' },
  { id: 'calidad',  label: 'Calidad de datos', to: '/admin/calidad' },
  { id: 'avisos',   label: 'Avisos',           to: '/admin/avisos' },
];

// Pestañas reservadas a quien tiene acceso total: el resumen de todo el sistema y los avisos.
const SOLO_GENERAL = ['', 'avisos'];
const SOLO_USUARIOS = ['usuarios'];

// Arma el marco de la consola con sus pestañas según los permisos del usuario.
export default function Admin() {
  const { session, logout } = useSession();
  const ubicacion = useLocation();
  const esGeneral = session?.role === 'superadmin';
  const soloUsuarios = session?.role === 'coordinador_compras';
  const pestanas = esGeneral ? PESTANAS
    : soloUsuarios ? PESTANAS.filter((p) => SOLO_USUARIOS.includes(p.id))
    : PESTANAS.filter((p) => !SOLO_GENERAL.includes(p.id));
  const actual = ubicacion.pathname.replace(/^\/admin\/?/, '').split('/')[0];

  return (
    <MarcoApp
      clave={ubicacion.pathname}
      session={session}
      modulo="admin"
      titulo="Administración"
      subtitulo={esGeneral ? 'Usuarios, roles, claves y accesos de todo el sistema'
        : soloUsuarios ? 'Profesionales de logística y compra: crear, asignar su bodega y clave, y desbloquear'
          : 'Usuarios, roles, claves y accesos de tu territorio'}
      tabs={pestanas}
      seccion={actual}
      onLogout={logout}
    >
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route index element={esGeneral ? <Resumen /> : <Navigate to="/admin/usuarios" replace />} />
          <Route path="usuarios" element={<Usuarios />} />
          {!soloUsuarios && <Route path="alistamiento" element={<Alistamiento />} />}
          {!soloUsuarios && <Route path="accesos" element={<Accesos />} />}
          {!soloUsuarios && <Route path="sesiones" element={<Sesiones />} />}
          {!soloUsuarios && <Route path="claves" element={<Auditoria />} />}
          {!soloUsuarios && <Route path="actividad" element={<Actividad />} />}
          {!soloUsuarios && <Route path="uso" element={<Uso />} />}
          {!soloUsuarios && <Route path="calidad" element={<Calidad />} />}
          {esGeneral && <Route path="avisos" element={<Avisos />} />}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </MarcoApp>
  );
}
