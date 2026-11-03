// Catálogo y adaptador de las visitas. Visitas.jsx solo habla con este archivo, que lee y escribe en la API
// (tabla visitas, columna documento y soportes en el almacenamiento del servidor). Define los tipos de visita
// con sus formatos, las reglas de obligatoriedad por modalidad, el avance de cada unidad y la conversión entre
// el documento guardado y el estado interno de la pantalla.
import {
  SIN_DATOS, VISITAS_URL, VISITA_URL, VISITA_ARCHIVO_URL, VISITA_FORMATOS_URL,
  FETCH_TIMEOUT,
} from './config';
import { fetchApi, AppError } from './api';
import { cabecerasSesion } from './csrf';

const PDF = '.pdf';
const XLS = '.xlsx,.xls';
const IMG = 'image/*';
const VID = 'video/*';
const DOC = `${PDF},${IMG}`;
const M2_M4 = ['M2', 'M3', 'M4'];
// Soporte opcional de una visita virtual por causa externa, que se exige solo si la visita es virtual.
const SOPORTE_VIRTUAL = { nombre: 'Soporte de la visita virtual', accept: DOC, opcional: true,
  desc: 'Solo si la visita se hizo virtual por una causa externa: el documento que la justifica (orden público, emergencia…).' };
export const FORMATO_SOPORTE_VIRTUAL = SOPORTE_VIRTUAL.nombre;
// Causas de una visita virtual, las mismas del servidor.
export const CAUSAS_VIRTUAL = [
  { codigo: 'orden_publico', nombre: 'Orden público' },
  { codigo: 'desastre', nombre: 'Desastre natural o emergencia' },
  { codigo: 'otra', nombre: 'Otra causa externa' },
];

// Devuelve lo que le falta a una visita virtual para cerrarse; el servidor lo exige igual.
export function faltantesVirtual(v, archivos) {
  if (v?.modalidadVisita !== 'virtual') return [];
  const faltan = [];
  if (!v.causaVirtual || !String(v.justificacionVirtual || '').trim()) faltan.push('la causa externa y la justificación de la visita virtual');
  const a = archivos?.[FORMATO_SOPORTE_VIRTUAL];
  if (!(Array.isArray(a) ? a.length : a)) faltan.push(`el formato «${FORMATO_SOPORTE_VIRTUAL}»`);
  if (!v.aprobacionVirtual) faltan.push('la aprobación de la interventoría (la registra la coordinación)');
  return faltan;
}

