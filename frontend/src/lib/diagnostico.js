// Diagnóstico estructurado de la unidad productiva. Las secciones, los campos y sus reglas los define el
// servidor y llegan por GET /api/diagnostico/esquema, con lo que se dibujan los formularios. Aquí van las
// llamadas y lo propio del diagnóstico; el servidor valida todo otra vez y decide el cierre.
import { apiGeneral, qs } from '../inventario/lib/api';
import { faltantesCampos } from './secciones';

export { aEnvio, aFormulario, esObligatorio, pesos, textoValor } from './secciones';

let esquemaEnCurso = null;

// Pide el esquema del diagnóstico una sola vez.
export function cargarEsquema() {
  if (!esquemaEnCurso) {
    esquemaEnCurso = apiGeneral.get('/diagnostico/esquema').then((r) => r.item).catch((err) => {
      esquemaEnCurso = null;
      throw err;
    });
  }
  return esquemaEnCurso;
}

export const pedirDiagnostico = async (idUnico) => (await apiGeneral.get(`/diagnostico${qs({ id_unico: idUnico })}`)).item;
export const guardarSeccion = (idUnico, seccion, datos) => apiGeneral.post('/diagnostico', { id_unico: idUnico, seccion, datos });
export const revisar = (idUnico, decision, observacion) => apiGeneral.post('/diagnostico/revisar', { id_unico: idUnico, decision, observacion });
export const reenviar = (idUnico) => apiGeneral.post('/diagnostico/reenviar', { id_unico: idUnico });
export const pedirCoherencia = async (idUnico) => (await apiGeneral.get(`/visitas/coherencia${qs({ id_unico: idUnico })}`)).items;

export const ESTADOS_REVISION = {
  sin_enviar: { texto: 'Sin enviar', tono: 'neutro', ayuda: 'Se envía a revisión al cerrar la visita.' },
  pendiente: { texto: 'En revisión', tono: 'alerta', ayuda: 'La coordinación lo está revisando.' },
  revisado: { texto: 'Revisado', tono: 'ok', ayuda: 'La coordinación lo revisó.' },
  devuelto: { texto: 'Devuelto', tono: 'error', ayuda: 'La coordinación lo devolvió: corrígelo y reenvíalo.' },
};

export const NIVELES_FORMALIZACION = { formal: 'Formal (Cámara de comercio y RUT)', parcial: 'Parcial', informal: 'Informal' };

// Devuelve lo que falta en la sección del diagnóstico con la misma regla del servidor.
export function faltantes(seccion, d) {
  const datos = d || {};
  const faltan = faltantesCampos(seccion, datos);
  if (seccion.clave === 'verificacion' && ['existe', 'funciona', 'informacion_veraz'].some((k) => datos[k] === 'no') && !datos.observacion) {
    faltan.push('Observación (hay una respuesta «No»)');
  }
  if (seccion.clave === 'socializacion' && datos.realizada === 'no') faltan.push('La ruta debe socializarse en la Visita 1');
  return faltan;
}

// Devuelve las secciones a mostrar: las de una visita o todas.
export const seccionesDe = (esquema, visita) => (esquema?.secciones || []).filter((s) => !visita || s.visita === visita);

// Devuelve lo que impide cerrar la visita como exitosa según el diagnóstico, para el botón de cierre.
export function bloqueosDeCierre(datos, visita, sinGuardar = []) {
  if (!datos || !['v1', 'v2'].includes(visita)) return [];
  const lista = [];
  if (visita === 'v1') {
    const c = datos.completitud.v1;
    if (c.verificacion_negativa?.length) lista.push(`la verificación en sitio dice que ${c.verificacion_negativa.join(', ')} (solo cierra con acta de No Aceptación o de Retiro)`);
    else if (c.faltan.length) lista.push(`diagnóstico: ${c.faltan.length} dato(s) de la Visita 1`);
  } else if (datos.completitud.v2.faltan.length) {
    lista.push(`diagnóstico: ${datos.completitud.v2.faltan.length} dato(s)`);
  }
  if (sinGuardar.length) lista.push(`cambios sin guardar en: ${sinGuardar.join(', ')}`);
  return lista;
}
