// Adaptador de eventos: useComunicaciones.jsx es el único que llama estas funciones, que hablan con la API. El
// documento sigue el contrato Evento.json.
import {
  EVENTOS_URL, EVENTO_URL, EVENTO_RESPUESTA_URL, SIN_DATOS,
} from './config';
import { fetchApi } from './api';
import { TIPOS_EVENTO } from './comunicaciones';

const ahora = () => new Date().toISOString();

export const nuevoIdEvento = () =>
  `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// Convierte el estado de pantalla en el documento Evento.json, completando lo que falte.
export function prepararEvento(e, session) {
  return {
    ...e,
    id: String(e.id),
    tipo_label: TIPOS_EVENTO.find((t) => t.id === e.tipo)?.nombre || SIN_DATOS,
    destinatarios: Object.keys(e.respuestas || {}),
    convocado_por: e.convocado_por || {
      usuario: session?.correo || session?.nombre || SIN_DATOS,
      nodo: session?.role === 'gestor' ? session.nodo : null,
    },
    recordado: e.recordado || null,
    creado_en: e.creado_en || ahora(),
    fecha_actualizacion: ahora(),
  };
}

// Pide los eventos; la API filtra por el nodo del token si el usuario es de campo.
export async function listarEventos(session) {
  const r = await fetchApi(EVENTOS_URL, { token: session?.token });
  return r.items || [];
}

// Crea o edita un evento, solo para quien tiene permisos de coordinación.
export async function guardarEvento(evento, session) {
  const doc = prepararEvento(evento, session);
  const r = await fetchApi(EVENTO_URL, { token: session?.token, metodo: 'PUT', cuerpo: doc });
  return r.item || doc;
}

export async function eliminarEvento(id, session) {
  await fetchApi(EVENTO_URL, { token: session?.token, metodo: 'DELETE', params: { id } });
}

// Guarda la respuesta de una sola cuenta de campo, aparte para que dos respuestas a la vez no se pisen.
export async function guardarRespuesta(eventoId, nodo, respuesta, session) {
  const r = { ...respuesta, fecha_respuesta: ahora() };
  await fetchApi(EVENTO_RESPUESTA_URL, {
    token: session?.token, metodo: 'PATCH',
    cuerpo: { id: String(eventoId), nodo, respuesta: r },
  });
}
