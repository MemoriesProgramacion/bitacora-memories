// Adaptador de la edición de los datos de una unidad productiva: qué campos se pueden editar y cómo se piden.
// Los nombres son los que entrega la API y los que acepta el servidor.
import { UNIDAD_URL, UNIDAD_EDITAR_URL, DOCUMENTO_URL } from './config';
import { fetchApi } from './api';

// Campos editables de la ficha con su tipo: texto, largo, sí o no, fecha, entero, número, CIIU o lista.
export const CAMPOS_UP = [
  { k: 'nombre', label: 'Nombre de la unidad' }, { k: 'actividad', label: 'Actividad' },
  { k: 'sector', label: 'Sector' }, { k: 'modalidad', label: 'Modalidad' },
  { k: 'nit', label: 'NIT' }, { k: 'departamento', label: 'Departamento' },
  { k: 'municipio', label: 'Municipio' }, { k: 'producto_servicio', label: 'Producto o servicio' },
  { k: 'habilitada', label: 'Habilitada', tipo: 'sino' },
  { k: 'novedad_incapacitante', label: 'Novedad incapacitante', tipo: 'sino' },
  { k: 'resultado', label: 'Resultado' }, { k: 'actualizacion_datos', label: 'Actualización de datos' },
  { k: 'doc_interventoria', label: 'Documento de interventoría' }, { k: 'enlace_carpeta', label: 'Enlace a la carpeta' },
  { k: 'ciiu', label: 'Actividad económica (clase CIIU de 4 dígitos)', tipo: 'ciiu' },
  { k: 'actividad_no_financiable', label: 'Actividad no financiable (bloquea la capitalización)', tipo: 'lista', lista: 'actividades_no_financiables' },
  { k: 'necesidades', label: 'Necesidades', tipo: 'largo' }, { k: 'observaciones', label: 'Observaciones', tipo: 'largo' },
];

export const CAMPOS_REPRESENTANTE = [
  { k: 'nombre1', label: 'Primer nombre' }, { k: 'nombre2', label: 'Segundo nombre' },
  { k: 'apellido1', label: 'Primer apellido' }, { k: 'apellido2', label: 'Segundo apellido' },
  { k: 'sexo', label: 'Sexo' }, { k: 'fecha_nacimiento', label: 'Fecha de nacimiento', tipo: 'fecha' },
  { k: 'documento_expedicion', label: 'Lugar de expedición del documento' },
  { k: 'telefono1', label: 'Teléfono 1' }, { k: 'telefono2', label: 'Teléfono 2' },
  { k: 'correo1', label: 'Correo 1' }, { k: 'correo2', label: 'Correo 2' },
  { k: 'tiene_correo2', label: 'Tiene correo 2', tipo: 'sino' }, { k: 'direccion', label: 'Dirección' },
];

// Campos editables del expediente; p es la ruta dentro del documento.
export const CAMPOS_EXPEDIENTE = [
  { p: 'doc_interventoria', label: 'Documento de interventoría' },
  { p: 'control.up_aprobada', label: 'U.P. aprobada', tipo: 'sino' }, { p: 'control.lote_up_aprobada', label: 'Lote de aprobación' },
  { p: 'control.doc_completa_gestor', label: 'Documentación completa (gestor)', tipo: 'sino' },
  { p: 'control.doc_completa_triada', label: 'Documentación completa (tríada)', tipo: 'sino' },
  { p: 'control.novedad_dps_gestor', label: 'Novedad DPS (gestor)' },
  { p: 'control.novedad_contacto_no_posible', label: 'Contacto no posible', tipo: 'sino' },
  { p: 'rit.tiene_rit', label: 'Tiene RIT', tipo: 'sino' }, { p: 'rit.fecha_enviado', label: 'RIT enviado el', tipo: 'fechahora' },
  { p: 'rit.total_dias', label: 'Total de días del RIT', tipo: 'entero' }, { p: 'rit.ubicacion', label: 'Ubicación del RIT' },
  { p: 'rit.direccion', label: 'Dirección del RIT' }, { p: 'rit.latitud', label: 'Latitud', tipo: 'numero' },
  { p: 'rit.longitud', label: 'Longitud', tipo: 'numero' }, { p: 'pdf_carrito.estado', label: 'Estado del PDF del carrito' },
  { p: 'viabilidad.plan_inversion', label: 'Viabilidad del plan de inversión' },
  { p: 'aprobacion.plan_negocio', label: 'Aprobación del plan de negocio' },
  { p: 'subsanaciones.comite', label: 'Subsanaciones del comité', tipo: 'largo' },
  { p: 'subsanaciones.proceso_subsanacion', label: 'Proceso de subsanación', tipo: 'largo' },
  { p: 'evento.asistencia', label: 'Asistencia al evento' }, { p: 'observaciones', label: 'Observaciones del expediente', tipo: 'largo' },
];