// Catálogo de los tipos de visita con sus formatos, el archivo en blanco de cada uno y sus reglas.
export const TIPOS_VISITA = [
  {
    id: 'v1', carpeta: '01_VISITA_1_CARACTERIZACION',
    nombre: 'Visita 1 — Caracterización', corto: 'Visita 1',
    desc: 'Primer acercamiento, verificación de datos, acta de compromiso y documentos del beneficiario.',
    nota: 'Cuando se presente un acta de retiro, debe ir acompañada del Acta de Novedades, que justifica formalmente el motivo del retiro de la unidad productiva.',
    requiere: [],
    formatos: [
      { nombre: 'Acta de Compromiso', codigo: '01', accept: PDF, plantilla: 'ACTA DE COMPROMISO',
        formato: '01_Acta_de_Compromiso.pdf',
        desc: 'Documento en el que el beneficiario manifiesta su compromiso con el proyecto y sus obligaciones.' },
      { nombre: 'Acta de Visita 1', codigo: '06', accept: PDF, plantilla: 'ACTA DE VISITA',
        formato: '06_Acta_de_Visita_1.pdf',
        desc: 'Formato oficial que registra la información recolectada durante la visita de caracterización.' },
      { nombre: 'Imágenes de caracterización', accept: IMG, multiple: true,
        minimos: { imagen: 4 },
        desc: 'Registro fotográfico de la visita y de la unidad productiva (4 imágenes).' },
      { nombre: 'Video de caracterización', accept: VID, minimos: { video: 1 },
        desc: 'Registro audiovisual que evidencia la visita y la caracterización de la unidad productiva.' },
      { nombre: 'Autorización para el tratamiento de datos personales', codigo: '22', accept: PDF,
        plantilla: 'AUTORIZACION TRATAMIENTO DE DATOS', formato: '22_Autorizacion_tratamiento_de_datos_personales.pdf',
        desc: 'Autorización del beneficiario para el tratamiento de sus datos personales conforme a la normatividad vigente.' },
      { nombre: 'Acta de Novedades', codigo: '03', accept: PDF, opcional: true, plantilla: 'ACTA DE NOVEDADES',
        formato: '03_Acta_de_Novedades.pdf',
        desc: 'Registra situaciones o novedades identificadas durante la visita.' },
      { nombre: 'Acta de No Aceptación', codigo: '02', accept: PDF, opcional: true, plantilla: 'ACTA DE NO ACEPTACION',
        formato: '02_Acta_de_No_Aceptacion.pdf',
        desc: 'Se diligencia cuando el beneficiario decide no continuar con el proceso.' },
      { nombre: 'Acta de Retiro', codigo: '04', accept: PDF, opcional: true, plantilla: 'ACTA DE RETIRO',
        formato: '04_Acta_de_Retiro.pdf',
        desc: 'Registra el retiro voluntario de la unidad productiva del proyecto. Debe ir con el Acta de Novedades.' },
      { nombre: 'Cédula del representante legal', seccion: 'beneficiario', accept: DOC,
        desc: 'Documento de identidad del representante legal de la unidad productiva.' },
      { nombre: 'Cédulas de los asociados', seccion: 'beneficiario', accept: DOC, multiple: true,
        modalidades: M2_M4,
        desc: 'Documentos de identidad de los asociados de la unidad productiva.' },
      { nombre: 'RUT', seccion: 'beneficiario', accept: PDF, obligatorioEn: ['M3', 'M4'],
        desc: 'Registro Único Tributario de la unidad productiva.' },
      { nombre: 'Certificado de existencia o Cámara de comercio', seccion: 'beneficiario', accept: PDF,
        obligatorioEn: ['M3', 'M4'],
        desc: 'Certificado de existencia y representación legal o de Cámara de comercio.' },
      { nombre: 'Tenencia', seccion: 'beneficiario', accept: DOC, multiple: true, obligatorioEn: M2_M4,
        desc: 'Soporte de la tenencia del lugar donde funciona la unidad productiva.' },
      SOPORTE_VIRTUAL,
    ],
    dependencias: [['Acta de Retiro', 'Acta de Novedades']],
    salidas: ['Acta de No Aceptación', 'Acta de Retiro'],
    exigeEnSalida: ['Acta de Visita 1'],
  },
  {
    id: 'v2', carpeta: '02_VISITA_2_DIAGNOSTICO',
    nombre: 'Visita 2 — Diagnóstico', corto: 'Visita 2',
    desc: 'Levantamiento del diagnóstico según la modalidad (M1 individual; M2, M3, M4 solidario) y construcción del plan de negocio.',
    requiere: ['v1'],
    formatos: [
      { nombre: 'Acta de Visita 2', codigo: '06', accept: PDF, plantilla: 'ACTA DE VISITA',
        formato: '06_Acta_de_Visita_2.pdf',
        desc: 'Formato oficial que registra la información recolectada durante la visita de diagnóstico.' },
      { nombre: 'Diagnóstico de unidades productivas individuales (M1)', codigo: '09', accept: PDF,
        modalidades: ['M1'], alternativas: 'diagnostico', plantilla: 'DIAGNOSTICO INDIVIDUAL',
        formato: '09_Diagnostico_UP_individuales_M1.pdf',
        desc: 'Análisis de la situación actual, necesidades y potencialidades de la unidad productiva individual.' },
      { nombre: 'Diagnóstico de unidades productivas solidarias (M2, M3, M4)', codigo: '10', accept: PDF,
        modalidades: M2_M4, alternativas: 'diagnostico', plantilla: 'DIAGNOSTICO SOLIDARIO',
        formato: '10_Diagnostico_UP_solidarias_M2_M3_M4.pdf',
        desc: 'Análisis de la situación actual, necesidades y potencialidades de la unidad productiva solidaria.' },
      { nombre: 'Plan de negocios', codigo: '16', accept: `${XLS},${PDF}`, plantilla: 'PLAN DE NEGOCIOS',
        formato: '16_Plan_de_Negocio.pdf',
        desc: 'Propuesta de negocio: objetivos, estrategias, actividades, presupuesto y proyecciones de la unidad productiva.' },
      { nombre: 'Indicadores iniciales INNPULSA', accept: `${XLS},${PDF}`, plantilla: 'INDICADORES INICIALES INNPULSA',
        desc: 'Formato de indicadores iniciales de INNPULSA diligenciado en la visita de diagnóstico.' },
      { nombre: 'Video de recorrido con entrevista', accept: VID, minimos: { video: 1 },
        desc: 'Recorrido por la unidad productiva con la entrevista al beneficiario (se comprime antes de subirlo).' },
      SOPORTE_VIRTUAL,
    ],
  },
  {
    id: 'v3', carpeta: '05_ACOMPAÑAMIENTO_Y_SEGUIMIENTO',
    nombre: 'Visita 3 — Acompañamiento y seguimiento', corto: 'Visita 3',
    desc: 'Acompañamiento y seguimiento: verificación del uso de los bienes y cierre del proceso.',
    requiere: ['v2'],
    formatos: [
      { nombre: 'Bitácora', accept: PDF, plantilla: 'BITACORA',
        desc: 'Registra las actividades realizadas durante el acompañamiento.' },
      { nombre: 'Acta de Visita 3', codigo: '06', accept: PDF, plantilla: 'ACTA DE VISITA',
        formato: '06_Acta_de_Visita_3.pdf',
        desc: 'Certifica la realización de la tercera visita de seguimiento.' },
      { nombre: 'Registro fotográfico', accept: `${IMG},${PDF}`, multiple: true,
        desc: 'Evidencia visual de las actividades realizadas.' },
      { nombre: 'Video de salida', accept: VID, minimos: { video: 1 },
        desc: 'Registro audiovisual que evidencia el cierre del proceso de acompañamiento.' },
      SOPORTE_VIRTUAL,
    ],
  },
  {
    id: 'fort', carpeta: '03_FORTALECIMIENTO_Y_TRANSFERENCIA_CONOCIMIENTOS', legado: true,
    nombre: 'Fortalecimiento y transferencia de conocimientos', corto: 'Fortalecimiento',
    desc: 'Talleres por módulo, con evidencia fotográfica o audiovisual y listas de asistencia.',
    nota: 'Es un solo registro por unidad productiva: después de cada taller carga lo de ese módulo y déjala en «Pendiente de soportes» hasta completar los tres módulos. Se pueden incluir varias fotos y videos, sin límite, enumerados en secuencia. El video 1 y la foto 1 deben corresponder exclusivamente a la unidad productiva.',
    requiere: ['v1'],
    formatos: [
      { nombre: 'Foto individual de la unidad productiva — Módulo 1', subcarpeta: 'MODULO_1',
        accept: IMG, multiple: true,
        nombreArchivo: (c) => `Foto #_ID${c.id}_${c.doc}` },
      { nombre: 'Lista de asistencia — Módulo 1', codigo: '17', subcarpeta: 'MODULO_1', accept: PDF,
        nombreArchivo: (c) => `${c.taller}_${c.region}_${c.dpto}_MODULO1` },
      { nombre: 'Video de la unidad productiva — Módulo 2', subcarpeta: 'MODULO_2',
        accept: VID, multiple: true,
        nombreArchivo: (c) => `Video #_ID${c.id}_${c.doc}` },
      { nombre: 'Lista de asistencia — Módulo 2', codigo: '17', subcarpeta: 'MODULO_2', accept: PDF,
        nombreArchivo: (c) => `${c.taller}_${c.region}_${c.dpto}_MODULO2` },
      { nombre: 'Foto grupal de las unidades productivas — Módulo 3', subcarpeta: 'MODULO_3',
        accept: IMG, multiple: true,
        nombreArchivo: () => 'FOTO GRUPAL #' },
      { nombre: 'Lista de asistencia — Módulo 3', codigo: '17', subcarpeta: 'MODULO_3', accept: PDF,
        nombreArchivo: (c) => `${c.taller}_${c.region}_${c.dpto}_MODULO3` },
      { nombre: 'Informe individual', accept: PDF,
        nombreArchivo: (c) => `Informe_ID${c.id}_${c.doc}` },
      { nombre: 'Informe grupal', accept: PDF,
        nombreArchivo: (c) => `INFORME GRUPAL_${c.taller}_${c.region}_${c.dpto}` },
      { nombre: 'Encuestas', accept: PDF,
        nombreArchivo: (c) => `Encuestas_${c.doc}` },
      { nombre: 'Lista de asistencia refrigerio', codigo: '17', accept: PDF,
        nombreArchivo: (c) => `${c.taller}_${c.region}_${c.dpto}_REFRIGERIO` },
    ],
  },
  {
    id: 'cap', carpeta: '04_CAPITALIZACION', legado: true,
    nombre: 'Capitalización', corto: 'Capitalización',
    desc: 'Entrega de bienes o servicios a la unidad productiva.',
    requiere: ['v2'],
    formatos: [
      { nombre: 'Plan de negocio', codigo: '16', accept: `${PDF},${XLS}`,
        desc: 'Firmado por el representante de la unidad productiva y el consultor que la acompaña.' },
      { nombre: 'Plan de inversión', accept: PDF,
        desc: 'Detalla la asignación de recursos financieros a la unidad productiva.' },
      { nombre: 'Actas de comités de aprobación', accept: PDF, multiple: true,
        desc: 'Registran las decisiones y aprobaciones del comité.' },
      { nombre: 'Órdenes de pedido', codigo: '14', accept: `${PDF},${XLS}`, multiple: true,
        desc: 'Respaldan la solicitud y aprobación de los bienes o servicios.' },
      { nombre: 'Actas de entregas', codigo: '13', accept: `${PDF},${XLS}`, multiple: true,
        desc: 'Certifican la entrega de los bienes o servicios.' },
      { nombre: 'Recibido a satisfacción de la entrega de activos', codigo: '21', accept: PDF,
        desc: 'El beneficiario certifica que recibió los activos a satisfacción.' },
      { nombre: 'Evidencia fotográfica de las entregas (fotos y videos)', accept: `${IMG},${VID}`, multiple: true,
        desc: 'Registro fotográfico y audiovisual que evidencia las entregas realizadas.' },
    ],
  },
  {
    id: 'nov', carpeta: '06_NOVEDADES', legado: true,
    nombre: 'Visita de novedad', corto: 'Novedad',
    desc: 'Atención de una novedad reportada por el gestor o el beneficiario.',
    requiere: [],
    formatos: [
      { nombre: 'Acta de novedad', accept: PDF },
      { nombre: 'Soporte de la novedad', accept: `${PDF},${IMG},${VID}`, multiple: true },
    ],
  },
];

