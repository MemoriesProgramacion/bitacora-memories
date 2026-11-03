// Rutas de la consola de administración bajo /api/admin. Permiten listar y crear cuentas, editar sus datos y su
// territorio, cambiar claves, activar o desactivar usuarios, cerrar sesiones y consultar los registros de
// ingreso. Cada acción se limita a las cuentas que quien la pide puede administrar.
import { Router } from 'express';
import { ROLES_CON_TERRITORIO } from '../config.js';
import { pool, transaccion } from '../db.js';
import { ok, error, cuerpo, texto, validarLargos, aInt, ErrorNegocio } from '../inventario/util.js';
import { hashClave, validarClaveNueva } from './clave.js';
import {
  ORIGENES, ORIGEN_DE_ROL, ROLES_ORDEN, buscarPorUsuario, leerCuenta, listarOrigen, fijarClave, auditarClave,
} from './cuentas.js';
import {
  codigoDeDepartamento, departamentoValido, departamentosConSiguiente, siguienteNodo,
} from './departamentos.js';
import { soloAdministracion, cerrarSesionesDe, registrarEvento } from './sesiones.js';
import { enAlcance, normTexto } from '../alcance.js';
import {
  actorDe, esRegional, esLogistica, puedeAsignarRol, puedeGestionar, cuentasGestionables, claveDeCuenta,
} from './jerarquia.js';

const router = Router();
router.use(soloAdministracion);

// Acciones y tipos de cuenta que puede administrar el acceso de logística.
const PERMITIDAS_LOGISTICA = [
  ['GET', /^\/usuarios$/], ['POST', /^\/usuarios$/], ['POST', /^\/desbloquear$/], ['POST', /^\/usuarios\/[a-z]+\/\d+\/clave$/],
  ['POST', /^\/usuarios\/inventario\/\d+\/bodega$/],
];
router.use((req, res, next) => {
  if (!esLogistica(actorDe(req.sesion.cuenta))) return next();
  if (PERMITIDAS_LOGISTICA.some(([m, r]) => m === req.method && r.test(req.path))) return next();
  return error(res, 'No tienes permiso para esta acción.', 403);
});

// Obtiene quién hace la petición a partir de su sesión.
const actorDeReq = (req) => actorDe(req.sesion.cuenta);

const USUARIO_VALIDO = /^[a-z0-9._-]{3,40}$/;
const CEDULA_VALIDA = /^\d{5,20}$/;
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valor que representa un territorio sin restricciones.
const TERRITORIO_VACIO = { region: null, departamento: null, modalidad: null, nodo: null };

// Extrae región, departamento, modalidad y nodo de un cuerpo de petición.
function territorioDe(rol, c) {
  if (!ROLES_CON_TERRITORIO.includes(rol)) return TERRITORIO_VACIO;
  if (rol === 'tallerista') {
    if (!texto(c.region)) throw new ErrorNegocio('Asigna una región al Tallerista.', 400, { campo: 'region' });
    return { ...TERRITORIO_VACIO, region: texto(c.region) };
  }
  const departamento = c.departamento ? departamentoValido(c.departamento) : null;
  if (c.departamento && !departamento) throw new ErrorNegocio('Elige un departamento de la lista.');
  const t = {
    region: c.region || null,
    departamento,
    modalidad: c.modalidad || null,
    nodo: c.nodo ? String(c.nodo).trim().toUpperCase() : null,
  };
  if (!Object.values(t).some(Boolean)) {
    throw new ErrorNegocio('Este rol necesita al menos una región, un departamento, una modalidad o un nodo.');
  }
  return t;
}

// Número fijo del candado que serializa altas y cambios para que dos cuentas creadas a la vez no repitan
// consecutivo.
const CANDADO_CUENTAS = 7001;

// Tipos de evento que cuentan como inicio de sesión en el filtro del listado.
const EVENTOS_INGRESO = ['login_ok', 'login_fallo', 'logout', 'usuario_bloqueado',
  'login_usuario_bloqueado', 'login_bloqueado_ip'];

// Valida los parámetros de la ruta y devuelve la cuenta indicada.
async function cuentaDeRuta(req, res) {
  const { origen } = req.params;
  const id = aInt(req.params.id);
  if (!ORIGENES.includes(origen) || id === null) {
    error(res, 'Recurso no encontrado.', 404);
    return null;
  }
  const cuenta = await leerCuenta(origen, id);
  if (!cuenta || !puedeGestionar(actorDeReq(req), cuenta)) {
    error(res, 'El usuario no existe.', 404);
    return null;
  }
  return cuenta;
}

// Indica si la cuenta es la de quien actúa, para impedir que se desactive o se degrade a sí misma.
const esMismaCuenta = (req, c) => req.sesion.cuenta.origen === c.origen && req.sesion.cuenta.id === c.id;

