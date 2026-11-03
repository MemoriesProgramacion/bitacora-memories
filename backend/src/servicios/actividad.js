// Registro de actividad: quién cambió qué y cuándo. Cada escritura guarda una fila con el autor, el momento, el
// módulo y los campos cambiados como antes y después. Alimenta el historial de cada unidad y la pantalla de
// actividad de la consola, y es independiente del registro de seguridad.
import { query } from '../db.js';
import { HttpError, noEncontrado, prohibido } from '../errores.js';
import { esGestor, normNodo } from '../util.js';
import { enAlcance, condicionAlcance } from '../alcance.js';
import { ROLES } from '../config.js';
import { esRegional, cuentasGestionables, claveDeCuenta } from '../acceso/jerarquia.js';

// Tipos de cuenta que tienen territorio; los demás son de alcance nacional.
const ROLES_TERRITORIALES = [ROLES.TECNICO, ROLES.TALLERISTA, ROLES.GESTOR];

// Devuelve las cuentas origen:id que un usuario con territorio puede ver: las de niveles inferiores dentro de
// su territorio y la suya.
async function subsVisibles(usuario) {
  const cuentas = await cuentasGestionables(usuario);
  return [...cuentas.map(claveDeCuenta), usuario.sub];
}

// Devuelve las mismas cuentas separadas entre las que tienen territorio y todas.
async function subsPorTerritorio(usuario) {
  const cuentas = await cuentasGestionables(usuario);
  return {
    territoriales: [...cuentas.filter((c) => ROLES_TERRITORIALES.includes(c.rol)).map(claveDeCuenta), usuario.sub],
    todas: [...cuentas.map(claveDeCuenta), usuario.sub],
  };
}

const LIMITE_MAX = 500;

function quien(usuario) {
  return {
    sub: usuario?.sub || null,
    nombre: usuario?.nombre || usuario?.sub || null,
    rol: usuario?.superadmin ? 'superadmin' : usuario?.esDatos ? 'coordinador_datos' : usuario?.rol || null,
    nodo: usuario?.nodo ? normNodo(usuario.nodo) : null,
  };
}