// Tipos que se pueden programar hoy, sin los de legado.
export const TIPOS_PROCESO = TIPOS_VISITA.filter((t) => !t.legado);

export const NOTA_GENERAL =
  'Todos los documentos deben diligenciarse completamente, firmarse y entregarse en la carpeta indicada.';

// Devuelve la modalidad de la unidad normalizada de M1 a M4, o vacío si no se conoce.
export function modalidadUP(up) {
  const m = /M\s*([1-4])/i.exec(String(up?.modalidad || ''));
  return m ? `M${m[1]}` : '';
}

// Devuelve los formatos que aplican a esta unidad ya resueltos según su modalidad.
export function formatosDe(tipo, up) {
  if (!tipo) return [];
  const mod = modalidadUP(up);
  return tipo.formatos
    .filter((f) => !f.modalidades || !mod || f.modalidades.includes(mod))
    .map((f) => {
      if (!mod && f.modalidades) {
        return f.alternativas ? { ...f, alternativa: true } : { ...f, opcional: true, segunModalidad: true };
      }
      if (f.obligatorioEn) {
        if (!mod) return { ...f, opcional: true, segunModalidad: true };
        return { ...f, opcional: !f.obligatorioEn.includes(mod) };
      }
      return f;
    });
}

// Devuelve el texto de la regla por modalidad, como M2-M3-M4.
export function modalidadesTexto(f) {
  const lista = f?.obligatorioEn || f?.modalidades;
  return lista?.length ? lista.join('-') : '';
}

