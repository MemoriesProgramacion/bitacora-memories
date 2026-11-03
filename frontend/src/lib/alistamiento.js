// Alistamiento, retiros y cierre: lo que la pantalla comprueba antes de enviar y cómo presenta lo que devuelve
// el servidor, que es quien aplica las reglas.
import { diaColombia } from './carrito';
import { asociadoVacio, erroresAsociado } from './asociados';

// Las 9 causales de retiro, las mismas del servidor.
export const CAUSALES = {
  retiro_voluntario: 'Retiro voluntario',
  fallecimiento: 'Fallecimiento del representante',
  documento_no_vigente: 'Documento de identidad no vigente',
  incumplimiento: 'Incumplimiento de los compromisos del programa',
  uso_diferente: 'Uso diferente de la capitalización',
  no_firma_compromiso: 'No firma del acta de compromiso',
  informacion_falsa: 'Información falsa o no veraz',
  asistencia_menor_80: 'Asistencia a la formación menor al 80 %',
  no_viabilizacion: 'No viabilización del plan de capitalización',
};

export const TIPOS_EVENTO_EQUIPO = {
  transferencia: 'Transferencia metodológica',
  kit_gestor: 'Entrega de kit al gestor',
  cierre: 'Evento de cierre por departamento',
};

export const TOPE_UP_GESTOR = 50;

// Devuelve el texto de carga de una cuenta de campo, como 12 de 50 unidades, y su tono.
export function textoCarga(g) {
  const tope = g.tope || TOPE_UP_GESTOR;
  return { texto: `${g.unidades} de ${tope} unidades`, porcentaje: Math.min(100, Math.round((g.unidades / tope) * 100)), tono: g.unidades > tope ? 'error' : g.unidades >= tope ? 'alerta' : 'ok' };
}

const esPdf = (a) => Boolean(a) && /\.pdf$/i.test(a.name);
const esImagen = (a) => Boolean(a) && /\.(jpe?g|png)$/i.test(a.name);

// Devuelve lo que falta para registrar un retiro y, con reemplazo, lo del reemplazo uno a uno.
export function faltasRetiro(f, { acta = null, actaComite = null, personalDisponible = 0 } = {}) {
  const faltas = [];
  if (!f.id_unico) faltas.push('Elige la unidad que sale.');
  if (!f.id_ticket) faltas.push(`Elige el ticket de la etapa ${f.tipo === 'reemplazo' ? 'Reemplazo' : 'Retiro'} que se resuelve con este registro.`);
  if (personalDisponible > 0) {
    const n = (f.personal_sale || []).length;
    if (f.tipo === 'reemplazo' ? n !== 1 : n < 1) {
      faltas.push(f.tipo === 'reemplazo' ? 'Elige a la persona de la unidad que sale (1 a 1).' : 'Elige el personal de la unidad que sale.');
    }
  }
  if (!CAUSALES[f.causal]) faltas.push('Elige una de las 9 causales.');
  if (!esPdf(acta)) faltas.push('Adjunta el acta de retiro o desistimiento en PDF.');
  if (f.tipo === 'reemplazo') {
    if (!f.comite_fecha) faltas.push('Escribe la fecha del concepto del Comité Técnico.');
    if (!f.comite_concepto?.trim()) faltas.push('Escribe el concepto del Comité Técnico.');
    if (!esPdf(actaComite)) faltas.push('Adjunta el acta del Comité Técnico en PDF.');
    if (Object.keys(erroresAsociado(f.persona || asociadoVacio())).length) {
      faltas.push('Completa los datos de la persona que entra (nombre completo, cédula, teléfono y sexo).');
    }
  }
  return faltas;
}

// Devuelve lo que falta para registrar un evento del equipo según su tipo.
export function faltasEvento(tipo, f, { lista = null, acta = null, presentacion = null, fotos = [], asistentes = [] } = {}) {
  const faltas = [];
  if (!f.fecha) faltas.push('Escribe la fecha.');
  if (tipo === 'kit_gestor') {
    if (!f.id_gestor) faltas.push('Elige el gestor.');
    if (!f.contenido?.trim()) faltas.push('Describe el contenido del kit.');
    if (!esPdf(acta)) faltas.push('Adjunta el acta de entrega en PDF.');
    return faltas;
  }
  if (!f.lugar?.trim()) faltas.push('Escribe el lugar.');
  if (!esPdf(lista)) faltas.push('Adjunta la lista de asistencia en PDF.');
  if (!fotos.length) faltas.push('Adjunta al menos una foto (JPG o PNG).');
  else if (fotos.some((x) => !esImagen(x))) faltas.push('Las fotos deben ser JPG o PNG.');
  if (fotos.length > 20) faltas.push('Máximo 20 fotos.');
  if (tipo === 'cierre') {
    if (!f.departamento?.trim()) faltas.push('Elige el departamento.');
    if (!esPdf(presentacion)) faltas.push('Adjunta la presentación de resultados en PDF.');
    if (!asistentes.length) faltas.push('Marca las unidades que asistieron.');
  } else if (!asistentes.length) faltas.push('Marca a los integrantes del equipo que asistieron.');
  return faltas;
}

