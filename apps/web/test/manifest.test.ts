import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@atlagsebesseg/app-logic';
import { manifest, manifestFile, PUBLIC } from '../scripts/build-manifests';

describe('AW25: webmanifest nyelvenként', () => {
  it('mind a 6 nyelv statikus fájlban, a szótárból (npm run manifests); a magyar a régi manifest.webmanifest', () => {
    for (const l of LANGUAGES) expect(readFileSync(join(PUBLIC, manifestFile(l)), 'utf8'), l).toBe(manifest(l));
    expect(JSON.parse(manifest('en')).name).toBe('Tempomate');
    expect(JSON.parse(manifest('hu')).name).toBe('Átlagsebesség');
  });

  it('a nyelvváltás a statikus fájlra mutat, nem blob-URL-re; robots.txt és OG-kép a helyén', () => {
    const src = readFileSync(join(PUBLIC, '..', 'src', 'i18n.tsx'), 'utf8');
    expect(src).toContain('`/manifest.${lang}.webmanifest`');
    expect(src).not.toContain('createObjectURL');
    expect(readFileSync(join(PUBLIC, 'robots.txt'), 'utf8')).toContain('User-agent: *');
    expect(readFileSync(join(PUBLIC, 'og-image.png')).subarray(1, 4).toString()).toBe('PNG');
    expect(readFileSync(join(PUBLIC, '..', 'index.html'), 'utf8')).toContain('og:image');
  });
});
