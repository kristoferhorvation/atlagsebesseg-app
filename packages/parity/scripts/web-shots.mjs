// Webes képek a paritás-kapuhoz (AOS18): Playwright, a szimulátorral azonos pt-méret, DPR és biztonsági zóna; a térkép helyett
// egyszínű háttér, megállított lejátszás, rögzített óra. A webes kódhoz nem nyúl: minden az oldalba injektálva történik.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { color } from '../../design-tokens/src/index.ts';
import { DEVICES, FIXED_NOW_MS, SAVED_PLACES, TIME_ZONE, WEB_BASE, WORK } from './config.mjs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchBrowser() {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

/** Egy oldal az adott eszköz méretével; az injektált szkript a térképet üresre, a lejátszót állóra teszi. */
export async function openPage(browser, device, settings = null, lang = 'hu') {
  const d = DEVICES[device];
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    timezoneId: TIME_ZONE,
    locale: 'hu-HU',
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FIXED_NOW_MS));
  await ctx.addInitScript(({ saved, settings, lang }) => {
    window.__mapTest = 'blank';
    localStorage.setItem('lang:v1', lang);
    localStorage.setItem('nav:saved:v1', JSON.stringify(saved));
    if (settings) localStorage.setItem('settings:v1', JSON.stringify(settings));
    // a lejátszó időzítője (1000 / speed, speed = 7 vagy 12) nem indul el: a kért mintán áll a szimuláció
    const real = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => (ms > 83 && ms < 84) || (ms > 142 && ms < 143) ? 0 : real(fn, ms, ...rest);
  }, { saved: SAVED_PLACES, settings, lang });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: d.top, bottom: d.bottom, left: 0, right: 0 } });
  return { page, ctx };
}

const FLAT_CSS = (bg) => `
  .app { background: ${bg} !important; }
  .app > .map, .map-fallback, .mapboxgl-map, .mapboxgl-canvas { opacity: 0 !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`;

/** A navsim ablakainak helyettesítése (`WIN1+95` → a 2. ablak eleje + 95). */
export const resolveAt = (s, windows) => s.replace(/WIN(\d)(\+(\d+))?/, (_, w, __, n) => String(windows[Number(w)] + Number(n ?? 0)));

export async function navWindows(browser) {
  const { page, ctx } = await openPage(browser, 'pro');
  await page.goto(`${WEB_BASE}/?navsim&panel=0&heat=ki&speed=7`);
  await page.waitForFunction(() => window.__navSim?.windows, null, { timeout: 60_000 });
  const windows = await page.evaluate(() => window.__navSim.windows);
  await ctx.close();
  return windows;
}

export async function webShot(browser, device, state, windows) {
  const dir = join(WORK, 'web');
  mkdirSync(dir, { recursive: true });
  const { page, ctx } = await openPage(browser, device, null, state.lang ?? 'hu');
  const web = state.web;
  await page.goto(`${WEB_BASE}${resolveAt(web.path, windows)}`);
  await page.addStyleTag({ content: FLAT_CSS(color.parityBackdrop) });
  await page.waitForSelector(web.ready, { timeout: 120_000, state: 'attached' });
  if (web.mini) {
    // AW23: a ManualMini – kézi mérés indul, a harness rögzített órája miatt bökésre zsugorodik
    await page.locator('button[aria-label="Kézi átlagmérés indítása"]').first().click();
    await page.locator('.hud > .card[aria-label="Kézi átlagmérés"] .chip').first().click();
    await page.waitForSelector('.manual-mini', { timeout: 30_000 });
  }
  if (web.recenter) {
    // a térkép elhúzása a szabad részen (a felső kártya alatt, az alsó csoport fölött): a követés kikapcsol, a „Vissza a helyemre” megjelenik
    const box = page.viewportSize();
    await page.mouse.move(box.width / 2, box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.width / 2 + 60, box.height * 0.5 + 50, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('.recenter', { timeout: 15_000 });
  }
  if (web.click) {
    await page.locator(web.click).first().click();
    await page.waitForSelector(web.after, { timeout: 15_000, state: 'attached' });
  }
  if (web.scrollTo) await page.locator(web.scrollTo).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(700);
  const masks = await page.evaluate((sels) => sels.flatMap((s) => [...document.querySelectorAll(s)].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })), web.mask ?? []);
  const file = join(dir, `${device}-${state.id}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await ctx.close();
  return { file, masks };
}
