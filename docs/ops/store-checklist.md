# App Store – kiadás előtti lista (AW25-től vezetve)

Jelölés: **[K]** Kristof lépése (fiók, szerződés, kulcs), **[C]** Claude Code egy következő körben.

## Jog és adatvédelem
- [ ] **[K]** Ügyvédi átnézés: `docs/legal/ugyvedi-atnezes.md` (14 pont), utána a szövegek véglegesítése.
- [ ] **[K]** Adatkezelő adatai: cím (és vállalkozás esetén cégadatok) a `docs/legal/*` placeholderek helyére, majd `npm run legal -w @atlagsebesseg/web`.
- [ ] **[K]** App Store Connect › App Privacy kitöltése: `docs/ops/app-privacy-labels.md`.
- [ ] **[C]** iOS `PrivacyInfo.xcprivacy` (required-reason API-k) – `app-privacy-labels.md` › Nyitott 1.
- [ ] **[C]** iOS: Beállítások › Adatvédelem › „Tájékoztató” (a weben AW25 óta megvan; paritási tartozás).
- [ ] **[K]** A landing (tempomate.app) /privacy, /terms, /support, /imprint oldalai a `docs/legal/*.md`-ből (a web-app saját példánya: `app…/legal/<doc>.<nyelv>.html`).

## Visszaélés elleni védelem
- [x] Napi kvóta telepítésenként (adatbázis-trigger, AW25).
- [ ] **[K]** Cloudflare Turnstile-fiók: site key + secret key. A secret a Supabase Dashboard › Authentication › Bot and Abuse Protection (Turnstile) mezőbe.
- [ ] **[C]** Captcha bekapcsolása az iOS-kör után: `packages/app-logic/src/captcha.ts` `enabled: true` + `siteKey`; iOS-oldali token-adó; a tájékoztató bővítése (Cloudflare mint adatfeldolgozó). **Sorrend:** előbb a kliensek (web + iOS) adjanak tokent, csak utána a Supabase-kapcsoló – különben a régi buildek névtelen belépése elbukik.

## Levelek és domain
- [ ] **[K]** `app.tempomate.app` CNAME a Vercelre; utána a régi `atlagsebesseg.vercel.app` → `app.tempomate.app` 301 (`docs/ops/dns-tempomate.md`).
- [ ] **[K]** Resend: a domain DNS-rekordjai + `.env.resend` (gitignore). Utána **[C]** `setup-resend` és a Supabase-titok: `RESEND_API_KEY` (az `account-email` edge function ebből küld; nélküle csak jelez).
- [ ] **[C]** Valódi levél-próba nem csapattag címre (bejelentkező link, üdvözlés, törlés-visszaigazolás).

## Kiadás előtt lezárandó (CLAUDE.md › TestFlight)
- [ ] **[C]** A Beállítások szimulátor-sora Release-ben ne látsszon; a szimulátor ne küldjön az éles Supabase-re.
- [ ] **[C]** Map Matching-eredmény tárolása (Mapbox-feltételek) – döntés.
