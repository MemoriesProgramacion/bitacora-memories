// Entregas: cronograma, confirmación y reagendamientos. Hay una entrega por unidad como documento plano: las
// columnas excel_ las trae el cargue de compras, las gestor_ lo que confirma quien atiende la unidad, las
// solicitud_ un reagendamiento abierto con su acta en PDF y historial el registro de lo ocurrido.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { query, transaccion } from '../db.js';
import { config, ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { esGestor, normNodo } from '../util.js';
import { condicionAlcance, condicionAlcanceFila, exigirAlcanceDeUP, COLUMNAS_UP } from '../alcance.js';
import { guardarArchivo } from './archivos.js';
import { conRegistro, diferencias, registrar } from './actividad.js';

export const MAX_ACTA_MB = 10;
const CONTENEDOR_ACTAS = 'actas-reagendamiento';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const ahoraIso = () => new Date().toISOString();
const quienEs = (u) => u.nombre || u.sub || 'sistema';
const lista = (x) => (Array.isArray(x) ? x : []);
const soloFecha = (v) => (v ? String(v).slice(0, 10) : '');
const vacio = (v) => v === undefined || v === null || v === '';

// Indica si el usuario puede ver las entregas; quien solo consulta no escribe, porque lo rechaza el middleware
// de autenticación.
const puedeVer = (u) => esGestor(u) || [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS].includes(u?.rol);
const esCoordinacion = (u) => [ROLES.COORDINADOR, ROLES.COMPRAS].includes(u?.rol);
const exigirLectura = (u) => { if (!puedeVer(u)) throw prohibido('Tu rol no ve las entregas.'); };
const exigirCargue = (u) => { if (!u?.general && u?.rol !== ROLES.COMPRAS) throw prohibido('Solo el Profesional alianzas y conexión de mercados puede cargar el MASTER ENTREGAS.'); };

// Aplica las reglas de fecha de una entrega, las mismas del frontend.
export function fechaProgramada(doc = {}) {
  for (const k of ['excel_fecha_entrega_efectiva', 'excel_fecha_entrega_vigente', 'excel_fecha_reprogramada', 'excel_fecha_programada']) {
    const v = soloFecha(doc[k]);
    if (ISO.test(v)) return v;
  }
  return '';
}

const norma = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Calcula el estado de una entrega a partir de lo que trae el Excel, su solicitud de reagendamiento y su
// historial.
export function estadoEntrega(doc, fecha = fechaProgramada(doc)) {
  const prog = norma(doc.excel_estado_programacion);
  const ent = norma(doc.excel_estado_entrega);
  if (prog.includes('PARCIAL') || ent.includes('PARCIAL')) return 'parcial';
  if (prog.startsWith('NO ENTREGA') || ent.startsWith('NO ENTREGA')) return 'no_entregada';
  if (prog === 'ENTREGADA' || ent === 'ENTREGADA' || ent.includes('COMPLETA') || ISO.test(soloFecha(doc.excel_fecha_entrega_efectiva))) return 'entregada';
  if (doc.solicitud_en) return doc.solicitud_acta_estado === 'en_revision' ? 'acta_revision' : 'solicitud';
  if (!fecha) return 'sin_fecha';
  if (doc.gestor_confirmada_fecha === fecha) return 'confirmada';
  return lista(doc.historial).some((h) => h.accion === 'reagendada' && h.fecha_nueva === fecha) ? 'reagendada' : 'programada';
}

// Indica si la cuenta de campo puede modificar la entrega: tiene fecha, no tiene reagendamiento en curso y no
// está entregada.
const editablePorGestor = (doc) => ['programada', 'confirmada', 'reagendada'].includes(estadoEntrega(doc));

// Valida una hora HH:MM de 24 horas, como la que envía el campo de hora.
const horaValida = (h) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(h ?? ''));

