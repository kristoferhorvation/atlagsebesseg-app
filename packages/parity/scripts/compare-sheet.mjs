// AW25: régi ↔ új összehasonlító lap (képpárok soronként, címkével) – pl. a hőtérkép AW24 (Mapbox-illesztés) ↔ AW25 (saját rács-illesztő).
// Használat: node packages/parity/scripts/compare-sheet.mjs <kimenet.png> <cím> <régi1.png> <új1.png> [<régi2.png> <új2.png> …]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [out, title, ...files] = process.argv.slice(2);
const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
const rows = [];
for (let i = 0; i < files.length; i += 2) rows.push([files[i], files[i + 1]]);
const html = `<html><body style="margin:0;background:#06070A;color:#F4F6FA;font:600 22px Inter,-apple-system,Arial,sans-serif;padding:24px">
<div style="font-size:30px;margin-bottom:16px">${title}</div>
${rows.map(([a, b]) => `<div style="display:flex;gap:24px;margin-bottom:28px">${[a, b].map((f, k) => `<div><div style="margin-bottom:8px;color:${k ? '#2EE59D' : '#A3A9B5'}">${k ? 'ÚJ' : 'RÉGI'} · ${basename(f)}</div><img src="${img(f)}" style="height:900px;border-radius:16px"></div>`).join('')}</div>`).join('')}
</body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.setContent(html);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
} finally {
  await browser.close();
}
console.log(out);