// Resumen de la consola: total y activos por tipo de cuenta, sesiones abiertas, fallos de ingreso de las
// últimas 24 horas y usuarios bloqueados.
router.get('/resumen', async (req, res) => {
  if (!actorDeReq(req).superadmin) return error(res, 'No tienes permiso para esta sección.', 403);
  const [{ rows: usuarios }, { rows: [sesiones] }, { rows: [fallos] }, { rows: [bloq] }] = await Promise.all([
    pool.query(`SELECT 'superadmin' AS rol, count(*)::int AS total, count(*) FILTER (WHERE activo)::int AS activos FROM superadmins
                UNION ALL SELECT tipo, count(*)::int, count(*) FILTER (WHERE activo)::int FROM coordinadores GROUP BY tipo
                UNION ALL SELECT 'gestor', count(*)::int, count(*) FILTER (WHERE activo)::int FROM gestores
                UNION ALL SELECT rol, count(*)::int, count(*) FILTER (WHERE activo)::int FROM inventario.usuarios GROUP BY rol`),
    pool.query('SELECT count(*)::int AS n FROM sesiones_app WHERE origen IS NOT NULL'),
    pool.query(`SELECT count(*)::int AS n FROM eventos_seguridad
                 WHERE exito = FALSE AND fecha > now() - interval '24 hours'`),
    pool.query('SELECT count(*)::int AS n FROM intentos_login WHERE bloqueado_hasta > now()'),
  ]);
  ok(res, null, {
    usuarios: Object.fromEntries(usuarios.map((u) => [u.rol, { total: u.total, activos: u.activos }])),
    sesiones_activas: sesiones.n,
    fallos_24h: fallos.n,
    bloqueados: bloq.n,
  });
});

// Lista las regiones, modalidades y nodos que existen en los datos para ofrecerlos al asignar territorio.
async function territorioDisponible(actor) {
  const [regiones, modalidades, nodos, combinaciones] = await Promise.all([
    pool.query(`SELECT DISTINCT btrim(region) AS v FROM triadas
                 WHERE btrim(region) <> '' AND region <> 'Por asignar' ORDER BY 1`),
    pool.query(`SELECT DISTINCT btrim(modalidad) AS v FROM unidades_productivas
                 WHERE modalidad IS NOT NULL AND btrim(modalidad) <> '' ORDER BY 1`),
    pool.query(`SELECT DISTINCT upper(btrim(nodo)) AS v FROM triadas WHERE btrim(nodo) <> '' ORDER BY 1`),
    pool.query(`SELECT DISTINCT nullif(btrim(t.region), '') AS region, nullif(btrim(up.departamento), '') AS departamento,
                       nullif(btrim(up.modalidad), '') AS modalidad, upper(btrim(t.nodo)) AS nodo
                  FROM triadas t LEFT JOIN unidades_productivas up ON up.id_triada = t.id_triada
                 WHERE btrim(t.nodo) <> '' AND t.region <> 'Por asignar'
                 ORDER BY 1, 2, 3, 4`),
  ]);
  if (esRegional(actor)) {
    const dentro = combinaciones.rows.filter((c) => enAlcance(actor, c));
    const unicos = (campo) => [...new Set(dentro.map((c) => c[campo]).filter(Boolean))].sort();
    return { combinaciones: dentro, regiones: unicos('region'), modalidades: unicos('modalidad'), nodos: unicos('nodo') };
  }
  return {
    combinaciones: combinaciones.rows,
    regiones: regiones.rows.map((r) => r.v),
    modalidades: modalidades.rows.map((r) => r.v),
    nodos: nodos.rows.map((r) => r.v),
  };
}

// Ajusta el territorio de una cuenta nueva al de quien la crea y comprueba que el resto exista.
async function acotarTerritorio(actor, rol, datos) {
  if (!esRegional(actor)) return datos;
  const a = actor.alcance;
  const salida = { ...datos };
  if (rol === 'tallerista') {
    if (!a.region || a.departamento || a.modalidad || a.nodo) throw new ErrorNegocio('Solo puedes asignar un Tallerista si administras una región completa.', 403);
    if (salida.region && normTexto(salida.region) !== normTexto(a.region)) throw new ErrorNegocio('Esa región queda fuera de tu territorio.', 403);
    salida.region = a.region;
  } else if (rol === 'tecnico_administrativo') {
    for (const k of ['region', 'departamento', 'modalidad', 'nodo']) if (a[k]) salida[k] = a[k];
    const t = { region: salida.region, departamento: salida.departamento, modalidad: salida.modalidad, nodo: salida.nodo };
    const { combinaciones } = await territorioDisponible(actor);
    const existe = combinaciones.some((c) => Object.entries(t).every(([k, v]) => !v || normTexto(c[k]) === normTexto(v)));
    if (!existe) throw new ErrorNegocio('Ese territorio queda fuera del tuyo.', 403);
  } else if (rol === 'gestor') {
    if (a.nodo) throw new ErrorNegocio('Tu territorio es un solo nodo: no puedes crear gestores nuevos.', 403);
    if (a.region) salida.region = a.region;
    if (a.departamento) salida.departamento = a.departamento;
    if (salida.departamento) {
      const { combinaciones } = await territorioDisponible(actor);
      if (!combinaciones.some((c) => normTexto(c.departamento) === normTexto(salida.departamento))) {
        throw new ErrorNegocio('Ese departamento queda fuera de tu territorio.', 403);
      }
    }
  }
  return salida;
}

