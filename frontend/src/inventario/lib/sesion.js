// Adapta la sesión única de la aplicación al formato que usaban las páginas del inventario: usuario, esAdmin y
// empresa. Quien tiene acceso total actúa como administrador dentro del inventario.
import { useSession } from '../../hooks/useSession'

// Hook que devuelve la sesión con el formato del inventario.
export function useSesion() {
  const { session, empresa } = useSession()
  const rol = ['superadmin', 'coordinador_datos', 'coordinador_compras'].includes(session?.role) ? 'admin' : session?.role
  return {
    usuario: session ? { nombre: session.nombre || session.usuario, usuario: session.usuario, rol } : null,
    esAdmin: rol === 'admin',
    empresa,
  }
}
