// Verificación humana con Cloudflare Turnstile. El formulario de ingreso entrega un token y este módulo lo
// confirma con Cloudflare desde el servidor, sin exponer la llave secreta.
import { config } from '../config.js';

// Indica si la verificación está configurada y debe exigirse.
export const captchaActivo = () => Boolean(config.turnstileSecret);

// Devuelve true solo si Cloudflare confirma el token; ante cualquier fallo de red responde false.
export async function verificarCaptcha(token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  try {
    const cuerpo = new URLSearchParams({ secret: config.turnstileSecret, response: token });
    if (ip) cuerpo.set('remoteip', ip);
    const res = await fetch(config.turnstileVerifyUrl, {
      method: 'POST',
      body: cuerpo,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('[captcha] Cloudflare respondió', res.status);
      return false;
    }
    const datos = await res.json();
    if (!datos.success) console.info('[captcha] Token rechazado:', datos['error-codes']);
    return datos.success === true;
  } catch (err) {
    console.error('[captcha] No se pudo validar con Cloudflare:', err.message);
    return false;
  }
}
