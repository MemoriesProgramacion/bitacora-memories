// Acceso a la API de la Bitácora. Los errores tienen dos caras: un mensaje genérico para el usuario y el
// detalle del error, que solo va a la consola.
import { FETCH_TIMEOUT, SIN_DATOS, API_BASE } from './config';
import { tokenCsrf, renovarCsrf } from './csrf';

export class AppError extends Error {
  constructor(code, publicMsg, detail, respuesta) {
    super(publicMsg);
    this.code = code;
    this.publicMsg = publicMsg;
    this.detail = detail;
    this.respuesta = respuesta;
  }
}

// Devuelve el token CSRF de la sesión activa, para las piezas que no reciben la sesión por props.
export function tokenSesion() {
  return tokenCsrf() || '';
}

// Devuelve la URL de un archivo servido por la API; las etiquetas iframe, video y los enlaces llevan la cookie
// de sesión solos.
export function urlArchivo(url) {
  if (!url) return '';
  const u = String(url);
  if (/^https?:\/\//i.test(u) || u.startsWith(API_BASE)) return u;
  return `${API_BASE}${u.startsWith('/') ? '' : '/'}${u}`;
}

// Hace una petición autenticada: la sesión viaja en la cookie y las escrituras llevan el token CSRF.
export async function fetchApi(url, { token, params, metodo = 'GET', cuerpo } = {}) {
  const u = new URL(url, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    }
  }

  const escritura = metodo !== 'GET';
  if (escritura && !token && !tokenCsrf()) await renovarCsrf();

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), FETCH_TIMEOUT);
  try {
    const enviar = () => fetch(u.toString(), {
      method: metodo,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(escritura ? { 'X-CSRF-Token': tokenCsrf() || token || '' } : {}),
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });

    let res = await enviar();
    if (res.status === 400 && escritura) {
      const aviso = await res.clone().json().catch(() => null);
      if (aviso && aviso.csrf) {
        await renovarCsrf();
        res = await enviar();
      }
    }
    clearTimeout(timer);

    let data = null;
    try { data = await res.json(); } catch { }

    if (res.status === 401) {
      window.dispatchEvent(new Event('sesion-expirada'));
      throw new AppError('E-SESION', 'Tu sesión expiró',
        'La sesión venció o no es válida. Hay que volver a iniciar sesión.');
    }
    if (res.status === 403 && data && data.error === 'simulacion') {
      throw new AppError('E-SIM', 'En «Ver como» no se guardan cambios. Vuelve a superadmin para guardar.',
        data.detalle || 'escritura en «Ver como»', 'simulacion');
    }
    if (res.status === 403 && data && data.error === 'mantenimiento') {
      throw new AppError('E-MANT', 'La app está en mantenimiento: puedes consultar, pero no guardar.',
        data.detalle || 'modo mantenimiento activo', 'mantenimiento');
    }
    if (!res.ok || !data || data.ok === false) {
      const detalle = (data && data.error) || `HTTP ${res.status} ${res.statusText}`;
      const publico = res.status < 500 && typeof data?.error === 'string' && data.error ? data.error : 'Error de conexión';
      throw new AppError(`E${res.status}`, publico,
        `La API de la bitácora respondió: ${detalle}`, (data && data.error) || undefined);
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof AppError) throw err;
    if (err && err.name === 'AbortError') {
      throw new AppError('E-TIME', 'Error de conexión',
        `Sin respuesta tras ${FETCH_TIMEOUT / 1000}s.`);
    }
    throw new AppError('E-RED', 'Error de conexión',
      (err && err.message) || 'Fallo de red o CORS.');
  }
}

// Devuelve vacío cuando el valor es el relleno de los generadores, para que la interfaz muestre un guion.
function limpio(v) {
  if (v === undefined || v === null) return '';
  if (v === SIN_DATOS) return '';
  return v;
}

// Convierte los booleanos de la API al 1 o 0 que espera etapas.js.
function bool10(v) {
  if (v === true) return '1';
  if (v === false) return '0';
  return '';
}

