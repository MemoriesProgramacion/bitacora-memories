// Entregas completas: lo que la pantalla comprueba antes de enviar, y que el servidor vuelve a exigir, sobre la
// instalación y puesta en marcha del kit, el acta de recibido de la copia de las facturas y las garantías y el
// seguimiento del acta de elementos defectuosos.
import { diaColombia } from './carrito';

// Estados del acta de elementos defectuosos: reportada, devuelta al proveedor y reemplazada.
export const ESTADOS_DEFECTO = {
  reportada: { texto: 'Reportada', tono: 'alerta' },
  devuelta: { texto: 'Devuelta al proveedor', tono: 'neutro' },
  reemplazada: { texto: 'Reemplazada', tono: 'ok' },
};

export const INSTALACION_VACIA = {
  aplica: '', fecha_instalacion: '', fecha_puesta_marcha: '', capacitacion: '', capacitacion_fecha: '', capacitacion_por: '', capacitacion_recibe: '', observaciones: '',
};

// Convierte la instalación registrada en el formulario, para poder corregirla.
export function instalacionAFormulario(i) {
  if (!i) return { ...INSTALACION_VACIA };
  return {
    ...INSTALACION_VACIA, aplica: i.aplica ? 'si' : 'no', fecha_instalacion: i.fecha_instalacion || '', fecha_puesta_marcha: i.fecha_puesta_marcha || '',
    capacitacion: i.aplica ? (i.capacitacion ? 'si' : 'no') : '', capacitacion_fecha: i.capacitacion_fecha || '', capacitacion_por: i.capacitacion_por || '',
    capacitacion_recibe: i.capacitacion_recibe || '', observaciones: i.observaciones || '',
  };
}

// Devuelve lo que falta para registrar la instalación; la instalación no puede ser antes de la entrega.
export function faltasInstalacion(f, { soporte = null, tieneSoporte = false, entregado = '' } = {}) {
  const faltas = [];
  if (!['si', 'no'].includes(f.aplica)) faltas.push('Indica si aplica la instalación.');
  if (f.aplica !== 'si') return faltas;
  if (!f.fecha_instalacion) faltas.push('Escribe la fecha de instalación.');
  else if (entregado && f.fecha_instalacion < entregado) faltas.push(`La instalación no puede ser anterior a la entrega (${entregado}).`);
  if (!f.fecha_puesta_marcha) faltas.push('Escribe la fecha de puesta en marcha.');
  else if (f.fecha_instalacion && f.fecha_puesta_marcha < f.fecha_instalacion) faltas.push('La puesta en marcha no puede ser anterior a la instalación.');
  if (!['si', 'no'].includes(f.capacitacion)) faltas.push('Indica si hubo capacitación de uso.');
  if (f.capacitacion === 'si') {
    if (!f.capacitacion_fecha) faltas.push('Escribe la fecha de la capacitación.');
    else if (entregado && f.capacitacion_fecha < entregado) faltas.push(`La capacitación no puede ser anterior a la entrega (${entregado}).`);
    if (!f.capacitacion_por?.trim()) faltas.push('Escribe quién dio la capacitación.');
    if (!f.capacitacion_recibe?.trim()) faltas.push('Escribe quién la recibió.');
  }
  if (!soporte && !tieneSoporte) faltas.push('Adjunta el soporte de la instalación (PDF, JPG o PNG).');
  return faltas;
}

// Devuelve el resumen de la instalación registrada en una entrega.
export function textoInstalacion(i) {
  if (!i) return 'Sin registrar';
  if (!i.aplica) return 'No aplica';
  const cap = i.capacitacion ? ` · capacitación el ${i.capacitacion_fecha} (${i.capacitacion_por} → ${i.capacitacion_recibe})` : ' · sin capacitación';
  return `Instalado el ${i.fecha_instalacion} · en marcha el ${i.fecha_puesta_marcha}${cap}`;
}

// Devuelve el documento como lo guarda el servidor: sin puntos ni espacios y en mayúsculas.
export const documentoLimpio = (v) => String(v || '').replace(/[\s.]/g, '').toUpperCase();

// Devuelve lo que falta en el acta de recibido de la copia de las facturas y de las garantías.
export function faltasActaRecibido(f, archivo) {
  const faltas = [];
  if (!f.fecha) faltas.push('Escribe la fecha del acta.');
  if (!f.recibe_nombre?.trim()) faltas.push('Escribe el nombre de quien recibe.');
  if (!/^[A-Z0-9]{5,15}$/.test(documentoLimpio(f.recibe_documento))) faltas.push('Escribe el documento de quien recibe (5 a 15 letras o números).');
  if (!f.garantias?.trim()) faltas.push('Escribe los soportes de garantía entregados (o «Sin garantía»).');
  if (!(f.facturas || []).length) faltas.push('Marca al menos una factura entregada en copia.');
  if (!archivo) faltas.push('Adjunta el acta firmada en PDF.');
  else if (!/\.pdf$/i.test(archivo.name)) faltas.push('El acta debe ser un PDF.');
  return faltas;
}

// Devuelve el seguimiento del acta de elementos defectuosos en una línea.
export function textoSeguimiento(n) {
  const partes = [];
  partes.push(n.reporte ? `Reporte recibido por ${n.reporte.por} el ${diaColombia(n.reporte.en)}` : 'Reporte sin dar por recibido');
  if (n.devolucion) partes.push(`Devuelto a ${n.devolucion.proveedor} el ${n.devolucion.fecha}${n.devolucion.guia ? ` (guía ${n.devolucion.guia})` : ''}`);
  if (n.reemplazo) partes.push(`Reemplazo entregado el ${n.reemplazo.fecha}`);
  return partes.join(' · ');
}

// Devuelve las columnas del Excel de actas de elementos defectuosos.
export function columnasDefectuosos() {
  return [
    { titulo: 'Acta', valor: (n) => String(n.id).padStart(5, '0'), ancho: 8 },
    { titulo: 'Fecha', valor: (n) => diaColombia(n.creado), ancho: 12 },
    { titulo: 'ID único', valor: (n) => n.id_unico || '', ancho: 14 },
    { titulo: 'Unidad productiva', valor: (n) => n.unidad || '', ancho: 30 },
    { titulo: 'Región', valor: (n) => n.region || '', ancho: 14 },
    { titulo: 'Nodo', valor: (n) => n.nodo || '', ancho: 10 },
    { titulo: 'Kit', valor: (n) => n.kit, ancho: 20 },
    { titulo: 'Tipo', valor: (n) => n.nombre_tipo, ancho: 12 },
    { titulo: 'Elementos', valor: (n) => (n.articulos || []).map((a) => `${a.cantidad} × ${a.nombre}`).join(', '), ancho: 40 },
    { titulo: 'Descripción', valor: (n) => n.texto, ancho: 40 },
    { titulo: 'Estado', valor: (n) => n.nombre_estado, ancho: 22 },
    { titulo: 'Seguimiento', valor: (n) => textoSeguimiento(n), ancho: 60 },
  ];
}
