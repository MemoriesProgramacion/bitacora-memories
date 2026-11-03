// Rutas de la Bitácora, montadas bajo /api. Las respuestas exitosas son { ok: true, items } o { ok: true, item
// } y los errores { ok: false, error }; el validador conserva su propio formato.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import multer from 'multer';
import { config, ROLES } from './config.js';
import { autenticar, exigirRol } from './auth.js';
import { HttpError, solicitudInvalida } from './errores.js';
import { query } from './db.js';
import { tieneAlcance, exigirAlcance } from './alcance.js';

import * as unidades from './servicios/unidades.js';
import * as documentos from './servicios/documentos.js';
import * as visitas from './servicios/visitas.js';
import * as comunicaciones from './servicios/comunicaciones.js';
import * as tickets from './servicios/tickets.js';
import * as entregas from './servicios/entregas.js';
import * as compras from './servicios/compras.js';
import * as revision from './servicios/revision.js';
import * as actividad from './servicios/actividad.js';
import * as fichaUP from './servicios/fichaUP.js';
import * as miBodega from './servicios/miBodega.js';
import * as proveedores from './servicios/proveedores.js';
import * as kardex from './servicios/kardex.js';
import * as saldosBodegas from './servicios/saldosBodegas.js';
import * as cargueDocs from './servicios/cargueDocumentos.js';
import * as cargueRit from './servicios/cargueRit.js';
import * as historialSubs from './servicios/historialSubsanacion.js';
import * as configuracion from './servicios/configuracion.js';
import * as archivos from './servicios/archivos.js';
import * as validador from './servicios/validador.js';
import * as agenda from './servicios/agenda.js';
import * as catalogo from './servicios/catalogo.js';
import * as carrito from './servicios/carrito.js';
import * as planCap from './servicios/planCapitalizacion.js';
import * as flujoPlan from './servicios/flujoPlan.js';
import * as entregaBeneficiario from './servicios/entregaBeneficiario.js';
import * as defectuosos from './servicios/defectuosos.js';
import * as alistamiento from './servicios/alistamiento.js';
import * as retiros from './servicios/retiros.js';
import * as metas from './servicios/metas.js';
import * as casos from './servicios/casos.js';
import * as comercial from './servicios/comercial.js';
import * as seguimiento from './servicios/seguimiento.js';
import * as clasificacion from './servicios/clasificacion.js';
import * as tenencia from './servicios/tenencia.js';
import * as asociados from './servicios/asociados.js';
import * as diagnostico from './servicios/diagnostico.js';
import * as coherencia from './servicios/coherencia.js';
import * as salida from './servicios/salida.js';
import * as formacion from './servicios/formacion.js';
import rutasTalleres from './rutasTalleres.js';

const router = express.Router();

// Envuelve un servicio asíncrono (usuario, datos) para responder su resultado como JSON.
const json = (fn, origen = 'query') => async (req, res, next) => {
  try {
    const datos = origen === 'body' ? (req.body || {}) : req.query;
    res.json(await fn(req.usuario, datos));
  } catch (err) {
    next(err);
  }
};

// Configuración de multer que guarda las cargas en disco temporal, porque los videos pueden pesar decenas de
// MB.
const subida = multer({
  dest: path.join(os.tmpdir(), 'bitacora-subidas'),
  limits: { fileSize: config.maxMbArchivo * 1024 * 1024, files: 12 },
});

// Borra los temporales que multer dejó y que no se movieron al almacén.
async function limpiarTemporales(req) {
  const lista = Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
  if (req.file) lista.push(req.file);
  await Promise.all(lista.map((f) => fs.unlink(f.path).catch(() => {})));
}

const auth = [autenticar(), configuracion.bloquearEscrituraEnMantenimiento];
router.use('/talleres', auth, rutasTalleres);

// Comprobación de estado pública para monitoreo; el detalle de un fallo solo se escribe en el registro del
// servidor y no se envía al cliente.
router.get('/salud', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, servicio: 'bitacora-api', db: 'ok' });
  } catch (err) {
    console.error('[salud] La base de datos no respondió:', err.message);
    res.status(503).json({ ok: false, servicio: 'bitacora-api', db: 'error', error: 'La base de datos no responde.' });
  }
});

