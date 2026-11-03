// Un flujo propio por rol, de extremo a extremo en el navegador.
import { test, expect } from '../fixtures.js';

test.describe('gestor', () => {
  test.use({ rol: 'gestor' });

  test('ve solo las unidades de su nodo y abre una ficha', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await expect(page.getByText('2 registros')).toBeVisible();
    await bitacora.abrirFicha('E2E-1');
    await expect(page.getByRole('heading', { name: 'Unidad E2E-1', level: 2 })).toBeVisible();
    // La unidad del otro nodo no aparece en su lista (y la API tampoco se la entrega).
    await bitacora.abrir();
    await bitacora.buscador.fill('E2E-3');
    await expect(page.getByText('No se encontraron resultados')).toBeVisible();
    const ids = (await (await page.request.get('/api/unidades')).json()).items.map((u) => u.id_unico);
    expect(ids.sort()).toEqual(['E2E-1', 'E2E-2']);
  });

  test('radica un ticket con etapa y lo ve en la bandeja', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Novedades');
    await page.getByRole('tab', { name: /Tickets/ }).click();
    await page.getByRole('button', { name: '+ Nuevo ticket' }).click();
    const form = page.getByRole('region', { name: 'Nuevo ticket' });
    await form.getByLabel('Título').fill('No carga el soporte de la visita');
    await form.getByLabel('Etapa del proceso').selectOption('diagnostico');
    await form.getByLabel('Descripción').fill('Al subir el PDF de la Visita 1 la página se queda cargando.');
    await form.getByRole('button', { name: 'Radicar ticket' }).click();
    await expect(page.getByRole('heading', { name: 'No carga el soporte de la visita' })).toBeVisible();
    await expect(page.getByText(/TK-\d{5}/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Salidas del ticket' }).first()).toContainText('Radicado');
  });
});

test.describe('coordinación local regional', () => {
  test.use({ rol: 'clr' });

  test('atiende el ticket del gestor: lo toma y lo responde', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Novedades');
    await page.getByRole('tab', { name: /Tickets/ }).click();
    await page.getByRole('button', { name: /^Todos/ }).click();
    const tarjeta = page.getByRole('article').filter({ hasText: 'No carga el soporte de la visita' }).first();
    await expect(tarjeta).toBeVisible();
    await tarjeta.getByRole('button', { name: 'Tomar' }).click();
    await expect(tarjeta.getByText('En gestión').first()).toBeVisible();
    await tarjeta.getByLabel('Nota').fill('Era el tamaño del archivo: ya quedó.');
    await tarjeta.getByRole('button', { name: 'Resuelto: enviar respuesta' }).click();
    await expect(tarjeta.getByText('Respondido').first()).toBeVisible();
  });

  test('solo ve las unidades de su región', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await expect(page.getByText('2 registros')).toBeVisible();
  });

  test('publica un aviso a los gestores reales de su región', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Novedades');
    await page.getByRole('button', { name: '+ Nueva novedad' }).click();
    const form = page.getByRole('region', { name: 'Nueva novedad' });
    // Los destinatarios son los gestores activos de su territorio: el de BOLIV1 (Región 2) no aparece.
    await expect(form).toContainText('1 de 1 gestores');
    await form.getByRole('button', { name: 'Ver personas ▾' }).click();
    await expect(form.getByText('Gestor ATLAN1', { exact: true })).toBeVisible();
    await expect(form.getByText('Gestor BOLIV1')).toHaveCount(0);
    await form.getByRole('radio', { name: /Información/ }).click();
    await form.getByLabel('Título').fill('Reunión de gestores E2E');
    await form.getByLabel('Mensaje', { exact: true }).fill('Nos vemos el lunes a las 9 en la sede de la región.');
    await expect(form).toContainText('Se enviará a todos los gestores (1)');
    await form.getByRole('button', { name: 'Publicar novedad' }).click();
    await expect(page.getByText('Reunión de gestores E2E').first()).toBeVisible();
  });
});

