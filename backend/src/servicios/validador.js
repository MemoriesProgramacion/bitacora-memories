// Validador de documentos de entrega. Recibe peticiones multipart con una acción (comprobar, subir, guardar
// correo, descargar prellenados o revisar) y responde con éxito o error y un mensaje. No hay OCR: los soportes
// quedan en revisión y la coordinación los aprueba o los devuelve.
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { config, ROLES } from '../config.js';
import { prohibido } from '../errores.js';
import { txt } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { esSoloLectura, MENSAJE_SOLO_LECTURA } from '../auth.js';
import { guardarArchivo, leerBase64 } from './archivos.js';
import { contenidoValido, extensionPorContenido, tipoPorNombre } from './tipoArchivo.js';
import { registrar, diferenciasCortas, diferenciasSinDatos } from './actividad.js';

// Documentos de la entrega; debe coincidir con los del frontend.
export const DOCS_ENTREGA = [
  { clave: 'orden_pedido',         label: 'Formato de Orden de Pedido',         campo: 'archivo_orden',                blob: 'ORDEN DE PEDIDO',              tipo: 'pdf' },
  { clave: 'entrega_activos',      label: 'Formato de Entrega de Activos',      campo: 'archivo_entrega',              blob: 'ENTREGA ACTIVOS',              tipo: 'pdf' },
  { clave: 'recibo_satisfaccion',  label: 'Recibo a Satisfacción',              campo: 'archivo_satisfaccion',         blob: 'SATISFACCION ENTREGA ACTIVOS', tipo: 'pdf' },
  { clave: 'registro_fotografico', label: 'Registro fotográfico de la entrega', campo: 'archivo_registro_fotografico', blob: 'REGISTRO FOTOGRAFICO ENTREGA', tipo: 'pdf' },
  { clave: 'video_entrega',        label: 'Video de la entrega',                campo: 'archivo_video',                blob: 'VIDEO ENTREGA',                tipo: 'video' },
  { clave: 'acta_parcial',         label: 'Acta de novedad — entrega parcial',  campo: 'archivo_acta_parcial',         blob: 'ACTA NOVEDAD ENTREGA PARCIAL', tipo: 'pdf' },
  { clave: 'acta_no_entrega',      label: 'Acta de novedad — no entrega',       campo: 'archivo_acta_no_entrega',      blob: 'ACTA NOVEDAD NO ENTREGA',      tipo: 'pdf' },
];

// Soportes que exige cada tipo de entrega; la cédula se pide en los tres. Debe coincidir con los del frontend.
export const SOPORTES_POR_TIPO = {
  completa: ['orden_pedido', 'entrega_activos', 'recibo_satisfaccion', 'registro_fotografico', 'video_entrega'],
  parcial: ['acta_parcial', 'registro_fotografico'],
  no_entrega: ['acta_no_entrega'],
};
export const TIPO_ENTREGA_POR_DEFECTO = 'completa';
export const docsDeTipo = (tipo) => (SOPORTES_POR_TIPO[tipo] || SOPORTES_POR_TIPO.completa)
  .map((clave) => DOCS_ENTREGA.find((d) => d.clave === clave));
const DOCS_CEDULA = [
  { clave: 'cedula_frontal', campo: 'archivo_frontal',    blob: 'CEDULA FRONTAL', tipo: 'imagen' },
  { clave: 'cedula_trasera', campo: 'archivo_trasera',    blob: 'CEDULA TRASERA', tipo: 'imagen' },
  { clave: 'cedula_pdf',     campo: 'archivo_cedula_pdf', blob: 'CEDULA',         tipo: 'pdf' },
];
const EXT_VIDEO = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp'];
const EXT_IMAGEN = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

// Responde un error de negocio con estado 200 y exito en falso, para que el formulario muestre el mensaje tal
// cual.
const fallo = (mensaje) => ({ status: 200, cuerpo: { exito: false, mensaje } });
const exito = (datos) => ({ status: 200, cuerpo: { exito: true, ...datos } });

