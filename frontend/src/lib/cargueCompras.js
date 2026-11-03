// Cargue de compras desde el Excel de entregas. El archivo se lee en el navegador y aquí se arma un documento
// por unidad productiva con sus ítems aprobados, su estado de compra, su cronograma, su ruta y su entrega; al
// servidor solo viajan esos documentos.
import { SIN_DATOS } from './config';
import { horaParaGuardar } from './entregas';

export const HOJAS_COMPRAS = {
  aprobado: '1. APROBADO',
  compras: '2. COMPRAS',
  cronograma: '3. CRONOGRAMA',
  rutas: '4. RUTAS',
  entregas: '5. ENTREGAS',
};

// Hojas sin las que no se puede armar la lista.
export const HOJAS_OBLIGATORIAS = ['aprobado'];

const c = (alias, nombre, opcional = false) => ({ alias, nombre, opcional });

// Columnas de cada hoja; cada una lleva al menos una columna obligatoria que solo existe en ella, para que no
// se tome otra hoja por error.
export const COLUMNAS_COMPRAS = {
  aprobado: [
    c('id_unico', 'ID_unico'),
    c('region', 'region', true),
    c('dpto', 'dpto', true),
    c('mpio', 'mpio', true),
    c('gestor', 'gestor', true),
    c('modalidad', 'modalidad', true),
    c('num_documento', 'num_documento', true),
    c('direccion', 'direccion', true),
    c('ubicacion', 'ubicacion', true),
    c('concepto', 'Concepto previo interventoría (numero)', true),
    c('aprobado_comite', 'aprobado_comite', true),
    c('resultado_comite', 'resultado_comite', true),
    c('comite', 'comite_aprobacion', true),
    c('item_n', 'item_n'),
    c('codigo_actual', 'codigo_actual', true),
    c('item_por_actividad', 'item_por_actividad', true),
    c('tipo_segun_carrito', 'tipo_segun_carrito', true),
    c('denominacion', 'denominacion'),
    c('descripcion', 'descripcion', true),
    c('especificaciones_tecnicas', 'especificaciones_tecnicas', true),
    c('dimensiones', 'dimensiones', true),
    c('empaque', 'empaque', true),
    c('peso', 'peso', true),
    c('referencia', 'referencia', true),
    c('material', 'material', true),
    c('composicion', 'composicion', true),
    c('capacidad', 'capacidad', true),
    c('potencia', 'potencia', true),
    c('otras_especificaciones', 'otras_especificaciones', true),
    c('cantidad', 'cantidad'),
    c('iva', 'iva_carrito', true),
    c('precio', 'precio'),
    c('total', 'total', true),
    c('enlace_carpeta', 'enlace_carpeta', true),
    c('comprado', 'COMPRADO'),
  ],
  compras: [
    c('id_unico', 'ID_unico'),
    c('num_documento', 'num_documento', true),
    c('hoja_origen', 'hoja_origen', true),
    c('region', 'region', true),
    c('dpto', 'dpto', true),
    c('mpio', 'mpio', true),
    c('gestor', 'gestor', true),
    c('modalidad', 'modalidad', true),
    c('direccion', 'direccion', true),
    c('ubicacion', 'ubicacion', true),
    c('concepto', 'Concepto previo interventoría (numero)', true),
    c('aprobado_comite', 'aprobado_comite', true),
    c('resultado_comite', 'resultado_comite', true),
    c('comite', 'comite_aprobacion', true),
    c('fecha_solicitud_pi', 'fecha_solicitud_plan_inversion', true),
    c('fecha_procesado_pi', 'fecha_procesado_plan_inversion', true),
    c('item_n', 'item_n'),
    c('codigo_actual', 'codigo_actual', true),
    c('item_por_actividad', 'item_por_actividad', true),
    c('tipo_segun_carrito', 'tipo_segun_carrito_actual', true),
    c('nombre_solicitado', 'nombre_solicitado', true),
    c('nombre_carrito_actual', 'nombre_carrito_actual'),
    c('descripcion', 'Descripción general', true),
    c('especificaciones_tecnicas', 'Especificaciones técnicas', true),
    c('dimensiones', 'Dimensiones', true),
    c('empaque', 'Empaque', true),
    c('peso', 'Peso', true),
    c('referencia', 'Referencia', true),
    c('material', 'Material', true),
    c('composicion', 'Composición', true),
    c('capacidad', 'Capacidad', true),
    c('potencia', 'Potencia', true),
    c('otras_especificaciones', 'Otras especificaciones', true),
    c('condiciones_limitantes', 'Condiciones limitantes de servicios públicos', true),
    c('requerimientos_especiales', 'Requerimientos especiales', true),
    c('cantidad', 'cantidad', true),
    c('iva', 'iva_carrito', true),
    c('precio', 'precio_solicitado', true),
    c('total', 'TOTAL UNIDAD', true),
  ],
  cronograma: [
    c('id_unico', 'ID_unico'),
    c('n', 'N.º', true),
    c('n_original', 'N.º original', true),
    c('unidad_nombre', 'unidad_nombre', true),
    c('fecha_aprobacion', 'fecha_aprobacion', true),
    c('valor_aprobado', 'valor_aprobado', true),
    c('valor_capitalizado', 'valor_capitalizado', true),
    c('proveedor', 'proveedor', true),
    c('gestor_nodo', 'Gestor/Nodo', true),
    c('direccion', 'Dirección', true),
    c('enlace_carpeta', 'enlace_carpeta', true),
    c('enlace_contabilidad', 'enlace_contabilidad', true),
    c('estado_programacion', 'ESTADO_PROGRAMACION'),
    c('fecha_programada', 'fecha_programada', true),
    c('fecha_entrega_efectiva', 'fecha_entrega_efectiva', true),
    c('estado_documentacion', 'ESTADO_DOCUMENTACIÓN', true),
    c('plazo_documentacion', 'PLAZO_DOCUMENTACIÓN', true),
  ],
  rutas: [
    c('id_unico', 'ID_unico'),
    c('unidad_nombre', 'unidad_nombre', true),
    c('unidad_tel1', 'unidad_tel1', true),
    c('unidad_tel2', 'unidad_tel2', true),
    c('unidad_direccion', 'unidad_direccion', true),
    c('nodo', 'nodo', true),
    c('region', 'region_hoja', true),
    c('ruta', 'ruta', true),
    c('coordinador', 'coordinador', true),
    c('telefono_gestor', 'telefono_gestor', true),
    c('gestor_telefono', 'gestor_telefono', true),
    c('gestor_nombre', 'gestor_nombre', true),
    c('telefono_coordinador', 'telefono_coordinador', true),
    c('punto_encuentro', 'punto_encuentro', true),
    c('hora_salida', 'hora_salida', true),
    c('fecha_programada', 'fecha_programada', true),
    c('fecha_visita', 'fecha_visita', true),
    c('fecha_ruta', 'fecha_ruta', true),
    c('hora_visita', 'hora_visita'),
  ],
  entregas: [
    c('id_unico', 'ID_unico'),
    c('unidad_nombre', 'unidad_nombre', true),
    c('en_cronograma', 'en_cronograma', true),
    c('fecha_cronograma', 'fecha_cronograma', true),
    c('fecha_reprogramada', 'fecha_reprogramada', true),
    c('fecha_entrega_vigente', 'fecha_entrega_vigente', true),
    c('obs_cronograma', 'obs_cronograma', true),
    c('en_ruta', 'en_ruta', true),
    c('estado_up', 'ESTADO_UP', true),
    c('hora_ruta', 'hora_ruta', true),
    c('ruta', 'ruta', true),
    c('region_ruta', 'region_ruta', true),
    c('estado_entrega', 'ESTADO_ENTREGA'),
    c('observaciones_entrega', 'OBSERVACIONES_ENTREGA', true),
  ],
};

