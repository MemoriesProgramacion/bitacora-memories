// Prueba de rendimiento de los endpoints críticos. Siembra una base con volumen real, levanta la API en un
// puerto libre y mide cada endpoint con autocannon usando la sesión de un usuario válido. Si la latencia o la
// tasa de errores supera el presupuesto de un endpoint, el proceso termina con error.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

const aqui = path.dirname(fileURLToPath(import.meta.url));
process.env.TURNSTILE_SECRET_KEY = '';
process.env.STORAGE_DIR = process.env.STORAGE_DIR || path.join(aqui, '..', 'storage-carga');
const { pool, query } = await import('../src/db.js');
const { hashClave } = await import('../src/acceso/clave.js');
const { iniciarEsquemaCompartido } = await import('../src/acceso/esquema.js');
const { iniciarEsquemaBitacora } = await import('../src/servicios/esquema.js');
const { iniciarEsquemaInventario, pool: poolInventario } = await import('../src/inventario/db.js');
const { reiniciarLimites } = await import('../src/acceso/limites.js');
const { crearApp } = await import('../src/app.js');

const RAPIDO = process.argv.includes('--rapido');
const UNIDADES = 6334;
const REGIONES = ['Región 1', 'Región 2', 'Región 3', 'Región 4', 'Región 5'];
const NODOS = 130;
const CLAVE = 'Carga-Clave-Segura-2026';

// Presupuesto por endpoint: latencia máxima en los percentiles 97,5 y 99 y tasa máxima de respuestas que no son
// exitosas.
const ESCENARIOS = [
  { nombre: 'Lista de unidades (nivel nacional)', ruta: '/api/unidades', quien: 'general', peticiones: 300, conexiones: 10, p975: 2500, p99: 4000 },
  { nombre: 'Lista de unidades (gestor)', ruta: '/api/unidades', quien: 'gestor', peticiones: 600, conexiones: 10, p975: 400, p99: 800 },
  { nombre: 'Expedientes (nivel nacional)', ruta: '/api/documentos', quien: 'general', peticiones: 300, conexiones: 10, p975: 2500, p99: 4000 },
  { nombre: 'Panel de seguimiento (nivel nacional)', ruta: '/api/seguimiento/panel', quien: 'datos', peticiones: 120, conexiones: 5, p975: 3000, p99: 5000 },
  { nombre: 'Ruta por unidad (coordinación regional)', ruta: '/api/seguimiento/ruta', quien: 'clr', peticiones: 120, conexiones: 5, p975: 2500, p99: 4000 },
  { nombre: 'Bandeja de tickets (coordinación regional)', ruta: '/api/tickets', quien: 'clr', peticiones: 600, conexiones: 10, p975: 500, p99: 1000 },
  { nombre: 'Agenda (gestor)', ruta: '/api/agenda', quien: 'gestor', peticiones: 600, conexiones: 10, p975: 400, p99: 800 },
];
const MAX_ERRORES = 0.01;
const LOGIN_P99 = 2500;
const RECUPERACION = 1.5;

const { rows: [{ db }] } = await query('SELECT current_database() AS db');
if (!/carga/i.test(db) || !/test/i.test(db)) {
  console.error(`[carga] Esta prueba borra la base «${db}». Usa una base cuyo nombre contenga «carga» y «test».`);
  process.exit(1);
}

console.log(`[carga] Sembrando ${UNIDADES} unidades en «${db}»…`);
await query('DROP SCHEMA IF EXISTS inventario CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await query(await fs.readFile(path.join(aqui, '../db/schema.sql'), 'utf8'));
await iniciarEsquemaCompartido();
await iniciarEsquemaInventario();
await iniciarEsquemaBitacora();
const clave = await hashClave(CLAVE);
await query(`INSERT INTO triadas (nodo, region, triada)
  SELECT 'NODO' || lpad(g::text, 3, '0'), ($1::text[])[1 + (g - 1) % 5], 'T' || g FROM generate_series(1, $2::int) g`, [REGIONES, NODOS]);
await query(`INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo)
  SELECT 'G-' || nodo, id_triada, (2000000000 + id_triada)::text, 'Gestor ' || nodo, lower(nodo) || '@carga.test' FROM triadas`);
await query(`INSERT INTO representantes (documento, nombre1, apellido1)
  SELECT (3000000000 + g)::text, 'Representante', 'Carga ' || g FROM generate_series(1, $1::int) g`, [UNIDADES]);
await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad, departamento, municipio)
  SELECT 'C-' || g, 'C-' || lpad(g::text, 5, '0'), (SELECT id_triada FROM triadas ORDER BY id_triada OFFSET (g - 1) % $2 LIMIT 1),
         r.id_representante, 'Unidad de carga ' || g,
         (ARRAY['M1 - Individual', 'M2 - Asociativa', 'M3 - Solidaria', 'M4 - Solidaria'])[1 + g % 4], 'Departamento ' || (1 + g % 20), 'Municipio ' || (1 + g % 90)
    FROM generate_series(1, $1::int) g JOIN representantes r ON r.documento = (3000000000 + g)::text`, [UNIDADES, NODOS]);
await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, tipo_visita, cerrada, fecha_cierre, documento)
  SELECT up.id_unico || '_' || t.tipo, up.id_up, up.id_unico, r.documento, t.tipo, TRUE, now() - (t.dias || ' days')::interval, '{}'
    FROM unidades_productivas up JOIN representantes r ON r.id_representante = up.id_representante
    CROSS JOIN (VALUES ('v1', 90, 6), ('v2', 60, 3), ('v3', 10, 10)) AS t(tipo, dias, cada)
   WHERE up.id_up % t.cada = 0`);
