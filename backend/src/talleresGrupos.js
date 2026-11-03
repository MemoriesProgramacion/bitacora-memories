// Grupos de unidades de los talleres: listado de los grupos visibles según el territorio y rutas para
// administrarlos.
import { pool, query, transaccion } from './db.js';
import { COLUMNAS_UP, condicionAlcance, enAlcance, normTexto, sqlNorm } from './alcance.js';
import { noEncontrado, prohibido, solicitudInvalida } from './errores.js';
import { registrarEvento } from './acceso/sesiones.js';
import { registrar } from './servicios/actividad.js';

const columnas = `up.id_up, up.id_unico, up.nombre, up.municipio, up.departamento, up.modalidad,
  upper(btrim(t.nodo)) AS nodo, t.region, r.documento,
  concat_ws(' ', r.nombre1, r.nombre2, r.apellido1, r.apellido2) AS representante`;
const uniones = `FROM unidades_productivas up JOIN triadas t ON t.id_triada=up.id_triada
  LEFT JOIN representantes r ON r.id_representante=up.id_representante`;
const idValido = (v) => /^\d{1,9}$/.test(String(v || ''));
const esTallerista = (u) => u.rol === 'tallerista';
const regionesIguales = (a, b) => normTexto(a) === normTexto(b);

async function miembros(id, db) {
  return (await db.query(`SELECT ${columnas} ${uniones}
    JOIN talleres_grupos_ups gu ON gu.id_up=up.id_up WHERE gu.grupo_id=$1 ORDER BY up.id_up`, [id])).rows;
}

// Indica si el grupo es visible para el usuario según su alcance.
export async function grupoVisible(u, id, db = pool, bloquear = false) {
  if (!idValido(id)) throw solicitudInvalida('Elige un grupo de UP creado previamente.');
  const { rows: [g] } = await db.query(`SELECT * FROM talleres_grupos WHERE id=$1${bloquear ? ' FOR UPDATE' : ''}`, [id]);
  if (!g) throw noEncontrado('El grupo no existe o está fuera de tu región.');
  const ups = await miembros(g.id, db);
  if (!ups.length || !ups.every((up) => enAlcance(u, up) && regionesIguales(up.region, g.region))
    || (esTallerista(u) && !regionesIguales(g.region, u.alcance?.region))) {
    throw noEncontrado('El grupo no existe o está fuera de tu región.');
  }
  return { ...g, ups };
}

// Lista los grupos visibles con sus miembros.
export async function listarGrupos(u, regiones) {
  const { rows } = await query(`SELECT g.*, COALESCE(jsonb_agg(jsonb_build_object(
    'id_up',up.id_up,'id_unico',up.id_unico,'nombre',up.nombre,'municipio',up.municipio,
    'nodo',upper(btrim(t.nodo)),'region',t.region,'departamento',up.departamento,'modalidad',up.modalidad,
    'documento',r.documento,'representante',concat_ws(' ',r.nombre1,r.nombre2,r.apellido1,r.apellido2))
    ORDER BY up.id_up) FILTER (WHERE up.id_up IS NOT NULL),'[]') AS ups,
    EXISTS(SELECT 1 FROM talleres_fortalecimiento tf WHERE tf.grupo_id=g.id) AS utilizado
    FROM talleres_grupos g LEFT JOIN talleres_grupos_ups gu ON gu.grupo_id=g.id
    LEFT JOIN unidades_productivas up ON up.id_up=gu.id_up
    LEFT JOIN triadas t ON t.id_triada=up.id_triada
    LEFT JOIN representantes r ON r.id_representante=up.id_representante
    WHERE g.region=ANY($1::text[]) GROUP BY g.id ORDER BY g.creado_en DESC,g.id DESC`, [regiones]);
  return rows.filter((g) => g.ups.length && g.ups.every((up) => enAlcance(u, up) && regionesIguales(up.region, g.region)))
    .map((g) => ({ ...g, editable: !g.utilizado && !esTallerista(u) }));
}

