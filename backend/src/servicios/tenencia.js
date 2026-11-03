// Tenencia de la sede de la unidad productiva. Las adecuaciones locativas solo se capitalizan si la sede es
// propia, en comodato de 5 años o más o en arriendo de 3 años o más, con la certificación de tenencia cargada
// como soporte.
import path from 'node:path';
import { transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { conRegistro, diferencias } from './actividad.js';
import { guardarArchivo, urlArchivo } from './archivos.js';
import { TENENCIA, TENENCIAS, codigoDeLista, tenenciaHabilitaAdecuaciones } from './clasificacion.js';
import { buscarUP } from './unidades.js';

export const CONTENEDOR_TENENCIAS = 'tenencias';
const EXT_SOPORTE = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_SOPORTE_MB = 15;

// Devuelve la tenencia de una fila de unidades productivas tal como la ve la pantalla.
export function tenenciaDe(fila) {
  if (!fila?.tenencia_tipo) return null;
  const t = {
    tipo: fila.tenencia_tipo,
    tipo_nombre: TENENCIA[fila.tenencia_tipo]?.nombre || fila.tenencia_tipo,
    anios: fila.tenencia_anios == null ? null : Number(fila.tenencia_anios),
    soporte: fila.tenencia_soporte || null,
    soporte_url: fila.tenencia_soporte ? urlArchivo(CONTENEDOR_TENENCIAS, fila.tenencia_soporte) : null,
    registrada_por: fila.tenencia_registrada_por || null,
    fecha: fila.tenencia_fecha || null,
  };
  return { ...t, habilita_adecuaciones: tenenciaHabilitaAdecuaciones(t) };
}

function exigirRegistro(usuario) {
  if (esGestor(usuario) || usuario?.rol === ROLES.COORDINADOR) return;
  throw prohibido('Tu rol no registra la tenencia de la sede.');
}

// Registra la tenencia de la sede con su tipo y años y el archivo de la certificación, obligatorio la primera
// vez.
export function registrarTenencia(usuario, campos = {}, archivo) {
  const idUnico = txt(campos.id_unico);
  return conRegistro(
    usuario, { accion: 'unidad.tenencia', objeto: { tipo: 'unidad', id: idUnico }, idUnico },
    async () => {
      exigirRegistro(usuario);
      if (!idUnico) throw solicitudInvalida('Falta la unidad (id_unico).');
      const up = await buscarUP({ idUnico });
      if (!up) throw noEncontrado('Unidad productiva no encontrada.');
      exigirAlcance(usuario, up);

      const tipo = codigoDeLista(TENENCIAS, campos.tipo, 'el tipo de tenencia');
      if (!tipo) throw solicitudInvalida('Indica el tipo de tenencia de la sede.');
      const minimo = TENENCIA[tipo].anios_minimos;
      let anios = null;
      if (minimo !== null) {
        anios = Number(String(campos.anios ?? '').replace(',', '.'));
        if (campos.anios === undefined || campos.anios === '' || !Number.isFinite(anios) || anios < 0 || anios > 99) {
          throw solicitudInvalida(`Indica por cuántos años es el ${TENENCIA[tipo].nombre.toLowerCase()} (entre 0 y 99).`);
        }
        anios = Math.round(anios * 10) / 10;
      }
      if (archivo) {
        const ext = path.extname(archivo.originalname || '').toLowerCase();
        if (!EXT_SOPORTE.includes(ext)) throw solicitudInvalida('La certificación de tenencia debe ser PDF, JPG o PNG.');
        if (archivo.size > MAX_SOPORTE_MB * 1024 * 1024) throw solicitudInvalida(`La certificación supera ${MAX_SOPORTE_MB} MB.`);
      }

      return transaccion(async (db) => {
        const { rows: [antes] } = await db.query(
          `SELECT tenencia_tipo, tenencia_anios, tenencia_soporte FROM unidades_productivas WHERE id_up = $1 FOR UPDATE`,
          [up.id_up],
        );
        if (!archivo && !antes.tenencia_soporte) {
          throw solicitudInvalida('Adjunta la certificación de tenencia, comodato o arriendo de la sede.');
        }
        const aniosAntes = antes.tenencia_anios == null ? null : Number(antes.tenencia_anios);
        if (!archivo && (antes.tenencia_tipo !== tipo || aniosAntes !== anios)) {
          throw solicitudInvalida('Cambiaste el tipo o los años de la tenencia: adjunta la certificación que lo respalda.');
        }
        let soporte = antes.tenencia_soporte;
        if (archivo) {
          const ext = path.extname(archivo.originalname).toLowerCase();
          const r = await guardarArchivo({
            contenedor: CONTENEDOR_TENENCIAS, nombre: `${up.id_unico}/TENENCIA_${Date.now()}${ext}`, archivo, idUp: up.id_up, usuario,
          }, db);
          soporte = r.nombre;
        }
        const { rows: [despues] } = await db.query(
          `UPDATE unidades_productivas
              SET tenencia_tipo = $2, tenencia_anios = $3, tenencia_soporte = $4,
                  tenencia_registrada_por = $5, tenencia_fecha = now(), fecha_actualizacion = now()
            WHERE id_up = $1
        RETURNING tenencia_tipo, tenencia_anios, tenencia_soporte, tenencia_registrada_por, tenencia_fecha`,
          [up.id_up, tipo, anios, soporte, usuario.nombre || usuario.sub || null],
        );
        return {
          ok: true,
          item: tenenciaDe(despues),
          _antes: { tipo: antes.tenencia_tipo, anios: antes.tenencia_anios == null ? null : Number(antes.tenencia_anios), soporte: antes.tenencia_soporte },
        };
      });
    },
    (r) => ({
      habilita_adecuaciones: r.item.habilita_adecuaciones,
      campos: diferencias(r._antes, { tipo: r.item.tipo, anios: r.item.anios, soporte: r.item.soporte }, ['tipo', 'anios', 'soporte']),
    }),
  ).then(({ _antes, ...r }) => r);
}
