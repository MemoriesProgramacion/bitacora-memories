// Antes de las pruebas: se borran las sesiones guardadas. La base E2E la prepara el webServer de playwright.config.js
// (backend/scripts/preparar-e2e.js); con E2E_BASE_URL (la CI) la prepara el job antes de levantar el servidor.
import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

setup('limpia las sesiones guardadas', () => {
  fs.rmSync(path.resolve('.auth'), { recursive: true, force: true });
});
