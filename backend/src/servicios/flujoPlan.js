// Flujo de aprobación y legalización del plan de capitalización: las acciones del ciclo que no son un simple
// cambio de estado, como el visto bueno de viabilidad, la sesión del comité de aprobación, la reapertura de una
// subsanación vencida, las fichas técnicas de los activos y la legalización por unidad.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { query, transaccion } from '../db.js';
import { ROLES, config } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { guardarArchivo } from './archivos.js';
import { contenidoValido } from './tipoArchivo.js';
import { conRegistro, registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { sumarDiasHabiles } from './diasHabiles.js';
import {
  APROBADOS, MAX_ID, NOMBRE_ESTADO, cargarCarrito, conHistorial, conRegistroCarrito, exigirCarritoEnPrograma, exigirLectura, formacionCumple,
  iniciativa, lineasDe, resumir, subsanacionVencida, vista,
} from './carrito.js';

// Plazo de subsanación en días hábiles.
const PLAZO_SUBSANACION = 4;
const quienEs = (u) => u.nombre || u.nodo || u.sub || 'sistema';
const marca = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const soloAlfanum = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
const esCompras = (u) => u.rol === ROLES.COMPRAS || Boolean(u.general);
const fechaValida = (f, que) => {
  const x = String(f || '').slice(0, 10);
  if (!fechaReal(x) || x > hoyColombia() || x < '2000-01-01') throw solicitudInvalida(`La fecha ${que} no es válida (no puede ser futura).`);
  return x;
};

async function pdfValido(archivo, que) {
  if (!archivo) throw solicitudInvalida(`Adjunta ${que} en PDF.`);
  if (archivo.size > config.maxMbPdf * 1024 * 1024) throw new HttpError(413, `El PDF supera los ${config.maxMbPdf} MB.`);
  if (path.extname(archivo.originalname || '').toLowerCase() !== '.pdf' || !(await contenidoValido(archivo.path, archivo.originalname))) {
    throw solicitudInvalida(`${que.charAt(0).toUpperCase()}${que.slice(1)} debe ser un PDF válido.`);
  }
}
const nombreOriginal = (archivo, defecto = '') => Buffer.from(archivo?.originalname || defecto, 'latin1').toString('utf8').slice(0, 300);

// Registra el visto bueno de viabilidad del plan.
export async function registrarViabilidad(usuario, campos = {}, archivo) {
  exigirLectura(usuario);
  if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('El visto bueno de la interventoría lo registra el Coordinador local regional.');
  const up = await iniciativa(usuario, campos.id_unico);
  const viable = String(campos.viable || '').toLowerCase();
  if (!['si', 'no'].includes(viable)) throw solicitudInvalida('Indica si la interventoría dio el plan por viable (sí o no).');
  const fecha = fechaValida(campos.fecha, 'del visto bueno');
  const responsable = txt(campos.responsable)?.slice(0, 200);
  if (!responsable) throw solicitudInvalida('Escribe quién de la interventoría dio el visto bueno.');
  const observaciones = txt(campos.observaciones)?.slice(0, 2000) || null;
  if (viable === 'no' && !observaciones) throw solicitudInvalida('Escribe las observaciones de la interventoría: el plan no es viable.');
  await pdfValido(archivo, 'el soporte del visto bueno');
  return conRegistroCarrito(usuario, 'carrito.viabilidad', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirCarritoEnPrograma(carrito);
    if (!carrito || carrito.estado !== 'revisado') {
      throw new HttpError(409, `La viabilidad se registra sobre un plan revisado por la coordinación (este está ${NOMBRE_ESTADO[carrito?.estado || 'borrador']}).`);
    }
    const r = await guardarArchivo({
      contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/viabilidad/${marca()}_${randomBytes(3).toString('hex')}_VISTO_BUENO.pdf`,
    }, db);
    const datos = { viable: viable === 'si', fecha, responsable, observaciones, soporte: r.nombre, registrada_por: quienEs(usuario), registrada_en: new Date().toISOString() };
    const nuevo = viable === 'si' ? 'viable' : 'devuelto';
    await db.query('UPDATE carritos SET viabilidad = $2, estado = $3, historial = $4 WHERE id_carrito = $1', [
      carrito.id_carrito, JSON.stringify(datos), nuevo,
      JSON.stringify(conHistorial(carrito, usuario, 'revisado', nuevo, { motivo: viable === 'si' ? 'Viable para la interventoría' : `No viable: ${observaciones}` })),
    ]);
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => ({ viable: viable === 'si', fecha, responsable }));
}

const ENTIDADES = ['Prosperidad Social', 'INNPULSA'];

// Valida los integrantes del comité: exactamente 3, dos de Prosperidad Social y uno de INNPULSA, con nombre.
export function limpiarIntegrantes(lista) {
  const xs = (Array.isArray(lista) ? lista : []).map((x) => ({ nombre: txt(x?.nombre)?.slice(0, 200) || '', entidad: txt(x?.entidad) || '' }));
  if (xs.length !== 3 || xs.some((x) => !x.nombre || !ENTIDADES.includes(x.entidad))
      || xs.filter((x) => x.entidad === 'Prosperidad Social').length !== 2) {
    throw solicitudInvalida('El comité lo integran 3 personas con su nombre: 2 de Prosperidad Social y 1 de INNPULSA.');
  }
  return xs;
}

// Valida las calificaciones de un plan, una por integrante de 1 a 5, y devuelve las calificaciones, el promedio
// y el resultado.
export function calificar(calificaciones) {
  const xs = (Array.isArray(calificaciones) ? calificaciones : []).map(Number);
  if (xs.length !== 3 || xs.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) {
    throw solicitudInvalida('Cada integrante del comité califica el plan de 1 a 5.');
  }
  const promedio = Math.round((xs.reduce((a, n) => a + n, 0) / 3) * 100) / 100;
  return { calificaciones: xs, promedio, resultado: promedio >= 3 ? 'aprobado' : 'no_aprobado' };
}

const exigirGeneral = (u) => { if (!u?.general) throw prohibido('La sesión del comité la registra el Coordinador general o el Profesional de seguimiento.'); };

// Registra una sesión del comité con sus integrantes, el acta y las calificaciones de los planes.
export async function registrarComite(usuario, campos = {}, archivo) {
  exigirGeneral(usuario);
  const fecha = fechaValida(campos.fecha, 'del comité');
  let integrantes;
  let planes;
  try {
    integrantes = limpiarIntegrantes(typeof campos.integrantes === 'string' ? JSON.parse(campos.integrantes) : campos.integrantes);
    planes = typeof campos.planes === 'string' ? JSON.parse(campos.planes) : campos.planes;
  } catch (e) {
    if (e?.status) throw e;
    throw solicitudInvalida('Los integrantes o los planes del comité no son válidos.');
  }
  if (!Array.isArray(planes) || !planes.length || planes.length > 200) throw solicitudInvalida('Incluye de 1 a 200 planes en la sesión del comité.');
  const evaluados = planes.map((p) => ({ id_unico: txt(p?.id_unico) || '', observacion: txt(p?.observacion)?.slice(0, 1000) || null, ...calificar(p?.calificaciones) }));
  if (new Set(evaluados.map((p) => p.id_unico)).size !== evaluados.length) throw solicitudInvalida('Un plan está repetido en la sesión.');
  await pdfValido(archivo, 'el acta del comité');
  const fs = await import('node:fs/promises');
  const acta = await fs.readFile(archivo.path);

  const registros = [];
  return conRegistro(usuario, { accion: 'comite.registrar', objeto: { tipo: 'comite', id: null } }, () => transaccion(async (db) => {
    const problemas = [];
    const filas = [];
    const vistas = new Set();
    for (const p of evaluados) {
      const up = await buscarUP({ idUnico: p.id_unico });
      if (!up) { problemas.push(`«${p.id_unico}» no existe.`); continue; }
      if (vistas.has(up.id_up)) { problemas.push(`«${p.id_unico}» está repetido en la sesión.`); continue; }
      vistas.add(up.id_up);
      const carrito = await cargarCarrito(db, up.id_up, true);
      if (carrito?.up_retirada) { problemas.push(`«${p.id_unico}» está retirada del programa.`); continue; }
      if (!carrito || !['viable', 'subsanado'].includes(carrito.estado)) {
        problemas.push(`«${p.id_unico}» no está listo para el comité (está ${NOMBRE_ESTADO[carrito?.estado || 'borrador']}; debe ser viable o subsanado).`);
        continue;
      }
      const f = await formacionCumple(db, up.id_up);
      if (!f.cumple) { problemas.push(`«${p.id_unico}» no alcanza el 80 % de formación (tiene ${f.porcentaje} %).`); continue; }
      filas.push({ p, up, carrito });
    }
    if (problemas.length) throw solicitudInvalida(`No se puede registrar el comité: ${problemas.join(' ')}`);
    const { rows: [c] } = await db.query(
      `INSERT INTO comites_aprobacion (fecha, integrantes, acta, acta_nombre, registrado_por) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fecha, JSON.stringify(integrantes), acta, nombreOriginal(archivo, 'acta.pdf'), quienEs(usuario)],
    );
    const resultados = [];
    for (const { p, up, carrito } of filas) {
      await db.query(
        `INSERT INTO comite_planes (comite_id, id_carrito, id_up, id_unico, calificaciones, promedio, resultado, observacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [c.id, carrito.id_carrito, up.id_up, up.id_unico, p.calificaciones, p.promedio, p.resultado, p.observacion],
      );
      const comite = { comite_id: c.id, fecha, calificaciones: p.calificaciones, promedio: p.promedio, resultado: p.resultado, observacion: p.observacion };
      const subsanacion = p.resultado === 'aprobado' ? carrito.subsanacion
        : { comite_id: c.id, desde: fecha, plazo: sumarDiasHabiles(fecha, PLAZO_SUBSANACION), reaperturas: [] };
      const nuevo = p.resultado === 'aprobado' ? 'aprobado' : 'en_subsanacion';
      await db.query('UPDATE carritos SET estado = $2, comite = $3, subsanacion = $4, historial = $5 WHERE id_carrito = $1', [
        carrito.id_carrito, nuevo, JSON.stringify(comite), subsanacion ? JSON.stringify(subsanacion) : null,
        JSON.stringify(conHistorial(carrito, usuario, carrito.estado, nuevo, { motivo: `Comité del ${fecha}: promedio ${p.promedio}` })),
      ]);
      registros.push({ accion: 'carrito.comite', objeto: { tipo: 'carrito', id: up.id_unico }, idUnico: up.id_unico,
        cambios: { promedio: p.promedio, comite: c.id, campos: { estado: [carrito.estado, nuevo] } } });
      resultados.push({ id_unico: up.id_unico, promedio: p.promedio, resultado: p.resultado, plazo_subsanacion: subsanacion?.plazo || null });
    }
    return { ok: true, item: { id: c.id, fecha, integrantes, planes: resultados } };
  }), (r) => ({ comite: r.item.id, planes: r.item.planes.map((x) => [x.id_unico, x.resultado]) }))
    .then(async (r) => { for (const x of registros) await registrar(usuario, x); return r; });
}

// Lista las sesiones del comité: el nivel nacional ve todos los planes y los demás solo los de su alcance.
export async function listarComites(usuario) {
  exigirLectura(usuario);
  const { rows: comites } = await query(
    'SELECT id, to_char(fecha, \'YYYY-MM-DD\') AS fecha, integrantes, acta_nombre, registrado_por, creado_en FROM comites_aprobacion ORDER BY fecha DESC, id DESC LIMIT 200');
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows: planes } = await query(
    `SELECT cp.comite_id, cp.id_unico, cp.calificaciones, cp.promedio::float AS promedio, cp.resultado, cp.observacion, up.nombre
       FROM comite_planes cp JOIN unidades_productivas up ON up.id_up = cp.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE ${alcance} ORDER BY cp.id`, params);
  const items = comites.map((c) => ({ ...c, planes: planes.filter((p) => p.comite_id === c.id) }))
    .filter((c) => usuario.general || c.planes.length);
  return { ok: true, items };
}

// Devuelve el acta de una sesión para quien ve al menos un plan de esa sesión.
export async function actaComite(usuario, { id } = {}) {
  exigirLectura(usuario);
  const cid = entero(id);
  if (!cid || cid < 1 || cid > MAX_ID) throw noEncontrado('El comité no existe.');
  const visibles = (await listarComites(usuario)).items.some((c) => c.id === cid);
  if (!visibles) throw noEncontrado('El comité no existe.');
  const { rows: [c] } = await query('SELECT acta, acta_nombre FROM comites_aprobacion WHERE id = $1', [cid]);
  return { buffer: c.acta, nombre: c.acta_nombre };
}

// Devuelve los planes listos para el comité, con su porcentaje de formación, para armar la sesión.
export async function planesParaComite(usuario) {
  exigirGeneral(usuario);
  const { rows } = await query(
    `SELECT DISTINCT ON (c.id_up) c.id_carrito, c.codigo_iniciativa AS id_unico, c.estado, c.id_up, up.nombre, up.modalidad, t.nodo, t.region
       FROM carritos c JOIN unidades_productivas up ON up.id_up = c.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE c.estado IN ('viable', 'subsanado')
      ORDER BY c.id_up, (c.id_origen LIKE 'LOCAL-%') DESC, c.id_carrito DESC`);
  const items = [];
  for (const r of rows) items.push({ ...r, formacion: await formacionCumple({ query }, r.id_up) });
  return { ok: true, items };
}

// Reabre una subsanación vencida.
export async function reabrirSubsanacion(usuario, { id_unico: idUnico, motivo } = {}) {
  exigirLectura(usuario);
  if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('La subsanación vencida la reabre la coordinación.');
  const nota = txt(motivo)?.slice(0, 1000);
  if (!nota) throw solicitudInvalida('Escribe el motivo para reabrir la subsanación.');
  const up = await iniciativa(usuario, idUnico);
  return conRegistroCarrito(usuario, 'carrito.subsanacion_reabrir', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirCarritoEnPrograma(carrito);
    if (!subsanacionVencida(carrito)) throw new HttpError(409, 'Solo se reabre una subsanación vencida.');
    const hoy = hoyColombia();
    const s = carrito.subsanacion;
    const subsanacion = { ...s, plazo: sumarDiasHabiles(hoy, PLAZO_SUBSANACION),
      reaperturas: [...(s.reaperturas || []), { plazo_anterior: s.plazo, motivo: nota, por: quienEs(usuario), en: new Date().toISOString() }] };
    await db.query('UPDATE carritos SET subsanacion = $2, historial = $3 WHERE id_carrito = $1', [carrito.id_carrito, JSON.stringify(subsanacion),
      JSON.stringify(conHistorial(carrito, usuario, 'en_subsanacion', 'en_subsanacion', { motivo: `Subsanación reabierta hasta el ${subsanacion.plazo}: ${nota}` }))]);
    return vista(db, usuario, up, await cargarCarrito(db, up.id_up));
  }), () => ({ motivo: nota }));
}

async function lineaDelPlan(db, carrito, idLinea) {
  const id = entero(idLinea);
  if (!id || id < 1 || id > MAX_ID || !carrito) throw noEncontrado('Esa línea no está en el plan de la iniciativa.');
  const { rows: [l] } = await db.query('SELECT * FROM carrito_productos WHERE id_carrito_producto = $1 AND id_carrito = $2 FOR UPDATE', [id, carrito.id_carrito]);
  if (!l) throw noEncontrado('Esa línea no está en el plan de la iniciativa.');
  return l;
}

// Carga o reemplaza la ficha técnica de un activo del plan aprobado; reemplazarla quita su aprobación.
export async function cargarFichaTecnica(usuario, campos = {}, archivo) {
  exigirLectura(usuario);
  if (!esCompras(usuario)) throw prohibido('La ficha técnica la carga el Profesional alianzas y conexión de mercados.');
  const up = await iniciativa(usuario, campos.id_unico);
  await pdfValido(archivo, 'la ficha técnica');
  return conRegistroCarrito(usuario, 'carrito.ficha_tecnica', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirCarritoEnPrograma(carrito);
    if (carrito?.estado !== 'aprobado') throw new HttpError(409, 'La ficha técnica se carga cuando el comité aprobó el plan y antes de pasarlo a compra.');
    const l = await lineaDelPlan(db, carrito, campos.id_linea);
    const r = await guardarArchivo({ contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/fichas/${l.id_carrito_producto}_${marca()}_${randomBytes(3).toString('hex')}.pdf` }, db);
    const ficha = { soporte: r.nombre, soporte_nombre: nombreOriginal(archivo), cargada_por: quienEs(usuario), cargada_en: new Date().toISOString(), aprobacion: null };
    await db.query('UPDATE carrito_productos SET ficha_tecnica = $2 WHERE id_carrito_producto = $1', [l.id_carrito_producto, JSON.stringify(ficha)]);
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _linea: l.nombre_producto };
  }), (r) => ({ linea: r._linea })).then(({ _linea, ...r }) => r);
}

