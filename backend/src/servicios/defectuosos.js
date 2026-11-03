// Actas de elementos defectuosos en la entrega. Una novedad de kit dañado o incompleto es un acta con
// seguimiento: reportada, devuelta al proveedor y reemplazada, sin mover stock. Quien coordina el territorio de
// la unidad recibe un aviso por correo al reportarla y consulta las actas de su territorio.
import PDFDocument from 'pdfkit';
import { query, transaccion } from '../db.js';
import { ROLES } from '../config.js';
import { HttpError, noEncontrado, prohibido } from '../errores.js';
import { entero } from '../util.js';
import { COLUMNAS_UP, condicionAlcance, normTexto, CAMPOS_ALCANCE } from '../alcance.js';
import { encolarCorreo } from './correo.js';
import { registrar } from './actividad.js';

export const TIPOS_DEFECTO = ['danado', 'incompleto'];
export const ESTADOS_DEFECTO = { reportada: 'Reportada', devuelta: 'Devuelta al proveedor', reemplazada: 'Reemplazada' };
const NOMBRE_TIPO = { danado: 'Dañado', incompleto: 'Incompleto', otro: 'Otro' };
const LECTORES = [ROLES.COORDINADOR, ROLES.TECNICO, ROLES.COMPRAS];
// Usuarios que consultan las actas, también desde el expediente documental.
export const LECTORES_DEFECTUOSOS = LECTORES;
const MAX_ID = 2147483647;
const MAX_FOTOS_PDF = 8;
const MAX_BYTES_FOTO_PDF = 2 * 1024 * 1024;

// SQL que obtiene el ID único de la unidad de un kit por su nombre: la que tiene ese ID o, si no, la única con
// ese nombre.
export const SQL_UP_DE_KIT = (col) => `COALESCE(
  (SELECT u_k.id_unico FROM public.unidades_productivas u_k WHERE lower(btrim(u_k.id_unico)) = lower(btrim(${col})) LIMIT 1),
  (SELECT max(u_k.id_unico) FROM public.unidades_productivas u_k WHERE lower(btrim(u_k.nombre)) = lower(btrim(${col})) HAVING count(*) = 1))`;

// La misma regla en bloque para consultas de muchos kits, sin subconsulta por fila.
export const CTE_UP_DE_KIT = `kit_ids AS (SELECT lower(btrim(id_unico)) AS k, min(id_unico) AS id_unico FROM public.unidades_productivas GROUP BY 1),
  kit_nombres AS (SELECT lower(btrim(nombre)) AS k, max(id_unico) AS id_unico FROM public.unidades_productivas GROUP BY 1 HAVING count(*) = 1)`;
export const JOIN_UP_DE_KIT = (col, a = 'kup') => `LEFT JOIN kit_ids ${a}_i ON ${a}_i.k = lower(btrim(${col}))
  LEFT JOIN kit_nombres ${a}_n ON ${a}_n.k = lower(btrim(${col}))`;
export const ID_UP_DE_KIT = (a = 'kup') => `COALESCE(${a}_i.id_unico, ${a}_n.id_unico)`;

// Devuelve el ID único de la unidad de un kit por su nombre, o null.
export async function idUnicoDeKit(db, nombreKit) {
  const { rows } = await db.query(`SELECT ${SQL_UP_DE_KIT('$1::text')} AS id_unico`, [String(nombreKit || '')]);
  return rows[0]?.id_unico || null;
}

// Devuelve los correos de las cuentas activas cuyo territorio incluye la unidad; los datos vacíos no
// restringen.
export async function correosCoordinacion(db, idUnico) {
  if (!idUnico) return [];
  const { rows: [up] } = await db.query(
    `SELECT t.region, t.nodo, up.departamento, up.modalidad FROM public.unidades_productivas up
       LEFT JOIN public.triadas t ON t.id_triada = up.id_triada WHERE up.id_unico = $1`, [idUnico]);
  if (!up) return [];
  const { rows } = await db.query(
    `SELECT correo, region, departamento, modalidad, nodo FROM public.coordinadores
      WHERE tipo = 'coordinador' AND activo AND correo IS NOT NULL AND btrim(correo) <> ''`);
  return rows.filter((c) => {
    const campos = CAMPOS_ALCANCE.filter((k) => normTexto(c[k]));
    return campos.length > 0 && campos.every((k) => normTexto(c[k]) === normTexto(up[k]));
  }).map((c) => c.correo);
}

// Encola el aviso del acta para quien coordina la unidad y devuelve el id del correo o null.
export async function avisarDefectuoso(db, { id, idUnico, kit, tipo, texto, articulos, por }) {
  const para = await correosCoordinacion(db, idUnico);
  if (!para.length) return null;
  return encolarCorreo(db, {
    para, origen: 'kit_defectuoso', referencia: id,
    asunto: `Acta de elementos defectuosos · ${kit} (U.P. ${idUnico})`,
    texto: [
      `Se reportó una novedad de elementos defectuosos en la entrega del kit «${kit}» de la unidad productiva ${idUnico}.`, '',
      `Tipo: ${NOMBRE_TIPO[tipo] || tipo}`,
      `Elementos: ${articulos.map((a) => `${a.cantidad} × ${a.nombre}`).join(', ')}`,
      `Descripción: ${texto}`,
      `Reportó: ${por}`, '',
      'Consulte el acta y dé por recibido el reporte en la Bitácora: Entregas › Elementos defectuosos.',
    ].join('\n'),
  });
}

