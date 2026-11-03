// Unifica las cuatro tablas de cuentas (acceso total, coordinación, trabajo de campo e inventario) para
// consultarlas como una sola, con la misma forma de datos sin importar de dónde vengan. También guarda claves y
// deja constancia de sus cambios.
import { pool } from '../db.js';
import { igualesSeguro, verificarClave } from './clave.js';
import { departamentoDeNodo } from './departamentos.js';

export const ORIGENES = ['superadmin', 'coordinador', 'inventario', 'gestor'];

// Perfiles que puede tener cada tipo de cuenta.
export const ROLES_POR_ORIGEN = {
  superadmin: ['superadmin'],
  coordinador: ['coordinador', 'tecnico_administrativo', 'coordinador_compras', 'coordinador_datos', 'tallerista'],
  inventario: ['bodeguero'],
  gestor: ['gestor'],
};

// Tabla a la que pertenece cada perfil, en el orden en que se muestran.
export const ORIGEN_DE_ROL = {
  superadmin: 'superadmin',
  coordinador: 'coordinador',
  tecnico_administrativo: 'coordinador',
  tallerista: 'coordinador',
  coordinador_compras: 'coordinador',
  coordinador_datos: 'coordinador',
  bodeguero: 'inventario',
  gestor: 'gestor',
};
export const ROLES_ORDEN = Object.keys(ORIGEN_DE_ROL);

// Orden de preferencia cuando el mismo usuario y clave existen en más de una tabla.
const PRIORIDAD = ['superadmin', 'coordinador', 'inventario', 'gestor'];

const SQL = {
  superadmin: `SELECT id, usuario, nombre, correo, NULL::text AS cedula, 'superadmin' AS rol,
                      clave_hash, activo, FALSE AS cambiar_clave
                 FROM superadmins`,
  coordinador: `SELECT id_coordinador AS id, usuario, nombre, correo, cedula, tipo AS rol,
                       clave_hash, activo, FALSE AS cambiar_clave,
                       region, departamento, modalidad, nodo
                  FROM coordinadores`,
  inventario: `SELECT id, usuario, nombre, NULL::text AS correo, NULL::text AS cedula, rol,
                      clave_hash, activo, cambiar_clave, bodega_id
                 FROM inventario.usuarios`,
  gestor: `SELECT g.id_gestor AS id, t.nodo AS usuario, g.nombre, g.correo, g.cedula, 'gestor' AS rol,
                  g.clave_hash, g.activo, FALSE AS cambiar_clave,
                  g.telefono, t.nodo, t.region, t.triada
             FROM gestores g
             JOIN triadas t ON t.id_triada = g.id_triada`,
};

const FILTRO_ID = {
  superadmin: 'WHERE id = $1',
  coordinador: 'WHERE id_coordinador = $1',
  inventario: 'WHERE id = $1',
  gestor: 'WHERE g.id_gestor = $1',
};
const FILTRO_USUARIO = {
  superadmin: 'WHERE lower(usuario) = $1',
  coordinador: 'WHERE lower(usuario) = $1',
  inventario: 'WHERE lower(usuario) = $1',
  gestor: 'WHERE lower(t.nodo) = $1',
};

// Convierte una fila de cualquier tabla al formato común de cuenta.
function normalizar(origen, f) {
  return {
    origen,
    id: f.id,
    usuario: f.usuario,
    nombre: f.nombre || '',
    rol: f.rol,
    correo: f.correo || '',
    cedula: f.cedula || '',
    nodo: f.nodo || null,
    departamento: f.departamento || (origen === 'gestor' ? departamentoDeNodo(f.nodo) : null),
    modalidad: f.modalidad || '',
    triada: f.triada || '',
    region: f.region ?? '',
    telefono: f.telefono || '',
    bodega_id: f.bodega_id || null,
    activo: Boolean(f.activo) && (ROLES_POR_ORIGEN[origen] || []).includes(f.rol),
    claveHash: f.clave_hash,
    cambiarClave: Boolean(f.cambiar_clave),
  };
}

// Devuelve las cuentas cuyo usuario coincide, sin importar mayúsculas, en orden de prioridad.
export async function buscarPorUsuario(usuario) {
  const u = String(usuario).toLowerCase();
  const listas = await Promise.all(PRIORIDAD.map(async (origen) => {
    const { rows } = await pool.query(`${SQL[origen]} ${FILTRO_USUARIO[origen]}`, [u]);
    return rows.map((f) => normalizar(origen, f));
  }));
  return listas.flat();
}

// Busca una cuenta por tabla de origen e id.
export async function leerCuenta(origen, id) {
  if (!SQL[origen]) return null;
  const { rows } = await pool.query(`${SQL[origen]} ${FILTRO_ID[origen]}`, [id]);
  return rows.length ? normalizar(origen, rows[0]) : null;
}

// Lista todas las cuentas de una tabla de origen.
export async function listarOrigen(origen) {
  const { rows } = await pool.query(`${SQL[origen]} ORDER BY 2`);
  return rows.map((f) => normalizar(origen, f));
}

// Comprueba la clave de una cuenta; las cuentas de campo sin clave propia entran con su cédula.
export async function claveCorrecta(cuenta, clave) {
  if (cuenta.origen === 'gestor' && !cuenta.claveHash) {
    return Boolean(cuenta.cedula) && igualesSeguro(String(clave).trim(), cuenta.cedula);
  }
  return verificarClave(cuenta.claveHash, clave);
}

// Datos de la cuenta que se envían al navegador.
export function perfilDe(cuenta) {
  return {
    nombre: cuenta.nombre,
    nodo: cuenta.nodo,
    cedula: cuenta.cedula,
    triada: cuenta.triada,
    region: cuenta.region,
    departamento: cuenta.departamento,
    modalidad: cuenta.modalidad,
    correo: cuenta.correo,
    telefono: cuenta.telefono,
  };
}

// Cuenta en el formato que se guarda dentro de la sesión.
export function cuentaDeSesion(cuenta) {
  return {
    origen: cuenta.origen,
    id: cuenta.id,
    usuario: cuenta.usuario,
    rol: cuenta.rol,
    perfil: perfilDe(cuenta),
    cambiarClave: cuenta.cambiarClave,
  };
}

const UPDATE_CLAVE = {
  superadmin: 'UPDATE superadmins SET clave_hash = $1 WHERE id = $2',
  coordinador: 'UPDATE coordinadores SET clave_hash = $1, fecha_actualizacion = now() WHERE id_coordinador = $2',
  inventario: 'UPDATE inventario.usuarios SET clave_hash = $1, cambiar_clave = FALSE WHERE id = $2',
  gestor: 'UPDATE gestores SET clave_hash = $1, fecha_actualizacion = now() WHERE id_gestor = $2',
};

// Guarda una clave nueva; para una cuenta de campo, null lo devuelve a su clave por defecto.
export async function fijarClave(origen, id, hash, db = pool) {
  await db.query(UPDATE_CLAVE[origen], [hash, id]);
}

// Registra quién cambió una clave sin guardar la clave en sí.
export async function auditarClave(cuenta, accion, hechoPor, db = pool) {
  await db.query(
    `INSERT INTO auditoria_claves (origen, cuenta_id, usuario_texto, accion, hecho_por)
     VALUES ($1, $2, $3, $4, $5)`,
    [cuenta.origen, cuenta.id, cuenta.usuario, accion, hechoPor],
  );
}