// Devuelve los formatos de la visita en las tres columnas de la tabla: obligatorios, opcionales y documentos
// del beneficiario.
export function gruposFormatos(tipo, up) {
  const lista = formatosDe(tipo, up);
  const deVisita = lista.filter((f) => f.seccion !== 'beneficiario');
  const beneficiario = lista.filter((f) => f.seccion === 'beneficiario');
  return {
    obligatorios: deVisita.filter((f) => !f.opcional),
    opcionales: deVisita.filter((f) => f.opcional),
    beneficiario,
    beneficiarioObligatorios: beneficiario.filter((f) => !f.opcional),
    beneficiarioOpcionales: beneficiario.filter((f) => f.opcional),
  };
}

// Indica si hay archivo cargado para ese formato.
function tieneArchivo(archivos, nombre) {
  const a = archivos?.[nombre];
  return Array.isArray(a) ? a.length > 0 : !!a;
}

// Devuelve las actas de salida cargadas en la visita; si hay alguna, la unidad sale del programa y la visita se
// cierra solo con lo de la salida.
export function salidasCargadas(tipo, archivos) {
  return (tipo?.salidas || []).filter((n) => tieneArchivo(archivos, n));
}

// Devuelve los datos para armar el nombre sugerido del archivo; el taller no existe en la base y se deja T#
// para que se escriba el número.
export function contextoNombre(up) {
  const reg = /(\d+)/.exec(String(up?.region || ''));
  return {
    id: String(up?.ID_unico ?? '0000').padStart(4, '0'),
    doc: String(up?.unidad_doc || up?.integrante_doc_inicial || ''),
    dpto: String(up?.dpto || 'DEPARTAMENTO').toUpperCase(),
    region: reg ? `R${reg[1]}` : 'R#',
    taller: 'T#',
  };
}

const RE_VIDEO = /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/i;
const RE_IMAGEN = /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i;
// Devuelve la clase de un archivo cargado según la extensión de su nombre.
function claseArchivo(a) {
  const n = String(a?.nombre || '');
  return RE_VIDEO.test(n) ? 'video' : RE_IMAGEN.test(n) ? 'imagen' : 'otro';
}

const ETIQUETA_CLASE = { video: ['video', 'videos'], imagen: ['imagen', 'imágenes'] };

// Para los formatos con mínimos, devuelve por clase lo que tiene y lo que se pide.
export function conteoMinimos(f, valor) {
  if (!f?.minimos) return [];
  const lista = Array.isArray(valor) ? valor : valor ? [valor] : [];
  return Object.entries(f.minimos).map(([clase, pide]) => ({
    clase, pide,
    tiene: lista.filter((a) => claseArchivo(a) === clase).length,
    etiqueta: ETIQUETA_CLASE[clase]?.[pide === 1 ? 0 : 1] || clase,
  }));
}

// Devuelve los formatos obligatorios que faltan, con las dependencias si aplica, los mínimos por clase, el
// diagnóstico cuando no se conoce la modalidad y la regla de salida.
export function formatosFaltantes(tipo, up, archivos) {
  const tiene = (n) => tieneArchivo(archivos, n);
  const dependencias = (lista) => {
    (tipo?.dependencias || []).forEach(([si, entonces]) => {
      if (tiene(si) && !tiene(entonces) && !lista.includes(entonces)) lista.push(entonces);
    });
    return lista;
  };

  if (salidasCargadas(tipo, archivos).length) {
    return dependencias((tipo.exigeEnSalida || []).filter((n) => !tiene(n)));
  }

  const describir = (f) => {
    const cortos = conteoMinimos(f, archivos?.[f.nombre]).filter((c) => c.tiene < c.pide);
    if (!cortos.length) return null;
    if (!tiene(f.nombre)) return f.nombre;
    return `${f.nombre} (${cortos.map((c) => `lleva ${c.tiene} de ${c.pide} ${c.etiqueta}`).join(', ')})`;
  };
  const lista = formatosDe(tipo, up);
  const faltan = lista.filter((f) => !f.opcional && !f.alternativa)
    .map((f) => (!tiene(f.nombre) ? f.nombre : describir(f)))
    .filter(Boolean);
  const alternativas = lista.filter((f) => f.alternativa);
  if (alternativas.length && !alternativas.some((f) => tiene(f.nombre))) {
    faltan.push(alternativas.map((f) => f.nombre).join(' o '));
  }
  return dependencias(faltan);
}

export const RESULTADOS_AGENDA = [
  { id: 'agendada',   label: 'Agendada',            tono: 'ok' },
  { id: 'reagendar',  label: 'Solicita reagendar',  tono: 'warn' },
  { id: 'nocontesta', label: 'No contesta',         tono: 'warn' },
  { id: 'errado',     label: 'Número errado',       tono: 'bad' },
  { id: 'rechaza',    label: 'No acepta la visita', tono: 'bad' },
];

export const ESTADOS_VISITA = [
  { id: 'exitosa',     label: 'Visita exitosa',     tono: 'ok',
    desc: 'La visita se realizó y los formatos están completos.' },
  { id: 'revision',    label: 'Pendiente de soportes', tono: 'warn',
    desc: 'La visita se realizó, pero faltan formatos. Queda abierta hasta completarlos.' },
  { id: 'norealizada', label: 'No se realizó',      tono: 'bad',
    desc: 'La visita no pudo llevarse a cabo. Vuelve a quedar por programar.' },
];

export const tipoDeVisita = (id) => TIPOS_VISITA.find((t) => t.id === id) || null;

export function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Indica si la visita quedó pactada con fecha y hora en la llamada.
export const estaAgendada = (v) => v.resultado === 'agendada' && !!v.fecha && !!v.hora;

