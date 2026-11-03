// Rutas de formación de cada taller: modalidad de cada módulo, aprobación de sesiones virtuales, encuestas de
// apropiación y satisfacción, y convocatoria. Se montan dentro del router de talleres, que ya valida el permiso
// y el territorio.
import PDFDocument from 'pdfkit';
import { pool, query, transaccion } from './db.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from './errores.js';
import { registrar } from './servicios/actividad.js';
import { cancelarPendientes, encolarCorreo, estadoCorreos } from './servicios/correo.js';
import { CAUSAS_VIRTUAL } from './servicios/reglasVisitas.js';
import { fechaReal, hoyColombia } from './servicios/secciones.js';
import {
  PREGUNTAS_APROPIACION, PREGUNTAS_SATISFACCION, autorizacionDatosCargada, bloquesSesion, cumplimientoTaller,
  datosParticipantes, limpiarRespuestas, promedioSatisfaccion, variacionApropiacion,
} from './servicios/talleresFormacion.js';

const idValido = (v) => /^\d{1,9}$/.test(String(v || ''));
const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
const fechaHora = (iso) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(iso));

// Arma el texto de la convocatoria de un taller.
export function textoConvocatoria(taller, encuentros) {
  const lineas = encuentros.map((e) => `· Módulo ${e.modulo}: ${fechaHora(e.inicio)} (3 horas)${e.modalidad === 'VIRTUAL' ? ' — virtual' : ''}`);
  return [
    `Cordial saludo.`, '',
    `Su unidad productiva está convocada al taller de fortalecimiento «${taller.nombre}» de la Fundación Memories.`, '',
    `Lugar: ${taller.lugar}, ${taller.municipio}.`, 'Sesiones:', ...lineas, '',
    'Cada sesión tiene dos horas teórico-prácticas y una hora de evaluación. Las unidades M2 deben asistir con al menos 3 integrantes y las M3 y M4 con al menos 5.',
    '', 'Si no puede asistir, comuníquese con su gestor.',
  ].join('\n');
}

// Pone en cola la convocatoria para las unidades del taller y las cuentas de campo activas, y devuelve cuántos
// correos quedaron.
export async function convocar(db, taller) {
  const { rows: encuentros } = await db.query('SELECT modulo, inicio, modalidad FROM talleres_encuentros WHERE taller_id = $1 ORDER BY modulo', [taller.id]);
  const { rows: [{ previos }] } = await db.query(
    "SELECT count(*)::int AS previos FROM correos_salida WHERE origen = 'taller_convocatoria' AND referencia = $1", [String(taller.id)]);
  await cancelarPendientes(db, 'taller_convocatoria', taller.id);
  const ids = (taller.participantes || []).map((p) => p.id_up).filter(Boolean);
  if (!ids.length) return 0;
  const { rows } = await db.query(
    `SELECT up.id_up, up.id_unico, r.correo1, r.correo2, array_remove(array_agg(DISTINCT g.correo), NULL) AS gestores
       FROM unidades_productivas up
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
       LEFT JOIN triadas t ON t.id_triada = up.id_triada
       LEFT JOIN gestores g ON g.id_triada = t.id_triada AND g.activo
      WHERE up.id_up = ANY($1::int[]) GROUP BY up.id_up, up.id_unico, r.correo1, r.correo2`,
    [ids],
  );
  const reprogramacion = previos > 0;
  const texto = `${reprogramacion ? 'Esta convocatoria reemplaza la anterior: revise las fechas.\n\n' : ''}${textoConvocatoria(taller, encuentros)}`;
  const asunto = `${reprogramacion ? 'Reprogramación: convocatoria' : 'Convocatoria'} al taller de fortalecimiento «${taller.nombre}»`;
  const venceEn = encuentros.length ? new Date(Math.max(...encuentros.map((e) => new Date(e.inicio).getTime()))) : null;
  const base = { origen: 'taller_convocatoria', referencia: taller.id, venceEn };
  let n = 0;
  for (const r of rows) {
    if (await encolarCorreo(db, { ...base, para: [r.correo1, r.correo2], asunto, texto, idUp: r.id_up })) n += 1;
  }
  const porGestor = new Map();
  for (const r of rows) for (const g of r.gestores || []) porGestor.set(g, [...(porGestor.get(g) || []), r.id_unico]);
  for (const [gestor, ups] of porGestor) {
    const id = await encolarCorreo(db, {
      ...base, para: [gestor], asunto: `${asunto} — ${ups.length} unidad(es) de tu nodo`,
      texto: `${texto}\n\nUnidades de tu nodo convocadas: ${ups.join(', ')}.`,
    });
    if (id) n += 1;
  }
  return n;
}

