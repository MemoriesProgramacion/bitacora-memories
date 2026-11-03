// Adaptador de tickets. Se radican con la etapa del proceso, una unidad productiva opcional y hasta 5 archivos.
// Quien lo atiende lo toma, lo asigna a una persona o a un tipo de cuenta de la región, lo escala o lo responde
// con anexos, y el solicitante confirma la solución o la reabre. El servidor decide qué ve y qué puede hacer
// cada quien.
import { TICKETS_URL } from './config';
import { fetchApi } from './api';
import { apiGeneral, qs } from '../inventario/lib/api';

export const ESTADOS_TICKET = {
  abierto: { nombre: 'Radicado', tono: 'warn' },
  en_gestion: { nombre: 'En gestión', tono: 'info' },
  asignado: { nombre: 'Asignado', tono: 'info' },
  escalado: { nombre: 'Escalado', tono: 'bad' },
  respondido: { nombre: 'Respondido', tono: 'ok' },
  resuelto: { nombre: 'Solucionado', tono: 'ok' },
};

export const NIVELES_TICKET = {
  regional: 'Coordinador local regional',
  general: 'Nivel nacional',
};

// Etapas del proceso, las mismas del servidor.
export const ETAPAS_TICKET = {
  diagnostico: 'Diagnóstico', fortalecimiento: 'Fortalecimiento', capitalizacion: 'Capitalización',
  acompanamiento: 'Acompañamiento y seguimiento', administrativo: 'Administrativo/financiero',
  retiro: 'Retiro', reemplazo: 'Reemplazo',
};

export const ACCIONES_TICKET = {
  crear: 'Ticket radicado',
  tomar: 'Puesto en gestión',
  asignar: 'Asignado',
  escalar: 'Escalado al nivel nacional',
  resolver: 'Respondido',
  confirmar: 'Solución confirmada por el solicitante',
  reabrir: 'Reabierto por el solicitante',
  solucionado_auto: 'Solucionado sin confirmación',
};

export const MAX_ARCHIVOS_TICKET = 5;
const MB = 1024 * 1024;

// Devuelve los problemas de los archivos elegidos: máximo 5, PDF de hasta 15 MB o JPG y PNG de hasta 5 MB.
export function problemasArchivos(archivos = []) {
  const p = [];
  if (archivos.length > MAX_ARCHIVOS_TICKET) p.push(`Máximo ${MAX_ARCHIVOS_TICKET} archivos.`);
  for (const a of archivos) {
    const pdf = /\.pdf$/i.test(a.name);
    if (!pdf && !/\.(jpe?g|png)$/i.test(a.name)) p.push(`«${a.name}» debe ser PDF, JPG o PNG.`);
    else if (a.size > (pdf ? 15 : 5) * MB) p.push(`«${a.name}» supera los ${pdf ? 15 : 5} MB.`);
  }
  return p;
}

// Devuelve lo que falta para radicar.
export function faltasTicket(f, archivos = []) {
  const faltas = [];
  if (!String(f.titulo || '').trim()) faltas.push('Escribe el título.');
  if (!ETAPAS_TICKET[f.etapa]) faltas.push('Elige la etapa del proceso.');
  if (!String(f.descripcion || '').trim()) faltas.push('Describe la novedad.');
  return [...faltas, ...problemasArchivos(archivos)];
}

// Devuelve las salidas del ticket para el solicitante: radicado, respondido con anexos y solucionado, con su
// fecha y si ya pasó.
export function cadenaTicket(t) {
  const h = Array.isArray(t?.historial) ? t.historial : [];
  const ultimo = (acc) => [...h].reverse().find((x) => acc.includes(x.accion));
  const resp = ultimo(['resolver']);
  const sol = t?.estado === 'resuelto' ? ultimo(['confirmar', 'solucionado_auto']) : null;
  const anexos = (t?.adjuntos || []).filter((a) => a.clase === 'respuesta').length;
  const respondido = ['respondido', 'resuelto'].includes(t?.estado);
  return [
    { clave: 'radicado', nombre: 'Radicado', hecho: true, cuando: t?.creado_en || null },
    { clave: 'respondido', nombre: anexos ? `Respondido con ${anexos} ${anexos === 1 ? 'anexo' : 'anexos'}` : 'Respondido', hecho: respondido, cuando: respondido ? resp?.cuando || t?.respondido_en || null : null },
    { clave: 'solucionado', nombre: sol?.accion === 'solucionado_auto' ? 'Solucionado (sin confirmación)' : 'Solucionado', hecho: t?.estado === 'resuelto', cuando: t?.estado === 'resuelto' ? sol?.cuando || t?.resuelto_en || null : null },
  ];
}

