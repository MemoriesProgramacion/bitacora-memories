import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // En desarrollo, /api se redirige al backend (carpeta backend/).
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    build: {
      // `vite build --mode e2e` compila a dist-e2e sin la verificación humana (ver .env.e2e): lo usan las pruebas de extremo a extremo.
      outDir: mode === 'e2e' ? 'dist-e2e' : 'dist',
      sourcemap: false,
    },
    test: {
      // Las pruebas de vitest viven en tests/; las de e2e/ son de Playwright (npm run e2e).
      include: ['tests/**/*.test.{js,jsx}'],
      // `npm run test:cobertura` (y la CI): la lógica de las pantallas no puede perder cobertura. Los pisos son la
      // medición de E14 · LIT-h-02; súbelos cuando suba la cobertura, nunca los bajes. Las pantallas (JSX) las cubren
      // además las pruebas de extremo a extremo de e2e/.
      coverage: {
        provider: 'v8',
        include: ['src/lib/**', 'src/inventario/lib/**'],
        reporter: ['text-summary', 'json-summary', 'html'],
        reportsDirectory: 'reportes/cobertura',
        thresholds: { lines: 70, statements: 69, branches: 65, functions: 64 },
      },
    },
  };
});
