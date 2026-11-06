// AW25: a link-előnézet képe (public/og-image.png, 1200×630) a Tempomate névvel, az app ikonjával és a tokenszínekkel.
// Futtatás: node apps/web/scripts/og-image.mjs (Playwright-Chromium, a packages/parity függősége).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { color } from '@atlagsebesseg/design-tokens';

const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const icon = readFileSync(pub('icons/icon-512.png')).toString('base64');
const html = `<html><body style="margin:0;width:1200px;height:630px;background:${color.bg};display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:Inter,-apple-system,'Segoe UI',Arial,sans-serif;color:${color.text}">
<img src="data:image/png;base64,${icon}" style="width:260px;height:260px;border-radius:58px">
<div><div style="font-size:96px;font-weight:800;letter-spacing:-2px">Tempomate</div>
<div style="font-size:36px;line-height:1.3;color:${color.textMuted};margin-top:12px;max-width:640px">Average speed checks · live average, limit and colour code as you drive</div>
<div style="font-size:30px;color:${color.accent};margin-top:28px;font-weight:600">tempomate.app</div></div></body></html>`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.screenshot({ path: pub('og-image.png') });
  await page.close();
} finally {
  await browser.close();
}
console.log('og-image.png kész');