// Devuelve las claves origen:id de las cuentas que quien actúa puede ver, o null si puede ver todas.
async function clavesVisibles(req) {
  const actor = actorDeReq(req);
  if (actor.superadmin) return null;
  return (await cuentasGestionables(actor, req.sesion.cuenta)).map(claveDeCuenta);
}

// Lista las cuentas visibles con su último ingreso, sesiones abiertas y estado de bloqueo.
router.get('/usuarios', async (req, res) => {
  const actor = actorDeReq(req);
  const [listas, ultimos, sesiones, bloqueos, departamentos, territorio] = await Promise.all([
    Promise.all(ORIGENES.map(listarOrigen)),
    pool.query(`SELECT origen, cuenta_id, max(fecha) AS fecha FROM eventos_seguridad
                 WHERE tipo = 'login_ok' AND cuenta_id IS NOT NULL GROUP BY 1, 2`),
    pool.query(`SELECT origen, cuenta_id, count(*)::int AS n FROM sesiones_app
                 WHERE origen IS NOT NULL GROUP BY 1, 2`),
    pool.query('SELECT usuario FROM intentos_login WHERE bloqueado_hasta > now()'),
    departamentosConSiguiente(pool),
    territorioDisponible(actorDeReq(req)),
  ]);
  const ultimoDe = new Map(ultimos.rows.map((r) => [`${r.origen}:${r.cuenta_id}`, r.fecha]));
  const sesionesDe = new Map(sesiones.rows.map((r) => [`${r.origen}:${r.cuenta_id}`, r.n]));
  const bloqueados = new Set(bloqueos.rows.map((r) => r.usuario));
  const { rows: bodegas } = await pool.query("SELECT id, nombre FROM inventario.bodegas WHERE activa AND tipo = 'municipal' ORDER BY nombre");

  const usuarios = listas.flat().filter((c) => puedeGestionar(actor, c)).map((c) => {
    const k = `${c.origen}:${c.id}`;
    const porDefecto = c.origen === 'gestor' && !c.claveHash;
    return {
      clave_id: k,
      origen: c.origen,
      id: c.id,
      usuario: c.usuario,
      nombre: c.nombre,
      rol: c.rol,
      correo: c.correo,
      cedula: c.cedula,
      nodo: c.nodo,
      departamento: c.departamento,
      telefono: c.telefono,
      bodega_id: c.bodega_id,
      bodega_nombre: bodegas.find((b) => b.id === c.bodega_id)?.nombre || null,
      region: c.region,
      modalidad: c.modalidad,
      triada: c.triada,
      activo: c.activo,
      clave_estado: porDefecto ? 'cedula' : 'cifrada',
      clave_visible: porDefecto ? c.cedula : null,
      cambiar_clave: c.cambiarClave,
      bloqueado: bloqueados.has(String(c.usuario).toLowerCase()),
      ultimo_acceso: ultimoDe.get(k) || null,
      sesiones: sesionesDe.get(k) || 0,
    };
  });
  usuarios.sort((a, b) => ROLES_ORDEN.indexOf(a.rol) - ROLES_ORDEN.indexOf(b.rol)
    || String(a.usuario).localeCompare(String(b.usuario)));
  const deptosVisibles = esRegional(actor)
    ? departamentos.filter((d) => territorio.combinaciones.some((c) => normTexto(c.departamento) === normTexto(d.nombre)))
    : departamentos;
  ok(res, null, {
    usuarios,
    bodegas,
    roles: ROLES_ORDEN.filter((rol) => puedeAsignarRol(actor, rol)).map((rol) => ({ rol, origen: ORIGEN_DE_ROL[rol] })),
    departamentos: esLogistica(actor) ? [] : deptosVisibles,
    territorio: esLogistica(actor) ? { combinaciones: [], regiones: [], modalidades: [], nodos: [] } : territorio,
  });
});

// Ejecuta un trabajo dentro de una transacción con el candado de cuentas tomado.
const enTransaccion = (trabajo) => transaccion(async (db) => {
  await db.query('SELECT pg_advisory_xact_lock($1)', [CANDADO_CUENTAS]);
  return trabajo(db);
});

// Verifica que el correo no esté ya en otra cuenta, sin distinguir mayúsculas.
async function validarCorreo(db, correo, propia = null) {
  if (!correo) return;
  if (!CORREO_VALIDO.test(correo)) {
    throw new ErrorNegocio('Por favor ingrese un correo válido, por ejemplo nombre@dominio.co.', 400, { campo: 'correo' });
  }
  const { rows } = await db.query(
    `SELECT origen, id FROM (
       SELECT 'superadmin' AS origen, id, correo FROM superadmins
       UNION ALL SELECT 'coordinador', id_coordinador, correo FROM coordinadores
       UNION ALL SELECT 'gestor', id_gestor, correo FROM gestores
     ) c WHERE lower(trim(c.correo)) = lower(trim($1))`,
    [correo],
  );
  if (rows.some((x) => !(propia && x.origen === propia.origen && x.id === propia.id))) {
    throw new ErrorNegocio('Este correo ya está registrado en otro usuario. Por favor ingrese uno diferente.', 409,
      { campo: 'correo' });
  }
}

