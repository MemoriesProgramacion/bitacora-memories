// Reglas de las visitas en el servidor, que antes solo validaba la pantalla: datos de la visita con códigos
// conocidos, cédulas de los participantes para cerrar la primera visita, vigencia del certificado de existencia
// y plazo de la tercera visita respecto de la entrega.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { HttpError, solicitudInvalida } from '../errores.js';
import { archivosDe, modalidadDe, tieneFormato } from './catalogoVisitas.js';
import { diaColombia, fechaReal, hoyColombia } from './secciones.js';
import { datosDiagnostico } from './diagnostico.js';
import { fechaProgramada, estadoEntrega } from './entregas.js';
import { CTE_UP_DE_KIT, ID_UP_DE_KIT, JOIN_UP_DE_KIT } from './defectuosos.js';

export const SIN_DATOS = 'Sin datos asignados';
// Resultados de la llamada de agendamiento admitidos; incluye lo que manda la pantalla cuando no hay dato.
export const RESULTADOS_LLAMADA = ['AGENDADA', 'SOLICITA_REAGENDAR', 'NO_CONTESTA', 'NUMERO_ERRADO', 'NO_ACEPTA'];
export const ESTADOS_REALIZACION = ['EXITOSA', 'PENDIENTE_SOPORTES', 'NO_REALIZADA'];
export const MODALIDADES_REALIZACION = ['PRESENCIAL', 'VIRTUAL'];
export const CAUSAS_VIRTUAL = [
  { codigo: 'orden_publico', nombre: 'Orden público' },
  { codigo: 'desastre', nombre: 'Desastre natural o emergencia' },
  { codigo: 'otra', nombre: 'Otra causa externa' },
];
export const FORMATO_SOPORTE_VIRTUAL = 'Soporte de la visita virtual';
export const FORMATO_CERTIFICADO = 'Certificado de existencia o Cámara de comercio';
export const DIAS_TRAS_ENTREGA = 30;

const NOMBRES = { v1: 'Visita 1', v2: 'Visita 2', v3: 'Visita 3' };
const conDato = (v) => (v === null || v === undefined || v === '' || v === SIN_DATOS ? null : v);
const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Limpia la programación: el resultado con un código conocido y la fecha y la hora con formato válido.
export function programacionLimpia(p = {}) {
  const resultado = conDato(p.resultado_llamada);
  if (resultado && !RESULTADOS_LLAMADA.includes(resultado)) throw solicitudInvalida('El resultado del agendamiento no es válido.');
  const contacto = conDato(p.contacto_logrado);
  if (contacto && !['SI', 'NO'].includes(contacto)) throw solicitudInvalida('Indica si se logró el contacto (SI o NO).');
  const fecha = conDato(p.fecha_visita);
  if (fecha && !fechaReal(String(fecha))) throw solicitudInvalida('La fecha de la visita no es válida.');
  return {
    contacto_logrado: contacto,
    intentos_llamada: Number.isInteger(Number(p.intentos_llamada)) && Number(p.intentos_llamada) >= 0 ? Number(p.intentos_llamada) : null,
    resultado_llamada: resultado,
    fecha_visita: fecha,
    hora_visita: /^\d{1,2}:\d{2}$/.test(String(p.hora_visita)) ? p.hora_visita : null,
    fechas_anteriores: (Array.isArray(p.fechas_anteriores) ? p.fechas_anteriores : []).slice(0, 100)
      .map((h) => (h && typeof h === 'object' && !Array.isArray(h) ? h : {})),
  };
}

// Limpia la realización: estado y modalidad conocidos; la aprobación de la visita virtual la conserva el
// servidor.
export function realizacionLimpia(r = {}, antes = {}) {
  const estado = conDato(r.estado);
  if (estado && !ESTADOS_REALIZACION.includes(estado)) throw solicitudInvalida('El estado de la visita no es válido.');
  const modalidad = conDato(r.modalidad) || 'PRESENCIAL';
  if (!MODALIDADES_REALIZACION.includes(modalidad)) throw solicitudInvalida('La modalidad de la visita debe ser presencial o virtual.');
  const salida = { estado, modalidad };
  if (modalidad === 'VIRTUAL') {
    const causa = conDato(r.causa_virtual);
    if (causa && !CAUSAS_VIRTUAL.some((c) => c.codigo === causa)) throw solicitudInvalida('La causa de la visita virtual no es válida.');
    salida.causa_virtual = causa;
    salida.justificacion_virtual = txt(r.justificacion_virtual, 2000);
  }
  const ap = antes?.aprobacion_interventoria;
  const descartadas = Array.isArray(antes?.aprobaciones_descartadas) ? antes.aprobaciones_descartadas : [];
  if (descartadas.length) salida.aprobaciones_descartadas = descartadas;
  if (ap) {
    const igual = modalidad === 'VIRTUAL' && salida.causa_virtual === ap.causa_virtual && salida.justificacion_virtual === ap.justificacion_virtual;
    if (igual) salida.aprobacion_interventoria = ap;
    else salida.aprobaciones_descartadas = [...descartadas, { ...ap, descartada_en: new Date().toISOString() }];
  }
  return salida;
}

