// AW25b: az App Store-adatlap (listing.md) hosszainak mérése az App Store Connect korlátaihoz.
// Használat: node docs/store/listing-check.mjs  (hibánál 1-es kóddal lép ki; a kimenet nyelvenként a mért értékek)
import { readFileSync } from 'node:fs';

const LIMITS = { name: 30, subtitle: 30, promo: 170, description: 4000, keywords: 100, whatsNew: 4000 };
const ORDER = ['name', 'subtitle', 'promo', 'description', 'keywords', 'whatsNew'];
const LANGS = ['hu', 'en', 'de', 'sk', 'cs', 'pl'];

const md = readFileSync(new URL('./listing.md', import.meta.url), 'utf8');
const sections = md.split(/^## /m).slice(1);
let bad = 0;
const seen = [];
for (const sec of sections) {
  const lang = sec.split('\n')[0].trim();
  seen.push(lang);
  // a mezők sorrendben: **Címke:** érték (a leírás a címke utáni sorokban, a következő címkéig)
  const parts = sec.split(/^\*\*[^*\n]+:\*\*/m).slice(1).map((p) => p.replace(/\n---\s*$/, '').trim());
  if (parts.length !== ORDER.length) {
    console.log(`${lang}: ${parts.length} mező a várt ${ORDER.length} helyett`);
    bad++;
    continue;
  }
  const f = Object.fromEntries(ORDER.map((k, i) => [k, parts[i]]));
  const len = {
    name: [...f.name].length,
    subtitle: [...f.subtitle].length,
    promo: [...f.promo].length,
    description: [...f.description].length,
    keywords: Buffer.byteLength(f.keywords, 'utf8'),
    whatsNew: [...f.whatsNew].length,
  };
  const over = ORDER.filter((k) => len[k] > LIMITS[k] || len[k] === 0);
  if (/,\s/.test(f.keywords)) over.push('keywords: szóköz vessző után');
  console.log(`${lang}: ${ORDER.map((k) => `${k} ${len[k]}/${LIMITS[k]}`).join(', ')}${over.length ? `  ← HIBA: ${over.join(', ')}` : ''}`);
  bad += over.length;
}
const missing = LANGS.filter((l) => !seen.includes(l));
if (missing.length) {
  console.log(`hiányzó nyelv: ${missing.join(', ')}`);
  bad++;
}
process.exit(bad ? 1 : 0);