// Bodega municipal asignada a la cuenta, de solo consulta.
router.get('/mi-bodega', auth, json(miBodega.misBodegas));
// Saldos de productos por bodega, limitados a las bodegas que corresponden a cada cuenta.
router.get('/saldos-bodegas', auth, json(saldosBodegas.saldosBodegas));

// Kardex: movimiento de la mercancía entre bodegas, de solo consulta.
router.get('/kardex', auth, json(kardex.kardex));
router.get('/kardex/saldos', auth, json(kardex.saldos));

// Proveedores compartidos con el inventario: listar, crear, editar y eliminar, según el permiso de cada cuenta.
router.get('/proveedores', auth, json(proveedores.listarProveedores));
router.post('/proveedores', auth, json(proveedores.crearProveedor, 'body'));
router.put('/proveedores', auth, json(proveedores.actualizarProveedor, 'body'));
router.delete('/proveedores', auth, json(proveedores.eliminarProveedor));
router.get('/proveedores/facturas', auth, json(proveedores.facturasDeProveedor));
router.get('/facturas/detalle', auth, json(proveedores.detalleFactura));
router.get('/facturas/adjunto', auth, async (req, res, next) => {
  try {
    const { buffer, nombre } = await proveedores.adjuntoFactura(req.usuario, req.query);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}` });
    res.send(buffer);
  } catch (err) { next(err); }
});

// Unidades productivas: listado, detalle, edición de la ficha y carga de la tenencia de la sede.
router.get('/unidades', auth, json(unidades.listarUnidades));
router.get('/unidades/detalle', auth, json(unidades.obtenerUnidad));
router.post('/unidades/editar', auth, json(fichaUP.editarUnidad, 'body'));
router.post('/unidades/tenencia', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    res.json(await tenencia.registrarTenencia(req.usuario, req.body || {}, req.file));
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.get('/gestores', auth, json(unidades.listarGestores));

// Asociados de la unidad productiva y actas de novedades de asociados.
router.get('/asociados', auth, json(asociados.listarAsociados));
router.get('/asociados/listas', auth, json(asociados.listasAsociados));
router.post('/asociados', auth, json(asociados.guardarAsociado, 'body'));
router.post('/asociados/quitar', auth, json(asociados.quitarAsociado, 'body'));
router.post('/asociados/acta', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    let datos = req.body || {};
    if (typeof datos.datos === 'string') {
      try { datos = JSON.parse(datos.datos); } catch { throw solicitudInvalida('El campo «datos» no es un JSON válido.'); }
    }
    res.json(await asociados.registrarActa(req.usuario, datos, req.file));
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
// Datos base de la herramienta de registro fotográfico, limitados al alcance de quien la abre.
router.get('/registro-fotografico', auth, json(unidades.datosRegistroFotografico));

// Expediente documental por etapas de cada unidad.
router.get('/documentos', auth, json(documentos.listarDocumentos));
router.get('/documentos/detalle', auth, json(documentos.obtenerDocumento));
// Cargue de la documentación, con consulta, edición y eliminación de lo cargado y el historial de subsanación.
router.post('/cargue', auth, exigirRol(ROLES.DATOS), json(documentos.aplicarCargue, 'body'));
router.get('/cargue/datos', auth, exigirRol(ROLES.DATOS), json(documentos.listarCargados));
router.post('/cargue/editar', auth, exigirRol(ROLES.DATOS), json(documentos.editarCargado, 'body'));
router.post('/cargue/eliminar', auth, exigirRol(ROLES.DATOS), json(documentos.eliminarCargados, 'body'));
router.post('/cargue/historial', auth, exigirRol(ROLES.DATOS), subida.single('archivo'), async (req, res, next) => {
  try { res.json(await historialSubs.iniciarHistorial(req.usuario, req.body || {}, req.file)); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.get('/cargue/historial', auth, json(historialSubs.listarHistorial));
router.get('/cargue/historial/cambios', auth, json(historialSubs.cambiosDeHistorial));
router.get('/cargue/historial/archivo', auth, async (req, res, next) => {
  try { await enviarDeDisco(res, await historialSubs.archivoDeHistorial(req.usuario, req.query)); } catch (err) { next(err); }
});

// Envía un archivo del disco admitiendo peticiones parciales, para que el video pueda adelantarse.
async function enviarDeDisco(res, a) {
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  await new Promise((ok, mal) => { res.sendFile(a.ruta, { dotfiles: 'allow' }, (e) => (e ? mal(e) : ok())); });
}

// Visitas: listado, guardado, archivos, aprobación de visitas virtuales, plazo de la tercera visita y formatos
// en blanco.
router.get('/visitas', auth, json(visitas.listarVisitas));
router.get('/visitas/coherencia', auth, json(coherencia.coherenciaCarpeta));
// Diagnóstico estructurado de la unidad por secciones, con su revisión y reenvío.
router.get('/diagnostico/esquema', auth, json(diagnostico.esquemaDiagnostico));
router.get('/diagnostico', auth, json(diagnostico.obtenerDiagnostico));
router.post('/diagnostico', auth, json(diagnostico.guardarSeccion, 'body'));
router.post('/diagnostico/revisar', auth, json(diagnostico.revisarDiagnostico, 'body'));
router.post('/diagnostico/reenviar', auth, json(diagnostico.reenviarDiagnostico, 'body'));
router.get('/formacion', auth, json(formacion.obtenerFormacion));
// Línea base y evaluación de salida de la tercera visita, con su revisión.
router.get('/evaluacion/esquema', auth, json(salida.esquemaSalida));
router.get('/evaluacion/tablero', auth, json(salida.tableroEvaluacion));
router.get('/evaluacion', auth, json(salida.obtenerEvaluacion));
router.post('/evaluacion', auth, json(salida.guardarSeccionSalida, 'body'));
router.post('/evaluacion/revisar', auth, json(salida.revisarEvaluacion, 'body'));
router.post('/evaluacion/reenviar', auth, json(salida.reenviarEvaluacion, 'body'));
router.post('/visitas', auth, json(visitas.guardarVisita, 'body'));
router.post('/visitas/aprobacion-virtual', auth, subida.single('archivo'), async (req, res, next) => {
  try { res.json(await visitas.registrarAprobacionVirtual(req.usuario, req.body || {}, req.file)); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.get('/visitas/plazo-v3', auth, json(visitas.plazoVisita3));
router.post('/visitas/archivo', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    res.json(await visitas.subirArchivoVisita(req.usuario, req.body || {}, req.file));
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.get('/visitas/archivo', auth, async (req, res, next) => {
  try { await enviarDeDisco(res, await visitas.obtenerSoporte(req.usuario, req.query)); } catch (err) { next(err); }
});
router.get('/visitas/formatos', auth, async (req, res, next) => {
  try {
    if (req.query.nombre) await enviarDeDisco(res, await visitas.obtenerFormato(req.usuario, req.query));
    else res.json(await visitas.listarFormatos(req.usuario));
  } catch (err) { next(err); }
});
router.post('/visitas/formatos', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    res.json(await visitas.subirFormato(req.usuario, req.body || {}, req.file));
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.delete('/visitas/formatos', auth, json(visitas.eliminarFormato));

// Eventos: listar, guardar, eliminar y responder.
router.get('/eventos', auth, json(comunicaciones.listarEventos));
router.put('/eventos', auth, json(comunicaciones.guardarEvento, 'body'));
router.delete('/eventos', auth, json(comunicaciones.eliminarEvento));
router.patch('/eventos/respuesta', auth, json(comunicaciones.responderEvento, 'body'));

// Avisos que se muestran en la pestaña de novedades: listar, guardar, eliminar y marcar como leídos.
router.get('/avisos', auth, json(comunicaciones.listarAvisos));
router.put('/avisos', auth, json(comunicaciones.guardarAviso, 'body'));
router.delete('/avisos', auth, json(comunicaciones.eliminarAviso));
router.patch('/avisos/lectura', auth, json(comunicaciones.marcarAvisoLeido, 'body'));

router.get('/items-ups', auth, json(compras.listarItemsUPs));
router.get('/items-ups/detalle', auth, json(compras.obtenerItemUP));
router.post('/items-ups/detalle', auth, json(compras.guardarItemUP, 'body'));
router.post('/cargue/documentos', auth, json(cargueDocs.cargarDocumentos, 'body'));
router.post('/cargue/rit', auth, json(cargueRit.cargarRit, 'body'));
router.post('/cargue/compras', auth, json(compras.cargarCompras, 'body'));
router.post('/cargue/entregas', auth, json(entregas.cargarEntregas, 'body'));

router.get('/entregas', auth, json(entregas.listarEntregas));
router.post('/entregas', auth, json(entregas.accionEntrega, 'body'));
router.post('/entregas/revision', auth, json(entregas.revisarActa, 'body'));
router.get('/entregas/acta', auth, async (req, res, next) => {
  try {
    const a = await entregas.obtenerActa(req.usuario, req.query);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    await new Promise((ok, mal) => { res.sendFile(a.ruta, { dotfiles: 'allow' }, (e) => (e ? mal(e) : ok())); });
  } catch (err) { next(err); }
});
router.get('/estados-entrega', auth, json(entregas.estadosEntrega));

router.get('/config', auth, json(configuracion.leerConfig));
router.post('/config', auth, json(configuracion.accionConfig, 'body'));

router.get('/actividad', auth, json(actividad.listarActividad));

router.get('/revision-entregas', auth, json(revision.listarRevision));
router.post('/revision-entregas', auth, json(revision.guardarRevision, 'body'));
router.get('/revision-entregas/archivo', auth, async (req, res, next) => {
  try {
    const a = await revision.obtenerArchivoRevision(req.usuario, req.query);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    await new Promise((ok, mal) => { res.sendFile(a.ruta, { dotfiles: 'allow' }, (e) => (e ? mal(e) : ok())); });
  } catch (err) { next(err); }
});

router.get('/agenda', auth, json(agenda.listarCitas));
router.get('/agenda/contactos', auth, json(agenda.contactosIniciativa));
router.post('/agenda/guardar', auth, json(agenda.guardarCita, 'body'));
router.post('/agenda/estado', auth, json(agenda.cambiarEstadoCita, 'body'));
router.delete('/agenda', auth, json(agenda.eliminarCita));

router.get('/clasificacion', auth, json(clasificacion.listas));
router.get('/unspsc', auth, json(clasificacion.buscarUnspsc));
router.post('/unspsc/importar', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    res.json(await clasificacion.importarUnspsc(req.usuario, req.file));
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.get('/catalogo', auth, json(catalogo.listarCatalogo));
router.post('/catalogo/guardar', auth, json(catalogo.guardarProducto, 'body'));
router.delete('/catalogo', auth, json(catalogo.eliminarProducto));
router.post('/catalogo/importar', auth, subida.single('archivo'), async (req, res, next) => {
  try {
    res.json(await catalogo.importarCatalogo(req.usuario, req.file));
  } catch (err) {
    next(err);
  } finally {
    await limpiarTemporales(req);
  }
});
router.get('/carritos', auth, json(carrito.listarCarritos));
router.get('/carritos/detalle', auth, json(carrito.detalleCarrito));
router.post('/carritos/linea', auth, json(carrito.ponerLinea, 'body'));
router.post('/carritos/vaciar', auth, json(carrito.vaciarCarrito, 'body'));
router.post('/carritos/datos', auth, json(carrito.guardarDatos, 'body'));
router.post('/carritos/estado', auth, json(carrito.cambiarEstado, 'body'));
router.post('/carritos/justificacion', auth, json(carrito.guardarJustificacion, 'body'));
router.post('/carritos/plan-negocio', auth, json(planCap.guardarPlanNegocio, 'body'));
router.post('/carritos/adecuaciones', auth, json(planCap.guardarAdecuaciones, 'body'));
router.get('/carritos/proveedores', auth, json(planCap.proveedoresParaCotizar));
router.post('/carritos/cotizacion', auth, subida.single('archivo'), async (req, res, next) => {
  try { res.json(await planCap.agregarCotizacion(req.usuario, req.body || {}, req.file)); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
router.post('/carritos/cotizacion/quitar', auth, json(planCap.quitarCotizacion, 'body'));
router.post('/carritos/cotizacion/elegir', auth, json(planCap.elegirCotizacion, 'body'));
router.post('/carritos/evaluacion', auth, json(planCap.evaluarActivo, 'body'));
router.get('/carritos/plan-pdf', auth, async (req, res, next) => {
  try {
    const { buffer, nombre } = await planCap.pdfPlan(req.usuario, req.query);
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}` }).send(buffer);
  } catch (err) { next(err); }
});
router.post('/carritos/firma', auth, subida.single('archivo'), async (req, res, next) => {
  try { res.json(await planCap.registrarFirma(req.usuario, req.body || {}, req.file)); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});
const conArchivo = (fn) => [subida.single('archivo'), async (req, res, next) => {
  try { res.json(await fn(req.usuario, req.body || {}, req.file)); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
}];
router.post('/carritos/viabilidad', auth, ...conArchivo(flujoPlan.registrarViabilidad));
router.post('/carritos/subsanacion/reabrir', auth, json(flujoPlan.reabrirSubsanacion, 'body'));
router.post('/carritos/ficha-tecnica', auth, ...conArchivo(flujoPlan.cargarFichaTecnica));
router.post('/carritos/ficha-tecnica/aprobacion', auth, ...conArchivo(flujoPlan.aprobarFichaTecnica));
router.get('/comites', auth, json(flujoPlan.listarComites));
router.get('/comites/planes', auth, json(flujoPlan.planesParaComite));
router.post('/comites', auth, ...conArchivo(flujoPlan.registrarComite));
router.get('/comites/acta', auth, async (req, res, next) => {
  try {
    const { buffer, nombre } = await flujoPlan.actaComite(req.usuario, req.query);
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}` }).send(buffer);
  } catch (err) { next(err); }
});
router.get('/capitalizacion/legalizacion', auth, json(flujoPlan.legalizacion));

router.post('/carritos/recomendaciones', auth, ...conArchivo(entregaBeneficiario.cargarRecomendaciones));
router.post('/carritos/acta-recibido', auth, ...conArchivo(entregaBeneficiario.registrarActaRecibido));
router.get('/entregas/defectuosos', auth, json(defectuosos.listarDefectuosos));
router.post('/entregas/defectuosos/recibido', auth, json(defectuosos.marcarRecibido, 'body'));
router.get('/entregas/defectuosos/acta', auth, async (req, res, next) => {
  try {
    const { buffer, nombre } = await defectuosos.actaDefectuoso(req.usuario, req.query);
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}` }).send(buffer);
  } catch (err) { next(err); }
});

