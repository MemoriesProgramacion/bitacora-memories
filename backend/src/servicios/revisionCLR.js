// Revisión de la coordinación sobre el diagnóstico y la evaluación de salida. Al cerrar la visita el registro
// queda pendiente; la coordinación lo marca revisado o lo devuelve con observación, y devuelto, se corrige y se
// reenvía si está completo. Cada decisión queda en la actividad.
import { transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, prohibido, solicitudInvalida } from '../errores.js';
import { txt } from '../util.js';
import { conRegistro } from './actividad.js';

export const ESTADOS_REVISION = ['sin_enviar', 'pendiente', 'revisado', 'devuelto'];

// Arma el bloque de revisión para la respuesta de consulta.
export const revisionDe = (fila) => ({
  estado: fila?.estado_revision || 'sin_enviar',
  observacion: fila?.revision_observacion || null,
  revisado_por: fila?.revisado_por || null,
  revisado_en: fila?.revisado_en || null,
  historial: fila?.revision_historial || [],
});

// Indica qué puede hacer el usuario con la revisión.
export function accionesRevision(usuario, estado, escribe) {
  return {
    puede_revisar: usuario.rol === ROLES.COORDINADOR && estado === 'pendiente',
    puede_devolver: usuario.rol === ROLES.COORDINADOR && ['pendiente', 'revisado'].includes(estado),
    puede_reenviar: escribe && estado === 'devuelto',
  };
}

// Crea las acciones de revisar y reenviar para una tabla con una fila por unidad.
export function flujoRevision({ tabla, accion, textos, unidad, exigirEscritura, completo, alDecidir }) {
  const leer = async (db, idUp) => (await db.query(`SELECT * FROM ${tabla} WHERE id_up = $1 FOR UPDATE`, [idUp])).rows[0] || null;

  function revisar(usuario, { id_unico: idUnico, decision, observacion } = {}) {
    return conRegistro(
      usuario, { accion: `${accion}.revisar`, objeto: { tipo: accion, id: txt(decision) }, idUnico: txt(idUnico) },
      async () => {
        if (usuario?.rol !== ROLES.COORDINADOR) throw prohibido(`Solo la coordinación revisa ${textos.sujeto.toLowerCase()}.`);
        const up = await unidad(usuario, idUnico);
        const dec = txt(decision);
        if (!['revisado', 'devuelto'].includes(dec)) throw solicitudInvalida('La decisión debe ser «revisado» o «devuelto».');
        const obs = txt(observacion);
        if (dec === 'devuelto' && !obs) throw solicitudInvalida('Escribe la observación con lo que el gestor debe corregir.');
        if (obs && obs.length > 2000) throw solicitudInvalida('La observación admite máximo 2000 caracteres.');
        return transaccion(async (db) => {
          const fila = await leer(db, up.id_up);
          const estado = fila?.estado_revision || 'sin_enviar';
          const permitido = dec === 'revisado' ? ['pendiente'] : ['pendiente', 'revisado'];
          if (!permitido.includes(estado)) {
            throw new HttpError(409, estado === 'sin_enviar' || estado === 'devuelto'
              ? `${textos.sujeto} todavía no se ha enviado a revisión (se envía al cerrar la ${textos.visita}).`
              : `${textos.sujeto} ya está ${textos.revisado}.`);
          }
          const quien = usuario.nombre || usuario.sub || null;
          const entrada = { decision: dec, observacion: obs || null, por: quien, en: new Date().toISOString() };
          await db.query(
            `UPDATE ${tabla} SET estado_revision = $2, revision_observacion = $3, revisado_por = $4, revisado_en = now(),
                    revision_historial = revision_historial || $5::jsonb WHERE id_up = $1`,
            [up.id_up, dec, obs || null, quien, JSON.stringify([entrada])],
          );
          if (alDecidir) await alDecidir(db, up, dec);
          return { ok: true, item: { estado: dec }, _antes: estado };
        });
      },
      (r) => ({ observacion: txt(observacion) || null, campos: { estado: [r._antes, r.item.estado] } }),
    ).then(({ _antes, ...r }) => r);
  }

  function reenviar(usuario, { id_unico: idUnico } = {}) {
    return conRegistro(
      usuario, { accion: `${accion}.reenviar`, objeto: { tipo: accion, id: null }, idUnico: txt(idUnico) },
      async () => {
        exigirEscritura(usuario);
        const up = await unidad(usuario, idUnico);
        return transaccion(async (db) => {
          const fila = await leer(db, up.id_up);
          if ((fila?.estado_revision || 'sin_enviar') !== 'devuelto') {
            throw new HttpError(409, `Solo se reenvía ${textos.devuelto} por la coordinación.`);
          }
          const c = await completo(fila, db, up);
          if (!c.completo) throw solicitudInvalida(`${textos.sujeto} todavía no está ${textos.completo || 'completo'}: ${c.faltan.join('; ')}.`);
          await db.query(`UPDATE ${tabla} SET estado_revision = 'pendiente' WHERE id_up = $1`, [up.id_up]);
          return { ok: true, item: { estado: 'pendiente' } };
        });
      },
      () => ({ campos: { estado: ['devuelto', 'pendiente'] } }),
    );
  }

  return { revisar, reenviar };
}
