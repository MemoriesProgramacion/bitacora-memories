// Rutas de las entregas de encuentros de los programas Niñas TIC, Mujeres TIC y Alfabetizadores TIC: el espacio
// de entrega de cada grupo, los consentimientos (solo la primera vez), los cuatro entregables de cada uno de los
// 10 encuentros (registro fotográfico, lista de asistencia, video e informe) y el cierre de cada encuentro en la
// carpeta de evidencias. Los archivos se guardan en la base, como los soportes de talleres, y toda escritura
// queda en el registro de actividad.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { query, transaccion } from './db.js';
import { noEncontrado, prohibido, solicitudInvalida } from './errores.js';
import { registrar } from './servicios/actividad.js';
import { contenidoValido, tipoPorNombre } from './servicios/tipoArchivo.js';

const router = Router();

export const PROGRAMAS = {
  ninas: 'Niñas TIC',
  mujeres: 'Mujeres TIC',
  alfabetizadores: 'Alfabetizadores TIC',
};
export const TOTAL_ENCUENTROS = 10;

// Lo que se entrega en cada encuentro, con los formatos y el peso que admite cada uno.
export const ELEMENTOS = {
  fotos: { titulo: 'Registro fotográfico', ext: ['.pdf'], formatos: 'PDF', mb: 30 },
  asistencia: { titulo: 'Lista de asistencia', ext: ['.pdf', '.jpg', '.jpeg', '.png', '.docx'], formatos: 'PDF, JPG, PNG o Word', mb: 25 },
  video: { titulo: 'Video', ext: ['.mp4', '.mov', '.webm', '.3gp', '.m4v'], formatos: 'MP4, MOV, WEBM o 3GP', mb: 200 },
  informe: { titulo: 'Informe de actividades', ext: ['.pdf', '.docx', '.doc'], formatos: 'PDF o Word', mb: 25 },
};
const CONSENTIMIENTO = { titulo: 'Consentimientos', ext: ['.pdf', '.jpg', '.jpeg', '.png'], formatos: 'PDF, JPG o PNG', mb: 25, max: 10 };
const MB_MAXIMO = Math.max(CONSENTIMIENTO.mb, ...Object.values(ELEMENTOS).map((e) => e.mb));

// Pueden entrar quien tiene acceso total, la coordinación regional y los talleristas (las lideresas).
const ROLES = ['coordinador', 'tallerista'];
const general = (u) => Boolean(u?.general);

const subida = multer({
  dest: path.join(os.tmpdir(), 'bitacora-encuentros-tic'),
  limits: { fileSize: MB_MAXIMO * 1024 * 1024, files: CONSENTIMIENTO.max, fields: 10, fieldSize: 10_000 },
});

// Envuelve multer para borrar los temporales al terminar y responder claro cuando el archivo pesa de más.
const cargar = (middleware) => (req, res, next) => {
  res.on('close', () => {
    const lista = [...(Array.isArray(req.files) ? req.files : []), req.file].filter(Boolean);
    for (const f of lista) if (f.path) fs.unlink(f.path).catch(() => {});
  });
  middleware(req, res, (e) => {
    if (e?.code === 'LIMIT_FILE_SIZE') return next(solicitudInvalida(`El archivo pesa demasiado. El video puede pesar hasta ${ELEMENTOS.video.mb} MB y los demás hasta 30 MB.`));
    if (e?.code === 'LIMIT_FILE_COUNT') return next(solicitudInvalida(`Puedes subir hasta ${CONSENTIMIENTO.max} archivos a la vez.`));
    next(e);
  });
};

const nombreArchivo = (f) => String(f.originalname || 'archivo').replace(/[\r\n\\/]/g, '_').slice(0, 200);
const idValido = (v) => /^\d{1,9}$/.test(String(v || ''));
const actividad = (req, accion, objeto, cambios = {}) => registrar(req.usuario, { accion, objeto, cambios });

router.use((req, _res, next) => {
  if (!general(req.usuario) && !ROLES.includes(req.usuario?.rol)) return next(prohibido('No tienes acceso a las entregas de encuentros.'));
  next();
});

// Los tres grupos (uno por programa) están siempre activos y los ve toda cuenta con acceso a la sección; el
// esquema los crea al arrancar.
async function grupoVisible(_u, id) {
  if (!idValido(id)) throw noEncontrado('El grupo no existe.');
  const { rows: [g] } = await query('SELECT * FROM encuentros_tic_grupos WHERE id=$1', [id]);
  if (!g) throw noEncontrado('El grupo no existe.');
  return g;
}

