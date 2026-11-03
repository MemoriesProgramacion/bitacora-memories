// Retiro y reemplazo de unidades productivas. El retiro lleva una de las 9 causales y el acta de retiro en PDF,
// y la unidad queda retirada y sale de las listas operativas. El reemplazo agrega el concepto del comité y la
// persona que entra, una por una, con los datos de un ingreso del acta de novedades.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { entero, txt } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, exigirAlcance } from '../alcance.js';
import { contenidoValido } from './tipoArchivo.js';
import { registrar } from './actividad.js';
import { buscarUP } from './unidades.js';
import { fechaReal, hoyColombia } from './secciones.js';
import { exigirTamano } from './alistamiento.js';
import { limpiarAsociado } from './asociados.js';
import { consecutivo, responderTicketVinculado, ticketParaVincular } from './tickets.js';

// Las 9 causales de retiro.
export const CAUSALES = {
  retiro_voluntario: 'Retiro voluntario',
  fallecimiento: 'Fallecimiento del representante',
  documento_no_vigente: 'Documento de identidad no vigente',
  incumplimiento: 'Incumplimiento de los compromisos del programa',
  uso_diferente: 'Uso diferente de la capitalización',
  no_firma_compromiso: 'No firma del acta de compromiso',
  informacion_falsa: 'Información falsa o no veraz',
  asistencia_menor_80: 'Asistencia a la formación menor al 80 %',
  no_viabilizacion: 'No viabilización del plan de capitalización',
};
const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO];
const MAX_ID = 2147483647;
const quienEs = (u) => u.nombre || u.sub || 'sistema';
const nombreOriginal = (a) => Buffer.from(a?.originalname || '', 'latin1').toString('utf8').replace(/[\r\n\\/]/g, '_').slice(0, 300);
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

function exigirLector(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta los retiros de unidades.');
}
function exigirCoordinacion(usuario) {
  if (usuario?.rol !== ROLES.COORDINADOR) throw prohibido('El retiro y el reemplazo de unidades los registra la coordinación.');
}
async function pdf(archivos, campo, que) {
  const a = (Array.isArray(archivos?.[campo]) ? archivos[campo][0] : archivos?.[campo]) || null;
  if (!a) throw solicitudInvalida(`Adjunta ${que} en PDF.`);
  exigirTamano(a, true, `${que.charAt(0).toUpperCase()}${que.slice(1)}`);
  const nombre = nombreOriginal(a);
  if (path.extname(nombre).toLowerCase() !== '.pdf' || !(await contenidoValido(a.path, nombre, ['.pdf']))) {
    throw solicitudInvalida(`${que.charAt(0).toUpperCase()}${que.slice(1)} debe ser un PDF válido.`);
  }
  return { nombre, contenido: await fs.readFile(a.path) };
}

// Devuelve el personal activo de la unidad y valida la selección de quién sale: una o varias personas en el
// retiro y exactamente una en el reemplazo.
async function personalQueSale(up, campos, tipo) {
  const { rows: activos } = await query(
    'SELECT id, nombre, documento, es_representante FROM up_asociados WHERE id_up = $1 AND activo ORDER BY es_representante DESC, nombre', [up.id_up]);
  let ids = campos.personal_sale;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = null; } }
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
  if (ids.some((i) => !Number.isInteger(i) || i < 1 || i > MAX_ID)) throw solicitudInvalida('La selección del personal que sale no es válida.');
  if (!activos.length) {
    if (ids.length) throw solicitudInvalida(`La unidad ${up.id_unico} no tiene personal activo registrado.`);
    return [];
  }
  if (!ids.length) throw solicitudInvalida(tipo === 'reemplazo' ? 'Elige a la persona de la unidad que sale en el reemplazo (1 a 1).' : 'Elige el personal de la unidad que sale.');
  if (tipo === 'reemplazo' && ids.length !== 1) throw solicitudInvalida('El reemplazo es 1 a 1: elige una sola persona de la unidad que sale.');
  const elegidos = ids.map((i) => activos.find((a) => a.id === i));
  if (elegidos.some((a) => !a)) throw solicitudInvalida(`Hay personal elegido que no es del personal activo de la unidad ${up.id_unico}.`);
  return elegidos.map(({ id, nombre, documento, es_representante: representante }) => ({ id, nombre, documento, representante }));
}
const nombresDe = (personal) => personal.map((p) => `${p.nombre} (${p.documento})`).join(', ');

