// Seguimiento de la convocatoria de un taller por unidad productiva: constancia del correo enviado y llamadas
// de confirmación. Cada llamada se agenda, se marca como contestada o no y, si contestó, registra si asistirá y
// si necesita algún ajuste.
import { query, transaccion } from './db.js';
import { noEncontrado, solicitudInvalida } from './errores.js';
import { MODIFICADO, registrar } from './servicios/actividad.js';

export const ESTADOS_LLAMADA = ['agendada', 'contesto', 'no_contesto', 'cancelada'];
const idValido = (v) => /^\d{1,9}$/.test(String(v ?? ''));
const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fechaHora = (iso) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(iso));
const siNo = (v) => (v === true || v === 'si' || v === 'true' ? true : v === false || v === 'no' || v === 'false' ? false : null);

// Valida la fecha y hora de la llamada y la devuelve en formato ISO; usa el momento actual si viene vacía.
function fechaLlamada(v) {
  if (v === undefined || v === null || v === '') return new Date().toISOString();
  const d = new Date(v);
  if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw solicitudInvalida('La fecha y hora de la llamada no es válida.');
  return d.toISOString();
}

// Valida el número de teléfono de la llamada.
function telefonoLlamada(v) {
  const t = txt(v, 30);
  if (t && !/^[\d+\s()-]{7,30}$/.test(t)) throw solicitudInvalida('El número de la llamada no es válido.');
  return t;
}

// Interpreta a qué módulo se refiere la llamada: 1, 2 o 3, o todo el taller si va vacío.
function moduloLlamada(v) {
  if (v === undefined || v === null || v === '' || v === 'todos') return null;
  const n = Number(v);
  if (![1, 2, 3].includes(n)) throw solicitudInvalida('El módulo de la llamada debe ser 1, 2, 3 o todos.');
  return n;
}

// Comprueba que una llamada agendada sea anterior al módulo que confirma.
function exigirAntesDelModulo(inicio, modulo, encuentros) {
  const pendientes = encuentros.filter((e) => !e.realizado_en).sort((a, b) => a.modulo - b.modulo);
  const e = modulo ? encuentros.find((x) => x.modulo === modulo) : pendientes[0];
  if (modulo && !e) throw solicitudInvalida(`El taller no tiene módulo ${modulo}.`);
  if (!e || e.realizado_en) {
    throw solicitudInvalida(modulo ? `El módulo ${modulo} ya se realizó: no hay nada que confirmar.` : 'Todos los módulos del taller ya se realizaron: no hay nada que confirmar.');
  }
  if (new Date(inicio).getTime() >= new Date(e.inicio).getTime()) {
    throw solicitudInvalida(`La llamada debe ser antes del módulo ${e.modulo} (${fechaHora(e.inicio)}).`);
  }
}

// Clasifica una llamada agendada según el tiempo: sin efecto si su módulo ya se realizó, vencida si pasó su
// hora.
export function enElTiempo(l, encuentros, ahora = Date.now()) {
  if (l.estado !== 'agendada') return { ...l, vencida: false, sin_efecto: false };
  const sinEfecto = l.modulo
    ? Boolean(encuentros.find((e) => e.modulo === l.modulo)?.realizado_en)
    : encuentros.length > 0 && encuentros.every((e) => e.realizado_en);
  return { ...l, sin_efecto: sinEfecto, vencida: !sinEfecto && new Date(l.inicio).getTime() < ahora };
}

// Devuelve lo que queda de una llamada según su estado; el resultado solo existe si contestó.
function resultado(estado, d) {
  if (!ESTADOS_LLAMADA.includes(estado)) throw solicitudInvalida('Estado de la llamada desconocido.');
  if (estado !== 'contesto') return { asistira: null, discapacidad: null, discapacidad_detalle: null };
  const asistira = siNo(d.asistira);
  if (asistira === null) throw solicitudInvalida('Indica si la UP asistirá o no al taller.');
  const discapacidad = siNo(d.discapacidad);
  if (discapacidad === null) throw solicitudInvalida('Indica si asistirá alguna persona con discapacidad.');
  const detalle = discapacidad ? txt(d.discapacidad_detalle, 500) : null;
  if (discapacidad && !detalle) throw solicitudInvalida('Describe la discapacidad y el ajuste que necesita para el taller.');
  return { asistira, discapacidad, discapacidad_detalle: detalle };
}

