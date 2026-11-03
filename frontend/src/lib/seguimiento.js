// Seguimiento, indicadores y reportes: cómo presenta la pantalla lo que calcula el servidor y lo que comprueba
// antes de enviar. Las reglas y los permisos los aplica el servidor.
import { diaColombia } from './carrito';

const GENERALES = ['superadmin', 'coordinador_datos'];

// Devuelve las pestañas de seguimiento que abre cada tipo de cuenta, las mismas que el servidor le contesta.
export function pestanasSeguimiento(session) {
  const rol = session?.role;
  const coordinacion = GENERALES.includes(rol) || rol === 'coordinador';
  const detalle = coordinacion || ['tecnico_administrativo', 'coordinador_compras'].includes(rol);
  const p = [];
  if (detalle) p.push('panel');
  if (detalle) p.push('ruta', 'alertas', 'formacion', 'salida');
  if (detalle) p.push('informes', 'metas');
  if (detalle || rol === 'gestor') p.push('casos', 'comercial');
  if (coordinacion || rol === 'tecnico_administrativo') p.push('multimedia');
  return p;
}
export const esGeneralSeg = (session) => GENERALES.includes(session?.role);

// Devuelve la pestaña a la que lleva una tecla de la barra de pestañas, como flechas, Inicio y Fin, o null si
// la tecla no mueve.
export function pestanaPorTecla(ids = [], actual, tecla) {
  if (!ids.length) return null;
  const i = Math.max(ids.indexOf(actual), 0);
  if (tecla === 'ArrowRight') return ids[(i + 1) % ids.length];
  if (tecla === 'ArrowLeft') return ids[(i - 1 + ids.length) % ids.length];
  if (tecla === 'Home') return ids[0];
  if (tecla === 'End') return ids[ids.length - 1];
  return null;
}

// Protege contra respuestas viejas: cada llamada abre un pedido nuevo y devuelve una función que dice si sigue
// siendo el último, para ignorar lo que llegue tarde.
export function ultimoPedido() {
  let n = 0;
  return () => {
    n += 1;
    const mio = n;
    return () => mio === n;
  };
}

// Devuelve un porcentaje como 12,5 %, o un guion si no hay dato.
export function pct(n) {
  return Number.isFinite(n) ? `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %` : '—';
}

export const ESTADO_PROGRAMA = { en_programa: 'En el programa', no_habilitada: 'Sin habilitar', retirada: 'Retirada' };

// Devuelve Sí con la fecha, Sí o No para un paso de la ruta.
export function textoPaso(x) {
  if (!x?.logrado) return 'No';
  return x.fecha ? `Sí (${x.fecha})` : 'Sí';
}

// Devuelve las columnas del Excel de la ruta por unidad: los datos de la unidad y una columna por paso.
export function columnasRuta(pasos = []) {
  return [
    { titulo: 'ID único', valor: (f) => f.id_unico, ancho: 14 },
    { titulo: 'Unidad productiva', valor: (f) => f.nombre, ancho: 30 },
    { titulo: 'Región', valor: (f) => f.region, ancho: 14 },
    { titulo: 'Nodo', valor: (f) => f.nodo, ancho: 10 },
    { titulo: 'Departamento', valor: (f) => f.departamento, ancho: 16 },
    { titulo: 'Municipio', valor: (f) => f.municipio, ancho: 16 },
    { titulo: 'Modalidad', valor: (f) => f.modalidad, ancho: 10 },
    { titulo: 'Estado en el programa', valor: (f) => ESTADO_PROGRAMA[f.estado_programa] || f.estado_programa, ancho: 16 },
    { titulo: 'Avance', valor: (f) => `${f.avance} de ${f.de}`, ancho: 10 },
    ...[1, 2, 3].map((m) => ({ titulo: `Módulo ${m}`, valor: (f) => (f.modulos ? (f.modulos[m - 1] ? 'Sí' : 'No') : ''), ancho: 10 })),
    ...pasos.map((p) => ({ titulo: p.nombre, valor: (f) => (p.clave === 'formacion' && f.pasos[p.clave]?.porcentaje != null && !f.pasos[p.clave].logrado
      ? `No (${pct(f.pasos[p.clave].porcentaje)})` : textoPaso(f.pasos[p.clave])), ancho: 16 })),
  ];
}

