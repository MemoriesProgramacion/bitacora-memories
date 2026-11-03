// Avisos para todos los usuarios y modo mantenimiento. Quien tiene acceso total publica avisos que ven todos
// mientras estén vigentes y puede poner la aplicación en mantenimiento: todos consultan y nadie guarda, salvo
// quien tiene acceso total.
import crypto from 'node:crypto';
import { query } from '../db.js';
import { prohibido, solicitudInvalida } from '../errores.js';
import { registrar } from './actividad.js';
import { correoValido } from './correo.js';

export const MAX_CORREOS_TICKETS = 20;

// Devuelve los correos que siguen los tickets.
export async function correosTickets() {
  const { rows } = await query("SELECT valor FROM configuracion WHERE clave = 'correos_tickets'");
  const xs = rows[0]?.valor?.correos;
  return Array.isArray(xs) ? xs.filter(correoValido) : [];
}

export const NIVELES = ['info', 'alerta', 'urgente'];
const TEXTO_MANTENIMIENTO = 'La app está en mantenimiento: puedes consultar, pero no guardar.';

// Guarda 10 segundos en memoria el estado de mantenimiento, que se consulta en cada escritura.
let cache = { hasta: 0, valor: { activo: false, texto: '' } };

// Devuelve si la aplicación está en mantenimiento y su texto.
export async function estadoMantenimiento() {
  if (Date.now() < cache.hasta) return cache.valor;
  const { rows } = await query("SELECT valor FROM configuracion WHERE clave = 'mantenimiento'");
  const v = rows[0]?.valor || {};
  cache = { hasta: Date.now() + 10_000, valor: { activo: v.activo === true, texto: String(v.texto || '') } };
  return cache.valor;
}
// Borra el estado de mantenimiento guardado en memoria.
export const olvidarCache = () => { cache = { hasta: 0, valor: cache.valor }; };

const esSuperadmin = (u) => !!u?.superadmin;

const aAviso = (r) => ({
  id: r.id, texto: r.texto, nivel: r.nivel, hasta: r.hasta, creado_en: r.creado_en, creado_por: r.creado_por,
});

// Devuelve los avisos vigentes, o todos si los pide quien tiene acceso total, y el estado de mantenimiento.
export async function leerConfig(usuario, { todos } = {}) {
  const verTodos = todos === '1' && esSuperadmin(usuario);
  const { rows } = await query(
    `SELECT * FROM avisos_globales
      WHERE NOT retirado AND ($1::boolean OR (desde <= now() AND hasta > now()))
      ORDER BY creado_en DESC LIMIT 50`, [verTodos]);
  const m = await estadoMantenimiento();
  return {
    ok: true,
    avisos: rows.map(aAviso),
    mantenimiento: m.activo,
    mantenimiento_texto: m.activo ? (m.texto || TEXTO_MANTENIMIENTO) : '',
    ...(verTodos ? { correos_tickets: await correosTickets() } : {}),
  };
}

// Ejecuta una acción de configuración de quien tiene acceso total, como publicar un aviso con su texto, nivel y
// fecha de fin.
export async function accionConfig(usuario, cuerpo = {}) {
  if (!esSuperadmin(usuario)) throw prohibido('Solo el superadmin administra los avisos.');
  const accion = String(cuerpo.accion || '');

  if (accion === 'publicar_aviso') {
    const texto = String(cuerpo.texto ?? '').trim();
    if (!texto) throw solicitudInvalida('Escribe el texto del aviso.');
    if (texto.length > 300) throw solicitudInvalida('El aviso no puede pasar de 300 caracteres.');
    if (!NIVELES.includes(cuerpo.nivel)) throw solicitudInvalida('Nivel de aviso no válido.');
    const hasta = new Date(cuerpo.hasta);
    if (Number.isNaN(hasta.getTime()) || hasta.getTime() <= Date.now()) throw solicitudInvalida('La fecha de fin debe ser futura.');
    const id = crypto.randomUUID();
    await query('INSERT INTO avisos_globales (id, texto, nivel, hasta, creado_por) VALUES ($1,$2,$3,$4,$5)',
      [id, texto, cuerpo.nivel, hasta.toISOString(), usuario.nombre || usuario.sub]);
    await registrar(usuario, { accion: 'config.publicar_aviso', objeto: { tipo: 'aviso', id }, cambios: { nivel: cuerpo.nivel, hasta: hasta.toISOString() } });
  } else if (accion === 'retirar_aviso') {
    const r = await query('UPDATE avisos_globales SET retirado = TRUE WHERE id = $1 AND NOT retirado', [String(cuerpo.id || '')]);
    if (!r.rowCount) throw solicitudInvalida('Ese aviso no existe o ya se retiró.');
    await registrar(usuario, { accion: 'config.retirar_aviso', objeto: { tipo: 'aviso', id: cuerpo.id } });
  } else if (accion === 'mantenimiento') {
    const activo = cuerpo.activo === true;
    const texto = String(cuerpo.texto ?? '').trim().slice(0, 300);
    await query(
      `INSERT INTO configuracion (clave, valor) VALUES ('mantenimiento', $1)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
      [JSON.stringify({ activo, texto })]);
    olvidarCache();
    await registrar(usuario, { accion: 'config.mantenimiento', objeto: { tipo: 'mantenimiento', id: null }, cambios: { activo } });
  } else if (accion === 'correos_tickets') {
    const entrada = Array.isArray(cuerpo.correos) ? cuerpo.correos : String(cuerpo.correos ?? '').split(/[\s,;]+/);
    const correos = [...new Set(entrada.map((c) => String(c).trim().toLowerCase()).filter(Boolean))];
    const malo = correos.find((c) => !correoValido(c));
    if (malo) throw solicitudInvalida(`«${malo.slice(0, 80)}» no es un correo válido.`);
    if (correos.length > MAX_CORREOS_TICKETS) throw solicitudInvalida(`Se admiten máximo ${MAX_CORREOS_TICKETS} correos.`);
    const antes = await correosTickets();
    await query(
      `INSERT INTO configuracion (clave, valor) VALUES ('correos_tickets', $1)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
      [JSON.stringify({ correos })]);
    await registrar(usuario, { accion: 'config.correos_tickets', objeto: { tipo: 'configuracion', id: 'correos_tickets' }, cambios: { campos: { correos: [antes.length, correos.length] } } });
  } else {
    throw solicitudInvalida('Acción desconocida.');
  }
  return leerConfig(usuario, { todos: '1' });
}

// Middleware que impide guardar cuando se mira como otro usuario o cuando hay mantenimiento, salvo para quien
// tiene acceso total.
export async function bloquearEscrituraEnMantenimiento(req, res, next) {
  try {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (req.usuario?.sim) {
      return res.status(403).json({ ok: false, error: 'simulacion', detalle: 'En «Ver como» no se guardan cambios. Vuelve a superadmin para guardar.' });
    }
    if (req.usuario?.superadmin || !req.usuario) return next();
    const m = await estadoMantenimiento();
    if (!m.activo) return next();
    return res.status(403).json({ ok: false, error: 'mantenimiento', detalle: m.texto || TEXTO_MANTENIMIENTO });
  } catch (err) { return next(err); }
}
