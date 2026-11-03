// Plan de capitalización de cada unidad: un carrito con los productos del catálogo que se le comprarán, dentro
// de un presupuesto máximo. Pasa por los estados borrador, enviado, revisado, viable, aprobado, en compra y
// entregado, con devoluciones que lo hacen volver a empezar. Los permisos se resuelven en el servidor.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, entero, normNodo } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { buscarUP, exigirEnPrograma } from './unidades.js';
import { conRegistro } from './actividad.js';
import { urlArchivo } from './archivos.js';
import {
  ACTIVIDAD_NO_FINANCIABLE, NO_FINANCIABLE, RUBRO, RUBRO_ADECUACIONES, RUBRO_COMPUTO,
} from './clasificacion.js';
import { tenenciaDe } from './tenencia.js';
import { modalidadDe } from './catalogoVisitas.js';
import { hoyColombia } from './secciones.js';
import { formacionDeUP } from './formacion.js';
import {
  ESTADOS_ADECUACION, NIVELES_RIESGO, PUNTOS_ADECUACION, DIMENSIONES, MIN_COTIZACIONES, TOPES,
  bloqueosAdecuaciones, codigoPlan, compararCotizaciones, esM1, faltantesAdecuaciones, faltantesPlanNegocio, faltasCotizacion,
  faltasEvaluacion, faltasFirma, huellaPlan, presupuestoEfectivo, topeDe,
} from './reglasPlan.js';

// Estados del ciclo del plan, desde el borrador hasta la entrega.
export const ESTADOS = ['borrador', 'enviado', 'devuelto', 'revisado', 'viable', 'en_subsanacion', 'subsanado', 'aprobado', 'en_compra', 'entregado'];
export const NOMBRE_ESTADO = {
  borrador: 'en borrador', enviado: 'enviado a revisión', devuelto: 'devuelto', revisado: 'revisado por la coordinación',
  viable: 'viable para la interventoría', en_subsanacion: 'en subsanación', subsanado: 'subsanado', aprobado: 'aprobado por el comité',
  en_compra: 'en compra', entregado: 'entregado',
};
// Estados de los planes aprobados por el comité, que son los que se compran y se verifican en la tercera
// visita.
export const APROBADOS = ['aprobado', 'en_compra', 'entregado'];
const EDITABLES_GESTOR = ['borrador', 'devuelto', 'en_subsanacion'];
const EDITABLES_COORDINACION = ['borrador', 'enviado', 'devuelto', 'en_subsanacion'];
const MAX_CANTIDAD = 100000;
export const MAX_ID = 2147483647;

const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS, ROLES.GESTOR];

const estadoDe = (carrito) => carrito?.estado || 'borrador';
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const pesos = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;

export function exigirLectura(usuario) {
  if (!LECTORES.includes(usuario.rol)) throw prohibido('Tu usuario no usa el carrito.');
}

// Indica si venció el plazo de 4 días hábiles de la subsanación; hasta que se reabra, nadie la cambia.
export const subsanacionVencida = (carrito) => estadoDe(carrito) === 'en_subsanacion'
  && Boolean(carrito?.subsanacion?.plazo) && hoyColombia() > carrito.subsanacion.plazo;

// Indica quién puede cambiar los productos del carrito; después de la revisión, nadie.
function puedeEditar(usuario, carrito) {
  if (subsanacionVencida(carrito)) return false;
  if (usuario.rol === ROLES.COORDINADOR) return EDITABLES_COORDINACION.includes(estadoDe(carrito));
  if (usuario.rol === ROLES.GESTOR) return EDITABLES_GESTOR.includes(estadoDe(carrito));
  return false;
}

// Impide cambios en el plan de una unidad retirada.
export function exigirCarritoEnPrograma(carrito) {
  if (carrito?.up_retirada) exigirEnPrograma({ retirada_dps: true, novedad_tipo: carrito.up_novedad, id_unico: carrito.up_id_unico || carrito.codigo_iniciativa }, 'cambia su plan de capitalización');
}

export function exigirEdicion(usuario, carrito) {
  exigirCarritoEnPrograma(carrito);
  if (puedeEditar(usuario, carrito)) return;
  if (subsanacionVencida(carrito) && [ROLES.COORDINADOR, ROLES.GESTOR].includes(usuario.rol)) {
    throw new HttpError(409, `La subsanación venció el ${carrito.subsanacion.plazo}: la coordinación debe reabrirla.`);
  }
  if (usuario.rol === ROLES.COORDINADOR) {
    throw new HttpError(409, `El plan está ${NOMBRE_ESTADO[estadoDe(carrito)]}: devuélvelo para cambiarlo.`);
  }
  throw prohibido(usuario.rol === ROLES.GESTOR
    ? 'El carrito ya se envió: solo la coordinación puede cambiarlo.'
    : 'Tu usuario solo puede consultar los carritos.');
}

// Agrega un cambio de estado al historial del plan, con quién y cuándo.
export function conHistorial(carrito, usuario, de, a, extra = {}) {
  const historial = Array.isArray(carrito?.historial) ? carrito.historial : [];
  return [...historial, { de, a, por: usuario.nombre || usuario.sub || 'sistema', rol: usuario.rol, general: Boolean(usuario.general),
    es_datos: Boolean(usuario.esDatos), en: new Date().toISOString(), ...extra }].slice(-200);
}

