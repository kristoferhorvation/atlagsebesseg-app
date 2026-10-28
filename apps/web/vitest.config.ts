import { defineConfig } from 'vitest/config';

// Csak a DOM-mentes logika (szimulátor, GPS-konverzió, service worker-lista) + a felirat-őr (test/).
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } });
