// Lista de compras por unidad productiva: un documento por unidad con los ítems aprobados, su estado de compra
// y la logística de alistamiento, despacho y entrega. Se alimenta con el cargue de compras desde Excel y la
// coordinación de compras lo completa marcando ítems.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { esGestor, normNodo } from '../util.js';
import { condicionAlcanceFila, exigirAlcanceDeUP } from '../alcance.js';
import { conRegistro, registrar, registrarPorUnidad, tope } from './actividad.js';

const lista = (x) => (Array.isArray(x) ? x : []);
const ahoraIso = () => new Date().toISOString();
const quienEs = (u) => u.nombre || u.sub || 'sistema';

const puedeVer = (u) => esGestor(u) || [ROLES.COORDINADOR, ROLES.COMPRAS].includes(u?.rol);
const puedeEditar = (u) => [ROLES.COORDINADOR, ROLES.COMPRAS].includes(u?.rol);
const puedeCargar = (u) => !!u?.general || u?.rol === ROLES.COMPRAS;

const exigirLectura = (u) => { if (!puedeVer(u)) throw prohibido('Tu rol no ve la lista de compras.'); };
const exigirEdicion = (u) => { if (!puedeEditar(u)) throw prohibido('Solo compras o coordinación pueden marcar la lista.'); };
const exigirCargue = (u) => { if (!puedeCargar(u)) throw prohibido('Solo el Profesional alianzas y conexión de mercados puede cargar el MASTER ENTREGAS.'); };

const LOGISTICA_VACIA = {
  comprado: false, alistamiento: false, despachado: false, entregado: false,
  tipo_novedad: '', descripcion_novedad: '', observaciones: '',
};

// Valida y normaliza los datos de logística de un ítem (alistamiento, despacho y entrega), conservando lo
// previo.
function logisticaLimpia(l = {}, previa = LOGISTICA_VACIA) {
  const bool = (k) => (typeof l[k] === 'boolean' ? l[k] : !!previa[k]);
  const txt = (k) => String(l[k] ?? previa[k] ?? '').slice(0, 2000);
  return {
    comprado: !!previa.comprado,
    alistamiento: bool('alistamiento'), despachado: bool('despachado'), entregado: bool('entregado'),
    entregado_en: previa.entregado_en || (previa === LOGISTICA_VACIA && l.entregado_en)
      || (bool('entregado') ? new Date().toISOString() : null),
    tipo_novedad: txt('tipo_novedad'), descripcion_novedad: txt('descripcion_novedad'), observaciones: txt('observaciones'),
  };
}

// Indica si todos los ítems están comprados y hay al menos uno.
const todoComprado = (items) => items.length > 0 && items.every((i) => i.compra?.comprado === true);

// Cuenta el total de ítems, los comprados y los marcados.
function conteos(items) {
  return {
    total_items: items.length,
    items_comprados: items.filter((i) => i.compra?.comprado === true).length,
    items_marcados: items.filter((i) => i.compra).length,
  };
}

const selectResumen = (alcance) => `
  SELECT id_unico, nodo, doc, total_items, items_comprados, items_marcados, actualizado_en, actualizado_por
    FROM items_ups
   WHERE vigente AND ($1::text IS NULL OR upper(nodo) = $1) AND ${alcance}
   ORDER BY id_unico::int`;

function resumen(r) {
  const { items: _items, ...resto } = r.doc;
  return {
    ...resto,
    id: String(r.id_unico), id_unico: Number(r.id_unico) || r.id_unico, nodo: r.nodo,
    total_items: r.total_items, items_comprados: r.items_comprados, items_marcados: r.items_marcados,
    fecha_actualizacion: r.actualizado_en, actualizado_por: r.actualizado_por || '',
  };
}

export async function listarItemsUPs(usuario) {
  exigirLectura(usuario);
  const params = [esGestor(usuario) ? normNodo(usuario.nodo) : null];
  const alcance = condicionAlcanceFila(usuario, { idUp: 'items_ups.id_up', nodo: 'items_ups.nodo' }, params);
  const { rows } = await query(selectResumen(alcance), params);
  return { ok: true, items: rows.map(resumen) };
}

