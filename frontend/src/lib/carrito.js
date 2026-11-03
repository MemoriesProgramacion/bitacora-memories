// Ayudas del carrito de compras: estados, textos del historial, comité, plan de negocio, pesos y plantillas.
import { ROLES as NOMBRE_ROL } from '../admin/etiquetas';

// Nombre y color de cada estado del carrito: borrador, enviado, revisado, viable, aprobado, en compra y
// entregado.
export const ESTADOS_CARRITO = {
  borrador: { texto: 'Borrador', tono: 'neutro' },
  enviado: { texto: 'Enviado a revisión', tono: 'alerta' },
  devuelto: { texto: 'Devuelto para corregir', tono: 'error' },
  revisado: { texto: 'Revisado por la coordinación', tono: 'alerta' },
  viable: { texto: 'Viable: espera el comité', tono: 'alerta' },
  en_subsanacion: { texto: 'En subsanación', tono: 'error' },
  subsanado: { texto: 'Subsanado: espera el comité', tono: 'alerta' },
  aprobado: { texto: 'Aprobado por el comité', tono: 'ok' },
  en_compra: { texto: 'En compra', tono: 'ok' },
  entregado: { texto: 'Entregado', tono: 'ok' },
};
export const ORDEN_CICLO = ['borrador', 'enviado', 'revisado', 'viable', 'aprobado', 'en_compra', 'entregado'];
// Estados aprobados por el comité, los mismos del servidor.
export const APROBADOS = ['aprobado', 'en_compra', 'entregado'];

// Devuelve el texto del plazo de la subsanación, como hasta el 2026-10-16 o venció el 2026-10-16.
export function textoSubsanacion(s) {
  if (!s?.plazo) return '';
  return s.vencida ? `La subsanación venció el ${s.plazo}: la coordinación debe reabrirla.` : `Plazo para subsanar: hasta el ${s.plazo} (4 días hábiles).`;
}

