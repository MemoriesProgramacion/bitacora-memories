// Tickets de novedades. Se radican con la etapa del proceso, la descripción, hasta 5 archivos, la región y la
// unidad productiva si aplica; se atienden por niveles, se asignan, escalan y resuelven, y avisan por correo
// cada movimiento. Los respondidos sin confirmación quedan solucionados a los 5 días hábiles.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { ROLES, config } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, entero, normNodo } from '../util.js';
import { nodosEnAlcance, enAlcance, normTexto, exigirAlcance } from '../alcance.js';
import { registrar, corto, SISTEMA } from './actividad.js';
import { contenidoValido } from './tipoArchivo.js';
import { buscarUP } from './unidades.js';
import { encolarCorreo } from './correo.js';
import { sumarDiasHabiles } from './diasHabiles.js';
import { hoyColombia } from './secciones.js';
import { correosTickets } from './configuracion.js';
import { ORIGENES, leerCuenta, listarOrigen } from '../acceso/cuentas.js';

export const ESTADOS = ['abierto', 'en_gestion', 'asignado', 'escalado', 'respondido', 'resuelto'];
export const ACCIONES = ['tomar', 'asignar', 'escalar', 'resolver', 'confirmar', 'reabrir'];
export const ETAPAS = {
  diagnostico: 'Diagnóstico', fortalecimiento: 'Fortalecimiento', capitalizacion: 'Capitalización',
  acompanamiento: 'Acompañamiento y seguimiento', administrativo: 'Administrativo/financiero',
  retiro: 'Retiro', reemplazo: 'Reemplazo',
};
export const ROLES_ASIGNABLES = [ROLES.TECNICO, ROLES.GESTOR, ROLES.TALLERISTA];
export const NOMBRE_ROL = {
  [ROLES.TECNICO]: 'Técnico administrativo regional de apoyo', [ROLES.GESTOR]: 'Gestor', [ROLES.TALLERISTA]: 'Tallerista',
};
export const MAX_ARCHIVOS = 5;
const MAX_MB_FOTO = 5;
const MAX_BYTES_CORREO = 10 * 1024 * 1024;
export const DIAS_CONFIRMAR = 5;
const LIMITE = 2000;
const MAX_ID = 2147483647;

const esGeneral = (u) => !!u?.general;
const esRegional = (u) => u?.rol === ROLES.COORDINADOR && !u.general;
export const consecutivo = (id) => `TK-${String(id).padStart(5, '0')}`;

function exigirAcceso(usuario) {
  if (esGeneral(usuario)) return;
  if (![ROLES.COORDINADOR, ROLES.TECNICO, ROLES.GESTOR, ROLES.TALLERISTA].includes(usuario?.rol)) {
    throw prohibido('Los tickets son para los gestores y la coordinación.');
  }
}

function rolLegible(usuario) {
  if (usuario?.esDatos) return 'Profesional de seguimiento e información';
  if (esGeneral(usuario)) return 'Coordinador general';
  if (esRegional(usuario)) return 'Coordinador local regional';
  return NOMBRE_ROL[usuario?.rol] || usuario?.rol || '';
}

const entrada = (usuario, accion, estado, nivel, nota, extra = {}) => ({
  accion, estado, nivel, nota: nota || null, ...extra,
  por: usuario.nombre, rol: rolLegible(usuario), cuando: new Date().toISOString(),
});

// Devuelve la región de la cuenta: la del nodo o la de su territorio.
async function regionDe(usuario) {
  if (usuario.rol === ROLES.GESTOR) {
    const { rows: [t] } = await query('SELECT region FROM triadas WHERE upper(btrim(nodo)) = $1 LIMIT 1', [normNodo(usuario.nodo)]);
    return t?.region || null;
  }
  return usuario.alcance?.region || null;
}

// Indica si el ticket está en la cola del tipo de cuenta del usuario: asignado a su tipo, sin persona concreta
// y en su región.
async function enCola(t, usuario, region) {
  if (t.asignado_sub || !t.asignado_rol || t.asignado_rol !== usuario.rol || !t.region) return false;
  const r = region === undefined ? await regionDe(usuario) : region;
  return Boolean(r) && normTexto(r) === normTexto(t.region);
}
const esAsignado = (t, usuario) => Boolean(t.asignado_sub) && t.asignado_sub === usuario.sub;