// Indica si la visita se puede realizar y cerrar, que solo ocurre desde el día pactado.
export const puedeRealizarse = (v, hoy = hoyISO()) => estaAgendada(v) && v.fecha <= hoy;

// Devuelve la situación de un documento de visita para las listas: cerrada, soportes, hoy, vencida, próxima o
// sin fecha.
export function situacionVisita(doc, hoy = hoyISO()) {
  if (doc.cierre?.cerrada) return 'cerrada';
  if (String(doc.estado_visita).toLowerCase() === 'revision') return 'soportes';
  const c = doc.contacto_control || {};
  if (String(c.resultado_agendamiento).toLowerCase() !== 'agendada' || !c.fecha) return 'sinfecha';
  if (c.fecha === hoy) return 'hoy';
  return c.fecha < hoy ? 'vencida' : 'proxima';
}

// Devuelve el acta con la que la unidad salió del programa, o null si sigue en el proceso.
export function salidaDelProceso(visitasUP) {
  for (const x of visitasUP) {
    if (!x.cierre?.cerrada) continue;
    const s = salidasCargadas(tipoDeVisita(x.tipo_visita), x.post_visita?.cargue_formatos);
    if (s.length) return s[0];
  }
  return null;
}

// Calcula el avance de una unidad en el proceso a partir de sus visitas guardadas, con una fila por tipo y su
// estado.
export function avanceUP(visitasUP) {
  const cerradas = (id) => visitasUP.filter((x) => x.tipo_visita === id && x.cierre?.cerrada);
  const salida = salidaDelProceso(visitasUP);
  return TIPOS_PROCESO.map((t) => {
    const abierta = visitasUP.find((x) => x.tipo_visita === t.id && !x.cierre?.cerrada) || null;
    const faltan = (t.requiere || []).filter((r) => !cerradas(r).length)
      .map((r) => tipoDeVisita(r)?.nombre || r);
    let estado;
    if (cerradas(t.id).length) estado = 'hecha';
    else if (abierta) estado = 'abierta';
    else if (salida) estado = 'fuera';
    else estado = faltan.length ? 'bloqueada' : 'disponible';
    return { tipo: t, estado, abierta, faltan, salida };
  });
}

// Genera el objeto con cada formato del catálogo en falso.
export function formatosVacios(tipo) {
  const m = {};
  (tipo?.formatos || []).forEach((f) => { m[f.nombre] = false; });
  return m;
}

const ahora = () => new Date().toISOString();
const texto = (s) => (s && String(s).trim() ? String(s).trim() : SIN_DATOS);

const RESULTADO_A_API = {
  agendada: 'AGENDADA', reagendar: 'SOLICITA_REAGENDAR', nocontesta: 'NO_CONTESTA',
  errado: 'NUMERO_ERRADO', rechaza: 'NO_ACEPTA',
};
const ESTADO_A_API = { exitosa: 'EXITOSA', revision: 'PENDIENTE_SOPORTES', norealizada: 'NO_REALIZADA' };
const invertir = (m) => Object.fromEntries(Object.entries(m).map(([k, x]) => [x, k]));
const RESULTADO_DE_API = invertir(RESULTADO_A_API);
const ESTADO_DE_API = invertir(ESTADO_A_API);

// Nombres de los grupos dentro de alistamiento y soportes.
export const GRUPOS_DOC = {
  obligatorios: 'documentos_visita_obligatorios',
  opcionales: 'documentos_visita_opcionales',
  beneficiario: 'documentos_beneficiario',
};
const OTROS_DOC = 'otros_documentos';

const lista = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// Devuelve la situación resumida para filtrar las listas sin abrir cada sección.
function situacionDe(v) {
  if (v.cerrada) return 'CERRADA';
  if (v.estado === 'revision') return 'PENDIENTE_SOPORTES';
  if (v.resultado === 'agendada' && v.fecha) return 'PROGRAMADA';
  return 'SIN_FECHA';
}

// Convierte un archivo interno en soporte guardado.
function soporteAApi(a) {
  return {
    archivo: a?.nombre || SIN_DATOS,
    blob: a?.blob || null,
    peso_bytes: a?.tamano || null,
    cargado_en: a?.fecha_cargue || null,
    cargado_por: a?.por || null,
  };
}
// Convierte un soporte guardado en archivo interno.
function soporteDeApi(s) {
  return {
    nombre: s?.archivo && s.archivo !== SIN_DATOS ? s.archivo : '',
    tamano: s?.peso_bytes || 0,
    blob: s?.blob || null,
    fecha_cargue: s?.cargado_en || null,
    por: s?.cargado_por || null,
  };
}