const leer = (obj, ruta) => ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// Convierte un valor del servidor en el texto del formulario: vacío sin dato y si o no para los sí o no.
export function aTexto(v, tipo) {
  if (v === null || v === undefined) return '';
  if (tipo === 'sino') return v === true ? 'si' : v === false ? 'no' : '';
  if (tipo === 'fecha') return String(v).slice(0, 10);
  if (tipo === 'fechahora') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return String(v);
}

// Convierte el texto del formulario en el valor para el servidor; vacío deja el campo sin dato.
export function deTexto(t, tipo) {
  if (t === '' || t === undefined) return null;
  if (tipo === 'sino') return t === 'si';
  if (tipo === 'fechahora') return new Date(t).toISOString();
  return t;
}

// Pide los valores actuales de la unidad como textos de formulario; el expediente es null si no tiene
// expediente documental.
export async function cargarDatosEditables(idUnico, session) {
  const [u, e] = await Promise.all([
    fetchApi(UNIDAD_URL, { token: session?.token, params: { id: idUnico } }),
    fetchApi(DOCUMENTO_URL, { token: session?.token, params: { id: idUnico } }).catch(() => null),
  ]);
  const item = u.item || {};
  const exp = e?.item || null;
  return {
    up: Object.fromEntries(CAMPOS_UP.map((c) => [c.k, aTexto(item.datos_up?.[c.k], c.tipo)])),
    representante: Object.fromEntries(CAMPOS_REPRESENTANTE.map((c) => [c.k, aTexto(item.datos_representante?.[c.k], c.tipo)])),
    expediente: exp ? Object.fromEntries(CAMPOS_EXPEDIENTE.map((c) => [c.p, aTexto(leer(exp, c.p), c.tipo)])) : null,
  };
}

// Arma el cuerpo solo con lo que cambió.
export function armarCambios(inicial, actual) {
  const cuerpo = { datos_up: {}, datos_representante: {}, expediente: {} };
  CAMPOS_UP.forEach((c) => {
    if (actual.up[c.k] !== inicial.up[c.k]) cuerpo.datos_up[c.k] = deTexto(actual.up[c.k], c.tipo);
  });
  CAMPOS_REPRESENTANTE.forEach((c) => {
    if (actual.representante[c.k] !== inicial.representante[c.k]) {
      cuerpo.datos_representante[c.k] = deTexto(actual.representante[c.k], c.tipo);
    }
  });
  if (inicial.expediente) {
    CAMPOS_EXPEDIENTE.forEach((c) => {
      if (actual.expediente[c.p] === inicial.expediente[c.p]) return;
      const [a, b] = c.p.includes('.') ? c.p.split('.') : [c.p, null];
      if (b) cuerpo.expediente[a] = { ...(cuerpo.expediente[a] || {}), [b]: deTexto(actual.expediente[c.p], c.tipo) };
      else cuerpo.expediente[a] = deTexto(actual.expediente[c.p], c.tipo);
    });
  }
  return cuerpo;
}

export const hayCambios = (c) => Object.values(c).some((s) => Object.keys(s).length);

export async function guardarDatosUnidad(idUnico, cambios, session) {
  return fetchApi(UNIDAD_EDITAR_URL, { token: session?.token, metodo: 'POST', cuerpo: { id_unico: idUnico, ...cambios } });
}