// Registra en el router de talleres las rutas para crear, editar y listar grupos.
export function rutasGrupos(router, territorio) {
  router.use(['/ups', '/grupos'], (req, _res, next) => {
    next(esTallerista(req.usuario) ? prohibido('Los grupos de UP los crea la coordinación.') : undefined);
  });
  router.get('/ups', async (req, res) => {
    const params = [];
    const alcance = condicionAlcance(req.usuario, COLUMNAS_UP, params);
    const buscar = String(req.query.buscar || '').trim().slice(0, 100);
    params.push(buscar, String(req.query.region || '').trim());
    const b = params.length - 1;
    const filtros = [['departamento', 'up.departamento'], ['nodo', 't.nodo'], ['municipio', 'up.municipio']]
      .filter(([k]) => String(req.query[k] || '').trim())
      .map(([k, col]) => {
        params.push(normTexto(String(req.query[k]).slice(0, 100)));
        return `AND ${sqlNorm(col)} = $${params.length}`;
      }).join(' ');
    const { rows } = await query(`SELECT ${columnas} ${uniones} WHERE ${alcance}
      AND ($${b + 1}='' OR t.region=$${b + 1})
      AND ($${b}='' OR strpos(lower(concat_ws(' ',up.id_unico,up.nombre,r.documento,
        r.nombre1,r.nombre2,r.apellido1,r.apellido2,up.municipio,t.nodo)),lower($${b}))>0)
      ${filtros}
      ORDER BY up.id_unico,up.id_up LIMIT 51`, params);
    res.json({ ok: true, items: rows.slice(0, 50), hay_mas: rows.length > 50 });
  });

  async function guardar(req, res) {
    const d = req.body || {};
    const nombre = typeof d.nombre === 'string' ? d.nombre.trim() : '';
    if (!nombre || nombre.length > 150) throw solicitudInvalida('Indica el nombre del grupo (máximo 150 caracteres).');
    if (!Array.isArray(d.ups) || d.ups.length < 1 || d.ups.length > 40 || !d.ups.every(idValido)
      || new Set(d.ups.map(Number)).size !== d.ups.length) throw solicitudInvalida('Selecciona entre 1 y 40 UP, sin repetir.');
    const regiones = [...new Set((await territorio(req.usuario)).map((n) => n.region))];
    const region = regiones.find((r) => regionesIguales(r, d.region));
    if (!region) throw prohibido('Elige una región de tu territorio.');
    let previo;
    const item = await transaccion(async (db) => {
      if (req.params.gid) {
        previo = await grupoVisible(req.usuario, req.params.gid, db, true);
        const { rowCount } = await db.query('SELECT 1 FROM talleres_fortalecimiento WHERE grupo_id=$1', [previo.id]);
        if (rowCount) throw solicitudInvalida('Este grupo ya está programado. Crea otro grupo para cambiar sus UP sin alterar la asistencia.');
      }
      const { rows: ups } = await db.query(`SELECT ${columnas} ${uniones} WHERE up.id_up=ANY($1::int[])`, [d.ups]);
      if (ups.length !== d.ups.length || !ups.every((up) => enAlcance(req.usuario, up) && regionesIguales(up.region, region))) {
        throw prohibido('Todas las UP del grupo deben existir y pertenecer a la región y territorio seleccionados.');
      }
      const { rows: [g] } = previo
        ? await db.query('UPDATE talleres_grupos SET nombre=$2,region=$3,actualizado_en=now() WHERE id=$1 RETURNING *', [previo.id,nombre,region])
        : await db.query('INSERT INTO talleres_grupos(nombre,region,creado_por) VALUES($1,$2,$3) RETURNING *', [nombre,region,req.usuario.sub]);
      await db.query('DELETE FROM talleres_grupos_ups WHERE grupo_id=$1', [g.id]);
      await db.query('INSERT INTO talleres_grupos_ups(grupo_id,id_up) SELECT $1,unnest($2::int[])', [g.id,d.ups]);
      return { ...g, ups };
    });
    registrarEvento(req, 'taller_grupo_guardado', { detalle: String(item.id) });
    const idsDe = (lista) => (lista || []).map((up) => up.id_unico).sort();
    const campos = {};
    if (previo?.nombre !== item.nombre) campos.nombre = [previo?.nombre ?? null, item.nombre];
    if (previo?.region !== item.region) campos.region = [previo?.region ?? null, item.region];
    if (JSON.stringify(idsDe(previo?.ups)) !== JSON.stringify(idsDe(item.ups))) campos.ups = [previo ? idsDe(previo.ups) : null, idsDe(item.ups)];
    await registrar(req.usuario, { accion: 'talleres.grupo_guardar', objeto: { tipo: 'grupo_up', id: item.id }, cambios: { nuevo: !previo, campos } });
    res.json({ ok: true, item, mensaje: 'Grupo de UP guardado.' });
  }
  router.post('/grupos', guardar);
  router.put('/grupos/:gid', guardar);
}