// Indica si la unidad alcanzó el 80 % de formación, tomando el mejor cumplimiento de sus talleres.
export async function formacionCumple(db, idUp) {
  const f = await formacionDeUP(db, idUp);
  return { cumple: Boolean(f.cumplimiento?.cumple_80), porcentaje: f.cumplimiento?.porcentaje ?? 0 };
}

// Devuelve la iniciativa del carrito comprobada contra el alcance del usuario.
export async function iniciativa(usuario, idUnico) {
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Iniciativa no encontrada.');
  exigirAlcance(usuario, up);
  return up;
}

// Carga el carrito de la iniciativa con la modalidad vigente, de la que sale el tope; si hay uno anterior y
// otro nuevo, prefiere el nuevo.
export async function cargarCarrito(db, idUp, bloquear = false) {
  const { rows } = await db.query(
    `SELECT c.*, up.modalidad AS up_modalidad, up.retirada_dps AS up_retirada, up.novedad_tipo AS up_novedad, up.id_unico AS up_id_unico
       FROM carritos c LEFT JOIN unidades_productivas up ON up.id_up = c.id_up
      WHERE c.id_up = $1
      ORDER BY (c.id_origen LIKE 'LOCAL-%') DESC, c.id_carrito DESC LIMIT 1 ${bloquear ? 'FOR UPDATE OF c' : ''}`,
    [idUp],
  );
  return rows[0] || null;
}

// Crea el carrito la primera vez que se necesita, guardando una copia de los datos de la iniciativa para que
// siga mostrando lo aprobado.
export async function crearCarrito(db, up) {
  exigirEnPrograma(up, 'arma un plan de capitalización');
  const { rows: [d] } = await db.query(
    `SELECT up.nombre, up.sector, up.modalidad, up.departamento, up.municipio,
            r.documento, r.nombre_completo, r.direccion
       FROM unidades_productivas up
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE up.id_up = $1`,
    [up.id_up],
  );
  await db.query(
    `INSERT INTO carritos (id_origen, id_up, codigo_iniciativa, estado, fecha_recibido, nombre_up,
                           tipologia, fecha_generacion, snap_unidad_nombre, snap_unidad_doc,
                           snap_representante, snap_unidad_direccion, snap_dpto, snap_mpio,
                           snap_unidad_sector, snap_modalidad)
     VALUES ('LOCAL-' || $1::text, $2, $1, 'borrador', now(), $3, $4, now(), $3, $5, $6, $7, $8, $9, $4, $10)
     ON CONFLICT (id_origen) DO NOTHING`,
    [up.id_unico, up.id_up, d.nombre, d.sector, d.documento, d.nombre_completo, d.direccion,
      d.departamento, d.municipio, d.modalidad],
  );
  return cargarCarrito(db, up.id_up, true);
}

export async function lineasDe(db, idCarrito) {
  const { rows } = await db.query(
    `SELECT cp.id_carrito_producto AS id, cp.id_producto, cp.nombre_producto AS nombre,
            cp.cantidad::float AS cantidad, COALESCE(cp.precio_unitario, 0)::float AS precio,
            COALESCE(cp.iva, 0)::float AS iva, cat.tipologia, cat.proceso,
            cat.unspsc, cat.rubro, cat.no_financiable, cp.justificacion,
            cp.cotizacion_elegida, cp.justificacion_cotizacion, cp.evaluacion, cp.ficha_tecnica
       FROM carrito_productos cp
       LEFT JOIN catalogo_productos cat ON cat.id_producto = cp.id_producto
      WHERE cp.id_carrito = $1
      ORDER BY cp.id_carrito_producto`,
    [idCarrito],
  );
  return rows.map((l) => ({ ...l, total: redondear(l.cantidad * l.precio * (1 + l.iva / 100)) }));
}

// Devuelve las cotizaciones de las líneas del carrito agrupadas por id de línea.
export async function cotizacionesDe(db, idCarrito) {
  const { rows } = await db.query(
    `SELECT q.id, q.id_carrito_producto AS id_linea, q.id_proveedor, q.proveedor_nombre, q.valor_unitario::float AS valor_unitario,
            to_char(q.fecha, 'YYYY-MM-DD') AS fecha, q.soporte, q.soporte_nombre, q.creado_por, q.creado_en
       FROM carrito_linea_cotizaciones q JOIN carrito_productos cp ON cp.id_carrito_producto = q.id_carrito_producto
      WHERE cp.id_carrito = $1 ORDER BY q.id`,
    [idCarrito],
  );
  const porLinea = {};
  for (const r of rows) (porLinea[r.id_linea] ||= []).push(r);
  return porLinea;
}