await query(`INSERT INTO expedientes_up (id_origen, id_up, rit_tiene, pdf_carrito_estado)
  SELECT 'DOC-' || id_unico, id_up, id_up % 3 = 0, 'Cargado' FROM unidades_productivas WHERE id_up % 2 = 0`);
await query(`INSERT INTO carritos (id_origen, codigo_iniciativa, id_up, estado, historial)
  SELECT 'LOCAL-' || id_unico, id_unico, id_up, (ARRAY['borrador', 'enviado', 'viable', 'aprobado', 'en_compra', 'entregado'])[1 + id_up % 6], '[]'
    FROM unidades_productivas WHERE id_up % 5 = 0`);
await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, region) VALUES
  ('CG-CLR', 'coordinador', 'carga.clr', $1, 'Coordinación Región 1', 'Región 1'),
  ('CG-PSI', 'coordinador_datos', 'carga.datos', $1, 'Profesional de seguimiento', NULL)`, [clave]);
await query('INSERT INTO superadmins (usuario, nombre, clave_hash) VALUES ($1, $2, $3)', ['carga.jefe', 'Coordinación general', clave]);
await query(`INSERT INTO tickets (titulo, descripcion, estado, nivel, nodo, creado_por, creado_por_nombre, creado_por_rol, historial, etapa, region)
  SELECT 'Ticket ' || g, 'Descripción del ticket ' || g, (ARRAY['abierto', 'en_gestion', 'respondido', 'resuelto'])[1 + g % 4], 'regional',
         t.nodo, 'gestor:' || t.id_triada, 'Gestor ' || t.nodo, 'Gestor', '[]', (ARRAY['diagnostico', 'fortalecimiento', 'capitalizacion'])[1 + g % 3], t.region
    FROM generate_series(1, 600) g JOIN triadas t ON t.id_triada = 1 + (g % $1)`, [NODOS]);
await query('ANALYZE');

const servidor = crearApp().listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;
// Pide el token CSRF, inicia sesión con el usuario y la clave dados y devuelve la cookie de sesión y lo que
// tardó el ingreso.
async function entrar(usuario, claveCuenta) {
  const r0 = await fetch(`${base}/api/auth/sesion`);
  const token = (await r0.json()).token;
  const cookie0 = r0.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const t0 = performance.now();
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Cookie: cookie0 }, body: JSON.stringify({ usuario, clave: claveCuenta }) });
  const ms = performance.now() - t0;
  const json = await r.json();
  if (!json.ok) throw new Error(`[carga] No entró ${usuario}: ${JSON.stringify(json)}`);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') || cookie0, ms };
}
const { rows: [g1] } = await query('SELECT nodo, (SELECT cedula FROM gestores WHERE id_triada = t.id_triada) AS cedula FROM triadas t ORDER BY id_triada LIMIT 1');
const sesiones = {
  general: await entrar('carga.jefe', CLAVE),
  clr: await entrar('carga.clr', CLAVE),
  datos: await entrar('carga.datos', CLAVE),
  gestor: await entrar(g1.nodo.toLowerCase(), g1.cedula),
};
const logins = [];
for (let i = 0; i < (RAPIDO ? 3 : 8); i += 1) { await reiniciarLimites(); logins.push((await entrar('carga.jefe', CLAVE)).ms); }
logins.sort((a, b) => a - b);

// Lanza autocannon contra una ruta con la sesión de un usuario y devuelve las métricas de la prueba.
const medir = (ruta, quien, peticiones, conexiones) => autocannon({
  url: `${base}${ruta}`, connections: conexiones, amount: RAPIDO ? Math.ceil(peticiones / 4) : peticiones,
  headers: { Cookie: sesiones[quien].cookie }, timeout: 30,
});
const resultados = [];
for (const e of ESCENARIOS) {
  await reiniciarLimites();
  process.stdout.write(`[carga] ${e.nombre}… `);
  const r = await medir(e.ruta, e.quien, e.peticiones, e.conexiones);
  const total = r.requests.total || 1;
  const errores = (r.non2xx + r.errors + r.timeouts) / total;
  const ok = r.latency.p97_5 <= e.p975 && r.latency.p99 <= e.p99 && errores <= MAX_ERRORES;
  resultados.push({ escenario: e.nombre, ruta: e.ruta, rol: e.quien, peticiones: total, rps: Math.round(r.requests.average),
    p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, errores: Math.round(errores * 10000) / 100,
    presupuesto: { p97_5: e.p975, p99: e.p99, errores_pct: MAX_ERRORES * 100 }, ok });
  console.log(`p50 ${r.latency.p50} ms · p97,5 ${r.latency.p97_5} ms · p99 ${r.latency.p99} ms · ${(errores * 100).toFixed(2)} % errores ${ok ? '✓' : '✗'}`);
}

await reiniciarLimites();
const antes = await medir('/api/seguimiento/panel', 'datos', 40, 2);
await reiniciarLimites();
const pico = await medir('/api/seguimiento/panel', 'datos', 120, 25);
await reiniciarLimites();
const despues = await medir('/api/seguimiento/panel', 'datos', 40, 2);
const recupera = despues.latency.p50 <= antes.latency.p50 * RECUPERACION + 50;
const errPico = (pico.non2xx + pico.errors + pico.timeouts) / (pico.requests.total || 1);
console.log(`[carga] Pico del panel: antes p50 ${antes.latency.p50} ms · pico p99 ${pico.latency.p99} ms · después p50 ${despues.latency.p50} ms ${recupera ? '✓ se recupera' : '✗ no se recupera'}`);

const loginOk = logins[logins.length - 1] <= LOGIN_P99;
const todoOk = resultados.every((x) => x.ok) && recupera && errPico <= MAX_ERRORES && loginOk;
const informe = {
  fecha: new Date().toISOString(), base: db, unidades: UNIDADES, rapido: RAPIDO, ok: todoOk,
  ingreso: { mediciones: logins.map(Math.round), max_ms: Math.round(logins[logins.length - 1]), presupuesto_ms: LOGIN_P99, ok: loginOk },
  escenarios: resultados,
  pico: { antes_p50: antes.latency.p50, pico_p99: pico.latency.p99, pico_errores_pct: Math.round(errPico * 10000) / 100, despues_p50: despues.latency.p50, recupera, factor: RECUPERACION },
};
const carpeta = path.join(aqui, '..', 'reportes');
await fs.mkdir(carpeta, { recursive: true });
await fs.writeFile(path.join(carpeta, 'carga.json'), JSON.stringify(informe, null, 2));
const md = [
  `# Prueba de rendimiento · ${informe.fecha.slice(0, 16).replace('T', ' ')} UTC`, '',
  `${UNIDADES} unidades sintéticas en la base de pruebas «${db}». Resultado: **${todoOk ? 'dentro del presupuesto' : 'FUERA del presupuesto'}**.`, '',
  '| Escenario | Rol | Peticiones | RPS | p50 (ms) | p97,5 (ms) | p99 (ms) | Errores | Presupuesto p97,5 / p99 | ¿Cumple? |',
  '|---|---|---:|---:|---:|---:|---:|---:|---|---|',
  ...resultados.map((x) => `| ${x.escenario} | ${x.rol} | ${x.peticiones} | ${x.rps} | ${x.p50} | ${x.p97_5} | ${x.p99} | ${x.errores} % | ${x.presupuesto.p97_5} / ${x.presupuesto.p99} | ${x.ok ? 'Sí' : 'No'} |`),
  '', `Ingreso (cifrado de la clave, en serie): máximo ${informe.ingreso.max_ms} ms de ${LOGIN_P99} ms permitidos — ${loginOk ? 'cumple' : 'no cumple'}.`,
  `Pico sobre el panel (25 conexiones): p50 antes ${antes.latency.p50} ms, p99 en el pico ${pico.latency.p99} ms, p50 después ${despues.latency.p50} ms — ${recupera ? 'se recupera' : 'no se recupera'}.`, '',
];
await fs.writeFile(path.join(carpeta, 'carga.md'), md.join('\n'));
console.log(`[carga] ${todoOk ? 'Todo dentro del presupuesto' : 'Hay endpoints fuera del presupuesto'}. Informe en backend/reportes/carga.md`);

servidor.close();
await poolInventario.end();
await pool.end();
process.exit(todoOk ? 0 : 1);
