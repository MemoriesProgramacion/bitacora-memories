// Agenda de citas: llamadas, visitas y reuniones con las unidades productivas. Cada cita guarda su hora, con
// quién y a qué número se llama, y si se realizó, no contestaron o se canceló. Los permisos se resuelven en el
// servidor según el nodo y el alcance de la cuenta.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, entero, fechaHora, normNodo } from '../util.js';
import { condicionAlcanceFila, exigirAlcance, exigirAlcanceDeUP } from '../alcance.js';
import { buscarUP, exigirEnPrograma } from './unidades.js';
import { registrar, diferenciasCortas, diferenciasSinDatos } from './actividad.js';

// Campos de la cita que se comparan en la actividad, antes y después.
const CAMPOS_CITA = ['tipo', 'motivo', 'inicio', 'duracion_min', 'telefono', 'contacto', 'estado', 'notas'];
// Campos de los que solo se registra que cambiaron, como el número al que se llama y la persona de contacto.
const SENSIBLES_CITA = ['telefono', 'contacto'];
// Convierte las fechas a formato ISO para compararlas.
const paraComparar = (c) => c && { ...c, inicio: iso(c.inicio) };

export const TIPOS = ['llamada', 'visita', 'reunion'];
export const ESTADOS = ['agendada', 'realizada', 'no_contesto', 'cancelada'];

// Tope de citas por respuesta, suficiente para un año de trabajo de un nodo.
const LIMITE = 5000;

function exigirAcceso(usuario) {
  if (![ROLES.COORDINADOR, ROLES.TECNICO, ROLES.GESTOR].includes(usuario.rol)) {
    throw prohibido('La agenda es para los gestores y la coordinación.');
  }
}

// Consulta de una cita lista para mostrar, con los datos de la iniciativa y su representante.
const SELECCION = `
  SELECT c.id, c.id_unico, c.nodo, c.tipo, c.motivo, c.inicio, c.duracion_min, c.telefono, c.contacto,
         c.estado, c.notas, c.historial, c.creado_por, c.creado_en,
         up.nombre AS up_nombre, up.municipio, up.departamento,
         r.nombre_completo AS representante, r.telefono1, r.telefono2
    FROM agenda_citas c
    JOIN unidades_productivas up ON up.id_up = c.id_up
    LEFT JOIN representantes r ON r.id_representante = up.id_representante`;