// Convierte las filas de la lista de unidades al formato que espera el selector de iniciativa.
export function filasSelector(unidades) {
  return (unidades || []).map((x) => ({
    ID_unico: x.id_unico, unidad_nombre: x.up_nombre, mpio: x.up_municipio, dpto: x.up_departamento, nodo: x.nodo || '',
    habilitadas: x.up_habilitada === false ? '0' : '1',
    integrante_nombre1: x.rep_nombre1, integrante_nombre2: x.rep_nombre2, integrante_apellido1: x.rep_apellido1, integrante_apellido2: x.rep_apellido2,
  }));
}

// Devuelve los departamentos distintos de las unidades, ordenados.
export const departamentosDe = (unidades) => [...new Set((unidades || []).map((x) => (x.up_departamento || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

// Devuelve las columnas del Excel de retiros y reemplazos.
export function columnasRetiros() {
  return [
    { titulo: 'Fecha', valor: (r) => diaColombia(r.creado_en), ancho: 12 },
    { titulo: 'Tipo', valor: (r) => (r.tipo === 'reemplazo' ? 'Reemplazo' : 'Retiro'), ancho: 12 },
    { titulo: 'ID único', valor: (r) => r.id_unico, ancho: 14 },
    { titulo: 'Unidad que sale', valor: (r) => r.unidad || '', ancho: 30 },
    { titulo: 'Región', valor: (r) => r.region || '', ancho: 14 },
    { titulo: 'Nodo', valor: (r) => r.nodo || '', ancho: 10 },
    { titulo: 'Causal (5.6.4)', valor: (r) => r.nombre_causal, ancho: 36 },
    { titulo: 'Observaciones', valor: (r) => r.observaciones || '', ancho: 40 },
    { titulo: 'Concepto del Comité', valor: (r) => r.comite?.concepto || '', ancho: 40 },
    { titulo: 'Fecha del Comité', valor: (r) => r.comite?.fecha || '', ancho: 12 },
    { titulo: 'Entra', valor: (r) => (r.persona_entra ? `${r.persona_entra.nombre} · ${r.persona_entra.documento}` : r.id_unico_entra ? `${r.id_unico_entra} · ${r.unidad_entra || ''}` : ''), ancho: 36 },
    { titulo: 'Personal que sale', valor: (r) => (r.personal_sale || []).map((p) => (p.documento ? `${p.nombre} · ${p.documento}` : p.nombre)).join('; '), ancho: 40 },
    { titulo: 'Ticket', valor: (r) => r.ticket || '', ancho: 12 },
    { titulo: 'Registró', valor: (r) => r.registrado_por || '', ancho: 20 },
  ];
}

// Devuelve el motivo de desactivación de una unidad en un texto corto, o vacío si está activa.
export function textoDesactivacion(d) {
  if (!d) return '';
  const tipo = d.tipo === 'reemplazo' ? 'Reemplazo' : d.tipo === 'retiro' ? 'Retiro' : d.motivo === 'retirada' ? 'Retirada' : 'Sin habilitar';
  return [tipo, d.causal, d.ticket, d.fecha ? diaColombia(d.fecha) : '', d.registrado_por].filter(Boolean).join(' · ');
}

const sinTildes = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Filtra las unidades por estado y por texto en código, unidad, representante, municipio o nodo.
export function filtrarUnidadesEstado(items = [], { estado = '', q = '' } = {}) {
  const t = sinTildes(q).trim();
  return items.filter((u) => (!estado || u.estado === estado)
    && (!t || [u.id_unico, u.nombre, u.representante, u.municipio, u.departamento, u.nodo].some((c) => sinTildes(c).includes(t))));
}

// Devuelve las columnas del Excel de unidades activas y desactivadas.
export function columnasUnidadesEstado() {
  return [
    { titulo: 'ID único', valor: (u) => u.id_unico, ancho: 16 },
    { titulo: 'Unidad', valor: (u) => u.nombre || '', ancho: 32 },
    { titulo: 'Estado', valor: (u) => (u.estado === 'activa' ? 'Activa' : 'Desactivada'), ancho: 14 },
    { titulo: 'Desactivación', valor: (u) => textoDesactivacion(u.desactivacion), ancho: 52 },
    { titulo: 'Región', valor: (u) => u.region || '', ancho: 14 },
    { titulo: 'Nodo', valor: (u) => u.nodo || '', ancho: 10 },
    { titulo: 'Departamento', valor: (u) => u.departamento || '', ancho: 18 },
    { titulo: 'Municipio', valor: (u) => u.municipio || '', ancho: 18 },
    { titulo: 'Modalidad', valor: (u) => u.modalidad || '', ancho: 22 },
    { titulo: 'Representante', valor: (u) => u.representante || '', ancho: 30 },
  ];
}
