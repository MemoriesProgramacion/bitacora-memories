// Formación de la unidad productiva para su ficha: los talleres en que participa con su asistencia por módulo,
// las encuestas, los hallazgos y el cumplimiento del 80 %. Se alimenta de lo registrado en Talleres y no del
// cargue de Excel.
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { buscarUP } from './unidades.js';
import { cumplimientoTaller, promedioSatisfaccion, variacionApropiacion } from './talleresFormacion.js';

function exigirLectura(usuario) {
  if (esGestor(usuario) || [ROLES.COORDINADOR, ROLES.TECNICO].includes(usuario?.rol)) return;
  throw prohibido('Tu rol no consulta la formación de la unidad productiva.');
}

// Devuelve la formación de la unidad por taller, con su cumplimiento, encuestas y resultado, y el mejor
// cumplimiento.
export async function formacionDeUP(db, idUp) {
  const { rows: talleres } = await db.query(
    `SELECT * FROM talleres_fortalecimiento WHERE participantes @> $1::jsonb ORDER BY creado_en`,
    [JSON.stringify([{ id_up: idUp }])],
  );
  const items = [];
  for (const t of talleres) {
    const c = (await cumplimientoTaller(db, t))[idUp];
    const [{ rows: encuentros }, { rows: encuestas }, { rows: [resultado] }] = await Promise.all([
      db.query('SELECT modulo, inicio, modalidad, tallerista_nombre, realizado_en FROM talleres_encuentros WHERE taller_id = $1 ORDER BY modulo', [t.id]),
      db.query('SELECT tipo, modulo, respuestas FROM talleres_encuestas WHERE taller_id = $1 AND id_up = $2', [t.id, idUp]),
      db.query('SELECT hallazgos, recomendaciones FROM talleres_resultados_up WHERE taller_id = $1 AND id_up = $2', [t.id, idUp]),
    ]);
    const enc = (tipo, m = 0) => encuestas.find((x) => x.tipo === tipo && x.modulo === m)?.respuestas;
    items.push({
      taller_id: t.id, taller: t.nombre, region: t.region, municipio: t.municipio, lugar: t.lugar,
      encuentros: encuentros.map((e) => ({ ...e, ...(c?.modulos.find((m) => m.modulo === e.modulo) || {}),
        satisfaccion: promedioSatisfaccion(enc('satisfaccion', e.modulo)) })),
      cumplimiento: c ? { cumplidas: c.cumplidas, actividades: c.actividades, porcentaje: c.porcentaje, cumple_80: c.cumple_80,
        encuesta_salida: c.encuesta_salida, entrega_final: c.entrega_final } : null,
      apropiacion: variacionApropiacion(enc('apropiacion_entrada'), enc('apropiacion_salida')),
      resultado: resultado || null,
    });
  }
  const mejor = items.map((i) => i.cumplimiento).filter(Boolean).sort((a, b) => b.porcentaje - a.porcentaje)[0] || null;
  return { items, cumplimiento: mejor };
}

// Responde la formación de la unidad indicada.
export async function obtenerFormacion(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  if (!txt(idUnico)) throw solicitudInvalida('Falta la unidad (id_unico).');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return { ok: true, item: { id_unico: up.id_unico, ...(await formacionDeUP({ query }, up.id_up)) } };
}