// Resuelve lo común del retiro y del reemplazo: la unidad del alcance, la causal y el acta.
async function base(usuario, campos, archivos) {
  exigirCoordinacion(usuario);
  const up = await buscarUP({ idUnico: txt(campos.id_unico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  const causal = txt(campos.causal);
  if (!CAUSALES[causal]) throw solicitudInvalida('Elige una de las 9 causales de retiro del numeral 5.6.4.');
  const observaciones = txt(campos.observaciones)?.slice(0, 2000) || null;
  const acta = await pdf(archivos, 'acta', 'el acta de retiro o desistimiento');
  return { up, causal, observaciones, acta };
}

// Obtiene el ticket de la etapa que corresponde que este registro resuelve, uno solo por registro.
async function ticketDelRegistro(usuario, campos, tipo, up) {
  const ticket = await ticketParaVincular(usuario, campos.id_ticket, { etapa: tipo, idUnico: up.id_unico });
  const { rows: [usado] } = await query('SELECT 1 FROM up_retiros WHERE id_ticket = $1', [ticket.id]);
  if (usado) throw new HttpError(409, `El ticket ${ticket.consecutivo} ya está vinculado a otro registro.`);
  return ticket;
}

// Responde el ticket con una nota del registro; si no se puede, el registro ya quedó hecho.
async function responderTicket(usuario, ticket, nota, extra = {}) {
  try {
    await responderTicketVinculado(usuario, ticket.id, nota, extra);
    return { id: ticket.id, consecutivo: ticket.consecutivo, resuelto: true };
  } catch (err) {
    console.error('[retiros] No se pudo responder el ticket', ticket.consecutivo, err.message);
    return { id: ticket.id, consecutivo: ticket.consecutivo, resuelto: false, motivo: err.message };
  }
}

// Deja la unidad retirada, bloqueada dentro de la transacción.
async function retirar(db, up, causal) {
  const { rows: [fila] } = await db.query('SELECT habilitada, retirada_dps FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
  if (fila.retirada_dps) throw new HttpError(409, `La unidad ${up.id_unico} ya está retirada.`);
  await db.query(
    `UPDATE unidades_productivas SET habilitada = FALSE, retirada_dps = TRUE, novedad_tipo = $2, fecha_actualizacion = now() WHERE id_up = $1`,
    [up.id_up, CAUSALES[causal].slice(0, 200)]);
  return fila;
}

// Deja a las personas elegidas fuera del personal activo de la unidad, como en el acta de novedades: salen de
// la lista y quedan como retiradas con la causal.
async function retirarPersonal(db, up, personal, causal) {
  if (!personal.length) return;
  const { rowCount } = await db.query(
    `UPDATE up_asociados SET activo = FALSE, es_representante = FALSE, fecha_retiro = now(), motivo_retiro = $3, actualizado_en = now()
     WHERE id_up = $1 AND activo AND id = ANY($2::int[])`,
    [up.id_up, personal.map((p) => p.id), `Retiro de la unidad: ${CAUSALES[causal]}`.slice(0, 500)]);
  if (rowCount !== personal.length) throw new HttpError(409, `El personal que sale de la unidad ${up.id_unico} cambió mientras registrabas: vuelve a elegirlo.`);
}

// Registra el retiro de la unidad con causal y acta y resuelve un ticket de la etapa de retiro.
export async function registrarRetiro(usuario, campos = {}, archivos = {}) {
  const { up, causal, observaciones, acta } = await base(usuario, campos, archivos);
  const personal = await personalQueSale(up, campos, 'retiro');
  const ticket = await ticketDelRegistro(usuario, campos, 'retiro', up);
  let antes = null;
  const id = await transaccion(async (db) => {
    antes = await retirar(db, up, causal);
    await retirarPersonal(db, up, personal, causal);
    const { rows: [r] } = await db.query(
      `INSERT INTO up_retiros (id_up, id_unico, tipo, causal, observaciones, acta, acta_nombre, personal_sale, id_ticket, registrado_por)
       VALUES ($1, $2, 'retiro', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [up.id_up, up.id_unico, causal, observaciones, acta.contenido, acta.nombre, JSON.stringify(personal), ticket.id, quienEs(usuario)]);
    return r.id;
  });
  await registrar(usuario, { accion: 'up.retiro', objeto: { tipo: 'unidad', id: up.id_unico }, idUnico: up.id_unico,
    cambios: { causal: CAUSALES[causal], acta: acta.nombre, ticket: ticket.consecutivo, sale: personal.map((p) => p.nombre),
      campos: { habilitada: [antes.habilitada, false], retirada_dps: [Boolean(antes.retirada_dps), true] } } });
  const respuesta = await responderTicket(usuario, ticket,
    `Retiro registrado: unidad ${up.id_unico}${up.unidad_nombre ? ` (${up.unidad_nombre})` : ''}, causal «${CAUSALES[causal]}».${personal.length ? ` Sale: ${nombresDe(personal)}.` : ''} Registró ${quienEs(usuario)}.`,
    { personal_sale: personal.map((p) => ({ nombre: p.nombre, documento: p.documento })) });
  return { ok: true, item: { id, id_unico: up.id_unico, causal, nombre_causal: CAUSALES[causal], ticket: respuesta } };
}

// Valida la persona que entra, una sola, con las reglas del ingreso del acta de novedades.
function personaQueEntra(v) {
  let d = v;
  if (typeof v === 'string') { try { d = JSON.parse(v); } catch { d = null; } }
  if (Array.isArray(d)) {
    if (d.length !== 1) throw solicitudInvalida('El reemplazo es 1 a 1: entra una sola persona por la que sale.');
    [d] = d;
  }
  if (!d || typeof d !== 'object') throw solicitudInvalida('Registra la persona que entra en reemplazo (nombre completo, cédula, teléfono y sexo).');
  return limpiarAsociado(d, 'La persona que entra');
}

// Registra el reemplazo uno a uno: la unidad sale con causal y acta, el comité da su concepto y entra una
// persona.
export async function registrarReemplazo(usuario, campos = {}, archivos = {}) {
  const { up, causal, observaciones, acta } = await base(usuario, campos, archivos);
  const fecha = String(campos.comite_fecha || '').slice(0, 10);
  if (!fechaReal(fecha) || fecha > hoyColombia() || fecha < '2000-01-01') throw solicitudInvalida('La fecha del concepto del Comité Técnico no es válida (no puede ser futura).');
  const concepto = txt(campos.comite_concepto)?.slice(0, 5000);
  if (!concepto) throw solicitudInvalida('Escribe el concepto del Comité Técnico.');
  const actaComite = await pdf(archivos, 'acta_comite', 'el acta del Comité Técnico');
  const entra = personaQueEntra(campos.persona_entra);
  const { rows: [rep] } = await query(
    'SELECT r.documento FROM unidades_productivas u JOIN representantes r ON r.id_representante = u.id_representante WHERE u.id_up = $1', [up.id_up]);
  const personal = await personalQueSale(up, campos, 'reemplazo');
  if ((rep && soloDigitos(rep.documento) === entra.documento) || personal.some((p) => p.documento === entra.documento)) {
    throw solicitudInvalida('La persona que entra no puede ser la misma que sale (misma cédula).');
  }
  const ticket = await ticketDelRegistro(usuario, campos, 'reemplazo', up);

  let antes = null;
  const id = await transaccion(async (db) => {
    const { rows: v2 } = await db.query("SELECT 1 FROM visitas WHERE id_up = $1 AND lower(tipo_visita) = 'v2' AND cerrada LIMIT 1", [up.id_up]);
    if (v2.length) throw new HttpError(409, `La unidad ${up.id_unico} ya cerró la Visita 2 (diagnóstico): después del diagnóstico solo procede el retiro.`);
    antes = await retirar(db, up, causal);
    await retirarPersonal(db, up, personal, causal);
    const comite = { fecha, concepto, registrado_por: quienEs(usuario) };
    const { rows: [r] } = await db.query(
      `INSERT INTO up_retiros (id_up, id_unico, tipo, causal, observaciones, acta, acta_nombre, comite, comite_acta, comite_acta_nombre, persona_entra, personal_sale, id_ticket, registrado_por)
       VALUES ($1, $2, 'reemplazo', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [up.id_up, up.id_unico, causal, observaciones, acta.contenido, acta.nombre, JSON.stringify(comite), actaComite.contenido, actaComite.nombre,
        JSON.stringify(entra), JSON.stringify(personal), ticket.id, quienEs(usuario)]);
    return r.id;
  });
  await registrar(usuario, { accion: 'up.reemplazo', objeto: { tipo: 'unidad', id: up.id_unico }, idUnico: up.id_unico,
    cambios: { causal: CAUSALES[causal], entra: entra.nombre, sale: personal.map((p) => p.nombre), comite: fecha, ticket: ticket.consecutivo,
      campos: { habilitada: [antes.habilitada, false], retirada_dps: [Boolean(antes.retirada_dps), true] } } });
  const respuesta = await responderTicket(usuario, ticket,
    `Reemplazo registrado: sale la unidad ${up.id_unico}${up.unidad_nombre ? ` (${up.unidad_nombre})` : ''}, causal «${CAUSALES[causal]}».${personal.length ? ` Sale: ${nombresDe(personal)}.` : ''} Entra: ${entra.nombre}. Registró ${quienEs(usuario)}.`,
    { personal_sale: personal.map((p) => ({ nombre: p.nombre, documento: p.documento })), entra: entra.nombre });
  return { ok: true, item: { id, id_unico: up.id_unico, entra: entra.nombre, causal, nombre_causal: CAUSALES[causal], ticket: respuesta } };
}

// Devuelve lo que se muestra de la persona que entra: nombre y cédula.
const resumenEntra = (p) => (p ? { nombre: p.nombre, documento: p.documento } : null);

// Lista los retiros y reemplazos de las unidades del alcance.
export async function listarRetiros(usuario) {
  exigirLector(usuario);
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT r.id, r.id_unico, r.tipo, r.causal, r.observaciones, r.acta_nombre, r.comite, r.comite_acta_nombre, r.id_unico_entra, r.persona_entra, r.personal_sale,
            r.id_ticket, r.registrado_por, r.creado_en, up.nombre AS unidad, t.nodo, t.region, up.departamento, e.nombre AS unidad_entra
       FROM up_retiros r JOIN unidades_productivas up ON up.id_up = r.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
       LEFT JOIN unidades_productivas e ON e.id_up = r.id_up_entra
      WHERE ${alcance} ORDER BY r.creado_en DESC, r.id DESC LIMIT 500`, params);
  return {
    ok: true,
    items: rows.map(({ id_ticket: ticket, persona_entra: persona, personal_sale: sale, ...r }) => ({
      ...r, nombre_causal: CAUSALES[r.causal] || r.causal, persona_entra: resumenEntra(persona), ticket: ticket ? consecutivo(ticket) : null,
      personal_sale: (sale || []).map(({ nombre, documento }) => ({ nombre, documento })),
    })),
    causales: CAUSALES,
  };
}

// Devuelve el acta de retiro o del comité de un registro del alcance, con su contenido y nombre.
export async function actaRetiro(usuario, { id, cual } = {}) {
  exigirLector(usuario);
  const rid = entero(id);
  if (!rid || rid < 1 || rid > MAX_ID) throw noEncontrado('El acta no existe.');
  const params = [];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(rid);
  const comite = txt(cual) === 'comite';
  const { rows: [r] } = await query(
    `SELECT ${comite ? 'r.comite_acta AS acta, r.comite_acta_nombre AS nombre' : 'r.acta, r.acta_nombre AS nombre'}
       FROM up_retiros r JOIN unidades_productivas up ON up.id_up = r.id_up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE (${alcance}) AND r.id = $${params.length}`, params);
  if (!r?.acta) throw noEncontrado('El acta no existe.');
  return { buffer: r.acta, nombre: r.nombre };
}

// Devuelve todas las unidades con su estado, activa o desactivada, y en las desactivadas el motivo.
export async function estadoUnidades(usuario) {
  if (!usuario?.superadmin) throw prohibido('El estado de las unidades (activas y desactivadas) lo consulta el Coordinador general.');
  const { rows } = await query(
    `SELECT up.id_unico, up.nombre, up.modalidad, up.departamento, up.municipio, up.habilitada, up.retirada_dps, up.novedad_tipo,
            t.nodo, t.region, r.nombre_completo AS representante,
            x.tipo AS retiro_tipo, x.causal, x.creado_en AS retiro_en, x.registrado_por AS retiro_por, x.id_ticket
       FROM unidades_productivas up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
       LEFT JOIN LATERAL (SELECT tipo, causal, creado_en, registrado_por, id_ticket FROM up_retiros WHERE id_up = up.id_up ORDER BY id DESC LIMIT 1) x ON TRUE
      ORDER BY up.id_unico LIMIT 5000`);
  const items = rows.map((f) => {
    const activa = f.habilitada !== false && f.retirada_dps !== true;
    const desactivacion = activa ? null : {
      motivo: f.retirada_dps ? 'retirada' : 'sin_habilitar',
      tipo: f.retiro_tipo || null,
      causal: f.causal ? (CAUSALES[f.causal] || f.causal) : (f.retirada_dps ? f.novedad_tipo || null : null),
      fecha: f.retiro_en || null,
      ticket: f.id_ticket ? consecutivo(f.id_ticket) : null,
      registrado_por: f.retiro_por || null,
    };
    return {
      id_unico: f.id_unico, nombre: f.nombre, modalidad: f.modalidad, departamento: f.departamento, municipio: f.municipio,
      nodo: f.nodo, region: f.region, representante: f.representante, estado: activa ? 'activa' : 'desactivada', desactivacion,
    };
  });
  const activas = items.filter((x) => x.estado === 'activa').length;
  return { ok: true, items, resumen: { total: items.length, activas, desactivadas: items.length - activas } };
}

// Devuelve el retiro o reemplazo de una unidad para su ficha, o null.
export async function retiroDeUP(db, idUp) {
  const { rows: [r] } = await db.query(
    `SELECT r.id, r.tipo, r.causal, r.observaciones, r.id_unico_entra, r.persona_entra, r.personal_sale, r.id_ticket, r.registrado_por, r.creado_en, r.comite
       FROM up_retiros r WHERE r.id_up = $1 ORDER BY r.id DESC LIMIT 1`, [idUp]);
  if (!r) return null;
  const { persona_entra: persona, personal_sale: sale, id_ticket: ticket, ...resto } = r;
  return {
    ...resto, nombre_causal: CAUSALES[r.causal] || r.causal, persona_entra: persona ? { nombre: persona.nombre } : null,
    personal_sale: (sale || []).map((p) => ({ nombre: p.nombre })),
    ticket: ticket ? consecutivo(ticket) : null,
    comite: r.comite ? { fecha: r.comite.fecha, concepto: r.comite.concepto } : null,
  };
}
