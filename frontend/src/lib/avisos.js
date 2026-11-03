// Adaptador de los avisos de la pestaña de novedades, con el mismo patrón de lib/eventos.js. El documento sigue
// el contrato Novedad.json, y lecturas[nodo] existe solo si el nodo la leyó.
import {
  AVISOS_URL, AVISO_LECTURA_URL, SIN_DATOS,
} from './config';
import { fetchApi } from './api';
import { CATEGORIAS_NOVEDAD } from './comunicaciones';

const ahora = () => new Date().toISOString();

export const nuevoIdNovedad = () =>
  `nov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export function prepararNovedad(n, session) {
  return {
    ...n,
    id: String(n.id),
    categoria_label: CATEGORIAS_NOVEDAD.find((c) => c.id === n.categoria)?.nombre || SIN_DATOS,
    publicado_por: n.publicado_por || {
      usuario: session?.correo || session?.nombre || SIN_DATOS,
      nodo: session?.role === 'gestor' ? session.nodo : null,
    },
    editada: !!n.editada,
    recordado: n.recordado || null,
    creado_en: n.creado_en || ahora(),
    fecha_actualizacion: ahora(),
  };
}

// Pide los avisos; la API filtra por destinatarios si el usuario es de campo.
export async function listarNovedades(session) {
  const r = await fetchApi(AVISOS_URL, { token: session?.token });
  return r.items || [];
}

export async function guardarNovedad(novedad, session) {
  const doc = prepararNovedad(novedad, session);
  const r = await fetchApi(AVISOS_URL, { token: session?.token, metodo: 'PUT', cuerpo: doc });
  return r.item || doc;
}

export async function eliminarNovedad(id, session) {
  await fetchApi(AVISOS_URL, { token: session?.token, metodo: 'DELETE', params: { id } });
}

// Marca el aviso como leído por un solo nodo, porque en la base hay una fila por nodo.
export async function marcarLeida(novedadId, nodo, session) {
  const lectura = { fecha_lectura: ahora() };
  await fetchApi(AVISO_LECTURA_URL, {
    token: session?.token, metodo: 'PATCH',
    cuerpo: { id: String(novedadId), nodo, lectura },
  });
}
