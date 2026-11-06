// AW24 F (INV-23): a web valódi Mobile Safariban, az iOS-szimulátoron – eszköztárral, eszköztár nélkül és kezdőképernyős webappként (XCUITest:
// packages/parity/safari-probe). Egyszerre egy szimulátor; a végén leáll. Használat: `npm run safari:real -- [--device pro] [--shots] [--date 2026-11-05]`.
// A Playwright WebKit (`npm run webkit:layout`) a gyors, három méretes őr; ez a valódi böngésző-mérés (a 812 pt-es kezdőképernyős indítás véletlenszerű).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEVICES, pick, ROOT, WORK } from './config.mjs';

const argv = process.argv.slice(2);
const dev = pick(argv, 'device') ?? 'pro';
const { udid } = DEVICES[dev];
const DATE = pick(argv, 'date') ?? new Date().toISOString().slice(0, 10);
const BASE = process.env.SAFARI_BASE ?? 'http://127.0.0.1:5197';
const OUT = join(WORK, 'safari-probe', 'out');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => spawnSync('xcrun', ['simctl', ...a], { stdio: 'ignore' });

let vite = null;
if (!(await fetch(BASE).then((r) => r.ok).catch(() => false))) {
  vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', new URL(BASE).port, '--strictPort'], { cwd: join(ROOT, 'apps', 'web'), stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await fetch(BASE).then((r) => r.ok).catch(() => false)); i++) await sleep(500);
}

let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'HIBA'} ${name}${info ? ` – ${info}` : ''}`);
};

try {
  for (const d of Object.values(DEVICES)) simctl('shutdown', d.udid);
  simctl('boot', udid);
  execFileSync('xcrun', ['simctl', 'bootstatus', udid, '-b'], { stdio: 'ignore' });
  await sleep(20_000);
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${BASE}/?navsim&panel=0&heat=ki`]);
  await sleep(45_000);
  const proj = join(WORK, 'safari-probe');
  execFileSync('xcodegen', ['generate', '--spec', join(ROOT, 'packages', 'parity', 'safari-probe', 'project.yml'), '--project', proj, '--project-root', join(ROOT, 'packages', 'parity', 'safari-probe')], { stdio: 'ignore' });
  const frames = {};
  for (const t of ['test1Safari', 'test2AddToHomeScreen', 'test3Standalone']) {
    const r = spawnSync('xcodebuild', ['test', '-project', join(proj, 'SafariProbe.xcodeproj'), '-scheme', 'UITests', '-destination', `platform=iOS Simulator,id=${udid}`, '-derivedDataPath', join(proj, 'build'), 'CODE_SIGNING_ALLOWED=NO', `-only-testing:UITests/SafariProbe/${t}`], {
      encoding: 'utf8',
      env: { ...process.env, TEST_RUNNER_PROBE_OUT: OUT },
      maxBuffer: 1 << 28,
    });
    check(`${dev} ${t} lefutott`, r.status === 0, r.status === 0 ? '' : (r.stdout.match(/error: .*/g) ?? []).slice(0, 3).join(' | '));
    for (const m of r.stdout.matchAll(/^FRAMES (\S+) (\{.*\})$/gm)) frames[m[1]] = JSON.parse(m[2]);
  }
  for (const [mode, f] of Object.entries(frames)) {
    const text = f.bottomText;
    const map = f['Map, régió'];
    const [, screenH] = f.screen;
    // a webtartalom látható alja: a térkép-elem alja (Safariban a lap alja, kezdőképernyős módban a nézetablaké), legfeljebb a kijelzőé
    const visible = Math.min(map?.[3] ?? screenH, screenH);
    const safe = mode === 'kezdokepernyo' ? DEVICES[dev].bottom : 0;
    check(`${dev} ${mode}: a webtartalom legalsó szövege is látszik, alatta a biztonsági sáv + 12 pt szabad`, !!text && text[3] <= visible - safe - 12, JSON.stringify({ text: text?.[3], visible, screenH }));
    check(`${dev} ${mode}: az „i” a webtartalom tetején (+ 4 pt)`, !!f['Toggle attribution'] && f['Toggle attribution'][1] === (map?.[1] ?? 0) + (mode === 'kezdokepernyo' ? DEVICES[dev].top : 0) + 4, JSON.stringify(f['Toggle attribution']));
    if (argv.includes('--shots')) copyFileSync(join(OUT, `safari-${mode}.png`), join(ROOT, 'docs', 'screenshots', `${DATE}-aw24-safari-${dev}-${mode}.png`));
  }
  check(`${dev}: mindhárom mód mérve`, ['eszkoztarral', 'eszkoztar-nelkul', 'kezdokepernyo'].every((m) => frames[m]), Object.keys(frames).join(', '));
} finally {
  simctl('shutdown', udid);
  if (vite) process.kill(-vite.pid);
}
process.exit(failed ? 1 : 0);