// Resume en qué va la convocatoria de una unidad según su última llamada no cancelada.
function situacion(llamadas) {
  const u = llamadas.find((l) => l.estado !== 'cancelada');
  if (!u) return 'por_llamar';
  return situacionDe(u);
}

// Calcula la situación de una llamada: agendada, vencida, sin efecto, no contestó, asistirá o no asistirá.
const situacionDe = (l) => {
  if (l.estado === 'contesto') return l.asistira ? 'asistira' : 'no_asistira';
  if (l.estado === 'agendada' && l.sin_efecto) return 'sin_efecto';
  if (l.estado === 'agendada' && l.vencida) return 'vencida';
  return l.estado;
};

// Obtiene lo que la convocatoria confirmó de cada unidad para un módulo, a partir de su última llamada válida.
export function confirmacionesDeModulo(llamadas, modulo, encuentros = []) {
  const salida = {};
  for (const x of llamadas) {
    const l = enElTiempo(x, encuentros);
    if (l.estado === 'cancelada' || (l.modulo !== null && l.modulo !== modulo) || salida[l.id_up]) continue;
    salida[l.id_up] = {
      situacion: situacionDe(l), modulo: l.modulo, inicio: l.inicio,
      discapacidad_detalle: l.estado === 'contesto' && l.discapacidad ? l.discapacidad_detalle : null,
    };
  }
  return salida;
}

// Devuelve el correo de la convocatoria de cada unidad, que es el último que no se canceló.
function correoDe(correos, up) {
  const propios = [up.correo1, up.correo2].filter(Boolean).map((c) => c.trim().toLowerCase());
  const c = correos.find((x) => x.id_up === up.id_up)
    || correos.find((x) => x.id_up === null && x.para.some((p) => propios.includes(p)));
  if (!c) return null;
  return { estado: c.estado, para: c.para, creado_en: c.creado_en, enviado_en: c.enviado_en, intentos: c.intentos, error: c.error };
}

const encuentrosDe = async (db, tallerId) => (await db.query('SELECT modulo, inicio, realizado_en FROM talleres_encuentros WHERE taller_id = $1', [tallerId])).rows;