const subidaVarios = multer({
  dest: path.join(os.tmpdir(), 'bitacora-subidas'),
  limits: { fileSize: config.maxMbArchivo * 1024 * 1024, files: 22 },
});
const conArchivos = (fn, campos) => [subidaVarios.fields(campos), async (req, res, next) => {
  try { res.json(await fn(req.usuario, req.body || {}, req.files || {})); } catch (err) { next(err); } finally { await limpiarTemporales(req); }
}];
const enviarBinario = (obtener) => async (req, res, next) => {
  try {
    const { buffer, nombre, tipo } = await obtener(req.usuario, req.query);
    res.set({ 'Content-Type': tipo || 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}` }).send(buffer);
  } catch (err) { next(err); }
};
router.get('/tickets', auth, json(tickets.listarTickets));
router.post('/tickets', auth, ...conArchivos(tickets.crearTicket, [{ name: 'adjuntos', maxCount: 5 }]));
router.post('/tickets/gestion', auth, ...conArchivos(tickets.gestionarTicket, [{ name: 'adjuntos', maxCount: 5 }]));
router.get('/tickets/asignables', auth, json(tickets.asignables));
router.get('/tickets/adjunto', auth, enviarBinario(tickets.adjuntoTicket));
router.get('/alistamiento/gestores', auth, json(alistamiento.cargaGestores));
router.post('/alistamiento/mover-up', auth, json(alistamiento.moverUP, 'body'));
router.get('/alistamiento/equipo', auth, json(alistamiento.equipo));
router.get('/alistamiento/eventos', auth, json(alistamiento.listarEventos));
router.post('/alistamiento/eventos', auth, ...conArchivos(alistamiento.registrarEvento,
  [{ name: 'lista', maxCount: 1 }, { name: 'acta', maxCount: 1 }, { name: 'presentacion', maxCount: 1 }, { name: 'fotos', maxCount: 20 }]));
router.get('/alistamiento/eventos/adjunto', auth, enviarBinario(alistamiento.adjuntoEvento));
router.get('/retiros', auth, json(retiros.listarRetiros));
router.post('/retiros', auth, ...conArchivos(retiros.registrarRetiro, [{ name: 'acta', maxCount: 1 }]));
router.post('/retiros/reemplazo', auth, ...conArchivos(retiros.registrarReemplazo, [{ name: 'acta', maxCount: 1 }, { name: 'acta_comite', maxCount: 1 }]));
router.get('/retiros/unidades', auth, json(retiros.estadoUnidades));
router.get('/retiros/acta', auth, enviarBinario(retiros.actaRetiro));

router.get('/metas', auth, json(metas.listarMetas));
router.post('/metas', auth, json(metas.guardarMetas, 'body'));
router.get('/casos', auth, json(casos.listarCasos));
router.post('/casos', auth, ...conArchivos(casos.registrarCaso, [{ name: 'fotos', maxCount: 10 }, { name: 'documento', maxCount: 1 }]));
router.post('/casos/documentar', auth, json(casos.documentarCaso, 'body'));
router.get('/casos/adjunto', auth, enviarBinario(casos.adjuntoCaso));
router.get('/comercial', auth, json(comercial.listarGestiones));
router.post('/comercial', auth, ...conArchivos(comercial.registrarGestion, [{ name: 'soporte', maxCount: 1 }]));
router.get('/comercial/soporte', auth, enviarBinario(comercial.soporteGestion));

router.get('/seguimiento/panel', auth, json(seguimiento.panel));
router.get('/seguimiento/indicadores', auth, json(seguimiento.indicadores));
router.get('/seguimiento/ruta', auth, json(seguimiento.rutaOperacion));
router.get('/seguimiento/formacion', auth, json(seguimiento.reporteFormacion));
router.get('/seguimiento/alertas', auth, json(seguimiento.alertas));
router.get('/seguimiento/mensual', auth, json(seguimiento.consolidadoMensual));
router.get('/seguimiento/mensual/archivo', auth, enviarBinario(seguimiento.archivoMensual));
router.get('/seguimiento/informes', auth, json(seguimiento.listarInformes));
router.get('/seguimiento/informes/archivo', auth, enviarBinario(seguimiento.informeArchivo));
router.get('/seguimiento/kokan', auth, json(seguimiento.exportarKokan));
router.get('/seguimiento/informe-up', auth, enviarBinario(seguimiento.informeTecnicoUP));
router.get('/seguimiento/soportes', auth, json(seguimiento.soportesUP));
router.get('/seguimiento/soportes/archivo', auth, enviarBinario(seguimiento.archivoSoporte));
router.post('/seguimiento/soportes/verificar', auth, json(seguimiento.verificarSoporte, 'body'));
router.get('/seguimiento/multimedia', auth, json(seguimiento.multimediaMensual));

async function enviarArchivo(req, res, contenedor, nombre) {
  const a = await archivos.obtenerArchivo(req.usuario, { contenedor, nombre });
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(path.posix.basename(a.nombre))}`);
  res.setHeader('Cache-Control', 'private, no-store');
  await new Promise((resolve, reject) => {
    res.sendFile(a.ruta, { dotfiles: 'allow' }, (err) => (err ? reject(err) : resolve()));
  });
}

const authArchivo = auth;

router.get('/archivos', authArchivo, async (req, res, next) => {
  try {
    const contenedor = archivos.contenedorDeOrigen(req.query.origen);
    if (req.query.action === 'list') {
      res.json(await archivos.listarPorPrefijo(req.usuario, { contenedor, prefijo: req.query.id }));
    } else if (req.query.action === 'get') {
      await enviarArchivo(req, res, contenedor, req.query.blobName);
    } else {
      throw solicitudInvalida('action debe ser list o get.');
    }
  } catch (err) { next(err); }
});

router.get(/^\/archivos\/([^/]+)\/(.+)$/, authArchivo, async (req, res, next) => {
  try {
    const contenedor = req.params[0];
    const nombre = req.params[1].split('/').map(decodeURIComponent).join('/');
    await enviarArchivo(req, res, contenedor, nombre);
  } catch (err) { next(err); }
});

router.post('/archivos', auth, exigirRol(ROLES.COORDINADOR, ROLES.COMPRAS),
  subida.single('archivo'), async (req, res, next) => {
    try {
      const contenedor = String(req.body?.contenedor || '');
      if (!['carritos', 'prellenados'].includes(contenedor)) {
        throw solicitudInvalida('contenedor debe ser carritos o prellenados.');
      }
      if (!req.file) throw solicitudInvalida('Falta el archivo.');
      const nombre = archivos.nombreSeguro(req.body?.nombre || req.file.originalname);
      if (contenedor === 'carritos' && archivos.esArchivoDelPlan(nombre)) {
        throw new HttpError(409, 'Ese archivo lo administra el plan de capitalización: se carga desde la pestaña «Plan de capitalización».');
      }
      const permitidas = contenedor === 'carritos' ? ['.pdf'] : ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];
      if (!permitidas.includes(path.extname(String(nombre)).toLowerCase())) {
        throw solicitudInvalida(contenedor === 'carritos'
          ? 'El archivo del carrito debe ser PDF.' : 'El formato debe ser PDF, Word o Excel.');
      }
      const up = await unidades.buscarUP({ idUnico: req.body?.id_unico, documento: req.body?.unidad_doc });
      if (tieneAlcance(req.usuario)) exigirAlcance(req.usuario, up);
      if (contenedor === 'carritos' && nombre.includes('/') && nombre.split('/')[0] !== String(up?.id_unico ?? '').replace(/[^A-Za-z0-9_-]/g, '_')) {
        throw solicitudInvalida('El archivo del carrito va en la carpeta de su iniciativa (id_unico).');
      }
      const { reemplazado, ...item } = await archivos.guardarArchivo({
        contenedor, nombre, archivo: req.file, idUp: up?.id_up ?? null, usuario: req.usuario,
      });
      await actividad.registrar(req.usuario, {
        accion: reemplazado ? 'archivos.reemplazar' : 'archivos.subir', objeto: { tipo: 'archivo', id: `${contenedor}/${item.nombre}`.slice(0, 300) },
        idUnico: up?.id_unico ?? null, cambios: { contenedor, nombre: item.nombre, tamano: req.file.size ?? null },
      });
      res.json({ ok: true, item });
    } catch (err) { next(err); } finally { await limpiarTemporales(req); }
  });

const camposValidador = subida.fields([
  ...['archivo_frontal', 'archivo_trasera', 'archivo_cedula_pdf', ...validador.DOCS_ENTREGA.map((d) => d.campo)]
    .map((name) => ({ name, maxCount: 1 })),
]);

router.post('/validador', auth, camposValidador, async (req, res, next) => {
  try {
    const recibidos = {};
    for (const [campo, lista] of Object.entries(req.files || {})) recibidos[campo] = lista[0];
    const { status, cuerpo } = await validador.procesar(req.usuario, req.body || {}, recibidos);
    res.status(status).json(cuerpo);
  } catch (err) { next(err); } finally { await limpiarTemporales(req); }
});

export default router;
