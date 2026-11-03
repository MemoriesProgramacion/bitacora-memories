// Crea o actualiza las tablas de PostgreSQL a partir de db/schema.sql. Con la opción de demostración también
// carga datos de ejemplo, pero solo en bases cuyo nombre indique que son de pruebas.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { hashClave } from '../src/acceso/clave.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// Inserta nodos, usuarios y cuentas de coordinación de demostración.
async function demo() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`
      INSERT INTO triadas (nodo, region, triada) VALUES
        ('ATLAN1', 'Región 1', 'Triada Norte'),
        ('ATLAN2', 'Región 1', 'Triada Norte'),
        ('BOLIV1', 'Región 2', 'Triada Sur')
      ON CONFLICT DO NOTHING`);
    await c.query(`
      INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo, telefono)
      SELECT v.id, t.id_triada, v.cedula, v.nombre, v.correo, v.tel
        FROM (VALUES
          ('G-ATLAN1', 'ATLAN1', '1001001001', 'Gestora Atlántico Uno', 'atlan1@ejemplo.co', '3000000001'),
          ('G-ATLAN2', 'ATLAN2', '1001001002', 'Gestor Atlántico Dos',  'atlan2@ejemplo.co', '3000000002'),
          ('G-BOLIV1', 'BOLIV1', '1001001003', 'Gestora Bolívar Uno',   'boliv1@ejemplo.co', '3000000003')
        ) AS v (id, nodo, cedula, nombre, correo, tel)
        JOIN triadas t ON t.nodo = v.nodo
      ON CONFLICT (id_origen) DO NOTHING`);

    const coords = [
      ['C-1', 'coordinador', 'coordinacion', 'Coordinador local regional Región 1', '52000001', 'Región 1', 'Atlántico', null, null],
      ['C-2', 'coordinador_compras', 'compras', 'Coordinadora de compras', '52000002', null, null, null, null],
      ['C-3', 'coordinador_datos', 'datos', 'Profesional de seguimiento e información', '52000003', null, null, null, null],
    ];
    const claveDemo = await hashClave('Demo2026*');
    for (const [id, tipo, usuario, nombre, cedula, region, departamento, modalidad, nodo] of coords) {
      await c.query(
        `INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula,
                                    region, departamento, modalidad, nodo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id_origen) DO NOTHING`,
        [id, tipo, usuario, claveDemo, nombre, cedula, region, departamento, modalidad, nodo],
      );
    }

    const ups = [
      ['UP-1', '1', 'ATLAN1', '1045000001', 'María', 'José', 'Pérez', 'Gómez', 'Tienda La Esperanza', 'Comercio al por menor', 'M1', 'Comercio', 'Atlántico', 'Luruaco'],
      ['UP-2', '2', 'ATLAN1', '1045000002', 'Luis', null, 'Rodríguez', null, 'Confecciones Luz', 'Confección de prendas', 'M2', 'Confecciones', 'Atlántico', 'Repelón'],
      ['UP-3', '3', 'ATLAN2', '1045000003', 'Ana', 'Lucía', 'Martínez', 'Ruiz', 'Panadería El Trigal', 'Elaboración de productos de panadería', 'M1', 'Alimentos', 'Atlántico', 'Sabanalarga'],
      ['UP-4', '4', 'BOLIV1', '1045000004', 'Carlos', null, 'Díaz', 'Mora', 'Taller Díaz', 'Reparación de motos', 'M1', 'Servicios', 'Bolívar', 'Turbaco'],
    ];
    for (const [idOrigen, idUnico, nodo, doc, n1, n2, a1, a2, nombre, act, mod, sector, dpto, mpio] of ups) {
      const r = await c.query(
        `INSERT INTO representantes (documento, documento_inicial, nombre1, nombre2, apellido1, apellido2,
                                     telefono1, correo1, direccion)
         VALUES ($1, $1, $2, $3, $4, $5, '3100000000', NULL, 'Calle 1 # 2-3')
         ON CONFLICT (documento) DO UPDATE SET nombre1 = EXCLUDED.nombre1
         RETURNING id_representante`,
        [doc, n1, n2, a1, a2],
      );
      await c.query(
        `INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, actividad,
                                           habilitada, modalidad, sector, departamento, municipio)
         SELECT $1, $2, t.id_triada, $4, $5, $6, TRUE, $7, $8, $9, $10 FROM triadas t WHERE t.nodo = $3
         ON CONFLICT (id_origen) DO NOTHING`,
        [idOrigen, idUnico, nodo, r.rows[0].id_representante, nombre, act, mod, sector, dpto, mpio],
      );
      await c.query(
        `INSERT INTO expedientes_up (id_origen, id_up, rit_tiene, pdf_carrito_estado)
         SELECT 'DOC-' || $1, id_up, TRUE, NULL FROM unidades_productivas WHERE id_origen = $1
         ON CONFLICT (id_origen) DO NOTHING`,
        [idOrigen],
      );
    }
    await c.query(`
      INSERT INTO expediente_etapas (id_expediente, id_etapa, completa, archivos, checks)
      SELECT e.id_expediente, et.id_etapa, TRUE, '[]'::jsonb,
             '[{"item":"Documento cargado","estado":"ok"}]'::jsonb
        FROM expedientes_up e
        JOIN etapas et ON et.codigo IN ('beneficiario', 'visita1')
      ON CONFLICT (id_expediente, id_etapa) DO NOTHING`);
    await c.query('COMMIT');
    console.log('Datos de ejemplo cargados.');
    console.log('  Coordinador local regional (Región 1, Atlántico): coordinacion · compras · datos  — clave Demo2026*');
    console.log('  Gestores: usuario = nodo (ATLAN1, ATLAN2, BOLIV1), clave = cédula (1001001001…)');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

// Comprueba que el nombre de la base sea de demostración, pruebas o desarrollo antes de cargar datos de
// ejemplo.
async function admiteEjemplos() {
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  if (/demo|test|dev/i.test(db)) return true;
  console.error(`[demo] Los datos de ejemplo no se cargan en la base «${db}». Usa una base cuyo nombre contenga «demo», «test» o «dev».`);
  return false;
}

const conDemo = process.argv.includes('--demo');
try {
  if (conDemo && !(await admiteEjemplos())) {
    process.exitCode = 1;
  } else {
    const sql = await fs.readFile(path.join(aqui, '../db/schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Esquema aplicado.');
    if (conDemo) await demo();
  }
} catch (err) {
  console.error('Error en la migración:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