// Convierte una fila en lo que ve el usuario e indica qué botones mostrar.
function aDoc(t, usuario, { atiendeT, colaT, adjuntos = [] }) {
  const vivo = !['respondido', 'resuelto'].includes(t.estado);
  const solicitante = t.creado_por === usuario.sub;
  const responde = vivo && (atiendeT || esAsignado(t, usuario) || colaT);
  return {
    id: t.id, consecutivo: consecutivo(t.id), titulo: t.titulo, descripcion: t.descripcion,
    etapa: t.etapa, nombre_etapa: ETAPAS[t.etapa] || null, region: t.region, nodo: t.nodo,
    id_unico: t.id_unico, unidad: t.unidad_nombre || null,
    estado: t.estado, nivel: t.nivel,
    asignado: t.asignado_sub ? { tipo: 'cuenta', nombre: t.asignado_nombre, rol: t.asignado_rol, nombre_rol: NOMBRE_ROL[t.asignado_rol] || t.asignado_rol }
      : t.asignado_rol ? { tipo: 'rol', rol: t.asignado_rol, nombre_rol: NOMBRE_ROL[t.asignado_rol] || t.asignado_rol } : null,
    creado_por: t.creado_por_nombre, creado_por_rol: t.creado_por_rol, es_mio: solicitante,
    creado_en: t.creado_en, actualizado_en: t.actualizado_en, respondido_en: t.respondido_en, resuelto_en: t.resuelto_en,
    confirmar_hasta: t.confirmar_hasta,
    adjuntos: adjuntos.map((a) => ({ id: a.id, clase: a.clase, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano })),
    historial: Array.isArray(t.historial) ? t.historial : [],
    puede: {
      tomar: vivo && atiendeT && !['en_gestion'].includes(t.estado),
      asignar: vivo && atiendeT,
      escalar: vivo && atiendeT && esRegional(usuario),
      resolver: responde,
      confirmar: t.estado === 'respondido' && solicitante,
      reabrir: t.estado === 'respondido' && solicitante,
    },
  };
}

// Arma la condición de visibilidad del usuario agregando sus valores a los parámetros.
async function condicionVisibilidad(usuario, params, region) {
  if (esGeneral(usuario)) return 'TRUE';
  params.push(usuario.sub);
  const propio = `t.creado_por = $${params.length} OR t.asignado_sub = $${params.length}`;
  let cola = 'FALSE';
  if (ROLES_ASIGNABLES.includes(usuario.rol) && region) {
    params.push(usuario.rol, normTexto(region));
    cola = `(t.asignado_rol = $${params.length - 1} AND t.asignado_sub IS NULL AND upper(translate(btrim(t.region), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) = $${params.length})`;
  }
  if (usuario.rol === ROLES.TALLERISTA) return `(${propio} OR ${cola})`;
  if (usuario.rol === ROLES.GESTOR) {
    params.push(normNodo(usuario.nodo));
    return `(upper(t.nodo) = $${params.length} OR ${propio} OR ${cola})`;
  }
  const nodos = (await nodosEnAlcance(usuario)) || [];
  params.push(nodos);
  return `(upper(t.nodo) = ANY($${params.length}::text[]) OR ${propio} OR ${cola} OR t.alcance IS NOT NULL OR (t.nodo IS NULL AND t.region IS NOT NULL))`;
}

// Indica si el usuario ve el ticket según quién lo abrió, a quién está asignado y el territorio.
function visible(t, usuario, colaT) {
  if (esGeneral(usuario) || t.creado_por === usuario.sub || esAsignado(t, usuario) || colaT) return true;
  if (usuario.rol === ROLES.GESTOR || usuario.rol === ROLES.TALLERISTA) return !t.alcance && Boolean(t.nodo) && normNodo(t.nodo) === normNodo(usuario.nodo);
  if (t.alcance) return enAlcance(usuario, t.alcance);
  if (!t.nodo && t.region) return enAlcance(usuario, { region: t.region });
  return true;
}

const SELECT = `SELECT t.*, up.nombre AS unidad_nombre FROM tickets t LEFT JOIN unidades_productivas up ON up.id_up = t.id_up`;

// Indica si el usuario lo atiende en su nivel actual.
function atiende(t, usuario, nodos) {
  if (esGeneral(usuario)) return true;
  if (!esRegional(usuario) || t.nivel !== 'regional') return false;
  return t.alcance ? enAlcance(usuario, t.alcance) : (nodos || []).includes(normNodo(t.nodo));
}