async function filaDe(usuario, id, db = { query }, bloquear = false) {
  const { rows } = await db.query(
    `SELECT * FROM items_ups WHERE id_unico = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [String(id || '')]);
  const r = rows[0];
  if (!r || !r.vigente) throw noEncontrado('Esa unidad no tiene lista de compras.');
  if (esGestor(usuario) && normNodo(r.nodo) !== normNodo(usuario.nodo)) throw noEncontrado('Esa unidad no tiene lista de compras.');
  await exigirAlcanceDeUP(usuario, r.id_up, r.nodo);
  return r;
}

const aDocumento = (r) => ({
  ...r.doc,
  id: String(r.id_unico), id_unico: Number(r.id_unico) || r.id_unico, nodo: r.nodo,
  fecha_actualizacion: r.actualizado_en, actualizado_por: r.actualizado_por || '',
});

export async function obtenerItemUP(usuario, { id }) {
  exigirLectura(usuario);
  return { ok: true, item: aDocumento(await filaDe(usuario, id)) };
}

// Guarda las marcas de compra y los datos de logística de una unidad.
export async function guardarItemUP(usuario, cuerpo = {}) {
  exigirEdicion(usuario);
  const cambios = {};
  const item = await conRegistro(usuario, { accion: 'compras.guardar', objeto: { tipo: 'lista_compras', id: cuerpo.id }, idUnico: cuerpo.id },
    () => guardarItemUPInterno(usuario, cuerpo, cambios), () => cambios);
  return { ok: true, item };
}

async function guardarItemUPInterno(usuario, cuerpo, cambios) {
  const item = await transaccion(async (db) => {
    const r = await filaDe(usuario, cuerpo.id, db, true);
    const doc = r.doc;
    const items = lista(doc.items);
    const ahora = ahoraIso();
    for (const c of lista(cuerpo.compras)) {
      const it = items[Number(c.idx)];
      if (!it) throw solicitudInvalida(`El ítem ${c.idx} no existe.`);
      if (c.item_n != null && it.item_n != null && Number(c.item_n) !== Number(it.item_n)) {
        throw solicitudInvalida('La lista cambió mientras la editabas. Recárgala e intenta de nuevo.');
      }
      const marcado = c.comprado === true;
      if (!it.compra || (it.compra.comprado === true) !== marcado) {
        it.compra = { comprado: marcado, origen: 'manual', por: quienEs(usuario), en: ahora };
        (cambios.compras ||= []).push({ item_n: it.item_n, comprado: marcado });
      }
    }
    const logisticaAntes = doc.logistica || {};
    doc.logistica = logisticaLimpia(cuerpo.logistica, doc.logistica);
    doc.logistica.comprado = todoComprado(items);
    for (const k of ['alistamiento', 'despachado', 'entregado', 'tipo_novedad', 'descripcion_novedad', 'observaciones']) {
      if (JSON.stringify(logisticaAntes[k] ?? null) !== JSON.stringify(doc.logistica[k] ?? null)) (cambios.logistica ||= {})[k] = doc.logistica[k];
    }
    await db.query(
      `UPDATE items_ups SET doc = $2, total_items = $3, items_comprados = $4, items_marcados = $5,
              actualizado_en = now(), actualizado_por = $6 WHERE id_unico = $1`,
      [r.id_unico, JSON.stringify(doc), ...Object.values(conteos(items)), quienEs(usuario)]);
    return aDocumento((await db.query('SELECT * FROM items_ups WHERE id_unico = $1', [r.id_unico])).rows[0]);
  });
  return item;
}

// Devuelve el nodo de la unidad según la base; si no existe, usa el del Excel solo cuando es un nodo real.
async function nodoDe(idUnico, nodoExcel) {
  const up = await query(
    `SELECT up.id_up, t.nodo FROM unidades_productivas up LEFT JOIN triadas t ON t.id_triada = up.id_triada
      WHERE up.id_unico = $1`, [String(idUnico)]);
  if (up.rows[0]?.nodo) return { nodo: up.rows[0].nodo, idUp: up.rows[0].id_up };
  const n = normNodo(nodoExcel);
  if (n) {
    const t = await query('SELECT nodo FROM triadas WHERE upper(nodo) = $1 LIMIT 1', [n]);
    if (t.rows[0]) return { nodo: t.rows[0].nodo, idUp: up.rows[0]?.id_up ?? null };
  }
  return null;
}

function validarDocCargue(d) {
  const id = Number(d?.id_unico);
  if (!Number.isInteger(id) || id <= 0) return 'id_unico inválido';
  if (!Array.isArray(d.items) || !d.items.length) return 'sin ítems';
  if (d.items.length > 500) return 'demasiados ítems';
  return null;
}

// Recibe por lotes los documentos del cargue de compras y retira los que ya no vienen vigentes.
export async function cargarCompras(usuario, cuerpo = {}) {
  exigirCargue(usuario);
  const archivo = String(cuerpo.archivo || '').slice(0, 200);

  if (Array.isArray(cuerpo.vigentes)) {
    const ids = cuerpo.vigentes.map(String);
    const r = await query(
      'UPDATE items_ups SET vigente = FALSE WHERE vigente AND NOT (id_unico = ANY($1)) RETURNING id_unico', [ids]);
    const lote = await registrar(usuario, {
      accion: 'cargue.compras_vigentes', objeto: { tipo: 'archivo', id: archivo },
      cambios: { retiradas: r.rowCount, ids: tope(r.rows.map((x) => x.id_unico)), campos: r.rowCount ? { vigente: [true, false] } : {} },
    });
    await registrarPorUnidad(usuario, {
      accion: 'cargue.compras_vigentes', objeto: { tipo: 'archivo', id: archivo }, lote,
      filas: r.rows.map((x) => ({ idUnico: x.id_unico, campos: { vigente: [true, false] } })),
    });
    return { ok: true, retiradas: r.rowCount };
  }

  const docs = lista(cuerpo.docs);
  if (!docs.length) throw solicitudInvalida('No hay unidades para cargar.');
  if (docs.length > 200) throw solicitudInvalida('Envía el cargue en lotes de máximo 200 unidades.');

  const salida = { ok: true, guardados: 0, nuevos: 0, fallidos: [], errores: [] };
  for (const d of docs) {
    const falla = validarDocCargue(d);
    if (falla) { salida.fallidos.push({ id: d?.id_unico ?? null, error: falla }); continue; }
    try {
      const destino = await nodoDe(d.id_unico, d.nodo);
      if (!destino) { salida.fallidos.push({ id: d.id_unico, error: 'sin nodo: la unidad no existe y el Excel no trae un nodo válido' }); continue; }
      const nuevo = await transaccion(async (db) => {
        const previo = (await db.query('SELECT * FROM items_ups WHERE id_unico = $1 FOR UPDATE', [String(d.id_unico)])).rows[0];
        const ahora = ahoraIso();
        const items = d.items.map((it) => {
          const { comprado_excel: marcaExcel, ...resto } = it;
          return { ...resto, comprado_excel: marcaExcel === true, compra: { comprado: marcaExcel === true, origen: 'excel', en: ahora } };
        });
        const doc = {
          ...d, nodo: destino.nodo, items,
          cronograma: d.cronograma ?? previo?.doc?.cronograma ?? null,
          ruta: d.ruta ?? previo?.doc?.ruta ?? null,
          entrega: d.entrega ?? previo?.doc?.entrega ?? null,
          logistica: logisticaLimpia(previo?.doc?.logistica, LOGISTICA_VACIA),
          ultimo_cargue: { archivo, en: ahora, por: quienEs(usuario) },
        };
        doc.logistica.comprado = todoComprado(items);
        await db.query(
          `INSERT INTO items_ups (id_unico, id_up, nodo, vigente, doc, total_items, items_comprados, items_marcados, actualizado_en, actualizado_por)
           VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7, now(), $8)
           ON CONFLICT (id_unico) DO UPDATE SET id_up = EXCLUDED.id_up, nodo = EXCLUDED.nodo, vigente = TRUE, doc = EXCLUDED.doc,
              total_items = EXCLUDED.total_items, items_comprados = EXCLUDED.items_comprados,
              items_marcados = EXCLUDED.items_marcados, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por`,
          [String(d.id_unico), destino.idUp, destino.nodo, JSON.stringify(doc), ...Object.values(conteos(items)), quienEs(usuario)]);
        return !previo;
      });
      salida.guardados += 1;
      if (nuevo) salida.nuevos += 1;
    } catch (err) {
      salida.fallidos.push({ id: d.id_unico, error: 'no se pudo guardar' });
      if (salida.errores.length < 3) salida.errores.push(String(err.message).slice(0, 200));
    }
  }
  await registrar(usuario, {
    accion: 'cargue.compras', objeto: { tipo: 'archivo', id: archivo },
    cambios: { guardados: salida.guardados, nuevos: salida.nuevos, fallidos: salida.fallidos.length },
  });
  return salida;
}
