// Bandeja de salida y envío de correo por SMTP. Cada correo queda primero como pendiente en la misma
// transacción que lo origina; después se envía con nodemailer, con hasta 5 reintentos, y queda como enviado o
// fallido. Sin SMTP configurado se quedan pendientes.
import { query } from '../db.js';

const MAX_INTENTOS = 5;
const MAX_POR_RONDA = 50;
const RE_CORREO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

// Indica si una dirección de correo tiene un formato válido.
export const correoValido = (c) => typeof c === 'string' && c.length <= 254 && RE_CORREO.test(c.trim());

// Indica si hay un servidor SMTP configurado.
export const smtpConfigurado = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);

// Deja un correo en la bandeja de salida descartando direcciones inválidas y repetidas; devuelve el id, o null
// si no quedó ninguna.
export async function encolarCorreo(db, { para, asunto, texto, origen, referencia = null, venceEn = null, adjuntos = null, idUp = null }) {
  const destinos = [...new Set((Array.isArray(para) ? para : [para]).filter(correoValido).map((c) => c.trim().toLowerCase()))];
  if (!destinos.length) return null;
  const { rows: [c] } = await db.query(
    `INSERT INTO correos_salida (para, asunto, texto, origen, referencia, vence_en, adjuntos, id_up) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [destinos, String(asunto).slice(0, 300), String(texto).slice(0, 20000), String(origen).slice(0, 60),
      referencia ? String(referencia).slice(0, 120) : null, venceEn, adjuntos?.length ? JSON.stringify(adjuntos) : null, idUp],
  );
  return c.id;
}

// Cancela los correos que aún no salieron de una referencia y devuelve cuántos eran.
export async function cancelarPendientes(db, origen, referencia) {
  const { rowCount } = await db.query(
    `UPDATE correos_salida SET estado = 'cancelado', actualizado_en = now()
      WHERE origen = $1 AND referencia = $2 AND estado IN ('pendiente', 'fallido', 'enviando')`,
    [origen, String(referencia)],
  );
  return rowCount;
}

// Minutos de espera antes de reintentar: 1, 2, 4, 8 y así según los intentos hechos.
const ESPERA_MIN = 1;
// Tiempo tras el cual un correo en estado enviando se considera atascado y se vuelve a intentar.
const ENVIANDO_ATASCADO_MIN = 10;

let transporte = null;
// Crea el transporte de nodemailer con la configuración SMTP.
async function transportador() {
  if (transporte) return transporte;
  const { default: nodemailer } = await import('nodemailer');
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  return transporte;
}

// Envía los correos pendientes o fallidos con intentos disponibles y devuelve cuántos se enviaron y cuántos
// fallaron.
export async function enviarPendientes({ enviar } = {}) {
  if (!enviar && !smtpConfigurado()) return { enviados: 0, fallidos: 0, sin_smtp: true };
  const mandar = enviar || (async (c) => (await transportador()).sendMail({
    from: process.env.SMTP_FROM, to: c.para.join(', '), subject: c.asunto, text: c.texto, attachments: await adjuntosDeCorreo(c),
  }));
  let enviados = 0;
  let fallidos = 0;
  await query(`UPDATE correos_salida SET estado = 'fallido', error = 'Envío interrumpido', actualizado_en = now()
    WHERE estado = 'enviando' AND intentos >= $1 AND actualizado_en < now() - make_interval(mins => $2)`, [MAX_INTENTOS, ENVIANDO_ATASCADO_MIN]);
  const { rowCount: vencidos } = await query(
    `UPDATE correos_salida SET estado = 'vencido', actualizado_en = now()
      WHERE estado IN ('pendiente', 'fallido') AND vence_en IS NOT NULL AND vence_en < now()`);
  for (let i = 0; i < MAX_POR_RONDA; i += 1) {
    const { rows: [c] } = await query(
      `UPDATE correos_salida SET estado = 'enviando', intentos = intentos + 1, actualizado_en = now()
        WHERE id = (SELECT id FROM correos_salida
                     WHERE intentos < $1 AND (
                       estado = 'pendiente'
                       OR (estado = 'fallido' AND (proximo_intento IS NULL OR proximo_intento <= now()))
                       OR (estado = 'enviando' AND actualizado_en < now() - make_interval(mins => $2)))
                     ORDER BY creado_en FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
      [MAX_INTENTOS, ENVIANDO_ATASCADO_MIN],
    );
    if (!c) break;
    try {
      await mandar(c);
      await query("UPDATE correos_salida SET estado = 'enviado', enviado_en = now(), error = NULL, actualizado_en = now() WHERE id = $1 AND estado = 'enviando'", [c.id]);
      enviados += 1;
    } catch (e) {
      await query(
        `UPDATE correos_salida SET estado = 'fallido', error = $2, actualizado_en = now(),
                proximo_intento = now() + make_interval(mins => $3 * power(2, intentos - 1)::int) WHERE id = $1 AND estado = 'enviando'`,
        [c.id, String(e?.message || e).slice(0, 500), ESPERA_MIN]);
      fallidos += 1;
    }
  }
  return { enviados, fallidos, vencidos };
}

// Devuelve los archivos de un correo en el formato de nodemailer.
export async function adjuntosDeCorreo(c) {
  const ids = (Array.isArray(c?.adjuntos) ? c.adjuntos : []).filter((a) => a?.origen === 'ticket' && Number.isInteger(a.id)).map((a) => a.id);
  if (!ids.length) return [];
  const { rows } = await query('SELECT nombre, tipo, contenido FROM tickets_adjuntos WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
  return rows.map((r) => ({ filename: r.nombre, content: r.contenido, contentType: r.tipo }));
}

let reloj = null;
// Envía los pendientes cada cierto intervalo; lo arranca server.js y no corre en las pruebas.
export function iniciarEnvioPeriodico() {
  if (reloj || !smtpConfigurado()) return;
  const cada = Math.max(10_000, Number(process.env.CORREO_INTERVALO_MS || 60_000));
  reloj = setInterval(() => { enviarPendientes().catch((e) => console.error('[correo] envío:', e.message)); }, cada);
  reloj.unref?.();
}

// Devuelve cuántos correos de una referencia están pendientes, enviados o fallidos.
export async function estadoCorreos(db, origen, referencia) {
  const { rows } = await db.query(
    `SELECT estado, count(*)::int AS n FROM correos_salida WHERE origen = $1 AND referencia = $2 GROUP BY estado`,
    [origen, String(referencia)],
  );
  const n = (e) => rows.filter((r) => e.includes(r.estado)).reduce((a, r) => a + r.n, 0);
  return { pendientes: n(['pendiente', 'enviando']), enviados: n(['enviado']), fallidos: n(['fallido']) };
}