const BORRAR = {
  superadmin: 'DELETE FROM superadmins WHERE id = $1',
  coordinador: 'DELETE FROM coordinadores WHERE id_coordinador = $1',
  inventario: 'DELETE FROM inventario.usuarios WHERE id = $1',
  gestor: 'DELETE FROM gestores WHERE id_gestor = $1',
};

// Comprueba que el valor sea el id de una bodega municipal activa y lo devuelve.
async function validarBodegaMunicipal(db, valor) {
  if (!/^\d{1,9}$/.test(String(valor || ''))) throw new ErrorNegocio('Asigna una bodega municipal al profesional de logística y compra.', 400, { campo: 'bodega_id' });
  const { rows: [b] } = await db.query("SELECT id FROM inventario.bodegas WHERE id = $1 AND activa AND tipo = 'municipal'", [valor]);
  if (!b) throw new ErrorNegocio('Elige una bodega municipal activa.', 400, { campo: 'bodega_id' });
  return b.id;
}

async function validarRegionTallerista(db, rol, region) {
  if (rol !== 'tallerista') return;
  const { rows } = await db.query("SELECT 1 FROM triadas WHERE upper(translate(btrim(region), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = $1 AND region <> 'Por asignar' LIMIT 1", [normTexto(region)]);
  if (!rows.length) throw new ErrorNegocio('Elige una región existente para el Tallerista.', 400, { campo: 'region' });
}

// Crea la cuenta en la tabla que le corresponde según su tipo.
async function insertarCuenta(db, c, propia = null) {
  const origen = ORIGEN_DE_ROL[c.rol];
  let usuario = c.usuario;
  const t = origen === 'coordinador' ? territorioDe(c.rol, c) : TERRITORIO_VACIO;
  await validarRegionTallerista(db, c.rol, t.region);

  if (origen === 'gestor') {
    const departamento = departamentoValido(c.departamento);
    if (!departamento) throw new ErrorNegocio('Elige el departamento del gestor.');
    if (!c.cedula) throw new ErrorNegocio('La cédula es obligatoria: es la clave inicial del gestor.');
    if (!CEDULA_VALIDA.test(c.cedula)) throw new ErrorNegocio('La cédula debe llevar solo números (de 5 a 20).');
    const { rowCount } = await db.query('SELECT 1 FROM gestores WHERE cedula = $1', [c.cedula]);
    if (rowCount) throw new ErrorNegocio('Ya hay un gestor con esa cédula.', 409);
    usuario = await siguienteNodo(db, departamento);
    c = { ...c, departamento };
  } else if (!USUARIO_VALIDO.test(usuario || '')) {
    throw new ErrorNegocio('El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.');
  }

  const repetidas = (await buscarPorUsuario(usuario))
    .filter((x) => !(propia && x.origen === propia.origen && x.id === propia.id));
  if (repetidas.length) throw new ErrorNegocio(`Ya existe un usuario con el nombre de acceso '${usuario}'.`, 409);
  if (origen !== 'inventario') await validarCorreo(db, c.correo, propia);

  let id;
  if (origen === 'superadmin') {
    ({ rows: [{ id }] } = await db.query(
      'INSERT INTO superadmins (usuario, nombre, correo, clave_hash, activo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [usuario, c.nombre, c.correo, c.claveHash, c.activo],
    ));
  } else if (origen === 'coordinador') {
    ({ rows: [{ id }] } = await db.query(
      `INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, correo, activo,
                                  region, departamento, modalidad, nodo)
       VALUES ('LOCAL-' || $2::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id_coordinador AS id`,
      [c.rol, usuario, c.claveHash, c.nombre, c.cedula, c.correo, c.activo,
        t.region, t.departamento, t.modalidad, t.nodo],
    ));
  } else if (origen === 'inventario') {
    const bodegaId = await validarBodegaMunicipal(db, c.bodega_id);
    ({ rows: [{ id }] } = await db.query(
      `INSERT INTO inventario.usuarios (usuario, nombre, clave_hash, rol, cambiar_clave, activo, bodega_id)
       VALUES ($1, $2, $3, $4, FALSE, $5, $6) RETURNING id`,
      [usuario, c.nombre, c.claveHash, c.rol, c.activo, bodegaId],
    ));
  } else {
    const { rows: [vecino] } = await db.query(
      `SELECT region, triada FROM triadas WHERE upper(nodo) ~ ('^' || $1 || '[0-9]+$')
        ORDER BY id_triada DESC LIMIT 1`,
      [codigoDeDepartamento(c.departamento)],
    );
    const { rows: [t] } = await db.query(
      'INSERT INTO triadas (nodo, region, triada) VALUES ($1, $2, $3) RETURNING id_triada',
      [usuario, c.region || vecino?.region || 'Por asignar', c.triada || vecino?.triada || 'Por asignar'],
    );
    ({ rows: [{ id }] } = await db.query(
      `INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo, telefono, clave_hash, activo)
       VALUES ('LOCAL-' || $1::text, $2, $3, $4, $5, $6, $7, $8) RETURNING id_gestor AS id`,
      [usuario, t.id_triada, c.cedula, c.nombre, c.correo, c.telefono, c.claveHash, c.activo],
    ));
  }
  return { origen, id, usuario };
}

