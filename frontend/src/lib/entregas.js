// Entregas, lista de compras y cronograma. Los tres apartados de la sección de entregas solo hablan con este
// archivo. La lista de compras lee y escribe la tabla items_ups, con un documento por unidad, y las entregas
// usan la tabla entregas_ups; la fecha, el estado y la ruta salen del cargue de compras y de lo que confirma
// quien atiende la unidad.
import {
  ENTREGAS_URL, ENTREGA_URL, ENTREGA_ACTA_URL, ENTREGA_REVISION_URL, ITEMS_UPS_URL, ITEM_UP_URL, SIN_DATOS, FETCH_TIMEOUT,
} from './config';
import { fetchApi } from './api';

// Estados de una entrega: los primeros vienen del Excel y el resto resulta de cruzar la fecha programada con lo
// que hizo la cuenta de campo.
export const ESTADOS_HORA = {
  programada:   { label: 'Programada',          tono: 'espera' },
  confirmada:   { label: 'Confirmada',          tono: 'bueno' },
  acta_revision:{ label: 'Reagendamiento en revisión', tono: 'espera' },
  solicitud:    { label: 'En reagendamiento',   tono: 'malo' },
  reagendada:   { label: 'Reagendada',          tono: 'espera' },
  entregada:    { label: 'Entregada',           tono: 'bueno' },
  parcial:      { label: 'Entrega parcial',     tono: 'malo' },
  no_entregada: { label: 'No entregada',        tono: 'malo' },
  sin_fecha:    { label: 'Sin fecha',           tono: 'vacio' },
};

// Indica si la cuenta de campo puede tocar la entrega: tiene fecha, no espera un reagendamiento y todavía no se
// entregó.
export function editablePorGestor(entrega) {
  return ['programada', 'confirmada', 'reagendada'].includes(entrega?.estado_hora);
}

// Calcula el semáforo del proceso de entrega.
export function semaforoEntrega(lista, entrega) {
  const p = progresoLista(lista);
  const est = entrega?.estado_hora;
  if (est === 'entregada' || lista?.logistica?.entregado === true) return { tono: 'bueno', label: 'Entregada' };
  if (est === 'parcial') return { tono: 'malo', label: 'Entrega parcial' };
  if (lista?.logistica?.despachado === true) return { tono: 'espera', label: 'Despachada' };
  if (est === 'confirmada') return { tono: 'bueno', label: 'Entrega confirmada' };
  if (est === 'acta_revision') return { tono: 'espera', label: 'Reagendamiento en revisión' };
  if (est === 'solicitud')  return { tono: 'malo',  label: 'En reagendamiento' };
  if (entrega?.fecha_programada) return { tono: 'espera', label: 'Entrega programada' };
  if (!lista || !p.total)   return { tono: 'vacio', label: 'Sin iniciar' };
  if (p.hechos === p.total) return { tono: 'espera', label: 'Lista completa' };
  if (p.hechos === 0)       return { tono: 'vacio', label: 'Sin comprar' };
  return { tono: 'malo', label: `Comprando ${p.hechos}/${p.total}` };
}

// Indica si la unidad ya pasó a la etapa de entrega: programada, confirmada, en reagendamiento, despachada o
// entregada.
export function listaParaEntrega(lista, entrega) {
  return !!(entrega?.fecha_programada
    || ['confirmada', 'acta_revision', 'solicitud', 'reagendada', 'entregada', 'parcial'].includes(entrega?.estado_hora)
    || lista?.logistica?.despachado === true || lista?.logistica?.entregado === true);
}

// Calcula el semáforo del cargue de documentos que reporta el validador: sin cargar, cargados en revisión y
// validados.
export function semaforoDocumentos(estado) {
  if (estado === 'aprobado' || estado === 'validado') {
    return { tono: 'bueno', label: 'Documentos validados' };
  }
  if (estado === 'correcciones') return { tono: 'malo', label: 'Con correcciones' };
  if (estado === 'revision' || estado === 'pendiente') {
    return { tono: 'espera', label: 'Cargados, en revisión' };
  }
  return { tono: 'vacio', label: 'Sin cargar' };
}

