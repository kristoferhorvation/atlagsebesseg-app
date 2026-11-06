import { afterEach, describe, expect, it } from 'vitest';
import { CAPTCHA, captchaOptions, setCaptchaProvider } from '../src/captcha';

describe('AW25: captcha (előkészítve, kikapcsolva)', () => {
  afterEach(() => setCaptchaProvider(null));

  it('alapból ki van kapcsolva: a kérés nem kap captchaToken-t, a token-adót sem hívja', async () => {
    expect(CAPTCHA.enabled).toBe(false);
    let called = 0;
    setCaptchaProvider(async () => { called++; return 'tok'; });
    expect(await captchaOptions()).toEqual({});
    expect(called).toBe(0);
  });

  it('bekapcsolva a token a kérésbe kerül; token-adó nélkül vagy hibánál üres', async () => {
    expect(await captchaOptions(true)).toEqual({});
    setCaptchaProvider(async () => 'tok');
    expect(await captchaOptions(true)).toEqual({ captchaToken: 'tok' });
    setCaptchaProvider(async () => { throw new Error('x'); });
    expect(await captchaOptions(true)).toEqual({});
  });
});