// Crea una cuenta nueva validando sus datos, su territorio y la unicidad del usuario y del correo.
router.post('/usuarios', async (req, res) => {
  let datos = cuerpo(req);
  const actor = actorDeReq(req);
  const largo = validarLargos(datos, {
    usuario: 40, nombre: 120, correo: 150, cedula: 20, telefono: 30, region: 100, triada: 100,
    modalidad: 100, nodo: 100,
  });
  if (largo) return error(res, largo);

  const rol = texto(datos.rol);
  const origen = ORIGEN_DE_ROL[rol];
  if (!origen) return error(res, 'Elige un rol.');
  if (!puedeAsignarRol(actor, rol)) return error(res, 'No puedes crear usuarios con ese rol.', 403);
  try {
    datos = await acotarTerritorio(actor, rol, datos);
  } catch (e) {
    if (e instanceof ErrorNegocio) return error(res, e.message, e.codigo, e.datos);
    throw e;
  }
  const nombre = texto(datos.nombre);
  if (!nombre) return error(res, 'El nombre es obligatorio.');
  const clave = typeof datos.clave === 'string' ? datos.clave : '';

  const cuenta = {
    rol,
    usuario: texto(datos.usuario).toLowerCase(),
    nombre,
    correo: texto(datos.correo) || null,
    cedula: texto(datos.cedula) || null,
    telefono: texto(datos.telefono) || null,
    bodega_id: datos.bodega_id,
    departamento: texto(datos.departamento),
    region: texto(datos.region) || null,
    modalidad: texto(datos.modalidad) || null,
    nodo: texto(datos.nodo) || null,
    triada: texto(datos.triada) || null,
    activo: true,
    claveHash: null,
  };

  if (clave || origen !== 'gestor') {
    const motivo = validarClaveNueva(clave, { usuario: cuenta.usuario });
    if (motivo) return error(res, motivo);
    cuenta.claveHash = await hashClave(clave);
  }

  let nueva;
  try {
    nueva = await enTransaccion((db) => insertarCuenta(db, cuenta));
  } catch (e) {
    if (e instanceof ErrorNegocio) return error(res, e.message, e.codigo, e.datos);
    throw e;
  }
  await auditarClave({ ...nueva }, clave ? 'creacion' : 'creacion_cedula', req.sesion.cuenta.usuario);
  registrarEvento(req, 'admin_usuario_creado', { detalle: `${nueva.usuario} (${rol})` });
  ok(res, `Usuario '${nueva.usuario}' creado.`, { id: nueva.id, usuario: nueva.usuario });
});

// Mueve una cuenta a otra tabla cuando cambia de tipo, conservando clave y estado.
async function trasladar(req, cuenta, rol, datos) {
  const origenNuevo = ORIGEN_DE_ROL[rol];
  const claveNueva = typeof datos.clave === 'string' ? datos.clave : '';

  const usuario = origenNuevo === 'gestor' ? null : (texto(datos.usuario) || cuenta.usuario).toLowerCase();

  let claveHash = cuenta.claveHash;
  if (claveNueva) {
    const motivo = validarClaveNueva(claveNueva, { usuario: usuario || cuenta.usuario });
    if (motivo) throw new ErrorNegocio(motivo);
    claveHash = await hashClave(claveNueva);
  }
  if (!claveHash && origenNuevo !== 'gestor') {
    throw new ErrorNegocio('Esta persona entra con su cédula como clave. Para darle ese rol escribe una clave nueva.');
  }

  const nueva = await enTransaccion(async (db) => {
    if (cuenta.origen === 'superadmin' && cuenta.activo) {
      const { rows: [{ n }] } = await db.query(
        'SELECT count(*)::int AS n FROM superadmins WHERE activo AND id <> $1', [cuenta.id],
      );
      if (n === 0) throw new ErrorNegocio('No puedes quitarle el rol al último superadmin activo.');
    }
    await db.query(BORRAR[cuenta.origen], [cuenta.id]);
    const creada = await insertarCuenta(db, {
      rol,
      usuario,
      nombre: datos.nombre,
      correo: datos.correo,
      cedula: datos.cedula,
      telefono: texto(datos.telefono) || cuenta.telefono || null,
      bodega_id: datos.bodega_id,
      departamento: texto(datos.departamento),
      region: texto(datos.region) || null,
      modalidad: texto(datos.modalidad) || null,
      nodo: texto(datos.nodo) || null,
      triada: texto(datos.triada) || null,
      activo: cuenta.activo,
      claveHash,
    }, cuenta);
    for (const tabla of ['eventos_seguridad', 'auditoria_claves']) {
      await db.query(
        `UPDATE ${tabla} SET origen = $1, cuenta_id = $2 WHERE origen = $3 AND cuenta_id = $4`,
        [creada.origen, creada.id, cuenta.origen, cuenta.id],
      );
    }
    return creada;
  });

  await cerrarSesionesDe(cuenta.origen, cuenta.id);
  await pool.query('DELETE FROM intentos_login WHERE usuario = ANY($1)',
    [[String(cuenta.usuario).toLowerCase(), nueva.usuario.toLowerCase()]]);
  if (claveNueva) await auditarClave(nueva, 'cambio_admin', req.sesion.cuenta.usuario);
  registrarEvento(req, 'admin_rol_cambiado', {
    detalle: `${cuenta.usuario} (${cuenta.rol}) -> ${nueva.usuario} (${rol})`,
  });
  return nueva;
}

