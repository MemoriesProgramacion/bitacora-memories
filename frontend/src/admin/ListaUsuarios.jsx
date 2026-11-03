// Listado de usuarios con todos sus datos. En pantallas muy anchas es una tabla; en pantallas menores cada
// usuario es una tarjeta con sus datos y botones con texto, para poder operarla con el dedo.
import { IdCard, KeyRound, LogOut, Pencil, Power, Unlock, Users, Warehouse } from 'lucide-react';
import { Boton, Celda, Fila, Insignia, Tabla, Tarjeta, Vacio } from '../inventario/componentes/ui';
import { ROLES, fechaHora } from './etiquetas';

// Devuelve la zona de la persona: departamento, región y nodo de una cuenta de campo, o el territorio de una
// cuenta regional.
const zonaDe = (u) => (u.origen === 'coordinador'
  ? [u.departamento, u.region, u.modalidad, u.nodo]
  : [u.departamento, u.region, u.triada]).filter(Boolean);

function EstadoClave({ u }) {
  return u.clave_estado === 'cedula' ? (
    <Insignia tono="alerta">Clave = cédula</Insignia>
  ) : (
    <Insignia>Clave cifrada</Insignia>
  );
}

// Muestra los botones de cada usuario; con conTexto llevan su nombre junto al icono.
function Acciones({ u, acciones, conTexto }) {
  const t = (texto) => (conTexto ? texto : null);
  return (
    <div className={`flex flex-wrap gap-1.5 ${conTexto ? '' : 'justify-end'}`}>
      <Boton tamano="sm" variante="fantasma" icono={KeyRound} onClick={() => acciones.clave(u)}
        aria-label={`Cambiar la clave de ${u.usuario}`} title="Cambiar clave">
        {t('Clave')}
      </Boton>
      {acciones.editar && (
        <Boton tamano="sm" variante="fantasma" icono={Pencil} onClick={() => acciones.editar(u)}
          aria-label={`Editar a ${u.usuario}`} title="Editar datos y rol">
          {t('Editar')}
        </Boton>
      )}
      {acciones.bodega && u.rol === 'bodeguero' && (
        <Boton tamano="sm" variante="fantasma" icono={Warehouse} onClick={() => acciones.bodega(u)}
          aria-label={`Asignar bodega a ${u.usuario}`} title="Asignar bodega municipal">{t('Bodega')}</Boton>
      )}
      {acciones.estado && (
        <Boton tamano="sm" variante="fantasma" icono={Power} onClick={() => acciones.estado(u)}
          aria-label={`${u.activo ? 'Desactivar' : 'Activar'} a ${u.usuario}`}
          title={u.activo ? 'Desactivar' : 'Activar'}>
          {t(u.activo ? 'Desactivar' : 'Activar')}
        </Boton>
      )}
      {acciones.cerrarSesiones && u.sesiones > 0 && (
        <Boton tamano="sm" variante="fantasma" icono={LogOut} onClick={() => acciones.cerrarSesiones(u)}
          aria-label={`Cerrar las sesiones de ${u.usuario}`} title="Cerrar sus sesiones">
          {t('Cerrar sesiones')}
        </Boton>
      )}
      {u.bloqueado && (
        <Boton tamano="sm" variante="fantasma" icono={Unlock} onClick={() => acciones.desbloquear(u)}
          aria-label={`Desbloquear a ${u.usuario}`} title="Quitar el bloqueo">
          {t('Desbloquear')}
        </Boton>
      )}
      {acciones.aCedula && u.origen === 'gestor' && u.clave_estado !== 'cedula' && u.cedula && (
        <Boton tamano="sm" variante="fantasma" icono={IdCard} onClick={() => acciones.aCedula(u)}
          aria-label={`Volver la clave de ${u.usuario} a su cédula`} title="Volver a la cédula">
          {t('Clave = cédula')}
        </Boton>
      )}
    </div>
  );
}

// Muestra una fila de la tarjeta con dato y valor, que no se dibuja si no hay valor.
function Dato({ etiqueta, children }) {
  if (!children) return null;
  return (
    <>
      <dt className="text-gris">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-marca">{children}</dd>
    </>
  );
}