// Anota un cambio y devuelve el id de la fila, o null si no se pudo registrar.
export async function registrar(usuario, { accion, resultado = 'ok', objeto = null, idUnico = null, cambios = {} }) {
  try {
    const q = quien(usuario);
    const { rows } = await query(
      `INSERT INTO actividad (accion, resultado, usuario_sub, usuario_nombre, usuario_rol, usuario_nodo, objeto_tipo, objeto_id, id_unico, cambios)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [accion, resultado, q.sub, q.nombre, q.rol, q.nodo, objeto?.tipo ?? null, objeto?.id != null ? String(objeto.id) : null,
        idUnico != null ? String(idUnico) : null, JSON.stringify(cambios)],
    );
    return rows[0]?.id != null ? String(rows[0].id) : null;
  } catch (err) {
    console.error('[actividad] No se pudo registrar:', err.message);
    return null;
  }
}

// Anota una fila por unidad de un cargue o borrado masivo en una sola inserción.
export async function registrarPorUnidad(usuario, { accion, objeto = null, lote = null, filas = [] }) {
  const validas = (Array.isArray(filas) ? filas : []).filter((f) => f && f.idUnico != null && String(f.idUnico) !== '');
  if (!validas.length) return 0;
  try {
    const q = quien(usuario);
    const r = await query(
      `INSERT INTO actividad (accion, resultado, usuario_sub, usuario_nombre, usuario_rol, usuario_nodo, objeto_tipo, objeto_id, id_unico, cambios)
       SELECT $1, 'ok', $2, $3, $4, $5, $6, $7, f.id_unico, f.cambios
         FROM unnest($8::text[], $9::jsonb[]) WITH ORDINALITY AS f (id_unico, cambios, n)
        ORDER BY f.n`,
      [accion, q.sub, q.nombre, q.rol, q.nodo, objeto?.tipo ?? null, objeto?.id != null ? String(objeto.id) : null,
        validas.map((f) => String(f.idUnico)),
        validas.map((f) => JSON.stringify({ campos: f.campos || {}, ...(lote != null ? { lote: String(lote) } : {}) }))],
    );
    return r.rowCount;
  } catch (err) {
    console.error('[actividad] No se pudo registrar por unidad:', err.message);
    return 0;
  }
}

// Ejecuta una función y deja constancia: ok con lo que devuelva, o rechazado o error si lanza, y vuelve a
// lanzar.
export async function conRegistro(usuario, meta, fn, cambiosDe = () => ({})) {
  try {
    const r = await fn();
    await registrar(usuario, { ...meta, resultado: 'ok', cambios: cambiosDe(r) });
    return r;
  } catch (err) {
    const esNegocio = err instanceof HttpError && err.status < 500;
    await registrar(usuario, {
      ...meta, resultado: esNegocio ? 'rechazado' : 'error', cambios: { detalle: String(err.message).slice(0, 300) },
    });
    throw err;
  }
}

// Calcula las diferencias campo a campo como antes y después, solo de lo que cambió.
export function diferencias(antes = {}, despues = {}, campos = []) {
  const salida = {};
  for (const k of campos) {
    const a = antes[k] ?? null;
    const d = despues[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(d)) salida[k] = [a, d];
  }
  return salida;
}

// Recorta un texto largo para que las filas de actividad sigan siendo pequeñas.
export const corto = (v, max = 300) => (typeof v === 'string' && v.length > max ? `${v.slice(0, max)}…` : v);

// Igual que diferencias, con los textos largos recortados.
export const diferenciasCortas = (antes, despues, campos, max = 300) => Object.fromEntries(
  Object.entries(diferencias(antes, despues, campos)).map(([k, [a, d]]) => [k, [corto(a, max), corto(d, max)]]));

// Texto que queda en la actividad cuando cambia un dato personal, en lugar de su valor.
export const MODIFICADO = '(modificado)';

// Igual que diferenciasCortas, pero de los campos sensibles solo dice que cambiaron, sin guardar su valor.
export function diferenciasSinDatos(antes, despues, campos, sensibles = [], max = 300) {
  const salida = diferenciasCortas(antes || {}, despues || {}, campos, max);
  for (const k of sensibles) if (k in salida) salida[k] = MODIFICADO;
  return salida;
}

// Devuelve las claves de primer nivel de dos objetos para comparar secciones guardadas como JSON.
export const clavesDe = (...objetos) => [...new Set(objetos.flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])))];

// Limita una lista de ids a un tope, dejando el total aparte.
export const tope = (lista, max = 200) => (Array.isArray(lista) ? lista.slice(0, max) : []);

// Identidad con la que se registran los trabajos programados, como cierres automáticos e informes.
export const SISTEMA = { sub: 'sistema', nombre: 'Proceso automático', rol: 'sistema' };

const aItem = (r) => ({
  id: String(r.id), fecha: r.fecha, accion: r.accion, resultado: r.resultado,
  quien: { nombre: r.usuario_nombre, rol: r.usuario_rol, nodo: r.usuario_nodo },
  objeto: r.objeto_tipo ? { tipo: r.objeto_tipo, id: r.objeto_id } : null,
  cambios: r.cambios || {},
});

// Lista la actividad con filtros por unidad, fechas, autor, acción, resultado, límite y cursor.
export async function listarActividad(usuario, p = {}) {
  if (p.resumen === 'uso') return resumenUso(usuario, p);
  const up = p.up ? String(p.up) : null;
  const admin = !!usuario?.superadmin;
  const regional = esRegional(usuario);
  if (!admin && !regional && !up) throw prohibido('Solo el administrador ve toda la actividad.');
  if (up && [ROLES.COMPRAS, ROLES.TECNICO].includes(usuario?.rol)) {
    throw prohibido('Tu rol no consulta el historial de cambios de la unidad productiva.');
  }
  if (up && !admin) {
    const { rows } = await query(
      `SELECT t.nodo, t.region, x.departamento, x.modalidad FROM unidades_productivas x
         LEFT JOIN triadas t ON t.id_triada = x.id_triada WHERE x.id_unico = $1`, [up]);
    if (!rows.length || !enAlcance(usuario, rows[0])) {
      throw noEncontrado(esGestor(usuario) ? 'Esa unidad no pertenece a tu nodo.' : 'Esa unidad está fuera de tu alcance.');
    }
  }
  const limite = Math.min(Math.max(Number(p.limite) || 100, 1), LIMITE_MAX);
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (up) add('id_unico = ?', up);
  if (!up && regional) {
    const { territoriales, todas } = await subsPorTerritorio(usuario);
    params.push(territoriales);
    const pTerritoriales = params.length;
    params.push(todas);
    const pTodas = params.length;
    const alcance = condicionAlcance(usuario, {
      nodo: 't_v.nodo', region: 't_v.region', departamento: 'u_v.departamento', modalidad: 'u_v.modalidad',
    }, params);
    cond.push(`((id_unico IS NULL AND usuario_sub = ANY($${pTerritoriales}::text[]))
      OR (id_unico IS NOT NULL AND usuario_sub = ANY($${pTodas}::text[])
          AND EXISTS (SELECT 1 FROM unidades_productivas u_v LEFT JOIN triadas t_v ON t_v.id_triada = u_v.id_triada
                       WHERE u_v.id_unico = actividad.id_unico AND ${alcance})))`);
  }
  if (up && !admin && !usuario?.general && !regional) cond.push("(accion LIKE 'compras.%' OR accion LIKE 'entrega.%' OR accion = 'cargue.compras_vigentes')");
  if (p.desde && /^\d{4}-\d{2}-\d{2}/.test(p.desde)) add('fecha >= ?::date', String(p.desde).slice(0, 10));
  if (p.hasta && /^\d{4}-\d{2}-\d{2}/.test(p.hasta)) add("fecha < (?::date + 1)", String(p.hasta).slice(0, 10));
  if (p.quien) add('usuario_nombre ILIKE ?', `%${String(p.quien).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (p.rol) add('usuario_rol = ?', String(p.rol));
  if (p.accion) add("accion LIKE ? ESCAPE '\\'", `${String(p.accion).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (p.resultado) add('resultado = ?', String(p.resultado));
  if (p.antes && /^\d+$/.test(String(p.antes))) add('id < ?::bigint', String(p.antes));
  const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM actividad ${donde} ORDER BY id DESC LIMIT ${limite}`, params);
  return { ok: true, items: rows.map(aItem), siguiente: rows.length === limite ? String(rows[rows.length - 1].id) : null };
}

// Resume quién entró en los últimos 7, 30 o 90 días, cuántas veces, cuándo fue la última y qué operaciones hizo
// con éxito.
export async function resumenUso(usuario, { dias } = {}) {
  const regional = esRegional(usuario);
  if (!usuario?.superadmin && !regional) throw prohibido('Solo el administrador ve el uso.');
  const d = [7, 30, 90].includes(Number(dias)) ? Number(dias) : 30;
  const visibles = regional ? await subsVisibles(usuario) : null;
  const [ing, ops, cuentas] = await Promise.all([
    query(`SELECT origen, cuenta_id, max(usuario_texto) AS usuario, max(rol) AS rol, count(*)::int AS ingresos, max(fecha) AS ultimo
            FROM eventos_seguridad
           WHERE tipo = 'login_ok' AND exito AND cuenta_id IS NOT NULL AND fecha >= now() - make_interval(days => $1)
             AND ($2::text[] IS NULL OR (origen || ':' || cuenta_id) = ANY($2))
           GROUP BY origen, cuenta_id`, [d, visibles]),
    query(`SELECT usuario_sub, split_part(accion, '.', 1) AS modulo, count(*)::int AS n
            FROM actividad
           WHERE resultado = 'ok' AND usuario_sub IS NOT NULL AND fecha >= now() - make_interval(days => $1)
             AND NOT (cambios ? 'lote')
             AND ($2::text[] IS NULL OR usuario_sub = ANY($2))
           GROUP BY usuario_sub, split_part(accion, '.', 1)`, [d, visibles]),
    query(`SELECT (SELECT count(*) FROM superadmins WHERE activo) + (SELECT count(*) FROM coordinadores WHERE activo)
                 + (SELECT count(*) FROM gestores WHERE activo) + (SELECT count(*) FROM inventario.usuarios WHERE activo) AS total`),
  ]);
  const cuentasVisibles = regional ? (await cuentasGestionables(usuario)).filter((c) => c.activo).length : null;
  const porSub = new Map();
  for (const o of ops.rows) {
    const m = porSub.get(o.usuario_sub) || {};
    m[o.modulo] = o.n;
    porSub.set(o.usuario_sub, m);
  }
  const usuarios = ing.rows.map((r) => {
    const operaciones = porSub.get(`${r.origen}:${r.cuenta_id}`) || {};
    return {
      origen: r.origen, id: r.cuenta_id, usuario: r.usuario, rol: r.rol, ingresos: r.ingresos, ultimo_ingreso: r.ultimo,
      operaciones, total_operaciones: Object.values(operaciones).reduce((a, b) => a + b, 0),
    };
  }).sort((a, b) => new Date(b.ultimo_ingreso) - new Date(a.ultimo_ingreso));
  const total = cuentasVisibles ?? Number(cuentas.rows[0].total);
  return {
    ok: true, dias: d, usuarios,
    totales: {
      activos: usuarios.length, cuentas: total, sin_ingresar: Math.max(total - usuarios.length, 0),
      ingresos: usuarios.reduce((a, u) => a + u.ingresos, 0), operaciones: usuarios.reduce((a, u) => a + u.total_operaciones, 0),
    },
  };
}
