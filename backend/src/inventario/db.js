// Base de datos del inventario. Usa la misma base PostgreSQL de la Bitácora, pero con sus tablas en el esquema
// propio "inventario"; el pool fija el search_path para consultar sin prefijo. Ofrece consultas sueltas y
// transacciones.
import pg from 'pg';
import { config } from '../config.js';

// Códigos de error de PostgreSQL que se atrapan para dar un mensaje claro: violación de unicidad, de llave
// foránea y de restricción CHECK.
export const COD_UNICO = '23505';
export const COD_FK = '23503';
export const COD_CHECK = '23514';

// Pool de conexiones con el esquema del inventario primero en la ruta de búsqueda.
export const pool = new pg.Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {}),
  ...(config.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  options: '-c search_path=inventario,public',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (e) => console.error('[db] Error en una conexión inactiva (inventario):', e.message));

// Ejecuta una consulta y devuelve las filas.
export async function consulta(texto, params = []) {
  const r = await pool.query(texto, params);
  return r.rows;
}

// Ejecuta una consulta y devuelve solo la primera fila, o undefined.
export async function una(texto, params = []) {
  const r = await pool.query(texto, params);
  return r.rows[0];
}

// Ejecuta una función dentro de una transacción; hace ROLLBACK si falla y COMMIT si termina bien.
export async function conTransaccion(fn) {
  const cli = await pool.connect();
  cli.q = async (texto, params = []) => (await cli.query(texto, params)).rows;
  try {
    await cli.query('BEGIN');
    const resultado = await fn(cli);
    await cli.query('COMMIT');
    return resultado;
  } catch (e) {
    try {
      await cli.query('ROLLBACK');
    } catch {
    }
    throw e;
  } finally {
    cli.release();
  }
}

// Definición de las tablas del inventario, todas con IF NOT EXISTS para poder correrla en cada arranque.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS proveedores (
    id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre   TEXT NOT NULL,
    codigo   TEXT NOT NULL UNIQUE,
    creado   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articulos (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre           TEXT NOT NULL,
    codigo_proveedor TEXT,
    proveedor_id     INTEGER REFERENCES proveedores(id),
    codigo_barras    TEXT NOT NULL UNIQUE,
    precio           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
    stock            INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    minimo           INTEGER NOT NULL DEFAULT 0 CHECK (minimo >= 0),
    creado           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    articulo_id     INTEGER REFERENCES articulos(id),
    tipo            TEXT NOT NULL,
    cantidad        INTEGER NOT NULL,
    motivo          TEXT,
    referencia      TEXT,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    codigo_proveedor TEXT,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combos (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre        TEXT NOT NULL,
    codigo_barras TEXT NOT NULL UNIQUE,
    stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    armado        BOOLEAN NOT NULL DEFAULT FALSE,
    armado_en     TIMESTAMPTZ,
    creado        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combo_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    combo_id    INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0)
);

CREATE TABLE IF NOT EXISTS ordenes (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero        TEXT UNIQUE,
    destino       TEXT,
    observaciones TEXT,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado        TEXT NOT NULL DEFAULT 'generada'
);

CREATE TABLE IF NOT EXISTS orden_items (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    orden_id      INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
    tipo          TEXT,
    ref_id        INTEGER,
    nombre        TEXT,
    codigo_barras TEXT,
    cantidad      INTEGER NOT NULL
);