// Registra en el router de talleres todas las rutas de formación.
export function rutasFormacion(router, h) {
  const { tallerVisible, territorio, esTallerista, esCoordinacion, soloCoordinacion, archivoValido, nombreArchivo, cargar, upload } = h;
  const esGeneral = (u) => Boolean(u?.general);
  const registrarAccion = (req, accion, objeto, idUnico, cambios) => registrar(req.usuario, { accion, objeto, idUnico, cambios });

  async function encuentroDe(db, t, modulo, bloquear = true) {
    const { rows: [e] } = await db.query(`SELECT * FROM talleres_encuentros WHERE taller_id=$1 AND modulo=$2${bloquear ? ' FOR UPDATE' : ''}`,
      [t.id, idValido(modulo) ? Number(modulo) : null]);
    if (!e) throw noEncontrado('El módulo no existe.');
    return e;
  }
  const participante = (t, idUp) => {
    if (!idValido(idUp)) throw noEncontrado('Esa UP no pertenece al grupo.');
    const p = (t.participantes || []).find((x) => x.id_up === Number(idUp));
    if (!p) throw noEncontrado('Esa UP no pertenece al grupo.');
    return p;
  };

  router.put('/:id/encuentros/:modulo/modalidad', async (req, res) => {
    const d = req.body || {};
    const modalidad = String(d.modalidad || '').toUpperCase();
    if (!['PRESENCIAL', 'VIRTUAL'].includes(modalidad)) throw solicitudInvalida('La modalidad de la sesión debe ser presencial o virtual.');
    const causa = modalidad === 'VIRTUAL' ? txt(d.causa_virtual, 30) : '';
    const justificacion = modalidad === 'VIRTUAL' ? txt(d.justificacion_virtual, 2000) : '';
    if (modalidad === 'VIRTUAL' && !CAUSAS_VIRTUAL.some((c) => c.codigo === causa)) throw solicitudInvalida('Elige la causa externa de la sesión virtual.');
    if (modalidad === 'VIRTUAL' && !justificacion) throw solicitudInvalida('Escribe la justificación de la sesión virtual.');
    const r = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const e = await encuentroDe(db, t, req.params.modulo);
      if (esTallerista(req.usuario) && e.tallerista_sub !== req.usuario.sub) throw prohibido('Este módulo lo dicta otro Tallerista.');
      if (e.realizado_en) throw solicitudInvalida('La sesión ya está registrada: su modalidad no cambia.');
      const conserva = Boolean(e.aprobacion_virtual) && modalidad === 'VIRTUAL'
        && e.causa_virtual === (causa || null) && e.justificacion_virtual === (justificacion || null);
      await db.query(`UPDATE talleres_encuentros SET modalidad=$2::varchar, causa_virtual=$3, justificacion_virtual=$4,
        aprobacion_virtual = CASE WHEN $5::boolean THEN aprobacion_virtual ELSE NULL END WHERE id=$1`,
      [e.id, modalidad, causa || null, justificacion || null, conserva]);
      return { taller: t.id, modulo: e.modulo, descartada: Boolean(e.aprobacion_virtual) && !conserva };
    });
    await registrarAccion(req, 'talleres.modalidad', { tipo: 'encuentro', id: `${r.taller}:${r.modulo}` }, null,
      { modalidad, causa_virtual: causa || null, ...(r.descartada ? { aprobacion_descartada: true } : {}) });
    res.json({
      ok: true,
      mensaje: r.descartada ? 'Modalidad guardada: la aprobación de la interventoría se descartó porque cambiaron la modalidad, la causa o la justificación.'
        : modalidad === 'VIRTUAL' ? 'Sesión marcada como virtual: falta la aprobación de la interventoría.' : 'Sesión presencial.',
    });
  });

  router.post('/:id/encuentros/:modulo/aprobacion-virtual', cargar(upload.single('archivo')), async (req, res) => {
    soloCoordinacion(req.usuario, 'La aprobación de la interventoría la registra la coordinación.');
    const fecha = String(req.body?.fecha || '').slice(0, 10);
    const aprobadaPor = txt(req.body?.aprobada_por, 200);
    if (!fechaReal(fecha) || fecha > hoyColombia()) throw solicitudInvalida('La fecha de la aprobación no es válida (no puede ser futura).');
    if (!aprobadaPor) throw solicitudInvalida('Escribe quién aprobó en la interventoría.');
    if (!req.file) throw solicitudInvalida('Adjunta el soporte de la aprobación de la interventoría en PDF.');
    const mime = archivoValido(req.file, true);
    const r = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const e = await encuentroDe(db, t, req.params.modulo);
      if (e.modalidad !== 'VIRTUAL') throw new HttpError(409, 'La sesión no está marcada como virtual.');
      if (e.realizado_en) throw solicitudInvalida('La sesión ya está registrada.');
      const { rows: [s] } = await db.query("INSERT INTO talleres_soportes (encuentro_id,nombre,mime,archivo,creado_por,tipo) VALUES ($1,$2,$3,$4,$5,'aprobacion_virtual') RETURNING id",
        [e.id, nombreArchivo(req.file), mime, req.file.buffer, req.usuario.sub]);
      const aprobacion = { fecha, aprobada_por: aprobadaPor, observacion: txt(req.body?.observacion, 1000) || null, soporte_id: s.id,
        registrada_por: req.usuario.nombre || req.usuario.sub, registrada_en: new Date().toISOString() };
      await db.query('UPDATE talleres_encuentros SET aprobacion_virtual=$2 WHERE id=$1', [e.id, JSON.stringify(aprobacion)]);
      return { taller: t.id, modulo: e.modulo, aprobacion };
    });
    await registrarAccion(req, 'talleres.aprobacion_virtual', { tipo: 'encuentro', id: `${r.taller}:${r.modulo}` }, null, { fecha, aprobada_por: aprobadaPor });
    res.json({ ok: true, item: r.aprobacion, mensaje: 'Aprobación de la interventoría registrada.' });
  });

  router.put('/:id/encuestas/:idup', async (req, res) => {
    const tipo = String(req.body?.tipo || '');
    const respuestas = limpiarRespuestas(tipo, req.body?.respuestas);
    const modulo = tipo === 'satisfaccion' ? Number(req.body?.modulo) : 0;
    if (tipo === 'satisfaccion' && ![1, 2, 3].includes(modulo)) throw solicitudInvalida('Elige el módulo de la encuesta de satisfacción.');
    const r = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const p = participante(t, req.params.idup);
      const { rows: encuentros } = await db.query('SELECT modulo, tallerista_sub, realizado_en, asistencia FROM talleres_encuentros WHERE taller_id=$1 ORDER BY modulo', [t.id]);
      const m = (n) => encuentros.find((e) => e.modulo === n);
      const de = tipo === 'apropiacion_entrada' ? m(1) : tipo === 'apropiacion_salida' ? m(3) : m(modulo);
      if (esTallerista(req.usuario) && de?.tallerista_sub !== req.usuario.sub && t.entrega_final_sub !== req.usuario.sub) {
        throw prohibido('Esta encuesta la registra el Tallerista del módulo.');
      }
      if (tipo === 'apropiacion_salida' && !m(3)?.realizado_en) throw solicitudInvalida('La encuesta de apropiación de salida se registra al terminar el módulo 3.');
      if (tipo === 'apropiacion_salida' && !(m(3).asistencia || []).includes(`up:${p.id_up}`)) {
        throw solicitudInvalida('La encuesta de apropiación de salida se toma al final del módulo 3: la UP no asistió a ese módulo.');
      }
      if (tipo === 'satisfaccion' && !(de?.realizado_en && (de.asistencia || []).includes(`up:${p.id_up}`))) {
        throw solicitudInvalida(`La encuesta de satisfacción del módulo ${modulo} se registra cuando la UP asistió a ese módulo.`);
      }
      if (tipo !== 'satisfaccion' && !(await autorizacionDatosCargada(db, p.id_up))) {
        throw solicitudInvalida('La unidad no tiene cargada la autorización de tratamiento de datos personales (Visita 1): sin ella no se registra la encuesta.');
      }
      await db.query(`INSERT INTO talleres_encuestas (taller_id,id_up,tipo,modulo,respuestas,registrado_por) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (taller_id,id_up,tipo,modulo) DO UPDATE SET respuestas=EXCLUDED.respuestas, registrado_por=EXCLUDED.registrado_por, actualizado_en=now()`,
      [t.id, p.id_up, tipo, modulo, JSON.stringify(respuestas), req.usuario.nombre || req.usuario.sub]);
      return { taller: t.id, p };
    });
    await registrarAccion(req, 'talleres.encuesta', { tipo: 'taller', id: r.taller }, r.p.id_unico, { tipo, modulo: modulo || null, respuestas });
    res.json({ ok: true, mensaje: 'Encuesta registrada.' });
  });

  router.put('/:id/resultados/:idup', async (req, res) => {
    const hallazgos = txt(req.body?.hallazgos, 4000);
    const recomendaciones = txt(req.body?.recomendaciones, 4000);
    if (!hallazgos || !recomendaciones) throw solicitudInvalida('Escribe los hallazgos y las recomendaciones de la unidad.');
    const r = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      const p = participante(t, req.params.idup);
      if (esTallerista(req.usuario) && t.entrega_final_sub !== req.usuario.sub) throw prohibido('Los hallazgos los registra el Tallerista de la entrega final.');
      const { rows: e } = await db.query('SELECT realizado_en FROM talleres_encuentros WHERE taller_id=$1', [t.id]);
      if (e.length !== 3 || e.some((x) => !x.realizado_en)) throw solicitudInvalida('Los hallazgos y las recomendaciones se registran al terminar los tres módulos.');
      await db.query(`INSERT INTO talleres_resultados_up (taller_id,id_up,hallazgos,recomendaciones,registrado_por) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (taller_id,id_up) DO UPDATE SET hallazgos=EXCLUDED.hallazgos, recomendaciones=EXCLUDED.recomendaciones, registrado_por=EXCLUDED.registrado_por, actualizado_en=now()`,
      [t.id, p.id_up, hallazgos, recomendaciones, req.usuario.nombre || req.usuario.sub]);
      return { taller: t.id, p };
    });
    await registrarAccion(req, 'talleres.resultados', { tipo: 'taller', id: r.taller }, r.p.id_unico, { hallazgos: hallazgos.slice(0, 200) });
    res.json({ ok: true, mensaje: 'Hallazgos y recomendaciones registrados.' });
  });

  router.get('/:id/cumplimiento', async (req, res) => {
    const t = await tallerVisible(req.usuario, req.params.id);
    res.json({ ok: true, items: Object.values(await cumplimientoTaller(pool, t)) });
  });

  router.get('/cumplimiento', async (req, res) => {
    const nodos = await territorio(req.usuario);
    const { rows: talleres } = await query(`SELECT * FROM talleres_fortalecimiento WHERE nodo = ANY($1::text[])
      AND ($2::text IS NULL OR entrega_final_sub = $2 OR EXISTS (SELECT 1 FROM talleres_encuentros e WHERE e.taller_id = talleres_fortalecimiento.id AND e.tallerista_sub = $2))
      ORDER BY region, nombre`, [nodos.map((n) => n.nodo), esTallerista(req.usuario) ? req.usuario.sub : null]);
    const items = [];
    for (const candidato of talleres) {
      const t = await tallerVisible(req.usuario, candidato.id).catch((e) => {
        if (e?.status === 404 || e?.status === 403) return null;
        throw e;
      });
      if (!t) continue;
      const c = await cumplimientoTaller(pool, t);
      for (const p of t.participantes || []) {
        const x = c[p.id_up];
        if (!x) continue;
        items.push({ taller_id: t.id, taller: t.nombre, region: t.region, nodo: t.nodo, id_unico: p.id_unico, nombre: p.nombre, ...x });
      }
    }
    const ids = [...new Set(items.map((i) => i.id_up))];
    const { rows: ubic } = ids.length ? await query(`SELECT up.id_up, nullif(btrim(up.departamento), '') AS departamento,
        upper(btrim(t.nodo)) AS nodo, nullif(btrim(up.municipio), '') AS municipio
      FROM unidades_productivas up JOIN triadas t ON t.id_triada = up.id_triada WHERE up.id_up = ANY($1::int[])`, [ids]) : { rows: [] };
    const ubicacion = new Map(ubic.map(({ id_up: id, ...u }) => [id, u]));
    for (const i of items) i.ubicacion = ubicacion.get(i.id_up) || null;
    const porUP = new Map();
    for (const i of items) porUP.set(i.id_up, Boolean(porUP.get(i.id_up)) || i.cumple_80);
    res.json({ ok: true, items, resumen: { unidades: porUP.size, cumplen: [...porUP.values()].filter(Boolean).length, inscripciones: items.length } });
  });

  router.get('/:id/informe/:idup', async (req, res) => {
    const t = await tallerVisible(req.usuario, req.params.id);
    const p = participante(t, req.params.idup);
    const info = await datosParticipantes(pool, t);
    const [cumple, { rows: encuentros }, { rows: encuestas }, { rows: [resultado] }, { rows: todos }] = await Promise.all([
      cumplimientoTaller(pool, t, info),
      query('SELECT * FROM talleres_encuentros WHERE taller_id=$1 ORDER BY modulo', [t.id]),
      query('SELECT tipo, modulo, respuestas FROM talleres_encuestas WHERE taller_id=$1 AND id_up=$2', [t.id, p.id_up]),
      query('SELECT * FROM talleres_resultados_up WHERE taller_id=$1 AND id_up=$2', [t.id, p.id_up]),
      query('SELECT id, nombre FROM up_asociados WHERE id_up = $1', [p.id_up]),
    ]);
    const nombreAsociado = new Map(todos.map((x) => [x.id, x.nombre]));
    const datos = info[p.id_up];
    const c = cumple[p.id_up];
    const encuesta = (tipo, m = 0) => encuestas.find((x) => x.tipo === tipo && x.modulo === m)?.respuestas;
    const ap = variacionApropiacion(encuesta('apropiacion_entrada'), encuesta('apropiacion_salida'));
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Informe de formación ${p.id_unico}` } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="informe-formacion-${String(p.id_unico).replace(/[^\w-]/g, '_')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    doc.fontSize(15).text('Informe de resultados de la formación', { align: 'left' });
    doc.moveDown(0.3).fontSize(10).fillColor('#555').text(`Fundación Memories · Taller «${t.nombre}» · ${t.region} · ${t.municipio}`);
    doc.fillColor('#000').moveDown();
    doc.fontSize(11).text(`Unidad productiva: ${p.nombre || p.id_unico} (ID ${p.id_unico}) · Modalidad ${datos?.modalidad || '—'}`);
    doc.text(`Cumplimiento: ${c ? `${c.porcentaje} % (${c.cumplidas} de ${c.actividades} actividades) — ${c.cumple_80 ? 'cumple el 80 %' : 'no alcanza el 80 %'}` : '—'}`);
    doc.moveDown().fontSize(12).text('Integrantes');
    doc.fontSize(10);
    if (datos?.integrantes?.length) datos.integrantes.forEach((i) => doc.text(`· ${i.nombre} — C.C. ${i.documento}${i.es_representante ? ' (representante)' : ''}`));
    else if (datos?.modalidad === 'M1') doc.text(`· ${p.representante || 'Representante'} (persona inscrita)`);
    else doc.text('· Sin integrantes registrados (se registran como asociados en la Visita 1).');
    doc.moveDown().fontSize(12).text('Cronograma y asistencia');
    doc.fontSize(10);
    for (const e of encuentros) {
      const m = c?.modulos.find((x) => x.modulo === e.modulo);
      const asistentes = (e.asistencia_integrantes?.[p.id_up] || []).map((id) => nombreAsociado.get(id)).filter(Boolean);
      doc.text(`Módulo ${e.modulo} · ${fechaHora(e.inicio)} · ${e.modalidad === 'VIRTUAL' ? 'virtual' : 'presencial'} · ${e.tallerista_nombre || ''}`);
      doc.text(`   ${!e.realizado_en ? 'Pendiente' : m?.valida ? `Asistió (${m.integrantes} integrante(s)) — cuenta` : m?.asistio ? `Asistió con ${m.integrantes} integrante(s), menos del mínimo de ${m.minimo} — no cuenta` : 'No asistió'}`);
      if (asistentes.length) doc.text(`   Asistentes: ${asistentes.join(', ')}`);
      const sat = promedioSatisfaccion(encuesta('satisfaccion', e.modulo));
      if (sat !== null) doc.text(`   Satisfacción del módulo: ${sat} de 5`);
    }
    doc.moveDown().fontSize(12).text('Apropiación de conocimientos');
    doc.fontSize(10).text(ap.entrada === null && ap.salida === null ? 'Sin encuestas registradas.'
      : `Entrada: ${ap.entrada ?? '—'} · Salida: ${ap.salida ?? '—'} · Variación: ${ap.variacion === null ? '—' : `${ap.variacion > 0 ? '+' : ''}${ap.variacion}`} (escala 1 a 5)`);
    doc.moveDown().fontSize(12).text('Hallazgos');
    doc.fontSize(10).text(resultado?.hallazgos || 'Sin registrar.');
    doc.moveDown().fontSize(12).text('Recomendaciones');
    doc.fontSize(10).text(resultado?.recomendaciones || 'Sin registrar.');
    doc.moveDown().fontSize(8).fillColor('#777').text(`Generado el ${fechaHora(new Date().toISOString())}.`);
    doc.end();
    registrarAccion(req, 'talleres.informe_up', { tipo: 'taller', id: t.id }, p.id_unico, {}).catch(() => {});
  });

  router.post('/:id/convocar', async (req, res) => {
    soloCoordinacion(req.usuario, 'La convocatoria la envía la coordinación.');
    const r = await transaccion(async (db) => {
      const t = await tallerVisible(req.usuario, req.params.id, db, true);
      return { taller: t.id, correos: await convocar(db, t) };
    });
    await registrarAccion(req, 'talleres.convocatoria', { tipo: 'taller', id: r.taller }, null, { correos: r.correos });
    res.json({ ok: true, correos: r.correos, mensaje: r.correos ? `Convocatoria en la bandeja de salida: ${r.correos} correo(s).` : 'Ninguna unidad del grupo tiene correo registrado.' });
  });

  router.put('/contenidos/:cid/aprobacion', cargar(upload.single('archivo')), async (req, res) => {
    if (!esGeneral(req.usuario)) throw prohibido('La aprobación del Comité Técnico la registra el Coordinador general o el Profesional de seguimiento.');
    if (!idValido(req.params.cid)) throw noEncontrado('El contenido no existe.');
    const fecha = String(req.body?.fecha || '').slice(0, 10);
    if (!fechaReal(fecha) || fecha > hoyColombia()) throw solicitudInvalida('La fecha del Comité no es válida (no puede ser futura).');
    const version = String(req.body?.version || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(version) || Number.isNaN(Date.parse(version))) {
      throw solicitudInvalida('Falta la versión del contenido revisado: recarga la página.');
    }
    if (!req.file) throw solicitudInvalida('Adjunta el acta del Comité Técnico en PDF.');
    archivoValido(req.file, true);
    const aprobacion = { fecha, observacion: txt(req.body?.observacion, 1000) || null, version, registrada_por: req.usuario.nombre || req.usuario.sub, registrada_en: new Date().toISOString() };
    const { rows: [c] } = await query(`UPDATE talleres_contenidos SET aprobado = TRUE, aprobacion = $2, acta_comite = $3, acta_comite_nombre = $4
      WHERE id = $1 AND date_trunc('milliseconds', actualizado_en) = $5::timestamptz RETURNING id, region, modulo`,
    [req.params.cid, JSON.stringify(aprobacion), req.file.buffer, nombreArchivo(req.file), version]);
    if (!c) {
      const { rowCount } = await query('SELECT 1 FROM talleres_contenidos WHERE id = $1', [req.params.cid]);
      if (rowCount) throw new HttpError(409, 'El contenido cambió desde que lo abriste: revísalo de nuevo antes de registrar la aprobación.');
      throw noEncontrado('El contenido no existe.');
    }
    await registrarAccion(req, 'talleres.contenido_aprobado', { tipo: 'contenido', id: c.id }, null, { region: c.region, modulo: c.modulo, fecha });
    res.json({ ok: true, mensaje: 'Contenido aprobado por el Comité Técnico: ya lo ven los Talleristas.' });
  });

  router.get('/contenidos/:cid/acta', async (req, res) => {
    if (!idValido(req.params.cid)) throw noEncontrado('El contenido no existe.');
    if (esTallerista(req.usuario)) throw prohibido('El acta del Comité la consulta la coordinación.');
    const { rows: [c] } = await query('SELECT region, acta_comite, acta_comite_nombre FROM talleres_contenidos WHERE id=$1', [req.params.cid]);
    if (!c?.acta_comite || !(await territorio(req.usuario)).some((n) => n.region.toLowerCase() === String(c.region).toLowerCase())) throw noEncontrado('El acta no existe.');
    res.attachment(c.acta_comite_nombre).type('application/pdf').send(c.acta_comite);
  });
}

// Devuelve los datos de formación que acompañan a cada taller en el listado.
export async function formacionDeTaller(db, t) {
  const info = await datosParticipantes(db, t);
  const [cumple, { rows: encuestas }, { rows: resultados }, convocatoria] = await Promise.all([
    cumplimientoTaller(db, t, info),
    db.query('SELECT id_up, tipo, modulo, respuestas FROM talleres_encuestas WHERE taller_id = $1', [t.id]),
    db.query('SELECT id_up, hallazgos, recomendaciones FROM talleres_resultados_up WHERE taller_id = $1', [t.id]),
    estadoCorreos(db, 'taller_convocatoria', t.id),
  ]);
  return {
    participantes_info: info, cumplimiento: cumple, encuestas, resultados, convocatoria,
    preguntas: { apropiacion: PREGUNTAS_APROPIACION, satisfaccion: PREGUNTAS_SATISFACCION },
  };
}

export { bloquesSesion };
