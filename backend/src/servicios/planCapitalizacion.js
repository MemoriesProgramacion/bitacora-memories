// Plan de capitalización: lo que el carrito necesita para ser el plan que pide el anexo, como el plan de
// negocio estructurado, las adecuaciones técnicas de la sede y las cotizaciones. Las reglas están en
// reglasPlan.js y el envío y la aprobación los valida carrito.js.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { guardarArchivo } from './archivos.js';
import { contenidoValido } from './tipoArchivo.js';
import {
  MAX_ID, cargarCarrito, conRegistroCarrito, cotizacionesDe, crearCarrito, exigirEdicion, exigirLectura, guardarTotales,
  iniciativa, lineasDe, pesos, resumir, vista,
} from './carrito.js';
import {
  DIMENSIONES, ESTADOS_ADECUACION, NIVELES_RIESGO, PUNTOS_ADECUACION, codigoPlan, compararCotizaciones, huellaPlan,
  limpiarAdecuaciones, limpiarCotizacion, limpiarFirmas, limpiarPlanNegocio,
} from './reglasPlan.js';

const quienEs = (u) => u.nombre || u.nodo || u.sub || 'sistema';
const marca = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const soloAlfanum = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_');

async function pdfValido(archivo, que) {
  if (!archivo) throw solicitudInvalida(`Adjunta ${que} en PDF.`);
  if (path.extname(archivo.originalname || '').toLowerCase() !== '.pdf' || !(await contenidoValido(archivo.path, archivo.originalname))) {
    throw solicitudInvalida(`${que.charAt(0).toUpperCase()}${que.slice(1)} debe ser un PDF válido.`);
  }
  if (archivo.size > 15 * 1024 * 1024) throw new HttpError(413, 'El PDF supera los 15 MB.');
}

async function lineaDe(db, carrito, idLinea) {
  const id = entero(idLinea);
  if (!id || id < 1 || id > MAX_ID || !carrito) throw noEncontrado('Esa línea no está en el plan de la iniciativa.');
  const { rows: [l] } = await db.query(
    'SELECT * FROM carrito_productos WHERE id_carrito_producto = $1 AND id_carrito = $2 FOR UPDATE', [id, carrito.id_carrito]);
  if (!l) throw noEncontrado('Esa línea no está en el plan de la iniciativa.');
  return l;
}

// Guarda el plan de negocio estructurado de la unidad dentro de su plan de capitalización.
export async function guardarPlanNegocio(usuario, { id_unico: idUnico, plan } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const limpio = limpiarPlanNegocio(plan);
  return conRegistroCarrito(usuario, 'carrito.plan_negocio', up.id_unico, () => transaccion(async (db) => {
    let carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    carrito = carrito || await crearCarrito(db, up);
    await db.query('UPDATE carritos SET plan_negocio = $2 WHERE id_carrito = $1', [carrito.id_carrito, JSON.stringify(limpio)]);
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => ({ secciones: Object.entries(limpio).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k]) => k) }));
}

// Guarda las adecuaciones técnicas de la sede.
export async function guardarAdecuaciones(usuario, { id_unico: idUnico, adecuaciones } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const limpio = limpiarAdecuaciones(adecuaciones);
  return conRegistroCarrito(usuario, 'carrito.adecuaciones', up.id_unico, () => transaccion(async (db) => {
    let carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    carrito = carrito || await crearCarrito(db, up);
    const doc = { ...limpio, registrado_por: quienEs(usuario), registrado_en: new Date().toISOString() };
    await db.query('UPDATE carritos SET adecuaciones = $2 WHERE id_carrito = $1', [carrito.id_carrito, JSON.stringify(doc)]);
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => Object.fromEntries(PUNTOS_ADECUACION.map((p) => [p.clave, limpio[p.clave].estado])));
}

// Devuelve los proveedores registrados en el inventario para elegirlos en una cotización.
export async function proveedoresParaCotizar(usuario) {
  exigirLectura(usuario);
  const { rows } = await query(
    `SELECT id, nombre, tipo_documento, numero_documento, municipio FROM inventario.proveedores ORDER BY lower(nombre)`);
  return { ok: true, items: rows };
}

// Agrega una cotización a una línea del plan.
export async function agregarCotizacion(usuario, campos = {}, archivo) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, campos.id_unico);
  const c = limpiarCotizacion(campos);
  await pdfValido(archivo, 'el soporte de la cotización');
  return conRegistroCarrito(usuario, 'carrito.cotizacion', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    const l = await lineaDe(db, carrito, campos.id_linea);
    const { rows: [prov] } = await db.query('SELECT id, nombre FROM inventario.proveedores WHERE id = $1', [c.id_proveedor]);
    if (!prov) throw solicitudInvalida('Ese proveedor no está registrado: la coordinación lo crea en Proveedores.');
    const { rows: [ya] } = await db.query(
      'SELECT 1 FROM carrito_linea_cotizaciones WHERE id_carrito_producto = $1 AND id_proveedor = $2', [l.id_carrito_producto, prov.id]);
    if (ya) throw new HttpError(409, `«${prov.nombre}» ya tiene una cotización para «${l.nombre_producto}»: las tres deben ser de proveedores distintos.`);
    const r = await guardarArchivo({
      contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/cotizaciones/${l.id_carrito_producto}_${marca()}_${randomBytes(3).toString('hex')}.pdf`,
    }, db);
    await db.query(
      `INSERT INTO carrito_linea_cotizaciones (id_carrito_producto, id_proveedor, proveedor_nombre, valor_unitario, fecha, soporte, soporte_nombre, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [l.id_carrito_producto, prov.id, prov.nombre, c.valor_unitario, c.fecha, r.nombre, String(archivo.originalname || '').slice(0, 300), quienEs(usuario)],
    );
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _cambios: { linea: l.nombre_producto, proveedor: prov.nombre, valor_unitario: c.valor_unitario } };
  }), (r) => r._cambios).then(({ _cambios, ...r }) => r);
}