// Calcula las cuentas del carrito: lo que suman los productos, el presupuesto restante y si se pasó.
export function resumir(carrito, lineas, modalidad = carrito?.up_modalidad) {
  const subtotal = lineas.reduce((n, l) => n + l.cantidad * l.precio, 0);
  const iva = lineas.reduce((n, l) => n + l.cantidad * l.precio * (l.iva / 100), 0);
  const total = subtotal + iva;
  const m1 = esM1(modalidad);
  const tope = topeDe(modalidad);
  const transporte = !m1 && carrito?.transporte_descontado ? Number(carrito.monto_transporte || 0) : 0;
  const maximo = presupuestoEfectivo(carrito?.presupuesto_maximo, modalidad);
  const paraProductos = maximo === null ? null : maximo - transporte;
  const saldo = paraProductos === null ? null : paraProductos - total;
  return {
    subtotal: redondear(subtotal),
    iva: redondear(iva),
    total: redondear(total),
    transporte: redondear(transporte),
    transporte_m1: m1 ? redondear(Number(carrito?.monto_transporte || 0)) : 0,
    modalidad: modalidadDe(modalidad) || null,
    tope_modalidad: tope,
    presupuesto_maximo: maximo,
    presupuesto_productos: paraProductos === null ? null : redondear(paraProductos),
    saldo: saldo === null ? null : redondear(saldo),
    excede: saldo !== null && saldo < -0.005,
    unidades: lineas.reduce((n, l) => n + l.cantidad, 0),
  };
}

// Devuelve lo que la unidad aporta a las reglas de capitalización: su actividad no financiable y la tenencia de
// la sede.
async function clasificacionUP(db, idUp) {
  const { rows: [x] } = await db.query(
    `SELECT actividad_no_financiable, tenencia_tipo, tenencia_anios, tenencia_soporte, tenencia_registrada_por, tenencia_fecha
       FROM unidades_productivas WHERE id_up = $1`,
    [idUp],
  );
  return { actividad_no_financiable: x?.actividad_no_financiable || null, tenencia: tenenciaDe(x) };
}

const motivoActividad = (cod) =>
  `La unidad productiva tiene una actividad no financiable (${ACTIVIDAD_NO_FINANCIABLE[cod]?.nombre || cod}): no se puede capitalizar.`;
const MOTIVO_TENENCIA = 'las adecuaciones locativas exigen sede propia, comodato de 5 años o más o arriendo de 3 años o más, con la certificación de tenencia cargada';
const SIN_MODALIDAD = 'La unidad no tiene modalidad registrada: sin ella no hay tope de capitalización.';

// Devuelve lo que le falta a una línea para poder enviar o aprobar el plan.
function faltasLinea(l, cup) {
  const f = [];
  if (l.no_financiable) f.push(`no es financiable (${NO_FINANCIABLE[l.no_financiable]?.nombre || l.no_financiable})`);
  if (!l.unspsc) f.push('no tiene clase UNSPSC');
  if (!l.rubro && !l.no_financiable) f.push('no tiene rubro capitalizable');
  if (l.rubro === RUBRO_COMPUTO && !txt(l.justificacion)) f.push('es un equipo de cómputo y le falta la justificación');
  if (l.rubro === RUBRO_ADECUACIONES && !cup.tenencia?.habilita_adecuaciones) f.push(MOTIVO_TENENCIA);
  return f;
}

// Devuelve por qué el plan no se puede enviar ni aprobar todavía; una lista vacía significa que se puede.
function problemasPlan(cup, lineas, carrito, modalidad) {
  const p = [];
  if (cup.actividad_no_financiable) p.push(motivoActividad(cup.actividad_no_financiable));
  for (const l of lineas) {
    const f = faltasLinea(l, cup);
    if (f.length) p.push(`«${l.nombre}» ${f.join('; ')}.`);
  }
  if (!topeDe(modalidad)) p.push(SIN_MODALIDAD);
  const plan = faltantesPlanNegocio(carrito?.plan_negocio);
  const adec = faltantesAdecuaciones(carrito?.adecuaciones);
  if (plan.length || adec.length) p.push(`Falta completar: ${[...plan, ...adec].join('; ')}.`);
  if (esM1(modalidad) && !carrito?.libro_contable) p.push('El plan de una unidad M1 debe incluir el libro contable.');
  return p;
}

// Devuelve lo que además se exige para aprobar: cotizaciones, coherencia, pertinencia, adecuaciones y firma
// vigente.
function problemasAprobacion(carrito, lineas, cotizaciones) {
  const p = [];
  for (const l of lineas) {
    const f = [...faltasCotizacion(l, cotizaciones[l.id] || []), ...faltasEvaluacion(l)];
    if (f.length) p.push(`«${l.nombre}» ${f.join('; ')}.`);
  }
  p.push(...bloqueosAdecuaciones(carrito?.adecuaciones));
  if (lineas.length) p.push(...faltasFirma(carrito?.firma, huellaPlan({ carrito, lineas, cotizaciones })));
  return p;
}

// Guarda en el carrito los totales que lee el resto de la aplicación.
export async function guardarTotales(db, carrito, lineas) {
  const r = resumir(carrito, lineas);
  await db.query(
    'UPDATE carritos SET total_seleccionado = $2, saldo_disponible = $3, presupuesto_productos = $4 WHERE id_carrito = $1',
    [carrito.id_carrito, r.total, r.saldo, r.presupuesto_productos],
  );
  return r;
}

