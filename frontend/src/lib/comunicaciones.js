// Datos y utilidades de las comunicaciones. Las cuentas de campo a las que se convoca en eventos o se avisa en
// avisos son las activas del alcance de quien publica y las trae cargarGestores desde la API. Eventos y avisos
// guardan siempre la lista exacta de nodos destinatarios, y cada cuenta de campo solo ve lo que incluye su
// nodo.
import { useSyncExternalStore } from 'react';
import { GESTORES_URL } from './config';
import { fetchApi } from './api';

// Lista viva de cuentas de campo, exportada con let para que quien la importa vea siempre la última.
export let GESTORES = [];
const oyentes = new Set();
let pedido = null;
// Estado de la carga, una sola por sesión: inicial, cargando, lista o error.
let carga = 'inicial';
const avisarOyentes = () => oyentes.forEach((f) => f());
function fijarCarga(valor) {
  if (carga === valor) return;
  carga = valor;
  avisarOyentes();
}

// Convierte una cuenta de campo, tal como la entrega el servidor, en la forma que pinta el selector de
// destinatarios.
export const aGestor = (g) => ({
  nodo: String(g?.nodo ?? '').trim().toUpperCase(),
  nombre: String(g?.nombre ?? '').trim() || String(g?.nodo ?? '').trim(),
  region: String(g?.region ?? '').trim() || 'Sin región',
  dpto: String(g?.departamento ?? '').trim() || 'Sin departamento',
  modalidades: Array.isArray(g?.modalidades) ? g.modalidades.filter(Boolean).map(String) : [],
  ups: Number(g?.ups) || 0,
});

export function fijarGestores(items) {
  const vistos = new Set();
  GESTORES = (items || []).map(aGestor).filter((g) => g.nodo && !vistos.has(g.nodo) && vistos.add(g.nodo));
  avisarOyentes();
}

// Trae las cuentas de campo del alcance de la sesión una sola vez; otra sesión las vuelve a pedir.
export function cargarGestores(session) {
  if (!session || session.role === 'gestor' || session.role === 'tallerista') return Promise.resolve(GESTORES);
  const clave = `${session.role}|${session.token || ''}|${session.correo || session.nombre || ''}`;
  if (pedido?.clave === clave) return pedido.promesa;
  if (pedido) fijarGestores([]);
  const promesa = fetchApi(GESTORES_URL, { token: session.token })
    .then((r) => {
      if (pedido?.clave === clave) { carga = 'lista'; fijarGestores(r.items); }
      return GESTORES;
    })
    .catch((e) => {
      console.error('[bitacora][E-COMUNICACIONES] gestores:', e);
      if (pedido?.clave === clave) { pedido = null; fijarCarga('error'); }
      return GESTORES;
    });
  pedido = { clave, promesa };
  fijarCarga('cargando');
  return promesa;
}

const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f); };
const leer = () => GESTORES;
const leerCarga = () => carga;
// Hook para que las pantallas que pintan cuentas de campo se vuelvan a pintar cuando llegan.
export const useGestores = () => useSyncExternalStore(suscribir, leer, leer);
// Hook para que el selector sepa si la carga sigue en camino o falló.
export const useCargaGestores = () => useSyncExternalStore(suscribir, leerCarga, leerCarga);

export const TIPOS_EVENTO = [
  { id: 'general',      nombre: 'Reunión general',    desc: 'Convoca a todos los nodos.' },
  { id: 'capacitacion', nombre: 'Capacitación',       desc: 'Formación sobre un tema puntual.' },
  { id: 'asamblea',     nombre: 'Asamblea nodal',     desc: 'Encuentro propio de un nodo.' },
  { id: 'comite',       nombre: 'Comité',             desc: 'Reunión de seguimiento interno.' },
  { id: 'entrega',      nombre: 'Entrega de insumos', desc: 'Jornada de entrega o capitalización.' },
];

export const RESPUESTAS_EVENTO = [
  { id: 'si',           label: 'Sí, asisto',       grupo: 'Confirman asistencia', corto: 'Confirman',     tono: 'ok' },
  { id: 'porconfirmar', label: 'Por confirmar',    grupo: 'Por confirmar',        corto: 'Por confirmar', tono: 'warn' },
  { id: 'no',           label: 'No puedo asistir', grupo: 'No pueden asistir',    corto: 'No pueden',     tono: 'bad' },
  { id: 'sin',          label: 'Sin responder',    grupo: 'Sin responder',        corto: 'Sin responder', tono: 'neutral' },
];

