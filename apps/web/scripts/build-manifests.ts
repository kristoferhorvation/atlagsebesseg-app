// AW25: a webmanifest nyelvenként (public/manifest.<nyelv>.webmanifest) a szótárból. A böngésző a blob-URL-es manifestet telepítéskor
// nem fogadja el, ezért statikus fájl kell; a magyar a régi `manifest.webmanifest` marad. `npm run manifests -w @atlagsebesseg/web`,
// a `test/manifest.test.ts` bukik, ha a szótár változott és a fájl nem.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICTIONARIES, LANGUAGES, type Lang } from '@atlagsebesseg/app-logic';
import { color } from '@atlagsebesseg/design-tokens';

const here = dirname(fileURLToPath(import.meta.url));
export const PUBLIC = join(here, '..', 'public');
export const manifestFile = (l: Lang) => (l === 'hu' ? 'manifest.webmanifest' : `manifest.${l}.webmanifest`);

export function manifest(l: Lang): string {
  const d = DICTIONARIES[l];
  const m = {
    name: d['app.name'],
    short_name: l === 'hu' ? 'Átlag' : d['ios.displayName'],
    description: d['app.description'],
    lang: l,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: color.bg,
    theme_color: color.bg,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return `${JSON.stringify(m, null, 2).replace(/\{\n\s+("src"[^}]*)\n\s+\}/g, (_, x: string) => `{ ${x.replace(/\n\s+/g, ' ')} }`)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const l of LANGUAGES) if (l !== 'hu') writeFileSync(join(PUBLIC, manifestFile(l)), manifest(l));
  console.log('manifest: 5 nyelv');
}