const aDocumento = (r) => ({
  ...r.doc,
  id: String(r.id_unico), id_unico: Number(r.id_unico) || r.id_unico, nodo: r.nodo, unidad_nombre: r.unidad_nombre || r.doc.unidad_nombre || '',
});

export async function listarEntregas(usuario, { nodo_id: nodoId } = {}) {
  exigirLectura(usuario);
  const nodo = esGestor(usuario) ? normNodo(usuario.nodo) : (normNodo(nodoId) || null);
  const params = [nodo];
  const alcance = condicionAlcanceFila(usuario, { idUp: 'entregas_ups.id_up', nodo: 'entregas_ups.nodo' }, params);
  const { rows } = await query(
    `SELECT * FROM entregas_ups WHERE ($1::text IS NULL OR upper(nodo) = $1) AND ${alcance} ORDER BY id_unico::int`, params);
  return { ok: true, items: rows.map(aDocumento) };
}

async function filaDe(usuario, id, db = { query }, bloquear = false) {
  const { rows } = await db.query(
    `SELECT * FROM entregas_ups WHERE id_unico = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [String(id || '')]);
  const r = rows[0];
  if (!r || (esGestor(usuario) && normNodo(r.nodo) !== normNodo(usuario.nodo))) throw noEncontrado('Entrega no encontrada.');
  await exigirAlcanceDeUP(usuario, r.id_up, r.nodo);
  return r;
}

async function guardarDoc(db, r, doc) {
  await db.query('UPDATE entregas_ups SET doc = $2, actualizado_en = now() WHERE id_unico = $1', [r.id_unico, JSON.stringify(doc)]);
  return aDocumento((await db.query('SELECT * FROM entregas_ups WHERE id_unico = $1', [r.id_unico])).rows[0]);
}

const limpiarSolicitud = (doc) => {
  for (const k of Object.keys(doc)) if (k.startsWith('solicitud_')) delete doc[k];
};

const CAMPOS_REGISTRO = [
  'gestor_telefono', 'gestor_direccion', 'gestor_confirmada_fecha', 'gestor_confirmada_hora',
  'solicitud_motivo', 'solicitud_fecha_anterior', 'solicitud_fecha_sugerida', 'solicitud_acta', 'solicitud_acta_estado',
];

// Ejecuta una acción sobre la entrega: registrar contacto, confirmar o solicitar reagendamiento.
export async function accionEntrega(usuario, cuerpo = {}) {
  exigirLectura(usuario);
  if (!esGestor(usuario)) throw prohibido('Las entregas las confirma el gestor de cada nodo.');
  const accion = String(cuerpo.accion || '');
  const ctx = {};
  return conRegistro(
    usuario, { accion: `entrega.${accion || 'desconocida'}`, objeto: { tipo: 'entrega', id: cuerpo.id }, idUnico: cuerpo.id },
    async () => ({ ok: true, item: await accionEntregaInterna(usuario, cuerpo, accion, ctx) }),
    (r) => ({ campos: diferencias(ctx.antes, r.item, CAMPOS_REGISTRO) }),
  );
}

async function accionEntregaInterna(usuario, cuerpo, accion, ctx) {
  const item = await transaccion(async (db) => {
    const r = await filaDe(usuario, cuerpo.id, db, true);
    const doc = r.doc;
    ctx.antes = structuredClone(doc);
    if (!editablePorGestor(doc)) throw solicitudInvalida('Esta entrega ya no se puede modificar.');
    const fecha = fechaProgramada(doc);
    const ahora = ahoraIso();
    const quien = quienEs(usuario);
    const telefono = String(cuerpo.telefono ?? '').trim().slice(0, 60);
    const direccion = String(cuerpo.direccion ?? '').trim().slice(0, 300);

    if (accion === 'contacto') {
      doc.gestor_telefono = telefono || null;
      doc.gestor_direccion = direccion || null;
    } else if (accion === 'confirmar') {
      if (!fecha) throw solicitudInvalida('La entrega todavía no tiene fecha.');
      if (!horaValida(cuerpo.hora)) throw solicitudInvalida('Indica la hora de la entrega (HH:MM).');
      if (!telefono || !direccion) throw solicitudInvalida('Confirma el teléfono y la dirección.');
      Object.assign(doc, {
        gestor_telefono: telefono, gestor_direccion: direccion,
        gestor_confirmada_fecha: fecha, gestor_confirmada_hora: cuerpo.hora, gestor_confirmada_por: quien, gestor_confirmada_en: ahora,
      });
      doc.historial = [...lista(doc.historial), { accion: 'confirmar', fecha, hora: cuerpo.hora, por: quien, en: ahora }];
    } else if (accion === 'solicitar_reagendamiento') {
      if (!fecha) throw solicitudInvalida('La entrega todavía no tiene fecha.');
      const motivo = String(cuerpo.motivo ?? '').trim().slice(0, 2000);
      if (!motivo) throw solicitudInvalida('El motivo del reagendamiento es obligatorio.');
      const sugerida = String(cuerpo.fecha_sugerida ?? '');
      if (sugerida && !ISO.test(sugerida)) throw solicitudInvalida('La fecha sugerida no es válida.');
      const pdf = Buffer.from(String(cuerpo.acta_pdf ?? ''), 'base64');
      if (!pdf.length) throw solicitudInvalida('Adjunta el acta de reagendamiento en PDF.');
      if (pdf.length > MAX_ACTA_MB * 1024 * 1024) throw solicitudInvalida(`El acta pesa más de ${MAX_ACTA_MB} MB.`);
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw solicitudInvalida('El acta debe ser un archivo PDF.');

      const nombre = `${r.id_unico}/ACTA_${ahora.replace(/\D/g, '').slice(0, 14)}.pdf`;
      await guardarActa(nombre, pdf, usuario);
      if (telefono) doc.gestor_telefono = telefono;
      if (direccion) doc.gestor_direccion = direccion;
      Object.assign(doc, {
        solicitud_en: ahora, solicitud_por: quien, solicitud_motivo: motivo,
        solicitud_fecha_anterior: fecha, solicitud_fecha_sugerida: sugerida || null,
        solicitud_acta: nombre, solicitud_acta_estado: 'en_revision',
      });
      doc.historial = [...lista(doc.historial), {
        accion: 'solicitar_reagendamiento', fecha_anterior: fecha, fecha_sugerida: sugerida || null, motivo, acta: nombre, por: quien, en: ahora,
      }];
    } else {
      throw solicitudInvalida('Acción desconocida.');
    }
    return guardarDoc(db, r, doc);
  });
  return item;
}

// Guarda el acta con el nombre dado, que ya viene validado.
async function guardarActa(nombre, pdf, usuario) {
  const tmp = path.join(os.tmpdir(), `acta-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.writeFile(tmp, pdf);
  await guardarArchivo({
    contenedor: CONTENEDOR_ACTAS, nombre, archivo: { path: tmp, mimetype: 'application/pdf', size: pdf.length }, usuario,
  });
}

// Registra la decisión de aprobar o rechazar el acta de reagendamiento, con su observación.
export async function revisarActa(usuario, cuerpo = {}) {
  if (!esCoordinacion(usuario)) throw prohibido('Solo coordinación revisa las actas.');
  const decision = String(cuerpo.decision || '');
  if (!['aprobar', 'rechazar'].includes(decision)) throw solicitudInvalida('La decisión debe ser aprobar o rechazar.');
  const obs = String(cuerpo.observacion ?? '').trim().slice(0, 2000);
  if (decision === 'rechazar' && !obs) throw solicitudInvalida('Escribe por qué se rechaza el acta.');

  const ctx = {};
  return conRegistro(
    usuario, { accion: `entrega.acta_${decision}`, objeto: { tipo: 'entrega', id: cuerpo.id }, idUnico: cuerpo.id },
    async () => ({ ok: true, item: await revisarActaInterna(usuario, cuerpo, decision, obs, ctx) }),
    (r) => ({ campos: diferencias(ctx.antes, r.item, CAMPOS_REGISTRO), ...(obs ? { observacion: obs } : {}) }),
  );
}

async function revisarActaInterna(usuario, cuerpo, decision, obs, ctx) {
  const item = await transaccion(async (db) => {
    const r = await filaDe(usuario, cuerpo.id, db, true);
    const doc = r.doc;
    ctx.antes = structuredClone(doc);
    if (!doc.solicitud_en || doc.solicitud_acta_estado !== 'en_revision') throw solicitudInvalida('Esta entrega no tiene un acta por revisar.');
    const ahora = ahoraIso();
    const quien = quienEs(usuario);
    if (decision === 'aprobar') {
      doc.solicitud_acta_estado = 'aprobada';
      doc.solicitud_acta_revisado_por = quien;
      doc.solicitud_acta_revisado_en = ahora;
      doc.historial = [...lista(doc.historial), { accion: 'acta_aprobada', acta: doc.solicitud_acta, por: quien, en: ahora, ...(obs ? { observacion: obs } : {}) }];
    } else {
      doc.historial = [...lista(doc.historial), {
        accion: 'acta_rechazada', acta: doc.solicitud_acta, observacion: obs, motivo: doc.solicitud_motivo, por: quien, en: ahora,
      }];
      limpiarSolicitud(doc);
    }
    return guardarDoc(db, r, doc);
  });
  return item;
}

// Devuelve la ruta, el tipo y el nombre del PDF de la solicitud actual o de uno del historial.
export async function obtenerActa(usuario, { id, acta }) {
  exigirLectura(usuario);
  const r = await filaDe(usuario, id);
  const nombre = String(acta || r.doc.solicitud_acta || '');
  const propias = [r.doc.solicitud_acta, ...lista(r.doc.historial).map((h) => h.acta)].filter(Boolean);
  if (!nombre || !propias.includes(nombre)) throw noEncontrado('No se encontró el acta.');
  const { rows } = await query('SELECT ruta_relativa FROM archivos WHERE contenedor = $1 AND nombre = $2', [CONTENEDOR_ACTAS, nombre]);
  if (!rows.length) throw noEncontrado('No se encontró el acta.');
  const ruta = path.join(config.storageDir, rows[0].ruta_relativa);
  if (!ruta.startsWith(config.storageDir + path.sep)) throw prohibido();
  return { ruta, mime: 'application/pdf', nombre: path.posix.basename(nombre) };
}

const ESTADO_VALIDADOR = { pendiente: 'pendiente', en_revision: 'revision', correcciones: 'correcciones', completo: 'aprobado' };

// Devuelve el estado del validador de documentos por cédula de cada entrega.
export async function estadosEntrega(usuario) {
  exigirLectura(usuario);
  const params = [esGestor(usuario) ? normNodo(usuario.nodo) : null];
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  const { rows } = await query(
    `SELECT c.cedula, c.estado_validacion
       FROM ciudadanos c
       LEFT JOIN unidades_productivas up ON up.id_up = c.id_up
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE c.cedula IS NOT NULL AND ($1::text IS NULL OR upper(t.nodo) = $1) AND ${alcance}`,
    params);
  return { ok: true, items: Object.fromEntries(rows.map((r) => [r.cedula, ESTADO_VALIDADOR[r.estado_validacion] || 'pendiente'])) };
}

// Devuelve el nodo de la unidad para el cargue del cronograma.
async function nodoDeUP(idUnico, docCompras) {
  const up = await query(
    `SELECT up.id_up, t.nodo FROM unidades_productivas up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE up.id_unico = $1`, [String(idUnico)]);
  if (up.rows[0]?.nodo) return { nodo: up.rows[0].nodo, idUp: up.rows[0].id_up };
  const c = await query('SELECT nodo FROM items_ups WHERE id_unico = $1', [String(idUnico)]);
  if (c.rows[0]?.nodo) return { nodo: c.rows[0].nodo, idUp: null };
  const n = normNodo(docCompras);
  if (n) {
    const t = await query('SELECT nodo FROM triadas WHERE upper(nodo) = $1 LIMIT 1', [n]);
    if (t.rows[0]) return { nodo: t.rows[0].nodo, idUp: null };
  }
  return null;
}

// Compara dos valores en profundidad sin importar el orden de las llaves, que jsonb reordena al guardar.
const estable = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, estable(v[k])])) : v);
const igual = (a, b) => JSON.stringify(estable(a)) === JSON.stringify(estable(b));

