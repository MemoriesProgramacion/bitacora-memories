// Asociados de la unidad productiva. Se registran uno por uno con nombre completo, cédula, teléfono y perfil.
// La modalidad fija el mínimo (10, 15 o 20 en M2, M3 y M4), que se exige al cerrar la primera visita; después,
// los cambios entran solo con el acta de novedades. Las listas y las reglas las define el servidor y aquí se
// presentan y se comprueban antes de enviar.
import { apiGeneral, qs } from '../inventario/lib/api';
import { formatDateEs } from './utils';

let listasEnCurso = null;

// Pide las listas del perfil (sexo, pertenencia étnica, nivel educativo, zona y tipo) y los mínimos por
// modalidad.
export function cargarListasAsociados() {
  if (!listasEnCurso) {
    listasEnCurso = apiGeneral.get('/asociados/listas').then((r) => r.item).catch((err) => {
      listasEnCurso = null;
      throw err;
    });
  }
  return listasEnCurso;
}

// Pide los asociados, el resumen, las actas y los permisos de una unidad.
export async function pedirAsociados(idUnico) {
  return (await apiGeneral.get(`/asociados${qs({ id_unico: idUnico })}`)).item;
}

export const asociadoVacio = () => ({
  nombre: '', documento: '', telefono: '', sexo: '', tipo: 'directo', es_representante: false,
  fecha_nacimiento: '', pertenencia_etnica: '', discapacidad: '', victima: '', nivel_educativo: '', zona: '',
});

// Convierte un asociado, tal como lo devuelve el servidor, en los valores del formulario.
export function asociadoAFormulario(a) {
  const sino = (v) => (v === true ? 'si' : v === false ? 'no' : '');
  return {
    ...asociadoVacio(),
    id: a.id,
    nombre: a.nombre || '', documento: a.documento || '', telefono: a.telefono || '', sexo: a.sexo || '',
    tipo: a.tipo || 'directo', es_representante: Boolean(a.es_representante),
    fecha_nacimiento: a.fecha_nacimiento || '', pertenencia_etnica: a.pertenencia_etnica || '',
    discapacidad: sino(a.discapacidad), victima: sino(a.victima),
    nivel_educativo: a.nivel_educativo || '', zona: a.zona || '',
  };
}

// Convierte el formulario en lo que se manda al servidor; los vacíos van como null para que el perfil quede sin
// dato.
export function formularioAAsociado(f) {
  const nulo = (v) => (v === '' || v === undefined ? null : v);
  return {
    ...(f.id ? { id: f.id } : {}),
    nombre: String(f.nombre || '').trim().replace(/\s+/g, ' '),
    documento: String(f.documento || '').replace(/\D/g, ''),
    telefono: String(f.telefono || '').replace(/\D/g, ''),
    sexo: nulo(f.sexo), tipo: f.tipo || 'directo', es_representante: Boolean(f.es_representante),
    fecha_nacimiento: nulo(f.fecha_nacimiento), pertenencia_etnica: nulo(f.pertenencia_etnica),
    discapacidad: nulo(f.discapacidad), victima: nulo(f.victima),
    nivel_educativo: nulo(f.nivel_educativo), zona: nulo(f.zona),
  };
}

// Devuelve los errores por campo de un asociado con las mismas reglas del servidor, o un objeto vacío si está
// bien.
export function erroresAsociado(f, hoy = new Date()) {
  const e = {};
  const nombre = String(f.nombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.split(' ').filter(Boolean).length < 2) e.nombre = 'Escribe el nombre completo (nombres y apellidos).';
  else if (nombre.length > 200) e.nombre = 'Máximo 200 caracteres.';
  if (!/^\d{5,15}$/.test(String(f.documento || '').replace(/\D/g, ''))) e.documento = 'La cédula lleva entre 5 y 15 dígitos.';
  if (!/^\d{7,15}$/.test(String(f.telefono || '').replace(/\D/g, ''))) e.telefono = 'El teléfono lleva entre 7 y 15 dígitos.';
  if (!f.sexo) e.sexo = 'Indica el sexo.';
  if (f.fecha_nacimiento) {
    const t = Date.parse(`${f.fecha_nacimiento}T00:00:00Z`);
    const edad = (hoy.getTime() - t) / (365.25 * 24 * 3600 * 1000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_nacimiento) || Number.isNaN(t) || edad < 0 || edad > 120) {
      e.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
    }
  }
  return e;
}

// Calcula cuántos asociados quedan activos después del acta.
export const activosTrasActa = (activos, ingresos, retiros) => activos - retiros.length + ingresos.length;

