// `npm run parity` (AOS18): azonos állapotok a weben és iOS-en, a térkép helyett egyszínű háttérrel; perceptuális diff, küszöb felett bukik.
// Kapcsolók: --device se|pro|max, --state <id>[,<id>], --skip-web, --skip-ios, --skip-build, --no-selfcheck
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onCleanup, reapOrphanChrome, startWatchdog } from '../../../apps/web/scripts/chrome-guard.mjs';
import { DEVICES, OUT, pick, ROOT, STATES, WEB_BASE, WORK } from './config.mjs';
import { diffImages, readPng, sideBySide, THRESHOLDS } from './diff-core.mjs';
import { buildApp, iosShot, prepareDevice, stopApp } from './ios-shots.mjs';
import { launchBrowser, navWindows, webShot } from './web-shots.mjs';

// kemény időkorlát (a teljes futás ~25 perc; SHOTS_TIMEOUT_MIN felülírja) + az előző futás árva Chrome-jának kilövése
startWatchdog(30, 'parity');
reapOrphanChrome();

const argv = process.argv.slice(2);
const devices = (pick(argv, 'device')?.split(',') ?? Object.keys(DEVICES));
const wanted = pick(argv, 'state')?.split(',');
const states = wanted ? STATES.filter((s) => wanted.includes(s.id)) : STATES;
const skipWeb = argv.includes('--skip-web');
const skipIos = argv.includes('--skip-ios');
const skipBuild = argv.includes('--skip-build');

