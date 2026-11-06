// AW25: Cloudflare Turnstile token-adó a munkamenet-létrehozáshoz – előkészítve, KIKAPCSOLVA (`CAPTCHA.enabled`, app-logic/captcha.ts).
// Bekapcsolt állapotban egy láthatatlan widget ad tokent a névtelen belépéshez és az e-mail-linkhez; kikapcsolva a szkript sem töltődik be.
import { CAPTCHA, setCaptchaProvider } from '@atlagsebesseg/app-logic';

interface Turnstile {
  render(el: HTMLElement, opts: { sitekey: string; size: 'invisible'; callback: (t: string) => void; 'error-callback': () => void }): string;
  reset(id: string): void;
}

export function initCaptcha(): void {
  if (!CAPTCHA.enabled || !CAPTCHA.siteKey) return;
  let ready: Promise<Turnstile> | null = null;
  const load = () =>
    (ready ??= new Promise<Turnstile>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve((window as unknown as { turnstile: Turnstile }).turnstile);
      s.onerror = () => reject(new Error('turnstile'));
      document.head.appendChild(s);
    }));
  setCaptchaProvider(async () => {
    const ts = await load();
    const host = document.createElement('div');
    host.hidden = true;
    document.body.appendChild(host);
    try {
      return await new Promise<string | null>((resolve) => {
        ts.render(host, { sitekey: CAPTCHA.siteKey, size: 'invisible', callback: resolve, 'error-callback': () => resolve(null) });
      });
    } finally {
      host.remove();
    }
  });
}
