// Eventos y avisos. La coordinación crea, edita y elimina; las cuentas de campo solo ven lo que se les envió a
// su nodo y solo escriben su respuesta en una fila propia. Los avisos usan las tablas novedades y
// novedad_destinatarios.
import { query, transaccion } from '../db.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, fecha, fechaHora, esGestor, normNodo } from '../util.js';
import { nodosEnAlcance } from '../alcance.js';
import { esSoloLectura, MENSAJE_SOLO_LECTURA } from '../auth.js';
import { ROLES } from '../config.js';
import { registrar, diferenciasCortas, corto } from './actividad.js';

// Campos de un evento y de un aviso que se comparan en la actividad, antes y después.
const CAMPOS_EVENTO = ['titulo', 'tipo', 'tipo_label', 'fecha', 'hora', 'modalidad', 'lugar', 'descripcion', 'destinatarios'];
const CAMPOS_AVISO = ['titulo', 'categoria', 'categoria_label', 'cuerpo', 'fecha', 'editada', 'destinatarios'];

const exigirEventos = (u) => {
  if (u?.rol === ROLES.COMPRAS) throw prohibido('Tu rol no tiene acceso a Eventos.');
};
const exigirAvisos = (u) => {
  if (u?.rol === ROLES.COMPRAS) throw prohibido('Tu rol no tiene acceso a Novedades.');
};

const exigirCoordinacion = (u) => {
  exigirEventos(u);
  if (u?.rol === ROLES.TALLERISTA) throw prohibido('El Tallerista consulta los eventos de su región.');
  if (esGestor(u)) throw prohibido('Solo coordinación puede crear, editar o eliminar.');
  if (esSoloLectura(u)) throw prohibido(MENSAJE_SOLO_LECTURA);
};

// Devuelve el nodo sobre el que escribe el usuario: el suyo, o uno de los de su alcance.
async function nodoEscritura(usuario, nodoPedido) {
  if (esGestor(usuario)) return normNodo(usuario.nodo);
  const n = normNodo(nodoPedido);
  if (!n) throw solicitudInvalida('Falta el nodo.');
  const permitidos = await nodosEnAlcance(usuario);
  if (permitidos && !permitidos.includes(n)) throw prohibido('Ese nodo está fuera de tu alcance.');
  return n;
}

// Devuelve los nodos que el usuario puede ver y escribir; null significa todos.
async function nodosPermitidos(usuario) {
  if (esGestor(usuario)) return [normNodo(usuario.nodo)];
  return nodosEnAlcance(usuario);
}

// Comprueba que los nodos elegidos estén en el alcance del usuario; todos significa todos los suyos.
function dentroDelAlcance(permitidos, nodos) {
  if (!permitidos) return nodos;
  const propios = nodos.filter((n) => permitidos.includes(n));
  if (!propios.length) throw prohibido('Ninguno de los destinatarios está en tu alcance.');
  return propios;
}

// Impide tocar lo que también va a nodos fuera del alcance del usuario.
function exigirSoloPermitidos(permitidos, destinatarios) {
  if (permitidos && destinatarios.some((n) => !permitidos.includes(normNodo(n)))) {
    throw prohibido('Esto incluye nodos fuera de tu alcance.');
  }
}

const listaNodos = (v) => [...new Set((Array.isArray(v) ? v : []).map(normNodo).filter(Boolean))];

// Arma el documento del evento con las respuestas de cada nodo destinatario.
function eventoADoc(e, dest) {
  const respuestas = {};
  for (const d of dest) {
    respuestas[d.nodo] = {
      valor: d.valor, comentario: d.comentario || '', foto: d.foto || '',
      ...(d.fecha_respuesta ? { fecha_respuesta: d.fecha_respuesta } : {}),
    };
  }
  return {
    id: e.id, titulo: e.titulo, tipo: e.tipo, tipo_label: e.tipo_label,
    fecha: e.fecha, hora: e.hora, modalidad: e.modalidad, lugar: e.lugar, descripcion: e.descripcion,
    respuestas,
    destinatarios: dest.map((d) => d.nodo),
    convocado_por: { usuario: e.convocado_usuario, nodo: e.convocado_nodo },
    recordado: e.recordado,
    creado_en: e.creado_en,
    fecha_actualizacion: e.fecha_actualizacion,
  };
}