// Arma el estado de cada grupo: consentimientos y, por encuentro, qué entregables tiene y si ya se entregó.
async function estadoGrupos(grupos) {
  const ids = grupos.map((g) => g.id);
  if (!ids.length) return [];
  const { rows: archivos } = await query(`SELECT id, grupo_id, encuentro, elemento, nombre, tamano, subido_por_nombre, subido_en
    FROM encuentros_tic_archivos WHERE grupo_id = ANY($1::int[]) ORDER BY id`, [ids]);
  const { rows: entregados } = await query('SELECT grupo_id, encuentro, entregado_en, entregado_por_nombre FROM encuentros_tic_entregados WHERE grupo_id = ANY($1::int[])', [ids]);
  return grupos.map((g) => {
    const propios = archivos.filter((a) => a.grupo_id === g.id);
    const encuentros = Array.from({ length: TOTAL_ENCUENTROS }, (_, i) => {
      const n = i + 1;
      const e = entregados.find((x) => x.grupo_id === g.id && x.encuentro === n);
      return {
        numero: n,
        elementos: Object.fromEntries(Object.keys(ELEMENTOS).map((k) => [k, propios.find((a) => a.encuentro === n && a.elemento === k) || null])),
        entregado_en: e?.entregado_en || null,
        entregado_por: e?.entregado_por_nombre || null,
      };
    });
    return {
      id: g.id, programa: g.programa, programa_nombre: PROGRAMAS[g.programa], nombre: g.nombre, municipio: g.municipio,
      lugar: g.lugar, region: g.region, creado_en: g.creado_en,
      consentimientos: propios.filter((a) => a.elemento === 'consentimiento'),
      encuentros,
      entregados: encuentros.filter((e) => e.entregado_en).length,
    };
  });
}

router.get('/', async (req, res) => {
  const { rows } = await query(`SELECT * FROM encuentros_tic_grupos
    ORDER BY array_position(ARRAY['ninas','mujeres','alfabetizadores']::varchar[], programa), id`);
  const grupos = await estadoGrupos(rows);
  res.json({
    ok: true,
    grupos,
    programas: Object.entries(PROGRAMAS).map(([codigo, nombre]) => ({ codigo, nombre })),
    elementos: Object.entries(ELEMENTOS).map(([codigo, e]) => ({ codigo, titulo: e.titulo, formatos: e.formatos, mb: e.mb, ext: e.ext })),
    consentimiento: { formatos: CONSENTIMIENTO.formatos, mb: CONSENTIMIENTO.mb, ext: CONSENTIMIENTO.ext, max: CONSENTIMIENTO.max },
    total_encuentros: TOTAL_ENCUENTROS,
  });
});

// Valida un archivo contra la extensión y el contenido admitidos.
async function validarArchivo(f, def) {
  const nombre = nombreArchivo(f);
  const ext = path.extname(nombre).toLowerCase();
  if (!def.ext.includes(ext)) throw solicitudInvalida(`"${nombre}" no es un formato admitido. Sube ${def.formatos}.`);
  if (f.size > def.mb * 1024 * 1024) throw solicitudInvalida(`"${nombre}" pesa más de ${def.mb} MB.`);
  if (!(await contenidoValido(f.path, nombre, def.ext))) throw solicitudInvalida(`El contenido de "${nombre}" no corresponde a un ${def.formatos}.`);
  return { nombre, mime: tipoPorNombre(nombre)?.mime || 'application/octet-stream' };
}

// Sube los consentimientos del grupo. Se hace una vez; se pueden agregar más si faltó alguno.
router.post('/grupos/:id/consentimientos', cargar(subida.array('archivos', CONSENTIMIENTO.max)), async (req, res) => {
  const g = await grupoVisible(req.usuario, req.params.id);
  const lista = req.files || [];
  if (!lista.length) throw solicitudInvalida('Adjunta los consentimientos del grupo.');
  const datos = [];
  for (const f of lista) datos.push({ f, ...(await validarArchivo(f, CONSENTIMIENTO)) });
  await transaccion(async (db) => {
    for (const d of datos) {
      await db.query(`INSERT INTO encuentros_tic_archivos (grupo_id, encuentro, elemento, nombre, mime, tamano, archivo, subido_por, subido_por_nombre)
        VALUES ($1,NULL,'consentimiento',$2,$3,$4,$5,$6,$7)`, [g.id, d.nombre, d.mime, d.f.size, await fs.readFile(d.f.path), req.usuario.sub, req.usuario.nombre || null]);
    }
  });
  await actividad(req, 'encuentros_tic.consentimientos', { tipo: 'encuentros_tic_grupo', id: g.id }, { archivos: datos.map((d) => d.nombre) });
  const [item] = await estadoGrupos([g]);
  res.json({ ok: true, item });
});

