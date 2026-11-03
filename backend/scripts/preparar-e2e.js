// Deja una base limpia para las pruebas de extremo a extremo con Playwright: crea las tablas, dos nodos, tres
// unidades y una cuenta por tipo de usuario. Borra todo lo existente, por eso solo corre si el nombre de la
// base contiene e2e y test.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const { pool, query } = await import('../src/db.js');
const { hashClave } = await import('../src/acceso/clave.js');
const { iniciarEsquemaCompartido } = await import('../src/acceso/esquema.js');
const { iniciarEsquemaBitacora } = await import('../src/servicios/esquema.js');
const { iniciarEsquemaInventario, pool: poolInventario } = await import('../src/inventario/db.js');

// Clave común de todas las cuentas de prueba, que también conocen las pruebas del frontend.
export const CLAVE_E2E = process.env.E2E_CLAVE || 'E2e-Clave-Segura-2026';

const { rows: [{ db }] } = await query('SELECT current_database() AS db');
if (!/e2e/i.test(db) || !/test/i.test(db)) {
  console.error(`[e2e] Esta preparación borra la base «${db}». Usa una base cuyo nombre contenga «e2e» y «test».`);
  process.exit(1);
}

await query('DROP SCHEMA IF EXISTS inventario CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await query(await fs.readFile(path.join(aqui, '../db/schema.sql'), 'utf8'));
await iniciarEsquemaCompartido();
await iniciarEsquemaInventario();
await iniciarEsquemaBitacora();

const clave = await hashClave(CLAVE_E2E);
await query(`INSERT INTO triadas (nodo, region, triada) VALUES ('ATLAN1', 'Región 1', 'T1'), ('BOLIV1', 'Región 2', 'T2')`);
await query(`INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo)
  SELECT 'E2E-' || nodo, id_triada, CASE nodo WHEN 'ATLAN1' THEN '1001001001' ELSE '1001001003' END, 'Gestor ' || nodo, lower(nodo) || '@e2e.test'
    FROM triadas`);
await query('INSERT INTO superadmins (usuario, nombre, clave_hash, correo) VALUES ($1, $2, $3, $4)', ['e2e.jefe', 'Coordinación General E2E', clave, 'jefe@e2e.test']);
const coordinadores = [
  ['e2e.clr', 'coordinador', 'Coordinación Región 1', 'Región 1'],
  ['e2e.tecnico', 'tecnico_administrativo', 'Técnica Región 1', 'Región 1'],
  ['e2e.compras', 'coordinador_compras', 'Profesional Alianzas', null],
  ['e2e.datos', 'coordinador_datos', 'Profesional de Seguimiento', null],
  ['e2e.tallerista', 'tallerista', 'Tallerista Región 1', 'Región 1'],
];
for (const [usuario, tipo, nombre, region] of coordinadores) {
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, region, correo)
    VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`, [`E2E-${usuario}`, tipo, usuario, clave, nombre, region, `${usuario.replace('e2e.', '')}@e2e.test`]);
}
for (const [u, nodo, doc] of [['E2E-1', 'ATLAN1', '9001'], ['E2E-2', 'ATLAN1', '9002'], ['E2E-3', 'BOLIV1', '9003']]) {
  const { rows: [r] } = await query(`INSERT INTO representantes (documento, nombre1, apellido1) VALUES ($1, 'Representante', $2) RETURNING id_representante`, [doc, u]);
  await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad, departamento)
    SELECT $1::text, $1::text, id_triada, $3::int, 'Unidad ' || $1::text, 'M1 - Individual', CASE $2::text WHEN 'ATLAN1' THEN 'Atlántico' ELSE 'Bolívar' END FROM triadas WHERE nodo = $2::text`,
  [u, nodo, r.id_representante]);
}
console.log(`[e2e] Base «${db}» lista: 6 cuentas, el gestor de ATLAN1, 2 nodos y 3 unidades.`);
await poolInventario.end();
await pool.end();
