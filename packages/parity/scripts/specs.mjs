// Komponens-spec export (AOS18): a jóváhagyott webes komponensek computed style-ja és mért mérete → docs/parity/specs/*.json.
// Az iOS AppTests (`ParityTests.swift`) ezekre assertál. `npm run parity:specs`; web-változás után újra kell futtatni.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, WEB_BASE } from './config.mjs';
import { launchBrowser, navWindows, openPage, resolveAt } from './web-shots.mjs';

const NAVSIM = '/?navsim&panel=0&heat=ki&speed=7';
const AT = (n) => `/?navsim&stage=nav&panel=0&speed=7&at=WIN1+${n}`;
/**
 * Komponensek: `file` a webes forrás, `path` az állapot, `parts` névvel ellátott szelektorok. `click` / `recenter`: a megjelenítés előtti lépés.
 * `box`: ezek méretét méri az AppTests (a többi rész a tokeneken át).
 */
const COMPONENTS = [
  { name: 'start', file: 'apps/web/src/ui/StartScreen.tsx', path: '/', parts: { root: '.start', title: '.start h1', mark: '.start-mark', tagline: '.start p', tip: '.start li', go: '.start .btn.primary', sim: '.start .link-btn' } },
  { name: 'greeting', file: 'apps/web/src/ui/StatusPills.tsx', path: NAVSIM, parts: { root: '.greeting' } },
  { name: 'pills', file: 'apps/web/src/ui/StatusPills.tsx', path: NAVSIM, parts: { root: '.pills', gps: '.pills .pill:nth-child(1)', wake: '.pills .pill:nth-child(2)', text: '.pills .pill-text', icon: '.pills .pill svg' } },
  { name: 'heat-switch', file: 'apps/web/src/ui/HeatSwitch.tsx', path: '/?navsim&panel=0&heatSeed&heat=sajat&heatView=gyakorisag&speed=7', parts: { root: '.heat-switch', box: '.heat-switch .segmented', selected: '.heat-switch button[aria-pressed="true"]', other: '.heat-switch button[aria-pressed="false"]', legend: '.heat-legend', bar: '.heat-legend-bar' } },
  { name: 'actions', file: 'apps/web/src/App.tsx', path: NAVSIM, parts: { root: '.actions', button: '.actions .round-btn', report: '.actions .round-btn.report' } },
  { name: 'recenter', file: 'apps/web/src/App.tsx', path: NAVSIM, recenter: true, parts: { root: '.actions', slot: '.actions .recenter-slot', button: '.actions .recenter', report: '.actions .round-btn.report', card: '.hud > .card' } },
  { name: 'nav-bottom', file: 'apps/web/src/ui/NavHud.tsx', path: AT(-295), parts: { root: '.nav-bottom', speed: '.nav-bottom-speed', eta: '.nav-bottom-eta b', remaining: '.nav-bottom-eta span', end: '.nav-end' } },
  { name: 'nav-top', file: 'apps/web/src/ui/NavHud.tsx', path: AT(-295), parts: { root: '.nav-top', dist: '.nav-dist', road: '.nav-road', then: '.nav-then' } },
  { name: 'meter-full', file: 'apps/web/src/ui/Hud.tsx', path: `${AT(150)}&alt=aftergate`, parts: { root: '.hud > .card', chip: '.hud > .card .chip', hero: '.hud > .card .hero', unit: '.hud > .card .hero-unit', sign: '.hud > .card .sign', num: '.hud > .card .meter-num', progress: '.hud > .card .progress', progressLabel: '.hud > .card .progress-label' } },
  { name: 'meter-compact', file: 'apps/web/src/ui/Hud.tsx', path: AT(150), parts: { root: '.card:has(.meter-compact)', row: '.meter-compact', speed: '.meter-compact .compact-speed', max: '.meter-compact-max', sign: '.meter-compact .sign', num: '.meter-compact .meter-num' } },
  { name: 'idle-card', file: 'apps/web/src/ui/Hud.tsx', path: NAVSIM, parts: { root: '.card.compact', speed: '.compact-speed', text: '.compact-row .body' } },
  { name: 'manual-card', file: 'apps/web/src/ui/Hud.tsx', path: NAVSIM, click: 'button[aria-label="Kézi átlagmérés indítása"]', parts: { root: '.hud > .card', chip: '.hud > .card .chip', time: '.hud > .card .title', hero: '.hud > .card .hero', stop: '.hud > .card .btn.danger' } },
  { name: 'offer-compact', file: 'apps/web/src/ui/NavHud.tsx', path: AT(150), parts: { root: '.nav-offer-compact', title: '.nav-offer-compact .nav-offer-title', button: '.nav-offer-compact .btn' } },
  { name: 'route-picker', file: 'apps/web/src/ui/RoutePicker.tsx', path: '/?navsim&stage=picker&panel=0&speed=7', parts: { root: '.picker', title: '.picker-title', option: '.route-opt', duration: '.route-opt-main b', detail: '.route-opt-main span.num', tag: '.route-opt-tag', meta: '.route-opt-meta', start: '.picker-start' } },
  { name: 'route-label', file: 'apps/web/src/map/MapboxWebAdapter.tsx', path: '/?navsim&stage=picker&panel=0&speed=7', parts: { root: '.route-label', bubble: '.route-label-bubble' } },
  { name: 'report-tiles', file: 'apps/web/src/ui/ReportSheet.tsx', path: NAVSIM, click: 'button[aria-label="Bejelentés"]', parts: { root: '.sheet', head: '.sheet-head', close: '.sheet-head .icon-btn', tile: '.tile', icon: '.tile .ic', label: '.tile-label', gate: '.tile.wide', note: '.sheet-note' } },
  { name: 'settings-rows', file: 'apps/web/src/ui/SettingsSheet.tsx', path: `${NAVSIM}&sheet=settings`, parts: { root: '.sheet', group: '.group-label', list: '.list', row: '.list-row', label: '.list-row .label', hint: '.list-row .hint', switch: '.switch', segmented: '.segmented', segment: '.segmented button[aria-pressed="true"]' } },
  { name: 'zone-picker', file: 'apps/web/src/ui/ZonePicker.tsx', path: `${NAVSIM}&sheet=settings`, parts: { root: '.zone-picker', hint: '.zone-picker .hint', box: '.zone-picker .segmented', selected: '.zone-picker button[aria-pressed="true"]', other: '.zone-picker button[aria-pressed="false"]' } },
  { name: 'gps-marker', file: 'apps/web/src/map/MapboxWebAdapter.tsx', path: NAVSIM, parts: { root: '.puck', dot: '.puck-dot', cone: '.puck-cone' } },
];

