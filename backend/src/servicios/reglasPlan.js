// Reglas del plan de capitalización, como funciones puras que usan carrito.js y planCapitalizacion.js: tope de
// presupuesto por modalidad, tratamiento del transporte, plan de negocio, adecuaciones, cotizaciones,
// evaluación de coherencia y pertinencia, y firma del plan.
import { createHash } from 'node:crypto';
import { solicitudInvalida } from '../errores.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { modalidadDe } from './catalogoVisitas.js';

// Tope de presupuesto por modalidad; la coordinación puede fijar uno menor, nunca mayor.
export const TOPES = { M1: 5_000_000, M2: 20_000_000, M3: 30_000_000, M4: 50_000_000 };
export const topeDe = (modalidad) => TOPES[modalidadDe(modalidad)] ?? null;
export const esM1 = (modalidad) => modalidadDe(modalidad) === 'M1';
// Fecha mínima admitida en los soportes, porque PostgreSQL no acepta el año 0 en DATE.
const FECHA_MINIMA = '2000-01-01';

// Devuelve el presupuesto del plan: el tope de la modalidad o el menor que haya fijado la coordinación, o null
// si no hay ninguno.
export function presupuestoEfectivo(fijado, modalidad) {
  const tope = topeDe(modalidad);
  const f = fijado == null ? null : Number(fijado);
  return f === null ? tope : tope === null ? f : Math.min(f, tope);
}
export const MIN_COTIZACIONES = 3;

export const DIMENSIONES = [
  { clave: 'social', nombre: 'Acciones de la dimensión social' },
  { clave: 'economica', nombre: 'Acciones de la dimensión económica' },
  { clave: 'empresarial', nombre: 'Acciones de la dimensión empresarial' },
];
// Estructura del plan de mercadeo dentro del plan de negocio.
export const MERCADEO = [
  { clave: 'segmento', nombre: 'Segmento de clientes' },
  { clave: 'canales', nombre: 'Canales de venta' },
  { clave: 'precio', nombre: 'Estrategia de precio' },
  { clave: 'promocion', nombre: 'Promoción y comunicación' },
  { clave: 'distribucion', nombre: 'Distribución del producto' },
];
export const NIVELES_RIESGO = [
  { codigo: 'alto', nombre: 'Alto' }, { codigo: 'medio', nombre: 'Medio' }, { codigo: 'bajo', nombre: 'Bajo' },
];
export const PUNTOS_ADECUACION = [
  { clave: 'electricas', nombre: 'Instalaciones eléctricas' },
  { clave: 'ventilacion', nombre: 'Ventilación' },
  { clave: 'espacio', nombre: 'Espacio para los activos' },
];
export const ESTADOS_ADECUACION = [
  { codigo: 'cumple', nombre: 'Cumple' }, { codigo: 'no_cumple', nombre: 'No cumple' }, { codigo: 'no_aplica', nombre: 'No aplica' },
];

const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const textos = (v) => lista(v, 20).map((x) => txt(x, 500)).filter(Boolean);
const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);

// Limpia el plan de negocio; admite borradores incompletos y rechaza fechas y niveles que no existen.
export function limpiarPlanNegocio(p = {}) {
  const d = esObjeto(p) ? p : {};
  const plan = {};
  for (const dim of DIMENSIONES) plan[dim.clave] = textos(d[dim.clave]);
  plan.propuesta_valor = txt(d.propuesta_valor, 2000);
  plan.asistencia_tecnica = textos(d.asistencia_tecnica);
  const m = esObjeto(d.mercadeo) ? d.mercadeo : {};
  plan.mercadeo = Object.fromEntries(MERCADEO.map((c) => [c.clave, txt(m[c.clave], 1000)]));
  plan.plan_accion = lista(d.plan_accion, 30).map((f, i) => {
    const x = esObjeto(f) ? f : {};
    const fila = { accion: txt(x.accion, 500), responsable: txt(x.responsable, 200), fecha: txt(x.fecha, 10) };
    if (fila.fecha && !fechaReal(fila.fecha)) throw solicitudInvalida(`Plan de negocio › Plan de acción, fila ${i + 1}: la fecha no es válida.`);
    return fila;
  }).filter((f) => f.accion || f.responsable || f.fecha);
  plan.riesgos = lista(d.riesgos, 20).map((f, i) => {
    const x = esObjeto(f) ? f : {};
    const fila = { riesgo: txt(x.riesgo, 500), nivel: txt(x.nivel, 10), mitigacion: txt(x.mitigacion, 1000) };
    if (fila.nivel && !NIVELES_RIESGO.some((n) => n.codigo === fila.nivel)) {
      throw solicitudInvalida(`Plan de negocio › Riesgos, fila ${i + 1}: el nivel debe ser alto, medio o bajo.`);
    }
    return fila;
  }).filter((f) => f.riesgo || f.nivel || f.mitigacion);
  return plan;
}

