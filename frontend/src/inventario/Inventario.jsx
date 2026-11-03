// Módulo de inventario. Vive dentro de la misma aplicación y usa el marco, la cabecera y el estilo de la
// Bitácora. Las pestañas cambian según el tipo de cuenta; el servidor valida cada petición y esto es solo la
// navegación.
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import MarcoApp from '../components/MarcoApp';
import { Cargando, SinPermiso } from './componentes/ui';
import { ROLES } from '../admin/etiquetas';
import { useDatos } from './lib/useDatos';

// Pantalla del inventario descargada solo cuando se abre; lo mismo ocurre con las demás pantallas del módulo.
const Panel = lazy(() => import('./paginas/Panel'));
const Alertas = lazy(() => import('./paginas/Alertas'));
const Recepcion = lazy(() => import('./paginas/Recepcion'));
const Kits = lazy(() => import('./paginas/Kits'));
const Etiquetas = lazy(() => import('./paginas/Etiquetas'));
const Articulos = lazy(() => import('./paginas/Articulos'));
const Proveedores = lazy(() => import('./paginas/Proveedores'));
const Ordenes = lazy(() => import('./paginas/Ordenes'));
const OrdenVer = lazy(() => import('./paginas/OrdenVer'));
const Pedidos = lazy(() => import('./paginas/Pedidos'));
const PedidoVer = lazy(() => import('./paginas/PedidoVer'));
const Evidencias = lazy(() => import('./paginas/Evidencias'));
const Bodegas = lazy(() => import('./paginas/Bodegas'));
const Facturas = lazy(() => import('./paginas/Facturas'));
const Traslados = lazy(() => import('./paginas/Traslados'));
const EntregasKits = lazy(() => import('./paginas/EntregasKits'));
const Saldos = lazy(() => import('./paginas/Saldos'));

// Pestañas del inventario; el id es el primer tramo de la ruta y vacío corresponde al panel.
const PESTANAS = [
  { id: '',            label: 'Panel',                to: '/inventario',             soloAdmin: true },
  { id: 'alertas',     label: 'Alertas',              to: '/inventario/alertas' },
  { id: 'recepcion',   label: 'Recepción',            to: '/inventario/recepcion' },
  { id: 'kits',        label: 'Kit UP',               to: '/inventario/kits' },
  { id: 'entregas-kits', label: 'Entregas de kits',   to: '/inventario/entregas-kits' },
  { id: 'saldos',      label: 'Saldos por bodega',    to: '/inventario/saldos' },
  { id: 'bodegas',     label: 'Bodegas',             to: '/inventario/bodegas',     soloAdmin: true },
  { id: 'facturas',    label: 'Facturas',             to: '/inventario/facturas',    soloAdmin: true },
  { id: 'traslados',   label: 'Traslados',            to: '/inventario/traslados',   soloAdmin: true },
  { id: 'articulos',   label: 'Artículos',            to: '/inventario/articulos',   soloAdmin: true },
  { id: 'proveedores', label: 'Proveedores',          to: '/inventario/proveedores', soloAdmin: true },
  { id: 'ordenes',     label: 'Órdenes de entrega',   to: '/inventario/ordenes',     soloAdmin: true },
  { id: 'pedidos',     label: 'Órdenes de pedido',    to: '/inventario/pedidos',     soloAdmin: true },
  { id: 'evidencias',  label: 'Evidencias',           to: '/inventario/evidencias',  soloAdmin: true },
];

// Envuelve una pantalla que solo ve quien tiene acceso completo; quien llega por la dirección ve el aviso de
// permisos dentro del marco.
function SoloAdmin({ esAdmin, children }) {
  const { session } = useSession();
  if (esAdmin) return children;
  return (
    <SinPermiso
      rol={ROLES[session.role] || session.role}
      destino="esta sección del Inventario"
      volverA="/inventario/recepcion"
    />
  );
}

// Marco del inventario: pestañas según el tipo de cuenta y la ruta que se esté viendo.
export default function Inventario() {
  const { session, logout } = useSession();
  const ubicacion = useLocation();

  const esAdmin = ['admin', 'superadmin', 'coordinador_datos', 'coordinador_compras'].includes(session.role);
  const sinProveedores = session.role === 'superadmin';
  const pestanas = PESTANAS.filter((p) => (!p.soloAdmin || esAdmin) && !(sinProveedores && p.id === 'proveedores'));
  const actual = ubicacion.pathname.replace(/^\/inventario\/?/, '').split('/')[0];
  const inicio = pestanas[0].to;
  const soloAdmin = (pantalla) => (
    <SoloAdmin esAdmin={esAdmin} session={session} inicio={inicio}>{pantalla}</SoloAdmin>
  );

  const { datos: avisos, recargar: recargarAvisos } = useDatos('/alertas/resumen', { auto: false });
  useEffect(() => { recargarAvisos(); }, [ubicacion.pathname, recargarAvisos]);

  return (
    <MarcoApp
      clave={ubicacion.pathname}
      session={session}
      modulo="inventario"
      titulo="Inventario"
      subtitulo="Bodega, Kit UP y órdenes de entrega"
      tabs={pestanas}
      seccion={actual}
      onLogout={logout}
      contadores={{ alertas: avisos?.resumen?.total || 0 }}
    >
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route index element={esAdmin ? <Panel /> : <Navigate to={inicio} replace />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="recepcion" element={<Recepcion />} />
          <Route path="kits" element={<Kits />} />
          <Route path="entregas-kits" element={<EntregasKits />} />
          <Route path="etiquetas" element={<Etiquetas />} />
          <Route path="saldos" element={<Saldos />} />
          <Route path="bodegas"element={soloAdmin(<Bodegas />)} />
          <Route path="facturas" element={soloAdmin(<Facturas />)} />
          <Route path="traslados" element={soloAdmin(<Traslados />)} />
          <Route path="articulos" element={soloAdmin(<Articulos />)} />
          <Route path="proveedores" element={sinProveedores ? <Navigate to={inicio} replace /> : soloAdmin(<Proveedores />)} />
          <Route path="ordenes" element={soloAdmin(<Ordenes />)} />
          <Route path="ordenes/:id" element={soloAdmin(<OrdenVer />)} />
          <Route path="pedidos" element={soloAdmin(<Pedidos />)} />
          <Route path="pedidos/:id" element={soloAdmin(<PedidoVer />)} />
          <Route path="evidencias" element={soloAdmin(<Evidencias />)} />
          <Route path="*" element={<Navigate to={inicio} replace />} />
        </Routes>
      </Suspense>
    </MarcoApp>
  );
}
