// Cada rol entra, ve sus módulos y sus secciones, y no ve las que no le corresponden (la matriz de roles en el navegador).
import { test, expect } from '../fixtures.js';
import { CUENTAS, SECCIONES } from '../cuentas.js';

for (const clave of Object.keys(CUENTAS)) {
  test.describe(`rol: ${CUENTAS[clave].rol}`, () => {
    test.use({ rol: clave });

    test('ve sus módulos y sus secciones', async ({ bitacora }) => {
      await bitacora.abrir();
      expect(await bitacora.nombresModulos()).toEqual(CUENTAS[clave].modulos);
      const secciones = await bitacora.nombresSecciones();
      for (const s of SECCIONES[clave].ve) expect(secciones, `${clave} debe ver ${s}`).toContain(s);
      for (const s of SECCIONES[clave].noVe) expect(secciones, `${clave} no debe ver ${s}`).not.toContain(s);
    });

    test('el servidor cierra lo que la pantalla no muestra', async ({ page }) => {
      // Lo que cada rol no tiene en pantalla tampoco lo entrega la API (control de acceso en el servidor).
      const r = await page.request.get('/api/admin/usuarios');
      expect([200, 403]).toContain(r.status());
      expect(r.status() === 200).toBe(CUENTAS[clave].modulos.includes('Administración'));
      if (clave === 'tallerista') expect((await page.request.get('/api/unidades')).status()).toBe(403);
    });
  });
}
