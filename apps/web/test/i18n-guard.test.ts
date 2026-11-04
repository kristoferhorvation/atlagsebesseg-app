import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md-szabály: felhasználónak szóló felirat csak a szótárba (packages/app-logic/src/i18n), mind a
 * 6 nyelven. Ez az őr a webes forrásban keres magyar ékezetes betűt a kommenteken kívül – ha ilyet talál,
 * valaki a szótár megkerülésével írt feliratot. A szimulátor (sim/, SimPanel) kivétel.
 */
const SRC = join(__dirname, '..', 'src');
const EXEMPT = ['sim/', 'ui/SimPanel.tsx'];
/** Szimulátor-felirat és tesztfájl-leírás nem felhasználói szöveg. */
const allowedLine = (l: string) => l.includes("key: 'sim'");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f: string) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) && !f.endsWith('.css') ? [p] : [];
  });
}

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');

describe('nincs szótáron kívüli felirat a webes kódban', () => {
  for (const file of files(SRC)) {
    const rel = relative(SRC, file);
    if (EXEMPT.some((e) => rel.startsWith(e)) || /\.test\.tsx?$/.test(rel)) continue;
    it(rel, () => {
      const hits = stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter((x) => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(x.line) && !allowedLine(x.line));
      expect(hits, 'magyar felirat a kódban – a szótárba való').toEqual([]);
    });
  }
});

/** AW21: a feliratok logikája az app-logic-ban van – ott sincs magyar felirat (a hibaüzenet-kivételek a `throw` / `Error(` sorok: belső, nem jelenik meg). */
describe('nincs szótáron kívüli felirat az app-logic kódban', () => {
  const LOGIC = join(__dirname, '..', '..', '..', 'packages', 'app-logic', 'src');
  for (const file of files(LOGIC)) {
    const rel = relative(LOGIC, file);
    if (rel.startsWith('i18n/') || rel.includes('/fixtures/') || /\.test\.tsx?$/.test(rel)) continue;
    it(rel, () => {
      const hits = stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter((x) => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(x.line) && !/\b(throw|Error\()/.test(x.line));
      expect(hits, 'magyar felirat az app-logicban – a szótárba való').toEqual([]);
    });
  }
});

describe('AW21: a nyelv az app nyelve, nem a böngészőé / nem beégetett hu', () => {
  for (const file of [...files(SRC), ...files(join(__dirname, '..', '..', '..', 'packages', 'app-logic', 'src'))]) {
    if (/\.test\.tsx?$/.test(file) || /\/(sim)\//.test(file) || file.endsWith('SimPanel.tsx')) continue;
    it(relative(join(__dirname, '..', '..', '..'), file), () => {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(src).not.toMatch(/toLocale(Date|Time)?String\(\s*(undefined|['"]hu)/);
      expect(src).not.toMatch(/Intl\.\w+\(\s*['"]hu/);
    });
  }
});
