// Asociados de la unidad productiva y actas de novedades. Los asociados se registran uno por uno con nombre
// completo, cédula y teléfono, y el servidor exige el mínimo de la modalidad (10, 15 o 20 según sea M2, M3 o
// M4) al cerrar la primera visita. Después del cierre, los ingresos y retiros solo entran con un acta firmada.
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { conRegistro, diferenciasSinDatos } from './actividad.js';
import { guardarArchivo, urlArchivo } from './archivos.js';
import { buscarUP } from './unidades.js';
import { codigoDeLista } from './clasificacion.js';
import { fechaReal, hoyColombia } from './secciones.js';

const MAX_ID = 2147483647;
// Valida el id de un asociado: un entero positivo dentro del rango de la columna, o lanza un error 400.
function idValido(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_ID) throw solicitudInvalida('El asociado indicado no es válido.');
  return n;
}

export const CONTENEDOR_ACTAS_ASOCIADOS = 'novedades-asociados';
export const MINIMOS = { M2: 10, M3: 15, M4: 20 };

export const SEXOS = [
  { codigo: 'mujer', nombre: 'Mujer' }, { codigo: 'hombre', nombre: 'Hombre' },
  { codigo: 'intersexual', nombre: 'Intersexual' }, { codigo: 'no_informa', nombre: 'Prefiere no informar' },
];
export const ETNIAS = [
  { codigo: 'ninguna', nombre: 'Ninguna' }, { codigo: 'indigena', nombre: 'Indígena' },
  { codigo: 'afrocolombiana', nombre: 'Negra, afrocolombiana' }, { codigo: 'raizal', nombre: 'Raizal' },
  { codigo: 'palenquera', nombre: 'Palenquera' }, { codigo: 'rrom', nombre: 'Rrom (gitana)' },
  { codigo: 'no_informa', nombre: 'Prefiere no informar' },
];
export const NIVELES_EDUCATIVOS = [
  { codigo: 'ninguno', nombre: 'Ninguno' }, { codigo: 'primaria', nombre: 'Primaria' },
  { codigo: 'secundaria', nombre: 'Secundaria' }, { codigo: 'media', nombre: 'Media (bachiller)' },
  { codigo: 'tecnico', nombre: 'Técnico' }, { codigo: 'tecnologo', nombre: 'Tecnólogo' },
  { codigo: 'universitario', nombre: 'Universitario' }, { codigo: 'posgrado', nombre: 'Posgrado' },
];
export const ZONAS = [{ codigo: 'urbana', nombre: 'Urbana' }, { codigo: 'rural', nombre: 'Rural' }];
export const TIPOS_ASOCIADO = [
  { codigo: 'directo', nombre: 'Beneficiario directo' }, { codigo: 'indirecto', nombre: 'Beneficiario indirecto' },
];

// Devuelve la modalidad normalizada de M1 a M4, o vacío si no se conoce.
export const modalidadDe = (texto) => {
  const m = /M\s*([1-4])/i.exec(String(texto || ''));
  return m ? `M${m[1]}` : '';
};
// Devuelve el mínimo de asociados de la modalidad, o null si no tiene, como en M1, que es individual.
export const minimoDe = (modalidad) => MINIMOS[modalidadDe(modalidad)] ?? null;

const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const booleano = (v, campo) => {
  if (v === undefined || v === null || v === '') return null;
  if (v === true || v === 'true' || v === 'si' || v === 'sí') return true;
  if (v === false || v === 'false' || v === 'no') return false;
  throw solicitudInvalida(`${campo} debe ser Sí o No.`);
};

