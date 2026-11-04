// AW21 képei: web (bal) és iOS (jobb) egymás mellett, három méreten → docs/screenshots/2026-11-04-aw21-<nézet>-<méret>.png.
// A térkép helyett egyszínű háttér (a paritás-harness képei); a „Vissza a helyemre” látható / rejtett állapota, és a német / lengyel képernyők.
// Használat: `node packages/parity/scripts/aw21-shots.mjs [--device pro]`
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { onCleanup, reapOrphanChrome, startWatchdog } from '../../../apps/web/scripts/chrome-guard.mjs';
import { DEVICES, pick, ROOT, STATES, WEB_BASE, WORK } from './config.mjs';
import { readPng } from './diff-core.mjs';
import { buildApp, iosShot, prepareDevice, shutdownAll, shutdownDevice } from './ios-shots.mjs';
import { launchBrowser, navWindows, webShot } from './web-shots.mjs';

startWatchdog(60, 'aw21-shots');
reapOrphanChrome();
const argv = process.argv.slice(2);
const devices = pick(argv, 'device')?.split(',') ?? Object.keys(DEVICES);
const base = (id, over = {}) => ({ ...STATES.find((s) => s.id === id), ...over });
const VIEWS = [
  ['vissza-lathato', base('vissza-nav', { id: 'aw21-vissza-lathato' })],
  ['vissza-rejtett', base('nav', { id: 'aw21-vissza-rejtett' })],
  ...['de', 'pl'].flatMap((lang) => [
    [`${lang}-fo`, base('ures', { id: `aw21-${lang}-fo`, lang })],
    [`${lang}-merokartya`, base('meres-jo', { id: `aw21-${lang}-merokartya`, lang })],
    [`${lang}-bejelentes`, base('bejelentes', { id: `aw21-${lang}-bejelentes`, lang, web: { ...STATES.find((x) => x.id === 'bejelentes').web, click: '.round-btn.report' } })], // az aria-label nyelvfüggő: osztály-szelektor
    [`${lang}-beallitasok`, base('beallitasok', { id: `aw21-${lang}-beallitasok`, lang })],
  ]),
];
const states = VIEWS.map(([, s]) => s);

async function withServer(fn) {
  if (await fetch(WEB_BASE).then((r) => r.ok).catch(() => false)) return fn();
  const proc = spawn('npx', ['vite', '--port', new URL(WEB_BASE).port, '--strictPort'], { cwd: join(ROOT, 'apps', 'web'), stdio: 'ignore', detached: true });
  const unregister = onCleanup(() => process.kill(-proc.pid, 'SIGKILL'));
  try {
    for (let i = 0; i < 120 && !(await fetch(WEB_BASE).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
    return await fn();
  } finally {
    unregister();
    try { process.kill(-proc.pid); } catch { /* már leállt */ }
  }
}

let windows = [0, 0, 0];
await withServer(async () => {
  const browser = await launchBrowser();
  try {
    windows = await navWindows(browser);
    for (const device of devices) for (const s of states) { await webShot(browser, device, s, windows); console.log('web ', device, s.id); }
  } finally { await browser.close(); }
});
buildApp();
try {
  for (const device of devices) {
    await prepareDevice(device);
    for (const s of states) { await iosShot(device, s, windows); console.log('ios ', device, s.id); }
    shutdownDevice(device);
  }
} finally { shutdownAll(); }

const out = join(ROOT, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
for (const device of devices) {
  for (const [name, s] of VIEWS) {
    const a = readPng(join(WORK, 'web', `${device}-${s.id}.png`));
    const b = readPng(join(WORK, 'ios', `${device}-${s.id}.png`));
    const gap = 24;
    const png = new PNG({ width: a.width + gap + b.width, height: Math.max(a.height, b.height) });
    png.data.fill(32);
    for (const [img, ox] of [[a, 0], [b, a.width + gap]]) PNG.bitblt(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }), png, 0, 0, img.width, img.height, ox, 0);
    writeFileSync(join(out, `2026-11-04-aw21-${name}-${device}.png`), PNG.sync.write(png));
  }
}
console.log('kész: web (bal) | iOS (jobb)');
