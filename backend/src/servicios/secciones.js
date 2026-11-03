// Secciones de formulario descritas por un esquema, compartidas por el diagnóstico y la evaluación de salida.
// Cada sección tiene clave, título y campos, y cada campo tiene clave, etiqueta, tipo y reglas de
// obligatoriedad, largo y opciones.
import { solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';

export const SI_NO = [{ codigo: 'si', nombre: 'Sí' }, { codigo: 'no', nombre: 'No' }];
// Devuelve la fecha de hoy en Colombia en formato AAAA-MM-DD; desde las 7 p. m. la fecha UTC ya es la de
// mañana.
export const hoyColombia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
// Devuelve el día de Colombia de una fecha con hora, o null si no es una fecha.
export function diaColombia(x) {
  const d = x instanceof Date ? x : new Date(String(x || ''));
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}
const hoy = hoyColombia;
export const vacio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Indica si el texto es una fecha AAAA-MM-DD que existe en el calendario, porque Date.parse acepta el 30 de
// febrero.
export function fechaReal(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f))) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

// Interpreta un número escrito a la colombiana o enviado por un campo numérico, como 1500, 1.500.000 o 1500,75.
export function numeroDe(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').trim().replace(/^\$/, '').replace(/\s/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d+[.,]\d+$/.test(t)) return Number(t.replace(',', '.'));
  return null;
}

// Devuelve el valor limpio de un campo, null si viene vacío; lanza un error 400 con la sección y el campo.
export function valorCampo(c, v, seccion) {
  const nombre = `${seccion.titulo} › ${c.etiqueta}`;
  if (vacio(v)) return null;
  switch (c.tipo) {
    case 'texto': case 'texto_largo': {
      const t = txt(v);
      if (t && t.length > c.max) throw solicitudInvalida(`${nombre}: máximo ${c.max} caracteres.`);
      if (c.clave === 'nit' && t && !/^\d{6,12}(-?\d)?$/.test(t.replace(/[.\s]/g, ''))) {
        throw solicitudInvalida(`${nombre}: escribe solo números (6 a 12 dígitos, con o sin dígito de verificación).`);
      }
      return t;
    }
    case 'sino': {
      if (v === true || v === 'si' || v === 'sí') return 'si';
      if (v === false || v === 'no') return 'no';
      throw solicitudInvalida(`${nombre}: responde Sí o No.`);
    }
    case 'lista': {
      const op = c.opciones.find((o) => o.codigo === v || o.nombre === v);
      if (!op) throw solicitudInvalida(`${nombre}: "${v}" no es una opción válida.`);
      return op.codigo;
    }
    case 'entero': {
      const n = numeroDe(v);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw solicitudInvalida(`${nombre}: escribe un número entero entre 0 y 10.000.000.`);
      return n;
    }
    case 'escala': {
      const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\s*[1-5]\s*$/.test(v));
      const n = ok ? Number(v) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 5) throw solicitudInvalida(`${nombre}: califica de 1 a 5.`);
      return n;
    }
    case 'pesos': {
      const n = numeroDe(v);
      if (n === null || n < 0 || n > 100_000_000_000) throw solicitudInvalida(`${nombre}: escribe un valor en pesos (0 o más), por ejemplo 1.500.000.`);
      return Math.round(n);
    }
    case 'fecha': {
      const f = String(v).slice(0, 10);
      if (!fechaReal(f)) throw solicitudInvalida(`${nombre}: la fecha no es válida.`);
      if (f > hoy()) throw solicitudInvalida(`${nombre}: la fecha no puede ser futura.`);
      return f;
    }
    case 'lista_textos': {
      if (!Array.isArray(v)) throw solicitudInvalida(`${nombre}: debe ser una lista.`);
      const items = v.map((x) => txt(x)).filter(Boolean);
      if (items.length > c.max_items) throw solicitudInvalida(`${nombre}: máximo ${c.max_items} elementos.`);
      if (items.some((x) => x.length > c.max)) throw solicitudInvalida(`${nombre}: cada elemento admite máximo ${c.max} caracteres.`);
      return items.length ? items : null;
    }
    default: return null;
  }
}

// Devuelve los datos limpios de la sección: solo los campos que conoce, con su tipo.
export function limpiarCon(seccion, datos = {}) {
  const d = datos && typeof datos === 'object' ? datos : {};
  return Object.fromEntries(seccion.campos.map((c) => [c.clave, valorCampo(c, d[c.clave], seccion)]));
}

// Indica si el campo es obligatorio con los datos actuales.
export const esObligatorio = (c, datos) => {
  if (c.obligatorio === true) return true;
  if (!c.obligatorio || typeof c.obligatorio !== 'object') return false;
  const actual = datos?.[c.obligatorio.campo];
  return Array.isArray(c.obligatorio.valor) ? c.obligatorio.valor.includes(actual) : actual === c.obligatorio.valor;
};

// Devuelve los campos obligatorios vacíos.
export const faltantesCon = (seccion, datos) => seccion.campos
  .filter((c) => esObligatorio(c, datos || {}) && vacio(datos?.[c.clave]))
  .map((c) => `${seccion.titulo} › ${c.etiqueta}`);
