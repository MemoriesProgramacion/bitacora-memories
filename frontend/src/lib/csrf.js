// Token CSRF de la sesión. La sesión viaja en una cookie que el navegador manda sola, así que cada escritura
// debe llevar además este token en la cabecera X-CSRF-Token. Se guarda solo en memoria.
import { API_BASE } from './config';

let csrf = null;

// Guarda el token de la sesión en memoria, nunca en el almacenamiento del navegador.
export function fijarCsrf(token) {
  if (token) csrf = token;
}

export function tokenCsrf() {
  return csrf;
}

// Pide un token nuevo al servidor, la primera vez o cuando el anterior venció.
export async function renovarCsrf() {
  const r = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'same-origin', cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (j && j.token) csrf = j.token;
  return csrf;
}

// Devuelve las cabeceras de sesión para las peticiones propias que no pasan por fetchApi.
export function cabecerasSesion() {
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}
