// ============================================================
// PRUEBAS DE EXTREMO A EXTREMO POR ROL (E14 · LIT-h-05)
// ------------------------------------------------------------
// Recorren la Bitácora en el navegador como cada rol (Coordinador general, Coordinador local regional, gestor, técnico,
// Profesional alianzas, Profesional de seguimiento y tallerista) contra el backend real y una base de pruebas
// propia (bitacora_e2e_test) preparada con backend/scripts/preparar-e2e.js.
//   npm run e2e          (local: compila el frontend sin captcha a dist-e2e y levanta el backend en el 4300 con la base E2E_DATABASE_URL)
//   E2E_BASE_URL=…       para correr contra un servidor ya levantado (la CI lo hace así)
// ============================================================
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const enCI = Boolean(process.env.CI);
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4300';
const baseDatos = process.env.E2E_DATABASE_URL || 'postgres://tester@127.0.0.1:55432/bitacora_e2e_test';

export default defineConfig({
  testDir: './e2e/pruebas',
  fullyParallel: false,       // comparten la misma base y las mismas cuentas: cada archivo es independiente, pero en serie
  workers: 1,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  timeout: 60_000,
  reporter: enCI ? [['list'], ['junit', { outputFile: 'reportes/e2e.xml' }], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    baseURL,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'preparar', testMatch: /preparar\.setup\.js/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['preparar'] },
    { name: 'celular', use: { ...devices['Pixel 7'] }, dependencies: ['preparar'], testMatch: /celular\.spec\.js/ },
  ],
  // Sin E2E_BASE_URL se prepara la base de pruebas y se levanta el backend con el frontend compilado (frontend/dist).
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'node scripts/preparar-e2e.js && node src/server.js',
    cwd: '../backend',
    url: `${baseURL}/api/auth/sesion`,
    reuseExistingServer: !enCI,
    timeout: 120_000,
    env: { PORT: '4300', DATABASE_URL: baseDatos, TURNSTILE_SECRET_KEY: '', JWT_SECRET: 'solo-para-e2e', STORAGE_DIR: 'storage-e2e', NODE_ENV: 'test',
      FRONTEND_DIST: path.resolve('dist-e2e') },
  },
});