async function cargarEventos(ids) {
  if (!ids.length) return [];
  const ev = await query('SELECT * FROM eventos WHERE id = ANY($1) ORDER BY fecha DESC, creado_en DESC', [ids]);
  const de = await query('SELECT * FROM evento_destinatarios WHERE id_evento = ANY($1) ORDER BY nodo', [ids]);
  const porEvento = {};
  for (const d of de.rows) (porEvento[d.id_evento] = porEvento[d.id_evento] || []).push(d);
  return ev.rows.map((e) => eventoADoc(e, porEvento[e.id] || []));
}

export async function listarEventos(usuario) {
  exigirEventos(usuario);
  const permitidos = await nodosPermitidos(usuario);
  const { rows } = permitidos
    ? await query(
      'SELECT DISTINCT id_evento AS id FROM evento_destinatarios WHERE upper(nodo) = ANY($1)',
      [permitidos])
    : await query('SELECT id FROM eventos');
  let items = await cargarEventos(rows.map((r) => r.id));
  if (permitidos) {
    items = items.map((e) => ({
      ...e,
      respuestas: Object.fromEntries(Object.entries(e.respuestas).filter(([n]) => permitidos.includes(normNodo(n)))),
      ...(esGestor(usuario) ? {} : { destinatarios: e.destinatarios.filter((n) => permitidos.includes(normNodo(n))) }),
    }));
  }
  return { ok: true, items };
}

export async function guardarEvento(usuario, doc = {}) {
  exigirCoordinacion(usuario);
  const id = txt(doc.id);
  const titulo = txt(doc.titulo);
  if (!id || !titulo) throw solicitudInvalida('El evento necesita id y título.');
  const respuestas = doc.respuestas && typeof doc.respuestas === 'object' ? doc.respuestas : {};
  const conv = doc.convocado_por || {};

  const permitidos = await nodosPermitidos(usuario);
  const nodos = dentroDelAlcance(permitidos, listaNodos([...(doc.destinatarios || []), ...Object.keys(respuestas)]));
  if (permitidos) {
    const previos = await query('SELECT nodo FROM evento_destinatarios WHERE id_evento = $1', [id]);
    exigirSoloPermitidos(permitidos, previos.rows.map((r) => r.nodo));
  }
  const [antes] = await cargarEventos([id]);

  await transaccion(async (db) => {
    await db.query(
      `INSERT INTO eventos (id, titulo, tipo, tipo_label, fecha, hora, modalidad, lugar, descripcion,
                            convocado_usuario, convocado_nodo, recordado, creado_en, fecha_actualizacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::timestamptz, now()), now())
       ON CONFLICT (id) DO UPDATE SET
         titulo = EXCLUDED.titulo, tipo = EXCLUDED.tipo, tipo_label = EXCLUDED.tipo_label,
         fecha = EXCLUDED.fecha, hora = EXCLUDED.hora, modalidad = EXCLUDED.modalidad,
         lugar = EXCLUDED.lugar, descripcion = EXCLUDED.descripcion,
         recordado = EXCLUDED.recordado, fecha_actualizacion = now()`,
      [id, titulo, txt(doc.tipo), txt(doc.tipo_label), fecha(doc.fecha), txt(doc.hora),
        txt(doc.modalidad), txt(doc.lugar), txt(doc.descripcion),
        txt(conv.usuario) || usuario.nombre || null, txt(conv.nodo),
        fechaHora(doc.recordado), fechaHora(doc.creado_en)],
    );
    await db.query(
      'DELETE FROM evento_destinatarios WHERE id_evento = $1 AND NOT (upper(nodo) = ANY($2))',
      [id, nodos],
    );
    for (const n of nodos) {
      const r = Object.entries(respuestas).find(([k]) => normNodo(k) === n)?.[1] || {};
      await db.query(
        `INSERT INTO evento_destinatarios (id_evento, nodo, valor, comentario, foto, fecha_respuesta)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_evento, nodo) DO NOTHING`,
        [id, n, txt(r.valor), txt(r.comentario), txt(r.foto), fechaHora(r.fecha_respuesta)],
      );
    }
  });

  const [item] = await cargarEventos([id]);
  await registrar(usuario, {
    accion: 'eventos.guardar', objeto: { tipo: 'evento', id },
    cambios: { nuevo: !antes, campos: diferenciasCortas(antes || {}, item, CAMPOS_EVENTO) },
  });
  return { ok: true, item };
}

