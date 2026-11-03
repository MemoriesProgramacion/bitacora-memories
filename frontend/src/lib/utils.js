// Ayudas para los datos: lectura tolerante de campos, normalización de textos y documentos, búsqueda de
// unidades, conteos y formato de fechas.
export function val(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  return String(v);
}

export function normVal(v) {
  return String(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normKey(k) {
  return String(k)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const normIndexCache = new WeakMap();

// Busca un campo probando varios nombres y tolerando diferencias de formato.
export function pick(obj, candidates) {
  if (!obj) return undefined;
  for (const c of candidates) {
    if (obj[c] !== undefined) return obj[c];
  }
  let idx = normIndexCache.get(obj);
  if (!idx) {
    idx = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const nk = normKey(key);
        if (!(nk in idx)) idx[nk] = obj[key];
      }
    }
    normIndexCache.set(obj, idx);
  }
  for (const c of candidates) {
    const nk = normKey(c);
    if (nk in idx) return idx[nk];
  }
  return undefined;
}

// Indica si un valor es un error de fórmula de Google Sheets, que no es un dato.
export function esErrorHoja(v) {
  if (v === null || v === undefined) return false;
  return /^#(NAME|N\/A|REF|VALUE|DIV\/0|NULL|NUM|ERROR|GETTING_DATA)/i.test(String(v).trim());
}

export function fullName(up) {
  if (!up) return '';
  return [up.integrante_nombre1, up.integrante_nombre2,
          up.integrante_apellido1, up.integrante_apellido2]
    .map((x) => val(x)).filter(Boolean).join(' ');
}

export function normDoc(v) {
  return String(v || '').replace(/\D/g, '');
}

// Normaliza el texto de búsqueda para compararlo sin mayúsculas ni tildes.
function normBusqueda(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Busca unidades por ID, cédula, nombre del representante, nombre de la unidad o de la cuenta de campo, con un
// máximo de 50 resultados.
export function buscarUnidades(data, q) {
  const t = normBusqueda(q).trim();
  if (!t) return [];
  const tDoc = normDoc(t);
  return data.filter((up) => {
    const id = normBusqueda(up.ID_unico);
    const doc = normDoc(up.integrante_doc_inicial || up.unidad_doc);
    const nombre = normBusqueda(fullName(up));
    const unidad = normBusqueda(up.unidad_nombre);
    const gestor = normBusqueda(up.nombre_gestor);
    return id.includes(t) || (tDoc && doc.includes(tDoc)) ||
           nombre.includes(t) || unidad.includes(t) || gestor.includes(t);
  }).slice(0, 50);
}

// Devuelve los valores únicos de una lista, ordenados.
export function uniqueSorted(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = val(v);
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out.sort((a, b) => a.localeCompare(b, 'es'));
}

// Cuenta las filas por el valor de un campo.
export function countBy(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = val(r[key]) || 'Sin dato';
    m[k] = (m[k] || 0) + 1;
  }
  return Object.keys(m)
    .map((k) => ({ label: k, n: m[k] }))
    .sort((a, b) => b.n - a.n);
}

// Da formato de fecha en español.
export function formatDateEs(d) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio',
    'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}