// Arma la consulta de actas con sus unidades y kits.
const conTipos = () => [TIPOS_DEFECTO];
async function consultarActas(where, params, { fotos = false } = {}) {
  const { rows } = await query(
    `SELECT n.id, n.tipo, n.texto, n.creado_por, n.creado, n.estado, n.reporte, n.devolucion, n.reemplazo,
            (n.reemplazo_soporte IS NOT NULL) AS reemplazo_con_soporte, c.id AS kit_id, c.nombre AS kit, c.codigo_barras,
            up.id_unico, up.nombre AS unidad, up.municipio, up.departamento, up.modalidad, t.nodo, t.region,
            COALESCE((SELECT json_agg(json_build_object('articulo_id', na.articulo_id, 'nombre', na.nombre, 'cantidad', na.cantidad,
                        'con_foto', na.foto IS NOT NULL) ORDER BY na.nombre)
                        FROM inventario.kit_novedad_articulos na WHERE na.novedad_id = n.id), '[]') AS articulos
       FROM inventario.kit_novedades n
       JOIN LATERAL (SELECT combo_id FROM inventario.kit_novedad_kits WHERE novedad_id = n.id ORDER BY combo_id LIMIT 1) k ON TRUE
       JOIN inventario.combos c ON c.id = k.combo_id
       LEFT JOIN public.unidades_productivas up ON up.id_unico = COALESCE(n.id_unico, ${SQL_UP_DE_KIT('c.nombre')})
       LEFT JOIN public.triadas t ON t.id_triada = up.id_triada
      WHERE n.tipo = ANY($1::text[]) AND (${where})
      ORDER BY n.creado DESC, n.id DESC LIMIT 300`,
    params,
  );
  if (!fotos || !rows.length) return rows;
  const { rows: imgs } = await query(
    `SELECT novedad_id, articulo_id, octet_length(foto) <= $2 AS cabe, CASE WHEN octet_length(foto) <= $2 THEN foto END AS foto
       FROM inventario.kit_novedad_articulos WHERE novedad_id = ANY($1::int[]) AND foto IS NOT NULL`,
    [rows.map((r) => r.id), MAX_BYTES_FOTO_PDF]);
  return rows.map((r) => ({ ...r, articulos: r.articulos.map((a) => {
    const img = imgs.find((i) => i.novedad_id === r.id && i.articulo_id === a.articulo_id);
    return { ...a, foto: img?.foto || null, foto_grande: Boolean(img && !img.cabe) };
  }) }));
}

const vistaActa = (usuario) => (n) => ({
  ...n,
  nombre_tipo: NOMBRE_TIPO[n.tipo] || n.tipo,
  estado: n.estado || 'reportada',
  nombre_estado: ESTADOS_DEFECTO[n.estado || 'reportada'],
  puede_recibir: usuario?.rol === ROLES.COORDINADOR && !n.reporte,
});

function exigirLector(usuario) {
  if (!LECTORES.includes(usuario?.rol)) throw prohibido('Tu usuario no consulta las actas de elementos defectuosos.');
}

// Lista las actas del alcance del usuario, filtrables por estado.
export async function listarDefectuosos(usuario, { estado } = {}) {
  exigirLector(usuario);
  const params = conTipos();
  let where = condicionAlcance(usuario, COLUMNAS_UP, params);
  if (ESTADOS_DEFECTO[estado]) { params.push(estado); where = `(${where}) AND COALESCE(n.estado, 'reportada') = $${params.length}`; }
  return { ok: true, items: (await consultarActas(where, params)).map(vistaActa(usuario)) };
}

// Devuelve un acta visible para el usuario o un error 404.
async function actaVisible(usuario, id, opciones) {
  const nid = entero(id);
  if (!nid || nid < 1 || nid > MAX_ID) throw noEncontrado('El acta no existe.');
  const params = conTipos();
  const alcance = condicionAlcance(usuario, COLUMNAS_UP, params);
  params.push(nid);
  const [n] = await consultarActas(`(${alcance}) AND n.id = $${params.length}`, params, opciones);
  if (!n) throw noEncontrado('El acta no existe.');
  return n;
}