export async function eliminarEvento(usuario, { id }) {
  exigirCoordinacion(usuario);
  if (!id) throw solicitudInvalida('Falta el parámetro id.');
  const permitidos = await nodosPermitidos(usuario);
  if (permitidos) {
    const previos = await query('SELECT nodo FROM evento_destinatarios WHERE id_evento = $1', [String(id)]);
    exigirSoloPermitidos(permitidos, previos.rows.map((r) => r.nodo));
  }
  const r = await query('DELETE FROM eventos WHERE id = $1 RETURNING titulo, fecha', [String(id)]);
  if (!r.rowCount) throw noEncontrado('Evento no encontrado.');
  await registrar(usuario, {
    accion: 'eventos.eliminar', objeto: { tipo: 'evento', id: String(id) },
    cambios: { titulo: corto(r.rows[0].titulo), fecha: r.rows[0].fecha },
  });
  return { ok: true };
}

// Guarda la respuesta de una cuenta de campo a un evento enviado a su nodo.
export async function responderEvento(usuario, { id, nodo, respuesta } = {}) {
  exigirEventos(usuario);
  if (usuario?.rol === ROLES.TALLERISTA) throw prohibido('El Tallerista no responde por los gestores.');
  if (esSoloLectura(usuario)) throw prohibido(MENSAJE_SOLO_LECTURA);
  if (!id) throw solicitudInvalida('Falta el id del evento.');
  const n = await nodoEscritura(usuario, nodo);
  const r = respuesta || {};
  const valor = txt(r.valor);
  if (valor && !['si', 'porconfirmar', 'no'].includes(valor)) throw solicitudInvalida('Respuesta no válida.');
  const res = await query(
    `WITH previo AS (
        SELECT id_evento, nodo, valor, comentario FROM evento_destinatarios WHERE id_evento = $1 AND upper(nodo) = $2
     )
     UPDATE evento_destinatarios d
        SET valor = $3, comentario = $4, foto = $5, fecha_respuesta = coalesce($6::timestamptz, now())
       FROM previo p
      WHERE d.id_evento = p.id_evento AND d.nodo = p.nodo
      RETURNING p.valor AS valor_antes, p.comentario AS comentario_antes, d.valor, d.comentario`,
    [String(id), n, valor, txt(r.comentario), txt(r.foto), fechaHora(r.fecha_respuesta)],
  );
  if (!res.rowCount) throw noEncontrado('Ese nodo no está invitado al evento.');
  await query('UPDATE eventos SET fecha_actualizacion = now() WHERE id = $1', [String(id)]);
  const f = res.rows[0];
  await registrar(usuario, {
    accion: 'eventos.responder', objeto: { tipo: 'evento', id: String(id) },
    cambios: { nodo: n, campos: diferenciasCortas({ valor: f.valor_antes, comentario: f.comentario_antes }, f, ['valor', 'comentario']) },
  });
  return { ok: true };
}

// Arma el documento del aviso con la fecha de lectura de cada nodo destinatario.
function avisoADoc(n, dest, usuario) {
  const lecturas = {};
  for (const d of dest) if (d.fecha_lectura) lecturas[d.nodo] = { fecha_lectura: d.fecha_lectura };
  return {
    id: n.id, titulo: n.titulo, categoria: n.categoria, categoria_label: n.categoria_label,
    cuerpo: n.cuerpo, fecha: n.fecha,
    destinatarios: dest.map((d) => d.nodo),
    lecturas,
    editada: n.editada,
    publicado_por: { usuario: n.publicado_usuario, nodo: n.publicado_nodo },
    recordado: n.recordado,
    creado_en: n.creado_en,
    fecha_actualizacion: n.fecha_actualizacion,
    editable: usuario?.rol !== ROLES.TALLERISTA && !esGestor(usuario) && (!esSoloLectura(usuario) || n.creado_por === usuario.sub),
  };
}

