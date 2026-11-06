// AW25: a jogi szövegek (docs/legal/<doc>.<nyelv>.md) statikus HTML-oldalai a web-appba (public/legal/<doc>.<nyelv>.html), hogy a
// Beállítások › Adatvédelem › „Tájékoztató” a saját domainről nyíljon. Generált fájlok: `npm run legal -w @atlagsebesseg/web`;
// a `test/legal.test.ts` bukik, ha a markdown változott és a HTML nem. A markdownnak csak a jogi szövegekben használt részhalmaza:
// címsor, bekezdés, felsorolás (egy szint beljebb is), táblázat, idézet, vízszintes vonal, **félkövér**, *dőlt*, `kód`, URL.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color } from '@atlagsebesseg/design-tokens';

const here = dirname(fileURLToPath(import.meta.url));
export const LEGAL_SRC = join(here, '..', '..', '..', 'docs', 'legal');
export const LEGAL_OUT = join(here, '..', 'public', 'legal');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(https:\/\/[^\s<)]+[^\s<).,;])/g, '<a href="$1">$1</a>')
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+[\w])/g, '<a href="mailto:$1">$1</a>');
}

export function mdToHtml(md: string): { title: string; body: string } {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let title = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) {
      i++;
    } else if (/^#{1,3} /.test(l)) {
      const n = l.indexOf(' ');
      const text = l.slice(n + 1).trim();
      if (n === 1 && !title) title = text;
      out.push(`<h${n}>${inline(text)}</h${n}>`);
      i++;
    } else if (/^---+$/.test(l.trim())) {
      out.push('<hr>');
      i++;
    } else if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...rest] = rows;
      out.push(`<table><thead><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (l.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]!) || (/^\s{2,}\S/.test(lines[i]!) && items.length) || (!lines[i]!.trim() && /^\s{2,}\S/.test(lines[i + 1] ?? '')))) {
        const x = lines[i]!;
        if (!x.trim()) {
          i++;
          continue;
        }
        if (/^\s{2,}([-*]) /.test(x)) items.at(-1)!.sub.push(x.trim().replace(/^[-*] /, ''));
        else if (/^\s{2,}\S/.test(x)) items.at(-1)!.text += ` ${x.trim()}`;
        else items.push({ text: x.replace(/^\s*([-*]|\d+\.) /, ''), sub: [] });
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${tag}>`);
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,3} |\||>|\s*([-*]|\d+\.) |---+$)/.test(lines[i]!)) buf.push(lines[i++]!.trim());
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
  }
  return { title, body: out.join('\n') };
}

export function page(md: string, lang: string): string {
  const { title, body } = mdToHtml(md);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>${esc(title)}</title>
<!-- GENERÁLT FÁJL – npm run legal -w @atlagsebesseg/web (docs/legal). Ne szerkeszd. -->
<style>
body{margin:0;background:${color.bg};color:${color.text};font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;line-height:1.25}h2{font-size:20px;margin-top:32px}h3{font-size:17px;margin-top:24px}
a{color:${color.accent}}code{font-size:14px}hr{border:0;border-top:1px solid ${color.textFaint};margin:32px 0}
blockquote{margin:16px 0;padding:8px 14px;border-left:3px solid ${color.textFaint};color:${color.textMuted}}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto;font-size:14px}th,td{border:1px solid ${color.textFaint};padding:6px 8px;text-align:left;vertical-align:top}
</style>
</head>
<body><main>
${body}
</main></body>
</html>
`;
}

/** A forrás → cél párok (a teszt is ebből ellenőriz). */
export function legalPages(): { file: string; html: string }[] {
  return readdirSync(LEGAL_SRC)
    .filter((f) => /^(privacy|terms|support|imprint)\.(hu|en|de|sk|cs|pl)\.md$/.test(f))
    .sort()
    .map((f) => ({ file: f.replace(/\.md$/, '.html'), html: page(readFileSync(join(LEGAL_SRC, f), 'utf8'), f.split('.')[1]!) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(LEGAL_OUT, { recursive: true });
  for (const p of legalPages()) writeFileSync(join(LEGAL_OUT, p.file), p.html);
  console.log(`${legalPages().length} jogi oldal: ${LEGAL_OUT}`);
}