const VACIOS = new Set(['', 'none', 'nan', '#n/a', '#¡n/a!', '-', 'null']);

function limpio(v) {
  const t = String(v ?? '').trim();
  return VACIOS.has(t.toLowerCase()) ? '' : t;
}
const texto = (v) => limpio(v) || SIN_DATOS;

export function idNum(v) {
  const n = Number(limpio(v));
  return Number.isFinite(n) && n > 0 && Number.isInteger(Math.round(n)) ? Math.round(n) : null;
}

function entero(v) {
  const n = Number(limpio(v));
  return Number.isFinite(n) && limpio(v) !== '' ? Math.round(n) : null;
}

function numero(v) {
  const t = limpio(v).replace(/\$/g, '').replace(/\s/g, '').replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

function digitos(v) {
  const t = limpio(v).replace(/\.0+$/, '').replace(/\D/g, '');
  return t || SIN_DATOS;
}

function booleano(v) {
  const t = limpio(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['si', 's', 'true', '1', 'x', 'aprobado'].includes(t)) return true;
  if (['no', 'n', 'false', '0'].includes(t)) return false;
  return null;
}
const boolOSin = (v) => { const b = booleano(v); return b === null ? SIN_DATOS : b; };

// Convierte dd/mm/aaaa en aaaa-mm-dd y deja como texto lo que no sea fecha.
function fecha(v) {
  const t = limpio(v);
  if (!t) return SIN_DATOS;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return t;
}

function coordenadas(v) {
  const partes = limpio(v).replace(/;/g, ',').split(',').map((p) => p.trim());
  if (partes.length < 2) return null;
  const lat = Number(partes[0]); const lng = Number(partes[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { latitud: lat, longitud: lng } : null;
}

function cabecera(f, compras) {
  const g = (k) => f[k] || compras?.[k] || '';
  return {
    nodo: (limpio(g('gestor')) || SIN_DATOS).toUpperCase(),
    num_documento: digitos(g('num_documento')),
    hoja_origen: texto(compras?.hoja_origen),
    region: entero(g('region')),
    departamento: texto(g('dpto')),
    municipio: texto(g('mpio')),
    modalidad: texto(g('modalidad')),
    direccion: texto(g('direccion')),
    ubicacion: coordenadas(g('ubicacion')),
    enlace_carpeta: texto(f.enlace_carpeta),
    aprobacion: {
      concepto_interventoria: texto(g('concepto')),
      aprobado_comite: boolOSin(g('aprobado_comite')),
      resultado_comite: texto(g('resultado_comite')),
      comite: texto(g('comite')),
      fecha_solicitud_plan_inversion: fecha(compras?.fecha_solicitud_pi),
      fecha_procesado_plan_inversion: fecha(compras?.fecha_procesado_pi),
    },
  };
}

// Arma un ítem desde la hoja de aprobados, completado con su fila de compras si existe.
function itemAprobado(a, co) {
  const item = {
    item_n: entero(a.item_n),
    codigo_actual: texto(a.codigo_actual || co?.codigo_actual),
    item_por_actividad: texto(a.item_por_actividad || co?.item_por_actividad),
    tipo_segun_carrito: texto(a.tipo_segun_carrito || co?.tipo_segun_carrito),
    nombre_solicitado: texto(co?.nombre_solicitado || a.denominacion),
    nombre_carrito_actual: texto(co?.nombre_carrito_actual || a.denominacion),
    cantidad: numero(a.cantidad),
    iva: numero(a.iva),
    precio_solicitado: numero(a.precio),
    total: numero(a.total),
    ficha_tecnica: {
      descripcion_general: texto(a.descripcion),
      especificaciones_tecnicas: texto(a.especificaciones_tecnicas),
      dimensiones: texto(a.dimensiones),
      empaque: texto(a.empaque),
      peso: texto(a.peso),
      referencia: texto(a.referencia),
      material: texto(a.material),
      composicion: texto(a.composicion),
      capacidad: texto(a.capacidad),
      potencia: texto(a.potencia),
      otras_especificaciones: texto(a.otras_especificaciones),
      condiciones_limitantes: texto(co?.condiciones_limitantes),
      requerimientos_especiales: texto(co?.requerimientos_especiales),
    },
    origen: 'APROBADO',
    comprado_excel: booleano(a.comprado) === true,
  };
  return recalcular(item);
}

// Recalcula el total si no es precio por cantidad y lo marca.
function recalcular(item) {
  if (item.precio_solicitado !== null && item.cantidad !== null) {
    const esperado = Math.round(item.precio_solicitado * item.cantidad * 100) / 100;
    if (item.total === null || Math.abs(item.total - esperado) > 1) {
      item.total = esperado;
      item.total_recalculado = true;
    }
  }
  return item;
}

function cronogramaDe(f) {
  return {
    n: entero(f?.n),
    n_original: entero(f?.n_original),
    proveedor: texto(f?.proveedor),
    fecha_aprobacion: fecha(f?.fecha_aprobacion),
    valor_aprobado: numero(f?.valor_aprobado),
    valor_capitalizado: numero(f?.valor_capitalizado),
    estado_programacion: texto(f?.estado_programacion),
    fecha_programada: fecha(f?.fecha_programada),
    fecha_entrega_efectiva: fecha(f?.fecha_entrega_efectiva),
    estado_documentacion: texto(f?.estado_documentacion),
    plazo_documentacion: fecha(f?.plazo_documentacion),
    direccion: texto(f?.direccion),
    enlace_carpeta: texto(f?.enlace_carpeta),
    enlace_contabilidad: texto(f?.enlace_contabilidad),
  };
}

// Obtiene la ruta y la región de la unidad, tomándolas de la fila de entregas si la hoja de rutas no las trae.
function rutaDe(f, fE) {
  return {
    ruta: texto(f?.ruta || fE?.ruta),
    region: texto(f?.region || fE?.region_ruta),
    nodo: texto(f?.nodo),
    coordinador: texto(f?.coordinador),
    telefono_coordinador: texto(f?.telefono_coordinador),
    gestor_nombre: texto(f?.gestor_nombre),
    telefono_gestor: texto(f?.gestor_telefono || f?.telefono_gestor),
    punto_encuentro: texto(f?.punto_encuentro),
    hora_salida: texto(horaParaGuardar(f?.hora_salida)),
    fecha_ruta: fecha(f?.fecha_programada || f?.fecha_visita || f?.fecha_ruta),
    hora_visita: texto(horaParaGuardar(f?.hora_visita)),
    telefono_up: texto([limpio(f?.unidad_tel1), limpio(f?.unidad_tel2)].filter(Boolean).join(' · ')),
    direccion_up: texto(f?.unidad_direccion),
  };
}

function entregaDe(f) {
  return {
    estado_up: texto(f?.estado_up),
    estado_entrega: texto(f?.estado_entrega),
    observaciones_entrega: texto(f?.observaciones_entrega),
    en_cronograma: boolOSin(f?.en_cronograma),
    fecha_cronograma: fecha(f?.fecha_cronograma),
    fecha_reprogramada: fecha(f?.fecha_reprogramada),
    fecha_entrega_vigente: fecha(f?.fecha_entrega_vigente),
    obs_cronograma: texto(f?.obs_cronograma),
    en_ruta: boolOSin(f?.en_ruta),
  };
}

const clave = (v) => limpio(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

// Empareja cada fila de aprobados con la fila de compras de la misma unidad, primero por código o nombre.
function emparejar(filasAp, filasCo) {
  const pares = filasAp.map(() => null);
  const usadas = new Set();
  filasAp.forEach((a, i) => {
    const cod = clave(a.codigo_actual);
    const nom = clave(a.denominacion);
    const f = filasCo.find((x) => !usadas.has(x) && (
      (cod && cod === clave(x.codigo_actual))
      || (nom && (nom === clave(x.nombre_solicitado) || nom === clave(x.nombre_carrito_actual)))
    ));
    if (f) { pares[i] = f; usadas.add(f); }
  });
  filasAp.forEach((a, i) => {
    if (pares[i]) return;
    const n = entero(a.item_n);
    const f = n === null ? null : filasCo.find((x) => !usadas.has(x) && entero(x.item_n) === n);
    if (f) { pares[i] = f; usadas.add(f); }
  });
  return pares;
}

// Columnas sin las cuales el cronograma quedaría mal: si falta alguna o cambió de nombre, el cargue se detiene
// antes de escribir nada.
export const COLUMNAS_CLAVE_ENTREGAS = {
  cronograma: ['id_unico', 'estado_programacion', 'fecha_programada', 'fecha_entrega_efectiva'],
  entregas: ['id_unico', 'estado_entrega', 'fecha_entrega_vigente', 'fecha_reprogramada', 'hora_ruta'],
  rutas: ['id_unico', 'fecha_ruta', 'hora_visita', 'punto_encuentro'],
};

// Columnas clave que pueden venir con otro nombre; faltan solo si no está ninguna de sus alternativas.
const ALTERNATIVAS_CLAVE = {
  rutas: { fecha_ruta: ['fecha_programada', 'fecha_visita', 'fecha_ruta'] },
};

// Devuelve la lista de columnas clave que faltan, con su hoja.
export function columnasClaveFaltantes(faltantes) {
  const out = [];
  for (const [hoja, claves] of Object.entries(COLUMNAS_CLAVE_ENTREGAS)) {
    for (const alias of claves) {
      const opciones = ALTERNATIVAS_CLAVE[hoja]?.[alias] || [alias];
      if (opciones.every((al) => (faltantes[hoja] || []).includes(al))) {
        const col = COLUMNAS_COMPRAS[hoja].find((c) => c.alias === alias);
        out.push(`${HOJAS_COMPRAS[hoja]}: ${col?.nombre || alias}`);
      }
    }
  }
  return out;
}

const nulo = (v) => (v === SIN_DATOS || v === '' || v === undefined ? null : v);
const conPrefijo = (prefijo, obj) => Object.fromEntries(
  Object.entries(obj).map(([k, v]) => [`${prefijo}${k}`, nulo(v)]),
);

// Arma las entregas solo si están las tres hojas, porque si falta alguna el servidor dejaría una entrega a
// medias.
export function armarEntregas(hojas) {
  if (!hojas.cronograma || !hojas.entregas || !hojas.rutas) return null;
  const cron = primeraPorId(hojas.cronograma);
  const ent = primeraPorId(hojas.entregas);
  const rut = primeraPorId(hojas.rutas);
  const ids = [...new Set([...cron.keys(), ...ent.keys(), ...rut.keys()])].sort((a, b) => a - b);
  return ids.map((id) => {
    const fC = cron.get(id);
    const fE = ent.get(id);
    const fR = rut.get(id);
    const { ruta, ...restoRuta } = rutaDe(fR, fE);
    const { fecha_ruta: rutaFecha, ...restoRuta2 } = restoRuta;
    return {
      id_unico: id,
      unidad_nombre: limpio(fC?.unidad_nombre) || limpio(fE?.unidad_nombre) || limpio(fR?.unidad_nombre),
      excel: {
        ...conPrefijo('excel_', cronogramaDe(fC)),
        ...conPrefijo('excel_', entregaDe(fE)),
        excel_hora_ruta: nulo(texto(horaParaGuardar(fE?.hora_ruta))),
        excel_ruta: nulo(ruta),
        excel_ruta_fecha: nulo(rutaFecha),
        ...conPrefijo('excel_ruta_', restoRuta2),
      },
    };
  });
}

function agrupar(filas) {
  const m = new Map();
  for (const f of filas || []) {
    const id = idNum(f.id_unico);
    if (id === null) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(f);
  }
  return m;
}

function primeraPorId(filas) {
  const m = new Map();
  for (const f of filas || []) {
    const id = idNum(f.id_unico);
    if (id !== null && !m.has(id)) m.set(id, f);
  }
  return m;
}

// Arma los documentos de compras de cada unidad a partir de las hojas leídas.
export function armarDocumentosCompras(hojas) {
  const ap = agrupar(hojas.aprobado);
  const co = agrupar(hojas.compras);
  const cron = hojas.cronograma ? primeraPorId(hojas.cronograma) : null;
  const rut = hojas.rutas ? primeraPorId(hojas.rutas) : null;
  const ent = hojas.entregas ? primeraPorId(hojas.entregas) : null;

  const ids = [...ap.keys()].sort((a, b) => a - b);
  const docs = [];
  const cedulas = new Set();
  const info = {
    soloCompras: [...co.keys()].filter((id) => !ap.has(id)),
    itemsSoloCompras: 0,
    cedulas: 0,
    upConCompras: 0,
    itemsComprados: 0,
    items: 0,
    conCronograma: 0, conRuta: 0, conEntrega: 0,
  };

  for (const id of ids) {
    const filasAp = ap.get(id) || [];
    const filasCo = co.get(id) || [];
    const base = cabecera(filasAp[0], filasCo[0]);
    const pares = emparejar(filasAp, filasCo);
    const items = filasAp.map((a, i) => itemAprobado(a, pares[i]));
    info.itemsSoloCompras += filasCo.length - pares.filter(Boolean).length;
    const cc = limpio(filasAp[0].num_documento).replace(/\.0+$/, '').replace(/\D/g, '');
    if (cc) cedulas.add(cc);
    items.sort((x, y) => (x.item_n ?? 1e9) - (y.item_n ?? 1e9));

    const unidades = items.reduce((s, it) => s + (it.cantidad || 0), 0);
    const valor = items.reduce((s, it) => s + (it.total || 0), 0);
    info.items += items.length;
    const comprados = items.filter((it) => it.comprado_excel).length;
    info.itemsComprados += comprados;
    if (comprados) info.upConCompras += 1;

    const fCron = cron?.get(id);
    const fRut = rut?.get(id);
    const fEnt = ent?.get(id);
    const nombre = limpio(fCron?.unidad_nombre) || limpio(fEnt?.unidad_nombre)
      || limpio(fRut?.unidad_nombre);

    const doc = {
      id: String(id),
      id_unico: id,
      tipo: 'items_up',
      origen: 'APROBADO',
      unidad_nombre: nombre || SIN_DATOS,
      ...base,
      resumen: {
        total_items: items.length,
        total_unidades: Math.round(unidades * 100) / 100,
        valor_total: Math.round(valor * 100) / 100,
      },
      items,
    };
    if (cron) { doc.cronograma = cronogramaDe(fCron); if (fCron) info.conCronograma += 1; }
    if (rut) { doc.ruta = rutaDe(fRut, fEnt); if (fRut) info.conRuta += 1; }
    if (ent) { doc.entrega = entregaDe(fEnt); if (fEnt) info.conEntrega += 1; }
    docs.push(doc);
  }
  info.cedulas = cedulas.size;
  return { docs, info };
}
