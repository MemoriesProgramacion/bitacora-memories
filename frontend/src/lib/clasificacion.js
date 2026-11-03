// Clasificación de la capitalización según el anexo: rubros capitalizables, causales de no financiable,
// actividades no financiables, tenencias y clases UNSPSC. Las listas las define el servidor y se piden una vez
// a GET /api/clasificacion; aquí solo se presentan.
import { apiGeneral, qs } from '../inventario/lib/api';

let listasEnCurso = null;

// Pide las listas del anexo una sola vez; forzar vuelve a pedirlas, por ejemplo tras cargar clases UNSPSC.
export function cargarListas(forzar = false) {
  if (!listasEnCurso || forzar) {
    listasEnCurso = apiGeneral.get('/clasificacion').then((r) => r.item).catch((err) => {
      listasEnCurso = null;
      throw err;
    });
  }
  return listasEnCurso;
}

// Busca clases UNSPSC por código o nombre, para el campo con sugerencias.
export async function buscarClases(texto) {
  const q = String(texto ?? '').trim();
  if (q.length < 2) return [];
  return (await apiGeneral.get(`/unspsc${qs({ q })}`)).items || [];
}

// Devuelve el nombre de un código dentro de una lista, o el código si no está.
export function nombreDe(lista, codigo) {
  if (!codigo) return '';
  return (lista || []).find((x) => x.codigo === codigo)?.nombre || codigo;
}

// Indica si el texto tiene la forma de una clase UNSPSC de 6 dígitos; vacío cuenta como válido.
export const formatoUnspsc = (v) => !String(v ?? '').trim() || /^\d{6}$/.test(String(v).trim());

// Indica si el texto tiene la forma de una clase CIIU de 4 dígitos; vacío cuenta como válido.
export const formatoCiiu = (v) => !String(v ?? '').trim() || /^\d{4}$/.test(String(v).trim());

// Agrupa los rubros como en el anexo, para un select con optgroup.
export function rubrosPorGrupo(rubros) {
  const grupos = new Map();
  for (const r of rubros || []) {
    if (!grupos.has(r.grupo)) grupos.set(r.grupo, []);
    grupos.get(r.grupo).push(r);
  }
  return [...grupos.entries()].map(([grupo, items]) => ({ grupo, items }));
}

// Indica si la tenencia elegida necesita años, como el comodato y el arriendo.
export const tenenciaPideAnios = (tenencias, tipo) =>
  (tenencias || []).find((t) => t.codigo === tipo)?.anios_minimos != null;

// Devuelve lo que la pantalla le dice a quien registra la tenencia: si con esos datos se habilitan las
// adecuaciones locativas; es solo una guía.
export function guiaTenencia(tenencias, tipo, anios, conSoporte) {
  const t = (tenencias || []).find((x) => x.codigo === tipo);
  if (!t) return { habilita: false, texto: 'Elige el tipo de tenencia de la sede.' };
  if (!conSoporte) return { habilita: false, texto: 'Falta adjuntar la certificación de tenencia.' };
  if (t.codigo === 'propia') return { habilita: true, texto: 'Con sede propia se pueden incluir adecuaciones locativas.' };
  if (t.anios_minimos == null) {
    return { habilita: false, texto: 'Con esta tenencia no se pueden incluir adecuaciones locativas.' };
  }
  const n = Number(String(anios ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || String(anios ?? '') === '') return { habilita: false, texto: `Indica por cuántos años es el ${t.nombre.toLowerCase()}.` };
  return n >= t.anios_minimos
    ? { habilita: true, texto: `${t.nombre} de ${n} años: se pueden incluir adecuaciones locativas.` }
    : { habilita: false, texto: `Las adecuaciones locativas piden ${t.nombre.toLowerCase()} de ${t.anios_minimos} años o más.` };
}