// Registra la aprobación de la ficha técnica cargada con su fecha, autor y soporte.
export async function aprobarFichaTecnica(usuario, campos = {}, archivo) {
  exigirLectura(usuario);
  if (!esCompras(usuario)) throw prohibido('La aprobación de la ficha técnica la registra el Profesional alianzas y conexión de mercados.');
  const up = await iniciativa(usuario, campos.id_unico);
  const fecha = fechaValida(campos.fecha, 'de la aprobación');
  const aprobadaPor = txt(campos.aprobada_por)?.slice(0, 200);
  if (!aprobadaPor) throw solicitudInvalida('Escribe quién de la interventoría aprobó la ficha técnica.');
  await pdfValido(archivo, 'el soporte de la aprobación');
  return conRegistroCarrito(usuario, 'carrito.ficha_aprobada', up.id_unico, () => transaccion(async (db) => {
    const carrito = await cargarCarrito(db, up.id_up, true);
    exigirCarritoEnPrograma(carrito);
    if (carrito?.estado !== 'aprobado') throw new HttpError(409, 'La ficha técnica se aprueba cuando el comité aprobó el plan y antes de pasarlo a compra.');
    const l = await lineaDelPlan(db, carrito, campos.id_linea);
    if (!l.ficha_tecnica?.soporte) throw new HttpError(409, `Carga primero la ficha técnica de «${l.nombre_producto}».`);
    const r = await guardarArchivo({ contenedor: 'carritos', archivo, idUp: up.id_up, usuario,
      nombre: `${soloAlfanum(up.id_unico)}/fichas/${l.id_carrito_producto}_${marca()}_${randomBytes(3).toString('hex')}_APROBACION.pdf` }, db);
    const ficha = { ...l.ficha_tecnica, aprobacion: { fecha, aprobada_por: aprobadaPor, soporte: r.nombre, registrada_por: quienEs(usuario), registrada_en: new Date().toISOString() } };
    await db.query('UPDATE carrito_productos SET ficha_tecnica = $2 WHERE id_carrito_producto = $1', [l.id_carrito_producto, JSON.stringify(ficha)]);
    return { ...(await vista(db, usuario, up, await cargarCarrito(db, up.id_up))), _linea: l.nombre_producto };
  }), (r) => ({ linea: r._linea, fecha, aprobada_por: aprobadaPor })).then(({ _linea, ...r }) => r);
}