// Devuelve lo que le falta al plan de negocio para poder enviar el plan de capitalización.
export function faltantesPlanNegocio(p) {
  const plan = p || {};
  const f = [];
  for (const dim of DIMENSIONES) if (!(plan[dim.clave] || []).length) f.push(`Plan de negocio › ${dim.nombre}`);
  if (!plan.propuesta_valor) f.push('Plan de negocio › Propuesta de valor');
  if (!(plan.asistencia_tecnica || []).length) f.push('Plan de negocio › Necesidades de asistencia técnica');
  const faltaMercadeo = MERCADEO.filter((c) => !plan.mercadeo?.[c.clave]).map((c) => c.nombre.toLowerCase());
  if (faltaMercadeo.length) f.push(`Plan de negocio › Plan de mercadeo: ${faltaMercadeo.join(', ')}`);
  const acciones = plan.plan_accion || [];
  if (!acciones.length) f.push('Plan de negocio › Plan de acción');
  else if (acciones.some((x) => !x.accion || !x.responsable || !x.fecha)) f.push('Plan de negocio › Plan de acción: cada fila con la acción, el responsable y la fecha');
  const riesgos = plan.riesgos || [];
  if (!riesgos.length) f.push('Plan de negocio › Análisis de riesgos');
  else if (riesgos.some((x) => !x.riesgo || !x.nivel || !x.mitigacion)) f.push('Plan de negocio › Análisis de riesgos: cada riesgo con su nivel y su mitigación');
  return f;
}

// Limpia los datos de las adecuaciones técnicas.
export function limpiarAdecuaciones(a = {}) {
  const d = esObjeto(a) ? a : {};
  const salida = {};
  for (const p of PUNTOS_ADECUACION) {
    const x = esObjeto(d[p.clave]) ? d[p.clave] : {};
    const estado = txt(x.estado, 20);
    if (estado && !ESTADOS_ADECUACION.some((e) => e.codigo === estado)) throw solicitudInvalida(`Adecuaciones técnicas › ${p.nombre}: elige Cumple, No cumple o No aplica.`);
    const observacion = txt(x.observacion, 1000);
    if (estado === 'no_cumple' && !observacion) throw solicitudInvalida(`Adecuaciones técnicas › ${p.nombre}: escribe qué no cumple.`);
    salida[p.clave] = { estado: estado || null, observacion: observacion || null };
  }
  return salida;
}

export const faltantesAdecuaciones = (a) => PUNTOS_ADECUACION.filter((p) => !a?.[p.clave]?.estado).map((p) => `Adecuaciones técnicas de la sede › ${p.nombre}`);
export const bloqueosAdecuaciones = (a) => PUNTOS_ADECUACION.filter((p) => a?.[p.clave]?.estado === 'no_cumple')
  .map((p) => `Adecuaciones técnicas de la sede › ${p.nombre}: no cumple (${a[p.clave].observacion}).`);

// Limpia una cotización: proveedor, valor unitario positivo y fecha real no futura.
export function limpiarCotizacion(c = {}) {
  const idProveedor = Number(c.id_proveedor);
  if (!Number.isInteger(idProveedor) || idProveedor < 1 || idProveedor > 2147483647) throw solicitudInvalida('Elige el proveedor de la cotización.');
  const crudo = String(c.valor_unitario ?? '').replace(/\s/g, '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(crudo)) {
    throw solicitudInvalida('El valor unitario de la cotización no es válido: escríbelo en pesos, sin puntos de miles (por ejemplo 1500000).');
  }
  const valor = Number(crudo);
  if (valor <= 0) throw solicitudInvalida('El valor unitario de la cotización debe ser mayor que cero.');
  const fecha = txt(c.fecha, 10);
  if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < FECHA_MINIMA) throw solicitudInvalida('La fecha de la cotización no es válida (no puede ser futura).');
  return { id_proveedor: idProveedor, valor_unitario: Math.round(valor * 100) / 100, fecha };
}

