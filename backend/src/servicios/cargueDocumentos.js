// Cargue de la documentación completa a partir de dos archivos Excel. El navegador lee los archivos y envía por
// lotes una fila por unidad con dos partes: m, con las columnas de la hoja «up» de la BASE MASTER, y a, con las
// de la hoja «AUDITORIA» de auditoria_global_archivos, o null si no está. Aquí se reconstruye el estado
// documental de cada unidad por etapa.
import { transaccion } from '../db.js';
import { prohibido, solicitudInvalida } from '../errores.js';
import { conRegistro } from './actividad.js';
import { anotarLote } from './historialSubsanacion.js';

const MAX_FILAS = 500;

const vacio = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'sin datos asignados'
  || ['none', 'nan', '#n/a', 'null', '-'].includes(String(v).trim().toLowerCase());
const texto = (v, max = 500) => (vacio(v) ? null : String(v).trim().slice(0, max));

// Convierte a booleano de forma tolerante; devuelve null si la celda está vacía o no se entiende.
export function booleano(v) {
  if (v === true || v === false) return v;
  if (vacio(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'x', 'verdadero', 'completa', 'completo', 'ok', 'aprobada', 'aprobado'].includes(s)) return true;
  if (['0', 'false', 'no', 'falso', 'incompleta', 'incompleto', 'pendiente'].includes(s)) return false;
  if (/^\d+(\.0+)?$/.test(s)) return Number(s) > 0;
  return null;
}

const entero = (v) => {
  if (vacio(v)) return null;
  const n = Math.trunc(Number(String(v).replace(',', '.')));
  return Number.isFinite(n) ? n : null;
};