// Devuelve las filas visibles para el usuario con sus archivos y lo que puede hacer en cada una.
async function documentar(rows, usuario, region) {
  const adj = await adjuntosDe(rows.map((t) => t.id));
  const nodos = esRegional(usuario) ? (await nodosEnAlcance(usuario)) || [] : null;
  const items = [];
  for (const t of rows) {
    const colaT = await enCola(t, usuario, region);
    if (!visible(t, usuario, colaT)) continue;
    items.push(aDoc(t, usuario, { atiendeT: atiende(t, usuario, nodos), colaT, adjuntos: adj.get(t.id) || [] }));
  }
  return items;
}
// Devuelve un ticket con la misma visibilidad de la bandeja, o null si no existe.
async function docDe(id, usuario) {
  const region = ROLES_ASIGNABLES.includes(usuario.rol) ? await regionDe(usuario) : null;
  const params = [id];
  const condicion = await condicionVisibilidad(usuario, params, region);
  const { rows } = await query(`${SELECT} WHERE t.id = $1 AND ${condicion}`, params);
  return (await documentar(rows, usuario, region))[0] || null;
}

async function adjuntosDe(ids) {
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT id, ticket_id, clase, nombre, tipo, tamano FROM tickets_adjuntos WHERE ticket_id = ANY($1::int[]) ORDER BY id', [ids]);
  const m = new Map();
  for (const a of rows) m.set(a.ticket_id, [...(m.get(a.ticket_id) || []), a]);
  return m;
}