// Valida los datos de un asociado; nombre completo, cédula, teléfono y sexo son obligatorios y el resto del
// perfil es opcional.
export function limpiarAsociado(x, etiqueta = 'El asociado') {
  const d = x && typeof x === 'object' ? x : {};
  const nombre = txt(d.nombre)?.replace(/\s+/g, ' ');
  if (!nombre || nombre.split(' ').length < 2) throw solicitudInvalida(`${etiqueta}: escribe el nombre completo (nombres y apellidos).`);
  if (nombre.length > 200) throw solicitudInvalida(`${etiqueta}: el nombre admite máximo 200 caracteres.`);
  const documento = soloDigitos(d.documento);
  if (!/^\d{5,15}$/.test(documento)) throw solicitudInvalida(`${etiqueta}: la cédula es obligatoria (entre 5 y 15 dígitos).`);
  const telefono = soloDigitos(d.telefono);
  if (!/^\d{7,15}$/.test(telefono)) throw solicitudInvalida(`${etiqueta}: el teléfono es obligatorio (entre 7 y 15 dígitos).`);
  const sexo = codigoDeLista(SEXOS, d.sexo, 'el sexo');
  if (!sexo) throw solicitudInvalida(`${etiqueta}: indica el sexo.`);
  let fechaNacimiento = null;
  if (txt(d.fecha_nacimiento)) {
    const f = String(d.fecha_nacimiento).slice(0, 10);
    const t = fechaReal(f) ? Date.parse(`${f}T00:00:00Z`) : NaN;
    const edad = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(t) || edad < 0 || edad > 120) {
      throw solicitudInvalida(`${etiqueta}: la fecha de nacimiento no es válida.`);
    }
    fechaNacimiento = f;
  }
  return {
    nombre, documento, telefono, sexo,
    tipo: codigoDeLista(TIPOS_ASOCIADO, d.tipo, 'el tipo de asociado') || 'directo',
    es_representante: booleano(d.es_representante, 'Representante') === true,
    fecha_nacimiento: fechaNacimiento,
    pertenencia_etnica: codigoDeLista(ETNIAS, d.pertenencia_etnica, 'la pertenencia étnica'),
    discapacidad: booleano(d.discapacidad, 'Discapacidad'),
    victima: booleano(d.victima, 'Víctima del conflicto'),
    nivel_educativo: codigoDeLista(NIVELES_EDUCATIVOS, d.nivel_educativo, 'el nivel educativo'),
    zona: codigoDeLista(ZONAS, d.zona, 'la zona'),
  };
}

// Calcula la edad cumplida a hoy, o null.
function edad(fecha) {
  if (!fecha) return null;
  const n = new Date(fecha);
  const h = new Date();
  let e = h.getUTCFullYear() - n.getUTCFullYear();
  if (h.getUTCMonth() < n.getUTCMonth() || (h.getUTCMonth() === n.getUTCMonth() && h.getUTCDate() < n.getUTCDate())) e -= 1;
  return e;
}
const RANGOS_EDAD = [['menor_18', 0, 17], ['18_28', 18, 28], ['29_59', 29, 59], ['60_mas', 60, 200]];

// Calcula el total de asociados, directos e indirectos, el mínimo de la modalidad y el perfil sociodemográfico.
export function resumenAsociados(activos, modalidad) {
  const contar = (campo, lista) => Object.fromEntries([...lista.map((x) => [x.codigo, 0]), ['sin_dato', 0]]
    .map(([k]) => [k, activos.filter((a) => (a[campo] ?? 'sin_dato') === k).length]));
  const porEdad = Object.fromEntries([...RANGOS_EDAD.map(([k]) => [k, 0]), ['sin_dato', 0]]);
  for (const a of activos) {
    const e = edad(a.fecha_nacimiento);
    const r = e === null ? null : RANGOS_EDAD.find(([, min, max]) => e >= min && e <= max);
    porEdad[r ? r[0] : 'sin_dato'] += 1;
  }
  const minimo = minimoDe(modalidad);
  const total = activos.length;
  return {
    modalidad: modalidadDe(modalidad) || null,
    total,
    directos: activos.filter((a) => a.tipo === 'directo').length,
    indirectos: activos.filter((a) => a.tipo === 'indirecto').length,
    con_representante: activos.some((a) => a.es_representante),
    minimo,
    cumple_minimo: minimo === null ? true : total >= minimo,
    faltan: minimo === null ? 0 : Math.max(0, minimo - total),
    perfil: {
      sexo: contar('sexo', SEXOS),
      edad: porEdad,
      pertenencia_etnica: contar('pertenencia_etnica', ETNIAS),
      nivel_educativo: contar('nivel_educativo', NIVELES_EDUCATIVOS),
      zona: contar('zona', ZONAS),
      con_discapacidad: activos.filter((a) => a.discapacidad === true).length,
      victimas: activos.filter((a) => a.victima === true).length,
    },
  };
}

