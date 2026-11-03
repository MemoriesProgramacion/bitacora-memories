// Histórico del proceso de subsanación de la base maestra. Cada vez que se actualiza subsanaciones_proceso
// queda una entrada con cuándo, quién, qué unidades cambiaron y el Excel adjunto. El navegador sube primero el
// Excel y envía su id en cada lote del cargue.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { exigirContenido } from './tipoArchivo.js';

const CARPETA = 'cargues-master';
const ORIGENES = ['subsanacion', 'documentacion'];
const POR_PAGINA = 20;
const CAMBIOS_POR_PAGINA = 100;

const exigirCargue = (usuario) => {
  if (!usuario?.general) throw prohibido('Solo el Profesional de seguimiento e información puede hacer cargues.');
};
const exigirCoordinadorGeneral = (usuario) => {
  if (!usuario?.superadmin) throw prohibido('El histórico de la BASE MASTER solo lo consulta el Coordinador general.');
};

const rolDe = (u) => (u.superadmin ? 'superadmin' : u.esDatos ? 'coordinador_datos' : u.rol || null);

async function mover(origen, destino) {
  await fs.mkdir(path.dirname(destino), { recursive: true });
  try {
    await fs.rename(origen, destino);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.copyFile(origen, destino);
    await fs.unlink(origen);
  }
}

// Crea la entrada del histórico con el archivo de la base maestra, el origen y la cantidad de filas, y devuelve
// su id.
export async function iniciarHistorial(usuario, campos = {}, archivo) {
  exigirCargue(usuario);
  const origen = String(campos.origen || '');
  if (!ORIGENES.includes(origen)) throw solicitudInvalida('Origen del cargue desconocido.');
  if (!archivo?.path) throw solicitudInvalida('Adjunta la BASE MASTER.');
  const nombre = path.basename(String(archivo.originalname || '')).replace(/[\u0000-\u001f<>:"|?*\\/]/g, '').trim().slice(0, 300)
    || 'BASE_MASTER.xlsx';
  await exigirContenido(archivo.path, nombre, ['.xlsx']);
  const relativa = path.posix.join(CARPETA, `${crypto.randomUUID()}.xlsx`);
  const destino = path.join(config.storageDir, relativa);
  await mover(archivo.path, destino);
  const filas = Math.max(0, Number.parseInt(campos.filas, 10) || 0);
  try {
    const { rows: [h] } = await query(
      `INSERT INTO historial_subsanacion (usuario_sub, usuario_nombre, usuario_rol, origen, archivo_nombre, archivo_ruta,
                                          archivo_tamano, filas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [usuario.sub, usuario.nombre || null, rolDe(usuario), origen, nombre, relativa, archivo.size ?? null, filas],
    );
    return { ok: true, id: h.id };
  } catch (err) {
    await fs.unlink(destino).catch(() => {});
    throw err;
  }
}

// Suma un lote del cargue a su entrada del histórico acumulando los contadores; la entrada debe ser de quien
// hace el cargue.
export async function anotarLote(usuario, id, { cambios = [], sin_cambios = 0, no_encontrados = 0, fallidos = 0 } = {}) {
  if (id === undefined || id === null || id === '') return;
  const idH = Number.parseInt(id, 10);
  const { rowCount } = await query(
    `UPDATE historial_subsanacion
        SET actualizados = actualizados + $3, sin_cambios = sin_cambios + $4,
            no_encontrados = no_encontrados + $5, fallidos = fallidos + $6
      WHERE id = $1 AND usuario_sub = $2`,
    [idH, usuario.sub, cambios.length, sin_cambios, no_encontrados, fallidos],
  );
  if (!rowCount) throw solicitudInvalida('La entrada del histórico de la BASE MASTER no existe o no es tuya.');
  if (!cambios.length) return;
  await query(
    `INSERT INTO historial_subsanacion_cambios (id_historial, id_unico, antes, despues)
     SELECT $1, d.id_unico, d.antes, d.despues
       FROM unnest($2::text[], $3::text[], $4::text[]) AS d (id_unico, antes, despues)
     ON CONFLICT (id_historial, id_unico) DO UPDATE SET despues = EXCLUDED.despues`,
    [idH, cambios.map((c) => String(c.id_unico)), cambios.map((c) => c.antes ?? null), cambios.map((c) => c.despues ?? null)],
  );
}

// Lista las entradas del histórico, la más reciente primero.
export async function listarHistorial(usuario, { pagina } = {}) {
  exigirCoordinadorGeneral(usuario);
  const pag = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const { rows } = await query(
    `SELECT id, fecha, usuario_nombre, usuario_rol, origen, archivo_nombre, archivo_tamano, filas,
            actualizados, sin_cambios, no_encontrados, fallidos, count(*) OVER ()::int AS total
       FROM historial_subsanacion
      ORDER BY fecha DESC, id DESC
      LIMIT ${POR_PAGINA} OFFSET $1`,
    [(pag - 1) * POR_PAGINA],
  );
  const total = rows[0]?.total ?? 0;
  return {
    ok: true,
    items: rows.map(({ total: _t, ...r }) => r),
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
  };
}

// Devuelve qué cambió en una entrada, unidad por unidad, con el antes y el después.
export async function cambiosDeHistorial(usuario, { id, q, pagina } = {}) {
  exigirCoordinadorGeneral(usuario);
  const idH = Number.parseInt(id, 10);
  if (!idH) throw solicitudInvalida('Falta la entrada del histórico.');
  const pag = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const buscar = String(q || '').trim().slice(0, 80);
  const { rows } = await query(
    `SELECT c.id_unico, up.nombre AS up_nombre, c.antes, c.despues, count(*) OVER ()::int AS total
       FROM historial_subsanacion_cambios c
       LEFT JOIN unidades_productivas up ON up.id_unico = c.id_unico
      WHERE c.id_historial = $1
        AND ($2 = '' OR c.id_unico = $2 OR up.nombre ILIKE '%' || $2 || '%'
             OR c.antes ILIKE '%' || $2 || '%' OR c.despues ILIKE '%' || $2 || '%')
      ORDER BY length(c.id_unico), c.id_unico
      LIMIT ${CAMBIOS_POR_PAGINA} OFFSET $3`,
    [idH, buscar.replace(/[\\%_]/g, (c) => `\\${c}`), (pag - 1) * CAMBIOS_POR_PAGINA],
  );
  const total = rows[0]?.total ?? 0;
  return {
    ok: true,
    items: rows.map(({ total: _t, ...r }) => r),
    total,
    pagina: pag,
    paginas: Math.max(1, Math.ceil(total / CAMBIOS_POR_PAGINA)),
  };
}

// Devuelve la ruta, el tipo y el nombre del Excel adjunto a una entrada.
export async function archivoDeHistorial(usuario, { id } = {}) {
  exigirCoordinadorGeneral(usuario);
  const { rows: [h] } = await query(
    'SELECT archivo_nombre, archivo_ruta FROM historial_subsanacion WHERE id = $1', [Number.parseInt(id, 10) || 0]);
  if (!h) throw noEncontrado('La entrada del histórico no existe.');
  const ruta = path.join(config.storageDir, h.archivo_ruta);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  try { await fs.access(ruta); } catch { throw noEncontrado('El archivo ya no está en el almacenamiento.'); }
  return {
    ruta,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    nombre: h.archivo_nombre,
  };
}