async function cargarAvisos(ids, usuario) {
  if (!ids.length) return [];
  const nv = await query('SELECT * FROM novedades WHERE id = ANY($1) ORDER BY fecha DESC, creado_en DESC', [ids]);
  const de = await query('SELECT * FROM novedad_destinatarios WHERE id_novedad = ANY($1) ORDER BY nodo', [ids]);
  const porNov = {};
  for (const d of de.rows) (porNov[d.id_novedad] = porNov[d.id_novedad] || []).push(d);
  return nv.rows.map((n) => avisoADoc(n, porNov[n.id] || [], usuario));
}

export async function listarAvisos(usuario) {
  exigirAvisos(usuario);
  const permitidos = await nodosPermitidos(usuario);
  const { rows } = permitidos
    ? await query(
      'SELECT DISTINCT id_novedad AS id FROM novedad_destinatarios WHERE upper(nodo) = ANY($1)',
      [permitidos])
    : await query('SELECT id FROM novedades');
  let items = await cargarAvisos(rows.map((r) => r.id), usuario);
  if (permitidos && !esGestor(usuario)) {
    items = items.map((n) => ({
      ...n,
      destinatarios: n.destinatarios.filter((d) => permitidos.includes(normNodo(d))),
      lecturas: Object.fromEntries(Object.entries(n.lecturas).filter(([d]) => permitidos.includes(normNodo(d)))),
    }));
  }
  return { ok: true, items };
}

// Impide publicar avisos a quien no tiene permiso para hacerlo.
const exigirPublicacion = (u) => {
  exigirAvisos(u);
  if (u?.rol === ROLES.TALLERISTA) throw prohibido('El Tallerista consulta los avisos de su región.');
  if (esGestor(u)) throw prohibido('Solo coordinación puede crear, editar o eliminar.');
};

async function exigirPropioSiEsTecnico(usuario, id, verbo) {
  if (!esSoloLectura(usuario)) return;
  const { rows } = await query('SELECT creado_por FROM novedades WHERE id = $1', [String(id)]);
  if (rows.length && rows[0].creado_por !== usuario.sub) {
    throw prohibido(`Solo puedes ${verbo} los avisos que publicaste tú.`);
  }
}

