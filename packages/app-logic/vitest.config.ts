import { defineConfig } from 'vitest/config';

// Csak a React Native-mentes logika (src/logic) tesztje.
export default defineConfig({ test: { include: ['src/logic/**/*.test.ts'] } });