// Devuelve la bandeja de tickets del usuario con filtros por estado, etapa, asignado y texto.
export async function listarTickets(usuario, filtros = {}) {
  exigirAcceso(usuario);
  await cerrarSinConfirmar();
  const region = await regionDe(usuario).catch(() => null);
  const params = [];
  const condicion = await condicionVisibilidad(usuario, params, region);
  const extra = [];
  if (ESTADOS.includes(txt(filtros.estado))) { params.push(txt(filtros.estado)); extra.push(`t.estado = $${params.length}`); }
  if (ETAPAS[txt(filtros.etapa)]) { params.push(txt(filtros.etapa)); extra.push(`t.etapa = $${params.length}`); }
  const asignado = txt(filtros.asignado);
  if (asignado?.startsWith('rol:')) { params.push(asignado.slice(4)); extra.push(`t.asignado_rol = $${params.length} AND t.asignado_sub IS NULL`); }
  else if (asignado?.startsWith('cuenta:')) { params.push(asignado.slice(7)); extra.push(`t.asignado_sub = $${params.length}`); }
  const q = txt(filtros.q)?.slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    extra.push(`(t.titulo ILIKE $${params.length} OR t.descripcion ILIKE $${params.length} OR t.id_unico ILIKE $${params.length} OR ('TK-' || lpad(t.id::text, 5, '0')) ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `${SELECT} WHERE ${condicion}${extra.length ? ` AND ${extra.join(' AND ')}` : ''} ORDER BY t.actualizado_en DESC LIMIT ${LIMITE}`, params);
  const items = await documentar(rows, usuario, region);
  return { ok: true, items, etapas: ETAPAS, roles_asignables: Object.fromEntries(ROLES_ASIGNABLES.map((r) => [r, NOMBRE_ROL[r]])) };
}

const nombreOriginal = (a) => Buffer.from(a?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 300);
// Lee los archivos adjuntos que llegan con el ticket y valida que no pasen del máximo permitido.
async function leerArchivos(archivos, que) {
  const lista = Array.isArray(archivos?.adjuntos) ? archivos.adjuntos : [];
  if (lista.length > MAX_ARCHIVOS) throw solicitudInvalida(`Se admiten máximo ${MAX_ARCHIVOS} archivos ${que}.`);
  const salida = [];
  for (const a of lista) {
    const nombre = nombreOriginal(a);
    const ext = path.extname(nombre).toLowerCase();
    const esPdf = ext === '.pdf';
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) || !(await contenidoValido(a.path, nombre, ['.pdf', '.jpg', '.jpeg', '.png']))) {
      throw solicitudInvalida(`«${nombre}» debe ser un PDF, JPG o PNG válido.`);
    }
    const mb = esPdf ? config.maxMbPdf : MAX_MB_FOTO;
    if ((a.size || 0) > mb * 1024 * 1024) throw new HttpError(413, `«${nombre}» supera los ${mb} MB.`);
    salida.push({ nombre, tipo: esPdf ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg', tamano: a.size || 0, contenido: await fs.readFile(a.path) });
  }
  return salida;
}
// Guarda los archivos adjuntos de un ticket.
async function guardarArchivos(db, ticketId, clase, archivos, quien) {
  for (const a of archivos) {
    await db.query('INSERT INTO tickets_adjuntos (ticket_id, clase, nombre, tipo, tamano, contenido, subido_por) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [ticketId, clase, a.nombre, a.tipo, a.tamano, a.contenido, quien]);
  }
}

async function correoDeSub(sub) {
  const [origen, id] = String(sub || '').split(':');
  if (!ORIGENES.includes(origen) || !Number.isInteger(Number(id))) return null;
  const c = await leerCuenta(origen, Number(id)).catch(() => null);
  return c?.activo && c.correo ? c.correo : null;
}
// Calcula los correos a avisar: los configurados para tickets, quien lo abrió y quien lo tiene asignado.
async function destinatarios(db, t) {
  const para = [...(await correosTickets())];
  const solicitante = await correoDeSub(t.creado_por);
  if (solicitante) para.push(solicitante);
  if (t.asignado_sub) { const c = await correoDeSub(t.asignado_sub); if (c) para.push(c); }
  const [coordinadores, gestores] = await Promise.all([listarOrigen('coordinador'), t.asignado_rol === ROLES.GESTOR && !t.asignado_sub ? listarOrigen('gestor') : []]);
  const deRegion = (c) => t.region && normTexto(c.region) === normTexto(t.region);
  for (const c of [...coordinadores, ...gestores]) {
    if (!c.activo || !c.correo) continue;
    if (c.rol === ROLES.COORDINADOR && (deRegion(c) || (t.nodo && normNodo(c.nodo) === normNodo(t.nodo)))) para.push(c.correo);
    if (!t.asignado_sub && t.asignado_rol && c.rol === t.asignado_rol && deRegion(c)) para.push(c.correo);
  }
  if (t.nivel === 'general') {
    const { rows } = await db.query("SELECT correo FROM superadmins WHERE activo AND correo IS NOT NULL UNION SELECT correo FROM coordinadores WHERE activo AND tipo = 'coordinador_datos' AND correo IS NOT NULL");
    para.push(...rows.map((r) => r.correo));
  }
  return para;
}

const ESTADO_CORREO = { abierto: 'Radicado', en_gestion: 'En gestión', asignado: 'Asignado', escalado: 'Escalado al nivel nacional', respondido: 'Respondido', resuelto: 'Solucionado' };

// Encola el aviso del movimiento dentro de la transacción que lo origina, antes del COMMIT.
async function avisar(db, t, mov) {
  const { rows: adj } = await db.query('SELECT id, clase, nombre, tamano FROM tickets_adjuntos WHERE ticket_id = $1 ORDER BY id', [t.id]);
  let total = 0;
  const adjuntos = [];
  const lineas = adj.map((a) => {
    const cabe = total + (a.tamano || 0) <= MAX_BYTES_CORREO;
    if (cabe) { total += a.tamano || 0; adjuntos.push({ origen: 'ticket', id: a.id }); }
    return `· ${a.nombre} (${a.clase === 'respuesta' ? 'respuesta' : 'radicación'}${cabe ? ', adjunto' : ', en la plataforma: los adjuntos pasan de 10 MB'})`;
  });
  const { rows: [u] } = t.id_up ? await db.query('SELECT nombre FROM unidades_productivas WHERE id_up = $1', [t.id_up]) : { rows: [] };
  const estado = ESTADO_CORREO[t.estado] || t.estado;
  const texto = [
    `Ticket ${consecutivo(t.id)} · ${estado}`, '',
    `Etapa: ${ETAPAS[t.etapa] || '—'}`, `Región: ${t.region || '—'}${t.nodo ? ` · Nodo: ${t.nodo}` : ''}`,
    `Unidad productiva: ${t.id_unico ? `${t.id_unico}${u?.nombre ? ` · ${u.nombre}` : ''}` : 'No aplica'}`,
    `Radicó: ${t.creado_por_nombre || '—'} (${t.creado_por_rol || '—'})`,
    t.asignado_nombre || t.asignado_rol ? `Asignado a: ${t.asignado_nombre || `cualquier ${NOMBRE_ROL[t.asignado_rol] || t.asignado_rol} de la región`}` : null,
    '', `Título: ${t.titulo}`, `Descripción: ${t.descripcion}`, '',
    `Último movimiento: ${mov.texto} por ${mov.por} (${mov.rol})${mov.nota ? `: ${mov.nota}` : ''}`,
    t.estado === 'respondido' && t.confirmar_hasta ? `El solicitante confirma la solución o la reabre hasta el ${t.confirmar_hasta}; si no, queda solucionado.` : null,
    '', adj.length ? `Archivos:\n${lineas.join('\n')}` : 'Sin archivos.',
  ].filter((x) => x !== null).join('\n');
  await encolarCorreo(db, {
    para: await destinatarios(db, t), origen: 'ticket', referencia: consecutivo(t.id),
    asunto: `${consecutivo(t.id)} · ${estado} · ${t.titulo}`.slice(0, 300), texto, adjuntos,
  });
}
const TEXTO_MOV = { crear: 'Radicado', tomar: 'Puesto en gestión', asignar: 'Asignado', escalar: 'Escalado al nivel nacional', resolver: 'Respondido', confirmar: 'Solución confirmada', reabrir: 'Reabierto', solucionado_auto: 'Solucionado sin confirmación' };

// Radica un ticket con título, descripción, etapa, unidad opcional, región y adjuntos.
export async function crearTicket(usuario, datos = {}, archivos = {}) {
  exigirAcceso(usuario);
  const titulo = txt(datos.titulo);
  const descripcion = txt(datos.descripcion);
  const etapa = txt(datos.etapa);
  if (!titulo) throw solicitudInvalida('Escribe el título del ticket.');
  if (!descripcion) throw solicitudInvalida('Describe la novedad.');
  if (!ETAPAS[etapa]) throw solicitudInvalida('Elige la etapa del proceso: Diagnóstico, Fortalecimiento, Capitalización, Acompañamiento y seguimiento, Administrativo/financiero, Retiro o Reemplazo.');

  const nodo = normNodo(usuario.nodo) || null;
  if (usuario.rol === ROLES.GESTOR && !nodo) throw solicitudInvalida('Tu usuario no tiene nodo asignado.');
  const nivel = esGeneral(usuario) || esRegional(usuario) ? 'general' : 'regional';
  const alcance = [ROLES.TECNICO, ROLES.TALLERISTA].includes(usuario.rol) ? usuario.alcance : null;
  if (usuario.rol === ROLES.TALLERISTA && !alcance?.region) throw solicitudInvalida('Tu usuario no tiene región asignada.');
  if (alcance && !Object.values(alcance).some(Boolean)) throw solicitudInvalida('Tu usuario no tiene territorio asignado.');

  let region = await regionDe(usuario);
  let up = null;
  if (txt(datos.id_unico)) {
    up = await buscarUP({ idUnico: txt(datos.id_unico) });
    if (!up) throw noEncontrado('Unidad productiva no encontrada.');
    exigirAlcance(usuario, up);
    region = up.region || region;
  }
  if (esGeneral(usuario) && !up && txt(datos.region)) region = txt(datos.region).slice(0, 100);
  const adjuntos = await leerArchivos(archivos, 'al radicar');

  const historial = [entrada(usuario, 'crear', 'abierto', nivel, null, adjuntos.length ? { anexos: adjuntos.length } : {})];
  const mov = { texto: TEXTO_MOV.crear, por: usuario.nombre, rol: rolLegible(usuario) };
  const t = await transaccion(async (db) => {
    const { rows: [fila] } = await db.query(
      `INSERT INTO tickets (titulo, descripcion, estado, nivel, nodo, creado_por, creado_por_nombre, creado_por_rol, historial, alcance,
                            etapa, region, id_up, id_unico)
       VALUES ($1, $2, 'abierto', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13) RETURNING *`,
      [titulo.slice(0, 150), descripcion.slice(0, 4000), nivel, nodo, usuario.sub, usuario.nombre, rolLegible(usuario),
        JSON.stringify(historial), alcance ? JSON.stringify(alcance) : null, etapa, region, up?.id_up ?? null, up?.id_unico ?? null]);
    await guardarArchivos(db, fila.id, 'radicacion', adjuntos, usuario.nombre || usuario.sub);
    await avisar(db, fila, mov);
    return fila;
  });
  await registrar(usuario, {
    accion: 'tickets.crear', objeto: { tipo: 'ticket', id: t.id }, idUnico: t.id_unico,
    cambios: { titulo: corto(t.titulo), etapa, nivel: t.nivel, nodo: t.nodo, region: t.region, anexos: adjuntos.length, campos: { estado: [null, t.estado] } },
  });
  return { ok: true, item: await docDe(t.id, usuario) };
}

// Devuelve las cuentas activas del territorio del ticket a las que se puede asignar.
async function cuentasAsignables(t, usuario) {
  const todas = (await Promise.all(['coordinador', 'gestor'].map(listarOrigen))).flat()
    .filter((c) => c.activo && ROLES_ASIGNABLES.includes(c.rol));
  const enTerritorio = (c) => {
    if (t.region && normTexto(c.region) !== normTexto(t.region) && !(t.nodo && normNodo(c.nodo) === normNodo(t.nodo))) return false;
    if (esGeneral(usuario)) return true;
    const terr = { nodo: c.nodo, region: c.region, departamento: c.departamento || null };
    if (c.rol === ROLES.GESTOR) { const { modalidad: _m, ...sin } = usuario.alcance || {}; return enAlcance({ ...usuario, alcance: sin }, terr); }
    return enAlcance(usuario, terr) || (t.region && normTexto(c.region) === normTexto(usuario.alcance?.region));
  };
  return todas.filter(enTerritorio).map((c) => ({ sub: `${c.origen}:${c.id}`, nombre: c.nombre, rol: c.rol, nombre_rol: NOMBRE_ROL[c.rol], nodo: c.nodo, region: c.region }));
}

async function ticketParaAtender(db, idTicket, usuario) {
  const { rows: [t] } = await db.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [idTicket]);
  if (!t) throw noEncontrado('El ticket no existe.');
  return t;
}

async function exigirQueAtiende(t, usuario) {
  if (esGeneral(usuario)) return;
  if (!esRegional(usuario)) throw prohibido('Tu rol no gestiona tickets: solo responde los que tiene asignados.');
  const nodos = (await nodosEnAlcance(usuario)) || [];
  const dentro = t.alcance ? enAlcance(usuario, t.alcance) : nodos.includes(normNodo(t.nodo));
  if (!dentro) throw prohibido('Ese ticket está fuera de tu alcance.');
  if (t.nivel !== 'regional') throw prohibido('Ese ticket ya lo atiende el Coordinador general.');
}

// Devuelve las cuentas y los tipos de cuenta a los que quien atiende el ticket lo puede asignar.
export async function asignables(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const iid = entero(id);
  if (!iid || iid < 1 || iid > MAX_ID) throw noEncontrado('El ticket no existe.');
  const { rows: [t] } = await query('SELECT * FROM tickets WHERE id = $1', [iid]);
  if (!t) throw noEncontrado('El ticket no existe.');
  await exigirQueAtiende(t, usuario);
  return { ok: true, cuentas: await cuentasAsignables(t, usuario), roles: t.region ? ROLES_ASIGNABLES.map((r) => ({ rol: r, nombre_rol: NOMBRE_ROL[r] })) : [], region: t.region };
}

// Aplica una acción sobre el ticket: tomar, asignar, escalar, resolver y otras, con su nota y adjuntos.
export async function gestionarTicket(usuario, datos = {}, archivos = {}, interno = {}) {
  exigirAcceso(usuario);
  const { id, accion } = datos;
  const idTicket = entero(id);
  if (!idTicket || idTicket < 1 || idTicket > MAX_ID) throw solicitudInvalida('Falta el ticket.');
  if (!ACCIONES.includes(accion)) throw solicitudInvalida('La acción no es válida.');
  if (['tomar', 'asignar', 'escalar'].includes(accion) && !esGeneral(usuario) && !esRegional(usuario)) {
    throw prohibido('Tu rol no gestiona tickets: solo responde los que tiene asignados.');
  }
  const texto = txt(datos.nota)?.slice(0, 2000) || null;
  if (['escalar', 'resolver', 'reabrir'].includes(accion) && !texto) throw solicitudInvalida('Escribe una nota para este cambio.');
  const anexos = accion === 'resolver' ? await leerArchivos(archivos, 'de respuesta') : [];
  if (accion !== 'resolver' && Array.isArray(archivos?.adjuntos) && archivos.adjuntos.length) throw solicitudInvalida('Solo se adjuntan archivos al responder el ticket.');
  const region = ROLES_ASIGNABLES.includes(usuario.rol) ? await regionDe(usuario) : null;
  let destino = null;
  if (accion === 'asignar') {
    const a = txt(datos.asignado);
    if (!a) throw solicitudInvalida('Elige a quién asignar el ticket.');
    const { rows: [t0] } = await query('SELECT * FROM tickets WHERE id = $1', [idTicket]);
    if (!t0) throw noEncontrado('El ticket no existe.');
    await exigirQueAtiende(t0, usuario);
    if (a.startsWith('rol:')) {
      const rol = a.slice(4);
      if (!ROLES_ASIGNABLES.includes(rol)) throw solicitudInvalida('Ese rol no recibe tickets.');
      if (!t0.region) throw solicitudInvalida('El ticket no tiene región: asígnalo a una persona.');
      destino = { sub: null, nombre: null, rol };
    } else {
      const sub = a.replace(/^cuenta:/, '');
      const c = (await cuentasAsignables(t0, usuario)).find((x) => x.sub === sub);
      if (!c) throw solicitudInvalida('Esa persona no está activa en el territorio del ticket.');
      destino = { sub: c.sub, nombre: c.nombre, rol: c.rol };
    }
  }

  let antes = null;
  const item = await transaccion(async (db) => {
    const t = await ticketParaAtender(db, idTicket, usuario);
    if (!esGeneral(usuario) && !visible(t, usuario, await enCola(t, usuario, region))) throw prohibido('Ese ticket está fuera de tu alcance.');
    if (t.estado === 'resuelto') throw solicitudInvalida('Ese ticket ya está solucionado.');
    let estado = t.estado;
    let nivel = t.nivel;
    const cambios = { asignado_sub: t.asignado_sub, asignado_nombre: t.asignado_nombre, asignado_rol: t.asignado_rol };
    let respondido = null;
    let extra = {};

    if (['confirmar', 'reabrir'].includes(accion)) {
      if (t.creado_por !== usuario.sub) throw prohibido('Solo quien radicó el ticket confirma la solución o lo reabre.');
      if (t.estado !== 'respondido') throw solicitudInvalida('El ticket todavía no tiene respuesta.');
      if (accion === 'confirmar') estado = 'resuelto';
      else estado = t.asignado_sub || t.asignado_rol ? 'asignado' : 'en_gestion';
    } else if (accion === 'resolver') {
      if (t.estado === 'respondido') throw solicitudInvalida('Ese ticket ya tiene respuesta: espera la confirmación del solicitante.');
      const asignadoA = esAsignado(t, usuario) || (await enCola(t, usuario, region));
      if (!asignadoA) await exigirQueAtiende(t, usuario);
      estado = 'respondido';
      respondido = { por: usuario.sub, hasta: sumarDiasHabiles(hoyColombia(), DIAS_CONFIRMAR) };
      if (anexos.length) extra = { anexos: anexos.length };
      if (!t.asignado_sub && t.asignado_rol && t.asignado_rol === usuario.rol) Object.assign(cambios, { asignado_sub: usuario.sub, asignado_nombre: usuario.nombre });
    } else {
      await exigirQueAtiende(t, usuario);
      if (t.estado === 'respondido') throw solicitudInvalida('Ese ticket ya tiene respuesta: espera la confirmación del solicitante.');
      if (accion === 'tomar') {
        if (t.estado === 'en_gestion') throw solicitudInvalida('Ese ticket ya está en gestión.');
        estado = 'en_gestion';
        Object.assign(cambios, { asignado_sub: null, asignado_nombre: null, asignado_rol: null });
      }
      if (accion === 'escalar') {
        if (!esRegional(usuario)) throw prohibido('Solo el Coordinador local regional escala tickets.');
        estado = 'escalado'; nivel = 'general';
        Object.assign(cambios, { asignado_sub: null, asignado_nombre: null, asignado_rol: null });
      }
      if (accion === 'asignar') {
        if (destino.sub && !(await cuentasAsignables(t, usuario)).some((x) => x.sub === destino.sub)) throw solicitudInvalida('Esa persona no está activa en el territorio del ticket.');
        if (!destino.sub && !t.region) throw solicitudInvalida('El ticket no tiene región: asígnalo a una persona.');
        if (t.estado === 'asignado' && (t.asignado_sub || null) === destino.sub && t.asignado_rol === destino.rol) {
          throw solicitudInvalida(`El ticket ya está asignado a ${destino.nombre || `cualquier ${NOMBRE_ROL[destino.rol].toLowerCase()} de la región`}.`);
        }
        estado = 'asignado';
        Object.assign(cambios, { asignado_sub: destino.sub, asignado_nombre: destino.nombre, asignado_rol: destino.rol });
        extra = { asignado: destino.nombre || `Cola: ${NOMBRE_ROL[destino.rol]}` };
      }
    }

    if (interno.extra) extra = { ...extra, ...interno.extra };
    const historial = [...(Array.isArray(t.historial) ? t.historial : []), entrada(usuario, accion, estado, nivel, texto, extra)];
    const { rows: [r] } = await db.query(
      `UPDATE tickets
          SET estado = $2::varchar, nivel = $3, historial = $4::jsonb, actualizado_en = now(),
              asignado_sub = $5, asignado_nombre = $6, asignado_rol = $7,
              respondido_por = CASE WHEN $2::varchar = 'respondido' THEN $8 ELSE respondido_por END,
              respondido_en = CASE WHEN $2::varchar = 'respondido' THEN now() ELSE respondido_en END,
              confirmar_hasta = CASE WHEN $2::varchar = 'respondido' THEN $9::date ELSE NULL END,
              resuelto_en = CASE WHEN $2::varchar = 'resuelto' THEN now() ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [t.id, estado, nivel, JSON.stringify(historial), cambios.asignado_sub, cambios.asignado_nombre, cambios.asignado_rol,
        respondido?.por ?? null, respondido?.hasta ?? null]);
    await guardarArchivos(db, t.id, 'respuesta', anexos, usuario.nombre || usuario.sub);
    await avisar(db, r, { texto: TEXTO_MOV[accion], por: usuario.nombre, rol: rolLegible(usuario), nota: texto });
    antes = t;
    return r;
  });
  const campos = {};
  for (const k of ['estado', 'nivel', 'asignado_sub', 'asignado_nombre', 'asignado_rol']) if (antes[k] !== item[k]) campos[k] = [antes[k], item[k]];
  await registrar(usuario, {
    accion: `tickets.${accion}`, objeto: { tipo: 'ticket', id: item.id }, idUnico: item.id_unico,
    cambios: { campos, nota: corto(texto), ...(anexos.length ? { anexos: anexos.length } : {}) },
  });
  return { ok: true, item: await docDe(item.id, usuario) };
}