// Convierte una fila de la lista liviana de unidades a la forma plana de siempre.
export function adaptarFila(r) {
  return {
    ID_unico: r.id_unico,
    _id: r.id,
    nodo: limpio(r.nodo),
    region: limpio(r.region),
    triada: limpio(r.triada),
    enlace_carpeta: limpio(r.enlace_carpeta),

    unidad_nombre: limpio(r.up_nombre),
    modalidad: limpio(r.up_modalidad),
    unidad_sector: limpio(r.up_sector),
    dpto: limpio(r.up_departamento),
    mpio: limpio(r.up_municipio),
    habilitadas: bool10(r.up_habilitada),
    RESULTADO: limpio(r.up_resultado),

    unidad_doc: limpio(r.rep_documento),
    integrante_doc_inicial: limpio(r.rep_documento_inicial),
    integrante_nombre1: limpio(r.rep_nombre1),
    integrante_nombre2: limpio(r.rep_nombre2),
    integrante_apellido1: limpio(r.rep_apellido1),
    integrante_apellido2: limpio(r.rep_apellido2),
    unidad_tel1: limpio(r.rep_telefono1),
    unidad_tel2: limpio(r.rep_telefono2),
    unidad_mail1: limpio(r.rep_correo1),
    unidad_direccion: limpio(r.rep_direccion),

    _parcial: true,
  };
}

// Convierte el documento completo de una unidad a la forma plana de siempre.
export function adaptarUP(doc) {
  const rep = doc.datos_representante || {};
  const up = doc.datos_up || {};
  return {
    ID_unico: doc.id_unico,
    _id: doc.id,
    _retiro: doc.retiro ?? null,
    _cierre: doc.cierre ?? null,
    nodo: limpio(doc.nodo),
    region: limpio(doc.region),
    triada: limpio(doc.triada),
    enlace_carpeta: limpio(doc.enlace_carpeta),

    unidad_doc: limpio(rep.documento),
    integrante_doc_inicial: limpio(rep.documento_inicial),
    integrantes_RIT: (rep.documentos_rit || []).join('; '),
    integrante_doc_expedicion: limpio(rep.documento_expedicion),
    integrante_nacimiento: limpio(rep.fecha_nacimiento),
    integrante_nombre1: limpio(rep.nombre1),
    integrante_nombre2: limpio(rep.nombre2),
    integrante_apellido1: limpio(rep.apellido1),
    integrante_apellido2: limpio(rep.apellido2),
    integrante_sexo: limpio(rep.sexo),
    unidad_tel1: limpio(rep.telefono1),
    unidad_tel2: limpio(rep.telefono2),
    unidad_mail1: limpio(rep.correo1),
    unidad_mail2: limpio(rep.correo2),
    unidad_otromail: bool10(rep.tiene_correo2),
    unidad_direccion: limpio(rep.direccion),

    unidad_nombre: limpio(up.nombre),
    unidad_actividad: limpio(up.actividad),
    habilitadas: bool10(up.habilitada),
    retiradas_dps: bool10(up.retirada_dps),
    novedades_incapacitantes: bool10(up.novedad_incapacitante),
    novedades_tipo: limpio(up.novedad_tipo),
    modalidad: limpio(up.modalidad),
    unidad_sector: limpio(up.sector),
    nit: limpio(up.nit),
    dpto: limpio(up.departamento),
    mpio: limpio(up.municipio),
    p_dpto: limpio(up.posicion_dpto),
    'Quéproductooservicioestásd': limpio(up.producto_servicio),
    'Quénecesidadesodificultades': limpio(up.necesidades),
    RESULTADO: limpio(up.resultado),
    ACTUALIZACION: limpio(up.actualizacion_datos),
    up_completas_coord: bool10(up.completa_coordinacion),
    doc_interventoria: limpio(up.doc_interventoria),
    OBSERVACIONES: limpio(up.observaciones),

    _parcial: false,
  };
}

// Convierte los datos de la cuenta de campo en las columnas que antes traía el master, que es el cruce por
// nodo.
export function camposGestor(g) {
  if (!g) return {};
  return {
    nombre_gestor: limpio(g.nombre),
    cedula_gestor: limpio(g.cedula),
    correo_gestor: limpio(g.correo),
    telefono_gestor: limpio(g.telefono),
    triada: limpio(g.triada),
  };
}