// Registra en el router las rutas de la convocatoria de un taller, con su correo y sus llamadas; solo las
// gestiona quien tiene permisos de coordinación.
export function rutasConvocatoria(router, { tallerVisible, soloCoordinacion }) {
  const exigir = (req) => soloCoordinacion(req.usuario, 'La convocatoria la gestiona la coordinación.');
  const accion = (req, nombre, objeto, idUnico, cambios) => registrar(req.usuario, { accion: nombre, objeto, idUnico, cambios });
  const quien = (req) => req.usuario.nombre || req.usuario.sub;

  router.get('/:id/convocatoria', async (req, res) => {
    exigir(req);
    const t = await tallerVisible(req.usuario, req.params.id);
    const ids = (t.participantes || []).map((p) => Number(p.id_up)).filter((n) => Number.isInteger(n) && n > 0);
    const [{ rows: ups }, { rows: correos }, { rows: llamadas }] = await Promise.all([
      query(`SELECT up.id_up, up.id_unico, up.nombre, r.nombre_completo AS representante, r.telefono1, r.telefono2, r.correo1, r.correo2
               FROM unidades_productivas up LEFT JOIN representantes r ON r.id_representante = up.id_representante
              WHERE up.id_up = ANY($1::int[])`, [ids]),
      query(`SELECT id_up, para, estado, creado_en, enviado_en, intentos, error FROM correos_salida
              WHERE origen = 'taller_convocatoria' AND referencia = $1 AND estado <> 'cancelado' ORDER BY id DESC`, [String(t.id)]),
      query('SELECT * FROM talleres_convocatoria_llamadas WHERE taller_id = $1 ORDER BY id DESC', [t.id]),
    ]);
    const { rows: encuentros } = await query('SELECT modulo, inicio, realizado_en FROM talleres_encuentros WHERE taller_id = $1', [t.id]);
    const porId = new Map(ups.map((u) => [u.id_up, u]));
    const items = ids.filter((id) => porId.has(id)).map((id) => {
      const up = porId.get(id);
      const propias = llamadas.filter((l) => l.id_up === id).map((l) => enElTiempo(l, encuentros));
      return {
        id_up: id, id_unico: up.id_unico, nombre: up.nombre, representante: up.representante,
        telefonos: [{ etiqueta: 'Teléfono 1', numero: up.telefono1 }, { etiqueta: 'Teléfono 2', numero: up.telefono2 }],
        tiene_correo: Boolean(up.correo1 || up.correo2),
        correo: correoDe(correos, up),
        llamadas: propias,
        situacion: situacion(propias),
      };
    });
    const cuenta = (f) => items.filter(f).length;
    res.json({
      ok: true, items,
      resumen: {
        unidades: items.length,
        correo: {
          enviados: cuenta((i) => i.correo?.estado === 'enviado'),
          pendientes: cuenta((i) => ['pendiente', 'enviando'].includes(i.correo?.estado)),
          fallidos: cuenta((i) => ['fallido', 'vencido'].includes(i.correo?.estado)),
          sin_correo: cuenta((i) => !i.tiene_correo),
        },
        llamadas: Object.fromEntries(['por_llamar', 'agendada', 'vencida', 'sin_efecto', 'no_contesto', 'asistira', 'no_asistira'].map((s) => [s, cuenta((i) => i.situacion === s)])),
        con_discapacidad: cuenta((i) => { const u = i.llamadas.find((l) => l.estado !== 'cancelada'); return u?.estado === 'contesto' && u.discapacidad; }),
      },
    });
  });

  router.post('/:id/convocatoria/llamadas', async (req, res) => {
    exigir(req);
    const d = req.body || {};
    const estado = d.estado ? String(d.estado) : 'agendada';
    if (estado === 'cancelada') throw solicitudInvalida('Una llamada nueva no puede quedar cancelada.');
    const r = resultado(estado, d);
    const inicio = fechaLlamada(d.inicio);
    const telefono = telefonoLlamada(d.telefono);
    const notas = txt(d.notas, 2000);
    const modulo = moduloLlamada(d.modulo);
    const fila = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const p = idValido(d.id_up) && (t.participantes || []).find((x) => x.id_up === Number(d.id_up));
      if (!p) throw noEncontrado('Esa UP no pertenece al grupo del taller.');
      if (estado === 'agendada') exigirAntesDelModulo(inicio, modulo, await encuentrosDe(db, t.id));
      const { rows: [l] } = await db.query(
        `INSERT INTO talleres_convocatoria_llamadas (taller_id, id_up, inicio, telefono, estado, asistira, discapacidad, discapacidad_detalle, notas,
                                                     creado_por, actualizado_por, modulo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11) RETURNING *`,
        [t.id, p.id_up, inicio, telefono, estado, r.asistira, r.discapacidad, r.discapacidad_detalle, notas, quien(req), modulo]);
      return { l, idUnico: p.id_unico };
    });
    await accion(req, 'talleres.convocatoria_llamada', { tipo: 'taller', id: fila.l.taller_id }, fila.idUnico,
      { nuevo: true, estado, modulo, asistira: r.asistira, ...(r.discapacidad !== null ? { discapacidad: MODIFICADO } : {}) });
    res.json({ ok: true, item: fila.l, mensaje: estado === 'agendada' ? 'Llamada agendada.' : 'Llamada registrada.' });
  });

  router.patch('/:id/convocatoria/llamadas/:lid', async (req, res) => {
    exigir(req);
    if (!idValido(req.params.lid)) throw noEncontrado('La llamada no existe.');
    const d = req.body || {};
    const fila = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const { rows: [l] } = await db.query('SELECT * FROM talleres_convocatoria_llamadas WHERE id = $1 AND taller_id = $2 FOR UPDATE', [req.params.lid, t.id]);
      if (!l) throw noEncontrado('La llamada no existe.');
      const estado = d.estado ? String(d.estado) : l.estado;
      if (l.estado === 'cancelada' && estado !== 'cancelada') throw solicitudInvalida('La llamada está cancelada: agenda una nueva.');
      const r = resultado(estado, { asistira: l.asistira, discapacidad: l.discapacidad, discapacidad_detalle: l.discapacidad_detalle, ...d });
      const inicio = d.inicio !== undefined ? fechaLlamada(d.inicio) : new Date(l.inicio).toISOString();
      const telefono = d.telefono !== undefined ? telefonoLlamada(d.telefono) : l.telefono;
      const notas = d.notas !== undefined ? txt(d.notas, 2000) : l.notas;
      const modulo = d.modulo !== undefined ? moduloLlamada(d.modulo) : l.modulo;
      if (estado === 'agendada' && (inicio !== new Date(l.inicio).toISOString() || modulo !== l.modulo)) {
        exigirAntesDelModulo(inicio, modulo, await encuentrosDe(db, t.id));
      }
      const historial = [...(l.historial || [])];
      if (inicio !== new Date(l.inicio).toISOString()) historial.push({ cambio: 'hora', de: l.inicio, a: inicio, por: quien(req), en: new Date().toISOString() });
      if (modulo !== l.modulo) historial.push({ cambio: 'modulo', de: l.modulo, a: modulo, por: quien(req), en: new Date().toISOString() });
      if (estado !== l.estado) historial.push({ cambio: 'estado', de: l.estado, a: estado, por: quien(req), en: new Date().toISOString() });
      const { rows: [n] } = await db.query(
        `UPDATE talleres_convocatoria_llamadas SET inicio=$2, telefono=$3, estado=$4, asistira=$5, discapacidad=$6, discapacidad_detalle=$7, notas=$8,
                historial=$9, actualizado_por=$10, modulo=$11, actualizado_en=now() WHERE id=$1 RETURNING *`,
        [l.id, inicio, telefono, estado, r.asistira, r.discapacidad, r.discapacidad_detalle, notas, JSON.stringify(historial), quien(req), modulo]);
      const { rows: [up] } = await db.query('SELECT id_unico FROM unidades_productivas WHERE id_up = $1', [l.id_up]);
      return { antes: l, n, idUnico: up?.id_unico ?? null };
    });
    const { antes, n } = fila;
    const campos = {};
    if (antes.estado !== n.estado) campos.estado = [antes.estado, n.estado];
    if (antes.modulo !== n.modulo) campos.modulo = [antes.modulo, n.modulo];
    if (antes.asistira !== n.asistira) campos.asistira = [antes.asistira, n.asistira];
    if (new Date(antes.inicio).getTime() !== new Date(n.inicio).getTime()) campos.inicio = [antes.inicio, n.inicio];
    if (antes.discapacidad !== n.discapacidad || antes.discapacidad_detalle !== n.discapacidad_detalle) campos.discapacidad = MODIFICADO;
    if (antes.telefono !== n.telefono) campos.telefono = MODIFICADO;
    await accion(req, 'talleres.convocatoria_llamada', { tipo: 'taller', id: n.taller_id }, fila.idUnico, { campos });
    res.json({ ok: true, item: n, mensaje: n.estado === 'cancelada' ? 'Llamada cancelada.' : 'Llamada actualizada.' });
  });
}
