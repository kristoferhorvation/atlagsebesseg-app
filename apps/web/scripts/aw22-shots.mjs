// AW22: a kör webes képei három szélességen (320 / 390 / 430 px) → docs/screenshots/2026-11-04-aw22-web-<szélesség>-<nézet>.png. Fut a dev-szerver.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeChrome, launchChrome, openPage, sleep } from './cdp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'screenshots');
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173';
const q = (s) => `document.querySelector(${JSON.stringify(s)})`;
const VIEWS = {
  'fiok-ki': { path: '/?navsim&panel=0&heat=ki&speed=7&sheet=settings', ready: '[data-testid="account-card"]', click: '[data-testid="account-email"]' },
  'fiok-nincs-beallitva': { path: '/?navsim&panel=0&heat=ki&speed=7&sheet=settings&account=off', ready: '[data-testid="account-card"]' },
  'fiok-be': { path: '/?navsim&panel=0&heat=ki&speed=7&sheet=settings&account=in', ready: '[data-testid="account-card"]' },
  'fiok-torles': { path: '/?navsim&panel=0&heat=ki&speed=7&sheet=settings&account=in', ready: '[data-testid="account-card"]', click: '[data-testid="account-delete"]' },
  'fiok-nev': { path: '/?navsim&panel=0&heat=ki&speed=7&nameStep=Anna', ready: '[data-testid="name-step"]' },
  'fiok-ajanlat': { path: '/?navsim&panel=0&heat=ki&speed=7&nudge', ready: '[data-testid="account-nudge"]' },
  veszely: { path: '/?navsim&panel=0&heat=ki&speed=7', ready: 'button[aria-label="Bejelentés"]', click: 'button[aria-label="Bejelentés"]', then: `[...document.querySelectorAll('.tile')][3].click(); true` },
  'vissza-mini': { path: '/?navsim&stage=nav&panel=0&speed=1&at=60', ready: 'button[aria-label="Kézi átlagmérés indítása"]', click: 'button[aria-label="Kézi átlagmérés indítása"]', mini: true },
};
const chrome = await launchChrome({ photo: false });
try {
  for (const w of [320, 390, 430]) {
    for (const [name, v] of Object.entries(VIEWS)) {
      const p = await openPage({ port: chrome.port, base: BASE, outDir: OUT, map: name === 'vissza-mini' ? 'real' : 'blank' });
      await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 320 ? 568 : w === 390 ? 844 : 932, deviceScaleFactor: 2, mobile: true });
      await p.goto(v.path);
      await p.waitFor(q(v.ready), 60000, name);
      if (v.click) await p.evaluate(`${q(v.click)}.click(); true`);
      if (v.then) {
        await sleep(300);
        await p.evaluate(v.then);
      }
      if (v.mini) {
        await p.waitFor(q('.manual-mini'), 30000, 'mini');
        const m = (type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1, ...extra });
        // a szabad térkép-rész a felső kártya alatt (kis kijelzőn szűk)
        const y = await p.evaluate(`Math.round(${q('.nav-top')}.getBoundingClientRect().bottom + 12)`);
        await m('mousePressed', w / 2 - 60, y);
        await m('mouseMoved', w / 2 - 20, y + 12);
        await m('mouseMoved', w / 2 + 40, y + 24);
        await m('mouseReleased', w / 2 + 40, y + 24, { buttons: 0 });
        await p.waitFor(q('.recenter-above'), 15000, 'gomb');
      }
      await sleep(600);
      await p.shot(`2026-11-04-aw22-web-${w}-${name}.png`);
      await p.close();
      console.log(`${w} ${name}`);
    }
  }
} finally {
  await closeChrome(chrome).catch(() => undefined);
}
