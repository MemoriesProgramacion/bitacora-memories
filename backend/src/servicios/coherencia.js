// Lista de comprobación de coherencia de la carpeta de cada visita, calculada en el servidor con lo que hay en
// la plataforma: formatos obligatorios de la modalidad cargados, cédulas de los asociados que cubren a los
// activos y fechas coherentes.
import { query } from '../db.js';
import { ROLES } from '../config.js';
import { noEncontrado, prohibido, solicitudInvalida } from '../errores.js';
import { txt, esGestor } from '../util.js';
import { exigirAlcance } from '../alcance.js';
import { buscarUP } from './unidades.js';
import { CATALOGO, SECUENCIA, archivosDe, formatosFaltantes, modalidadDe } from './catalogoVisitas.js';
import { FORMATO_PLAN_NEGOCIO, datosDiagnostico, visitasDeUP } from './diagnostico.js';
import { conteoCedulas } from './reglasVisitas.js';

const NOMBRES = { v1: 'Visita 1', v2: 'Visita 2', v3: 'Visita 3' };
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function exigirLectura(usuario) {
  if (esGestor(usuario) || [ROLES.COORDINADOR, ROLES.TECNICO].includes(usuario?.rol)) return;
  throw prohibido('Tu rol no consulta la carpeta de las visitas.');
}

const item = (clave, texto, ok, detalle) => ({ clave, texto, ok, detalle: detalle || null });

// Calcula la lista de comprobación de una visita.
async function checklistVisita(tipo, v, up, vis, diag) {
  const items = [];
  const mod = modalidadDe(up.modalidad);
  const faltan = formatosFaltantes(tipo, up.modalidad, v.soportes);
  items.push(item('formatos', 'Formatos obligatorios cargados', !faltan.length, faltan.length ? `Faltan: ${faltan.join(', ')}.` : null));

  if (tipo === 'v1' && ['M2', 'M3', 'M4'].includes(mod)) {
    const titulo = 'Cédulas de los asociados frente a los asociados registrados';
    try {
      const { paginas, asociados: pide } = await conteoCedulas({ query }, up, v.soportes);
      items.push(item('cedulas', titulo, pide > 0 && paginas >= pide,
        `${paginas} ${paginas === 1 ? 'imagen o página' : 'imágenes o páginas'} para ${pide} asociados activos (sin el representante).`));
    } catch (e) {
      if (e.status !== 400) throw e;
      items.push(item('cedulas', titulo, false, e.message));
    }
  }

  const fechaVisita = v.fecha_visita;
  const cargas = Object.entries(v.soportes || {})
    .filter(([g]) => g !== 'soportes_quitados')
    .flatMap(([, formatos]) => Object.values(formatos || {}).flat())
    .map((s) => String(s?.cargado_en || '').slice(0, 10)).filter(Boolean);
  const antes = fechaVisita ? cargas.filter((f) => f < fechaVisita).length : 0;
  const cierreAntes = fechaVisita && v.fecha_cierre && String(v.fecha_cierre).slice(0, 10) < fechaVisita;
  const anterior = SECUENCIA[SECUENCIA.indexOf(tipo) - 1];
  const anteriorOk = !anterior || !!vis[anterior]?.cerrada;
  const problemas = [];
  if (!fechaVisita) problemas.push('la visita no tiene fecha');
  if (antes) problemas.push(`${antes} soporte(s) cargado(s) antes de la fecha de la visita`);
  if (cierreAntes) problemas.push('se cerró antes de la fecha de la visita');
  if (!anteriorOk) problemas.push(`la ${NOMBRES[anterior]} no está cerrada`);
  items.push(item('fechas', 'Fechas coherentes y visita anterior cerrada', !problemas.length, problemas.length ? `${problemas.join('; ')}.` : null));

  if (tipo === 'v1' || tipo === 'v2') {
    const idf = diag?.identificacion || {};
    const dif = [];
    if (!idf.modalidad) dif.push('el diagnóstico no tiene modalidad');
    else if (mod && idf.modalidad !== mod) dif.push(`modalidad ${idf.modalidad} en el diagnóstico y ${mod} en la unidad`);
    if (idf.departamento && up.departamento && normal(idf.departamento) !== normal(up.departamento)) {
      dif.push(`departamento «${idf.departamento}» en el diagnóstico y «${up.departamento}» en la unidad`);
    }
    if (tipo === 'v2' && !archivosDe(v.soportes, FORMATO_PLAN_NEGOCIO).length) dif.push('falta el plan de negocio');
    items.push(item('diagnostico', tipo === 'v2' ? 'Diagnóstico coherente con la unidad y plan de negocio cargado' : 'Diagnóstico coherente con la unidad',
      !dif.length, dif.length ? `${dif.join('; ')}.` : null));
  }
  return items;
}

// Devuelve, para cada visita de una unidad, sus comprobaciones y si está completa.
export async function coherenciaCarpeta(usuario, { id_unico: idUnico } = {}) {
  exigirLectura(usuario);
  if (!txt(idUnico)) throw solicitudInvalida('Falta la unidad (id_unico).');
  const up = await buscarUP({ idUnico: txt(idUnico) });
  if (!up) throw noEncontrado('Unidad productiva no encontrada.');
  exigirAlcance(usuario, up);
  const db = { query };
  const [vis, diag] = await Promise.all([visitasDeUP(db, up.id_up), datosDiagnostico(db, up.id_up)]);
  const items = [];
  for (const tipo of SECUENCIA.filter((t) => vis[t] && CATALOGO[t])) {
    const lista = await checklistVisita(tipo, vis[tipo], up, vis, diag);
    items.push({ tipo, nombre: NOMBRES[tipo], cerrada: vis[tipo].cerrada, completa: lista.every((x) => x.ok), items: lista });
  }
  return { ok: true, items };
}