const limpiaCedula = (v) => String(v || '').replace(/\D/g, '');

// Busca la unidad del beneficiario por el documento de su representante.
async function upDeCedula(cedula) {
  const { rows } = await query(
    `SELECT up.id_up, up.id_unico, up.nombre AS unidad_nombre, up.nit, up.actividad, up.sector,
            up.departamento, up.municipio, up.modalidad, t.nodo, t.region,
            r.nombre_completo, r.telefono1, r.correo1
       FROM representantes r
       JOIN unidades_productivas up ON up.id_representante = r.id_representante
       LEFT JOIN triadas t          ON t.id_triada = up.id_triada
      WHERE r.documento = $1 OR r.documento_inicial = $1
      ORDER BY up.id_up LIMIT 1`,
    [cedula],
  );
  return rows[0] || null;
}

async function ciudadanoDe(cedula) {
  const { rows } = await query(
    `SELECT c.*, t.nodo AS nodo_up, t.region AS region_up,
            up.departamento AS departamento_up, up.modalidad AS modalidad_up, up.id_unico AS id_unico_up
       FROM ciudadanos c
       LEFT JOIN unidades_productivas up ON up.id_up = c.id_up
       LEFT JOIN triadas t               ON t.id_triada = up.id_triada
      WHERE c.cedula = $1`,
    [cedula],
  );
  return rows[0] || null;
}

// Crea el registro del ciudadano a partir de su unidad si todavía no existe.
async function asegurarCiudadano(cedula, up) {
  const existente = await ciudadanoDe(cedula);
  if (existente) return existente;
  await query(
    `INSERT INTO ciudadanos (id_origen, id_up, cedula, nombre_completo, estado_validacion,
                             departamento, municipio, negocio_nombre_unidad, negocio_nit,
                             negocio_actividad, negocio_sector, celular, email)
     VALUES ($1, $2, $1, $3, 'pendiente', $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (cedula) DO NOTHING`,
    [cedula, up.id_up, up.nombre_completo || cedula, up.departamento, up.municipio,
      up.unidad_nombre, up.nit, up.actividad, up.sector, up.telefono1, up.correo1],
  );
  return ciudadanoDe(cedula);
}

// Comprueba que la unidad esté dentro del alcance de quien opera, a partir de su nodo, región, departamento y
// modalidad.
function verificarAlcance(usuario, up) {
  exigirAlcance(usuario, up, 'Esa cédula no pertenece a una unidad productiva de tu alcance.');
}

// Devuelve el territorio de la unidad de un ciudadano ya guardado.
const territorioDe = (c) => c && ({
  nodo: c.nodo_up, region: c.region_up, departamento: c.departamento_up, modalidad: c.modalidad_up,
});

async function documentosDe(idCiudadano) {
  const { rows } = await query(
    `SELECT td.codigo, cd.url, cd.estado, cd.observacion, cd.fecha_carga
       FROM ciudadano_documentos cd
       JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
      WHERE cd.id_ciudadano = $1`,
    [idCiudadano],
  );
  return rows;
}

// Calcula el estado global a partir del estado de cada soporte obligatorio.
export function estadoGlobal(docs, tipo = TIPO_ENTREGA_POR_DEFECTO) {
  const porClave = Object.fromEntries(docs.map((d) => [d.codigo, d]));
  const exigidos = docsDeTipo(tipo);
  const soportes = exigidos.map((d) => porClave[d.clave]).filter(Boolean);
  if (!soportes.length) return 'pendiente';
  if (soportes.some((d) => d.estado === 'rechazado')) return 'correcciones';
  if (soportes.length === exigidos.length && soportes.every((d) => d.estado === 'aprobado')) return 'completo';
  return 'en_revision';
}