// Convierte el estado de la pantalla en el documento de la visita.
export function mapearVisita(v, session) {
  const tipo = tipoDeVisita(v.tipo);
  const grupos = gruposFormatos(tipo, v.up);
  const usados = new Set(Object.values(grupos).flat().map((f) => f.nombre));
  const porGrupo = (conv) => Object.fromEntries(Object.entries(GRUPOS_DOC)
    .map(([g, clave]) => [clave, Object.fromEntries(grupos[g].map((f) => [f.nombre, conv(f.nombre)]))]));
  const soportes = porGrupo((n) => lista(v.archivos?.[n]).map(soporteAApi));
  const otros = Object.entries(v.archivos || {}).filter(([n, x]) => !usados.has(n) && lista(x).length);
  if (otros.length) {
    soportes[OTROS_DOC] = Object.fromEntries(otros.map(([n, x]) => [n, lista(x).map(soporteAApi)]));
  }
  const ahoraIso = ahora();
  const quien = session?.nombre || session?.nodo || SIN_DATOS;
  return {
    id: v.id || null,
    nodo: texto(v.up?.nodo || session?.nodo),

    unidad: {
      id_unico: v.up?.ID_unico ?? null,
      nombre: texto(v.up?.unidad_nombre),
      documento: docUP(v.up?.unidad_doc),
      modalidad: modalidadUP(v.up) || SIN_DATOS,
    },

    visita: {
      tipo: v.tipo,
      nombre: tipo?.nombre || SIN_DATOS,
      carpeta: tipo?.carpeta || SIN_DATOS,
    },

    situacion: situacionDe(v),

    programacion: {
      contacto_logrado: v.llamada ? v.llamada.toUpperCase() : SIN_DATOS,
      intentos_llamada: v.intentos ? Number(v.intentos) : null,
      resultado_llamada: RESULTADO_A_API[v.resultado] || SIN_DATOS,
      fecha_visita: v.fecha || null,
      hora_visita: v.hora || null,
      fechas_anteriores: (v.historialAgenda || []).map((h) => ({
        fecha: h.fecha || null, hora: h.hora || null, motivo: h.motivo || SIN_DATOS,
        registrado_en: h.en || null, registrado_por: h.por || null,
      })),
    },

    alistamiento: {
      confirmado_en: v.fechaConfirmacion || null,
      ...porGrupo((n) => !!v.confirmados?.[n]),
    },

    realizacion: {
      estado: ESTADO_A_API[v.estado] || SIN_DATOS,
      modalidad: v.modalidadVisita === 'virtual' ? 'VIRTUAL' : 'PRESENCIAL',
      ...(v.modalidadVisita === 'virtual' ? { causa_virtual: v.causaVirtual || null, justificacion_virtual: v.justificacionVirtual || null } : {}),
    },

    soportes,

    cierre: {
      cerrada: !!v.cerrada, fecha_cierre: v.fechaCierre || null, cerrada_por: v.cerradaPor || null,
      reaperturas: v.reaperturas || [],
    },

    registro: {
      creado_en: v.creado_en || ahoraIso,
      creado_por: v.creadoPor || quien,
      actualizado_en: ahoraIso,
      actualizado_por: quien,
    },
  };
}

// Convierte el documento guardado en el estado interno que usan las listas; los documentos del formato anterior
// pasan tal cual.
export function deApi(doc) {
  if (!doc || doc.contacto_control) return doc;
  const p = doc.programacion || {};
  const tipo = tipoDeVisita(doc.visita?.tipo);
  const multiple = (n) => !!tipo?.formatos.find((f) => f.nombre === n)?.multiple;
  const confirmados = {};
  Object.values(GRUPOS_DOC).forEach((g) => Object.assign(confirmados, doc.alistamiento?.[g] || {}));
  const archivos = {};
  [...Object.values(GRUPOS_DOC), OTROS_DOC].forEach((g) => {
    Object.entries(doc.soportes?.[g] || {}).forEach(([n, sops]) => {
      const arch = lista(sops).map(soporteDeApi);
      archivos[n] = multiple(n) ? arch : (arch[0] || false);
    });
  });
  const sinDato = (x) => (x && x !== SIN_DATOS ? x : null);
  return {
    id: doc.id,
    nodo_gestor: doc.nodo,
    id_unico: doc.unidad?.id_unico ?? null,
    unidad_nombre: doc.unidad?.nombre,
    unidad_doc: doc.unidad?.documento || '',
    modalidad: sinDato(doc.unidad?.modalidad),
    tipo_visita: doc.visita?.tipo,
    tipo_visita_label: doc.visita?.nombre,
    contacto_control: {
      logro_contactar: p.contacto_logrado || SIN_DATOS,
      numero_intentos: p.intentos_llamada ?? null,
      resultado_agendamiento: (RESULTADO_DE_API[p.resultado_llamada] || SIN_DATOS).toUpperCase(),
      fecha: p.fecha_visita || null,
      hora: p.hora_visita || null,
      historial: (p.fechas_anteriores || []).map((h) => ({
        fecha: h.fecha, hora: h.hora, motivo: sinDato(h.motivo), en: h.registrado_en, por: h.registrado_por,
      })),
    },
    alistamiento: { confirmados, fecha_confirmacion: doc.alistamiento?.confirmado_en || null },
    post_visita: { cargue_formatos: archivos },
    estado_visita: (ESTADO_DE_API[doc.realizacion?.estado] || SIN_DATOS).toUpperCase(),
    realizacion_extra: {
      modalidad: doc.realizacion?.modalidad === 'VIRTUAL' ? 'virtual' : 'presencial',
      causa_virtual: doc.realizacion?.causa_virtual || '',
      justificacion_virtual: doc.realizacion?.justificacion_virtual || '',
      aprobacion: doc.realizacion?.aprobacion_interventoria || null,
    },
    cierre: { cerrada: !!doc.cierre?.cerrada, fecha_cierre: doc.cierre?.fecha_cierre || null,
      cerrada_por: doc.cierre?.cerrada_por || null, reaperturas: doc.cierre?.reaperturas || [] },
    creado_en: doc.registro?.creado_en || null,
    creado_por: doc.registro?.creado_por || null,
    fecha_actualizacion: doc.registro?.actualizado_en || null,
  };
}