// Quita una cotización de una línea del plan.
export async function quitarCotizacion(usuario, { id_unico: idUnico, id_cotizacion: idCot } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const id = entero(idCot);
  if (!id || id < 1 || id > MAX_ID) throw solicitudInvalida('Falta la cotización.');
  return conRegistroCarrito(usuario, 'carrito.cotizacion_quitar', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    const { rows: [q] } = await db.query(
      `SELECT q.*, cp.cotizacion_elegida, cp.nombre_producto FROM carrito_linea_cotizaciones q
         JOIN carrito_productos cp ON cp.id_carrito_producto = q.id_carrito_producto
        WHERE q.id = $1 AND cp.id_carrito = $2 FOR UPDATE OF q`, [id, carrito?.id_carrito ?? null]);
    if (!q) throw noEncontrado('Esa cotización no está en el plan de la iniciativa.');
    if (q.cotizacion_elegida === q.id) {
      await db.query(`UPDATE carrito_productos cp SET cotizacion_elegida = NULL, justificacion_cotizacion = NULL,
        precio_unitario = COALESCE((SELECT precio FROM catalogo_productos WHERE id_producto = cp.id_producto), cp.precio_unitario)
        WHERE id_carrito_producto = $1`, [q.id_carrito_producto]);
    }
    await db.query('DELETE FROM carrito_linea_cotizaciones WHERE id = $1', [id]);
    await guardarTotales(db, carrito, await lineasDe(db, carrito.id_carrito));
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _cambios: { linea: q.nombre_producto, proveedor: q.proveedor_nombre } };
  }), (r) => r._cambios).then(({ _cambios, ...r }) => r);
}

// Elige la cotización de una línea: fija su precio unitario, se justifica si no es la más barata y el plan no
// puede pasarse del presupuesto con el nuevo precio.
export async function elegirCotizacion(usuario, { id_unico: idUnico, id_cotizacion: idCot, justificacion } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const id = entero(idCot);
  if (!id || id < 1 || id > MAX_ID) throw solicitudInvalida('Falta la cotización.');
  const motivo = txt(justificacion)?.slice(0, 2000) || null;
  return conRegistroCarrito(usuario, 'carrito.cotizacion_elegir', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    const { rows: [q] } = await db.query(
      `SELECT q.*, cp.nombre_producto, cp.precio_unitario::float AS precio_antes FROM carrito_linea_cotizaciones q
         JOIN carrito_productos cp ON cp.id_carrito_producto = q.id_carrito_producto
        WHERE q.id = $1 AND cp.id_carrito = $2`, [id, carrito?.id_carrito ?? null]);
    if (!q) throw noEncontrado('Esa cotización no está en el plan de la iniciativa.');
    const { rows: [{ minimo }] } = await db.query(
      'SELECT min(valor_unitario)::float AS minimo FROM carrito_linea_cotizaciones WHERE id_carrito_producto = $1', [q.id_carrito_producto]);
    const valor = Number(q.valor_unitario);
    if (valor > minimo && !motivo) {
      throw solicitudInvalida(`La cotización de «${q.proveedor_nombre}» no es la más barata (${pesos(minimo)} por unidad): escribe la justificación.`);
    }
    await db.query(
      `UPDATE carrito_productos SET cotizacion_elegida = $2, precio_unitario = $3, justificacion_cotizacion = $4 WHERE id_carrito_producto = $1`,
      [q.id_carrito_producto, q.id, valor, valor > minimo ? motivo : null]);
    const r = await guardarTotales(db, carrito, await lineasDe(db, carrito.id_carrito));
    if (r.excede && valor > q.precio_antes) throw new HttpError(409, `Con esta cotización el plan se pasa del presupuesto por ${pesos(-r.saldo)}.`);
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _cambios: { linea: q.nombre_producto, proveedor: q.proveedor_nombre, campos: { precio: [q.precio_antes, valor] } } };
  }), (r) => r._cambios).then(({ _cambios, ...r }) => r);
}