function exigirLectura(usuario) {
  if (esGestor(usuario) || [ROLES.COORDINADOR, ROLES.TECNICO].includes(usuario?.rol)) return;
  throw prohibido('Tu rol no consulta los asociados de la unidad productiva.');
}
function exigirEscritura(usuario) {
  if (esGestor(usuario) || usuario?.rol === ROLES.COORDINADOR) return;
  throw prohibido('Tu rol no registra asociados.');
}

async function unidad(usuario, idUnico) {
  if (!txt(idUnico)) throw solicitudInvalida('Falta la unidad (id_unico).');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  return up;
}

const v1Cerrada = async (db, idUp) =>
  (await db.query("SELECT 1 FROM visitas WHERE id_up = $1 AND tipo_visita = 'v1' AND cerrada LIMIT 1", [idUp])).rowCount > 0;

const COLUMNAS = `id, nombre, documento, telefono, tipo, es_representante, sexo, to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
  pertenencia_etnica, discapacidad, victima, nivel_educativo, zona, activo, fecha_ingreso, fecha_retiro, motivo_retiro,
  id_acta_ingreso, id_acta_retiro, registrado_por`;

const actaDoc = (a) => ({
  id: a.id, fecha: a.fecha, motivo: a.motivo, ingresos: a.ingresos, retiros: a.retiros,
  activos_antes: a.activos_antes, activos_despues: a.activos_despues,
  registrada_por: a.registrada_por, creada_en: a.creada_en, acta_url: urlArchivo(CONTENEDOR_ACTAS_ASOCIADOS, a.acta),
});

// Devuelve los asociados activos y retirados, el resumen, las actas y lo que el usuario puede hacer.
export async function listarAsociados(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  const up = await unidad(usuario, idUnico);
  const [{ rows }, actas, cerrada] = await Promise.all([
    query(`SELECT ${COLUMNAS} FROM up_asociados WHERE id_up = $1 ORDER BY activo DESC, es_representante DESC, nombre`, [up.id_up]),
    query(`SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, motivo, ingresos, retiros, acta, activos_antes, activos_despues,
                  registrada_por, creada_en FROM up_actas_asociados WHERE id_up = $1 ORDER BY creada_en DESC`, [up.id_up]),
    v1Cerrada({ query }, up.id_up),
  ]);
  const escribe = esGestor(usuario) || usuario.rol === ROLES.COORDINADOR;
  return {
    ok: true,
    item: {
      id_unico: up.id_unico,
      asociados: rows,
      resumen: resumenAsociados(rows.filter((a) => a.activo), up.modalidad),
      actas: actas.rows.map(actaDoc),
      visita1_cerrada: cerrada,
      puede_registrar: escribe && !cerrada,
      puede_registrar_acta: escribe,
      puede_corregir: escribe,
    },
  };
}

// Exige el mínimo de asociados de la modalidad para cerrar la primera visita.
export async function exigirMinimoParaCerrarV1(db, idUp, modalidad) {
  const minimo = minimoDe(modalidad);
  if (minimo === null) return;
  await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [idUp]);
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM up_asociados WHERE id_up = $1 AND activo', [idUp]);
  if (n < minimo) {
    throw solicitudInvalida(`No se puede cerrar la Visita 1: la unidad (${modalidadDe(modalidad)}) tiene ${n} asociado${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'} y la modalidad exige ${minimo}. Registra los asociados que faltan.`);
  }
}

