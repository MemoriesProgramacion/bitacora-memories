// Metas de cupos por región y modalidad: cuántas unidades debe atender cada región en cada modalidad, que suman
// las 6.334 del programa, y opcionalmente por departamento. El seguimiento compara el avance contra ellas.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { prohibido, solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';
import { alcanceDe, normTexto } from '../alcance.js';
import { registrar } from './actividad.js';

export const MODALIDADES = ['M1', 'M2', 'M3', 'M4'];
export const TOTAL_PROGRAMA = 6334;
const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS];

// Convierte un nombre como M2 - Asociativa en M2, o null si no es una modalidad.
export const modalidadCorta = (m) => { const x = normTexto(m).slice(0, 2); return MODALIDADES.includes(x) ? x : null; };

// Devuelve las metas con el total y lo que suma cada región; quien tiene alcance regional solo ve su región.
export async function listarMetas(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta las metas.');
  const a = alcanceDe(usuario);
  const { rows } = await query(
    `SELECT id, region, modalidad, departamento, meta, registrada_por, actualizada_en FROM metas_cupos
      WHERE $1::text IS NULL OR upper(translate(btrim(region), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = $1
      ORDER BY region, departamento, modalidad`, [a?.region || null]);
  const regionales = rows.filter((r) => !r.departamento);
  return {
    ok: true, items: rows, total_programa: TOTAL_PROGRAMA,
    total_metas: regionales.reduce((n, r) => n + r.meta, 0),
    puede_editar: Boolean(usuario.general),
  };
}

// Reemplaza las metas; cada fila lleva región, modalidad, departamento opcional y una meta mayor o igual a
// cero.
export async function guardarMetas(usuario, { metas } = {}) {
  if (!usuario?.general) throw prohibido('Las metas las registra el Coordinador general o el Profesional de seguimiento.');
  if (!Array.isArray(metas) || metas.length > 2000) throw solicitudInvalida('Envía la lista de metas.');
  const limpias = [];
  const claves = new Set();
  metas.forEach((m, i) => {
    const region = txt(m?.region)?.slice(0, 100);
    const modalidad = modalidadCorta(m?.modalidad);
    const departamento = txt(m?.departamento)?.slice(0, 100) || '';
    const meta = Number(m?.meta);
    if (!region) throw solicitudInvalida(`Meta ${i + 1}: escribe la región.`);
    if (!modalidad) throw solicitudInvalida(`Meta ${i + 1}: la modalidad debe ser M1, M2, M3 o M4.`);
    if (!Number.isInteger(meta) || meta < 0 || meta > 1000000) throw solicitudInvalida(`Meta ${i + 1}: la meta debe ser un número entero de unidades.`);
    const clave = `${normTexto(region)}|${modalidad}|${normTexto(departamento)}`;
    if (claves.has(clave)) throw solicitudInvalida(`Meta ${i + 1}: la región ${region}${departamento ? ` (${departamento})` : ''} en ${modalidad} está repetida.`);
    claves.add(clave);
    limpias.push({ region, modalidad, departamento, meta });
  });
  const { rows: antes } = await query('SELECT region, modalidad, departamento, meta FROM metas_cupos ORDER BY region, departamento, modalidad');
  await transaccion(async (db) => {
    await db.query('DELETE FROM metas_cupos');
    for (const m of limpias) {
      await db.query('INSERT INTO metas_cupos (region, modalidad, departamento, meta, registrada_por) VALUES ($1, $2, $3, $4, $5)',
        [m.region, m.modalidad, m.departamento, m.meta, usuario.nombre || usuario.sub]);
    }
  });
  const total = limpias.filter((m) => !m.departamento).reduce((n, m) => n + m.meta, 0);
  await registrar(usuario, { accion: 'metas.guardar', objeto: { tipo: 'metas', id: null }, idUnico: null,
    cambios: { campos: { metas: [antes.length, limpias.length], total: [antes.filter((m) => !m.departamento).reduce((n, m) => n + m.meta, 0), total] } } });
  return { ok: true, items: limpias, total_metas: total, total_programa: TOTAL_PROGRAMA,
    aviso: total !== TOTAL_PROGRAMA ? `Las metas regionales suman ${total} y el programa atiende ${TOTAL_PROGRAMA} unidades.` : null };
}

// Devuelve la meta de una región y modalidad, y departamento si hay una específica, o null.
export function metaDe(metas, { region, modalidad, departamento = '' }) {
  const r = normTexto(region);
  const m = modalidadCorta(modalidad);
  const d = normTexto(departamento);
  const fila = metas.find((x) => normTexto(x.region) === r && x.modalidad === m && normTexto(x.departamento) === d)
    || (d ? null : metas.find((x) => normTexto(x.region) === r && x.modalidad === m && !x.departamento));
  return fila ? fila.meta : null;
}