// Registra la evaluación de coherencia y pertinencia de un activo del plan.
export async function evaluarActivo(usuario, { id_unico: idUnico, id_linea: idLinea, coherente, pertinente, observacion } = {}) {
  exigirLectura(usuario);
  if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('La coherencia y la pertinencia de los activos las evalúa el Coordinador local regional.');
  if (typeof coherente !== 'boolean' || typeof pertinente !== 'boolean') throw solicitudInvalida('Indica si el activo es coherente y si es pertinente (Sí o No).');
  const obs = txt(observacion)?.slice(0, 1000) || null;
  if ((!coherente || !pertinente) && !obs) throw solicitudInvalida('Escribe la observación: el activo no es coherente o no es pertinente.');
  const up = await iniciativa(usuario, idUnico);
  return conRegistroCarrito(usuario, 'carrito.evaluacion_activo', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    const l = await lineaDe(db, carrito, idLinea);
    const evaluacion = { coherente, pertinente, observacion: obs, evaluado_por: quienEs(usuario), evaluado_en: new Date().toISOString() };
    await db.query('UPDATE carrito_productos SET evaluacion = $2 WHERE id_carrito_producto = $1', [l.id_carrito_producto, JSON.stringify(evaluacion)]);
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _cambios: { linea: l.nombre_producto, coherente, pertinente } };
  }), (r) => r._cambios).then(({ _cambios, ...r }) => r);
}

const nombreDe = (lista, codigo) => lista.find((x) => x.codigo === codigo)?.nombre || '—';