// Formato antiguo de la primera visita, con un solo formato de video e imágenes; al reabrir una de esas visitas
// sus archivos se reparten en los dos formatos actuales.
const V1_ANTIGUO = 'Video de caracterización y 4 imágenes';
function archivosV1Antiguos(tipoId, archivos) {
  const viejo = archivos[V1_ANTIGUO];
  if (tipoId !== 'v1' || !viejo) return archivos;
  const lista = Array.isArray(viejo) ? viejo : [viejo];
  const resto = { ...archivos };
  delete resto[V1_ANTIGUO];
  const imgs = lista.filter((a) => claseArchivo(a) !== 'video');
  const video = lista.find((a) => claseArchivo(a) === 'video');
  const previasImgs = Array.isArray(resto['Imágenes de caracterización']) ? resto['Imágenes de caracterización'] : [];
  if (imgs.length) resto['Imágenes de caracterización'] = [...previasImgs, ...imgs];
  if (video && !resto['Video de caracterización']) resto['Video de caracterización'] = video;
  return resto;
}

// Convierte el documento de la visita en el estado de la pantalla, para reabrirla.
export function visitaAEstado(doc) {
  const c = doc.contacto_control || {};
  const low = (s) => (s && s !== SIN_DATOS ? String(s).toLowerCase() : null);
  return {
    id: doc.id,
    creado_en: doc.creado_en,
    creadoPor: doc.creado_por || null,
    fechaCierre: doc.cierre?.fecha_cierre || null,
    cerradaPor: doc.cierre?.cerrada_por || null,
    reaperturas: Array.isArray(doc.cierre?.reaperturas) ? doc.cierre.reaperturas : [],
    tipo: doc.tipo_visita,
    formatos: doc.formatos || {},
    llamada: low(c.logro_contactar),
    intentos: c.numero_intentos != null ? String(c.numero_intentos) : '1',
    resultado: low(c.resultado_agendamiento),
    fecha: c.fecha || '',
    hora: c.hora || '',
    historialAgenda: Array.isArray(c.historial) ? c.historial : [],
    archivos: archivosV1Antiguos(doc.tipo_visita, doc.post_visita?.cargue_formatos || {}),
    confirmados: doc.alistamiento?.confirmados || {},
    fechaConfirmacion: doc.alistamiento?.fecha_confirmacion || null,
    estado: low(doc.estado_visita),
    modalidadVisita: doc.realizacion_extra?.modalidad || 'presencial',
    causaVirtual: doc.realizacion_extra?.causa_virtual || '',
    justificacionVirtual: doc.realizacion_extra?.justificacion_virtual || '',
    aprobacionVirtual: doc.realizacion_extra?.aprobacion || null,
    cerrada: !!doc.cierre?.cerrada,
  };
}

// Devuelve el documento de la unidad como lo usa el servidor, solo letras y números, por ejemplo 1.001.234 pasa
// a 1001234.
export const docUP = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '');

// Equivalencia entre los errores del servidor y el mensaje que se muestra.
const MENSAJES = {
  'visita cerrada': 'La visita ya está cerrada. Recarga la página.',
  'fuera de alcance': 'Esta unidad productiva no pertenece a tu nodo.',
  'unidad no encontrada': 'La unidad productiva no está en la base. Avisa a coordinación.',
  'la unidad no tiene documento': 'La unidad productiva no tiene documento registrado. Avisa a coordinación.',
  'el documento no corresponde a la unidad': 'El documento de la unidad cambió. Recarga la página.',
  conflicto: 'Alguien más modificó esta visita. Recarga la página e intenta de nuevo.',
  'archivo muy pesado': `El archivo supera el máximo de 80 MB.`,
  'tipo de archivo no permitido': 'Ese tipo de archivo no se permite. Usa PDF, imagen, video o Excel.',
};
const esFrase = (s) => typeof s === 'string' && /\s/.test(s.trim()) && /[.»)]$/.test(s.trim());
export function mensajeVisita(e, porDefecto) {
  const clave = e?.respuesta || (/: (.+)$/.exec(e?.detail || '')?.[1]);
  return MENSAJES[clave] || (e?.code === 'E-SESION' ? e.publicMsg : null) || (esFrase(e?.respuesta) ? e.respuesta : null) || porDefecto;
}