router.post('/usuarios/:origen/:id/bodega', async (req, res) => {
  const cuenta = await cuentaDeRuta(req, res);
  if (!cuenta) return;
  if (cuenta.origen !== 'inventario') return error(res, 'Esta cuenta no es de un profesional de logística y compra.', 400);
  const bodegaId = await validarBodegaMunicipal(pool, cuerpo(req).bodega_id);
  await pool.query('UPDATE inventario.usuarios SET bodega_id = $1 WHERE id = $2', [bodegaId, cuenta.id]);
  await cerrarSesionesDe(cuenta.origen, cuenta.id);
  registrarEvento(req, 'admin_bodega_asignada', { detalle: `${cuenta.usuario}: bodega ${bodegaId}` });
  ok(res, 'Bodega municipal asignada. Debe volver a iniciar sesión.');
});

// Edita nombre, correo, cédula, tipo de cuenta y territorio.
router.post('/usuarios/:origen/:id/editar', async (req, res) => {
  const cuenta = await cuentaDeRuta(req, res);
  if (!cuenta) return;
  let datos = cuerpo(req);
  const actor = actorDeReq(req);
  const largo = validarLargos(datos, {
    usuario: 40, nombre: 120, correo: 150, cedula: 20, telefono: 30, region: 100, triada: 100,
    modalidad: 100, nodo: 100,
  });
  if (largo) return error(res, largo);

  const rol = texto(datos.rol) || cuenta.rol;
  if (!ORIGEN_DE_ROL[rol]) return error(res, 'Elige un rol válido.');
  const cambiaRol = rol !== cuenta.rol;
  if (cambiaRol && esMismaCuenta(req, cuenta)) return error(res, 'No puedes cambiar tu propio rol.');
  if (!puedeAsignarRol(actor, rol)) return error(res, 'No puedes asignar ese rol.', 403);
  try {
    datos = await acotarTerritorio(actor, rol, datos);
  } catch (e) {
    if (e instanceof ErrorNegocio) return error(res, e.message, e.codigo, e.datos);
    throw e;
  }

  const nombre = texto(datos.nombre) || cuenta.nombre;
  const correo = datos.correo === undefined ? (cuenta.correo || null) : (texto(datos.correo) || null);
  const cedula = datos.cedula === undefined ? (cuenta.cedula || null) : (texto(datos.cedula) || null);
  let cambiaTerritorio = false;

  try {
    if (ORIGEN_DE_ROL[rol] !== cuenta.origen) {
      const nueva = await trasladar(req, cuenta, rol, { ...datos, nombre, correo, cedula });
      return ok(res, `Rol cambiado. Ahora entra con el usuario '${nueva.usuario}' y solo ve lo de su rol nuevo.`,
        { usuario: nueva.usuario });
    }

    const correoCambio = (correo || '').trim().toLowerCase() !== (cuenta.correo || '').trim().toLowerCase();
    if (cuenta.origen !== 'inventario' && correoCambio) await validarCorreo(pool, correo, cuenta);

    if (cuenta.origen === 'superadmin') {
      await pool.query('UPDATE superadmins SET nombre = $1, correo = $2 WHERE id = $3', [nombre, correo, cuenta.id]);
    } else if (cuenta.origen === 'coordinador') {
      const pedido = (campo) => (datos[campo] === undefined ? (cuenta[campo] || null) : (texto(datos[campo]) || null));
      const t = territorioDe(rol, {
        region: pedido('region'), departamento: pedido('departamento'),
        modalidad: pedido('modalidad'), nodo: pedido('nodo'),
      });
      await validarRegionTallerista(pool, rol, t.region);
      cambiaTerritorio = ['region', 'departamento', 'modalidad', 'nodo']
        .some((k) => (t[k] || '') !== (cuenta[k] || ''));
      await pool.query(
        `UPDATE coordinadores SET nombre = $1, correo = $2, cedula = $3, tipo = $4,
                region = $6, departamento = $7, modalidad = $8, nodo = $9,
                fecha_actualizacion = now() WHERE id_coordinador = $5`,
        [nombre, correo, cedula, rol, cuenta.id, t.region, t.departamento, t.modalidad, t.nodo],
      );
    } else if (cuenta.origen === 'inventario') {
      const bodegaId = datos.bodega_id === undefined ? cuenta.bodega_id : await validarBodegaMunicipal(pool, datos.bodega_id);
      cambiaTerritorio = bodegaId !== cuenta.bodega_id;
      await pool.query('UPDATE inventario.usuarios SET nombre = $1, rol = $2, bodega_id = $4 WHERE id = $3', [nombre, rol, cuenta.id, bodegaId]);
    } else {
      if (!cedula || !CEDULA_VALIDA.test(cedula)) throw new ErrorNegocio('La cédula debe llevar solo números (de 5 a 20).');
      const { rowCount } = await pool.query(
        'SELECT 1 FROM gestores WHERE cedula = $1 AND id_gestor <> $2', [cedula, cuenta.id],
      );
      if (rowCount) throw new ErrorNegocio('Ya hay un gestor con esa cédula.', 409);
      const telefono = datos.telefono === undefined ? (cuenta.telefono || null) : (texto(datos.telefono) || null);
      await pool.query(
        `UPDATE gestores SET nombre = $1, correo = $2, cedula = $3, telefono = $4,
                fecha_actualizacion = now() WHERE id_gestor = $5`,
        [nombre, correo, cedula, telefono, cuenta.id],
      );
      if (cedula !== cuenta.cedula && !cuenta.claveHash) await cerrarSesionesDe(cuenta.origen, cuenta.id);
    }
  } catch (e) {
    if (e instanceof ErrorNegocio) return error(res, e.message, e.codigo, e.datos);
    throw e;
  }
  if (cambiaRol || cambiaTerritorio) await cerrarSesionesDe(cuenta.origen, cuenta.id);
  registrarEvento(req, 'admin_usuario_editado', {
    detalle: `${cuenta.usuario}${cambiaRol ? `: rol ${cuenta.rol} -> ${rol}` : ''}${cambiaTerritorio ? ': territorio' : ''}`,
  });
  return ok(res, 'Usuario actualizado.');
});

