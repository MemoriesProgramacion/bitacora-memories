// ============================================================
// PRUEBAS DE LOS SERVICIOS CONTRA UNA BASE POSTGRESQL REAL
// ------------------------------------------------------------
// Usan una base de PRUEBAS (se borra y se vuelve a crear el contenido):
//   createdb bitacora_test
//   DATABASE_URL=postgres://usuario:clave@localhost:5432/bitacora_test npm test
// Se niegan a correr si el nombre de la base no contiene "test".
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.STORAGE_DIR ||= path.join(os.tmpdir(), `bitacora-test-${process.pid}`);

const { pool, query } = await import('../src/db.js');
const { hashClave } = await import('../src/acceso/clave.js');
const { iniciarEsquemaCompartido } = await import('../src/acceso/esquema.js');
const { iniciarEsquemaBitacora } = await import('../src/servicios/esquema.js');
const { iniciarEsquemaInventario, pool: poolInventario } = await import('../src/inventario/db.js');
const { reiniciarLimites } = await import('../src/acceso/limites.js');
const { crearApp } = await import('../src/app.js');
const unidades = await import('../src/servicios/unidades.js');
const documentos = await import('../src/servicios/documentos.js');
const visitas = await import('../src/servicios/visitas.js');
const com = await import('../src/servicios/comunicaciones.js');
const entregas = await import('../src/servicios/entregas.js');
const archivos = await import('../src/servicios/archivos.js');
const validador = await import('../src/servicios/validador.js');
const agenda = await import('../src/servicios/agenda.js');
const catalogo = await import('../src/servicios/catalogo.js');
const carrito = await import('../src/servicios/carrito.js');
const compras = await import('../src/servicios/compras.js');
const revision = await import('../src/servicios/revision.js');
const actividad = await import('../src/servicios/actividad.js');
const fichaUP = await import('../src/servicios/fichaUP.js');
const cargueDocs = await import('../src/servicios/cargueDocumentos.js');
const cargueRit = await import('../src/servicios/cargueRit.js');
const historialSubs = await import('../src/servicios/historialSubsanacion.js');
const configuracion = await import('../src/servicios/configuracion.js');

const aqui = path.dirname(fileURLToPath(import.meta.url));

// Coordinador general: el superadmin entra a la Bitácora como 'coordinador' con superadmin: true y sin límite de territorio.
const COORD = { sub: 'superadmin:1', rol: 'coordinador', superadmin: true, general: true, nodo: null, nombre: 'Coord', cedula: '52000001' };
// Coordinador local regional: solo ve lo de su región, departamento, modalidad y nodo.
const local = (alcance) => ({ sub: 'coordinador:9', rol: 'coordinador', nodo: alcance.nodo || null,
  nombre: 'Local', cedula: '52000009', alcance: { region: null, departamento: null, modalidad: null, nodo: null, ...alcance } });
const LOCAL_R1 = local({ region: 'región 1' });
const COMPRAS = { sub: 'c2', rol: 'coordinador_compras', nodo: null, nombre: 'Compras', cedula: '52000002' };
// El Profesional de seguimiento actúa en la Bitácora como el Coordinador general (ver auth.js): rol 'coordinador' y `general`.
const DATOS = { sub: 'c3', rol: 'coordinador', general: true, esDatos: true, alcance: null, nodo: null, nombre: 'Datos', cedula: '52000003' };
// El «admin» de la Bitácora oficial es el superadmin en SSDPS: entra a la Bitácora como coordinador con superadmin:true.
const ADMIN = { sub: 'superadmin:1', rol: 'coordinador', nodo: null, nombre: 'Jefe', cedula: '', superadmin: true, general: true };
// Quien revisa los soportes del Validador es el superadmin.
const REVISOR = { ...ADMIN, nombre: 'Revisor' };
const G1 = { sub: 'g1', rol: 'gestor', nodo: 'ATLAN1', nombre: 'Gestora 1', cedula: '1001001001' };
const G2 = { sub: 'g2', rol: 'gestor', nodo: 'BOLIV1', nombre: 'Gestora 3', cedula: '1001001003' };

async function rechaza(promesa, status) {
  await assert.rejects(promesa, (e) => e.status === status);
}

// Firma mínima de cada tipo: el servidor revisa que el contenido corresponda a la extensión
// (servicios/tipoArchivo.js), así que el contenido de prueba la lleva delante. Con { crudo: true }
// el contenido va tal cual, para probar los archivos disfrazados.
const FIRMAS_PRUEBA = {
  '.pdf': Buffer.from('%PDF-'),
  '.mp4': Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypmp42')]),
  '.docx': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  '.xlsx': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  '.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

async function archivoTemporal(nombre, contenido = 'x', mimetype = 'application/pdf', { crudo = false } = {}) {
  const p = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const cuerpo = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido);
  const firma = crudo ? null : FIRMAS_PRUEBA[path.extname(nombre).toLowerCase()];
  const datos = firma && !cuerpo.subarray(0, firma.length).equals(firma) ? Buffer.concat([firma, cuerpo]) : cuerpo;
  await fs.writeFile(p, datos);
  return { path: p, originalname: nombre, size: datos.length, mimetype };
}

before(async () => {
  // Protección: estas pruebas borran todo. Solo corren en una base de pruebas.
  const { rows: [{ db }] } = await query('SELECT current_database() AS db');
  if (!/test/i.test(db)) {
    throw new Error(`Las pruebas borran la base "${db}". Usa una base cuyo nombre contenga "test".`);
  }
  await query('DROP SCHEMA IF EXISTS inventario CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await query(await fs.readFile(path.join(aqui, '../db/schema.sql'), 'utf8'));
  await iniciarEsquemaCompartido();
  await iniciarEsquemaInventario();
  await iniciarEsquemaBitacora();
  await query(`INSERT INTO triadas (nodo, region, triada) VALUES
    ('ATLAN1','Región 1','T1'), ('BOLIV1','Región 2','T2')`);
  await query(`INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo)
    SELECT 'G-' || nodo, id_triada, CASE nodo WHEN 'ATLAN1' THEN '1001001001' ELSE '1001001003' END,
           'Gestor ' || nodo, lower(nodo) || '@x.co' FROM triadas`);
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula)
    VALUES ('C1', 'coordinador', 'coordinacion', $1, 'Coord', '52000001')`, [await hashClave('Secreta123')]);
  await query(`INSERT INTO inventario.usuarios (usuario, nombre, clave_hash, rol)
    VALUES ('bodega', 'Bodeguero', $1, 'bodeguero')`, [await hashClave('Bodega-Segura-2026')]);
  await query(`INSERT INTO superadmins (usuario, nombre, clave_hash)
    VALUES ('jefe', 'Jefe', $1)`, [await hashClave('Super-Segura-2026x')]);
  for (const [o, u, nodo, doc] of [['UP-1', '1', 'ATLAN1', '111'], ['UP-2', '2', 'ATLAN1', '222'], ['UP-3', '3', 'BOLIV1', '333']]) {
    const r = await query(`INSERT INTO representantes (documento, nombre1, apellido1) VALUES ($1, 'Nombre', $2)
      RETURNING id_representante`, [doc, `Ap${u}`]);
    await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad)
      SELECT $1, $2::text, id_triada, $4, 'UP ' || $2::text, 'M1' FROM triadas WHERE nodo = $3`, [o, u, nodo, r.rows[0].id_representante]);
  }
  await query(`INSERT INTO expedientes_up (id_origen, id_up, rit_tiene, pdf_carrito_estado)
    SELECT 'DOC-' || id_unico, id_up, TRUE, 'Cargado' FROM unidades_productivas WHERE id_unico IN ('1','3')`);
  await query(`INSERT INTO expediente_etapas (id_expediente, id_etapa, completa, archivos, checks, fecha, modalidad)
    SELECT e.id_expediente, et.id_etapa, TRUE, '[{"nombre":"a.pdf"}]', '[{"item":"Acta","estado":"ok"}]',
           '2026-09-01T10:00:00Z', 'Presencial'
      FROM expedientes_up e JOIN etapas et ON et.codigo IN ('visita1','fortalecimiento.modulo2','compra','cotizaciones.ganadora')`);
});

after(async () => {
  await new Promise((r) => servidor.close(r));
  await poolInventario.end();
  await pool.end();
  await fs.rm(process.env.STORAGE_DIR, { recursive: true, force: true });
});

// ---------------- Acceso: login único, sesión y módulos ----------------
// Se prueba por HTTP contra la aplicación real, con cookie y token CSRF.
const servidor = crearApp().listen(0);
const base = `http://127.0.0.1:${servidor.address().port}`;

// Cliente con su propia cookie de sesión.
function cliente() {
  let cookie = '';
  let csrf = null;
  const pedir = async (metodo, ruta, cuerpo) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(metodo !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const nuevas = res.headers.getSetCookie();
    if (nuevas.length) cookie = nuevas.map((c) => c.split(';')[0]).join('; ');
    const json = await res.json().catch(() => null);
    if (json?.token) csrf = json.token;
    return { status: res.status, json };
  };
  pedir.cookie = () => cookie;
  return pedir;
}

async function entrar(usuario, clave) {
  const http = cliente();
  await http('GET', '/api/auth/sesion'); // trae el token CSRF
  const r = await http('POST', '/api/auth/login', { usuario, clave });
  return { http, r };
}

test('login único: el coordinador abre Bitácora y Administración; el gestor, solo la Bitácora', async () => {
  await reiniciarLimites();
  const c = await entrar('Coordinacion', 'Secreta123');
  assert.equal(c.r.status, 200);
  assert.equal(c.r.json.sesion.rol, 'coordinador');
  assert.deepEqual(c.r.json.sesion.modulos, ['bitacora', 'admin']);
  assert.equal((await c.http('GET', '/api/unidades')).status, 200);

  const g = await entrar('atlan1', '1001001001');
  assert.equal(g.r.json.sesion.rol, 'gestor');
  assert.equal(g.r.json.sesion.nodo, 'ATLAN1');
  assert.equal(g.r.json.sesion.region, 'Región 1');
  // El gestor solo ve su nodo y no entra al inventario ni a la administración.
  assert.equal((await g.http('GET', '/api/unidades')).json.items.length, 2);
  assert.equal((await g.http('GET', '/api/inv/recepcion')).status, 403);
  assert.equal((await g.http('GET', '/api/admin/usuarios')).status, 403);
});

test('Profesional alianzas y conexión de mercados: inventario completo y Administración limitada a los bodegueros', async () => {
  await reiniciarLimites();
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula)
    VALUES ('C-LOG', 'coordinador_compras', 'logistica', $1, 'Logística', '52000021')`, [await hashClave('Logistica-Clave-2026')]);
  const l = await entrar('logistica', 'Logistica-Clave-2026');
  assert.deepEqual(l.r.json.sesion.modulos, ['bitacora', 'inventario', 'admin']);
  assert.equal((await l.http('GET', '/api/inv/panel')).status, 200);   // todo el inventario

  const lista = (await l.http('GET', '/api/admin/usuarios')).json;
  assert.ok(lista.usuarios.length > 0 && lista.usuarios.every((u) => u.rol === 'bodeguero'));
  assert.deepEqual(lista.roles.map((r) => r.rol), ['bodeguero']);
  for (const ruta of ['/api/admin/resumen', '/api/admin/accesos', '/api/admin/sesiones', '/api/admin/auditoria-claves']) {
    assert.equal((await l.http('GET', ruta)).status, 403, ruta);
  }
  const bodega = lista.usuarios.find((u) => u.usuario === 'bodega');
  assert.equal((await l.http('POST', `/api/admin/usuarios/inventario/${bodega.id}/editar`, { nombre: 'x' })).status, 403);
  assert.equal((await l.http('POST', `/api/admin/usuarios/inventario/${bodega.id}/estado`)).status, 403);
  assert.equal((await l.http('POST', '/api/admin/usuarios', { rol: 'gestor', nombre: 'No', departamento: 'Meta', cedula: '4004004004' })).status, 403);

  // Crea un bodeguero, le asigna clave y lo desbloquea; no toca a nadie más.
  const p = (await query("INSERT INTO inventario.bodegas (nombre, tipo) VALUES ('Temporal logística principal', 'principal') RETURNING id")).rows[0].id;
  const m = (await query("INSERT INTO inventario.bodegas (nombre, tipo, principal_id) VALUES ('Temporal logística municipal', 'municipal', $1) RETURNING id", [p])).rows[0].id;
  const nuevo = await l.http('POST', '/api/admin/usuarios', { rol: 'bodeguero', usuario: 'bodega.nuevo', nombre: 'Nuevo', clave: 'Bodega-Clave-2026x', bodega_id: m });
  assert.equal(nuevo.status, 200);
  assert.equal((await l.http('POST', `/api/admin/usuarios/inventario/${nuevo.json.id}/clave`, { clave: 'Otra-Clave-Bodega-9' })).status, 200);
  assert.equal((await l.http('POST', '/api/admin/desbloquear', { usuario: 'bodega.nuevo' })).status, 200);
  assert.equal((await l.http('POST', '/api/admin/desbloquear', { usuario: 'jefe' })).status, 404);
  await query("DELETE FROM inventario.usuarios WHERE usuario = 'bodega.nuevo'");
  await query('DELETE FROM inventario.bodegas WHERE id = $1', [m]);
  await query('DELETE FROM inventario.bodegas WHERE id = $1', [p]);
});

test('login único: el usuario de inventario abre solo el inventario', async () => {
  const b = await entrar('bodega', 'Bodega-Segura-2026');
  assert.deepEqual(b.r.json.sesion.modulos, ['inventario']);
  assert.equal((await b.http('GET', '/api/inv/recepcion')).status, 200);
  assert.equal((await b.http('GET', '/api/inv/panel')).status, 403); // solo administrador
  assert.equal((await b.http('GET', '/api/unidades')).status, 403);
  assert.equal((await b.http('GET', '/api/admin/usuarios')).status, 403);
});

test('superadmin: ve los dos programas y administra a todos los usuarios', async () => {
  const s = await entrar('jefe', 'Super-Segura-2026x');
  assert.deepEqual(s.r.json.sesion.modulos, ['bitacora', 'inventario', 'admin']);
  assert.equal((await s.http('GET', '/api/unidades')).status, 200);
  assert.equal((await s.http('GET', '/api/inv/panel')).status, 200);

  const lista = (await s.http('GET', '/api/admin/usuarios')).json.usuarios;
  const origenes = new Set(lista.map((u) => u.origen));
  assert.deepEqual([...origenes].sort(), ['coordinador', 'gestor', 'inventario', 'superadmin']);
  // Nunca se devuelve el hash de ninguna clave.
  assert.ok(lista.every((u) => !JSON.stringify(u).includes('scrypt')));
  // La clave de un gestor sin clave propia es su cédula.
  assert.equal(lista.find((u) => u.usuario === 'ATLAN1').clave_visible, '1001001001');

  // Cambiar la clave de alguien le cierra la sesión y la vieja deja de servir.
  const coord = await entrar('coordinacion', 'Secreta123');
  const id = lista.find((u) => u.usuario === 'coordinacion').id;
  const r = await s.http('POST', `/api/admin/usuarios/coordinador/${id}/clave`, { clave: 'Otra-Clave-Larga-77' });
  assert.equal(r.status, 200);
  assert.equal((await coord.http('GET', '/api/unidades')).status, 401);
  assert.equal((await entrar('coordinacion', 'Secreta123')).r.status, 401);
  assert.equal((await entrar('coordinacion', 'Otra-Clave-Larga-77')).r.status, 200);

  // Un coordinador no puede usar la consola.
  assert.equal((await (await entrar('coordinacion', 'Otra-Clave-Larga-77')).http('GET', '/api/admin/resumen')).status, 403);
});

test('superadmin: el gestor nuevo pide departamento y se numera solo', async () => {
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const crear = (extra) => s.http('POST', '/api/admin/usuarios', { rol: 'gestor', nombre: 'Gestora Nueva', ...extra });

  // Sin departamento o sin cédula no se puede crear.
  assert.equal((await crear({ cedula: '2001001001' })).status, 400);
  assert.equal((await crear({ departamento: 'Cundinamarca' })).status, 400);

  assert.equal((await crear({ departamento: 'Cundinamarca', cedula: '2001001001' })).json.usuario, 'CUNDI1');
  assert.equal((await crear({ departamento: 'Cundinamarca', cedula: '2001001002' })).json.usuario, 'CUNDI2');
  // En un departamento que ya tenía a ATLAN1, el nuevo es el 2.
  assert.equal((await crear({ departamento: 'Atlántico', cedula: '2001001003' })).json.usuario, 'ATLAN2');
  // La cédula no se repite.
  assert.equal((await crear({ departamento: 'Cundinamarca', cedula: '2001001001' })).status, 409);

  // Entra con su cédula y solo ve la Bitácora.
  const g = await entrar('cundi2', '2001001002');
  assert.equal(g.r.json.sesion.rol, 'gestor');
  assert.deepEqual(g.r.json.sesion.modulos, ['bitacora']);

  const datos = (await s.http('GET', '/api/admin/usuarios')).json;
  assert.equal(datos.usuarios.find((u) => u.usuario === 'CUNDI2').departamento, 'Cundinamarca');
  assert.equal(datos.departamentos.find((d) => d.nombre === 'Cundinamarca').siguiente, 'CUNDI3');
  // Todos los roles se pueden elegir al crear o editar.
  assert.deepEqual(datos.roles.map((r) => r.rol), ['superadmin', 'coordinador', 'tecnico_administrativo', 'tallerista',
    'coordinador_compras', 'coordinador_datos', 'bodeguero', 'gestor']);
});

test('superadmin: el correo no se repite entre usuarios', async () => {
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const gestor = (cedula, correo) => s.http('POST', '/api/admin/usuarios',
    { rol: 'gestor', nombre: 'Jhon Fredy Ocampo', departamento: 'Valle del Cauca', cedula, correo, telefono: '3001001006' });

  const primero = await gestor('5001001006', 'valle1@ejemplo.co');
  assert.equal(primero.status, 200);

  // El mismo correo, aunque cambie de mayúsculas o sea otro rol, se rechaza.
  const repetido = await gestor('5001001007', 'Valle1@Ejemplo.co');
  assert.equal(repetido.status, 409);
  assert.match(repetido.json.error, /correo/);
  assert.equal(repetido.json.campo, 'correo'); // el formulario lo muestra bajo el campo Correo
  assert.equal((await s.http('POST', '/api/admin/usuarios', {
    rol: 'coordinador', usuario: 'otro.valle', nombre: 'Otro', clave: 'Clave-Muy-Larga-91', correo: 'valle1@ejemplo.co', region: 'Región 1',
  })).status, 409);
  // Correo con formato inválido.
  assert.equal((await gestor('5001001008', 'valle1-sin-arroba')).status, 400);

  // Al editar: puede guardar su propio correo, pero no tomar el de otro.
  const lista = (await s.http('GET', '/api/admin/usuarios')).json.usuarios;
  const yo = lista.find((u) => u.usuario === primero.json.usuario);
  const editar = (correo) => s.http('POST', `/api/admin/usuarios/gestor/${yo.id}/editar`, { correo });
  assert.equal((await editar('valle1@ejemplo.co')).status, 200);
  const otro = await gestor('5001001009', 'valle2@ejemplo.co');
  assert.equal(otro.status, 200);
  assert.equal((await editar('valle2@ejemplo.co')).status, 409);
});

test('superadmin: al cambiar el rol, la persona solo ve lo de su rol nuevo', async () => {
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const clave = 'Clave-Muy-Larga-91';
  const p = (await query("INSERT INTO inventario.bodegas (nombre, tipo) VALUES ('Temporal roles principal', 'principal') RETURNING id")).rows[0].id;
  const m = (await query("INSERT INTO inventario.bodegas (nombre, tipo, principal_id) VALUES ('Temporal roles municipal', 'municipal', $1) RETURNING id", [p])).rows[0].id;
  const alta = await s.http('POST', '/api/admin/usuarios',
    { rol: 'bodeguero', usuario: 'maria.inv', nombre: 'María', clave, bodega_id: m });
  assert.equal(alta.status, 200);

  const antes = await entrar('maria.inv', clave);
  assert.deepEqual(antes.r.json.sesion.modulos, ['inventario']);
  assert.equal((await antes.http('GET', '/api/inv/recepcion')).status, 200);

  // De bodeguero a gestor: cambia de tabla y toma el nodo como usuario.
  const aGestor = await s.http('POST', `/api/admin/usuarios/inventario/${alta.json.id}/editar`,
    { rol: 'gestor', nombre: 'María', departamento: 'Bolívar', cedula: '3001001001' });
  assert.equal(aGestor.status, 200);
  assert.equal(aGestor.json.usuario, 'BOLIV2');
  assert.equal((await antes.http('GET', '/api/inv/recepcion')).status, 401); // su sesión se cerró
  assert.equal((await entrar('maria.inv', clave)).r.status, 401); // el usuario viejo ya no existe

  // Con la misma clave entra como gestor y el inventario le queda cerrado.
  const gestor = await entrar('boliv2', clave);
  assert.equal(gestor.r.json.sesion.rol, 'gestor');
  assert.deepEqual(gestor.r.json.sesion.modulos, ['bitacora']);
  assert.equal((await gestor.http('GET', '/api/inv/panel')).status, 403);

  // De gestor a Profesional alianzas y conexión de mercados, conservando la clave.
  const lista = (await s.http('GET', '/api/admin/usuarios')).json.usuarios;
  const idGestor = lista.find((u) => u.usuario === 'BOLIV2').id;
  const aCompras = await s.http('POST', `/api/admin/usuarios/gestor/${idGestor}/editar`,
    { rol: 'coordinador_compras', usuario: 'maria.compras', nombre: 'María' });
  assert.equal(aCompras.status, 200);
  const compras = await entrar('maria.compras', clave);
  assert.equal(compras.r.json.sesion.rol, 'coordinador_compras');
  assert.equal((await entrar('boliv2', clave)).r.status, 401);

  // Un gestor que entra con su cédula necesita una clave nueva para pasar a otro rol.
  const g = await s.http('POST', '/api/admin/usuarios', { rol: 'gestor', nombre: 'Otra', departamento: 'Meta', cedula: '4001001001' });
  assert.equal(g.status, 200);
  const idG = (await s.http('GET', '/api/admin/usuarios')).json.usuarios.find((u) => u.usuario === 'META1').id;
  const sinClave = { rol: 'coordinador_datos', usuario: 'otra.datos', nombre: 'Otra' };
  assert.equal((await s.http('POST', `/api/admin/usuarios/gestor/${idG}/editar`, sinClave)).status, 400);
  assert.equal((await s.http('POST', `/api/admin/usuarios/gestor/${idG}/editar`, { ...sinClave, clave })).status, 200);
  assert.equal((await entrar('otra.datos', clave)).r.json.sesion.rol, 'coordinador_datos');

  // Nadie cambia su propio rol.
  const yo = (await s.http('GET', '/api/admin/usuarios')).json.usuarios.find((u) => u.usuario === 'jefe');
  assert.equal((await s.http('POST', `/api/admin/usuarios/superadmin/${yo.id}/editar`, { rol: 'admin' })).status, 400);
  await query('DELETE FROM inventario.bodegas WHERE id = $1', [m]);
  await query('DELETE FROM inventario.bodegas WHERE id = $1', [p]);
});

test('inventario: el panel trae las cifras y los datos de todas las gráficas', async () => {
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const r = await s.http('GET', '/api/inv/panel');
  assert.equal(r.status, 200);
  const d = r.json;

  // Series completas aunque no haya movimientos: 30 días y 6 meses, en cero.
  assert.equal(d.movs_dia.length, 30);
  assert.equal(d.ordenes_mes.length, 6);
  assert.equal(d.despachos_mes.length, 6);
  assert.deepEqual(Object.keys(d.estado).sort(), ['agotados', 'normales', 'por_reponer']);
  for (const clave of ['valor_stock', 'ordenes_este_mes', 'monto_despachado', 'n_lotes']) {
    assert.equal(typeof d[clave], 'number', clave);
  }
  assert.ok(Array.isArray(d.top_valor) && Array.isArray(d.por_proveedor) && Array.isArray(d.lotes));

  // El bodeguero no ve el panel (lleva precios y valores).
  const b = await entrar('bodega', 'Bodega-Segura-2026');
  assert.equal((await b.http('GET', '/api/inv/panel')).status, 403);
});

test('alertas de stock: se clasifican por mínimo y por ritmo de consumo', async () => {
  const { clasificar } = await import('../src/inventario/alertas.js');
  const nivel = (stock, minimo, salidas = 0, tuvoMovimientos = false) =>
    clasificar({ stock, minimo, salidas, tuvoMovimientos }).nivel;

  assert.equal(nivel(0, 5), 'agotado');
  assert.equal(nivel(0, 0), null); // un artículo recién creado en cero no es una alerta
  assert.equal(nivel(0, 0, 0, true), 'agotado'); // pero si ya se movió, sí
  assert.equal(nivel(2, 10), 'critico'); // la mitad del mínimo o menos
  assert.equal(nivel(8, 10), 'bajo'); // en el mínimo o por debajo
  assert.equal(nivel(100, 5), null);
  assert.equal(nivel(10, 0, 90), 'critico'); // consume 3 al día: dura ~3 días
  assert.equal(nivel(30, 5, 60), 'bajo'); // consume 2 al día: dura 15 días
  assert.equal(nivel(40, 5, 60), 'atencion'); // dura 20 días
  assert.equal(nivel(50, 5, 60), 'atencion'); // dura 25 días
});

test('alertas de stock: el administrador ve los valores y el bodeguero no', async () => {
  await reiniciarLimites(); // esta prueba hace varios ingresos seguidos y no debe toparse con el tope por minuto
  const ids = [];
  const art = async (nombre, stock, minimo) => {
    const r = await poolInventario.query(
      `INSERT INTO articulos (nombre, codigo_barras, precio, stock, minimo)
       VALUES ($1, $2, 1000, $3, $4) RETURNING id`, [nombre, `ALR-${nombre}`, stock, minimo]);
    ids.push(r.rows[0].id);
    return r.rows[0].id;
  };
  try {
    await art('Agotado', 0, 5);
    await art('Critico', 2, 10);
    await art('Bajo', 8, 10);
    const consumo = await art('Se acaba', 50, 5);
    await art('Sobrado', 100, 5);
    await art('Nuevo en cero', 0, 0);
    await poolInventario.query(
      "INSERT INTO movimientos (articulo_id, tipo, cantidad, motivo) VALUES ($1, 'salida', 60, 'kit')", [consumo]);

    const admin = await entrar('jefe', 'Super-Segura-2026x');
    const r = await admin.http('GET', '/api/inv/alertas');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.resumen, { total: 4, agotado: 1, critico: 1, bajo: 1, atencion: 1 });
    // De la más urgente a la menos urgente.
    assert.deepEqual(r.json.alertas.map((a) => a.nombre), ['Agotado', 'Critico', 'Bajo', 'Se acaba']);
    const seAcaba = r.json.alertas.find((a) => a.nombre === 'Se acaba');
    assert.equal(seAcaba.consumo_diario, 2);
    assert.equal(seAcaba.dias_restantes, 25);
    assert.equal(seAcaba.sugerido, 10); // para cubrir 30 días (60) menos lo que hay (50)
    assert.equal(r.json.alertas[0].valor_reponer, 10000); // 10 unidades a $1.000

    // El bodeguero ve las alertas, pero sin valores en pesos.
    const bodega = await entrar('bodega', 'Bodega-Segura-2026');
    const b = await bodega.http('GET', '/api/inv/alertas');
    assert.equal(b.status, 200);
    assert.equal(b.json.alertas.length, 4);
    assert.ok(b.json.alertas.every((a) => !('valor_reponer' in a)));
    assert.equal((await bodega.http('GET', '/api/inv/alertas/resumen')).json.resumen.total, 4);

    // Un gestor de la Bitácora no entra al inventario.
    const gestor = await entrar('atlan1', '1001001001');
    assert.equal((await gestor.http('GET', '/api/inv/alertas')).status, 403);
  } finally {
    await poolInventario.query('DELETE FROM movimientos WHERE articulo_id = ANY($1)', [ids]);
    await poolInventario.query('DELETE FROM articulos WHERE id = ANY($1)', [ids]);
  }
});

test('login rechaza clave errada y bloquea el usuario tras 5 fallos', async () => {
  await reiniciarLimites();
  await query("DELETE FROM intentos_login WHERE usuario = 'bodega'");
  for (let i = 0; i < 5; i++) {
    assert.equal((await entrar('bodega', 'clave-mala')).r.status, 401);
  }
  // Bloqueado: ni siquiera la clave correcta entra.
  assert.equal((await entrar('bodega', 'Bodega-Segura-2026')).r.status, 401);
  await query("DELETE FROM intentos_login WHERE usuario = 'bodega'");
  assert.equal((await entrar('bodega', 'Bodega-Segura-2026')).r.status, 200);
  await reiniciarLimites();
});

test('sesión: sin cookie no entra, sin token CSRF no escribe y logout invalida la cookie', async () => {
  const anonimo = cliente();
  assert.equal((await anonimo('GET', '/api/unidades')).status, 401);

  const { http } = await entrar('bodega', 'Bodega-Segura-2026');
  // Una escritura sin el token CSRF se rechaza aunque la cookie sea buena.
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: http.cookie() } });
  assert.equal(res.status, 400);

  assert.equal((await http('POST', '/api/auth/logout')).status, 200);
  assert.equal((await http('GET', '/api/inv/recepcion')).status, 401);
});

// ---------------- Unidades ----------------
test('unidades: el gestor solo ve su nodo', async () => {
  const todas = await unidades.listarUnidades(COORD);
  assert.equal(todas.items.length, 3);
  const mias = await unidades.listarUnidades(G1);
  assert.deepEqual(mias.items.map((u) => u.id_unico), ['1', '2']);
  assert.equal(mias.items[0].rep_documento, '111');
  assert.equal(mias.items[0].up_nombre, 'UP 1');
});

test('unidad detalle con forma de documento y alcance', async () => {
  const r = await unidades.obtenerUnidad(COORD, { id: 'UP-3' });
  assert.equal(r.item.datos_representante.documento, '333');
  assert.equal(r.item.datos_up.nombre, 'UP 3');
  assert.deepEqual(r.item.datos_representante.documentos_rit, []);
  await rechaza(unidades.obtenerUnidad(G1, { id: 'UP-3' }), 404);
  assert.equal((await unidades.obtenerUnidad(G1, { id: '1' })).item.id, 'UP-1');
});

test('gestores: cédula solo para el coordinador general', async () => {
  const c = await unidades.listarGestores(COORD);
  assert.ok(c.items.every((g) => g.cedula));
  const d = await unidades.listarGestores(COMPRAS);
  assert.ok(d.items.every((g) => g.cedula === null));
  await rechaza(unidades.listarGestores(G1), 403);
});

// ---------------- Documentos ----------------
test('documentos: lista liviana y detalle anidado', async () => {
  const l = await documentos.listarDocumentos(COORD);
  assert.equal(l.items.length, 2);
  const f = l.items.find((x) => x.id_unico === '1');
  assert.equal(f.v1_completa, true);
  assert.equal(f.b00_completa, null);
  assert.deepEqual(f.compra_checks, [{ item: 'Acta', estado: 'ok' }]);
  assert.equal(f.pdf_carrito, 'Cargado');
  assert.equal((await documentos.listarDocumentos(G2)).items.length, 1);

  const d = await documentos.obtenerDocumento(COORD, { id: 'UP-1' });
  assert.equal(d.item.visita1.modalidad, 'Presencial');
  assert.ok(d.item.visita1.fecha_visita);
  assert.equal(d.item.fortalecimiento.modulos.modulo2.completa, true);
  assert.equal(d.item.cotizaciones.ganadora.archivos[0].nombre, 'a.pdf');
  assert.equal(d.item.rit.tiene_rit, true);
  await rechaza(documentos.obtenerDocumento(COORD, { id: 'UP-2' }), 404);
});

test('cargue: solo coordinador_datos; cuenta actualizados, iguales y no encontrados', async () => {
  await rechaza(documentos.aplicarCargue(LOCAL_R1, { campo: 'proceso_subsanacion', filas: [] }), 403);
  await rechaza(documentos.aplicarCargue(DATOS, { campo: 'otro', filas: [] }), 400);
  const r = await documentos.aplicarCargue(DATOS, {
    campo: 'proceso_subsanacion',
    filas: [{ id_unico: 1, valor: 'En curso' }, { id_unico: 3, valor: null }, { id_unico: 2, valor: 'x' },
      { id_unico: 99, valor: 'x' }, { valor: 'sin id' }],
  });
  assert.equal(r.actualizados, 1);
  assert.equal(r.sin_cambios, 1);
  assert.deepEqual(r.no_encontrados.sort(), ['2', '99']);
  assert.equal(r.invalidos, 1);
  const again = await documentos.aplicarCargue(DATOS, { campo: 'proceso_subsanacion', filas: [{ id_unico: '1', valor: 'En curso' }] });
  assert.equal(again.sin_cambios, 1);
});

test('convocatoria: una llamada agendada vence si pasa su hora y queda sin efecto si su módulo ya se realizó', async () => {
  const { enElTiempo, confirmacionesDeModulo } = await import('../src/convocatoriaLlamadas.js');
  const enc = [{ modulo: 1, inicio: '2026-03-01T14:00:00Z', realizado_en: '2026-03-01T17:30:00Z' }, { modulo: 2, inicio: '2026-03-08T14:00:00Z', realizado_en: null }];
  const ahora = new Date('2026-03-05T12:00:00Z').getTime();
  const ag = (extra) => ({ id_up: 7, estado: 'agendada', modulo: null, inicio: '2026-03-06T15:00:00Z', ...extra });
  assert.deepEqual([enElTiempo(ag(), enc, ahora).vencida, enElTiempo(ag(), enc, ahora).sin_efecto], [false, false]);
  assert.equal(enElTiempo(ag({ inicio: '2026-03-04T15:00:00Z' }), enc, ahora).vencida, true, 'pasó su hora sin resultado');
  assert.equal(enElTiempo(ag({ modulo: 1, inicio: '2026-02-27T15:00:00Z' }), enc, ahora).sin_efecto, true, 'su módulo ya se realizó');
  assert.equal(enElTiempo(ag({ modulo: 1, inicio: '2026-02-27T15:00:00Z' }), enc, ahora).vencida, false, 'sin efecto manda sobre vencida');
  assert.equal(enElTiempo(ag(), enc.map((e) => ({ ...e, realizado_en: '2026-03-09T00:00:00Z' })), ahora).sin_efecto, true, 'de todo el taller: los tres realizados');
  assert.equal(enElTiempo({ ...ag({ inicio: '2026-03-04T15:00:00Z' }), estado: 'no_contesto' }, enc, ahora).vencida, false, 'solo vencen las agendadas');
  assert.equal(confirmacionesDeModulo([ag({ inicio: '2026-03-04T15:00:00Z' })], 2, enc)[7].situacion, 'vencida');
});

test('histórico de la BASE MASTER: quién, cuándo, qué cambió y el archivo; solo lo consulta el Coordinador general', async () => {
  await rechaza(historialSubs.iniciarHistorial(LOCAL_R1, { origen: 'subsanacion' }, await archivoTemporal('M.xlsx')), 403);
  await rechaza(historialSubs.iniciarHistorial(DATOS, { origen: 'otro' }, await archivoTemporal('M.xlsx')), 400);
  await rechaza(historialSubs.iniciarHistorial(DATOS, { origen: 'subsanacion' }, await archivoTemporal('M.pdf')), 400);
  const { id } = await historialSubs.iniciarHistorial(DATOS, { origen: 'subsanacion', filas: '2' },
    await archivoTemporal('BASE MASTER EP.xlsx', 'hoja up'));
  await documentos.aplicarCargue(DATOS, {
    campo: 'proceso_subsanacion', historial: id, filas: [{ id_unico: 1, valor: 'Subsanado' }, { id_unico: 99, valor: 'x' }],
  });
  // La entrada es de quien la abrió: otro no le suma lotes.
  await rechaza(documentos.aplicarCargue(COORD, { campo: 'proceso_subsanacion', historial: id, filas: [] }), 400);

  await rechaza(historialSubs.listarHistorial(DATOS), 403);
  const h = (await historialSubs.listarHistorial(COORD)).items.find((x) => x.id === id);
  assert.equal(h.usuario_nombre, 'Datos');
  assert.equal(h.usuario_rol, 'coordinador_datos');
  assert.equal(h.origen, 'subsanacion');
  assert.equal(h.archivo_nombre, 'BASE MASTER EP.xlsx');
  assert.ok(h.fecha);
  assert.deepEqual([h.filas, h.actualizados, h.sin_cambios, h.no_encontrados], [2, 1, 0, 1]);
  const c = await historialSubs.cambiosDeHistorial(COORD, { id });
  assert.deepEqual(c.items.map(({ id_unico, antes, despues }) => ({ id_unico, antes, despues })),
    [{ id_unico: '1', antes: 'En curso', despues: 'Subsanado' }]);
  assert.equal((await historialSubs.cambiosDeHistorial(COORD, { id, q: 'nada así' })).total, 0);
  const a = await historialSubs.archivoDeHistorial(COORD, { id });
  assert.equal((await fs.readFile(a.ruta, 'utf8')).slice(4), 'hoja up');
  await rechaza(historialSubs.archivoDeHistorial(DATOS, { id }), 403);
  // Se deja como estaba para las pruebas que siguen.
  await documentos.aplicarCargue(DATOS, { campo: 'proceso_subsanacion', filas: [{ id_unico: 1, valor: 'En curso' }] });
});

// ---------------- Visitas ----------------
// ---------------- Eventos y novedades ----------------
test('eventos: coordinación crea; gestor responde solo lo suyo', async () => {
  const ev = await com.guardarEvento(COORD, {
    id: 'evt_1', titulo: 'Asamblea', tipo: 'asamblea', fecha: '2026-10-20', hora: '09:00',
    respuestas: { ATLAN1: { valor: null, comentario: '', foto: '' }, BOLIV1: { valor: null } },
    destinatarios: ['ATLAN1', 'BOLIV1'],
  });
  assert.deepEqual(ev.item.destinatarios.sort(), ['ATLAN1', 'BOLIV1']);
  // El gestor lee y responde los de su nodo, pero no crea, edita ni elimina (matriz: Eventos GES = P).
  await rechaza(com.guardarEvento(G1, { id: 'evt_2', titulo: 'x' }), 403);
  await rechaza(com.eliminarEvento(G1, { id: 'evt_1' }), 403);

  await com.responderEvento(G1, { id: 'evt_1', nodo: 'BOLIV1', respuesta: { valor: 'si', comentario: 'voy' } });
  const lista = await com.listarEventos(COORD);
  const e = lista.items[0];
  assert.equal(e.respuestas.ATLAN1.valor, 'si', 'el gestor escribe en su propio nodo aunque pida otro');
  assert.equal(e.respuestas.BOLIV1.valor, null);

  // Al editar, coordinación no pisa las respuestas ya dadas.
  await com.guardarEvento(COORD, { ...e, titulo: 'Asamblea (editada)', respuestas: { ATLAN1: { valor: null }, BOLIV1: {} } });
  const vistaG = await com.listarEventos(G1);
  assert.equal(vistaG.items[0].titulo, 'Asamblea (editada)');
  assert.equal(vistaG.items[0].respuestas.ATLAN1.valor, 'si');
  assert.deepEqual(Object.keys(vistaG.items[0].respuestas), ['ATLAN1']);

  // Quitar un destinatario.
  await com.guardarEvento(COORD, { ...e, destinatarios: ['ATLAN1'], respuestas: {} });
  assert.equal((await com.listarEventos(G2)).items.length, 0);
  await com.eliminarEvento(COORD, { id: 'evt_1' });
  assert.equal((await com.listarEventos(COORD)).items.length, 0);
});

// ---------------- Archivos (visor del carrito) ----------------
test('archivos: listado por prefijo exacto y alcance del gestor', async () => {
  const up1 = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico = '1'")).rows[0].id_up;
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: '111_20260901_101010_OK.pdf', archivo: await archivoTemporal('a.pdf'), idUp: up1 });
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: '1110_20260901_101010_OK.pdf', archivo: await archivoTemporal('b.pdf') });
  const r = await archivos.listarPorPrefijo(COORD, { contenedor: 'carritos', prefijo: '111' });
  assert.equal(r.blobs.length, 2);
  const g = await archivos.listarPorPrefijo(G1, { contenedor: 'carritos', prefijo: '111' });
  assert.deepEqual(g.blobs.map((b) => b.name), ['111_20260901_101010_OK.pdf']);
  // LIKE no interpreta comodines del usuario.
  assert.equal((await archivos.listarPorPrefijo(COORD, { contenedor: 'carritos', prefijo: '%' })).blobs.length, 0);
  // Reemplazo: mismo nombre, nuevo contenido.
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: '111_20260901_101010_OK.pdf', archivo: await archivoTemporal('a.pdf', '%PDF-1.4 v2'), idUp: up1 });
  const a = await archivos.obtenerArchivo(COORD, { contenedor: 'carritos', nombre: '111_20260901_101010_OK.pdf' });
  assert.equal(await fs.readFile(a.ruta, 'utf8'), '%PDF-1.4 v2');
  // Un nombre con "../" no escapa del almacén: se normaliza.
  const raro = await archivos.guardarArchivo({ contenedor: 'carritos', nombre: '../../x.pdf', archivo: await archivoTemporal('x.pdf') });
  assert.equal(raro.nombre, 'x.pdf');
  const rx = await archivos.obtenerArchivo(COORD, { contenedor: 'carritos', nombre: 'x.pdf' });
  assert.ok(rx.ruta.startsWith(path.resolve(process.env.STORAGE_DIR)));
});

// ---------------- Validador ----------------
// ---------------- Agenda ----------------
test('agenda: el gestor agenda en su nodo, ve solo lo suyo y se avisan los cruces', async () => {
  const inicio = '2026-11-03T15:00:00.000Z';
  const a = await agenda.guardarCita(G1, {
    id_unico: '1', tipo: 'llamada', inicio, duracion_min: 30, telefono: '3100000000', contacto: 'María',
  });
  assert.equal(a.item.estado, 'agendada');
  assert.equal(a.item.telefono, '3100000000');
  assert.equal(a.choques, 0);

  // Otra cita del mismo nodo que se pisa con la primera: se guarda, pero avisa.
  const b = await agenda.guardarCita(G1, { id_unico: '2', inicio: '2026-11-03T15:15:00.000Z' });
  assert.equal(b.choques, 1);

  // El gestor de otro nodo no agenda en una iniciativa ajena ni toca su cita.
  await rechaza(agenda.guardarCita(G2, { id_unico: '1', inicio }), 403);
  await rechaza(agenda.cambiarEstadoCita(G2, { id: a.item.id, estado: 'cancelada' }), 403);

  // Cada quien ve lo suyo; la coordinación ve todo.
  assert.equal((await agenda.listarCitas(G1)).items.length, 2);
  assert.equal((await agenda.listarCitas(G2)).items.length, 0);
  assert.equal((await agenda.listarCitas(COORD)).items.length, 2);
  assert.equal((await agenda.listarCitas(COORD, { nodo: 'BOLIV1' })).items.length, 0);

  // Reagendar cambia la hora, la deja agendada y anota el cambio.
  const r = await agenda.cambiarEstadoCita(G1, { id: a.item.id, inicio: '2026-11-04T16:00:00.000Z' });
  assert.equal(r.item.estado, 'agendada');
  assert.equal(r.item.historial.length, 1);
  assert.equal(r.item.historial[0].por, G1.nombre);

  // Resultado de una llamada.
  const n = await agenda.cambiarEstadoCita(G1, { id: b.item.id, estado: 'no_contesto', notas: 'No contestó' });
  assert.equal(n.item.estado, 'no_contesto');
  assert.equal(n.item.notas, 'No contestó');

  // Datos inválidos.
  await rechaza(agenda.guardarCita(G1, { id_unico: '1' }), 400); // sin hora
  await rechaza(agenda.guardarCita(G1, { id_unico: '1', inicio, tipo: 'baile' }), 400);
  await rechaza(agenda.guardarCita(G1, { id_unico: '1', inicio, duracion_min: 1 }), 400);

  // Los números a los que se puede llamar en la iniciativa (el representante de la prueba no traía teléfono).
  await query("UPDATE representantes SET telefono1 = '3100000000' WHERE documento = '111'");
  const c = await agenda.contactosIniciativa(G1, { id_unico: '1' });
  assert.ok(c.contactos.some((x) => x.rol === 'Representante'));
  await rechaza(agenda.contactosIniciativa(G2, { id_unico: '1' }), 403);

  // Compras no usa la agenda.
  await rechaza(agenda.listarCitas(COMPRAS), 403);

  await agenda.eliminarCita(G1, { id: a.item.id });
  await agenda.eliminarCita(COORD, { id: b.item.id });
  assert.equal((await agenda.listarCitas(COORD)).items.length, 0);
});

// ---------------- Catálogo y carrito ----------------
test('catálogo: la coordinación lo importa desde un CSV y se puede volver a importar', async () => {
  const csv = [
    'Código;Nombre;Precio;IVA;Tipología;Sector',
    'M-1;Mesa de trabajo;"$ 250.000";19%;Carpintería;Manufactura',
    'M-2;Silla;80000;0,19;Carpintería;Manufactura',
    ';Sin precio;;;;',
  ].join('\n');
  const r = await catalogo.importarCatalogo(COORD, await archivoTemporal('catalogo.csv', csv, 'text/csv'));
  assert.equal(r.creados, 2);
  assert.equal(r.errores.length, 1);
  assert.equal(r.omitidos, 1);

  // Volver a importar actualiza, no duplica.
  const otra = await catalogo.importarCatalogo(COORD, await archivoTemporal('catalogo.csv', csv, 'text/csv'));
  assert.equal(otra.creados, 0);
  assert.equal(otra.actualizados, 2);

  const lista = await catalogo.listarCatalogo(G1, { q: 'mesa' });
  assert.equal(lista.items.length, 1);
  assert.equal(lista.items[0].precio, 250000);
  assert.equal(lista.items[0].iva, 19);
  assert.deepEqual(lista.facetas.tipologias, ['Carpintería']);

  // Solo la coordinación importa y modifica; compras y gestores consultan.
  await rechaza(catalogo.importarCatalogo(G1, await archivoTemporal('x.csv', csv, 'text/csv')), 403);
  await rechaza(catalogo.guardarProducto(G1, { nombre: 'Algo', precio: 1 }), 403);
  assert.equal((await catalogo.listarCatalogo(COMPRAS)).total, 2);

  // Un producto eliminado deja de ofrecerse.
  await catalogo.eliminarProducto(COORD, { id: lista.items[0].id_producto });
  assert.equal((await catalogo.listarCatalogo(G1, { q: 'mesa' })).items.length, 0);
});

// ---- E8: lo que el plan de capitalización necesita para enviarse y aprobarse (las U.P. de prueba son M1) ----
const planCap = await import('../src/servicios/planCapitalizacion.js');
const PLAN_COMPLETO = {
  social: ['Vincular a dos jóvenes del barrio'], economica: ['Aumentar las ventas un 20 %'], empresarial: ['Llevar los registros contables'],
  propuesta_valor: 'Pan artesanal a domicilio en la vereda', asistencia_tecnica: ['Costos y precios'],
  mercadeo: { segmento: 'Familias del barrio', canales: 'Venta directa y domicilios', precio: 'Precio justo por calidad', promocion: 'Redes sociales', distribucion: 'A domicilio en moto' },
  plan_accion: [{ accion: 'Comprar el horno', responsable: 'Representante', fecha: '2026-12-01' }],
  riesgos: [{ riesgo: 'Alza de insumos', nivel: 'medio', mitigacion: 'Comprar por volumen' }],
};
const ADECUACIONES_OK = { electricas: { estado: 'cumple' }, ventilacion: { estado: 'cumple' }, espacio: { estado: 'no_aplica' } };
function diaColombia() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()); }
async function ultimaActividadCarrito(accion) {
  return (await query('SELECT * FROM actividad WHERE accion = $1 ORDER BY id DESC LIMIT 1', [accion])).rows[0];
}
async function proveedoresE8() {
  for (const n of ['A', 'B', 'C', 'D']) {
    await query('INSERT INTO inventario.proveedores (nombre, codigo) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING', [`Proveedor E8 ${n}`, `E8-${n}`]);
  }
  return (await query("SELECT id FROM inventario.proveedores WHERE codigo LIKE 'E8-%' ORDER BY codigo")).rows.map((r) => r.id);
}
async function firmarPlan(u, idUnico) {
  const codigo = (await carrito.detalleCarrito(u, { id_unico: idUnico })).carrito.codigo_plan;
  return planCap.registrarFirma(u, { id_unico: idUnico, codigo_plan: codigo, firma_up_nombre: 'Representante de la UP', firma_up_fecha: diaColombia(),
    firma_consultor_nombre: 'Gestora 1', firma_consultor_fecha: diaColombia() }, await archivoTemporal('firmado.pdf', '%PDF-1.4 plan firmado'));
}
// Plan de negocio, adecuaciones, libro contable (M1), tres cotizaciones al precio de cada línea con la primera elegida y la firma.
async function prepararEnvio(u, idUnico) {
  await planCap.guardarPlanNegocio(u, { id_unico: idUnico, plan: PLAN_COMPLETO });
  await planCap.guardarAdecuaciones(u, { id_unico: idUnico, adecuaciones: ADECUACIONES_OK });
  let v = await carrito.detalleCarrito(u, { id_unico: idUnico });
  if (v.carrito.modalidad === 'M1') v = await carrito.guardarDatos(u, { id_unico: idUnico, libro_contable: true });
  const prov = await proveedoresE8();
  for (const l of v.lineas) {
    for (const p of prov.slice(0, 3).filter((id) => !l.cotizaciones.some((c) => c.id_proveedor === id))) {
      await planCap.agregarCotizacion(u, { id_unico: idUnico, id_linea: l.id, id_proveedor: p, valor_unitario: l.precio, fecha: diaColombia() },
        await archivoTemporal('cotizacion.pdf', '%PDF-1.4 cotizacion'));
    }
    const c = (await carrito.detalleCarrito(u, { id_unico: idUnico })).lineas.find((x) => x.id === l.id).cotizaciones[0];
    if (!c.elegida) await planCap.elegirCotizacion(u, { id_unico: idUnico, id_cotizacion: c.id });
  }
  return firmarPlan(u, idUnico);
}
// ---- E9: el plan hasta la aprobación del comité ----
const flujoPlanSrv = await import('../src/servicios/flujoPlan.js');
const INTEGRANTES = [{ nombre: 'Ana PS', entidad: 'Prosperidad Social' }, { nombre: 'Luis PS', entidad: 'Prosperidad Social' }, { nombre: 'Marta INNPULSA', entidad: 'INNPULSA' }];
// Formación con el 80 % sembrada en la base de pruebas: tres módulos asistidos, encuesta de salida y entrega final.
async function formacionCompleta(idUnico) {
  const { rows: [up] } = await query('SELECT id_up, id_unico, nombre FROM unidades_productivas WHERE id_unico = $1', [idUnico]);
  if ((await carrito.formacionCumple({ query }, up.id_up)).cumple) return null;
  const { rows: [t] } = await query(`INSERT INTO talleres_fortalecimiento (nombre, nodo, region, municipio, lugar, tallerista_sub, tallerista_nombre, participantes, creado_por)
    VALUES ('Formación de prueba ' || $1::text, 'ATLAN1', 'Región 1', 'Barranquilla', 'Sede', 'coordinador:0', 'Prueba', $2, 'pruebas') RETURNING id`,
  [idUnico, JSON.stringify([{ id_up: up.id_up, id_unico: up.id_unico, nombre: up.nombre }])]);
  for (const m of [1, 2, 3]) {
    await query(`INSERT INTO talleres_encuentros (taller_id, modulo, inicio, tallerista_sub, tallerista_nombre, realizado_en, asistencia)
      VALUES ($1, $2, now() - interval '30 days', 'coordinador:0', 'Prueba', now(), $3)`, [t.id, m, JSON.stringify([`up:${up.id_up}`])]);
  }
  await query("INSERT INTO talleres_encuestas (taller_id, id_up, tipo, modulo, respuestas, registrado_por) VALUES ($1, $2, 'apropiacion_salida', 0, '{}', 'pruebas')", [t.id, up.id_up]);
  await query("INSERT INTO talleres_entregas_finales (taller_id, id_up, nombre, archivo, creado_por) VALUES ($1, $2, 'entrega.pdf', $3, 'pruebas')", [t.id, up.id_up, Buffer.from('%PDF-1.4')]);
  return t.id;
}
async function borrarFormacionDePrueba() {
  const ids = (await query("SELECT id FROM talleres_fortalecimiento WHERE nombre LIKE 'Formación de prueba %'")).rows.map((r) => r.id);
  for (const tabla of ['talleres_entregas_finales', 'talleres_encuestas', 'talleres_encuentros']) await query(`DELETE FROM ${tabla} WHERE taller_id = ANY($1)`, [ids]);
  await query('DELETE FROM talleres_fortalecimiento WHERE id = ANY($1)', [ids]);
}
async function comite(idUnicos, calificaciones = [4, 4, 4], extra = {}) {
  return flujoPlanSrv.registrarComite(COORD, { fecha: diaColombia(), integrantes: JSON.stringify(INTEGRANTES),
    planes: JSON.stringify(idUnicos.map((id) => ({ id_unico: id, calificaciones }))), ...extra }, await archivoTemporal('acta.pdf', '%PDF-1.4 acta del comite'));
}
const vistoBueno = async (u, idUnico, extra = {}) => flujoPlanSrv.registrarViabilidad(u, { id_unico: idUnico, viable: 'si', fecha: diaColombia(), responsable: 'Interventoría de prueba', ...extra },
  await archivoTemporal('visto-bueno.pdf', '%PDF-1.4 visto bueno'));
// Lleva el plan, desde donde esté, hasta «aprobado» por el comité.
async function aprobarPorComite(idUnico) {
  await formacionCompleta(idUnico);
  let v = await carrito.detalleCarrito(COORD, { id_unico: idUnico });
  if (['borrador', 'devuelto'].includes(v.carrito.estado)) { await prepararEnvio(G1, idUnico); v = await carrito.cambiarEstado(G1, { id_unico: idUnico, estado: 'enviado' }); }
  if (v.carrito.estado === 'enviado') { await evaluarActivos(idUnico); v = await carrito.cambiarEstado(COORD, { id_unico: idUnico, estado: 'revisado' }); }
  if (v.carrito.estado === 'revisado') v = await vistoBueno(COORD, idUnico);
  await comite([idUnico]);
  return carrito.detalleCarrito(COORD, { id_unico: idUnico });
}
// La coordinación marca cada activo coherente y pertinente.
async function evaluarActivos(idUnico) {
  for (const l of (await carrito.detalleCarrito(COORD, { id_unico: idUnico })).lineas) {
    await planCap.evaluarActivo(COORD, { id_unico: idUnico, id_linea: l.id, coherente: true, pertinente: true });
  }
}

test('carrito: el gestor arma el suyo dentro del presupuesto y la coordinación lo aprueba', async () => {
  const horno = (await catalogo.guardarProducto(COORD, {
    nombre: 'Horno industrial', precio: '$ 1.000.000', iva: 19, tipologia: 'Panadería', sector: 'Alimentos',
  })).id_producto;
  const bandeja = (await catalogo.guardarProducto(COORD, { nombre: 'Bandeja', precio: 50000, iva: 0 })).id_producto;

  // Sin presupuesto definido se puede agregar; el IVA se suma al total.
  let v = await carrito.ponerLinea(G1, { id_unico: '1', id_producto: horno, cantidad: 1 });
  assert.equal(v.carrito.estado, 'borrador');
  assert.equal(v.resumen.total, 1190000);
  assert.equal(v.carrito.presupuesto_maximo, null);

  // El presupuesto y el transporte los define solo la coordinación.
  await rechaza(carrito.guardarDatos(G1, { id_unico: '1', presupuesto_maximo: 5000000 }), 403);
  // ET3-04: el presupuesto no pasa del tope de la modalidad (M1: $5.000.000); sin fijarlo, es el tope.
  assert.equal(v.resumen.presupuesto_maximo, 5000000);
  assert.equal(v.resumen.tope_modalidad, 5000000);
  await rechazaCon(carrito.guardarDatos(COORD, { id_unico: '1', presupuesto_maximo: 5000001 }), 400, /unidad M1 no puede pasar de \$ 5\.000\.000/);
  // ET3-05: en M1 el transporte es una bolsa aparte: no sale del presupuesto aunque se pida descontarlo.
  v = await carrito.guardarDatos(COORD, {
    id_unico: '1', presupuesto_maximo: 1500000, monto_transporte: 100000, transporte_descontado: true,
  });
  assert.equal(v.resumen.presupuesto_productos, 1500000);
  assert.deepEqual([v.resumen.transporte, v.resumen.transporte_m1, v.carrito.transporte_descontado], [0, 100000, false]);
  assert.equal(v.resumen.saldo, 310000);
  assert.deepEqual((await ultimaActividadCarrito('carrito.datos')).cambios.presupuesto, [null, 1500000]);

  // Agregar de más se rechaza y no deja nada a medias; lo que cabe, entra.
  await rechaza(carrito.ponerLinea(G1, { id_unico: '1', id_producto: horno, cantidad: 1 }), 409);
  assert.equal((await carrito.detalleCarrito(G1, { id_unico: '1' })).resumen.total, 1190000);
  v = await carrito.ponerLinea(G1, { id_unico: '1', id_producto: bandeja, cantidad: 4 });
  assert.equal(v.resumen.saldo, 110000);
  assert.equal(v.lineas.length, 2);

  // Cada gestor ve solo su nodo; compras consulta pero no edita.
  await rechaza(carrito.detalleCarrito(G2, { id_unico: '1' }), 403);
  const deCompras = await carrito.detalleCarrito(COMPRAS, { id_unico: '1' });
  assert.equal(deCompras.carrito.puede_editar, false);
  await rechaza(carrito.ponerLinea(COMPRAS, { id_unico: '1', id_producto: bandeja, cantidad: 1 }), 403);

  // Quitar una línea (fijar en 0) siempre se puede.
  v = await carrito.ponerLinea(G1, { id_unico: '1', id_producto: bandeja, cantidad: 0, modo: 'fijar' });
  assert.equal(v.lineas.length, 1);

  // Sin clase UNSPSC ni rubro no se envía (E2); clasificado, sí.
  await assert.rejects(carrito.cambiarEstado(G1, { id_unico: '1', estado: 'enviado' }),
    (e) => e.status === 400 && /no tiene clase UNSPSC; no tiene rubro capitalizable/.test(e.message));
  await query("INSERT INTO unspsc_clases (codigo, nombre) VALUES ('481015', 'Equipos de cocina industrial') ON CONFLICT DO NOTHING");
  await catalogo.guardarProducto(COORD, { id_producto: horno, nombre: 'Horno industrial', precio: 1000000, iva: 19,
    tipologia: 'Panadería', sector: 'Alimentos', unspsc: '481015', rubro: 'dotacion_maquinaria' });

  // El gestor envía (con el plan de capitalización completo, E8); ya enviado no lo cambia ni lo aprueba él mismo.
  await prepararEnvio(G1, '1');
  v = await carrito.cambiarEstado(G1, { id_unico: '1', estado: 'enviado' });
  assert.equal(v.carrito.estado, 'enviado');
  assert.equal(v.carrito.puede_editar, false);
  await rechaza(carrito.ponerLinea(G1, { id_unico: '1', id_producto: bandeja, cantidad: 1 }), 403);
  await rechaza(carrito.cambiarEstado(G1, { id_unico: '1', estado: 'revisado' }), 403);
  await rechaza(carrito.cambiarEstado(COMPRAS, { id_unico: '1', estado: 'revisado' }), 403);
  await rechaza(carrito.cambiarEstado(G1, { id_unico: '1', estado: 'aprobado' }), 403);

  // La coordinación lo devuelve (el gestor puede corregir); el gestor lo envía de nuevo y la coordinación lo revisa.
  await carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'devuelto' });
  assert.equal((await carrito.detalleCarrito(G1, { id_unico: '1' })).carrito.puede_editar, true);
  await evaluarActivos('1');
  await rechazaCon(carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'revisado' }), 409, /No se puede marcar como revisado un plan devuelto/);
  await carrito.cambiarEstado(G1, { id_unico: '1', estado: 'enviado' });
  v = await carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'revisado' });
  assert.equal(v.carrito.estado, 'revisado');

  // El tablero: cada rol ve los carritos de su alcance.
  assert.equal((await carrito.listarCarritos(COORD)).items.length, 1);
  assert.equal((await carrito.listarCarritos(G1)).items[0].total, 1190000);
  assert.equal((await carrito.listarCarritos(G2)).items.length, 0);
  assert.equal((await carrito.listarCarritos(COORD, { estado: 'borrador' })).items.length, 0);

  // Aprobado, ni la coordinación lo cambia sin reabrirlo.
  await rechazaCon(carrito.vaciarCarrito(COORD, { id_unico: '1' }), 409, /revisado por la coordinación: devuélvelo para cambiarlo/);
  // Reabrir un plan que ya pasó de «enviado» exige el motivo (revisión E9).
  await rechazaCon(carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'borrador' }), 400, /motivo para reabrir/);
  await carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'borrador', motivo: 'Se reabre para ajustar las cantidades' });

  // Un carrito vacío no se envía.
  await carrito.vaciarCarrito(COORD, { id_unico: '1' });
  await rechaza(carrito.cambiarEstado(COORD, { id_unico: '1', estado: 'enviado' }), 400);

  await query("DELETE FROM carritos WHERE codigo_iniciativa = '1'");
  await query('DELETE FROM catalogo_productos WHERE id_producto = ANY($1)', [[horno, bandeja]]);
});


test('validador: check, carga inicial, revisión, corrección y completo', async () => {
  let r = await validador.procesar(G1, { action: 'check', cedula: '111' });
  assert.equal(r.cuerpo.exito, true);
  assert.equal(r.cuerpo.estado_validacion, 'pendiente');
  r = await validador.procesar(G2, { action: 'check', cedula: '111' }).catch((e) => e);
  assert.equal(r.status, 403);
  r = await validador.procesar(G1, { action: 'check', cedula: '999' });
  assert.equal(r.cuerpo.exito, false);

  // Carga inicial incompleta.
  r = await validador.procesar(G1, { action: 'upload', cedula: '111', modo_cedula: 'pdf' },
    { archivo_orden: await archivoTemporal('o.pdf') });
  assert.equal(r.cuerpo.exito, false);
  assert.match(r.cuerpo.mensaje, /Faltan soportes/);

  // Tipo de archivo errado.
  const completos = async () => ({
    archivo_cedula_pdf: await archivoTemporal('ced.pdf'),
    archivo_orden: await archivoTemporal('o.pdf'),
    archivo_entrega: await archivoTemporal('e.pdf'),
    archivo_satisfaccion: await archivoTemporal('s.pdf'),
    archivo_registro_fotografico: await archivoTemporal('r.pdf'),
    archivo_video: await archivoTemporal('v.mp4', 'video', 'video/mp4'),
  });
  const malos = await completos();
  malos.archivo_orden = await archivoTemporal('o.docx');
  r = await validador.procesar(G1, { action: 'upload', cedula: '111', modo_cedula: 'pdf' }, malos);
  assert.match(r.cuerpo.mensaje, /PDF/);

  r = await validador.procesar(G1, { action: 'upload', cedula: '111', modo_cedula: 'pdf' }, await completos());
  assert.equal(r.cuerpo.exito, true);
  assert.equal(r.cuerpo.estado_validacion, 'en_revision');

  r = await validador.procesar(G1, { action: 'check', cedula: '111' });
  assert.equal(r.cuerpo.documentos_cargados.length, 5);
  const orden = r.cuerpo.documentos_cargados.find((d) => d.clave === 'orden_pedido');
  // El frontend saca el nombre del último segmento de la URL.
  assert.equal(decodeURIComponent(orden.url.split('?')[0].split('/').pop()), 'ORDEN DE PEDIDO_111.pdf');
  const video = r.cuerpo.documentos_cargados.find((d) => d.clave === 'video_entrega');
  assert.match(video.url, /VIDEO%20ENTREGA_111\.mp4$/);

  // Revisión: solo coordinación.
  r = await validador.procesar(G1, { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'aprobado' }).catch((e) => e);
  assert.equal(r.status, 403);
  r = await validador.procesar(COORD, { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'rechazado' });
  assert.equal(r.cuerpo.exito, false, 'el rechazo exige observación');
  r = await validador.procesar(COORD, { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'rechazado', observacion: 'Falta firma' });
  assert.equal(r.cuerpo.estado_validacion, 'correcciones');
  r = await validador.procesar(G1, { action: 'check', cedula: '111' });
  assert.deepEqual(r.cuerpo.por_corregir, [{ clave: 'orden_pedido', label: 'Formato de Orden de Pedido', observacion: 'Falta firma' }]);

  // Corrección: solo el documento observado.
  r = await validador.procesar(G1, { action: 'upload', cedula: '111' }, { archivo_orden: await archivoTemporal('o2.pdf') });
  assert.equal(r.cuerpo.exito, true);
  assert.equal(r.cuerpo.estado_validacion, 'en_revision');

  for (const clave of ['orden_pedido', 'entrega_activos', 'recibo_satisfaccion', 'registro_fotografico', 'video_entrega']) {
    r = await validador.procesar(COORD, { action: 'revisar', cedula: '111', clave, estado: 'aprobado' });
  }
  assert.equal(r.cuerpo.estado_validacion, 'completo');

  // Correos y prediligenciados.
  r = await validador.procesar(G1, { action: 'guardar_correo', cedula: '111', correo_gestor: 'g@x.co', correo_personal: 'p@x.co' });
  assert.equal(r.cuerpo.exito, true);
  r = await validador.procesar(G1, { action: 'descargar_prellenados', cedula: '111' });
  assert.equal(r.cuerpo.documentos.length, 0);
  await archivos.guardarArchivo({ contenedor: 'prellenados', nombre: '111/ORDEN.pdf', archivo: await archivoTemporal('ORDEN.pdf', '%PDF-1.4 PDF') });
  r = await validador.procesar(G1, { action: 'descargar_prellenados', cedula: '111' });
  assert.equal(r.cuerpo.documentos[0].nombre, 'ORDEN.pdf');
  assert.equal(Buffer.from(r.cuerpo.documentos[0].contenido, 'base64').toString(), '%PDF-1.4 PDF');
});

// ---------------- Sincronización con la Bitácora oficial (octubre 2026) ----------------
// ---------------- Administración del Coordinador local regional ----------------
test('coordinador local regional: administra solo lo de debajo y de su región', async () => {
  await reiniciarLimites();
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, region)
    VALUES ('C-ADM', 'coordinador', 'admin.reg', $1, 'Regional Admin', '52000010', 'Región 1')`, [await hashClave('Regional-Admin-2026')]);
  const r = await entrar('admin.reg', 'Regional-Admin-2026');
  assert.equal(r.r.status, 200);
  assert.deepEqual(r.r.json.sesion.modulos, ['bitacora', 'admin']);

  // No ve el resumen general ni nada del Coordinador general ni de otros regionales.
  assert.equal((await r.http('GET', '/api/admin/resumen')).status, 403);
  const datos = (await r.http('GET', '/api/admin/usuarios')).json;
  const usuarios = datos.usuarios.map((u) => u.usuario);
  assert.ok(usuarios.includes('ATLAN1'), 've los gestores de su región');
  assert.ok(!usuarios.includes('BOLIV1'), 'no ve los de otra región');
  assert.ok(!datos.usuarios.some((u) => u.rol === 'superadmin' || u.rol === 'coordinador'));
  assert.ok(!datos.roles.some((x) => x.rol === 'superadmin' || x.rol === 'coordinador'));

  // No puede crear ni editar hacia arriba.
  assert.equal((await r.http('POST', '/api/admin/usuarios', { rol: 'coordinador', usuario: 'otro.reg', nombre: 'X', clave: 'Otra-Clave-Larga-88', region: 'Región 1' })).status, 403);
  const jefe = (await (await entrar('jefe', 'Super-Segura-2026x')).http('GET', '/api/admin/usuarios')).json.usuarios.find((u) => u.rol === 'superadmin');
  assert.equal((await r.http('POST', `/api/admin/usuarios/superadmin/${jefe.id}/estado`)).status, 404);

  // Un técnico nuevo queda dentro de su región aunque pida otra.
  const alta = await r.http('POST', '/api/admin/usuarios', { rol: 'tecnico_administrativo', usuario: 'tec.reg', nombre: 'Técnico', clave: 'Tecnico-Clave-2026', region: 'Región 2' });
  assert.equal(alta.status, 200);
  const { rows } = await query("SELECT region FROM coordinadores WHERE usuario = 'tec.reg'");
  assert.equal(rows[0].region, 'Región 1');
  assert.equal((await r.http('GET', '/api/admin/accesos')).status, 200);
});

// Un PNG mínimo para las pruebas de archivos.
const png = () => Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(32)]);

// ---------------- Visitas V1 → V3 ----------------
const docVisita = (extra = {}) => ({
  id: '111_v1',
  unidad: { id_unico: '1', nombre: 'UP 1', documento: '111', modalidad: 'M1' },
  visita: { tipo: 'v1', nombre: 'Visita 1 — Caracterización', carpeta: '01_VISITA_1_CARACTERIZACION' },
  programacion: { contacto_logrado: 'SI', intentos_llamada: 2, resultado_llamada: 'AGENDADA', fecha_visita: '2026-10-10', hora_visita: '09:30', fechas_anteriores: [] },
  alistamiento: { confirmado_en: null, documentos_visita_obligatorios: { 'Acta de Visita 1': true } },
  realizacion: { estado: null },
  soportes: {},
  cierre: { cerrada: false },
  registro: {},
  ...extra,
});
const guardarV = (u, doc, extra = {}) => visitas.guardarVisita(u, { visita: doc, ...extra });
// E4: para cerrar la Visita 1 el diagnóstico debe tener verificación, socialización y caracterización.
const diagnostico = await import('../src/servicios/diagnostico.js');
// Día de Colombia: el servidor compara las fechas con hoyColombia() (después de las 7 p. m. el día UTC ya es otro).
const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const SECCIONES_V1_PRUEBA = (modalidad) => ({
  verificacion: { existe: 'si', funciona: 'si', informacion_veraz: 'si', fecha: hoyIso() },
  socializacion: { realizada: 'si', fecha: hoyIso() },
  identificacion: { nombre_iniciativa: 'Iniciativa de prueba', modalidad, departamento: 'Atlántico', municipio: 'Barranquilla', direccion: 'Calle 1 # 2-3', zona: 'urbana' },
  formalizacion: { camara_comercio: 'no', rut: 'si', nit: '900123456', fecha_certificado: hoyIso() },
  actividad: { tipo_actividad: 'produccion', productos_servicios: 'Pan artesanal', volumen_produccion: 100, unidad_volumen: 'unidades', periodo_volumen: 'diario', mercado_objetivo: 'Tiendas del barrio' },
});
// Sube de verdad un archivo por cada formato obligatorio de la visita (con los mínimos) y devuelve los soportes
// del documento: el servidor solo cuenta los archivos registrados en la tabla archivos.
const catalogoVisitas = await import('../src/servicios/catalogoVisitas.js');
async function formatosCompletos(visitaId, tipo, modalidad, usuario = G1) {
  const grupo = {};
  for (const f of catalogoVisitas.formatosDe(tipo, modalidad).filter((x) => !x.opcional)) {
    const cuantos = f.minimos?.imagen || 1;
    const ext = /Video/.test(f.nombre) ? 'mp4' : f.minimos?.imagen ? 'jpg' : 'pdf';
    grupo[f.nombre] = [];
    for (let i = 0; i < cuantos; i += 1) {
      const nombre = `${tipo}_${i}.${ext}`;
      // Las cédulas de los asociados van en un PDF con una página por asociado (se cuentan al cerrar la V1).
      const contenido = f.nombre === 'Cédulas de los asociados' ? `%PDF-1.4 ${'<< /Type /Page >> '.repeat(30)}` : 'contenido';
      const r = await visitas.subirArchivoVisita(usuario, { visita_id: visitaId, formato: f.nombre }, await archivoTemporal(nombre, contenido, 'application/octet-stream'));
      grupo[f.nombre].push({ archivo: nombre, blob: r.blob, cargado_en: new Date().toISOString(), cargado_por: 'Gestora 1' });
    }
  }
  return { documentos: grupo };
}
async function diagnosticoV1(u, idUnico, modalidad = 'M1') {
  for (const [seccion, datos] of Object.entries(SECCIONES_V1_PRUEBA(modalidad))) {
    await diagnostico.guardarSeccion(u, { id_unico: idUnico, seccion, datos });
  }
}

test('visitas: guardar, listar y alcance por nodo (el servidor decide nodo, situación y autor)', async () => {
  const g = (await guardarV(G1, docVisita({ nodo: 'BOLIV1', situacion: 'CERRADA' }))).item;
  assert.equal(g.nodo, 'ATLAN1');                       // el nodo sale de la U.P., no de lo que mande el navegador
  assert.equal(g.situacion, 'PROGRAMADA');              // se recalcula
  assert.equal(g.registro.creado_por, 'Gestora 1');
  assert.equal(g.programacion.fecha_visita, '2026-10-10');

  await rechaza(guardarV(G2, docVisita()), 403);        // gestor de otro nodo
  await rechaza(guardarV(G1, docVisita({ visita: { tipo: 'v9', nombre: 'x', carpeta: 'x' } })), 400);
  await rechaza(guardarV(G1, docVisita({ id: '999_v1', unidad: { id_unico: '999', nombre: 'x', documento: '999' } })), 400); // no existe
  await rechaza(guardarV(G1, docVisita({ id: '222_v1' })), 400);                  // el id no corresponde al documento
  await rechaza(guardarV(G1, docVisita({ unidad: { id_unico: '1', nombre: 'UP 1', documento: '' } })), 400);

  const otra = (await guardarV(G1, docVisita({ realizacion: { estado: 'PENDIENTE_SOPORTES' } }))).item;
  assert.equal(otra.situacion, 'PENDIENTE_SOPORTES');
  assert.equal(otra.registro.creado_en, g.registro.creado_en);   // la creación no cambia al editar

  assert.equal((await visitas.listarVisitas(G1, { unidad_doc: '111' })).items.length, 1);
  assert.equal((await visitas.listarVisitas(G1, { unidad_doc: '1.1.1' })).items.length, 1);   // sin puntos ni guiones
  assert.equal((await visitas.listarVisitas(G2, { unidad_doc: '111' })).items.length, 0);
  assert.equal((await visitas.listarVisitas(COORD, {})).items.length, 1);
  assert.equal((await visitas.listarVisitas(DATOS, {})).ok, true);     // como el Coordinador general
});

test('visitas: soportes — subir, abrir, quitar, tipo y tamaño', async () => {
  const f = await archivoTemporal('acta.pdf', '%PDF-1.4 prueba');
  const s = await visitas.subirArchivoVisita(G1, { visita_id: '111_v1', formato: 'Acta de Visita 1' }, f);
  assert.match(s.blob, /^111\/01_VISITA_1_CARACTERIZACION\/111_v1_\d{14}_[0-9a-f]{6}_acta\.pdf$/);

  // El soporte queda en el documento cuando el gestor guarda.
  const sop = { archivo: 'acta.pdf', blob: s.blob, peso_bytes: 15, cargado_en: '2026-10-10T10:00:00Z', cargado_por: 'Gestora 1' };
  const g = (await guardarV(G1, docVisita({ soportes: { documentos_visita_obligatorios: { 'Acta de Visita 1': [sop] } } }))).item;
  assert.equal(g.soportes.documentos_visita_obligatorios['Acta de Visita 1'][0].blob, s.blob);

  const a = await visitas.obtenerSoporte(G1, { id: '111_v1', blob: s.blob });
  assert.equal(await fs.readFile(a.ruta, 'utf8'), '%PDF-1.4 prueba');
  await rechaza(visitas.obtenerSoporte(G2, { id: '111_v1', blob: s.blob }), 403);
  await rechaza(visitas.obtenerSoporte(G1, { id: '111_v1', blob: '222/otra/cosa.pdf' }), 404);

  await rechaza(visitas.subirArchivoVisita(G1, { visita_id: '111_v1', formato: 'X' }, await archivoTemporal('virus.exe', 'MZ')), 400);
  const grande = await archivoTemporal('video.mp4', 'x');
  grande.size = 81 * 1024 * 1024;
  await rechaza(visitas.subirArchivoVisita(G1, { visita_id: '111_v1', formato: 'X' }, grande), 413);
  await rechaza(visitas.subirArchivoVisita(G1, { formato: 'X' }, f), 400);
  await rechaza(visitas.subirArchivoVisita(G2, { visita_id: '111_v1', formato: 'X' }, f), 403);

  // Quitar: no se borra, se renombra y queda anotado quién lo quitó.
  const q = (await visitas.subirArchivoVisita(G1, { accion: 'quitar', visita_id: '111_v1', blob: s.blob })).item;
  assert.deepEqual(q.soportes.documentos_visita_obligatorios['Acta de Visita 1'], []);
  assert.equal(q.soportes.soportes_quitados.length, 1);
  assert.equal(q.soportes.soportes_quitados[0].quitado_por, 'Gestora 1');
  await rechaza(visitas.obtenerSoporte(G1, { id: '111_v1', blob: s.blob }), 404);
  await rechaza(visitas.subirArchivoVisita(G1, { accion: 'quitar', visita_id: '111_v1', blob: s.blob }), 404);
  // Guardar de nuevo no pierde lo que ya se quitó.
  assert.equal((await guardarV(G1, docVisita())).item.soportes.soportes_quitados.length, 1);

  // Un archivo de otra unidad no puede colarse en la visita.
  const ajeno = { archivo: 'x.pdf', blob: '222/01_VISITA_1_CARACTERIZACION/222_v1_1_x.pdf' };
  const sin = (await guardarV(G1, docVisita({ soportes: { documentos_visita_obligatorios: { 'Acta de Visita 1': [ajeno] } } }))).item;
  assert.deepEqual(sin.soportes.documentos_visita_obligatorios['Acta de Visita 1'], []);
});

test('visitas: el servidor cierra la visita; una cerrada solo se reabre por coordinación y con motivo', async () => {
  await diagnosticoV1(G1, '1');
  // Los formatos obligatorios se exigen en el servidor; declarados sin subirlos no cuentan.
  const inventados = { documentos: Object.fromEntries(catalogoVisitas.formatosDe('v1', 'M1').filter((f) => !f.opcional)
    .map((f) => [f.nombre, [{ archivo: 'x.pdf' }, { archivo: 'y.jpg', blob: '111/01_VISITA_1_CARACTERIZACION/no_subido.jpg' }]])) };
  await rechazaCon(guardarV(G1, docVisita({ soportes: inventados, realizacion: { estado: 'EXITOSA' }, cierre: { cerrada: true } })), 400,
    /Para cerrar la Visita 1 faltan los formatos: Acta de Compromiso, Acta de Visita 1, Imágenes de caracterización/);
  const soportes = await formatosCompletos('111_v1', 'v1', 'M1');
  const c = (await guardarV(G1, docVisita({ soportes, realizacion: { estado: 'EXITOSA' }, cierre: { cerrada: true, fecha_cierre: '1999-01-01', cerrada_por: 'Otro' } }))).item;
  assert.equal(c.cierre.cerrada, true);
  assert.equal(c.cierre.cerrada_por, 'Gestora 1');                          // no se acepta lo que mande el navegador
  assert.notEqual(c.cierre.fecha_cierre, '1999-01-01');
  assert.equal(c.situacion, 'CERRADA');

  await rechaza(guardarV(G1, docVisita()), 409);                            // cerrada: ya no se modifica
  await rechaza(visitas.subirArchivoVisita(G1, { visita_id: '111_v1', formato: 'X' }, await archivoTemporal('a.pdf', 'x')), 409);
  await rechaza(guardarV(G1, docVisita(), { reabrir: true, motivo: 'quiero' }), 403);        // el gestor no reabre
  await rechaza(guardarV(COORD, docVisita(), { reabrir: true }), 400);                       // falta el motivo

  const r = (await guardarV(COORD, docVisita(), { reabrir: true, motivo: 'Faltó un soporte' })).item;
  assert.equal(r.cierre.cerrada, false);
  assert.equal(r.cierre.reaperturas.length, 1);
  assert.equal(r.cierre.reaperturas[0].motivo, 'Faltó un soporte');
  assert.equal(r.cierre.reaperturas[0].cerrada_antes_por, 'Gestora 1');
  assert.equal(r.cierre.reaperturas[0].reabierta_por, 'Coord');
  await rechaza(guardarV(COORD, docVisita(), { reabrir: true, motivo: 'otra vez' }), 400); // ya no está cerrada

  // Tras reabrir el gestor puede seguir; el historial de reaperturas se conserva.
  const s = (await guardarV(G1, docVisita())).item;
  assert.equal(s.cierre.reaperturas.length, 1);
});

test('visitas: formatos en blanco — los sube coordinación y los descargan todos', async () => {
  await rechaza(visitas.subirFormato(G1, {}, await archivoTemporal('ACTA DE VISITA.pdf', 'x')), 403);
  await rechaza(visitas.subirFormato(COORD, {}, await archivoTemporal('malo.exe', 'x')), 400);
  assert.deepEqual((await visitas.listarFormatos(G1)).items, []);          // nace vacío

  await visitas.subirFormato(COORD, {}, await archivoTemporal('ACTA DE VISITA.pdf', '%PDF-1.4 formato en blanco'));
  const l = (await visitas.listarFormatos(G1)).items;
  assert.equal(l.length, 1);
  assert.equal(l[0].nombre, 'ACTA DE VISITA.pdf');
  const a = await visitas.obtenerFormato(G1, { nombre: 'ACTA DE VISITA.pdf' });
  assert.equal(await fs.readFile(a.ruta, 'utf8'), '%PDF-1.4 formato en blanco');
  await rechaza(visitas.obtenerFormato(G1, { nombre: 'NO EXISTE.pdf' }), 404);

  await rechaza(visitas.eliminarFormato(G1, { nombre: 'ACTA DE VISITA.pdf' }), 403);
  await visitas.eliminarFormato(COORD, { nombre: 'ACTA DE VISITA.pdf' });
  assert.deepEqual((await visitas.listarFormatos(COORD)).items, []);
});

// ---------------- Lista de compras (MASTER ENTREGAS) ----------------
const itemCompra = (n, comprado, extra = {}) => ({
  item_n: n, nombre_solicitado: `Ítem ${n}`, nombre_carrito_actual: `Ítem ${n}`, cantidad: 2, precio_solicitado: 10, total: 20,
  comprado_excel: comprado, ...extra,
});
const docCompra = (id, items, extra = {}) => ({
  id: String(id), id_unico: id, tipo: 'items_up', unidad_nombre: `UP ${id}`, nodo: 'SIN DATOS',
  resumen: { total_items: items.length }, items, ...extra,
});

test('compras: el cargue por lotes respeta el nodo de la U.P., el Excel manda sobre «comprado» y la logística se conserva', async () => {
  const docs = [
    docCompra(1, [itemCompra(1, true), itemCompra(2, false)]),
    docCompra(2, [itemCompra(1, false)]),
    docCompra(3, [itemCompra(1, true)]),
    docCompra(98, [itemCompra(1, false)], { nodo: 'NODO-INEXISTENTE' }),
  ];
  await rechaza(compras.cargarCompras(G1, { archivo: 'M.xlsx', docs }), 403);        // el gestor no carga
  await rechaza(compras.cargarCompras(LOCAL_R1, { archivo: 'M.xlsx', docs }), 403);   // ni el Coordinador local regional
  await rechaza(compras.cargarCompras(COMPRAS, { archivo: 'M.xlsx', docs: [] }), 400);

  const r = await compras.cargarCompras(COMPRAS, { archivo: 'M.xlsx', docs });
  assert.equal(r.guardados, 3);
  assert.equal(r.nuevos, 3);
  assert.equal(r.fallidos.length, 1);                                                   // la 98: ni existe ni trae un nodo real
  assert.match(r.fallidos[0].error, /sin nodo/);
  assert.equal((await compras.cargarCompras(ADMIN, { archivo: 'M.xlsx', docs: [docs[0]] })).nuevos, 0);   // el superadmin también

  // Cada gestor ve solo las de su nodo; el nodo sale de la U.P., no del Excel.
  const verCompras = (await compras.listarItemsUPs(COMPRAS)).items;
  assert.deepEqual(verCompras.map((x) => x.id), ['1', '2', '3']);
  assert.deepEqual((await compras.listarItemsUPs(G1)).items.map((x) => x.id), ['1', '2']);
  assert.equal(verCompras[0].total_items, 2);
  assert.equal(verCompras[0].items_comprados, 1);
  assert.equal(verCompras[0].items, undefined);                                         // la lista no trae los ítems
  assert.equal((await compras.listarItemsUPs(DATOS)).ok, true);
  await rechaza(compras.obtenerItemUP(G1, { id: '3' }), 404);                           // de otro nodo

  // Marcar ítems: solo compras o coordinación; logistica.comprado lo calcula el servidor.
  const d1 = (await compras.obtenerItemUP(G1, { id: '1' })).item;
  assert.equal(d1.items[0].compra.comprado, true);
  assert.equal(d1.items[1].compra.comprado, false);
  assert.equal(d1.logistica.comprado, false);
  await rechaza(compras.guardarItemUP(G1, { id: '1', compras: [{ idx: 1, item_n: 2, comprado: true }] }), 403);
  await rechaza(compras.guardarItemUP(COMPRAS, { id: '1', compras: [{ idx: 7, comprado: true }] }), 400);
  await rechaza(compras.guardarItemUP(COMPRAS, { id: '1', compras: [{ idx: 1, item_n: 99, comprado: true }] }), 400);
  const m = (await compras.guardarItemUP(COMPRAS, {
    id: '1', compras: [{ idx: 1, item_n: 2, comprado: true }], logistica: { despachado: true, observaciones: 'Sale mañana', comprado: false },
  })).item;
  assert.equal(m.logistica.comprado, true);                                             // ya están todos
  assert.equal(m.logistica.despachado, true);
  assert.equal(m.items[1].compra.origen, 'manual');
  assert.equal(m.items[1].compra.por, 'Compras');

  // Otro cargue: el Excel vuelve a mandar sobre «comprado»; la logística no se toca.
  const otro = await compras.cargarCompras(COMPRAS, { archivo: 'M2.xlsx', docs: [docs[0]] });
  assert.equal(otro.nuevos, 0);
  const d2 = (await compras.obtenerItemUP(COMPRAS, { id: '1' })).item;
  assert.equal(d2.items[1].compra.comprado, false);
  assert.equal(d2.logistica.comprado, false);
  assert.equal(d2.logistica.despachado, true);
  assert.equal(d2.logistica.observaciones, 'Sale mañana');
  assert.equal(d2.ultimo_cargue.archivo, 'M2.xlsx');

  // Las que ya no vienen se retiran (no se borran) y vuelven si el siguiente cargue las trae.
  assert.equal((await compras.cargarCompras(COMPRAS, { archivo: 'M3.xlsx', vigentes: ['1'] })).retiradas, 2);
  assert.deepEqual((await compras.listarItemsUPs(COMPRAS)).items.map((x) => x.id), ['1']);
  await compras.cargarCompras(COMPRAS, { archivo: 'M4.xlsx', docs: [docs[1]] });
  assert.deepEqual((await compras.listarItemsUPs(COMPRAS)).items.map((x) => x.id), ['1', '2']);
});

// ---------------- Cronograma de entregas ----------------
const pdfBase64 = (extra = 'prueba') => Buffer.from(`%PDF-1.4 ${extra}`).toString('base64');
const entregaExcel = (id, extra = {}) => ({
  id_unico: id, unidad_nombre: `UP ${id}`,
  excel: {
    excel_estado_programacion: 'PROGRAMADA', excel_fecha_programada: '2026-11-10',
    excel_ruta_hora_visita: '09:00', excel_fecha_entrega_efectiva: null, ...extra,
  },
});

test('entregas: cronograma, confirmación del gestor y reagendamiento con acta PDF', async () => {
  const e1 = entregaExcel(1);
  await rechaza(entregas.cargarEntregas(G1, { entregas: [e1] }), 403);
  await rechaza(entregas.cargarEntregas(COMPRAS, { entregas: [] }), 400);

  const c = await entregas.cargarEntregas(COMPRAS, { entregas: [e1, entregaExcel(3), entregaExcel(55)] });
  assert.equal(c.guardadas, 2);
  assert.deepEqual(c.sin_nodo, [55]);                                                   // 55 no existe en ninguna parte
  const repetido = await entregas.cargarEntregas(COMPRAS, { entregas: [e1] });
  assert.equal(repetido.sin_cambios, 1);                                                // mismo Excel: no se toca

  // Alcance: el gestor ve solo su nodo; coordinación ve todo.
  assert.deepEqual((await entregas.listarEntregas(G1)).items.map((x) => x.id), ['1']);
  assert.deepEqual((await entregas.listarEntregas(COMPRAS)).items.map((x) => x.id), ['1', '3']);
  assert.deepEqual((await entregas.listarEntregas(COORD, { nodo_id: 'BOLIV1' })).items.map((x) => x.id), ['3']);
  assert.equal((await entregas.listarEntregas(DATOS)).ok, true);
  const inicial = (await entregas.listarEntregas(G1)).items[0];
  assert.equal(entregas.estadoEntrega(inicial), 'programada');
  assert.equal(entregas.fechaProgramada(inicial), '2026-11-10');

  // La fecha que manda: efectiva > vigente > reprogramada > programada.
  assert.equal(entregas.fechaProgramada({ excel_fecha_programada: '2026-11-10', excel_fecha_reprogramada: '2026-11-12', excel_fecha_entrega_vigente: '2026-11-15' }), '2026-11-15');

  // Solo el gestor del nodo confirma.
  await rechaza(entregas.accionEntrega(G2, { id: '1', accion: 'contacto', telefono: '3' }), 404);
  await rechaza(entregas.accionEntrega(COMPRAS, { id: '1', accion: 'confirmar', hora: '09:00', telefono: '3', direccion: 'x' }), 403);
  await rechaza(entregas.accionEntrega(G1, { id: '1', accion: 'confirmar', hora: '9:00', telefono: '3', direccion: 'x' }), 400);   // hora mal
  await rechaza(entregas.accionEntrega(G1, { id: '1', accion: 'confirmar', hora: '09:00', telefono: '', direccion: 'x' }), 400);   // falta teléfono
  const k = (await entregas.accionEntrega(G1, { id: '1', accion: 'contacto', telefono: '3001112233', direccion: 'Calle 1' })).item;
  assert.equal(k.gestor_telefono, '3001112233');
  const conf = (await entregas.accionEntrega(G1, { id: '1', accion: 'confirmar', hora: '09:30', telefono: '3001112233', direccion: 'Calle 1' })).item;
  assert.equal(entregas.estadoEntrega(conf), 'confirmada');
  assert.equal(conf.gestor_confirmada_hora, '09:30');
  assert.equal(conf.historial.at(-1).accion, 'confirmar');

  // Reagendar exige motivo y un PDF válido (hasta 10 MB).
  const pedir = (extra) => entregas.accionEntrega(G1, { id: '1', accion: 'solicitar_reagendamiento', motivo: 'La beneficiaria viaja', acta_pdf: pdfBase64(), ...extra });
  await rechaza(pedir({ motivo: '  ' }), 400);
  await rechaza(pedir({ acta_pdf: '' }), 400);
  await rechaza(pedir({ acta_pdf: Buffer.from('no soy pdf').toString('base64') }), 400);
  await rechaza(pedir({ acta_pdf: Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(10 * 1024 * 1024)]).toString('base64') }), 400);
  await rechaza(pedir({ fecha_sugerida: 'mañana' }), 400);

  let s = (await pedir({ fecha_sugerida: '2026-11-20' })).item;
  assert.equal(entregas.estadoEntrega(s), 'acta_revision');
  assert.equal(s.solicitud_fecha_anterior, '2026-11-10');
  assert.match(s.solicitud_acta, /^1\/ACTA_\d+\.pdf$/);
  await rechaza(pedir(), 400);                                                          // ya hay una solicitud en curso

  // Coordinación revisa el acta; el gestor no.
  await rechaza(entregas.revisarActa(G1, { id: '1', decision: 'aprobar' }), 403);
  await rechaza(entregas.revisarActa(COMPRAS, { id: '1', decision: 'quizá' }), 400);
  await rechaza(entregas.revisarActa(COMPRAS, { id: '1', decision: 'rechazar', observacion: '' }), 400);
  const rechazada = (await entregas.revisarActa(COMPRAS, { id: '1', decision: 'rechazar', observacion: 'Falta la firma' })).item;
  assert.equal(entregas.estadoEntrega(rechazada), 'confirmada');                        // vuelve al gestor tal como estaba
  assert.equal(rechazada.solicitud_en, undefined);
  assert.equal(rechazada.historial.at(-1).accion, 'acta_rechazada');
  assert.equal(rechazada.historial.at(-1).observacion, 'Falta la firma');
  await rechaza(entregas.revisarActa(COMPRAS, { id: '1', decision: 'aprobar' }), 400);  // ya no hay acta por revisar

  s = (await pedir({ fecha_sugerida: '2026-11-20' })).item;
  const aprobada = (await entregas.revisarActa(COORD, { id: '1', decision: 'aprobar' })).item;
  assert.equal(entregas.estadoEntrega(aprobada), 'solicitud');
  assert.equal(aprobada.solicitud_acta_revisado_por, 'Coord');

  // El acta la ven coordinación y el gestor del nodo; las anteriores siguen en el historial.
  const a = await entregas.obtenerActa(G1, { id: '1' });
  assert.equal((await fs.readFile(a.ruta, 'utf8')).startsWith('%PDF-1.4'), true);
  await rechaza(entregas.obtenerActa(G2, { id: '1' }), 404);
  await entregas.obtenerActa(COMPRAS, { id: '1', acta: rechazada.historial.find((h) => h.accion === 'acta_rechazada').acta });
  await rechaza(entregas.obtenerActa(COMPRAS, { id: '1', acta: '3/otra.pdf' }), 404);

  // La nueva fecha llega con el siguiente cargue y la solicitud se cierra sola.
  const nuevo = await entregas.cargarEntregas(COMPRAS, { entregas: [entregaExcel(1, { excel_fecha_reprogramada: '2026-11-20' })] });
  assert.equal(nuevo.guardadas, 1);
  const fin = (await entregas.listarEntregas(G1)).items[0];
  assert.equal(entregas.fechaProgramada(fin), '2026-11-20');
  assert.equal(fin.solicitud_en, undefined);
  assert.equal(fin.gestor_telefono, '3001112233');                                      // lo del gestor se conserva
  assert.equal(entregas.estadoEntrega(fin), 'reagendada');
  assert.equal(fin.historial.at(-1).accion, 'reagendada');

  // Una entrega ya entregada no se modifica.
  await entregas.cargarEntregas(COMPRAS, { entregas: [entregaExcel(1, { excel_reprogramada: null, excel_fecha_entrega_efectiva: '2026-11-20', excel_fecha_reprogramada: '2026-11-20' })] });
  await rechaza(entregas.accionEntrega(G1, { id: '1', accion: 'contacto', telefono: '1' }), 400);
});

test('entregas: el estado del validador de cada cédula alimenta los semáforos', async () => {
  // 222 (nodo ATLAN1) en corrección y 333 (nodo BOLIV1) en revisión.
  await query(`INSERT INTO ciudadanos (id_origen, id_up, cedula, nombre_completo, estado_validacion)
    SELECT 'CIU-' || r.documento, up.id_up, r.documento, 'Beneficiaria', CASE r.documento WHEN '222' THEN 'correcciones' ELSE 'en_revision' END
      FROM unidades_productivas up JOIN representantes r ON r.id_representante = up.id_representante
     WHERE up.id_unico IN ('2', '3')
    ON CONFLICT (cedula) DO UPDATE SET estado_validacion = EXCLUDED.estado_validacion`);
  const g = (await entregas.estadosEntrega(G1)).items;
  assert.equal(g['222'], 'correcciones');
  assert.equal(g['333'], undefined);                                                    // otro nodo
  const todos = (await entregas.estadosEntrega(COMPRAS)).items;
  assert.equal(todos['222'], 'correcciones');
  assert.equal(todos['333'], 'revision');
  assert.equal((await entregas.estadosEntrega(DATOS)).ok, true);
});

// ---------------- Revisión de entregas ----------------
test('revisión de entregas: el revisor aprueba o devuelve cada soporte y el gestor no reemplaza lo aprobado', async () => {
  // Beneficiaria de la U.P. 3 (nodo BOLIV1) con los 5 soportes cargados y en revisión.
  await query(`INSERT INTO ciudadanos (id_origen, id_up, cedula, nombre_completo, estado_validacion)
    SELECT 'CIU-REV', up.id_up, '333', 'Beneficiaria Tres', 'en_revision' FROM unidades_productivas up WHERE up.id_unico = '3'
    ON CONFLICT (cedula) DO UPDATE SET estado_validacion = 'en_revision'`);
  const f = await archivoTemporal('orden.pdf', '%PDF-1.4 orden de pedido');
  const guardado = await archivos.guardarArchivo({ contenedor: 'entrega-activos', nombre: 'ORDEN DE PEDIDO_333.pdf', archivo: f, usuario: G2 });
  await query(`INSERT INTO ciudadano_documentos (id_ciudadano, id_tipo_documento, url, estado, fecha_carga)
    SELECT c.id_ciudadano, td.id_tipo_documento, $1, 'en_revision', '2026-10-10T10:00:00Z'
      FROM ciudadanos c, tipos_documento td
     WHERE c.cedula = '333' AND td.codigo IN ('orden_pedido', 'entrega_activos', 'recibo_satisfaccion', 'registro_fotografico', 'video_entrega', 'cedula_pdf')
    ON CONFLICT (id_ciudadano, id_tipo_documento) DO UPDATE
      SET url = EXCLUDED.url, estado = 'en_revision', observacion = NULL, fecha_carga = EXCLUDED.fecha_carga`, [guardado.url]);

  // Solo el revisor y el superadmin.
  await rechaza(revision.listarRevision(G2), 403);
  await rechaza(revision.listarRevision(LOCAL_R1), 403);
  const lista = (await revision.listarRevision(REVISOR)).items;
  const b = lista.find((x) => x.cedula === '333');
  assert.equal(b.estado, 'en_revision');
  assert.equal(b.up.nodo, 'BOLIV1');
  assert.equal(b.documentos.length, 5);
  assert.equal(b.documentos[0].clave, 'orden_pedido');
  assert.equal(b.documentos[0].estado, 'en_revision');
  assert.equal((await revision.listarRevision(ADMIN)).items.length >= 1, true);

  // Decisiones: observación obligatoria al devolver, soporte conocido y ya cargado.
  const carga = b.documentos[0].fecha_carga;
  const dec = (clave, estado, extra = {}) => revision.guardarRevision(REVISOR, { cedula: '333', documentos: { [clave]: { estado, fecha_carga: carga, ...extra } } });
  await rechaza(dec('orden_pedido', 'por_corregir'), 400);
  await rechaza(dec('video_inventado', 'aprobado'), 400);
  await rechaza(dec('orden_pedido', 'maybe'), 400);
  await rechaza(revision.guardarRevision(G2, { cedula: '333', documentos: {} }), 403);
  await rechaza(revision.guardarRevision(REVISOR, { cedula: '999999', documentos: { orden_pedido: { estado: 'aprobado' } } }), 404);
  await rechaza(dec('orden_pedido', 'aprobado', { fecha_carga: '2026-10-11T10:00:00Z' }), 409);            // cambió mientras se revisaba

  await dec('orden_pedido', 'aprobado');
  let r = (await dec('video_entrega', 'por_corregir', { observacion: 'Se ve muy oscuro' })).item;
  assert.equal(r.estado, 'correcciones');
  const docs = Object.fromEntries(r.documentos.map((d) => [d.clave, d]));
  assert.equal(docs.orden_pedido.estado, 'aprobado');
  assert.equal(docs.orden_pedido.revisado_por, 'Revisor');
  assert.equal(docs.video_entrega.estado, 'por_corregir');
  assert.equal(docs.video_entrega.observacion, 'Se ve muy oscuro');

  // El validador (lo que ve el gestor) refleja la revisión al instante.
  const ver = (await validador.procesar(G2, { action: 'check', cedula: '333' })).cuerpo;
  assert.deepEqual(ver.por_corregir.map((x) => x.clave), ['video_entrega']);

  // Lo aprobado no se reemplaza; lo devuelto sí, y vuelve a quedar en revisión.
  const intento = await validador.procesar(G2, { action: 'upload', cedula: '333' }, { archivo_orden: await archivoTemporal('nuevo.pdf', '%PDF-1.4 otro') });
  assert.equal(intento.cuerpo.exito, false);
  assert.match(intento.cuerpo.mensaje, /ya fue aprobado/);
  const video = await archivoTemporal('video.mp4', 'video nuevo', 'video/mp4');
  const subida = await validador.procesar(G2, { action: 'upload', cedula: '333' }, { archivo_video: video });
  assert.equal(subida.cuerpo.exito, true);
  r = (await revision.listarRevision(REVISOR)).items.find((x) => x.cedula === '333');
  const v = r.documentos.find((d) => d.clave === 'video_entrega');
  assert.equal(v.estado, 'en_revision');
  assert.equal(v.observacion, '');
  assert.equal(v.revisado_por, null);

  // Aprobados los cinco, queda completa.
  const todos = Object.fromEntries(['entrega_activos', 'recibo_satisfaccion', 'registro_fotografico', 'video_entrega']
    .map((k) => [k, { estado: 'aprobado', fecha_carga: r.documentos.find((d) => d.clave === k).fecha_carga }]));
  assert.equal((await revision.guardarRevision(REVISOR, { cedula: '333', documentos: todos })).item.estado, 'completo');
  // En la actividad el objeto es el id interno del ciudadano (no su cédula); queda en el historial de su U.P. con el antes → después (E12).
  const revAct = (await query("SELECT * FROM actividad WHERE accion = 'revision.guardar' ORDER BY id DESC LIMIT 1")).rows[0];
  const idC333 = String((await query("SELECT id_ciudadano FROM ciudadanos WHERE cedula = '333'")).rows[0].id_ciudadano);
  assert.deepEqual([revAct.objeto_id, revAct.id_unico, revAct.cambios.campos.video_entrega], [idC333, '3', ['en_revision', 'aprobado']]);
  assert.notEqual(revAct.objeto_id, '333');

  // El revisor abre el archivo; sin soporte cargado no hay archivo.
  const a = await revision.obtenerArchivoRevision(REVISOR, { cedula: '333', clave: 'orden_pedido' });
  assert.equal(await fs.readFile(a.ruta, 'utf8'), '%PDF-1.4 orden de pedido');
  await rechaza(revision.obtenerArchivoRevision(G2, { cedula: '333', clave: 'orden_pedido' }), 403);
  await rechaza(revision.obtenerArchivoRevision(REVISOR, { cedula: '333', clave: 'cedula_frontal' }), 404);
  await rechaza(revision.obtenerArchivoRevision(REVISOR, { cedula: '333', clave: '../../etc/passwd' }), 400);
});

test('validador: cada tipo de entrega exige sus propios soportes', async () => {
  // Beneficiaria de la U.P. 2 (nodo ATLAN1): una «no entrega» solo pide el acta y la cédula.
  await query(`INSERT INTO ciudadanos (id_origen, id_up, cedula, nombre_completo, estado_validacion)
    SELECT 'CIU-NE', up.id_up, '222', 'Beneficiaria Dos', 'pendiente' FROM unidades_productivas up WHERE up.id_unico = '2'
    ON CONFLICT (cedula) DO UPDATE SET estado_validacion = 'pendiente', tipo_entrega = 'completa'`);
  await query("DELETE FROM ciudadano_documentos WHERE id_ciudadano = (SELECT id_ciudadano FROM ciudadanos WHERE cedula = '222')");
  const pdf = (n) => archivoTemporal(n, '%PDF-1.4 x');
  const subir = (campos, archivos) => validador.procesar(G1, { action: 'upload', cedula: '222', ...campos }, archivos);

  const inicial = (await validador.procesar(G1, { action: 'check', cedula: '222' })).cuerpo;
  assert.equal(inicial.tipo_entrega, 'completa');                                        // lo de siempre

  assert.equal((await subir({ tipo_entrega: 'nunca' }, {})).cuerpo.exito, false);         // tipo inválido
  const sinActa = await subir({ tipo_entrega: 'no_entrega', modo_cedula: 'pdf' }, { archivo_cedula_pdf: await pdf('c.pdf') });
  assert.match(sinActa.cuerpo.mensaje, /Acta de novedad — no entrega/);
  const sobra = await subir({ tipo_entrega: 'no_entrega', modo_cedula: 'pdf' }, {
    archivo_cedula_pdf: await pdf('c.pdf'), archivo_acta_no_entrega: await pdf('a.pdf'), archivo_video: await archivoTemporal('v.mp4', 'v', 'video/mp4'),
  });
  assert.match(sobra.cuerpo.mensaje, /no se pide en una entrega no entrega/);              // el video no corresponde
  const sinCedula = await subir({ tipo_entrega: 'no_entrega' }, { archivo_acta_no_entrega: await pdf('a.pdf') });
  assert.match(sinCedula.cuerpo.mensaje, /cédula/);

  const ok = await subir({ tipo_entrega: 'no_entrega', modo_cedula: 'pdf' }, { archivo_cedula_pdf: await pdf('c.pdf'), archivo_acta_no_entrega: await pdf('a.pdf') });
  assert.equal(ok.cuerpo.exito, true);
  assert.equal(ok.cuerpo.estado_validacion, 'en_revision');
  const chequeo = (await validador.procesar(G1, { action: 'check', cedula: '222' })).cuerpo;
  assert.equal(chequeo.tipo_entrega, 'no_entrega');
  assert.deepEqual(chequeo.documentos_cargados.map((d) => d.clave), ['acta_no_entrega']);

  // El revisor solo ve y califica los soportes de ese tipo; con el acta aprobada queda completa.
  const item = (await revision.listarRevision(REVISOR)).items.find((x) => x.cedula === '222');
  assert.equal(item.tipo_entrega, 'no_entrega');
  assert.deepEqual(item.documentos.map((d) => d.clave), ['acta_no_entrega']);
  await rechaza(revision.guardarRevision(REVISOR, { cedula: '222', documentos: { video_entrega: { estado: 'aprobado' } } }), 400);
  const fin = (await revision.guardarRevision(REVISOR, { cedula: '222', documentos: { acta_no_entrega: { estado: 'aprobado', fecha_carga: item.documentos[0].fecha_carga } } })).item;
  assert.equal(fin.estado, 'completo');

  // Parcial y no entrega se pueden replantear; una completa ya enviada, solo si el revisor la devolvió.
  const aParcial = await subir({ tipo_entrega: 'parcial' }, { archivo_acta_parcial: await pdf('p.pdf'), archivo_registro_fotografico: await pdf('r.pdf') });
  assert.equal(aParcial.cuerpo.exito, true);
  assert.equal((await validador.procesar(G1, { action: 'check', cedula: '222' })).cuerpo.tipo_entrega, 'parcial');
  const completaEnviada = await validador.procesar(G2, { action: 'upload', cedula: '333', tipo_entrega: 'parcial' }, { archivo_acta_parcial: await pdf('p.pdf') });
  assert.match(completaEnviada.cuerpo.mensaje, /no puede cambiar de tipo|ya fue aprobado/);
});

// ---------------- Registro de actividad (historial de la U.P.) ----------------
test('actividad: cada cambio de compras y entregas queda en el historial de la U.P., con su antes y después', async () => {
  // Lo que hicieron los tests anteriores sobre la U.P. 1 (nodo ATLAN1).
  const h = (await actividad.listarActividad(G1, { up: '1' })).items;
  const acciones = h.map((x) => x.accion);
  for (const a of ['entrega.contacto', 'entrega.confirmar', 'entrega.solicitar_reagendamiento', 'entrega.acta_rechazar', 'entrega.acta_aprobar', 'compras.guardar']) {
    assert.ok(acciones.includes(a), `falta ${a} en ${acciones.join(', ')}`);
  }
  assert.ok(h.every((x) => /^(compras|entrega)\./.test(x.accion)));                       // el historial de la U.P. solo muestra compras y entregas
  const orden = h.map((x) => Number(x.id));
  assert.deepEqual(orden, [...orden].sort((a, b) => b - a));                              // lo más reciente primero

  const tel = h.find((x) => x.accion === 'entrega.contacto' && x.resultado === 'ok');
  assert.deepEqual(tel.cambios.campos.gestor_telefono, [null, '3001112233']);
  assert.equal(tel.quien.nombre, 'Gestora 1');
  assert.equal(tel.quien.rol, 'gestor');
  assert.equal(tel.quien.nodo, 'ATLAN1');

  const marca = h.find((x) => x.accion === 'compras.guardar' && x.cambios.compras);
  assert.equal(marca.cambios.compras[0].comprado, true);
  assert.equal(marca.cambios.logistica?.despachado, true);

  // Lo que el servidor rechazó también queda, con el motivo.
  const rechazado = h.find((x) => x.resultado === 'rechazado');
  assert.ok(rechazado, 'debería haber al menos un intento rechazado');
  assert.ok(rechazado.cambios.detalle);

  // Alcance: el gestor ve las suyas, no las de otro nodo; solo el superadmin ve todo.
  await rechaza(actividad.listarActividad(G1, { up: '3' }), 404);
  await rechaza(actividad.listarActividad(G1, {}), 403);
  await rechaza(actividad.listarActividad(COMPRAS, {}), 403);
  assert.ok((await actividad.listarActividad(COORD, { up: '1' })).items.length >= 6);
  const todo = (await actividad.listarActividad(ADMIN, {})).items;
  assert.ok(todo.some((x) => x.accion === 'cargue.compras'));
  assert.ok(todo.some((x) => x.accion === 'cargue.entregas'));
  assert.ok(todo.some((x) => x.accion === 'revision.guardar'));

  // Filtros y paginación (el cursor es el id de la última fila).
  assert.ok((await actividad.listarActividad(ADMIN, { accion: 'cargue.' })).items.every((x) => x.accion.startsWith('cargue.')));
  assert.ok((await actividad.listarActividad(ADMIN, { resultado: 'rechazado' })).items.every((x) => x.resultado === 'rechazado'));
  assert.ok((await actividad.listarActividad(ADMIN, { quien: 'gestora' })).items.length > 0);
  const p1 = await actividad.listarActividad(ADMIN, { limite: 3 });
  assert.equal(p1.items.length, 3);
  assert.ok(p1.siguiente);
  const p2 = await actividad.listarActividad(ADMIN, { limite: 3, antes: p1.siguiente });
  assert.ok(p2.items.every((x) => Number(x.id) < Number(p1.siguiente)));
});

// ---------------- Cargue de la documentación completa ----------------
test('cargue de documentos: interpreta las celdas, rehace el expediente y se puede repetir', async () => {
  const { booleano, fecha, archivos: arch, checks: chk } = cargueDocs;
  assert.equal(booleano('Sí'), true);
  assert.equal(booleano('0'), false);
  assert.equal(booleano('Incompleta'), false);
  assert.equal(booleano('Sin datos asignados'), null);
  assert.equal(fecha('2026-10-05T10:00:00Z'), '2026-10-05');
  assert.equal(fecha('05/10/2026'), '2026-10-05');
  assert.equal(fecha('46300'), '2026-10-05');                                                 // número de serie de Excel
  assert.equal(fecha('mañana'), null);
  assert.deepEqual(arch('a.pdf; b.pdf\nc.jpg'), [{ nombre: 'a.pdf' }, { nombre: 'b.pdf' }, { nombre: 'c.jpg' }]);
  assert.deepEqual(chk('Acta: ok\nCédula: falta'), [{ item: 'Acta', estado: 'ok' }, { item: 'Cédula', estado: 'falta' }]);

  const fila = (id, extra = {}) => ({
    m: { id_unico: id, doc_interventoria: 'DOC-77', observaciones: 'Todo bien', rit: '1', pdf_carrito: 'Cargado',
      plan_inversion: 'Viable', plan_negocio: 'Aprobado', proceso_subsanacion: 'En curso', evento_asistencia: 'Asistió',
      v1_fecha: '2026-09-01', v1_modalidad: 'Presencial', v1_agendamiento: 'Agendada', v2_documentacion: 'Completa',
      entrega_fecha: '2026-10-01', entrega_resultado: 'Entregada', enlace_carpeta: 'https://ejemplo.co/carpeta' },
    a: { id_unico: id, doc_completa_gestor: '1', doc_completa_triada: '0', up_aprobada: 'Sí', lote_up_aprobada: 'L1', total_dias_rit: '12',
      b00_archivos: 'cedula.pdf; rut.pdf', b00_completa: '1', b00_checks: 'Cédula: ok\nRUT: ok',
      v1_archivos: 'acta.pdf', v1_completa: '0', v1_checks: 'Acta: ok\nFotos: falta',
      m2_archivos: 'foto.jpg', entrega_checklist: 'Acta de entrega: ok', ...extra },
  });
  await rechaza(cargueDocs.cargarDocumentos(G1, { filas: [fila(2)] }), 403);
  await rechaza(cargueDocs.cargarDocumentos(DATOS, { filas: [] }), 400);

  const r = await cargueDocs.cargarDocumentos(DATOS, { filas: [fila(2), fila(999), { m: { id_unico: 'x' }, a: null }] });
  assert.equal(r.guardados, 1);
  assert.deepEqual(r.fallidos.map((x) => x.error).sort(), ['id_unico inválido', 'unidad no encontrada']);

  const doc = (await documentos.obtenerDocumento(DATOS, { id: '2' })).item;
  assert.equal(doc.doc_interventoria, 'DOC-77');
  assert.equal(doc.control.up_aprobada, true);
  assert.equal(doc.control.doc_completa_triada, false);
  assert.equal(doc.rit.tiene_rit, true);
  assert.equal(doc.rit.total_dias, 12);
  assert.equal(doc.pdf_carrito.estado, 'Cargado');
  assert.equal(doc.subsanaciones.proceso_subsanacion, 'En curso');
  assert.equal(doc.beneficiario.completa, true);
  assert.deepEqual(doc.beneficiario.archivos, [{ nombre: 'cedula.pdf' }, { nombre: 'rut.pdf' }]);
  assert.equal(doc.visita1.completa, false);
  assert.equal(new Date(doc.visita1.fecha_visita).toISOString().slice(0, 10), '2026-09-01');   // sin correrse de día
  assert.equal(doc.visita1.modalidad, 'Presencial');
  assert.deepEqual(doc.visita1.checks, [{ item: 'Acta', estado: 'ok' }, { item: 'Fotos', estado: 'falta' }]);
  assert.equal(doc.visita2.completa, true);                                    // viene de documentacion_visita2 de la BASE MASTER
  assert.equal(doc.fortalecimiento.modulos.modulo2.archivos.length, 1);
  assert.equal(doc.entrega.resultado, 'Entregada');
  assert.equal(doc.entrega.checklist[0].item, 'Acta de entrega');
  assert.equal(doc.visita3, undefined);                                         // sin datos no se inventa la etapa

  // Repetir deja lo mismo; una etapa que ya no trae datos desaparece.
  await cargueDocs.cargarDocumentos(DATOS, { filas: [fila(2, { m2_archivos: '' })] });
  const otra = (await documentos.obtenerDocumento(DATOS, { id: '2' })).item;
  assert.equal(otra.fortalecimiento?.modulos?.modulo2, undefined);
  assert.equal(otra.beneficiario.archivos.length, 2);
  assert.equal((await query('SELECT count(*)::int AS n FROM expedientes_up e JOIN unidades_productivas up ON up.id_up = e.id_up WHERE up.id_unico = $1', ['2'])).rows[0].n, 1);
  assert.equal((await query("SELECT enlace_carpeta FROM unidades_productivas WHERE id_unico = '2'")).rows[0].enlace_carpeta, 'https://ejemplo.co/carpeta');
});

// ---------------- Avisos para todos y mantenimiento ----------------
test('avisos: nacen vacíos, los publica el superadmin y vencen o se retiran', async () => {
  const vacio = await configuracion.leerConfig(G1);
  assert.deepEqual(vacio.avisos, []);
  assert.equal(vacio.mantenimiento, false);

  const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await rechaza(configuracion.accionConfig(G1, { accion: 'publicar_aviso', texto: 'x', nivel: 'info', hasta: manana }), 403);
  await rechaza(configuracion.accionConfig(LOCAL_R1, { accion: 'publicar_aviso', texto: 'x', nivel: 'info', hasta: manana }), 403);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'publicar_aviso', texto: '  ', nivel: 'info', hasta: manana }), 400);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'publicar_aviso', texto: 'x'.repeat(301), nivel: 'info', hasta: manana }), 400);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'publicar_aviso', texto: 'x', nivel: 'grave', hasta: manana }), 400);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'publicar_aviso', texto: 'x', nivel: 'info', hasta: '2020-01-01' }), 400);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'borrar_todo' }), 400);

  const r = await configuracion.accionConfig(ADMIN, { accion: 'publicar_aviso', texto: 'Hoy a las 6 p. m. hay mantenimiento', nivel: 'alerta', hasta: manana });
  assert.equal(r.avisos.length, 1);
  const visto = (await configuracion.leerConfig(G1)).avisos;
  assert.equal(visto[0].texto, 'Hoy a las 6 p. m. hay mantenimiento');
  assert.equal(visto[0].nivel, 'alerta');

  // Uno vencido no lo ve nadie salvo el superadmin que pide verlos todos.
  await query("INSERT INTO avisos_globales (id, texto, nivel, desde, hasta) VALUES ('viejo', 'Aviso viejo', 'info', now() - interval '2 days', now() - interval '1 day')");
  assert.equal((await configuracion.leerConfig(G1)).avisos.length, 1);
  assert.equal((await configuracion.leerConfig(G1, { todos: '1' })).avisos.length, 1);                  // el gestor no puede pedir todos
  assert.equal((await configuracion.leerConfig(ADMIN, { todos: '1' })).avisos.length, 2);

  await configuracion.accionConfig(ADMIN, { accion: 'retirar_aviso', id: visto[0].id });
  assert.equal((await configuracion.leerConfig(G1)).avisos.length, 0);
  await rechaza(configuracion.accionConfig(ADMIN, { accion: 'retirar_aviso', id: visto[0].id }), 400);   // ya retirado
});

test('mantenimiento: todos consultan, solo el superadmin guarda', async () => {
  await reiniciarLimites();
  const admin = await entrar('jefe', 'Super-Segura-2026x');
  const gestor = await entrar('atlan1', '1001001001');
  const accion = (s, datos) => s.http('POST', '/api/config', datos);

  assert.equal((await gestor.http('POST', '/api/visitas', {})).status, 400);                // sin mantenimiento llega a la validación
  assert.equal((await accion(gestor, { accion: 'mantenimiento', activo: true })).status, 403);
  assert.equal((await accion(admin, { accion: 'mantenimiento', activo: true, texto: 'Volvemos a las 8' })).status, 200);

  const bloqueado = await gestor.http('POST', '/api/visitas', {});
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.json.error, 'mantenimiento');
  assert.equal(bloqueado.json.detalle, 'Volvemos a las 8');
  assert.equal((await gestor.http('GET', '/api/unidades')).status, 200);                    // consultar sí
  const cfg = (await gestor.http('GET', '/api/config')).json;
  assert.equal(cfg.mantenimiento, true);
  assert.equal(cfg.mantenimiento_texto, 'Volvemos a las 8');
  assert.equal((await admin.http('PUT', '/api/avisos', { id: 'aviso-mant', titulo: 'Prueba mantenimiento', cuerpo: 'Aviso de prueba', destinatarios: ['ATLAN1'], fecha: '2026-10-22' })).status, 200);   // el superadmin guarda
  assert.equal((await gestor.http('POST', '/api/auth/logout')).status, 200);               // salir siempre se puede

  assert.equal((await accion(admin, { accion: 'mantenimiento', activo: false })).status, 200);
  const entrar2 = await entrar('atlan1', '1001001001');
  assert.equal((await entrar2.http('POST', '/api/visitas', {})).status, 400);               // vuelve a la normalidad
});

// ---------------- Ver como ----------------
test('ver como: el superadmin mira la Bitácora como otro rol, solo lectura', async () => {
  await reiniciarLimites();
  const admin = await entrar('jefe', 'Super-Segura-2026x');
  const gestor = await entrar('atlan1', '1001001001');
  const simular = (s, datos) => s.http('POST', '/api/auth/simular', datos);
  const sesion = async (s) => (await s.http('GET', '/api/auth/sesion')).json.sesion;

  assert.equal((await simular(gestor, { rol: 'coordinador' })).status, 403);                // solo el superadmin
  assert.equal((await simular(admin, { rol: 'superadmin' })).status, 400);
  assert.equal((await simular(admin, { rol: 'gestor' })).status, 400);                      // el gestor necesita nodo
  assert.equal((await simular(admin, { rol: 'gestor', nodo: 'NO-EXISTE' })).status, 400);

  assert.equal((await simular(admin, { rol: 'gestor', nodo: 'atlan1' })).status, 200);
  let s = await sesion(admin);
  assert.equal(s.rol, 'gestor');
  assert.equal(s.nodo, 'ATLAN1');
  assert.equal(s.rol_real, 'superadmin');
  assert.deepEqual(s.modulos, ['bitacora']);
  assert.equal((await admin.http('GET', '/api/unidades')).json.items.length, 2);             // ve lo que vería ese gestor
  const escritura = await admin.http('POST', '/api/visitas', {});
  assert.equal(escritura.status, 403);
  assert.equal(escritura.json.error, 'simulacion');
  assert.equal((await admin.http('PUT', '/api/avisos', { id: 'aviso-sim', titulo: 'No debe guardarse', cuerpo: 'Aviso de prueba', destinatarios: ['ATLAN1'], fecha: '2026-10-22' })).status, 403);
  assert.equal((await admin.http('GET', '/api/admin/usuarios')).status, 200);               // la cuenta real sigue siendo superadmin

  assert.equal((await simular(admin, { rol: 'coordinador' })).status, 200);
  s = await sesion(admin);
  assert.equal(s.rol, 'coordinador');
  assert.equal((await admin.http('GET', '/api/unidades')).json.items.length, 3);

  assert.equal((await simular(admin, { rol: null })).status, 200);                           // vuelve a ser superadmin
  s = await sesion(admin);
  assert.equal(s.rol, 'superadmin');
  assert.equal(s.rol_real, undefined);
  assert.ok(s.modulos.includes('admin'));
  assert.equal((await admin.http('PUT', '/api/avisos', { id: 'aviso-real', titulo: 'Sí se guarda', cuerpo: 'Aviso de prueba', destinatarios: ['ATLAN1'], fecha: '2026-10-22' })).status, 200);
});

test('uso: usuarios activos con sus ingresos y operaciones del periodo', async () => {
  const antes = await actividad.listarActividad(ADMIN, { resumen: 'uso', dias: '30' });
  assert.equal(antes.dias, 30);
  await rechaza(actividad.listarActividad(G1, { resumen: 'uso' }), 403);
  await rechaza(actividad.listarActividad(COMPRAS, { resumen: 'uso' }), 403);
  assert.equal((await actividad.listarActividad(ADMIN, { resumen: 'uso', dias: '999' })).dias, 30);                // periodo no válido → 30

  // Quien entra queda como activo; sus cambios se cuentan por módulo con el mismo sub de la sesión.
  await reiniciarLimites();
  const g = await entrar('atlan1', '1001001001');
  const sub = `gestor:${(await query("SELECT id_gestor FROM gestores g JOIN triadas t ON t.id_triada = g.id_triada WHERE upper(t.nodo) = 'ATLAN1'")).rows[0].id_gestor}`;
  await actividad.registrar({ sub, nombre: 'Gestora 1', rol: 'gestor', nodo: 'ATLAN1' }, { accion: 'entrega.confirmar', objeto: { tipo: 'entrega', id: '1' }, idUnico: '1' });
  await actividad.registrar({ sub, nombre: 'Gestora 1', rol: 'gestor', nodo: 'ATLAN1' }, { accion: 'entrega.confirmar', resultado: 'rechazado', idUnico: '1' });
  const r = await actividad.listarActividad(ADMIN, { resumen: 'uso', dias: '7' });
  const u = r.usuarios.find((x) => x.usuario === 'ATLAN1');
  assert.ok(u, 'ATLAN1 debería figurar como activo');
  assert.ok(u.ingresos >= 1);
  assert.equal(u.operaciones.entrega >= 1, true);
  assert.equal(r.totales.activos, r.usuarios.length);
  assert.ok(r.totales.cuentas >= r.totales.activos);
  await g.http('POST', '/api/auth/logout');
});

test('actividad: visitas y validador dejan rastro, filtrable por módulo', async () => {
  await guardarV(G1, docVisita());
  await validador.procesar(G1, { action: 'upload', cedula: '222', tipo_entrega: 'nunca' }, {});

  const de = async (prefijo) => (await actividad.listarActividad(ADMIN, { accion: prefijo })).items;
  const vis = await de('visitas.');
  assert.ok(vis.some((i) => i.accion === 'visitas.guardar' && i.objeto.id === '111_v1'));
  assert.ok((await actividad.listarActividad(ADMIN, { up: '1' })).items.some((i) => i.accion === 'visitas.guardar'));  // enlazada a la U.P. (el gestor solo ve compras y entregas)

  const val = await de('validador.');
  assert.ok(val.some((i) => i.accion === 'validador.subir' && i.resultado === 'ok'));
  assert.ok(val.some((i) => i.accion === 'validador.subir' && i.resultado === 'rechazado'));
});

// ---------------- Coordinador local regional: alcance por región, departamento, modalidad y nodo ----------------
test('coordinador regional: ve solo su territorio en toda la Bitácora', async () => {
  // Territorio de las tres iniciativas: UP 1 y UP 2 son de ATLAN1 (UP 2 con la tilde mal escrita y en M2); UP 3, de BOLIV1.
  await query(`UPDATE unidades_productivas SET departamento = CASE id_unico
      WHEN '1' THEN 'Atlántico' WHEN '2' THEN 'ATLANTICO' ELSE 'Bolívar' END,
    modalidad = CASE id_unico WHEN '2' THEN 'M2' ELSE 'M1' END`);
  const ids = async (u) => (await unidades.listarUnidades(u)).items.map((x) => x.id_unico);

  // Cada dato del territorio limita por sí solo (sin importar tildes ni mayúsculas) y se suman.
  assert.deepEqual(await ids(LOCAL_R1), ['1', '2']);
  assert.deepEqual(await ids(local({ departamento: 'atlantico' })), ['1', '2']);
  assert.deepEqual(await ids(local({ departamento: 'Atlántico', modalidad: 'm1' })), ['1']);
  assert.deepEqual(await ids(local({ nodo: 'boliv1' })), ['3']);
  assert.deepEqual(await ids(local({ region: 'Región 2', modalidad: 'M2' })), []);
  // Sin ningún dato de territorio no ve nada, en vez de verlo todo.
  const SIN_TERRITORIO = local({});
  assert.deepEqual(await ids(SIN_TERRITORIO), []);
  assert.deepEqual(await ids(COORD), ['1', '2', '3']);
  assert.deepEqual(await ids(DATOS), ['1', '2', '3']);

  await rechaza(unidades.obtenerUnidad(LOCAL_R1, { id: 'UP-3' }), 404);
  assert.equal((await unidades.obtenerUnidad(LOCAL_R1, { id: 'UP-2' })).item.id, 'UP-2');
  await rechaza(unidades.obtenerUnidad(SIN_TERRITORIO, { id: 'UP-1' }), 404);

  // Documentos (expedientes) y gestores.
  const docsLocal = (await documentos.listarDocumentos(LOCAL_R1)).items.map((d) => d.id_unico);
  assert.ok(docsLocal.includes('1') && !docsLocal.includes('3'), 'solo los expedientes de su territorio');
  await rechaza(documentos.obtenerDocumento(local({ nodo: 'BOLIV1' }), { id: 'UP-1' }), 404);
  const gestoresLocal = (await unidades.listarGestores(LOCAL_R1)).items;
  assert.ok(gestoresLocal.some((g) => g.nodo === 'ATLAN1') && gestoresLocal.every((g) => g.region === 'Región 1'));
  assert.ok(gestoresLocal.every((g) => g.cedula), 'la coordinación sí ve la cédula de sus gestores');

  // Agenda: ve y toca solo las citas de su territorio.
  const inicio = '2026-12-01T15:00:00.000Z';
  const c1 = await agenda.guardarCita(COORD, { id_unico: '1', inicio });
  const c3 = await agenda.guardarCita(COORD, { id_unico: '3', inicio });
  assert.deepEqual((await agenda.listarCitas(LOCAL_R1)).items.map((c) => c.id_unico), ['1']);
  assert.equal((await agenda.listarCitas(local({ region: 'Región 1', modalidad: 'M2' }))).items.length, 0);
  await rechaza(agenda.guardarCita(LOCAL_R1, { id_unico: '3', inicio }), 403);
  await rechaza(agenda.cambiarEstadoCita(LOCAL_R1, { id: c3.item.id, estado: 'cancelada' }), 403);
  await rechaza(agenda.eliminarCita(LOCAL_R1, { id: c3.item.id }), 403);
  assert.equal((await agenda.cambiarEstadoCita(LOCAL_R1, { id: c1.item.id, estado: 'realizada' })).item.estado, 'realizada');
  await rechaza(agenda.contactosIniciativa(LOCAL_R1, { id_unico: '3' }), 403);

  // Visitas, lista de compras y entregas.
  const docUP3 = (extra = {}) => docVisita({ id: '333_v1', unidad: { id_unico: '3', nombre: 'UP 3', documento: '333', modalidad: 'M1' }, ...extra });
  await guardarV(LOCAL_R1, docVisita());
  await rechaza(guardarV(LOCAL_R1, docUP3()), 403);
  await guardarV(COORD, docUP3());
  assert.ok((await visitas.listarVisitas(LOCAL_R1, { unidad_doc: '111' })).items.some((v) => v.id === '111_v1'));
  assert.equal((await visitas.listarVisitas(LOCAL_R1, { unidad_doc: '333' })).items.length, 0);

  // La lista de compras y las entregas se filtran por el territorio de la U.P. (filas sembradas a mano).
  for (const [idUnico, nodo] of [['1', 'ATLAN1'], ['3', 'BOLIV1']]) {
    const { rows: [up] } = await query('SELECT id_up FROM unidades_productivas WHERE id_unico = $1', [idUnico]);
    await query(`INSERT INTO items_ups (id_unico, id_up, nodo, doc) VALUES ($1,$2,$3,'{"items":[]}'::jsonb)
                 ON CONFLICT (id_unico) DO UPDATE SET vigente = TRUE`, [idUnico, up.id_up, nodo]);
    await query(`INSERT INTO entregas_ups (id_unico, id_up, nodo, doc) VALUES ($1,$2,$3,'{}'::jsonb)
                 ON CONFLICT (id_unico) DO NOTHING`, [idUnico, up.id_up, nodo]);
  }
  const idsLista = (await compras.listarItemsUPs(LOCAL_R1)).items.map((l) => l.id_unico);
  assert.ok(idsLista.includes(1) || idsLista.includes('1'));
  assert.ok(!idsLista.includes(3) && !idsLista.includes('3'), 'la lista de compras de otra región no se ve');
  await rechaza(compras.obtenerItemUP(LOCAL_R1, { id: '3' }), 403);
  await rechaza(compras.guardarItemUP(LOCAL_R1, { id: '3', compras: [] }), 403);
  const idsEntregas = (await entregas.listarEntregas(LOCAL_R1)).items.map((e) => String(e.id_unico));
  assert.ok(idsEntregas.includes('1') && !idsEntregas.includes('3'));
  assert.equal((await entregas.listarEntregas(local({ region: 'Región 1', modalidad: 'M2' }))).items.filter((e) => String(e.id_unico) === '1').length, 0);

  // Carrito: arma el de su iniciativa, no toca el de otra.
  await carrito.guardarDatos(COORD, { id_unico: '3', presupuesto_maximo: 100000 });
  await carrito.guardarDatos(LOCAL_R1, { id_unico: '1', presupuesto_maximo: 100000 });
  assert.deepEqual((await carrito.listarCarritos(LOCAL_R1)).items.map((c) => c.id_unico), ['1']);
  await rechaza(carrito.detalleCarrito(LOCAL_R1, { id_unico: '3' }), 403);
  await rechaza(carrito.guardarDatos(LOCAL_R1, { id_unico: '3', presupuesto_maximo: 1 }), 403);
  assert.equal((await carrito.listarCarritos(COORD)).items.length, 2);

  // Archivos: los de una iniciativa suya sí, los de otra no, y los que no tienen iniciativa tampoco.
  const up1 = await query("SELECT id_up FROM unidades_productivas WHERE id_unico = '1'");
  const up3 = await query("SELECT id_up FROM unidades_productivas WHERE id_unico = '3'");
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'L1_a.pdf', archivo: await archivoTemporal('a.pdf'), idUp: up1.rows[0].id_up });
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'L3_a.pdf', archivo: await archivoTemporal('a.pdf'), idUp: up3.rows[0].id_up });
  await archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'L0_a.pdf', archivo: await archivoTemporal('a.pdf') });
  assert.equal((await archivos.obtenerArchivo(LOCAL_R1, { contenedor: 'carritos', nombre: 'L1_a.pdf' })).nombre, 'L1_a.pdf');
  await rechaza(archivos.obtenerArchivo(LOCAL_R1, { contenedor: 'carritos', nombre: 'L3_a.pdf' }), 403);
  await rechaza(archivos.obtenerArchivo(LOCAL_R1, { contenedor: 'carritos', nombre: 'L0_a.pdf' }), 403);
  assert.deepEqual((await archivos.listarPorPrefijo(LOCAL_R1, { contenedor: 'carritos', prefijo: 'L' })).blobs.map((b) => b.name), ['L1_a.pdf']);

  // Validador: solo cédulas de su territorio.
  let r = await validador.procesar(LOCAL_R1, { action: 'check', cedula: '111' });
  assert.equal(r.cuerpo.exito, true);
  await rechaza(validador.procesar(LOCAL_R1, { action: 'check', cedula: '333' }), 403);
  await rechaza(validador.procesar(local({ region: 'Región 2' }), { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'aprobado' }), 403);
});

test('coordinador regional: eventos y novedades solo para los nodos de su alcance', async () => {
  // "Todos" para él son los de su alcance: ATLAN1 (la región 1 solo tiene ese nodo).
  const ev = await com.guardarEvento(LOCAL_R1, { id: 'evt_l', titulo: 'Reunión local', destinatarios: ['ATLAN1', 'BOLIV1'], respuestas: {} });
  assert.deepEqual(ev.item.destinatarios, ['ATLAN1']);
  await rechaza(com.guardarEvento(LOCAL_R1, { id: 'evt_l2', titulo: 'Ajeno', destinatarios: ['BOLIV1'], respuestas: {} }), 403);
  await rechaza(com.responderEvento(LOCAL_R1, { id: 'evt_l', nodo: 'BOLIV1', respuesta: { valor: 'si' } }), 403);
  await com.responderEvento(LOCAL_R1, { id: 'evt_l', nodo: 'ATLAN1', respuesta: { valor: 'si' } });

  // Un evento de la coordinación general que también va a otros nodos: lo ve (solo sus nodos) pero no lo cambia.
  await com.guardarEvento(COORD, { id: 'evt_g', titulo: 'De todos', destinatarios: ['ATLAN1', 'BOLIV1'], respuestas: {} });
  const vistos = (await com.listarEventos(LOCAL_R1)).items;
  assert.deepEqual(vistos.map((e) => e.id).sort(), ['evt_g', 'evt_l']);
  assert.deepEqual(vistos.find((e) => e.id === 'evt_g').destinatarios, ['ATLAN1']);
  assert.deepEqual(Object.keys(vistos.find((e) => e.id === 'evt_g').respuestas), ['ATLAN1']);
  await rechaza(com.guardarEvento(LOCAL_R1, { id: 'evt_g', titulo: 'Cambiado', destinatarios: ['ATLAN1'], respuestas: {} }), 403);
  await rechaza(com.eliminarEvento(LOCAL_R1, { id: 'evt_g' }), 403);
  await com.eliminarEvento(LOCAL_R1, { id: 'evt_l' });

  await com.guardarAviso(LOCAL_R1, { id: 'nov_l', titulo: 'Aviso local', destinatarios: ['ATLAN1', 'BOLIV1'] });
  await com.guardarAviso(COORD, { id: 'nov_g', titulo: 'Aviso general', destinatarios: ['ATLAN1', 'BOLIV1'] });
  const nov = (await com.listarAvisos(LOCAL_R1)).items.filter((n) => ['nov_g', 'nov_l'].includes(n.id));
  assert.deepEqual(nov.map((n) => [n.id, n.destinatarios.join()]).sort(), [['nov_g', 'ATLAN1'], ['nov_l', 'ATLAN1']]);
  await rechaza(com.guardarAviso(LOCAL_R1, { id: 'nov_g', titulo: 'Cambiada', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.eliminarAviso(LOCAL_R1, { id: 'nov_g' }), 403);
  await rechaza(com.marcarAvisoLeido(LOCAL_R1, { id: 'nov_g', nodo: 'BOLIV1' }), 403);

  // Sin territorio no puede enviar a nadie.
  await rechaza(com.guardarAviso(local({}), { id: 'nov_x', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await com.eliminarEvento(COORD, { id: 'evt_g' });
  await com.eliminarAviso(COORD, { id: 'nov_g' });
  await com.eliminarAviso(COORD, { id: 'nov_l' });
});

test('coordinador regional: el Coordinador general lo crea con territorio y solo abre la Bitácora', async () => {
  await reiniciarLimites();
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const clave = 'Clave-Local-Larga-55';
  const crear = (extra) => s.http('POST', '/api/admin/usuarios',
    { rol: 'coordinador', usuario: 'local.r1', nombre: 'Local Región 1', clave, ...extra });

  // Sin ningún dato de territorio no se crea; un departamento que no existe tampoco.
  assert.equal((await crear({})).status, 400);
  assert.equal((await crear({ departamento: 'Atlantida' })).status, 400);
  const alta = await crear({ region: 'Región 1', departamento: 'Atlántico', modalidad: 'M1', nodo: 'atlan1' });
  assert.equal(alta.status, 200);

  const datosAdmin = (await s.http('GET', '/api/admin/usuarios')).json;
  // El formulario ofrece las regiones, modalidades y nodos que existen.
  assert.ok(datosAdmin.territorio.regiones.includes('Región 1') && datosAdmin.territorio.regiones.includes('Región 2'));
  assert.ok(datosAdmin.territorio.modalidades.includes('M1') && datosAdmin.territorio.modalidades.includes('M2'));
  assert.ok(datosAdmin.territorio.nodos.includes('ATLAN1') && datosAdmin.territorio.nodos.includes('BOLIV1'));
  assert.ok(!datosAdmin.territorio.regiones.includes('Por asignar'));
  const lista = datosAdmin.usuarios;
  const u = lista.find((x) => x.usuario === 'local.r1');
  assert.deepEqual([u.region, u.departamento, u.modalidad, u.nodo], ['Región 1', 'Atlántico', 'M1', 'ATLAN1']);

  // Entra solo a la Bitácora (ni inventario ni administración) y ve únicamente su territorio.
  const l = await entrar('local.r1', clave);
  assert.equal(l.r.json.sesion.rol, 'coordinador');
  assert.deepEqual(l.r.json.sesion.modulos, ['bitacora', 'admin']);   // Administración limitada a lo de debajo
  assert.equal((await l.http('GET', '/api/inv/recepcion')).status, 403);
  assert.equal((await l.http('GET', '/api/inv/panel')).status, 403);
  // Administración sí, pero solo lo de debajo: no aparece el Coordinador general.
  const admRegional = await l.http('GET', '/api/admin/usuarios');
  assert.equal(admRegional.status, 200);
  assert.ok(!admRegional.json.usuarios.some((u) => u.rol === 'superadmin'));
  assert.deepEqual((await l.http('GET', '/api/unidades')).json.items.map((x) => x.id_unico), ['1']);
  assert.equal((await l.http('GET', '/api/unidades/detalle?id=UP-3')).status, 404);

  // El Coordinador general sí abre todo y ve todas las iniciativas.
  assert.equal((await s.http('GET', '/api/unidades')).json.items.length, 3);

  // Cambiarle el territorio le cierra la sesión; al volver a entrar ve lo nuevo.
  const cambio = await s.http('POST', `/api/admin/usuarios/coordinador/${u.id}/editar`,
    { rol: 'coordinador', nombre: 'Local', nodo: 'BOLIV1', region: '', departamento: '', modalidad: '' });
  assert.equal(cambio.status, 200);
  assert.equal((await l.http('GET', '/api/unidades')).status, 401);
  const otra = await entrar('local.r1', clave);
  assert.deepEqual((await otra.http('GET', '/api/unidades')).json.items.map((x) => x.id_unico), ['3']);

  // Quitarle todo el territorio no se permite; pasarlo a otro rol de coordinación lo borra.
  assert.equal((await s.http('POST', `/api/admin/usuarios/coordinador/${u.id}/editar`,
    { rol: 'coordinador', nodo: '', region: '', departamento: '', modalidad: '' })).status, 400);
  assert.equal((await s.http('POST', `/api/admin/usuarios/coordinador/${u.id}/editar`,
    { rol: 'coordinador_datos' })).status, 200);
  const dato = (await s.http('GET', '/api/admin/usuarios')).json.usuarios.find((x) => x.usuario === 'local.r1');
  assert.deepEqual([dato.rol, dato.region, dato.nodo], ['coordinador_datos', '', null]);
});

// ---------------- Técnico administrativo regional de apoyo: como el Coordinador local regional, pero solo consulta ----------------
test('técnico administrativo regional de apoyo: ve su territorio y no puede crear, modificar ni eliminar', async () => {
  await reiniciarLimites();
  const s = await entrar('jefe', 'Super-Segura-2026x');
  const clave = 'Clave-Tecnico-Larga-66';
  const crear = (extra) => s.http('POST', '/api/admin/usuarios',
    { rol: 'tecnico_administrativo', usuario: 'tecnico.r1', nombre: 'Técnica Región 1', clave, ...extra });

  // Como el Coordinador local regional, necesita territorio.
  assert.equal((await crear({})).status, 400);
  assert.equal((await crear({ region: 'Región 1', departamento: 'Atlántico', nodo: 'ATLAN1' })).status, 200);
  const datos = (await s.http('GET', '/api/admin/usuarios')).json;
  assert.ok(datos.roles.some((r) => r.rol === 'tecnico_administrativo' && r.origen === 'coordinador'));
  const u = datos.usuarios.find((x) => x.usuario === 'tecnico.r1');
  assert.deepEqual([u.rol, u.region, u.departamento, u.nodo], ['tecnico_administrativo', 'Región 1', 'Atlántico', 'ATLAN1']);

  // Solo abre la Bitácora y ve únicamente su territorio.
  const t = await entrar('tecnico.r1', clave);
  assert.equal(t.r.json.sesion.rol, 'tecnico_administrativo');
  assert.deepEqual(t.r.json.sesion.modulos, ['bitacora']);
  assert.equal((await t.http('GET', '/api/inv/panel')).status, 403);
  assert.equal((await t.http('GET', '/api/admin/usuarios')).status, 403);
  assert.deepEqual((await t.http('GET', '/api/unidades')).json.items.map((x) => x.id_unico), ['1', '2']);
  assert.equal((await t.http('GET', '/api/unidades/detalle?id=UP-3')).status, 404);

  // Consulta todo lo que consulta un Coordinador local regional.
  for (const ruta of ['/api/documentos', '/api/gestores', '/api/agenda', '/api/eventos', '/api/avisos',
    '/api/entregas', '/api/carritos', '/api/catalogo']) {
    assert.equal((await t.http('GET', ruta)).status, 200, ruta);
  }
  // Visitas no está en su matriz (ROL-TAR-03): ni la lista, ni los soportes, ni los formatos en blanco.
  for (const ruta of ['/api/visitas?unidad_doc=111', '/api/visitas/formatos', '/api/visitas/archivo?id=111_v1&blob=x']) {
    assert.equal((await t.http('GET', ruta)).status, 403, ruta);
  }
  const citas = (await t.http('GET', '/api/agenda')).json.items;
  assert.ok(citas.every((c) => c.nodo === 'ATLAN1'));
  assert.equal((await t.http('GET', '/api/carritos/detalle?id_unico=1')).json.carrito.puede_editar, false);
  assert.equal((await t.http('GET', '/api/carritos/detalle?id_unico=3')).status, 403);

  // Nada de escribir: cada intento recibe 403 y no cambia nada.
  const inicio = '2026-12-20T15:00:00.000Z';
  const intentos = [
    ['POST', '/api/agenda/guardar', { id_unico: '1', inicio }],
    ['POST', '/api/agenda/estado', { id: 1, estado: 'cancelada' }],
    ['DELETE', '/api/agenda?id=1'],
    ['POST', '/api/visitas', { visita: { id: '111_v1' } }],
    ['PUT', '/api/eventos', { id: 'e_t', titulo: 'x' }],
    ['PATCH', '/api/avisos/lectura', { id: 'n_t', nodo: 'ATLAN1' }],
    ['POST', '/api/tickets/gestion', { id: 1, accion: 'tomar' }],
    ['DELETE', '/api/eventos?id=evt'],
    ['PATCH', '/api/eventos/respuesta', { id: 'evt', nodo: 'ATLAN1', respuesta: { valor: 'si' } }],
    ['POST', '/api/items-ups/detalle', { id: '1', compras: [] }],
    ['POST', '/api/entregas', { id: '1', accion: 'contacto', telefono: '3000000000' }],
    ['POST', '/api/carritos/linea', { id_unico: '1', id_producto: 1, cantidad: 1 }],
    ['POST', '/api/carritos/datos', { id_unico: '1', presupuesto_maximo: 1 }],
    ['POST', '/api/carritos/estado', { id_unico: '1', estado: 'aprobado' }],
    ['POST', '/api/catalogo/guardar', { nombre: 'x', precio: 1 }],
    ['POST', '/api/cargue', { campo: 'proceso_subsanacion', filas: [] }],
    ['POST', '/api/archivos', {}],
  ];
  for (const [metodo, ruta, cuerpo] of intentos) {
    assert.equal((await t.http(metodo, ruta, cuerpo)).status, 403, `${metodo} ${ruta}`);
  }
  assert.equal((await agenda.listarCitas(COORD)).items.filter((c) => new Date(c.inicio).toISOString() === inicio).length, 0);

  // El validador usa POST: consultar se permite; subir, corregir o revisar no.
  const consulta = await t.http('POST', '/api/validador', { action: 'check', cedula: '111' });
  assert.equal(consulta.status, 200);
  assert.equal(consulta.json.exito, true);
  assert.equal((await t.http('POST', '/api/validador', { action: 'upload', cedula: '111' })).status, 403);
  assert.equal((await t.http('POST', '/api/validador', { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'aprobado' })).status, 403);
  assert.equal((await t.http('POST', '/api/validador', { action: 'guardar_correo', cedula: '111', correo_personal: 'x@x.co' })).status, 403);

  // Puede cambiar su propia clave (no es un dato de la Bitácora).
  assert.equal((await t.http('POST', '/api/auth/cambiar-clave',
    { actual: clave, nueva: 'Otra-Clave-Tecnico-77', repetir: 'Otra-Clave-Tecnico-77' })).status, 200);
});

test('técnico administrativo regional de apoyo: los servicios también lo rechazan si se llaman sin pasar por la ruta', async () => {
  const TEC = { sub: 'coordinador:10', rol: 'tecnico_administrativo', nombre: 'Tec', cedula: '1',
    alcance: { region: 'Región 1', departamento: null, modalidad: null, nodo: null } };
  await rechaza(entregas.accionEntrega(TEC, { id: '1', accion: 'contacto', telefono: '3000000000' }), 403);
  await rechaza(compras.guardarItemUP(TEC, { id: '1', compras: [] }), 403);
  await rechaza(com.guardarEvento(TEC, { id: 'e', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.eliminarAviso(TEC, { id: 'no_es_suyo' }), 404);   // solo borra los suyos (ver la prueba de avisos del técnico)
  await rechaza(com.responderEvento(TEC, { id: 'e', nodo: 'ATLAN1', respuesta: {} }), 403);
  await rechaza(validador.procesar(TEC, { action: 'upload', cedula: '111' }), 403);
  await rechaza(carrito.guardarDatos(TEC, { id_unico: '1', presupuesto_maximo: 5 }), 403);
  await rechaza(carrito.cambiarEstado(TEC, { id_unico: '1', estado: 'aprobado' }), 403);
  assert.ok((await carrito.listarCarritos(TEC)).items.every((c) => ['1', '2'].includes(c.id_unico)));
  assert.equal((await validador.procesar(TEC, { action: 'check', cedula: '111' })).cuerpo.exito, true);
});

async function rechazaSql(promesa) {
  await assert.rejects(promesa, (e) => e.code === '23514');
}

test('técnico administrativo regional de apoyo: una base ya creada recibe el rol sin perder los tipos que tenía', async () => {
  // Una base antigua: sin el tipo nuevo y con otro tipo que alguien agregó por su cuenta.
  await query("UPDATE coordinadores SET tipo = 'coordinador' WHERE tipo = 'tecnico_administrativo'");
  await query(`ALTER TABLE coordinadores DROP CONSTRAINT ck_coordinadores_tipo;
    ALTER TABLE coordinadores ADD CONSTRAINT ck_coordinadores_tipo CHECK
      (tipo IN ('coordinador', 'coordinador_compras', 'coordinador_datos', 'otro_tipo_propio'))`);
  await rechazaSql(query("UPDATE coordinadores SET tipo = 'tecnico_administrativo' WHERE usuario = 'tecnico.r1'"));
  await iniciarEsquemaBitacora();
  await iniciarEsquemaBitacora(); // se puede repetir
  await query("UPDATE coordinadores SET tipo = 'tecnico_administrativo' WHERE usuario = 'tecnico.r1'");
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre)
    VALUES ('R1', 'otro_tipo_propio', 'propio.x', 'x', 'Propio')`);
  await rechazaSql(query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre)
    VALUES ('R2', 'inventado', 'inventado.x', 'x', 'Otro')`));
});

test('técnico de apoyo: edita y borra solo los avisos que publicó él', async () => {
  const T1 = { ...local({ region: 'Región 1' }), sub: 'tecnico:11', rol: 'tecnico_administrativo' };
  const T2 = { ...local({ region: 'Región 1' }), sub: 'tecnico:12', rol: 'tecnico_administrativo' };
  await com.guardarAviso(T1, { id: 'nov_t1', titulo: 'Del técnico 1', destinatarios: ['ATLAN1'] });
  await com.guardarAviso(LOCAL_R1, { id: 'nov_reg', titulo: 'Del regional', destinatarios: ['ATLAN1'] });

  const vistos = (await com.listarAvisos(T1)).items;
  assert.equal(vistos.find((n) => n.id === 'nov_t1').editable, true);
  assert.equal(vistos.find((n) => n.id === 'nov_reg').editable, false);

  // Edita el suyo; no el de otro técnico ni el del regional.
  await com.guardarAviso(T1, { id: 'nov_t1', titulo: 'Del técnico 1 (editado)', destinatarios: ['ATLAN1'] });
  await rechaza(com.guardarAviso(T2, { id: 'nov_t1', titulo: 'Intento ajeno', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.guardarAviso(T1, { id: 'nov_reg', titulo: 'Intento', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.eliminarAviso(T2, { id: 'nov_t1' }), 403);
  await rechaza(com.eliminarAviso(T1, { id: 'nov_reg' }), 403);

  // El regional sí modifica el del técnico (está por encima); el gestor no publica.
  await com.guardarAviso(LOCAL_R1, { id: 'nov_t1', titulo: 'Ajustado por el regional', destinatarios: ['ATLAN1'] });
  await rechaza(com.guardarAviso(G1, { id: 'nov_g', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await com.eliminarAviso(T1, { id: 'nov_t1' }).catch(() => {});
  await com.eliminarAviso(LOCAL_R1, { id: 'nov_t1' }).catch(() => {});
  await com.eliminarAviso(LOCAL_R1, { id: 'nov_reg' });
});

// ---------------- Datos de la unidad productiva ----------------
test('editar los datos de una U.P.: solo el Coordinador general y el Profesional de seguimiento', async () => {
  const antes = (await unidades.obtenerUnidad(DATOS, { id: '1' })).item;
  const r = await fichaUP.editarUnidad(DATOS, {
    id_unico: '1', datos_up: { observaciones: 'Ajustada por seguimiento' }, datos_representante: { telefono2: '3001112233' },
  });
  assert.ok(r.cambios['unidades_productivas.observaciones']);
  const despues = (await unidades.obtenerUnidad(DATOS, { id: '1' })).item;
  assert.equal(despues.datos_up.observaciones, 'Ajustada por seguimiento');
  assert.equal(despues.datos_representante.telefono2, '3001112233');

  await rechaza(fichaUP.editarUnidad(COMPRAS, { id_unico: '1', datos_up: { nombre: 'x' } }), 403);
  await rechaza(fichaUP.editarUnidad(LOCAL_R1, { id_unico: '1', datos_up: { nombre: 'x' } }), 403);
  await rechaza(fichaUP.editarUnidad(DATOS, { id_unico: '1', datos_up: { id_unico: '9' } }), 400);   // los códigos no se editan
  await rechaza(fichaUP.editarUnidad(DATOS, { id_unico: '1' }), 400);
  await rechaza(fichaUP.editarUnidad(DATOS, { id_unico: 'no_existe', datos_up: { nombre: 'x' } }), 404);
  const hist = (await actividad.listarActividad(DATOS, { up: '1' })).items;
  assert.ok(hist.some((i) => i.accion === 'unidad.editar'), 'queda en el historial de la U.P.');
  // Del teléfono del representante solo queda que cambió (E12): ni el número viejo ni el nuevo.
  const editada = hist.find((i) => i.accion === 'unidad.editar' && i.resultado === 'ok');
  assert.equal(editada.cambios.campos['representantes.telefono2'], '(modificado)');
  assert.ok(Array.isArray(editada.cambios.campos['unidades_productivas.observaciones']));
  assert.equal(JSON.stringify(editada.cambios).includes('3001112233'), false);

  await fichaUP.editarUnidad(DATOS, {
    id_unico: '1', datos_up: { observaciones: antes.datos_up.observaciones }, datos_representante: { telefono2: antes.datos_representante.telefono2 },
  });
});

// ---------------- Bodegas, facturas y traslados ----------------
test('bodegas, facturas y traslados: el Profesional alianzas y conexión de mercados gestiona; el coordinador local regional solo consulta la suya', async () => {
  await reiniciarLimites();
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula)
    VALUES ('C-ALI', 'coordinador_compras', 'alianzas.bod', $1, 'Alianzas', '52000031')`, [await hashClave('Alianzas-Bod-2026x')]);
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, region)
    VALUES ('C-REG', 'coordinador', 'regional.bod', $1, 'Regional Bod', '52000032', 'Región 1')`, [await hashClave('Regional-Bod-2026x')]);
  const ali = await entrar('alianzas.bod', 'Alianzas-Bod-2026x');
  const reg = await entrar('regional.bod', 'Regional-Bod-2026x');
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const gestor = await entrar('atlan1', '1001001001');
  const idReg = (await query("SELECT id_coordinador AS id FROM coordinadores WHERE usuario = 'regional.bod'")).rows[0].id;

  // Solo quien administra el inventario entra a bodegas, facturas y traslados.
  assert.equal((await reg.http('GET', '/api/inv/bodegas')).status, 403);
  assert.equal((await gestor.http('GET', '/api/inv/facturas')).status, 403);

  // El Coordinador local regional también crea proveedores (los del inventario); el gestor no, y repetir el código se rechaza.
  const prov = (extra = {}) => ({
    nombre: 'Proveedor Regional S.A.S.', tipo_documento: 'NIT', numero_documento: '900123456-7', contacto: 'Ana Pérez',
    telefono: '300 123 4567', correo: 'Ventas@Proveedor.co', direccion: 'Calle 1 # 2-3', municipio: 'Barranquilla', departamento: 'Atlántico', ...extra,
  });
  const creado = await reg.http('POST', '/api/proveedores', prov());
  assert.equal(creado.status, 200);
  assert.equal(creado.json.item.correo, 'ventas@proveedor.co');                    // el correo se guarda en minúsculas
  assert.equal(creado.json.item.codigo, 'NIT-900123456-7');                        // sin código propio, se arma con el documento
  assert.equal((await reg.http('POST', '/api/proveedores', prov({ nombre: 'Otro nombre' }))).status, 409);   // mismo NIT
  assert.equal((await reg.http('POST', '/api/proveedores', prov({ tipo_documento: 'CC', numero_documento: '900123456-7' }))).status, 400);
  assert.equal((await reg.http('POST', '/api/proveedores', prov({ tipo_documento: 'CC', numero_documento: '52123456' }))).status, 200);   // cédula válida
  for (const malo of [{ nombre: '' }, { tipo_documento: 'XX' }, { numero_documento: '12' }, { contacto: '' }, { telefono: 'abc' },
    { correo: 'sin-arroba' }, { direccion: '' }, { municipio: '' }]) {
    const r = await reg.http('POST', '/api/proveedores', prov({ numero_documento: '811222333-1', ...malo }));
    assert.equal(r.status, 400, JSON.stringify(malo));
    assert.ok(r.json.campo, 'dice qué campo falló');
  }
  assert.ok((await reg.http('GET', '/api/proveedores')).json.items.some((p) => p.numero_documento === '900123456-7'));
  assert.equal((await gestor.http('POST', '/api/proveedores', prov({ numero_documento: '811222333-1' }))).status, 403);
  assert.equal((await ali.http('GET', '/api/inv/proveedores')).json.proveedores.some((p) => p.contacto === 'Ana Pérez'), true, 'lo ve el inventario');

  // Bodegas: dos principales y una municipal que cuelga de la primera.
  const p1 = (await ali.http('POST', '/api/inv/bodegas', { nombre: 'Principal Norte', tipo: 'principal', municipio: 'Barranquilla', region: 'Región 1' })).json.id;
  const p2 = (await ali.http('POST', '/api/inv/bodegas', { nombre: 'Principal Sur', tipo: 'principal', municipio: 'Cali', region: 'Región 2' })).json.id;
  assert.ok(p1 && p2);
  assert.equal((await ali.http('POST', '/api/inv/bodegas', { nombre: 'principal norte', tipo: 'principal' })).status, 409);   // el nombre no se repite
  assert.equal((await ali.http('POST', '/api/inv/bodegas', { nombre: 'Muni sin padre', tipo: 'municipal', municipio: 'X' })).status, 400);
  assert.equal((await ali.http('POST', '/api/inv/bodegas', { nombre: 'Muni mal', tipo: 'municipal', municipio: 'X', principal_id: 99999 })).status, 400);
  const m1 = (await ali.http('POST', '/api/inv/bodegas', { nombre: 'Municipal Soledad', tipo: 'municipal', municipio: 'Soledad', principal_id: p1, region: 'Región 1' })).json.id;
  assert.ok(m1);

  // Factura: cada línea va a una bodega principal; el total lo calcula el servidor; el PDF queda guardado.
  assert.equal((await ali.http('POST', '/api/inv/proveedores', {
    nombre: 'Proveedor Bodegas', tipo_documento: 'NIT', numero_documento: '800555111-2', contacto: 'Luis Gómez', telefono: '6012345678',
    correo: 'luis@bodegas.co', direccion: 'Carrera 5 # 6-7', municipio: 'Bogotá', codigo: 'PB1',
  })).status, 200);
  const proveedorId = (await query("SELECT id FROM inventario.proveedores WHERE codigo = 'PB1'")).rows[0].id;
  const token = async (s) => (await s.http('GET', '/api/auth/sesion')).json.token;
  const enviarFactura = async (s, datos, pdf = '%PDF-1.4 prueba') => {
    const form = new FormData();
    form.append('datos', JSON.stringify(datos));
    if (pdf) form.append('adjunto', new Blob([pdf], { type: 'application/pdf' }), 'factura.pdf');
    const res = await fetch(`${base}/api/inv/facturas`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': await token(s) }, body: form });
    return { status: res.status, json: await res.json() };
  };
  const linea = (extra = {}) => ({ nombre: 'Teclado', descripcion: 'USB', sku: 'SKU-TEC', cantidad: 10, valor_unitario: 1000, valor_impuesto: 1900, bodega_id: p1, total: 1, ...extra });
  const datosFactura = {
    numero: 'F-001', proveedor_id: proveedorId,
    lineas: [linea(), linea({ nombre: 'Mouse', sku: 'SKU-MOU', cantidad: 5, valor_unitario: 500, valor_impuesto: 0, bodega_id: p2 })],
  };
  assert.equal((await enviarFactura(ali, { ...datosFactura, lineas: [] })).status, 400);                          // sin líneas
  assert.equal((await enviarFactura(ali, { ...datosFactura, lineas: [linea({ bodega_id: m1 })] })).status, 400);   // solo bodegas principales
  assert.equal((await enviarFactura(ali, { ...datosFactura, lineas: [linea({ sku: '' })] })).status, 400);
  assert.equal((await enviarFactura(ali, { ...datosFactura, lineas: [linea({ cantidad: 0 })] })).status, 400);
  assert.equal((await enviarFactura(ali, datosFactura, 'no es un pdf')).status, 400);                              // adjunto que no es PDF
  assert.equal((await ali.http('GET', '/api/inv/facturas')).json.facturas.length, 0, 'las inválidas no dejan nada');
  assert.equal((await enviarFactura(ali, { ...datosFactura, fecha: '2026-10-20', vencimiento: '2026-10-01' })).status, 400);   // vence antes de la fecha
  const f = await enviarFactura(ali, { ...datosFactura, fecha: '2026-10-20', vencimiento: '2026-11-19' });
  assert.equal(f.status, 200);
  assert.equal((await enviarFactura(ali, datosFactura)).status, 409);                                              // mismo número y proveedor
  const det = (await ali.http('GET', `/api/inv/facturas/${f.json.id}`)).json;
  assert.equal(Number(det.factura.total), 10 * 1000 + 1900 + 5 * 500);                                             // 14.400
  assert.equal(String(det.factura.vencimiento).slice(0, 10), '2026-11-19');
  assert.equal(det.factura.proveedor_documento, '800555111-2');                                                      // el detalle trae la identificación del proveedor
  assert.deepEqual(det.items.map((i) => [i.sku, i.cantidad, Number(i.total), i.bodega]),
    [['SKU-TEC', 10, 11900, 'Principal Norte'], ['SKU-MOU', 5, 2500, 'Principal Sur']]);
  const pdf = await fetch(`${base}/api/inv/facturas/${f.json.id}/adjunto`, { headers: { Cookie: ali.http.cookie() } });
  assert.equal(pdf.status, 200);
  assert.equal((await pdf.text()).startsWith('%PDF-'), true);

  // Proveedores: cuántas facturas tiene cada uno, sus facturas, editar y no borrar si tiene facturas.
  const listaProv = async () => (await ali.http('GET', '/api/inv/proveedores')).json.proveedores;
  assert.equal((await listaProv()).find((p) => p.id === proveedorId).facturas, 1);
  assert.equal((await listaProv()).find((p) => p.numero_documento === '900123456-7').facturas, 0);
  const deProv = (await ali.http('GET', `/api/inv/proveedores/${proveedorId}/facturas`)).json;
  assert.deepEqual(deProv.facturas.map((x) => x.numero), ['F-001']);
  // El Coordinador local regional las ve (solo lectura): lista, detalle y PDF.
  assert.equal((await reg.http('GET', '/api/proveedores')).json.items.find((p) => p.id === proveedorId).facturas, 1);
  const factReg = (await reg.http('GET', `/api/proveedores/facturas?id=${proveedorId}`)).json.facturas;
  assert.deepEqual(factReg.map((x) => x.numero), ['F-001']);
  assert.equal((await reg.http('GET', `/api/facturas/detalle?id=${factReg[0].id}`)).json.items.length, 2);
  const pdfReg = await fetch(`${base}/api/facturas/adjunto?id=${factReg[0].id}`, { headers: { Cookie: reg.http.cookie() } });
  assert.equal(pdfReg.status, 200);
  assert.equal((await gestor.http('GET', `/api/proveedores/facturas?id=${proveedorId}`)).status, 403);
  assert.equal((await gestor.http('GET', `/api/facturas/detalle?id=${factReg[0].id}`)).status, 403);
  // Editar: el coordinador y el administrador del inventario; las reglas de validación y de documento único se mantienen.
  const editado = { id: proveedorId, nombre: 'Proveedor Bodegas S.A.', tipo_documento: 'NIT', numero_documento: '800555111-2', contacto: 'Luis G.',
    telefono: '6012345678', correo: 'luis@bodegas.co', direccion: 'Carrera 5 # 6-7', municipio: 'Bogotá' };
  assert.equal((await reg.http('PUT', '/api/proveedores', editado)).status, 200);
  assert.equal((await listaProv()).find((p) => p.id === proveedorId).contacto, 'Luis G.');
  assert.equal((await listaProv()).find((p) => p.id === proveedorId).codigo, 'PB1', 'el código interno no cambia al editar');
  assert.equal((await reg.http('PUT', '/api/proveedores', { ...editado, correo: 'malo' })).status, 400);
  assert.equal((await reg.http('PUT', '/api/proveedores', { ...editado, numero_documento: '900123456-7' })).status, 409);   // ya es de otro
  assert.equal((await ali.http('PUT', `/api/inv/proveedores/${proveedorId}`, { ...editado, contacto: 'Luis Gómez' })).status, 200);
  assert.equal((await ali.http('PUT', '/api/inv/proveedores/999999', editado)).status, 404);
  assert.equal((await gestor.http('PUT', '/api/proveedores', editado)).status, 403);
  // Eliminar es solo del Coordinador general (si nunca se usó): ni el regional, ni el gestor, ni el inventario.
  assert.ok([404, 405].includes((await ali.http('DELETE', `/api/inv/proveedores/${proveedorId}`)).status), 'el inventario ya no elimina');
  const libre = (await listaProv()).find((p) => p.numero_documento === '52123456').id;
  assert.equal((await reg.http('DELETE', `/api/proveedores?id=${libre}`)).status, 403);
  assert.equal((await gestor.http('DELETE', `/api/proveedores?id=${libre}`)).status, 403);
  assert.equal((await jefe.http('DELETE', `/api/proveedores?id=${proveedorId}`)).status, 409, 'con facturas no se elimina');
  assert.equal((await jefe.http('DELETE', `/api/proveedores?id=${libre}`)).status, 200);
  assert.equal((await jefe.http('DELETE', `/api/proveedores?id=${libre}`)).status, 404, 'ya no existe');
  assert.equal((await listaProv()).some((p) => p.id === libre), false);

  // El stock entró al artículo (total) y a la bodega indicada.
  const existencias = async (id) => (await ali.http('GET', `/api/inv/bodegas/${id}`)).json.existencias.map((e) => [e.sku, e.cantidad]);
  const regionDe = async (id) => (await query('SELECT region FROM inventario.bodegas WHERE id = $1', [id])).rows[0].region;
  const ubicadoEn = async (bid) => Number((await query('SELECT cantidad FROM inventario.stock_bodega WHERE bodega_id = $1 AND articulo_id = $2', [bid, tec])).rows[0]?.cantidad ?? 0);
  const stockTotal = async () => (await query("SELECT stock FROM inventario.articulos WHERE codigo_proveedor = 'SKU-TEC'")).rows[0].stock;
  assert.deepEqual(await existencias(p1), [['SKU-TEC', 10]]);
  assert.deepEqual(await existencias(p2), [['SKU-MOU', 5]]);
  assert.equal(await stockTotal(), 10);

  // Traslados: descuentan del origen, suman al destino, piden nota y no dejan mover más de lo que hay.
  const tec = (await query("SELECT id FROM inventario.articulos WHERE codigo_proveedor = 'SKU-TEC'")).rows[0].id;
  const trasladar = (extra) => ali.http('POST', '/api/inv/traslados',
    { origen_id: p1, destino_id: m1, nota: 'Reposición de Soledad', items: [{ articulo_id: tec, cantidad: 4 }], ...extra });
  assert.equal((await trasladar({ nota: '' })).status, 400);
  assert.equal((await trasladar({ destino_id: p1 })).status, 400);
  assert.equal((await trasladar({ items: [{ articulo_id: tec, cantidad: 11 }] })).status, 409);                   // solo hay 10
  assert.equal((await trasladar()).status, 200);
  assert.deepEqual(await existencias(p1), [['SKU-TEC', 6]]);
  assert.deepEqual(await existencias(m1), [['SKU-TEC', 4]]);
  assert.equal(await stockTotal(), 10, 'el total no cambia al trasladar');
  assert.equal((await ali.http('GET', '/api/inv/traslados')).json.traslados[0].nota, 'Reposición de Soledad');

  // Bodega municipal asignada al Coordinador local regional: él solo consulta la suya.
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${p1}/coordinador`, { coordinador_id: idReg })).status, 400);   // solo las municipales
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${m1}/coordinador`, { coordinador_id: 999999 })).status, 400);
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${m1}/coordinador`, { coordinador_id: idReg })).status, 200);
  const mia = (await reg.http('GET', '/api/mi-bodega')).json.bodegas;
  assert.deepEqual(mia.map((b) => b.nombre), ['Municipal Soledad']);
  assert.deepEqual(mia[0].existencias.map((e) => [e.sku, e.cantidad]), [['SKU-TEC', 4]]);
  assert.equal(mia[0].traslados.length, 1);
  assert.equal((await reg.http('POST', '/api/inv/traslados', { origen_id: m1, destino_id: p1, nota: 'x', items: [{ articulo_id: tec, cantidad: 1 }] })).status, 403);   // no escribe
  assert.equal((await jefe.http('GET', '/api/mi-bodega')).json.bodegas.length, 3, 'el Coordinador general ve todas');
  assert.equal((await gestor.http('GET', '/api/mi-bodega')).status, 403);
  assert.equal((await ali.http('GET', '/api/mi-bodega')).status, 403);
  // «Entregas a UP» ya no existe en el inventario (las salidas son las entregas de kits), pero el Kardex conserva las que
  // se hayan registrado antes: aquí se siembra una a mano, como la dejaba el módulo anterior.
  assert.equal((await ali.http('POST', '/api/inv/entregas-up', { bodega_id: m1, id_unico: '1', items: [{ articulo_id: tec, cantidad: 3 }] })).status, 404);
  const entregaUp = (await query(
    "INSERT INTO inventario.entregas_up (bodega_id, id_unico, unidad_nombre, nota, creado_por) VALUES ($1, '1', 'UP 1', 'Entrega inicial', 'prueba') RETURNING id", [m1])).rows[0].id;
  await query('UPDATE inventario.stock_bodega SET cantidad = cantidad - 3 WHERE bodega_id = $1 AND articulo_id = $2', [m1, tec]);
  await query('UPDATE inventario.articulos SET stock = stock - 3 WHERE id = $1', [tec]);
  await query("INSERT INTO inventario.movimientos (articulo_id, tipo, cantidad, motivo, referencia) VALUES ($1, 'salida', 3, 'entrega_up', 'UP 1')", [tec]);
  await query('INSERT INTO inventario.entrega_up_items (entrega_id, articulo_id, cantidad) VALUES ($1, $2, 3)', [entregaUp, tec]);
  assert.deepEqual(await existencias(m1), [['SKU-TEC', 1]]);
  assert.equal(await stockTotal(), 7);

  // Kardex: factura → traslado → entrega, con el saldo de cada bodega después de cada movimiento.
  const kx = (await ali.http('GET', '/api/kardex')).json;
  const deTec = (bodega) => kx.movimientos.filter((m) => m.sku === 'SKU-TEC' && m.bodega === bodega).reverse().map((m) => [m.tipo, m.cantidad, m.saldo]);
  assert.deepEqual(deTec('Principal Norte'), [['entrada', 10, 10], ['traslado_salida', -4, 6]]);
  assert.deepEqual(deTec('Municipal Soledad'), [['traslado_entrada', 4, 4], ['entrega_up', -3, 1]]);
  assert.ok(kx.movimientos.some((m) => m.comprobante === 'Factura F-001'));
  assert.ok(kx.movimientos.some((m) => /^Entrega \d{5}$/.test(m.comprobante) && m.detalle.startsWith('UP 1')));
  assert.equal(kx.bodegas.length, 3);
  // Filtros: por bodega, por tipo, por artículo/comprobante, por fechas; el saldo no cambia al filtrar.
  const porBodega = (await ali.http('GET', `/api/kardex?bodega=${m1}`)).json;
  assert.ok(porBodega.movimientos.length === 2 && porBodega.movimientos.every((m) => m.bodega === 'Municipal Soledad'));
  assert.deepEqual(porBodega.movimientos.map((m) => m.saldo), [1, 4]);
  const soloEntregas = (await ali.http('GET', '/api/kardex?tipo=entrega')).json;
  assert.ok(soloEntregas.movimientos.length === 1 && soloEntregas.resumen.salidas === 3 && soloEntregas.resumen.entradas === 0);
  assert.ok((await ali.http('GET', '/api/kardex?q=F-001')).json.movimientos.every((m) => m.comprobante === 'Factura F-001'));
  assert.equal((await ali.http('GET', '/api/kardex?desde=2999-01-01')).json.movimientos.length, 0);
  assert.equal((await ali.http('GET', '/api/kardex?hasta=2000-01-01')).json.movimientos.length, 0);
  const sal = (await ali.http('GET', '/api/kardex/saldos')).json;
  assert.ok(sal.saldos.some((s) => s.bodega === 'Municipal Soledad' && s.sku === 'SKU-TEC' && s.saldo === 1));
  assert.equal(sal.unidades, sal.saldos.reduce((s, f) => s + f.saldo, 0));
  // El Coordinador local regional solo ve las bodegas que le asignaron; el general ve todas; los demás roles no entran.
  const kReg = (await reg.http('GET', '/api/kardex')).json;
  assert.deepEqual(kReg.bodegas.map((b) => b.nombre), ['Municipal Soledad']);
  assert.ok(kReg.movimientos.length === 2 && kReg.movimientos.every((m) => m.bodega === 'Municipal Soledad'));
  assert.equal((await reg.http('GET', `/api/kardex?bodega=${p1}`)).status, 403);
  assert.ok((await reg.http('GET', '/api/kardex/saldos')).json.saldos.every((s) => s.bodega === 'Municipal Soledad'));
  assert.equal((await jefe.http('GET', '/api/kardex')).json.bodegas.length, 3);
  assert.equal((await gestor.http('GET', '/api/kardex')).status, 403);
  assert.equal((await gestor.http('GET', '/api/kardex/saldos')).status, 403);

  // Valores: la entrada lleva el valor de la factura; salidas y saldos se valoran con el costo promedio del artículo.
  const entradaTec = kx.movimientos.find((m) => m.tipo === 'entrada' && m.sku === 'SKU-TEC');
  assert.equal(Number(entradaTec.valor), 10000);
  assert.equal(Number(kx.movimientos.find((m) => m.tipo === 'entrega_up').valor), 3000);          // 3 × costo promedio ($ 1.000)
  assert.equal(Number(soloEntregas.resumen.valor_salidas), 3000);
  const saldoM1 = sal.saldos.find((s) => s.bodega === 'Municipal Soledad' && s.sku === 'SKU-TEC');
  assert.equal(Number(saldoM1.costo_promedio), 1000);
  assert.equal(Number(saldoM1.valor), 1000);

  // Lo que no pasa por una bodega (recepciones, kits y ajustes manuales) aparece en «Sin ubicar».
  assert.equal((await ali.http('POST', '/api/inv/recepcion', { proveedor_id: proveedorId, referencia: 'R-1', lineas: [{ articulo_id: tec, cantidad: 5 }] })).status, 200);
  assert.equal((await ali.http('POST', `/api/inv/articulos/${tec}/ajuste`, { stock: 14 })).status, 200);                  // 12 → 14: +2
  const sinUbicar = (await ali.http('GET', '/api/kardex?bodega=sin&q=SKU-TEC')).json;
  assert.deepEqual(sinUbicar.movimientos.slice().reverse().map((m) => [m.tipo, m.bodega, m.cantidad, m.saldo]),
    [['recepcion', 'Sin ubicar', 5, 5], ['ajuste', 'Sin ubicar', 2, 7]]);
  assert.equal((await ali.http('GET', '/api/kardex?tipo=otros&q=SKU-TEC')).json.movimientos.length, 2);
  const salSin = (await ali.http('GET', '/api/kardex/saldos?bodega=sin')).json.saldos;
  assert.deepEqual(salSin.filter((s) => s.sku === 'SKU-TEC').map((s) => [s.bodega, s.saldo]), [['Sin ubicar', 7]]);   // 14 en total − 7 ubicados
  const total = (await ali.http('GET', '/api/kardex/saldos')).json;
  assert.equal(total.saldos.filter((s) => s.sku === 'SKU-TEC').reduce((s, f) => s + f.saldo, 0), 14, 'bodegas + sin ubicar = total del inventario');
  // El Coordinador local regional no ve «Sin ubicar».
  assert.ok((await reg.http('GET', '/api/kardex')).json.movimientos.every((m) => m.bodega === 'Municipal Soledad'));
  assert.equal((await reg.http('GET', '/api/kardex?bodega=sin')).status, 403);
  assert.ok((await reg.http('GET', '/api/kardex/saldos')).json.saldos.every((s) => s.bodega === 'Municipal Soledad'));

  // ---- Correcciones de la auditoría: saldos de líneas iguales, redondeo, facturas simultáneas y stock ubicado ----
  // Dos líneas del mismo artículo y bodega en una factura: el saldo corre línea por línea (3, luego 10).
  const f2 = await enviarFactura(ali, { numero: 'F-002', proveedor_id: proveedorId, lineas: [linea({ cantidad: 3, bodega_id: p2 }), linea({ cantidad: 7, bodega_id: p2 })] });
  assert.equal(f2.status, 200);
  const lineasF2 = (await ali.http('GET', '/api/kardex?q=F-002')).json.movimientos.filter((m) => m.sku === 'SKU-TEC').reverse();
  assert.deepEqual(lineasF2.map((m) => [m.cantidad, m.saldo]), [[3, 3], [7, 10]]);
  // Precios con más de dos decimales: el total de la factura y el valor del Kardex coinciden (3 × 1,23 = 3,69).
  const fR = await enviarFactura(ali, { numero: 'F-003', proveedor_id: proveedorId, lineas: [linea({ sku: 'SKU-RND', nombre: 'Redondeo', cantidad: 3, valor_unitario: 1.234, valor_impuesto: 0 })] });
  assert.equal(fR.status, 200);
  assert.equal(Number((await ali.http('GET', `/api/inv/facturas/${fR.json.id}`)).json.factura.total), 3.69);
  assert.equal(Number((await ali.http('GET', '/api/kardex?q=SKU-RND')).json.movimientos[0].valor), 3.69);
  // Dos facturas a la vez con un SKU nuevo no crean dos artículos.
  const [pa, pb] = await Promise.all([1, 2].map((n) => enviarFactura(ali, { numero: `F-PAR-${n}`, proveedor_id: proveedorId, lineas: [linea({ sku: 'SKU-PAR', nombre: 'Paralelo' })] })));
  assert.deepEqual([pa.status, pb.status], [200, 200]);
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM inventario.articulos WHERE codigo_proveedor = 'SKU-PAR'")).rows[0].n, 1);
  // «Saldos por bodega» del Kardex respeta el artículo elegido.
  const soloTec = (await ali.http('GET', `/api/kardex/saldos?articulo=${tec}`)).json.saldos;
  assert.ok(soloTec.length > 0 && soloTec.every((s) => s.sku === 'SKU-TEC'));
  // Un ajuste hacia abajo (o armar un kit) no deja lo ubicado por encima del total: sale de lo sin ubicar y, si no alcanza, de las bodegas.
  const ubicadoTec = async () => Number((await query('SELECT COALESCE(SUM(cantidad), 0) AS n FROM inventario.stock_bodega WHERE articulo_id = $1', [tec])).rows[0].n);
  const totalAntes = await stockTotal();
  const sinUbicarAntes = totalAntes - (await ubicadoTec());
  assert.ok(sinUbicarAntes > 0);
  const nuevoTotal = (await ubicadoTec()) - 2;                                                                    // obliga a tocar 2 unidades ubicadas
  assert.equal((await ali.http('POST', `/api/inv/articulos/${tec}/ajuste`, { stock: nuevoTotal })).status, 200);
  assert.equal(await stockTotal(), nuevoTotal);
  assert.equal(await ubicadoTec(), nuevoTotal, 'lo ubicado coincide con el total: ya no hay nada sin ubicar');
  const ajusteBodega = (await ali.http('GET', '/api/kardex?tipo=otros&q=SKU-TEC')).json.movimientos.filter((m) => m.tipo === 'ajuste' && m.cantidad === -2);
  assert.equal(ajusteBodega.length, 1);
  assert.notEqual(ajusteBodega[0].bodega, 'Sin ubicar', 'el kardex muestra de qué bodega salió');
  // El Profesional de seguimiento e información (actúa como general) no entra al Kardex, pero sí a los saldos por bodega.
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula)
    VALUES ('C-DAT', 'coordinador_datos', 'datos.sal', $1, 'Seguimiento', '52000041')`, [await hashClave('Datos-Sal-2026xx')]);
  const seg = await entrar('datos.sal', 'Datos-Sal-2026xx');
  assert.equal((await seg.http('GET', '/api/kardex')).status, 403);
  assert.equal((await seg.http('GET', '/api/kardex/saldos')).status, 403);

  // ---- Saldos de productos por bodega: cada rol ve las bodegas que le corresponden ----
  const columnas = (r) => r.json.bodegas.map((b) => b.nombre).sort();
  const todasLasColumnas = ['Municipal Soledad', 'Principal Norte', 'Principal Sur', 'Sin ubicar'].sort();
  const sinUbicarFila = (r) => r.json.productos.some((p) => p.saldos.sin);
  assert.equal(await regionDe(p1), 'Región 1');
  for (const [nombre, sesion] of [['general', jefe], ['seguimiento', seg], ['alianzas', ali]]) {
    const r = await sesion.http('GET', '/api/saldos-bodegas');
    assert.equal(r.status, 200, nombre);
    assert.deepEqual(columnas(r).filter((n) => !n.startsWith('Sin')), ['Municipal Soledad', 'Principal Norte', 'Principal Sur'], nombre);
    assert.ok(r.json.bodegas.some((b) => b.id === 'sin'), `${nombre} ve «Sin ubicar»`);
  }
  assert.equal(columnas(await ali.http('GET', '/api/saldos-bodegas')).length, todasLasColumnas.length);
  // Bodeguero (rol del inventario): todas las bodegas.
  await query(`INSERT INTO inventario.usuarios (usuario, nombre, clave_hash, rol) VALUES ('bodeguero.sal', 'Bodeguero', $1, 'bodeguero')`,
    [await hashClave('Bodeguero-Sal-2026x')]);
  const bod = await entrar('bodeguero.sal', 'Bodeguero-Sal-2026x');
  const rBod = await bod.http('GET', '/api/inv/saldos-bodegas');
  assert.equal(rBod.status, 200);
  assert.deepEqual(columnas(rBod).filter((n) => !n.startsWith('Sin')), ['Municipal Soledad', 'Principal Norte', 'Principal Sur']);
  assert.equal((await bod.http('GET', '/api/saldos-bodegas')).status, 403, 'el bodeguero no entra a la Bitácora: usa la ruta del inventario');
  // Coordinador local regional y técnico de la Región 1: solo las bodegas de esa región; sin «Sin ubicar».
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, region)
    VALUES ('C-TS1', 'tecnico_administrativo', 'tec.sal1', $1, 'Técnico R1', '52000042', 'Región 1'),
           ('C-TS2', 'tecnico_administrativo', 'tec.sal2', $1, 'Técnico R2', '52000043', 'Región 2')`, [await hashClave('Tecnico-Sal-2026x')]);
  const rReg = await reg.http('GET', '/api/saldos-bodegas');
  assert.deepEqual(columnas(rReg), ['Municipal Soledad', 'Principal Norte']);
  assert.ok(!rReg.json.bodegas.some((b) => b.id === 'sin') && !sinUbicarFila(rReg));
  assert.ok(rReg.json.productos.every((p) => Object.keys(p.saldos).every((k) => k !== String(p2) && k !== 'sin')));
  assert.equal((await reg.http('GET', `/api/saldos-bodegas?bodega=${p2}`)).status, 403);
  assert.equal((await reg.http('GET', '/api/saldos-bodegas?bodega=sin')).status, 403);
  const rT1 = await (await entrar('tec.sal1', 'Tecnico-Sal-2026x')).http('GET', '/api/saldos-bodegas');
  assert.deepEqual(columnas(rT1), ['Municipal Soledad', 'Principal Norte']);
  const rT2 = await (await entrar('tec.sal2', 'Tecnico-Sal-2026x')).http('GET', '/api/saldos-bodegas');
  assert.deepEqual(columnas(rT2), ['Principal Sur']);
  // Filtros: por bodega y por texto; los totales siguen lo filtrado.
  const rFiltro = await ali.http('GET', `/api/saldos-bodegas?bodega=${m1}&q=SKU-TEC`);
  assert.deepEqual(rFiltro.json.productos.map((p) => [p.sku, p.total]), [['SKU-TEC', await ubicadoEn(m1)]]);
  assert.equal((await gestor.http('GET', '/api/saldos-bodegas')).status, 403);
  // La región de una bodega: solo existen las que tienen los nodos, y se puede cambiar.
  assert.equal((await ali.http('POST', '/api/inv/bodegas', { nombre: 'Región falsa', tipo: 'principal', region: 'Nunca' })).status, 400);
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${p2}/region`, { region: 'Región 1' })).status, 200);
  assert.deepEqual(columnas(await reg.http('GET', '/api/saldos-bodegas')), ['Municipal Soledad', 'Principal Norte', 'Principal Sur']);
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${p2}/region`, { region: 'Región 2' })).status, 200);
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${p2}/region`, { region: 'Nunca' })).status, 400);
  assert.equal((await reg.http('POST', `/api/inv/bodegas/${p2}/region`, { region: 'Región 1' })).status, 403);

  // Quitar la asignación: el coordinador deja de verla.
  assert.equal((await ali.http('POST', `/api/inv/bodegas/${m1}/coordinador`, { coordinador_id: null })).status, 200);
  assert.deepEqual((await reg.http('GET', '/api/mi-bodega')).json.bodegas, []);
});

// ---------------- Datos cargados: ver, modificar y eliminar ----------------
test('datos cargados: el Profesional de seguimiento e información los ve, modifica y elimina', async () => {
  await documentos.aplicarCargue(DATOS, { campo: 'proceso_subsanacion', filas: [{ id_unico: 1, valor: 'En curso' }, { id_unico: 3, valor: 'Cerrada' }] });

  let r = await documentos.listarCargados(DATOS);
  const mios = (x) => ['1', '3'].includes(x.id_unico);   // otras pruebas dejan expedientes de otras unidades
  assert.deepEqual(r.items.filter(mios).map((x) => [x.id_unico, x.valor, x.nodo]), [['1', 'En curso', 'ATLAN1'], ['3', 'Cerrada', 'BOLIV1']]);
  assert.ok(r.valores.map((v) => v.valor).includes('Cerrada') && r.valores.map((v) => v.valor).includes('En curso'));
  assert.deepEqual((await documentos.listarCargados(DATOS, { q: 'curso' })).items.filter(mios).map((x) => x.id_unico), ['1']);
  assert.deepEqual((await documentos.listarCargados(DATOS, { valor: 'Cerrada' })).items.filter(mios).map((x) => x.id_unico), ['3']);
  assert.equal((await documentos.listarCargados(DATOS, { q: '%' })).items.length, 0, 'el comodín se busca literal');
  await rechaza(documentos.listarCargados(DATOS, { campo: 'otro' }), 400);

  // Modificar: cambia el valor y deja la fecha de actualización.
  const e = await documentos.editarCargado(DATOS, { id_unico: '3', valor: '  Subsanada  ' });
  assert.equal(e.item.valor, 'Subsanada');
  assert.equal((await documentos.obtenerDocumento(COORD, { id: 'UP-3' })).item.subsanaciones.proceso_subsanacion, 'Subsanada');
  await rechaza(documentos.editarCargado(DATOS, { id_unico: '3', valor: '' }), 400);
  await rechaza(documentos.editarCargado(DATOS, { id_unico: '3', valor: 'x'.repeat(501) }), 400);
  await rechaza(documentos.editarCargado(DATOS, { valor: 'x' }), 400);
  await rechaza(documentos.editarCargado(DATOS, { id_unico: '999', valor: 'x' }), 404);

  // Eliminar: vuelve a "sin dato"; lo que ya estaba sin dato no cuenta.
  const d = await documentos.eliminarCargados(DATOS, { ids: ['1', '3', '3', '99'] });
  assert.deepEqual([d.eliminados, d.sin_cambios], [2, 1]);
  r = await documentos.listarCargados(DATOS, { estado: 'con' });
  assert.equal(r.items.filter(mios).length, 0);
  assert.equal((await documentos.listarCargados(DATOS, { estado: 'sin' })).items.filter(mios).length, 2);
  await rechaza(documentos.eliminarCargados(DATOS, { ids: [] }), 400);
  // Agregar donde faltaba también es modificar.
  assert.equal((await documentos.editarCargado(DATOS, { id_unico: '1', valor: 'Nueva' })).item.valor, 'Nueva');
  assert.equal((await documentos.listarCargados(DATOS, { estado: 'con' })).items.filter(mios).length, 1);

  // Nadie más lo toca: ni coordinación local, ni gestor, ni compras.
  for (const u of [LOCAL_R1, G1, COMPRAS]) {
    await rechaza(documentos.listarCargados(u), 403);
    await rechaza(documentos.editarCargado(u, { id_unico: '1', valor: 'x' }), 403);
    await rechaza(documentos.eliminarCargados(u, { ids: ['1'] }), 403);
  }
  assert.equal((await documentos.listarCargados(COORD)).ok, true, 'el Coordinador general también');
});

test('datos cargados: por la API solo entran el Profesional de seguimiento e información y el Coordinador general', async () => {
  await reiniciarLimites();
  const datos = await entrar('otra.datos', 'Clave-Muy-Larga-91');
  assert.equal(datos.r.json.sesion.rol, 'coordinador_datos');
  // Además de lo suyo tiene todo lo del Coordinador general (Bitácora e Inventario), menos Administración.
  assert.deepEqual(datos.r.json.sesion.modulos, ['bitacora', 'inventario']);
  assert.equal((await datos.http('GET', '/api/admin/usuarios')).status, 403);
  assert.equal((await datos.http('GET', '/api/admin/resumen')).status, 403);
  assert.equal((await datos.http('GET', '/api/inv/recepcion')).status, 200);
  assert.equal((await datos.http('GET', '/api/unidades')).status, 200);
  assert.equal((await datos.http('GET', '/api/entregas')).status, 200);
  assert.equal((await datos.http('GET', '/api/actividad')).status, 403, 'la actividad de todo el sistema es de Administración');
  assert.equal((await datos.http('GET', '/api/cargue/datos')).status, 200);
  assert.equal((await datos.http('POST', '/api/cargue/editar', { id_unico: '3', valor: 'Por API' })).status, 200);
  assert.equal((await datos.http('GET', '/api/cargue/datos')).json.items.find((x) => x.id_unico === '3').valor, 'Por API');
  assert.equal((await datos.http('POST', '/api/cargue/eliminar', { ids: ['3'] })).json.eliminados, 1);

  const compras = await entrar('maria.compras', 'Clave-Muy-Larga-91');
  for (const [m, ruta, cuerpo] of [['GET', '/api/cargue/datos'], ['POST', '/api/cargue/editar', { id_unico: '1', valor: 'x' }],
    ['POST', '/api/cargue/eliminar', { ids: ['1'] }]]) {
    assert.equal((await compras.http(m, ruta, cuerpo)).status, 403, ruta);
  }
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  assert.equal((await jefe.http('GET', '/api/cargue/datos')).status, 200);
});

// ---------------- Tickets: gestor → Coordinador local regional → Coordinador general ----------------
test('tickets: el gestor abre, el regional de su región atiende y el de otra región no lo ve', async () => {
  const tickets = await import('../src/servicios/tickets.js');
  const LOCAL_R2 = { ...local({ region: 'región 2' }), sub: 'coordinador:10' };

  const { item } = await tickets.crearTicket(G1, { titulo: 'No carga el soporte', descripcion: 'Falla al subir el PDF', etapa: 'diagnostico' });
  assert.equal(item.estado, 'abierto');
  assert.equal(item.nivel, 'regional');
  assert.equal(item.nodo, 'ATLAN1');
  assert.deepEqual(item.puede, { tomar: false, asignar: false, escalar: false, resolver: false, confirmar: false, reabrir: false }, 'el gestor no gestiona');

  assert.equal((await tickets.listarTickets(G1)).items.length, 1);
  assert.equal((await tickets.listarTickets(G2)).items.length, 0, 'otro nodo no lo ve');
  assert.equal((await tickets.listarTickets(LOCAL_R1)).items.length, 1);
  assert.equal((await tickets.listarTickets(LOCAL_R2)).items.length, 0, 'otra región no lo ve');
  await rechaza(tickets.gestionarTicket(LOCAL_R2, { id: item.id, accion: 'tomar' }), 403);
  await rechaza(tickets.gestionarTicket(G1, { id: item.id, accion: 'resolver', nota: 'x' }), 403);

  const [propio] = (await tickets.listarTickets(LOCAL_R1)).items;
  assert.equal(propio.puede.tomar, true);
  assert.equal(propio.puede.escalar, true);

  const tomado = await tickets.gestionarTicket(LOCAL_R1, { id: item.id, accion: 'tomar' });
  assert.equal(tomado.item.estado, 'en_gestion');
  await rechaza(tickets.gestionarTicket(LOCAL_R1, { id: item.id, accion: 'tomar' }), 400);
  await rechaza(tickets.gestionarTicket(LOCAL_R1, { id: item.id, accion: 'resolver' }), 400, 'pide nota');
  await rechaza(tickets.crearTicket(G1, { titulo: '', descripcion: 'x', etapa: 'diagnostico' }), 400);

  const resuelto = await tickets.gestionarTicket(LOCAL_R1, { id: item.id, accion: 'resolver', nota: 'Era el tamaño del archivo' });
  // E13 · TK-05: resolver deja el ticket respondido hasta que el solicitante confirma.
  assert.equal(resuelto.item.estado, 'respondido');
  assert.deepEqual(resuelto.item.historial.map((h) => h.accion), ['crear', 'tomar', 'resolver']);
  await rechaza(tickets.gestionarTicket(LOCAL_R1, { id: item.id, accion: 'tomar' }), 400);
});

test('tickets: lo que el regional no resuelve pasa al Coordinador general', async () => {
  const tickets = await import('../src/servicios/tickets.js');
  const { item } = await tickets.crearTicket(G2, { titulo: 'Falla del sistema', descripcion: 'No abre la agenda', etapa: 'administrativo' });
  const LOCAL_R2 = { ...local({ region: 'región 2' }), sub: 'coordinador:10' };

  await rechaza(tickets.gestionarTicket(LOCAL_R2, { id: item.id, accion: 'escalar' }), 400, 'pide nota');
  const esc = await tickets.gestionarTicket(LOCAL_R2, { id: item.id, accion: 'escalar', nota: 'Es un fallo del servidor' });
  assert.equal(esc.item.estado, 'escalado');
  assert.equal(esc.item.nivel, 'general');
  assert.equal(esc.item.puede.resolver, false, 'el regional ya no lo atiende');
  await rechaza(tickets.gestionarTicket(LOCAL_R2, { id: item.id, accion: 'resolver', nota: 'x' }), 403);

  const [delGeneral] = (await tickets.listarTickets(COORD)).items.filter((t) => t.id === item.id);
  assert.equal(delGeneral.puede.tomar, true);
  assert.equal(delGeneral.puede.escalar, false, 'el general no escala');
  await rechaza(tickets.gestionarTicket(COORD, { id: item.id, accion: 'escalar', nota: 'x' }), 403);
  await tickets.gestionarTicket(COORD, { id: item.id, accion: 'tomar' });
  const fin = await tickets.gestionarTicket(COORD, { id: item.id, accion: 'resolver', nota: 'Servidor reiniciado' });
  assert.equal(fin.item.estado, 'respondido');
  assert.deepEqual(fin.item.historial.map((h) => h.rol), [
    'Gestor', 'Coordinador local regional', 'Coordinador general', 'Coordinador general']);
});

test('tickets: el regional también abre tickets, directo al general; el general y el técnico no abren', async () => {
  const tickets = await import('../src/servicios/tickets.js');
  const { item } = await tickets.crearTicket(LOCAL_R1, { titulo: 'Necesito apoyo', descripcion: 'Con la región', etapa: 'fortalecimiento' });
  assert.equal(item.nivel, 'general');
  assert.equal(item.puede.resolver, false);
  assert.ok((await tickets.listarTickets(LOCAL_R1)).items.some((t) => t.id === item.id), 'lo ve quien lo abrió');
  assert.ok((await tickets.listarTickets(COORD)).items.some((t) => t.id === item.id));

  // E13 · TK-01: el nivel nacional también radica; su ticket queda en el nivel nacional.
  assert.equal((await tickets.crearTicket(COORD, { titulo: 'x', descripcion: 'y', etapa: 'administrativo' })).item.nivel, 'general');
  const TECNICO = { ...local({ region: 'región 1' }), sub: 'tecnico:1', rol: 'tecnico_administrativo' };
  assert.ok((await tickets.listarTickets(TECNICO)).items.length > 0, 'el técnico consulta lo de su alcance');
  await rechaza(tickets.gestionarTicket(TECNICO, { id: item.id, accion: 'tomar' }), 403);
  // El técnico de apoyo abre tickets hacia su Coordinador local regional, que los ve y los gestiona.
  const delTecnico = (await tickets.crearTicket(TECNICO, { titulo: 'Apoyo regional', descripcion: 'Falta material', etapa: 'fortalecimiento' })).item;
  assert.equal(delTecnico.nivel, 'regional');
  assert.equal(delTecnico.puede.tomar, false);
  const vistoPorRegional = (await tickets.listarTickets(LOCAL_R1)).items.find((t) => t.id === delTecnico.id);
  assert.ok(vistoPorRegional, 'el regional ve el ticket del técnico de su región');
  assert.equal(vistoPorRegional.puede.tomar, true);
  assert.equal((await tickets.gestionarTicket(LOCAL_R1, { id: delTecnico.id, accion: 'tomar' })).item.estado, 'en_gestion');
  const OTRA = { ...local({ region: 'Región 2' }), sub: 'tecnico:2', rol: 'tecnico_administrativo' };
  assert.ok(!(await tickets.listarTickets(OTRA)).items.some((t) => t.id === delTecnico.id), 'otra región no lo ve');
  await rechaza(tickets.listarTickets(COMPRAS), 403);
  assert.ok((await tickets.listarTickets(DATOS)).ok, 'el profesional de seguimiento ve los tickets como el general');
});

test('entrega de kits: bodega asignada, responsable y soporte obligatorios; salida atómica y sin duplicados', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const ali = await entrar('logistica', 'Logistica-Clave-2026');
  const p = (await jefe.http('POST', '/api/inv/bodegas', { nombre: 'Kits principal', tipo: 'principal' })).json.id;
  const municipal = async (nombre) => (await jefe.http('POST', '/api/inv/bodegas', { nombre, tipo: 'municipal', principal_id: p, municipio: 'Prueba' })).json.id;
  const m1 = await municipal('Kits municipal 1');
  const m2 = await municipal('Kits municipal 2');
  const nuevo = (extra = {}) => ({ rol: 'bodeguero', usuario: 'entregas.kits', nombre: 'Bodeguero kits', clave: 'Bodeguero-Kits-2026', bodega_id: m1, ...extra });
  assert.equal((await jefe.http('POST', '/api/admin/usuarios', nuevo({ bodega_id: null }))).status, 400);
  assert.equal((await jefe.http('POST', '/api/admin/usuarios', nuevo({ bodega_id: p }))).status, 400);
  const alta = await ali.http('POST', '/api/admin/usuarios', nuevo());
  assert.equal(alta.status, 200);
  const bod = await entrar('entregas.kits', 'Bodeguero-Kits-2026');
  const otroId = (await jefe.http('POST', '/api/admin/usuarios', nuevo({ usuario: 'entregas.kits2', bodega_id: m2 }))).json.id;
  const otro = await entrar('entregas.kits2', 'Bodeguero-Kits-2026');
  const sinAsignar = await entrar('bodega', 'Bodega-Segura-2026');
  assert.match((await sinAsignar.http('GET', '/api/inv/entregas-kits')).json.aviso, /asignada/);
  assert.equal((await bod.http('GET', `/api/inv/entregas-kits?bodega_id=${m2}`)).status, 403);
  const gestor = await entrar('atlan1', '1001001001');
  assert.equal((await gestor.http('GET', '/api/inv/entregas-kits')).status, 403);

  const responsable = { nombre: 'Persona responsable', documento: '123456789', telefono: '3001234567', correo: 'Persona@ejemplo.co' };
  const crearResp = (s, extra = {}) => s.http('POST', '/api/inv/entregas-kits/responsables',
    { tipo_documento: 'CC', numero_documento: '123.456.789', primer_nombre: 'Persona', segundo_nombre: 'Uno', primer_apellido: 'Responsable', segundo_apellido: 'Prueba', celular: '300 123 4567', correo: 'Persona@ejemplo.co', ...extra });
  assert.equal((await crearResp(bod, { correo: 'invalido' })).status, 400);
  assert.equal((await crearResp(bod, { numero_documento: '' })).status, 400);
  assert.equal((await crearResp(bod, { tipo_documento: 'XX' })).status, 400);
  assert.equal((await crearResp(bod, { primer_nombre: '' })).status, 400);
  assert.equal((await crearResp(bod, { primer_apellido: '' })).status, 400);
  assert.equal((await crearResp(bod, { celular: '2001234567' })).status, 400, 'el celular empieza por 3');
  assert.equal((await crearResp(bod, { bodega_id: m2 })).status, 403);
  const r1 = await crearResp(bod);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.responsable.correo, 'persona@ejemplo.co');
  assert.equal(r1.json.responsable.celular, '3001234567');
  assert.equal(r1.json.responsable.nombre, 'Persona Uno Responsable Prueba');
  assert.equal((await crearResp(bod)).status, 409);
  assert.equal((await crearResp(otro)).status, 409, 'el número de documento no se repite, tampoco en otra bodega');
  const buscar = (s, doc) => s.http('GET', `/api/inv/entregas-kits/responsables/buscar?documento=${encodeURIComponent(doc)}`);
  assert.equal((await buscar(otro, '123.456.789')).json.responsable.id, r1.json.responsable.id, 'se reutiliza desde cualquier bodega con el número completo');
  assert.equal((await buscar(otro, '12345678')).status, 404, 'un número incompleto no encuentra a nadie');
  assert.equal((await buscar(otro, '1234')).status, 400);
  // 8 intentos fallidos seguidos (un acierto reinicia la cuenta) bloquean a esa cuenta; otra cuenta no se ve afectada.
  for (let i = 0; i < 6; i++) assert.equal((await buscar(otro, `9990000${i}`)).status, 404);
  assert.equal((await buscar(otro, '99900009')).status, 404, 'el octavo fallo todavía responde 404');
  const bloqueada = await buscar(otro, '123456789');
  assert.equal(bloqueada.status, 429, 'tras 8 fallos se bloquea, aunque el documento exista');
  assert.ok(bloqueada.json.error.includes('minuto'));
  assert.equal((await crearResp(otro, { numero_documento: '555666777' })).status, 429, 'tampoco registra mientras está bloqueada');
  assert.equal((await buscar(bod, '123456789')).status, 200, 'otra cuenta sigue buscando');
  const rid = r1.json.responsable.id;

  const articulo = async (sku) => (await query(`INSERT INTO inventario.articulos (nombre, codigo_proveedor, codigo_barras, stock)
    VALUES ($1,$1,$1,20) RETURNING id`, [sku])).rows[0].id;
  const x = await articulo('ENT-KIT-X');
  const y = await articulo('ENT-KIT-Y');
  for (const [aid, cantidades] of [[x, [6,8,6]], [y, [2,8,10]]]) {
    for (const [i, bid] of [m1,m2,p].entries()) {
      await query('INSERT INTO inventario.stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1,$2,$3)', [bid, aid, cantidades[i]]);
      await query("INSERT INTO inventario.movimientos (articulo_id,tipo,cantidad,motivo,bodega_id) VALUES ($1,'entrada',$2,'recepcion',$3)", [aid, cantidades[i], bid]);
    }
  }
  const crearKit = async (nombre, items) => {
    const r = await jefe.http('POST', '/api/inv/kits', { nombre, items });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.id;
  };
  const kit = await crearKit('UP entrega kits 1', [{ articulo_id: x, cantidad: 2 }, { articulo_id: y, cantidad: 1 }]);
  const stock = async () => (await query('SELECT id, stock FROM inventario.articulos WHERE id = ANY($1::int[]) ORDER BY id', [[x,y]])).rows.map((a) => a.stock);
  const local = async (bid = m1) => (await query('SELECT cantidad FROM inventario.stock_bodega WHERE bodega_id = $1 AND articulo_id = ANY($2::int[]) ORDER BY articulo_id', [bid, [x,y]])).rows.map((a) => a.cantidad);
  assert.equal((await bod.http('POST', `/api/inv/kits/${kit}/armar`)).status, 200);
  assert.deepEqual(await stock(), [20,20], 'preparar no descuenta el inventario');
  assert.deepEqual(await local(), [6,2]);
  const contexto = (await bod.http('GET', '/api/inv/entregas-kits')).json;
  assert.equal(contexto.bodega.id, m1);
  assert.deepEqual(contexto.bodegas.map((b) => b.id), [m1]);
  assert.equal(contexto.responsables, undefined, 'no hay listado de responsables');
  assert.deepEqual((await bod.http('GET', '/api/inv/kits')).json.kits.find((k) => k.combo.id === kit).detalle.map((d) => d.stock), [6,2]);

  // Novedades de kit (dañado, incompleto...): texto y artículos del kit afectados obligatorios, cada artículo con su propia foto,
  // que debe ser una imagen real.
  const png = (marca = 0) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(20, marca)]);
  const kit2 = await crearKit('UP novedad extra', [{ articulo_id: x, cantidad: 1 }]);
  const afectados = (lista) => JSON.stringify(lista.map(([articulo_id, cantidad]) => ({ articulo_id, cantidad })));
  // Sin `fotos`, manda una foto por cada artículo pedido (con el id del artículo como marca para reconocerla después).
  const novedad = async (s, datos = {}, fotos) => {
    const campos = { tipo: 'danado', texto: 'Caja golpeada', kit_id: kit, articulos: afectados([[x, 1]]), ...datos };
    let pedidos = [];
    try { pedidos = JSON.parse(campos.articulos); } catch { /* lista inválida a propósito */ }
    fotos ??= Object.fromEntries((Array.isArray(pedidos) ? pedidos : []).map((p) => [`foto_${p.articulo_id}`, png(p.articulo_id % 256)]));
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== null) form.append(k, String(v));
    for (const [campo, contenido] of Object.entries(fotos)) form.append(campo, new Blob([contenido], { type: 'image/png' }), `${campo}.png`);
    const r = await fetch(`${base}/api/inv/kits/novedades`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: form });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await novedad(bod, {}, {})).status, 400, 'sin foto');
  assert.match((await novedad(bod, { articulos: afectados([[x, 1], [y, 1]]) }, { [`foto_${x}`]: png() })).json.error, /Adjunta la foto/, 'falta la foto de un artículo');
  assert.equal((await novedad(bod, {}, { [`foto_${x}`]: png(), [`foto_${y}`]: png() })).status, 400, 'foto de un artículo no elegido');
  assert.equal((await novedad(bod, {}, { foto: png() })).status, 400, 'foto sin artículo');
  assert.equal((await novedad(bod, { texto: '  ' })).status, 400, 'sin texto');
  assert.equal((await novedad(bod, { tipo: 'raro' })).status, 400, 'tipo desconocido');
  assert.equal((await novedad(bod, {}, { [`foto_${x}`]: 'no es una imagen' })).status, 400, 'la foto debe ser una imagen real');
  assert.equal((await novedad(bod, {}, { [`foto_${x}`]: Buffer.alloc(10 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await novedad(bod, { kit_id: null })).status, 400, 'sin kit');
  assert.equal((await novedad(bod, { kit_id: 999999 })).status, 404, 'el kit no existe');
  assert.equal((await novedad(bod, { articulos: null })).status, 400, 'sin artículos');
  assert.equal((await novedad(bod, { articulos: '[]' })).status, 400, 'lista de artículos vacía');
  assert.equal((await novedad(bod, { articulos: 'no es JSON' })).status, 400, 'lista de artículos inválida');
  assert.equal((await novedad(bod, { kit_id: kit2, articulos: afectados([[y, 1]]) })).status, 400, 'el artículo no es del kit');
  assert.equal((await novedad(bod, { articulos: afectados([[x, 3]]) })).status, 400, 'el kit lleva 2 de x');
  assert.equal((await novedad(bod, { articulos: afectados([[x, 0]]) })).status, 400, 'cantidad en cero');
  assert.equal((await novedad(bod, { articulos: afectados([[x, 1], [x, 1]]) })).status, 400, 'artículo repetido');
  // Los artículos y cantidades que ofrece la ventana son los del kit.
  assert.deepEqual((await bod.http('GET', `/api/inv/kits/${kit}/novedades`)).json.kit.articulos.map((a) => [a.articulo_id, a.cantidad]).sort((m, n) => m[0] - n[0]), [[x, 2], [y, 1]]);
  const creada = await novedad(bod, { tipo: 'incompleto', texto: 'Falta un artículo', articulos: afectados([[x, 2], [y, 1]]) });
  assert.equal(creada.status, 200, JSON.stringify(creada.json));
  const delKit = (await bod.http('GET', `/api/inv/kits/${kit}/novedades`)).json.novedades;
  assert.equal(delKit.length, 1);
  assert.equal(delKit[0].tipo, 'incompleto');
  assert.equal(delKit[0].texto, 'Falta un artículo');
  assert.deepEqual(delKit[0].articulos.map((a) => [a.articulo_id, a.cantidad, a.con_foto]).sort((m, n) => m[0] - n[0]), [[x, 2, true], [y, 1, true]],
    'guarda los artículos afectados con sus unidades y su foto');
  assert.equal(delKit[0].con_foto, false, 'las novedades nuevas no tienen foto general');
  assert.deepEqual(delKit[0].tambien, []);
  assert.equal(delKit[0].foto, undefined, 'la lista no trae los bytes de la foto');
  const contar = async (id) => (await bod.http('GET', '/api/inv/kits')).json.kits.find((k) => k.combo.id === id).combo.novedades;
  assert.equal(await contar(kit), 1);
  assert.equal(await contar(kit2), 0);
  const fotoDe = (cid, aid, s = bod) => fetch(`${base}/api/inv/kits/${cid}/novedades/${creada.json.id}/articulos/${aid}/foto`, { headers: s ? { Cookie: s.http.cookie() } : {} });
  for (const aid of [x, y]) {
    const f = await fotoDe(kit, aid);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), png(aid % 256), 'cada artículo guarda su propia foto');
  }
  assert.equal((await fotoDe(kit, x, null)).status, 401, 'la foto pide sesión');
  assert.equal((await fotoDe(kit2, x)).status, 404, 'la foto solo se ve desde el kit de la novedad');
  assert.equal((await fotoDe(kit, 999999)).status, 404, 'artículo que no está en la novedad');
  assert.equal((await fetch(`${base}/api/inv/kits/${kit}/novedades/${creada.json.id}/foto`, { headers: { Cookie: bod.http.cookie() } })).status, 404, 'sin foto general');
  // Cada novedad es de un solo kit: la del otro kit no aparece en este.
  const otraNovedad = await novedad(bod, { kit_id: kit2, articulos: afectados([[x, 1]]), texto: 'Mojado por la lluvia' });
  assert.equal(otraNovedad.status, 200, JSON.stringify(otraNovedad.json));
  assert.equal(await contar(kit), 1);
  assert.equal(await contar(kit2), 1);
  const deKit2 = (await bod.http('GET', `/api/inv/kits/${kit2}/novedades`)).json.novedades;
  assert.deepEqual(deKit2.map((n) => [n.texto, n.articulos.map((a) => a.cantidad), n.tambien]), [['Mojado por la lluvia', [1], []]]);
  assert.equal((await bod.http('GET', '/api/inv/kits/999999/novedades')).status, 404);
  assert.deepEqual(await stock(), [20,20], 'la novedad no descuenta el inventario');

  const pdf = '%PDF-1.4 soporte de entrega';
  const entregar = async (s = bod, datos = {}, contenido = pdf, nombre = 'acta.pdf') => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const form = new FormData();
    const campos = { combo_id: kit, responsable_id: rid, nota: 'Entrega verificada', ...datos };
    for (const [k,v] of Object.entries(campos)) if (v !== null) form.append(k, String(v));
    if (contenido !== null) form.append('adjunto', new Blob([contenido], { type: 'application/pdf' }), nombre);
    const r = await fetch(`${base}/api/inv/entregas-kits`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: form });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await entregar(bod, {}, null)).status, 400);
  assert.equal((await entregar(bod, { responsable_id: null })).status, 400);
  assert.equal((await entregar(bod, {}, 'archivo falso')).status, 400);
  assert.equal((await entregar(bod, {}, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await entregar(bod, { bodega_id: m2 })).status, 403);
  assert.equal((await entregar(bod, { responsable_id: 999999 })).status, 400, 'el responsable no existe');
  assert.equal((await entregar(sinAsignar)).status, 403);
  await query('UPDATE inventario.bodegas SET activa = FALSE WHERE id = $1', [m1]);
  assert.equal((await entregar()).status, 403, 'no opera en una bodega desactivada');
  await query('UPDATE inventario.bodegas SET activa = TRUE WHERE id = $1', [m1]);
  assert.deepEqual(await stock(), [20,20], 'los rechazos no modifican existencias');
  const entrega = await entregar();
  assert.equal(entrega.status, 200, JSON.stringify(entrega.json));
  assert.deepEqual(await local(), [4,1]);
  assert.deepEqual(await local(m2), [8,8], 'no toma inventario de otra bodega municipal');
  assert.deepEqual(await local(p), [6,10], 'no toma inventario de la principal');
  assert.deepEqual(await stock(), [18,19]);
  assert.equal((await entregar()).status, 409);
  assert.deepEqual(await stock(), [18,19], 'una entrega repetida no vuelve a descontar');
  const lista = (await bod.http('GET', '/api/inv/entregas-kits')).json;
  assert.equal(lista.entregas.length, 1);
  assert.equal(lista.entregas[0].responsable.documento, responsable.documento);
  assert.equal(lista.entregas[0].responsable.correo, 'persona@ejemplo.co');
  assert.equal(lista.entregas[0].responsable.tipo_documento, 'CC');
  assert.equal(lista.entregas[0].adjunto_nombre, 'acta.pdf');
  assert.equal((await otro.http('GET', '/api/inv/entregas-kits')).json.entregas.length, 0);
  const descargar = (s) => fetch(`${base}/api/inv/entregas-kits/${entrega.json.id}/adjunto`, { headers: { Cookie: s.http.cookie() } });
  assert.equal(await (await descargar(bod)).text(), pdf);
  assert.equal((await descargar(otro)).status, 404);

  const incompleto = await crearKit('UP entrega kits incompleta', [{ articulo_id: x, cantidad: 1 }, { articulo_id: y, cantidad: 2 }]);
  assert.equal((await entregar(bod, { combo_id: incompleto })).status, 409, 'el stock global no sustituye el faltante municipal');
  assert.deepEqual(await local(), [4,1], 'no queda una salida parcial del primer artículo');
  assert.deepEqual(await stock(), [18,19]);
  const simultaneo = await crearKit('UP entrega kits simultánea', [{ articulo_id: x, cantidad: 2 }, { articulo_id: y, cantidad: 1 }]);
  assert.deepEqual((await Promise.all([entregar(bod, { combo_id: simultaneo }), entregar(bod, { combo_id: simultaneo })])).map((r) => r.status).sort(), [200,409]);
  assert.deepEqual(await local(), [2,0]);
  const a = await crearKit('UP competencia 1', [{ articulo_id: x, cantidad: 2 }]);
  const b = await crearKit('UP competencia 2', [{ articulo_id: x, cantidad: 2 }]);
  assert.deepEqual((await Promise.all([entregar(bod, { combo_id: a }), entregar(bod, { combo_id: b })])).map((r) => r.status).sort(), [200,409]);
  assert.deepEqual(await local(), [0,0]);
  assert.deepEqual(await stock(), [14,18]);
  const k = (await jefe.http('GET', '/api/kardex?tipo=entrega&q=ENT-KIT-X')).json;
  assert.equal(k.movimientos.filter((m) => m.tipo === 'entrega_kit' && m.bodega_id === m1).length, 3);
  assert.equal(k.movimientos.find((m) => m.bodega_id === m1).saldo, 0, 'el Kardex muestra el saldo real de la municipal');

  // Cada entrega es de una sola unidad productiva (administrador, bodega m2 con 8 y 8): no se aceptan varios kits juntos.
  const kA = await crearKit('UP varios A', [{ articulo_id: x, cantidad: 2 }, { articulo_id: y, cantidad: 1 }]);
  const kB = await crearKit('UP varios B', [{ articulo_id: x, cantidad: 2 }, { articulo_id: y, cantidad: 1 }]);
  const entregarLista = (ids) => entregar(jefe, { combo_id: null, combo_ids: JSON.stringify(ids), bodega_id: m2 });
  const antesM2 = await local(m2);
  const antesTotal = await stock();
  const juntos = await entregarLista([kA, kB]);
  assert.equal(juntos.status, 400, 'dos kits en una entrega');
  assert.match(juntos.json.error, /una sola unidad productiva/);
  assert.equal((await entregarLista([])).status, 400, 'sin kits');
  assert.deepEqual(await local(m2), antesM2, 'un rechazo no deja salidas');
  assert.deepEqual(await stock(), antesTotal);
  const uno = await entregarLista([kA, kA]);
  assert.equal(uno.status, 200, 'un kit repetido cuenta una sola vez');
  assert.deepEqual(await local(m2), [antesM2[0] - 2, antesM2[1] - 1], 'descuenta lo del kit de la bodega elegida');
  assert.equal((await entregar(jefe, { combo_id: kB, bodega_id: m2 })).status, 200, 'la otra UP va en su propia entrega');
  assert.deepEqual(await stock(), [antesTotal[0] - 4, antesTotal[1] - 2]);
  assert.equal((await entregar(jefe, { combo_id: kA, bodega_id: m2 })).status, 409, 'un kit ya entregado no se repite');

  const antiguo = await crearKit('UP kit del flujo anterior', [{ articulo_id: x, cantidad: 1 }]);
  await query('UPDATE inventario.combos SET armado = TRUE, descontado_al_armar = TRUE WHERE id = $1', [antiguo]);
  assert.equal((await entregar(bod, { combo_id: antiguo })).status, 409, 'no se vuelve a descontar un kit antiguo');
  await iniciarEsquemaInventario();
  assert.equal((await query('SELECT descontado_al_armar FROM inventario.combos WHERE id = $1', [antiguo])).rows[0].descontado_al_armar, true);
  assert.equal((await query('SELECT descontado_al_armar FROM inventario.combos WHERE id = $1', [kit])).rows[0].descontado_al_armar, false);
  const duplicado = await crearKit('UP componentes repetidos', [{ articulo_id: x, cantidad: 5 }, { articulo_id: x, cantidad: 5 }]);
  const duplicados = (await otro.http('GET', '/api/inv/entregas-kits')).json.kits.find((c) => c.id === duplicado);
  assert.deepEqual(duplicados.items.map((i) => i.cantidad), [10]);
  assert.equal((await otro.http('POST', `/api/inv/kits/${duplicado}/armar`)).status, 409, '8 unidades no alcanzan para 5 + 5');
  assert.equal((await ali.http('POST', `/api/admin/usuarios/inventario/${otroId}/bodega`, { bodega_id: p })).status, 400);
  assert.equal((await ali.http('POST', `/api/admin/usuarios/inventario/${otroId}/bodega`, { bodega_id: m1 })).status, 200);
  assert.equal((await otro.http('GET', '/api/inv/entregas-kits')).status, 401, 'reasignar bodega cierra la sesión anterior');
  const reasignado = await entrar('entregas.kits2', 'Bodeguero-Kits-2026');
  assert.equal((await reasignado.http('GET', '/api/inv/entregas-kits')).json.bodega.id, m1);
});

test('Tallerista: región obligatoria, Eventos y Avisos regionales, tickets propios y API restringida', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const alta = (extra = {}) => jefe.http('POST', '/api/admin/usuarios', { rol: 'tallerista', usuario: 'tallerista.r1', nombre: 'Tallerista R1', clave: 'Tallerista-Pruebas-2026', region: 'Región 1', ...extra });
  assert.equal((await alta({ region: '' })).status, 400);
  assert.equal((await alta({ region: 'No existe' })).status, 400);
  assert.equal((await alta()).status, 200);
  assert.equal((await alta({ usuario: 'tallerista.r2', nombre: 'Tallerista R2', region: 'Región 2' })).status, 200);
  assert.equal((await alta({ usuario: 'tallerista.otro', nombre: 'Otro Tallerista R1' })).status, 200);
  const t1 = await entrar('tallerista.r1', 'Tallerista-Pruebas-2026');
  const t2 = await entrar('tallerista.r2', 'Tallerista-Pruebas-2026');
  const otro = await entrar('tallerista.otro', 'Tallerista-Pruebas-2026');
  assert.deepEqual(t1.r.json.sesion.modulos, ['bitacora']);
  assert.equal(t1.r.json.sesion.rol, 'tallerista');
  assert.equal(t1.r.json.sesion.region, 'Región 1');
  for (const ruta of ['/api/unidades', '/api/documentos', '/api/gestores', '/api/visitas', '/api/agenda', '/api/kardex', '/api/saldos-bodegas', '/api/admin/usuarios', '/api/inv/panel']) {
    assert.equal((await t1.http('GET', ruta)).status, 403, ruta);
  }
  const ev = { id: 'evento-tallerista', titulo: 'Encuentro regional', fecha: '2026-11-01', hora: '09:00', destinatarios: ['ATLAN1','BOLIV1'], respuestas: {} };
  assert.equal((await jefe.http('PUT', '/api/eventos', ev)).status, 200);
  const eventos = (await t1.http('GET', '/api/eventos')).json.items;
  const e = eventos.find((x) => x.id === ev.id);
  assert.deepEqual(e.destinatarios, ['ATLAN1']);
  assert.deepEqual(Object.keys(e.respuestas), ['ATLAN1']);
  assert.deepEqual((await t2.http('GET', '/api/eventos')).json.items.find((x) => x.id === ev.id).destinatarios, ['BOLIV1']);
  for (const metodo of ['PUT','DELETE']) assert.equal((await t1.http(metodo, '/api/eventos', ev)).status, 403);
  assert.equal((await t1.http('PATCH', '/api/eventos/respuesta', { id: ev.id, nodo: 'ATLAN1', respuesta: { valor: 'si' } })).status, 403);
  assert.equal((await jefe.http('PUT', '/api/avisos', { id: 'aviso-tallerista', titulo: 'Material disponible', cuerpo: 'Consulta los módulos', destinatarios: ['ATLAN1','BOLIV1'], fecha: '2026-10-22' })).status, 200);
  const aviso = (await t1.http('GET', '/api/avisos')).json.items.find((x) => x.id === 'aviso-tallerista');
  assert.deepEqual(aviso.destinatarios, ['ATLAN1']);
  assert.equal(aviso.editable, false);
  assert.equal((await t1.http('PUT', '/api/avisos', { id: 'no', titulo: 'No' })).status, 403);
  const ticket = await t1.http('POST', '/api/tickets', { titulo: 'Novedad del taller', descripcion: 'Se necesita confirmar el salón.', etapa: 'fortalecimiento' });
  assert.equal(ticket.status, 200);
  assert.equal(ticket.json.item.nivel, 'regional');
  assert.equal(ticket.json.item.creado_por_rol, 'Tallerista');
  assert.equal((await otro.http('GET', '/api/tickets')).json.items.some((t) => t.id === ticket.json.item.id), false, 'no ve tickets de otro Tallerista');
  assert.equal((await t1.http('POST', '/api/tickets/gestion', { id: ticket.json.item.id, accion: 'tomar' })).status, 403);

  assert.equal((await jefe.http('POST', '/api/admin/usuarios', { rol: 'coordinador', usuario: 'taller.regional1', nombre: 'Regional talleres', clave: 'Regional-Taller-2026', region: 'Región 1' })).status, 200);
  const reg = await entrar('taller.regional1', 'Regional-Taller-2026');
  assert.ok((await reg.http('GET', '/api/tickets')).json.items.some((t) => t.id === ticket.json.item.id));
  assert.equal((await reg.http('POST', '/api/tickets/gestion', { id: ticket.json.item.id, accion: 'tomar' })).status, 200);
  const usuarios = (await reg.http('GET', '/api/admin/usuarios')).json.usuarios;
  assert.ok(usuarios.some((u) => u.usuario === 'tallerista.r1'));
  assert.ok(!usuarios.some((u) => u.usuario === 'tallerista.r2'));
  assert.equal((await reg.http('POST', '/api/admin/usuarios', { rol: 'tallerista', usuario: 'taller.invasion', nombre: 'Fuera', clave: 'Tallerista-Clave-2026', region: 'Región 2' })).status, 403);
  assert.equal((await reg.http('POST', '/api/admin/usuarios', { rol: 'tallerista', usuario: 'taller.desde.reg', nombre: 'Tallerista regional', clave: 'Tallerista-Clave-2026', region: 'Región 1' })).status, 200);
});

test('talleres: la coordinación crea grupos y eventos con docente por encuentro; el Tallerista consulta lo suyo, anexa archivos y entrega al final', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const reg = await entrar('taller.regional1', 'Regional-Taller-2026');
  const t1 = await entrar('tallerista.r1', 'Tallerista-Pruebas-2026');
  const t2 = await entrar('tallerista.r2', 'Tallerista-Pruebas-2026');
  const otro = await entrar('tallerista.otro', 'Tallerista-Pruebas-2026');
  const subDe = async (usuario) => `coordinador:${(await query('SELECT id_coordinador FROM coordinadores WHERE usuario = $1', [usuario])).rows[0].id_coordinador}`;
  const [s1, s2, sOtro] = [await subDe('tallerista.r1'), await subDe('tallerista.r2'), await subDe('tallerista.otro')];
  await query("INSERT INTO triadas(nodo,region,triada) VALUES ('ATLAN2','Región 1','T1') ON CONFLICT DO NOTHING");
  const { rows: grupo } = await query(`INSERT INTO unidades_productivas(id_origen,id_unico,id_triada,id_representante,nombre,modalidad,municipio)
    SELECT 'TALLER-UP-'||i,'TALLER-UP-'||i,t.id_triada,(SELECT id_representante FROM unidades_productivas WHERE id_unico='1'),
      'Emprendimiento '||i,'M1','Barranquilla'
    FROM generate_series(1,40) AS i JOIN triadas t ON t.nodo=CASE WHEN i<=20 THEN 'ATLAN1' ELSE 'ATLAN2' END
    RETURNING id_up,id_unico,nombre`);
  const upFuera = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico='3'")).rows[0].id_up;
  const upExtra = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico='1'")).rows[0].id_up;

  // ---- Grupos de UP: los crean el Coordinador general y el local regional, nunca el Tallerista ----
  const guardarGrupo = (s = reg, extra = {}) => s.http('POST','/api/talleres/grupos', {nombre:'Grupo de 40 UP',region:'Región 1',ups:grupo.map((up)=>up.id_up),...extra});
  assert.equal((await guardarGrupo(t1)).status,403,'el Tallerista no crea grupos');
  assert.equal((await t1.http('GET','/api/talleres/ups?buscar=TALLER-UP-')).status,403,'ni busca UP para armarlos');
  assert.equal((await guardarGrupo(reg,{ups:[]})).status,400);
  assert.equal((await guardarGrupo(reg,{ups:[...grupo.map((up)=>up.id_up),upExtra]})).status,400);
  assert.equal((await guardarGrupo(reg,{ups:[grupo[0].id_up,grupo[0].id_up]})).status,400);
  assert.equal((await guardarGrupo(reg,{ups:[9999999]})).status,403);
  assert.equal((await guardarGrupo(reg,{ups:[grupo[0].id_up,upFuera]})).status,403);
  assert.equal((await guardarGrupo(reg,{region:'Región 2',ups:[upFuera]})).status,403,'el regional no crea grupos de otra región');
  const altaGrupo = await guardarGrupo();
  assert.equal(altaGrupo.status,200,JSON.stringify(altaGrupo.json));
  const grupoId = altaGrupo.json.item.id;
  const grupoR2 = await guardarGrupo(jefe,{nombre:'Grupo de UP región 2',region:'Región 2',ups:[upFuera]});
  assert.equal(grupoR2.status,200,'el Coordinador general crea grupos de cualquier región');
  const buscar = (await reg.http('GET','/api/talleres/ups?buscar=TALLER-UP-')).json;
  assert.equal(buscar.items.length,40);
  assert.ok(buscar.items.every((up)=>up.region==='Región 1'));
  assert.equal((await reg.http('GET','/api/talleres/ups?region=Regi%C3%B3n%202')).json.items.length,0);
  // Filtros por departamento, nodo y municipio de la UP: sin distinguir mayúsculas ni tildes.
  await query("UPDATE unidades_productivas SET departamento='Atlántico' WHERE id_unico = ANY($1)", [['TALLER-UP-1','TALLER-UP-2','TALLER-UP-3']]);
  const filtrar = async (q) => (await jefe.http('GET',`/api/talleres/ups?buscar=TALLER-UP-&${q}`)).json.items;
  assert.equal((await filtrar('nodo=atlan2')).length,20);
  assert.ok((await filtrar('nodo=atlan2')).every((up)=>up.nodo==='ATLAN2'));
  assert.equal((await filtrar('departamento=ATLANTICO')).length,3);
  assert.equal((await filtrar('departamento=atl%C3%A1ntico&nodo=ATLAN2')).length,0);
  assert.equal((await filtrar('municipio=barranquilla')).length,40);
  assert.equal((await filtrar('municipio=Soledad')).length,0);
  assert.deepEqual((await t1.http('GET','/api/talleres')).json.grupos,[],'el Tallerista no recibe la lista de grupos');
  assert.equal((await t1.http('PUT',`/api/talleres/grupos/${grupoId}`,{nombre:'Cambio ajeno',region:'Región 1',ups:[grupo[0].id_up]})).status,403);
  const editable = await guardarGrupo(reg,{nombre:'Grupo editable',ups:[grupo[0].id_up]});
  assert.equal((await reg.http('PUT',`/api/talleres/grupos/${editable.json.item.id}`,{nombre:'Grupo editado',region:'Región 1',ups:[grupo[1].id_up]})).status,200);

  // ---- Eventos: los programa la coordinación, con el docente de cada encuentro ----
  const hacer = (docentes = [s1, sOtro, s1], extra = {}) => ({ nombre: 'Fortalecimiento grupo 1', nodo: 'ATLAN1', municipio: 'Barranquilla', lugar: 'Salón de fortalecimiento', grupo_id:grupoId,
    encuentros: [1,2,3].map((modulo) => ({ modulo, inicio: `2026-01-0${modulo}T14:00:00.000Z`, duracion_minutos: 180, tallerista_sub: docentes[modulo - 1] })), ...extra });
  const programado = hacer;
  const crear = (s = reg, extra = {}, docentes) => s.http('POST', '/api/talleres', hacer(docentes, extra));
  const contexto = (await reg.http('GET', '/api/talleres')).json;
  assert.ok(contexto.nodos.length && contexto.nodos.every((n) => n.region === 'Región 1'));
  assert.equal(contexto.puede_programar, true);
  assert.equal((await t1.http('GET', '/api/talleres')).json.puede_programar, false);
  assert.equal((await crear(t1)).status, 403, 'el Tallerista no programa eventos');
  assert.equal((await crear(reg, { grupo_id:null })).status,400,'no crea eventos con personas sueltas');
  assert.equal((await crear(reg, { grupo_id:grupoR2.json.item.id })).status,404,'no elige grupos de otra región');
  assert.equal((await crear(reg, { encuentros: hacer().encuentros.slice(0,2) })).status, 400);
  assert.equal((await crear(reg, { encuentros: hacer().encuentros.map((e) => ({ ...e, duracion_minutos: 60 })) })).status, 400);
  assert.equal((await crear(reg, { encuentros: hacer().encuentros.map((e) => ({ ...e, inicio: '2026-01-01T14:00:00.000Z' })) })).status, 400);
  assert.equal((await crear(reg, { encuentros: hacer().encuentros.map((e) => e.modulo === 1 ? { ...e, inicio: '2026-02-30T14:00:00.000Z' } : e) })).status, 400);
  assert.equal((await crear(reg, { nodo: 'BOLIV1' })).status, 403);
  assert.equal((await crear(reg, {}, [s1, 'coordinador:999999', s1])).status, 400, 'el docente debe existir');
  assert.equal((await crear(reg, {}, [s1, s2, s1])).status, 400, 'el docente debe ser de la región del evento');
  assert.equal((await crear(reg, { encuentros: hacer().encuentros.map(({ tallerista_sub: _t, ...e }) => e) })).status, 400, 'cada encuentro lleva su docente');
  const alta = await crear();
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  const id = alta.json.item.id;
  assert.equal(alta.json.item.encuentros.length, 3);
  assert.deepEqual(alta.json.item.encuentros.map((e) => e.tallerista_sub), [s1, sOtro, s1]);
  assert.equal(alta.json.item.participantes.length, 40);
  assert.equal(alta.json.item.grupo_id,grupoId);
  assert.ok(alta.json.item.participantes.every((p)=>Number.isInteger(p.id_up)));
  assert.equal((await reg.http('PUT',`/api/talleres/grupos/${grupoId}`,{nombre:'Cambio histórico',region:'Región 1',ups:[grupo[0].id_up]})).status,400,'no altera un grupo ya programado');
  const reutilizado = await crear(reg,{nombre:'Segunda programación del mismo grupo',participantes:[{nombre:'Falso',documento:'999'}]});
  assert.equal(reutilizado.status,200);
  assert.deepEqual(reutilizado.json.item.participantes,alta.json.item.participantes,'la lista sale de las UP del grupo y no del cliente');
  assert.ok(alta.json.item.encuentros.every((e) => e.duracion_minutos === 180));

  // ---- Filtros de territorio: solo el Coordinador general recibe las ubicaciones de las UP ----
  const general = (await jefe.http('GET', '/api/talleres')).json;
  assert.equal(general.filtros_territorio, true);
  assert.ok(general.territorio_ups.some((t) => t.nodo === 'ATLAN2' && t.municipio === 'Barranquilla' && t.region === 'Región 1'));
  assert.ok(general.territorio_ups.some((t) => t.departamento === 'Atlántico' && t.nodo === 'ATLAN1'));
  assert.deepEqual([...new Set(general.talleres.find((t) => t.id === id).ubicaciones.map((u) => u.nodo))].sort(), ['ATLAN1', 'ATLAN2']);
  const regional = (await reg.http('GET', '/api/talleres')).json;
  assert.equal(regional.filtros_territorio, false);
  assert.deepEqual(regional.territorio_ups, []);
  assert.equal(regional.talleres.find((t) => t.id === id).ubicaciones, undefined);
  const cumplGeneral = (await jefe.http('GET', '/api/talleres/cumplimiento')).json.items.filter((i) => i.taller_id === id);
  assert.ok(cumplGeneral.length && cumplGeneral.every((i) => ['ATLAN1', 'ATLAN2'].includes(i.ubicacion?.nodo) && i.ubicacion.municipio === 'Barranquilla'));

  // ---- Convocatoria: constancia del correo por UP y llamadas como en la Agenda (solo la coordinación) ----
  const conv = (s = reg) => s.http('GET', `/api/talleres/${id}/convocatoria`);
  const llamadas = `/api/talleres/${id}/convocatoria/llamadas`;
  assert.equal((await conv(t1)).status, 403, 'el Tallerista no gestiona la convocatoria');
  const c0 = (await conv()).json;
  assert.equal(c0.items.length, 40);
  const conCorreo = c0.items.filter((i) => i.tiene_correo);
  assert.ok(conCorreo.every((i) => i.correo && i.correo.para.length && ['pendiente', 'enviado', 'enviando'].includes(i.correo.estado)), 'cada UP con correo tiene su constancia');
  assert.equal(c0.resumen.llamadas.por_llamar, 40);
  const [u0, u1, u2] = grupo.map((g) => g.id_up);
  assert.equal((await reg.http('POST', llamadas, { id_up: upFuera })).status, 404, 'solo UP del grupo');
  assert.equal((await t1.http('POST', llamadas, { id_up: u0 })).status, 403);
  // Una llamada agendada va antes del módulo que confirma (aquí, el módulo 1: 2026-01-01 a las 14:00 Z).
  assert.match((await reg.http('POST', llamadas, { id_up: u0, inicio: '2026-01-10T15:00:00.000Z' })).json.error, /La llamada debe ser antes del módulo 1/);
  assert.match((await reg.http('POST', llamadas, { id_up: u0, modulo: 3, inicio: '2026-01-03T15:00:00.000Z' })).json.error, /antes del módulo 3/);
  const ag = await reg.http('POST', llamadas, { id_up: u0, inicio: '2025-12-28T15:00:00.000Z', telefono: '300 000 0000', notas: 'Llamar en la mañana' });
  assert.equal(ag.status, 200, JSON.stringify(ag.json));
  assert.equal(ag.json.item.estado, 'agendada');
  const lid = ag.json.item.id;
  assert.equal((await reg.http('PATCH', `${llamadas}/${lid}`, { estado: 'contesto' })).status, 400, 'si contestó hay que decir si asistirá');
  assert.equal((await reg.http('PATCH', `${llamadas}/${lid}`, { estado: 'contesto', asistira: true })).status, 400, 'y si asistirá alguna persona con discapacidad');
  assert.equal((await reg.http('PATCH', `${llamadas}/${lid}`, { estado: 'contesto', asistira: true, discapacidad: true })).status, 400, 'con discapacidad se describe el ajuste');
  const ok = await reg.http('PATCH', `${llamadas}/${lid}`, { estado: 'contesto', asistira: true, discapacidad: true, discapacidad_detalle: 'Movilidad reducida: acceso sin escaleras' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.item.historial.map((h) => [h.de, h.a]), [['agendada', 'contesto']]);
  assert.equal((await reg.http('POST', llamadas, { id_up: u1, estado: 'no_contesto' })).status, 200, 'se registra una llamada de ahora');
  assert.equal((await reg.http('POST', llamadas, { id_up: u1, estado: 'contesto', asistira: false, discapacidad: false })).status, 200, 'otro intento');
  const cancelar = (await reg.http('POST', llamadas, { id_up: u2, inicio: '2025-12-29T15:00:00.000Z' })).json.item.id;
  assert.equal((await reg.http('PATCH', `${llamadas}/${cancelar}`, { estado: 'cancelada' })).status, 200);
  assert.equal((await reg.http('PATCH', `${llamadas}/${cancelar}`, { estado: 'contesto', asistira: true, discapacidad: false })).status, 400, 'una cancelada no se reabre');
  const c1 = (await conv(jefe)).json;
  const de = (idUp) => c1.items.find((i) => i.id_up === idUp);
  assert.equal(de(u0).situacion, 'asistira');
  assert.equal(de(u1).situacion, 'no_asistira');
  assert.equal(de(u1).llamadas.length, 2);
  assert.equal(de(u2).situacion, 'por_llamar', 'una llamada cancelada no cuenta');
  assert.deepEqual([c1.resumen.llamadas.asistira, c1.resumen.llamadas.no_asistira, c1.resumen.llamadas.por_llamar, c1.resumen.con_discapacidad], [1, 1, 38, 1]);
  const { rows: rastro } = await query("SELECT cambios::text AS c FROM actividad WHERE accion = 'talleres.convocatoria_llamada'");
  assert.ok(rastro.length >= 5 && rastro.every((r) => !r.c.includes('Movilidad')), 'la actividad no guarda el detalle de la discapacidad');
  // La llamada puede ser de un módulo: lo confirmado sale en la lista de asistencia de ese módulo (o de los tres).
  assert.equal((await reg.http('POST', llamadas, { id_up: u2, modulo: 5 })).status, 400, 'el módulo es 1, 2, 3 o todos');
  const m2 = await reg.http('POST', llamadas, { id_up: u2, modulo: 2, estado: 'contesto', asistira: false, discapacidad: false });
  assert.equal(m2.status, 200);
  assert.equal(m2.json.item.modulo, 2);
  const conf = (s) => async (modulo) => (await s.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id).encuentros.find((e) => e.modulo === modulo)?.confirmaciones;
  const c1m = await conf(reg)(1);
  const c2m = await conf(reg)(2);
  assert.equal(c2m[u2].situacion, 'no_asistira', 'en el módulo 2 sale que no asistirá');
  assert.equal(c1m[u2], undefined, 'en el módulo 1 sigue sin confirmar');
  assert.equal(c1m[u0].situacion, 'asistira', 'una llamada de todo el taller vale para cada módulo');
  assert.equal(c1m[u0].discapacidad_detalle, 'Movilidad reducida: acceso sin escaleras');
  assert.equal(c1m[u1].situacion, 'no_asistira', 'manda la última llamada');
  assert.equal((await conf(t1)(1))[u0].situacion, 'asistira', 'el Tallerista ve la confirmación en la lista de su módulo');
  assert.equal(await conf(t1)(2), undefined, 'y no recibe los módulos que no dicta');
  // Una llamada agendada cuya hora pasó sin resultado se ve «vencida» (no se marca «no contestó»); reprogramarla pide ir antes del módulo.
  const u3 = grupo[3].id_up;
  const venc = (await reg.http('POST', llamadas, { id_up: u3, modulo: 2, inicio: '2025-12-30T15:00:00.000Z' })).json.item;
  const c3 = (await conv()).json;
  assert.equal(c3.items.find((i) => i.id_up === u3).situacion, 'vencida');
  assert.equal(c3.items.find((i) => i.id_up === u3).llamadas[0].estado, 'agendada', 'el registro no cambia solo');
  assert.equal(c3.resumen.llamadas.vencida, 1);
  assert.equal((await conf(reg)(2))[u3].situacion, 'vencida', 'la lista de asistencia del módulo también la ve vencida');
  assert.match((await reg.http('PATCH', `${llamadas}/${venc.id}`, { inicio: '2026-01-05T15:00:00.000Z' })).json.error, /antes del módulo 2/);
  assert.equal((await reg.http('PATCH', `${llamadas}/${venc.id}`, { estado: 'no_contesto' })).status, 200, 'se le registra el resultado aunque venció');

  // ---- Calendario propio: cada Tallerista ve solo los encuentros que dicta ----
  const mios = (await t1.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  assert.deepEqual(mios.encuentros.map((e) => e.modulo), [1, 3]);
  assert.ok(mios.encuentros.every((e) => e.mio && e.tallerista_sub === s1));
  const deOtro = (await otro.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  assert.deepEqual(deOtro.encuentros.map((e) => e.modulo), [2], 'el otro Tallerista solo ve su encuentro');
  assert.equal((await t2.http('GET', '/api/talleres')).json.talleres.some((t) => t.id === id), false);
  assert.equal((await reg.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id).encuentros.length, 3);
  assert.equal((await otro.http('PUT', `/api/talleres/${id}`, programado())).status, 403);
  assert.equal((await t2.http('PUT', `/api/talleres/${id}/encuentros/1`, { inicio: '2026-01-01T15:00:00.000Z' })).status, 403);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/encuentros/2`, { inicio: '2026-01-02T16:00:00.000Z' })).status, 403, 'el Tallerista no reprograma');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { inicio: '2026-01-01T15:00:00.000Z' })).status, 400, 'no superpone encuentros');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { inicio: '2026-01-02T16:00:00.000Z' })).status, 200);
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { tallerista_sub: s2 })).status, 400, 'reasignar solo a un docente de la región');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { tallerista_sub: s1 })).status, 200, 'la coordinación reasigna el docente');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { tallerista_sub: sOtro })).status, 200);

  const multipart = async (s, metodo, ruta, campos = {}, archivos = []) => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const f = new FormData();
    Object.entries(campos).forEach(([k,v]) => f.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
    archivos.forEach(([campo, nombre, contenido, tipo = 'application/pdf']) => f.append(campo, new Blob([contenido], { type: tipo }), nombre));
    const r = await fetch(base + ruta, { method: metodo, headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: f });
    return { status: r.status, json: await r.json() };
  };
  const pdf = '%PDF-1.4 soporte del taller';
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0]);
  const mp4 = Buffer.from([0,0,0,0x18,...Buffer.from('ftypmp42'),0,0,0,0]);
  // Las tres secciones obligatorias del módulo realizado: informe, fotos y videos (cada una en su formato).
  const EVID = [['informe','informe.pdf',pdf], ['fotos','foto-1.png',png,'image/png'], ['videos','video-1.mp4',mp4,'video/mp4']];
  const sinEvid = (campo) => EVID.filter(([c]) => c !== campo);
  const realizarCon = (s, modulo, asistencia, archivos, tallerId = id) =>
    multipart(s, 'POST', `/api/talleres/${tallerId}/encuentros/${modulo}/realizar`, { asistencia, observaciones: 'Módulo realizado durante tres horas', evaluacion: 'Prueba escrita y socialización de lo aprendido' }, archivos);
  const realizar = (s = t1, modulo = 1, asistencia = grupo.map((p) => `up:${p.id_up}`), archivos = [['soportes', 'asistencia.pdf', pdf]], tallerId = id) =>
    realizarCon(s, modulo, asistencia, [...archivos, ...EVID], tallerId);
  assert.equal((await realizar(t1, 1, [`up:${grupo[0].id_up}`], [])).status, 400, 'soporte obligatorio');
  assert.equal((await realizar(t1, 1, [])).status, 400);
  assert.equal((await realizar(t1, 1, ['persona-no-inscrita'])).status, 400);
  assert.equal((await realizar(t1, 1, [`up:${grupo[0].id_up}`, `up:${grupo[0].id_up}`])).status, 400);
  assert.equal((await realizar(t1, 1, grupo.map((p) => `up:${p.id_up}`), [['soportes', 'falso.pdf', 'no es pdf']])).status, 400);
  assert.equal((await realizar(t1, 1, grupo.map((p) => `up:${p.id_up}`), [['soportes', 'grande.pdf', Buffer.alloc(20 * 1024 * 1024 + 1)]])).status, 413, 'la asistencia firmada hasta 20 MB');
  // Informe, fotos y videos: obligatorios y cada uno en su formato.
  const todos = grupo.map((p) => `up:${p.id_up}`);
  const asist = [['soportes', 'asistencia.pdf', pdf]];
  for (const campo of ['informe', 'fotos', 'videos']) {
    const r = await realizarCon(t1, 1, todos, [...asist, ...sinEvid(campo)]);
    assert.equal(r.status, 400, `${campo} es obligatorio`);
    assert.match(r.json.error, /es obligatorio/);
  }
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...sinEvid('informe'), ['informe','informe.png',png,'image/png']])).status, 400, 'el informe es PDF o Word');
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...sinEvid('fotos'), ['fotos','foto.pdf',pdf]])).status, 400, 'las fotos son JPG o PNG');
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...sinEvid('videos'), ['videos','video.png',png,'image/png']])).status, 400, 'los videos son MP4, MOV o WEBM');
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...sinEvid('videos'), ['videos','falso.mp4','no es video','video/mp4']])).status, 400, 'se revisa el contenido, no solo la extensión');
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...EVID, ['informe','otro-informe.pdf',pdf]])).status, 400, 'un solo informe por vez');
  assert.equal((await realizarCon(t1, 1, todos, [...asist, ...sinEvid('fotos'), ['fotos','grande.png',Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024)]),'image/png']])).status, 413, 'cada foto hasta 20 MB');
  // Una foto de 15 MB pasa la revisión de peso: el rechazo llega por la sección siguiente (falta el video), no por la foto.
  assert.match((await realizarCon(t1, 1, todos, [...asist, EVID[0], ['fotos','pesada.png',Buffer.concat([png, Buffer.alloc(15 * 1024 * 1024)]),'image/png']])).json.error, /Videos del módulo: es obligatorio/);
  assert.equal((await realizar(otro)).status, 403, 'el encuentro 1 lo dicta otro Tallerista');
  assert.equal((await realizar(t2)).status, 404);
  const [primero, repetido] = await Promise.all([realizar(), realizar()]);
  assert.deepEqual([primero.status, repetido.status].sort(), [200,400], 'una sola asistencia por encuentro aunque se envíe dos veces');
  const taller = (await t1.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  const e1 = taller.encuentros.find((e) => e.modulo === 1);
  assert.equal(e1.asistencia.length, 40);
  assert.equal(e1.soportes.length, 4);
  assert.equal(e1.soportes[0].tipo, 'asistencia', 'la planilla firmada queda marcada como asistencia');
  assert.deepEqual(e1.soportes.slice(1).map((x) => [x.tipo, x.nombre]), [['informe','informe.pdf'], ['foto','foto-1.png'], ['video','video-1.mp4']]);
  assert.equal((await reg.http('PUT', `/api/talleres/${id}`, programado([s1, sOtro, s1], { participantes: [] }))).status, 400, 'no cambia el grupo después de tomar asistencia');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/1`, { inicio: '2026-01-01T16:00:00.000Z' })).status, 400);
  const sid = e1.soportes[0].id;
  const descargar = (s, ruta) => fetch(base + ruta, { headers: { Cookie: s.http.cookie() } });
  assert.equal(await (await descargar(t1, `/api/talleres/soportes/${sid}`)).text(), pdf);
  assert.equal((await descargar(otro, `/api/talleres/soportes/${sid}`)).status, 404, 'un Tallerista no ve los archivos del encuentro de otro');
  assert.equal((await descargar(t2, `/api/talleres/soportes/${sid}`)).status, 404);
  assert.equal((await descargar(reg, `/api/talleres/soportes/${sid}`)).status, 200);
  assert.equal((await realizar(t1, 2, grupo.slice(0,20).map((p) => `up:${p.id_up}`))).status, 403, 'el encuentro 2 es del otro Tallerista');
  assert.equal((await realizar(otro, 2, grupo.slice(0,20).map((p) => `up:${p.id_up}`), [['soportes','acta-2.pdf',pdf], ['soportes','evidencia-2.pdf',pdf]])).status, 200);
  assert.equal((await realizar(t1, 3, grupo.slice(0,10).map((p) => `up:${p.id_up}`))).status, 200);
  const terminado = (await reg.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  assert.deepEqual(terminado.encuentros.map((e) => e.asistencia.length), [40,20,10]);
  assert.equal(terminado.encuentros.filter((e) => e.realizado_en).length, 3);
  assert.equal(terminado.grupo_completo, true);
  assert.equal(terminado.encuentros[1].soportes.length, 5);
  assert.equal(terminado.encuentros.reduce((total, e) => total + e.duracion_minutos, 0), 540);

  // ---- Imágenes y documentos por evento: los anexa el docente (a lo suyo) y la coordinación; solo esta los quita ----
  const anexar = (s, modulo, archivos, tipo = 'foto', tallerId = id) => multipart(s, 'POST', `/api/talleres/${tallerId}/encuentros/${modulo}/soportes`, { tipo }, archivos);
  assert.equal((await anexar(t1, 1, [['soportes','foto.png',png,'image/png']])).status, 200, 'anexa una foto a su módulo');
  assert.equal((await anexar(t1, 1, [['soportes','notas.pdf',pdf]], 'informe')).status, 200);
  assert.equal((await anexar(t1, 1, [])).status, 400);
  assert.equal((await anexar(t1, 1, [['soportes','falso.png','no es una imagen','image/png']])).status, 400);
  assert.equal((await anexar(t1, 1, [['soportes','notas.pdf',pdf]], 'foto')).status, 400, 'cada sección solo admite su formato');
  assert.equal((await anexar(t1, 1, [['soportes','foto.png',png,'image/png']], 'otro')).status, 400, 'hay que elegir una de las tres secciones');
  assert.equal((await anexar(t1, 1, [['soportes','foto.png',png,'image/png']], 'foto', reutilizado.json.item.id)).status, 400, 'antes de registrar el módulo, las evidencias van en el registro');
  assert.equal((await anexar(t1, 2, [['soportes','foto.png',png,'image/png']])).status, 403, 'no anexa al encuentro de otro Tallerista');
  assert.equal((await anexar(t2, 1, [['soportes','foto.png',png,'image/png']])).status, 404);
  assert.equal((await anexar(otro, 2, [['soportes','foto-otro.png',png,'image/png']])).status, 200);
  assert.equal((await anexar(reg, 3, [['soportes','coordinacion.pdf',pdf]], 'informe')).status, 200, 'la coordinación también anexa');
  const conArchivos = (await t1.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  const fotos = conArchivos.encuentros.find((e) => e.modulo === 1).soportes;
  assert.deepEqual(fotos.map((s) => s.nombre), ['asistencia.pdf','informe.pdf','foto-1.png','video-1.mp4','foto.png','notas.pdf']);
  assert.deepEqual(fotos.map((s) => s.tipo), ['asistencia','informe','foto','video','foto','informe'], 'lo anexado después queda en su sección');
  // Un módulo realizado no se queda sin una sección obligatoria: el único video no se quita.
  const unicoVideo = fotos.find((s) => s.tipo === 'video');
  assert.equal((await reg.http('DELETE', `/api/talleres/soportes/${unicoVideo.id}`)).status, 409, 'el único video no se quita');
  const foto = fotos.find((s) => s.nombre === 'foto.png');
  assert.equal((await descargar(t1, `/api/talleres/soportes/${foto.id}`)).headers.get('content-type').startsWith('image/png'), true);
  assert.equal((await t1.http('DELETE', `/api/talleres/soportes/${foto.id}`)).status, 403, 'el Tallerista no quita archivos');
  assert.equal((await reg.http('DELETE', `/api/talleres/soportes/${foto.id}`)).status, 200, 'la coordinación sí');
  assert.equal((await descargar(reg, `/api/talleres/soportes/${foto.id}`)).status, 404);
  const deLaOtra = (await otro.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id).encuentros[0].soportes.find((s) => s.nombre === 'foto-otro.png');
  assert.equal((await descargar(t1, `/api/talleres/soportes/${deLaOtra.id}`)).status, 404);
  assert.equal((await descargar(reg, `/api/talleres/soportes/${deLaOtra.id}`)).status, 200);

  // ---- Entrega final por UP (PDF) cuando el grupo termina los tres encuentros ----
  const entregar = (s, idUp, archivos = [['archivo','entrega-final.pdf',pdf]], tallerId = id) => multipart(s, 'POST', `/api/talleres/${tallerId}/entregas-finales/${idUp}`, {}, archivos);
  const a2 = await crear(jefe, { nombre: 'Grupo región 2', nodo: 'BOLIV1', grupo_id: grupoR2.json.item.id }, [s2, s2, s2]);
  assert.equal(a2.status, 200, JSON.stringify(a2.json));
  assert.equal((await reg.http('GET', '/api/talleres')).json.talleres.some((t) => t.id === a2.json.item.id), false);
  const futuro = await crear(reg, { nombre: 'Grupo futuro', encuentros: [1,2,3].map((modulo) => ({ modulo, inicio: `2999-01-0${modulo}T14:00:00.000Z`, tallerista_sub: s1 })) });
  assert.equal(futuro.status, 200);
  assert.equal((await realizar(t1, 1, [`up:${grupo[0].id_up}`], [['soportes','acta.pdf',pdf]], futuro.json.item.id)).status, 400, 'no registra como realizado un encuentro futuro');
  assert.equal((await entregar(t1, grupo[0].id_up, undefined, futuro.json.item.id)).status, 400, 'la entrega final espera a que termine la formación');
  assert.equal((await entregar(t1, grupo[0].id_up, [])).status, 400);
  assert.equal((await entregar(t1, grupo[0].id_up, [['archivo','falso.pdf','no es pdf']])).status, 400);
  assert.equal((await entregar(t1, grupo[0].id_up, [['archivo','foto.png',png,'image/png']])).status, 400, 'la entrega final es PDF');
  assert.equal((await entregar(t1, upFuera)).status, 404, 'solo UP del grupo');
  assert.equal((await entregar(t2, grupo[0].id_up)).status, 404);
  assert.equal(terminado.entrega_final_sub, s1, 'por defecto carga la entrega final el docente del último encuentro');
  assert.equal((await entregar(t1, grupo[0].id_up)).status, 200);
  assert.equal((await entregar(t1, grupo[0].id_up)).status, 400, 'el Tallerista no reemplaza una entrega ya cargada');
  assert.equal((await entregar(otro, grupo[1].id_up, [['archivo','otra.pdf',pdf + ' otra']])).status, 403, 'solo el docente del último encuentro entrega');
  // La coordinación reasigna al docente de la entrega final (por ejemplo si el anterior renuncia).
  const reasignar = (s, sub) => s.http('PUT', `/api/talleres/${id}/entrega-final-docente`, { tallerista_sub: sub });
  assert.equal((await reasignar(t1, sOtro)).status, 403, 'el Tallerista no reasigna');
  assert.equal((await reasignar(reg, s2)).status, 400, 'solo un docente de la región');
  assert.equal((await reasignar(reg, 'coordinador:999999')).status, 400);
  const reasignado = await reasignar(reg, sOtro);
  assert.equal(reasignado.status, 200, JSON.stringify(reasignado.json));
  assert.equal(reasignado.json.item.entrega_final_sub, sOtro);
  assert.equal((await entregar(t1, grupo[2].id_up)).status, 403, 'el docente anterior ya no entrega');
  assert.equal((await entregar(otro, grupo[1].id_up, [['archivo','otra.pdf',pdf + ' otra']])).status, 200, 'el nuevo docente entrega, aunque dictó otro encuentro');
  assert.equal((await entregar(reg, grupo[0].id_up, [['archivo','reemplazo.pdf',pdf + ' reemplazo']])).status, 200, 'la coordinación reemplaza');
  const delNuevo = (await otro.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  assert.equal(delNuevo.puede_entregar, true);
  assert.deepEqual(delNuevo.entregas_finales.map((f) => f.id_up).sort(), [grupo[0].id_up, grupo[1].id_up].sort());
  const delAnterior = (await t1.http('GET', '/api/talleres')).json.talleres.find((t) => t.id === id);
  assert.equal(delAnterior.puede_entregar, false);
  assert.deepEqual(delAnterior.entregas_finales, [], 'el docente anterior ya no ve las entregas');
  const fin0 = delNuevo.entregas_finales.find((f) => f.id_up === grupo[0].id_up);
  assert.equal(await (await descargar(otro, `/api/talleres/entregas-finales/${fin0.id}`)).text(), pdf + ' reemplazo');
  assert.equal((await descargar(t1, `/api/talleres/entregas-finales/${fin0.id}`)).status, 404);
  assert.equal((await descargar(reg, `/api/talleres/entregas-finales/${fin0.id}`)).status, 200);
  assert.equal((await descargar(t2, `/api/talleres/entregas-finales/${fin0.id}`)).status, 404);
  // Reasignar al docente del encuentro 3 mientras es el responsable arrastra la entrega final.
  assert.equal((await reg.http('PUT', `/api/talleres/${futuro.json.item.id}/encuentros/3`, { tallerista_sub: sOtro })).status, 200);
  assert.equal((await query('SELECT entrega_final_sub FROM talleres_fortalecimiento WHERE id=$1', [futuro.json.item.id])).rows[0].entrega_final_sub, sOtro);

  const contenido = { region: 'Región 1', modulo: 1, titulo: 'Contenido oficial del encuentro 1', texto: 'Material aprobado por la coordinación', enlace: 'https://ejemplo.co/clase1' };
  const publicar = (s, extra = {}, archivos = [['archivo','modulo1.pdf',pdf]]) => multipart(s, 'PUT', '/api/talleres/contenidos/publicar', { ...contenido, ...extra }, archivos);
  assert.equal((await publicar(t1)).status, 403);
  assert.equal((await publicar(reg, { region: 'Región 2' })).status, 403);
  assert.equal((await publicar(reg, { enlace: 'javascript:alert(1)' })).status, 400);
  assert.equal((await publicar(reg, { texto: '', enlace: '' }, [])).status, 400);
  assert.equal((await publicar(reg)).status, 200, 'el Coordinador local regional publica contenidos de su región');
  // ET2-05: el Tallerista solo ve y descarga contenidos aprobados por el Comité Técnico; la aprobación la registra el general.
  const pendiente = (await reg.http('GET', '/api/talleres')).json.contenidos.find((x) => x.region === 'Región 1' && x.modulo === 1);
  assert.equal(pendiente.aprobado, false);
  assert.equal((await t1.http('GET', '/api/talleres')).json.contenidos.some((x) => x.id === pendiente.id), false, 'sin aprobar no lo ve el Tallerista');
  assert.equal((await descargar(t1, `/api/talleres/contenidos/${pendiente.id}/archivo`)).status, 404);
  const version = async () => (await reg.http('GET', '/api/talleres')).json.contenidos.find((x) => x.id === pendiente.id).actualizado_en;
  const aprobar = async (s, extra = {}, archivos = [['archivo', 'acta-comite.pdf', pdf]]) =>
    multipart(s, 'PUT', `/api/talleres/contenidos/${pendiente.id}/aprobacion`, { fecha: hoyIso(), version: await version(), ...extra }, archivos);
  assert.equal((await aprobar(reg)).status, 403, 'el Coordinador local regional no registra la aprobación del Comité');
  assert.equal((await aprobar(jefe, {}, [])).status, 400, 'el acta es obligatoria');
  assert.equal((await aprobar(jefe, { fecha: '2999-01-01' })).status, 400);
  assert.equal((await aprobar(jefe)).status, 200);
  assert.equal((await ultimaActividad('talleres.contenido_aprobado')).resultado, 'ok');
  const contenidos = (await t1.http('GET', '/api/talleres')).json.contenidos;
  const c = contenidos.find((c) => c.region === 'Región 1' && c.modulo === 1);
  assert.ok(c?.tiene_adjunto, 'el Tallerista consulta el contenido de su región');
  assert.equal((await t2.http('GET', '/api/talleres')).json.contenidos.some((x) => x.id === c.id), false);
  assert.equal(await (await descargar(t1, `/api/talleres/contenidos/${c.id}/archivo`)).text(), pdf);
  assert.equal((await descargar(t2, `/api/talleres/contenidos/${c.id}/archivo`)).status, 404);
  assert.equal((await publicar(jefe, { region: 'Región 2', modulo: 3 })).status, 200);
  const revisada = await version();
  assert.equal((await publicar(reg, { titulo: 'Actualizado' }, [])).status, 200);
  // La aprobación es de la versión revisada: si cambió mientras tanto, 409.
  assert.equal((await aprobar(jefe, { version: revisada })).status, 409);
  assert.equal((await aprobar(jefe, { version: '' })).status, 400);
  // Editar un contenido aprobado lo vuelve a dejar pendiente del Comité.
  assert.equal((await t1.http('GET', '/api/talleres')).json.contenidos.some((x) => x.id === c.id), false, 'editado, vuelve a pendiente');
  assert.equal((await aprobar(jefe)).status, 200);
  assert.equal((await t1.http('GET', '/api/talleres')).json.contenidos.find((x) => x.id === c.id).tiene_adjunto, true, 'editar texto conserva el PDF');

  const cuenta = (await jefe.http('GET', '/api/admin/usuarios')).json.usuarios.find((u) => u.usuario === 'tallerista.r1');
  assert.equal((await jefe.http('POST', `/api/admin/usuarios/coordinador/${cuenta.id}/editar`, { region: 'Región 2' })).status, 200);
  assert.equal((await t1.http('GET', '/api/talleres')).status, 401, 'al cambiar la región se cierra la sesión');
  const movido = await entrar('tallerista.r1', 'Tallerista-Pruebas-2026');
  assert.equal((await movido.http('GET', '/api/talleres')).json.talleres.some((t) => t.id === id), false);
  assert.equal((await descargar(movido, `/api/talleres/soportes/${sid}`)).status, 404);
  await iniciarEsquemaBitacora();
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM talleres_soportes WHERE id=$1', [sid])).rows[0].n, 1, 'la migración repetida conserva talleres y soportes');
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM talleres_encuentros WHERE tallerista_sub IS NULL')).rows[0].n, 0, 'cada encuentro conserva su docente');
});

// ============================================================
// E1 · SEGURIDAD: matriz de roles en el servidor, datos personales, archivos y límites
// (brechas ROL-PACM-01/02/04/07, ROL-TAR-03, ROL-GES-04, LIT-g-05/07/09/12)
// ============================================================
test('E1 matriz de roles: el Profesional alianzas no entra a Bitácora, Agenda, Visitas, Eventos ni Novedades aunque llame la API por URL', async () => {
  await reiniciarLimites();
  const l = await entrar('logistica', 'Logistica-Clave-2026');
  assert.equal(l.r.status, 200);
  const contar = async () => (await query('SELECT (SELECT count(*) FROM eventos) + (SELECT count(*) FROM novedades) AS n')).rows[0].n;
  const antes = await contar();
  const negadas = [
    // Bitácora (tablero de la ruta), ficha de la U.P. e historial de cambios (ROL-PACM-01).
    ['GET', '/api/documentos'], ['GET', '/api/documentos/detalle?id=DOC-1'], ['GET', '/api/unidades/detalle?id=UP-1'],
    ['GET', '/api/actividad?up=1'], ['GET', '/api/registro-fotografico'],
    // Agenda de llamadas y citas (ROL-PACM-02).
    ['GET', '/api/agenda'], ['POST', '/api/agenda/guardar', { id_unico: '1', inicio: '2026-12-20T15:00:00.000Z' }],
    // Visitas.
    ['GET', '/api/visitas?unidad_doc=111'], ['GET', '/api/visitas/formatos'],
    // Eventos (ROL-PACM-04).
    ['GET', '/api/eventos'], ['PUT', '/api/eventos', { id: 'e_pacm', titulo: 'x', destinatarios: ['ATLAN1'] }],
    ['DELETE', '/api/eventos?id=e_pacm'], ['PATCH', '/api/eventos/respuesta', { id: 'e_pacm', nodo: 'ATLAN1', respuesta: { valor: 'si' } }],
    // Novedades: avisos y tickets (ROL-PACM-07).
    ['GET', '/api/avisos'], ['PUT', '/api/avisos', { id: 'n_pacm', titulo: 'x', destinatarios: ['ATLAN1'] }],
    ['DELETE', '/api/avisos?id=n_pacm'], ['PATCH', '/api/avisos/lectura', { id: 'n_pacm', nodo: 'ATLAN1' }],
    ['GET', '/api/tickets'], ['POST', '/api/tickets', { titulo: 'x', descripcion: 'y' }],
  ];
  for (const [metodo, ruta, cuerpo] of negadas) {
    assert.equal((await l.http(metodo, ruta, cuerpo)).status, 403, `${metodo} ${ruta}`);
  }
  assert.equal(await contar(), antes, 'ningún intento rechazado escribió');

  // Lo que la matriz sí le da sigue abierto: Capitalización (consulta) y Entregas.
  for (const ruta of ['/api/carritos', '/api/entregas', '/api/items-ups']) {
    assert.equal((await l.http('GET', ruta)).status, 200, ruta);
  }
  // La lista de U.P. que usan esas secciones no lleva el nombre ni el contacto del representante (LIT-g-12).
  const ups = (await l.http('GET', '/api/unidades')).json.items;
  assert.ok(ups.length >= 3);
  for (const u of ups) {
    for (const c of ['rep_nombre1', 'rep_apellido1', 'rep_telefono1', 'rep_correo1', 'rep_direccion']) assert.equal(u[c], null, c);
  }
  assert.equal(ups.find((u) => u.id_unico === '1').rep_documento, '111', 'conserva la cédula con la que se ubica la entrega');
  // La coordinación sigue viendo el representante completo.
  assert.equal((await unidades.listarUnidades(COORD)).items.find((u) => u.id_unico === '1').rep_nombre1, 'Nombre');
});

test('E1 matriz de roles: los servicios también rechazan si se llaman sin pasar por la ruta', async () => {
  const TEC = { sub: 'coordinador:10', rol: 'tecnico_administrativo', nombre: 'Tec', cedula: '1',
    alcance: { region: 'Región 1', departamento: null, modalidad: null, nodo: null } };
  // El Técnico de apoyo no tiene Visitas, ni para consultar (ROL-TAR-03).
  await rechaza(visitas.listarVisitas(TEC, { unidad_doc: '111' }), 403);
  await rechaza(visitas.listarFormatos(TEC), 403);
  await rechaza(visitas.obtenerFormato(TEC, { nombre: 'ACTA DE VISITA.pdf' }), 403);
  await rechaza(visitas.obtenerSoporte(TEC, { id: '111_v1', blob: '111/x.pdf' }), 403);
  // Ni el historial de cambios de la U.P.
  await rechaza(actividad.listarActividad(TEC, { up: '1' }), 403);
  await rechaza(actividad.listarActividad(COMPRAS, { up: '1' }), 403);
  // El gestor ve sus eventos y avisos, pero no publica ninguno (ROL-GES-04, matriz ajustada: Eventos GES = P).
  assert.equal((await com.listarEventos(G1)).ok, true);
  await rechaza(com.guardarEvento(G1, { id: 'e_g', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.guardarAviso(G1, { id: 'n_g', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  assert.equal((await com.listarAvisos(G1)).ok, true);
  // El Profesional alianzas no tiene Eventos ni Novedades (ROL-PACM-04/07) ni el tablero (ROL-PACM-01).
  await rechaza(com.listarEventos(COMPRAS), 403);
  await rechaza(com.guardarEvento(COMPRAS, { id: 'e', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.eliminarEvento(COMPRAS, { id: 'e' }), 403);
  await rechaza(com.listarAvisos(COMPRAS), 403);
  await rechaza(com.guardarAviso(COMPRAS, { id: 'n', titulo: 'x', destinatarios: ['ATLAN1'] }), 403);
  await rechaza(com.eliminarAviso(COMPRAS, { id: 'n' }), 403);
  await rechaza(com.marcarAvisoLeido(COMPRAS, { id: 'n', nodo: 'ATLAN1' }), 403);
  await rechaza(agenda.listarCitas(COMPRAS), 403);
  await rechaza(documentos.listarDocumentos(COMPRAS), 403);
  await rechaza(documentos.obtenerDocumento(COMPRAS, { id: 'DOC-1' }), 403);
  await rechaza(unidades.obtenerUnidad(COMPRAS, { id: 'UP-1' }), 403);
  // Quien sí tiene la sección sigue entrando.
  assert.equal((await visitas.listarVisitas(G1, { unidad_doc: '111' })).ok, true);
  assert.equal((await visitas.listarVisitas(LOCAL_R1, { unidad_doc: '111' })).ok, true);
  assert.equal((await documentos.listarDocumentos(LOCAL_R1)).ok, true);
});

test('E1 datos personales: la base del registro fotográfico se pide con sesión y solo trae el alcance de quien la abre', async () => {
  // Sin sesión no hay nada (antes iba incrustada en un HTML público).
  assert.equal((await fetch(`${base}/api/registro-fotografico`)).status, 401);
  const g = (await unidades.datosRegistroFotografico(G1)).item;
  assert.deepEqual(Object.keys(g.ups), ['ATLAN1']);
  const idsG = g.ups.ATLAN1.map((u) => u[0]);
  assert.ok(idsG.includes('1') && idsG.includes('2') && !idsG.includes('3'));
  assert.deepEqual(g.ups.ATLAN1.find((u) => u[0] === '1'), ['1', 'UP 1', '111']);
  assert.deepEqual(g.gestores.map((x) => x[0]), ['ATLAN1']);
  const r1 = (await unidades.datosRegistroFotografico(LOCAL_R1)).item;
  assert.ok(r1.ups.ATLAN1 && !r1.ups.BOLIV1, 'el Coordinador local regional ve solo su región');
  const todo = (await unidades.datosRegistroFotografico(COORD)).item;
  assert.ok(todo.ups.ATLAN1 && todo.ups.BOLIV1, 'el Coordinador general ve todo');
  // El técnico de apoyo, el Profesional alianzas y el tallerista no usan la herramienta.
  const TEC = { sub: 'coordinador:10', rol: 'tecnico_administrativo', alcance: { region: 'Región 1' } };
  await rechaza(unidades.datosRegistroFotografico(TEC), 403);
  await rechaza(unidades.datosRegistroFotografico(COMPRAS), 403);
  await rechaza(unidades.datosRegistroFotografico({ sub: 't', rol: 'tallerista', alcance: { region: 'Región 1' } }), 403);
});

test('E1 archivos: se inspecciona el contenido, no solo la extensión, y el tipo con que se sirve no lo decide el navegador', async () => {
  const up1 = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico = '1'")).rows[0].id_up;
  const html = '<html><script>alert(document.cookie)</script></html>';
  // Un HTML con nombre de PDF, una página web y un ejecutable con nombre de foto: rechazados.
  await rechaza(archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'E1_falso.pdf', idUp: up1,
    archivo: await archivoTemporal('falso.pdf', html, 'application/pdf', { crudo: true }) }), 400);
  await rechaza(archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'E1_pagina.html', idUp: up1,
    archivo: await archivoTemporal('pagina.html', html, 'text/html') }), 400);
  await rechaza(archivos.guardarArchivo({ contenedor: 'entrega-activos', nombre: 'E1_foto.jpg', idUp: up1,
    archivo: await archivoTemporal('foto.jpg', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'image/jpeg', { crudo: true }) }), 400);
  assert.equal((await query("SELECT count(*)::int AS n FROM archivos WHERE nombre LIKE 'E1\\_%'")).rows[0].n, 0);

  // Firmas reales de cada familia.
  const { contenidoValido } = await import('../src/servicios/tipoArchivo.js');
  const bytes = (...partes) => Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
  const casos = [
    ['a.pdf', bytes('basura\n%PDF-1.7'), true],
    ['a.jpg', bytes([0xff, 0xd8, 0xff, 0xdb]), true],
    ['a.png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), true],
    ['a.webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), true],
    ['a.mp4', bytes([0, 0, 0, 0x18], 'ftypisom'), true],
    ['a.mov', bytes([0, 0, 0, 0x08], 'wide'), true],
    ['a.webm', bytes([0x1a, 0x45, 0xdf, 0xa3]), true],
    ['a.xlsx', bytes([0x50, 0x4b, 0x03, 0x04]), true],
    ['a.xls', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), true],
    ['a.csv', bytes('codigo;nombre\n1;x'), true],
    ['a.pdf', bytes(html), false],
    ['a.png', bytes([0xff, 0xd8, 0xff]), false],
    ['a.mp4', bytes('no es video'), false],
    ['a.csv', bytes([0x50, 0x4b, 0x03, 0x00, 0x00]), false],
    ['a.exe', bytes('MZ'), false],
    ['a.svg', bytes('<svg/>'), false],
  ];
  for (const [nombre, b, esperado] of casos) {
    assert.equal(await contenidoValido(b, nombre), esperado, `${nombre} ${b.subarray(0, 8).toString('hex')}`);
  }

  // El catálogo y el validador también revisan el contenido (el validador conserva su contrato { exito, mensaje }).
  await rechaza(catalogo.importarCatalogo(COORD, await archivoTemporal('cat.csv', Buffer.from([0x50, 0x4b, 0, 0, 1]), 'text/csv', { crudo: true })), 400);
  await rechaza(catalogo.importarCatalogo(COORD, await archivoTemporal('cat.xlsx', 'no es excel', 'application/vnd.ms-excel', { crudo: true })), 400);
  const disfrazado = await validador.procesar(G1, { action: 'upload', cedula: '222' },
    { archivo_cedula_pdf: await archivoTemporal('cedula.pdf', html, 'application/pdf', { crudo: true }) });
  assert.equal(disfrazado.cuerpo.exito, false);
  assert.match(disfrazado.cuerpo.mensaje, /contenido/i);

  // Por HTTP: el carrito solo admite PDF y se sirve como PDF aunque el navegador declare otra cosa.
  await reiniciarLimites();
  const l = await entrar('logistica', 'Logistica-Clave-2026');
  const subir = async (nombre, contenido, tipo) => {
    const token = (await l.http('GET', '/api/auth/sesion')).json.token;
    const f = new FormData();
    f.append('contenedor', 'carritos');
    f.append('id_unico', '1');
    f.append('nombre', nombre);
    f.append('archivo', new Blob([contenido], { type: tipo }), nombre);
    const r = await fetch(`${base}/api/archivos`, { method: 'POST', headers: { Cookie: l.http.cookie(), 'X-CSRF-Token': token }, body: f });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await subir('E1_pagina.html', html, 'text/html')).status, 400);
  assert.equal((await subir('E1_falso.pdf', html, 'text/html')).status, 400);
  const bueno = await subir('E1_bueno.pdf', '%PDF-1.4 carrito', 'text/html');
  assert.equal(bueno.status, 200);
  const servido = await fetch(`${base}/api${bueno.json.item.url}`, { headers: { Cookie: l.http.cookie() } });
  assert.equal(servido.status, 200);
  assert.equal(servido.headers.get('content-type'), 'application/pdf');
  assert.equal(servido.headers.get('x-content-type-options'), 'nosniff');
});

test('E1 límites por IP: viven en la base, sobreviven a un reinicio y los comparten las instancias', async () => {
  await reiniciarLimites();
  const { limitador, ipBloqueada, registrarFalloIp, limpiarFallosIp } = await import('../src/acceso/limites.js');
  const pedir = async (mw, ip = '10.9.9.9') => {
    let status = 200;
    let paso = false;
    const res = { set() { return this; }, status(c) { status = c; return this; }, json() { return this; } };
    await mw({ ip, method: 'GET', originalUrl: '/api/x', get: () => 'prueba' }, res, () => { paso = true; });
    return paso ? 200 : status;
  };
  const crear = () => limitador({ ventanaMs: 60_000, max: 2, tipo: 'limite_prueba_e1' });
  // Dos «instancias» (o la misma antes y después de reiniciar) crean su limitador por separado y cuentan juntas.
  const a = crear();
  const b = crear();
  assert.deepEqual([await pedir(a), await pedir(b), await pedir(a)], [200, 200, 429]);
  assert.equal(await pedir(crear()), 429, 'un proceso nuevo sigue viendo la cuenta');
  const fila = (await query("SELECT n, avisado FROM limites_peticiones WHERE clave = 'limite_prueba_e1:10.9.9.9'")).rows[0];
  assert.equal(fila.n, 4);
  assert.equal(fila.avisado, true, 'el aviso al registro de seguridad se deja una sola vez por ventana');
  assert.equal(await pedir(a, '10.9.9.8'), 200, 'otra IP no se ve afectada');
  // Al vencer la ventana se vuelve a contar desde cero.
  await query("UPDATE limites_peticiones SET reinicia = now() - interval '1 second' WHERE clave = 'limite_prueba_e1:10.9.9.9'");
  assert.equal(await pedir(a), 200);

  // Fallos de ingreso por IP: 10 en la ventana bloquean; un ingreso correcto limpia.
  const req = { ip: '10.9.9.9' };
  for (let i = 0; i < 9; i += 1) await registrarFalloIp(req);
  assert.equal(await ipBloqueada(req), false);
  await registrarFalloIp(req);
  assert.equal(await ipBloqueada(req), true);
  assert.equal(await ipBloqueada({ ip: '10.9.9.8' }), false);
  await limpiarFallosIp(req);
  assert.equal(await ipBloqueada(req), false);
  // La migración se puede repetir sin perder nada.
  await iniciarEsquemaCompartido();
  await reiniciarLimites();
});

// Rechazo con código y mensaje en español (la regla de negocio se explica, no solo se niega).
async function rechazaCon(promesa, status, patron) {
  await assert.rejects(promesa, (e) => e.status === status && patron.test(e.message));
}

test('E1 gestor y Eventos por HTTP: ve y responde los de su nodo, no crea, edita ni elimina', async () => {
  await reiniciarLimites();
  await com.guardarEvento(COORD, { id: 'evt_http', titulo: 'Feria', destinatarios: ['ATLAN1', 'BOLIV1'], respuestas: {} });
  const g = await entrar('atlan1', '1001001001');
  assert.equal(g.r.status, 200);
  const lista = await g.http('GET', '/api/eventos');
  assert.equal(lista.status, 200);
  const ev = lista.json.items.find((e) => e.id === 'evt_http');
  assert.deepEqual(Object.keys(ev.respuestas), ['ATLAN1'], 'no ve las respuestas de otros nodos');
  assert.equal((await g.http('PATCH', '/api/eventos/respuesta', { id: 'evt_http', nodo: 'ATLAN1', respuesta: { valor: 'si' } })).status, 200);
  for (const [metodo, ruta, cuerpo] of [
    ['PUT', '/api/eventos', { id: 'evt_http', titulo: 'Cambiado', destinatarios: ['ATLAN1'] }],
    ['DELETE', '/api/eventos?id=evt_http'],
  ]) {
    const r = await g.http(metodo, ruta, cuerpo);
    assert.equal(r.status, 403, `${metodo} ${ruta}`);
    assert.match(r.json.error, /coordinación/);
  }
  const final = (await com.listarEventos(COORD)).items.find((e) => e.id === 'evt_http');
  assert.equal(final.titulo, 'Feria');
  assert.equal(final.respuestas.ATLAN1.valor, 'si');
  await com.eliminarEvento(COORD, { id: 'evt_http' });
});

test('E1 mensajes: los rechazos explican la regla en español', async () => {
  const html = '<html><script>x</script></html>';
  await rechazaCon(archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'E1m.pdf',
    archivo: await archivoTemporal('E1m.pdf', html, 'application/pdf', { crudo: true }) }), 400,
  /El contenido de «E1m\.pdf» no corresponde a un archivo \.pdf\./);
  await rechazaCon(archivos.guardarArchivo({ contenedor: 'carritos', nombre: 'E1m.html',
    archivo: await archivoTemporal('E1m.html', html, 'text/html') }), 400, /Tipo de archivo no permitido/);
  await rechazaCon(catalogo.importarCatalogo(COORD, await archivoTemporal('cat.csv', Buffer.from([0x50, 0x4b, 0, 0, 1]), 'text/csv', { crudo: true })),
    400, /no corresponde a un archivo \.csv/);
  await rechazaCon(com.listarEventos(COMPRAS), 403, /no tiene acceso a Eventos/);
  await rechazaCon(com.listarAvisos(COMPRAS), 403, /no tiene acceso a Novedades/);
  await rechazaCon(documentos.listarDocumentos(COMPRAS), 403, /no tiene acceso a la Bitácora/);
  const TEC = { sub: 'coordinador:10', rol: 'tecnico_administrativo', alcance: { region: 'Región 1' } };
  await rechazaCon(visitas.listarVisitas(TEC, { unidad_doc: '111' }), 403, /no usa Visitas/);
  await rechazaCon(actividad.listarActividad(TEC, { up: '1' }), 403, /historial de cambios/);
});

test('E1 archivos: videos de cámara y archivos sin extensión se reconocen por su contenido', async () => {
  const { contenidoValido, extensionPorContenido } = await import('../src/servicios/tipoArchivo.js');
  const bytes = (...partes) => Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
  const ts = Buffer.alloc(400, 0); ts[0] = 0x47; ts[188] = 0x47;
  assert.equal(await contenidoValido(bytes([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6]), 'v.wmv'), true);
  assert.equal(await contenidoValido(bytes([0, 0, 1, 0xba, 0x44]), 'v.mpeg'), true);
  assert.equal(await contenidoValido(ts, 'v.mts'), true);
  assert.equal(await contenidoValido(bytes('no es video'), 'v.wmv'), false);
  // Sin extensión: la extensión sale del contenido (y la marca del contenedor ISO distingue foto de video).
  assert.equal(await extensionPorContenido(bytes([0, 0, 0, 0x18], 'ftypheic')), '.heic');
  assert.equal(await extensionPorContenido(bytes([0, 0, 0, 0x18], 'ftypqt  ')), '.mov');
  assert.equal(await extensionPorContenido(bytes([0, 0, 0, 0x18], 'ftypisom')), '.mp4');
  assert.equal(await extensionPorContenido(ts), '.mts');
  assert.equal(await extensionPorContenido(bytes('%PDF-1.4')), '.pdf');
  assert.equal(await extensionPorContenido(bytes([0xff, 0xd8, 0xff, 0xe0])), '.jpg');
  assert.equal(await extensionPorContenido(bytes('<html>')), null);
});

// ============================================================
// E2 · CATÁLOGOS Y CLASIFICACIÓN (ET3-15 UNSPSC, ET3-12 rubros, ET3-14 actividades no financiables,
// ET3-13 tenencia para adecuaciones, TR-03 CIIU)
// ============================================================
const clasificacion = await import('../src/servicios/clasificacion.js');
const tenencia = await import('../src/servicios/tenencia.js');
const ultimaActividad = async (accion) =>
  (await query('SELECT * FROM actividad WHERE accion = $1 ORDER BY id DESC LIMIT 1', [accion])).rows[0];

test('E2 UNSPSC: solo el Coordinador general y el de seguimiento cargan las clases; se valida formato y existencia', async () => {
  const csv = ['Código;Nombre', '101015;Animales de granja', '10;Segmento (no es clase)', '10101501;Producto (no es clase)',
    '101016;', '701015;Servicios de cultivo'].join('\n');
  const subir = () => archivoTemporal('unspsc.csv', csv, 'text/csv');
  for (const u of [LOCAL_R1, G1, COMPRAS, { sub: 't', rol: 'tecnico_administrativo', alcance: { region: 'Región 1' } }]) {
    await rechazaCon(clasificacion.importarUnspsc(u, await subir()), 403, /Coordinador general y el Profesional de seguimiento/);
  }
  const r = await clasificacion.importarUnspsc(DATOS, await subir());
  assert.equal(r.creadas, 2);
  assert.equal(r.omitidas, 3, 'segmentos, productos y filas sin nombre no son clases');
  assert.equal((await clasificacion.importarUnspsc(COORD, await subir())).actualizadas, 2, 'volver a importar actualiza');
  assert.equal((await ultimaActividad('catalogo.unspsc_importar')).resultado, 'ok');
  await rechazaCon(clasificacion.importarUnspsc(COORD, await archivoTemporal('u.csv', 'nombre;otra\nx;y', 'text/csv')), 400, /código.*nombre/);

  // Búsqueda por código o por nombre para los formularios.
  assert.deepEqual((await clasificacion.buscarUnspsc(G1, { q: '1010' })).items.map((x) => x.codigo), ['101015']);
  assert.equal((await clasificacion.buscarUnspsc(COMPRAS, { q: 'granja' })).items[0].codigo, '101015');
  await rechazaCon(clasificacion.buscarUnspsc({ sub: 't', rol: 'tallerista' }, { q: '1' }), 403, /clasificación/);
  const listas = (await clasificacion.listas(G1)).item;
  assert.equal(listas.actividades_no_financiables.length, 16);
  assert.ok(listas.unspsc_cargadas >= 2);

  // El producto del catálogo: 6 dígitos y del catálogo cargado.
  await rechazaCon(catalogo.guardarProducto(COORD, { nombre: 'Gallinas', precio: 1, unspsc: '12345' }), 400, /6 dígitos/);
  await rechazaCon(catalogo.guardarProducto(COORD, { nombre: 'Gallinas', precio: 1, unspsc: '999999' }), 400, /no está en el catálogo/);
  await rechazaCon(catalogo.guardarProducto(COORD, { nombre: 'Gallinas', precio: 1, rubro: 'no_existe' }), 400, /no es una opción válida para el rubro/);
  await rechazaCon(catalogo.guardarProducto(COORD, { nombre: 'Gallinas', precio: 1, rubro: 'dotacion_insumos', no_financiable: 'franquicias' }),
    400, /no tiene rubro capitalizable/);
  const { id_producto: gallinas } = await catalogo.guardarProducto(COORD, {
    codigo: 'E2-GAL', nombre: 'Gallinas ponedoras E2', precio: 25000, unspsc: '101015', rubro: 'Insumos y materia prima (fondo rotatorio)',
  });
  const visto = (await catalogo.listarCatalogo(G1, { q: 'Gallinas ponedoras E2' })).items[0];
  assert.deepEqual([visto.unspsc, visto.unspsc_nombre, visto.rubro], ['101015', 'Animales de granja', 'dotacion_insumos']);
  assert.equal((await ultimaActividad('catalogo.crear')).resultado, 'ok');

  // Importar con las columnas clasifica; reimportar sin ellas no borra la clasificación.
  await catalogo.importarCatalogo(COORD, await archivoTemporal('c.csv',
    'Código;Nombre;Precio;UNSPSC;Rubro\nE2-ALI;Alimento concentrado E2;90000;101015;dotacion_insumos', 'text/csv'));
  await catalogo.importarCatalogo(COORD, await archivoTemporal('c.csv', 'Código;Nombre;Precio\nE2-ALI;Alimento concentrado E2;95000', 'text/csv'));
  const ali = (await catalogo.listarCatalogo(COORD, { q: 'Alimento concentrado E2' })).items[0];
  assert.deepEqual([ali.precio, ali.unspsc, ali.rubro], [95000, '101015', 'dotacion_insumos']);
  const malo = await catalogo.importarCatalogo(COORD, await archivoTemporal('c.csv', 'Código;Nombre;Precio;UNSPSC\nE2-X;X;1;999999', 'text/csv'));
  assert.match(malo.errores[0].motivo, /no está en el catálogo/);
  await query("DELETE FROM catalogo_productos WHERE id_origen IN ('E2-GAL','E2-ALI')");
  assert.ok(gallinas);
});

test('E2 UNSPSC en el inventario: el artículo se crea y se clasifica con una clase cargada', async () => {
  await reiniciarLimites();
  const l = await entrar('logistica', 'Logistica-Clave-2026');
  const malo = await l.http('POST', '/api/inv/articulos', { nombre: 'Bebedero E2', precio: 1000, unspsc: '000001' });
  assert.equal(malo.status, 400);
  assert.match(malo.json.error, /no está en el catálogo/);
  const r = await l.http('POST', '/api/inv/articulos', { nombre: 'Bebedero E2', precio: 1000, unspsc: '101015' });
  assert.equal(r.status, 200);
  const art = (await query('SELECT unspsc FROM inventario.articulos WHERE id = $1', [r.json.id])).rows[0];
  assert.equal(art.unspsc, '101015');
  const p = await l.http('PATCH', `/api/inv/articulos/${r.json.id}/unspsc`, { unspsc: '701015' });
  assert.equal(p.status, 200);
  const act = await ultimaActividad('inventario.articulo_unspsc');
  assert.deepEqual(act.cambios.campos.unspsc, ['101015', '701015']);
  assert.equal((await l.http('PATCH', `/api/inv/articulos/${r.json.id}/unspsc`, { unspsc: '12' })).status, 400);
  assert.equal((await l.http('PATCH', '/api/inv/articulos/99999999/unspsc', { unspsc: '701015' })).status, 404);
  // Sin sesión (ni token CSRF) se rechaza antes de llegar a la ruta.
  assert.ok([400, 401, 403].includes((await fetch(`${base}/api/inv/articulos/${r.json.id}/unspsc`, { method: 'PATCH' })).status));
  // Un rol sin el inventario no clasifica artículos.
  const g = await entrar('atlan1', '1001001001');
  assert.equal((await g.http('PATCH', `/api/inv/articulos/${r.json.id}/unspsc`, { unspsc: '101015' })).status, 403);
  await query('UPDATE inventario.articulos SET activo = FALSE WHERE id = $1', [r.json.id]);
});

test('E2 CIIU y actividad no financiable: los edita la ficha y la actividad bloquea la capitalización', async () => {
  await rechazaCon(fichaUP.editarUnidad(COORD, { id_unico: '2', datos_up: { ciiu: '107' } }), 400, /CIIU de 4 dígitos/);
  await rechazaCon(fichaUP.editarUnidad(COORD, { id_unico: '2', datos_up: { actividad_no_financiable: 'Pesca deportiva' } }),
    400, /no es una opción válida para la actividad no financiable/);
  await rechaza(fichaUP.editarUnidad(LOCAL_R1, { id_unico: '2', datos_up: { ciiu: '1071' } }), 403);
  await rechaza(fichaUP.editarUnidad(G1, { id_unico: '2', datos_up: { ciiu: '1071' } }), 403);
  await fichaUP.editarUnidad(DATOS, { id_unico: '2', datos_up: { ciiu: '1071', actividad_no_financiable: 'Juegos de azar' } });
  const up = (await unidades.obtenerUnidad(COORD, { id: '2' })).item.datos_up;
  assert.deepEqual([up.ciiu, up.actividad_no_financiable], ['1071', 'juegos_azar']);
  const act = await ultimaActividad('unidad.editar');
  assert.deepEqual(act.cambios.campos['unidades_productivas.ciiu'], [null, '1071']);

  // Con la actividad no financiable no se capitaliza: ni agregar productos ni enviar.
  const { id_producto: pan } = await catalogo.guardarProducto(COORD, {
    codigo: 'E2-PAN', nombre: 'Amasadora E2', precio: 100000, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: '2', id_producto: pan, cantidad: 1 }), 400, /actividad no financiable \(Juegos de azar\)/);
  const d = await carrito.detalleCarrito(G1, { id_unico: '2' });
  assert.equal(d.clasificacion.actividad_no_financiable, 'juegos_azar');
  assert.match(d.clasificacion.problemas_envio[0], /no se puede capitalizar/);

  // Sin la marca vuelve a capitalizarse.
  await fichaUP.editarUnidad(COORD, { id_unico: '2', datos_up: { actividad_no_financiable: null } });
  const v = await carrito.ponerLinea(G1, { id_unico: '2', id_producto: pan, cantidad: 1 });
  assert.equal(v.lineas.length, 1);
  assert.ok(!v.clasificacion.problemas_envio.some((p) => /no se puede capitalizar/.test(p)));
  await query("DELETE FROM carritos WHERE codigo_iniciativa = '2'");
  await query("DELETE FROM catalogo_productos WHERE id_origen = 'E2-PAN'");
});

test('E2 bienes no financiables, adecuaciones locativas con tenencia y equipos de cómputo justificados', async () => {
  const prod = async (codigo, extra) => (await catalogo.guardarProducto(COORD, { codigo, precio: 100000, unspsc: '101015', ...extra })).id_producto;
  const usado = await prod('E2-USA', { nombre: 'Horno usado E2', unspsc: '', no_financiable: 'bienes_no_nuevos' });
  const piso = await prod('E2-PIS', { nombre: 'Enchape de piso E2', rubro: 'adecuaciones_locativas' });
  const pc = await prod('E2-PC', { nombre: 'Computador portátil E2', rubro: 'equipos_computo' });

  // El gestor no ve en la tienda lo no financiable; la coordinación sí, con la marca.
  assert.equal((await catalogo.listarCatalogo(G1, { q: 'Horno usado E2' })).items.length, 0);
  assert.equal((await catalogo.listarCatalogo(COORD, { q: 'Horno usado E2' })).items[0].no_financiable, 'bienes_no_nuevos');
  await rechazaCon(carrito.ponerLinea(COORD, { id_unico: '2', id_producto: usado, cantidad: 1 }), 400, /no es financiable: Bienes de segunda/);

  // Adecuaciones locativas: sin tenencia válida con soporte no entran.
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: '2', id_producto: piso, cantidad: 1 }), 400, /adecuación locativa: .*comodato de 5 años/);
  const cert = () => archivoTemporal('certificado.pdf', '%PDF-1.4 certificado de tenencia');
  await rechazaCon(tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'propia' }), 400, /Adjunta la certificación/);
  await rechazaCon(tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'arriendo' }, await cert()), 400, /cuántos años/);
  await rechazaCon(tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'castillo' }, await cert()), 400, /no es una opción válida para el tipo de tenencia/);
  await rechazaCon(tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'propia' },
    await archivoTemporal('certificado.pdf', '<html>no</html>', 'application/pdf', { crudo: true })), 400, /no corresponde/);
  // Solo el gestor del nodo y la coordinación de su alcance la registran.
  await rechaza(tenencia.registrarTenencia(G2, { id_unico: '2', tipo: 'propia' }, await cert()), 403);
  await rechaza(tenencia.registrarTenencia(COMPRAS, { id_unico: '2', tipo: 'propia' }, await cert()), 403);
  await rechaza(tenencia.registrarTenencia({ sub: 't', rol: 'tecnico_administrativo', alcance: { region: 'Región 1' } },
    { id_unico: '2', tipo: 'propia' }, await cert()), 403);

  let t = await tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'arriendo', anios: '2' }, await cert());
  assert.equal(t.item.habilita_adecuaciones, false, 'arriendo de 2 años no alcanza');
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: '2', id_producto: piso, cantidad: 1 }), 400, /adecuación locativa/);
  // Cambiar los años (o el tipo) exige la certificación que los respalda; repetir lo mismo conserva la cargada.
  await rechazaCon(tenencia.registrarTenencia(LOCAL_R1, { id_unico: '2', tipo: 'arriendo', anios: '3' }), 400, /Cambiaste el tipo o los años/);
  await rechazaCon(tenencia.registrarTenencia(LOCAL_R1, { id_unico: '2', tipo: 'otra' }), 400, /Cambiaste el tipo o los años/);
  t = await tenencia.registrarTenencia(LOCAL_R1, { id_unico: '2', tipo: 'arriendo', anios: '3' }, await cert());
  const certificado = t.item.soporte;
  t = await tenencia.registrarTenencia(G1, { id_unico: '2', tipo: 'arriendo', anios: '3' });
  assert.equal(t.item.habilita_adecuaciones, true);
  assert.equal(t.item.soporte, certificado, 'el soporte ya cargado se conserva');
  let v = await carrito.ponerLinea(G1, { id_unico: '2', id_producto: piso, cantidad: 1 });
  assert.equal(v.clasificacion.tenencia.tipo, 'arriendo');
  const act = await ultimaActividad('unidad.tenencia');
  assert.equal(act.id_unico, '2');
  // El antes → después va en cambios.campos, solo con lo que cambió (repetir lo mismo no cambia nada).
  assert.deepEqual(act.cambios.campos, {});
  const cambioAnios = (await query(`SELECT cambios FROM actividad WHERE accion = 'unidad.tenencia' AND id_unico = '2' AND resultado = 'ok'
    ORDER BY id DESC LIMIT 1 OFFSET 1`)).rows[0];
  assert.deepEqual(cambioAnios.cambios.campos.anios, [2, 3]);
  // La certificación es privada: el gestor del nodo la ve, el de otro nodo no.
  const soporte = (await unidades.obtenerUnidad(COORD, { id: '2' })).item.tenencia.soporte;
  assert.ok((await archivos.obtenerArchivo(G1, { contenedor: 'tenencias', nombre: soporte })).ruta);
  await rechaza(archivos.obtenerArchivo(G2, { contenedor: 'tenencias', nombre: soporte }), 403);

  // Equipos de cómputo: entran, pero el plan no se envía sin la justificación.
  v = await carrito.ponerLinea(G1, { id_unico: '2', id_producto: pc, cantidad: 1 });
  const lineaPc = v.lineas.find((l) => l.id_producto === pc);
  assert.equal(lineaPc.requiere_justificacion, true);
  await rechazaCon(carrito.cambiarEstado(G1, { id_unico: '2', estado: 'enviado' }), 400, /equipo de cómputo y le falta la justificación/);
  await rechaza(carrito.guardarJustificacion(COMPRAS, { id_unico: '2', id_linea: lineaPc.id, justificacion: 'x' }), 403);
  await rechaza(carrito.guardarJustificacion(G1, { id_unico: '2', id_linea: 99999999, justificacion: 'x' }), 404);
  await rechaza(carrito.guardarJustificacion(G2, { id_unico: '2', id_linea: lineaPc.id, justificacion: 'x' }), 403);
  await prepararEnvio(G1, '2');
  v = await carrito.guardarJustificacion(G1, { id_unico: '2', id_linea: lineaPc.id,
    justificacion: 'Lleva el inventario y las ventas en línea de la panadería.' });
  assert.deepEqual(v.clasificacion.problemas_envio, []);
  assert.deepEqual((await ultimaActividad('carrito.justificacion')).cambios.campos.justificacion[1], 'Lleva el inventario y las ventas en línea de la panadería.');
  v = await carrito.cambiarEstado(G1, { id_unico: '2', estado: 'enviado' });
  assert.equal(v.carrito.estado, 'enviado');

  // Si la tenencia deja de habilitar las adecuaciones, la coordinación no puede aprobar.
  await query("UPDATE unidades_productivas SET tenencia_anios = 1 WHERE id_unico = '2'");
  await rechazaCon(carrito.cambiarEstado(COORD, { id_unico: '2', estado: 'revisado' }), 400, /no se puede marcar como revisado todavía: «Enchape de piso E2»/);

  await query("DELETE FROM carritos WHERE codigo_iniciativa = '2'");
  await query(`UPDATE unidades_productivas SET tenencia_tipo = NULL, tenencia_anios = NULL, tenencia_soporte = NULL,
    ciiu = NULL WHERE id_unico = '2'`);
  await query("DELETE FROM catalogo_productos WHERE id_origen IN ('E2-USA','E2-PIS','E2-PC')");
});

test('E2 la migración se repite sin perder la clasificación y no siembra datos', async () => {
  const antes = (await query('SELECT count(*)::int AS n FROM unspsc_clases')).rows[0].n;
  await iniciarEsquemaBitacora();
  await iniciarEsquemaInventario();
  assert.equal((await query('SELECT count(*)::int AS n FROM unspsc_clases')).rows[0].n, antes);
  // Las restricciones guardan la forma aunque se escriba directo en la base.
  await rechazaSql(query("UPDATE unidades_productivas SET ciiu = '12' WHERE id_unico = '3'"));
  await rechazaSql(query("UPDATE unidades_productivas SET tenencia_tipo = 'prestada' WHERE id_unico = '3'"));
  await rechazaSql(query("INSERT INTO unspsc_clases (codigo, nombre) VALUES ('12a456', 'x')"));
});

// ============================================================
// E3 · ASOCIADOS POR UNIDAD PRODUCTIVA Y ACTAS DE NOVEDAD (ET1-08, ET1-10, ET1-15, NOV-04)
// ============================================================
const asociados = await import('../src/servicios/asociados.js');

// Una U.P. de economía solidaria (M3, mínimo 15) en el nodo de G1, solo para estas pruebas.
async function upSolidaria(idUnico, doc) {
  const r = await query("INSERT INTO representantes (documento, nombre1, apellido1) VALUES ($1, 'Rep', 'Solidaria') RETURNING id_representante", [doc]);
  await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad)
    SELECT $1::text, $1::text, id_triada, $2, 'Cooperativa ' || $1::text, 'M3 - Economía solidaria' FROM triadas WHERE nodo = 'ATLAN1'`, [idUnico, r.rows[0].id_representante]);
}
const asociado = (i, extra = {}) => ({
  nombre: `Asociada Número ${i}`, documento: String(70000000 + i), telefono: `300${String(1000000 + i)}`, sexo: 'mujer',
  tipo: i % 4 === 0 ? 'indirecto' : 'directo', fecha_nacimiento: i % 2 ? '1990-05-10' : '1960-01-01', zona: 'rural', ...extra,
});
const visitaV1 = (doc, idUnico, cerrada) => ({
  id: `${doc}_v1`, unidad: { id_unico: idUnico, nombre: `Cooperativa ${idUnico}`, documento: doc, modalidad: 'M3' },
  visita: { tipo: 'v1', nombre: 'Visita 1 — Caracterización', carpeta: '01_VISITA_1_CARACTERIZACION' },
  programacion: { resultado_llamada: 'AGENDADA', fecha_visita: hoyIso(), hora_visita: '09:00' }, alistamiento: {}, realizacion: { estado: 'EXITOSA' }, soportes: {}, cierre: { cerrada }, registro: {},
});

test('E3 asociados: registro uno por uno con datos obligatorios, perfil, resumen y permisos', async () => {
  await upSolidaria('E3-A', '8800001');
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { telefono: '' }) }), 400, /teléfono es obligatorio/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { nombre: 'Ana' }) }), 400, /nombre completo/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { documento: '12' }) }), 400, /cédula es obligatoria/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { sexo: '' }) }), 400, /indica el sexo/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { fecha_nacimiento: '2999-01-01' }) }), 400, /fecha de nacimiento/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { pertenencia_etnica: 'marciana' }) }), 400, /pertenencia étnica/);

  const r1 = await asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(1, { es_representante: true, documento: '8800001' }) });
  await asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(2, { sexo: 'hombre', victima: true, discapacidad: 'si' }) });
  await asociados.guardarAsociado(LOCAL_R1, { id_unico: 'E3-A', asociado: asociado(4, { pertenencia_etnica: 'Indígena', nivel_educativo: 'media' }) });
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: asociado(5, { documento: '8800001' }) }), 409, /ya está entre los asociados activos/);
  assert.equal((await ultimaActividad('asociados.registrar')).id_unico, 'E3-A');

  // Solo un representante: marcar otro le quita la marca al anterior.
  await asociados.guardarAsociado(G1, { id_unico: 'E3-A', asociado: { ...asociado(6), es_representante: true } });
  let l = (await asociados.listarAsociados(G1, { id_unico: 'E3-A' })).item;
  assert.deepEqual(l.asociados.filter((a) => a.es_representante).map((a) => a.documento), [asociado(6).documento]);
  assert.ok(l.asociados.find((a) => a.id === r1.item.id), 'el anterior sigue como asociado');

  // ET1-15: totales y perfil sociodemográfico calculados desde el registro.
  const res = l.resumen;
  assert.deepEqual([res.modalidad, res.total, res.directos, res.indirectos, res.minimo, res.faltan, res.cumple_minimo], ['M3', 4, 3, 1, 15, 11, false]);
  assert.deepEqual([res.perfil.sexo.mujer, res.perfil.sexo.hombre], [3, 1]);
  assert.deepEqual([res.perfil.edad['29_59'], res.perfil.edad['60_mas']], [1, 3]);
  assert.deepEqual([res.perfil.victimas, res.perfil.con_discapacidad, res.perfil.pertenencia_etnica.indigena, res.perfil.zona.rural], [1, 1, 1, 4]);
  assert.equal(l.puede_registrar, true);

  // Permisos: otro nodo no; el técnico consulta pero no registra; el Profesional alianzas no consulta.
  await rechaza(asociados.listarAsociados(G2, { id_unico: 'E3-A' }), 403);
  await rechaza(asociados.guardarAsociado(G2, { id_unico: 'E3-A', asociado: asociado(7) }), 403);
  const TEC = { sub: 'coordinador:10', rol: 'tecnico_administrativo', nombre: 'Tec', alcance: { region: 'Región 1' } };
  assert.equal((await asociados.listarAsociados(TEC, { id_unico: 'E3-A' })).item.resumen.total, 4);
  await rechazaCon(asociados.guardarAsociado(TEC, { id_unico: 'E3-A', asociado: asociado(7) }), 403, /no registra asociados/);
  await rechazaCon(asociados.listarAsociados(COMPRAS, { id_unico: 'E3-A' }), 403, /no consulta los asociados/);

  // Antes de cerrar la Visita 1 se puede quitar un asociado mal registrado.
  await asociados.quitarAsociado(G1, { id_unico: 'E3-A', id: r1.item.id });
  l = (await asociados.listarAsociados(G1, { id_unico: 'E3-A' })).item;
  assert.equal(l.resumen.total, 3);
});

test('E3 la Visita 1 de una UP M2–M4 no se cierra sin el mínimo de asociados de su modalidad', async () => {
  await upSolidaria('E3-B', '8800002');
  for (let i = 1; i <= 14; i += 1) await asociados.guardarAsociado(G1, { id_unico: 'E3-B', asociado: asociado(100 + i) });
  await guardarV(G1, visitaV1('8800002', 'E3-B', false));
  const sopE3 = await formatosCompletos('8800002_v1', 'v1', 'M3');
  await diagnosticoV1(G1, 'E3-B', 'M3');
  await rechazaCon(guardarV(G1, { ...visitaV1('8800002', 'E3-B', true), soportes: sopE3 }), 400, /tiene 14 asociados registrados y la modalidad exige 15/);
  assert.equal((await query("SELECT cerrada FROM visitas WHERE id = '8800002_v1'")).rows[0].cerrada, false);
  await asociados.guardarAsociado(G1, { id_unico: 'E3-B', asociado: asociado(115, { es_representante: true }) });
  const v = await guardarV(G1, { ...visitaV1('8800002', 'E3-B', true), soportes: sopE3 });
  assert.equal(v.item.cierre.cerrada, true);
  // Una UP individual (M1) no tiene mínimo de asociados.
  assert.equal(asociados.minimoDe('M1 - Iniciativa individual'), null);
  assert.deepEqual([asociados.minimoDe('M2'), asociados.minimoDe('m3'), asociados.minimoDe('M4 robusta')], [10, 15, 20]);
});

test('E3 acta de novedades: después de la V1 los cambios de asociados solo entran con acta y sin bajar del mínimo', async () => {
  const l0 = (await asociados.listarAsociados(G1, { id_unico: 'E3-B' })).item;
  assert.equal(l0.visita1_cerrada, true);
  assert.equal(l0.puede_registrar, false);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-B', asociado: asociado(200) }), 409, /acta de novedades/);
  const unId = l0.asociados[0].id;
  await rechazaCon(asociados.quitarAsociado(G1, { id_unico: 'E3-B', id: unId }), 409, /acta de novedades/);
  // Corregir un teléfono sí se puede; cambiar la cédula, no.
  const a0 = l0.asociados.find((a) => a.id === unId);
  await asociados.guardarAsociado(G1, { id_unico: 'E3-B', asociado: { ...a0, telefono: '3109998877' } });
  // En la actividad queda qué cambió (cambios.campos), y del teléfono solo que cambió: ni el número viejo ni el nuevo (E12).
  const corregido = await ultimaActividad('asociados.corregir');
  assert.deepEqual(corregido.cambios, { nuevo: false, campos: { telefono: '(modificado)' } });
  assert.equal(['3109998877', a0.telefono, a0.documento].some((d) => JSON.stringify(corregido.cambios).includes(d)), false);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E3-B', asociado: { ...a0, documento: '99999999' } }), 409, /la cédula no se cambia/);

  const pdf = () => archivoTemporal('acta.pdf', '%PDF-1.4 acta de novedades de asociados');
  const acta = { id_unico: 'E3-B', fecha: '2026-10-01', motivo: 'Cambio de integrantes por traslado de municipio' };
  await rechazaCon(asociados.registrarActa(G1, { ...acta, retiros: [{ id: unId }] }), 400, /Adjunta el acta/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta }, await pdf()), 400, /al menos un ingreso o un retiro/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, motivo: '', retiros: [{ id: unId }] }, await pdf()), 400, /motivo del acta/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, fecha: '2999-01-01', retiros: [{ id: unId }] }, await pdf()), 400, /no puede ser futura/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, ingresos: [asociado(201, { telefono: '1' })] }, await pdf()), 400, /Ingreso 1: el teléfono es obligatorio/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, retiros: [{ id: unId }] }, await pdf()), 400,
    /deja a la unidad con 14 asociados y la modalidad M3 exige 15. Registra el reemplazo en la misma acta/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, retiros: [{ id: 99999999 }], ingresos: [asociado(202)] }, await pdf()), 400, /no es un asociado activo/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, ingresos: [asociado(203, { documento: a0.documento })] }, await pdf()), 409, /ya está entre los asociados activos/);
  await rechazaCon(asociados.registrarActa(G1, { ...acta, retiros: [{ id: unId }], ingresos: [asociado(204)] },
    await archivoTemporal('acta.pdf', 'no es pdf', 'application/pdf', { crudo: true })), 400, /no corresponde/);
  await rechaza(asociados.registrarActa(G2, { ...acta, retiros: [{ id: unId }], ingresos: [asociado(205)] }, await pdf()), 403);
  assert.equal((await query("SELECT count(*)::int AS n FROM up_actas_asociados a JOIN unidades_productivas u USING (id_up) WHERE u.id_unico = 'E3-B'")).rows[0].n, 0,
    'ningún intento rechazado dejó acta');

  // Reemplazo en la misma acta: sale uno y entra otro.
  const ok = await asociados.registrarActa(G1, { ...acta, retiros: [{ id: unId, motivo: 'Se trasladó de municipio' }], ingresos: [asociado(206)] }, await pdf());
  assert.deepEqual([ok.item.activos_antes, ok.item.activos_despues], [15, 15]);
  const l = (await asociados.listarAsociados(LOCAL_R1, { id_unico: 'E3-B' })).item;
  const retirado = l.asociados.find((a) => a.id === unId);
  assert.deepEqual([retirado.activo, retirado.motivo_retiro, retirado.id_acta_retiro], [false, 'Se trasladó de municipio', ok.item.id]);
  assert.equal(l.asociados.find((a) => a.documento === asociado(206).documento).id_acta_ingreso, ok.item.id);
  assert.equal(l.actas.length, 1);
  assert.match(l.actas[0].acta_url, /^\/archivos\/novedades-asociados\/E3-B\//);
  assert.deepEqual(l.actas[0].retiros[0].documento, a0.documento);
  const actaAct = await ultimaActividad('asociados.acta_novedades');
  assert.deepEqual(actaAct.cambios.campos.activos, [15, 15]);
  // Quién entra y quién sale va por su nombre: las cédulas no van a la actividad (E12, TR-15).
  assert.deepEqual([actaAct.cambios.ingresos, actaAct.cambios.retiros], [[asociado(206).nombre], [a0.nombre]]);
  assert.equal([asociado(206).documento, a0.documento].some((d) => JSON.stringify(actaAct.cambios).includes(d)), false);
  // El acta es privada: el gestor de otro nodo no la descarga.
  const nombreActa = l.actas[0].acta_url.replace('/archivos/novedades-asociados/', '');
  await rechaza(archivos.obtenerArchivo(G2, { contenedor: 'novedades-asociados', nombre: decodeURIComponent(nombreActa) }), 403);

  // Por HTTP: el técnico no registra; el gestor sube el acta en multipart.
  await reiniciarLimites();
  const g = await entrar('atlan1', '1001001001');
  const token = (await g.http('GET', '/api/auth/sesion')).json.token;
  const f = new FormData();
  f.append('datos', JSON.stringify({ ...acta, ingresos: [asociado(207, { tipo: 'indirecto' })] }));
  f.append('archivo', new Blob(['%PDF-1.4 acta 2'], { type: 'application/pdf' }), 'acta2.pdf');
  const http = await fetch(`${base}/api/asociados/acta`, { method: 'POST', headers: { Cookie: g.http.cookie(), 'X-CSRF-Token': token }, body: f });
  assert.equal(http.status, 200);
  assert.equal((await asociados.listarAsociados(G1, { id_unico: 'E3-B' })).item.resumen.total, 16);
  assert.equal((await g.http('GET', '/api/asociados?id_unico=E3-B')).json.item.actas.length, 2);
});

// ============================================================
// Revisión de E1 y E2: defectos confirmados y corregidos
// ============================================================
test('E1/E2 revisión: plan aprobado, ids fuera de rango, archivos dañados, importación con celdas vacías y tipo de soporte', async () => {
  // S-1: la coordinación no cambia un plan aprobado sin reabrirlo.
  const { id_producto: pala } = await catalogo.guardarProducto(COORD, {
    codigo: 'REV-PALA', nombre: 'Pala revisión', precio: 50000, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await carrito.guardarDatos(COORD, { id_unico: '2', presupuesto_maximo: 1000000 });
  let v = await carrito.ponerLinea(G1, { id_unico: '2', id_producto: pala, cantidad: 1 });
  await prepararEnvio(G1, '2');
  await carrito.cambiarEstado(G1, { id_unico: '2', estado: 'enviado' });
  await evaluarActivos('2');
  v = await carrito.cambiarEstado(COORD, { id_unico: '2', estado: 'revisado' });
  assert.equal(v.carrito.puede_editar, false);
  await rechazaCon(carrito.ponerLinea(COORD, { id_unico: '2', id_producto: pala, cantidad: 1 }), 409, /revisado por la coordinación: devuélvelo/);
  await rechazaCon(carrito.guardarJustificacion(COORD, { id_unico: '2', id_linea: v.lineas[0].id, justificacion: 'x' }), 409, /devuélvelo para cambiarlo/);
  await rechazaCon(carrito.cambiarEstado(COORD, { id_unico: '2', estado: 'devuelto' }), 400, /Escribe el motivo/);
  v = await carrito.cambiarEstado(COORD, { id_unico: '2', estado: 'devuelto', motivo: 'Ajustar la cantidad' });
  v = await carrito.ponerLinea(COORD, { id_unico: '2', id_producto: pala, cantidad: 1 });
  assert.equal(v.lineas[0].cantidad, 2, 'reabierto, se puede cambiar');

  // S-4: un id fuera del rango de PostgreSQL es un 400, no un 500.
  await rechazaCon(carrito.guardarJustificacion(G1, { id_unico: '2', id_linea: '99999999999', justificacion: 'x' }), 400, /Falta la línea/);
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: '2', id_producto: '99999999999', cantidad: 1 }), 400, /cantidad no es válida/);
  await query("DELETE FROM carritos WHERE codigo_iniciativa = '2'");

  // S-5: un Excel dañado o un CSV ilegible responde 400 con un mensaje en español.
  // Un .xlsx con la estructura ZIP en orden pero con el contenido roto.
  const zip = (await import('node:zlib')).deflateRawSync(Buffer.from('<roto'));
  const nombreZip = Buffer.from('xl/workbook.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(zip.length, 18); local.writeUInt32LE(5, 22); local.writeUInt16LE(nombreZip.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(zip.length, 20); central.writeUInt32LE(5, 24); central.writeUInt16LE(nombreZip.length, 28);
  const inicioCentral = 30 + nombreZip.length + zip.length;
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(46 + nombreZip.length, 12); fin.writeUInt32LE(inicioCentral, 16);
  const libro = Buffer.concat([local, nombreZip, zip, central, nombreZip, fin]);
  const dañado = () => archivoTemporal('dañado.xlsx', libro, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await rechazaCon(clasificacion.importarUnspsc(COORD, await archivoTemporal('u.xlsx', 'PK no es zip', 'x', { crudo: true })), 400, /no corresponde a un archivo .xlsx/);
  await rechazaCon(clasificacion.importarUnspsc(COORD, await dañado()), 400, /No se pudo leer el archivo/);
  await rechazaCon(catalogo.importarCatalogo(COORD, await dañado()), 400, /No se pudo leer el archivo/);

  // D-1: en la importación, una celda vacía de UNSPSC o rubro no borra la clasificación.
  await catalogo.importarCatalogo(COORD, await archivoTemporal('c.csv',
    'Código;Nombre;Precio;UNSPSC;Rubro;No financiable\nREV-PALA;Pala revisión;60000;;;', 'text/csv'));
  const p = (await catalogo.listarCatalogo(COORD, { q: 'Pala revisión' })).items[0];
  assert.deepEqual([p.precio, p.unspsc, p.rubro], [60000, '101015', 'dotacion_maquinaria']);
  // En el formulario, en cambio, vaciar el campo sí lo borra.
  await catalogo.guardarProducto(COORD, { id_producto: p.id_producto, nombre: 'Pala revisión', precio: 60000, unspsc: '' });
  assert.equal((await catalogo.listarCatalogo(COORD, { q: 'Pala revisión' })).items[0].unspsc, null);
  await query("DELETE FROM catalogo_productos WHERE id_origen = 'REV-PALA'");

  // S-3: el soporte del validador guarda una extensión de su tipo, aunque el contenido corresponda a otra.
  const { extGuardada } = await import('../src/servicios/validador.js');
  const foto = await archivoTemporal('video.jpg', 'foto', 'video/mp4');
  assert.equal(await extGuardada({ tipo: 'video' }, foto), null, 'una foto no se guarda como video');
  assert.equal(await extGuardada({ tipo: 'video' }, await archivoTemporal('v.mp4', 'video', 'video/mp4')), '.mp4');
  assert.equal(await extGuardada({ tipo: 'imagen' }, await archivoTemporal('f.jpg', 'foto', 'image/jpeg')), '.jpg');
});

// ============================================================
// E4 · DIAGNÓSTICO ESTRUCTURADO, VISITAS 1 Y 2 (ET1-02, ET1-03, ET1-09, ET1-12, ET1-13, ET1-14, ET1-16,
// ET1-17, ET1-19, ET1-20, ET1-21, ET1-22, ET1-28, FUN-GES-02, FUN-GES-03, FUN-CLR-01)
// ============================================================
const coherencia = await import('../src/servicios/coherencia.js');
const TEC_R1 = { sub: 'tec:1', rol: 'tecnico_administrativo', alcance: { region: 'Región 1' }, nombre: 'Técnico' };
async function upE4(idUnico, doc, modalidad) {
  const r = await query("INSERT INTO representantes (documento, nombre1, apellido1) VALUES ($1, 'Rep', 'Diagnóstico') RETURNING id_representante", [doc]);
  await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad, departamento)
    SELECT $1::text, $1::text, id_triada, $2, 'Iniciativa ' || $1::text, $3, 'Atlántico' FROM triadas WHERE nodo = 'ATLAN1'`,
  [idUnico, r.rows[0].id_representante, modalidad]);
}
const CARPETAS = { v1: '01_VISITA_1_CARACTERIZACION', v2: '02_VISITA_2_DIAGNOSTICO', v3: '05_ACOMPAÑAMIENTO_Y_SEGUIMIENTO' };
const visitaE4 = (doc, idUnico, tipo, cerrada, soportes = {}) => ({
  id: `${doc}_${tipo}`, unidad: { id_unico: idUnico, nombre: `Iniciativa ${idUnico}`, documento: doc, modalidad: 'M1' },
  visita: { tipo, nombre: tipo, carpeta: CARPETAS[tipo] },
  programacion: { resultado_llamada: 'AGENDADA', fecha_visita: hoyIso(), hora_visita: '09:00' },
  alistamiento: {}, realizacion: { estado: 'EXITOSA' }, soportes, cierre: { cerrada }, registro: {},
});
const SECCIONES_V2_PRUEBA = {
  recursos: { personas_trabajan: 3, recurso_humano: 'La dueña y dos ayudantes', recurso_fisico: 'Horno y mesón', recurso_financiero: 'Ahorros propios', ingresos_mensuales: '2.000.000', costos_mensuales: 1500000 },
  indicadores: { ventas_mensuales: 1800000, clientes_mes: 120 },
  negocio: { etapa: 'en_marcha', productos: 'Pan y tortas', valor_agregado: 'Receta propia sin conservantes', estado_produccion: 'continua', estado_comercializacion: 'local' },
  mercado: { condiciones_mercado: 'Demanda estable en el barrio', redes_alianzas: 'Ninguna', necesidades: 'Un horno más grande' },
  foda: { fortalezas: ['Receta propia'], oportunidades: ['Ferias'], debilidades: ['Poca capacidad'], amenazas: ['Panaderías grandes'] },
  plan_fortalecimiento: { objetivos: 'Duplicar la producción', diagnostico_resumido: 'Buena calidad, poca capacidad', estrategia: 'Equipar y vender en ferias', recursos: 'Capital productivo y formación', capital_productivo: 'Horno industrial', valor_capital: 4000000 },
  concepto: { resultado: 'favorable', justificacion: 'La unidad funciona y tiene mercado.' },
};
const guardarSecciones = async (u, idUnico, secciones) => {
  for (const [seccion, datos] of Object.entries(secciones)) await diagnostico.guardarSeccion(u, { id_unico: idUnico, seccion, datos });
};
// Sube un soporte a la visita y devuelve el item que va en el documento.
async function soporteE4(visitaId, formato, nombre, contenido) {
  const r = await visitas.subirArchivoVisita(G1, { visita_id: visitaId, formato }, await archivoTemporal(nombre, contenido, 'application/octet-stream'));
  return { archivo: nombre, blob: r.blob, cargado_en: new Date().toISOString(), cargado_por: 'Gestora 1' };
}

test('E4 diagnóstico: secciones por partes, validación en español, cálculos del servidor y permisos por rol', async () => {
  await upE4('E4-A', '8810001', 'M1 - Iniciativa individual');
  // Permisos: otro nodo, compras y tallerista no lo ven; el técnico de apoyo consulta sin escribir.
  await rechaza(diagnostico.obtenerDiagnostico(G2, { id_unico: 'E4-A' }), 403);
  await rechaza(diagnostico.obtenerDiagnostico(COMPRAS, { id_unico: 'E4-A' }), 403);
  await rechaza(diagnostico.obtenerDiagnostico({ sub: 't', rol: 'tallerista', alcance: { region: 'Región 1' } }, { id_unico: 'E4-A' }), 403);
  await rechaza(diagnostico.obtenerDiagnostico(G1, { id_unico: 'NO-EXISTE' }), 404);
  const tec = (await diagnostico.obtenerDiagnostico(TEC_R1, { id_unico: 'E4-A' })).item;
  assert.deepEqual(tec.editables, []);
  assert.equal(tec.revision.estado, 'sin_enviar');
  assert.equal(tec.sugeridos.identificacion.modalidad, 'M1');
  await rechaza(diagnostico.guardarSeccion(TEC_R1, { id_unico: 'E4-A', seccion: 'mercado', datos: {} }), 403);
  await rechaza(diagnostico.guardarSeccion(G2, { id_unico: 'E4-A', seccion: 'mercado', datos: {} }), 403);

  // Validación: el servidor rechaza con el motivo.
  const guardar = (seccion, datos) => diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion, datos });
  await rechazaCon(guardar('identificacion', { modalidad: 'M9' }), 400, /Identificación › Tipo de unidad productiva \(modalidad\): "M9" no es una opción válida/);
  await rechazaCon(guardar('verificacion', { existe: 'si', fecha: '2999-01-01' }), 400, /la fecha no puede ser futura/);
  await rechazaCon(guardar('verificacion', { existe: 'quizás' }), 400, /responde Sí o No/);
  await rechazaCon(guardar('formalizacion', { rut: 'si', nit: 'abc' }), 400, /escribe solo números/);
  await rechazaCon(guardar('foda', { fortalezas: Array.from({ length: 11 }, (_, i) => `F${i}`) }), 400, /máximo 10 elementos/);
  await rechazaCon(guardar('recursos', { ingresos_mensuales: -5 }), 400, /valor en pesos/);
  await rechazaCon(guardar('actividad', { volumen_produccion: 2.5 }), 400, /número entero/);
  await rechazaCon(guardar('inventada', {}), 400, /no existe/);

  // Por partes: lo guardado se conserva; los campos desconocidos se descartan.
  await guardar('formalizacion', { camara_comercio: 'si', matricula: '123456', rut: 'si', nit: '900.123.456-1', otra_cosa: 'x' });
  await guardar('recursos', SECCIONES_V2_PRUEBA.recursos);
  const d = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-A' })).item;
  assert.equal(d.secciones.formalizacion.otra_cosa, undefined);
  assert.deepEqual(d.calculos, { nivel_formalizacion: 'formal', utilidad_mensual: 500000, margen_porcentaje: 25 });
  assert.equal(d.secciones.recursos.ingresos_mensuales, 2000000);
  assert.ok(d.completitud.v1.faltan.some((f) => /^Verificación en sitio › ¿La unidad productiva existe/.test(f)));
  assert.equal(d.completitud.v1.completo, false);
  const act = await ultimaActividad('diagnostico.guardar');
  assert.equal(act.id_unico, 'E4-A');
  assert.equal(act.cambios.seccion, 'recursos');
  assert.deepEqual(act.cambios.campos.ingresos_mensuales, [null, 2000000], 'lo que cambió de la sección va en cambios.campos (E12)');
  assert.equal(act.cambios.cambios, undefined);
  // Obligatorio según otro campo: con Cámara de comercio «sí» se pide la matrícula.
  assert.deepEqual(diagnostico.faltantesSeccion('formalizacion', { camara_comercio: 'si', rut: 'no' }), ['Formalización › Número de matrícula mercantil']);
  assert.equal(diagnostico.calculos({ formalizacion: { camara_comercio: 'no', rut: 'no' } }).nivel_formalizacion, 'informal');
  assert.equal(diagnostico.calculos({ recursos: { ingresos_mensuales: 0, costos_mensuales: 10 } }).margen_porcentaje, null);
  // El esquema que dibuja la pantalla.
  const esq = diagnostico.esquemaDiagnostico().item;
  assert.deepEqual(esq.secciones.map((s) => s.clave), ['verificacion', 'socializacion', 'identificacion', 'formalizacion', 'actividad',
    'recursos', 'indicadores', 'negocio', 'mercado', 'foda', 'plan_fortalecimiento', 'concepto']);
});

test('E4 Visita 1: verificación en sitio, socialización y caracterización exigidas; secuencia de la ruta en el servidor', async () => {
  await guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', false));
  const sopV1 = await formatosCompletos('8810001_v1', 'v1', 'M1');
  // FUN-GES-02: la V2 no se registra con la V1 abierta, ni la V3 sin la V2.
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v2', false)), 409, /Primero debe cerrarse la Visita 1/);
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', true, sopV1)), 400, /Para cerrar la Visita 1 falta en el diagnóstico: Verificación en sitio/);

  await diagnosticoV1(G1, 'E4-A', 'M1');
  // Con un «No» en la verificación, la observación es obligatoria y la V1 no se cierra como exitosa.
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'verificacion', datos: { existe: 'si', funciona: 'no', informacion_veraz: 'si', fecha: hoyIso() } });
  const sinObs = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-A' })).item.completitud.v1.faltan;
  assert.ok(sinObs.includes('Verificación en sitio › Observación (hay una respuesta «No»)'));
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', true, sopV1)), 400, /no está en funcionamiento: la Visita 1 no se cierra como exitosa/);
  // La socialización de la ruta es obligatoria.
  await diagnosticoV1(G1, 'E4-A', 'M1');
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'socializacion', datos: { realizada: 'no', fecha: hoyIso() } });
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', true, sopV1)), 400, /La ruta debe socializarse en la Visita 1/);
  await diagnosticoV1(G1, 'E4-A', 'M1');
  const v1 = await guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', true, sopV1));
  assert.equal(v1.item.cierre.cerrada, true);

  // Cerrada la V1, la verificación y la socialización ya no cambian; la caracterización sí (se actualiza en la V2).
  await rechazaCon(diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'verificacion', datos: {} }), 409, /La Visita 1 ya está cerrada/);
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'actividad', datos: { ...SECCIONES_V1_PRUEBA('M1').actividad, volumen_produccion: 120 } });

  // Una unidad que sale en la V1 (No Aceptación) cierra sin diagnóstico y no tiene más visitas.
  await upE4('E4-B', '8810002', 'M1');
  const v1b = await guardarV(G1, visitaE4('8810002', 'E4-B', 'v1', false));
  const salida = {
    documentos_visita_obligatorios: { 'Acta de Visita 1': [await soporteE4(v1b.item.id, 'Acta de Visita 1', 'acta.pdf', 'x')] },
    documentos_visita_opcionales: { 'Acta de No Aceptación': [await soporteE4(v1b.item.id, 'Acta de No Aceptación', 'no.pdf', 'x')] },
  };
  assert.equal((await guardarV(G1, visitaE4('8810002', 'E4-B', 'v1', true, salida))).item.cierre.cerrada, true);
  await rechazaCon(guardarV(G1, visitaE4('8810002', 'E4-B', 'v2', false)), 409, /salió del programa en la Visita 1 \(Acta de No Aceptación\)/);
});

test('E4 Visita 2: diagnóstico completo, plan de negocio e indicadores INNPULSA para cerrar; revisión del coordinador', async () => {
  const v2 = await guardarV(G1, visitaE4('8810001', 'E4-A', 'v2', false));
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', false)), 409, /Primero debe cerrarse la Visita 2/);
  // Primero los formatos de la V2 (con los indicadores INNPULSA y el plan de negocio), luego el diagnóstico.
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v2', true)), 400,
    /^Para cerrar la Visita 2 faltan los formatos: Acta de Visita 2, Diagnóstico de unidades productivas individuales \(M1\), Plan de negocios, Indicadores iniciales INNPULSA, Video de recorrido con entrevista\.$/);
  const soportes = await formatosCompletos(v2.item.id, 'v2', 'M1');
  soportes.documentos['Plan de negocios'] = [await soporteE4(v2.item.id, 'Plan de negocios', 'plan.xlsx', 'plan')];
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v2', true, soportes)), 400, /^Para cerrar la Visita 2 falta: .*Mercado y necesidades › /);
  await guardarSecciones(G1, 'E4-A', SECCIONES_V2_PRUEBA);
  assert.equal((await guardarV(G1, visitaE4('8810001', 'E4-A', 'v2', true, soportes))).item.cierre.cerrada, true);
  // La línea base (E5) se congeló al cerrar la V2.
  const lb = (await query("SELECT linea_base FROM up_evaluaciones e JOIN unidades_productivas u USING (id_up) WHERE u.id_unico = 'E4-A'")).rows[0].linea_base;
  assert.deepEqual(lb, { ventas_mensuales: 1800000, clientes_mes: 120, personas_trabajan: 3, ingresos_mensuales: 2000000, costos_mensuales: 1500000, utilidad_mensual: 500000, volumen_produccion: 120, unidad_volumen: 'unidades', periodo_volumen: 'diario' });

  // El plan de negocio queda vinculado a la unidad y el diagnóstico pasa a revisión.
  let d = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-A' })).item;
  assert.equal(d.plan_negocio.archivo, 'plan.xlsx');
  assert.equal(d.innpulsa_cargado, true);
  assert.equal(d.revision.estado, 'pendiente');
  assert.deepEqual(d.editables, []);
  await rechazaCon(diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'mercado', datos: SECCIONES_V2_PRUEBA.mercado }), 409, /en revisión/);

  // FUN-CLR-01: revisa la coordinación de su territorio.
  await rechaza(diagnostico.revisarDiagnostico(G1, { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechaza(diagnostico.revisarDiagnostico(TEC_R1, { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechaza(diagnostico.revisarDiagnostico(local({ region: 'región 2' }), { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechazaCon(diagnostico.revisarDiagnostico(LOCAL_R1, { id_unico: 'E4-A', decision: 'devuelto' }), 400, /Escribe la observación/);
  await rechazaCon(diagnostico.revisarDiagnostico(LOCAL_R1, { id_unico: 'E4-A', decision: 'quizás' }), 400, /«revisado» o «devuelto»/);
  await diagnostico.revisarDiagnostico(LOCAL_R1, { id_unico: 'E4-A', decision: 'devuelto', observacion: 'Falta detallar la competencia.' });
  assert.deepEqual((await ultimaActividad('diagnostico.revisar')).cambios.campos.estado, ['pendiente', 'devuelto']);

  // Devuelto: el gestor corrige (aunque la V2 esté cerrada) y lo reenvía.
  d = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-A' })).item;
  assert.equal(d.revision.observacion, 'Falta detallar la competencia.');
  assert.equal(d.puede_reenviar, true);
  assert.ok(d.editables.includes('mercado') && !d.editables.includes('verificacion'));
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'mercado', datos: { ...SECCIONES_V2_PRUEBA.mercado, condiciones_mercado: 'Dos panaderías cercanas con precios más altos' } });
  // La corrección también cambia las ventas: al revisarse, la línea base se toma del diagnóstico revisado.
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-A', seccion: 'indicadores', datos: { ventas_mensuales: '1.900.000', clientes_mes: 120 } });
  await rechaza(diagnostico.reenviarDiagnostico(TEC_R1, { id_unico: 'E4-A' }), 403);
  await diagnostico.reenviarDiagnostico(G1, { id_unico: 'E4-A' });
  await rechazaCon(diagnostico.reenviarDiagnostico(G1, { id_unico: 'E4-A' }), 409, /Solo se reenvía un diagnóstico devuelto/);
  await diagnostico.revisarDiagnostico(LOCAL_R1, { id_unico: 'E4-A', decision: 'revisado' });
  const ev = (await query("SELECT linea_base, linea_base_historial FROM up_evaluaciones e JOIN unidades_productivas u USING (id_up) WHERE u.id_unico = 'E4-A'")).rows[0];
  assert.equal(ev.linea_base.ventas_mensuales, 1900000, 'la línea base es la del diagnóstico revisado');
  assert.deepEqual([ev.linea_base_historial.length, ev.linea_base_historial[0].linea_base.ventas_mensuales, ev.linea_base_historial[0].motivo], [1, 1800000, 'diagnóstico revisado por la coordinación']);
  await rechazaCon(diagnostico.revisarDiagnostico(LOCAL_R1, { id_unico: 'E4-A', decision: 'revisado' }), 409, /ya está revisado/);
  await rechazaCon(diagnostico.guardarSeccion(COORD, { id_unico: 'E4-A', seccion: 'concepto', datos: SECCIONES_V2_PRUEBA.concepto }), 409, /ya fue revisado/);
  d = (await diagnostico.obtenerDiagnostico(TEC_R1, { id_unico: 'E4-A' })).item;
  assert.equal(d.revision.estado, 'revisado');
  assert.equal(d.revision.historial.length, 2);
  // ET4-01: la V3 solo se registra después de la entrega, y al menos 30 días después de ella.
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', false)), 409, /no tiene una entrega registrada/);
  await query(`INSERT INTO items_ups (id_unico, id_up, nodo, doc) SELECT 'E4-A', id_up, 'ATLAN1', jsonb_build_object('logistica',
    jsonb_build_object('entregado', true, 'entregado_en', (now() - interval '10 days')::text)) FROM unidades_productivas WHERE id_unico = 'E4-A'`);
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', false)), 400, /al menos 30 días después de la entrega/);
  await query("UPDATE items_ups SET doc = jsonb_set(doc, '{logistica,entregado_en}', to_jsonb((now() - interval '40 days')::text)) WHERE id_unico = 'E4-A'");
  assert.ok((await guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', false))).item.id);
});

test('E4 checklist de coherencia de la carpeta por visita (consulta el técnico de apoyo)', async () => {
  await rechaza(coherencia.coherenciaCarpeta(G2, { id_unico: 'E4-A' }), 403);
  await rechaza(coherencia.coherenciaCarpeta(COMPRAS, { id_unico: 'E4-A' }), 403);
  const c = (await coherencia.coherenciaCarpeta(TEC_R1, { id_unico: 'E4-A' })).items;
  assert.deepEqual(c.map((x) => x.tipo), ['v1', 'v2', 'v3']);
  const v1 = Object.fromEntries(c[0].items.map((x) => [x.clave, x]));
  assert.equal(v1.formatos.ok, true, 'la V1 se cerró con todos sus formatos');
  assert.equal(v1.fechas.ok, true);
  assert.equal(v1.diagnostico.ok, true, 'modalidad M1 y departamento Atlántico coinciden');
  const v2 = Object.fromEntries(c[1].items.map((x) => [x.clave, x]));
  assert.equal(v2.formatos.ok, true);
  assert.equal(v2.diagnostico.ok, true);
  const v3 = Object.fromEntries(c[2].items.map((x) => [x.clave, x]));
  assert.equal(v3.formatos.ok, false);
  assert.match(v3.formatos.detalle, /^Faltan: Bitácora, Acta de Visita 3, Registro fotográfico, Video de salida\.$/);
  assert.equal(v3.fechas.ok, true, 'la V2 está cerrada');

  // Cédulas frente a asociados (V1 de M2–M4): cuenta imágenes y páginas de los PDF.
  await upSolidaria('E4-C', '8810003');
  for (let i = 1; i <= 3; i += 1) await asociados.guardarAsociado(G1, { id_unico: 'E4-C', asociado: asociado(300 + i, { es_representante: i === 1 }) });
  const vc = await guardarV(G1, visitaV1('8810003', 'E4-C', false));
  let cc = (await coherencia.coherenciaCarpeta(G1, { id_unico: 'E4-C' })).items[0].items.find((x) => x.clave === 'cedulas');
  assert.equal(cc.ok, false);
  assert.match(cc.detalle, /0 imágenes o páginas para 2 asociados activos/);
  const pdf2 = await soporteE4(vc.item.id, 'Cédulas de los asociados', 'cedulas.pdf', '%PDF-1.4 1 0 obj << /Type /Page >> 2 0 obj << /Type /Page >> 3 0 obj << /Type /Pages >>');
  await guardarV(G1, { ...visitaV1('8810003', 'E4-C', false), soportes: { documentos_beneficiario: { 'Cédulas de los asociados': [pdf2] } } });
  cc = (await coherencia.coherenciaCarpeta(G1, { id_unico: 'E4-C' })).items[0].items.find((x) => x.clave === 'cedulas');
  assert.equal(cc.ok, true);
  assert.match(cc.detalle, /2 imágenes o páginas para 2 asociados/);
  const dc = (await coherencia.coherenciaCarpeta(G1, { id_unico: 'E4-C' })).items[0].items.find((x) => x.clave === 'diagnostico');
  assert.equal(dc.ok, false);
  assert.match(dc.detalle, /el diagnóstico no tiene modalidad/);
});

test('E4 la migración del diagnóstico es idempotente y la base guarda el estado de la revisión', async () => {
  await iniciarEsquemaBitacora();
  assert.equal((await query("SELECT estado_revision FROM up_diagnosticos d JOIN unidades_productivas u USING (id_up) WHERE u.id_unico = 'E4-A'")).rows[0].estado_revision, 'revisado');
  await rechazaSql(query("UPDATE up_diagnosticos SET estado_revision = 'aprobadisimo'"));
});

// ============================================================
// Revisión de E3 y E4: defectos confirmados y corregidos
// ============================================================
test('E3/E4 revisión: fechas imposibles, ids raros, cifras a la colombiana, visitas repetidas y enlaces por rol', async () => {
  // Fechas que no existen en el calendario: 400, no 500.
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E4-C', asociado: asociado(400, { fecha_nacimiento: '1990-02-31' }) }), 400, /fecha de nacimiento no es válida/);
  await rechazaCon(asociados.registrarActa(G1, { id_unico: 'E3-B', fecha: '2024-02-30', motivo: 'x', retiros: [{ id: 1 }] }, await archivoTemporal('a.pdf', 'x')), 400, /fecha del acta no es válida/);
  await rechazaCon(diagnostico.guardarSeccion(G1, { id_unico: 'E4-C', seccion: 'verificacion', datos: { fecha: '2024-02-30' } }), 400, /la fecha no es válida/);
  // Ids y cuerpos raros: 400 en español.
  await rechazaCon(asociados.quitarAsociado(G1, { id_unico: 'E4-C', id: 'abc' }), 400, /asociado indicado no es válido/);
  await rechazaCon(asociados.quitarAsociado(G1, { id_unico: 'E4-C', id: '99999999999' }), 400, /asociado indicado no es válido/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E4-C', asociado: { ...asociado(401), id: 1.5 } }), 400, /asociado indicado no es válido/);
  await rechazaCon(asociados.guardarAsociado(G1, { id_unico: 'E4-C', asociado: null }), 400, /nombre completo/);
  await rechazaCon(asociados.registrarActa(G1, null, null), 400, /Falta la unidad/);

  // Cifras: «1.500.000» son miles; «1500.75» y «1500,75» son decimales; lo demás es 400.
  const { numeroDe } = await import('../src/servicios/secciones.js');
  assert.deepEqual(['1.500.000', '$ 2.000.000,50', '1500.75', '1500,75', '1500', 1200, '1.200'].map(numeroDe), [1500000, 2000000.5, 1500.75, 1500.75, 1500, 1200, 1200]);
  assert.deepEqual(['abc', '1.5.0', '', '12,345,678'].map(numeroDe), [null, null, null, null]);
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-C', seccion: 'recursos', datos: { ingresos_mensuales: '1.500.000', costos_mensuales: '1500.75', personas_trabajan: '1.200' } });
  const r = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-C' })).item.secciones.recursos;
  assert.deepEqual([r.ingresos_mensuales, r.costos_mensuales, r.personas_trabajan], [1500000, 1501, 1200]);
  await rechazaCon(diagnostico.guardarSeccion(G1, { id_unico: 'E4-C', seccion: 'recursos', datos: { ingresos_mensuales: '1,5,0' } }), 400, /valor en pesos/);

  // La V1 con un «No» no se pinta como lista para cerrar como exitosa.
  await diagnosticoV1(G1, 'E4-C', 'M3');
  await diagnostico.guardarSeccion(G1, { id_unico: 'E4-C', seccion: 'verificacion', datos: { existe: 'no', funciona: 'si', informacion_veraz: 'si', fecha: hoyIso(), observacion: 'Se trasladó' } });
  const v1 = (await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-C' })).item.completitud.v1;
  assert.deepEqual([v1.completo, v1.cierra_exitosa, v1.verificacion_negativa], [true, false, ['la unidad no existe en el lugar']]);

  // Una V1 nueva no tapa la V1 ya cerrada (ni una salida del programa).
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v1', false)), 409, /visita cerrada/);
  await rechazaCon(guardarV(G1, { ...visitaE4('8810001', 'E4-A', 'v1', false), id: '8810001_v1_2' }), 409, /La Visita 1 de esta unidad ya está cerrada/);
  await rechazaCon(guardarV(G1, { ...visitaE4('8810002', 'E4-B', 'v1', false), id: '8810002_v1_2' }), 409, /salió del programa/);

  // El técnico de apoyo ve el nombre del plan de negocio, sin el enlace a los soportes de Visitas (no usa Visitas).
  assert.equal((await diagnostico.obtenerDiagnostico(TEC_R1, { id_unico: 'E4-A' })).item.plan_negocio.url, null);
  assert.match((await diagnostico.obtenerDiagnostico(G1, { id_unico: 'E4-A' })).item.plan_negocio.url, /^\/visitas\/archivo\?id=/);
});

// ============================================================
// E5 · LÍNEA BASE Y EVALUACIÓN DE SALIDA (ET1-18, ET4-02, ET4-03, ET4-04, ET4-05, FUN-PSI-01, FUN-CLR-02)
// ============================================================
const salidaE5 = await import('../src/servicios/salida.js');
const SALIDA_PRUEBA = {
  resultado: { ventas_mensuales: '2.700.000', clientes_mes: 150, personas_trabajan: 4, ingresos_mensuales: '3.000.000', costos_mensuales: 2000000, volumen_produccion: 200, unidad_volumen: 'Unidades', periodo_volumen: 'diario' },
  caracterizacion: { camara_comercio: 'si', rut: 'si', tipo_actividad: 'produccion', productos_servicios: 'Pan y tortas', mercado_objetivo: 'Barrio y ferias', cambios: 'Se formalizó y amplió la producción' },
  negocio: { etapa: 'consolidado', productos: 'Pan, tortas y galletas', valor_agregado: 'Receta propia y empaque', estado_produccion: 'continua', estado_comercializacion: 'municipal' },
  encuesta: { acompanamiento: 5, formacion: 4, bienes: 5, oportunidad: 3, general: 4, comentario: 'Muy útil' },
  compromiso: { cumplimiento: 'cumple' },
  recomendaciones: { texto: 'Llevar el registro diario de ventas y separar las cuentas de la casa y del negocio.' },
};

test('E5 línea base congelada, indicadores de resultado con variación, encuesta y permisos', async () => {
  // Permisos: otro nodo, compras y tallerista no consultan; el técnico de apoyo sí, sin escribir.
  await rechaza(salidaE5.obtenerEvaluacion(G2, { id_unico: 'E4-A' }), 403);
  assert.equal((await salidaE5.obtenerEvaluacion(COMPRAS, { id_unico: 'E4-A' })).ok, true, 'el Profesional alianzas consulta la salida (FUN-PACM-05, E12)');
  await rechaza(salidaE5.obtenerEvaluacion({ sub: 't', rol: 'tallerista', alcance: { region: 'Región 1' } }, { id_unico: 'E4-A' }), 403);
  const tec = (await salidaE5.obtenerEvaluacion(TEC_R1, { id_unico: 'E4-A' })).item;
  assert.equal(tec.editable, false);
  assert.equal(tec.linea_base.ventas_mensuales, 1900000);
  await rechaza(salidaE5.guardarSeccionSalida(TEC_R1, { id_unico: 'E4-A', seccion: 'resultado', datos: {} }), 403);
  await rechaza(salidaE5.guardarSeccionSalida(G2, { id_unico: 'E4-A', seccion: 'resultado', datos: {} }), 403);
  // Antes de cerrar la V2 no se diligencia (E4-C tiene la V1 abierta).
  await rechazaCon(salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-C', seccion: 'resultado', datos: {} }), 409, /después de cerrar la Visita 2/);

  const guardar = (seccion, datos) => salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion, datos });
  await rechazaCon(guardar('encuesta', { general: 6 }), 400, /Encuesta de satisfacción › Satisfacción general con el programa: califica de 1 a 5/);
  await rechazaCon(guardar('compromiso', { cumplimiento: 'casi' }), 400, /no es una opción válida/);
  await rechazaCon(guardar('inventada', {}), 400, /no existe/);
  for (const [seccion, datos] of Object.entries(SALIDA_PRUEBA)) await guardar(seccion, datos);
  assert.equal((await ultimaActividad('evaluacion.guardar')).cambios.seccion, 'recomendaciones');

  const e = (await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item;
  const comp = Object.fromEntries(e.comparacion.map((c) => [c.clave, c]));
  assert.deepEqual([comp.ventas_mensuales.base, comp.ventas_mensuales.salida, comp.ventas_mensuales.variacion, comp.ventas_mensuales.variacion_pct], [1900000, 2700000, 800000, 42.1]);
  assert.deepEqual([comp.utilidad_mensual.base, comp.utilidad_mensual.salida, comp.utilidad_mensual.variacion_pct], [500000, 1000000, 100]);
  assert.equal(comp.clientes_mes.variacion_pct, 25);
  assert.equal(e.satisfaccion, 4.2);
  // Con un cumplimiento parcial del acta, la observación es obligatoria.
  await guardar('compromiso', { cumplimiento: 'parcial' });
  assert.ok((await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item.completitud.faltan.includes('Cumplimiento del acta de compromiso › Observación'));
  await guardar('compromiso', { cumplimiento: 'parcial', observacion: 'No asistió a un taller' });
  // La escala solo admite 1 a 5 de verdad.
  for (const raro of [true, [5], '5.0', 4.5]) {
    await rechazaCon(guardar('encuesta', { ...SALIDA_PRUEBA.encuesta, general: raro }), 400, /califica de 1 a 5/);
  }
  // El volumen se compara en su equivalente mensual y con la misma unidad.
  const vol = (b, s) => salidaE5.comparacion(b, s).find((c) => c.clave === 'volumen_produccion');
  assert.equal(vol({ volumen_produccion: 120, unidad_volumen: 'kilos', periodo_volumen: 'diario' }, { volumen_produccion: 3600, unidad_volumen: 'Kilos', periodo_volumen: 'mensual' }).variacion_pct, 0);
  assert.match(vol({ volumen_produccion: 120, unidad_volumen: 'kilos', periodo_volumen: 'diario' }, { volumen_produccion: 120, unidad_volumen: 'cajas', periodo_volumen: 'diario' }).nota, /Unidades distintas/);
  assert.ok(salidaE5.faltantesSalida(null, { plan: null, bienes: [] }).includes('La línea base de la Visita 2 (se congela al cerrarla)'));
  // Funciones puras.
  assert.equal(salidaE5.promedioEncuesta({ acompanamiento: 5 }), null);
  assert.equal(salidaE5.comparacion({ ventas_mensuales: 0 }, { ventas_mensuales: 10 })[0].variacion_pct, null, 'sin porcentaje sobre una base de 0');
});

test('E5 uso de los activos por cada bien del plan aprobado y cierre de la V3 con revisión del coordinador', async () => {
  // Plan aprobado de E4-A con un bien.
  const { id_producto: horno } = await catalogo.guardarProducto(COORD, {
    codigo: 'E5-HORNO', nombre: 'Horno industrial E5', precio: 3000000, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await carrito.guardarDatos(COORD, { id_unico: 'E4-A', presupuesto_maximo: 5000000 });
  await carrito.ponerLinea(G1, { id_unico: 'E4-A', id_producto: horno, cantidad: 1 });
  assert.equal((await aprobarPorComite('E4-A')).carrito.estado, 'aprobado');
  let e = (await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item;
  assert.deepEqual(e.bienes.map((b) => b.nombre), ['Horno industrial E5']);
  assert.ok(e.completitud.faltan.includes('Uso de los activos › Horno industrial E5'));
  const linea = e.bienes[0].id_linea;
  await rechazaCon(salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion: 'uso_activos', datos: { items: [{ id_linea: 99999999, estado: 'en_uso' }] } }), 400, /no está en el plan aprobado/);
  await rechazaCon(salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion: 'uso_activos', datos: { items: [{ id_linea: linea, estado: 'vendido' }] } }), 400, /no es un estado válido/);
  await salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion: 'uso_activos', datos: { items: [{ id_linea: linea, estado: 'danado' }] } });
  e = (await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item;
  assert.deepEqual(e.completitud.faltan, ['Uso de los activos › Horno industrial E5: explica por qué no está en uso']);

  // Cerrar la V3: formatos y evaluación completa.
  const v3 = '8810001_v3';
  // Un mismo archivo no vale por varios formatos, ni sirve un archivo de otra visita.
  const unaFoto = await soporteE4(v3, 'Registro fotográfico', 'foto.jpg', 'foto');
  const deLaV1 = (await query("SELECT nombre FROM archivos WHERE nombre LIKE '8810001/%8810001_v1_%' LIMIT 1")).rows[0].nombre;
  const trampa = { documentos: { 'Bitácora': [unaFoto], 'Acta de Visita 3': [unaFoto], 'Registro fotográfico': [unaFoto],
    'Video de salida': [{ ...unaFoto, archivo: 'video.mp4' }, { archivo: 'v.mp4', blob: deLaV1 }] } };
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', true, trampa)), 400, /faltan los formatos: Acta de Visita 3, Registro fotográfico, Video de salida\.$/);
  const soportes = await formatosCompletos(v3, 'v3', 'M1');
  // Con el plan reabierto no hay contra qué verificar los activos.
  await carrito.cambiarEstado(COORD, { id_unico: 'E4-A', estado: 'devuelto', motivo: 'Revisar el plan' });
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', true, soportes)), 400, /El plan de capitalización está reabierto \(devuelto\)/);
  await aprobarPorComite('E4-A');
  await borrarFormacionDePrueba();
  await rechazaCon(guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', true, soportes)), 400,
    /^Para cerrar la Visita 3 falta en la evaluación de salida: Uso de los activos › Horno industrial E5: explica por qué no está en uso\.$/);
  await salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion: 'uso_activos', datos: { items: [{ id_linea: linea, estado: 'danado', observacion: 'Falla eléctrica; en garantía' }] } });
  assert.equal((await guardarV(G1, visitaE4('8810001', 'E4-A', 'v3', true, soportes))).item.cierre.cerrada, true);
  e = (await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item;
  assert.equal(e.revision.estado, 'pendiente');
  assert.equal(e.editable, false);
  await rechazaCon(salidaE5.guardarSeccionSalida(G1, { id_unico: 'E4-A', seccion: 'encuesta', datos: SALIDA_PRUEBA.encuesta }), 409, /en revisión/);

  // FUN-CLR-02: revisa la coordinación de su territorio.
  await rechaza(salidaE5.revisarEvaluacion(G1, { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechaza(salidaE5.revisarEvaluacion(TEC_R1, { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechaza(salidaE5.revisarEvaluacion(local({ region: 'región 2' }), { id_unico: 'E4-A', decision: 'revisado' }), 403);
  await rechazaCon(salidaE5.revisarEvaluacion(LOCAL_R1, { id_unico: 'E4-A', decision: 'devuelto' }), 400, /Escribe la observación/);
  await salidaE5.revisarEvaluacion(LOCAL_R1, { id_unico: 'E4-A', decision: 'devuelto', observacion: 'Falta la foto del horno dañado.' });
  assert.equal((await salidaE5.obtenerEvaluacion(G1, { id_unico: 'E4-A' })).item.editable, true, 'devuelta, el gestor la corrige');
  await salidaE5.reenviarEvaluacion(G1, { id_unico: 'E4-A' });
  await salidaE5.revisarEvaluacion(LOCAL_R1, { id_unico: 'E4-A', decision: 'revisado' });
  await rechazaCon(salidaE5.revisarEvaluacion(LOCAL_R1, { id_unico: 'E4-A', decision: 'revisado' }), 409, /La evaluación de salida ya está revisada/);
  await rechazaCon(salidaE5.guardarSeccionSalida(COORD, { id_unico: 'E4-A', seccion: 'encuesta', datos: SALIDA_PRUEBA.encuesta }), 409, /ya fue revisada/);
  await rechaza(salidaE5.reenviarEvaluacion(G2, { id_unico: 'E4-A' }), 403);
  // Con la evaluación revisada, reabrir y volver a cerrar la V2 no cambia la línea base en silencio.
  const v2doc = (await query("SELECT documento FROM visitas WHERE id = '8810001_v2'")).rows[0].documento;
  await guardarV(COORD, { ...visitaE4('8810001', 'E4-A', 'v2', false), soportes: v2doc.soportes }, { reabrir: true, motivo: 'Corregir un soporte' });
  await rechazaCon(guardarV(G1, { ...visitaE4('8810001', 'E4-A', 'v2', true), soportes: v2doc.soportes }), 409, /ya se envió a revisión: la coordinación debe devolverla/);
  assert.equal((await salidaE5.recongelarLineaBase({ query }, { id_up: (await query("SELECT id_up FROM unidades_productivas WHERE id_unico = 'E4-A'")).rows[0].id_up })), null);
  const okRevisar = (await query("SELECT cambios FROM actividad WHERE accion = 'evaluacion.revisar' AND resultado = 'ok' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(okRevisar.cambios.campos.estado, ['pendiente', 'revisado']);
  assert.equal((await ultimaActividad('evaluacion.revisar')).resultado, 'rechazado', 'el intento repetido queda como rechazado');
});

test('E5 tablero por territorio: línea base, salida, variación y satisfacción (PSI, CLR y técnico)', async () => {
  await rechaza(salidaE5.tableroEvaluacion(G1, {}), 403);
  assert.ok(Array.isArray((await salidaE5.tableroEvaluacion(COMPRAS, {})).items), 'el Profesional alianzas consulta el tablero (FUN-PACM-05, E12)');
  const t = await salidaE5.tableroEvaluacion(LOCAL_R1, {});
  const fila = t.items.find((x) => x.id_unico === 'E4-A');
  assert.ok(fila, 'E4-A está en la región 1');
  assert.deepEqual([fila.indicadores.ventas_mensuales.variacion_pct, fila.satisfaccion, fila.estado_revision], [42.1, 4.2, 'revisado']);
  assert.ok(t.resumen.con_salida >= 1);
  assert.equal(t.resumen.variacion_ventas_promedio_pct, 42.1);
  assert.ok(t.resumen.enviadas >= 1);
  assert.equal(t.resumen.truncado, false);
  assert.equal((await salidaE5.tableroEvaluacion(local({ region: 'región 2' }), {})).items.some((x) => x.id_unico === 'E4-A'), false, 'otra región no la ve');
  assert.ok((await salidaE5.tableroEvaluacion(DATOS, { region: 'Región 1', modalidad: 'M1' })).items.some((x) => x.id_unico === 'E4-A'));
  assert.equal((await salidaE5.tableroEvaluacion(DATOS, { modalidad: 'M3' })).items.some((x) => x.id_unico === 'E4-A'), false);
  assert.ok((await salidaE5.tableroEvaluacion(TEC_R1, {})).items.length >= 1);
  // Por HTTP: el gestor recibe 403.
  await reiniciarLimites();
  const g = await entrar('atlan1', '1001001001');
  assert.equal((await g.http('GET', '/api/evaluacion/tablero')).status, 403);
  await query("DELETE FROM carritos WHERE codigo_iniciativa = 'E4-A'");
  await query("DELETE FROM catalogo_productos WHERE id_origen = 'E5-HORNO'");
});

// ============================================================
// E6 · REGLAS DE LAS VISITAS EN EL SERVIDOR (ET1-01, ET1-04, ET1-05, ET1-06, ET1-07, ET1-11, ET1-23, ET1-24,
// ET1-25, ET4-01, ET4-06, ET4-11)
// ============================================================
const reglas = await import('../src/servicios/reglasVisitas.js');
const secciones = await import('../src/servicios/secciones.js');

test('E6 datos de la visita en el servidor: códigos válidos, solo se cierra exitosa y ya realizada', async () => {
  await upE4('E6-A', '8820001', 'M1');
  const base = (extra = {}) => ({ ...visitaE4('8820001', 'E6-A', 'v1', false), ...extra });
  await rechazaCon(guardarV(G1, base({ programacion: { resultado_llamada: 'QUIZAS' } })), 400, /resultado del agendamiento no es válido/);
  await rechazaCon(guardarV(G1, base({ realizacion: { estado: 'REALIZADA' } })), 400, /estado de la visita no es válido/);
  await rechazaCon(guardarV(G1, base({ programacion: { fecha_visita: '2026-02-30' } })), 400, /fecha de la visita no es válida/);
  // «Sin datos asignados» es lo que manda la pantalla cuando no hay dato: se acepta como vacío.
  const v = await guardarV(G1, base({ programacion: { resultado_llamada: 'Sin datos asignados', contacto_logrado: 'Sin datos asignados' } }));
  assert.equal(v.item.programacion.resultado_llamada, null);
  await diagnosticoV1(G1, 'E6-A', 'M1');
  const soportes = await formatosCompletos('8820001_v1', 'v1', 'M1');
  await rechazaCon(guardarV(G1, base({ soportes, realizacion: { estado: 'PENDIENTE_SOPORTES' }, cierre: { cerrada: true } })), 400, /Solo se cierra una visita exitosa/);
  const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await rechazaCon(guardarV(G1, base({ soportes, programacion: { resultado_llamada: 'AGENDADA', fecha_visita: manana, hora_visita: '09:00' }, cierre: { cerrada: true } })),
    400, new RegExp(`programada para el ${manana}: se cierra desde ese día`));
  await rechazaCon(guardarV(G1, base({ soportes, programacion: { resultado_llamada: 'NO_CONTESTA' }, cierre: { cerrada: true } })), 400, /debe estar agendada con su fecha/);
  // ET1-04 y ET1-05: sin el acta de compromiso ni la autorización de datos no cierra.
  const sinActa = JSON.parse(JSON.stringify(soportes));
  delete sinActa.documentos['Acta de Compromiso'];
  delete sinActa.documentos['Autorización para el tratamiento de datos personales'];
  await rechazaCon(guardarV(G1, base({ soportes: sinActa, cierre: { cerrada: true } })), 400,
    /^Para cerrar la Visita 1 faltan los formatos: Acta de Compromiso, Autorización para el tratamiento de datos personales\.$/);
});

test('E6 documentos por modalidad (ET1-06): RUT solo en M3–M4, cédulas de todos los participantes y certificado vigente', async () => {
  const obligatorios = (m) => catalogoVisitas.formatosDe('v1', m).filter((f) => !f.opcional).map((f) => f.nombre);
  assert.ok(!obligatorios('M2').includes('RUT') && obligatorios('M3').includes('RUT') && obligatorios('M4').includes('RUT'));
  assert.ok(!obligatorios('M2').includes('Certificado de existencia o Cámara de comercio') && obligatorios('M3').includes('Certificado de existencia o Cámara de comercio'));
  assert.ok(obligatorios('M2').includes('Tenencia') && obligatorios('M2').includes('Cédulas de los asociados') && !obligatorios('M1').includes('Cédulas de los asociados'));
  assert.ok(catalogoVisitas.formatosDe('v2', 'M1').some((f) => f.nombre === 'Video de recorrido con entrevista' && !f.opcional), 'ET1-23');

  // M3 con 15 asociados (uno representante): las cédulas deben cubrir a los 14 restantes.
  await upSolidaria('E6-B', '8820002');
  for (let i = 1; i <= 15; i += 1) await asociados.guardarAsociado(G1, { id_unico: 'E6-B', asociado: asociado(500 + i, { es_representante: i === 1 }) });
  await guardarV(G1, visitaV1('8820002', 'E6-B', false));
  await diagnosticoV1(G1, 'E6-B', 'M3');
  const soportes = await formatosCompletos('8820002_v1', 'v1', 'M3');
  const pocas = await soporteE4('8820002_v1', 'Cédulas de los asociados', 'cedulas.pdf', '%PDF-1.4 << /Type /Page >> << /Type /Page >>');
  const conPocas = { ...soportes, documentos: { ...soportes.documentos, 'Cédulas de los asociados': [pocas] } };
  await rechazaCon(guardarV(G1, { ...visitaV1('8820002', 'E6-B', true), soportes: conPocas }), 400,
    /faltan cédulas de los asociados: hay 2 imágenes o páginas para 14 asociados activos \(sin el representante\)/);

  // ET1-07: certificado con más de un mes frente a la fecha de la V1.
  const viejo = reglas.unMesAntes(hoyIso());
  const antes = new Date(Date.parse(`${viejo}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await diagnostico.guardarSeccion(G1, { id_unico: 'E6-B', seccion: 'formalizacion', datos: { ...SECCIONES_V1_PRUEBA('M3').formalizacion, fecha_certificado: antes } });
  await rechazaCon(guardarV(G1, { ...visitaV1('8820002', 'E6-B', true), soportes }), 400, new RegExp(`se expidió el ${antes}: .*debe ser del ${viejo} o posterior`));
  await diagnostico.guardarSeccion(G1, { id_unico: 'E6-B', seccion: 'formalizacion', datos: { ...SECCIONES_V1_PRUEBA('M3').formalizacion, fecha_certificado: null } });
  await rechazaCon(guardarV(G1, { ...visitaV1('8820002', 'E6-B', true), soportes }), 400, /Registra la fecha de expedición del certificado/);
  await diagnostico.guardarSeccion(G1, { id_unico: 'E6-B', seccion: 'formalizacion', datos: { ...SECCIONES_V1_PRUEBA('M3').formalizacion, fecha_certificado: viejo } });
  assert.equal((await guardarV(G1, { ...visitaV1('8820002', 'E6-B', true), soportes })).item.cierre.cerrada, true);
  // Un mes antes, con meses cortos y cambio de año.
  assert.deepEqual(['2026-03-31', '2026-01-15', '2024-03-30'].map(reglas.unMesAntes), ['2026-02-28', '2025-12-15', '2024-02-29']);
});

test('E6 visita virtual por causa externa (ET1-25): causa, soporte y aprobación de la interventoría registrada por la coordinación', async () => {
  await upE4('E6-C', '8820003', 'M1');
  const virtual = (extra = {}) => ({
    ...visitaE4('8820003', 'E6-C', 'v1', false),
    realizacion: { estado: 'EXITOSA', modalidad: 'VIRTUAL', causa_virtual: 'orden_publico', justificacion_virtual: 'Paro armado en la vereda.' },
    ...extra,
  });
  await rechazaCon(guardarV(G1, virtual({ realizacion: { estado: 'EXITOSA', modalidad: 'VIRTUAL', causa_virtual: 'pereza' } })), 400, /causa de la visita virtual no es válida/);
  await rechazaCon(guardarV(G1, virtual({ realizacion: { estado: 'EXITOSA', modalidad: 'REMOTA' } })), 400, /presencial o virtual/);
  await guardarV(G1, virtual());
  await diagnosticoV1(G1, 'E6-C', 'M1');
  const soportes = await formatosCompletos('8820003_v1', 'v1', 'M1');
  await rechazaCon(guardarV(G1, virtual({ soportes, realizacion: { estado: 'EXITOSA', modalidad: 'VIRTUAL', causa_virtual: 'orden_publico' }, cierre: { cerrada: true } })),
    400, /necesita la causa externa y su justificación/);
  await rechazaCon(guardarV(G1, virtual({ soportes, cierre: { cerrada: true } })), 400, /Carga el soporte de la visita virtual/);
  soportes.documentos['Soporte de la visita virtual'] = [await soporteE4('8820003_v1', 'Soporte de la visita virtual', 'orden.pdf', 'orden publico')];
  await rechazaCon(guardarV(G1, virtual({ soportes, cierre: { cerrada: true } })), 400, /necesita la aprobación de la interventoría/);

  // La aprobación la registra la coordinación de su territorio, con su soporte en PDF.
  const pdf = () => archivoTemporal('aprobacion.pdf', '%PDF-1.4 aprobacion de la interventoria');
  const campos = { visita_id: '8820003_v1', fecha: hoyIso(), aprobada_por: 'Ana Interventora' };
  await rechaza(visitas.registrarAprobacionVirtual(G1, campos, await pdf()), 403);
  await rechaza(visitas.registrarAprobacionVirtual(local({ region: 'región 2' }), campos, await pdf()), 403);
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, { ...campos, aprobada_por: '' }, await pdf()), 400, /quién aprobó/);
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, { ...campos, fecha: '2999-01-01' }, await pdf()), 400, /no puede ser futura/);
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, campos), 400, /Adjunta el soporte/);
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, campos, await archivoTemporal('a.jpg', 'x', 'image/jpeg')), 400, /debe ser un PDF/);
  const ap = (await visitas.registrarAprobacionVirtual(LOCAL_R1, campos, await pdf())).item.realizacion.aprobacion_interventoria;
  assert.equal(ap.aprobada_por, 'Ana Interventora');
  assert.equal((await ultimaActividad('visitas.aprobacion_virtual')).id_unico, 'E6-C');
  assert.equal(ap.causa_virtual, 'orden_publico', 'la aprobación guarda la causa que se aprobó');
  // El PDF de la aprobación no puede usarse como soporte del gestor (ni quitarse desde la visita).
  const conAprobacion = { ...soportes, documentos: { ...soportes.documentos, 'Soporte de la visita virtual': [{ archivo: 'x.pdf', blob: ap.soporte }] } };
  const usado = await guardarV(G1, virtual({ soportes: conAprobacion }));
  assert.deepEqual(usado.item.soportes.documentos['Soporte de la visita virtual'], []);
  await rechaza(visitas.subirArchivoVisita(G1, { accion: 'quitar', visita_id: '8820003_v1', blob: ap.soporte }), 404);
  // El navegador no puede quitarla ni inventarla: el servidor la conserva.
  const g = await guardarV(G1, virtual({ soportes, realizacion: { ...virtual().realizacion, aprobacion_interventoria: null } }));
  assert.equal(g.item.realizacion.aprobacion_interventoria.aprobada_por, 'Ana Interventora');
  // Si cambia la justificación (o la causa, o deja de ser virtual), la aprobación se descarta y queda en el registro.
  const cambio = await guardarV(G1, virtual({ soportes, realizacion: { ...virtual().realizacion, justificacion_virtual: 'Otra razón.' } }));
  assert.equal(cambio.item.realizacion.aprobacion_interventoria, undefined);
  assert.equal(cambio.item.realizacion.aprobaciones_descartadas.length, 1);
  assert.match(cambio.aviso, /aprobación de la interventoría se descartó/);
  assert.equal((await ultimaActividad('visitas.guardar')).cambios.aprobacion_descartada, true);
  await rechazaCon(guardarV(G1, virtual({ soportes, realizacion: { ...virtual().realizacion, justificacion_virtual: 'Otra razón.' }, cierre: { cerrada: true } })),
    400, /necesita la aprobación de la interventoría/);
  await guardarV(G1, virtual({ soportes }));
  await visitas.registrarAprobacionVirtual(LOCAL_R1, campos, await pdf());
  assert.equal((await guardarV(G1, virtual({ soportes, cierre: { cerrada: true } }))).item.cierre.cerrada, true);
  // Una visita presencial no lleva aprobación.
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, { ...campos, visita_id: '8820001_v1' }, await pdf()), 409, /no está marcada como virtual/);
});

test('E6 la logística marca cuándo se entregó (ET4-01) y la V3 pide recomendaciones (ET4-11)', async () => {
  const antes = (await compras.obtenerItemUP(COMPRAS, { id: '1' })).item.logistica;
  assert.equal(antes.entregado_en ?? null, null);
  const m = (await compras.guardarItemUP(COMPRAS, { id: '1', logistica: { entregado: true, entregado_en: '1999-01-01' } })).item;
  assert.ok(m.logistica.entregado_en && !m.logistica.entregado_en.startsWith('1999'), 'la fecha la pone el servidor');
  const otra = (await compras.guardarItemUP(COMPRAS, { id: '1', logistica: { entregado: true } })).item;
  assert.equal(otra.logistica.entregado_en, m.logistica.entregado_en, 'volver a guardar no cambia la fecha');
  // El día de la entrega es el de Colombia (una marca después de las 7 p. m. no cae al día siguiente).
  assert.equal(await reglas.fechaEntregaUP({ query }, { id_unico: '1' }), secciones.diaColombia(m.logistica.entregado_en));
  // Desmarcar no cuenta como entrega, y volver a marcar conserva la primera fecha (no corre el plazo de la V3).
  const desmarcada = (await compras.guardarItemUP(COMPRAS, { id: '1', logistica: { entregado: false } })).item.logistica;
  assert.deepEqual([desmarcada.entregado, desmarcada.entregado_en], [false, m.logistica.entregado_en]);
  const otraVez = (await compras.guardarItemUP(COMPRAS, { id: '1', logistica: { entregado: true } })).item.logistica;
  assert.equal(otraVez.entregado_en, m.logistica.entregado_en);
  await compras.guardarItemUP(COMPRAS, { id: '1', logistica: { entregado: false } });
  // Recomendaciones de la V3 (sección de la evaluación de salida).
  assert.ok(salidaE5.ESQUEMA_SALIDA.some((s) => s.clave === 'recomendaciones' && s.campos[0].obligatorio));
  assert.ok(salidaE5.faltantesSalida({}, { plan: null, bienes: [] }).includes('Recomendaciones a la unidad › Recomendaciones dadas en la Visita 3'));
});

test('E6 revisión: páginas reales de los PDF, videos solo en formatos de video, una visita por tipo y la aprobación atada a su causa', async () => {
  // ---- Páginas de un PDF (ET1-06): el árbol de páginas, también comprimido; las revisiones no cuentan doble ----
  const B = (s) => Buffer.from(s, 'latin1');
  const plano = '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R 4 0 R] /Count 3 >> endobj\n'
    + '2 0 obj << /Type /Page /Parent 1 0 R >> endobj 3 0 obj << /Type /Page /Parent 1 0 R >> endobj 4 0 obj << /Type /Page /Parent 1 0 R >> endobj\n';
  assert.equal(reglas.contarPaginasPdf(B(plano)), 3);
  const firmado = `${plano}2 0 obj << /Type /Page /Parent 1 0 R /Annots [] >> endobj 1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R 4 0 R] /Count 3 >> endobj\n%%EOF`;
  assert.equal(reglas.contarPaginasPdf(B(firmado)), 3, 'una actualización incremental no cuenta doble');
  assert.equal(reglas.contarPaginasPdf(B('%PDF-1.7 1 0 obj << /Type /Pages /Resources << /Font << /F1 5 0 R >> >> /Count 7 >> endobj')), 7);
  const { deflateSync } = await import('node:zlib');
  const objetos = deflateSync(B('1 0 2 60 << /Type /Pages /Kids [2 0 R] /Count 14 >> << /Type /Page /Parent 1 0 R >>'));
  const comprimido = Buffer.concat([
    B(`%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 2 /First 9 /Filter /FlateDecode /Length ${objetos.length} >>\nstream\n`), objetos, B('\nendstream\nendobj\n%%EOF'),
  ]);
  assert.equal(reglas.contarPaginasPdf(comprimido), 14, 'PDF optimizado con flujos de objetos');
  assert.equal(reglas.contarPaginasPdf(B('%PDF-1.4 nada legible')), null);

  // M3 con 3 asociados (uno representante): un video o una hoja de cálculo no cuentan como cédulas; un PDF ilegible se dice.
  await upSolidaria('E6-D', '8820004');
  for (let i = 1; i <= 3; i += 1) await asociados.guardarAsociado(G1, { id_unico: 'E6-D', asociado: asociado(600 + i, { es_representante: i === 1 }) });
  await guardarV(G1, visitaV1('8820004', 'E6-D', false));
  const upD = (await query("SELECT id_up, id_unico, nombre, modalidad FROM unidades_productivas WHERE id_unico = 'E6-D'")).rows[0];
  const video = await soporteE4('8820004_v1', 'Cédulas de los asociados', 'cedulas.mp4', 'video');
  const hoja = await soporteE4('8820004_v1', 'Cédulas de los asociados', 'cedulas.xlsx', 'PK\u0003\u0004 hoja');
  assert.equal((await reglas.conteoCedulas({ query }, upD, { documentos: { 'Cédulas de los asociados': [video, hoja] } })).paginas, 0);
  const ilegible = await soporteE4('8820004_v1', 'Cédulas de los asociados', 'escaneo.pdf', '%PDF-1.4 sin paginas');
  await rechazaCon(reglas.conteoCedulas({ query }, upD, { documentos: { 'Cédulas de los asociados': [ilegible] } }), 400,
    /No se pudo leer el número de páginas del PDF «escaneo\.pdf»/);
  // La checklist de la carpeta lo muestra como pendiente, con el mismo motivo.
  await guardarV(G1, { ...visitaV1('8820004', 'E6-D', false), soportes: { documentos: { 'Cédulas de los asociados': [ilegible] } } });
  const cc = (await coherencia.coherenciaCarpeta(G1, { id_unico: 'E6-D' })).items[0].items.find((x) => x.clave === 'cedulas');
  assert.equal(cc.ok, false);
  assert.match(cc.detalle, /No se pudo leer el número de páginas/);

  // ---- Videos (ET1-23, ET4-06): el formato de video solo recibe videos, y el cierre lo verifica ----
  await rechazaCon(soporteE4('8820004_v1', 'Video de caracterización', 'recorrido.pdf', '%PDF-1.4 x'), 400, /debe ser un video/);
  await rechazaCon(soporteE4('8820004_v1', 'Imágenes de caracterización', 'fotos.pdf', '%PDF-1.4 x'), 400, /debe ser una imagen/);
  const conPdf = { documentos: { 'Video de caracterización': [{ archivo: 'v.pdf', blob: '8820004/x/8820004_v1_20260101010101_abc123_v.pdf' }] } };
  assert.ok(catalogoVisitas.formatosFaltantes('v1', 'M1', conPdf).includes('Video de caracterización (lleva 0 de 1)'));

  // ---- Una visita por tipo (ET1-11): ni una segunda abierta ni una segunda cerrada ----
  await rechazaCon(guardarV(G1, { ...visitaV1('8820004', 'E6-D', false), id: '8820004_v1_2' }), 409, /ya tiene la Visita 1 abierta/);
  await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, unidad_nombre, nodo_gestor, tipo_visita, tipo_visita_label, estado_visita,
      cerrada, fecha_cierre, documento, creado_en, fecha_actualizacion)
    SELECT id || '_2', id_up, id_unico, unidad_doc, unidad_nombre, nodo_gestor, tipo_visita, tipo_visita_label, estado_visita, false, NULL,
      jsonb_set(jsonb_set(documento, '{id}', to_jsonb(id || '_2')), '{cierre,cerrada}', 'false'), now(), now()
      FROM visitas WHERE id = '8820002_v1'`);
  await rechazaCon(guardarV(G1, { ...visitaV1('8820002', 'E6-B', true), id: '8820002_v1_2' }), 409, /Visita 1 de esta unidad ya está cerrada/);
  await query("DELETE FROM visitas WHERE id = '8820002_v1_2'");

  // ---- La aprobación exige la causa y la justificación guardadas ----
  await guardarV(G1, { ...visitaV1('8820004', 'E6-D', false), realizacion: { estado: 'EXITOSA', modalidad: 'VIRTUAL' } });
  await rechazaCon(visitas.registrarAprobacionVirtual(LOCAL_R1, { visita_id: '8820004_v1', fecha: hoyIso(), aprobada_por: 'Ana' },
    await archivoTemporal('ap.pdf', '%PDF-1.4 aprobacion')), 409, /aún no tiene guardadas la causa externa y la justificación/);
  await guardarV(G1, visitaV1('8820004', 'E6-D', false));

  // ---- Entrega para la V3 (ET4-01): día de Colombia; manda el MASTER; cuenta el Kit UP entregado en el inventario ----
  assert.equal(secciones.diaColombia('2026-10-02T01:30:00Z'), '2026-10-01', 'las 8:30 p. m. de Colombia siguen siendo el mismo día');
  assert.equal(await reglas.fechaEntregaUP({ query }, upD), null);
  const dia = (n) => secciones.diaColombia(new Date(Date.now() - n * 86400000));
  const bod = (await query("INSERT INTO inventario.bodegas (nombre, tipo) VALUES ('Bodega E6-D', 'principal') RETURNING id")).rows[0].id;
  const kit = (await query("INSERT INTO inventario.combos (nombre, codigo_barras) VALUES (' e6-d ', 'KIT-E6-D') RETURNING id")).rows[0].id;
  await query(`INSERT INTO inventario.entregas_kits (combo_id, bodega_id, responsable, adjunto_nombre, adjunto_tipo, creado_por, fecha)
    VALUES ($1, $2, '{}'::jsonb, 'acta.pdf', 'application/pdf', 'bodega', now() - interval '45 days')`, [kit, bod]);
  assert.equal(await reglas.fechaEntregaUP({ query }, upD), dia(45), 'el Kit UP lleva el ID de la unidad');
  await query(`INSERT INTO entregas_ups (id_unico, id_up, nodo, doc) VALUES ('E6-D', $1, 'ATLAN1', jsonb_build_object('excel_fecha_entrega_efectiva', $2::text))`, [upD.id_up, dia(60)]);
  assert.equal(await reglas.fechaEntregaUP({ query }, upD), dia(60), 'manda la entrega efectiva del MASTER');
  await query("UPDATE entregas_ups SET doc = jsonb_build_object('excel_fecha_entrega_efectiva', $1::text) WHERE id_unico = 'E6-D'", [dia(-10)]);
  assert.equal(await reglas.fechaEntregaUP({ query }, upD), dia(45), 'una fecha del MASTER que no ha llegado no cuenta');
  // La pantalla consulta la entrega y la fecha mínima antes de programar la V3; otro nodo no.
  const plazo = (await visitas.plazoVisita3(G1, { id_unico: 'E6-D' })).item;
  assert.deepEqual(plazo, { fecha_entrega: dia(45), desde: dia(15), dias: 30 });
  await rechaza(visitas.plazoVisita3(G2, { id_unico: 'E6-D' }), 403);
  const g = await entrar('atlan1', '1001001001');
  assert.equal((await g.http('GET', '/api/visitas/plazo-v3?id_unico=E6-D')).json.item.desde, dia(15));
  await query("DELETE FROM entregas_ups WHERE id_unico = 'E6-D'");
  await query('DELETE FROM inventario.entregas_kits WHERE combo_id = $1', [kit]);
  await query('DELETE FROM inventario.combos WHERE id = $1', [kit]);
  await query('DELETE FROM inventario.bodegas WHERE id = $1', [bod]);

  // Una entrega registrada después no bloquea una V3 ya programada: el plazo se valida al crearla o al cambiar su fecha.
  const v3 = (await query("SELECT documento, cerrada, fecha_cierre FROM visitas WHERE id = '8810001_v3'")).rows[0];
  const logistica = (await query("SELECT id_unico, doc FROM items_ups WHERE id_unico = 'E4-A'")).rows;
  await query("UPDATE visitas SET cerrada = false, documento = jsonb_set(documento, '{cierre,cerrada}', 'false') WHERE id = '8810001_v3'");
  await query("UPDATE items_ups SET doc = jsonb_set(doc, '{logistica,entregado_en}', to_jsonb((now() - interval '5 days')::text)) WHERE id_unico = 'E4-A' AND doc ? 'logistica'");
  const fecha = v3.documento.programacion.fecha_visita;
  const v3Doc = (extra = {}) => ({ ...visitaE4('8810001', 'E4-A', 'v3', false, v3.documento.soportes), ...extra });
  assert.ok((await guardarV(G1, v3Doc({ programacion: { ...v3.documento.programacion } }))).item.id, 'misma fecha: no se vuelve a validar');
  const otraFecha = secciones.diaColombia(new Date(Date.parse(`${fecha}T12:00:00Z`) - 86400000));
  await rechazaCon(guardarV(G1, v3Doc({ programacion: { ...v3.documento.programacion, fecha_visita: otraFecha } })), 400, /al menos 30 días después de la entrega/);
  await query('UPDATE visitas SET documento = $1, cerrada = $2, fecha_cierre = $3 WHERE id = $4', [v3.documento, v3.cerrada, v3.fecha_cierre, '8810001_v3']);
  for (const r of logistica) await query('UPDATE items_ups SET doc = $2 WHERE id_unico = $1 AND doc ? $3', [r.id_unico, r.doc, 'logistica']);
});

// ============================================================
// E7 · FORTALECIMIENTO CON CONTROL REAL (ET2-02, ET2-04, ET2-05, ET2-06, ET2-07, ET2-08, ET2-10, ET2-11, ET2-12,
// ET2-13, ET2-15, ET2-16, FUN-TAL-02, FUN-TAL-06, FUN-TAL-07, FUN-TAL-08)
// ============================================================
const correo = await import('../src/servicios/correo.js');
const formacionSrv = await import('../src/servicios/formacion.js');
const formacionReglas = await import('../src/servicios/talleresFormacion.js');

test('E7 formación: convocatoria por correo, sesión virtual, asistencia por integrante, encuestas, 80 % e informes', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const reg = await entrar('taller.regional1', 'Regional-Taller-2026');
  // tallerista.otro es el Tallerista activo de la Región 1 (otra prueba pasa a tallerista.r1 a la Región 2).
  const t1 = await entrar('tallerista.otro', 'Tallerista-Pruebas-2026');
  const t2 = await entrar('tallerista.r2', 'Tallerista-Pruebas-2026');
  const s1 = `coordinador:${(await query("SELECT id_coordinador FROM coordinadores WHERE usuario = 'tallerista.otro'")).rows[0].id_coordinador}`;
  const idUp = async (u) => (await query('SELECT id_up FROM unidades_productivas WHERE id_unico = $1', [u])).rows[0].id_up;
  const [b, a, e3] = [await idUp('E6-B'), await idUp('E4-A'), await idUp('E3-A')];
  await query("UPDATE representantes SET correo1 = 'representante.e6b@ejemplo.co' WHERE id_representante = (SELECT id_representante FROM unidades_productivas WHERE id_up = $1)", [b]);
  const pdf = '%PDF-1.4 soporte de formación';
  const multipart = async (s, metodo, ruta, campos = {}, archivos = []) => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const f = new FormData();
    Object.entries(campos).forEach(([k, v]) => f.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
    archivos.forEach(([campo, nombre, contenido, tipo = 'application/pdf']) => f.append(campo, new Blob([contenido], { type: tipo }), nombre));
    const r = await fetch(base + ruta, { method: metodo, headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: f });
    return { status: r.status, json: await r.json().catch(() => ({})), r };
  };

  // ---- Programar: el grupo y el taller; la convocatoria queda en la bandeja de salida (ET2-07) ----
  const grupo = await reg.http('POST', '/api/talleres/grupos', { nombre: 'Grupo E7', region: 'Región 1', ups: [b, a, e3] });
  assert.equal(grupo.status, 200, JSON.stringify(grupo.json));
  const alta = await reg.http('POST', '/api/talleres', {
    nombre: 'Fortalecimiento E7', nodo: 'ATLAN1', municipio: 'Barranquilla', lugar: 'Casa de la cultura', grupo_id: grupo.json.item.id,
    encuentros: [1, 2, 3].map((modulo) => ({ modulo, inicio: `2026-03-0${modulo}T14:00:00.000Z`, duracion_minutos: 180, tallerista_sub: s1 })),
  });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  const id = alta.json.item.id;
  assert.match(alta.json.mensaje, /Convocatoria en la bandeja de salida: \d+ correo/);
  const correos = (await query("SELECT para, asunto, texto, estado FROM correos_salida WHERE origen = 'taller_convocatoria' AND referencia = $1", [String(id)])).rows;
  assert.ok(correos.length >= 1);
  assert.ok(correos.some((c) => c.para.includes('representante.e6b@ejemplo.co')), 'al representante con correo');
  assert.match(correos[0].texto, /Módulo 1: .*\(3 horas\)/);
  assert.match(correos[0].texto, /M3 y M4 con al menos 5/);
  assert.equal(alta.json.item.convocatoria.pendientes, correos.length);
  // ET2-02: la sesión se muestra en bloques de 120 + 60 minutos.
  assert.deepEqual([alta.json.item.encuentros[0].bloques.teorico_practico.minutos, alta.json.item.encuentros[0].bloques.evaluacion.minutos], [120, 60]);
  assert.equal(alta.json.item.encuentros[0].bloques.evaluacion.inicio, '2026-03-01T16:00:00.000Z');
  // El envío marca cada correo; sin SMTP no se envía nada.
  assert.deepEqual(await correo.enviarPendientes(), { enviados: 0, fallidos: 0, sin_smtp: true });
  // Un correo al representante de cada UP con correo y uno solo al gestor del nodo con sus UP.
  const alGestor = correos.filter((x) => x.para.includes('atlan1@x.co'));
  assert.equal(alGestor.length, 1);
  assert.match(alGestor[0].texto, /Unidades de tu nodo convocadas: .*E6-B/);
  // Los talleres de prueba ya pasaron: para probar el envío se simula que la sesión es próxima.
  await query("UPDATE correos_salida SET vence_en = now() + interval '1 day' WHERE origen = 'taller_convocatoria' AND referencia = $1", [String(id)]);
  const enviados = [];
  let ronda = { enviados: 0, fallidos: 0 };
  const enviar = async (x) => { enviados.push(x.para); if (x.para.includes('representante.e6b@ejemplo.co')) throw new Error('buzón lleno'); };
  for (let i = 0; i < 20; i += 1) {
    const r = await correo.enviarPendientes({ enviar });
    ronda = { enviados: ronda.enviados + r.enviados, fallidos: ronda.fallidos + r.fallidos };
    if (!r.enviados && !r.fallidos) break;
  }
  assert.ok(ronda.fallidos >= 1);
  const fallido = (await query("SELECT id, error, intentos, proximo_intento > now() AS espera FROM correos_salida WHERE estado = 'fallido' AND referencia = $1", [String(id)])).rows[0];
  assert.deepEqual([fallido.error, fallido.intentos, fallido.espera], ['buzón lleno', 1, true], 'un fallo espera antes de reintentar: no gasta los 5 intentos de una vez');
  // Pasada la espera se reintenta; un envío interrumpido (enviando hace más de 10 minutos) también.
  await query("UPDATE correos_salida SET proximo_intento = now() - interval '1 second' WHERE id = $1", [fallido.id]);
  await correo.enviarPendientes({ enviar: async () => {} });
  assert.equal((await query('SELECT estado FROM correos_salida WHERE id = $1', [fallido.id])).rows[0].estado, 'enviado');
  await query("UPDATE correos_salida SET estado = 'enviando', actualizado_en = now() - interval '20 minutes' WHERE id = $1", [fallido.id]);
  await correo.enviarPendientes({ enviar: async () => {} });
  assert.equal((await query('SELECT estado FROM correos_salida WHERE id = $1', [fallido.id])).rows[0].estado, 'enviado');
  // Una convocatoria cuya sesión ya pasó no se envía: queda vencida.
  await query("UPDATE correos_salida SET estado = 'pendiente', vence_en = now() - interval '1 hour' WHERE id = $1", [fallido.id]);
  assert.equal((await correo.enviarPendientes({ enviar: async () => {} })).vencidos, 1);
  await query("UPDATE correos_salida SET estado = 'fallido', vence_en = now() + interval '1 day', proximo_intento = now() + interval '1 hour' WHERE id = $1", [fallido.id]);
  assert.equal((await t1.http('POST', `/api/talleres/${id}/convocar`, {})).status, 403, 'el Tallerista no convoca');
  assert.equal((await reg.http('POST', `/api/talleres/${id}/convocar`, {})).status, 200);
  assert.equal((await ultimaActividad('talleres.convocatoria')).resultado, 'ok');
  // Reconvocar reemplaza la convocatoria: lo que no salió se cancela y el asunto dice «Reprogramación».
  assert.equal((await query('SELECT estado FROM correos_salida WHERE id = $1', [fallido.id])).rows[0].estado, 'cancelado');
  assert.ok((await query("SELECT asunto FROM correos_salida WHERE referencia = $1 AND estado = 'pendiente'", [String(id)])).rows.every((x) => /^Reprogramación: convocatoria/.test(x.asunto)));
  // Cambiar solo el docente no reconvoca; cambiar la fecha, sí.
  const pendientesAntes = (await query("SELECT count(*)::int AS n FROM correos_salida WHERE referencia = $1 AND estado = 'pendiente'", [String(id)])).rows[0].n;
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/encuentros/2`, { tallerista_sub: s1 })).json.mensaje, 'Módulo actualizado.');
  assert.equal((await query("SELECT count(*)::int AS n FROM correos_salida WHERE referencia = $1 AND estado = 'pendiente'", [String(id)])).rows[0].n, pendientesAntes);
  // Al editar la programación con otras fechas, la convocatoria se rehace.
  const editado = await reg.http('PUT', `/api/talleres/${id}`, {
    nombre: 'Fortalecimiento E7', nodo: 'ATLAN1', municipio: 'Barranquilla', lugar: 'Casa de la cultura', grupo_id: grupo.json.item.id,
    encuentros: [1, 2, 3].map((modulo) => ({ modulo, inicio: `2026-03-0${modulo + 1}T14:00:00.000Z`, duracion_minutos: 180, tallerista_sub: s1 })),
  });
  assert.equal(editado.status, 200, JSON.stringify(editado.json));
  assert.match(editado.json.mensaje, /Convocatoria reprogramada en la bandeja de salida/);
  assert.equal(correo.correoValido('no-es-correo'), false);

  // ---- ET2-04: sesión virtual con la aprobación de la interventoría ----
  const integrantesB = (await query('SELECT id FROM up_asociados WHERE id_up = $1 AND activo ORDER BY id', [b])).rows.map((r) => r.id);
  const integrantesE3 = (await query('SELECT id FROM up_asociados WHERE id_up = $1 AND activo ORDER BY id', [e3])).rows.map((r) => r.id);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'pereza', justificacion_virtual: 'x' })).status, 400);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'orden_publico' })).status, 400, 'la justificación es obligatoria');
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'orden_publico', justificacion_virtual: 'Paro armado en el municipio' })).status, 200);
  const realizar = (s, modulo, asistencia, integrantes, extra = {}) => multipart(s, 'POST', `/api/talleres/${id}/encuentros/${modulo}/realizar`,
    { asistencia, integrantes, observaciones: 'Sesión realizada', evaluacion: 'Taller práctico de costos con ejercicio individual', ...extra },
    [['soportes', 'asistencia.pdf', pdf], ['informe', 'informe.pdf', pdf], ['fotos', 'foto.png', Buffer.from([137,80,78,71,13,10,26,10,0,0]), 'image/png'],
      ['videos', 'video.mp4', Buffer.from([0,0,0,0x18,...Buffer.from('ftypmp42'),0,0,0,0]), 'video/mp4']]);
  const todas = [`up:${b}`, `up:${a}`, `up:${e3}`];
  const r1 = { [b]: integrantesB.slice(0, 5), [e3]: integrantesE3.slice(0, 2) };
  assert.match((await realizar(t1, 1, todas, r1)).json.error, /falta la aprobación de la interventoría/);
  const aprobar = (s, modulo, extra = {}, archivos = [['archivo', 'aprobacion.pdf', pdf]]) =>
    multipart(s, 'POST', `/api/talleres/${id}/encuentros/${modulo}/aprobacion-virtual`, { fecha: hoyIso(), aprobada_por: 'Interventoría ABC', ...extra }, archivos);
  assert.equal((await aprobar(t1, 1)).status, 403, 'la aprobación la registra la coordinación');
  assert.equal((await aprobar(reg, 1, { aprobada_por: '' })).status, 400);
  assert.equal((await aprobar(reg, 1, {}, [])).status, 400);
  assert.equal((await aprobar(reg, 2)).status, 409, 'el módulo 2 es presencial');
  assert.equal((await aprobar(reg, 1)).status, 200);
  // La aprobación vale para la causa y la justificación aprobadas: si cambian, se descarta y se registra de nuevo.
  const otraJust = await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'orden_publico', justificacion_virtual: 'Bloqueo de la vía' });
  assert.match(otraJust.json.mensaje, /aprobación de la interventoría se descartó/);
  assert.equal((await ultimaActividad('talleres.modalidad')).cambios.aprobacion_descartada, true);
  assert.equal((await query('SELECT aprobacion_virtual FROM talleres_encuentros WHERE taller_id = $1 AND modulo = 1', [id])).rows[0].aprobacion_virtual, null);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'orden_publico', justificacion_virtual: 'Paro armado en el municipio' })).status, 200);
  assert.equal((await aprobar(reg, 1)).status, 200);
  // El PDF de la aprobación queda en el registro de la sesión: la coordinación no lo puede quitar.
  const soporteAprobacion = (await query("SELECT s.id FROM talleres_soportes s JOIN talleres_encuentros e ON e.id = s.encuentro_id WHERE e.taller_id = $1 AND s.tipo = 'aprobacion_virtual' LIMIT 1", [id])).rows[0].id;
  assert.equal((await reg.http('DELETE', `/api/talleres/soportes/${soporteAprobacion}`)).status, 409);
  // Guardar lo mismo no la descarta.
  assert.doesNotMatch((await t1.http('PUT', `/api/talleres/${id}/encuentros/1/modalidad`, { modalidad: 'VIRTUAL', causa_virtual: 'orden_publico', justificacion_virtual: 'Paro armado en el municipio' })).json.mensaje, /descartó/);

  // ---- ET2-06/08: asistencia por integrante y mínimo por modalidad ----
  assert.equal((await realizar(t1, 1, todas, { [b]: [999999] })).status, 400, 'solo asociados activos de la UP');
  assert.match((await realizar(t1, 1, todas, r1, { evaluacion: '' })).json.error, /actividad de evaluación de la tercera hora/);
  const hecho1 = await realizar(t1, 1, todas, r1);
  assert.equal(hecho1.status, 200, JSON.stringify(hecho1.json));
  assert.equal((await ultimaActividad('talleres.realizar')).resultado, 'ok');
  assert.equal((await realizar(t1, 2, [`up:${b}`], { [b]: integrantesB.slice(0, 3) })).status, 200, 'se guarda aunque no llegue al mínimo');

  // ---- ET2-10/11: encuestas ----
  const encuesta = (s, idup, tipo, respuestas, modulo) => s.http('PUT', `/api/talleres/${id}/encuestas/${idup}`, { tipo, respuestas, modulo });
  const todo = (n) => Object.fromEntries(formacionReglas.PREGUNTAS_APROPIACION.map((p) => [p.clave, n]));
  assert.equal((await encuesta(t1, b, 'apropiacion_entrada', { ...todo(2), mercadeo: 6 })).status, 400);
  assert.match((await encuesta(t1, e3, 'apropiacion_entrada', todo(2))).json.error, /autorización de tratamiento de datos/, 'sin la autorización de datos de la V1');
  assert.equal((await encuesta(t1, b, 'apropiacion_entrada', todo(2))).status, 200);
  assert.match((await encuesta(t1, b, 'apropiacion_salida', todo(4))).json.error, /al terminar el módulo 3/);
  const sat = Object.fromEntries(formacionReglas.PREGUNTAS_SATISFACCION.map((p) => [p.clave, 5]));
  assert.equal((await encuesta(t1, b, 'satisfaccion', sat, 1)).status, 200);
  assert.match((await encuesta(t1, a, 'satisfaccion', sat, 2)).json.error, /cuando la UP asistió a ese módulo/);
  assert.equal((await encuesta(t2, b, 'satisfaccion', sat, 1)).status, 404, 'un Tallerista de otra región no ve el taller');

  assert.equal((await realizar(t1, 3, [`up:${b}`, `up:${a}`], { [b]: integrantesB.slice(0, 6) })).status, 200);
  assert.equal((await encuesta(t1, b, 'apropiacion_salida', { ...todo(4), comentario: 'Aprendimos a costear' })).status, 200);
  assert.match((await encuesta(t1, e3, 'apropiacion_salida', todo(4))).json.error, /la UP no asistió a ese módulo/);
  assert.equal((await multipart(t1, 'POST', `/api/talleres/${id}/entregas-finales/${b}`, {}, [['archivo', 'entrega.pdf', pdf]])).status, 200);

  // ---- ET2-13: cumplimiento (5 actividades, 80 %) ----
  const c = Object.fromEntries((await reg.http('GET', `/api/talleres/${id}/cumplimiento`)).json.items.map((x) => [x.id_unico, x]));
  assert.deepEqual(c['E6-B'].modulos.map((m) => m.valida), [true, false, true], 'el módulo 2 con 3 integrantes no cuenta en M3');
  assert.deepEqual([c['E6-B'].cumplidas, c['E6-B'].porcentaje, c['E6-B'].cumple_80], [4, 80, true]);
  assert.deepEqual(c['E3-A'].modulos.map((m) => [m.asistio, m.valida]), [[true, false], [false, false], [false, false]], '2 integrantes en M3 no alcanzan');
  assert.deepEqual([c['E4-A'].modulos[0].valida, c['E4-A'].cumple_80], [true, false], 'en M1 basta la persona inscrita');

  // ---- ET2-12: hallazgos, recomendaciones e informe en PDF ----
  assert.equal((await t2.http('PUT', `/api/talleres/${id}/resultados/${b}`, { hallazgos: 'x', recomendaciones: 'y' })).status, 404);
  const sReg = `coordinador:${(await query("SELECT id_coordinador FROM coordinadores WHERE usuario = 'taller.desde.reg'")).rows[0].id_coordinador}`;
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/entrega-final-docente`, { tallerista_sub: sReg })).status, 200);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/resultados/${b}`, { hallazgos: 'x', recomendaciones: 'y' })).status, 403, 'dicta los módulos pero no tiene la entrega final');
  assert.equal((await reg.http('PUT', `/api/talleres/${id}/entrega-final-docente`, { tallerista_sub: s1 })).status, 200);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/resultados/${b}`, { hallazgos: '', recomendaciones: 'y' })).status, 400);
  assert.equal((await t1.http('PUT', `/api/talleres/${id}/resultados/${b}`, { hallazgos: 'Mejoró el registro de ventas.', recomendaciones: 'Mantener el control de costos semanal.' })).status, 200);
  const informe = await fetch(`${base}/api/talleres/${id}/informe/${b}`, { headers: { Cookie: reg.http.cookie() } });
  assert.equal(informe.status, 200);
  assert.equal(informe.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await informe.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  // ---- ET2-15: cumplimiento del territorio ----
  const territorio = (await reg.http('GET', '/api/talleres/cumplimiento')).json;
  assert.ok(territorio.items.some((x) => x.id_unico === 'E6-B' && x.porcentaje === 80 && x.cumple_80));
  assert.ok(territorio.resumen.cumplen >= 1);
  assert.equal(territorio.resumen.unidades, new Set(territorio.items.map((x) => x.id_up)).size, 'una UP en varios talleres cuenta una vez');
  assert.equal(territorio.resumen.inscripciones, territorio.items.length);
  // Un Coordinador local regional con alcance por departamento no ve el taller (tiene UP fuera de su alcance) ni sus filas.
  assert.equal((await jefe.http('POST', '/api/admin/usuarios', { rol: 'coordinador', usuario: 'taller.depto', nombre: 'Regional por departamento', clave: 'Regional-Depto-2026', region: 'Región 1' })).status, 200);
  await query("UPDATE coordinadores SET departamento = 'Atlántico' WHERE usuario = 'taller.depto'");
  const depto = await entrar('taller.depto', 'Regional-Depto-2026');
  assert.equal((await depto.http('GET', `/api/talleres/${id}/cumplimiento`)).status, 404);
  assert.equal((await depto.http('GET', '/api/talleres/cumplimiento')).json.items.some((x) => x.taller_id === id), false);

  // ---- ET2-16: la ficha de la UP muestra la formación registrada en la plataforma ----
  const f = (await formacionSrv.obtenerFormacion(G1, { id_unico: 'E6-B' })).item;
  assert.deepEqual([f.cumplimiento.porcentaje, f.cumplimiento.cumple_80], [80, true]);
  assert.deepEqual([f.items[0].apropiacion.entrada, f.items[0].apropiacion.salida, f.items[0].apropiacion.variacion], [2, 4, 2]);
  assert.equal(f.items[0].resultado.hallazgos, 'Mejoró el registro de ventas.');
  assert.equal(f.items[0].encuentros[0].satisfaccion, 5);
  assert.ok((await formacionSrv.obtenerFormacion(TEC_R1, { id_unico: 'E6-B' })).item.items.length);
  await rechaza(formacionSrv.obtenerFormacion(G2, { id_unico: 'E6-B' }), 403);
  await rechaza(formacionSrv.obtenerFormacion(COMPRAS, { id_unico: 'E6-B' }), 403);
  assert.equal((await ultimaActividad('talleres.encuesta')).id_unico, 'E6-B');
});

test('E7 reglas de formación: bloques, mínimos y respuestas', () => {
  assert.equal(formacionReglas.bloquesSesion('nada'), null);
  assert.deepEqual(formacionReglas.MINIMO_INTEGRANTES, { M1: 1, M2: 3, M3: 5, M4: 5 });
  assert.throws(() => formacionReglas.limpiarRespuestas('otra', {}), /tipo de encuesta no es válido/);
  assert.throws(() => formacionReglas.limpiarRespuestas('satisfaccion', { contenidos: true }), /califica de 1 a 5/);
  const v = formacionReglas.variacionApropiacion({ costos_precios: 1 }, null);
  assert.deepEqual([v.entrada, v.salida, v.variacion], [null, null, null]);
});

// ============================================================
// E8 · PLAN DE CAPITALIZACIÓN CON REGLAS DEL ANEXO (ET3-01, ET3-03, ET3-04, ET3-05, ET3-06, ET3-07, ET3-08)
// ============================================================
const reglasPlan = await import('../src/servicios/reglasPlan.js');
async function errorDe(promesa) {
  try { await promesa; } catch (e) { return e; }
  throw new Error('Se esperaba un error.');
}

test('E8 plan de capitalización: tope por modalidad, plan de negocio, adecuaciones, cotizaciones, coherencia y firma', async () => {
  await upE4('E8-A', '8830001', 'M2 - Asociativa');
  const { id_producto: maq } = await catalogo.guardarProducto(COORD, {
    codigo: 'E8-MAQ', nombre: 'Mezcladora E8', precio: 2000000, iva: 0, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  const pdf = () => archivoTemporal('soporte.pdf', '%PDF-1.4 soporte');
  let v = await carrito.ponerLinea(G1, { id_unico: 'E8-A', id_producto: maq, cantidad: 1 });
  const linea = v.lineas[0].id;
  assert.equal((await ultimaActividadCarrito('carrito.linea')).id_unico, 'E8-A', 'cada cambio queda en la actividad');

  // ---- ET3-04: tope de M2 ($20.000.000) ----
  assert.deepEqual([v.resumen.modalidad, v.resumen.presupuesto_maximo], ['M2', 20000000]);
  await rechazaCon(carrito.guardarDatos(COORD, { id_unico: 'E8-A', presupuesto_maximo: 25000000 }), 400, /unidad M2 no puede pasar de \$ 20\.000\.000/);
  v = await carrito.guardarDatos(COORD, { id_unico: 'E8-A', presupuesto_maximo: 18000000 });
  assert.equal(v.resumen.presupuesto_maximo, 18000000, 'la coordinación puede fijar uno menor');
  // ---- ET3-05: en M2–M4 el transporte va incluido (descuenta) o lo asume el beneficiario (sin monto); sin libro contable ----
  v = await carrito.guardarDatos(COORD, { id_unico: 'E8-A', monto_transporte: 300000, transporte_descontado: true });
  assert.deepEqual([v.resumen.transporte, v.resumen.presupuesto_productos], [300000, 17700000]);
  v = await carrito.guardarDatos(COORD, { id_unico: 'E8-A', monto_transporte: 300000, transporte_descontado: false });
  assert.deepEqual([v.resumen.transporte, v.carrito.monto_transporte], [0, 0]);
  await rechazaCon(carrito.guardarDatos(G1, { id_unico: 'E8-A', libro_contable: true }), 400, /libro contable se registra en el plan de las unidades M1/);

  // ---- Para enviar: plan de negocio y adecuaciones ----
  const envio = await errorDe(carrito.cambiarEstado(G1, { id_unico: 'E8-A', estado: 'enviado' }));
  assert.equal(envio.status, 400);
  assert.match(envio.message, /Plan de negocio › Acciones de la dimensión social/);
  assert.match(envio.message, /Adecuaciones técnicas de la sede › Instalaciones eléctricas/);
  // ET3-01: validación del plan de negocio y permisos.
  await rechazaCon(planCap.guardarPlanNegocio(G1, { id_unico: 'E8-A', plan: { ...PLAN_COMPLETO, plan_accion: [{ accion: 'x', responsable: 'y', fecha: '2026-02-30' }] } }), 400, /Plan de acción, fila 1: la fecha no es válida/);
  await rechazaCon(planCap.guardarPlanNegocio(G1, { id_unico: 'E8-A', plan: { ...PLAN_COMPLETO, riesgos: [{ riesgo: 'x', nivel: 'extremo', mitigacion: 'y' }] } }), 400, /el nivel debe ser alto, medio o bajo/);
  await rechaza(planCap.guardarPlanNegocio(G2, { id_unico: 'E8-A', plan: PLAN_COMPLETO }), 403);
  await rechaza(planCap.guardarPlanNegocio(COMPRAS, { id_unico: 'E8-A', plan: PLAN_COMPLETO }), 403);
  v = await planCap.guardarPlanNegocio(G1, { id_unico: 'E8-A', plan: { ...PLAN_COMPLETO, riesgos: [{ riesgo: 'Alza de insumos', nivel: 'medio' }] } });
  assert.ok(v.clasificacion.problemas_envio.join(' ').includes('Análisis de riesgos: cada riesgo con su nivel y su mitigación'));
  v = await planCap.guardarPlanNegocio(G1, { id_unico: 'E8-A', plan: PLAN_COMPLETO });
  assert.deepEqual(v.carrito.plan_negocio.social, PLAN_COMPLETO.social);
  // ET3-07: adecuaciones técnicas; «No cumple» exige la observación.
  await rechazaCon(planCap.guardarAdecuaciones(G1, { id_unico: 'E8-A', adecuaciones: { ...ADECUACIONES_OK, electricas: { estado: 'no_cumple' } } }), 400, /Instalaciones eléctricas: escribe qué no cumple/);
  await rechazaCon(planCap.guardarAdecuaciones(G1, { id_unico: 'E8-A', adecuaciones: { electricas: { estado: 'quizas' } } }), 400, /Cumple, No cumple o No aplica/);
  v = await planCap.guardarAdecuaciones(G1, { id_unico: 'E8-A', adecuaciones: { ...ADECUACIONES_OK, electricas: { estado: 'no_cumple', observacion: 'Falta un circuito de 220 V' } } });
  assert.equal(v.carrito.adecuaciones.registrado_por, 'Gestora 1');

  // ---- ET3-03: tres cotizaciones de proveedores distintos; la elegida fija el precio ----
  const prov = await proveedoresE8();
  const cotizar = async (u, idProveedor, valor, extra = {}, archivo) => planCap.agregarCotizacion(u,
    { id_unico: 'E8-A', id_linea: linea, id_proveedor: idProveedor, valor_unitario: valor, fecha: diaColombia(), ...extra }, archivo || await pdf());
  await rechazaCon(cotizar(G1, 99999999, 100), 400, /no está registrado/);
  await rechazaCon(cotizar(G1, prov[0], 0), 400, /valor unitario de la cotización debe ser mayor que cero/);
  await rechazaCon(cotizar(G1, prov[0], '1.500.000'), 400, /sin puntos de miles/);
  await rechazaCon(cotizar(G1, prov[0], 100, { fecha: '0000-01-01' }), 400, /fecha de la cotización no es válida/);
  await rechazaCon(cotizar(G1, prov[0], 100, { fecha: '2999-01-01' }), 400, /no puede ser futura/);
  await rechazaCon(cotizar(G1, prov[0], 100, {}, await archivoTemporal('cot.jpg', 'x', 'image/jpeg')), 400, /debe ser un PDF válido/);
  await rechaza(cotizar(COMPRAS, prov[0], 100), 403);
  await cotizar(G1, prov[0], 2100000);
  await rechazaCon(cotizar(G1, prov[0], 2050000), 409, /ya tiene una cotización .*proveedores distintos/);
  await cotizar(G1, prov[1], 1900000);
  v = await cotizar(G1, prov[2], 2000000);
  let cots = v.lineas[0].cotizaciones;
  assert.deepEqual(cots.map((c) => [c.valor_unitario, c.mas_barata]), [[1900000, true], [2000000, false], [2100000, false]], 'comparación ordenada por valor');
  const cara = cots.find((c) => c.valor_unitario === 2100000);
  await rechazaCon(planCap.elegirCotizacion(G1, { id_unico: 'E8-A', id_cotizacion: cara.id }), 400, /no es la más barata .*escribe la justificación/);
  v = await planCap.elegirCotizacion(G1, { id_unico: 'E8-A', id_cotizacion: cara.id, justificacion: 'Incluye instalación y garantía de dos años' });
  assert.deepEqual([v.lineas[0].precio, v.lineas[0].justificacion_cotizacion], [2100000, 'Incluye instalación y garantía de dos años']);
  assert.deepEqual((await ultimaActividadCarrito('carrito.cotizacion_elegir')).cambios.campos.precio, [2000000, 2100000]);
  // Quitar la elegida devuelve la línea al precio del catálogo.
  v = await planCap.quitarCotizacion(G1, { id_unico: 'E8-A', id_cotizacion: cara.id });
  assert.deepEqual([v.lineas[0].precio, v.lineas[0].cotizacion_elegida], [2000000, null]);
  assert.match(v.clasificacion.problemas_aprobacion.join(' '), /tiene 2 de 3 cotizaciones de proveedores distintos; no tiene la cotización elegida/);
  await cotizar(G1, prov[3], 2200000);
  const barata = (await carrito.detalleCarrito(G1, { id_unico: 'E8-A' })).lineas[0].cotizaciones[0];
  v = await planCap.elegirCotizacion(G1, { id_unico: 'E8-A', id_cotizacion: barata.id });
  assert.equal(v.lineas[0].precio, 1900000);
  // Cambiar la cantidad conserva el precio cotizado.
  v = await carrito.ponerLinea(G1, { id_unico: 'E8-A', id_producto: maq, cantidad: 2, modo: 'fijar' });
  assert.deepEqual([v.lineas[0].precio, v.resumen.total], [1900000, 3800000]);

  // Una U.P. sin modalidad no tiene tope: el plan no se envía. Una M1 sin libro contable, tampoco.
  await query("UPDATE unidades_productivas SET modalidad = NULL WHERE id_unico = 'E8-A'");
  await rechazaCon(carrito.cambiarEstado(G1, { id_unico: 'E8-A', estado: 'enviado' }), 400, /no tiene modalidad registrada/);
  await query("UPDATE unidades_productivas SET modalidad = 'M1 - Individual' WHERE id_unico = 'E8-A'");
  await rechazaCon(carrito.cambiarEstado(G1, { id_unico: 'E8-A', estado: 'enviado' }), 400, /debe incluir el libro contable/);
  await query("UPDATE unidades_productivas SET modalidad = 'M2 - Asociativa' WHERE id_unico = 'E8-A'");
  // ---- Se envía (las adecuaciones están diligenciadas, aunque una no cumple) ----
  v = await carrito.cambiarEstado(G1, { id_unico: 'E8-A', estado: 'enviado' });
  assert.equal(v.carrito.estado, 'enviado');
  assert.deepEqual((await ultimaActividadCarrito('carrito.estado')).cambios.campos.estado, ['borrador', 'enviado']);
  const aprobacion = await errorDe(carrito.cambiarEstado(COORD, { id_unico: 'E8-A', estado: 'revisado' }));
  assert.equal(aprobacion.status, 400);
  assert.match(aprobacion.message, /no tiene la evaluación de coherencia y pertinencia/);
  assert.match(aprobacion.message, /Instalaciones eléctricas: no cumple \(Falta un circuito de 220 V\)/);
  assert.match(aprobacion.message, /Falta el plan firmado por la unidad productiva y el consultor/);
  // El tablero muestra el presupuesto efectivo (el fijado de 18M, menor que el tope de 20M de la M2).
  const fila = (await carrito.listarCarritos(COORD)).items.find((x) => x.id_unico === 'E8-A');
  assert.deepEqual([fila.presupuesto_maximo, fila.presupuesto_fijado, fila.modalidad], [18000000, 18000000, 'M2']);

  // ---- ET3-06: coherencia y pertinencia, de la coordinación ----
  await rechaza(planCap.evaluarActivo(G1, { id_unico: 'E8-A', id_linea: linea, coherente: true, pertinente: true }), 403);
  await rechaza(planCap.evaluarActivo(local({ region: 'región 2' }), { id_unico: 'E8-A', id_linea: linea, coherente: true, pertinente: true }), 403);
  await rechazaCon(planCap.evaluarActivo(LOCAL_R1, { id_unico: 'E8-A', id_linea: linea, coherente: true, pertinente: false }), 400, /Escribe la observación/);
  v = await planCap.evaluarActivo(LOCAL_R1, { id_unico: 'E8-A', id_linea: linea, coherente: true, pertinente: false, observacion: 'Con una mezcladora basta' });
  assert.match(v.clasificacion.problemas_aprobacion.join(' '), /no es pertinente \(Con una mezcladora basta\)/);
  await rechazaCon(carrito.cambiarEstado(LOCAL_R1, { id_unico: 'E8-A', estado: 'revisado' }), 400, /no es pertinente \(Con una mezcladora basta\)/);
  // La coordinación ajusta la cantidad: la evaluación de pertinencia se vuelve a hacer.
  v = await carrito.ponerLinea(LOCAL_R1, { id_unico: 'E8-A', id_producto: maq, cantidad: 1, modo: 'fijar' });
  assert.equal(v.lineas[0].evaluacion, null);
  await planCap.evaluarActivo(LOCAL_R1, { id_unico: 'E8-A', id_linea: linea, coherente: true, pertinente: true });
  await planCap.guardarAdecuaciones(LOCAL_R1, { id_unico: 'E8-A', adecuaciones: ADECUACIONES_OK });

  // ---- ET3-08: el PDF del plan para firmar y el plan firmado ----
  const doc = await planCap.pdfPlan(G1, { id_unico: 'E8-A' });
  assert.equal(doc.buffer.subarray(0, 5).toString(), '%PDF-');
  await rechaza(planCap.pdfPlan(G2, { id_unico: 'E8-A' }), 403);
  // El código del plan va impreso en el PDF y se pide al cargarlo firmado.
  const codigo = (await carrito.detalleCarrito(LOCAL_R1, { id_unico: 'E8-A' })).carrito.codigo_plan;
  const firmas = { id_unico: 'E8-A', codigo_plan: codigo, firma_up_nombre: 'Representante E8', firma_up_fecha: diaColombia(), firma_consultor_nombre: 'Gestora 1', firma_consultor_fecha: diaColombia() };
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, { ...firmas, codigo_plan: '' }, await pdf()), 400, /código del plan que está impreso/);
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, { ...firmas, codigo_plan: 'ABCDEF012345' }, await pdf()), 409, /cambió desde que se descargó el PDF/);
  await rechaza(planCap.registrarFirma(G1, firmas, await pdf()), 403); // enviado, el gestor ya no lo cambia
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, { ...firmas, firma_up_nombre: '' }, await pdf()), 400, /nombre de quien firma de la unidad productiva/);
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, { ...firmas, firma_consultor_fecha: '2999-01-01' }, await pdf()), 400, /firma del consultor no es válida/);
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, firmas), 400, /Adjunta el plan firmado/);
  v = await planCap.registrarFirma(LOCAL_R1, firmas, await pdf());
  assert.equal(v.carrito.firma.vigente, true);
  // Volver a guardar lo mismo no invalida la firma (quién y cuándo no cuentan en la huella).
  v = await planCap.guardarAdecuaciones(LOCAL_R1, { id_unico: 'E8-A', adecuaciones: ADECUACIONES_OK });
  assert.equal(v.carrito.firma.vigente, true);
  // Si el plan cambia después de firmado, la firma ya no vale; el PDF viejo tampoco se puede cargar.
  v = await carrito.guardarDatos(LOCAL_R1, { id_unico: 'E8-A', presupuesto_maximo: 17000000 });
  assert.equal(v.carrito.firma.vigente, false);
  await rechazaCon(carrito.cambiarEstado(LOCAL_R1, { id_unico: 'E8-A', estado: 'revisado' }), 400, /El plan cambió después de firmado/);
  await rechazaCon(planCap.registrarFirma(LOCAL_R1, firmas, await pdf()), 409, /cambió desde que se descargó/);
  await planCap.registrarFirma(LOCAL_R1, { ...firmas, codigo_plan: v.carrito.codigo_plan }, await pdf());
  v = await carrito.cambiarEstado(LOCAL_R1, { id_unico: 'E8-A', estado: 'revisado' });
  assert.equal(v.carrito.estado, 'revisado');
  assert.deepEqual(v.clasificacion.problemas_aprobacion, []);
  // Aprobado, nada del plan cambia sin reabrirlo.
  await rechazaCon(planCap.guardarPlanNegocio(LOCAL_R1, { id_unico: 'E8-A', plan: PLAN_COMPLETO }), 409, /devuélvelo para cambiarlo/);
  await rechazaCon(cotizar(LOCAL_R1, prov[0], 100), 409, /devuélvelo para cambiarlo/);
  // El registro de proveedores para cotizar lo consulta también el gestor.
  assert.ok((await planCap.proveedoresParaCotizar(G1)).items.some((p) => p.id === prov[0]));
  await rechaza(planCap.proveedoresParaCotizar({ sub: 't', rol: 'tallerista' }), 403);
  const proveedoresSrv = await import('../src/servicios/proveedores.js');
  await rechazaCon(proveedoresSrv.eliminarProveedor(COORD, { id: prov[1] }), 409, /cotizaciones de planes de capitalización/);
  const jefeE8 = await entrar('jefe', 'Super-Segura-2026x');
  const tokenE8 = (await jefeE8.http('GET', '/api/auth/sesion')).json.token;
  const forma = new FormData();
  forma.append('contenedor', 'carritos');
  forma.append('id_unico', 'E8-A');
  forma.append('nombre', v.carrito.firma.soporte);
  forma.append('archivo', new Blob(['%PDF-1.4 otro'], { type: 'application/pdf' }), 'otro.pdf');
  assert.equal((await fetch(base + '/api/archivos', { method: 'POST', headers: { Cookie: jefeE8.http.cookie(), 'X-CSRF-Token': tokenE8 }, body: forma })).status, 409);

  await query("DELETE FROM carritos WHERE codigo_iniciativa = 'E8-A'");
  await query("DELETE FROM catalogo_productos WHERE id_origen = 'E8-MAQ'");
});

test('E8 reglas puras del plan: topes, plan de negocio, comparación de cotizaciones y huella', () => {
  assert.deepEqual(['M1', 'M2 - Asociativa', 'M3', 'M4 solidaria', ''].map(reglasPlan.topeDe), [5000000, 20000000, 30000000, 50000000, null]);
  assert.deepEqual(reglasPlan.faltantesPlanNegocio(null).length, 8); // con el plan de mercadeo (E12)
  assert.deepEqual(reglasPlan.faltantesPlanNegocio(reglasPlan.limpiarPlanNegocio(PLAN_COMPLETO)), []);
  assert.deepEqual(reglasPlan.limpiarPlanNegocio({ social: ['  ', 'Acción'], plan_accion: [{}, { accion: 'a' }] }).plan_accion, [{ accion: 'a', responsable: '', fecha: '' }]);
  const cots = [{ id: 1, id_proveedor: 1, valor_unitario: 10 }, { id: 2, id_proveedor: 2, valor_unitario: 10 }, { id: 3, id_proveedor: 3, valor_unitario: 12 }];
  assert.deepEqual(reglasPlan.compararCotizaciones(cots, 2).map((c) => [c.id, c.mas_barata, c.elegida]), [[1, true, false], [2, true, true], [3, false, false]]);
  assert.deepEqual(reglasPlan.faltasCotizacion({ cotizacion_elegida: 3 }, cots), ['la cotización elegida no es la más barata y no tiene justificación']);
  assert.deepEqual(reglasPlan.faltasCotizacion({ cotizacion_elegida: 2 }, cots), [], 'un empate con la más barata no pide justificación');
  const base = { carrito: { presupuesto_maximo: '100', plan_negocio: { a: 1 } }, lineas: [{ id: 1, id_producto: 2, cantidad: 1, precio: 5, iva: 0 }] };
  assert.equal(reglasPlan.huellaPlan(base), reglasPlan.huellaPlan(JSON.parse(JSON.stringify(base))));
  assert.notEqual(reglasPlan.huellaPlan(base), reglasPlan.huellaPlan({ ...base, lineas: [{ ...base.lineas[0], cantidad: 2 }] }));
});

// ============================================================
// E9 · FLUJO DE APROBACIÓN Y LEGALIZACIÓN (ET2-14, ET3-09, ET3-10, ET3-11, ET3-16, ET3-17, ET3-27, ET3-28,
// FUN-PLC-01, FUN-PLC-03, FUN-PLC-04)
// ============================================================
const diasHabiles = await import('../src/servicios/diasHabiles.js');
const entregaSrv = await import('../src/servicios/entregaBeneficiario.js');
const defectuososSrv = await import('../src/servicios/defectuosos.js');
const alistamientoSrv = await import('../src/servicios/alistamiento.js');
const retirosSrv = await import('../src/servicios/retiros.js');
const pedidosRutas = await import('../src/inventario/rutas/pedidos.js');

test('E9 flujo del plan: revisión, viabilidad, comité con subsanación, 80 %, fichas técnicas, compra y entrega', async () => {
  await upE4('E9-A', '8840001', 'M1 - Individual');
  const upId = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico = 'E9-A'")).rows[0].id_up;
  const { id_producto: horno } = await catalogo.guardarProducto(COORD, {
    codigo: 'E9-HORNO', nombre: 'Horno E9', precio: 1000000, iva: 0, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  const pdf = () => archivoTemporal('soporte.pdf', '%PDF-1.4 soporte');
  await carrito.ponerLinea(G1, { id_unico: 'E9-A', id_producto: horno, cantidad: 1 });
  await prepararEnvio(G1, 'E9-A');
  let v = await carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'enviado' });

  // ---- ET3-28: «viable», «aprobado» y «en_subsanacion» solo llegan por su acción ----
  await rechazaCon(carrito.cambiarEstado(COORD, { id_unico: 'E9-A', estado: 'aprobado' }), 400, /con su propia acción/);
  await rechaza(carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'viable' }), 403);

  // ---- ET3-09: viabilidad de la interventoría, sobre un plan revisado ----
  await rechazaCon(vistoBueno(COORD, 'E9-A'), 409, /sobre un plan revisado por la coordinación/);
  await evaluarActivos('E9-A');
  await carrito.cambiarEstado(COORD, { id_unico: 'E9-A', estado: 'revisado' });
  await rechaza(vistoBueno(G1, 'E9-A'), 403);
  await rechaza(vistoBueno(local({ region: 'región 2' }), 'E9-A'), 403);
  await rechazaCon(vistoBueno(LOCAL_R1, 'E9-A', { responsable: '' }), 400, /quién de la interventoría/);
  await rechazaCon(vistoBueno(LOCAL_R1, 'E9-A', { viable: 'no' }), 400, /Escribe las observaciones/);
  v = await vistoBueno(LOCAL_R1, 'E9-A', { viable: 'no', observaciones: 'Falta la cotización del transporte' });
  assert.equal(v.carrito.estado, 'devuelto');
  assert.deepEqual(v.carrito.historial.map((h) => h.a), ['enviado', 'revisado', 'devuelto']);
  assert.ok(v.carrito.historial.every((h) => h.por && h.en), 'cada cambio con quién y cuándo');
  assert.equal((await ultimaActividadCarrito('carrito.viabilidad')).cambios.viable, false);
  await carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'enviado' });
  await carrito.cambiarEstado(LOCAL_R1, { id_unico: 'E9-A', estado: 'revisado' });
  v = await vistoBueno(LOCAL_R1, 'E9-A');
  assert.deepEqual([v.carrito.estado, v.carrito.viabilidad.responsable, v.carrito.viabilidad.viable], ['viable', 'Interventoría de prueba', true]);

  // ---- ET3-10 y ET2-14: el comité (general), integrantes, calificaciones y el 80 % de formación ----
  await rechaza(flujoPlanSrv.registrarComite(LOCAL_R1, { fecha: diaColombia() }, await pdf()), 403);
  await rechazaCon(comite(['E9-A'], [4, 4, 4], { integrantes: JSON.stringify([INTEGRANTES[0], { nombre: 'Otro', entidad: 'INNPULSA' }, INTEGRANTES[2]]) }), 400, /2 de Prosperidad Social y 1 de INNPULSA/);
  await rechazaCon(comite(['E9-A'], [4, 6, 4]), 400, /califica el plan de 1 a 5/);
  await rechazaCon(comite(['E9-A'], [4, 4, 4], { fecha: '2999-01-01' }), 400, /fecha del comité no es válida/);
  await rechazaCon(comite(['E9-A']), 400, /no alcanza el 80 % de formación/);
  await formacionCompleta('E9-A');
  assert.equal((await flujoPlanSrv.planesParaComite(COORD)).items.find((p) => p.id_unico === 'E9-A').formacion.cumple, true);
  // Promedio 2,67: no aprobado → subsanación con 4 días hábiles (ET3-11).
  let r = await comite(['E9-A'], [3, 2, 3]);
  assert.deepEqual([r.item.planes[0].resultado, r.item.planes[0].promedio], ['no_aprobado', 2.67]);
  v = await carrito.detalleCarrito(G1, { id_unico: 'E9-A' });
  assert.deepEqual([v.carrito.estado, v.carrito.subsanacion.plazo, v.carrito.puede_editar], ['en_subsanacion', diasHabiles.sumarDiasHabiles(diaColombia(), 4), true]);
  await rechazaCon(comite(['E9-A']), 400, /no está listo para el comité/);
  // Vencida: nadie la cambia hasta que la coordinación la reabra.
  await query("UPDATE carritos SET subsanacion = jsonb_set(subsanacion, '{plazo}', '\"2000-01-03\"') WHERE codigo_iniciativa = 'E9-A'");
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: 'E9-A', id_producto: horno, cantidad: 2, modo: 'fijar' }), 409, /La subsanación venció el 2000-01-03/);
  await rechazaCon(carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'subsanado' }), 409, /venció/);
  await rechaza(flujoPlanSrv.reabrirSubsanacion(G1, { id_unico: 'E9-A', motivo: 'x' }), 403);
  await rechazaCon(flujoPlanSrv.reabrirSubsanacion(LOCAL_R1, { id_unico: 'E9-A' }), 400, /motivo/);
  v = await flujoPlanSrv.reabrirSubsanacion(LOCAL_R1, { id_unico: 'E9-A', motivo: 'La unidad estuvo incomunicada por el invierno' });
  assert.deepEqual([v.carrito.subsanacion.plazo, v.carrito.subsanacion.reaperturas.length], [diasHabiles.sumarDiasHabiles(diaColombia(), 4), 1]);
  // El gestor subsana: el plan cambia, se vuelve a firmar y se presenta a un nuevo comité.
  await planCap.guardarPlanNegocio(G1, { id_unico: 'E9-A', plan: { ...PLAN_COMPLETO, propuesta_valor: 'Pan artesanal con domicilio y venta por redes' } });
  await rechazaCon(carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'subsanado' }), 400, /El plan cambió después de firmado/);
  await firmarPlan(G1, 'E9-A');
  assert.equal((await carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'subsanado' })).carrito.estado, 'subsanado');
  r = await comite(['E9-A'], [3, 3, 4]);
  assert.equal(r.item.planes[0].resultado, 'aprobado');
  assert.equal((await ultimaActividadCarrito('carrito.comite')).id_unico, 'E9-A');
  // Las sesiones: el gestor ve las de sus unidades, otro nodo no; el acta igual.
  assert.equal((await flujoPlanSrv.listarComites(G1)).items.filter((c) => c.planes.some((p) => p.id_unico === 'E9-A')).length, 2);
  assert.equal((await flujoPlanSrv.listarComites(G2)).items.some((c) => c.planes.some((p) => p.id_unico === 'E9-A')), false);
  assert.equal((await flujoPlanSrv.actaComite(G1, { id: r.item.id })).buffer.subarray(0, 5).toString(), '%PDF-');
  await rechaza(flujoPlanSrv.actaComite(G2, { id: r.item.id }), 404);

  // ---- ET3-16 y ET2-14: fichas técnicas aprobadas y el 80 % para pasar a compra ----
  await rechaza(carrito.cambiarEstado(G1, { id_unico: 'E9-A', estado: 'en_compra' }), 403);
  await rechazaCon(carrito.cambiarEstado(COMPRAS, { id_unico: 'E9-A', estado: 'en_compra' }), 400, /ficha técnica aprobada por la interventoría de: «Horno E9»/);
  const linea = (await carrito.detalleCarrito(COMPRAS, { id_unico: 'E9-A' })).lineas[0].id;
  await rechaza(flujoPlanSrv.cargarFichaTecnica(G1, { id_unico: 'E9-A', id_linea: linea }, await pdf()), 403);
  const aprobarFicha = async () => flujoPlanSrv.aprobarFichaTecnica(COMPRAS, { id_unico: 'E9-A', id_linea: linea, fecha: diaColombia(), aprobada_por: 'Interventoría técnica' }, await pdf());
  await rechazaCon(aprobarFicha(), 409, /Carga primero la ficha técnica/);
  await flujoPlanSrv.cargarFichaTecnica(COMPRAS, { id_unico: 'E9-A', id_linea: linea }, await pdf());
  v = await aprobarFicha();
  assert.equal(v.lineas[0].ficha_tecnica.aprobacion.aprobada_por, 'Interventoría técnica');
  // Reemplazar la ficha quita su aprobación.
  v = await flujoPlanSrv.cargarFichaTecnica(COMPRAS, { id_unico: 'E9-A', id_linea: linea }, await pdf());
  assert.equal(v.lineas[0].ficha_tecnica.aprobacion, null);
  await aprobarFicha();
  v = await carrito.cambiarEstado(COMPRAS, { id_unico: 'E9-A', estado: 'en_compra' });
  assert.equal(v.carrito.estado, 'en_compra');
  assert.equal((await salidaE5.planYBienes({ query }, upId)).bienes.length, 1, 'en compra sigue siendo el plan aprobado');

  // ---- ET3-17, FUN-PLC-01 y FUN-PLC-04: factura de la U.P. con bienes nuevos y recepción contra la factura ----
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const token = (await jefe.http('GET', '/api/auth/sesion')).json.token;
  const bodega = (await query("INSERT INTO inventario.bodegas (nombre, tipo) VALUES ('Bodega principal E9', 'principal') RETURNING id")).rows[0].id;
  const prov = await proveedoresE8();
  const factura = async (extra) => {
    const fd = new FormData();
    fd.append('datos', JSON.stringify({ numero: `E9-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, proveedor_id: prov[1], fecha: diaColombia(),
      lineas: [{ nombre: 'Horno E9', sku: 'E9-SKU-HORNO', cantidad: 3, valor_unitario: 300000, valor_impuesto: 0, bodega_id: bodega }], ...extra }));
    const res = await fetch(`${base}/api/inv/facturas`, { method: 'POST', headers: { Cookie: jefe.http.cookie(), 'X-CSRF-Token': token }, body: fd });
    return { status: res.status, json: await res.json() };
  };
  assert.match((await factura({ capitalizacion: true, bienes_nuevos: true })).json.error, /necesita la unidad productiva/);
  assert.match((await factura({ capitalizacion: true, id_unico: '3', bienes_nuevos: true })).json.error, /no tiene un plan de capitalización aprobado por el comité/);
  assert.match((await factura({ capitalizacion: true, id_unico: 'E9-A' })).json.error, /Declara que los bienes/);
  const stock = async () => (await query("SELECT COALESCE(sum(stock), 0)::int AS n FROM inventario.articulos WHERE codigo_proveedor = 'E9-SKU-HORNO'")).rows[0].n;
  const antes = await stock();
  const alta = await factura({ capitalizacion: true, id_unico: 'E9-A', bienes_nuevos: true, entrega_pendiente: true });
  assert.equal(alta.status, 200, JSON.stringify(alta.json));
  assert.match(alta.json.mensaje, /pendiente de entrega del proveedor/);
  assert.equal(await stock(), antes, 'pendiente de entrega: aún no suma al stock');
  assert.equal((await ultimaActividadCarrito('factura.capitalizacion')).id_unico, 'E9-A');
  const porRecibir = (await jefe.http('GET', '/api/inv/facturas-por-recibir')).json.facturas.find((x) => x.id === alta.json.id);
  assert.equal(porRecibir.estado_entrega, 'pendiente');
  const recibir = (cantidad) => jefe.http('POST', `/api/inv/facturas/${alta.json.id}/recepcion`, { lineas: [{ item_id: porRecibir.items[0].id, cantidad }] });
  assert.equal((await recibir(2)).status, 200);
  assert.equal((await recibir(2)).status, 409, 'no se recibe más de lo facturado');
  let det = (await jefe.http('GET', `/api/inv/facturas/${alta.json.id}`)).json;
  assert.deepEqual([det.factura.estado_entrega, det.factura.id_unico, det.factura.bienes_nuevos, det.recepciones.length], ['parcial', 'E9-A', true, 1]);
  await recibir(1);
  det = (await jefe.http('GET', `/api/inv/facturas/${alta.json.id}`)).json;
  assert.equal(det.factura.estado_entrega, 'entregada');
  assert.equal(await stock(), antes + 3);
  assert.equal((await ultimaActividadCarrito('factura.recepcion')).id_unico, 'E9-A');

  // ---- ET3-27: legalización por U.P. frente al plan aprobado ----
  const leg = (await flujoPlanSrv.legalizacion(COORD)).items.find((x) => x.id_unico === 'E9-A');
  assert.deepEqual([leg.total_plan, leg.total_facturado, leg.diferencia, leg.porcentaje, leg.facturas.length], [1000000, 900000, -100000, 90, 1]);
  assert.equal((await flujoPlanSrv.legalizacion(G2)).items.some((x) => x.id_unico === 'E9-A'), false);

  // ---- FUN-PLC-03: el lote de pedido frente al plan aprobado ----
  const alertas = await pedidosRutas.alertasContraPlan({ num_documento: '8840001', items: [
    { codigo: 'E9-HORNO', nombre: 'Horno E9', cantidad: 2, precio: 1000000 }, { codigo: 'X-1', nombre: 'Otra cosa', cantidad: 1, precio: 5 }] });
  assert.deepEqual(alertas, ['«Otra cosa» no está en el plan aprobado de E9-A.', '«Horno E9»: el lote pide 2 y el plan aprobado tiene 1.']);
  // El mismo producto en dos filas se compara sumado (revisión E9).
  assert.deepEqual(await pedidosRutas.alertasContraPlan({ num_documento: '8840001', items: [
    { codigo: 'E9-HORNO', nombre: 'Horno E9', cantidad: 1, precio: 1000000 }, { codigo: 'E9-HORNO', nombre: 'Horno E9', cantidad: 1, precio: 1000000 }] }),
  ['«Horno E9»: el lote pide 2 y el plan aprobado tiene 1.']);
  assert.match((await pedidosRutas.alertasContraPlan({ num_documento: '0000', items: [] }))[0], /no corresponde a una unidad productiva/);

  // ---- Entrega (E10: con las recomendaciones de uso y el acta de recibido de facturas y garantías) ----
  await rechazaCon(carrito.cambiarEstado(COMPRAS, { id_unico: 'E9-A', estado: 'entregado' }), 400, /recomendaciones de uso/);
  await entregaSrv.cargarRecomendaciones(G1, { id_unico: 'E9-A' }, await pdf());
  await entregaSrv.registrarActaRecibido(G1, { id_unico: 'E9-A', fecha: diaColombia(), recibe_nombre: 'Rep Diagnóstico', recibe_documento: '8840001',
    garantias: 'Garantía del horno por 12 meses', facturas: JSON.stringify([alta.json.id]) }, await pdf());
  v = await carrito.cambiarEstado(COMPRAS, { id_unico: 'E9-A', estado: 'entregado' });
  assert.equal(v.carrito.estado, 'entregado');
  assert.deepEqual(v.carrito.historial.slice(-2).map((h) => h.a), ['en_compra', 'entregado']);
  await borrarFormacionDePrueba();
});

test('E9 días hábiles de Colombia (festivos de la Ley Emiliani y de la Pascua)', () => {
  const f = diasHabiles.festivosColombia(2026);
  for (const d of ['2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
    '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08']) assert.ok(f.has(d), d);
  assert.equal(f.size, 18);
  assert.equal(diasHabiles.sumarDiasHabiles('2026-10-09', 4), '2026-10-16', 'el 12 de octubre es festivo');
  assert.equal(diasHabiles.sumarDiasHabiles('2026-04-01', 4), '2026-04-09', 'Semana Santa');
  assert.deepEqual(flujoPlanSrv.calificar([3, 3, 3]), { calificaciones: [3, 3, 3], promedio: 3, resultado: 'aprobado' });
  assert.equal(flujoPlanSrv.calificar([3, 3, 2]).resultado, 'no_aprobado');
});

// ---------------- E10 · Entregas completas ----------------
const TECNICO_R1 = { ...local({ region: 'región 1' }), sub: 'tecnico:1', rol: 'tecnico_administrativo', nombre: 'Técnico' };
test('E10 entrega al beneficiario: recomendaciones de uso y acta de recibido de facturas y garantías exigidas para «entregado»', async () => {
  await upE4('E10-A', '8850001', 'M1 - Individual');
  const { id_producto: horno } = await catalogo.guardarProducto(COORD, {
    codigo: 'E10-HORNO', nombre: 'Horno E10', precio: 500000, iva: 0, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await carrito.ponerLinea(G1, { id_unico: 'E10-A', id_producto: horno, cantidad: 1 });
  const pdf = () => archivoTemporal('soporte.pdf', '%PDF-1.4 soporte');
  // Antes de estar en compra no se registra la entrega (el ciclo hasta «en compra» lo prueba E9).
  await rechazaCon(entregaSrv.cargarRecomendaciones(G1, { id_unico: 'E10-A' }, await pdf()), 409, /con el plan en compra/);
  await query("UPDATE carritos SET estado = 'en_compra' WHERE codigo_iniciativa = 'E10-A'");
  await rechazaCon(carrito.cambiarEstado(COMPRAS, { id_unico: 'E10-A', estado: 'entregado' }), 400,
    /Falta el documento de recomendaciones de uso.*Falta el acta de recibido/);

  // ET3-23: recomendaciones de uso (gestor del nodo o coordinación; PDF real).
  await rechaza(entregaSrv.cargarRecomendaciones(COMPRAS, { id_unico: 'E10-A' }, await pdf()), 403);
  await rechaza(entregaSrv.cargarRecomendaciones(G2, { id_unico: 'E10-A' }, await pdf()), 403);
  await rechaza(entregaSrv.cargarRecomendaciones(local({ region: 'región 2' }), { id_unico: 'E10-A' }, await pdf()), 403);
  await rechazaCon(entregaSrv.cargarRecomendaciones(G1, { id_unico: 'E10-A' }, await archivoTemporal('r.pdf', 'no es un pdf', 'application/pdf', { crudo: true })), 400, /PDF válido/);
  let v = await entregaSrv.cargarRecomendaciones(G1, { id_unico: 'E10-A' }, await pdf());
  assert.match(v.carrito.entrega_beneficiario.recomendaciones.soporte_url, /\/archivos\/carritos\/E10-A\/entrega\/.*_RECOMENDACIONES\.pdf$/);
  assert.equal(v.carrito.faltas_entrega.length, 1);
  assert.equal(v.carrito.puede_entrega_beneficiario, true);
  assert.equal((await ultimaActividadCarrito('carrito.recomendaciones')).id_unico, 'E10-A');

  // ET3-25 y NOV-03: acta de recibido con las facturas de capitalización de la U.P.
  const prov = await proveedoresE8();
  const { rows: [f1] } = await query(`INSERT INTO inventario.facturas (numero, proveedor_id, total, id_unico, bienes_nuevos)
    VALUES ('E10-F1', $1, 500000, 'E10-A', TRUE) RETURNING id`, [prov[2]]);
  const ajena = (await query("SELECT id FROM inventario.facturas WHERE id_unico = 'E9-A' LIMIT 1")).rows[0].id;
  v = await carrito.detalleCarrito(G1, { id_unico: 'E10-A' });
  assert.deepEqual(v.carrito.facturas_up.map((x) => x.numero), ['E10-F1']);
  const acta = async (extra = {}, u = G1) => entregaSrv.registrarActaRecibido(u, { id_unico: 'E10-A', fecha: diaColombia(), recibe_nombre: 'Rep Diagnóstico',
    recibe_documento: '8.850.001', garantias: 'Garantía del horno por 12 meses (certificado del fabricante)', facturas: JSON.stringify([f1.id]), ...extra }, await pdf());
  await rechazaCon(acta({ facturas: '[]' }), 400, /Marca las facturas/);
  await rechazaCon(acta({ facturas: JSON.stringify([f1.id, ajena]) }), 400, /no es una factura de capitalización de esta unidad/);
  await rechazaCon(acta({ garantias: ' ' }), 400, /soportes de garantía/);
  await rechazaCon(acta({ recibe_nombre: '' }), 400, /quien recibe/);
  await rechazaCon(acta({ recibe_documento: '12' }), 400, /documento de quien recibe/);
  await rechazaCon(acta({ fecha: '2999-01-01' }), 400, /no puede ser futura/);
  await rechaza(acta({}, TECNICO_R1), 403);
  v = await acta();
  const a = v.carrito.entrega_beneficiario.acta_recibido;
  assert.deepEqual([a.recibe_documento, a.facturas.map((x) => x.numero), a.registrada_por], ['8850001', ['E10-F1'], 'Gestora 1']);
  assert.deepEqual(v.carrito.faltas_entrega, []);
  assert.deepEqual((await ultimaActividadCarrito('carrito.acta_recibido')).cambios.facturas, 1);

  // Con ambos, compras marca la entrega; después ya no se cambian.
  await rechaza(carrito.cambiarEstado(G1, { id_unico: 'E10-A', estado: 'entregado' }), 403);
  v = await carrito.cambiarEstado(COMPRAS, { id_unico: 'E10-A', estado: 'entregado' });
  assert.equal(v.carrito.estado, 'entregado');
  assert.equal(v.carrito.puede_entrega_beneficiario, false);
  await rechazaCon(entregaSrv.cargarRecomendaciones(G1, { id_unico: 'E10-A' }, await pdf()), 409, /está entregado/);
});

test('E10 instalación y puesta en marcha por entrega de kit; acta de elementos defectuosos con reporte al CLR, devolución y reemplazo', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const bod = await entrar('entregas.kits', 'Bodeguero-Kits-2026');
  // El bodeguero de la otra municipal (la prueba de kits lo dejó en la misma bodega: se devuelve a la suya).
  await query(`UPDATE inventario.usuarios SET bodega_id = (SELECT id FROM inventario.bodegas WHERE nombre = 'Kits municipal 2')
    WHERE usuario = 'entregas.kits2'`);
  const otro = await entrar('entregas.kits2', 'Bodeguero-Kits-2026');
  const sinBodega = await entrar('bodega', 'Bodega-Segura-2026');
  const multipart = async (s, ruta, campos, archivo) => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const form = new FormData();
    for (const [k, val] of Object.entries(campos)) if (val !== null && val !== undefined) form.append(k, String(val));
    if (archivo) form.append(archivo.campo, new Blob([archivo.contenido]), archivo.nombre);
    const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: form });
    return { status: r.status, json: await r.json() };
  };
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(20, 7)]);
  const hoy = diaColombia();
  const ayer = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() - 86400000));

  // ---- ET3-21: instalación, puesta en marcha y capacitación de la entrega del kit (bodega de la entrega) ----
  const eid = (await query(`SELECT e.id FROM inventario.entregas_kits e JOIN inventario.combos c ON c.id = e.combo_id
    WHERE c.nombre = 'UP entrega kits 1'`)).rows[0].id;
  const ruta = `/api/inv/entregas-kits/${eid}/instalacion`;
  const completa = { aplica: 'si', fecha_instalacion: hoy, fecha_puesta_marcha: hoy, capacitacion: 'si', capacitacion_fecha: hoy,
    capacitacion_por: 'Técnico del proveedor', capacitacion_recibe: 'Representante de la U.P.', observaciones: 'Quedó funcionando' };
  const soporte = { campo: 'soporte', contenido: png, nombre: 'instalacion.png' };
  assert.match((await multipart(bod, ruta, completa)).json.error, /Adjunta el soporte de la instalación/);
  assert.match((await multipart(bod, ruta, { ...completa, aplica: 'tal vez' }, soporte)).json.error, /aplica la instalación/);
  assert.match((await multipart(bod, ruta, { ...completa, capacitacion_por: '' }, soporte)).json.error, /quién dio la capacitación/);
  assert.match((await multipart(bod, ruta, { ...completa, fecha_instalacion: '2999-01-01' }, soporte)).json.error, /no puede ser futura/);
  assert.match((await multipart(bod, ruta, { ...completa, fecha_instalacion: ayer }, soporte)).json.error, /no puede ser anterior/, 'antes de la entrega');
  assert.match((await multipart(bod, ruta, { ...completa, fecha_puesta_marcha: ayer }, soporte)).json.error, /puesta en marcha no puede ser anterior/);
  assert.match((await multipart(bod, ruta, completa, { ...soporte, contenido: 'no es imagen' })).json.error, /PDF, JPG o PNG/);
  assert.equal((await multipart(otro, ruta, completa, soporte)).status, 404, 'otra bodega municipal no la ve');
  assert.equal((await multipart(sinBodega, ruta, completa, soporte)).status, 403, 'bodeguero sin bodega asignada');
  const ok1 = await multipart(bod, ruta, completa, soporte);
  assert.equal(ok1.status, 200, JSON.stringify(ok1.json));
  let e = (await bod.http('GET', '/api/inv/entregas-kits')).json.entregas.find((x) => x.id === eid);
  assert.deepEqual([e.instalacion.aplica, e.instalacion.capacitacion_por, e.instalacion_con_soporte], [true, 'Técnico del proveedor', true]);
  const verSoporte = (s) => fetch(`${base}/api/inv/entregas-kits/${eid}/instalacion/soporte`, { headers: { Cookie: s.http.cookie() } });
  assert.equal((await verSoporte(bod)).status, 200);
  assert.equal((await verSoporte(otro)).status, 404);
  // Corregir sin soporte nuevo conserva el anterior; «no aplica» lo quita.
  assert.equal((await multipart(bod, ruta, { ...completa, capacitacion: 'no' })).status, 200);
  e = (await bod.http('GET', '/api/inv/entregas-kits')).json.entregas.find((x) => x.id === eid);
  assert.deepEqual([e.instalacion.capacitacion, e.instalacion.capacitacion_por, e.instalacion_con_soporte], [false, undefined, true]);
  assert.equal((await multipart(bod, ruta, { aplica: 'no', observaciones: 'El kit no requiere instalación' })).status, 200);
  assert.equal((await verSoporte(bod)).status, 404);
  assert.equal((await ultimaActividadCarrito('kit.instalacion')).cambios.aplica, false);

  // ---- ET3-26 y NOV-02: acta de elementos defectuosos de un kit de la U.P. E10-A ----
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, correo, region) VALUES
    ('C-E10-1', 'coordinador', 'clr.e10.r1', 'x', 'CLR región 1', 'clr.r1@x.co', 'Región 1'),
    ('C-E10-2', 'coordinador', 'clr.e10.r2', 'x', 'CLR región 2', 'clr.r2@x.co', 'Región 2')`);
  const art = (await query('SELECT id, nombre FROM inventario.articulos WHERE activo ORDER BY id LIMIT 1')).rows[0];
  const kit = (await jefe.http('POST', '/api/inv/kits', { nombre: 'E10-A', items: [{ articulo_id: art.id, cantidad: 2 }] })).json.id;
  const novedad = (tipo = 'danado') => multipart(bod, '/api/inv/kits/novedades',
    { kit_id: kit, tipo, texto: 'Llegó con la puerta rota', articulos: JSON.stringify([{ articulo_id: art.id, cantidad: 1 }]) },
    { campo: `foto_${art.id}`, contenido: png, nombre: 'foto.png' });
  const n1 = await novedad();
  assert.equal(n1.status, 200, JSON.stringify(n1.json));
  assert.match(n1.json.mensaje, /Acta de elementos defectuosos/);
  const correo = (await query("SELECT para, asunto FROM correos_salida WHERE origen = 'kit_defectuoso' AND referencia = $1", [String(n1.json.id)])).rows;
  assert.deepEqual(correo.map((c) => c.para), [['clr.r1@x.co']], 'avisa solo al Coordinador local regional del territorio de la U.P.');
  assert.match(correo[0].asunto, /E10-A/);
  assert.equal((await ultimaActividadCarrito('kit_defectuoso.reportar')).id_unico, 'E10-A');
  const nOtro = await novedad('otro');
  assert.equal((await query("SELECT count(*)::int AS n FROM correos_salida WHERE origen = 'kit_defectuoso' AND referencia = $1", [String(nOtro.json.id)])).rows[0].n, 0);

  // Bitácora: el Coordinador local regional ve las de su territorio y da por recibido el reporte.
  const deR1 = (await defectuososSrv.listarDefectuosos(LOCAL_R1)).items;
  assert.deepEqual(deR1.filter((x) => x.id_unico === 'E10-A').map((x) => [x.id, x.estado, x.puede_recibir]), [[n1.json.id, 'reportada', true]], 'la de tipo «otro» no es un acta');
  assert.equal((await defectuososSrv.listarDefectuosos(local({ region: 'región 2' }))).items.some((x) => x.id === n1.json.id), false);
  await rechaza(defectuososSrv.listarDefectuosos(G1), 403);
  assert.equal((await defectuososSrv.listarDefectuosos(COMPRAS)).items.some((x) => x.id === n1.json.id), true);
  assert.equal((await defectuososSrv.listarDefectuosos(TECNICO_R1)).items[0].puede_recibir, false);
  await rechaza(defectuososSrv.marcarRecibido(TECNICO_R1, { id: n1.json.id }), 403);
  await rechaza(defectuososSrv.marcarRecibido(local({ region: 'región 2' }), { id: n1.json.id }), 404);
  const recibido = await defectuososSrv.marcarRecibido(LOCAL_R1, { id: n1.json.id });
  assert.equal(recibido.item.reporte.por, 'Local');
  await rechazaCon(defectuososSrv.marcarRecibido(LOCAL_R1, { id: n1.json.id }), 409, /ya se dio por recibido/);
  const pdfBit = await defectuososSrv.actaDefectuoso(LOCAL_R1, { id: n1.json.id });
  assert.equal(pdfBit.buffer.subarray(0, 5).toString(), '%PDF-');
  await rechaza(defectuososSrv.actaDefectuoso(local({ region: 'región 2' }), { id: n1.json.id }), 404);
  const porHttp = await (await entrar('coordinacion', 'Otra-Clave-Larga-77')).http('GET', '/api/entregas/defectuosos');
  assert.equal(porHttp.status, 200);

  // Inventario: devolución al proveedor y reemplazo (sin mover stock).
  const stockAntes = (await query('SELECT stock FROM inventario.articulos WHERE id = $1', [art.id])).rows[0].stock;
  const prov = await proveedoresE8();
  const devolver = (id, datos) => bod.http('POST', `/api/inv/kits/novedades/${id}/devolucion`, { proveedor_id: prov[0], fecha: hoy, guia: 'GUIA-001', ...datos });
  const reemplazar = (id, campos, archivo = { campo: 'soporte', contenido: '%PDF-1.4 reemplazo', nombre: 'reemplazo.pdf' }) =>
    multipart(bod, `/api/inv/kits/novedades/${id}/reemplazo`, { fecha: hoy, nota: 'El proveedor entregó uno nuevo', ...campos }, archivo);
  assert.equal((await reemplazar(n1.json.id)).status, 409, 'primero la devolución');
  assert.equal((await devolver(n1.json.id, { proveedor_id: null })).status, 400);
  assert.equal((await devolver(n1.json.id, { proveedor_id: 999999 })).status, 404);
  assert.match((await devolver(n1.json.id, { fecha: '2999-01-01' })).json.error, /no puede ser futura/);
  assert.equal((await devolver(nOtro.json.id)).status, 404, 'una novedad «otro» no es un acta');
  assert.equal((await sinBodega.http('POST', `/api/inv/kits/novedades/${n1.json.id}/devolucion`, { proveedor_id: prov[0], fecha: hoy })).status, 403,
    'el bodeguero sin bodega asignada no mueve el acta (revisión E10)');
  assert.equal((await jefe.http('DELETE', `/api/inv/kits/${kit}`)).status, 409, 'un kit con actas no se elimina (revisión E10)');
  assert.equal((await devolver(n1.json.id)).status, 200);
  assert.equal((await devolver(n1.json.id)).status, 409);
  assert.equal((await reemplazar(n1.json.id, {}, null)).status, 400, 'sin soporte');
  assert.equal((await reemplazar(n1.json.id, {}, { campo: 'soporte', contenido: 'falso', nombre: 'x.pdf' })).status, 400);
  const rz = await reemplazar(n1.json.id);
  assert.equal(rz.status, 200, JSON.stringify(rz.json));
  assert.equal((await reemplazar(n1.json.id)).status, 409);
  const lista = (await bod.http('GET', `/api/inv/kits/${kit}/novedades`)).json;
  const acta = lista.novedades.find((x) => x.id === n1.json.id);
  assert.deepEqual([acta.estado, acta.devolucion.guia, acta.reemplazo.fecha, acta.reporte.por, acta.id_unico], ['reemplazada', 'GUIA-001', hoy, 'Local', 'E10-A']);
  assert.ok(lista.proveedores.some((p) => p.id === prov[0]));
  assert.equal((await query('SELECT stock FROM inventario.articulos WHERE id = $1', [art.id])).rows[0].stock, stockAntes, 'el acta no mueve stock');
  const pdfInv = await fetch(`${base}/api/inv/kits/${kit}/novedades/${n1.json.id}/acta`, { headers: { Cookie: bod.http.cookie() } });
  assert.equal(Buffer.from(await pdfInv.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(`${base}/api/inv/kits/999999/novedades/${n1.json.id}/acta`, { headers: { Cookie: bod.http.cookie() } })).status, 404);
  assert.equal((await fetch(`${base}/api/inv/kits/${kit}/novedades/${n1.json.id}/reemplazo/soporte`, { headers: { Cookie: bod.http.cookie() } })).status, 200);
  assert.deepEqual((await ultimaActividadCarrito('kit_defectuoso.reemplazo')).cambios.campos.estado, ['devuelta', 'reemplazada']);
  assert.deepEqual((await ultimaActividadCarrito('kit_defectuoso.devolucion')).cambios.campos.estado, ['reportada', 'devuelta']);
  assert.equal((await defectuososSrv.listarDefectuosos(LOCAL_R1, { estado: 'reemplazada' })).items.some((x) => x.id === n1.json.id), true);
  assert.equal((await defectuososSrv.listarDefectuosos(LOCAL_R1, { estado: 'reportada' })).items.some((x) => x.id === n1.json.id), false);
});

// ---------------- E11 · Alistamiento, retiros y cierre ----------------
test('E11 retiro y reemplazo de unidades: 9 causales, acta, ticket que se resuelve, personal que sale, concepto del Comité, persona que entra 1 a 1 y bloqueo tras el diagnóstico', async () => {
  for (const [u, doc] of [['E11-A', '8860001'], ['E11-B', '8860002'], ['E11-C', '8860003'], ['E11-D', '8860004'], ['E11-E', '8860005']]) await upE4(u, doc, 'M1 - Individual');
  await query("UPDATE unidades_productivas SET habilitada = TRUE WHERE id_unico IN ('E11-A', 'E11-B', 'E11-D')");
  // Elegibles: marcadas como no habilitadas y sin operación (una sin dato, NULL, cuenta como del programa).
  await query("UPDATE unidades_productivas SET habilitada = FALSE WHERE id_unico IN ('E11-C', 'E11-E')");
  await upE4('E11-F', '8860006', 'M1 - Individual');
  const idF = (await query("UPDATE unidades_productivas SET habilitada = FALSE WHERE id_unico = 'E11-F' RETURNING id_up")).rows[0].id_up;
  await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, tipo_visita, cerrada, documento) VALUES ('8860006_v1', $1, 'E11-F', '8860006', 'v1', TRUE, '{}')`, [idF]);
  const acta = async () => ({ acta: [await archivoTemporal('acta-retiro.pdf', '%PDF-1.4 acta de retiro')] });
  const ticketsE11 = await import('../src/servicios/tickets.js');
  // Cada registro resuelve un ticket de su etapa: lo radica el gestor y lo atiende la coordinación local.
  const ticket = async (etapa, extra = {}) => (await ticketsE11.crearTicket(G1, { titulo: `E11 ${etapa}`, descripcion: 'Solicitud de prueba', etapa, ...extra })).item;
  const estadoTicket = async (id) => (await ticketsE11.listarTickets(LOCAL_R1, {})).items.find((x) => x.id === id).estado;
  const tkRetiro = await ticket('retiro');
  // El personal activo de las unidades (up_asociados): de ahí se elige quién sale. E11-D queda sin personal registrado.
  const personal = async (u, filas) => {
    const { id_up: idUp } = (await query('SELECT id_up FROM unidades_productivas WHERE id_unico = $1', [u])).rows[0];
    const ids = [];
    for (const [nombre, documento, representante] of filas) {
      ids.push((await query("INSERT INTO up_asociados (id_up, nombre, documento, telefono, sexo, es_representante) VALUES ($1, $2, $3, '3001112233', 'mujer', $4) RETURNING id",
        [idUp, nombre, documento, representante])).rows[0].id);
    }
    return ids;
  };
  const personalA = await personal('E11-A', [['Ana Torres Ruiz', '7700001', true], ['Luis Mora Peña', '7700002', false]]);
  const personalB = await personal('E11-B', [['Marta Díaz Soto', '7700003', true]]);
  const [retirado] = await personal('E11-A', [['Pedro Viejo Gil', '7700004', false]]);
  await query('UPDATE up_asociados SET activo = FALSE WHERE id = $1', [retirado]);
  const retiro = (u, campos, archivos) => retirosSrv.registrarRetiro(u, { id_unico: 'E11-A', causal: 'retiro_voluntario', observaciones: 'Se muda de ciudad', id_ticket: tkRetiro.id,
    personal_sale: JSON.stringify(personalA), ...campos }, archivos);

  // ---- Etapas de ticket nuevas: Retiro y Reemplazo ----
  assert.equal(ticketsE11.ETAPAS.retiro, 'Retiro');
  assert.equal(ticketsE11.ETAPAS.reemplazo, 'Reemplazo');
  assert.deepEqual((await ticketsE11.listarTickets(LOCAL_R1, { etapa: 'retiro' })).items.map((x) => x.nombre_etapa), ['Retiro']);

  // ---- ET1-27 y NOV-01: retiro con causal, acta y ticket ----
  assert.equal(Object.keys(retirosSrv.CAUSALES).length, 9);
  await rechaza(retiro(G1, {}, await acta()), 403);
  await rechaza(retiro(TECNICO_R1, {}, await acta()), 403);
  await rechaza(retiro(local({ region: 'región 2' }), {}, await acta()), 403);
  await rechazaCon(retiro(LOCAL_R1, { causal: 'otra' }, await acta()), 400, /9 causales/);
  await rechazaCon(retiro(LOCAL_R1, {}, {}), 400, /Adjunta el acta de retiro/);
  await rechazaCon(retiro(LOCAL_R1, {}, { acta: [await archivoTemporal('acta.pdf', 'texto', 'application/pdf', { crudo: true })] }), 400, /PDF válido/);
  // El ticket es obligatorio, de la etapa Retiro, de la misma unidad y sin respuesta.
  await rechazaCon(retiro(LOCAL_R1, { id_ticket: '' }, await acta()), 400, /Elige el ticket de la etapa «Retiro»/);
  await rechazaCon(retiro(LOCAL_R1, { id_ticket: 999999 }, await acta()), 400, /no existe o está fuera de tu alcance/);
  const tkOtraEtapa = await ticket('reemplazo');
  await rechazaCon(retiro(LOCAL_R1, { id_ticket: tkOtraEtapa.id }, await acta()), 400, /es de la etapa «Reemplazo»: elige uno de la etapa «Retiro»/);
  const tkOtraUnidad = await ticket('retiro', { id_unico: 'E11-B' });
  await rechazaCon(retiro(LOCAL_R1, { id_ticket: tkOtraUnidad.id }, await acta()), 400, /es de la unidad E11-B, no de la E11-A/);
  // El personal que sale: hay que elegir del personal activo de ESA unidad.
  await rechazaCon(retiro(LOCAL_R1, { personal_sale: '' }, await acta()), 400, /Elige el personal de la unidad que sale/);
  await rechazaCon(retiro(LOCAL_R1, { personal_sale: '[]' }, await acta()), 400, /Elige el personal de la unidad que sale/);
  await rechazaCon(retiro(LOCAL_R1, { personal_sale: JSON.stringify(['abc']) }, await acta()), 400, /selección del personal que sale no es válida/);
  await rechazaCon(retiro(LOCAL_R1, { personal_sale: JSON.stringify(personalB) }, await acta()), 400, /no es del personal activo de la unidad E11-A/);
  await rechazaCon(retiro(LOCAL_R1, { personal_sale: JSON.stringify([retirado]) }, await acta()), 400, /no es del personal activo/);
  assert.ok(!(await query("SELECT retirada_dps FROM unidades_productivas WHERE id_unico = 'E11-A'")).rows[0].retirada_dps, 'ningún intento fallido retira la unidad');
  let r = await retiro(LOCAL_R1, {}, await acta());
  assert.equal(r.item.nombre_causal, 'Retiro voluntario');
  assert.deepEqual([r.item.ticket.id, r.item.ticket.resuelto], [tkRetiro.id, true]);
  assert.equal(await estadoTicket(tkRetiro.id), 'respondido', 'el ticket queda respondido con la nota del registro');
  const movRetiro = (await ticketsE11.listarTickets(LOCAL_R1, { etapa: 'retiro' })).items.find((x) => x.id === tkRetiro.id).historial.at(-1);
  assert.match(movRetiro.nota, /Retiro registrado: unidad E11-A.*Retiro voluntario.*Sale: Ana Torres Ruiz \(7700001\), Luis Mora Peña \(7700002\)/);
  assert.deepEqual(movRetiro.personal_sale, [{ nombre: 'Ana Torres Ruiz', documento: '7700001' }, { nombre: 'Luis Mora Peña', documento: '7700002' }], 'el personal queda asignado al ticket');
  assert.deepEqual((await query('SELECT personal_sale FROM up_retiros WHERE id = $1', [r.item.id])).rows[0].personal_sale.map((p) => p.id), personalA);
  assert.deepEqual((await ultimaActividadCarrito('up.retiro')).cambios.sale, ['Ana Torres Ruiz', 'Luis Mora Peña']);
  const fila = (u) => query('SELECT habilitada, retirada_dps, novedad_tipo FROM unidades_productivas WHERE id_unico = $1', [u]).then((x) => x.rows[0]);
  assert.deepEqual(await fila('E11-A'), { habilitada: false, retirada_dps: true, novedad_tipo: 'Retiro voluntario' });
  // El personal que sale deja de estar activo (sale de la lista de asociados) y queda en «Retirados» con la causal.
  const salieron = (await query('SELECT activo, es_representante, fecha_retiro IS NOT NULL AS con_fecha, motivo_retiro FROM up_asociados WHERE id = ANY($1::int[]) ORDER BY id', [personalA])).rows;
  assert.deepEqual(salieron, personalA.map(() => ({ activo: false, es_representante: false, con_fecha: true, motivo_retiro: 'Retiro de la unidad: Retiro voluntario' })));
  assert.equal((await query('SELECT count(*)::int AS n FROM up_asociados WHERE id = ANY($1::int[]) AND activo', [personalB])).rows[0].n, 1, 'el personal de otra unidad no se toca');
  // Un ticket respondido no se reutiliza; y una unidad ya retirada no se retira otra vez (el ticket sigue abierto).
  await rechazaCon(retiro(LOCAL_R1, {}, await acta()), 409, /ya tiene respuesta/);
  const tkRetiro2 = await ticket('retiro');
  await rechazaCon(retiro(LOCAL_R1, { id_ticket: tkRetiro2.id }, await acta()), 409, /ya está retirada/);
  assert.equal(await estadoTicket(tkRetiro2.id), 'abierto');
  assert.deepEqual((await ultimaActividadCarrito('up.retiro')).cambios.campos.habilitada, [true, false]);
  assert.equal((await unidades.obtenerUnidad(COORD, { id: 'E11-A' })).item.retiro.nombre_causal, 'Retiro voluntario');
  assert.equal((await unidades.obtenerUnidad(COORD, { id: 'E11-A' })).item.retiro.ticket, tkRetiro.consecutivo);
  assert.equal((await unidades.listarUnidades(G1)).items.find((x) => x.id_unico === 'E11-A').up_habilitada, false);
  // La unidad retirada sale de la operación: ni citas ni plan (revisión E11).
  const prod = await catalogo.guardarProducto(COORD, { codigo: 'E11-HORNO', nombre: 'Horno E11', precio: 900000, iva: 0, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await rechazaCon(carrito.ponerLinea(G1, { id_unico: 'E11-A', id_producto: prod.id_producto, cantidad: 1 }), 409, /retirada del programa \(Retiro voluntario\)/);
  await rechazaCon(agenda.guardarCita(G1, { id_unico: 'E11-A', titulo: 'Seguimiento', inicio: `${diaColombia()}T15:00:00Z`, fin: `${diaColombia()}T16:00:00Z` }), 409, /retirada del programa/);
  // La ficha ya no retira sin causal ni acta.
  await rechazaCon(fichaUP.editarUnidad(COORD, { id_unico: 'E11-B', datos_up: { retirada_dps: true } }), 400, /no se puede editar/);
  await rechazaCon(retirosSrv.registrarRetiro(LOCAL_R1, { id_unico: 'E11-B', causal: 'fallecimiento', id_ticket: tkRetiro2.id, personal_sale: JSON.stringify(personalB) }, { acta: [await archivoTemporal('grande.pdf', Buffer.alloc(15 * 1024 * 1024 + 10))] }), 413, /supera los 15 MB/);

  // ---- ET1-26 y NOV-01: reemplazo 1 a 1 (sale la unidad, entra una persona) con concepto del Comité y ticket ----
  const hoy = diaColombia();
  const tkReemplazo = await ticket('reemplazo');
  const entra = { nombre: 'Rosa Elena Gómez', documento: '52123456', telefono: '3001234567', sexo: 'mujer', tipo: 'directo', fecha_nacimiento: '1990-05-01', zona: 'urbana' };
  const reemplazo = (u, campos, archivos) => retirosSrv.registrarReemplazo(u, { id_unico: 'E11-B', causal: 'informacion_falsa', comite_fecha: hoy,
    comite_concepto: 'El Comité Técnico aprueba el reemplazo por la persona que entra.', persona_entra: JSON.stringify(entra), id_ticket: tkReemplazo.id,
    personal_sale: JSON.stringify(personalB), ...campos }, archivos);
  const dos = async () => ({ ...(await acta()), acta_comite: [await archivoTemporal('acta-comite.pdf', '%PDF-1.4 acta del comite')] });
  await rechazaCon(reemplazo(LOCAL_R1, {}, await acta()), 400, /acta del Comité Técnico/);
  await rechazaCon(reemplazo(LOCAL_R1, { comite_concepto: '' }, await dos()), 400, /concepto del Comité/);
  await rechazaCon(reemplazo(LOCAL_R1, { comite_fecha: '2999-01-01' }, await dos()), 400, /no puede ser futura/);
  // La persona que entra: una sola, con los datos obligatorios del ingreso del acta de novedades de asociados.
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: '' }, await dos()), 400, /Registra la persona que entra/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, nombre: 'Rosa' }) }, await dos()), 400, /La persona que entra: escribe el nombre completo/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, documento: '12' }) }, await dos()), 400, /la cédula es obligatoria/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, telefono: '' }) }, await dos()), 400, /el teléfono es obligatorio/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, sexo: '' }) }, await dos()), 400, /indica el sexo/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify([entra, { ...entra, documento: '52123457' }]) }, await dos()), 400, /1 a 1/);
  const docSale = (await query("SELECT r.documento FROM unidades_productivas u JOIN representantes r ON r.id_representante = u.id_representante WHERE u.id_unico = 'E11-B'")).rows[0].documento;
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, documento: docSale }) }, await dos()), 400, /misma que sale/);
  // Quién sale: una sola persona del personal activo de la unidad (1 a 1).
  await rechazaCon(reemplazo(LOCAL_R1, { personal_sale: '' }, await dos()), 400, /Elige a la persona de la unidad que sale/);
  await rechazaCon(reemplazo(LOCAL_R1, { personal_sale: JSON.stringify([personalB[0], personalA[0]]) }, await dos()), 400, /1 a 1: elige una sola persona/);
  await rechazaCon(reemplazo(LOCAL_R1, { personal_sale: JSON.stringify(personalA.slice(0, 1)) }, await dos()), 400, /no es del personal activo de la unidad E11-B/);
  await rechazaCon(reemplazo(LOCAL_R1, { persona_entra: JSON.stringify({ ...entra, documento: '7700003' }) }, await dos()), 400, /misma que sale/);
  // El ticket del reemplazo es de la etapa Reemplazo.
  await rechazaCon(reemplazo(LOCAL_R1, { id_ticket: tkRetiro2.id }, await dos()), 400, /es de la etapa «Retiro»: elige uno de la etapa «Reemplazo»/);
  await rechazaCon(reemplazo(LOCAL_R1, { id_ticket: '' }, await dos()), 400, /Elige el ticket de la etapa «Reemplazo»/);
  // Con la Visita 2 cerrada no hay reemplazo.
  const idD = (await query("SELECT id_up FROM unidades_productivas WHERE id_unico = 'E11-D'")).rows[0].id_up;
  await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, tipo_visita, cerrada, documento) VALUES ('8860004_v2', $1, 'E11-D', '8860004', 'v2', TRUE, '{}')`, [idD]);
  await rechazaCon(reemplazo(LOCAL_R1, { id_unico: 'E11-D' }, await dos()), 400, /no tiene personal activo registrado/);
  // Una unidad sin personal registrado no tiene nada que elegir (personal_sale vacío).
  await rechazaCon(reemplazo(LOCAL_R1, { id_unico: 'E11-D', personal_sale: '[]' }, await dos()), 409, /cerró la Visita 2/);
  assert.equal(await estadoTicket(tkReemplazo.id), 'abierto', 'los intentos fallidos no tocan el ticket');
  r = await reemplazo(LOCAL_R1, {}, await dos());
  assert.deepEqual([r.item.id_unico, r.item.entra, r.item.ticket.resuelto], ['E11-B', 'Rosa Elena Gómez', true]);
  assert.equal((await fila('E11-B')).retirada_dps, true);
  assert.deepEqual((await query('SELECT activo, motivo_retiro FROM up_asociados WHERE id = $1', [personalB[0]])).rows[0],
    { activo: false, motivo_retiro: 'Retiro de la unidad: Información falsa o no veraz' }, 'la persona que sale del reemplazo deja de ser personal activo');
  assert.equal(await estadoTicket(tkReemplazo.id), 'respondido');
  const movReemplazo = (await ticketsE11.listarTickets(LOCAL_R1, { etapa: 'reemplazo' })).items.find((x) => x.id === tkReemplazo.id).historial.at(-1);
  assert.match(movReemplazo.nota, /Sale: Marta Díaz Soto \(7700003\)\. Entra: Rosa Elena Gómez/);
  assert.deepEqual([movReemplazo.personal_sale, movReemplazo.entra], [[{ nombre: 'Marta Díaz Soto', documento: '7700003' }], 'Rosa Elena Gómez'], 'quién sale y quién entra quedan en el ticket');
  const guardada = (await query("SELECT persona_entra, id_ticket FROM up_retiros WHERE id = $1", [r.item.id])).rows[0];
  assert.deepEqual([guardada.persona_entra.nombre, guardada.persona_entra.documento, guardada.persona_entra.zona, guardada.id_ticket], ['Rosa Elena Gómez', '52123456', 'urbana', tkReemplazo.id]);
  // La actividad lleva el nombre de quien entra, no su cédula ni su teléfono.
  const act = await ultimaActividadCarrito('up.reemplazo');
  assert.equal(act.cambios.entra, 'Rosa Elena Gómez');
  assert.equal(JSON.stringify(act.cambios).includes('52123456'), false);
  assert.equal(JSON.stringify(act.cambios).includes('3001234567'), false);
  const lista = (await retirosSrv.listarRetiros(LOCAL_R1)).items;
  assert.deepEqual(lista.filter((x) => x.id_unico.startsWith('E11')).map((x) => [x.id_unico, x.tipo, x.persona_entra?.nombre ?? null, x.ticket]),
    [['E11-B', 'reemplazo', 'Rosa Elena Gómez', tkReemplazo.consecutivo], ['E11-A', 'retiro', null, tkRetiro.consecutivo]]);
  assert.deepEqual(Object.keys(lista.find((x) => x.tipo === 'reemplazo').persona_entra).sort(), ['documento', 'nombre'], 'la lista no trae el teléfono ni el perfil');
  assert.deepEqual(lista.find((x) => x.tipo === 'reemplazo').personal_sale, [{ nombre: 'Marta Díaz Soto', documento: '7700003' }]);
  assert.deepEqual(lista.find((x) => x.tipo === 'retiro' && x.id_unico === 'E11-A').personal_sale.map((p) => p.nombre), ['Ana Torres Ruiz', 'Luis Mora Peña']);
  assert.equal((await retirosSrv.listarRetiros(local({ region: 'región 2' }))).items.some((x) => x.id_unico.startsWith('E11')), false);
  await rechaza(retirosSrv.listarRetiros(G1), 403);
  const rid = lista.find((x) => x.tipo === 'reemplazo').id;
  assert.equal((await retirosSrv.actaRetiro(TECNICO_R1, { id: rid, cual: 'comite' })).buffer.subarray(0, 5).toString(), '%PDF-');
  await rechaza(retirosSrv.actaRetiro(local({ region: 'región 2' }), { id: rid }), 404);
  const det = (await unidades.obtenerUnidad(COORD, { id: 'E11-B' })).item.retiro;
  assert.deepEqual([det.tipo, det.persona_entra, det.comite.fecha, det.ticket], ['reemplazo', { nombre: 'Rosa Elena Gómez' }, hoy, tkReemplazo.consecutivo]);
  assert.deepEqual(det.personal_sale, [{ nombre: 'Marta Díaz Soto' }]);

  // El Coordinador general ve todas las unidades, activas y desactivadas: ninguna se borra, solo se desactiva.
  for (const u of [LOCAL_R1, TECNICO_R1, G1, DATOS]) await rechaza(retirosSrv.estadoUnidades(u), 403);
  const estado = await retirosSrv.estadoUnidades(COORD);
  const unidad = (u) => estado.items.find((x) => x.id_unico === u);
  assert.equal(estado.resumen.total, estado.items.length);
  assert.equal(estado.resumen.activas + estado.resumen.desactivadas, estado.resumen.total);
  assert.equal(estado.resumen.total, (await query('SELECT count(*)::int AS n FROM unidades_productivas')).rows[0].n, 'las retiradas siguen en la base');
  assert.deepEqual([unidad('E11-A').estado, unidad('E11-B').estado], ['desactivada', 'desactivada']);
  assert.deepEqual(unidad('E11-A').desactivacion, { motivo: 'retirada', tipo: 'retiro', causal: 'Retiro voluntario', fecha: unidad('E11-A').desactivacion.fecha, ticket: tkRetiro.consecutivo, registrado_por: 'Local' });
  assert.deepEqual([unidad('E11-B').desactivacion.tipo, unidad('E11-B').desactivacion.causal, unidad('E11-B').desactivacion.ticket], ['reemplazo', 'Información falsa o no veraz', tkReemplazo.consecutivo]);
  assert.equal(unidad('E11-C').estado, 'desactivada');
  assert.equal(unidad('E11-C').desactivacion.motivo, 'sin_habilitar', 'no habilitada y sin retiro');
  assert.equal(unidad('E11-D').estado, 'activa');
  assert.equal(unidad('E11-D').desactivacion, null);
});

test('E11 alistamiento: carga de los gestores con tope de 50, cambio de nodo, transferencia metodológica, kit a gestores y cierre por departamento', async () => {
  // ---- ET0-02 y FUN-GES-08: carga y tope de 50 ----
  await rechaza(alistamientoSrv.cargaGestores(G1), 403);
  let carga = (await alistamientoSrv.cargaGestores(LOCAL_R1)).items;
  assert.ok(carga.some((g) => g.nodo === 'ATLAN1') && carga.every((g) => g.region === 'Región 1'), 'el coordinador local ve los gestores de su territorio');
  const atlan = carga.find((g) => g.nodo === 'ATLAN1');
  assert.equal(atlan.tope, 50);
  assert.ok(atlan.unidades >= 1 && !atlan.lleno);
  assert.equal((await alistamientoSrv.cargaGestores(TECNICO_R1)).items.length, carga.length, 'el técnico de apoyo consulta');
  assert.equal((await alistamientoSrv.cargaGestores(COORD)).items.length >= 2, true);
  // Un nodo con su gestor y 50 unidades habilitadas.
  const { rows: [t] } = await query("INSERT INTO triadas (nodo, region, triada) VALUES ('E11TOPE', 'Región 1', 'T11') RETURNING id_triada");
  await query("INSERT INTO gestores (id_origen, id_triada, cedula, nombre, correo) VALUES ('G-E11TOPE', $1, '1001001111', 'Gestor tope', 'tope@x.co')", [t.id_triada]);
  for (let i = 0; i < 50; i++) {
    await query(`INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, nombre, modalidad, habilitada, departamento)
      VALUES ($1, $1, $2, 'UP tope ' || $3::text, 'M1', TRUE, 'Atlántico')`, [`E11-T${i}`, t.id_triada, i]);
  }
  carga = (await alistamientoSrv.cargaGestores(LOCAL_R1)).items;
  assert.deepEqual([carga.find((g) => g.nodo === 'E11TOPE').unidades, carga.find((g) => g.nodo === 'E11TOPE').lleno], [50, true]);
  const mover = (u, campos) => alistamientoSrv.moverUP(u, { id_unico: 'E11-D', nodo: 'E11TOPE', motivo: 'Reasignación de la ruta', ...campos });
  await rechaza(mover(G1), 403);
  await rechaza(mover(TECNICO_R1), 403);
  await rechazaCon(mover(LOCAL_R1, { motivo: '' }), 400, /motivo/);
  await rechazaCon(mover(LOCAL_R1, { nodo: 'NOEXISTE' }), 404, /nodo no existe/);
  await rechaza(mover(LOCAL_R1, { nodo: 'BOLIV1' }), 403, 'nodo fuera del alcance');
  await rechazaCon(mover(LOCAL_R1), 400, /ya atiende 50 unidades: el máximo por gestor es 50/);
  // Una unidad retirada no cuenta: sí se puede mover. Y mover a otro nodo del alcance sí pasa.
  assert.equal((await alistamientoSrv.moverUP(LOCAL_R1, { id_unico: 'E11-A', nodo: 'E11TOPE', motivo: 'Archivo' })).item.nodo, 'E11TOPE');
  await rechazaCon(mover(LOCAL_R1, { nodo: 'ATLAN1' }), 409, /ya está en el nodo/);
  assert.equal((await alistamientoSrv.moverUP(COORD, { id_unico: 'E11-D', nodo: 'BOLIV1', motivo: 'Cambio de ruta' })).item.nodo_anterior, 'ATLAN1');
  assert.deepEqual((await ultimaActividadCarrito('up.mover_nodo')).cambios.campos.nodo, ['ATLAN1', 'BOLIV1']);
  // Su historial viaja con ella (revisión E11): la visita queda en el nodo nuevo.
  assert.equal((await query("SELECT nodo_gestor FROM visitas WHERE id = '8860004_v2'")).rows[0].nodo_gestor, 'BOLIV1');
  assert.equal((await unidades.listarUnidades(G2)).items.some((x) => x.id_unico === 'E11-D'), true, 'el gestor del nodo nuevo la ve');

  // ---- ET0-03: transferencia metodológica (nivel nacional) con lista, fotos y asistentes del equipo ----
  const pdf = (n) => archivoTemporal(n, '%PDF-1.4 soporte');
  const foto = (n) => archivoTemporal(n, Buffer.alloc(16, 1), 'image/png');
  const equipo = (await alistamientoSrv.equipo(COORD)).items;
  assert.ok(equipo.some((p) => p.rol === 'gestor') && equipo.some((p) => p.rol === 'coordinador'));
  const sub = equipo.find((p) => p.rol === 'gestor').sub;
  const transferencia = (u, campos, archivos) => alistamientoSrv.registrarEvento(u, { tipo: 'transferencia', fecha: diaColombia(), lugar: 'Bogotá', descripcion: 'Metodología del programa', asistentes: JSON.stringify([sub]), ...campos }, archivos);
  const soportes = async () => ({ lista: [await pdf('lista.pdf')], fotos: [await foto('f1.png'), await foto('f2.png')] });
  await rechaza(transferencia(LOCAL_R1, {}, await soportes()), 403);
  await rechazaCon(transferencia(COORD, {}, { fotos: [await foto('f1.png')] }), 400, /lista de asistencia/);
  await rechazaCon(transferencia(COORD, {}, { lista: [await pdf('lista.pdf')] }), 400, /al menos una foto/);
  await rechazaCon(transferencia(COORD, {}, { lista: [await pdf('lista.pdf')], fotos: [await archivoTemporal('f.png', 'no', 'image/png', { crudo: true })] }), 400, /imagen JPG o PNG/);
  await rechazaCon(transferencia(COORD, { asistentes: '[]' }, await soportes()), 400, /integrantes del equipo/);
  await rechazaCon(transferencia(COORD, { asistentes: JSON.stringify(['gestor:999999']) }, await soportes()), 400, /no es un integrante/);
  await rechazaCon(transferencia(COORD, { fecha: '2999-01-01' }, await soportes()), 400, /no puede ser futura/);
  let ev = await alistamientoSrv.registrarEvento(DATOS, { tipo: 'transferencia', fecha: diaColombia(), lugar: 'Bogotá', descripcion: 'x', asistentes: JSON.stringify([sub]) }, await soportes());
  assert.deepEqual([ev.item.adjuntos, ev.item.asistentes], [3, 1]);
  // Por la ruta multipart: la lista y 15 fotos (16 archivos) pasan; con 21 fotos se pasa del tope (revisión E11).
  const jefeHttp = await entrar('jefe', 'Super-Segura-2026x');
  const enviarEvento = async (nFotos) => {
    const token = (await jefeHttp.http('GET', '/api/auth/sesion')).json.token;
    const form = new FormData();
    for (const [k, v] of Object.entries({ tipo: 'transferencia', fecha: diaColombia(), lugar: 'Bogotá', asistentes: JSON.stringify([sub]) })) form.append(k, v);
    form.append('lista', new Blob([Buffer.from('%PDF-1.4 lista')]), 'lista.pdf');
    for (let i = 0; i < nFotos; i++) form.append('fotos', new Blob([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8, i)])]), `f${i}.png`);
    const res = await fetch(`${base}/api/alistamiento/eventos`, { method: 'POST', headers: { Cookie: jefeHttp.http.cookie(), 'X-CSRF-Token': token }, body: form });
    return { status: res.status, json: await res.json() };
  };
  const quince = await enviarEvento(15);
  assert.equal(quince.status, 200, JSON.stringify(quince.json));
  assert.equal(quince.json.item.adjuntos, 16);
  const veintiuna = await enviarEvento(21);
  assert.equal(veintiuna.status, 400);
  assert.match(veintiuna.json.error, /archivo/);
  assert.equal((await ultimaActividadCarrito('alistamiento.transferencia')).cambios.asistentes, 1);

  // ---- ET0-04: kit a gestores (coordinación de su territorio) ----
  const gestorAtlan = carga.find((g) => g.nodo === 'ATLAN1');
  const gestorBoliv = (await alistamientoSrv.cargaGestores(COORD)).items.find((g) => g.nodo === 'BOLIV1');
  const kit = (u, campos, archivos) => alistamientoSrv.registrarEvento(u, { tipo: 'kit_gestor', fecha: diaColombia(), id_gestor: gestorAtlan.id_gestor, contenido: 'Chaleco, carpeta y tablet', ...campos }, archivos);
  await rechaza(kit(TECNICO_R1, {}, { acta: [await pdf('acta.pdf')] }), 403);
  await rechaza(kit(LOCAL_R1, { id_gestor: gestorBoliv.id_gestor }, { acta: [await pdf('acta.pdf')] }), 403);
  await rechazaCon(kit(LOCAL_R1, { contenido: '' }, { acta: [await pdf('acta.pdf')] }), 400, /contenido del kit/);
  await rechazaCon(kit(LOCAL_R1, {}, {}), 400, /acta de entrega del kit/);
  ev = await kit(LOCAL_R1, {}, { acta: [await pdf('acta.pdf')] });
  assert.equal(ev.item.adjuntos, 1);

  // ---- ET4-07: cierre por departamento con lista, fotos, presentación y las UP que asistieron ----
  const cierre = (u, campos, archivos) => alistamientoSrv.registrarEvento(u, { tipo: 'cierre', fecha: diaColombia(), lugar: 'Barranquilla', departamento: 'Atlántico',
    descripcion: 'Resultados del programa', asistentes: JSON.stringify(['E11-C', 'E11-E']), ...campos }, archivos);
  const todo = async () => ({ ...(await soportes()), presentacion: [await pdf('resultados.pdf')] });
  await rechaza(cierre(G1, {}, await todo()), 403);
  await rechazaCon(cierre(LOCAL_R1, {}, await soportes()), 400, /presentación de resultados/);
  await rechazaCon(cierre(LOCAL_R1, { departamento: '' }, await todo()), 400, /departamento/);
  await rechaza(cierre(LOCAL_R1, { asistentes: JSON.stringify(['3']) }, await todo()), 403); // una UP de otra región
  await rechazaCon(cierre(LOCAL_R1, { asistentes: JSON.stringify(['E11-C', 'NOEXISTE']) }, await todo()), 400, /no existe/);
  await rechaza(cierre(local({ region: 'región 1', departamento: 'Bolívar' }), {}, await todo()), 403, 'departamento fuera del alcance');
  ev = await cierre(LOCAL_R1, {}, await todo());
  assert.deepEqual([ev.item.adjuntos, ev.item.asistentes], [4, 2]);
  assert.equal((await ultimaActividadCarrito('up.cierre')).id_unico, 'E11-E');
  assert.deepEqual((await unidades.obtenerUnidad(COORD, { id: 'E11-C' })).item.cierre.departamento, 'Atlántico');
  assert.equal((await unidades.obtenerUnidad(COORD, { id: 'E11-D' })).item.cierre, null);

  // ---- Quién ve qué ----
  const deR1 = (await alistamientoSrv.listarEventos(LOCAL_R1)).items;
  assert.deepEqual([...new Set(deR1.map((e) => e.tipo))].sort(), ['cierre', 'kit_gestor', 'transferencia']);
  // E11-D (de Atlántico) pasó a BOLIV1, así que la región 2 sí ve el cierre de Atlántico; la coordinación de Bolívar, no.
  assert.deepEqual([...new Set((await alistamientoSrv.listarEventos(local({ region: 'región 2' }))).items.map((e) => e.tipo))].sort(), ['cierre', 'transferencia']);
  const R2B = local({ region: 'región 2', departamento: 'Bolívar' });
  const deR2 = (await alistamientoSrv.listarEventos(R2B)).items;
  assert.deepEqual([...new Set(deR2.map((e) => e.tipo))], ['transferencia'], 'Bolívar no ve el kit de ATLAN1 ni el cierre de Atlántico');
  assert.equal((await alistamientoSrv.listarEventos(COORD, { tipo: 'cierre' })).items[0].asistentes.length, 2);
  await rechaza(alistamientoSrv.listarEventos(G1), 403);
  const adj = deR1.find((e) => e.tipo === 'cierre').adjuntos.find((a) => a.clase === 'presentacion');
  assert.equal((await alistamientoSrv.adjuntoEvento(TECNICO_R1, { id: adj.id })).tipo, 'application/pdf');
  await rechaza(alistamientoSrv.adjuntoEvento(R2B, { id: adj.id }), 404);
});

// ---------------- E12 · Seguimiento, indicadores y reportes ----------------
const metasSrv = await import('../src/servicios/metas.js');
const casosSrv = await import('../src/servicios/casos.js');
const comercialSrv = await import('../src/servicios/comercial.js');

test('E12 metas de cupos, estado del negocio, plan de mercadeo y retiro del rol de entidad', async () => {
  // ---- ET0-06: metas por región y modalidad (nivel nacional) ----
  const METAS = [{ region: 'Región 1', modalidad: 'M1', meta: 3000 }, { region: 'Región 1', modalidad: 'M2 - Asociativa', meta: 300 },
    { region: 'Región 2', modalidad: 'M1', meta: 2000 }, { region: 'Región 1', modalidad: 'M1', departamento: 'Atlántico', meta: 1200 }];
  await rechaza(metasSrv.guardarMetas(LOCAL_R1, { metas: METAS }), 403);
  await rechazaCon(metasSrv.guardarMetas(COORD, { metas: [{ region: 'Región 1', modalidad: 'M9', meta: 1 }] }), 400, /M1, M2, M3 o M4/);
  await rechazaCon(metasSrv.guardarMetas(COORD, { metas: [{ region: 'Región 1', modalidad: 'M1', meta: -1 }] }), 400, /número entero/);
  await rechazaCon(metasSrv.guardarMetas(COORD, { metas: [METAS[0], { ...METAS[0], modalidad: 'M1 - Individual' }] }), 400, /repetida/);
  let r = await metasSrv.guardarMetas(DATOS, { metas: METAS });
  assert.deepEqual([r.total_metas, r.total_programa], [5300, 6334]);
  assert.match(r.aviso, /suman 5300/);
  assert.equal((await ultimaActividadCarrito('metas.guardar')).cambios.campos.total[1], 5300);
  r = await metasSrv.listarMetas(LOCAL_R1);
  assert.deepEqual([...new Set(r.items.map((m) => m.region))], ['Región 1'], 'la coordinación local ve su región');
  assert.equal(r.puede_editar, false);
  assert.equal((await metasSrv.listarMetas(COORD)).items.length, 4);
  await rechaza(metasSrv.listarMetas(G1), 403);
  const todas = (await metasSrv.listarMetas(COORD)).items;
  assert.deepEqual([metasSrv.metaDe(todas, { region: 'región 1', modalidad: 'M1 - Individual' }), metasSrv.metaDe(todas, { region: 'Región 1', modalidad: 'M1', departamento: 'ATLANTICO' }),
    metasSrv.metaDe(todas, { region: 'Región 1', modalidad: 'M1', departamento: 'Bolívar' }), metasSrv.metaDe(todas, { region: 'Región 3', modalidad: 'M1' })], [3000, 1200, null, null]);

  // ---- TR-04: estado del negocio en el diagnóstico (V2) y en la salida ----
  assert.ok(diagnostico.SECCIONES_V2.includes('negocio'));
  assert.ok(salidaE5.ESQUEMA_SALIDA.some((s) => s.clave === 'negocio'));
  await rechazaCon(diagnostico.guardarSeccion(G1, { id_unico: 'E11-C', seccion: 'negocio', datos: { etapa: 'volando' } }), 400, /Etapa del negocio/);
  const neg = await diagnostico.guardarSeccion(G1, { id_unico: 'E11-C', seccion: 'negocio', datos: { etapa: 'inicio', productos: 'Café', valor_agregado: 'Tostión propia', estado_produccion: 'intermitente', estado_comercializacion: 'local' } });
  assert.equal(neg.item.datos.etapa, 'inicio');

  // ---- FUN-PACM-02: plan de mercadeo dentro del plan de negocio; FUN-PACM-05: compras consulta la salida ----
  assert.deepEqual(reglasPlan.MERCADEO.map((c) => c.clave), ['segmento', 'canales', 'precio', 'promocion', 'distribucion']);
  const sinMercadeo = reglasPlan.faltantesPlanNegocio(reglasPlan.limpiarPlanNegocio({ ...PLAN_COMPLETO, mercadeo: { segmento: 'Vecinos' } }));
  assert.ok(sinMercadeo.some((f) => /Plan de mercadeo: canales de venta, estrategia de precio/.test(f)), sinMercadeo.join(' | '));
  assert.deepEqual(reglasPlan.faltantesPlanNegocio(reglasPlan.limpiarPlanNegocio(PLAN_COMPLETO)), []);
  assert.ok(Array.isArray((await salidaE5.tableroEvaluacion(COMPRAS)).items));

  // ---- DOC-05: el rol «entidad» (INNPULSA o DPS) se retiró en E14: no es un rol del Anexo. El panel para las
  // entidades lo consulta y lo exporta el nivel nacional (ver «E12 seguimiento…»). ----
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const alta = await jefe.http('POST', '/api/admin/usuarios', { rol: 'entidad', usuario: 'innpulsa', nombre: 'INNPULSA', clave: 'Entidad-Segura-2026' });
  assert.equal(alta.status, 400, 'ya no se crean cuentas de entidad');
  assert.equal((await jefe.http('GET', '/api/admin/usuarios')).json.roles.some((r) => r.rol === 'entidad'), false);
  // Una cuenta que haya quedado con ese tipo en una base de la versión anterior: al arrancar se desactiva (sin borrarla),
  // el tipo deja de admitirse y la cuenta no entra.
  // La restricción de esa versión es la de hoy con 'entidad' adelante (así la dejaba la migración anterior).
  const { rows: [hoy] } = await query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_coordinadores_tipo'");
  assert.ok(hoy.def.includes('ARRAY['), hoy.def);
  await query('ALTER TABLE coordinadores DROP CONSTRAINT ck_coordinadores_tipo');
  await query(`ALTER TABLE coordinadores ADD CONSTRAINT ck_coordinadores_tipo ${hoy.def.replace('ARRAY[', "ARRAY['entidad'::character varying, ")}`);
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre) VALUES ('E12-ENT', 'entidad', 'innpulsa.vieja', $1, 'INNPULSA')`,
    [await hashClave('Entidad-Segura-2026')]);
  await iniciarEsquemaBitacora();
  const { rows: [vieja] } = await query("SELECT activo FROM coordinadores WHERE usuario = 'innpulsa.vieja'");
  assert.equal(vieja.activo, false, 'la cuenta vieja queda inactiva, no se borra');
  const { rows: [ck] } = await query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_coordinadores_tipo'");
  assert.equal(ck.def.includes('entidad'), false, ck.def);
  await assert.rejects(query("INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre) VALUES ('E12-ENT2', 'entidad', 'dps.nueva', 'x', 'DPS')"),
    (e) => e.code === '23514', 'el tipo entidad ya no se admite');
  assert.notEqual((await entrar('innpulsa.vieja', 'Entidad-Segura-2026')).r.status, 200, 'la cuenta vieja no entra');
  // La restricción tampoco deja reactivarla a mano.
  await assert.rejects(query("UPDATE coordinadores SET activo = true WHERE usuario = 'innpulsa.vieja'"), (e) => e.code === '23514');
  // Y aunque alguien quitara la restricción y la reactivara, un rol que no existe no entra a nada.
  await query('ALTER TABLE coordinadores DROP CONSTRAINT ck_coordinadores_tipo');
  await query("UPDATE coordinadores SET activo = true WHERE usuario = 'innpulsa.vieja'");
  assert.notEqual((await entrar('innpulsa.vieja', 'Entidad-Segura-2026')).r.status, 200, 'un rol que no existe no entra');
  await query("DELETE FROM coordinadores WHERE usuario = 'innpulsa.vieja'");
  await query(`ALTER TABLE coordinadores ADD CONSTRAINT ck_coordinadores_tipo ${hoy.def}`);
  await reiniciarLimites();
});

test('E12 casos de éxito y gestión comercial por unidad', async () => {
  // ---- ET4-10, TR-07, FUN-PSI-06: casos de éxito, buenas prácticas y lecciones ----
  const png = (n) => archivoTemporal(n, Buffer.alloc(16, 3), 'image/png');
  const caso = (u, campos, archivos) => casosSrv.registrarCaso(u, { id_unico: '1', tipo: 'exito', titulo: 'Duplicó las ventas', descripcion: 'Con el horno nuevo atiende dos ferias', resultados: 'Ventas de 1,8 a 3,6 millones', fecha: diaColombia(), ...campos }, archivos);
  await rechaza(caso(TECNICO_R1, {}, {}), 403);
  await rechaza(caso(G2, {}, {}), 403, 'otro nodo');
  await rechazaCon(caso(G1, { tipo: 'otro' }, {}), 400, /Elige el tipo/);
  await rechazaCon(caso(G1, { titulo: '' }, {}), 400, /título/);
  await rechazaCon(caso(G1, { fecha: '2999-01-01' }, {}), 400, /no puede ser futura/);
  await rechazaCon(caso(G1, {}, { fotos: [await archivoTemporal('f.png', 'no', 'image/png', { crudo: true })] }), 400, /imagen JPG o PNG/);
  let r = await caso(G1, {}, { fotos: [await png('f1.png'), await png('f2.png')], documento: [await archivoTemporal('caso.pdf', '%PDF-1.4 caso')] });
  assert.equal(r.item.adjuntos, 3);
  assert.equal((await ultimaActividadCarrito('caso.registrar')).id_unico, '1');
  await caso(LOCAL_R1, { tipo: 'leccion', titulo: 'Separar las cuentas', descripcion: 'Mezclar el dinero de la casa y del negocio frenó la reinversión' }, {});
  let lista = (await casosSrv.listarCasos(LOCAL_R1)).items;
  assert.deepEqual(lista.map((c) => c.tipo).sort(), ['exito', 'leccion']);
  assert.equal((await casosSrv.listarCasos(LOCAL_R1, { tipo: 'leccion' })).items.length, 1);
  assert.equal((await casosSrv.listarCasos(local({ region: 'región 2' }))).items.length, 0);
  assert.equal((await casosSrv.listarCasos(G1)).items.length, 2, 'el gestor ve los de su nodo');
  assert.equal((await casosSrv.listarCasos(G1)).puede_documentar, false);
  const exito = lista.find((c) => c.tipo === 'exito');
  await rechaza(casosSrv.documentarCaso(LOCAL_R1, { id: exito.id }), 403);
  assert.equal((await casosSrv.documentarCaso(DATOS, { id: exito.id })).item.documentado, true);
  await rechazaCon(casosSrv.documentarCaso(COORD, { id: exito.id }), 409, /ya está documentado/);
  assert.deepEqual((await casosSrv.listarCasos(COORD, { documentado: 'si' })).items.map((c) => c.id), [exito.id]);
  const foto = exito.adjuntos.find((a) => a.clase === 'foto');
  assert.equal((await casosSrv.adjuntoCaso(TECNICO_R1, { id: foto.id })).tipo, 'image/png');
  await rechaza(casosSrv.adjuntoCaso(local({ region: 'región 2' }), { id: foto.id }), 404);

  // ---- TR-08, FUN-PACM-01/03/04: gestiones comerciales ----
  const gestion = (u, campos, archivos) => comercialSrv.registrarGestion(u, { id_unico: '1', tipo: 'visita_comercial', fecha: diaColombia(), descripcion: 'Visita para revisar el empaque', ...campos }, archivos);
  await rechaza(gestion(G1, {}, {}), 403);
  await rechaza(gestion(TECNICO_R1, {}, {}), 403);
  await rechazaCon(gestion(COMPRAS, { tipo: 'otra' }, {}), 400, /tipo de gestión/);
  await rechazaCon(gestion(COMPRAS, { tipo: 'cliente' }, {}), 400, /entidad, el aliado o el cliente/);
  await rechazaCon(gestion(COMPRAS, {}, { soporte: [await archivoTemporal('s.pdf', 'no', 'application/pdf', { crudo: true })] }), 400, /PDF, JPG o PNG/);
  r = await gestion(COMPRAS, {}, { soporte: [await archivoTemporal('visita.pdf', '%PDF-1.4 visita')] });
  assert.equal(r.item.nombre_tipo, 'Visita comercial');
  await gestion(LOCAL_R1, { tipo: 'cliente', entidad: 'Tienda La Esquina', resultado: 'Pedido semanal de 50 panes' }, {});
  await gestion(COMPRAS, { id_unico: '3', tipo: 'conexion_mercados', entidad: 'Feria regional' }, {});
  assert.equal((await ultimaActividadCarrito('comercial.registrar')).id_unico, '3');
  r = await comercialSrv.listarGestiones(LOCAL_R1);
  assert.deepEqual([r.items.length, r.resumen.por_tipo.visita_comercial, r.resumen.por_tipo.cliente, r.resumen.unidades], [2, 1, 1, 1]);
  assert.equal((await comercialSrv.listarGestiones(COMPRAS)).items.length, 3);
  assert.equal((await comercialSrv.listarGestiones(G1, { tipo: 'cliente' })).items.length, 1, 'el gestor consulta lo de su nodo');
  assert.equal((await comercialSrv.listarGestiones(G1)).puede_registrar, false);
  const conSoporte = r.items.find((g) => g.con_soporte);
  assert.equal((await comercialSrv.soporteGestion(TECNICO_R1, { id: conSoporte.id })).tipo, 'application/pdf');
  await rechaza(comercialSrv.soporteGestion(local({ region: 'región 2' }), { id: conSoporte.id }), 404);
});

const seguimientoSrv = await import('../src/servicios/seguimiento.js');
const diasAtras = (n) => { const d = new Date(`${hoyIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

test('E12 seguimiento: ruta desde la operación, indicadores contra metas, alertas, informe mensual, KOKAN y expediente documental', async () => {
  await upE4('E12-A', '8870001', 'M1 - Individual');
  await upE4('E12-B', '8870002', 'M1 - Individual');
  const { rows: [a] } = await query("SELECT id_up FROM unidades_productivas WHERE id_unico = 'E12-A'");
  const { rows: [b] } = await query("SELECT id_up FROM unidades_productivas WHERE id_unico = 'E12-B'");
  await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, tipo_visita, cerrada, fecha_cierre, documento) VALUES
    ('8870001_v1', $1, 'E12-A', '8870001', 'v1', TRUE, '2025-03-10T15:00:00Z', '{}'), ('8870001_v2', $1, 'E12-A', '8870001', 'v2', TRUE, '2025-03-20T15:00:00Z', '{}')`, [a.id_up]);
  await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, tipo_visita, cerrada, documento) VALUES ('8870002_v1', $1, 'E12-B', '8870002', 'v1', FALSE, $2)`,
    [b.id_up, JSON.stringify({ programacion: { resultado_llamada: 'AGENDADA', fecha_visita: diasAtras(20) } })]);
  const { id_producto: horno } = await catalogo.guardarProducto(COORD, { codigo: 'E12-HORNO', nombre: 'Horno E12', precio: 400000, iva: 0, unspsc: '101015', rubro: 'dotacion_maquinaria' });
  await carrito.ponerLinea(G1, { id_unico: 'E12-A', id_producto: horno, cantidad: 1 });
  const hist = [{ de: 'borrador', a: 'enviado', en: '2025-03-25T15:00:00Z' }, { de: 'subsanado', a: 'viable', en: '2025-04-01T15:00:00Z' },
    { de: 'viable', a: 'aprobado', en: '2025-04-08T15:00:00Z' }, { de: 'en_compra', a: 'entregado', en: `${diasAtras(40)}T15:00:00Z` }];
  await query("UPDATE carritos SET estado = 'entregado', historial = $2 WHERE id_up = $1", [a.id_up, JSON.stringify(hist)]);

  // ---- ET4-08, TR-02, FUN-CG-05, FUN-PSI-04: la ruta de 12 pasos sale de la operación ----
  assert.equal(seguimientoSrv.PASOS.length, 12);
  await rechaza(seguimientoSrv.rutaOperacion(G1), 403);
  let r = await seguimientoSrv.rutaOperacion(LOCAL_R1, { id_unico: 'E12-A' });
  const p = r.items[0].pasos;
  assert.deepEqual([p.visita1.fecha, p.visita2.fecha, p.plan.fecha, p.aprobacion.fecha, p.entrega.fecha], ['2025-03-10', '2025-03-20', '2025-03-25', '2025-04-08', diasAtras(40)]);
  assert.deepEqual([p.compra.logrado, p.visita3.logrado, p.cierre.logrado, p.subsanacion.logrado], [true, false, false, false]);
  assert.deepEqual([r.items[0].avance, r.items[0].de, r.items[0].modalidad], [7, 11, 'M1']);
  assert.equal(r.items[0].modulos, null, 'sin taller no hay participación por módulo');
  const conTaller = (await seguimientoSrv.rutaOperacion(COORD)).items.find((f) => f.modulos);
  assert.ok(conTaller && conTaller.modulos.length === 3 && conTaller.modulos.every((m) => typeof m === 'boolean'), 'participación por módulo (TR-02)');
  assert.equal((await seguimientoSrv.rutaOperacion(local({ region: 'región 2' }), { id_unico: 'E12-A' })).items.length, 0);
  assert.equal((await seguimientoSrv.rutaOperacion(COMPRAS, { id_unico: 'E12-A' })).items.length, 1);

  // ---- TR-01, FUN-CG-01/02, ET0-06: indicadores contra las metas ----
  await rechaza(seguimientoSrv.indicadores(G1), 403);
  r = await seguimientoSrv.indicadores(DATOS, { agrupar: 'region' });
  const r1 = r.items.find((x) => x.grupo === 'Región 1');
  assert.equal(r1.meta, 3300, 'las metas sin departamento de la región');
  assert.equal(r1.cobertura_pct, Math.round((r1.unidades / 3300) * 1000) / 10);
  assert.ok(r1.gestion.entrega.n >= 1);
  assert.equal(r.total_programa, 6334);
  assert.ok((await seguimientoSrv.indicadores(COORD, { agrupar: 'modalidad' })).items.some((x) => x.grupo === 'M1' && x.meta === 5000));

  // ---- TR-06: reporte del 80 % ----
  await rechaza(seguimientoSrv.reporteFormacion(G1), 403);
  assert.ok(Array.isArray((await seguimientoSrv.reporteFormacion(LOCAL_R1)).por_region));

  // ---- DOC-06: alertas de la ruta ----
  r = await seguimientoSrv.alertas(COORD);
  assert.ok(r.items.some((x) => x.tipo === 'v3_pendiente' && x.id_unico === 'E12-A'), 'entregada hace 40 días y sin V3');
  assert.ok(r.items.some((x) => x.tipo === 'visita_abierta' && x.id_unico === 'E12-B'), 'programada hace 20 días y sin cerrar');
  assert.equal(r.resumen.total, r.items.length, 'el resumen cuenta las mismas alertas que lista');
  assert.equal((await seguimientoSrv.alertas(local({ region: 'región 2' }))).items.some((x) => x.id_unico === 'E12-A'), false);
  await rechaza(seguimientoSrv.alertas(G1), 403);

  // ---- DOC-05: el panel para INNPULSA y DPS, que consulta y exporta el nivel nacional ----
  await rechaza(seguimientoSrv.panel(G1), 403);
  r = await seguimientoSrv.panel(DATOS);
  assert.equal(r.ruta.length, 12);
  assert.ok(r.por_region.length && r.alertas.total >= 2);
  assert.equal(JSON.stringify(r).includes('E12-A'), false, 'sin filas por unidad');
  assert.equal(JSON.stringify(r).includes('8870001'), false, 'sin datos personales');

  // ---- TR-09, FUN-CG-04: consolidado e informe mensual ----
  await rechaza(seguimientoSrv.consolidadoMensual(G1, { periodo: '2025-03' }), 403);
  await rechazaCon(seguimientoSrv.consolidadoMensual(COORD, { periodo: '2025-13' }), 400, /AAAA-MM/);
  r = await seguimientoSrv.consolidadoMensual(COORD, { periodo: '2025-03' });
  assert.deepEqual([r.totales.periodo.visita1, r.totales.periodo.visita2], [1, 1]);
  assert.equal((await seguimientoSrv.consolidadoMensual(COORD, { periodo: '2025-04' })).totales.periodo.aprobacion, 1);
  const xlsx = await seguimientoSrv.archivoMensual(COORD, { periodo: '2025-03' });
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
  assert.equal((await seguimientoSrv.archivoMensual(COORD, { periodo: '2025-03', formato: 'pdf' })).buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(seguimientoSrv.mesAnterior('2026-01-05'), '2025-12');
  r = await seguimientoSrv.generarInformeProgramado({ hoy: '2025-04-15' });
  assert.deepEqual([r.periodo, r.generado], ['2025-03', true]);
  assert.equal((await seguimientoSrv.generarInformeProgramado({ hoy: '2025-04-20' })).generado, false, 'no se repite');
  assert.equal((await ultimaActividadCarrito('informe.mensual')).cambios.periodo, '2025-03');
  const inf = (await seguimientoSrv.listarInformes(DATOS)).items.find((x) => x.periodo === '2025-03');
  assert.equal(inf.resumen.periodo.visita1, 1);
  assert.equal((await seguimientoSrv.informeArchivo(DATOS, { id: inf.id, formato: 'pdf' })).buffer.subarray(0, 4).toString(), '%PDF');
  await rechaza(seguimientoSrv.informeArchivo(DATOS, { id: 999999 }), 404);
  await rechaza(seguimientoSrv.listarInformes(G1), 403);

  // ---- TR-14: archivo de intercambio para KOKAN ----
  await rechaza(seguimientoSrv.exportarKokan(LOCAL_R1), 403);
  await rechazaCon(seguimientoSrv.exportarKokan(DATOS, { desde: 'ayer' }), 400, /AAAA-MM-DD/);
  r = await seguimientoSrv.exportarKokan(DATOS, { desde: '2025-03-01', hasta: '2025-03-31' });
  const filasA = r.items.filter((x) => x.id_unico === 'E12-A');
  assert.deepEqual(filasA.map((x) => [x.documento, x.etapa, x.actividad, x.fecha]),
    [['8870001', 'Diagnóstico', 'Visita 1 cerrada', '2025-03-10'], ['8870001', 'Diagnóstico', 'Visita 2 (diagnóstico) cerrada', '2025-03-20'], ['8870001', 'Capitalización', 'Plan de capitalización enviado', '2025-03-25']]);
  assert.equal(filasA[0].nombre_representante, 'Rep Diagnóstico');
  assert.deepEqual(r.diccionario.map((c) => c.campo), Object.keys(filasA[0]));
  assert.equal((await ultimaActividadCarrito('kokan.exportar')).cambios.desde, '2025-03-01');

  // ---- ET4-09: informe técnico por unidad ----
  assert.equal((await seguimientoSrv.informeTecnicoUP(G1, { id_unico: 'E12-A' })).buffer.subarray(0, 4).toString(), '%PDF');
  await rechaza(seguimientoSrv.informeTecnicoUP(G2, { id_unico: 'E12-A' }), 403);
  await rechaza(seguimientoSrv.informeTecnicoUP(COMPRAS, { id_unico: 'E12-A' }), 403);
  await rechaza(seguimientoSrv.informeTecnicoUP(COORD, { id_unico: 'NOEXISTE' }), 404);

  // ---- TR-10, TR-12, FUN-TAR-01/02, FUN-CLR-04: expediente por unidad con series, versiones y verificación ----
  const acta = () => archivoTemporal('acta.pdf', '%PDF-1.4 acta');
  const nombreActa = '8870001/01_VISITA_1_CARACTERIZACION/acta.pdf';
  await archivos.guardarArchivo({ contenedor: 'visitas', nombre: nombreActa, archivo: await acta(), idUp: a.id_up, usuario: G1 });
  await archivos.guardarArchivo({ contenedor: 'visitas', nombre: nombreActa, archivo: await acta(), idUp: a.id_up, usuario: G1 });
  const { rows: versiones } = await query("SELECT reemplazado_por FROM archivos_versiones WHERE contenedor = 'visitas' AND nombre = $1", [nombreActa]);
  assert.deepEqual(versiones.map((v) => v.reemplazado_por), ['1001001001'], 'el reemplazo conserva la versión anterior');
  await casosSrv.registrarCaso(G1, { id_unico: 'E12-A', tipo: 'exito', titulo: 'Vende en la feria', descripcion: 'Con el horno atiende la feria', fecha: hoyIso() },
    { fotos: [await archivoTemporal('feria.png', Buffer.alloc(16, 3), 'image/png')] });
  await rechaza(seguimientoSrv.soportesUP(COMPRAS, { id_unico: 'E12-A' }), 403);
  await rechaza(seguimientoSrv.soportesUP(G2, { id_unico: 'E12-A' }), 403);
  r = await seguimientoSrv.soportesUP(G1, { id_unico: 'E12-A' });
  assert.equal(r.puede_verificar, false);
  const actaV1 = r.items.find((x) => x.origen === 'archivo');
  assert.equal(actaV1.subido_por, 'Gestor ATLAN1', 'el expediente muestra el nombre de quien cargó, no su cédula (revisión E12 · [30])');
  assert.deepEqual([actaV1.serie, actaV1.versiones], ['diagnostico', 1]);
  const foto = r.items.find((x) => x.origen === 'caso');
  assert.equal(foto.serie, 'acompanamiento');
  assert.ok(foto.url.startsWith('/seguimiento/soportes/archivo?id_unico=E12-A&origen=caso&ref='), foto.url);
  const serie = Object.fromEntries(r.completitud.map((c) => [c.serie, c]));
  assert.deepEqual([serie.diagnostico.completa, serie.entrega.completa, serie.acompanamiento.completa], [true, false, false]);
  assert.equal((await seguimientoSrv.archivoSoporte(G1, { id_unico: 'E12-A', origen: 'caso', ref: foto.ref })).tipo, 'image/png');
  await rechaza(seguimientoSrv.archivoSoporte(G2, { id_unico: 'E12-A', origen: 'caso', ref: foto.ref }), 403);
  await rechaza(seguimientoSrv.archivoSoporte(G1, { id_unico: 'E12-A', origen: 'caso', ref: '999999' }), 404);
  await rechaza(seguimientoSrv.verificarSoporte(G1, { id_unico: 'E12-A', origen: 'caso', ref: foto.ref }), 403);
  await rechaza(seguimientoSrv.verificarSoporte(local({ region: 'región 2' }), { id_unico: 'E12-A', origen: 'caso', ref: foto.ref }), 403);
  await rechaza(seguimientoSrv.verificarSoporte(TECNICO_R1, { id_unico: 'E12-A', origen: 'caso', ref: 'nada' }), 404);
  assert.equal((await seguimientoSrv.soportesUP(TECNICO_R1, { id_unico: 'E12-A' })).puede_verificar, true);
  await seguimientoSrv.verificarSoporte(TECNICO_R1, { id_unico: 'E12-A', origen: 'caso', ref: foto.ref, observacion: 'Foto legible' });
  const verificada = (await seguimientoSrv.soportesUP(LOCAL_R1, { id_unico: 'E12-A' })).items.find((x) => x.origen === 'caso' && x.ref === foto.ref);
  assert.deepEqual([verificada.verificacion.verificado_por, verificada.verificacion.observacion], ['Técnico', 'Foto legible']);
  assert.equal((await ultimaActividadCarrito('soporte.verificar')).id_unico, 'E12-A');

  // ---- TR-11: reporte mensual de fotos y videos ----
  const mes = hoyIso().slice(0, 7);
  await rechaza(seguimientoSrv.multimediaMensual(G1, { periodo: mes }), 403);
  await rechaza(seguimientoSrv.multimediaMensual(COMPRAS, { periodo: mes }), 403);
  r = await seguimientoSrv.multimediaMensual(LOCAL_R1, { periodo: mes });
  assert.ok(r.items.some((x) => x.serie === 'acompanamiento' && x.region === 'Región 1' && x.fotos >= 1), JSON.stringify(r.items));

  // ---- Por HTTP: el nivel nacional abre el panel (sin datos personales) y descarga el informe; el gestor no ----
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const pan = await jefe.http('GET', '/api/seguimiento/panel');
  assert.equal(pan.status, 200);
  assert.equal(JSON.stringify(pan.json).includes('8870001'), false, 'el panel no trae datos personales');
  const gesHttp = await entrar('atlan1', '1001001001');
  for (const ruta of ['/api/seguimiento/panel', '/api/seguimiento/indicadores?agrupar=modalidad', '/api/seguimiento/kokan']) {
    assert.equal((await gesHttp.http('GET', ruta)).status, 403, `el gestor no llega a ${ruta}`);
  }
  assert.equal((await jefe.http('GET', '/api/seguimiento/mensual/archivo?periodo=2025-03&formato=pdf')).status, 200);
});

test('E12 seguimiento (revisión): soportes por rol del módulo dueño, verificación por versión, metas del alcance, entrega única y consolidado', async () => {
  await reiniciarLimites();
  await upE4('E12-S1', '8870011', 'M1 - Individual');
  await upE4('E12-S2', '8870012', 'M1 - Individual');
  await upE4('E12-S3', '8870013', 'M1 - Individual');
  const idUp = async (u) => (await query('SELECT id_up FROM unidades_productivas WHERE id_unico = $1', [u])).rows[0].id_up;
  const s1 = await idUp('E12-S1');
  const s2 = await idUp('E12-S2');
  const s3 = await idUp('E12-S3');
  const pdfBytes = Buffer.from('%PDF-1.4 soporte E12-S');
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const entregaFotos = async () => (await seguimientoSrv.multimediaMensual(COORD, { periodo: hoyIso().slice(0, 7) })).items
    .filter((x) => x.serie === 'entrega' && x.region === 'Región 1').reduce((a, x) => a + x.fotos, 0);
  const fotosAntes = await entregaFotos();

  // Operación: evento de cierre de S1 y S2; retiro de S1 a las 11:30 p. m. del 31 de mayo de 2024 (Colombia); taller de
  // S1, S2 y S3 con sus 3 módulos en mayo de 2024 (S1 y S3 asisten a todos, S2 a ninguno; S1 con su entrega final);
  // factura; kits de S1 y S2 con una sola acta de entrega (la de S2 la comparte con adjunto_de) y un acta de elementos
  // defectuosos del kit de S1.
  const ev = (await query(`INSERT INTO eventos_equipo (tipo, fecha, lugar, departamento, registrado_por)
    VALUES ('cierre', '2024-05-20', 'Barranquilla', 'Atlántico', 'Coord') RETURNING id`)).rows[0].id;
  await query(`INSERT INTO eventos_equipo_asistentes (evento_id, clase, ref, nombre, id_up) VALUES ($1, 'up', 'E12-S1', 'S1', $2), ($1, 'up', 'E12-S2', 'S2', $3)`, [ev, s1, s2]);
  const evRef = String((await query(`INSERT INTO eventos_equipo_adjuntos (evento_id, clase, nombre, tipo, contenido)
    VALUES ($1, 'lista', 'lista-cierre.pdf', 'application/pdf', $2) RETURNING id`, [ev, pdfBytes])).rows[0].id);
  await query(`INSERT INTO up_retiros (id_up, id_unico, tipo, causal, acta, acta_nombre, registrado_por, creado_en)
    VALUES ($1, 'E12-S1', 'retiro', 'retiro_voluntario', $2, 'acta-retiro.pdf', 'Coord', '2024-05-31T23:30:00-05:00')`, [s1, pdfBytes]);
  const taller = (await query(`INSERT INTO talleres_fortalecimiento (nombre, nodo, region, municipio, lugar, tallerista_sub, tallerista_nombre, participantes, creado_por)
    VALUES ('Taller E12-S', 'ATLAN1', 'Región 1', 'Barranquilla', 'Salón comunal', 'tallerista:9', 'Tallerista E12', $1, 'Coord') RETURNING id`,
  [JSON.stringify([{ id_up: s1 }, { id_up: s2 }, { id_up: s3 }])])).rows[0].id;
  const encuentros = [];
  for (const m of [1, 2, 3]) {
    encuentros.push((await query(`INSERT INTO talleres_encuentros (taller_id, modulo, inicio, asistencia, realizado_en) VALUES ($1, $2, $3, $4, $3) RETURNING id`,
      [taller, m, `2024-05-0${m + 1}T14:00:00Z`, JSON.stringify([`up:${s1}`, `up:${s3}`])])).rows[0].id);
  }
  await query(`INSERT INTO talleres_soportes (encuentro_id, nombre, mime, archivo, creado_por, creado_en)
    VALUES ($1, 'planilla.png', 'image/png', $2, 'tallerista:9', '2024-05-31T23:00:00-05:00')`, [encuentros[0], pngBytes]);
  await query(`INSERT INTO talleres_entregas_finales (taller_id, id_up, nombre, archivo, creado_por) VALUES ($1, $2, 'final.pdf', $3, 'tallerista:9')`, [taller, s1, pdfBytes]);
  await query(`INSERT INTO inventario.facturas (numero, adjunto, adjunto_nombre, id_unico, creado_por) VALUES ('FE12-S1', $1, 'factura.pdf', 'E12-S1', 'Coord')`, [pdfBytes]);
  const bodega = (await query("INSERT INTO inventario.bodegas (nombre, tipo) VALUES ('Bodega E12-S', 'principal') RETURNING id")).rows[0].id;
  const kit1 = (await query("INSERT INTO inventario.combos (nombre, codigo_barras) VALUES ('e12-s1', 'KIT-E12-S1') RETURNING id")).rows[0].id;
  const kit2 = (await query("INSERT INTO inventario.combos (nombre, codigo_barras) VALUES ('E12-S2 ', 'KIT-E12-S2') RETURNING id")).rows[0].id;
  const entrega1 = (await query(`INSERT INTO inventario.entregas_kits (combo_id, bodega_id, responsable, adjunto, adjunto_nombre, adjunto_tipo, creado_por, fecha)
    VALUES ($1, $2, '{}'::jsonb, $3, 'acta-kits.pdf', 'application/pdf', 'bodega', now() - interval '10 days') RETURNING id`, [kit1, bodega, pdfBytes])).rows[0].id;
  await query(`INSERT INTO inventario.entregas_kits (combo_id, bodega_id, responsable, adjunto, adjunto_nombre, adjunto_tipo, creado_por, fecha, adjunto_de)
    VALUES ($1, $2, '{}'::jsonb, NULL, 'acta-kits.pdf', 'application/pdf', 'bodega', now() - interval '10 days', $3)`, [kit2, bodega, entrega1]);
  const nov = (await query(`INSERT INTO inventario.kit_novedades (tipo, texto, foto, foto_nombre, foto_tipo, creado_por, estado)
    VALUES ('danado', 'Llegó roto', $1, 'roto.png', 'image/png', 'bodega', 'reportada') RETURNING id`, [pngBytes])).rows[0].id;
  await query('INSERT INTO inventario.kit_novedad_kits (novedad_id, combo_id) VALUES ($1, $2)', [nov, kit1]);

  // ---- [0] y [6]: el cálculo en bloque da lo mismo que el de una fila o un taller a la vez ----
  const talleresTodos = (await query('SELECT * FROM talleres_fortalecimiento ORDER BY id')).rows;
  const enBloque = await formacionReglas.cumplimientoTalleres({ query }, talleresTodos);
  for (const t of talleresTodos) assert.deepEqual(enBloque.get(t.id), await formacionReglas.cumplimientoTaller({ query }, t), `taller ${t.id}`);
  const { rows: kitsUp } = await query(`WITH ${defectuososSrv.CTE_UP_DE_KIT}
    SELECT c.id, ${defectuososSrv.SQL_UP_DE_KIT('c.nombre')} AS uno, ${defectuososSrv.ID_UP_DE_KIT()} AS bloque FROM inventario.combos c ${defectuososSrv.JOIN_UP_DE_KIT('c.nombre')}`);
  assert.ok(kitsUp.length > 2 && kitsUp.every((k) => k.uno === k.bloque), JSON.stringify(kitsUp.filter((k) => k.uno !== k.bloque)));
  assert.equal(kitsUp.find((k) => k.id === kit2).bloque, 'E12-S2');

  // ---- [1]: el índice y la descarga respetan los roles lectores del módulo dueño ----
  const origenes = async (u, id) => new Set((await seguimientoSrv.soportesUP(u, { id_unico: id })).items.map((x) => x.origen));
  const RESTRINGIDOS = ['evento', 'retiro', 'taller_final', 'taller_soporte', 'factura', 'kit_defectuoso', 'kit_entrega'];
  const deG1 = await origenes(G1, 'E12-S1');
  for (const o of RESTRINGIDOS) assert.equal(deG1.has(o), false, `el gestor no ve ${o}`);
  const deTec = await origenes(TECNICO_R1, 'E12-S1');
  for (const o of ['evento', 'retiro', 'kit_defectuoso']) assert.ok(deTec.has(o), `el técnico ve ${o}`);
  // El soporte de una entrega de varios kits cubre unidades de otros nodos: solo la coordinación (revisión E12 · [1]).
  for (const o of ['taller_final', 'taller_soporte', 'factura', 'kit_entrega']) assert.equal(deTec.has(o), false, `el técnico no ve ${o}`);
  const indiceClr = (await seguimientoSrv.soportesUP(LOCAL_R1, { id_unico: 'E12-S1' })).items;
  for (const o of RESTRINGIDOS) assert.ok(indiceClr.some((x) => x.origen === o), `la coordinación ve ${o}`);
  assert.equal(indiceClr.some((x) => 'huella' in x), false, 'la huella de la versión no sale en la respuesta');
  const refDe = (o) => indiceClr.find((x) => x.origen === o).ref;
  const bajar = (u, o) => seguimientoSrv.archivoSoporte(u, { id_unico: 'E12-S1', origen: o, ref: refDe(o) });
  for (const o of RESTRINGIDOS) await rechaza(bajar(G1, o), 404);
  for (const o of ['taller_final', 'taller_soporte', 'factura', 'kit_entrega']) await rechaza(bajar(TECNICO_R1, o), 404);
  for (const o of ['evento', 'retiro', 'kit_defectuoso']) assert.ok((await bajar(TECNICO_R1, o)).buffer.length > 0, o);
  for (const o of RESTRINGIDOS) assert.ok((await bajar(LOCAL_R1, o)).buffer.length > 0, o);
  const g1Http = await entrar('atlan1', '1001001001');
  assert.equal((await g1Http.http('GET', `/api/alistamiento/eventos/adjunto?id=${evRef}`)).status, 403, 'el módulo dueño se lo niega');
  assert.equal((await g1Http.http('GET', `/api/seguimiento/soportes/archivo?id_unico=E12-S1&origen=evento&ref=${evRef}`)).status, 404, 'y el seguimiento también');
  // [11] El soporte del taller lleva quién lo cargó.
  // Se muestra el nombre de la cuenta, nunca su clave interna ni una cédula (revisión E12 · [30]): «tallerista:9» no es una cuenta.
  assert.equal(indiceClr.find((x) => x.origen === 'taller_soporte').subido_por, null);

  // ---- [10]: la entrega de varios kits comparte el soporte guardado en la primera ----
  const kitS2 = (await seguimientoSrv.soportesUP(LOCAL_R1, { id_unico: 'E12-S2' })).items.find((x) => x.origen === 'kit_entrega');
  assert.ok((await seguimientoSrv.archivoSoporte(LOCAL_R1, { id_unico: 'E12-S2', origen: 'kit_entrega', ref: kitS2.ref })).buffer.equals(pdfBytes));

  // ---- [4] y [17]: la verificación es de la versión revisada; las versiones anteriores se listan y se descargan ----
  const nombreActa = '8870011/01_VISITA_1_CARACTERIZACION/acta.pdf';
  await archivos.guardarArchivo({ contenedor: 'visitas', nombre: nombreActa, archivo: await archivoTemporal('acta.pdf', '%PDF-1.4 primera versión'), idUp: s1, usuario: G1 });
  const refActa = `visitas/${nombreActa}`;
  const actaDe = async (u = LOCAL_R1) => (await seguimientoSrv.soportesUP(u, { id_unico: 'E12-S1' })).items.find((x) => x.origen === 'archivo' && x.ref === refActa);
  await seguimientoSrv.verificarSoporte(TECNICO_R1, { id_unico: 'E12-S1', origen: 'archivo', ref: refActa, observacion: 'Foto legible' });
  assert.equal((await actaDe()).verificacion.observacion, 'Foto legible');
  await archivos.guardarArchivo({ contenedor: 'visitas', nombre: nombreActa, archivo: await archivoTemporal('acta.pdf', '%PDF-1.4 segunda versión'), idUp: s1, usuario: G1 });
  let acta = await actaDe(G1);
  assert.equal(acta.verificacion, null, 'el documento nuevo nadie lo ha revisado');
  assert.deepEqual([acta.versiones, acta.anteriores.length], [1, 1]);
  const anterior = await seguimientoSrv.archivoSoporte(G1, { id_unico: 'E12-S1', origen: 'version', ref: String(acta.anteriores[0].id) });
  assert.match(anterior.buffer.toString(), /primera versión/);
  assert.equal(anterior.tipo, 'application/pdf');
  assert.ok(acta.anteriores[0].url.includes('origen=version'), acta.anteriores[0].url);
  await rechaza(seguimientoSrv.archivoSoporte(G2, { id_unico: 'E12-S1', origen: 'version', ref: String(acta.anteriores[0].id) }), 403);
  await rechaza(seguimientoSrv.archivoSoporte(G1, { id_unico: 'E12-A', origen: 'version', ref: String(acta.anteriores[0].id) }), 404);
  // [20] Por HTTP: el técnico verifica (la excepción de auth.js) y cualquier otra escritura sigue cerrada.
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, cedula, region)
    VALUES ('C-TE12', 'tecnico_administrativo', 'tec.e12', $1, 'Técnico E12', '52000412', 'Región 1')`, [await hashClave('Tecnico-E12-2026x')]);
  const tec = await entrar('tec.e12', 'Tecnico-E12-2026x');
  assert.equal(tec.r.status, 200, JSON.stringify(tec.r.json));
  const verificar = await tec.http('POST', '/api/seguimiento/soportes/verificar', { id_unico: 'E12-S1', origen: 'archivo', ref: refActa, observacion: 'Segunda versión revisada' });
  assert.equal(verificar.status, 200, JSON.stringify(verificar.json));
  assert.equal((await actaDe()).verificacion.verificado_por, 'Técnico E12');
  const otra = await tec.http('POST', '/api/metas', { metas: [] });
  assert.equal(otra.status, 403);
  assert.match(otra.json.error, /solo consulta/);
  assert.equal((await tec.http('POST', '/api/casos/documentar', { id: 1 })).status, 403);
  // [17] Dos reemplazos simultáneos guardan dos versiones distintas y ningún archivo queda sin registro.
  await Promise.all([1, 2].map(async (n) => archivos.guardarArchivo({ contenedor: 'visitas', nombre: nombreActa,
    archivo: await archivoTemporal('acta.pdf', `%PDF-1.4 simultánea ${n}`), idUp: s1, usuario: G1 })));
  const { rows: vers } = await query('SELECT ruta_relativa FROM archivos_versiones WHERE contenedor = $1 AND nombre = $2', ['visitas', nombreActa]);
  const { rows: [vigente] } = await query('SELECT ruta_relativa FROM archivos WHERE contenedor = $1 AND nombre = $2', ['visitas', nombreActa]);
  assert.equal(vers.length, 3);
  assert.equal(new Set([...vers.map((v) => v.ruta_relativa), vigente.ruta_relativa]).size, 4, 'cada carga queda como vigente o como versión');
  // Al eliminar un formato se van también sus versiones: si se vuelve a subir, empieza sin historia.
  await visitas.subirFormato(COORD, {}, await archivoTemporal('FORMATO E12.pdf', '%PDF-1.4 formato 1'));
  await visitas.subirFormato(COORD, {}, await archivoTemporal('FORMATO E12.pdf', '%PDF-1.4 formato 2'));
  const versionesFormato = async () => (await query("SELECT count(*)::int AS n FROM archivos_versiones WHERE contenedor = 'visitas-formatos' AND nombre = 'FORMATO E12.pdf'")).rows[0].n;
  assert.equal(await versionesFormato(), 1);
  await visitas.eliminarFormato(COORD, { nombre: 'FORMATO E12.pdf' });
  assert.equal(await versionesFormato(), 0);
  await rechaza(visitas.eliminarFormato(COORD, { nombre: 'FORMATO E12.pdf' }), 404);

  // ---- [9]: un soporte compartido sale verificado en todas sus unidades ----
  await seguimientoSrv.verificarSoporte(TECNICO_R1, { id_unico: 'E12-S1', origen: 'evento', ref: evRef, observacion: 'Lista completa' });
  const eventoEn = async (id) => (await seguimientoSrv.soportesUP(LOCAL_R1, { id_unico: id })).items.find((x) => x.origen === 'evento' && x.ref === evRef);
  assert.equal((await eventoEn('E12-S2')).verificacion?.observacion, 'Lista completa');
  await seguimientoSrv.verificarSoporte(TECNICO_R1, { id_unico: 'E12-S2', origen: 'evento', ref: evRef, observacion: 'Revisada desde S2' });
  assert.equal((await eventoEn('E12-S1')).verificacion.observacion, 'Revisada desde S2');
  const ver = await ultimaActividadCarrito('soporte.verificar');
  assert.deepEqual([ver.id_unico, ver.cambios.campos.verificado, ver.cambios.campos.observacion], ['E12-S2', [true, true], ['Lista completa', 'Revisada desde S2']]);

  // ---- [3] y [26]: las metas se comparan con el alcance y los filtros; cobertura región × modalidad ----
  let r = await seguimientoSrv.indicadores(LOCAL_R1, { agrupar: 'modalidad' });
  const m1 = r.items.find((x) => x.grupo === 'M1');
  assert.equal(m1.meta, 3000, 'la meta de M1 de la Región 1, no la nacional (5000)');
  assert.equal(m1.cobertura_pct, Math.round((m1.unidades / 3000) * 1000) / 10);
  assert.equal(r.total.meta, 3300, 'las metas regionales de la Región 1');
  assert.ok(r.por_region_modalidad.length && r.por_region_modalidad.every((x) => x.region === 'Región 1'), JSON.stringify(r.por_region_modalidad));
  const celda = r.por_region_modalidad.find((x) => x.modalidad === 'M1');
  assert.deepEqual([celda.meta, celda.unidades, celda.cobertura_pct], [3000, m1.unidades, m1.cobertura_pct]);
  assert.equal(r.por_region_modalidad.find((x) => x.modalidad === 'M2').meta, 300);
  assert.equal((await seguimientoSrv.panel(LOCAL_R1)).total.meta, 3300);
  assert.ok((await seguimientoSrv.panel(LOCAL_R1)).por_region_modalidad.some((x) => x.modalidad === 'M1' && x.meta === 3000));
  assert.equal((await seguimientoSrv.indicadores(COORD)).total.meta, 5300, 'el nivel nacional sin filtros: todas las regiones');
  assert.equal((await seguimientoSrv.indicadores(COORD, { region: 'Región 2' })).total.meta, 2000);
  assert.equal((await seguimientoSrv.indicadores(COORD, { departamento: 'Atlántico', modalidad: 'M1' })).total.meta, 1200, 'con departamento, su meta');
  assert.equal((await seguimientoSrv.indicadores(local({ nodo: 'ATLAN1' }))).total.meta, null, 'las metas no van por nodo');
  // [16] El grupo sin dato lleva tilde.
  await query("INSERT INTO unidades_productivas (id_origen, id_unico, nombre, modalidad) VALUES ('E12-SR', 'E12-SR', 'Sin tríada E12', 'M1')");
  const grupos = (await seguimientoSrv.indicadores(COORD, { agrupar: 'region' })).items.map((x) => x.grupo);
  assert.ok(grupos.includes('Sin región') && !grupos.includes('Sin region'), grupos.join(', '));
  await query("DELETE FROM unidades_productivas WHERE id_unico = 'E12-SR'");

  // ---- [2]: los indicadores filtran por región, modalidad, departamento y unidad ----
  const todo = await seguimientoSrv.indicadores(COORD, { agrupar: 'region' });
  assert.ok(todo.total.unidades > 1);
  const deR2 = await seguimientoSrv.indicadores(COORD, { agrupar: 'modalidad', region: 'Región 2' });
  assert.ok(deR2.total.unidades < todo.total.unidades && deR2.total.meta === 2000, JSON.stringify(deR2.total));
  assert.equal((await seguimientoSrv.indicadores(COORD, { id_unico: 'E12-A' })).total.unidades, 1, 'filtra por una unidad');
  assert.ok((await seguimientoSrv.indicadores(COORD, { agrupar: 'departamento' })).items.every((g) => !g.producto.reservado), 'ningún grupo se oculta');
  // Con un alcance por nodo las metas no aplican, y la respuesta lo dice (no es que no haya metas).
  assert.equal((await seguimientoSrv.panel(local({ region: 'región 1', nodo: 'ATLAN1' }))).metas_por_nodo, true);
  assert.equal((await seguimientoSrv.panel(LOCAL_R1)).metas_por_nodo, false);

  // ---- [12]: la entrega del seguimiento es la misma de la Visita 3 (manda el MASTER ENTREGAS; cuenta el plan entregado) ----
  await query(`INSERT INTO entregas_ups (id_unico, id_up, nodo, doc) VALUES ('E12-S2', $1, 'ATLAN1', jsonb_build_object('excel_fecha_entrega_efectiva', $2::text))`, [s2, diasAtras(50)]);
  const entregaS2 = (await seguimientoSrv.rutaOperacion(COORD, { id_unico: 'E12-S2' })).items[0].pasos.entrega;
  assert.deepEqual([entregaS2.logrado, entregaS2.fecha], [true, diasAtras(50)]);
  assert.equal(await reglas.fechaEntregaUP({ query }, { id_unico: 'E12-S2' }), diasAtras(50));
  assert.equal((await seguimientoSrv.rutaOperacion(COORD, { id_unico: 'E12-S1' })).items[0].pasos.entrega.fecha, diasAtras(10), 'el kit lleva el ID de la unidad');
  assert.equal(await reglas.fechaEntregaUP({ query }, { id_unico: 'E12-A' }), diasAtras(40), 'la Visita 3 acepta el plan entregado, como la ruta');
  r = await seguimientoSrv.alertas(COORD);
  assert.ok(r.items.some((x) => x.tipo === 'v3_pendiente' && x.id_unico === 'E12-S2'), 'entregada hace 50 días según el MASTER');
  // [5] Sin el 80 %: solo la unidad que ya no puede llegar (S2: ningún módulo, máximo 40 %). S3 tiene 60 % con los tres
  // módulos y aún le faltan la encuesta de salida y la entrega final (puede llegar a 100 %); S1 cumple (4 de 5).
  const sin80 = r.items.filter((x) => x.tipo === 'sin_80').map((x) => x.id_unico);
  assert.ok(sin80.includes('E12-S2'), sin80.join(', '));
  assert.equal(sin80.includes('E12-S1') || sin80.includes('E12-S3'), false, sin80.join(', '));
  const formS3 = (await seguimientoSrv.reporteFormacion(COORD)).items.find((x) => x.id_unico === 'E12-S3');
  assert.deepEqual([formS3.porcentaje, formS3.cumple, formS3.taller_terminado], [60, false, true]);
  // [14] Una unidad no habilitada no sale con su visita abierta.
  const { rows: [{ habilitada }] } = await query("SELECT habilitada FROM unidades_productivas WHERE id_unico = 'E12-B'");
  await query("UPDATE unidades_productivas SET habilitada = FALSE WHERE id_unico = 'E12-B'");
  assert.equal((await seguimientoSrv.alertas(COORD)).items.some((x) => x.id_unico === 'E12-B'), false);
  await query("UPDATE unidades_productivas SET habilitada = $1 WHERE id_unico = 'E12-B'", [habilitada]);

  // ---- [7], [8], [11] y [13]: consolidado y multimedia por día de Colombia; acumulado al cierre del periodo ----
  const mayo = await seguimientoSrv.consolidadoMensual(COORD, { periodo: '2024-05' });
  assert.deepEqual([mayo.totales.periodo.retiros, mayo.totales.periodo.sesiones], [1, 2], 'el retiro de la noche del 31 cuenta en mayo; S2 no asistió');
  assert.equal((await seguimientoSrv.consolidadoMensual(COORD, { periodo: '2024-06' })).totales.periodo.retiros, 0);
  const marzo = await seguimientoSrv.consolidadoMensual(COORD, { periodo: '2025-03' });
  const ahora = await seguimientoSrv.consolidadoMensual(COORD, { periodo: hoyIso().slice(0, 7) });
  assert.ok(marzo.totales.acumulado.entrega < ahora.totales.acumulado.entrega, 'el acumulado de marzo de 2025 no cuenta las entregas posteriores');
  assert.ok(marzo.totales.acumulado.visita1 >= 1);
  assert.match(marzo.metricas_acumulado.formacion, /a la fecha de generación/);
  assert.match(marzo.nota, /antes del 2025-04-01/);
  const multimediaMayo = await seguimientoSrv.multimediaMensual(LOCAL_R1, { periodo: '2024-05' });
  assert.ok(multimediaMayo.items.some((x) => x.serie === 'formacion' && x.region === 'Región 1' && x.fotos === 1), JSON.stringify(multimediaMayo.items));
  assert.equal(await entregaFotos(), fotosAntes + 1, 'la foto general de la novedad, por el kit de la unidad');

  // ---- [18]: no se generan meses anteriores a la operación; el informe, el correo y la actividad van juntos ----
  assert.deepEqual(await seguimientoSrv.generarInformeProgramado({ hoy: '2000-02-15' }), { periodo: '2000-01', generado: false });
  assert.equal((await query("SELECT count(*)::int AS n FROM informes_mensuales WHERE periodo = '2000-01'")).rows[0].n, 0);
  r = await seguimientoSrv.generarInformeProgramado({ hoy: '2024-06-10' });
  assert.deepEqual([r.periodo, r.generado], ['2024-05', true]);
  const act = await ultimaActividadCarrito('informe.mensual');
  assert.deepEqual([act.objeto_id, act.usuario_rol, act.cambios.periodo, act.cambios.campos.informe], [String(r.id), 'sistema', '2024-05', [null, '2024-05']]);

  // ---- [19]: el diccionario de KOKAN dice lo que se exporta ----
  assert.equal(seguimientoSrv.DICCIONARIO_KOKAN.find((c) => c.campo === 'estado').formato, 'Cumplida');
});

// ---------------- E12 · Trazabilidad (TR-15 / DOC-04) ----------------
test('E12 trazabilidad: las escrituras quedan en la actividad con antes y después', async () => {
  const tickets = await import('../src/servicios/tickets.js');
  await upE4('E12T-A', '8890001', 'M1 - Individual');
  const fila = async (accion) => (await query('SELECT * FROM actividad WHERE accion = $1 ORDER BY id DESC LIMIT 1', [accion])).rows[0];

  // Agenda: crear la cita y marcar su resultado; el antes es la cita guardada. Quedan en el historial de la U.P.
  const inicio = new Date(Date.now() + 2 * 86400000).toISOString();
  const cita = (await agenda.guardarCita(G1, { id_unico: 'E12T-A', tipo: 'llamada', inicio, motivo: 'Seguimiento E12' })).item;
  let a = await fila('agenda.guardar');
  assert.deepEqual([a.id_unico, a.usuario_sub, a.cambios.nuevo], ['E12T-A', 'g1', true]);
  assert.deepEqual(a.cambios.campos.motivo, [null, 'Seguimiento E12']);
  await agenda.cambiarEstadoCita(G1, { id: cita.id, estado: 'realizada', notas: 'Contestó' });
  a = await fila('agenda.estado');
  assert.equal(a.id_unico, 'E12T-A');
  assert.deepEqual(a.cambios.campos.estado, ['agendada', 'realizada']);
  assert.deepEqual(a.cambios.campos.notas, [null, 'Contestó']);
  assert.equal(a.cambios.campos.inicio, undefined, 'solo lo que cambió');

  // Tickets: el antes es la fila leída con FOR UPDATE.
  const tk = (await tickets.crearTicket(G1, { titulo: 'E12T ticket', descripcion: 'Falla de prueba para la trazabilidad', etapa: 'diagnostico' })).item;
  assert.deepEqual((await fila('tickets.crear')).cambios.campos.estado, [null, 'abierto']);
  await tickets.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'tomar' });
  const t = await fila('tickets.tomar');
  assert.deepEqual([t.objeto_id, t.usuario_sub], [String(tk.id), 'coordinador:9']);
  assert.deepEqual(t.cambios.campos, { estado: ['abierto', 'en_gestion'] });

  // Avisos: crear y editar (título y destinatarios antes → después).
  await com.guardarAviso(COORD, { id: 'E12T-AV1', titulo: 'Aviso E12', cuerpo: 'Primero', destinatarios: ['ATLAN1'] });
  assert.equal((await fila('avisos.guardar')).cambios.nuevo, true);
  await com.guardarAviso(COORD, { id: 'E12T-AV1', titulo: 'Aviso E12 corregido', cuerpo: 'Primero', destinatarios: ['ATLAN1', 'BOLIV1'] });
  const av = await fila('avisos.guardar');
  assert.equal(av.cambios.nuevo, false);
  assert.deepEqual(av.cambios.campos.titulo, ['Aviso E12', 'Aviso E12 corregido']);
  assert.deepEqual(av.cambios.campos.destinatarios, [['ATLAN1'], ['ATLAN1', 'BOLIV1']]);
  assert.equal(av.cambios.campos.cuerpo, undefined);

  // Lo cargado por el Profesional de seguimiento: el valor anterior sale del CTE; la respuesta no cambia.
  const valorAntes = (await query(`SELECT e.subsanaciones_proceso AS v FROM expedientes_up e
    JOIN unidades_productivas up ON up.id_up = e.id_up WHERE up.id_unico = '1'`)).rows[0].v;
  const ed = await documentos.editarCargado(DATOS, { id_unico: '1', valor: 'E12T en subsanación' });
  assert.deepEqual(Object.keys(ed.item).sort(), ['fecha_actualizacion', 'id_unico', 'valor']);
  const c = await fila('cargue.editar');
  assert.equal(c.id_unico, '1');
  assert.deepEqual(c.cambios.campos.proceso_subsanacion, [valorAntes, 'E12T en subsanación']);

  // Archivos por la ruta de la coordinación: el segundo con el mismo nombre es un reemplazo, enlazado a la U.P.
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const idJefe = (await query("SELECT id FROM superadmins WHERE usuario = 'jefe'")).rows[0].id;
  const multipart = async (s, ruta, campos, archivo) => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== null && v !== undefined) form.append(k, String(v));
    if (archivo) form.append(archivo.campo, new Blob([archivo.contenido], { type: 'application/pdf' }), archivo.nombre);
    const r = await fetch(`${base}${ruta}`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: form });
    return { status: r.status, json: await r.json() };
  };
  const subir = () => multipart(jefe, '/api/archivos', { contenedor: 'prellenados', nombre: '8890001/E12T-formato.pdf', id_unico: 'E12T-A' },
    { campo: 'archivo', contenido: '%PDF-1.4 formato E12', nombre: 'formato.pdf' });
  const s1 = await subir();
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  assert.deepEqual(Object.keys(s1.json.item).sort(), ['contenedor', 'nombre', 'url'], 'la respuesta no cambia');
  assert.equal((await fila('archivos.subir')).id_unico, 'E12T-A');
  assert.equal((await subir()).status, 200);
  const rep = await fila('archivos.reemplazar');
  assert.deepEqual([rep.id_unico, rep.objeto_id, rep.usuario_sub], ['E12T-A', 'prellenados/8890001/E12T-formato.pdf', `superadmin:${idJefe}`]);

  // Inventario por HTTP: el kit de la U.P. y su entrega quedan en su historial, con la cuenta real de la sesión.
  const m1 = (await query("SELECT id FROM inventario.bodegas WHERE nombre = 'Kits municipal 1'")).rows[0].id;
  const art = (await query(`INSERT INTO inventario.articulos (nombre, codigo_proveedor, codigo_barras, stock)
    VALUES ('E12T artículo', 'E12T-ART', 'E12T-ART', 5) RETURNING id`)).rows[0].id;
  await query('INSERT INTO inventario.stock_bodega (bodega_id, articulo_id, cantidad) VALUES ($1, $2, 5)', [m1, art]);
  const kit = await jefe.http('POST', '/api/inv/kits', { nombre: 'E12T-A', items: [{ articulo_id: art, cantidad: 2 }] });
  assert.equal(kit.status, 200, JSON.stringify(kit.json));
  const k = await fila('kit.crear');
  assert.deepEqual([k.id_unico, k.usuario_sub, k.objeto_id], ['E12T-A', `superadmin:${idJefe}`, String(kit.json.id)]);
  const rid = (await query("SELECT id FROM inventario.responsables_entrega WHERE documento = '123456789'")).rows[0].id;
  const ent = await multipart(jefe, '/api/inv/entregas-kits', { combo_id: kit.json.id, responsable_id: rid, bodega_id: m1, nota: 'Entrega E12' },
    { campo: 'adjunto', contenido: '%PDF-1.4 entrega E12', nombre: 'acta-e12.pdf' });
  assert.equal(ent.status, 200, JSON.stringify(ent.json));
  const e = await fila('kit.entrega');
  assert.deepEqual([e.id_unico, e.usuario_sub, e.objeto_id], ['E12T-A', `superadmin:${idJefe}`, String(ent.json.id)]);
  assert.deepEqual(e.cambios.items, [['E12T artículo', 2]]);
  assert.equal(e.cambios.responsable.id, rid);
  assert.equal(JSON.stringify(e.cambios).includes('123456789'), false, 'el documento del responsable no va a la actividad');
  // El actor ya no se arma como «inventario:<id>» para una sesión del superadmin (antes quedaba con el id equivocado).
  const inst = await multipart(jefe, `/api/inv/entregas-kits/${ent.json.id}/instalacion`, { aplica: 'no', observaciones: 'No requiere instalación' });
  assert.equal(inst.status, 200, JSON.stringify(inst.json));
  const i = await fila('kit.instalacion');
  assert.deepEqual([i.usuario_sub, i.usuario_rol, i.id_unico], [`superadmin:${idJefe}`, 'superadmin', 'E12T-A']);

  // Más escrituras del inventario: kit armado y en una orden con su evidencia (y sus borrados), kit y artículo eliminados, lote borrado.
  const kitB = (await jefe.http('POST', '/api/inv/kits', { nombre: 'E12T kit B', items: [{ articulo_id: art, cantidad: 1 }] })).json.id;
  assert.equal((await jefe.http('POST', `/api/inv/kits/${kitB}/armar`)).status, 200);
  assert.deepEqual((await fila('kit.armar')).cambios.campos.armado, [false, true]);
  const orden = await jefe.http('POST', '/api/inv/ordenes', { destino: 'Barranquilla', lineas: [{ ref_id: kitB, cantidad: 1 }] });
  assert.equal(orden.status, 200, JSON.stringify(orden.json));
  assert.deepEqual(Object.keys(orden.json).filter((x) => ['id', 'numero', 'kits'].includes(x)).sort(), ['id', 'numero'], 'la respuesta no cambia');
  assert.deepEqual((await fila('inventario.orden_crear')).cambios.kits, [['E12T kit B', 1]]);
  assert.equal((await jefe.http('POST', '/api/inv/evidencias', { orden_id: orden.json.id, placa: 'ABC123', transportista: 'Transporte E12' })).status, 200);
  const ev = await fila('inventario.evidencia_crear');
  assert.equal(ev.cambios.orden, orden.json.id);
  assert.equal((await jefe.http('DELETE', `/api/inv/evidencias/${ev.objeto_id}`)).status, 200);
  assert.equal((await fila('inventario.evidencia_eliminar')).objeto_id, ev.objeto_id);
  assert.equal((await jefe.http('DELETE', `/api/inv/ordenes/${orden.json.id}`)).status, 200);
  assert.equal((await fila('inventario.orden_eliminar')).cambios.numero, orden.json.numero);
  const kitC = (await jefe.http('POST', '/api/inv/kits', { nombre: 'E12T-A kit C', items: [{ articulo_id: art, cantidad: 1 }] })).json.id;
  assert.equal((await jefe.http('DELETE', `/api/inv/kits/${kitC}`)).status, 200);
  assert.equal((await fila('kit.eliminar')).cambios.nombre, 'E12T-A kit C');
  const suelto = (await query(`INSERT INTO inventario.articulos (nombre, codigo_proveedor, codigo_barras, stock)
    VALUES ('E12T suelto', 'E12T-SUELTO', 'E12T-SUELTO', 3) RETURNING id`)).rows[0].id;
  assert.equal((await jefe.http('DELETE', `/api/inv/articulos/${suelto}`)).status, 200);
  assert.deepEqual((await fila('inventario.articulo_eliminar')).cambios.campos, { activo: [true, false] });
  const lote = (await query("INSERT INTO inventario.lotes (numero, nombre, archivo) VALUES (9912, 'Lote E12T', 'e12t.xlsx') RETURNING id")).rows[0].id;
  assert.equal((await jefe.http('DELETE', `/api/inv/pedidos/${lote}`)).status, 200);
  assert.deepEqual((await fila('inventario.pedido_eliminar')).cambios, { numero: 9912, nombre: 'Lote E12T', archivo: 'e12t.xlsx' });

  // Primera lectura de un aviso por el gestor: queda una vez (leerlo de nuevo no cambia nada).
  const antesLeer = (await query("SELECT count(*)::int AS n FROM actividad WHERE accion = 'avisos.leer'")).rows[0].n;
  await com.marcarAvisoLeido(G1, { id: 'E12T-AV1' });
  await com.marcarAvisoLeido(G1, { id: 'E12T-AV1' });
  assert.equal((await query("SELECT count(*)::int AS n FROM actividad WHERE accion = 'avisos.leer'")).rows[0].n, antesLeer + 1);
  const leido = await fila('avisos.leer');
  assert.deepEqual([leido.cambios.nodo, leido.cambios.campos.fecha_lectura[0]], ['ATLAN1', null]);

  // Historial de la U.P.: el Coordinador local regional ve todas las acciones de su alcance; el gestor, solo compras y entregas.
  const deClr = (await actividad.listarActividad(LOCAL_R1, { up: 'E12T-A' })).items.map((x) => x.accion);
  for (const acc of ['agenda.guardar', 'agenda.estado', 'archivos.reemplazar', 'kit.crear', 'kit.entrega', 'kit.instalacion']) {
    assert.ok(deClr.includes(acc), `el CLR ve ${acc} (ve: ${deClr.join(', ')})`);
  }
  const deGestor = (await actividad.listarActividad(G1, { up: 'E12T-A' })).items;
  assert.ok(deGestor.every((x) => /^(compras|entrega)\./.test(x.accion)), 'el gestor sigue viendo solo compras y entregas');
  await rechaza(actividad.listarActividad(local({ region: 'región 2' }), { up: 'E12T-A' }), 404);
});

test('E12 trazabilidad (revisión): sin teléfonos, correos ni cédulas; una fila por U.P. en los cargues; el regional sin «up» solo ve su alcance', async () => {
  const { cuentasGestionables, claveDeCuenta } = await import('../src/acceso/jerarquia.js');
  const fila = async (accion) => (await query('SELECT * FROM actividad WHERE accion = $1 ORDER BY id DESC LIMIT 1', [accion])).rows[0];
  const incluye = (v, textos) => textos.some((t) => JSON.stringify(v).includes(t));

  // Agenda: del número al que se llama y de la persona de contacto solo queda que cambiaron, no su valor.
  const inicio = new Date(Date.now() + 3 * 86400000).toISOString();
  const cita = (await agenda.guardarCita(G1, { id_unico: 'E12T-A', tipo: 'llamada', inicio, motivo: 'Llamada E12R', telefono: '3009990001', contacto: 'Contacto Privado E12R' })).item;
  let a = await fila('agenda.guardar');
  assert.deepEqual([a.cambios.campos.telefono, a.cambios.campos.contacto, a.cambios.campos.motivo], ['(modificado)', '(modificado)', [null, 'Llamada E12R']]);
  await agenda.guardarCita(G1, { id: cita.id, telefono: '3009990002' });
  a = await fila('agenda.guardar');
  assert.deepEqual(a.cambios, { nuevo: false, campos: { telefono: '(modificado)' } });
  const privados = ['3009990001', '3009990002', 'Contacto Privado E12R'];
  assert.equal(incluye((await actividad.listarActividad(LOCAL_R1, { up: 'E12T-A' })).items, privados), false, 'el historial de la U.P. no trae el número ni el contacto');

  // Validador: de los correos solo queda que cambiaron; el objeto es el id interno del ciudadano, no su cédula.
  const idCiudadano = async (cedula) => String((await query('SELECT id_ciudadano FROM ciudadanos WHERE cedula = $1', [cedula])).rows[0].id_ciudadano);
  const correo = 'e12r.persona@correo.com';
  assert.equal((await validador.procesar(G1, { action: 'guardar_correo', cedula: '222', correo_personal: correo })).cuerpo.exito, true);
  const vc = await fila('validador.correo');
  assert.deepEqual([vc.objeto_id, vc.id_unico, vc.cambios], [await idCiudadano('222'), '2', { campos: { email: '(modificado)' } }]);
  assert.equal(incluye(vc, [correo]), false);
  await validador.procesar(G1, { action: 'upload', cedula: '222', tipo_entrega: 'nunca' }, {});
  const vs = await fila('validador.subir');
  assert.deepEqual([vs.objeto_id, vs.resultado, vs.id_unico], [await idCiudadano('222'), 'rechazado', null]);
  const docPrevio = (await query(`SELECT cd.id_ciudadano, cd.id_tipo_documento, cd.estado, cd.observacion, c.estado_validacion
      FROM ciudadano_documentos cd JOIN tipos_documento td ON td.id_tipo_documento = cd.id_tipo_documento
      JOIN ciudadanos c ON c.id_ciudadano = cd.id_ciudadano WHERE c.cedula = '111' AND td.codigo = 'orden_pedido'`)).rows[0];
  assert.ok(docPrevio, 'la orden de pedido de la cédula 111 está cargada');
  const rev = await validador.procesar(COORD, { action: 'revisar', cedula: '111', clave: 'orden_pedido', estado: 'rechazado', observacion: 'E12R falta la firma' });
  assert.equal(rev.cuerpo.exito, true);
  const vr = await fila('validador.revisar');
  assert.deepEqual([vr.objeto_id, vr.id_unico, vr.cambios.soporte], [String(docPrevio.id_ciudadano), '1', 'orden_pedido']);
  // El soporte queda como estaba para las pruebas que siguen.
  await query('UPDATE ciudadano_documentos SET estado = $3, observacion = $4 WHERE id_ciudadano = $1 AND id_tipo_documento = $2',
    [docPrevio.id_ciudadano, docPrevio.id_tipo_documento, docPrevio.estado, docPrevio.observacion]);
  await query('UPDATE ciudadanos SET estado_validacion = $2 WHERE id_ciudadano = $1', [docPrevio.id_ciudadano, docPrevio.estado_validacion]);

  // Cargues masivos: la fila del cargue (sin U.P.) y una por U.P. cambiada, con su id_unico y cambios.campos.
  const cuentas = await cuentasGestionables(LOCAL_R1);
  const subDe = (rol) => {
    const c = cuentas.find((x) => x.rol === rol);
    assert.ok(c, `hay una cuenta ${rol} bajo el regional`);
    return claveDeCuenta(c);
  };
  const datosReal = { ...DATOS, sub: subDe('coordinador_datos') };
  const comprasReal = { ...COMPRAS, sub: subDe('coordinador_compras') };
  const porUnidad = async (accion, lote) => (await query(
    "SELECT id::text AS id, id_unico, cambios FROM actividad WHERE accion = $1 AND cambios->>'lote' = $2 ORDER BY id_unico", [accion, String(lote)])).rows;
  const valorDe = async (idUnico) => (await query(`SELECT e.subsanaciones_proceso AS v FROM expedientes_up e
    JOIN unidades_productivas up ON up.id_up = e.id_up WHERE up.id_unico = $1`, [idUnico])).rows[0].v;
  const antes2 = await valorDe('2');
  const antes3 = await valorDe('3');
  const ap = await documentos.aplicarCargue(datosReal, { campo: 'proceso_subsanacion', filas: [{ id_unico: '2', valor: 'E12R subsanado' }, { id_unico: '3', valor: 'E12R otra región' }] });
  assert.equal(ap.actualizados, 2);
  const resumenDe = async (accion) => (await query('SELECT * FROM actividad WHERE accion = $1 AND id_unico IS NULL ORDER BY id DESC LIMIT 1', [accion])).rows[0];
  const resumenAp = await resumenDe('cargue.aplicar');
  assert.equal(resumenAp.id_unico, null);
  assert.deepEqual([resumenAp.cambios.actualizados, resumenAp.cambios.ids, resumenAp.cambios.unidades], [2, ['2', '3'], undefined]);
  const filasAp = await porUnidad('cargue.aplicar', resumenAp.id);
  assert.deepEqual(filasAp.map((x) => [x.id_unico, x.cambios.campos.proceso_subsanacion]),
    [['2', [antes2, 'E12R subsanado']], ['3', [antes3, 'E12R otra región']]]);
  const historial2 = (await actividad.listarActividad(ADMIN, { up: '2' })).items;
  assert.deepEqual(historial2.find((x) => x.accion === 'cargue.aplicar').cambios.campos.proceso_subsanacion, [antes2, 'E12R subsanado'],
    'el cambio por cargue está en el historial de la U.P.');
  const del = await documentos.eliminarCargados(datosReal, { campo: 'proceso_subsanacion', ids: ['3'] });
  assert.equal(del.eliminados, 1);
  const resumenDel = await resumenDe('cargue.eliminar');
  assert.deepEqual([resumenDel.id_unico, resumenDel.cambios.ids], [null, ['3']]);
  const filasDel = await porUnidad('cargue.eliminar', resumenDel.id);
  assert.deepEqual(filasDel.map((x) => [x.id_unico, x.cambios.campos.proceso_subsanacion]), [['3', ['E12R otra región', null]]]);
  await documentos.aplicarCargue(datosReal, { campo: 'proceso_subsanacion', filas: [{ id_unico: '2', valor: antes2 }] });
  if (antes3 !== null) await documentos.aplicarCargue(datosReal, { campo: 'proceso_subsanacion', filas: [{ id_unico: '3', valor: antes3 }] });

  // Compras retiradas por el cargue de vigentes: una fila por U.P. con vigente true → false.
  const vigentes = (await query('SELECT id_unico FROM items_ups WHERE vigente ORDER BY 1')).rows.map((x) => x.id_unico);
  assert.ok(vigentes.includes('2') && vigentes.includes('3'), vigentes.join(', '));
  const retiro = await compras.cargarCompras(comprasReal, { archivo: 'MASTER E12R.xlsx', vigentes: vigentes.filter((x) => !['2', '3'].includes(x)) });
  assert.equal(retiro.retiradas, 2);
  const resumenVig = await resumenDe('cargue.compras_vigentes');
  assert.deepEqual([resumenVig.cambios.retiradas, resumenVig.cambios.campos.vigente], [2, [true, false]]);
  const filasVig = await porUnidad('cargue.compras_vigentes', resumenVig.id);
  assert.deepEqual(filasVig.map((x) => [x.id_unico, x.cambios.campos.vigente]), [['2', [true, false]], ['3', [true, false]]]);
  // El gestor ve en el historial de su U.P. que el cargue la retiró de compras (revisión E12 · [24]).
  assert.ok((await actividad.listarActividad(G1, { up: '2' })).items.some((x) => x.accion === 'cargue.compras_vigentes'), 'el gestor ve el retiro por cargue');
  await query("UPDATE items_ups SET vigente = TRUE WHERE id_unico = ANY($1)", [['2', '3']]);
  // Las filas por U.P. no cuentan como operaciones aparte en «Usuarios activos».
  const { rows: [{ n: lotes }] } = await query(`SELECT count(*)::int AS n FROM actividad WHERE resultado = 'ok' AND NOT (cambios ? 'lote')
    AND usuario_sub = $1 AND accion = 'cargue.compras_vigentes'`, [comprasReal.sub]);
  assert.equal(lotes, 1);

  // Coordinador local regional sin «up»: de su jerarquía con territorio (y lo suyo), lo que no es de una U.P. o es de una
  // U.P. de su alcance; de las cuentas nacionales sin territorio (datos, compras, bodeguero), solo lo de U.P. de su alcance.
  const gestorReal = { sub: subDe('gestor'), rol: 'gestor', nombre: 'Gestor E12R', nodo: 'ATLAN1' };
  const bodeguero = { sub: subDe('bodeguero'), rol: 'bodeguero', nombre: 'Bodeguero E12R' };
  const ids = {
    gestorSinUp: await actividad.registrar(gestorReal, { accion: 'agenda.guardar', objeto: { tipo: 'cita', id: 'E12R' } }),
    gestorFuera: await actividad.registrar(gestorReal, { accion: 'agenda.guardar', objeto: { tipo: 'cita', id: 'E12R' }, idUnico: '3' }),
    propiaSinUp: await actividad.registrar(LOCAL_R1, { accion: 'avisos.guardar', objeto: { tipo: 'aviso', id: 'E12R' } }),
    bodegaSinUp: await actividad.registrar(bodeguero, { accion: 'inventario.traslado', objeto: { tipo: 'traslado', id: 1 } }),
    bodegaDentro: await actividad.registrar(bodeguero, { accion: 'kit.entrega', objeto: { tipo: 'entrega_kit', id: 1 }, idUnico: '2' }),
    bodegaFuera: await actividad.registrar(bodeguero, { accion: 'kit.entrega', objeto: { tipo: 'entrega_kit', id: 2 }, idUnico: '3' }),
  };
  assert.ok(Object.values(ids).every(Boolean), 'registrar devuelve el id de la fila');
  const vistos = new Set((await actividad.listarActividad(LOCAL_R1, { limite: 500 })).items.map((x) => x.id));
  const ve = (id) => vistos.has(String(id));
  assert.deepEqual(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, ve(id)])), {
    gestorSinUp: true, gestorFuera: false, propiaSinUp: true, bodegaSinUp: false, bodegaDentro: true, bodegaFuera: false,
  });
  assert.equal(ve(resumenAp.id) || ve(resumenDel.id) || ve(resumenVig.id), false, 'los cargues masivos del nivel nacional no');
  assert.deepEqual([filasAp, filasVig].map((f) => f.map((x) => [x.id_unico, ve(x.id)])), [[['2', true], ['3', false]], [['2', true], ['3', false]]],
    'de los cargues, solo las filas de U.P. de su alcance');
  assert.equal(ve(filasDel[0].id), false, 'la U.P. de otra región no');
  // Sin territorio asignado no ve filas de U.P.
  const sinTerritorio = (await actividad.listarActividad({ ...LOCAL_R1, alcance: {} }, { limite: 500 })).items.map((x) => x.id);
  assert.equal(sinTerritorio.includes(String(ids.bodegaDentro)), false);
});

// ---------------- E13 · Tickets con etapa, adjuntos, asignación, respuesta con anexos, confirmación y correo ----------------
test('E13 tickets: radicar con etapa, unidad y archivos; asignar a persona o rol; responder con anexos; confirmar, reabrir y cierre automático; correo', async () => {
  const t13 = await import('../src/servicios/tickets.js');
  const correoSrv = await import('../src/servicios/correo.js');
  const configSrv = await import('../src/servicios/configuracion.js');
  const pdf = (n) => archivoTemporal(n, '%PDF-1.4 ticket');
  const TECNICO_R2 = { ...local({ region: 'región 2' }), sub: 'tecnico:2', rol: 'tecnico_administrativo', nombre: 'Técnico 2' };
  const LOCAL_R2 = { ...local({ region: 'región 2' }), sub: 'coordinador:10' };

  // ---- TK-07: la lista de correos que siguen los tickets la registra el superadmin ----
  await rechaza(configSrv.accionConfig(LOCAL_R1, { accion: 'correos_tickets', correos: 'a@b.co' }), 403);
  await rechazaCon(configSrv.accionConfig(ADMIN, { accion: 'correos_tickets', correos: 'no-es-correo' }), 400, /no es un correo válido/);
  await configSrv.accionConfig(ADMIN, { accion: 'correos_tickets', correos: 'Financiero@Programa.co\nseguimiento@programa.co, financiero@programa.co' });
  assert.deepEqual(await configSrv.correosTickets(), ['financiero@programa.co', 'seguimiento@programa.co']);
  assert.equal((await configSrv.leerConfig(G1)).correos_tickets, undefined, 'solo el superadmin ve la lista');
  assert.deepEqual((await configSrv.leerConfig(ADMIN, { todos: '1' })).correos_tickets, ['financiero@programa.co', 'seguimiento@programa.co']);
  assert.equal((await ultimaActividadCarrito('config.correos_tickets')).cambios.campos.correos[1], 2);

  // ---- TK-01: radicar con etapa, unidad productiva y archivos ----
  await rechazaCon(t13.crearTicket(G1, { titulo: 'x', descripcion: 'y' }), 400, /etapa del proceso/);
  await rechazaCon(t13.crearTicket(G1, { titulo: 'x', descripcion: 'y', etapa: 'capitalizacion' },
    { adjuntos: [await archivoTemporal('f.pdf', 'no', 'application/pdf', { crudo: true })] }), 400, /PDF, JPG o PNG válido/);
  await rechazaCon(t13.crearTicket(G1, { titulo: 'x', descripcion: 'y', etapa: 'capitalizacion' },
    { adjuntos: await Promise.all([1, 2, 3, 4, 5, 6].map((i) => pdf(`a${i}.pdf`))) }), 400, /máximo 5 archivos/);
  await rechaza(t13.crearTicket(G2, { titulo: 'x', descripcion: 'y', etapa: 'diagnostico', id_unico: 'E12-A' }), 403);
  let r = await t13.crearTicket(G1, { titulo: 'Falta la factura', descripcion: 'El proveedor no la envió', etapa: 'capitalizacion', id_unico: 'E12-A' },
    { adjuntos: [await pdf('pedido.pdf'), await archivoTemporal('foto.png', Buffer.alloc(16, 3), 'image/png')] });
  const tk = r.item;
  assert.deepEqual([tk.consecutivo, tk.nombre_etapa, tk.region, tk.id_unico, tk.nivel, tk.estado, tk.adjuntos.length],
    [`TK-${String(tk.id).padStart(5, '0')}`, 'Capitalización', 'Región 1', 'E12-A', 'regional', 'abierto', 2]);
  assert.equal((await ultimaActividadCarrito('tickets.crear')).id_unico, 'E12-A');
  const correosDe = async () => (await query("SELECT para, asunto, texto, adjuntos FROM correos_salida WHERE origen = 'ticket' AND referencia = $1 ORDER BY id", [tk.consecutivo])).rows;
  let [c1] = await correosDe();
  assert.ok(c1.para.includes('financiero@programa.co'), 'llega a la lista del superadmin');
  for (const patron of [/Etapa: Capitalización/, /Región: Región 1/, /Unidad productiva: E12-A/, /El proveedor no la envió/, /pedido\.pdf \(radicación, adjunto\)/]) assert.match(c1.texto, patron);
  assert.match(c1.asunto, /^TK-\d{5} · Radicado · Falta la factura/);
  assert.equal((await correoSrv.adjuntosDeCorreo(c1)).map((a) => a.filename).join(','), 'pedido.pdf,foto.png');
  const adjunto = tk.adjuntos.find((a) => a.nombre === 'pedido.pdf');
  assert.equal((await t13.adjuntoTicket(G1, { id: adjunto.id })).tipo, 'application/pdf');
  await rechaza(t13.adjuntoTicket(G2, { id: adjunto.id }), 404);
  // La descarga tiene la misma visibilidad que la bandeja: el técnico y el CLR de otra región no ven el ticket ni sus archivos.
  await rechaza(t13.adjuntoTicket(TECNICO_R2, { id: adjunto.id }), 404);
  await rechaza(t13.adjuntoTicket(LOCAL_R2, { id: adjunto.id }), 404);
  assert.equal((await t13.adjuntoTicket(LOCAL_R1, { id: adjunto.id })).nombre, 'pedido.pdf', 'el CLR de la región sí lo descarga');
  // El nivel nacional también radica: queda en el nivel nacional con la región elegida.
  const delNacional = (await t13.crearTicket(DATOS, { titulo: 'Revisar metas', descripcion: 'Cifras de la región', etapa: 'administrativo', region: 'Región 1' })).item;
  assert.deepEqual([delNacional.nivel, delNacional.region, delNacional.puede.tomar], ['general', 'Región 1', true]);
  // El CLR radica sobre una unidad del nodo de G1: va al nivel nacional con la región de la unidad y sin nodo. El gestor
  // del nodo no lo ve (puede tratar de él); la coordinación de la región y el nivel nacional sí.
  const delClr = (await t13.crearTicket(LOCAL_R1, { titulo: 'Sobre la unidad', descripcion: 'Revisar la gestión del nodo', etapa: 'acompanamiento', id_unico: 'E12-A' })).item;
  assert.deepEqual([delClr.nivel, delClr.region, delClr.id_unico, delClr.nodo], ['general', 'Región 1', 'E12-A', null]);
  assert.ok(!(await t13.listarTickets(G1)).items.some((x) => x.id === delClr.id), 'el gestor del nodo no ve el ticket del CLR sobre su unidad');
  const OTRO_CLR_R1 = { ...local({ region: 'región 1' }), sub: 'coordinador:11' };
  assert.ok((await t13.listarTickets(OTRO_CLR_R1)).items.some((x) => x.id === delClr.id), 'la coordinación de la región lo ve por la región');
  assert.ok(!(await t13.listarTickets(LOCAL_R2)).items.some((x) => x.id === delClr.id));
  assert.ok((await t13.listarTickets(COORD)).items.some((x) => x.id === delClr.id));
  const sobreUnidad = (await t13.crearTicket(DATOS, { titulo: 'Metas de la unidad', descripcion: 'Revisar', etapa: 'administrativo', id_unico: 'E12-A' })).item;
  assert.equal(sobreUnidad.nodo, null);
  assert.ok(!(await t13.listarTickets(G1)).items.some((x) => x.id === sobreUnidad.id), 'tampoco el del nivel nacional sobre su unidad');

  // ---- TK-06: filtros de la bandeja ----
  assert.ok((await t13.listarTickets(LOCAL_R1, { etapa: 'capitalizacion' })).items.some((x) => x.id === tk.id));
  assert.ok(!(await t13.listarTickets(LOCAL_R1, { etapa: 'diagnostico' })).items.some((x) => x.id === tk.id));
  assert.deepEqual((await t13.listarTickets(LOCAL_R1, { q: tk.consecutivo })).items.map((x) => x.id), [tk.id]);

  // ---- TK-03: el CLR asigna a un rol de la región (cola) o a una persona de su territorio ----
  await rechaza(t13.gestionarTicket(G1, { id: tk.id, accion: 'asignar', asignado: 'rol:tecnico_administrativo' }), 403);
  await rechaza(t13.asignables(G1, { id: tk.id }), 403);
  const opciones = await t13.asignables(LOCAL_R1, { id: tk.id });
  assert.ok(opciones.roles.some((x) => x.rol === 'tecnico_administrativo'));
  assert.ok(opciones.cuentas.length && opciones.cuentas.every((c) => ['tecnico_administrativo', 'gestor', 'tallerista'].includes(c.rol)));
  await rechazaCon(t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'asignar', asignado: 'cuenta:gestor:99999' }), 400, /no está activa/);
  await rechazaCon(t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'asignar', asignado: 'rol:coordinador_compras' }), 400, /no recibe tickets/);
  r = await t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'asignar', asignado: 'rol:tecnico_administrativo' });
  assert.deepEqual([r.item.estado, r.item.asignado.tipo, r.item.asignado.rol], ['asignado', 'rol', 'tecnico_administrativo']);
  // Volver a asignar a la misma cola no es un movimiento: 400 y nada cambia (ni historial ni correo).
  const correosAntes = (await correosDe()).length;
  await rechazaCon(t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'asignar', asignado: 'rol:tecnico_administrativo' }), 400, /ya está asignado a/);
  assert.equal((await correosDe()).length, correosAntes);
  assert.equal((await t13.listarTickets(LOCAL_R1, { q: tk.consecutivo })).items[0].historial.length, 2);
  assert.deepEqual((await t13.listarTickets(LOCAL_R1, { asignado: 'rol:tecnico_administrativo' })).items.map((x) => x.id), [tk.id]);
  const enCola = (await t13.listarTickets(TECNICO_R1)).items.find((x) => x.id === tk.id);
  assert.ok(enCola?.puede.resolver, 'la cola del técnico de la región');
  assert.equal(enCola.puede.asignar, false);
  assert.ok(!(await t13.listarTickets(TECNICO_R2)).items.some((x) => x.id === tk.id), 'el técnico de otra región no lo ve');
  await rechaza(t13.gestionarTicket(TECNICO_R2, { id: tk.id, accion: 'resolver', nota: 'x' }), 403);

  // ---- TK-04/TK-05: responde con anexos; el solicitante confirma o reabre ----
  await rechazaCon(t13.gestionarTicket(TECNICO_R1, { id: tk.id, accion: 'resolver' }), 400, /nota/);
  await rechazaCon(t13.gestionarTicket(TECNICO_R1, { id: tk.id, accion: 'tomar' }, {}), 403, /solo responde los que tiene asignados/);
  r = await t13.gestionarTicket(TECNICO_R1, { id: tk.id, accion: 'resolver', nota: 'Se pidió la factura al proveedor' }, { adjuntos: [await pdf('factura.pdf')] });
  assert.deepEqual([r.item.estado, r.item.asignado.tipo, r.item.adjuntos.filter((a) => a.clase === 'respuesta').length], ['respondido', 'cuenta', 1]);
  assert.equal(String(r.item.confirmar_hasta).slice(0, 10), (await import('../src/servicios/diasHabiles.js')).sumarDiasHabiles(hoyIso(), 5));
  assert.match((await correosDe()).pop().texto, /Respondido por Técnico/);
  await rechazaCon(t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'tomar' }), 400, /espera la confirmación/);
  await rechaza(t13.gestionarTicket(LOCAL_R1, { id: tk.id, accion: 'confirmar' }), 403);
  const delSolicitante = (await t13.listarTickets(G1)).items.find((x) => x.id === tk.id);
  assert.deepEqual([delSolicitante.puede.confirmar, delSolicitante.puede.reabrir, delSolicitante.es_mio], [true, true, true]);
  await rechazaCon(t13.gestionarTicket(G1, { id: tk.id, accion: 'reabrir' }), 400, /nota/);
  r = await t13.gestionarTicket(G1, { id: tk.id, accion: 'reabrir', nota: 'La factura no trae el NIT' });
  assert.equal(r.item.estado, 'asignado', 'vuelve a quien lo respondió');
  assert.ok((await t13.listarTickets(TECNICO_R1)).items.find((x) => x.id === tk.id).puede.resolver);
  await t13.gestionarTicket(TECNICO_R1, { id: tk.id, accion: 'resolver', nota: 'Llegó la factura corregida' });
  r = await t13.gestionarTicket(G1, { id: tk.id, accion: 'confirmar' });
  assert.equal(r.item.estado, 'resuelto');
  assert.deepEqual(r.item.historial.map((h) => h.accion), ['crear', 'asignar', 'resolver', 'reabrir', 'resolver', 'confirmar']);
  assert.equal((await ultimaActividadCarrito('tickets.confirmar')).id_unico, 'E12-A');
  await rechazaCon(t13.gestionarTicket(G1, { id: tk.id, accion: 'reabrir', nota: 'x' }), 400, /ya está solucionado/);

  // ---- asignación a una persona del territorio y cierre automático sin confirmación ----
  const otro = (await t13.crearTicket(G1, { titulo: 'Cambio de fecha', descripcion: 'La UP pide otra fecha', etapa: 'acompanamiento' })).item;
  const persona = (await t13.asignables(LOCAL_R1, { id: otro.id })).cuentas.find((c) => c.rol === 'gestor' && c.nodo === 'ATLAN1');
  assert.ok(persona, 'el gestor del nodo está entre las personas');
  r = await t13.gestionarTicket(LOCAL_R1, { id: otro.id, accion: 'asignar', asignado: `cuenta:${persona.sub}` });
  assert.deepEqual([r.item.asignado.tipo, r.item.asignado.nombre], ['cuenta', persona.nombre]);
  assert.deepEqual((await ultimaActividadCarrito('tickets.asignar')).cambios.campos.asignado_sub, [null, persona.sub], 'la actividad registra a quién');
  await rechazaCon(t13.gestionarTicket(LOCAL_R1, { id: otro.id, accion: 'asignar', asignado: `cuenta:${persona.sub}` }), 400, /ya está asignado a/);
  // Asignado a una persona ya no está en la cola: otra cuenta del mismo rol y región lo ve por el nodo pero no lo responde.
  const OTRA_GESTORA = { sub: 'g1b', rol: 'gestor', nodo: 'ATLAN1', nombre: 'Otra gestora' };
  const vistoPorOtra = (await t13.listarTickets(OTRA_GESTORA)).items.find((x) => x.id === otro.id);
  assert.equal(vistoPorOtra?.puede.resolver, false, 'la colega del mismo rol no tiene el botón de responder');
  await rechaza(t13.gestionarTicket(OTRA_GESTORA, { id: otro.id, accion: 'resolver', nota: 'x' }), 403);
  assert.equal((await t13.listarTickets(G1)).items.find((x) => x.id === otro.id).puede.resolver, false, 'ni el solicitante, aunque sea del mismo rol');
  const comoPersona = { sub: persona.sub, rol: 'gestor', nodo: 'ATLAN1', nombre: persona.nombre };
  r = await t13.gestionarTicket(comoPersona, { id: otro.id, accion: 'resolver', nota: 'Se reprogramó' });
  assert.equal(r.item.estado, 'respondido');
  await query("UPDATE tickets SET confirmar_hasta = DATE '2020-01-01' WHERE id = $1", [otro.id]);
  assert.ok((await t13.cerrarSinConfirmar()) >= 1);
  const cerrado = (await t13.listarTickets(G1)).items.find((x) => x.id === otro.id);
  assert.deepEqual([cerrado.estado, cerrado.historial.at(-1).accion], ['resuelto', 'solucionado_auto']);
  assert.equal((await ultimaActividadCarrito('tickets.solucionado_auto')).usuario_nombre, 'Proceso automático');
  assert.match((await query("SELECT texto FROM correos_salida WHERE origen = 'ticket' AND referencia = $1 ORDER BY id DESC LIMIT 1", [cerrado.consecutivo])).rows[0].texto, /Solucionado sin confirmación/);

  // ---- TK-07: el correo se encola dentro de la transacción del movimiento. Si no se puede encolar, no queda el movimiento. ----
  const fragil = (await t13.crearTicket(G1, { titulo: 'Sin correo no hay movimiento', descripcion: 'Prueba de la transacción', etapa: 'diagnostico' })).item;
  const correosFragil = async () => (await query("SELECT count(*)::int AS n FROM correos_salida WHERE origen = 'ticket' AND referencia = $1", [fragil.consecutivo])).rows[0].n;
  const movimientosFragil = async () => (await query("SELECT count(*)::int AS n FROM actividad WHERE accion = 'tickets.tomar' AND objeto_id = $1", [String(fragil.id)])).rows[0].n;
  assert.equal(await correosFragil(), 1);
  await query("ALTER TABLE correos_salida ADD CONSTRAINT prueba_sin_correo_ticket CHECK (origen <> 'ticket') NOT VALID");
  try {
    await assert.rejects(t13.gestionarTicket(LOCAL_R1, { id: fragil.id, accion: 'tomar' }));
    const { rows: [sinMover] } = await query('SELECT estado, jsonb_array_length(historial) AS n FROM tickets WHERE id = $1', [fragil.id]);
    assert.deepEqual([sinMover.estado, sinMover.n], ['abierto', 1], 'el movimiento no quedó');
    assert.equal(await movimientosFragil(), 0, 'tampoco en la actividad');
    assert.equal(await correosFragil(), 1);
    await assert.rejects(t13.crearTicket(G1, { titulo: 'No queda radicado', descripcion: 'x', etapa: 'diagnostico' }));
    assert.equal((await query("SELECT count(*)::int AS n FROM tickets WHERE titulo = 'No queda radicado'")).rows[0].n, 0, 'sin correo no queda el ticket');
  } finally {
    await query('ALTER TABLE correos_salida DROP CONSTRAINT prueba_sin_correo_ticket');
  }
  r = await t13.gestionarTicket(LOCAL_R1, { id: fragil.id, accion: 'tomar' });
  assert.equal(r.item.estado, 'en_gestion');
  assert.equal(await correosFragil(), 2, 'con la bandeja sana el movimiento y su correo quedan juntos');
  assert.equal(await movimientosFragil(), 1);

  // ---- por HTTP: el nivel nacional radica y el técnico (de solo consulta) responde lo que tiene asignado ----
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const http = await jefe.http('POST', '/api/tickets', { titulo: 'Desde la consola', descripcion: 'Prueba', etapa: 'diagnostico' });
  assert.equal(http.status, 200, JSON.stringify(http.json));
  assert.equal(http.json.item.nivel, 'general');
  const paraCola = (await t13.crearTicket(G1, { titulo: 'Para la cola', descripcion: 'Revisar el soporte', etapa: 'diagnostico' })).item;
  await t13.gestionarTicket(LOCAL_R1, { id: paraCola.id, accion: 'asignar', asignado: 'rol:tecnico_administrativo' });
  const tec = await entrar('tec.e12', 'Tecnico-E12-2026x'); // técnico de la Región 1 (bloque «E12 seguimiento (revisión)»)
  const resp = await tec.http('POST', '/api/tickets/gestion', { id: paraCola.id, accion: 'resolver', nota: 'Atendido por la técnica' });
  assert.equal(resp.status, 200, JSON.stringify(resp.json));
  assert.equal(resp.json.item.estado, 'respondido');
  assert.equal((await tec.http('POST', '/api/tickets/gestion', { id: paraCola.id, accion: 'tomar' })).status, 403);
  assert.equal((await tec.http('POST', '/api/metas', { metas: [] })).status, 403, 'sigue siendo de solo consulta');

  // Un aviso que llega sin fecha queda con la de hoy (la bandeja ordena por fecha y no puede quedar vacía).
  await com.guardarAviso(COORD, { id: 'E13-AV-SIN-FECHA', titulo: 'Aviso sin fecha', destinatarios: [] });
  const { rows: [av] } = await query("SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM novedades WHERE id = 'E13-AV-SIN-FECHA'");
  assert.equal(av.f, hoyIso());
});

// ---------------- E14 · Gestores reales para Eventos y Avisos (LIT-e-02) ----------------
test('E14 gestores: el selector de destinatarios recibe región, departamento, modalidades y unidades vigentes del nodo', async () => {
  const todos = (await unidades.listarGestores(ADMIN)).items;
  const a1 = todos.find((g) => g.nodo === 'ATLAN1');
  assert.ok(a1, 'el gestor de ATLAN1 está en la lista');
  assert.equal(a1.region, 'Región 1');
  assert.ok(Array.isArray(a1.modalidades), 'las modalidades llegan como lista');
  assert.equal(typeof a1.ups, 'number');
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada
    WHERE upper(btrim(t.nodo)) = 'ATLAN1' AND up.habilitada IS NOT FALSE AND up.retirada_dps IS NOT TRUE`);
  assert.equal(a1.ups, n, 'solo cuenta las unidades vigentes');
  // El departamento del gestor es el más frecuente entre las unidades de su nodo (las que no lo traen no cuentan).
  const { rows: [frecuente] } = await query(`SELECT up.departamento FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada
    WHERE upper(btrim(t.nodo)) = 'ATLAN1' AND up.departamento IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`);
  assert.equal(frecuente?.departamento, 'Atlántico', 'la mayoría de las unidades de ATLAN1 están en Atlántico');
  assert.equal(a1.departamento, frecuente.departamento);
  // La modalidad llega como texto libre: «M1» y «M1 - Individual» son la misma (el nodo de la prueba E11 trae las dos).
  const { rows: textos } = await query("SELECT DISTINCT up.modalidad FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada WHERE t.nodo = 'E11TOPE'");
  assert.ok(textos.length > 1, 'la prueba necesita dos textos de la misma modalidad');
  assert.deepEqual(todos.find((g) => g.nodo === 'E11TOPE').modalidades, ['M1']);
  assert.ok(todos.every((g) => new Set(g.modalidades).size === g.modalidades.length));
  // El Coordinador local regional solo recibe los gestores de su territorio y el gestor no recibe la lista.
  const deR1 = (await unidades.listarGestores(LOCAL_R1)).items;
  assert.ok(deR1.length > 0, 'el regional recibe los gestores de su región');
  assert.ok(deR1.every((g) => String(g.region).toLowerCase() === 'región 1'));
  assert.ok(deR1.some((g) => g.nodo === 'ATLAN1'), 'incluye a ATLAN1 (Región 1)');
  assert.ok(!deR1.some((g) => g.nodo === 'BOLIV1'), 'no incluye a BOLIV1 (Región 2)');
  await rechaza(unidades.listarGestores(G1), 403);
});

// ---------------- E14 · Seguridad (LIT-h-03): el camino negativo de cada control, por categoría OWASP 2025 ----------------
// El mapa de categorías a pruebas está en docs/seguridad/owasp-cobertura.md.
test('seguridad (LIT-h-03): sesión, CSRF, bloqueo, roles, territorio, IDOR, archivos, contenido, inyección, errores y cabeceras', async () => {
  await reiniciarLimites();
  const pedir = (ruta, op = {}) => fetch(base + ruta, op);

  // ---- A07 Fallas de autenticación: la cookie no la lee el JavaScript ni viaja desde otros sitios; salir la invalida ----
  const r0 = await pedir('/api/auth/sesion');
  const token0 = (await r0.json()).token;
  const cookie0 = r0.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const login = await pedir('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token0, Cookie: cookie0 },
    body: JSON.stringify({ usuario: 'jefe', clave: 'Super-Segura-2026x' }) });
  assert.equal(login.status, 200);
  const setCookie = login.headers.getSetCookie().join(' ; ');
  assert.match(setCookie, /HttpOnly/i, 'la cookie de sesión es HttpOnly');
  assert.match(setCookie, /SameSite=Strict/i, 'la cookie de sesión es SameSite=Strict');
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  assert.equal((await jefe.http('GET', '/api/unidades')).status, 200);
  const cookieVieja = jefe.http.cookie();
  assert.equal((await jefe.http('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await pedir('/api/unidades', { headers: { Cookie: cookieVieja } })).status, 401, 'la cookie de una sesión cerrada ya no entra');
  // Sin sesión no se entra a la API ni a los archivos.
  assert.equal((await pedir('/api/unidades')).status, 401);
  assert.equal((await pedir('/api/archivos/visitas/cualquier.pdf')).status, 401);
  assert.equal((await pedir('/api/archivos?action=get&blobName=cualquier.pdf')).status, 401);

  // ---- A07/A06 Bloqueo por intentos: tras 5 fallos la cuenta se bloquea aunque después llegue la clave correcta ----
  await query(`INSERT INTO coordinadores (id_origen, tipo, usuario, clave_hash, nombre, region) VALUES ('SEG-1', 'coordinador', 'seg.bloqueo', $1, 'Prueba bloqueo', 'Región 9')
    ON CONFLICT DO NOTHING`, [await hashClave('Bloqueo-Seguro-2026x')]);
  for (let i = 0; i < 5; i += 1) assert.equal((await entrar('seg.bloqueo', `mala-${i}`)).r.status, 401);
  const bloqueado = await entrar('seg.bloqueo', 'Bloqueo-Seguro-2026x');
  assert.notEqual(bloqueado.r.status, 200, 'bloqueada tras 5 fallos');
  // A09: cada fallo y el bloqueo quedan en el registro de seguridad, y la clave intentada no.
  const { rows: fallos } = await query(`SELECT tipo, detalle FROM eventos_seguridad
    WHERE tipo IN ('login_fallo', 'usuario_bloqueado') AND usuario_texto = 'seg.bloqueo'`);
  assert.ok(fallos.length >= 5, `fallos registrados: ${fallos.length}`);
  assert.ok(fallos.some((f) => f.tipo === 'usuario_bloqueado'), 'el bloqueo queda registrado');
  assert.ok(fallos.every((f) => !String(f.detalle || '').includes('mala-')), 'no se guarda la clave intentada');
  await reiniciarLimites();

  // ---- A05 Inyección · CSRF: con sesión, sin token, con otro token o desde otro origen no se escribe ----
  const g = await entrar('atlan1', '1001001001');
  const cookieG = g.http.cookie();
  const ticket = JSON.stringify({ titulo: 'Prueba CSRF', descripcion: 'No debe quedar', etapa: 'diagnostico' });
  const antesT = (await query('SELECT count(*)::int AS n FROM tickets')).rows[0].n;
  const sinToken = await pedir('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieG }, body: ticket });
  // Sin token o con otro, 400 con la marca csrf (el cliente renueva el token y reintenta una vez); queda en el registro.
  assert.equal(sinToken.status, 400, 'sin token CSRF');
  assert.equal((await sinToken.json()).csrf, true);
  const otroToken = await pedir('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieG, 'X-CSRF-Token': 'a'.repeat(43) }, body: ticket });
  assert.equal(otroToken.status, 400, 'con un token que no es el de la sesión');
  assert.equal((await otroToken.json()).csrf, true);
  assert.ok((await query("SELECT count(*)::int AS n FROM eventos_seguridad WHERE tipo = 'csrf_invalido' AND detalle LIKE 'POST %/tickets'")).rows[0].n >= 2);
  const tokenG = (await (await pedir('/api/auth/sesion', { headers: { Cookie: cookieG } })).json()).token;
  const deFuera = await pedir('/api/tickets', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieG, 'X-CSRF-Token': tokenG, Origin: 'https://sitio-malo.example' }, body: ticket });
  assert.equal(deFuera.status, 403, 'desde otro origen, aunque traiga el token');
  assert.equal((await query('SELECT count(*)::int AS n FROM tickets')).rows[0].n, antesT, 'ningún intento rechazado creó el ticket');

  // ---- A01 Control de acceso roto · matriz de roles en el servidor ----
  const negados = [
    ['GET', '/api/admin/usuarios'], ['POST', '/api/metas', { metas: [] }], ['GET', '/api/seguimiento/kokan'],
    ['POST', '/api/config', { accion: 'mantenimiento', activo: true }], ['GET', '/api/gestores'], ['GET', '/api/inv/recepcion'],
  ];
  for (const [m, ruta, cuerpo] of negados) assert.equal((await g.http(m, ruta, cuerpo)).status, 403, `el gestor no llega a ${m} ${ruta}`);
  const pacm = await entrar('logistica', 'Logistica-Clave-2026');
  assert.equal(pacm.r.status, 200);
  for (const ruta of ['/api/eventos', '/api/avisos', '/api/tickets']) {
    assert.equal((await pacm.http('GET', ruta)).status, 403, `el Profesional alianzas no llega a ${ruta}`);
  }
  assert.equal((await pacm.http('PUT', '/api/avisos', { id: 'seg-pacm', titulo: 'x' })).status, 403, 'el Profesional alianzas no publica avisos');
  const tec = await entrar('tec.e12', 'Tecnico-E12-2026x');
  assert.equal(tec.r.status, 200);
  for (const [m, ruta, cuerpo] of [['POST', '/api/metas', { metas: [] }], ['PUT', '/api/eventos', { id: 'seg-tec', titulo: 'x' }], ['POST', '/api/config', { accion: 'mantenimiento', activo: true }]]) {
    assert.equal((await tec.http(m, ruta, cuerpo)).status, 403, `el técnico (solo consulta) no escribe en ${ruta}`);
  }

  // ---- A01 · territorio e IDOR: lo de otro nodo no se ve ni se descarga cambiando el id ----
  const detalleOtro = await g.http('GET', '/api/unidades/detalle?id=UP-3');
  assert.ok([403, 404].includes(detalleOtro.status), `UP de otro nodo: ${detalleOtro.status}`);
  // Un ticket de otro nodo (BOLIV1) con su PDF: el gestor de ATLAN1 no lo descarga aunque adivine el id.
  const t14 = await import('../src/servicios/tickets.js');
  const ajeno = (await t14.crearTicket(G2, { titulo: 'Ticket de otro nodo', descripcion: 'Con un soporte privado', etapa: 'diagnostico' },
    { adjuntos: [await archivoTemporal('ajeno.pdf', '%PDF-1.4 ajeno')] })).item;
  const { rows: [adjOtro] } = await query('SELECT id FROM tickets_adjuntos WHERE ticket_id = $1', [ajeno.id]);
  assert.ok(adjOtro, 'el ticket ajeno tiene su adjunto');
  assert.equal((await g.http('GET', `/api/tickets/adjunto?id=${adjOtro.id}`)).status, 404, 'adjunto de un ticket que no ve');
  const { rows: [archOtro] } = await query(`SELECT a.contenedor, a.nombre FROM archivos a JOIN unidades_productivas u ON u.id_up = a.id_up
    JOIN triadas t ON t.id_triada = u.id_triada WHERE upper(t.nodo) <> 'ATLAN1' LIMIT 1`);
  assert.ok(archOtro, 'hay archivos de unidades de otros nodos');
  const descarga = await g.http('GET', `/api/archivos/${archOtro.contenedor}/${archOtro.nombre.split('/').map(encodeURIComponent).join('/')}`);
  assert.ok([403, 404].includes(descarga.status), `archivo de una UP de otro nodo: ${descarga.status}`);
  // Ruta transversal en la descarga de archivos.
  for (const ruta of ['/api/archivos/visitas/..%2F..%2F..%2Fpackage.json', '/api/archivos/..%2F..%2Fsrc/config.js',
    '/api/archivos?action=get&blobName=..%2F..%2F..%2Fpackage.json']) {
    const r = await g.http('GET', ruta);
    assert.ok([400, 403, 404].includes(r.status), `${ruta}: ${r.status}`);
  }

  // ---- A05 · inyección SQL: los parámetros van como datos, nunca como SQL ----
  const inyecciones = [`/api/unidades/detalle?id=${encodeURIComponent("1' OR '1'='1")}`, `/api/tickets?q=${encodeURIComponent("'; DROP TABLE tickets; --")}`,
    `/api/tickets/adjunto?id=${encodeURIComponent('1 OR 1=1')}`, `/api/actividad?up=${encodeURIComponent("1' OR '1'='1")}`,
    `/api/visitas?unidad_doc=${encodeURIComponent("%' UNION SELECT clave_hash FROM coordinadores --")}`];
  for (const ruta of inyecciones) {
    const r = await g.http('GET', ruta);
    assert.ok(r.status < 500, `${ruta} no rompe el servidor: ${r.status}`);
    assert.doesNotMatch(JSON.stringify(r.json || {}), /scrypt|\$2[aby]\$/, 'no sale ningún hash de clave');
  }
  assert.ok((await query('SELECT count(*)::int AS n FROM tickets')).rows[0].n > 0, 'la tabla sigue ahí');
  // unidad_doc sí llega al SQL de las visitas: con «' OR '1'='1» no se abre el filtro ni salen visitas de otra unidad.
  const propias = await g.http('GET', '/api/visitas');
  assert.equal(propias.status, 200);
  assert.ok(propias.json.items.length > 0, 'el gestor tiene visitas propias con que comparar');
  const visitaInyectada = await g.http('GET', `/api/visitas?unidad_doc=${encodeURIComponent("1' OR '1'='1")}`);
  assert.ok(visitaInyectada.status < 500, `visitas con inyección: ${visitaInyectada.status}`);
  assert.deepEqual(visitaInyectada.json?.items ?? [], [], 'el filtro inyectado no trae ninguna visita');
  // La búsqueda de tickets (q) llega al SQL tal cual (solo se escapan %, _ y \): si se armara la consulta concatenando,
  // «' OR '1'='1» abriría el filtro y saldrían todos los tickets del gestor.
  const ticketsPropios = await g.http('GET', '/api/tickets');
  assert.ok(ticketsPropios.json.items.length > 0, 'el gestor tiene tickets con que comparar');
  const ticketInyectado = await g.http('GET', `/api/tickets?q=${encodeURIComponent("' OR '1'='1")}`);
  assert.equal(ticketInyectado.status, 200);
  assert.deepEqual(ticketInyectado.json.items, [], 'la búsqueda inyectada no trae ningún ticket');
  const inyectado = await g.http('GET', `/api/unidades/detalle?id=${encodeURIComponent("1' OR '1'='1")}`);
  assert.ok([400, 403, 404].includes(inyectado.status), 'no trae otra unidad');

  // ---- A10 · condiciones excepcionales: errores en español, sin trazas ni detalles internos ----
  const jefe2 = await entrar('jefe', 'Super-Segura-2026x');
  const tokenJ = (await (await pedir('/api/auth/sesion', { headers: { Cookie: jefe2.http.cookie() } })).json()).token;
  const malformado = await pedir('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jefe2.http.cookie(), 'X-CSRF-Token': tokenJ }, body: '{"titulo": ' });
  assert.equal(malformado.status, 400);
  const cuerpoMal = await malformado.text();
  assert.match(cuerpoMal, /no es JSON válido/);
  assert.doesNotMatch(cuerpoMal, /at \w+ \(|node_modules|stack|SELECT /, 'sin traza ni SQL');
  const enorme = await jefe2.http('GET', '/api/tickets/adjunto?id=99999999999999999999');
  assert.ok([400, 404].includes(enorme.status), `id enorme: ${enorme.status}`);
  const noExiste = await jefe2.http('GET', '/api/no-existe');
  assert.equal(noExiste.status, 404);
  assert.equal(noExiste.json.ok, false);
  // El módulo viejo de Novedades se retiró (LIT-e-02): sus rutas ya no existen.
  assert.equal((await jefe2.http('GET', '/api/novedades')).status, 404);
  assert.equal((await jefe2.http('POST', '/api/novedades/accion', { accion: 'crear' })).status, 404);

  // ---- A02 Configuración insegura · cabeceras de seguridad y sin «x-powered-by» ----
  const h = (await pedir('/api/auth/sesion')).headers;
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.ok(h.get('content-security-policy'), 'CSP presente');
  assert.equal(h.get('referrer-policy'), 'same-origin');
  assert.equal(h.get('x-powered-by'), null);

  // ---- A01/A04 · archivo público sin datos personales (Ley 1581) ----
  const publico = await fs.readFile(path.join(aqui, '../../frontend/public/herramientas/registro-fotografico.html'), 'utf8');
  assert.equal(/(?<![\d#.])\d{7,10}(?![\d.])/.test(publico), false, 'el HTML público no trae números con forma de cédula');
  // La base de la herramienta solo sale con sesión.
  assert.equal((await pedir('/api/registro-fotografico')).status, 401);

  // ---- A05/A08 · contenido de los archivos: la extensión no basta, se revisa la firma ----
  await assert.rejects(archivos.guardarArchivo({ contenedor: 'visitas', nombre: 'seg/falso.pdf', archivo: await archivoTemporal('falso.pdf', 'MZ esto es un ejecutable', 'application/pdf', { crudo: true }) }),
    (e) => e.status === 400, 'un «PDF» que no lo es');
  await assert.rejects(archivos.guardarArchivo({ contenedor: 'visitas', nombre: 'seg/pagina.html', archivo: await archivoTemporal('pagina.html', '<script>alert(1)</script>', 'text/html', { crudo: true }) }),
    (e) => e.status === 400, 'una página HTML');
});

// Texto de un PDF de pdfkit: cada flujo va comprimido (FlateDecode) y el texto sale en los operadores Tj/TJ como
// cadenas hexadecimales <…> o literales (…). Devuelve una línea por operador; basta para buscar rótulos y valores.
async function textoPdf(buf) {
  const zlib = await import('node:zlib');
  const bin = buf.toString('latin1');
  const lineas = [];
  let desde = 0;
  for (;;) {
    const m = /stream\r?\n/.exec(bin.slice(desde));
    if (!m) break;
    const ini = desde + m.index + m[0].length;
    const fin = bin.indexOf('endstream', ini);
    if (fin < 0) break;
    desde = fin + 'endstream'.length;
    let flujo;
    try {
      flujo = zlib.inflateSync(buf.subarray(ini, fin), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1');
    } catch { continue; } // un flujo que no es Flate (imágenes u otros): no trae texto
    for (const [, arg] of flujo.matchAll(/(\[[^\]]*\]|<[0-9a-fA-F\s]*>|\((?:\\.|[^\\)])*\))\s*T[jJ]/g)) {
      let t = '';
      for (const [, hex, lit] of arg.matchAll(/<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\)])*)\)/g)) {
        if (hex !== undefined) t += Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1');
        else {
          t += lit.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[e]
            ?? (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e));
        }
      }
      lineas.push(t);
    }
  }
  return lineas.join('\n');
}

// ---------------- E14 · Cobertura por módulo (LIT-e-03): pedidos, órdenes, códigos y PDF del inventario ----------------
test('E14 inventario: pedidos por lote desde Excel, órdenes de despacho con su PDF, códigos de barras, QR y etiquetas', async () => {
  await reiniciarLimites();
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  const bod = await entrar('bodega', 'Bodega-Segura-2026');
  const g = await entrar('atlan1', '1001001001');
  const crudo = (s, ruta) => fetch(base + ruta, { headers: s ? { Cookie: s.http.cookie() } : {} });
  const bytes = async (r) => Buffer.from(await r.arrayBuffer());
  const subir = async (s, nombre, contenido, campos = {}) => {
    const token = (await s.http('GET', '/api/auth/sesion')).json.token;
    const f = new FormData();
    Object.entries(campos).forEach(([k, v]) => f.append(k, v));
    f.append('archivo', new Blob([contenido]), nombre);
    const r = await fetch(`${base}/api/inv/pedidos/cargar`, { method: 'POST', headers: { Cookie: s.http.cookie(), 'X-CSRF-Token': token }, body: f });
    return { status: r.status, json: await r.json() };
  };

  // ---- Códigos: PNG con sesión del inventario; sin sesión, 401; el gestor no tiene el módulo ----
  const bc = await crudo(bod, '/api/inv/codigos/barcode/E14-ART-1.png');
  assert.equal(bc.status, 200);
  assert.equal(bc.headers.get('content-type'), 'image/png');
  assert.equal((await bytes(bc)).subarray(1, 4).toString(), 'PNG');
  const qr = await crudo(bod, '/api/inv/codigos/qr/E14-ART-1.png?t=99');                       // tamaño fuera de rango: se acota
  assert.equal(qr.status, 200);
  assert.equal((await bytes(qr)).subarray(1, 4).toString(), 'PNG');
  assert.equal((await crudo(bod, `/api/inv/codigos/qr/${'x'.repeat(65)}.png`)).status, 400, 'código demasiado largo');
  assert.equal((await crudo(bod, `/api/inv/codigos/barcode/${'x'.repeat(65)}.png`)).status, 400);
  assert.equal((await crudo(null, '/api/inv/codigos/barcode/E14.png')).status, 401);
  assert.equal((await crudo(g, '/api/inv/codigos/barcode/E14.png')).status, 403);
  const { rows: [etq] } = await query(`INSERT INTO inventario.articulos (nombre, codigo_proveedor, codigo_barras, stock)
    VALUES ('E14 etiqueta', 'E14-ETQ', 'E14-ETQ', 0) RETURNING id`);
  const et = await bod.http('GET', `/api/inv/codigos/etiquetas?id=${etq.id}&copias=3`);
  assert.equal(et.status, 200);
  assert.deepEqual(et.json.etiquetas, Array(3).fill({ nombre: 'E14 etiqueta', codigo: 'E14-ETQ' }));
  assert.equal((await bod.http('GET', `/api/inv/codigos/etiquetas?id=${etq.id}&copias=99`)).json.etiquetas.length, 20, 'máximo 20 copias');

  // ---- Pedidos por lote: solo el administrador del inventario; el Excel trae su hoja y sus columnas ----
  assert.equal((await bod.http('GET', '/api/inv/pedidos')).status, 403);
  assert.equal((await g.http('GET', '/api/inv/pedidos')).status, 403);
  const ExcelJS = (await import('exceljs')).default;
  const libro = async (hoja, filas) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(hoja);
    ws.addRow(['num_documento', 'codigo_actual', 'nombre_carrito_actual', 'tipo_segun_carrito_actual', 'cantidad', 'precio_actual']);
    filas.forEach((f) => ws.addRow(f));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const filas = [['900111', 'C-1', 'Silla', 'Mobiliario', 2, 150000], ['', 'C-9', 'Sin unidad', 'Otro', 1, 1], ['900222', 'C-2', 'Mesa', 'Mobiliario', 1, 300000]];
  assert.match((await subir(jefe, 'lote.xlsx', await libro('Otra hoja', filas))).json.error || '', /no tiene una hoja llamada 'Desglosado items'/);
  assert.equal((await subir(jefe, 'lote.csv', 'a,b')).status, 400, 'solo Excel');
  assert.equal((await subir(jefe, 'lote.xlsx', 'no es un excel')).status, 400, 'el contenido se revisa');
  const cargado = await subir(jefe, 'lote-e14.xlsx', await libro('Desglosado items', filas), { nombre: 'Lote E14' });
  assert.equal(cargado.status, 200, JSON.stringify(cargado.json));
  assert.match(cargado.json.mensaje, /Lote E14 creado: 2 items en 2 unidades productivas\. Se ignoraron 1 filas sin numero de documento\./);
  const lid = cargado.json.id;
  const lista = (await jefe.http('GET', '/api/inv/pedidos')).json.lotes;
  assert.equal(Number(lista.find((l) => l.id === lid).n_items), 2);
  const det = (await jefe.http('GET', `/api/inv/pedidos/${lid}`)).json;
  assert.deepEqual(det.grupos.map((x) => [x.num_documento, Number(x.subtotal)]), [['900111', 300000], ['900222', 300000]]);
  const pdfLote = await crudo(jefe, `/api/inv/pedidos/${lid}/pdf`);
  assert.equal(pdfLote.status, 200);
  assert.equal(pdfLote.headers.get('content-type'), 'application/pdf');
  assert.equal((await bytes(pdfLote)).subarray(0, 5).toString(), '%PDF-');
  const act = (await query("SELECT cambios FROM actividad WHERE accion = 'inventario.pedido_cargar' AND objeto_id = $1", [String(lid)])).rows[0];
  assert.equal(act.cambios.items, 2);
  assert.equal(JSON.stringify(act.cambios).includes('900111'), false, 'los documentos de las unidades no van a la actividad');
  assert.equal((await jefe.http('DELETE', `/api/inv/pedidos/${lid}`)).status, 200);
  assert.equal((await jefe.http('GET', `/api/inv/pedidos/${lid}`)).status, 404);
  assert.equal((await crudo(jefe, `/api/inv/pedidos/${lid}/pdf`)).status, 404);

  // ---- Órdenes de despacho: descuentan los kits armados, no pasan del stock y salen en PDF ----
  const { rows: [art] } = await query(`INSERT INTO inventario.articulos (nombre, codigo_proveedor, codigo_barras, stock)
    VALUES ('E14 artículo de kit', 'E14-KIT-ART', 'E14-KIT-ART', 3) RETURNING id`);
  const kit = (await jefe.http('POST', '/api/inv/kits', { nombre: 'E14 kit de despacho', items: [{ articulo_id: art.id, cantidad: 1 }] })).json.id;
  assert.equal((await jefe.http('POST', `/api/inv/kits/${kit}/armar`)).status, 200);
  assert.equal((await bod.http('POST', '/api/inv/ordenes', { destino: 'Cartagena', lineas: [{ ref_id: kit, cantidad: 1 }] })).status, 403, 'el bodeguero no genera órdenes');
  assert.equal((await jefe.http('POST', '/api/inv/ordenes', { destino: 'Cartagena', lineas: [] })).status, 400);
  assert.equal((await jefe.http('POST', '/api/inv/ordenes', { destino: 'Cartagena', lineas: [{ ref_id: kit, cantidad: 9 }] })).status, 409, 'más de lo armado');
  const orden = await jefe.http('POST', '/api/inv/ordenes', { destino: 'Cartagena', observaciones: 'Despacho E14', lineas: [{ ref_id: kit, cantidad: 1 }] });
  assert.equal(orden.status, 200, JSON.stringify(orden.json));
  assert.equal((await query('SELECT stock FROM inventario.combos WHERE id = $1', [kit])).rows[0].stock, 0, 'el kit sale del stock');
  const verOrden = await jefe.http('GET', `/api/inv/ordenes/${orden.json.id}`);
  assert.equal(verOrden.status, 200);
  assert.equal(verOrden.json.orden.destino, 'Cartagena');
  // El PDF del Coordinador general lleva precios; el del Profesional alianzas, solo cantidades.
  const textos = [];
  for (const s of [jefe, await entrar('logistica', 'Logistica-Clave-2026')]) {
    const pdfOrden = await crudo(s, `/api/inv/ordenes/${orden.json.id}/pdf`);
    assert.equal(pdfOrden.status, 200);
    const contenido = await bytes(pdfOrden);
    assert.equal(contenido.subarray(0, 5).toString(), '%PDF-');
    textos.push(await textoPdf(contenido));
  }
  const [conPrecios, soloCantidades] = textos;
  for (const t of textos) {
    assert.match(t, /E14 kit de despacho/, 'se lee el texto del PDF (el nombre del kit)');
    assert.match(t, /Cartagena/, 'y el destino');
  }
  assert.match(conPrecios, /Precio unit\./, 'el del Coordinador general trae la columna de precio');
  assert.match(conPrecios, /Subtotal del kit/);
  assert.match(conPrecios, /TOTAL DE LA ORDEN/);
  assert.match(conPrecios, /\$ \d/, 'y valores en pesos');
  assert.match(soloCantidades, /TOTAL DE ARTICULOS/, 'el del Profesional alianzas cierra con el total de artículos');
  assert.doesNotMatch(soloCantidades, /Precio|Subtotal|TOTAL DE LA ORDEN/, 'sin rótulos de precio, subtotal ni total en pesos');
  assert.doesNotMatch(soloCantidades, /\$ ?\d/, 'sin ningún valor en pesos');
  assert.equal((await jefe.http('GET', '/api/inv/ordenes/99999999')).status, 404);
  assert.equal((await jefe.http('DELETE', `/api/inv/ordenes/${orden.json.id}`)).status, 200);
  assert.equal((await query('SELECT stock FROM inventario.combos WHERE id = $1', [kit])).rows[0].stock, 0, 'borrar la orden no devuelve el stock (así lo avisa la pantalla)');
});

// ---------------- E14 · Verificación humana (LIT-e-03, OWASP A07/A10): Cloudflare confirma; ante errores, falla cerrado ----------------
test('E14 verificación humana: el login exige el token de Turnstile y ante cualquier error de Cloudflare falla cerrado', async () => {
  const { verificarCaptcha } = await import('../src/acceso/captcha.js');
  const { config } = await import('../src/config.js');
  const original = globalThis.fetch;
  const secreto = config.turnstileSecret;
  const enviados = [];
  // Solo se simula Cloudflare: las peticiones de la prueba al servidor siguen su camino.
  const cloudflare = (responder) => {
    globalThis.fetch = async (url, op) => {
      if (String(url) !== config.turnstileVerifyUrl) return original(url, op);
      enviados.push(String(op.body));
      return responder();
    };
  };
  try {
    // Cloudflare (simulado) ya diría que sí: si la guarda dejara pasar estos tokens a la consulta, saldrían aprobados y quedarían en «enviados».
    cloudflare(() => new Response(JSON.stringify({ success: true })));
    assert.equal(await verificarCaptcha('', '10.0.0.1'), false, 'sin token');
    assert.equal(await verificarCaptcha({ token: 'x' }), false, 'token que no es texto');
    assert.equal(await verificarCaptcha('x'.repeat(2049)), false, 'token desproporcionado');
    assert.equal(enviados.length, 0, 'esos ni se consultan');
    config.turnstileSecret = 'secreto-de-prueba';
    assert.equal(await verificarCaptcha('token-bueno', '10.0.0.1'), true);
    assert.match(enviados.at(-1), /secret=secreto-de-prueba/);
    assert.match(enviados.at(-1), /response=token-bueno/);
    assert.match(enviados.at(-1), /remoteip=10\.0\.0\.1/);
    for (const [motivo, responder] of [
      ['token rechazado', () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }))],
      ['Cloudflare caído', () => new Response('error', { status: 503 })],
      ['respuesta que no es JSON', () => new Response('<html>')],
      ['sin red', () => { throw new Error('ECONNREFUSED'); }],
      ['success que no es true', () => new Response(JSON.stringify({ success: 'yes' }))],
    ]) {
      cloudflare(responder);
      assert.equal(await verificarCaptcha('token', '10.0.0.1'), false, motivo);
    }

    // Por HTTP: con la verificación activa, sin token no se toca ninguna cuenta (ni con la clave correcta).
    await reiniciarLimites();
    cloudflare(() => new Response(JSON.stringify({ success: false })));
    const sin = await entrar('jefe', 'Super-Segura-2026x');
    assert.equal(sin.r.status, 401);
    assert.match(sin.r.json.error, /verificación de seguridad/);
    const { rows: [ev] } = await query("SELECT detalle FROM eventos_seguridad WHERE tipo = 'login_fallo' AND usuario_texto = 'jefe' ORDER BY id DESC LIMIT 1");
    assert.equal(ev.detalle, 'verificación humana fallida');
    cloudflare(() => new Response(JSON.stringify({ success: true })));
    const c = cliente();
    await c('GET', '/api/auth/sesion');
    assert.equal((await c('POST', '/api/auth/login', { usuario: 'jefe', clave: 'Super-Segura-2026x', captcha: 'token-bueno' })).status, 200);
  } finally {
    globalThis.fetch = original;
    config.turnstileSecret = secreto;
    await reiniciarLimites();
  }
});

// ---------------- Revisión de seguridad: cada control de docs/seguridad/owasp-cobertura.md, comprobado ----------------
// Identificador de la cookie de sesión de un cliente de prueba y la huella con que lo guarda sesiones_app.
const tokenDeSesion = (http) => /(?:^|;\s*)(?:__Host-)?sid=([^;]+)/.exec(http.cookie())?.[1];
const huellaSesion = async (http) => (await import('node:crypto')).createHash('sha256').update(tokenDeSesion(http)).digest('hex');

test('seguridad (A02/A04): la descarga de un archivo privado sale con «private, no-store»: ninguna caché la guarda', async () => {
  await reiniciarLimites();
  const { rows: [up] } = await query("SELECT id_up FROM unidades_productivas WHERE id_origen = 'UP-1'");
  await archivos.guardarArchivo({ contenedor: 'visitas', nombre: 'revision-cache/privado.pdf', idUp: up.id_up,
    archivo: await archivoTemporal('privado.pdf', '%PDF-1.4 soporte privado') });
  const jefe = await entrar('jefe', 'Super-Segura-2026x');
  // Las dos formas de pedirlo: la ruta directa y el contrato del visor antiguo.
  for (const ruta of ['/api/archivos/visitas/revision-cache/privado.pdf',
    '/api/archivos?action=get&origen=visitas&blobName=revision-cache%2Fprivado.pdf']) {
    const r = await fetch(base + ruta, { headers: { Cookie: jefe.http.cookie() } });
    assert.equal(r.status, 200, ruta);
    assert.equal(r.headers.get('cache-control'), 'private, no-store', ruta);
    assert.equal(r.headers.get('content-type'), 'application/pdf', ruta);
    assert.equal(r.headers.get('content-disposition'), "inline; filename*=UTF-8''privado.pdf", ruta);
    assert.ok((await r.text()).startsWith('%PDF-'), ruta);
  }
});

test('seguridad (A02/A07): con COOKIE_SECURE, la respuesta lleva HSTS y la cookie de sesión va con Secure y el prefijo __Host-', async () => {
  const { config } = await import('../src/config.js');
  // Sin HTTPS declarado (así corren estas pruebas) no se manda HSTS: el navegador lo recordaría un año.
  if (!config.cookieSecure) {
    const sinHttps = await fetch(`${base}/api/auth/sesion`);
    assert.equal(sinHttps.headers.get('strict-transport-security'), null);
    await sinHttps.text();
  }
  // El nombre y las opciones de la cookie se fijan al cargar acceso/sesiones.js: la aplicación con COOKIE_SECURE=1
  // corre en un proceso aparte, contra la misma base de pruebas.
  const { spawn } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const codigo = `const { crearApp } = await import(${JSON.stringify(pathToFileURL(path.join(aqui, '../src/app.js')).href)});
const s = crearApp().listen(0, '127.0.0.1', () => console.log('PUERTO=' + s.address().port));`;
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  const hijo = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
    env: { ...entorno, COOKIE_SECURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errores = '';
  hijo.stderr.on('data', (d) => { errores += d; });
  try {
    const puerto = await new Promise((resolve, reject) => {
      let salida = '';
      const espera = setTimeout(() => reject(new Error(`El servidor con COOKIE_SECURE no arrancó: ${errores}`)), 30_000);
      hijo.stdout.on('data', (d) => {
        salida += d;
        const m = /PUERTO=(\d+)/.exec(salida);
        if (m) { clearTimeout(espera); resolve(Number(m[1])); }
      });
      hijo.once('exit', (c) => { clearTimeout(espera); reject(new Error(`El servidor con COOKIE_SECURE terminó (${c}): ${errores}`)); });
    });
    const seguro = `http://127.0.0.1:${puerto}`;
    const HSTS = 'max-age=31536000; includeSubDomains';
    await reiniciarLimites();

    // La sesión anónima (la del token CSRF) ya usa la cookie segura.
    const r0 = await fetch(`${seguro}/api/auth/sesion`);
    assert.equal(r0.headers.get('strict-transport-security'), HSTS);
    const anonima = r0.headers.getSetCookie().join(' ; ');
    assert.match(anonima, /^__Host-sid=/, 'la cookie lleva el prefijo __Host-');
    assert.match(anonima, /;\s*Secure/i, 'y solo viaja por HTTPS');
    const { token } = await r0.json();
    const cookie = r0.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    // La de la sesión iniciada también, con el resto de sus atributos.
    const login = await fetch(`${seguro}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Cookie: cookie },
      body: JSON.stringify({ usuario: 'jefe', clave: 'Super-Segura-2026x' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('strict-transport-security'), HSTS);
    const deSesion = login.headers.getSetCookie().join(' ; ');
    assert.match(deSesion, /^__Host-sid=/);
    for (const atributo of [/;\s*Secure/i, /;\s*HttpOnly/i, /;\s*SameSite=Strict/i, /;\s*Path=\//i]) {
      assert.match(deSesion, atributo, `la cookie de sesión lleva ${atributo}`);
    }
    assert.doesNotMatch(deSesion, /;\s*Domain=/i, 'una cookie __Host- no lleva dominio');
    const cookieSesion = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const unidadesSeguras = await fetch(`${seguro}/api/unidades`, { headers: { Cookie: cookieSesion } });
    assert.equal(unidadesSeguras.status, 200, 'la sesión con la cookie segura funciona');
    assert.equal(unidadesSeguras.headers.get('strict-transport-security'), HSTS);
    await unidadesSeguras.text();
  } finally {
    if (hijo.exitCode === null && hijo.signalCode === null) {
      const fin = new Promise((r) => hijo.once('exit', r));
      hijo.kill();
      await fin;
    }
  }
});

test('seguridad (A07): la sesión vence por inactividad y por su duración máxima, aunque la cookie siga siendo buena', async () => {
  await reiniciarLimites();
  const { config } = await import('../src/config.js');
  const minutosMax = Math.round(config.sesionMaxHoras * 60);
  const sigue = async (http) => (await query('SELECT count(*)::int AS n FROM sesiones_app WHERE id_hash = $1', [await huellaSesion(http)])).rows[0].n;

  // ---- Inactividad (SESION_INACTIVIDAD_MIN): justo antes del límite entra; pasado, 401 y la sesión se borra ----
  const quieta = await entrar('jefe', 'Super-Segura-2026x');
  assert.equal(quieta.r.status, 200);
  const h1 = await huellaSesion(quieta.http);
  await query("UPDATE sesiones_app SET ultimo_uso = now() - $2::int * interval '1 minute' WHERE id_hash = $1",
    [h1, Math.max(0, config.sesionInactividadMin - 1)]);
  assert.equal((await quieta.http('GET', '/api/unidades')).status, 200, 'dentro del límite de inactividad');
  await query("UPDATE sesiones_app SET ultimo_uso = now() - $2::int * interval '1 minute' WHERE id_hash = $1",
    [h1, config.sesionInactividadMin + 1]);
  const inactiva = await quieta.http('GET', '/api/unidades');
  assert.equal(inactiva.status, 401, 'pasado el límite de inactividad');
  assert.equal(inactiva.json.ok, false);
  assert.equal((await query('SELECT count(*)::int AS n FROM sesiones_app WHERE id_hash = $1', [h1])).rows[0].n, 0, 'la sesión inactiva se borra');

  // ---- Caducidad absoluta (SESION_MAX_HORAS): aunque se haya usado hace un momento ----
  const larga = await entrar('jefe', 'Super-Segura-2026x');
  assert.equal(larga.r.status, 200);
  const h2 = await huellaSesion(larga.http);
  await query("UPDATE sesiones_app SET creado = now() - $2::int * interval '1 minute', ultimo_uso = now() WHERE id_hash = $1",
    [h2, minutosMax - 1]);
  assert.equal((await larga.http('GET', '/api/unidades')).status, 200, 'antes de la duración máxima');
  assert.equal(await sigue(larga.http), 1);
  await query("UPDATE sesiones_app SET creado = now() - $2::int * interval '1 minute', ultimo_uso = now() WHERE id_hash = $1",
    [h2, minutosMax + 1]);
  const caducada = await larga.http('GET', '/api/unidades');
  assert.equal(caducada.status, 401, 'pasada la duración máxima, aunque estuviera activa');
  assert.equal((await query('SELECT count(*)::int AS n FROM sesiones_app WHERE id_hash = $1', [h2])).rows[0].n, 0, 'la sesión caducada se borra');
});

test('seguridad (A10): si la base no responde, el limitador por IP deja pasar y /api/salud no delata la conexión', async () => {
  const { limitador } = await import('../src/acceso/limites.js');
  // Con la base sana: 200 y nada más que el estado.
  const sana = await fetch(`${base}/api/salud`);
  assert.equal(sana.status, 200);
  assert.deepEqual(await sana.json(), { ok: true, servicio: 'bitacora-api', db: 'ok' });

  // Se simula la caída: cada consulta del pool falla con un mensaje que trae host, puerto y usuario.
  const detalle = 'connect ECONNREFUSED 10.9.8.7:6543 (usuario operador_secreto)';
  const original = pool.query;
  const consola = console.error;
  const registro = [];
  pool.query = async () => { throw new Error(detalle); };
  console.error = (...partes) => { registro.push(partes.map(String).join(' ')); };
  let estado = null;
  let paso = false;
  let caida;
  try {
    // El limitador, llamado directo con tope 0: si pudiera contar, la primera petición ya sobraría y respondería 429.
    const res = { set() { return this; }, status(c) { estado = c; return this; }, json() { return this; } };
    await limitador({ ventanaMs: 60_000, max: 0, nombre: 'prueba_caida' })(
      { ip: '10.0.0.9', method: 'GET', originalUrl: '/api/x', get: () => null }, res, () => { paso = true; });
    // Por HTTP: el tope general por IP tampoco frena; la salud responde 503 sin el detalle.
    const r = await fetch(`${base}/api/salud`);
    caida = { status: r.status, texto: await r.text() };
  } finally {
    pool.query = original;
    console.error = consola;
  }
  assert.equal(paso, true, 'el limitador deja pasar cuando la base no responde');
  assert.equal(estado, null, 'y no responde nada por su cuenta');
  assert.equal(caida.status, 503);
  const cuerpo = JSON.parse(caida.texto);
  assert.equal(cuerpo.ok, false);
  assert.equal(cuerpo.db, 'error');
  assert.doesNotMatch(caida.texto, /ECONNREFUSED|10\.9\.8\.7|6543|operador_secreto/, 'la respuesta no delata la conexión');
  assert.ok(registro.some((l) => l.includes('[limites]') && l.includes('ECONNREFUSED')), 'el limitador deja constancia en el registro');
  assert.ok(registro.some((l) => l.includes('[salud]') && l.includes('ECONNREFUSED')), 'el detalle de la salud queda en el registro del servidor');
  // Vuelta la base, la salud se recupera.
  assert.equal((await fetch(`${base}/api/salud`)).status, 200);
});

test('seguridad (A02/A05): la herramienta de registro fotográfico tiene su propia CSP: corre sus scripts y jsPDF, y solo habla con este sitio', async () => {
  // Las pruebas no dependen de que exista frontend/dist: se arma uno mínimo con la herramienta real.
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'bitacora-dist-'));
  await fs.mkdir(path.join(dist, 'herramientas'));
  await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Bitácora</title>');
  await fs.copyFile(path.join(aqui, '../../frontend/public/herramientas/registro-fotografico.html'),
    path.join(dist, 'herramientas', 'registro-fotografico.html'));
  const previo = process.env.FRONTEND_DIST;
  process.env.FRONTEND_DIST = dist;
  const otro = crearApp().listen(0);
  if (previo === undefined) delete process.env.FRONTEND_DIST;
  else process.env.FRONTEND_DIST = previo;
  const sitio = `http://127.0.0.1:${otro.address().port}`;
  // «a b; c d e» -> { a: ['b'], c: ['d', 'e'] }
  const directivas = (csp) => Object.fromEntries(String(csp || '').split(';')
    .map((d) => d.trim().split(/\s+/)).filter(([k]) => k).map(([k, ...v]) => [k, v]));
  try {
    const r = await fetch(`${sitio}/herramientas/registro-fotografico.html`);
    assert.equal(r.status, 200);
    const html = await r.text();
    const d = directivas(r.headers.get('content-security-policy'));
    assert.deepEqual(d['connect-src'], ["'self'"], 'los datos solo pueden ir a este mismo sitio');
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'self'"]);
    assert.deepEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepEqual(d['img-src'], ["'self'", 'data:', 'blob:'], 'las fotos se leen como blob: y se guardan como data:');
    assert.ok(d['style-src'].includes("'unsafe-inline'"), 'sus estilos van en línea');
    assert.ok(d['script-src'].includes("'unsafe-inline'"), 'sus scripts van en línea');
    assert.ok(!d['script-src'].includes("'unsafe-eval'"));
    assert.ok(!d['script-src'].some((s) => s === '*' || /^https?:$/.test(s)), 'sin comodines en script-src');
    // Cada script externo del HTML sale de un origen que la política permite.
    const externos = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => new URL(src, sitio).origin);
    assert.ok(externos.length > 0, 'la herramienta carga jsPDF');
    for (const origen of externos) {
      assert.ok(origen === sitio || d['script-src'].includes(origen), `el script de ${origen} está permitido`);
    }
    assert.equal(r.headers.get('x-frame-options'), 'DENY');

    // El resto del sitio conserva su política estricta: sin scripts en línea ni el CDN de la herramienta.
    const inicio = await fetch(`${sitio}/`);
    assert.equal(inicio.status, 200);
    const app = directivas(inicio.headers.get('content-security-policy'));
    await inicio.text();
    assert.ok(!app['script-src'].includes("'unsafe-inline'"));
    assert.ok(!app['script-src'].includes('https://unpkg.com'));
    const api = await fetch(`${sitio}/api/auth/sesion`);
    assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    await api.text();
  } finally {
    await new Promise((r) => otro.close(r));
    await fs.rm(dist, { recursive: true, force: true });
  }
});

test('db:demo se niega a cargar los datos de ejemplo en una base que no es de demostración, pruebas ni desarrollo', async (t) => {
  const pg = (await import('pg')).default;
  const { config } = await import('../src/config.js');
  // Base desechable en el mismo servidor de pruebas, con un nombre sin «demo», «test» ni «dev».
  const nombre = 'bitacora_guarda_ejemplos';
  try {
    await query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    await query(`CREATE DATABASE ${nombre}`);
  } catch (err) {
    t.skip(`el usuario de pruebas no puede crear bases: ${err.message}`);
    return;
  }
  try {
    const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
    if (entorno.DATABASE_URL) {
      const url = new URL(entorno.DATABASE_URL);
      url.pathname = `/${nombre}`;
      entorno.DATABASE_URL = url.href;
    } else {
      entorno.PGDATABASE = nombre;
    }
    const { spawn } = await import('node:child_process');
    const hijo = spawn(process.execPath, [path.join(aqui, '../scripts/migrar.js'), '--demo'], { env: entorno, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { salida += d; });
    const codigo = await new Promise((r) => hijo.once('exit', r));
    assert.equal(codigo, 1, salida);
    assert.match(salida, /Los datos de ejemplo no se cargan en la base «bitacora_guarda_ejemplos»/);
    assert.match(salida, /«demo», «test» o «dev»/);
    assert.doesNotMatch(salida, /Esquema aplicado|Datos de ejemplo cargados/);
    // Se negó antes de tocar nada: la base sigue sin tablas.
    const c = new pg.Client({
      ...(entorno.DATABASE_URL ? { connectionString: entorno.DATABASE_URL } : { database: nombre }),
      ...(config.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    await c.connect();
    try {
      const { rows: [{ tablas }] } = await c.query("SELECT count(*)::int AS tablas FROM pg_tables WHERE schemaname = 'public'");
      assert.equal(tablas, 0, 'no aplicó el esquema ni sembró nada');
    } finally {
      await c.end();
    }
  } finally {
    await query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  }
});

// ---------------- Cargue del RIT ----------------
test('cargue del RIT: empalma por cédula y nombre, marca el RIT y dice la fila y la columna de cada error', async () => {
  const { cedulaDe, nombresCoinciden } = cargueRit;
  assert.equal(cedulaDe(' 1.045.000 '), '1045000');
  assert.ok(nombresCoinciden('Juan Carlos Pérez Gómez', 'PEREZ JUAN'));      // tildes, mayúsculas, orden y palabras de menos
  assert.ok(!nombresCoinciden('Juan Pérez', 'Ana Gómez'));
  assert.ok(!nombresCoinciden('', 'Ana'));

  // Casos propios (se borran al final): con expediente sin RIT, con RIT, otra persona, sin expediente y sin U.P.
  const crear = async (doc, nombre1, apellido1, idUnico, expediente) => {
    const { rows: [rep] } = await query(
      'INSERT INTO representantes (documento, nombre1, apellido1) VALUES ($1, $2, $3) RETURNING id_representante', [doc, nombre1, apellido1]);
    if (!idUnico) return;
    const { rows: [up] } = await query(
      "INSERT INTO unidades_productivas (id_origen, id_unico, id_representante, nombre) VALUES ('RIT-' || $1::text, $1, $2, 'UP RIT') RETURNING id_up",
      [idUnico, rep.id_representante]);
    if (expediente !== undefined) {
      await query('INSERT INTO expedientes_up (id_origen, id_up, rit_tiene) VALUES ($1, $2, $3)', [`DOC-RIT-${idUnico}`, up.id_up, expediente]);
    }
  };
  const ritDe = async (idUnico) => (await query(
    'SELECT e.rit_tiene FROM expedientes_up e JOIN unidades_productivas up ON up.id_up = e.id_up WHERE up.id_unico = $1', [idUnico])).rows[0]?.rit_tiene;

  try {
    await crear('7001', 'Rita', 'Prueba', '9101', false);
    await crear('7002', 'Luis', 'Tiene', '9102', true);
    await crear('7003', 'Nombre', 'Real', '9103', false);
    await crear('7004', 'Sin', 'Expediente', '9104');
    await crear('7005', 'Sin', 'Unidad');

    await rechaza(cargueRit.cargarRit(G1, { filas: [{ fila: 2, cedula: '7001', nombre: 'Rita Prueba' }] }), 403);
    await rechaza(cargueRit.cargarRit(DATOS, { filas: [] }), 400);
    await rechaza(cargueRit.cargarRit(DATOS, { filas: Array.from({ length: 501 }, (_, i) => ({ fila: i + 2, cedula: String(i), nombre: 'x' })) }), 400);

    const filas = [
      { fila: 2, cedula: '7001', nombre: 'Rita Prueba' },       // existe y coincide → se marca
      { fila: 3, cedula: '7.002', nombre: 'Tiene, Luis' },      // ya tenía RIT → sin cambios (punto y orden del nombre no importan)
      { fila: 4, cedula: '7003', nombre: 'Otra Persona' },      // la cédula es de otra persona
      { fila: 5, cedula: '9999999', nombre: 'Nadie' },          // no existe
      { fila: 6, cedula: '7004', nombre: 'Sin Expediente' },    // U.P. sin expediente
      { fila: 7, cedula: '7005', nombre: 'Sin Unidad' },        // sin U.P.
      { fila: 8, cedula: '', nombre: 'Falta Cédula' },          // cédula vacía
      { fila: 9, cedula: '7001', nombre: '' },                  // nombre vacío
    ];
    const r = await cargueRit.cargarRit(DATOS, { filas });
    assert.equal(r.actualizados, 1);
    assert.equal(r.sin_cambios, 1);
    assert.deepEqual(r.errores.map((e) => [e.fila, e.columna]),
      [[4, 'nombre'], [5, 'cedula'], [6, 'cedula'], [7, 'cedula'], [8, 'cedula'], [9, 'nombre']]);
    assert.match(r.errores[0].motivo, /«Nombre Real».*«Otra Persona»/);
    assert.match(r.errores[1].motivo, /no existe en la base de datos/);
    assert.match(r.errores[2].motivo, /9104.*no tiene expediente/);
    assert.match(r.errores[3].motivo, /ninguna unidad productiva/);

    assert.equal(await ritDe('9101'), true);
    assert.equal(await ritDe('9103'), false);                   // el de nombre distinto no se toca
    assert.equal(await ritDe('9104'), undefined);

    // Se puede repetir: lo que ya quedó marcado cuenta como sin cambios.
    const otra = await cargueRit.cargarRit(DATOS, { filas: [filas[0]] });
    assert.deepEqual([otra.actualizados, otra.sin_cambios, otra.errores.length], [0, 1, 0]);

    // Queda en el historial de la U.P. y en la actividad del cargue.
    const deLaUP = (await actividad.listarActividad(ADMIN, { up: '9101' })).items;
    assert.ok(deLaUP.some((x) => x.accion === 'cargue.rit' && x.cambios.campos?.rit_tiene?.[1] === true));
    const lotes = (await actividad.listarActividad(ADMIN, { accion: 'cargue.rit' })).items;
    assert.ok(lotes.some((x) => x.cambios.actualizados === 1 && x.cambios.errores === 6));
  } finally {
    await query("DELETE FROM expedientes_up WHERE id_origen LIKE 'DOC-RIT-%'");
    await query("DELETE FROM unidades_productivas WHERE id_origen LIKE 'RIT-%'");
    await query("DELETE FROM representantes WHERE documento IN ('7001','7002','7003','7004','7005')");
  }
});

// ---------------- Visita cerrada de formato antiguo (sin documento) ----------------
test('visitas: una visita cerrada de formato antiguo se lista y la coordinación la puede reabrir', async () => {
  const { rows: [t] } = await query("SELECT id_triada FROM triadas WHERE nodo = 'ATLAN1'");
  const { rows: [rep] } = await query("INSERT INTO representantes (documento, nombre1, apellido1) VALUES ('9900001', 'Luz', 'Antigua') RETURNING id_representante");
  const { rows: [up] } = await query(
    "INSERT INTO unidades_productivas (id_origen, id_unico, id_triada, id_representante, nombre, modalidad) VALUES ('LEG-1', 'LEG-1', $1, $2, 'UP Antigua', 'M1') RETURNING id_up",
    [t.id_triada, rep.id_representante]);
  try {
    // Una V1 cerrada solo por la columna (sin documento), como las de antes de que existiera `documento`; y una abierta sin datos.
    await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, unidad_nombre, nodo_gestor, tipo_visita, estado_visita, cerrada, fecha_cierre, documento)
                 VALUES ('9900001_v1', $1, 'LEG-1', '9900001', 'UP Antigua', 'ATLAN1', 'v1', 'EXITOSA', TRUE, '2026-10-21T01:07:11Z', NULL)`, [up.id_up]);
    await query(`INSERT INTO visitas (id, id_up, id_unico, unidad_doc, unidad_nombre, nodo_gestor, tipo_visita, cerrada, documento)
                 VALUES ('9900001_v1_3', $1, 'LEG-1', '9900001', 'UP Antigua', 'ATLAN1', 'v1', FALSE, NULL)`, [up.id_up]);

    // Se lista como una visita cerrada (la abierta sin datos no se entrega).
    const lista = (await visitas.listarVisitas(COORD, { unidad_doc: '9900001' })).items;
    assert.deepEqual(lista.map((x) => x.id), ['9900001_v1']);
    const antigua = lista[0];
    assert.deepEqual([antigua.visita.tipo, antigua.cierre.cerrada, antigua.situacion, antigua.unidad.id_unico, antigua.unidad.modalidad, antigua.realizacion.estado],
      ['v1', true, 'CERRADA', 'LEG-1', 'M1', 'EXITOSA']);
    assert.equal(antigua.cierre.fecha_cierre, '2026-10-21T01:07:11.000Z');
    assert.equal((await visitas.listarVisitas(G1, { unidad_doc: '9900001' })).items.length, 1, 'el gestor de su nodo la ve');
    assert.equal((await visitas.listarVisitas(G2, { unidad_doc: '9900001' })).items.length, 0, 'otro nodo no la ve');

    // Mientras esté cerrada, otra V1 de la unidad se rechaza; el gestor no la reabre; sin motivo tampoco.
    await rechazaCon(guardarV(COORD, { ...antigua, id: '9900001_v1_2', cierre: { cerrada: false }, realizacion: { estado: null } }), 409, /ya está cerrada/);
    await rechaza(guardarV(G1, antigua, { reabrir: true, motivo: 'quiero' }), 403);
    await rechaza(guardarV(COORD, antigua, { reabrir: true }), 400);

    // La coordinación la reabre: queda con documento, el cierre anterior consta en la reapertura y deja de bloquear.
    const r = (await guardarV(COORD, antigua, { reabrir: true, motivo: 'Faltó diligenciar la verificación' })).item;
    assert.equal(r.cierre.cerrada, false);
    assert.equal(r.cierre.reaperturas.length, 1);
    assert.deepEqual([r.cierre.reaperturas[0].motivo, r.cierre.reaperturas[0].reabierta_por, r.cierre.reaperturas[0].cerrada_antes_en],
      ['Faltó diligenciar la verificación', 'Coord', '2026-10-21T01:07:11.000Z']);
    const fila = (await query("SELECT cerrada, documento IS NOT NULL AS con_documento FROM visitas WHERE id = '9900001_v1'")).rows[0];
    assert.deepEqual(fila, { cerrada: false, con_documento: true });
    assert.equal((await visitas.listarVisitas(COORD, { unidad_doc: '9900001' })).items.find((x) => x.id === '9900001_v1').cierre.cerrada, false);
    await rechaza(guardarV(COORD, antigua, { reabrir: true, motivo: 'otra vez' }), 400);   // ya no está cerrada
    assert.equal((await actividad.listarActividad(COORD, { up: 'LEG-1' })).items.some((x) => x.accion === 'visitas.reabrir'), true);
  } finally {
    await query("DELETE FROM visitas WHERE unidad_doc = '9900001'");
    await query("DELETE FROM unidades_productivas WHERE id_unico = 'LEG-1'");
    await query("DELETE FROM representantes WHERE documento = '9900001'");
  }
});