// Da por recibido el reporte del acta, una sola vez.
export async function marcarRecibido(usuario, { id } = {}) {
  if (usuario?.rol !== ROLES.COORDINADOR) throw prohibido('El reporte lo da por recibido el Coordinador local regional.');
  const n = await actaVisible(usuario, id);
  const reporte = { por: usuario.nombre || usuario.sub, rol: usuario.rol, en: new Date().toISOString() };
  await transaccion(async (db) => {
    const { rows: [fila] } = await db.query('SELECT reporte FROM inventario.kit_novedades WHERE id = $1 FOR UPDATE', [n.id]);
    if (fila?.reporte) throw new HttpError(409, `El reporte ya se dio por recibido (${fila.reporte.por}).`);
    await db.query('UPDATE inventario.kit_novedades SET reporte = $2 WHERE id = $1', [n.id, JSON.stringify(reporte)]);
  });
  await registrar(usuario, { accion: 'kit_defectuoso.reporte_recibido', objeto: { tipo: 'kit_novedad', id: n.id }, idUnico: n.id_unico, cambios: { campos: { reporte: [null, reporte.por] } } });
  return { ok: true, item: vistaActa(usuario)({ ...n, reporte }) };
}

const fechaLarga = (x) => (x ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date(x)) : '—');

// Genera el PDF del acta con sus fotos, usado por la Bitácora y el Inventario.
export async function pdfActa(n) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Acta de elementos defectuosos ${n.id}` } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));
  const titulo = (t) => { if (doc.y > 650) doc.addPage(); doc.moveDown(0.6).fontSize(12).fillColor('#000').text(t).fontSize(10); };
  doc.fontSize(15).text('Acta de novedad · Elementos defectuosos en la entrega');
  doc.fontSize(10).fillColor('#555').text(`Fundación Memories · Acta N.º ${String(n.id).padStart(5, '0')} · ${fechaLarga(n.creado)}`).fillColor('#000');
  titulo('Unidad productiva y kit');
  doc.text(n.id_unico ? `${n.unidad || ''} (ID ${n.id_unico}) · ${[n.municipio, n.departamento].filter(Boolean).join(', ') || 'sin ubicación'} · Nodo ${n.nodo || '—'} · Región ${n.region || '—'}`
    : 'No se encontró la unidad productiva del kit.');
  doc.text(`Kit: ${n.kit} (${n.codigo_barras || '—'})`);
  titulo('Novedad');
  doc.text(`Tipo: ${NOMBRE_TIPO[n.tipo] || n.tipo} · Reportó: ${n.creado_por}`);
  doc.text(`Descripción: ${n.texto}`);
  titulo('Elementos afectados');
  let incluidas = 0;
  for (const a of n.articulos || []) {
    if (doc.y > 600) doc.addPage();
    doc.text(`· ${a.cantidad} × ${a.nombre}`);
    if (a.foto && incluidas < MAX_FOTOS_PDF) {
      try { doc.image(a.foto, { fit: [160, 120] }); doc.moveDown(0.3); incluidas += 1; } catch { doc.fillColor('#777').text('   (la foto no se pudo incluir)').fillColor('#000'); }
    } else if (a.foto || a.foto_grande) {
      doc.fillColor('#777').text('   (la foto se consulta en la novedad del kit, en el Inventario)').fillColor('#000');
    }
  }
  titulo('Seguimiento');
  const r = n.reporte;
  doc.text(`Reporte al Líder Operativo (Coordinador local regional): ${r ? `recibido por ${r.por} el ${fechaLarga(r.en)}` : 'pendiente de recibir'}`);
  const d = n.devolucion;
  doc.text(`Devolución al proveedor: ${d ? `${d.proveedor} el ${d.fecha}${d.guia ? ` · guía ${d.guia}` : ''}${d.nota ? ` · ${d.nota}` : ''}` : 'pendiente'}`);
  const z = n.reemplazo;
  doc.text(`Reemplazo entregado a la unidad: ${z ? `${z.fecha}${z.nota ? ` · ${z.nota}` : ''}` : 'pendiente'}`);
  doc.text(`Estado: ${ESTADOS_DEFECTO[n.estado || 'reportada']}`);
  doc.moveDown(2);
  if (doc.y > 620) doc.addPage();
  const y = doc.y + 30;
  doc.moveTo(50, y).lineTo(260, y).stroke().moveTo(330, y).lineTo(540, y).stroke();
  doc.text('Responsable de la entrega', 50, y + 5, { width: 210 }).text('Nombre:', 50, y + 20);
  doc.text('Unidad productiva (beneficiario)', 330, y + 5, { width: 210 }).text('Nombre:', 330, y + 20);
  doc.end();
  await fin;
  return { buffer: Buffer.concat(partes), nombre: `acta-elementos-defectuosos-${String(n.id).padStart(5, '0')}.pdf` };
}

// Devuelve el PDF del acta para la Bitácora si el usuario la puede ver.
export async function actaDefectuoso(usuario, { id } = {}) {
  exigirLector(usuario);
  return pdfActa(await actaVisible(usuario, id, { fotos: true }));
}

// Devuelve el acta por id sin comprobar alcance, para el Inventario, que ya controla su acceso.
export async function actaPorId(id, opciones) {
  const [n] = await consultarActas('n.id = $2', [...conTipos(), Number(id)], opciones);
  return n || null;
}
