// Cargue del RIT (cédula y nombre) desde un Excel que el navegador lee y envía por lotes. Cada fila se empalma
// con la base por la cédula del representante de la unidad, y se informa en qué fila está cada problema.
import { query } from '../db.js';
import { prohibido, solicitudInvalida } from '../errores.js';
import { conRegistro, registrarPorUnidad } from './actividad.js';

const MAX_FILAS = 500;
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

// Devuelve una cédula comparable, sin puntos ni espacios.
export const cedulaDe = (v) => String(v ?? '').trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const nombreLimpio = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

function palabras(v) {
  return new Set(
    String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p && !PARTICULAS.has(p)),
  );
}

// Compara dos nombres sin importar tildes, mayúsculas, orden ni si uno trae menos palabras.
export function nombresCoinciden(a, b) {
  const A = palabras(a);
  const B = palabras(b);
  if (!A.size || !B.size) return false;
  return [...A].every((p) => B.has(p)) || [...B].every((p) => A.has(p));
}

// Recibe un lote de filas con cédula y nombre y las empalma con la base.
export async function cargarRit(usuario, cuerpo = {}) {
  if (!usuario?.general) throw prohibido('Solo el coordinador de datos puede hacer cargues.');
  const filas = cuerpo.filas;
  if (!Array.isArray(filas) || !filas.length) throw solicitudInvalida('No hay filas para cargar.');
  if (filas.length > MAX_FILAS) throw solicitudInvalida(`Máximo ${MAX_FILAS} filas por envío.`);

  return conRegistro(usuario, { accion: 'cargue.rit', objeto: { tipo: 'rit', id: null } }, async () => {
    const errores = [];
    const validas = [];
    for (const f of filas) {
      const fila = Number.isInteger(Number(f?.fila)) && Number(f.fila) > 0 ? Number(f.fila) : null;
      const cedula = cedulaDe(f?.cedula);
      const nombre = nombreLimpio(f?.nombre);
      const falla = (columna, motivo) => errores.push({ fila, columna, cedula: String(f?.cedula ?? '').trim(), nombre, motivo });
      if (!cedula) { falla('cedula', 'La cédula está vacía.'); if (!nombre) falla('nombre', 'El nombre está vacío.'); continue; }
      if (cedula.length > 20) { falla('cedula', `La cédula «${String(f.cedula).trim()}» es demasiado larga (máximo 20 caracteres).`); continue; }
      if (!nombre) { falla('nombre', 'El nombre está vacío.'); continue; }
      validas.push({ fila, cedula, nombre, original: String(f.cedula).trim() });
    }

    const { rows } = await query(
      `SELECT regexp_replace(r.documento, '[^0-9A-Za-z]', '', 'g') AS cedula, r.id_representante, r.nombre_completo,
              up.id_unico, e.id_expediente, e.rit_tiene
         FROM representantes r
         LEFT JOIN unidades_productivas up ON up.id_representante = r.id_representante
         LEFT JOIN expedientes_up e        ON e.id_up = up.id_up
        WHERE upper(regexp_replace(r.documento, '[^0-9A-Za-z]', '', 'g')) = ANY($1::text[])
        ORDER BY up.id_unico`,
      [[...new Set(validas.map((v) => v.cedula))]],
    );
    const porCedula = new Map();
    for (const r of rows) {
      const clave = r.cedula.toUpperCase();
      if (!porCedula.has(clave)) porCedula.set(clave, new Map());
      const reps = porCedula.get(clave);
      if (!reps.has(r.id_representante)) reps.set(r.id_representante, { nombre: r.nombre_completo, ups: [] });
      if (r.id_unico) reps.get(r.id_representante).ups.push(r);
    }

    const porActualizar = [];
    let sinCambios = 0;
    for (const v of validas) {
      const falla = (columna, motivo) => errores.push({ fila: v.fila, columna, cedula: v.original, nombre: v.nombre, motivo });
      const reps = porCedula.get(v.cedula);
      if (!reps) {
        falla('cedula', `La cédula ${v.original} no existe en la base de datos: ningún representante tiene ese documento.`);
        continue;
      }
      const iguales = [...reps.values()].filter((r) => nombresCoinciden(r.nombre, v.nombre));
      if (!iguales.length) {
        const enBase = [...reps.values()].map((r) => `«${r.nombre}»`).join(' o ');
        falla('nombre', `La cédula ${v.original} está registrada a nombre de ${enBase}, pero el archivo dice «${v.nombre}». No se actualizó.`);
        continue;
      }
      const ups = iguales.flatMap((r) => r.ups);
      if (!ups.length) {
        falla('cedula', `La cédula ${v.original} (${iguales[0].nombre}) existe, pero no tiene ninguna unidad productiva asociada.`);
        continue;
      }
      let cambio = false;
      let pendiente = false;
      for (const up of ups) {
        if (!up.id_expediente) {
          falla('cedula', `La U.P. ${up.id_unico} de la cédula ${v.original} no tiene expediente: cárgala primero en «Documentación de las U.P.».`);
        } else if (up.rit_tiene !== true) {
          porActualizar.push({ id_expediente: up.id_expediente, id_unico: up.id_unico, antes: up.rit_tiene });
          cambio = true;
        } else {
          pendiente = true;
        }
      }
      if (!cambio && pendiente) sinCambios += 1;
    }

    let actualizados = 0;
    if (porActualizar.length) {
      const { rows: hechos } = await query(
        `UPDATE expedientes_up SET rit_tiene = true, fecha_actualizacion = now()
          WHERE id_expediente = ANY($1::int[]) AND rit_tiene IS DISTINCT FROM true
          RETURNING id_expediente`,
        [[...new Set(porActualizar.map((p) => p.id_expediente))]],
      );
      const hechosIds = new Set(hechos.map((h) => h.id_expediente));
      const unicos = [...new Map(porActualizar.filter((p) => hechosIds.has(p.id_expediente)).map((p) => [p.id_expediente, p])).values()];
      actualizados = unicos.length;
      await registrarPorUnidad(usuario, {
        accion: 'cargue.rit', objeto: { tipo: 'rit', id: null },
        filas: unicos.map((p) => ({ idUnico: p.id_unico, campos: { rit_tiene: [p.antes, true] } })),
      });
    }

    errores.sort((a, b) => (a.fila ?? 0) - (b.fila ?? 0));
    return { ok: true, recibidas: filas.length, actualizados, sin_cambios: sinCambios, errores };
  }, (r) => ({ actualizados: r.actualizados, sin_cambios: r.sin_cambios, errores: r.errores.length }));
}