// Convierte los booleanos al 1 o 0 que leen completaEstado y pasoLogrado.
function completa10(v) {
  if (v === true) return '1';
  if (v === false) return '0';
  return '';
}

// Considera completas la compra, la entrega y la tercera visita, que no tienen bandera propia, si hay
// comprobaciones y ninguna está en rojo.
function completaPorChecks(checks) {
  if (!Array.isArray(checks) || !checks.length) return '';
  return checks.some((c) => c && c.estado === 'falta') ? '0' : '1';
}

// Convierte una fila de GET /api/documentos en lo mínimo necesario para el avance de la ruta.
export function adaptarEtapasFila(r) {
  return {
    ID_unico: r.id_unico,
    _id: r.id,
    nodo: r.nodo,

    TIENE_RIT: completa10(r.tiene_rit),
    EVENTO: limpio(r.evento),

    DOC_COMPLETA_BENEFICIARIO_00: completa10(r.b00_completa),
    DOC_COMPLETA_VISITA_1: completa10(r.v1_completa),
    DOC_COMPLETA_VISITA_2: completa10(r.v2_completa),
    DOC_COMPLETA_TRANSFERENCIA: completa10(r.fort_completa),
    DOC_COMPLETA_TALLERES: completa10(r.talleres_completa),
    DOC_COMPLETA_CAPITALIZACION: completa10(r.cap_completa),
    DOC_COMPLETA_COMPRA: completaPorChecks(r.compra_checks),
    DOC_COMPLETA_ENTREGA: completaPorChecks(r.entrega_checks),
    DOC_COMPLETA_VISITA_3: completa10(r.v3_completa),

    ...camposRutaMaster(r),

    _parcial: true,
  };
}

// Devuelve los cuatro estados de la ruta que etapas.js lee de la fila de la unidad y que ahora viven en el
// documento de etapas.
export function camposRutaMaster(r) {
  return {
    PDF_carrito: limpio(r.pdf_carrito),
    plan_inversion: limpio(r.plan_inversion),
    plan_negocio: limpio(r.plan_negocio),
    comite_subsanaciones: limpio(r.comite_subsanaciones),
    proceso_subsanacion: limpio(r.proceso_subsanacion),
  };
}

// Convierte cada comprobación con item y estado en label, ok y bad, que es lo que pinta Etapas.jsx.
function checks(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map((c) => ({
    label: c.item,
    ok: c.estado === 'ok',
    bad: c.estado === 'falta',
  }));
}

// Convierte la lista de objetos con nombre en una lista de nombres, porque Etapas.jsx pinta texto y un objeto
// como hijo de React tumba la ficha.
function archivos(lista) {
  return Array.isArray(lista)
    ? lista.map((a) => (typeof a === 'string' ? a : a?.nombre)).filter(Boolean)
    : [];
}