// Devuelve el ticket que se resuelve con un retiro o reemplazo, que debe existir, ser visible y ser de la etapa
// indicada.
export async function ticketParaVincular(usuario, id, { etapa, idUnico } = {}) {
  exigirAcceso(usuario);
  const tid = entero(id);
  if (!tid || tid < 1 || tid > MAX_ID) throw solicitudInvalida(`Elige el ticket de la etapa «${ETAPAS[etapa]}» que se resuelve con este registro.`);
  const t = await docDe(tid, usuario);
  if (!t) throw solicitudInvalida('El ticket no existe o está fuera de tu alcance.');
  if (t.etapa !== etapa) {
    throw solicitudInvalida(`El ticket ${t.consecutivo} es de la etapa «${t.nombre_etapa || 'sin etapa'}»: elige uno de la etapa «${ETAPAS[etapa]}».`);
  }
  if (['respondido', 'resuelto'].includes(t.estado)) throw new HttpError(409, `El ticket ${t.consecutivo} ya tiene respuesta: elige uno que siga abierto.`);
  if (!t.puede.resolver) throw solicitudInvalida(`No puedes responder el ticket ${t.consecutivo}: lo atiende otro nivel o está asignado a otra persona.`);
  if (t.id_unico && idUnico && String(t.id_unico) !== String(idUnico)) {
    throw solicitudInvalida(`El ticket ${t.consecutivo} es de la unidad ${t.id_unico}, no de la ${idUnico}.`);
  }
  return t;
}