export function semaforoLista(lista) {
  return semaforoEntrega(lista, null);
}

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function soloFecha(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

export function fechaLarga(iso) {
  if (!iso) return '—';
  const [a, m, d] = soloFecha(iso).split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  return fecha.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function fechaCorta(iso) {
  if (!iso) return '—';
  const [a, m, d] = soloFecha(iso).split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  return fecha.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Suma días a una fecha AAAA-MM-DD.
export function sumarDias(iso, n) {
  const [a, m, d] = soloFecha(iso).split('-').map(Number);
  const dt = new Date(a, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function inicioSemana(iso) {
  const [a, m, d] = soloFecha(iso).split('-').map(Number);
  const offset = (new Date(a, m - 1, d).getDay() + 6) % 7;
  return sumarDias(iso, -offset);
}

export function inicioMes(iso) {
  const [a, m] = soloFecha(iso).split('-').map(Number);
  return `${a}-${String(m).padStart(2, '0')}-01`;
}

export function finMes(iso) {
  const [a, m] = soloFecha(iso).split('-').map(Number);
  const d = new Date(a, m, 0).getDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Devuelve los lapsos rápidos a partir de hoy, cada uno con desde, hasta y etiqueta.
export function lapsosRapidos() {
  const hoy = hoyISO();
  const inicioSem = inicioSemana(hoy);
  const mesPasadoRef = sumarDias(inicioMes(hoy), -1);
  return [
    { id: 'semana',      etiqueta: 'Esta semana',    desde: inicioSem,          hasta: sumarDias(inicioSem, 6) },
    { id: 'mes',         etiqueta: 'Este mes',       desde: inicioMes(hoy),     hasta: finMes(hoy) },
    { id: 'prox7',       etiqueta: 'Próximos 7 días', desde: hoy,               hasta: sumarDias(hoy, 7) },
    { id: 'prox30',      etiqueta: 'Próximos 30 días', desde: hoy,              hasta: sumarDias(hoy, 30) },
    { id: 'mespasado',   etiqueta: 'Mes anterior',   desde: inicioMes(mesPasadoRef), hasta: finMes(mesPasadoRef) },
    { id: 'atrasadas',   etiqueta: 'Atrasadas',      desde: null,               hasta: sumarDias(hoy, -1) },
  ];
}

// Indica si una fecha cae dentro de un lapso, con ambos límites incluidos.
export function enLapso(iso, lapso) {
  const d = soloFecha(iso);
  if (!d || !lapso) return true;
  if (lapso.desde && d < lapso.desde) return false;
  if (lapso.hasta && d > lapso.hasta) return false;
  return true;
}

export function progresoLista(lista) {
  if (!lista) return { hechos: 0, total: 0, pct: 0 };
  let hechos; let total;
  if (Array.isArray(lista.items)) {
    total = lista.items.length;
    hechos = lista.items.filter((i) => i.comprado).length;
  } else {
    total = lista.total_items || 0;
    hechos = lista.items_comprados || 0;
  }
  if (!total) return { hechos: 0, total: 0, pct: 0 };
  return { hechos, total, pct: Math.round((hechos / total) * 100) };
}

function txt(v) {
  return v === undefined || v === null || v === SIN_DATOS ? '' : String(v);
}

// Devuelve el resumen de todas las unidades que tienen plan de compras, con total de ítems, comprados, marcados
// y la logística.
export async function listarListasCompra(session) {
  const r = await fetchApi(ITEMS_UPS_URL, { token: session?.token });
  return (r.items || []).map((x) => ({
    ...x,
    ID_unico: String(x.id_unico ?? x.id),
    items_comprados: x.items_comprados || 0,
  }));
}

// Convierte una sección del cargue en un objeto campo y texto sin vacíos.
function seccionMaster(s) {
  if (!s || typeof s !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === true) out[k] = 'Sí';
    else if (v === false) out[k] = 'No';
    else if (txt(v)) out[k] = txt(v);
  }
  return out;
}

// Convierte el documento de items_ups en la forma que pinta la pantalla.
function adaptarLista(doc, up) {
  const log = doc.logistica || {};
  const ficha = (f = {}) => Object.fromEntries(
    Object.entries(f).map(([k, v]) => [k, txt(v)]).filter(([, v]) => v),
  );
  return {
    id: doc.id,
    ID_unico: String(doc.id_unico ?? doc.id),
    nodo: doc.nodo,
    nodo_id: doc.nodo,
    unidad_nombre: up?.unidad_nombre || txt(doc.unidad_nombre),
    departamento: txt(doc.departamento),
    municipio: txt(doc.municipio),
    modalidad: txt(doc.modalidad),
    aprobacion: doc.aprobacion || {},
    resumen: doc.resumen || {},
    fecha_actualizacion: doc.fecha_actualizacion,
    actualizado_por: doc.actualizado_por || '',
    ultimo_cargue: doc.ultimo_cargue || null,
    master: {
      cronograma: seccionMaster(doc.cronograma),
      ruta: seccionMaster(doc.ruta),
      entrega: seccionMaster(doc.entrega),
    },
    logistica: {
      comprado: log.comprado === true,
      alistamiento: log.alistamiento === true,
      despachado: log.despachado === true,
      entregado: log.entregado === true,
      tipo_novedad: txt(log.tipo_novedad),
      descripcion_novedad: txt(log.descripcion_novedad),
      observaciones: txt(log.observaciones),
    },
    items: (doc.items || []).map((it, idx) => ({
      id: String(idx),
      idx,
      item_n: it.item_n,
      nombre: txt(it.nombre_carrito_actual) || txt(it.nombre_solicitado) || `Ítem ${it.item_n ?? idx + 1}`,
      nombre_solicitado: txt(it.nombre_solicitado),
      codigo: txt(it.codigo_actual),
      tipo: txt(it.tipo_segun_carrito),
      actividad: txt(it.item_por_actividad),
      cantidad: it.cantidad,
      precio: it.precio_solicitado,
      total: it.total,
      ficha: ficha(it.ficha_tecnica),
      compra: it.compra || null,
      comprado: it.compra?.comprado === true,
    })),
  };
}

export async function obtenerListaCompra(up, session) {
  const r = await fetchApi(ITEM_UP_URL, {
    token: session?.token, params: { id: String(up.ID_unico) },
  });
  return adaptarLista(r.item, up);
}

// Guarda el avance de la lista: marcas por ítem y logística; el servidor marca comprado solo si todos los ítems
// lo están.
export async function guardarListaCompra(lista, session) {
  const cuerpo = {
    id: lista.id,
    compras: lista.items.map((i) => ({ idx: i.idx, item_n: i.item_n, comprado: !!i.comprado })),
    logistica: { ...lista.logistica },
  };
  delete cuerpo.logistica.comprado;
  const r = await fetchApi(ITEM_UP_URL, { token: session?.token, metodo: 'POST', cuerpo });
  return adaptarLista(r.item, { unidad_nombre: lista.unidad_nombre });
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve la fecha que manda, igual que el servidor: la efectiva si ya se entregó o, si no, la vigente, la
// reprogramada o la programada.
export function fechaProgramada(doc = {}) {
  for (const k of ['excel_fecha_entrega_efectiva', 'excel_fecha_entrega_vigente',
    'excel_fecha_reprogramada', 'excel_fecha_programada']) {
    const v = soloFecha(txt(doc[k]));
    if (ISO.test(v)) return v;
  }
  return '';
}

const norma = (v) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// Calcula el estado de una entrega a partir de su documento plano.
export function estadoEntrega(doc, fecha) {
  const prog = norma(doc.excel_estado_programacion);
  const ent = norma(doc.excel_estado_entrega);
  if (prog.includes('PARCIAL') || ent.includes('PARCIAL')) return 'parcial';
  if (prog.startsWith('NO ENTREGA') || ent.startsWith('NO ENTREGA')) return 'no_entregada';
  const efectiva = ISO.test(soloFecha(txt(doc.excel_fecha_entrega_efectiva)));
  if (prog === 'ENTREGADA' || ent === 'ENTREGADA' || ent.includes('COMPLETA') || efectiva) return 'entregada';
  if (doc.solicitud_en) return doc.solicitud_acta_estado === 'en_revision' ? 'acta_revision' : 'solicitud';
  if (!fecha) return 'sin_fecha';
  if (doc.gestor_confirmada_fecha === fecha) return 'confirmada';
  const reagendada = (doc.historial || []).some((h) => h.accion === 'reagendada' && h.fecha_nueva === fecha);
  return reagendada ? 'reagendada' : 'programada';
}

// Interpreta la hora que viene del Excel.
export function horaDeExcel(texto) {
  const t = txt(texto).toLowerCase().replace(/a\.?\s*m\.?/, 'am').replace(/p\.?\s*m\.?/, 'pm');
  const m = /^(\d{1,2})(?![\d-])(?:\s*[:.\s]\s*(\d{2}))?(?::\d{2})?\s*(am|pm)?/.exec(t.trim());
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return '';
  if (m[3] === 'pm' && h < 12) h += 12;
  else if (m[3] === 'am' && h === 12) h = 0;
  else if (!m[3]) {
    if (h === 0) h = 12;
    else if (h >= 1 && h <= 5) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Devuelve la hora ya guardada en formato HH:MM de 24 horas sin volver a deducirla.
export function horaInput(texto) {
  const t = txt(texto).trim();
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/.exec(t);
  return m ? `${m[1]}:${m[2]}` : horaDeExcel(t);
}

// Convierte HH:MM en un texto como 9:30 a. m.; lo que no se reconozca como hora se devuelve tal cual.
export function horaLegible(texto) {
  const hhmm = horaInput(texto);
  if (!hhmm) return txt(texto);
  const [h, min] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

// Devuelve HH:MM para guardar lo que viene del Excel si se reconoce, o el texto tal cual.
export function horaParaGuardar(texto) {
  return horaDeExcel(texto) || txt(texto);
}

// Convierte el documento plano de la entrega en la forma que pintan las pantallas.
function adaptarEntrega(doc) {
  const fecha = fechaProgramada(doc);
  const conf = doc.gestor_confirmada_fecha ? {
    fecha: doc.gestor_confirmada_fecha, hora: doc.gestor_confirmada_hora,
    por: doc.gestor_confirmada_por, en: doc.gestor_confirmada_en,
  } : null;
  return {
    id: doc.id,
    ID_unico: String(doc.id_unico ?? doc.id),
    nodo: txt(doc.nodo),
    unidad_nombre: txt(doc.unidad_nombre),
    fecha_programada: fecha,
    estado_hora: estadoEntrega(doc, fecha),
    hora: conf?.fecha === fecha ? txt(conf.hora) : '',
    hora_excel: txt(doc.excel_ruta_hora_visita) || txt(doc.excel_hora_ruta),
    telefono: txt(doc.gestor_telefono) || txt(doc.excel_ruta_telefono_up),
    direccion: txt(doc.gestor_direccion) || txt(doc.excel_ruta_direccion_up) || txt(doc.excel_direccion),
    confirmacion: conf,
    solicitud_reagendamiento: doc.solicitud_en ? {
      motivo: txt(doc.solicitud_motivo),
      fecha_anterior: txt(doc.solicitud_fecha_anterior),
      fecha_sugerida: txt(doc.solicitud_fecha_sugerida),
      gestor: txt(doc.solicitud_por),
      solicitado_en: doc.solicitud_en,
      acta: txt(doc.solicitud_acta),
      acta_estado: txt(doc.solicitud_acta_estado),
      acta_revisado_por: txt(doc.solicitud_acta_revisado_por),
      acta_revisado_en: doc.solicitud_acta_revisado_en || null,
    } : null,
    historial: doc.historial || [],
    excel: {
      estado_programacion: txt(doc.excel_estado_programacion),
      estado_entrega: txt(doc.excel_estado_entrega),
      ruta: {
        ruta: txt(doc.excel_ruta),
        fecha: soloFecha(txt(doc.excel_ruta_fecha)),
        hora_visita: txt(doc.excel_ruta_hora_visita) || txt(doc.excel_hora_ruta),
        hora_salida: txt(doc.excel_ruta_hora_salida),
        punto_encuentro: txt(doc.excel_ruta_punto_encuentro),
        coordinador: txt(doc.excel_ruta_coordinador),
        telefono_coordinador: txt(doc.excel_ruta_telefono_coordinador),
        gestor_nombre: txt(doc.excel_ruta_gestor_nombre),
        telefono_gestor: txt(doc.excel_ruta_telefono_gestor),
        region: txt(doc.excel_ruta_region),
      },
    },
  };
}

export async function listarEntregas(session, { nodo } = {}) {
  const r = await fetchApi(ENTREGAS_URL, { token: session?.token, params: nodo ? { nodo_id: nodo } : {} });
  return (r.items || []).map(adaptarEntrega);
}

async function accionEntrega(entrega, accion, datos, session) {
  const r = await fetchApi(ENTREGA_URL, {
    token: session?.token, metodo: 'POST', cuerpo: { id: entrega.id, accion, ...datos },
  });
  return adaptarEntrega(r.item);
}

export function guardarContacto(entrega, { telefono, direccion }, session) {
  return accionEntrega(entrega, 'contacto', { telefono, direccion }, session);
}

// Confirma el teléfono, la dirección y la hora para la fecha programada.
export function confirmarHora(entrega, { telefono, direccion, hora }, session) {
  return accionEntrega(entrega, 'confirmar', { telefono, direccion, hora }, session);
}

// Tamaño máximo del acta de reagendamiento; reagendar exige el acta en PDF y la nueva fecha llega en el próximo
// cargue, que cierra la solicitud.
export const MAX_ACTA_MB = 10;

export function validarActa(archivo) {
  if (!archivo) return 'Adjunta el acta de reagendamiento en PDF.';
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name || '');
  if (!esPdf) return 'El acta debe ser un archivo PDF.';
  if (archivo.size > MAX_ACTA_MB * 1024 * 1024) return `El acta pesa más de ${MAX_ACTA_MB} MB.`;
  return '';
}

function aBase64(archivo) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',', 2)[1] || '');
    r.onerror = () => mal(new Error('No se pudo leer el acta.'));
    r.readAsDataURL(archivo);
  });
}

export async function solicitarReagendamiento(entrega, { motivo, fecha_sugerida, telefono, direccion, acta }, session) {
  const texto = String(motivo || '').trim();
  if (!texto) throw new Error('El motivo del reagendamiento es obligatorio.');
  const error = validarActa(acta);
  if (error) throw new Error(error);
  return accionEntrega(entrega, 'solicitar_reagendamiento',
    { motivo: texto, fecha_sugerida: fecha_sugerida || '', telefono, direccion, acta_pdf: await aBase64(acta) }, session);
}

// Abre el acta en otra pestaña; la ventana se abre en el clic porque si no el navegador la bloquea y se llena
// cuando llega el PDF.
export async function abrirActa(entrega, acta, session) {
  const ventana = window.open('', '_blank');
  try {
    const u = new URL(ENTREGA_ACTA_URL, window.location.origin);
    u.searchParams.set('id', entrega.id);
    if (acta) u.searchParams.set('acta', acta);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(u.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 401) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    if (!res.ok) throw new Error(res.status === 404 ? 'No se encontró el acta.' : `Error ${res.status} al abrir el acta.`);
    const url = URL.createObjectURL(await res.blob());
    if (ventana) ventana.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (ventana) ventana.close();
    throw e;
  }
}

// Devuelve las entregas que esperan nueva fecha.
export async function listarSolicitudes(session) {
  const todas = await listarEntregas(session);
  return todas.filter((e) => ['acta_revision', 'solicitud'].includes(e.estado_hora));
}

// Registra la revisión del acta: aprobar la pasa a reagendamiento y rechazar, con observación, cierra la
// solicitud y vuelve a la cuenta de campo.
export async function revisarActa(entrega, decision, observacion, session) {
  const obs = String(observacion || '').trim();
  if (decision === 'rechazar' && !obs) throw new Error('Escribe por qué se rechaza el acta.');
  const r = await fetchApi(ENTREGA_REVISION_URL, {
    token: session?.token, metodo: 'POST', cuerpo: { id: entrega.id, decision, observacion: obs },
  });
  return adaptarEntrega(r.item);
}

// Devuelve el último rechazo de acta posterior a la última solicitud, para avisar por qué volvió la entrega.
export function rechazoVigente(entrega) {
  const h = entrega?.historial || [];
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].accion === 'acta_rechazada') return entrega.solicitud_reagendamiento ? null : h[i];
    if (['solicitar_reagendamiento', 'confirmar', 'reagendada'].includes(h[i].accion)) return null;
  }
  return null;
}

// Devuelve la hora con la que se ordena la ruta del día: la confirmada y, si no hay, la del cargue.
export function horaDeEntrega(e) {
  return horaInput(e?.hora) || horaInput(e?.excel?.ruta?.hora_visita) || horaInput(e?.hora_excel);
}

// Agrupa las entregas por día para pintar el calendario, ordenadas por hora y con las que no tienen hora al
// final.
export function porDia(entregas) {
  const mapa = {};
  entregas.forEach((e) => {
    const d = soloFecha(e.fecha_programada);
    if (!d) return;
    (mapa[d] = mapa[d] || []).push(e);
  });
  Object.values(mapa).forEach((lista) => lista.sort((x, y) => (
    (horaDeEntrega(x) || '99').localeCompare(horaDeEntrega(y) || '99')
    || String(x.unidad_nombre || '').localeCompare(String(y.unidad_nombre || ''), 'es')
  )));
  return mapa;
}
