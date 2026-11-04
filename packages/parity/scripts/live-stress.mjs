// AOS18-javítás: a Live Activity widget szöveg-archiválásának próbája valódi ActivityKit-en, szimulátoron: `-liveStress YES` (Sim/LiveActivityStress.swift), közben háttérbe / előtérbe váltás;
// a végén a futás alatt keletkezett crash-naplók száma és veremtartalma. Használat: `tsx packages/parity/scripts/live-stress.mjs [--device pro] [--minutes 5]`. Az appot előbb telepíteni kell.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE, DEVICES, pick } from './config.mjs';

const argv = process.argv.slice(2);
const device = pick(argv, 'device') ?? 'pro';
const minutes = Number(pick(argv, 'minutes') ?? 5);
const { udid } = DEVICES[device];
const DIR = join(homedir(), 'Library', 'Logs', 'DiagnosticReports');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180_000 });
const reports = () => new Set(readdirSync(DIR).filter((f) => f.startsWith('AtlagsebessegWidget') && f.endsWith('.ips')));

for (const other of Object.values(DEVICES)) {
  if (other.udid !== udid) {
    try { simctl('shutdown', other.udid); } catch { /* nem futott */ }
  }
}
try { simctl('boot', udid); } catch { /* már fut */ }
simctl('bootstatus', udid, '-b');
await sleep(30_000);
const before = reports();
const end = Date.now() + minutes * 60_000;
let cycles = 0;
while (Date.now() < end) {
  simctl('launch', '--terminate-running-process', udid, BUNDLE, '-liveStress', 'YES', '-lang:v1', 'hu');
  await sleep(40_000);
  // háttérbe: a rendszer a Dynamic Island / lezárt képernyő nézeteit rajzolja
  simctl('launch', udid, 'com.apple.Preferences');
  await sleep(15_000);
  simctl('terminate', udid, 'com.apple.Preferences');
  cycles++;
}
const fresh = [...reports()].filter((f) => !before.has(f));
console.log(`${minutes} perc, ${cycles} kör, új widget crash-napló: ${fresh.length}`);
for (const f of fresh) {
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8').split('\n').slice(1).join('\n'));
  console.log(f, d.threads[d.faultingThread ?? 0].frames.slice(0, 5).map((x) => x.symbol ?? '?').join(' < ').slice(0, 220));
}
simctl('terminate', udid, BUNDLE);
simctl('shutdown', udid);