// Genera el PDF del plan de capitalización para imprimirlo y firmarlo; devuelve el contenido y el nombre.
export async function pdfPlan(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, idUnico);
  const carrito = await cargarCarrito({ query }, up.id_up);
  if (!carrito) throw noEncontrado('La iniciativa todavía no tiene plan de capitalización.');
  const lineas = await lineasDe({ query }, carrito.id_carrito);
  const cots = await cotizacionesDe({ query }, carrito.id_carrito);
  const r = resumir(carrito, lineas);
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Plan de capitalización ${up.id_unico}` } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));
  const titulo = (t) => doc.moveDown(0.6).fontSize(12).fillColor('#000').text(t).fontSize(10);
  const vinetas = (xs) => (xs?.length ? xs.forEach((x) => doc.text(`· ${x}`)) : doc.text('—'));
  doc.fontSize(15).text('Plan de capitalización');
  doc.fontSize(10).fillColor('#555').text(`Fundación Memories · ${up.unidad_nombre || ''} (ID ${up.id_unico}) · Modalidad ${r.modalidad || '—'} · ${up.nodo || ''}`);
  doc.fillColor('#000');
  titulo('Objetivo del plan');
  doc.text(carrito.objetivo_plan || '—');
  const p = carrito.plan_negocio || {};
  titulo('Plan de negocio');
  for (const d of DIMENSIONES) { doc.font('Helvetica-Bold').text(d.nombre).font('Helvetica'); vinetas(p[d.clave]); }
  doc.font('Helvetica-Bold').text('Propuesta de valor').font('Helvetica').text(p.propuesta_valor || '—');
  doc.font('Helvetica-Bold').text('Necesidades de asistencia técnica').font('Helvetica'); vinetas(p.asistencia_tecnica);
  doc.font('Helvetica-Bold').text('Plan de acción').font('Helvetica');
  vinetas((p.plan_accion || []).map((f) => `${f.accion} — ${f.responsable} — ${f.fecha}`));
  doc.font('Helvetica-Bold').text('Análisis de riesgos').font('Helvetica');
  vinetas((p.riesgos || []).map((f) => `${f.riesgo} (${nombreDe(NIVELES_RIESGO, f.nivel)}): ${f.mitigacion}`));
  titulo('Activos del plan');
  for (const l of lineas) {
    const lista = compararCotizaciones(cots[l.id] || [], l.cotizacion_elegida);
    const elegida = lista.find((c) => c.elegida);
    doc.text(`· ${l.nombre} × ${l.cantidad} — ${pesos(l.precio)} c/u${l.iva ? ` + ${l.iva} % IVA` : ''} = ${pesos(l.total)}`);
    doc.fillColor('#555').text(`   Cotizaciones: ${lista.map((c) => `${c.proveedor_nombre} ${pesos(c.valor_unitario)}${c.elegida ? ' (elegida)' : ''}`).join(' · ') || '—'}`);
    if (elegida && l.justificacion_cotizacion) doc.text(`   Justificación de la elegida: ${l.justificacion_cotizacion}`);
    doc.fillColor('#000');
  }
  titulo('Cuentas');
  doc.text(`Total de los activos: ${pesos(r.total)} · Presupuesto: ${r.presupuesto_maximo == null ? '—' : pesos(r.presupuesto_maximo)} (tope de la modalidad ${r.tope_modalidad == null ? '—' : pesos(r.tope_modalidad)})`);
  doc.text(r.modalidad === 'M1'
    ? `Transporte de activos (bolsa aparte de M1): ${pesos(r.transporte_m1)} · Libro contable: ${carrito.libro_contable ? 'incluido' : 'no incluido'}`
    : `Transporte de activos: ${carrito.transporte_descontado ? `incluido en la capitalización (${pesos(r.transporte)})` : 'asumido por el beneficiario'}`);
  const a = carrito.adecuaciones || {};
  titulo('Adecuaciones técnicas de la sede');
  for (const x of PUNTOS_ADECUACION) doc.text(`· ${x.nombre}: ${nombreDe(ESTADOS_ADECUACION, a[x.clave]?.estado)}${a[x.clave]?.observacion ? ` — ${a[x.clave].observacion}` : ''}`);
  doc.moveDown(2);
  if (doc.y > 620) doc.addPage();
  const y = doc.y + 30;
  doc.moveTo(50, y).lineTo(260, y).stroke().moveTo(330, y).lineTo(540, y).stroke();
  doc.text('Firma de la unidad productiva', 50, y + 5, { width: 210 }).text('Nombre:', 50, y + 20);
  doc.text('Firma del consultor (gestor)', 330, y + 5, { width: 210 }).text('Nombre:', 330, y + 20);
  doc.fontSize(8).fillColor('#777').text(`Generado el ${new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date())}. Código del plan: ${codigoPlan(huellaPlan({ carrito, lineas, cotizaciones: cots }))} (se pide al cargar el plan firmado).`, 50, y + 60);
  doc.end();
  await fin;
  return { buffer: Buffer.concat(partes), nombre: `plan-capitalizacion-${soloAlfanum(up.id_unico)}.pdf` };
}

// Registra el plan firmado: el PDF con las dos firmas declaradas y el código impreso al pie, que solo se acepta
// si corresponde al plan actual.
export async function registrarFirma(usuario, campos = {}, archivo) {
  exigirLectura(usuario);
  const up = await iniciativa(usuario, campos.id_unico);
  const firmas = limpiarFirmas(campos);
  const codigo = String(campos.codigo_plan || '').trim().toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(codigo)) throw solicitudInvalida('Escribe el código del plan que está impreso al pie del PDF firmado (12 caracteres).');
  await pdfValido(archivo, 'el plan firmado');
  return conRegistroCarrito(usuario, 'carrito.firma', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirEdicion(usuario, carrito);
    if (!carrito) throw solicitudInvalida('La iniciativa todavía no tiene plan de capitalización.');
    const lineas = await lineasDe(db, carrito.id_carrito);
    if (!lineas.length) throw solicitudInvalida('Agrega los activos del plan antes de cargarlo firmado.');
    const huella = huellaPlan({ carrito, lineas, cotizaciones: await cotizacionesDe(db, carrito.id_carrito) });
    if (codigoPlan(huella) !== codigo) {
      throw new HttpError(409, 'El código no corresponde al plan actual: el plan cambió desde que se descargó el PDF. Descárgalo de nuevo y fírmalo.');
    }
    const r = await guardarArchivo({
      contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/firmado/${marca()}_${randomBytes(3).toString('hex')}_PLAN_FIRMADO.pdf`,
    }, db);
    const firma = {
      soporte: r.nombre, soporte_nombre: String(archivo.originalname || '').slice(0, 300), firma_up: firmas.up, firma_consultor: firmas.consultor,
      huella, codigo_plan: codigo, cargado_por: quienEs(usuario), cargado_en: new Date().toISOString(),
    };
    await db.query('UPDATE carritos SET firma = $2 WHERE id_carrito = $1', [carrito.id_carrito, JSON.stringify(firma)]);
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => ({ firma_up: firmas.up, firma_consultor: firmas.consultor }));
}