-- Usuarios del módulo de inventario. Entran por el mismo login de la
-- Bitácora; el superadmin los administra desde su consola.
CREATE TABLE IF NOT EXISTS usuarios (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario      TEXT NOT NULL UNIQUE,
    nombre       TEXT NOT NULL,
    clave_hash   TEXT NOT NULL,
    rol          TEXT NOT NULL CHECK (rol IN ('bodeguero')),
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE,
    creado       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lotes de órdenes de pedido. Cada lote se carga desde un Excel y agrupa
-- los items de varias unidades productivas (identificadas por num_documento).
CREATE TABLE IF NOT EXISTS lotes (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero       INTEGER NOT NULL UNIQUE,
    nombre       TEXT,
    archivo      TEXT,
    creado       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lote_items (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lote_id        INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
    num_documento  TEXT NOT NULL,
    codigo         TEXT,
    nombre         TEXT,
    tipo           TEXT,
    cantidad       INTEGER NOT NULL DEFAULT 0,
    precio         NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lote_items_lote  ON lote_items(lote_id);
CREATE INDEX IF NOT EXISTS idx_lote_items_doc   ON lote_items(lote_id, num_documento);
CREATE INDEX IF NOT EXISTS idx_lote_items_cod   ON lote_items(lote_id, codigo);

-- Contador atómico para numerar órdenes sin condiciones de carrera.
CREATE TABLE IF NOT EXISTS contadores (
    anio  INTEGER PRIMARY KEY,
    valor INTEGER NOT NULL DEFAULT 0
);

-- Borrado lógico: al "eliminar" un artículo se marca activo=FALSE en vez de
-- borrar la fila, para conservar su historial de movimientos (auditoría).
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
-- Clase UNSPSC del artículo (6 dígitos, del catálogo public.unspsc_clases; lo valida la ruta).
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS unspsc CHAR(6) NULL;
DO $$ BEGIN
  ALTER TABLE articulos DROP CONSTRAINT IF EXISTS ck_articulos_unspsc;
  ALTER TABLE articulos ADD CONSTRAINT ck_articulos_unspsc CHECK (unspsc IS NULL OR unspsc ~ '^[0-9]{6}$');
END $$;

CREATE INDEX IF NOT EXISTS idx_articulos_proveedor    ON articulos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_articulos_nombre       ON articulos(nombre);
CREATE INDEX IF NOT EXISTS idx_movimientos_articulo   ON movimientos(articulo_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha      ON movimientos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo      ON combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_articulo   ON combo_items(articulo_id);
CREATE INDEX IF NOT EXISTS idx_orden_items_orden      ON orden_items(orden_id);

-- Evidencias de transporte: registran el despacho de una orden de entrega
-- (vehículo, transportista, empresa, monto, fecha/hora). Una orden puede
-- tener varias evidencias (por ejemplo si se despacha en más de un vehículo).
CREATE TABLE IF NOT EXISTS evidencias_transporte (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    orden_id      INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
    placa         TEXT NOT NULL,
    transportista TEXT,
    empresa       TEXT,
    monto         NUMERIC(14,2) NOT NULL DEFAULT 0,
    observaciones TEXT,
    fecha_despacho TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidencias_orden ON evidencias_transporte(orden_id);

-- Datos completos del proveedor: documento (NIT o cédula), contacto, teléfono, correo y dirección. Los proveedores
-- anteriores quedan con estos datos vacíos hasta que se completen; los nuevos los exigen (ver inventario/proveedor.js).
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tipo_documento TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS numero_documento TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS contacto TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS correo TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS municipio TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS departamento TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_proveedores_documento ON proveedores (tipo_documento, numero_documento)
  WHERE numero_documento IS NOT NULL;

-- Región de la bodega: la ven los coordinadores y técnicos de esa región en los saldos por bodega.
-- (Se agrega con ALTER porque la tabla ya puede existir.)
-- Bodegas. Las principales guardan la mercancía que llega por factura; las municipales cuelgan de una
-- principal, se alimentan con traslados y se asignan a un Coordinador local regional (coordinador_sub =
-- "coordinador:<id>"), que solo consulta lo que hay en ellas. articulos.stock sigue siendo el total del
-- inventario; stock_bodega reparte la parte que ya está ubicada (lo demás está «sin ubicar»).
CREATE TABLE IF NOT EXISTS bodegas (
    id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre           TEXT NOT NULL,
    tipo             TEXT NOT NULL CHECK (tipo IN ('principal', 'municipal')),
    departamento     TEXT,
    municipio        TEXT,
    principal_id     INTEGER REFERENCES bodegas(id),
    coordinador_sub  TEXT,
    activa           BOOLEAN NOT NULL DEFAULT TRUE,
    creado           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((tipo = 'municipal') = (principal_id IS NOT NULL))
);
ALTER TABLE bodegas ADD COLUMN IF NOT EXISTS region TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bodegas_nombre ON bodegas (lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS idx_bodegas_coordinador ON bodegas (coordinador_sub);
-- Una sola bodega por bodeguero. Las cuentas anteriores requieren asignación antes de entregar.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bodega_id INTEGER REFERENCES bodegas(id);
-- Los kits ya armados con el flujo anterior habían descontado artículos. Se
-- conservan marcados para impedir que una entrega vuelva a descontarlos.
ALTER TABLE combos ADD COLUMN IF NOT EXISTS descontado_al_armar BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE combos ALTER COLUMN descontado_al_armar SET DEFAULT FALSE;
-- De qué bodega salió un movimiento que baja el inventario sin ser una entrega (kits, ajustes); NULL = de lo sin ubicar.
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS bodega_id INTEGER REFERENCES bodegas(id);

CREATE TABLE IF NOT EXISTS stock_bodega (
    bodega_id   INTEGER NOT NULL REFERENCES bodegas(id),
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    cantidad    INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    PRIMARY KEY (bodega_id, articulo_id)
);

-- Facturas de compra: cada línea dice a qué bodega principal va la mercancía. El PDF va en la misma fila.
CREATE TABLE IF NOT EXISTS facturas (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero          TEXT NOT NULL,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
    total           NUMERIC(16,2) NOT NULL DEFAULT 0,
    adjunto         BYTEA,
    adjunto_nombre  TEXT,
    creado_por      TEXT,
    creado          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS vencimiento DATE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_numero ON facturas (proveedor_id, lower(btrim(numero)));

CREATE TABLE IF NOT EXISTS factura_items (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factura_id      INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    bodega_id       INTEGER NOT NULL REFERENCES bodegas(id),
    articulo_id     INTEGER NOT NULL REFERENCES articulos(id),
    nombre          TEXT NOT NULL,
    descripcion     TEXT,
    sku             TEXT NOT NULL,
    cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
    valor_unitario  NUMERIC(14,2) NOT NULL CHECK (valor_unitario >= 0),
    valor_impuesto  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_impuesto >= 0),
    total           NUMERIC(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_factura_items_factura ON factura_items (factura_id);
-- E9: la factura de capitalización va a una unidad productiva (id_unico) con la declaración de bienes nuevos (ET3-17), y la
-- entrega del proveedor se sigue por lo recibido en bodega contra cada línea (FUN-PLC-04). Una factura registrada como
-- recibida (lo de siempre) tiene todo recibido; una «pendiente de entrega» suma al stock con cada recepción.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS id_unico TEXT NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS bienes_nuevos BOOLEAN NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS entrega_pendiente BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE factura_items ADD COLUMN IF NOT EXISTS recibido INTEGER NULL;
UPDATE factura_items SET recibido = cantidad WHERE recibido IS NULL;
CREATE INDEX IF NOT EXISTS idx_facturas_up ON facturas (id_unico) WHERE id_unico IS NOT NULL;
CREATE TABLE IF NOT EXISTS factura_recepciones (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    factura_id  INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES factura_items(id) ON DELETE CASCADE,
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
    recibido_por TEXT NULL,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factura_recepciones ON factura_recepciones (factura_id);

-- Traslados de inventario entre bodegas, con su nota.
CREATE TABLE IF NOT EXISTS traslados (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origen_id   INTEGER NOT NULL REFERENCES bodegas(id),
    destino_id  INTEGER NOT NULL REFERENCES bodegas(id),
    nota        TEXT NOT NULL,
    creado_por  TEXT,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (origen_id <> destino_id)
);
CREATE TABLE IF NOT EXISTS traslado_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    traslado_id INTEGER NOT NULL REFERENCES traslados(id) ON DELETE CASCADE,
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_traslado_items_traslado ON traslado_items (traslado_id);

-- Entregas a unidades productivas: la mercancía sale de una bodega hacia una U.P. (último paso del Kardex).
CREATE TABLE IF NOT EXISTS entregas_up (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bodega_id     INTEGER NOT NULL REFERENCES bodegas(id),
    id_unico      TEXT NOT NULL,
    unidad_nombre TEXT,
    nota          TEXT,
    creado_por    TEXT,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entregas_up_bodega ON entregas_up (bodega_id, fecha DESC);
CREATE TABLE IF NOT EXISTS entrega_up_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entrega_id  INTEGER NOT NULL REFERENCES entregas_up(id) ON DELETE CASCADE,
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_entrega_up_items_entrega ON entrega_up_items (entrega_id);

CREATE TABLE IF NOT EXISTS responsables_entrega (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bodega_id   INTEGER NOT NULL REFERENCES bodegas(id),
    nombre      TEXT NOT NULL,
    documento   TEXT NOT NULL,
    telefono    TEXT NOT NULL,
    correo      TEXT NOT NULL,
    creado_por  TEXT NOT NULL,
    creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bodega_id, documento)
);
CREATE TABLE IF NOT EXISTS entregas_kits (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    combo_id        INTEGER NOT NULL UNIQUE REFERENCES combos(id),
    bodega_id       INTEGER NOT NULL REFERENCES bodegas(id),
    responsable_id  INTEGER NOT NULL REFERENCES responsables_entrega(id),
    responsable     JSONB NOT NULL,
    adjunto         BYTEA NOT NULL,
    adjunto_nombre  TEXT NOT NULL,
    adjunto_tipo    TEXT NOT NULL,
    nota            TEXT NOT NULL DEFAULT '',
    creado_por      TEXT NOT NULL,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entregas_kits_bodega ON entregas_kits (bodega_id, fecha DESC);
-- Novedades de Kit UP (dañado, incompleto...): un texto y una foto como evidencia, que pueden valer para varios kits a la vez
-- (kit_novedad_kits). Quedan en el registro.
CREATE TABLE IF NOT EXISTS kit_novedades (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo        TEXT NOT NULL CHECK (tipo IN ('danado', 'incompleto', 'otro')),
    texto       TEXT NOT NULL,
    foto        BYTEA NOT NULL,
    foto_nombre TEXT NOT NULL,
    foto_tipo   TEXT NOT NULL,
    creado_por  TEXT NOT NULL,
    creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kit_novedad_kits (
    novedad_id INTEGER NOT NULL REFERENCES kit_novedades(id) ON DELETE CASCADE,
    combo_id   INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
    PRIMARY KEY (novedad_id, combo_id)
);
CREATE INDEX IF NOT EXISTS idx_kit_novedad_kits_combo ON kit_novedad_kits (combo_id);
-- Artículos del kit a los que se refiere la novedad, con cuántas unidades están afectadas. El nombre se copia para que el
-- registro no cambie si después se renombra el artículo. Las novedades anteriores a esta tabla no tienen artículos.
CREATE TABLE IF NOT EXISTS kit_novedad_articulos (
    novedad_id  INTEGER NOT NULL REFERENCES kit_novedades(id) ON DELETE CASCADE,
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    nombre      TEXT NOT NULL,
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (novedad_id, articulo_id)
);
-- Cada artículo afectado lleva su propia foto como evidencia. Desde entonces la novedad ya no guarda una foto general:
-- solo la tienen las novedades anteriores.
ALTER TABLE kit_novedad_articulos ADD COLUMN IF NOT EXISTS foto BYTEA;
ALTER TABLE kit_novedad_articulos ADD COLUMN IF NOT EXISTS foto_nombre TEXT;
ALTER TABLE kit_novedad_articulos ADD COLUMN IF NOT EXISTS foto_tipo TEXT;
ALTER TABLE kit_novedades ALTER COLUMN foto DROP NOT NULL;
ALTER TABLE kit_novedades ALTER COLUMN foto_nombre DROP NOT NULL;
ALTER TABLE kit_novedades ALTER COLUMN foto_tipo DROP NOT NULL;
-- La primera versión guardaba un solo kit por novedad (kit_novedades.combo_id): se pasa a la tabla de kits y se quita la columna.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'inventario' AND table_name = 'kit_novedades' AND column_name = 'combo_id') THEN
    INSERT INTO kit_novedad_kits (novedad_id, combo_id) SELECT id, combo_id FROM kit_novedades WHERE combo_id IS NOT NULL ON CONFLICT DO NOTHING;
    ALTER TABLE kit_novedades DROP COLUMN combo_id;
  END IF;
END $$;
-- Los responsables se registran con tipo y número de documento, nombres y celular; telefono guarda el celular.
ALTER TABLE responsables_entrega ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT 'CC';
ALTER TABLE responsables_entrega ADD COLUMN IF NOT EXISTS primer_nombre TEXT;
ALTER TABLE responsables_entrega ADD COLUMN IF NOT EXISTS segundo_nombre TEXT;
ALTER TABLE responsables_entrega ADD COLUMN IF NOT EXISTS primer_apellido TEXT;
ALTER TABLE responsables_entrega ADD COLUMN IF NOT EXISTS segundo_apellido TEXT;
UPDATE responsables_entrega SET primer_nombre = nombre WHERE primer_nombre IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_responsables_documento ON responsables_entrega (documento);
ALTER TABLE entregas_kits ALTER COLUMN responsable_id DROP NOT NULL;
-- Una entrega puede incluir varios kits: el soporte se guarda en la primera y las demás lo comparten (adjunto_de).
ALTER TABLE entregas_kits ALTER COLUMN adjunto DROP NOT NULL;
ALTER TABLE entregas_kits ADD COLUMN IF NOT EXISTS adjunto_de INTEGER REFERENCES entregas_kits(id);
CREATE TABLE IF NOT EXISTS entrega_kit_items (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entrega_id  INTEGER NOT NULL REFERENCES entregas_kits(id),
    articulo_id INTEGER NOT NULL REFERENCES articulos(id),
    nombre      TEXT NOT NULL,
    cantidad    INTEGER NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_entrega_kit_items_entrega ON entrega_kit_items (entrega_id);
-- E10 · ET3-21: instalación, puesta en marcha y capacitación de uso de la entrega (cuando aplique), con su soporte.
ALTER TABLE entregas_kits ADD COLUMN IF NOT EXISTS instalacion JSONB;
ALTER TABLE entregas_kits ADD COLUMN IF NOT EXISTS instalacion_soporte BYTEA;
ALTER TABLE entregas_kits ADD COLUMN IF NOT EXISTS instalacion_soporte_nombre TEXT;
ALTER TABLE entregas_kits ADD COLUMN IF NOT EXISTS instalacion_soporte_tipo TEXT;
-- E10 · ET3-26 y NOV-02: la novedad dañado o incompleto es el acta de elementos defectuosos, con su seguimiento:
-- reportada (aviso al Coordinador local regional de la U.P.) → devuelta al proveedor → reemplazada. No mueve stock.
-- id_unico guarda la U.P. del kit al reportar; reporte = quién del territorio dio por recibido el reporte.
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS id_unico TEXT;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS reporte JSONB;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS devolucion JSONB;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS reemplazo JSONB;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS reemplazo_soporte BYTEA;
ALTER TABLE kit_novedades ADD COLUMN IF NOT EXISTS reemplazo_soporte_tipo TEXT;
UPDATE kit_novedades SET estado = 'reportada' WHERE estado IS NULL AND tipo IN ('danado', 'incompleto');
DO $$ BEGIN
  ALTER TABLE kit_novedades ADD CONSTRAINT ck_kit_novedades_estado CHECK (estado IS NULL OR estado IN ('reportada', 'devuelta', 'reemplazada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_kit_novedades_id_unico ON kit_novedades (id_unico);
`;

// Crea el esquema y las tablas si no existen.
export async function iniciarEsquemaInventario() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS inventario');
  await pool.query(SCHEMA);
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_combos_nombre_unico
                      ON combos (lower(btrim(nombre)))`);
  } catch (e) {
    if (e.code !== COD_UNICO) throw e;
    const dups = await consulta(`SELECT lower(btrim(nombre)) AS n, COUNT(*) AS c
                                 FROM combos GROUP BY 1 HAVING COUNT(*) > 1`);
    console.warn('[inventario] Hay kits con nombres repetidos; corrígelos para activar la regla de unicidad:');
    for (const d of dups) console.warn(`  - '${d.n}' (${d.c} veces)`);
  }
}