// Exige para cerrar que la visita sea exitosa, esté agendada y ya realizada desde la fecha programada; si es
// virtual, con causa, soporte y aprobación.
export function exigirDatosDeCierre({ tipo, programacion, realizacion, soportes }) {
  if (realizacion.estado !== 'EXITOSA') throw solicitudInvalida('Solo se cierra una visita exitosa: márcala como exitosa con todos sus formatos.');
  if (programacion.resultado_llamada !== 'AGENDADA' || !programacion.fecha_visita) {
    throw solicitudInvalida('Para cerrar la visita debe estar agendada con su fecha.');
  }
  if (programacion.fecha_visita > hoyColombia()) {
    throw solicitudInvalida(`La visita está programada para el ${programacion.fecha_visita}: se cierra desde ese día.`);
  }
  if (realizacion.modalidad === 'VIRTUAL') {
    const nombre = NOMBRES[tipo] || 'visita';
    if (!realizacion.causa_virtual || !realizacion.justificacion_virtual) {
      throw solicitudInvalida(`La ${nombre} virtual necesita la causa externa y su justificación.`);
    }
    if (!tieneFormato(soportes, FORMATO_SOPORTE_VIRTUAL)) {
      throw solicitudInvalida(`Carga el soporte de la visita virtual (formato «${FORMATO_SOPORTE_VIRTUAL}»).`);
    }
    if (!realizacion.aprobacion_interventoria) {
      throw solicitudInvalida(`La ${nombre} virtual necesita la aprobación de la interventoría: la registra el Coordinador local regional.`);
    }
  }
}

const RE_IMAGEN = /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i;
const RE_PDF = /\.pdf$/i;
const MAX_LECTURA = 100 * 1024 * 1024;

// Devuelve el diccionario PDF que contiene una posición, con sus diccionarios internos.
function diccionarioEn(texto, i) {
  let nivel = 0;
  let ini = -1;
  for (let k = i; k > 0; k--) {
    if (texto[k] === '>' && texto[k - 1] === '>') { nivel++; k--; } else if (texto[k] === '<' && texto[k - 1] === '<') {
      if (nivel === 0) { ini = k - 1; break; }
      nivel--; k--;
    }
  }
  if (ini < 0) return '';
  nivel = 0;
  for (let k = ini; k < texto.length - 1; k++) {
    if (texto[k] === '<' && texto[k + 1] === '<') { nivel++; k++; } else if (texto[k] === '>' && texto[k + 1] === '>') {
      nivel--; k++;
      if (nivel === 0) return texto.slice(ini, k + 1);
    }
  }
  return '';
}