// Devuelve lo que falta de la entrega al beneficiario para marcar el plan como entregado.
export function faltasEntregaBeneficiario(carrito) {
  const e = carrito?.entrega_beneficiario || {};
  const f = [];
  if (!e.recomendaciones?.soporte) f.push('Falta el documento de recomendaciones de uso y buenas prácticas entregado a la unidad.');
  if (!e.acta_recibido?.soporte) f.push('Falta el acta de recibido de la copia de la factura y de los soportes de garantía.');
  return f;
}

// Devuelve las facturas de capitalización de la unidad que se entregan en copia al beneficiario.
async function facturasDeUP(db, idUnico) {
  const { rows } = await db.query(
    `SELECT f.id, f.numero, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.total::float AS total, p.nombre AS proveedor
       FROM inventario.facturas f LEFT JOIN inventario.proveedores p ON p.id = f.proveedor_id
      WHERE f.id_unico = $1 ORDER BY f.fecha, f.id LIMIT 200`, [idUnico]);
  return rows;
}

const entregaVista = (e) => (e ? {
  recomendaciones: e.recomendaciones ? { ...e.recomendaciones, soporte_url: urlArchivo('carritos', e.recomendaciones.soporte) } : null,
  acta_recibido: e.acta_recibido ? { ...e.acta_recibido, soporte_url: urlArchivo('carritos', e.acta_recibido.soporte) } : null,
} : null);

const firmaVista = (firma, huella) => (firma?.soporte ? {
  ...firma, huella: undefined, vigente: firma.huella === huella, soporte_url: urlArchivo('carritos', firma.soporte),
} : null);

// Arma la respuesta que ve la pantalla: el carrito, sus líneas, las cuentas y lo que este usuario puede hacer.
export async function vista(db, usuario, up, carrito) {
  const lineasBase = carrito ? await lineasDe(db, carrito.id_carrito) : [];
  const cotizaciones = carrito ? await cotizacionesDe(db, carrito.id_carrito) : {};
  const modalidad = carrito?.up_modalidad ?? up.modalidad;
  const resumen = resumir(carrito, lineasBase, modalidad);
  const estado = estadoDe(carrito);
  const esCoordinacion = usuario.rol === ROLES.COORDINADOR;
  const cup = await clasificacionUP(db, up.id_up);
  const lineas = lineasBase.map((l) => ({
    ...l,
    rubro_nombre: RUBRO[l.rubro]?.nombre || null,
    requiere_justificacion: l.rubro === RUBRO_COMPUTO,
    faltas: faltasLinea(l, cup),
    cotizaciones: compararCotizaciones(cotizaciones[l.id] || [], l.cotizacion_elegida)
      .map((c) => ({ ...c, soporte_url: urlArchivo('carritos', c.soporte) })),
    faltas_aprobacion: [...faltasCotizacion(l, cotizaciones[l.id] || []), ...faltasEvaluacion(l)],
    ficha_tecnica: l.ficha_tecnica ? {
      ...l.ficha_tecnica, soporte_url: urlArchivo('carritos', l.ficha_tecnica.soporte),
      aprobacion: l.ficha_tecnica.aprobacion ? { ...l.ficha_tecnica.aprobacion, soporte_url: urlArchivo('carritos', l.ficha_tecnica.aprobacion.soporte) } : null,
    } : null,
  }));
  const editable = puedeEditar(usuario, carrito);
  const huella = huellaPlan({ carrito: carrito && { ...carrito, up_modalidad: modalidad }, lineas: lineasBase, cotizaciones });
  const envio = problemasPlan(cup, lineasBase, carrito, modalidad);
  if (resumen.excede) envio.unshift(`El plan se pasa del presupuesto por ${pesos(-resumen.saldo)}: quita o ajusta activos.`);
  return {
    ok: true,
    clasificacion: {
      actividad_no_financiable: cup.actividad_no_financiable,
      actividad_no_financiable_nombre: ACTIVIDAD_NO_FINANCIABLE[cup.actividad_no_financiable]?.nombre || null,
      tenencia: cup.tenencia,
      puede_registrar_tenencia: usuario.rol === ROLES.COORDINADOR || usuario.rol === ROLES.GESTOR,
      problemas_envio: envio,
      problemas_aprobacion: problemasAprobacion(carrito, lineasBase, cotizaciones),
    },
    carrito: {
      existe: Boolean(carrito),
      id_unico: up.id_unico,
      nombre_up: up.unidad_nombre,
      nodo: up.nodo,
      modalidad: modalidadDe(modalidad) || null,
      estado,
      presupuesto_maximo: carrito?.presupuesto_maximo == null ? null : Number(carrito.presupuesto_maximo),
      monto_transporte: Number(carrito?.monto_transporte || 0),
      transporte_descontado: Boolean(carrito?.transporte_descontado),
      objetivo_plan: carrito?.objetivo_plan || '',
      plan_negocio: carrito?.plan_negocio || null,
      adecuaciones: carrito?.adecuaciones || null,
      libro_contable: Boolean(carrito?.libro_contable),
      firma: firmaVista(carrito?.firma, huella),
      codigo_plan: lineasBase.length ? codigoPlan(huella) : null,
      puede_editar: editable,
      puede_definir_presupuesto: esCoordinacion,
      puede_evaluar: esCoordinacion && editable,
      puede_enviar: editable && ['borrador', 'devuelto'].includes(estado) && lineas.length > 0,
      puede_resolver: esCoordinacion && estado === 'enviado',
      nombre_estado: NOMBRE_ESTADO[estado],
      historial: carrito?.historial || [],
      viabilidad: carrito?.viabilidad ? { ...carrito.viabilidad, soporte_url: carrito.viabilidad.soporte ? urlArchivo('carritos', carrito.viabilidad.soporte) : null } : null,
      comite: carrito?.comite || null,
      subsanacion: carrito?.subsanacion ? { ...carrito.subsanacion, vencida: subsanacionVencida(carrito) } : null,
      formacion: carrito ? await formacionCumple(db, up.id_up) : null,
      puede_viabilidad: esCoordinacion && estado === 'revisado',
      puede_devolver: esCoordinacion && DEVOLVIBLES.includes(estado) && estado !== 'devuelto',
      puede_enviar_subsanacion: editable && estado === 'en_subsanacion',
      puede_reabrir_subsanacion: esCoordinacion && subsanacionVencida(carrito),
      puede_fichas: esCompras(usuario) && estado === 'aprobado',
      puede_comprar: esCompras(usuario) && estado === 'aprobado',
      puede_entregar: esCompras(usuario) && estado === 'en_compra',
      entrega_beneficiario: entregaVista(carrito?.entrega_beneficiario),
      faltas_entrega: ['en_compra', 'entregado'].includes(estado) ? faltasEntregaBeneficiario(carrito) : [],
      facturas_up: ['en_compra', 'entregado'].includes(estado) ? await facturasDeUP(db, up.id_unico) : [],
      puede_entrega_beneficiario: [ROLES.GESTOR, ROLES.COORDINADOR].includes(usuario.rol) && estado === 'en_compra',
    },
    lineas,
    resumen,
    listas: {
      topes: TOPES, dimensiones: DIMENSIONES, niveles_riesgo: NIVELES_RIESGO, puntos_adecuacion: PUNTOS_ADECUACION,
      estados_adecuacion: ESTADOS_ADECUACION, min_cotizaciones: MIN_COTIZACIONES,
    },
  };
}

