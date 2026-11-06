/**
 * AW25: captcha a munkamenet-létrehozáshoz (névtelen belépés, e-mail-link) – előkészítve, KIKAPCSOLVA.
 * Bekapcsolás (az iOS-kör után): Cloudflare Turnstile-fiók + site key (Kristof), a Supabase Auth › Bot and Abuse Protection-ben a titkos
 * kulcs, itt `enabled: true` és a `siteKey`; a web a `apps/web/src/captcha.ts`-ben regisztrálja a token-adót. Amíg ki van kapcsolva, a
 * kérések pontosan a régiek (nincs `captchaToken`), és a token-adó sem töltődik be.
 */
export const CAPTCHA = { enabled: false, provider: 'turnstile', siteKey: '' } as const;

type TokenProvider = () => Promise<string | null>;
let provider: TokenProvider | null = null;

/** A platform token-adója (web: Turnstile láthatatlan widget). Kikapcsolt captchánál hatástalan. */
export function setCaptchaProvider(p: TokenProvider | null): void {
  provider = p;
}

/** A Supabase Auth `options`-ba olvasztandó mező: bekapcsolt captchánál és kapott tokennél `{ captchaToken }`, különben üres. */
export async function captchaOptions(enabled: boolean = CAPTCHA.enabled): Promise<{ captchaToken?: string }> {
  if (!enabled || !provider) return {};
  const token = await provider().catch(() => null);
  return token ? { captchaToken: token } : {};
}
