// Gestión comercial por unidad: visitas comerciales, oferta complementaria, conexión a mercados, clientes
// captados o fidelizados y canales de distribución, cada una con fecha, entidad o cliente, descripción,
// resultado y soporte opcional.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { contenidoValido } from './tipoArchivo.js';
import { registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { exigirTamano } from './alistamiento.js';

export const TIPOS_GESTION = {
  visita_comercial: 'Visita comercial', oferta_complementaria: 'Oferta complementaria', conexion_mercados: 'Conexión a mercados',
  cliente: 'Cliente captado o fidelizado', distribucion: 'Canal de distribución',
};
const LECTORES = [ROLES.COMPRAS, ROLES.COORDINADOR, ROLES.TECNICO, ROLES.GESTOR];
const MAX_ID = 2147483647;
const nombreOriginal = (a) => Buffer.from(a?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 300);

function exigirLector(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta la gestión comercial.');
}
function exigirEditor(usuario) {
  if (![ROLES.COMPRAS, ROLES.COORDINADOR].includes(usuario?.rol)) throw prohibido('La gestión comercial la registra el Profesional alianzas y conexión de mercados.');
}

// Registra una gestión comercial con su soporte opcional.
export async function registrarGestion(usuario, campos = {}, archivos = {}) {
  exigirEditor(usuario);
  const up = await buscarUP({ idUnico: txt(campos.id_unico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  const tipo = txt(campos.tipo);
  if (!TIPOS_GESTION[tipo]) throw solicitudInvalida('Elige el tipo de gestión comercial.');
  const fecha = String(campos.fecha || '').slice(0, 10);
  if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < '2000-01-01') throw solicitudInvalida('La fecha no es válida (no puede ser futura).');
  const descripcion = txt(campos.descripcion)?.slice(0, 5000);
  if (!descripcion) throw solicitudInvalida('Describe la gestión.');
  const entidad = txt(campos.entidad)?.slice(0, 300) || null;
  if (['cliente', 'conexion_mercados', 'oferta_complementaria'].includes(tipo) && !entidad) throw solicitudInvalida('Escribe la entidad, el aliado o el cliente de la gestión.');
  const resultado = txt(campos.resultado)?.slice(0, 5000) || null;
  let soporte = null;
  const a = (Array.isArray(archivos?.soporte) ? archivos.soporte[0] : null) || null;
  if (a) {
    exigirTamano(a, /\.pdf$/i.test(a.originalname || ''), 'El soporte');
    const nombre = nombreOriginal(a);
    const ext = path.extname(nombre).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) || !(await contenidoValido(a.path, nombre, ['.pdf', '.jpg', '.jpeg', '.png']))) {
      throw solicitudInvalida('El soporte debe ser un PDF, JPG o PNG válido.');
    }
    soporte = { nombre, tipo: ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg', contenido: await fs.readFile(a.path) };
  }
  const { rows: [g] } = await query(
    `INSERT INTO gestiones_comerciales (id_up, id_unico, tipo, fecha, entidad, descripcion, resultado, soporte, soporte_nombre, soporte_tipo, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [up.id_up, up.id_unico, tipo, fecha, entidad, descripcion, resultado, soporte?.contenido || null, soporte?.nombre || null, soporte?.tipo || null, usuario.nombre || usuario.sub]);
  await registrar(usuario, { accion: 'comercial.registrar', objeto: { tipo: 'gestion_comercial', id: g.id }, idUnico: up.id_unico,
    cambios: { tipo: TIPOS_GESTION[tipo], fecha, entidad, soporte: Boolean(soporte) } });
  return { ok: true, item: { id: g.id, id_unico: up.id_unico, tipo, nombre_tipo: TIPOS_GESTION[tipo], fecha } };
}

// Lista las gestiones del alcance con cuántas hay por tipo y cuántas unidades tienen alguna.
export async function listarGestiones(usuario, { id_unico: idUnico, tipo } = {}) {
  exigirLector(usuario);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(txt(idUnico) || null);
  params.push(TIPOS_GESTION[txt(tipo)] ? txt(tipo) : null);
  const { rows } = await query(
    `SELECT g.id, g.id_unico, g.tipo, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.entidad, g.descripcion, g.resultado, g.soporte_nombre,
            (g.soporte IS NOT NULL) AS con_soporte, g.registrado_por, g.creado_en, up.nombre AS unidad, up.modalidad, up.departamento, t.nodo, t.region
       FROM gestiones_comerciales g JOIN unidades_productivas up ON up.id_up = g.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND ($${params.length - 1}::text IS NULL OR g.id_unico = $${params.length - 1})
        AND ($${params.length}::text IS NULL OR g.tipo = $${params.length})
      ORDER BY g.fecha DESC, g.id DESC LIMIT 1000`, params);
  const porTipo = Object.fromEntries(Object.keys(TIPOS_GESTION).map((k) => [k, rows.filter((r) => r.tipo === k).length]));
  return { ok: true, items: rows.map((r) => ({ ...r, nombre_tipo: TIPOS_GESTION[r.tipo] })), tipos: TIPOS_GESTION,
    resumen: { por_tipo: porTipo, unidades: new Set(rows.map((r) => r.id_unico)).size },
    puede_registrar: [ROLES.COMPRAS, ROLES.COORDINADOR].includes(usuario.rol) };
}

// Devuelve el soporte de una gestión del alcance, con su contenido, nombre y tipo.
export async function soporteGestion(usuario, { id } = {}) {
  exigirLector(usuario);
  const gid = entero(id);
  if (!gid || gid < 1 || gid > MAX_ID) throw noEncontrado('El soporte no existe.');
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(gid);
  const { rows: [g] } = await query(
    `SELECT g.soporte, g.soporte_nombre, g.soporte_tipo FROM gestiones_comerciales g JOIN unidades_productivas up ON up.id_up = g.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada WHERE (${alcance}) AND g.id = $${params.length}`, params);
  if (!g?.soporte) throw noEncontrado('El soporte no existe.');
  return { buffer: g.soporte, nombre: g.soporte_nombre, tipo: g.soporte_tipo };
}