// Devuelve un id legible con el documento y el tipo, y un sufijo numérico si el tipo se repite.
function siguienteId(unidadDoc, tipoId, existentes) {
  const base = `${unidadDoc}_${tipoId}`;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`);
  const n = existentes.filter((x) => re.test(x.id)).length;
  return n ? `${base}_${n + 1}` : base;
}

// Lista las visitas de una unidad productiva en estado interno.
export async function listarVisitas(unidadDoc, session) {
  if (!unidadDoc) return [];
  const r = await fetchApi(VISITAS_URL, {
    token: session?.token, params: { unidad_doc: unidadDoc },
  });
  return (r.items || []).map(deApi);
}

// Lista las visitas de todas las unidades que ve el usuario.
export async function listarTodasVisitas(ups, session) {
  const docs = new Set(ups.map((u) => docUP(u.unidad_doc)).filter(Boolean));
  const deEsteUsuario = (l) => l.filter((x) => docs.has(docUP(x.unidad_doc)));
  const r = await fetchApi(VISITAS_URL, { token: session?.token });
  return deEsteUsuario((r.items || []).map(deApi));
}

export const ROLES_REABREN = ['coordinador', 'admin', 'superadmin', 'coordinador_datos'];

// Crea o actualiza una visita y devuelve el documento guardado; con reabrir y motivo reabre una visita cerrada.
export async function guardarVisita(v, session, extra = {}) {
  const doc = mapearVisita(v, session);
  if (!doc.id) {
    if (!doc.unidad.documento) throw Object.assign(new Error('sin documento'), { respuesta: 'la unidad no tiene documento' });
    const existentes = await listarVisitas(doc.unidad.documento, session);
    doc.id = siguienteId(doc.unidad.documento, doc.visita.tipo, existentes);
  }

  const r = await fetchApi(VISITA_URL, { token: session?.token, metodo: 'POST', cuerpo: { visita: doc, ...extra } });
  const guardado = deApi(r.item || doc);
  if (r.aviso) Object.defineProperty(guardado, 'aviso', { value: r.aviso, enumerable: false });
  return guardado;
}

// Pide la entrega registrada y la fecha mínima de la tercera visita.
export async function pedirPlazoV3(idUnico, session) {
  const r = await fetchApi(`${VISITAS_URL}/plazo-v3`, { token: session?.token, params: { id_unico: idUnico } });
  return r.item;
}

// Devuelve el texto del plazo de la tercera visita para avisarlo antes de programarla.
export function textoPlazoV3(p) {
  if (!p) return '';
  if (!p.fecha_entrega) return 'La unidad aún no tiene una entrega de bienes registrada: la Visita 3 se programa después de la entrega.';
  return `Entrega registrada el ${p.fecha_entrega}: la Visita 3 se programa desde el ${p.desde} (${p.dias} días después).`;
}

// Tope por archivo, igual al del servidor y al del video del validador para que el límite sea el mismo en toda
// la aplicación.
export const MAX_ARCHIVO_VISITA_MB = 80;

// Sube el archivo de un formato al almacenamiento del servidor, que arma el nombre, y devuelve el archivo en
// estado interno.
export async function subirFormatoVisita({ visitaId, formato, multiple, archivo, session }) {
  const base = { nombre: archivo.name, tamano: archivo.size, blob: null, fecha_cargue: ahora(), por: session?.nombre || null };
  const fd = new FormData();
  fd.append('visita_id', visitaId);
  fd.append('formato', formato);
  fd.append('multiple', multiple ? '1' : '0');
  fd.append('archivo', archivo);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(FETCH_TIMEOUT, 180000));
  try {
    const res = await fetch(VISITA_ARCHIVO_URL, {
      method: 'POST',
      headers: cabecerasSesion(),
      credentials: 'same-origin',
      body: fd,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) window.dispatchEvent(new Event('sesion-expirada'));
    if (!res.ok || !data || data.ok === false) {
      throw new AppError(`E${res.status}`, (res.status === 403 && data?.detalle) || 'No se pudo subir el archivo',
        (data && (data.detalle || data.error)) || `HTTP ${res.status}`, data && data.error);
    }
    return { ...base, blob: data.blob || null };
  } finally {
    clearTimeout(timer);
  }
}

// Quita un soporte de la visita; en disco no se borra, el servidor lo renombra con la marca de eliminado y lo
// anota.
export async function quitarSoporte({ visitaId, blob, session }) {
  if (!blob) return null;
  const fd = new FormData();
  fd.append('accion', 'quitar');
  fd.append('visita_id', visitaId);
  fd.append('blob', blob);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(FETCH_TIMEOUT, 180000));
  try {
    const res = await fetch(VISITA_ARCHIVO_URL, {
      method: 'POST',
      headers: cabecerasSesion(),
      credentials: 'same-origin',
      body: fd,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) window.dispatchEvent(new Event('sesion-expirada'));
    if (!res.ok || !data || data.ok === false) {
      throw new AppError(`E${res.status}`, (res.status === 403 && data?.detalle) || 'No se pudo quitar el archivo',
        (data && (data.detalle || data.error)) || `HTTP ${res.status}`, data && data.error);
    }
    return deApi(data.item);
  } finally {
    clearTimeout(timer);
  }
}

// Abre un soporte en otra pestaña; la ventana se abre en el clic porque si no el navegador la bloquea y se
// llena cuando llega el archivo.
export async function abrirSoporte(visitaId, blob, session) {
  const ventana = window.open('', '_blank');
  try {
    const u = new URL(VISITA_ARCHIVO_URL, window.location.origin);
    u.searchParams.set('id', visitaId);
    u.searchParams.set('blob', blob);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(FETCH_TIMEOUT, 120000));
    const res = await fetch(u.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 401) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    if (!res.ok) throw new Error(res.status === 404 ? 'No se encontró el archivo.' : `Error ${res.status} al abrir el archivo.`);
    const url = URL.createObjectURL(await res.blob());
    if (ventana) ventana.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) {
    if (ventana) ventana.close();
    throw e;
  }
}

// Normaliza el nombre de un formato en blanco para compararlo sin tildes ni mayúsculas.
export function normPlantilla(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\.[A-Z0-9]{1,5}$/, '').replace(/[^A-Z0-9]+/g, ' ').trim();
}

export async function listarPlantillas(session) {
  const r = await fetchApi(VISITA_FORMATOS_URL, { token: session?.token });
  const m = {};
  (r.items || []).forEach((x) => {
    const k = normPlantilla(x.nombre);
    (m[k] = m[k] || []).push(x.nombre);
  });
  return m;
}

// Devuelve la dirección del formato en blanco que viene con la aplicación, o vacío si ese documento no lo
// tiene.
export const urlFormato = (f) => (f?.formato ? `/plantillas/visitas/${f.formato}` : '');

export function plantillaDe(f, plantillas) {
  return f?.plantilla ? plantillas?.[normPlantilla(f.plantilla)] || [] : [];
}

export async function descargarPlantilla(nombre, session) {
  const u = new URL(VISITA_FORMATOS_URL, window.location.origin);
  u.searchParams.set('nombre', nombre);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(FETCH_TIMEOUT, 120000));
  try {
    const res = await fetch(u.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    if (res.status === 401) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    if (!res.ok) throw new Error(res.status === 404 ? 'El formato ya no está disponible.' : `Error ${res.status} al descargar el formato.`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    clearTimeout(timer);
  }
}