// Ordena las cotizaciones de una línea por valor y marca la más barata y la elegida.
export function compararCotizaciones(cots = [], elegida = null) {
  const orden = [...cots].sort((a, b) => a.valor_unitario - b.valor_unitario || a.id - b.id);
  const minimo = orden.length ? orden[0].valor_unitario : null;
  return orden.map((c) => ({ ...c, mas_barata: c.valor_unitario === minimo, elegida: c.id === elegida }));
}

// Devuelve lo que le falta a una línea en cotizaciones para aprobar el plan.
export function faltasCotizacion(linea, cots = []) {
  const f = [];
  const proveedores = new Set(cots.map((c) => c.id_proveedor));
  if (proveedores.size < MIN_COTIZACIONES) f.push(`tiene ${proveedores.size} de ${MIN_COTIZACIONES} cotizaciones de proveedores distintos`);
  const elegida = cots.find((c) => c.id === linea.cotizacion_elegida);
  if (!elegida) f.push('no tiene la cotización elegida');
  else {
    const minimo = Math.min(...cots.map((c) => c.valor_unitario));
    if (elegida.valor_unitario > minimo && !linea.justificacion_cotizacion) f.push('la cotización elegida no es la más barata y no tiene justificación');
  }
  return f;
}

// Devuelve lo que falta de la evaluación de coherencia y pertinencia.
export function faltasEvaluacion(linea) {
  const e = linea.evaluacion;
  if (!e) return ['no tiene la evaluación de coherencia y pertinencia de la coordinación'];
  const f = [];
  if (!e.coherente) f.push(`no es coherente con la actividad económica (${e.observacion || 'sin observación'})`);
  if (!e.pertinente) f.push(`no es pertinente (${e.observacion || 'sin observación'})`);
  return f;
}

// Calcula la huella del contenido del plan que se imprime y se firma: modalidad, presupuesto, transporte, libro
// contable, objetivo, plan de negocio y adecuaciones.
export function huellaPlan({ carrito, lineas, cotizaciones = {} }) {
  const modalidad = modalidadDe(carrito?.up_modalidad) || null;
  const a = carrito?.adecuaciones || null;
  const contenido = {
    modalidad,
    presupuesto: presupuestoEfectivo(carrito?.presupuesto_maximo, carrito?.up_modalidad),
    transporte: [Number(carrito?.monto_transporte || 0), Boolean(carrito?.transporte_descontado)],
    libro: Boolean(carrito?.libro_contable),
    objetivo: carrito?.objetivo_plan || '',
    plan: carrito?.plan_negocio || null,
    adecuaciones: a ? PUNTOS_ADECUACION.map((p) => [a[p.clave]?.estado || null, a[p.clave]?.observacion || null]) : null,
    lineas: lineas.map((l) => [l.id, l.id_producto, Number(l.cantidad), Number(l.precio), Number(l.iva), l.cotizacion_elegida || null,
      l.justificacion_cotizacion || null,
      (cotizaciones[l.id] || []).map((q) => [q.id_proveedor, Number(q.valor_unitario), q.fecha]).sort((x, y) => x[0] - y[0])]),
  };
  return createHash('sha256').update(JSON.stringify(contenido)).digest('hex');
}

// Calcula el código del plan que se imprime en el PDF y se pide al cargarlo firmado.
export const codigoPlan = (huella) => String(huella || '').slice(0, 12).toUpperCase();

export function faltasFirma(firma, huella) {
  if (!firma?.soporte) return ['Falta el plan firmado por la unidad productiva y el consultor (descarga el PDF, fírmalo y cárgalo).'];
  if (firma.huella !== huella) return ['El plan cambió después de firmado: descarga el PDF de nuevo y carga el plan firmado.'];
  return [];
}

// Limpia las firmas declaradas: nombre y fecha no futura de la unidad y del consultor.
export function limpiarFirmas(c = {}) {
  const salida = {};
  for (const [clave, quien] of [['up', 'de la unidad productiva'], ['consultor', 'del consultor']]) {
    const nombre = txt(c[`firma_${clave}_nombre`], 200);
    const fecha = txt(c[`firma_${clave}_fecha`], 10);
    if (!nombre) throw solicitudInvalida(`Escribe el nombre de quien firma ${quien}.`);
    if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < FECHA_MINIMA) throw solicitudInvalida(`La fecha de la firma ${quien} no es válida (no puede ser futura).`);
    salida[clave] = { nombre, fecha };
  }
  return salida;
}