// Filtra las filas de la ruta por texto, en ID, nombre o municipio, y por el paso pendiente.
export function filtrarRuta(items = [], { texto = '', pendiente = '' } = {}) {
  const t = String(texto).trim().toLowerCase();
  return items.filter((f) => (!t || [f.id_unico, f.nombre, f.municipio, f.nodo].some((v) => String(v || '').toLowerCase().includes(t)))
    && (!pendiente || (f.estado_programa === 'en_programa' && !f.pasos?.[pendiente]?.logrado)));
}

// La subsanación es una espera y no un paso cumplido, por eso el avance y el panel la muestran aparte.
const EN_ESPERA = ['subsanacion'];
const esEspera = (x) => Boolean(x?.pendiente) || EN_ESPERA.includes(x?.clave);
// Separa el resumen de la ruta del panel en pasos cumplidos y esperas.
export function separarRuta(ruta = []) {
  return { pasos: ruta.filter((x) => !esEspera(x)), espera: ruta.filter(esEspera) };
}

export const NIVEL_ALERTA = { alta: 'error', media: 'alerta' };

// Devuelve el título de una tarjeta de alerta: la unidad, el nodo o, si no hay ninguno, lo que es la alerta.
export function tituloAlerta(a = {}) {
  if (a.unidad) return a.id_unico ? `${a.id_unico} · ${a.unidad}` : a.unidad;
  if (a.id_unico) return a.id_unico;
  if (a.tipo === 'defectuoso_abierto') return 'Acta sin unidad asociada';
  if (a.nodo) return `Nodo ${a.nodo}`;
  return a.nombre_tipo || 'Alerta';
}

// Devuelve las columnas del Excel de alertas.
export function columnasAlertas() {
  return [
    { titulo: 'Alerta', valor: (a) => a.nombre_tipo, ancho: 40 },
    { titulo: 'Nivel', valor: (a) => a.nivel, ancho: 8 },
    { titulo: 'ID único', valor: (a) => a.id_unico || '', ancho: 14 },
    { titulo: 'Unidad productiva', valor: (a) => a.unidad || '', ancho: 30 },
    { titulo: 'Región', valor: (a) => a.region || '', ancho: 14 },
    { titulo: 'Nodo', valor: (a) => a.nodo || '', ancho: 10 },
    { titulo: 'Detalle', valor: (a) => a.detalle, ancho: 50 },
    { titulo: 'Desde', valor: (a) => a.desde || '', ancho: 12 },
  ];
}

// Devuelve las columnas del Excel del reporte del 80 %.
export function columnasFormacion() {
  return [
    { titulo: 'ID único', valor: (f) => f.id_unico, ancho: 14 },
    { titulo: 'Unidad productiva', valor: (f) => f.nombre, ancho: 30 },
    { titulo: 'Región', valor: (f) => f.region, ancho: 14 },
    { titulo: 'Nodo', valor: (f) => f.nodo, ancho: 10 },
    { titulo: 'Modalidad', valor: (f) => f.modalidad, ancho: 10 },
    { titulo: 'Taller', valor: (f) => f.taller, ancho: 30 },
    { titulo: '% de formación', valor: (f) => f.porcentaje, ancho: 12 },
    { titulo: 'Cumple el 80 %', valor: (f) => (f.cumple ? 'Sí' : 'No'), ancho: 12 },
    { titulo: 'Taller terminado', valor: (f) => (f.taller_terminado ? 'Sí' : 'No'), ancho: 12 },
  ];
}