// Muestra un usuario como tarjeta.
function TarjetaUsuario({ u, acciones }) {
  const zona = zonaDe(u);
  return (
    <article className="rounded-xl border border-borde bg-card p-4 shadow-tarjeta">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-[15px] font-bold text-marca">{u.nombre || u.usuario}</h3>
          <p className="cifras break-all text-[13px] font-semibold text-gris-txt">{u.usuario}</p>
        </div>
        <Insignia tono={u.activo ? 'ok' : 'error'}>{u.activo ? 'Activo' : 'Inactivo'}</Insignia>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Insignia ajustar>{ROLES[u.rol] || u.rol}</Insignia>
        <EstadoClave u={u} />
        {u.bloqueado && <Insignia tono="alerta">Bloqueado</Insignia>}
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <Dato etiqueta="Cédula">{u.cedula && <span className="cifras">{u.cedula}</span>}</Dato>
        <Dato etiqueta="Clave actual">
          {u.clave_estado === 'cedula' && <span className="cifras">{u.clave_visible}</span>}
        </Dato>
        <Dato etiqueta="Correo">{u.correo && <span className="break-all">{u.correo}</span>}</Dato>
        <Dato etiqueta="Teléfono">{u.telefono && <span className="cifras">{u.telefono}</span>}</Dato>
        <Dato etiqueta="Zona">{zona.length > 0 && zona.join(' · ')}</Dato>
        {u.rol === 'bodeguero' && <Dato etiqueta="Bodega">{u.bodega_nombre || 'Sin asignar'}</Dato>}
        <Dato etiqueta="Último ingreso">{fechaHora(u.ultimo_acceso)}</Dato>
        <Dato etiqueta="Sesiones">{u.sesiones > 0 && `${u.sesiones} abierta(s)`}</Dato>
      </dl>

      <div className="mt-3.5 border-t border-borde/70 pt-3">
        <Acciones u={u} acciones={acciones} conTexto />
      </div>
    </article>
  );
}

// Muestra la lista como tabla o como tarjetas según el ancho.
export default function ListaUsuarios({ usuarios, acciones }) {
  if (usuarios.length === 0) {
    return (
      <Tarjeta>
        <Vacio icono={Users}>Ningún usuario coincide con el filtro.</Vacio>
      </Tarjeta>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:hidden">
        {usuarios.map((u) => <TarjetaUsuario key={u.clave_id} u={u} acciones={acciones} />)}
      </div>

      <Tarjeta className="max-xl:hidden">
        <Tabla
          iconoVacio={Users}
          vacio="Ningún usuario coincide con el filtro."
          cabeceras={['Persona', 'Usuario', 'Rol', 'Estado', 'Último ingreso', { texto: 'Acciones', alinear: 'derecha' }]}
        >
          {usuarios.map((u) => {
            const zona = zonaDe(u);
            return (
              <Fila key={u.clave_id}>
                <Celda className="min-w-[9rem]">
                  <div className="font-bold text-marca">{u.nombre || '—'}</div>
                  {u.cedula && <div className="cifras text-[12px] text-gris">CC {u.cedula}</div>}
                  {u.correo && <div className="max-w-[13rem] break-all text-[12px] text-gris-txt">{u.correo}</div>}
                  {u.telefono && <div className="cifras text-[12px] text-gris-txt">{u.telefono}</div>}
                </Celda>
                <Celda>
                  <div className="cifras whitespace-nowrap font-semibold text-marca">{u.usuario}</div>
                  {u.rol === 'bodeguero' && <div className="text-[12px] text-gris-txt">{u.bodega_nombre || 'Bodega sin asignar'}</div>}
                  {zona.length > 0 && <div className="max-w-[12rem] text-[12px] text-gris-txt">{zona.join(' · ')}</div>}
                </Celda>
                <Celda className="max-w-[10rem]"><Insignia ajustar>{ROLES[u.rol] || u.rol}</Insignia></Celda>
                <Celda>
                  <div className="flex flex-col items-start gap-1">
                    <Insignia tono={u.activo ? 'ok' : 'error'}>{u.activo ? 'Activo' : 'Inactivo'}</Insignia>
                    {u.bloqueado && <Insignia tono="alerta">Bloqueado</Insignia>}
                    <EstadoClave u={u} />
                    {u.clave_estado === 'cedula' && <span className="cifras text-[12px] text-gris-txt">{u.clave_visible}</span>}
                    {u.sesiones > 0 && <span className="text-[12px] text-gris-txt">{u.sesiones} sesión(es)</span>}
                  </div>
                </Celda>
                <Celda className="text-[13px]">{fechaHora(u.ultimo_acceso)}</Celda>
                <Celda alinear="derecha">
                  <div className="ml-auto w-[7.5rem]">
                    <Acciones u={u} acciones={acciones} />
                  </div>
                </Celda>
              </Fila>
            );
          })}
        </Tabla>
      </Tarjeta>
    </>
  );
}