// Descomprime los flujos de objetos de los PDF 1.5 o superiores, que guardan los diccionarios comprimidos con
// FlateDecode.
function flujosDeObjetos(texto, buf) {
  const salida = [];
  const re = /\/Type\s*\/ObjStm\b/g;
  let m;
  while ((m = re.exec(texto))) {
    const dic = diccionarioEn(texto, m.index);
    if (!/\/FlateDecode\b/.test(dic)) continue;
    const ini = texto.indexOf('stream', m.index);
    if (ini < 0) continue;
    let datos = ini + 6;
    if (texto[datos] === '\r') datos++;
    if (texto[datos] === '\n') datos++;
    const fin = texto.indexOf('endstream', datos);
    if (fin < 0) continue;
    try { salida.push(zlib.inflateSync(buf.subarray(datos, fin), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1')); } catch { }
  }
  return salida;
}

// Cuenta las páginas de un PDF a partir del mayor /Count del árbol de páginas, incluso dentro de flujos
// comprimidos.
export function contarPaginasPdf(buf) {
  const crudo = buf.toString('latin1');
  const textos = [crudo, ...flujosDeObjetos(crudo, buf)];
  let total = 0;
  for (const t of textos) {
    const re = /\/Type\s*\/Pages(?![\w])/g;
    let m;
    while ((m = re.exec(t))) {
      const c = /\/Count\s+(\d+)/.exec(diccionarioEn(t, m.index));
      if (c) total = Math.max(total, Number(c[1]));
    }
  }
  if (total > 0) return total;
  const sueltas = textos.reduce((n, t) => n + (t.match(/\/Type\s*\/Page(?![s\w])/g) || []).length, 0);
  return sueltas || null;
}

// Devuelve las páginas de un PDF guardado en las visitas, o null si no se puede leer.
export async function paginasPdf(db, blob, idUp) {
  const { rows: [a] } = await db.query(
    "SELECT ruta_relativa FROM archivos WHERE contenedor = 'visitas' AND nombre = $1 AND id_up IS NOT DISTINCT FROM $2",
    [blob, idUp],
  ).catch(() => ({ rows: [] }));
  if (!a) return null;
  try {
    const ruta = path.join(config.storageDir, a.ruta_relativa);
    if (!ruta.startsWith(config.storageDir + path.sep)) return null;
    const st = await fs.stat(ruta);
    if (st.size > MAX_LECTURA) return null;
    return contarPaginasPdf(await fs.readFile(ruta));
  } catch {
    return null;
  }
}

// Compara las cédulas cargadas con los asociados activos sin el representante, contando cada imagen y las
// páginas de los PDF.
export async function conteoCedulas(db, up, soportes) {
  let paginas = 0;
  for (const a of archivosDe(soportes, 'Cédulas de los asociados')) {
    const n = String(a.blob || a.archivo || '');
    if (RE_IMAGEN.test(n)) { paginas += 1; continue; }
    if (!RE_PDF.test(n)) continue;
    const p = await paginasPdf(db, a.blob, up.id_up);
    if (p === null) {
      throw solicitudInvalida(`No se pudo leer el número de páginas del PDF «${a.archivo || path.posix.basename(n)}» de las cédulas: vuelve a generarlo sin contraseña o sube las cédulas como imágenes.`);
    }
    paginas += p;
  }
  const { rows: [{ n }] } = await db.query(
    'SELECT count(*)::int AS n FROM up_asociados WHERE id_up = $1 AND activo AND NOT es_representante', [up.id_up],
  );
  return { paginas, asociados: n };
}

export async function exigirCedulasParticipantes(db, up, soportes) {
  if (!['M2', 'M3', 'M4'].includes(modalidadDe(up.modalidad))) return;
  const { paginas, asociados } = await conteoCedulas(db, up, soportes);
  if (paginas < asociados) {
    throw solicitudInvalida(`Para cerrar la Visita 1 faltan cédulas de los asociados: hay ${paginas} ${paginas === 1 ? 'imagen o página' : 'imágenes o páginas'} para ${asociados} asociados activos (sin el representante).`);
  }
}

// Devuelve la fecha un mes antes, el mismo día del mes anterior o el último día si ese mes es más corto.
export function unMesAntes(f) {
  const [a, m, d] = f.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  const r = new Date(Date.UTC(m === 1 ? a - 1 : a, (m + 10) % 12, Math.min(d, ultimo)));
  return r.toISOString().slice(0, 10);
}

// Exige que el certificado, cuando aplica o se cargó, tenga fecha de expedición de máximo un mes antes de la
// primera visita.
export async function exigirVigenciaCertificado(db, up, soportes, fechaVisita) {
  const mod = modalidadDe(up.modalidad);
  if (!['M3', 'M4'].includes(mod) && !tieneFormato(soportes, FORMATO_CERTIFICADO)) return;
  const fecha = (await datosDiagnostico(db, up.id_up))?.formalizacion?.fecha_certificado;
  if (!fecha) {
    throw solicitudInvalida('Registra la fecha de expedición del certificado de existencia y representación (Diagnóstico › Formalización).');
  }
  const desde = unMesAntes(fechaVisita);
  if (fecha < desde) {
    throw solicitudInvalida(`El certificado de existencia y representación se expidió el ${fecha}: para la Visita 1 del ${fechaVisita} debe ser del ${desde} o posterior (máximo un mes).`);
  }
}

// Devuelve la fecha de entrega de cada unidad, la única definición de entrega que usan las visitas.
export async function fechasEntregaUPs(db, idsUnicos, hoy = hoyColombia()) {
  const ids = [...new Set((idsUnicos || []).filter((x) => String(x ?? '').trim()).map(String))];
  const salida = new Map();
  if (!ids.length) return salida;
  const consultar = (sql) => db.query(sql, [ids]).catch(() => ({ rows: [] }));
  const ent = await consultar('SELECT id_unico, doc FROM entregas_ups WHERE id_unico = ANY($1::text[])');
  const planes = await consultar(
    `SELECT DISTINCT ON (k.id_up) up.id_unico, k.estado, k.historial FROM carritos k JOIN unidades_productivas up ON up.id_up = k.id_up
      WHERE up.id_unico = ANY($1::text[]) ORDER BY k.id_up, (k.id_origen LIKE 'LOCAL-%') DESC, k.id_carrito DESC`);
  const kits = await consultar(
    `WITH ${CTE_UP_DE_KIT}
     SELECT ${ID_UP_DE_KIT()} AS id_unico, max(e.fecha) AS f FROM inventario.entregas_kits e JOIN inventario.combos c ON c.id = e.combo_id
       ${JOIN_UP_DE_KIT('c.nombre')}
      WHERE ${ID_UP_DE_KIT()} = ANY($1::text[]) GROUP BY 1`);
  const inv = await consultar('SELECT id_unico, max(fecha) AS f FROM inventario.entregas_up WHERE id_unico = ANY($1::text[]) GROUP BY id_unico');
  const comp = await consultar("SELECT id_unico, doc->'logistica' AS logistica FROM items_ups WHERE id_unico = ANY($1::text[]) AND vigente");
  const fuentes = new Map(ids.map((id) => [id, { master: [], otras: [] }]));
  const de = (id) => fuentes.get(String(id));
  for (const r of ent.rows) {
    const efectiva = String(r.doc?.excel_fecha_entrega_efectiva || '').slice(0, 10);
    if (fechaReal(efectiva)) de(r.id_unico)?.master.push(efectiva);
    else if (estadoEntrega(r.doc || {}) === 'entregada' && fechaProgramada(r.doc || {})) de(r.id_unico)?.master.push(fechaProgramada(r.doc));
  }
  for (const r of planes.rows) {
    if (r.estado !== 'entregado') continue;
    const paso = (Array.isArray(r.historial) ? r.historial : []).filter((h) => h?.a === 'entregado' && h.en).pop();
    if (paso) de(r.id_unico)?.otras.push(diaColombia(paso.en));
  }
  for (const r of kits.rows) if (r.f) de(r.id_unico)?.otras.push(diaColombia(r.f));
  for (const r of inv.rows) if (r.f) de(r.id_unico)?.otras.push(diaColombia(r.f));
  for (const r of comp.rows) {
    const l = r.logistica;
    if (l?.entregado && l.entregado_en) de(r.id_unico)?.otras.push(diaColombia(l.entregado_en));
  }
  const ocurrida = (f) => (f && f <= hoy ? f : null);
  for (const [id, f] of fuentes) {
    const fecha = f.master.map(ocurrida).filter(Boolean).sort().at(-1) || f.otras.map(ocurrida).filter(Boolean).sort().at(-1);
    if (fecha) salida.set(id, fecha);
  }
  return salida;
}

// Devuelve la fecha de entrega de una unidad o null.
export async function fechaEntregaUP(db, up) {
  return (await fechasEntregaUPs(db, [up?.id_unico])).get(String(up?.id_unico ?? '')) || null;
}

// Devuelve la entrega y la fecha mínima de la tercera visita para avisarlo en pantalla antes de programarla.
export async function plazoV3(db, up) {
  const entrega = await fechaEntregaUP(db, up);
  return { fecha_entrega: entrega, desde: entrega ? sumarDias(entrega, DIAS_TRAS_ENTREGA) : null, dias: DIAS_TRAS_ENTREGA };
}

const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Exige la entrega registrada para la tercera visita y, si ya tiene fecha, al menos 30 días después de la
// entrega.
export async function exigirEntregaParaV3(db, up, fechaVisita) {
  const entrega = await fechaEntregaUP(db, up);
  if (!entrega) {
    throw new HttpError(409, 'La Visita 3 se registra después de la entrega de los bienes: la unidad no tiene una entrega registrada.');
  }
  const desde = sumarDias(entrega, DIAS_TRAS_ENTREGA);
  if (fechaVisita && fechaVisita < desde) {
    throw solicitudInvalida(`La Visita 3 se programa al menos ${DIAS_TRAS_ENTREGA} días después de la entrega (${entrega}): desde el ${desde}.`);
  }
}