// Categorías de los avisos, ligadas al significado del color y no a la estética: rojo es alerta, ámbar
// precaución, verde éxito y azul información neutra.
export const CATEGORIAS_NOVEDAD = [
  { id: 'urgente',  nombre: 'Urgente',     desc: 'Vence hoy o exige acción inmediata',        tono: 'bad' },
  { id: 'atencion', nombre: 'Por vencer',  desc: 'Necesita atención en los próximos días',    tono: 'warn' },
  { id: 'logro',    nombre: 'Logro',       desc: 'Avance o resultado positivo para destacar', tono: 'ok' },
  { id: 'info',     nombre: 'Información', desc: 'Aviso general, sin urgencia',               tono: 'info' },
];

export const nodosDeRegion = (r) => GESTORES.filter((g) => g.region === r).map((g) => g.nodo);
export const todosNodos = () => GESTORES.map((g) => g.nodo);
export const gestor = (nodo) => GESTORES.find((g) => g.nodo === nodo) || null;
export const nombreGestor = (nodo) => (gestor(nodo) ? gestor(nodo).nombre : nodo);
export const metaGestor = (nodo) => {
  const g = gestor(nodo);
  return g ? `${g.nodo} · ${g.dpto}` : nodo;
};

export const resp = (valor, comentario, foto) => ({
  valor: valor || null, comentario: comentario || '', foto: foto || '',
});

// Ordena por región y luego por nodo para que las listas sean estables.
export function ordenGestores(nodos) {
  const orden = {};
  GESTORES.forEach((g, i) => { orden[g.nodo] = i; });
  return [...nodos].sort((a, b) => (orden[a] ?? 999) - (orden[b] ?? 999));
}

// Devuelve la etiqueta corta de un conjunto de destinatarios: todos, una región completa, un departamento o el
// número de cuentas, comparando por conjuntos.
export function destLabel(lista) {
  const nodos = [...new Set(lista || [])];
  const n = nodos.length;
  if (!n) return 'Nadie';
  if (n === GESTORES.length && nodos.every((x) => gestor(x))) return 'Todos los gestores';
  if (n === 1) return nombreGestor(nodos[0]);

  const regiones = [...new Set(nodos.map((x) => gestor(x)?.region).filter(Boolean))];
  if (regiones.length === 1) {
    const enRegion = nodosDeRegion(regiones[0]);
    if (enRegion.length === n && enRegion.every((x) => nodos.includes(x))) return regiones[0];
  }
  const dptos = [...new Set(nodos.map((x) => gestor(x)?.dpto).filter(Boolean))];
  if (dptos.length === 1) {
    const enDpto = GESTORES.filter((g) => g.dpto === dptos[0]).map((g) => g.nodo);
    if (enDpto.length === n && enDpto.every((x) => nodos.includes(x))) return dptos[0];
  }
  return `${n} gestores`;
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
  'agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const pad = (n) => (n < 10 ? '0' : '') + n;

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const diasHasta = (iso) =>
  Math.round((new Date(`${iso}T00:00:00`) - new Date(`${hoyISO()}T00:00:00`)) / 86400000);
export const esPasado = (iso) => diasHasta(iso) < 0;

export function fechaLarga(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Devuelve la hora siempre en formato de 12 horas, porque el campo de hora muestra hora militar en varios
// navegadores.
export function horaLegible(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}
export function horaDecompuesta(hhmm) {
  if (!hhmm) return { h: '', m: '', ap: '' };
  const [h, m] = hhmm.split(':').map(Number);
  return {
    h: String(h % 12 === 0 ? 12 : h % 12),
    m: pad(m),
    ap: h >= 12 ? 'PM' : 'AM',
  };
}
export function horaCompuesta(h, m, ap) {
  if (!h || !m || !ap) return '';
  let hh = Number(h) % 12;
  if (ap === 'PM') hh += 12;
  return `${pad(hh)}:${m}`;
}

export function cuandoRelativo(iso) {
  const d = diasHasta(iso);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  if (d > 0) return `en ${d} días`;
  return `hace ${Math.abs(d)} días`;
}
export function publicadoRelativo(iso) {
  const d = diasHasta(iso);
  if (d === 0) return 'Hoy';
  if (d === -1) return 'Ayer';
  if (d < 0) return `Hace ${Math.abs(d)} días`;
  return fechaLarga(iso);
}

export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
export const norm = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const unicos = (arr) =>
  [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
