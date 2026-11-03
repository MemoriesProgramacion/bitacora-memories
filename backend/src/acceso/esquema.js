// Define y crea las tablas que comparten la Bitácora y el inventario: cuentas, sesiones y registros de acceso.
// Todo se crea solo si no existe, así que puede ejecutarse en cada arranque.
import { pool } from '../db.js';

const DDL = `
CREATE SCHEMA IF NOT EXISTS inventario;

-- Administradores generales: ven y gestionan todo, en los dos módulos.
CREATE TABLE IF NOT EXISTS superadmins (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario     TEXT NOT NULL UNIQUE,
    nombre      TEXT NOT NULL,
    correo      TEXT,
    clave_hash  TEXT NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones en el servidor. La cookie solo lleva un identificador al azar;
-- aquí se guarda su huella SHA-256, así una copia de la tabla no sirve para
-- suplantar a nadie. origen NULL = visitante que aún no inicia sesión.
CREATE TABLE IF NOT EXISTS sesiones_app (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_hash     TEXT NOT NULL UNIQUE,
    csrf        TEXT NOT NULL,
    origen      TEXT,
    cuenta_id   INTEGER,
    usuario_texto TEXT,
    rol         TEXT,
    perfil      JSONB,
    ip          TEXT,
    agente      TEXT,
    creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_uso  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sesiones_app_cuenta ON sesiones_app (origen, cuenta_id);
CREATE INDEX IF NOT EXISTS ix_sesiones_app_uso ON sesiones_app (ultimo_uso);

-- Fallos seguidos por nombre de usuario (exista o no, para no delatarlo).
CREATE TABLE IF NOT EXISTS intentos_login (
    usuario          TEXT PRIMARY KEY,
    fallos           INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta  TIMESTAMPTZ,
    ultimo           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Límites de peticiones por IP (o por la clave del limitador), en la base para que
-- sobrevivan a un reinicio y los compartan todas las instancias. Ventana fija.
CREATE TABLE IF NOT EXISTS limites_peticiones (
    clave     TEXT PRIMARY KEY,
    n         INTEGER NOT NULL DEFAULT 0,
    reinicia  TIMESTAMPTZ NOT NULL,
    avisado   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_limites_peticiones_reinicia ON limites_peticiones (reinicia);

-- Ingresos fallidos por IP (freno contra fuerza bruta repartida entre usuarios).
CREATE TABLE IF NOT EXISTS fallos_login_ip (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip     TEXT NOT NULL,
    fecha  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fallos_login_ip ON fallos_login_ip (ip, fecha);

-- Registro de ingresos y eventos de seguridad. Nunca guarda claves ni tokens.
CREATE TABLE IF NOT EXISTS eventos_seguridad (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
    tipo          TEXT NOT NULL,
    exito         BOOLEAN NOT NULL DEFAULT TRUE,
    origen        TEXT,
    cuenta_id     INTEGER,
    usuario_texto TEXT,
    rol           TEXT,
    ip            TEXT,
    agente        TEXT,
    detalle       TEXT
);
CREATE INDEX IF NOT EXISTS ix_eventos_seguridad_fecha ON eventos_seguridad (fecha DESC);
CREATE INDEX IF NOT EXISTS ix_eventos_seguridad_tipo ON eventos_seguridad (tipo, fecha DESC);

-- Quién asignó o cambió una clave y cuándo. La clave en sí nunca se guarda.
CREATE TABLE IF NOT EXISTS auditoria_claves (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen        TEXT NOT NULL,
    cuenta_id     INTEGER,
    usuario_texto TEXT,
    accion        TEXT NOT NULL,
    hecho_por     TEXT
);
CREATE INDEX IF NOT EXISTS ix_auditoria_claves_fecha ON auditoria_claves (fecha DESC);
`;

// Crea el esquema del inventario y las tablas compartidas si aún no existen.
export async function iniciarEsquemaCompartido() {
  await pool.query(DDL);
}
