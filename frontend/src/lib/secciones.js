// Formularios por secciones descritos por el servidor. El diagnóstico y la evaluación de salida mandan su
// esquema de secciones con campos; aquí se convierten los valores para el formulario y se avisa lo que falta
// con la misma regla del servidor, que valida todo otra vez.
export const vacio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

// Convierte los valores guardados en formulario: vacíos como texto vacío y listas de textos con una línea en
// blanco.
export function aFormulario(seccion, datos) {
  const d = datos || {};
  return Object.fromEntries(seccion.campos.map((c) => {
    const v = d[c.clave];
    if (c.tipo === 'lista_textos') return [c.clave, Array.isArray(v) && v.length ? [...v] : ['']];
    return [c.clave, v === null || v === undefined ? '' : String(v)];
  }));
}

// Convierte el formulario en lo que se manda: vacíos como null y listas sin líneas en blanco; las cifras van
// como se escribieron.
export function aEnvio(seccion, f) {
  return Object.fromEntries(seccion.campos.map((c) => {
    const v = f[c.clave];
    if (c.tipo === 'lista_textos') return [c.clave, (v || []).map((x) => String(x).trim()).filter(Boolean)];
    const t = typeof v === 'string' ? v.trim() : v;
    return [c.clave, t === '' ? null : t];
  }));
}

// Indica si el campo es obligatorio con estos datos, siempre o según el valor de otro campo.
export const esObligatorio = (c, d) => {
  if (c.obligatorio === true) return true;
  if (!c.obligatorio || typeof c.obligatorio !== 'object') return false;
  const actual = d?.[c.obligatorio.campo];
  return Array.isArray(c.obligatorio.valor) ? c.obligatorio.valor.includes(actual) : actual === c.obligatorio.valor;
};

// Devuelve los campos obligatorios vacíos de la sección.
export const faltantesCampos = (seccion, d) => seccion.campos
  .filter((c) => esObligatorio(c, d || {}) && vacio(d?.[c.clave])).map((c) => c.etiqueta);

// Indica si el formulario cambió frente a lo guardado.
export const hayCambios = (seccion, f, base) => JSON.stringify(aEnvio(seccion, f)) !== JSON.stringify(aEnvio(seccion, aFormulario(seccion, base)));

// Da formato de pesos, como $ 1.234.567, o un guion.
export function pesos(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '—';
  return `$ ${Math.round(Number(n)).toLocaleString('es-CO')}`;
}

// Devuelve el texto para mostrar el valor guardado de un campo en la consulta.
export function textoValor(c, v) {
  if (vacio(v)) return '—';
  if (c.tipo === 'sino') return v === 'si' ? 'Sí' : 'No';
  if (c.tipo === 'lista') return c.opciones.find((o) => o.codigo === v)?.nombre || v;
  if (c.tipo === 'pesos') return pesos(v);
  if (c.tipo === 'entero') return Number(v).toLocaleString('es-CO');
  if (c.tipo === 'escala') return `${v} de 5`;
  if (c.tipo === 'lista_textos') return v.join(' · ');
  return String(v);
}
