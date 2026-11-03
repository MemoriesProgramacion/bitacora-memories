// Vista general de la consola: cuántos usuarios hay de cada tipo, sesiones abiertas, fallos recientes y los
// últimos ingresos.
import { Activity, LockKeyhole, Monitor, ShieldAlert, UserCog, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Cargando, Indicador, Insignia, Tabla, Fila, Celda, Tarjeta } from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { ROLES, fechaHora, nombreEvento } from './etiquetas';

// Muestra las cifras generales y los últimos ingresos.
export default function Resumen() {
  const { datos: resumen } = useCarga(() => admin.resumen());
  const { datos: ingresos } = useCarga(() => admin.accesos({ vista: 'ingresos', limite: 8 }));

  if (!resumen) return <Cargando />;

  const tipos = Object.keys(ROLES);
  const totalUsuarios = tipos.reduce((n, t) => n + (resumen.usuarios[t]?.total || 0), 0);

  return (
    <>
      <Encabezado
        titulo="Resumen general"
        descripcion="Estado de las cuentas y de los accesos de Bitácora e inventario."
      />

      <div className="escalonado grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador etiqueta="Usuarios" valor={totalUsuarios} icono={Users}
          detalle={`${tipos.reduce((n, t) => n + (resumen.usuarios[t]?.activos || 0), 0)} activos`} />
        <Indicador etiqueta="Sesiones abiertas" valor={resumen.sesiones_activas} icono={Monitor}
          detalle="Personas conectadas ahora" />
        <Indicador etiqueta="Fallos en 24 h" valor={resumen.fallos_24h} icono={ShieldAlert}
          detalle="Ingresos y accesos rechazados" />
        <Indicador etiqueta="Usuarios bloqueados" valor={resumen.bloqueados} icono={LockKeyhole}
          detalle="Por intentos fallidos seguidos" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Tarjeta titulo="Usuarios por rol">
          <ul className="flex flex-col divide-y divide-borde">
            {tipos.map((t) => (
              <li key={t} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span className="flex items-center gap-2 text-marca">
                  <UserCog size={16} aria-hidden="true" className="text-gris" />
                  {ROLES[t]}
                </span>
                <span className="cifras font-semibold text-marca">
                  {resumen.usuarios[t]?.activos || 0}
                  <span className="font-normal text-gris-txt"> / {resumen.usuarios[t]?.total || 0}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link to="/admin/usuarios" className="mt-3 inline-block text-[13px] font-semibold text-acento-txt hover:underline">
            Ver y administrar usuarios
          </Link>
        </Tarjeta>

        <Tarjeta
          titulo="Últimos inicios de sesión"
          acciones={<Link to="/admin/accesos" className="text-[13px] font-semibold text-acento-txt hover:underline">Ver todo</Link>}
        >
          {!ingresos ? <Cargando /> : (
            <Tabla cabeceras={['Fecha', 'Usuario', 'Evento', 'Resultado']} iconoVacio={Activity} vacio="Todavía no hay registros.">
              {ingresos.eventos.map((e) => (
                <Fila key={e.id}>
                  <Celda className="whitespace-nowrap">{fechaHora(e.fecha)}</Celda>
                  <Celda><strong className="font-semibold">{e.usuario_texto || '—'}</strong></Celda>
                  <Celda>{nombreEvento(e.tipo)}</Celda>
                  <Celda><Insignia tono={e.exito ? 'ok' : 'error'}>{e.exito ? 'Correcto' : 'Rechazado'}</Insignia></Celda>
                </Fila>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      </div>
    </>
  );
}