async function cargarCita(id) {
  const { rows } = await query(`${SELECCION} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

// Devuelve la cita guardada o un error 404; no la toca si está fuera del alcance del usuario.
async function citaPropia(usuario, idCrudo) {
  const id = entero(idCrudo);
  if (!id) throw solicitudInvalida('Falta la cita.');
  const { rows } = await query('SELECT * FROM agenda_citas WHERE id = $1', [id]);
  if (!rows.length) throw noEncontrado('La cita no existe.');
  await exigirAlcanceDeUP(usuario, rows[0].id_up, rows[0].nodo);
  return rows[0];
}

const iso = (f) => (f ? new Date(f).toISOString() : null);

// Lista las citas de un rango de fechas según el alcance de la cuenta.
export async function listarCitas(usuario, { desde, hasta, nodo, estado } = {}) {
  exigirAcceso(usuario);
  const est = txt(estado);
  if (est && !ESTADOS.includes(est)) throw solicitudInvalida('Estado de cita inválido.');
  const params = [txt(nodo) ? normNodo(nodo) : null, fechaHora(desde), fechaHora(hasta), est];
  const alcance = condicionAlcanceFila(usuario, { idUp: 'c.id_up', nodo: 'c.nodo' }, params);
  const { rows } = await query(
    `${SELECCION}
      WHERE (${alcance})
        AND ($1::text IS NULL OR upper(c.nodo) = $1)
        AND ($2::timestamptz IS NULL OR c.inicio >= $2)
        AND ($3::timestamptz IS NULL OR c.inicio < $3)
        AND ($4::text IS NULL OR c.estado = $4)
      ORDER BY c.inicio
      LIMIT ${LIMITE}`,
    params,
  );
  return { ok: true, items: rows };
}

// Crea una cita o, si trae id, la modifica; anota el cambio de hora en el historial y avisa cuántas citas del
// mismo nodo se cruzan.
export async function guardarCita(usuario, datos = {}) {
  exigirAcceso(usuario);
  const previa = datos.id ? await citaPropia(usuario, datos.id) : null;

  const up = await buscarUP({ idUnico: txt(datos.id_unico) || previa?.id_unico });
  if (!up) throw solicitudInvalida('Elige la iniciativa de la cita.');
  exigirAlcance(usuario, up);
  exigirEnPrograma(up, 'agendan citas');

  const dato = (campo, largo) => {
    if (datos[campo] === undefined) return previa ? previa[campo] : null;
    const v = txt(datos[campo]);
    return v ? v.slice(0, largo) : null;
  };

  const tipo = txt(datos.tipo) || previa?.tipo || 'llamada';
  const estado = txt(datos.estado) || previa?.estado || 'agendada';
  if (!TIPOS.includes(tipo)) throw solicitudInvalida('El tipo de cita no es válido.');
  if (!ESTADOS.includes(estado)) throw solicitudInvalida('El estado de la cita no es válido.');

  const inicio = fechaHora(datos.inicio) || iso(previa?.inicio);
  if (!inicio) throw solicitudInvalida('Falta la fecha y la hora de la cita.');
  const duracion = datos.duracion_min === undefined
    ? (previa?.duracion_min ?? 30)
    : entero(datos.duracion_min);
  if (!duracion || duracion < 5 || duracion > 480) {
    throw solicitudInvalida('La duración debe estar entre 5 minutos y 8 horas.');
  }

  const nodo = normNodo(up.nodo) || null;
  const campos = {
    motivo: dato('motivo', 200),
    telefono: dato('telefono', 30),
    contacto: dato('contacto', 200),
    notas: dato('notas', 2000),
  };

  const id = await transaccion(async (db) => {
    if (!previa) {
      const r = await db.query(
        `INSERT INTO agenda_citas (id_up, id_unico, nodo, tipo, motivo, inicio, duracion_min,
                                   telefono, contacto, estado, notas, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [up.id_up, up.id_unico, nodo, tipo, campos.motivo, inicio, duracion,
          campos.telefono, campos.contacto, estado, campos.notas, usuario.nombre],
      );
      return r.rows[0].id;
    }
    const historial = Array.isArray(previa.historial) ? [...previa.historial] : [];
    if (new Date(inicio).getTime() !== new Date(previa.inicio).getTime()) {
      historial.push({ de: iso(previa.inicio), a: inicio, por: usuario.nombre, cuando: new Date().toISOString() });
    }
    await db.query(
      `UPDATE agenda_citas
          SET tipo = $2, motivo = $3, inicio = $4, duracion_min = $5, telefono = $6, contacto = $7,
              estado = $8, notas = $9, historial = $10::jsonb, actualizado_en = now()
        WHERE id = $1`,
      [previa.id, tipo, campos.motivo, inicio, duracion, campos.telefono, campos.contacto,
        estado, campos.notas, JSON.stringify(historial)],
    );
    return previa.id;
  });

  let choques = 0;
  if (estado === 'agendada' && nodo) {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM agenda_citas c
        WHERE upper(c.nodo) = $1 AND c.estado = 'agendada' AND c.id <> $2
          AND c.inicio < $3::timestamptz + make_interval(mins => $4)
          AND c.inicio + make_interval(mins => c.duracion_min) > $3::timestamptz`,
      [nodo, id, inicio, duracion],
    );
    choques = rows[0].n;
  }

  const item = await cargarCita(id);
  await registrar(usuario, {
    accion: 'agenda.guardar', objeto: { tipo: 'cita', id }, idUnico: up.id_unico,
    cambios: { nuevo: !previa, campos: diferenciasSinDatos(paraComparar(previa) || {}, paraComparar(item), CAMPOS_CITA, SENSIBLES_CITA) },
  });
  return { ok: true, item, choques };
}

// Marca el resultado de una cita (realizada, no contestó, cancelada) o la reagenda a otra hora, dejándola de
// nuevo como agendada.
export async function cambiarEstadoCita(usuario, { id, estado, notas, inicio } = {}) {
  exigirAcceso(usuario);
  const previa = await citaPropia(usuario, id);

  const nuevoEstado = txt(estado);
  if (nuevoEstado && !ESTADOS.includes(nuevoEstado)) throw solicitudInvalida('El estado de la cita no es válido.');

  let horaFinal = iso(previa.inicio);
  const historial = Array.isArray(previa.historial) ? [...previa.historial] : [];
  if (txt(inicio)) {
    const nueva = fechaHora(inicio);
    if (!nueva) throw solicitudInvalida('La nueva fecha y hora no son válidas.');
    if (new Date(nueva).getTime() !== new Date(previa.inicio).getTime()) {
      historial.push({ de: horaFinal, a: nueva, por: usuario.nombre, cuando: new Date().toISOString() });
      horaFinal = nueva;
    }
  }

  const estadoFinal = nuevoEstado || (horaFinal !== iso(previa.inicio) ? 'agendada' : previa.estado);
  const notasFinal = notas === undefined ? previa.notas : (txt(notas) || '').slice(0, 2000) || null;

  await query(
    `UPDATE agenda_citas
        SET estado = $2, inicio = $3, notas = $4, historial = $5::jsonb, actualizado_en = now()
      WHERE id = $1`,
    [previa.id, estadoFinal, horaFinal, notasFinal, JSON.stringify(historial)],
  );
  const item = await cargarCita(previa.id);
  await registrar(usuario, {
    accion: 'agenda.estado', objeto: { tipo: 'cita', id: previa.id }, idUnico: previa.id_unico,
    cambios: { campos: diferenciasCortas(paraComparar(previa), paraComparar(item), ['estado', 'inicio', 'notas']) },
  });
  return { ok: true, item };
}

export async function eliminarCita(usuario, { id } = {}) {
  exigirAcceso(usuario);
  const previa = await citaPropia(usuario, id);
  await query('DELETE FROM agenda_citas WHERE id = $1', [previa.id]);
  await registrar(usuario, {
    accion: 'agenda.eliminar', objeto: { tipo: 'cita', id: previa.id }, idUnico: previa.id_unico,
    cambios: { tipo: previa.tipo, estado: previa.estado, inicio: iso(previa.inicio) },
  });
  return { ok: true };
}

// Lista las personas de la iniciativa a las que se puede llamar: el representante con sus dos teléfonos y los
// integrantes con celular.
export async function contactosIniciativa(usuario, { id_unico: idUnico } = {}) {
  exigirAcceso(usuario);
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Iniciativa no encontrada.');
  exigirAlcance(usuario, up);

  const rep = await query(
    `SELECT r.nombre_completo, r.telefono1, r.telefono2
       FROM unidades_productivas up
       LEFT JOIN representantes r ON r.id_representante = up.id_representante
      WHERE up.id_up = $1`,
    [up.id_up],
  );
  const integrantes = await query(
    `SELECT nombre_completo, celular FROM ciudadanos
      WHERE id_up = $1 AND celular IS NOT NULL AND btrim(celular) <> ''
      ORDER BY nombre_completo`,
    [up.id_up],
  );

  const contactos = [];
  const visto = new Set();
  const agregar = (nombre, rol, telefono) => {
    const t = txt(telefono);
    if (!t || visto.has(`${nombre}|${t}`)) return;
    visto.add(`${nombre}|${t}`);
    contactos.push({ nombre: nombre || 'Sin nombre', rol, telefono: t });
  };
  const r = rep.rows[0] || {};
  agregar(r.nombre_completo, 'Representante', r.telefono1);
  agregar(r.nombre_completo, 'Representante (2.º número)', r.telefono2);
  for (const i of integrantes.rows) agregar(i.nombre_completo, 'Integrante', i.celular);

  return { ok: true, contactos };
}