async function recalcularEstado(idCiudadano) {
  const { rows: [c] } = await query('SELECT tipo_entrega FROM ciudadanos WHERE id_ciudadano = $1', [idCiudadano]);
  const estado = estadoGlobal(await documentosDe(idCiudadano), c?.tipo_entrega);
  await query(
    `UPDATE ciudadanos SET estado_validacion = $2::text,
            fecha_validacion = CASE WHEN $2::text = 'completo' THEN now() ELSE fecha_validacion END
      WHERE id_ciudadano = $1`,
    [idCiudadano, estado],
  );
  return estado;
}

// Acción que comprueba qué soportes tiene cargados un beneficiario.
async function check(usuario, cedula) {
  const up = await upDeCedula(cedula);
  const c = await ciudadanoDe(cedula);
  if (!up && !c) return fallo('Beneficiario no encontrado.');
  verificarAlcance(usuario, up ?? territorioDe(c));

  if (!c) {
    return exito({
      nombre: up.nombre_completo, tipo: null, tipo_entrega: TIPO_ENTREGA_POR_DEFECTO, estado_validacion: 'pendiente',
      por_corregir: [], documentos_cargados: [],
    });
  }
  const tipoEntrega = c.tipo_entrega || TIPO_ENTREGA_POR_DEFECTO;
  const docs = await documentosDe(c.id_ciudadano);
  const porClave = Object.fromEntries(docs.map((d) => [d.codigo, d]));
  return exito({
    nombre: c.nombre_completo,
    tipo: c.tipo_clasificacion,
    tipo_entrega: tipoEntrega,
    estado_validacion: c.estado_validacion || estadoGlobal(docs, tipoEntrega),
    por_corregir: docsDeTipo(tipoEntrega)
      .filter((d) => porClave[d.clave]?.estado === 'rechazado')
      .map((d) => ({ clave: d.clave, label: d.label, observacion: porClave[d.clave].observacion || '' })),
    documentos_cargados: DOCS_ENTREGA
      .filter((d) => porClave[d.clave])
      .map((d) => ({ clave: d.clave, url: porClave[d.clave].url, estado: porClave[d.clave].estado })),
    correo_gestor: c.correo_gestor,
    correo_personal: c.email,
  });
}

// Acción que guarda el correo del beneficiario.
async function guardarCorreo(usuario, cedula, campos) {
  const up = await upDeCedula(cedula);
  if (!up) return fallo('Beneficiario no encontrado.');
  verificarAlcance(usuario, up);
  const c = await asegurarCiudadano(cedula, up);
  const { rows: [nuevo] } = await query(
    `UPDATE ciudadanos SET correo_gestor = coalesce($2, correo_gestor), email = coalesce($3, email)
      WHERE id_ciudadano = $1 RETURNING correo_gestor, email`,
    [c.id_ciudadano, txt(campos.correo_gestor), txt(campos.correo_personal)],
  );
  await registrar(usuario, {
    accion: 'validador.correo', objeto: { tipo: 'beneficiario', id: c.id_ciudadano }, idUnico: up.id_unico,
    cambios: { campos: diferenciasSinDatos(c, nuevo || {}, ['correo_gestor', 'email'], ['correo_gestor', 'email']) },
  });
  return exito({});
}

// Acción que entrega los formatos prediligenciados del beneficiario.
async function descargarPrellenados(usuario, cedula) {
  const up = await upDeCedula(cedula);
  if (!up) return fallo('Beneficiario no encontrado.');
  verificarAlcance(usuario, up);
  const documentos = await leerBase64('prellenados', `${cedula}/`);
  if (!documentos.length) {
    return exito({ documentos: [], mensaje: 'Documentos prediligenciados no encontrados o aún sin cargar.' });
  }
  return exito({ documentos });
}