// Devuelve el aviso del mínimo de la modalidad con su tono y texto.
export function avisoMinimo(resumen, total = resumen?.total ?? 0) {
  if (!resumen) return null;
  const { minimo, modalidad } = resumen;
  if (minimo === null || minimo === undefined) {
    return { tono: 'neutro', texto: modalidad ? `La modalidad ${modalidad} no exige un mínimo de asociados.` : 'La unidad no tiene modalidad registrada.' };
  }
  if (total >= minimo) return { tono: 'ok', texto: `${total} de ${minimo}: cumple el mínimo de la modalidad ${modalidad}.` };
  return { tono: 'alerta', texto: `${total} de ${minimo}: faltan ${minimo - total} para el mínimo de la modalidad ${modalidad}.` };
}

const ETIQUETAS_EDAD = { menor_18: 'Menores de 18', '18_28': '18 a 28 años', '29_59': '29 a 59 años', '60_mas': '60 años o más' };

// Devuelve el perfil sociodemográfico en bloques para pintar, sin las filas en cero.
export function bloquesPerfil(perfil, listas) {
  if (!perfil) return [];
  const nombre = (lista, codigo) => (codigo === 'sin_dato' ? 'Sin dato' : (lista || []).find((x) => x.codigo === codigo)?.nombre || codigo);
  const bloque = (titulo, conteo, lista, etiquetas) => ({
    titulo,
    filas: Object.entries(conteo || {}).filter(([, n]) => n > 0)
      .map(([codigo, n]) => ({ nombre: etiquetas ? (codigo === 'sin_dato' ? 'Sin dato' : etiquetas[codigo] || codigo) : nombre(lista, codigo), n })),
  });
  return [
    bloque('Sexo', perfil.sexo, listas?.sexos),
    bloque('Edad', perfil.edad, null, ETIQUETAS_EDAD),
    bloque('Pertenencia étnica', perfil.pertenencia_etnica, listas?.etnias),
    bloque('Nivel educativo', perfil.nivel_educativo, listas?.niveles_educativos),
    bloque('Zona', perfil.zona, listas?.zonas),
    { titulo: 'Condiciones', filas: [
      { nombre: 'Con discapacidad', n: perfil.con_discapacidad || 0 },
      { nombre: 'Víctimas del conflicto', n: perfil.victimas || 0 },
    ] },
  ].filter((b) => b.filas.length);
}

// Convierte AAAA-MM-DD, o una marca de tiempo, en un texto como 3 de mayo de 2026 sin correrse por la zona
// horaria.
export function fechaLegible(valor) {
  if (!valor) return '';
  const s = String(valor);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : new Date(s);
  return Number.isNaN(d.getTime()) ? s : formatDateEs(d);
}

// Devuelve la fecha de hoy en formato AAAA-MM-DD, hora local, que es el tope del campo de fecha del acta.
export function hoyISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Devuelve los problemas del acta antes de enviarla; una lista vacía significa que está lista.
export function problemasActa({ fecha, motivo, ingresos, retiros, archivo }, resumen, hoy = hoyISO()) {
  const p = [];
  if (!fecha) p.push('Indica la fecha del acta.');
  else if (fecha > hoy) p.push('La fecha del acta no puede ser futura.');
  if (!String(motivo || '').trim()) p.push('Escribe el motivo del acta.');
  if (!ingresos.length && !retiros.length) p.push('Registra al menos un ingreso o un retiro.');
  ingresos.forEach((x, i) => {
    if (Object.keys(erroresAsociado(x)).length) p.push(`Completa los datos obligatorios del ingreso ${i + 1}.`);
  });
  const docs = ingresos.map((x) => String(x.documento || '').replace(/\D/g, ''));
  if (new Set(docs).size !== docs.length) p.push('Hay cédulas repetidas entre los ingresos.');
  const despues = activosTrasActa(resumen?.total ?? 0, ingresos, retiros);
  if (resumen?.minimo != null && despues < resumen.minimo) {
    p.push(`El acta deja ${despues} asociados y la modalidad ${resumen.modalidad} exige ${resumen.minimo}: registra el reemplazo.`);
  }
  if (!archivo) p.push('Adjunta el acta firmada en PDF.');
  else if (!/\.pdf$/i.test(archivo.name || '')) p.push('El acta debe ser un archivo PDF.');
  return p;
}

// Arma el cuerpo multipart del acta: datos con el JSON y archivo con el PDF.
export function armarActa(idUnico, { fecha, motivo, ingresos, retiros, archivo }) {
  const cuerpo = new FormData();
  cuerpo.append('datos', JSON.stringify({
    id_unico: idUnico, fecha, motivo: String(motivo || '').trim(),
    ingresos: ingresos.map(formularioAAsociado),
    retiros: retiros.map((r) => ({ id: r.id, motivo: String(r.motivo || '').trim() || null })),
  }));
  if (archivo) cuerpo.append('archivo', archivo);
  return cuerpo;
}