export async function guardarAviso(usuario, doc = {}) {
  exigirPublicacion(usuario);
  const id = txt(doc.id);
  const titulo = txt(doc.titulo);
  if (!id || !titulo) throw solicitudInvalida('La novedad necesita id y título.');
  const pub = doc.publicado_por || {};

  await exigirPropioSiEsTecnico(usuario, id, 'editar');
  const permitidos = await nodosPermitidos(usuario);
  const nodos = dentroDelAlcance(permitidos, listaNodos(doc.destinatarios));
  if (permitidos) {
    const previos = await query('SELECT nodo FROM novedad_destinatarios WHERE id_novedad = $1', [id]);
    exigirSoloPermitidos(permitidos, previos.rows.map((r) => r.nodo));
  }
  const [antes] = await cargarAvisos([id], usuario);

  await transaccion(async (db) => {
    await db.query(
      `INSERT INTO novedades (id, titulo, categoria, categoria_label, cuerpo, fecha, editada,
                              publicado_usuario, publicado_nodo, recordado, creado_en, fecha_actualizacion, creado_por)
       VALUES ($1,$2,$3,$4,$5,coalesce($6::date, (now() AT TIME ZONE 'America/Bogota')::date),$7,$8,$9,$10, coalesce($11::timestamptz, now()), now(), $12)
       ON CONFLICT (id) DO UPDATE SET
         titulo = EXCLUDED.titulo, categoria = EXCLUDED.categoria,
         categoria_label = EXCLUDED.categoria_label, cuerpo = EXCLUDED.cuerpo,
         fecha = EXCLUDED.fecha, editada = EXCLUDED.editada,
         recordado = EXCLUDED.recordado, fecha_actualizacion = now()`,
      [id, titulo, txt(doc.categoria), txt(doc.categoria_label), txt(doc.cuerpo),
        fecha(doc.fecha), !!doc.editada, txt(pub.usuario) || usuario.nombre || null, txt(pub.nodo),
        fechaHora(doc.recordado), fechaHora(doc.creado_en), usuario.sub || null],
    );
    await db.query(
      'DELETE FROM novedad_destinatarios WHERE id_novedad = $1 AND NOT (upper(nodo) = ANY($2))',
      [id, nodos],
    );
    for (const n of nodos) {
      await db.query(
        `INSERT INTO novedad_destinatarios (id_novedad, nodo) VALUES ($1, $2)
         ON CONFLICT (id_novedad, nodo) DO NOTHING`,
        [id, n],
      );
    }
  });

  const [item] = await cargarAvisos([id], usuario);
  await registrar(usuario, {
    accion: 'avisos.guardar', objeto: { tipo: 'aviso', id },
    cambios: { nuevo: !antes, campos: diferenciasCortas(antes || {}, item, CAMPOS_AVISO) },
  });
  return { ok: true, item };
}

export async function eliminarAviso(usuario, { id }) {
  exigirPublicacion(usuario);
  if (!id) throw solicitudInvalida('Falta el parámetro id.');
  await exigirPropioSiEsTecnico(usuario, id, 'eliminar');
  const permitidos = await nodosPermitidos(usuario);
  if (permitidos) {
    const previos = await query('SELECT nodo FROM novedad_destinatarios WHERE id_novedad = $1', [String(id)]);
    exigirSoloPermitidos(permitidos, previos.rows.map((r) => r.nodo));
  }
  const r = await query('DELETE FROM novedades WHERE id = $1 RETURNING titulo, fecha', [String(id)]);
  if (!r.rowCount) throw noEncontrado('Novedad no encontrada.');
  await registrar(usuario, {
    accion: 'avisos.eliminar', objeto: { tipo: 'aviso', id: String(id) },
    cambios: { titulo: corto(r.rows[0].titulo), fecha: r.rows[0].fecha },
  });
  return { ok: true };
}

// Marca un aviso como leído por el usuario.
export async function marcarAvisoLeido(usuario, { id, nodo, lectura } = {}) {
  exigirAvisos(usuario);
  if (usuario?.rol === ROLES.TALLERISTA) throw prohibido('El Tallerista no marca lecturas por otros usuarios.');
  if (esSoloLectura(usuario)) throw prohibido(MENSAJE_SOLO_LECTURA);
  if (!id) throw solicitudInvalida('Falta el id de la novedad.');
  const n = await nodoEscritura(usuario, nodo);
  const res = await query(
    `WITH previo AS (
        SELECT id_novedad, nodo, fecha_lectura FROM novedad_destinatarios WHERE id_novedad = $1 AND upper(nodo) = $2
     )
     UPDATE novedad_destinatarios d
        SET fecha_lectura = coalesce(d.fecha_lectura, $3::timestamptz, now())
       FROM previo p
      WHERE d.id_novedad = p.id_novedad AND d.nodo = p.nodo
      RETURNING p.fecha_lectura AS antes, d.fecha_lectura AS despues`,
    [String(id), n, fechaHora(lectura?.fecha_lectura)],
  );
  if (!res.rowCount) throw noEncontrado('Esa novedad no fue enviada a tu nodo.');
  const f = res.rows[0];
  if (!f.antes) {
    await registrar(usuario, {
      accion: 'avisos.leer', objeto: { tipo: 'aviso', id: String(id) },
      cambios: { nodo: n, campos: { fecha_lectura: [null, f.despues] } },
    });
  }
  return { ok: true };
}