// Extensiones que cuentan como cada tipo de soporte al deducirlas del contenido.
const EXT_DE_TIPO = {
  pdf: ['.pdf'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v', '.wmv', '.mpeg', '.mpg', '.mts', '.m2ts'],
  imagen: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp'],
};

// Devuelve la extensión con que se guarda el soporte: la del archivo si el contenido corresponde, o la deducida
// del contenido si llega sin extensión o con una desconocida.
export async function extGuardada(def, f) {
  const ext = path.extname(f.originalname || '').toLowerCase();
  if (tipoPorNombre(`x${ext}`)) {
    if (EXT_DE_TIPO[def.tipo] && !EXT_DE_TIPO[def.tipo].includes(ext)) return null;
    return (await contenidoValido(f.path, `x${ext}`)) ? ext : null;
  }
  const real = await extensionPorContenido(f.path);
  return real && (EXT_DE_TIPO[def.tipo] || []).includes(real) ? real : null;
}

// Valida el tamaño, la extensión y el contenido de un soporte subido.
function validarArchivo(def, f) {
  const ext = path.extname(f.originalname || '').toLowerCase();
  const mb = f.size / (1024 * 1024);
  if (def.tipo === 'pdf') {
    if (ext !== '.pdf') return `"${def.label || def.clave}" debe ser un archivo PDF.`;
    if (mb > config.maxMbPdf) return `"${def.label || def.clave}" supera ${config.maxMbPdf} MB.`;
  } else if (def.tipo === 'video') {
    if (!EXT_VIDEO.includes(ext) && !(f.mimetype || '').startsWith('video/')) {
      return `"${def.label}" debe ser un archivo de video.`;
    }
    if (mb > config.maxMbVideo) return `"${def.label}" supera ${config.maxMbVideo} MB.`;
  } else if (def.tipo === 'imagen') {
    if (!EXT_IMAGEN.includes(ext) && !(f.mimetype || '').startsWith('image/')) {
      return 'Las fotos de la cédula deben ser imágenes.';
    }
    if (mb > config.maxMbPdf) return `La foto de la cédula supera ${config.maxMbPdf} MB.`;
  }
  return '';
}

// Acción que recibe y guarda un soporte del beneficiario.
async function upload(usuario, cedula, campos, archivos) {
  const up = await upDeCedula(cedula);
  if (!up) return fallo('Beneficiario no encontrado.');
  verificarAlcance(usuario, up);
  const c = await asegurarCiudadano(cedula, up);
  const previos = Object.fromEntries((await documentosDe(c.id_ciudadano)).map((d) => [d.codigo, d]));
  const recibidos = (def) => archivos[def.campo];

  const tipoPedido = txt(campos.tipo_entrega);
  if (tipoPedido && !SOPORTES_POR_TIPO[tipoPedido]) return fallo('Tipo de entrega no válido.');
  const tipoActual = c.tipo_entrega || TIPO_ENTREGA_POR_DEFECTO;
  const tipo = tipoPedido || tipoActual;
  const hayCargados = DOCS_ENTREGA.some((d) => previos[d.clave]);
  if (tipo !== tipoActual && hayCargados && c.estado_validacion !== 'correcciones' && tipoActual === 'completa') {
    return fallo('Una entrega completa ya enviada no puede cambiar de tipo.');
  }
  const exigidos = docsDeTipo(tipo);
  const noCorresponde = DOCS_ENTREGA.find((d) => recibidos(d) && !exigidos.includes(d));
  if (noCorresponde) return fallo(`"${noCorresponde.label}" no se pide en una entrega ${tipo.replace('_', ' ')}.`);
  const faltan = exigidos.filter((d) => !previos[d.clave] && !recibidos(d)).map((d) => d.label);
  if (faltan.length) return fallo(`Faltan soportes obligatorios: ${faltan.join(', ')}.`);
  const cedulaPrevia = !!previos.cedula_pdf || (!!previos.cedula_frontal && !!previos.cedula_trasera);
  if (!cedulaPrevia) {
    const modo = txt(campos.modo_cedula) === 'pdf' ? 'pdf' : 'foto';
    const cedulaOk = modo === 'pdf'
      ? !!archivos.archivo_cedula_pdf
      : !!(archivos.archivo_frontal && archivos.archivo_trasera);
    if (!cedulaOk) return fallo('Falta la cédula (las dos caras o el PDF).');
  }

  const aGuardar = [...DOCS_CEDULA, ...DOCS_ENTREGA].filter((d) => recibidos(d));
  if (!aGuardar.length) return fallo('No llegó ningún archivo.');
  const aprobado = aGuardar.find((d) => previos[d.clave]?.estado === 'aprobado');
  if (aprobado) return fallo(`"${aprobado.label || aprobado.clave}" ya fue aprobado y no se puede reemplazar.`);
  for (const d of aGuardar) {
    const f = recibidos(d);
    const err = validarArchivo(d, f);
    if (err) return fallo(err);
    f.extGuardada = await extGuardada(d, f);
    if (!f.extGuardada) {
      return fallo(`El contenido de "${d.label || d.clave}" no corresponde a su tipo de archivo.`);
    }
  }

  const choque = await transaccion(async (db) => {
    await db.query('SELECT 1 FROM ciudadanos WHERE id_ciudadano = $1 FOR UPDATE', [c.id_ciudadano]);
    const actuales = Object.fromEntries((await db.query(
      `SELECT td.codigo, cd.estado FROM ciudadano_documentos cd
         JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
        WHERE cd.id_ciudadano = $1`, [c.id_ciudadano])).rows.map((r) => [r.codigo, r.estado]));
    const ya = aGuardar.find((d) => actuales[d.clave] === 'aprobado');
    if (ya) return `"${ya.label || ya.clave}" ya fue aprobado y no se puede reemplazar.`;
    for (const d of aGuardar) {
      const f = recibidos(d);
      const nombre = `${d.blob}_${cedula}${f.extGuardada}`;
      const r = await guardarArchivo({ contenedor: 'entrega-activos', nombre, archivo: f, idUp: up.id_up, usuario }, db);
      await db.query(
        `INSERT INTO ciudadano_documentos (id_ciudadano, id_tipo_documento, url, estado, observacion, fecha_carga)
         SELECT $1, id_tipo_documento, $3, 'en_revision', NULL, now()
           FROM tipos_documento WHERE codigo = $2
         ON CONFLICT (id_ciudadano, id_tipo_documento) DO UPDATE
           SET url = EXCLUDED.url, estado = 'en_revision', observacion = NULL, fecha_carga = now(),
               fecha_revision = NULL, revisado_por = NULL`,
        [c.id_ciudadano, d.clave, r.url],
      );
    }
    return null;
  });
  if (choque) return fallo(choque);
  if (archivos.archivo_cedula_pdf || archivos.archivo_frontal) {
    await query('UPDATE ciudadanos SET cedula_modo = $2 WHERE id_ciudadano = $1',
      [c.id_ciudadano, archivos.archivo_cedula_pdf ? 'pdf' : 'foto']);
  }
  await query('UPDATE ciudadanos SET intentos_validacion = coalesce(intentos_validacion, 0) + 1, tipo_entrega = $2 WHERE id_ciudadano = $1',
    [c.id_ciudadano, tipo]);
  const estado = await recalcularEstado(c.id_ciudadano);
  return exito({ nombre: c.nombre_completo, estado_validacion: estado });
}

// Acción de revisión manual de un soporte: aprobado o rechazado, con observación.
async function revisar(usuario, cedula, campos) {
  if (usuario.rol !== ROLES.COORDINADOR) throw prohibido('Solo coordinación revisa los soportes.');
  const clave = txt(campos.clave);
  const estado = txt(campos.estado);
  if (!DOCS_ENTREGA.some((d) => d.clave === clave)) return fallo('Soporte desconocido.');
  if (!['aprobado', 'rechazado'].includes(estado)) return fallo('El estado debe ser aprobado o rechazado.');
  if (estado === 'rechazado' && !txt(campos.observacion)) return fallo('Indica la observación para el gestor.');
  const c = await ciudadanoDe(cedula);
  if (!c) return fallo('Beneficiario no encontrado.');
  verificarAlcance(usuario, territorioDe(c));
  const r = await query(
    `WITH previo AS (
        SELECT cd.id_ciudadano, cd.id_tipo_documento, cd.estado, cd.observacion
          FROM ciudadano_documentos cd JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
         WHERE cd.id_ciudadano = $1 AND td.codigo = $2
     )
     UPDATE ciudadano_documentos cd SET estado = $3, observacion = $4
       FROM previo p
      WHERE cd.id_ciudadano = p.id_ciudadano AND cd.id_tipo_documento = p.id_tipo_documento
      RETURNING p.estado AS estado_antes, p.observacion AS observacion_antes, cd.observacion`,
    [c.id_ciudadano, clave, estado, estado === 'rechazado' ? txt(campos.observacion) : null],
  );
  if (!r.rowCount) return fallo('Ese soporte aún no se ha cargado.');
  const estadoValidacion = await recalcularEstado(c.id_ciudadano);
  const f = r.rows[0];
  await registrar(usuario, {
    accion: 'validador.revisar', objeto: { tipo: 'beneficiario', id: c.id_ciudadano }, idUnico: c.id_unico_up ?? null,
    cambios: {
      soporte: clave,
      campos: diferenciasCortas(
        { estado: f.estado_antes, observacion: f.observacion_antes, estado_validacion: c.estado_validacion },
        { estado, observacion: f.observacion, estado_validacion: estadoValidacion },
        ['estado', 'observacion', 'estado_validacion']),
    },
  });
  return exito({ estado_validacion: estadoValidacion });
}

// Devuelve el beneficiario para la actividad: su id interno, nunca la cédula, y la unidad del ciudadano si ya
// existe.
async function referenciaBeneficiario(cedula) {
  try {
    const c = await ciudadanoDe(cedula);
    return { objeto: { tipo: 'beneficiario', id: c?.id_ciudadano ?? null }, idUnico: c?.id_unico_up ?? null };
  } catch {
    return { objeto: { tipo: 'beneficiario', id: null }, idUnico: null };
  }
}

// Ejecuta la subida dejando constancia en la actividad; los rechazos de negocio llegan como exito falso y no
// como excepción.
async function subirRegistrado(usuario, cedula, campos, archivos) {
  const meta = { accion: 'validador.subir' };
  try {
    const r = await upload(usuario, cedula, campos, archivos);
    const ref = await referenciaBeneficiario(cedula);
    await registrar(usuario, {
      ...meta,
      objeto: ref.objeto,
      idUnico: r.cuerpo.exito ? ref.idUnico : null,
      resultado: r.cuerpo.exito ? 'ok' : 'rechazado',
      cambios: r.cuerpo.exito
        ? { tipo_entrega: txt(campos.tipo_entrega) || null, soportes: Object.keys(archivos), estado_validacion: r.cuerpo.estado_validacion }
        : { detalle: String(r.cuerpo.mensaje).slice(0, 300) },
    });
    return r;
  } catch (err) {
    const ref = await referenciaBeneficiario(cedula);
    await registrar(usuario, { ...meta, objeto: ref.objeto, resultado: err.status && err.status < 500 ? 'rechazado' : 'error', cambios: { detalle: String(err.message).slice(0, 300) } });
    throw err;
  }
}

// Punto de entrada del validador: despacha la acción y devuelve el estado HTTP y el cuerpo.
export async function procesar(usuario, campos = {}, archivos = {}) {
  const accion = txt(campos.action);
  if (esSoloLectura(usuario) && !['check', 'descargar_prellenados'].includes(accion)) {
    throw prohibido(MENSAJE_SOLO_LECTURA);
  }
  const cedula = limpiaCedula(campos.cedula);
  if (!cedula) return fallo('Ingresa un número de cédula válido.');
  switch (accion) {
    case 'check': return check(usuario, cedula);
    case 'guardar_correo': return guardarCorreo(usuario, cedula, campos);
    case 'descargar_prellenados': return descargarPrellenados(usuario, cedula);
    case 'upload': return subirRegistrado(usuario, cedula, campos, archivos);
    case 'revisar': return revisar(usuario, cedula, campos);
    default: return fallo(`Acción desconocida: ${accion || '(vacía)'}.`);
  }
}

