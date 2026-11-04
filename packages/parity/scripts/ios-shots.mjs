// iOS-képek a paritás-kapuhoz (AOS18): szimulátor UDID-vel, `-parity YES` (a térkép helyett egyszínű háttér, rögzített óra, álló lejátszás).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { BUNDLE, DEVICES, FIXED_NOW_MS, ROOT, TIME_ZONE, WORK } from './config.mjs';
import { resolveAt } from './web-shots.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// időkorlát: a megakadt simctl (pl. bootstatus fagyott szimulátoron) ne tartsa a harnesst örökké
const SIMCTL_TIMEOUT_MS = 300_000;
const simctl = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SIMCTL_TIMEOUT_MS, killSignal: 'SIGKILL' });
const IOS = join(ROOT, 'apps', 'ios');
const APP = join(IOS, 'build', 'parity', 'Build', 'Products', 'Debug-iphonesimulator', 'Atlagsebesseg.app');

/** Fordítás szimulátorra; a kimenet fájlba megy (a csővezeték elfedné a hibát). */
export function buildApp() {
  const log = join(WORK, 'xcodebuild.log');
  mkdirSync(WORK, { recursive: true });
  const r = spawnSync('sh', ['-c', `exec xcodebuild build -project Atlagsebesseg.xcodeproj -scheme Atlagsebesseg -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build/parity ARCHS=arm64 ONLY_ACTIVE_ARCH=YES > "${log}" 2>&1`], { cwd: IOS, stdio: 'inherit', timeout: 20 * 60_000, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`xcodebuild hiba, napló: ${log}`);
}

export function shutdownDevice(device) {
  try {
    simctl('shutdown', DEVICES[device].udid);
  } catch {
    // nem futott
  }
}

export function shutdownAll() {
  for (const device of Object.keys(DEVICES)) shutdownDevice(device);
}

/** Bootolás (a többi szimulátor leállítva), állapotsor rögzítése, a friss app telepítése. */
export async function prepareDevice(device) {
  const { udid } = DEVICES[device];
  for (const other of Object.keys(DEVICES)) if (other !== device) shutdownDevice(other);
  const state = simctl('list', 'devices').split('\n').find((l) => l.includes(udid)) ?? '';
  if (!state.includes('(Booted)')) {
    simctl('boot', udid);
    simctl('bootstatus', udid, '-b');
    await sleep(20_000);
  }
  simctl('status_bar', udid, 'override', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3');
  simctl('install', udid, APP);
  // a telepítés utáni első indítás (előmelegítés) még nem kapja meg biztosan az argumentumokat: egy üres indítás, utána jöhetnek a képek
  execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-parity', 'YES'], { stdio: 'ignore', timeout: SIMCTL_TIMEOUT_MS, killSignal: 'SIGKILL' });
  await sleep(4000);
  simctl('terminate', udid, BUNDLE);
}

/** Az indítóképernyő egyszínű: sok, a sarokpixeltől eltérő minta kell ahhoz, hogy a kép az app UI-ja legyen. */
function hasContent(file) {
  const img = PNG.sync.read(readFileSync(file));
  const [r0, g0, b0] = [img.data[(img.width * 200 + 10) * 4], img.data[(img.width * 200 + 10) * 4 + 1], img.data[(img.width * 200 + 10) * 4 + 2]];
  let differing = 0;
  for (let k = img.width * 200 * 4; k < img.data.length; k += 4 * 37) {
    if (Math.abs(img.data[k] - r0) + Math.abs(img.data[k + 1] - g0) + Math.abs(img.data[k + 2] - b0) > 24) differing++;
  }
  return differing > 200;
}

/** Addig fotóz, amíg két egymás utáni kép azonos és már nem az indítóképernyő (az animációk lejártak), legfeljebb `maxMs`-ig. */
async function settledShot(udid, file, minMs, maxMs = 60_000) {
  const t0 = Date.now();
  let prev = null;
  await sleep(minMs);
  for (;;) {
    simctl('io', udid, 'screenshot', '--type=png', file);
    const cur = readFileSync(file);
    if (prev && cur.equals(prev) && hasContent(file)) return;
    prev = cur;
    if (Date.now() - t0 > maxMs) throw new Error(`nem állt be a kép: ${file}`);
    await sleep(900);
  }
}

/** A paritás-app leállítása a szimulátoron (best effort; hiba után is hívható). */
export function stopApp(device) {
  try {
    simctl('terminate', DEVICES[device].udid, BUNDLE);
  } catch {
    // nem futott
  }
}

/** Egyszeri elakadásnál (a kép nem állt be) egy újraindítás, utána már hibát ad. */
export async function iosShot(device, state, windows) {
  try {
    return await iosShotOnce(device, state, windows);
  } catch (e) {
    console.log(`újra: ${device} ${state.id} (${e.message})`);
    return iosShotOnce(device, state, windows);
  }
}

async function iosShotOnce(device, state, windows) {
  const { udid } = DEVICES[device];
  const dir = join(WORK, 'ios');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${device}-${state.id}.png`);
  try {
    simctl('terminate', udid, BUNDLE);
  } catch {
    // nem futott
  }
  try {
    simctl('spawn', udid, 'defaults', 'delete', BUNDLE);
  } catch {
    // üres tartomány
  }
  const args = state.ios.map((a) => resolveAt(a, windows));
  const env = { ...process.env, SIMCTL_CHILD_TZ: TIME_ZONE };
  execFileSync('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, BUNDLE, '-parity', 'YES', '-parityNow', String(FIXED_NOW_MS), '-lang:v1', state.lang ?? 'hu', ...args], { env, stdio: 'ignore', timeout: SIMCTL_TIMEOUT_MS, killSignal: 'SIGKILL' });
  // a navigációs állapotok útvonal-adata aszinkron érkezik: a „keresés…” kép is lehet stabil, ezért ezekre tovább várunk
  await settledShot(udid, file, state.ios.includes('nav') ? 24_000 : state.ios.includes('picker') ? 16_000 : 3000);
  return { file };
}
