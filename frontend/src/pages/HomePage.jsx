// Página principal con sesión iniciada: carga los datos, arma las secciones de la Bitácora según los permisos
// de la cuenta y muestra la sección activa dentro del marco de la aplicación.
import { lazy, Suspense, useState, useMemo, useEffect } from 'react';
import { useDatos } from '../hooks/useDatos';
import { visibleData } from '../hooks/useSession';
import { ComunicacionesProvider, useComunicaciones, Toast } from '../hooks/useComunicaciones';
import MarcoApp from '../components/MarcoApp';
import AvisoGlobal from '../components/AvisoGlobal';
import VerComo from '../components/VerComo';
import Bitacora from '../sections/Bitacora';
import Visitas from '../sections/Visitas';
import Eventos from '../sections/Eventos';
import Novedades from '../sections/Novedades';
import Entregas from '../sections/Entregas';
import CargueDatos from '../sections/CargueDatos';
import CargueCompras from '../sections/CargueCompras';
import RevisionEntregas from '../sections/RevisionEntregas';
import DatosCargados from '../sections/DatosCargados';
import MiBodega from '../sections/MiBodega';
import Proveedores from '../sections/Proveedores';
import Kardex from '../sections/Kardex';
import SaldosBodegas from '../sections/SaldosBodegas';
import { fetchApi } from '../lib/api';
import { API_BASE } from '../lib/config';
import { puedeVer, seccionInicial } from '../lib/permisos';
import { Cargando } from '../inventario/componentes/ui';

// Pantalla descargada solo al abrirla, porque es grande; lo mismo ocurre con el carrito y las demás.
const Agenda = lazy(() => import('../sections/Agenda'));
const Capitalizacion = lazy(() => import('../sections/Capitalizacion'));
const Talleres = lazy(() => import('../sections/Talleres'));
const Alistamiento = lazy(() => import('../admin/Alistamiento'));
const Seguimiento = lazy(() => import('../sections/Seguimiento'));

// Secciones de la Bitácora con el nombre que se muestra en cada pestaña.
const SECCIONES = {
  bitacora: { label: 'Bitácora' },
  agenda: { label: 'Agenda' },
  visitas: { label: 'Visitas' },
  eventos: { label: 'Eventos' },
  talleres: { label: 'Talleres de fortalecimiento' },
  capitalizacion: { label: 'Capitalización' },
  novedades: { label: 'Novedades' },
  entregas: { label: 'Entregas' },
  carguedatos: { label: 'Cargue de datos' },
  carguecompras: { label: 'Cargue de compras' },
  revisionentregas: { label: 'Revisión entregas' },
  datoscargados: { label: 'Datos cargados' },
  mibodega: { label: 'Mi bodega' },
  proveedores: { label: 'Proveedores' },
  kardex: { label: 'Kardex' },
  saldos: { label: 'Saldos por bodega' },
  alistamiento: { label: 'Alistamiento' },
  seguimiento: { label: 'Seguimiento' },
};

// Pantalla de la Bitácora: carga los datos y los reparte a la sección activa.
export default function HomePage({ session, onLogout }) {
  const {
    allData, auditIndex, auditLoaded, auditEstado, auditReintento,
    cargando, error, reintento, reintentar, reintentarAuditoria, cargarUnidad, recargar,
  } = useDatos(session?.role === 'tallerista' ? null : session);

  return (
    <ComunicacionesProvider session={session}>
      <Shell
        session={session} onLogout={onLogout} allData={allData}
        auditIndex={auditIndex} auditLoaded={auditLoaded}
        auditEstado={auditEstado} auditReintento={auditReintento}
        cargando={cargando} error={error} reintento={reintento}
        reintentar={reintentar} reintentarAuditoria={reintentarAuditoria}
        cargarUnidad={cargarUnidad} recargar={recargar}
      />
      <Toast />
    </ComunicacionesProvider>
  );
}