async function withServer(fn) {
  const up = await fetch(WEB_BASE).then((r) => r.ok).catch(() => false);
  if (up) return fn();
  const port = new URL(WEB_BASE).port;
  const proc = spawn('npx', ['vite', '--port', port, '--strictPort'], { cwd: join(ROOT, 'apps', 'web'), stdio: 'ignore', detached: true });
  // signal / kivétel / időkorlát esetén a `finally` nem fut: a detached vite folyamatcsoportját a közös őr is leállítja
  const unregister = onCleanup(() => process.kill(-proc.pid, 'SIGKILL'));
  try {
    for (let i = 0; i < 120; i++) {
      if (await fetch(WEB_BASE).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn();
  } finally {
    unregister();
    try {
      process.kill(-proc.pid);
    } catch {
      // már leállt
    }
  }
}

mkdirSync(join(OUT, 'diff'), { recursive: true });
mkdirSync(WORK, { recursive: true });
const maskFile = join(WORK, 'masks.json');
let masks = {};
let windows = [0, 0, 0];

await withServer(async () => {
  const browser = await launchBrowser();
  try {
    windows = await navWindows(browser);
    writeFileSync(join(WORK, 'windows.json'), JSON.stringify(windows));
    if (!skipWeb) {
      for (const device of devices) {
        for (const state of states) {
          const r = await webShot(browser, device, state, windows);
          masks[`${device}-${state.id}`] = r.masks;
          console.log(`web  ${device} ${state.id}`);
        }
      }
      const prev = await import('node:fs').then((fs) => { try { return JSON.parse(fs.readFileSync(maskFile, 'utf8')); } catch { return {}; } });
      writeFileSync(maskFile, JSON.stringify({ ...prev, ...masks }));
    }
  } finally {
    await browser.close();
  }
});

if (!skipIos) {
  if (!skipBuild) buildApp();
  try {
    for (const device of devices) {
      await prepareDevice(device);
      for (const state of states) {
        await iosShot(device, state, windows);
        console.log(`ios  ${device} ${state.id}`);
      }
    }
  } finally {
    // hiba esetén sem marad futó app a szimulátorokban
    for (const device of devices) stopApp(device);
  }
}

masks = await import('node:fs').then((fs) => { try { return JSON.parse(fs.readFileSync(maskFile, 'utf8')); } catch { return {}; } });
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const rows = [];
for (const device of devices) {
  const d = DEVICES[device];
  // a rendszer-elemek (állapotsor, home-sáv) nem a mi UI-nk
  const system = [{ x: 0, y: 0, w: d.w, h: d.top }, ...(d.bottom ? [{ x: d.w / 2 - 80, y: d.h - 12, w: 160, h: 12 }] : [])];
  for (const state of states) {
    const key = `${device}-${state.id}`;
    const webImg = readPng(join(WORK, 'web', `${key}.png`));
    const iosImg = readPng(join(WORK, 'ios', `${key}.png`));
    if (webImg.width !== iosImg.width || webImg.height !== iosImg.height) throw new Error(`${key}: eltérő képméret ${webImg.width}×${webImg.height} / ${iosImg.width}×${iosImg.height}`);
    const r = diffImages(webImg, iosImg, d.dpr, [...system, ...(masks[key] ?? [])]);
    writeFileSync(join(OUT, 'diff', `${key}.png`), sideBySide(r.a, r.b, r.output));
    rows.push({ device, state: state.id, overall: Number(r.overall.toFixed(4)), tile: Number(r.tile.toFixed(4)), tileAt: r.tileAt, passed: r.passed });
    console.log(`${r.passed ? 'OK  ' : 'HIBA'} ${key.padEnd(24)} egész ${pct(r.overall).padStart(7)}  csempe ${pct(r.tile).padStart(7)} @${r.tileAt ? `${r.tileAt.x},${r.tileAt.y}` : '-'}`);
  }
}

// önellenőrzés: egy kerek gomb 12 pt-es elcsúsztatása a valódi webes képen a kapunak buknia kell (nem vak-e a küszöb)
if (!argv.includes('--no-selfcheck')) {
  const key = rows[0] && `${rows[0].device}-${rows.find((r) => r.state === 'ures')?.state ?? rows[0].state}`;
  const d = DEVICES[key.split('-')[0]];
  const img = readPng(join(WORK, 'web', `${key}.png`));
  const moved = { width: img.width, height: img.height, data: Buffer.from(img.data) };
  const box = { x: d.w - 76, y: d.h - d.bottom - 150, w: 76, h: 76 };
  const shift = 12 * d.dpr;
  for (let y = box.y * d.dpr; y < (box.y + box.h) * d.dpr; y++) {
    for (let x = box.x * d.dpr; x < (box.x + box.w) * d.dpr; x++) {
      const t = (y * img.width + x) * 4;
      const s = ((y + shift) * img.width + x) * 4;
      for (let c = 0; c < 4; c++) moved.data[t + c] = img.data[s + c];
    }
  }
  const check = diffImages(img, moved, d.dpr, []);
  console.log(`önellenőrzés (12 pt-es elcsúszás ${key}): egész ${pct(check.overall)}, csempe ${pct(check.tile)} → ${check.passed ? 'NEM BUKOTT (a küszöb vak!)' : 'bukik, jó'}`);
  if (check.passed) process.exitCode = 1;
}

const failed = rows.filter((r) => !r.passed);
writeFileSync(join(OUT, 'diff', 'summary.json'), `${JSON.stringify({ thresholds: THRESHOLDS, total: rows.length, failed: failed.length, rows }, null, 2)}\n`);
const md = ['# Paritás-diff összefoglaló', '', `Küszöb: a kép egésze ≤ ${pct(THRESHOLDS.overall)}, legrosszabb ${THRESHOLDS.tileSize} pt-es csempe ≤ ${pct(THRESHOLDS.tile)}.`, `Eredmény: ${rows.length - failed.length} / ${rows.length} zöld.`, '', '| állapot | ' + devices.join(' | ') + ' |', '|---|' + devices.map(() => '---').join('|') + '|'];
for (const state of states) {
  md.push(`| ${state.id} | ${devices.map((dev) => {
    const r = rows.find((x) => x.device === dev && x.state === state.id);
    return `${r.passed ? '✓' : '✗'} ${pct(r.overall)} / ${pct(r.tile)}`;
  }).join(' | ')} |`);
}
writeFileSync(join(OUT, 'diff', 'README.md'), `${md.join('\n')}\n`);
console.log(`\n${rows.length - failed.length}/${rows.length} zöld`);
if (failed.length) process.exitCode = 1;