// Devuelve los planes aprobados con sus facturas de capitalización: total del plan, total facturado y
// diferencia.
export async function legalizacion(usuario, { region } = {}) {
  exigirLectura(usuario);
  const params = [txt(region) || null, APROBADOS];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT DISTINCT ON (c.id_up) c.id_carrito, c.codigo_iniciativa AS id_unico, c.estado, c.id_up, up.nombre, up.modalidad, t.nodo, t.region
       FROM carritos c JOIN unidades_productivas up ON up.id_up = c.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE c.estado = ANY($2::text[]) AND (${alcance}) AND ($1::text IS NULL OR t.region = $1)
      ORDER BY c.id_up, (c.id_origen LIKE 'LOCAL-%') DESC, c.id_carrito DESC`,
    params,
  );
  const ids = rows.map((r) => r.id_unico);
  const { rows: facturas } = ids.length ? await query(
    `SELECT f.id, f.numero, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.total::float AS total, f.id_unico, f.bienes_nuevos, f.entrega_pendiente,
            p.nombre AS proveedor, p.numero_documento AS proveedor_documento, (f.adjunto IS NOT NULL) AS tiene_adjunto,
            COALESCE((SELECT sum(i.cantidad) FROM inventario.factura_items i WHERE i.factura_id = f.id), 0)::int AS cantidad,
            COALESCE((SELECT sum(i.recibido) FROM inventario.factura_items i WHERE i.factura_id = f.id), 0)::int AS recibido
       FROM inventario.facturas f LEFT JOIN inventario.proveedores p ON p.id = f.proveedor_id
      WHERE f.id_unico = ANY($1::text[]) ORDER BY f.fecha, f.id`, [ids]) : { rows: [] };
  const items = [];
  for (const r of rows) {
    const lineas = await lineasDe({ query }, r.id_carrito);
    const plan = resumir({ up_modalidad: r.modalidad }, lineas).total;
    const fs = facturas.filter((f) => f.id_unico === r.id_unico);
    const facturado = Math.round(fs.reduce((a, f) => a + f.total, 0) * 100) / 100;
    items.push({
      id_unico: r.id_unico, nombre: r.nombre, nodo: r.nodo, region: r.region, estado: r.estado, nombre_estado: NOMBRE_ESTADO[r.estado],
      total_plan: plan, total_facturado: facturado, diferencia: Math.round((facturado - plan) * 100) / 100,
      porcentaje: plan > 0 ? Math.round((facturado / plan) * 1000) / 10 : null, facturas: fs,
    });
  }
  return { ok: true, items };
}