// Devuelve el personal de un retiro o reemplazo asignado al ticket, que el servidor anota en el movimiento con
// que se responde.
export function personalDeTicket(t) {
  const h = [...(Array.isArray(t?.historial) ? t.historial : [])].reverse().find((x) => Array.isArray(x.personal_sale) && x.personal_sale.length);
  return h ? { sale: h.personal_sale, entra: h.entra || null } : null;
}

// Devuelve los nombres con su documento en un texto, como Ana Pérez (123), Luis Mora (456).
export const textoPersonal = (lista = []) => lista.map((p) => (p.documento ? `${p.nombre} (${p.documento})` : p.nombre)).join(', ');

// Indica si el ticket pide acción de quien lo ve: atenderlo o, si es suyo, confirmar la respuesta.
export const requiereAccion = (t) => !!(t.puede?.tomar || t.puede?.resolver || t.puede?.asignar || t.puede?.confirmar);

// Devuelve el filtro con el que abre la bandeja: por atender si algo pide acción, o todos; se fija una vez, al
// cargar.
export const filtroInicial = (tickets = []) => (tickets.some(requiereAccion) ? 'atender' : 'todos');

// Devuelve el texto de la bandeja vacía; Estás al día solo si de verdad no hay nada por atender, y si lo hay lo
// tapan los otros filtros.
export function mensajeVacio(filtro, hayPendientes) {
  if (filtro === 'atender') return hayPendientes ? 'No hay tickets por atender con estos filtros.' : 'Estás al día: no tienes tickets por atender.';
  return 'No hay tickets con estos filtros.';
}

// Devuelve una fecha en español largo, como 30 de octubre de 2026.
export function fechaLargaTicket(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('es-CO', { dateStyle: 'long' });
}

// Aplica los filtros de la bandeja: estado, etapa, asignado y texto.
export function filtrarTickets(tickets = [], { estado = '', etapa = '', asignado = '', q = '' } = {}) {
  const t = String(q).trim().toLowerCase();
  return tickets.filter((x) => (!estado || x.estado === estado) && (!etapa || x.etapa === etapa)
    && (!asignado || claveAsignado(x) === asignado)
    && (!t || [x.consecutivo, x.titulo, x.descripcion, x.id_unico, x.unidad, x.creado_por].some((v) => String(v || '').toLowerCase().includes(t))));
}
// Devuelve la clave del asignado de un ticket para el filtro, o vacío.
export const claveAsignado = (t) => (t?.asignado?.tipo === 'cuenta' ? `cuenta:${t.asignado.nombre}` : t?.asignado?.tipo === 'rol' ? `rol:${t.asignado.rol}` : '');
// Devuelve las opciones del filtro de asignado con lo que hay en la bandeja.
export function opcionesAsignado(tickets = []) {
  const m = new Map();
  for (const t of tickets) {
    const k = claveAsignado(t);
    if (k && !m.has(k)) m.set(k, t.asignado.tipo === 'cuenta' ? `${t.asignado.nombre} (${t.asignado.nombre_rol})` : `Cola: ${t.asignado.nombre_rol}`);
  }
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}

export async function listarTickets(session) {
  const r = await fetchApi(TICKETS_URL, { token: session?.token });
  return r.items || [];
}

// Arma el formulario multipart que usan radicar y gestionar, porque llevan archivos.
const formulario = (campos, archivos = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  for (const a of archivos) fd.append('adjuntos', a);
  return fd;
};

export async function crearTicket(datos, archivos = []) {
  return (await apiGeneral.post('/tickets', formulario(datos, archivos))).item;
}

export async function gestionarTicket({ id, accion, nota, asignado }, archivos = []) {
  return (await apiGeneral.post('/tickets/gestion', formulario({ id, accion, nota, asignado }, archivos))).item;
}

export async function asignablesTicket(id) {
  return apiGeneral.get(`/tickets/asignables${qs({ id })}`);
}
