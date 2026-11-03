// Inicio de sesión por el formulario: clave errada, ingreso correcto y salida.
import { test, expect } from '@playwright/test';
import { CUENTAS } from '../cuentas.js';

test.describe('ingreso', () => {
  test('rechaza la clave errada y entra con la correcta', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    await page.getByLabel('Usuario').fill(CUENTAS.clr.usuario);
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-equivocada');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    await page.getByLabel('Contraseña', { exact: true }).fill(CUENTAS.clr.clave);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await expect(page.getByText(CUENTAS.clr.rol).first()).toBeVisible();

    await page.getByRole('button', { name: 'Salir' }).click();
    // Salir pide confirmación.
    const confirmar = page.getByRole('alertdialog', { name: '¿Seguro que quieres salir?' });
    await confirmar.getByRole('button', { name: 'Sí, salir' }).click();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible({ timeout: 15_000 });
    expect((await page.request.get('/api/unidades')).status()).toBe(401);
  });

  test('sin sesión, la API responde 401 y la pantalla vuelve al ingreso', async ({ page, request }) => {
    expect((await request.get('/api/unidades')).status()).toBe(401);
    await page.goto('/admin/usuarios');
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  });
});
