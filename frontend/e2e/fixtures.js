// Fixtures: una sesión por rol (iniciada por la API y guardada como storageState) y los objetos de página.
import { test as base, expect, request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CUENTAS } from './cuentas.js';
import { Bitacora } from './paginas/bitacora.js';

const CARPETA = path.resolve('.auth');

/** Inicia sesión por la API (como el navegador: cookie + token CSRF) y guarda el estado para reutilizarlo. */
export async function sesionDe(baseURL, clave) {
  fs.mkdirSync(CARPETA, { recursive: true });
  const archivo = path.join(CARPETA, `${clave}.json`);
  if (fs.existsSync(archivo) && Date.now() - fs.statSync(archivo).mtimeMs < 20 * 60_000) return archivo;
  const ctx = await request.newContext({ baseURL });
  const token = (await (await ctx.get('/api/auth/sesion')).json()).token;
  const c = CUENTAS[clave];
  const r = await ctx.post('/api/auth/login', { data: { usuario: c.usuario, clave: c.clave }, headers: { 'X-CSRF-Token': token } });
  const json = await r.json();
  if (!json.ok) throw new Error(`No entró ${c.usuario}: ${JSON.stringify(json)}`);
  await ctx.storageState({ path: archivo });
  await ctx.dispose();
  return archivo;
}

/**
 * `test.use({ rol: 'gestor' })` en un archivo abre el navegador ya con la sesión de ese rol.
 * `bitacora` es el objeto de página de la Bitácora (encabezado, secciones, búsqueda y ficha).
 */
export const test = base.extend({
  rol: ['general', { option: true }],
  storageState: async ({ baseURL, rol }, use) => { await use(await sesionDe(baseURL, rol)); },
  bitacora: async ({ page }, use) => { await use(new Bitacora(page)); },
});
export { expect };