// Marco de la Bitácora: pestañas según el tipo de cuenta y la sección que se está viendo.
function Shell({
  session, onLogout, allData, auditIndex, auditLoaded, auditEstado, auditReintento,
  cargando, error, reintento, reintentar, reintentarAuditoria, cargarUnidad, recargar,
}) {
  const inicio = seccionInicial(session);
  const [seccion, setSeccionRaw] = useState(inicio);
  const { pendientesEventos, sinLeerNovedades } = useComunicaciones();

  const setSeccion = (id) => setSeccionRaw(puedeVer(id, session) ? id : inicio);
  const seccionActiva = puedeVer(seccion, session) ? seccion : inicio;

  useEffect(() => { setSeccionRaw(seccionInicial(session)); }, [session]);

  const datos = useMemo(() => visibleData(allData, session), [allData, session]);
  const nodosUnicos = useMemo(() => [...new Set(allData.map((u) => String(u.nodo || '').trim().toUpperCase()).filter(Boolean))].sort(), [allData]);

  const tabs = Object.entries(SECCIONES)
    .map(([id, s]) => ({ id, label: s.label }))
    .filter((t) => puedeVer(t.id, session));

  return (
    <MarcoApp
      clave={seccionActiva}
      session={session}
      modulo="bitacora"
      titulo="Bitácora Memories"
      subtitulo="Fundación Memories — Consulta de unidades productivas"
      chip={session.role === 'tallerista' ? session.region : `${datos.length.toLocaleString('es-CO')} registros`}
      tabs={tabs}
      seccion={seccionActiva}
      onSeccion={setSeccion}
      onLogout={onLogout}
      contadores={{ eventos: pendientesEventos, novedades: sinLeerNovedades }}
    >
      <>
        <AvisoGlobal session={session} />
        <VerComo nodos={nodosUnicos} />
        {seccionActiva === 'bitacora' && (
          <Bitacora
            data={datos} auditIndex={auditIndex} auditLoaded={auditLoaded}
            auditEstado={auditEstado} auditReintento={auditReintento}
            cargando={cargando} error={error} reintento={reintento}
            onReintentar={reintentar} onReintentarAuditoria={reintentarAuditoria}
            onCargarUnidad={cargarUnidad} onRecargar={recargar} session={session}
          />
        )}
        <Suspense fallback={<Cargando />}>
          {seccionActiva === 'agenda' && <Agenda data={datos} session={session} />}
          {seccionActiva === 'capitalizacion' && <Capitalizacion data={datos} session={session} />}
          {seccionActiva === 'talleres' && <Talleres session={session} />}
          {seccionActiva === 'alistamiento' && <Alistamiento />}
          {seccionActiva === 'seguimiento' && <Seguimiento data={datos} session={session} />}
        </Suspense>
        {seccionActiva === 'visitas' && <Visitas data={datos} session={session} />}
        {seccionActiva === 'eventos' && <Eventos />}
        {seccionActiva === 'novedades' && <Novedades session={session} />}
        {seccionActiva === 'entregas' && <Entregas data={datos} session={session} />}
        {seccionActiva === 'carguedatos' && <CargueDatos session={session} />}
        {seccionActiva === 'carguecompras' && <CargueCompras session={session} />}
        {seccionActiva === 'revisionentregas' && <RevisionEntregas session={session} />}
        {seccionActiva === 'mibodega' && <MiBodega session={session} />}
        {seccionActiva === 'proveedores' && <Proveedores session={session} />}
        {seccionActiva === 'kardex' && <Kardex session={session} />}
        {seccionActiva === 'saldos' && <SaldosBodegas cargar={(params) => fetchApi(`${API_BASE}/saldos-bodegas`, { token: session.token, params })} />}
        {seccionActiva === 'datoscargados' && <DatosCargados session={session} onCambio={reintentarAuditoria} />}
      </>
    </MarcoApp>
  );
}