// Devuelve el día de Colombia de una fecha ISO, porque el servidor guarda en UTC, o vacío si no se puede leer.
export function diaColombia(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

const rolDeHistorial = (h) => (h.es_datos ? NOMBRE_ROL.coordinador_datos : h.general ? NOMBRE_ROL.superadmin : NOMBRE_ROL[h.rol] || h.rol);

// Devuelve una línea del historial del plan con el cambio de estado, quién lo hizo y la fecha.
export function textoHistorial(h) {
  const nombre = (e) => ESTADOS_CARRITO[e]?.texto || e;
  const cambio = h.de === h.a ? nombre(h.a) : `${nombre(h.de)} → ${nombre(h.a)}`;
  const rol = rolDeHistorial(h);
  return `${cambio} · ${h.por}${rol ? ` (${rol})` : ''} · ${diaColombia(h.en)}${h.motivo ? ` · ${h.motivo}` : ''}`;
}

// Calcula el promedio del comité como el servidor: 3 calificaciones de 1 a 5, y 3 o más aprueba; null si falta
// alguna.
export function promedioComite(calificaciones) {
  const xs = (calificaciones || []).map((x) => (x === '' || x == null ? NaN : Number(x)));
  if (xs.length !== 3 || xs.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) return null;
  const promedio = Math.round((xs.reduce((a, n) => a + n, 0) / 3) * 100) / 100;
  return { promedio, aprobado: promedio >= 3 };
}

// Entidades del comité: 2 personas de Prosperidad Social y 1 de INNPULSA.
export const ENTIDADES_COMITE = ['Prosperidad Social', 'INNPULSA'];
export function integrantesValidos(lista) {
  const xs = lista || [];
  return xs.length === 3 && xs.every((x) => x.nombre?.trim() && ENTIDADES_COMITE.includes(x.entidad))
    && xs.filter((x) => x.entidad === 'Prosperidad Social').length === 2;
}

// Devuelve las columnas del Excel de legalización por unidad.
export function columnasLegalizacion() {
  return [
    { titulo: 'ID único', valor: (f) => f.id_unico, ancho: 14 },
    { titulo: 'Unidad productiva', valor: (f) => f.nombre, ancho: 30 },
    { titulo: 'Región', valor: (f) => f.region, ancho: 14 },
    { titulo: 'Nodo', valor: (f) => f.nodo, ancho: 10 },
    { titulo: 'Estado del plan', valor: (f) => f.nombre_estado, ancho: 22 },
    { titulo: 'Total del plan', valor: (f) => f.total_plan, ancho: 16 },
    { titulo: 'Total facturado', valor: (f) => f.total_facturado, ancho: 16 },
    { titulo: 'Diferencia', valor: (f) => f.diferencia, ancho: 14 },
    { titulo: '% legalizado', valor: (f) => f.porcentaje ?? '', ancho: 12 },
    { titulo: 'Facturas', valor: (f) => f.facturas.map((x) => `${x.numero} (${x.fecha})`).join(', '), ancho: 40 },
  ];
}

// Calcula cuánto del presupuesto lleva gastado y de qué color se pinta la barra.
export function consumo(resumen) {
  const tope = resumen.presupuesto_productos;
  if (tope === null || tope === undefined || tope <= 0) return { pct: 0, color: 'var(--graf-azul)' };
  const pct = resumen.total / tope;
  const color = pct > 1 ? 'var(--color-rojo)' : pct >= 0.85 ? 'var(--color-acento)' : 'var(--color-ok)';
  return { pct, color };
}

// Campos del plan de mercadeo dentro del plan de negocio, las mismas claves del servidor.
export const CAMPOS_MERCADEO = [
  { clave: 'segmento', nombre: 'Segmento de clientes' },
  { clave: 'canales', nombre: 'Canales de venta' },
  { clave: 'precio', nombre: 'Estrategia de precio' },
  { clave: 'promocion', nombre: 'Promoción y comunicación' },
  { clave: 'distribucion', nombre: 'Distribución del producto' },
];

// Convierte el plan de negocio del servidor en formulario, con una fila vacía donde no hay nada para poder
// escribir.
export function planAFormulario(plan, dimensiones = []) {
  const p = plan || {};
  const textos = (xs) => (xs?.length ? [...xs] : ['']);
  const f = { propuesta_valor: p.propuesta_valor || '', asistencia_tecnica: textos(p.asistencia_tecnica),
    mercadeo: Object.fromEntries(CAMPOS_MERCADEO.map((c) => [c.clave, p.mercadeo?.[c.clave] || ''])) };
  for (const d of dimensiones) f[d.clave] = textos(p[d.clave]);
  f.plan_accion = p.plan_accion?.length ? p.plan_accion.map((x) => ({ ...x })) : [{ accion: '', responsable: '', fecha: '' }];
  f.riesgos = p.riesgos?.length ? p.riesgos.map((x) => ({ ...x })) : [{ riesgo: '', nivel: '', mitigacion: '' }];
  return f;
}

// Convierte el formulario en lo que se envía, sin líneas en blanco ni filas vacías.
export function formularioAPlan(f, dimensiones = []) {
  const textos = (xs) => (xs || []).map((x) => x.trim()).filter(Boolean);
  const plan = { propuesta_valor: (f.propuesta_valor || '').trim(), asistencia_tecnica: textos(f.asistencia_tecnica),
    mercadeo: Object.fromEntries(CAMPOS_MERCADEO.map((c) => [c.clave, String(f.mercadeo?.[c.clave] || '').trim()])) };
  for (const d of dimensiones) plan[d.clave] = textos(f[d.clave]);
  plan.plan_accion = (f.plan_accion || []).map((x) => ({ accion: x.accion.trim(), responsable: x.responsable.trim(), fecha: x.fecha }))
    .filter((x) => x.accion || x.responsable || x.fecha);
  plan.riesgos = (f.riesgos || []).map((x) => ({ riesgo: x.riesgo.trim(), nivel: x.nivel, mitigacion: x.mitigacion.trim() }))
    .filter((x) => x.riesgo || x.nivel || x.mitigacion);
  return plan;
}

// Devuelve el texto del transporte según la modalidad: en M1 es una bolsa aparte; en M2 a M4 va incluido o a
// cargo del beneficiario.
export function textoTransporte(resumen, c) {
  if (resumen?.modalidad === 'M1') return `Bolsa de transporte de M1 (aparte del tope): ${pesosTexto(resumen.transporte_m1)}`;
  return c?.transporte_descontado ? `Incluido en la capitalización: ${pesosTexto(resumen?.transporte)}` : 'Asumido por el beneficiario';
}
const pesosTexto = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

// Devuelve lo que falta para una acción: enviar, que exige lo del plan, o aprobar, que además exige
// cotizaciones, evaluación y firma.
export function problemasPara(clasificacion, accion) {
  const envio = clasificacion?.problemas_envio || [];
  return accion === 'aprobar' ? [...envio, ...(clasificacion?.problemas_aprobacion || [])] : envio;
}

// Convierte un valor escrito a la colombiana en el texto que espera el servidor, o null si no se puede leer sin
// ambigüedad.
export function valorPesos(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const conMiles = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
  const sinMiles = /^\d+(,\d{1,2})?$/;
  if (!conMiles.test(t) && !sinMiles.test(t)) return null;
  const limpio = t.replace(/\./g, '').replace(',', '.');
  return Number(limpio) > 0 && limpio.split('.')[0].length <= 10 ? limpio : null;
}

// Devuelve cuántas cotizaciones de proveedores distintos tiene una línea frente a las exigidas.
export function avanceCotizaciones(linea, minimo = 3) {
  const n = new Set((linea?.cotizaciones || []).map((c) => c.id_proveedor)).size;
  return { n, minimo, completo: n >= minimo && (linea?.cotizaciones || []).some((c) => c.elegida) };
}

// Plantilla en CSV que la coordinación descarga para armar el catálogo.
export const PLANTILLA_CATALOGO = [
  'Código;Nombre;Precio;IVA;Tipología;Sector;Proceso;Tipo;Descripción;UNSPSC;Rubro;No financiable',
  'HOR-001;Horno industrial de 2 cámaras;4500000;19;Panadería;Alimentos;Producción;Equipo;Horno a gas con termostato;;dotacion_maquinaria;',
  'BAN-010;Bandeja de aluminio;45000;19;Panadería;Alimentos;Producción;Utensilio;;dotacion_maquinaria;',
].join('\r\n');

// Plantilla del catálogo de clases UNSPSC, solo con la forma, porque los datos reales los carga el equipo.
export const PLANTILLA_UNSPSC = ['Código;Nombre', '101015;Animales de granja'].join('\r\n');