// Recibe por lotes las entregas del cargue de compras y reemplaza las columnas que trae el Excel.
export async function cargarEntregas(usuario, cuerpo = {}) {
  exigirCargue(usuario);
  const entregas = lista(cuerpo.entregas);
  if (!entregas.length) throw solicitudInvalida('No hay entregas para cargar.');
  if (entregas.length > 500) throw solicitudInvalida('Envía el cargue en lotes de máximo 500 entregas.');

  const salida = { ok: true, guardadas: 0, sin_cambios: 0, sin_nodo: [], fallidas: [], errores: [] };
  for (const e of entregas) {
    const id = Number(e?.id_unico);
    if (!Number.isInteger(id) || id <= 0) { salida.fallidas.push({ id: e?.id_unico ?? null, error: 'id_unico inválido' }); continue; }
    try {
      const destino = await nodoDeUP(id, e.excel?.excel_ruta_nodo);
      if (!destino) { salida.sin_nodo.push(id); continue; }
      const excel = Object.fromEntries(Object.entries(e.excel || {}).filter(([k]) => k.startsWith('excel_')));
      const cambio = await transaccion(async (db) => {
        const previo = (await db.query('SELECT * FROM entregas_ups WHERE id_unico = $1 FOR UPDATE', [String(id)])).rows[0];
        const doc = { ...(previo?.doc || {}) };
        for (const k of Object.keys(doc)) if (k.startsWith('excel_')) delete doc[k];
        Object.assign(doc, excel, { unidad_nombre: String(e.unidad_nombre || doc.unidad_nombre || '') });
        const antesExcel = Object.fromEntries(Object.entries(previo?.doc || {}).filter(([k]) => k.startsWith('excel_')));
        if (previo && igual(antesExcel, excel) && previo.nodo === destino.nodo) return false;

        const fecha = fechaProgramada(doc);
        if (doc.solicitud_en && fecha && fecha !== doc.solicitud_fecha_anterior) {
          doc.historial = [...lista(doc.historial), {
            accion: 'reagendada', fecha_anterior: doc.solicitud_fecha_anterior, fecha_nueva: fecha, en: ahoraIso(), por: 'cargue de MASTER ENTREGAS',
          }];
          limpiarSolicitud(doc);
        }
        await db.query(
          `INSERT INTO entregas_ups (id_unico, id_up, nodo, unidad_nombre, doc, actualizado_en)
           VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (id_unico) DO UPDATE SET id_up = EXCLUDED.id_up, nodo = EXCLUDED.nodo,
              unidad_nombre = EXCLUDED.unidad_nombre, doc = EXCLUDED.doc, actualizado_en = now()`,
          [String(id), destino.idUp, destino.nodo, doc.unidad_nombre, JSON.stringify(doc)]);
        return true;
      });
      if (cambio) salida.guardadas += 1; else salida.sin_cambios += 1;
    } catch (err) {
      salida.fallidas.push({ id, error: 'no se pudo guardar' });
      if (salida.errores.length < 3) salida.errores.push(String(err.message).slice(0, 200));
    }
  }
  await registrar(usuario, {
    accion: 'cargue.entregas', objeto: { tipo: 'cronograma', id: null },
    cambios: { guardadas: salida.guardadas, sin_cambios: salida.sin_cambios, sin_nodo: salida.sin_nodo.length, fallidas: salida.fallidas.length },
  });
  return salida;
}
