import { defineConfig } from 'vitest/config';

// Csak a DOM-mentes logika (szimulátor, GPS-konverzió, service worker-lista).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