// Ejecuta una escritura del carrito registrándola en la actividad de la unidad.
export function conRegistroCarrito(usuario, accion, idUnico, fn, cambiosDe = () => ({})) {
  return conRegistro(usuario, { accion, objeto: { tipo: 'carrito', id: idUnico ?? null }, idUnico: idUnico ?? null }, fn, cambiosDe);
}

// Lista todos los carritos con sus datos principales.
export async function listarCarritos(usuario, { estado, nodo } = {}) {
  exigirLectura(usuario);
  const est = txt(estado);
  if (est && !ESTADOS.includes(est)) throw solicitudInvalida('Estado de carrito inválido.');
  const params = [txt(nodo) ? normNodo(nodo) : null, est];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT c.id_carrito, c.codigo_iniciativa AS id_unico, c.nombre_up, t.nodo,
            COALESCE(c.estado, 'borrador') AS estado,
            c.presupuesto_maximo::float AS presupuesto_fijado, up.modalidad,
            COALESCE(c.monto_transporte, 0)::float AS monto_transporte, COALESCE(c.transporte_descontado, FALSE) AS transporte_descontado,
            c.fecha_generacion, c.fecha_recibido,
            (SELECT count(*) FROM carrito_productos cp WHERE cp.id_carrito = c.id_carrito)::int AS lineas,
            COALESCE((SELECT sum(cp.cantidad * COALESCE(cp.precio_unitario, 0) * (1 + COALESCE(cp.iva, 0) / 100))
                        FROM carrito_productos cp WHERE cp.id_carrito = c.id_carrito), 0)::float AS total
       FROM carritos c
       LEFT JOIN unidades_productivas up ON up.id_up = c.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance})
        AND ($1::text IS NULL OR upper(t.nodo) = $1)
        AND ($2::text IS NULL OR COALESCE(c.estado, 'borrador') = $2)
      ORDER BY c.fecha_generacion DESC NULLS LAST, c.id_carrito DESC
      LIMIT 1000`,
    params,
  );
  return {
    ok: true,
    items: rows.map(({ modalidad, monto_transporte: transporte, transporte_descontado: descuenta, ...c }) => {
      const maximo = presupuestoEfectivo(c.presupuesto_fijado, modalidad);
      const descuento = !esM1(modalidad) && descuenta ? transporte : 0;
      return { ...c, modalidad: modalidadDe(modalidad) || null, presupuesto_maximo: maximo,
        presupuesto_productos: maximo === null ? null : maximo - descuento };
    }),
  };
}

// Devuelve el carrito de una iniciativa, vacío si aún no existe, sin crearlo.
export async function detalleCarrito(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  return transaccion(async (db) => vista(db, usuario, up, await cargarCarrito(db, up.id_up)));
}

// Pone un producto en el carrito o cambia su cantidad.
export async function ponerLinea(usuario, datos = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, datos.id_unico);
  const idProducto = entero(datos.id_producto);
  const modo = txt(datos.modo) === 'fijar' ? 'fijar' : 'sumar';
  const cantidad = entero(datos.cantidad);
  if (!idProducto || idProducto < 1 || idProducto > MAX_ID || cantidad === null || cantidad < (modo === 'fijar' ? 0 : 1) || cantidad > MAX_CANTIDAD) {
    throw solicitudInvalida('La cantidad no es válida.');
  }

  let cambio = null;
  return conRegistroCarrito(usuario, 'carrito.linea', up.id_unico, () => transaccion(async (db) => {
    let carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);

    const { rows: [prod] } = await db.query(
      `SELECT id_producto, nombre, precio::float AS precio, COALESCE(iva, 0)::float AS iva, rubro, no_financiable
         FROM catalogo_productos WHERE id_producto = $1 AND activo AND precio IS NOT NULL`,
      [idProducto],
    );
    if (!prod) throw solicitudInvalida('Ese producto no está disponible en el catálogo.');

    carrito = carrito || await crearCarrito(db, up);
    const { rows: [previa] } = await db.query(
      `SELECT cp.id_carrito_producto AS id, cp.cantidad::float AS cantidad, q.valor_unitario::float AS cotizado
         FROM carrito_productos cp LEFT JOIN carrito_linea_cotizaciones q ON q.id = cp.cotizacion_elegida
        WHERE cp.id_carrito = $1 AND cp.id_producto = $2 ORDER BY cp.id_carrito_producto LIMIT 1`,
      [carrito.id_carrito, idProducto],
    );
    const antes = previa?.cantidad || 0;
    if (modo === 'sumar' || cantidad > antes) {
      const cup = await clasificacionUP(db, up.id_up);
      if (cup.actividad_no_financiable) throw solicitudInvalida(motivoActividad(cup.actividad_no_financiable));
      if (prod.no_financiable) {
        throw solicitudInvalida(`«${prod.nombre}» no es financiable: ${NO_FINANCIABLE[prod.no_financiable]?.nombre || prod.no_financiable}.`);
      }
      if (prod.rubro === RUBRO_ADECUACIONES && !cup.tenencia?.habilita_adecuaciones) {
        throw solicitudInvalida(`«${prod.nombre}» es una adecuación locativa: ${MOTIVO_TENENCIA}.`);
      }
    }
    const despues = modo === 'fijar' ? cantidad : antes + cantidad;
    if (despues > MAX_CANTIDAD) throw solicitudInvalida('La cantidad es demasiado grande.');

    if (despues <= 0) {
      if (previa) await db.query('DELETE FROM carrito_productos WHERE id_carrito_producto = $1', [previa.id]);
    } else if (previa) {
      await db.query(
        `UPDATE carrito_productos SET cantidad = $2, precio_unitario = $3, iva = $4, nombre_producto = $5,
                evaluacion = CASE WHEN cantidad = $2 THEN evaluacion ELSE NULL END WHERE id_carrito_producto = $1`,
        [previa.id, despues, previa.cotizado ?? prod.precio, prod.iva, prod.nombre],
      );
    } else {
      await db.query(
        `INSERT INTO carrito_productos (id_carrito, id_producto, nombre_producto, cantidad, precio_unitario, iva)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [carrito.id_carrito, idProducto, prod.nombre, despues, prod.precio, prod.iva],
      );
    }
    cambio = { producto: prod.nombre, campos: { cantidad: [antes, Math.max(0, despues)] } };

    const r = await guardarTotales(db, carrito, await lineasDe(db, carrito.id_carrito));
    if (despues > antes && r.excede) {
      throw new HttpError(409, `Con esto se pasa del presupuesto por ${pesos(-r.saldo)}.`);
    }
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => cambio || {});
}

// Quita todos los productos del carrito.
export async function vaciarCarrito(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  return conRegistroCarrito(usuario, 'carrito.vaciar', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    if (carrito) {
      await db.query('DELETE FROM carrito_productos WHERE id_carrito = $1', [carrito.id_carrito]);
      await guardarTotales(db, carrito, []);
    }
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }));
}

// Convierte a monto en pesos, o null si viene vacío; lanza un error 400 si no es un número válido.
function monto(valor, campo) {
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) throw solicitudInvalida(`El valor de ${campo} no es válido.`);
  return n;
}

// Guarda los datos del carrito; el presupuesto y el transporte los define solo la coordinación.
export async function guardarDatos(usuario, datos = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, datos.id_unico);
  const defineMontos = datos.presupuesto_maximo !== undefined
    || datos.monto_transporte !== undefined || datos.transporte_descontado !== undefined;
  if (defineMontos && usuario.rol !== ROLES.COORDINADOR) {
    throw prohibido('Solo la coordinación define el presupuesto y el transporte.');
  }

  let antes = null;
  let despues = null;
  return conRegistroCarrito(usuario, 'carrito.datos', up.id_unico, () => transaccion(async (db) => {
    let carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    carrito = carrito || await crearCarrito(db, up);
    const modalidad = carrito.up_modalidad ?? up.modalidad;
    const tope = topeDe(modalidad);

    const presupuesto = datos.presupuesto_maximo === undefined
      ? carrito.presupuesto_maximo : monto(datos.presupuesto_maximo, 'presupuesto');
    if (datos.presupuesto_maximo !== undefined && presupuesto !== null) {
      if (tope === null) throw solicitudInvalida(SIN_MODALIDAD);
      if (presupuesto > tope) {
        throw solicitudInvalida(`El presupuesto de una unidad ${modalidadDe(modalidad)} no puede pasar de ${pesos(tope)} (tope de la modalidad).`);
      }
    }
    let transporte = datos.monto_transporte === undefined
      ? carrito.monto_transporte : monto(datos.monto_transporte, 'transporte');
    let descuenta = datos.transporte_descontado === undefined
      ? carrito.transporte_descontado : Boolean(datos.transporte_descontado);
    if (esM1(modalidad)) descuenta = false;
    else if (!descuenta) transporte = null;
    const objetivo = datos.objetivo_plan === undefined
      ? carrito.objetivo_plan : (txt(datos.objetivo_plan)?.slice(0, 2000) || null);
    const libro = datos.libro_contable === undefined ? carrito.libro_contable : Boolean(datos.libro_contable);
    if (datos.libro_contable !== undefined && !esM1(modalidad)) throw solicitudInvalida('El libro contable se registra en el plan de las unidades M1.');

    const num = (v) => (v == null ? null : Number(v));
    antes = { presupuesto: num(carrito.presupuesto_maximo), transporte: num(carrito.monto_transporte), descuenta: Boolean(carrito.transporte_descontado), libro: Boolean(carrito.libro_contable), objetivo: carrito.objetivo_plan?.slice(0, 300) || null };
    despues = { presupuesto: num(presupuesto), transporte: num(transporte), descuenta: Boolean(descuenta), libro: Boolean(libro), objetivo: objetivo?.slice(0, 300) || null };
    await db.query(
      `UPDATE carritos SET presupuesto_maximo = $2, monto_transporte = $3, transporte_descontado = $4,
                           objetivo_plan = $5, libro_contable = $6 WHERE id_carrito = $1`,
      [carrito.id_carrito, presupuesto, transporte, descuenta, objetivo, libro],
    );
    const actualizado = await cargarCarrito(db, up.id_up);
    await guardarTotales(db, actualizado, await lineasDe(db, actualizado.id_carrito));
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => Object.fromEntries(Object.keys(despues || {}).filter((k) => antes?.[k] !== despues[k]).map((k) => [k, [antes?.[k] ?? null, despues[k]]])));
}

const DEVOLVIBLES = ['enviado', 'revisado', 'viable', 'aprobado', 'devuelto'];
// Cambios de estado permitidos de forma manual; viable, aprobado y en subsanación solo llegan por sus propias
// acciones.
const TRANSICIONES = {
  enviado: { desde: ['borrador', 'devuelto'], quien: 'editor', verbo: 'enviar' },
  revisado: { desde: ['enviado'], quien: 'coordinacion', verbo: 'marcar como revisado' },
  devuelto: { desde: DEVOLVIBLES, quien: 'coordinacion', verbo: 'devolver' },
  borrador: { desde: DEVOLVIBLES, quien: 'coordinacion', verbo: 'reabrir' },
  subsanado: { desde: ['en_subsanacion'], quien: 'editor', verbo: 'enviar la subsanación' },
  en_compra: { desde: ['aprobado'], quien: 'compras', verbo: 'pasar a compra' },
  entregado: { desde: ['en_compra'], quien: 'compras', verbo: 'marcar como entregado' },
};
const esCompras = (u) => u.rol === ROLES.COMPRAS || Boolean(u.general);

// Cambia el estado del plan según quién lo hace: envía, revisa, devuelve, reabre, pasa a compra o marca la
// entrega.
export async function cambiarEstado(usuario, { id_unico: idUnico, estado, motivo } = {}) {
  exigirLectura(usuario);
  if (usuario.rol === ROLES.TECNICO) throw prohibido('Tu usuario solo puede consultar los carritos.');
  const up = await iniciativa(usuario, idUnico);
  const nuevo = txt(estado);
  if (!ESTADOS.includes(nuevo)) throw solicitudInvalida('El estado del carrito no es válido.');
  const t = TRANSICIONES[nuevo];
  if (!t) {
    if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('Solo la coordinación revisa, devuelve o reabre el plan.');
    throw solicitudInvalida(`El plan pasa a «${NOMBRE_ESTADO[nuevo]}» con su propia acción (viabilidad de la interventoría o comité de aprobación).`);
  }
  const nota = txt(motivo)?.slice(0, 1000) || null;

  let previo = null;
  return conRegistroCarrito(usuario, 'carrito.estado', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    if (!carrito) throw solicitudInvalida('El carrito está vacío.');
    previo = estadoDe(carrito);
    exigirCarritoEnPrograma(carrito);
    const autorizado = t.quien === 'editor' ? [ROLES.GESTOR, ROLES.COORDINADOR].includes(usuario.rol)
      : t.quien === 'coordinacion' ? usuario.rol === ROLES.COORDINADOR : esCompras(usuario);
    if (!autorizado) {
      throw prohibido(t.quien === 'compras' ? 'Pasar a compra y marcar la entrega lo hace el Profesional alianzas y conexión de mercados.'
        : 'Solo la coordinación revisa, devuelve o reabre el plan.');
    }
    if (!t.desde.includes(previo)) {
      throw new HttpError(409, `No se puede ${t.verbo} un plan ${NOMBRE_ESTADO[previo]}.`);
    }
    if (t.quien === 'editor') exigirEdicion(usuario, carrito);
    const lineas = await lineasDe(db, carrito.id_carrito);
    if (['enviado', 'revisado', 'subsanado'].includes(nuevo)) {
      if (!lineas.length) throw solicitudInvalida('Agrega productos antes de enviar el carrito.');
      if (resumir(carrito, lineas).excede) throw solicitudInvalida('El carrito se pasa del presupuesto.');
      const problemas = problemasPlan(await clasificacionUP(db, up.id_up), lineas, carrito, carrito.up_modalidad);
      if (nuevo !== 'enviado') problemas.push(...problemasAprobacion(carrito, lineas, await cotizacionesDe(db, carrito.id_carrito)));
      if (problemas.length) throw solicitudInvalida(`El plan no se puede ${t.verbo} todavía: ${problemas.join(' ')}`);
    }
    if (nuevo === 'en_compra') {
      const f = await formacionCumple(db, up.id_up);
      const faltan = [];
      if (!f.cumple) faltan.push(`La unidad no alcanza el 80 % de formación (tiene ${f.porcentaje} %).`);
      const sinFicha = lineas.filter((l) => !l.ficha_tecnica?.aprobacion);
      if (sinFicha.length) faltan.push(`Falta la ficha técnica aprobada por la interventoría de: ${sinFicha.map((l) => `«${l.nombre}»`).join(', ')}.`);
      if (faltan.length) throw solicitudInvalida(`El plan no se puede pasar a compra todavía: ${faltan.join(' ')}`);
    }
    if (nuevo === 'entregado') {
      const faltan = faltasEntregaBeneficiario(carrito);
      if (faltan.length) throw solicitudInvalida(`El plan no se puede marcar como entregado todavía: ${faltan.join(' ')}`);
    }
    const reinicia = ['devuelto', 'borrador'].includes(nuevo) && !['enviado', 'devuelto'].includes(previo);
    if (reinicia && !nota) {
      throw solicitudInvalida(`Escribe el motivo para ${t.verbo} un plan que ya avanzó en el ciclo.`);
    }
    const extra = nota ? { motivo: nota } : {};
    if (reinicia) {
      const anterior = { viabilidad: carrito.viabilidad || null, comite: carrito.comite || null, subsanacion: carrito.subsanacion || null,
        fichas_aprobadas: lineas.filter((l) => l.ficha_tecnica?.aprobacion).map((l) => l.nombre) };
      if (anterior.viabilidad || anterior.comite || anterior.subsanacion || anterior.fichas_aprobadas.length) extra.deshecho = anterior;
      await db.query(
        `UPDATE carrito_productos SET ficha_tecnica = ficha_tecnica || '{"aprobacion": null}'::jsonb
          WHERE id_carrito = $1 AND ficha_tecnica ? 'aprobacion' AND ficha_tecnica->'aprobacion' <> 'null'::jsonb`, [carrito.id_carrito]);
    }
    await db.query(
      `UPDATE carritos SET estado = $2::text, historial = $3,
              fecha_recibido = CASE WHEN $2::text = 'enviado' THEN now() ELSE fecha_recibido END,
              viabilidad = CASE WHEN $4 THEN NULL ELSE viabilidad END, comite = CASE WHEN $4 THEN NULL ELSE comite END,
              subsanacion = CASE WHEN $4 THEN NULL ELSE subsanacion END
        WHERE id_carrito = $1`,
      [carrito.id_carrito, nuevo, JSON.stringify(conHistorial(carrito, usuario, previo, nuevo, extra)), reinicia],
    );
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => ({ campos: { estado: [previo, nuevo] }, ...(nota ? { motivo: nota } : {}) }));
}

// Guarda la justificación de una línea, requerida para financiar equipos de cómputo; vacía, la borra.
export async function guardarJustificacion(usuario, { id_unico: idUnico, id_linea: idLinea, justificacion } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const id = entero(idLinea);
  if (!id || id < 1 || id > MAX_ID) throw solicitudInvalida('Falta la línea del carrito.');
  const texto = txt(justificacion);
  if (texto && texto.length > 2000) throw solicitudInvalida('La justificación admite máximo 2000 caracteres.');
  return conRegistro(
    usuario, { accion: 'carrito.justificacion', objeto: { tipo: 'carrito_linea', id }, idUnico: up.id_unico },
    () => transaccion(async (db) => {
      const carrito = await cargarCarrito(db, up.id_up, true);
      exigirEdicion(usuario, carrito);
      const { rows: [antes] } = carrito ? await db.query(
        'SELECT justificacion FROM carrito_productos WHERE id_carrito_producto = $1 AND id_carrito = $2 FOR UPDATE',
        [id, carrito.id_carrito],
      ) : { rows: [] };
      if (!antes) throw noEncontrado('Esa línea no está en el carrito de la iniciativa.');
      await db.query('UPDATE carrito_productos SET justificacion = $2 WHERE id_carrito_producto = $1', [id, texto || null]);
      const r = await vista(db, usuario, up, await cargarCarrito(db, up.id_up));
      return { ...r, _antes: antes.justificacion };
    }),
    (r) => ({ campos: { justificacion: [r._antes || null, texto || null] } }),
  ).then(({ _antes, ...r }) => r);
}
