// AW22: a Sign in with Apple webes titka: a .p8 kulcsból készült, legfeljebb 6 hónapos ES256 JWT, a Supabase-be beállítva (Management API, a CLI bejelentkezésével).
// A kulcs és a titok nem jelenik meg a kimeneten. Fél évente újra kell futtatni.
//   node supabase/scripts/apple-client-secret.mjs --p8 apps/ios/secrets/AuthKey_XXX.p8 --key XXX --team YYY [--dry-run]
import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const [p8, kid, team] = [arg('p8'), arg('key'), arg('team')];
if (!p8 || !kid || !team) throw new Error('kell: --p8 <fájl> --key <Key ID> --team <Team ID>');
const WEB_CLIENT = 'hu.atlagsebesseg.web';
const APP_CLIENT = 'hu.atlagsebesseg.app';
const PROJECT = 'vewendmvvybrlymncdji';

const b64 = (x) => Buffer.from(x).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${b64(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: team, iat: now, exp: now + 180 * 86400, aud: 'https://appleid.apple.com', sub: WEB_CLIENT }))}`;
const signature = sign('sha256', Buffer.from(body), { key: createPrivateKey(readFileSync(p8)), dsaEncoding: 'ieee-p1363' });
const secret = `${body}.${signature.toString('base64url')}`;

if (process.argv.includes('--dry-run')) {
  console.log(`JWT kész: ${secret.split('.').length} rész, ${signature.length} bájtos aláírás, lejár: ${new Date((now + 180 * 86400) * 1000).toISOString().slice(0, 10)}`);
  process.exit(0);
}
const token = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim();
const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ external_apple_enabled: true, external_apple_client_id: `${WEB_CLIENT},${APP_CLIENT}`, external_apple_secret: secret }),
});
if (!r.ok) throw new Error(`a beállítás nem sikerült: HTTP ${r.status}`);
console.log('Apple-szolgáltató bekapcsolva; a titok lejár:', new Date((now + 180 * 86400) * 1000).toISOString().slice(0, 10));