// Asigna una clave nueva o devuelve la cuenta a su clave por defecto.
router.post('/usuarios/:origen/:id/clave', async (req, res) => {
  const cuenta = await cuentaDeRuta(req, res);
  if (!cuenta) return;
  const datos = cuerpo(req);
  const quien = req.sesion.cuenta.usuario;

  if (datos.restablecer === true) {
    if (cuenta.origen !== 'gestor') return error(res, 'Solo los gestores tienen una clave por defecto.');
    if (!cuenta.cedula) return error(res, 'Ese gestor no tiene cédula registrada.');
    await fijarClave('gestor', cuenta.id, null);
    await auditarClave(cuenta, 'restablecer_cedula', quien);
    await cerrarSesionesDe(cuenta.origen, cuenta.id);
    registrarEvento(req, 'admin_clave_restablecida', { detalle: `${cuenta.usuario} (clave = cédula)` });
    return ok(res, 'La clave volvió a ser la cédula del gestor.');
  }

  const clave = typeof datos.clave === 'string' ? datos.clave : '';
  const motivo = validarClaveNueva(clave, { usuario: cuenta.usuario });
  if (motivo) return error(res, motivo);

  await fijarClave(cuenta.origen, cuenta.id, await hashClave(clave));
  await auditarClave(cuenta, 'cambio_admin', quien);
  await cerrarSesionesDe(cuenta.origen, cuenta.id, esMismaCuenta(req, cuenta) ? req.sesion.hash : null);
  await pool.query('DELETE FROM intentos_login WHERE usuario = $1', [String(cuenta.usuario).toLowerCase()]);
  registrarEvento(req, 'admin_clave_asignada', { detalle: `a ${cuenta.usuario}` });
  ok(res, 'Clave actualizada.');
});

// Activa o desactiva la cuenta.
router.post('/usuarios/:origen/:id/estado', async (req, res) => {
  const cuenta = await cuentaDeRuta(req, res);
  if (!cuenta) return;
  if (esMismaCuenta(req, cuenta)) return error(res, 'No puedes desactivar tu propio usuario.');

  if (cuenta.origen === 'superadmin' && cuenta.activo) {
    const { rows: [{ n }] } = await pool.query(
      'SELECT count(*)::int AS n FROM superadmins WHERE activo AND id <> $1', [cuenta.id],
    );
    if (n === 0) return error(res, 'No puedes desactivar al último superadmin activo.');
  }

  const tabla = { superadmin: ['superadmins', 'id'], coordinador: ['coordinadores', 'id_coordinador'],
    inventario: ['inventario.usuarios', 'id'], gestor: ['gestores', 'id_gestor'] }[cuenta.origen];
  await pool.query(`UPDATE ${tabla[0]} SET activo = NOT activo WHERE ${tabla[1]} = $1`, [cuenta.id]);
  if (cuenta.activo) await cerrarSesionesDe(cuenta.origen, cuenta.id);
  registrarEvento(req, 'admin_usuario_estado', { detalle: `${cuenta.usuario}: ${cuenta.activo ? 'desactivado' : 'activado'}` });
  ok(res, 'Usuario actualizado.');
});

