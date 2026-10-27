import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

/**
 * A service worker build-időben készül: az app shell (index.html + minden hash-elt asset) listája
 * és a verzió kerül a sablonba. A térkép-csempék és a Supabase (más origin) nem cache-elődnek.
 */
function serviceWorker(): Plugin {
  return {
    name: 'atlag-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicFiles = (readdirSync(new URL('./public', import.meta.url), { recursive: true }) as string[])
        .filter((f) => f.includes('.'))
        .map((f) => f.split('\\').join('/'));
      // a nem latin betű-alkészleteket a böngésző úgysem tölti le (unicode-range)
      const files = [...Object.keys(bundle), ...publicFiles].filter((f) => !f.endsWith('.map') && !/inter-(?!latin)/.test(f));
      const shell = ['/', ...files.map((f) => `/${f}`)];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw/sw-template.js', import.meta.url), 'utf8')
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(async () => {
  const plugins: PluginOption[] = [react(), serviceWorker()];
  // HTTPS a helyi hálózathoz (iPhone): a geolocation csak biztonságos környezetben megy.
  if (process.env.HTTPS) {
    const { default: mkcert } = await import('vite-plugin-mkcert');
    plugins.push(mkcert());
  }
  return {
    plugins,
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    // a Mapbox GL önmagában ~1,9 MB (külön, lustán töltött chunk)
    build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  };
});