// Responde el ticket vinculado a un retiro o reemplazo con la misma acción de resolver de la bandeja.
export function responderTicketVinculado(usuario, id, nota, extra = {}) {
  return gestionarTicket(usuario, { id, accion: 'resolver', nota }, {}, { extra });
}

// Deja como solucionados los tickets respondidos que el solicitante no confirmó en 5 días hábiles.
export async function cerrarSinConfirmar(hoy = hoyColombia()) {
  const entradaAuto = { accion: 'solucionado_auto', estado: 'resuelto', nota: `Sin confirmación del solicitante en ${DIAS_CONFIRMAR} días hábiles.`, por: SISTEMA.nombre, rol: 'Sistema', cuando: new Date().toISOString() };
  const rows = await transaccion(async (db) => {
    const { rows: vencidos } = await db.query(
      `SELECT id FROM tickets WHERE estado = 'respondido' AND confirmar_hasta IS NOT NULL AND confirmar_hasta < $1::date ORDER BY id FOR UPDATE`, [hoy]);
    if (!vencidos.length) return [];
    const { rows: cerrados } = await db.query(
      `UPDATE tickets SET estado = 'resuelto', resuelto_en = now(), actualizado_en = now(), confirmar_hasta = NULL,
              historial = historial || $2::jsonb
        WHERE id = ANY($1::int[]) RETURNING *`,
      [vencidos.map((v) => v.id), JSON.stringify([entradaAuto])]);
    for (const t of cerrados) await avisar(db, t, { texto: TEXTO_MOV.solucionado_auto, por: SISTEMA.nombre, rol: 'Sistema' });
    return cerrados;
  });
  for (const t of rows) {
    await registrar(SISTEMA, { accion: 'tickets.solucionado_auto', objeto: { tipo: 'ticket', id: t.id }, idUnico: t.id_unico, cambios: { campos: { estado: ['respondido', 'resuelto'] } } });
  }
  return rows.length;
}

// Devuelve un archivo de un ticket que el usuario ve.
export async function adjuntoTicket(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const aid = entero(id);
  if (!aid || aid < 1 || aid > MAX_ID) throw noEncontrado('El archivo no existe.');
  const { rows: [a] } = await query('SELECT ticket_id, nombre, tipo, contenido FROM tickets_adjuntos WHERE id = $1', [aid]);
  if (!a) throw noEncontrado('El archivo no existe.');
  if (!(await docDe(a.ticket_id, usuario))) throw noEncontrado('El archivo no existe.');
  return { buffer: a.contenido, nombre: a.nombre, tipo: a.tipo };
}