test.describe('gestor confirma la solución', () => {
  test.use({ rol: 'gestor' });

  test('confirma el ticket respondido', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Novedades');
    await page.getByRole('tab', { name: /Tickets/ }).click();
    const tarjeta = page.getByRole('article').filter({ hasText: 'No carga el soporte de la visita' }).first();
    await tarjeta.getByRole('button', { name: 'Confirmar solución' }).click();
    await expect(tarjeta.getByText('Solucionado').first()).toBeVisible();
  });

  test('recibe el aviso que le publicó su coordinación', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Novedades');
    await expect(page.getByText('Reunión de gestores E2E').first()).toBeVisible();
    await expect(page.getByText('Nos vemos el lunes a las 9 en la sede de la región.').first()).toBeVisible();
  });
});

test.describe('nivel nacional', () => {
  test.use({ rol: 'general' });

  test('registra las metas y las ve en el panel de seguimiento', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Seguimiento');
    await page.getByRole('tab', { name: 'Metas' }).click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    const fila = page.getByRole('group', { name: 'Fila 1' });
    await fila.getByLabel('Región').fill('Región 1');
    await fila.getByLabel('Modalidad').selectOption('M1');
    await fila.getByLabel('Meta').fill('3000');
    await page.getByRole('button', { name: 'Guardar las metas' }).click();
    await expect(page.getByRole('cell', { name: 'Región 1' }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Panel' }).click();
    await expect(page.getByText('Meta registrada: 3.000')).toBeVisible();
  });

  test('ve el expediente documental y el historial de una unidad', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.abrirFicha('E2E-1');
    await page.getByRole('button', { name: /Expediente documental/ }).click();
    await expect(page.getByRole('link', { name: 'Informe técnico de la unidad (PDF)' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filtrar historial' })).toBeVisible();
  });
});

test.describe('profesional de seguimiento', () => {
  test.use({ rol: 'datos' });

  test('abre el panel para INNPULSA y DPS, sin datos personales', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await bitacora.irA('Seguimiento');
    await expect(page.getByRole('tab', { name: 'Panel' })).toBeVisible();
    await expect(page.getByText('Unidades en el programa', { exact: true })).toBeVisible();
    // El panel es agregado: ni filas por unidad ni documentos de los representantes.
    const panel = await (await page.request.get('/api/seguimiento/panel')).text();
    expect(panel).not.toContain('E2E-1');
    expect(panel).not.toMatch(/900[1-3]/);
  });
});

test.describe('técnico administrativo', () => {
  test.use({ rol: 'tecnico' });

  test('consulta pero el servidor no le deja escribir', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await expect(page.getByText('2 registros')).toBeVisible();
    // Con el token CSRF de su sesión, el servidor igual responde 403: el técnico solo consulta.
    const token = (await (await page.request.get('/api/auth/sesion')).json()).token;
    const r = await page.request.post('/api/metas', { data: { metas: [] }, headers: { 'X-CSRF-Token': token } });
    expect(r.status()).toBe(403);
  });
});

test.describe('Profesional alianzas', () => {
  test.use({ rol: 'compras' });

  test('arranca en Entregas y abre el inventario', async ({ bitacora, page }) => {
    await bitacora.abrir();
    await expect(bitacora.seccion('Entregas')).toHaveAttribute('aria-current', 'page');
    await bitacora.modulos.getByRole('tab', { name: 'Inventario' }).click();
    await expect(page).toHaveURL(/\/inventario/);
  });
});

test.describe('tallerista', () => {
  test.use({ rol: 'tallerista' });

  test('arranca en Talleres de fortalecimiento', async ({ bitacora }) => {
    await bitacora.abrir();
    await expect(bitacora.seccion('Talleres de fortalecimiento')).toHaveAttribute('aria-current', 'page');
  });
});