const STYLE_KEYS = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'backgroundImage', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'boxShadow', 'opacity'];

const browser = await launchBrowser();
try {
  const windows = await navWindows(browser);
  mkdirSync(join(OUT, 'specs'), { recursive: true });
  for (const c of COMPONENTS) {
    const { page, ctx } = await openPage(browser, 'pro');
    await page.goto(`${WEB_BASE}${resolveAt(c.path, windows)}`);
    const first = c.parts.root;
    if (c.recenter) {
      await page.waitForSelector('.card.compact', { timeout: 60_000 });
      const box = page.viewportSize();
      await page.mouse.move(box.width / 2, 250);
      await page.mouse.down();
      await page.mouse.move(box.width / 2 + 90, 340, { steps: 6 });
      await page.mouse.up();
    }
    if (c.click) {
      await page.locator(c.click).first().waitFor({ timeout: 60_000 });
      await page.locator(c.click).first().click();
    }
    await page.waitForSelector(first, { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(600);
    const parts = await page.evaluate(({ parts, keys }) => {
      const out = {};
      for (const [name, sel] of Object.entries(parts)) {
        const el = document.querySelector(sel);
        if (!el) {
          out[name] = null;
          continue;
        }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const style = {};
        for (const k of keys) style[k] = cs[k];
        const round = (x) => Math.round(x * 100) / 100;
        out[name] = { selector: sel, box: { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }, style };
      }
      return out;
    }, { parts: c.parts, keys: STYLE_KEYS });
    const missing = Object.entries(parts).filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length) throw new Error(`${c.name}: nincs meg a webes elem: ${missing.join(', ')}`);
    writeFileSync(join(OUT, 'specs', `${c.name}.json`), `${JSON.stringify({ component: c.name, webFile: c.file, device: { w: 402, h: 874, dpr: 3 }, parts }, null, 2)}\n`);
    console.log(`spec: ${c.name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