const encuentroValido = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL_ENCUENTROS) throw noEncontrado('El encuentro no existe.');
  return n;
};
// Indica si el encuentro ya se guardó en la carpeta de evidencias: desde ese momento queda cerrado.
async function yaEntregado(db, grupoId, n) {
  const { rowCount } = await db.query('SELECT 1 FROM encuentros_tic_entregados WHERE grupo_id=$1 AND encuentro=$2', [grupoId, n]);
  return rowCount > 0;
}
const CERRADO = (n) => solicitudInvalida(`El encuentro ${n} ya se guardó en la carpeta de evidencias: sus documentos quedan cerrados y no se pueden cambiar.`);
async function tieneConsentimientos(db, grupoId) {
  const { rowCount } = await db.query("SELECT 1 FROM encuentros_tic_archivos WHERE grupo_id=$1 AND elemento='consentimiento' LIMIT 1", [grupoId]);
  return rowCount > 0;
}

// Guarda el encuentro en la carpeta de evidencias: solo si tiene los cuatro entregables, y una sola vez. Desde
// ese momento queda cerrado. Va antes de la carga de archivos para que «entregar» no se tome como el nombre de
// un entregable.
router.post('/grupos/:id/encuentros/:n/entregar', async (req, res) => {
  const g = await grupoVisible(req.usuario, req.params.id);
  const n = encuentroValido(req.params.n);
  await transaccion(async (db) => {
    await db.query('SELECT id FROM encuentros_tic_grupos WHERE id=$1 FOR UPDATE', [g.id]);
    if (await yaEntregado(db, g.id, n)) throw CERRADO(n);
    if (!(await tieneConsentimientos(db, g.id))) throw solicitudInvalida('Primero sube los consentimientos del grupo.');
    const { rows } = await db.query('SELECT DISTINCT elemento FROM encuentros_tic_archivos WHERE grupo_id=$1 AND encuentro=$2', [g.id, n]);
    const tiene = new Set(rows.map((r) => r.elemento));
    const faltan = Object.entries(ELEMENTOS).filter(([k]) => !tiene.has(k)).map(([, e]) => e.titulo);
    if (faltan.length) throw solicitudInvalida(`Al encuentro ${n} le falta: ${faltan.join(', ')}.`);
    await db.query(`INSERT INTO encuentros_tic_entregados (grupo_id, encuentro, entregado_por, entregado_por_nombre) VALUES ($1,$2,$3,$4)`,
    [g.id, n, req.usuario.sub, req.usuario.nombre || null]);
  });
  await actividad(req, 'encuentros_tic.entregar', { tipo: 'encuentros_tic_grupo', id: g.id }, { encuentro: n });
  const [item] = await estadoGrupos([g]);
  res.json({ ok: true, item });
});

// Sube o reemplaza uno de los cuatro entregables de un encuentro que todavía no se ha guardado. Un encuentro
// guardado queda cerrado: sus documentos se ven y se descargan, pero no se cambian.
router.post('/grupos/:id/encuentros/:n/:elemento', cargar(subida.single('archivo')), async (req, res) => {
  const g = await grupoVisible(req.usuario, req.params.id);
  const n = encuentroValido(req.params.n);
  const def = ELEMENTOS[req.params.elemento];
  if (!def) throw noEncontrado('Ese entregable no existe.');
  if (!req.file) throw solicitudInvalida(`Adjunta el archivo de ${def.titulo.toLowerCase()}.`);
  const { nombre, mime } = await validarArchivo(req.file, def);
  const bytes = await fs.readFile(req.file.path);
  await transaccion(async (db) => {
    await db.query('SELECT id FROM encuentros_tic_grupos WHERE id=$1 FOR UPDATE', [g.id]);
    if (await yaEntregado(db, g.id, n)) throw CERRADO(n);
    if (!(await tieneConsentimientos(db, g.id))) throw solicitudInvalida('Primero sube los consentimientos del grupo.');
    await db.query('DELETE FROM encuentros_tic_archivos WHERE grupo_id=$1 AND encuentro=$2 AND elemento=$3', [g.id, n, req.params.elemento]);
    await db.query(`INSERT INTO encuentros_tic_archivos (grupo_id, encuentro, elemento, nombre, mime, tamano, archivo, subido_por, subido_por_nombre)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [g.id, n, req.params.elemento, nombre, mime, req.file.size, bytes, req.usuario.sub, req.usuario.nombre || null]);
  });
  await actividad(req, 'encuentros_tic.subir', { tipo: 'encuentros_tic_grupo', id: g.id }, { encuentro: n, elemento: req.params.elemento, archivo: nombre });
  const [item] = await estadoGrupos([g]);
  res.json({ ok: true, item });
});

// Descarga un archivo del grupo.
router.get('/archivos/:aid', async (req, res) => {
  if (!idValido(req.params.aid)) throw noEncontrado('El archivo no existe.');
  const { rows: [a] } = await query('SELECT * FROM encuentros_tic_archivos WHERE id=$1', [req.params.aid]);
  if (!a) throw noEncontrado('El archivo no existe.');
  await grupoVisible(req.usuario, a.grupo_id);
  res.attachment(a.nombre).type(a.mime).send(a.archivo);
});

export default router;
