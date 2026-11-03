// Usuarios de todo el sistema: una sola lista con las cuentas de la Bitácora, del inventario y de acceso total.
// Desde aquí se cambia el tipo de cuenta y la clave, se activa o desactiva una cuenta, se desbloquea y se
// cierran sus sesiones.
import { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import {
  Boton, Campo, Cargando, Dialogo, Entrada, Seleccion, Tarjeta, Confirmar,
} from '../inventario/componentes/ui';
import Encabezado from '../inventario/componentes/Encabezado';
import { useAccion } from '../inventario/lib/useDatos';
import { useSession } from '../hooks/useSession';
import { admin } from './apiAdmin';
import { useCarga } from './useCarga';
import { ROLES } from './etiquetas';
import DialogoClave from './DialogoClave';
import FormUsuario from './FormUsuario';
import ListaUsuarios from './ListaUsuarios';

// Muestra la lista de usuarios y coordina los diálogos de creación, edición y clave.
export default function Usuarios() {
  const { session } = useSession();
  const limitado = session?.role === 'coordinador_compras';
  const { datos, cargando, recargar } = useCarga(() => admin.usuarios());
  const { ejecutar, ocupado } = useAccion(recargar);

  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const [estado, setEstado] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState(null);
  const [bodegaDe, setBodegaDe] = useState(null);
  const [bodegaId, setBodegaId] = useState('');
  const [claveDe, setClaveDe] = useState(null);
  const [aCambiar, setACambiar] = useState(null);

  const visibles = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return (datos?.usuarios || []).filter((u) => (
      (!rol || u.rol === rol)
      && (!estado || (estado === 'activos' ? u.activo : !u.activo))
      && (!texto || [u.usuario, u.nombre, u.cedula, u.correo, u.departamento, ROLES[u.rol]]
        .some((v) => String(v || '').toLowerCase().includes(texto)))
    ));
  }, [datos, q, rol, estado]);

  if (!datos) return <Cargando />;

  const porRol = datos.usuarios.reduce((n, u) => ({ ...n, [u.rol]: (n[u.rol] || 0) + 1 }), {});

  const guardarNuevo = async (d, alFallar) => {
    const r = await ejecutar(() => admin.crearUsuario(d), { alFallar });
    if (r) setNuevo(false);
  };
  const guardarEdicion = async (d, alFallar) => {
    const r = await ejecutar(() => admin.editarUsuario(editar, d), { alFallar });
    if (r) setEditar(null);
  };
  const guardarClave = async (clave) => {
    const r = await ejecutar(() => admin.asignarClave(claveDe, clave));
    if (r) setClaveDe(null);
  };
  const volverACedula = async () => {
    const r = await ejecutar(() => admin.claveACedula(claveDe));
    if (r) setClaveDe(null);
  };
  const confirmarEstado = async () => {
    const u = aCambiar;
    setACambiar(null);
    await ejecutar(() => admin.cambiarEstado(u));
  };

  return (
    <>
      <Encabezado
        titulo="Usuarios"
        descripcion="Todas las cuentas de Bitácora e inventario. Las claves están cifradas: se pueden cambiar, no leer."
      >
        <Boton icono={UserPlus} variante="acento" onClick={() => setNuevo(true)}>Nuevo usuario</Boton>
      </Encabezado>

      <Tarjeta className="mb-5">
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Filtrar por rol">
          {[['', 'Todos', datos.usuarios.length], ...datos.roles.map(({ rol: r }) => [r, ROLES[r], porRol[r] || 0])]
            .map(([clave, texto, total]) => (
              <button
                key={clave || 'todos'}
                type="button"
                onClick={() => setRol(clave)}
                aria-pressed={rol === clave}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-[background-color,border-color,color] duration-150 ${
                  rol === clave
                    ? 'border-marino bg-marino text-white'
                    : 'border-borde bg-card text-marca hover:border-acento'
                }`}
              >
                {texto} <span className="cifras opacity-70">{total}</span>
              </button>
            ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gris" />
            <Entrada
              className="pl-10"
              placeholder="Buscar usuario, nombre o rol"
              aria-label="Buscar usuarios"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Seleccion value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado" className="sm:w-40">
            <option value="">Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </Seleccion>
        </div>
        <p className="mt-3 text-[12px] text-gris-txt" aria-live="polite">
          {visibles.length} de {datos.usuarios.length} usuarios{cargando ? ' · actualizando…' : ''}
        </p>
      </Tarjeta>

      <ListaUsuarios
        usuarios={visibles}
        acciones={{
          clave: setClaveDe,
          bodega: (u) => { setBodegaDe(u); setBodegaId(String(u.bodega_id || '')); },
          desbloquear: (u) => ejecutar(() => admin.desbloquear(u.usuario)),
          ...(limitado ? {} : {
            editar: setEditar,
            estado: setACambiar,
            cerrarSesiones: (u) => ejecutar(() => admin.cerrarSesiones(u)),
            aCedula: (u) => ejecutar(() => admin.claveACedula(u)),
          }),
        }}
      />

      <Dialogo abierto={nuevo} titulo="Nuevo usuario" onCerrar={() => setNuevo(false)}>
        {nuevo && (
          <FormUsuario roles={datos.roles} departamentos={datos.departamentos} territorio={datos.territorio} bodegas={datos.bodegas}
            onGuardar={guardarNuevo} onCancelar={() => setNuevo(false)} />
        )}
      </Dialogo>

      <Dialogo abierto={Boolean(editar)} titulo={`Editar a ${editar?.usuario || ''}`} onCerrar={() => setEditar(null)}>
        {editar && (
          <FormUsuario usuario={editar} roles={datos.roles} departamentos={datos.departamentos} territorio={datos.territorio} bodegas={datos.bodegas}
            onGuardar={guardarEdicion} onCancelar={() => setEditar(null)} />
        )}
      </Dialogo>

      <Dialogo abierto={Boolean(bodegaDe)} titulo={`Bodega de ${bodegaDe?.usuario || ''}`} onCerrar={() => setBodegaDe(null)}>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await ejecutar(() => admin.asignarBodega(bodegaDe, bodegaId));
          if (r) setBodegaDe(null);
        }}>
          <Campo etiqueta="Bodega municipal" obligatorio ayuda="Al guardar se cierran sus sesiones. Las siguientes entregas saldrán solo de esta bodega.">
            <Seleccion required value={bodegaId} onChange={(e) => setBodegaId(e.target.value)}>
              <option value="">Elige…</option>
              {(datos.bodegas || []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </Seleccion>
          </Campo>
          <Boton tipo="submit" cargando={ocupado}>Asignar bodega</Boton>
        </form>
      </Dialogo>

      <DialogoClave
        usuario={claveDe}
        onCerrar={() => setClaveDe(null)}
        onGuardar={guardarClave}
        onCedula={volverACedula}
      />

      <Confirmar
        abierto={Boolean(aCambiar)}
        titulo={aCambiar?.activo ? '¿Desactivar usuario?' : '¿Activar usuario?'}
        texto={aCambiar?.activo
          ? `${aCambiar?.usuario} no podrá entrar y se cerrarán sus sesiones abiertas.`
          : `${aCambiar?.usuario} volverá a poder entrar.`}
        etiquetaOk={aCambiar?.activo ? 'Desactivar' : 'Activar'}
        onOk={confirmarEstado}
        onCancelar={() => setACambiar(null)}
      />
    </>
  );
}