const camposRegistro = (a) => ({ nombre: a.nombre, documento: a.documento, telefono: a.telefono, tipo: a.tipo, es_representante: a.es_representante });

// Campos del asociado que se comparan en la actividad; de los datos sensibles solo se registra que cambiaron.
const CAMPOS_ACTIVIDAD = ['nombre', 'documento', 'telefono', 'tipo', 'es_representante', 'sexo', 'fecha_nacimiento',
  'pertenencia_etnica', 'discapacidad', 'victima', 'nivel_educativo', 'zona'];
const SENSIBLES_ACTIVIDAD = ['documento', 'telefono', 'sexo', 'fecha_nacimiento', 'pertenencia_etnica', 'discapacidad', 'victima'];
const cambiosAsociado = (antes, despues) => diferenciasSinDatos(antes || {}, despues || {}, CAMPOS_ACTIVIDAD, SENSIBLES_ACTIVIDAD);

async function insertar(db, idUp, a, usuario, idActa = null) {
  try {
    const { rows: [r] } = await db.query(
      `INSERT INTO up_asociados (id_up, nombre, documento, telefono, tipo, es_representante, sexo, fecha_nacimiento,
                                 pertenencia_etnica, discapacidad, victima, nivel_educativo, zona, id_acta_ingreso, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [idUp, a.nombre, a.documento, a.telefono, a.tipo, a.es_representante, a.sexo, a.fecha_nacimiento,
        a.pertenencia_etnica, a.discapacidad, a.victima, a.nivel_educativo, a.zona, idActa, usuario.nombre || usuario.sub || null],
    );
    return r.id;
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, `La cédula ${a.documento} ya está entre los asociados activos de la unidad.`);
    throw e;
  }
}

// Garantiza un solo representante activo por unidad: al marcar uno, los demás dejan de serlo.
async function unicoRepresentante(db, idUp, idAsociado) {
  await db.query('UPDATE up_asociados SET es_representante = FALSE WHERE id_up = $1 AND activo AND id <> $2 AND es_representante', [idUp, idAsociado]);
}

// Registra un asociado, solo antes de cerrar la primera visita, o corrige los datos de uno activo, sin cambiar
// la cédula.
export function guardarAsociado(usuario, { id_unico: idUnico, asociado } = {}) {
  const traeId = !(asociado?.id === undefined || asociado?.id === null || asociado?.id === '');
  return conRegistro(
    usuario, { accion: traeId ? 'asociados.corregir' : 'asociados.registrar', objeto: { tipo: 'asociado', id: traeId ? Number(asociado.id) || null : null }, idUnico: txt(idUnico) },
    async () => {
      exigirEscritura(usuario);
      const idAsociado = traeId ? idValido(asociado.id) : null;
      const up = await unidad(usuario, idUnico);
      const a = limpiarAsociado(asociado);
      return transaccion(async (db) => {
        await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
        const cerrada = await v1Cerrada(db, up.id_up);
        let id = idAsociado;
        let antes = null;
        if (id) {
          const { rows: [previo] } = await db.query(`SELECT ${COLUMNAS} FROM up_asociados WHERE id = $1 AND id_up = $2 FOR UPDATE`, [id, up.id_up]);
          if (!previo || !previo.activo) throw noEncontrado('Ese asociado no está activo en la unidad.');
          if (cerrada && previo.documento !== a.documento) {
            throw new HttpError(409, 'Después de cerrar la Visita 1 la cédula no se cambia: registra el cambio de asociado con el acta de novedades.');
          }
          antes = previo;
          try {
            await db.query(
              `UPDATE up_asociados SET nombre = $3, documento = $4, telefono = $5, tipo = $6, es_representante = $7, sexo = $8,
                      fecha_nacimiento = $9, pertenencia_etnica = $10, discapacidad = $11, victima = $12, nivel_educativo = $13,
                      zona = $14, actualizado_en = now()
                WHERE id = $1 AND id_up = $2`,
              [id, up.id_up, a.nombre, a.documento, a.telefono, a.tipo, a.es_representante, a.sexo, a.fecha_nacimiento,
                a.pertenencia_etnica, a.discapacidad, a.victima, a.nivel_educativo, a.zona],
            );
          } catch (e) {
            if (e.code === '23505') throw new HttpError(409, `La cédula ${a.documento} ya está entre los asociados activos de la unidad.`);
            throw e;
          }
        } else {
          if (cerrada) throw new HttpError(409, 'La Visita 1 ya está cerrada: los ingresos de asociados se registran con el acta de novedades.');
          id = await insertar(db, up.id_up, a, usuario);
        }
        if (a.es_representante) await unicoRepresentante(db, up.id_up, id);
        return { ok: true, item: { id }, _cambios: { nuevo: !antes, campos: cambiosAsociado(antes, a) } };
      });
    },
    (r) => r._cambios,
  ).then(({ _cambios, ...r }) => r);
}

// Quita un asociado mal registrado, solo antes de cerrar la primera visita.
export function quitarAsociado(usuario, { id_unico: idUnico, id } = {}) {
  return conRegistro(
    usuario, { accion: 'asociados.quitar', objeto: { tipo: 'asociado', id: Number.isInteger(Number(id)) ? Number(id) : null }, idUnico: txt(idUnico) },
    async () => {
      exigirEscritura(usuario);
      const up = await unidad(usuario, idUnico);
      const idQuitar = idValido(id);
      return transaccion(async (db) => {
        await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
        if (await v1Cerrada(db, up.id_up)) {
          throw new HttpError(409, 'La Visita 1 ya está cerrada: los retiros de asociados se registran con el acta de novedades.');
        }
        const { rows: [previo] } = await db.query('DELETE FROM up_asociados WHERE id = $1 AND id_up = $2 AND activo RETURNING nombre', [idQuitar, up.id_up]);
        if (!previo) throw noEncontrado('Ese asociado no está registrado en la unidad.');
        return { ok: true, _cambios: { quitado: previo.nombre } };
      });
    },
    (r) => r._cambios,
  ).then(({ _cambios, ...r }) => r);
}

// Registra un acta de novedades con sus ingresos y retiros y el archivo firmado en PDF.
export function registrarActa(usuario, entrada, archivo) {
  const datos = entrada && typeof entrada === 'object' ? entrada : {};
  const idUnico = txt(datos.id_unico);
  return conRegistro(
    usuario, { accion: 'asociados.acta_novedades', objeto: { tipo: 'acta_asociados', id: null }, idUnico },
    async () => {
      exigirEscritura(usuario);
      const up = await unidad(usuario, idUnico);
      const fecha = String(datos.fecha || '').slice(0, 10);
      if (!fechaReal(fecha) || fecha > hoyColombia()) {
        throw solicitudInvalida('La fecha del acta no es válida (no puede ser futura).');
      }
      const motivo = txt(datos.motivo);
      if (!motivo) throw solicitudInvalida('Escribe el motivo del acta de novedades.');
      if (motivo.length > 2000) throw solicitudInvalida('El motivo admite máximo 2000 caracteres.');
      const ingresos = (Array.isArray(datos.ingresos) ? datos.ingresos : []).map((x, i) => limpiarAsociado(x, `Ingreso ${i + 1}`));
      const retiros = (Array.isArray(datos.retiros) ? datos.retiros : []).map((x) => ({ id: Number(x?.id), motivo: txt(x?.motivo)?.slice(0, 500) || null }));
      if (!ingresos.length && !retiros.length) throw solicitudInvalida('El acta debe registrar al menos un ingreso o un retiro.');
      if (ingresos.length > 100 || retiros.length > 100) throw solicitudInvalida('Un acta admite máximo 100 ingresos y 100 retiros.');
      const docs = ingresos.map((x) => x.documento);
      if (new Set(docs).size !== docs.length) throw solicitudInvalida('Hay cédulas repetidas entre los ingresos del acta.');
      if (retiros.some((r) => !Number.isInteger(r.id) || r.id <= 0 || r.id > MAX_ID) || new Set(retiros.map((r) => r.id)).size !== retiros.length) {
        throw solicitudInvalida('Los retiros del acta no son válidos.');
      }
      if (!archivo) throw solicitudInvalida('Adjunta el acta de novedades firmada en PDF.');

      return transaccion(async (db) => {
        await db.query('SELECT 1 FROM unidades_productivas WHERE id_up = $1 FOR UPDATE', [up.id_up]);
        const { rows: activos } = await db.query('SELECT id, nombre, documento FROM up_asociados WHERE id_up = $1 AND activo FOR UPDATE', [up.id_up]);
        const porId = new Map(activos.map((a) => [a.id, a]));
        const ajenos = retiros.filter((r) => !porId.has(r.id));
        if (ajenos.length) throw solicitudInvalida('Uno de los retiros no es un asociado activo de la unidad.');
        const quedan = new Set(activos.filter((a) => !retiros.some((r) => r.id === a.id)).map((a) => a.documento));
        const repetido = ingresos.find((x) => quedan.has(x.documento));
        if (repetido) throw new HttpError(409, `La cédula ${repetido.documento} ya está entre los asociados activos de la unidad.`);

        const despues = activos.length - retiros.length + ingresos.length;
        const minimo = minimoDe(up.modalidad);
        if (minimo !== null && despues < minimo) {
          throw solicitudInvalida(`El acta deja a la unidad con ${despues} asociados y la modalidad ${modalidadDe(up.modalidad)} exige ${minimo}. Registra el reemplazo en la misma acta.`);
        }

        const soporte = await guardarArchivo({
          contenedor: CONTENEDOR_ACTAS_ASOCIADOS, nombre: `${up.id_unico}/ACTA_NOVEDADES_ASOCIADOS_${Date.now()}.pdf`,
          archivo, idUp: up.id_up, usuario,
        }, db);
        const retirosDoc = retiros.map((r) => ({ ...r, nombre: porId.get(r.id).nombre, documento: porId.get(r.id).documento }));
        const { rows: [acta] } = await db.query(
          `INSERT INTO up_actas_asociados (id_up, fecha, motivo, ingresos, retiros, acta, activos_antes, activos_despues, registrada_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [up.id_up, fecha, motivo, JSON.stringify(ingresos.map(camposRegistro)), JSON.stringify(retirosDoc), soporte.nombre,
            activos.length, despues, usuario.nombre || usuario.sub || null],
        );
        for (const r of retiros) {
          await db.query(
            `UPDATE up_asociados SET activo = FALSE, es_representante = FALSE, fecha_retiro = now(), motivo_retiro = $3,
                    id_acta_retiro = $4, actualizado_en = now() WHERE id = $1 AND id_up = $2`,
            [r.id, up.id_up, r.motivo || motivo.slice(0, 500), acta.id],
          );
        }
        for (const x of ingresos) {
          const id = await insertar(db, up.id_up, x, usuario, acta.id);
          if (x.es_representante) await unicoRepresentante(db, up.id_up, id);
        }
        return {
          ok: true, item: { id: acta.id, activos_antes: activos.length, activos_despues: despues },
          _cambios: { acta: acta.id, ingresos: ingresos.map((x) => x.nombre), retiros: retirosDoc.map((x) => x.nombre), campos: { activos: [activos.length, despues] } },
        };
      });
    },
    (r) => r._cambios,
  ).then(({ _cambios, ...r }) => r);
}

// Devuelve las listas del perfil para los formularios.
export function listasAsociados() {
  return { ok: true, item: { sexos: SEXOS, etnias: ETNIAS, niveles_educativos: NIVELES_EDUCATIVOS, zonas: ZONAS, tipos: TIPOS_ASOCIADO, minimos: MINIMOS } };
}
