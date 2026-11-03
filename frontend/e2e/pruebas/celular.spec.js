// En un celular (Pixel 7): el ingreso, la Bitácora y Seguimiento se usan sin desplazamiento horizontal.
import { test, expect } from '../fixtures.js';

test.describe('celular', () => {
  test.use({ rol: 'general' });

  test('la Bitácora y el Seguimiento caben en la pantalla', async ({ bitacora, page }) => {
    await bitacora.abrir();
    const sinDesborde = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await sinDesborde()).toBe(true);
    await bitacora.irA('Seguimiento');
    await expect(page.getByRole('tab', { name: 'Panel' })).toBeVisible();
    await expect(page.getByText('Unidades en el programa', { exact: true })).toBeVisible();
    expect(await sinDesborde()).toBe(true);
    await page.getByRole('tab', { name: 'Ruta por unidad' }).click();
    await expect(page.getByText('Avance de la ruta por unidad')).toBeVisible();
    expect(await sinDesborde()).toBe(true);
  });
});