// Convierte a AAAA-MM-DD una fecha en ISO, dd/mm/aaaa o número de serie de Excel.
export function fecha(v) {
  if (vacio(v)) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// Fija la fecha a mediodía UTC para que ningún huso horario la corra de día en las columnas TIMESTAMPTZ.
export const marcaDia = (v) => { const d = fecha(v); return d ? `${d}T12:00:00Z` : null; };

function listaJson(v) {
  if (Array.isArray(v)) return v;
  const s = String(v ?? '').trim();
  if (s.startsWith('[')) { try { const j = JSON.parse(s); if (Array.isArray(j)) return j; } catch { } }
  return null;
}

// Convierte la celda en una lista de archivos con su nombre.
export function archivos(v) {
  if (vacio(v)) return [];
  const j = listaJson(v);
  const items = j || String(v).split(/[\n;|]+/);
  return items.map((x) => (typeof x === 'object' && x ? x : { nombre: String(x).trim() }))
    .filter((x) => x.nombre).slice(0, 200).map((x) => ({ ...x, nombre: String(x.nombre).slice(0, 300) }));
}

const ESTADO_OK = /^(ok|si|sí|cumple|completo|completa|✔|✓|1|true)$/i;
const ESTADO_FALTA = /^(falta|no|no cumple|incompleto|incompleta|pendiente|✗|✘|0|false)$/i;

// Convierte la celda en una lista de comprobaciones con su estado: ok, falta u otro texto.
export function checks(v) {
  if (vacio(v)) return [];
  const j = listaJson(v);
  if (j) {
    return j.map((x) => (typeof x === 'object' && x ? { item: String(x.item ?? x.nombre ?? '').slice(0, 300), estado: String(x.estado ?? '').toLowerCase() || 'falta' } : null)).filter((x) => x?.item);
  }
  return String(v).split(/\n+/).map((linea) => {
    const m = /^(.*?)\s*[:=\-–]\s*([^:=\-–]+)$/.exec(linea.trim());
    if (!m) return linea.trim() ? { item: linea.trim().slice(0, 300), estado: 'falta' } : null;
    const est = m[2].trim();
    return { item: m[1].trim().slice(0, 300), estado: ESTADO_OK.test(est) ? 'ok' : ESTADO_FALTA.test(est) ? 'falta' : est.toLowerCase().slice(0, 40) };
  }).filter(Boolean);
}

// Equivalencia de cada etapa con sus columnas en la auditoría y en la base maestra.
const ETAPAS = [
  { codigo: 'beneficiario', a: 'b00', docM: null },
  { codigo: 'visita1', a: 'v1', docM: 'v1_documentacion', fecha: 'v1_fecha', reprog: 'v1_reprogramacion', agend: 'v1_agendamiento', modal: 'v1_modalidad' },
  { codigo: 'visita2', a: 'v2', docM: 'v2_documentacion' },
  { codigo: 'fortalecimiento', a: 'fort', docM: null },
  { codigo: 'fortalecimiento.modulo1', a: 'm1' },
  { codigo: 'fortalecimiento.modulo2', a: 'm2' },
  { codigo: 'fortalecimiento.modulo3', a: 'm3' },
  { codigo: 'talleres', a: null, docM: 'talleres_documentacion' },
  { codigo: 'capitalizacion', a: 'cap', docM: 'capitalizacion_documentacion' },
  { codigo: 'cotizaciones.ganadora', a: 'cot1' },
  { codigo: 'cotizaciones.proveedor2', a: 'cot2' },
  { codigo: 'cotizaciones.proveedor3', a: 'cot3' },
  { codigo: 'compra', a: 'compra', docM: 'compra_documentacion', checklist: 'compra_checklist' },
  { codigo: 'entrega', a: 'entrega', docM: null, checklist: 'entrega_checklist', fecha: 'entrega_fecha', reprog: 'entrega_reprogramacion', result: 'entrega_resultado' },
  { codigo: 'visita3', a: 'v3', docM: 'v3_documentacion', fecha: 'v3_fecha', reprog: 'v3_reprogramacion', result: 'v3_resultado', modal: 'v3_modalidad' },
];

function etapaDe(def, m, a) {
  const A = (k) => (a ? a[`${def.a}_${k}`] : undefined);
  const arch = def.a ? archivos(A('archivos')) : [];
  const chk = def.a ? checks(A('checks')) : [];
  const lista = def.checklist && a ? checks(a[def.checklist]) : [];
  let completa = def.a ? booleano(A('completa')) : null;
  if (completa === null && def.docM) {
    const d = texto(m[def.docM]);
    completa = d ? booleano(/incomplet/i.test(d) ? 'incompleta' : /complet/i.test(d) ? 'completa' : d) : null;
  }
  const fila = {
    completa,
    archivos: arch,
    total_archivos: arch.length || null,
    checks: chk,
    checklist: lista.length ? lista : null,
    fecha: def.fecha ? marcaDia(m[def.fecha]) : null,
    fecha_reprogramacion: def.reprog ? marcaDia(m[def.reprog]) : null,
    estado_agendamiento: def.agend ? texto(m[def.agend], 100) : null,
    modalidad: def.modal ? texto(m[def.modal], 100) : null,
    resultado: def.result ? texto(m[def.result], 200) : null,
  };
  const tieneDatos = completa !== null || arch.length || chk.length || lista.length || fila.fecha || fila.fecha_reprogramacion
    || fila.estado_agendamiento || fila.modalidad || fila.resultado;
  return tieneDatos ? fila : null;
}

// Guarda una fila y devuelve un error si no se pudo, o el proceso de subsanación con el antes y el después.
async function aplicarFila(db, f) {
  const m = f.m && typeof f.m === 'object' ? f.m : {};
  const a = f.a && typeof f.a === 'object' ? f.a : null;
  const idUnico = String(Number(m.id_unico ?? a?.id_unico));
  if (!/^\d+$/.test(idUnico) || idUnico === '0') return { error: { id: m.id_unico ?? null, error: 'id_unico inválido' } };
  const up = (await db.query('SELECT id_up FROM unidades_productivas WHERE id_unico = $1', [idUnico])).rows[0];
  if (!up) return { error: { id: Number(idUnico), error: 'unidad no encontrada' } };
  const previo = (await db.query('SELECT subsanaciones_proceso FROM expedientes_up WHERE id_up = $1', [up.id_up])).rows[0];

  if (texto(m.enlace_carpeta, 1000)) {
    await db.query('UPDATE unidades_productivas SET enlace_carpeta = $2 WHERE id_up = $1', [up.id_up, texto(m.enlace_carpeta, 1000)]);
  }
  const rit = booleano(a?.tiene_rit) ?? booleano(m.rit);
  const { rows: [e] } = await db.query(
    `INSERT INTO expedientes_up (id_origen, id_up, doc_interventoria, observaciones,
        up_aprobada, lote_up_aprobada, doc_completa_gestor, doc_completa_triada, novedad_dps_gestor, novedad_contacto_no_posible,
        rit_tiene, rit_fecha_enviado, rit_total_dias, rit_ubicacion, rit_direccion,
        pdf_carrito_estado, viabilidad_plan_inversion, aprobacion_plan_negocio, subsanaciones_comite, subsanaciones_proceso,
        evento_asistencia, fecha_actualizacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
     ON CONFLICT (id_up) DO UPDATE SET
        doc_interventoria = EXCLUDED.doc_interventoria, observaciones = EXCLUDED.observaciones,
        up_aprobada = EXCLUDED.up_aprobada, lote_up_aprobada = EXCLUDED.lote_up_aprobada,
        doc_completa_gestor = EXCLUDED.doc_completa_gestor, doc_completa_triada = EXCLUDED.doc_completa_triada,
        novedad_dps_gestor = EXCLUDED.novedad_dps_gestor, novedad_contacto_no_posible = EXCLUDED.novedad_contacto_no_posible,
        rit_tiene = EXCLUDED.rit_tiene, rit_fecha_enviado = EXCLUDED.rit_fecha_enviado, rit_total_dias = EXCLUDED.rit_total_dias,
        rit_ubicacion = EXCLUDED.rit_ubicacion, rit_direccion = EXCLUDED.rit_direccion,
        pdf_carrito_estado = EXCLUDED.pdf_carrito_estado, viabilidad_plan_inversion = EXCLUDED.viabilidad_plan_inversion,
        aprobacion_plan_negocio = EXCLUDED.aprobacion_plan_negocio, subsanaciones_comite = EXCLUDED.subsanaciones_comite,
        subsanaciones_proceso = EXCLUDED.subsanaciones_proceso, evento_asistencia = EXCLUDED.evento_asistencia,
        fecha_actualizacion = now()
     RETURNING id_expediente`,
    [`DOC-${idUnico}`, up.id_up, texto(m.doc_interventoria, 200), texto(m.observaciones, 4000),
      booleano(a?.up_aprobada), texto(a?.lote_up_aprobada, 50), booleano(a?.doc_completa_gestor), booleano(a?.doc_completa_triada),
      texto(a?.novedad_dps_gestor), booleano(a?.novedad_contacto_no_posible),
      rit, marcaDia(m.rit_fecha_enviado), entero(a?.total_dias_rit), texto(m.rit_ubicacion, 300), texto(m.rit_direccion, 300),
      texto(m.pdf_carrito, 100), texto(m.plan_inversion, 200), texto(m.plan_negocio, 200),
      texto(m.comite_subsanaciones, 4000), texto(m.proceso_subsanacion, 4000), texto(m.evento_asistencia, 100)],
  );

  for (const def of ETAPAS) {
    const fila = etapaDe(def, m, a);
    const { rows: [et] } = await db.query('SELECT id_etapa FROM etapas WHERE codigo = $1', [def.codigo]);
    if (!et) continue;
    if (!fila) {
      await db.query('DELETE FROM expediente_etapas WHERE id_expediente = $1 AND id_etapa = $2', [e.id_expediente, et.id_etapa]);
      continue;
    }
    await db.query(
      `INSERT INTO expediente_etapas (id_expediente, id_etapa, completa, archivos, total_archivos, checks, checklist, fecha,
                                      fecha_reprogramacion, estado_agendamiento, modalidad, resultado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id_expediente, id_etapa) DO UPDATE SET
         completa = EXCLUDED.completa, archivos = EXCLUDED.archivos, total_archivos = EXCLUDED.total_archivos,
         checks = EXCLUDED.checks, checklist = EXCLUDED.checklist, fecha = EXCLUDED.fecha,
         fecha_reprogramacion = EXCLUDED.fecha_reprogramacion, estado_agendamiento = EXCLUDED.estado_agendamiento,
         modalidad = EXCLUDED.modalidad, resultado = EXCLUDED.resultado`,
      [e.id_expediente, et.id_etapa, fila.completa, JSON.stringify(fila.archivos), fila.total_archivos, JSON.stringify(fila.checks),
        fila.checklist ? JSON.stringify(fila.checklist) : null, fila.fecha, fila.fecha_reprogramacion,
        fila.estado_agendamiento, fila.modalidad, fila.resultado],
    );
  }
  return { subsanacion: { id_unico: idUnico, antes: previo?.subsanaciones_proceso ?? null, despues: texto(m.proceso_subsanacion, 4000) } };
}

// Recibe un lote de filas y aplica cada una.
export async function cargarDocumentos(usuario, cuerpo = {}) {
  if (!usuario?.general) throw prohibido('Solo el coordinador de datos puede hacer cargues.');
  const filas = cuerpo.filas;
  if (!Array.isArray(filas) || !filas.length) throw solicitudInvalida('No hay filas para cargar.');
  if (filas.length > MAX_FILAS) throw solicitudInvalida(`Máximo ${MAX_FILAS} filas por envío.`);

  return conRegistro(usuario, { accion: 'cargue.documentos', objeto: { tipo: 'expedientes', id: null } }, async () => {
    const salida = { ok: true, guardados: 0, fallidos: [], errores: [] };
    const subs = { cambios: [], sin_cambios: 0, no_encontrados: 0, fallidos: 0 };
    for (const f of filas) {
      try {
        const r = await transaccion((db) => aplicarFila(db, f || {}));
        if (r.error) {
          salida.fallidos.push(r.error);
          if (r.error.error === 'unidad no encontrada') subs.no_encontrados += 1; else subs.fallidos += 1;
          continue;
        }
        salida.guardados += 1;
        if (r.subsanacion.antes === r.subsanacion.despues) subs.sin_cambios += 1; else subs.cambios.push(r.subsanacion);
      } catch (err) {
        salida.fallidos.push({ id: f?.m?.id_unico ?? null, error: 'no se pudo guardar' });
        if (salida.errores.length < 3) salida.errores.push(String(err.message).slice(0, 200));
        subs.fallidos += 1;
      }
    }
    await anotarLote(usuario, cuerpo.historial, subs);
    return salida;
  }, (r) => ({ guardados: r.guardados, fallidos: r.fallidos.length }));
}