// Devuelve los últimos n meses AAAA-MM hasta el de hoy, del más reciente al más antiguo.
export function periodosRecientes(hoy, n = 12) {
  let [a, m] = String(hoy).slice(0, 7).split('-').map(Number);
  const xs = [];
  for (let i = 0; i < n && a && m; i += 1) {
    xs.push(`${a}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return xs;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Convierte 2026-10 en octubre de 2026.
export function nombrePeriodo(p) {
  const [a, m] = String(p || '').split('-').map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} de ${a}` : String(p || '');
}

// Devuelve las columnas del Excel del consolidado mensual, como las arma el servidor.
export function columnasConsolidado(c) {
  return [
    { titulo: 'Región', valor: (g) => g.region, ancho: 14 },
    { titulo: 'Departamento', valor: (g) => g.departamento, ancho: 16 },
    { titulo: 'Modalidad', valor: (g) => g.modalidad, ancho: 10 },
    { titulo: 'Unidades en el programa', valor: (g) => g.unidades, ancho: 12 },
    ...Object.entries(c?.metricas_mes || {}).map(([k, v]) => ({ titulo: `${v} (mes)`, valor: (g) => g.periodo[k], ancho: 14 })),
    ...Object.entries(c?.metricas_acumulado || {}).map(([k, v]) => ({ titulo: `${v} (acumulado)`, valor: (g) => g.acumulado[k], ancho: 14 })),
  ];
}

// Devuelve las columnas del Excel de intercambio con KOKAN, con el nombre de cada campo del diccionario en su
// orden.
export function columnasKokan(diccionario = []) {
  return diccionario.map((c) => ({ titulo: c.campo, valor: (f) => f[c.campo] ?? '', ancho: Math.max(12, c.campo.length + 2) }));
}

// Devuelve una celda de CSV entre comillas si lleva separador, comillas o saltos, y antepone un apóstrofo a lo
// que empieza como fórmula.
function celdaCsv(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// Devuelve el archivo de intercambio en CSV separado por punto y coma, con BOM para que Excel lea las tildes.
export function csvKokan(items = [], diccionario = []) {
  const campos = diccionario.map((c) => c.campo);
  const lineas = [campos.join(';'), ...items.map((f) => campos.map((k) => celdaCsv(f[k])).join(';'))];
  return `﻿${lineas.join('\r\n')}\r\n`;
}

// Valida las fechas del rango de KOKAN, vacías o AAAA-MM-DD con desde menor o igual a hasta, y devuelve el
// mensaje del problema o vacío.
export function problemaRango(desde, hasta) {
  const ok = (x) => !x || /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (!ok(desde) || !ok(hasta)) return 'Las fechas deben ser AAAA-MM-DD.';
  if (desde && hasta && desde > hasta) return 'La fecha inicial no puede ser posterior a la final.';
  return '';
}

export const MODALIDADES = ['M1', 'M2', 'M3', 'M4'];
export const TOTAL_PROGRAMA = 6334;
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Devuelve lo que falta o está mal en la lista de metas antes de guardarla.
export function problemasMetas(filas = []) {
  const p = [];
  const vistas = new Set();
  filas.forEach((f, i) => {
    const n = `Fila ${i + 1}:`;
    if (!String(f.region || '').trim()) p.push(`${n} falta la región.`);
    if (!MODALIDADES.includes(f.modalidad)) p.push(`${n} elige la modalidad.`);
    if (!/^\d+$/.test(String(f.meta ?? '').trim())) p.push(`${n} la meta debe ser un número entero de 0 en adelante.`);
    const k = [f.region, f.modalidad, f.departamento].map(normal).join('|');
    if (vistas.has(k)) p.push(`${n} está repetida.`);
    vistas.add(k);
  });
  return p;
}

// Suma las metas por región y modalidad; las de departamento son un desglose y no se suman.
export function totalMetas(filas = []) {
  return filas.filter((f) => !String(f.departamento || '').trim()).reduce((a, f) => a + (Number.parseInt(f.meta, 10) || 0), 0);
}

// Devuelve lo que se envía al servidor: los textos sin espacios de más y la meta como número.
export function metasParaEnviar(filas = []) {
  return filas.map((f) => ({ region: String(f.region || '').trim(), modalidad: f.modalidad, departamento: String(f.departamento || '').trim(), meta: Number.parseInt(f.meta, 10) }));
}

export const TIPOS_CASO = { exito: 'Caso de éxito', buena_practica: 'Buena práctica', leccion: 'Lección aprendida' };
export const TIPOS_GESTION = {
  visita_comercial: 'Visita comercial', oferta_complementaria: 'Oferta complementaria', conexion_mercados: 'Conexión a mercados',
  cliente: 'Cliente captado o fidelizado', distribucion: 'Canal de distribución',
};
// Gestiones con un tercero, que exigen su nombre.
export const GESTION_CON_ENTIDAD = ['cliente', 'conexion_mercados', 'oferta_complementaria'];
export const MAX_FOTOS_CASO = 10;
const esPdf = (a) => /\.pdf$/i.test(a?.name || '');
const esImagen = (a) => /\.(jpe?g|png)$/i.test(a?.name || '');

// Devuelve lo que falta para registrar un caso: fotos JPG o PNG y documento PDF opcional.
export function faltasCaso(f, { fotos = [], documento = null } = {}, hoy = '') {
  const faltas = [];
  if (!f.id_unico) faltas.push('Elige la unidad.');
  if (!TIPOS_CASO[f.tipo]) faltas.push('Elige el tipo.');
  if (!String(f.titulo || '').trim()) faltas.push('Escribe el título.');
  if (!String(f.descripcion || '').trim()) faltas.push('Escribe la descripción.');
  if (!f.fecha) faltas.push('Pon la fecha.');
  else if (hoy && f.fecha > hoy) faltas.push('La fecha no puede ser futura.');
  if (fotos.length > MAX_FOTOS_CASO) faltas.push(`Máximo ${MAX_FOTOS_CASO} fotos.`);
  if (fotos.some((x) => !esImagen(x))) faltas.push('Las fotos deben ser JPG o PNG.');
  if (documento && !esPdf(documento)) faltas.push('El documento debe ser un PDF.');
  return faltas;
}

// Devuelve lo que falta para registrar una gestión comercial, con soporte PDF, JPG o PNG opcional.
export function faltasGestion(f, soporte = null, hoy = '') {
  const faltas = [];
  if (!f.id_unico) faltas.push('Elige la unidad.');
  if (!TIPOS_GESTION[f.tipo]) faltas.push('Elige el tipo de gestión.');
  if (!f.fecha) faltas.push('Pon la fecha.');
  else if (hoy && f.fecha > hoy) faltas.push('La fecha no puede ser futura.');
  if (!String(f.descripcion || '').trim()) faltas.push('Describe la gestión.');
  if (GESTION_CON_ENTIDAD.includes(f.tipo) && !String(f.entidad || '').trim()) faltas.push('Escribe la entidad, el aliado o el cliente.');
  if (soporte && !esPdf(soporte) && !esImagen(soporte)) faltas.push('El soporte debe ser PDF, JPG o PNG.');
  return faltas;
}

// Agrupa los soportes por serie, en el orden de las series del servidor.
export function porSerie(items = [], series = {}) {
  return Object.entries(series).map(([clave, nombre]) => ({ clave, nombre, items: items.filter((x) => x.serie === clave) }))
    .filter((g) => g.items.length);
}

// Devuelve las columnas del Excel del expediente de una unidad: cada soporte con su serie, metadatos y
// verificación.
export function columnasSoportes() {
  return [
    { titulo: 'Serie', valor: (x) => x.nombre_serie, ancho: 16 },
    { titulo: 'Tipo de soporte', valor: (x) => x.tipo, ancho: 36 },
    { titulo: 'Archivo', valor: (x) => x.nombre || '', ancho: 30 },
    { titulo: 'Fecha de carga', valor: (x) => (x.fecha ? diaColombia(x.fecha) : ''), ancho: 14 },
    { titulo: 'Cargó', valor: cargoDe, ancho: 20 },
    { titulo: 'Versiones anteriores', valor: (x) => x.versiones || 0, ancho: 12 },
    { titulo: 'Verificado por', valor: (x) => x.verificacion?.verificado_por || '', ancho: 20 },
    { titulo: 'Verificado el', valor: (x) => (x.verificacion ? diaColombia(x.verificacion.verificado_en) : ''), ancho: 14 },
    { titulo: 'Observación', valor: (x) => x.verificacion?.observacion || '', ancho: 30 },
  ];
}

// Devuelve quién cargó el soporte, o vacío si no se sabe; un valor que es solo un número se toma como cédula y
// no se muestra como nombre.
export function cargoDe(x) {
  const v = String(x?.subido_por ?? '').trim();
  return /^[\d.\s-]+$/.test(v) ? '' : v;
}

// Devuelve el texto de una versión anterior, como cargada el 2026-10-01 por Ana y reemplazada el 2026-10-20 por
// Luis.
export function textoVersion(v) {
  const quien = (x) => cargoDe({ subido_por: x });
  const cargada = [v?.fecha ? `cargada el ${diaColombia(v.fecha)}` : 'cargada', quien(v?.subido_por) ? `por ${quien(v.subido_por)}` : null].filter(Boolean).join(' ');
  const reemplazada = v?.reemplazado_en ? [`reemplazada el ${diaColombia(v.reemplazado_en)}`, quien(v.reemplazado_por) ? `por ${quien(v.reemplazado_por)}` : null].filter(Boolean).join(' ') : null;
  return [cargada, reemplazada].filter(Boolean).join(' · ');
}

// Devuelve el texto de un soporte con su fecha y quién lo cargó, si se sabe.
export function textoSoporte(x) {
  return [x.fecha ? diaColombia(x.fecha) : null, cargoDe(x)].filter(Boolean).join(' · ');
}
