# tempomate.app: DNS, Resend, domain

A rekordokat a Lovable domain-kezelőjében kell felvenni (a domain névszerverei: `ns*.name.com`). A `tempomate.app` gyökerét
(`A 185.158.133.1`, a Lovable landing) **nem bántjuk**: a gyökérre semmilyen új rekord nem kerül, az SPF is a `send` aldomainen van.

## 1. Web-app: app.tempomate.app

| Típus | Név | Érték | TTL |
|---|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` | 3600 |

A domain a Vercel-projektben már fel van véve (2026-11-05, `verified: true`, a CNAME-re vár).

## 2. Resend: küldő-domain tempomate.app (EU, eu-west-1)

| Típus | Név | Érték | Prioritás | TTL |
|---|---|---|---|---|
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 | 3600 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | | 3600 |
| TXT | `resend._domainkey` | **A Resend generálja** (`p=MIGfMA0…`, lásd lent) | | 3600 |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@tempomate.app;` | | 3600 |

A DKIM-érték domainenként egyedi. Forrása a Resend felülete (Domains › tempomate.app), vagy a kulcs lerakása után:

```bash
npx tsx supabase/scripts/setup-resend.mts domain   # felveszi a domaint és kiírja mind a négy rekordot
```

Feladók: `no-reply@tempomate.app` (a bejelentkező levelek, Supabase Auth SMTP), `hello@tempomate.app` (emberi levelezés).
A küldéshez postafiók nem kell; ahhoz, hogy a `hello@`-re (és a DMARC-jelentések) be is érkezzenek, a gyökér-domainhez
levélfogadás (pl. továbbítás) kellene, az MX-e külön döntés.

## 3. Resend API-kulcs

resend.com › API Keys › *Full access*. A repó gyökerébe, a gitignore-olt `.env.resend` fájlba (chatbe soha):

```
RESEND_API_KEY=re_...
RESEND_DOMAIN=tempomate.app
```

## 4. Élesítés, amikor a rekordok kint vannak

```bash
dig +short app.tempomate.app CNAME                  # cname.vercel-dns.com.
npx tsx supabase/scripts/setup-resend.mts verify    # verified; a „pending” nem hiba, a DNS terjedésére vár
npx tsx supabase/scripts/setup-resend.mts smtp      # Supabase Auth SMTP Resendre, feladó „Tempomate” <no-reply@tempomate.app>
npx tsx supabase/scripts/setup-resend.mts templates # levélsablonok 6 nyelven
npx tsx supabase/scripts/setup-resend.mts auth-urls # app.tempomate.app az átirányítások közé, élő DNS-nél a Site URL is
```

**Átirányítás:** a `atlagsebesseg.vercel.app` → `app.tempomate.app` 301 csak élő CNAME után kapcsolható be, különben az egyetlen
működő cím állna le. Ekkor a `vercel.json`-ba:

```json
"redirects": [{ "source": "/:path*", "has": [{ "type": "host", "value": "atlagsebesseg.vercel.app" }], "destination": "https://app.tempomate.app/:path*", "permanent": true }]
```

(A `permanent: true` a Vercelen 308-at ad; szó szerinti 301-hez `"statusCode": 301` kell a `permanent` helyett.)

**A saját adat nem jön át magától:** a webes app helyi adata (IndexedDB, localStorage) originhoz kötött, az új címen üresen indul.
Bejelentkezett felhasználó fiókszinkronnal visszakapja, névtelen felhasználó nem.

## 5. Mapbox-token domain-korlátozás (előkészítve, még NEM bekapcsolva)

Mapbox-fiók › Access tokens › a webes token › URL restrictions:

```
https://app.tempomate.app
https://atlagsebesseg.vercel.app
http://localhost:5173
http://localhost:5174
```

A natív iOS-app ugyanezt a tokent használja URL-fejléc nélkül. A korlátozással az iOS kérései `403`-at kapnának, ezért bekapcsolás
előtt külön iOS-tokenre kell váltani (`apps/ios/Secrets.xcconfig`).

## 6. App Store Connect

Név: **Tempomate – Average Speed Nav**. Az App Store Connect felületén állítandó (App Information › Name), a build nem hozza magával.

## 7. Universal links

`apple-app-site-association`: `apps/web/public/.well-known/`, útvonalak `/auth-callback*`, `/open/*`. Az iOS-oldal:
`com.apple.developer.associated-domains: applinks:app.tempomate.app` (`apps/ios/project.yml`). Élesben csak a CNAME után mérhető:

```bash
curl -sI https://app.tempomate.app/.well-known/apple-app-site-association   # 200, application/json
```
