// Llamadas del frontend a la consola de administración (/api/admin).
import { apiGeneral, qs } from '../inventario/lib/api';

// Devuelve la dirección de una acción sobre un usuario concreto: su tipo de cuenta, su id y la acción.
const ruta = (origen, id, accion) => `/admin/usuarios/${origen}/${id}/${accion}`;

// Agrupa por tema todas las llamadas del panel de administración.
export const admin = {
  resumen: () => apiGeneral.get('/admin/resumen'),

  usuarios: () => apiGeneral.get('/admin/usuarios'),
  crearUsuario: (datos) => apiGeneral.post('/admin/usuarios', datos),
  editarUsuario: (u, datos) => apiGeneral.post(ruta(u.origen, u.id, 'editar'), datos),
  asignarBodega: (u, bodega_id) => apiGeneral.post(ruta(u.origen, u.id, 'bodega'), { bodega_id }),
  asignarClave: (u, clave) => apiGeneral.post(ruta(u.origen, u.id, 'clave'), { clave }),
  claveACedula: (u) => apiGeneral.post(ruta(u.origen, u.id, 'clave'), { restablecer: true }),
  cambiarEstado: (u) => apiGeneral.post(ruta(u.origen, u.id, 'estado')),
  cerrarSesiones: (u) => apiGeneral.post(ruta(u.origen, u.id, 'cerrar-sesiones')),
  desbloquear: (usuario) => apiGeneral.post('/admin/desbloquear', { usuario }),

  accesos: (filtros) => apiGeneral.get(`/admin/accesos${qs(filtros)}`),
  sesiones: () => apiGeneral.get('/admin/sesiones'),
  cerrarSesion: (id) => apiGeneral.post(`/admin/sesiones/${id}/cerrar`),
  auditoriaClaves: () => apiGeneral.get('/admin/auditoria-claves'),

  config: () => apiGeneral.get('/config?todos=1'),
  accionConfig: (cuerpo) => apiGeneral.post('/config', cuerpo),

  cargaGestores: () => apiGeneral.get('/alistamiento/gestores'),
  moverUP: (datos) => apiGeneral.post('/alistamiento/mover-up', datos),
  equipo: () => apiGeneral.get('/alistamiento/equipo'),
  eventosEquipo: (tipo) => apiGeneral.get(`/alistamiento/eventos${qs({ tipo })}`),
  registrarEventoEquipo: (formulario) => apiGeneral.post('/alistamiento/eventos', formulario),
  unidades: () => apiGeneral.get('/unidades'),

  actividad: (filtros) => apiGeneral.get(`/actividad${qs(filtros)}`),
  uso: (filtros) => apiGeneral.get(`/actividad${qs({ ...filtros, resumen: 'uso' })}`),
};