// Obliga a la cuenta a iniciar sesión de nuevo.
router.post('/usuarios/:origen/:id/cerrar-sesiones', async (req, res) => {
  const cuenta = await cuentaDeRuta(req, res);
  if (!cuenta) return;
  const n = await cerrarSesionesDe(cuenta.origen, cuenta.id, esMismaCuenta(req, cuenta) ? req.sesion.hash : null);
  registrarEvento(req, 'admin_sesiones_cerradas', { detalle: `${cuenta.usuario}: ${n}` });
  ok(res, n ? `Se cerraron ${n} sesión(es).` : 'No tenía sesiones abiertas.');
});

// Quita el bloqueo por intentos fallidos de un usuario.
router.post('/desbloquear', async (req, res) => {
  const usuario = texto(cuerpo(req).usuario).toLowerCase();
  if (!usuario) return error(res, 'Falta el usuario.');
  const actor = actorDeReq(req);
  if (!actor.superadmin) {
    const cuentas = await buscarPorUsuario(usuario);
    if (!cuentas.length || !cuentas.every((c) => puedeGestionar(actor, c))) return error(res, 'El usuario no existe.', 404);
  }
  await pool.query('DELETE FROM intentos_login WHERE usuario = $1', [usuario]);
  registrarEvento(req, 'admin_desbloqueo', { detalle: usuario });
  ok(res, 'Usuario desbloqueado.');
});

// Registro de eventos de seguridad con filtros por vista, resultado y tipo de cuenta, y paginación.
router.get('/accesos', async (req, res) => {
  const limite = Math.min(Math.max(aInt(req.query.limite, 100), 1), 500);
  const desplazar = Math.max(aInt(req.query.desde, 0), 0);
  const condiciones = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (req.query.vista === 'ingresos') condiciones.push(`tipo = ANY(${p(EVENTOS_INGRESO)})`);
  if (req.query.exito === 'si') condiciones.push('exito = TRUE');
  if (req.query.exito === 'no') condiciones.push('exito = FALSE');
  if (typeof req.query.rol === 'string' && ROLES_ORDEN.includes(req.query.rol)) {
    condiciones.push(`rol = ${p(req.query.rol)}`);
  }
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const q = `%${req.query.q.trim().slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const n = p(q);
    condiciones.push(`(usuario_texto ILIKE ${n} OR ip ILIKE ${n} OR tipo ILIKE ${n} OR detalle ILIKE ${n})`);
  }
  const visibles = await clavesVisibles(req);
  if (visibles) condiciones.push(`(origen || ':' || cuenta_id) = ANY(${p(visibles)})`);
  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows: eventos } = await pool.query(
    `SELECT id, fecha, tipo, exito, origen, usuario_texto, rol, ip, agente, detalle
       FROM eventos_seguridad ${donde}
      ORDER BY fecha DESC, id DESC LIMIT ${p(limite)} OFFSET ${p(desplazar)}`,
    params,
  );
  ok(res, null, { eventos, limite });
});

// Sesiones abiertas de las cuentas visibles, de la más reciente a la más antigua.
router.get('/sesiones', async (req, res) => {
  const visibles = await clavesVisibles(req);
  const { rows } = await pool.query(
    `SELECT id, usuario_texto AS usuario, origen, rol, ip, agente, creado, ultimo_uso,
            (id_hash = $1) AS actual
       FROM sesiones_app WHERE origen IS NOT NULL AND ($2::text[] IS NULL OR (origen || ':' || cuenta_id) = ANY($2))
      ORDER BY ultimo_uso DESC`,
    [req.sesion.hash, visibles],
  );
  ok(res, null, { sesiones: rows });
});

router.post('/sesiones/:id/cerrar', async (req, res) => {
  const id = aInt(req.params.id);
  if (id === null) return error(res, 'Recurso no encontrado.', 404);
  const visibles = await clavesVisibles(req);
  const { rows } = await pool.query(
    `DELETE FROM sesiones_app WHERE id = $1 AND id_hash <> $2
        AND ($3::text[] IS NULL OR (origen || ':' || cuenta_id) = ANY($3)) RETURNING usuario_texto`,
    [id, req.sesion.hash, visibles],
  );
  if (!rows.length) return error(res, 'La sesión no existe o es la tuya.', 404);
  registrarEvento(req, 'admin_sesion_cerrada', { detalle: rows[0].usuario_texto });
  return ok(res, 'Sesión cerrada.');
});

// Historial de cambios de clave de las cuentas visibles, con los últimos 200 registros.
router.get('/auditoria-claves', async (req, res) => {
  const visibles = await clavesVisibles(req);
  const { rows } = await pool.query(
    `SELECT id, fecha, origen, usuario_texto, accion, hecho_por FROM auditoria_claves
      WHERE $1::text[] IS NULL OR (origen || ':' || cuenta_id) = ANY($1)
      ORDER BY fecha DESC, id DESC LIMIT 200`,
    [visibles],
  );
  ok(res, null, { registro: rows });
});

export default router;
