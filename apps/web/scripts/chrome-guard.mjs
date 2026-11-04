// A headless Chrome életciklus-őre a képernyőkép- és ellenőrző szkriptekhez (cdp.mjs, shots.mjs, i18n-check.mjs, paritás-harness).
// Ok: a nyers `spawn`-nal indított Chrome nem kötődik a szülőhöz, ezért a lelőtt Node-folyamat után árván, órákig pörög
// (DPR 3, SwiftShader, gyorsított szimuláció: 300–600% CPU). Három védelem:
//  1. indításkor az előző futásból maradt árva Chrome kilövése (`reapOrphanChrome`);
//  2. signal / kivétel / kilépés esetén a megnyitott Chrome szinkron leállítása (`SIGKILL` nem kapható el – azt az 1. fedi);
//  3. kemény időkorlát (`startWatchdog`): lejáratkor leállít és kilép.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

const ORPHAN_RE = /--user-data-dir=(\S*atlag-(?:nav|shots|i18n)-\S*)/;
const DEFAULT_TIMEOUT_MIN = 5;

/** @type {Set<{ proc: import('node:child_process').ChildProcess, profile: string }>} */
const open = new Set();
/** @type {Set<() => void>} */
const cleanups = new Set();

const killGroup = (pid, signal) => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
    } catch {
      // már kilépett
    }
  }
};

/** Szinkron takarítás: minden regisztrált Chrome és egyéb teendő (pl. vite). `exit`-ben is hívható. */
export function cleanupAllSync() {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      // best effort
    }
  }
  for (const c of open) {
    if (c.proc.pid) killGroup(c.proc.pid, 'SIGKILL');
    try {
      rmSync(c.profile, { recursive: true, force: true });
    } catch {
      // a Chrome még írhat bele; a következő indulás takarítja
    }
  }
  open.clear();
}

/** Egyéb szinkron takarítás (pl. a detached vite leállítása) ugyanazokra a leállási eseményekre. Visszaadja a visszavonót. */
export function onCleanup(fn) {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

let handlersInstalled = false;
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', cleanupAllSync);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(sig, () => {
      console.error(`${sig}: Chrome leállítása`);
      cleanupAllSync();
      process.exit(code);
    });
  }
  for (const ev of ['uncaughtException', 'unhandledRejection']) {
    process.on(ev, (e) => {
      console.error(`${ev}: ${e?.stack ?? e}`);
      cleanupAllSync();
      process.exit(1);
    });
  }
}

/**
 * Kemény időkorlát a teljes futásra. `SHOTS_TIMEOUT_MIN` felülírja. Az időzítő `unref`-elt, ezért nem tartja életben a folyamatot.
 * Megjegyzés: a szinkron hívások (spawnSync, execFileSync) alatt az időzítő nem tud elsülni – azoknak saját `timeout` kell.
 */
export function startWatchdog(minutes = DEFAULT_TIMEOUT_MIN, label = process.argv[1]) {
  installHandlers();
  const min = Number(process.env.SHOTS_TIMEOUT_MIN ?? minutes);
  const t = setTimeout(() => {
    console.error(`időkorlát (${min} perc) lejárt: ${label} – Chrome leállítása, kilépés`);
    cleanupAllSync();
    process.exit(124);
  }, min * 60_000);
  t.unref();
  return () => clearTimeout(t);
}

/**
 * Az előző futásból maradt árva Chrome kilövése (user-data-dir=…atlag-(nav|shots|i18n)-… minta).
 * Árva = a fa gyökere az init (PPID 1) gyereke; egy másik, még élő futás Chrome-ját (élő szülő) nem bántja.
 */
export function reapOrphanChrome() {
  let table;
  try {
    table = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const matched = new Map();
  for (const line of table.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    const p = m && ORPHAN_RE.exec(m[3]);
    if (p) matched.set(Number(m[1]), { ppid: Number(m[2]), profile: p[1] });
  }
  const rootOf = (pid) => {
    let cur = pid;
    for (let i = 0; i < 64 && matched.has(matched.get(cur).ppid); i++) cur = matched.get(cur).ppid;
    return cur;
  };
  const killed = [];
  const profiles = new Set();
  for (const [pid, info] of matched) {
    const root = rootOf(pid);
    if (matched.get(root).ppid !== 1) continue;
    killGroup(pid, 'SIGKILL');
    killed.push(pid);
    profiles.add(info.profile);
  }
  for (const profile of profiles) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // következő alkalommal
    }
  }
  if (killed.length) console.log(`árva Chrome kilőve az előző futásból: ${killed.length} folyamat (${[...profiles].join(', ')})`);
  return killed;
}

/** Chrome indítása őrzötten: előbb az árvák kilövése, saját folyamatcsoport, regisztráció; sikertelen indulásnál takarít. */
export async function spawnGuardedChrome(chromeBin, args, { profile, port, attempts = 150 }) {
  installHandlers();
  reapOrphanChrome();
  const proc = spawn(chromeBin, args, { detached: true, stdio: 'ignore' });
  const entry = { proc, profile };
  open.add(entry);
  proc.on('error', () => undefined);
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return { proc, profile, port };
    } catch {
      // még indul
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await closeChrome({ proc, profile }).catch(() => undefined);
  throw new Error('a Chrome nem indult el');
}

/** SIGTERM, a kilépés megvárása (legfeljebb 3 s), majd SIGKILL a csoportra; csak utána a profil törlése. */
export async function closeChrome({ proc, profile }) {
  const exited = new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : proc.once('exit', r)));
  if (proc.pid) killGroup(proc.pid, 'SIGTERM');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  if (proc.pid) killGroup(proc.pid, 'SIGKILL');
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  for (const c of open) if (c.proc === proc) open.delete(c);
}