// Convierte el documento completo de GET /api/documentos/detalle en el objeto aud con todo.
export function adaptarEtapas(doc) {
  const e = (k) => doc[k] || {};
  const cot = doc.cotizaciones || {};
  const mod = (e('fortalecimiento').modulos) || {};

  return {
    ...adaptarEtapasFila({
      id: doc.id,
      id_unico: doc.id_unico,
      nodo: doc.nodo,
      tiene_rit: e('rit').tiene_rit,
      evento: e('evento').asistencia,
      b00_completa: e('beneficiario').completa,
      v1_completa: e('visita1').completa,
      v2_completa: e('visita2').completa,
      fort_completa: e('fortalecimiento').completa,
      talleres_completa: e('talleres').completa,
      cap_completa: e('capitalizacion').completa,
      v3_completa: e('visita3').completa,
      compra_checks: e('compra').checks,
      entrega_checks: e('entrega').checks,
      pdf_carrito: e('pdf_carrito').estado,
      plan_inversion: e('viabilidad').plan_inversion,
      plan_negocio: e('aprobacion').plan_negocio,
      comite_subsanaciones: e('subsanaciones').comite,
      proceso_subsanacion: e('subsanaciones').proceso_subsanacion,
    }),

    DOCS_00_DOCUMENTACION_BENEFICIARIO: archivos(e('beneficiario').archivos),
    CHECK_DOCS_00_DOCUMENTACION_BENEFICIARIO: checks(e('beneficiario').checks),

    DOCS_01_VISITA1: archivos(e('visita1').archivos),
    CHECK_DOCS_01_VISITA1: checks(e('visita1').checks),

    DOCS_02_VISITA2: archivos(e('visita2').archivos),
    CHECK_DOCS_02_VISITA2: checks(e('visita2').checks),

    DOCS_03_FORTALECIMIENTO: archivos(e('fortalecimiento').archivos),
    CHECK_DOCS_03_FORTALECIMIENTO: checks(e('fortalecimiento').checks),
    DOCS_03_01_MODULO_1: archivos((mod.modulo1 || {}).archivos),
    CHECK_DOCS_03_01_MODULO_1: checks((mod.modulo1 || {}).checks),
    DOCS_03_02_MODULO_2: archivos((mod.modulo2 || {}).archivos),
    CHECK_DOCS_03_02_MODULO_2: checks((mod.modulo2 || {}).checks),
    DOCS_03_03_MODULO_3: archivos((mod.modulo3 || {}).archivos),
    CHECK_DOCS_03_03_MODULO_3: checks((mod.modulo3 || {}).checks),

    DOCS_04_TALLERES: archivos(e('talleres').archivos),
    CHECK_DOCS_04_TALLERES: checks(e('talleres').checks),

    DOCS_04_01_APROBACION: archivos(e('capitalizacion').archivos),
    CHECK_DOCS_04_01_APROBACION: checks(e('capitalizacion').checks),

    DOCS_04_02_COTIZACION_GANADORA: archivos((cot.ganadora || {}).archivos),
    CHECK_DOCS_04_02_COTIZACION_GANADORA: checks((cot.ganadora || {}).checks),
    DOCS_04_02_COTIZACION_PROVEEDOR_2: archivos((cot.proveedor2 || {}).archivos),
    CHECK_DOCS_04_02_PROVEEDOR_2: checks((cot.proveedor2 || {}).checks),
    DOCS_04_02_COTIZACION_PROVEEDOR_3: archivos((cot.proveedor3 || {}).archivos),
    CHECK_DOCS_04_02_PROVEEDOR_3: checks((cot.proveedor3 || {}).checks),

    RIT_FECHA_ENVIADO: limpio(e('rit').fecha_enviado),
    RIT_TOTAL_DIAS: e('rit').total_dias ?? '',
    RIT_DIRECCION: limpio(e('rit').direccion),

    UP_APROBADA: e('control').up_aprobada,
    LOTE_UP_APROBADA: limpio(e('control').lote_up_aprobada),
    DOC_COMPLETA_GESTOR: e('control').doc_completa_gestor,
    DOC_COMPLETA_TRIADA: e('control').doc_completa_triada,
    NOVEDAD_DPS_GESTOR: limpio(e('control').novedad_dps_gestor),
    NOVEDAD_CONTACTO_NO_POSIBLE: limpio(e('control').novedad_contacto_no_posible),

    V1_FECHA_VISITA: limpio(e('visita1').fecha_visita),
    V1_FECHA_REPROGRAMACION: limpio(e('visita1').fecha_reprogramacion),
    V1_ESTADO_AGENDAMIENTO: limpio(e('visita1').estado_agendamiento),
    V1_MODALIDAD: limpio(e('visita1').modalidad),

    ENTREGA_FECHA: limpio(e('entrega').fecha),
    ENTREGA_FECHA_REPROGRAMACION: limpio(e('entrega').fecha_reprogramacion),
    ENTREGA_RESULTADO: limpio(e('entrega').resultado),

    V3_FECHA: limpio(e('visita3').fecha),
    V3_FECHA_REPROGRAMACION: limpio(e('visita3').fecha_reprogramacion),
    V3_RESULTADO: limpio(e('visita3').resultado),
    V3_MODALIDAD: limpio(e('visita3').modalidad),

    DOCS_04_03_SOPORTES_COMPRA: archivos(e('compra').archivos),
    CHECK_DOCS_COMPRAS: checks(e('compra').checks),
    DOCS_04_03_SOPORTES_ENTREGA: archivos(e('entrega').archivos),
    CHECK_DOCS_ENTREGAS: checks(e('entrega').checks),

    _parcial: false,
  };
}
