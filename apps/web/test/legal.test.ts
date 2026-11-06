import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_OUT, legalPages, mdToHtml } from '../scripts/build-legal';

describe('AW25: jogi oldalak (docs/legal → public/legal)', () => {
  it('mind a 4 dokumentum mind a 6 nyelven, és a generált HTML friss (npm run legal)', () => {
    const pages = legalPages();
    expect(pages).toHaveLength(24);
    for (const p of pages) expect(readFileSync(join(LEGAL_OUT, p.file), 'utf8'), p.file).toBe(p.html);
  });

  it('a markdown-részhalmaz: címsor, táblázat, felsorolás alszinttel, idézet, félkövér, link', () => {
    const { title, body } = mdToHtml('# Cím\n\nSzöveg **fontos**, írj: hello@tempomate.app\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- egy:\n  - al\n- kettő\n\n> idézet');
    expect(title).toBe('Cím');
    expect(body).toContain('<strong>fontos</strong>');
    expect(body).toContain('<a href="mailto:hello@tempomate.app">hello@tempomate.app</a>');
    expect(body).toContain('<td>1</td><td>2</td>');
    expect(body).toContain('<li>egy:<ul><li>al</li></ul></li>');
    expect(body).toContain('<blockquote>');
  });
});
