# App Store adatvédelmi címke – kitöltési útmutató (AW25)

App Store Connect › App Privacy. A válaszok a kód 2026-11-06-i állapotát és a `docs/legal/privacy.hu.md`-t követik. Ha a kód változik
(új adat megy a szerverre, új SDK), ezt a fájlt is frissíteni kell.

## Alapkérdések

| Kérdés | Válasz | Miért |
|---|---|---|
| Gyűjt-e adatot az app? | **Igen** | helyadat, névtelen azonosító, fióknál e-mail stb. |
| Követés (tracking)? | **Nem** | nincs IDFA, nincs reklám, nincs harmadik féltől származó analitika, adat nem kerül adatbrókerhez |
| Privacy Policy URL | `https://tempomate.app/privacy` | a weboldalra a `docs/legal/privacy.<nyelv>.md` kerül |

## Adattípusok

„Kapcsolt” (Linked to You): a sor a névtelen auth-azonosítóhoz vagy a fiókhoz kötött. Az Apple definíciója szerint a véletlenszerű
felhasználó-azonosító is azonosító, ezért a névtelen azonosítóval küldött adat is kapcsolt.

| Apple-kategória | Adat | Cél | Kapcsolt? | Követés? | Megjegyzés |
|---|---|---|---|---|---|
| Location › **Precise Location** | bejelentés és dugó-minta helye; fióknál a felhős napló útvonala és mintái | App Functionality | Igen | Nem | a közösségi hőtérkép összevont szakaszai NEM kapcsoltak (nincs bennük azonosító) – ettől a kategória kapcsolt marad |
| Contact Info › **Email Address** | fiók (Apple / Google / e-mail-link) | App Functionality | Igen | Nem | csak fióknál; az Apple elrejtett címe is |
| Contact Info › **Name** | Megszólítás; az Apple / Google által adott név | App Functionality | Igen | Nem | nem kötelező |
| User Content › **Photos or Videos** | profilkép | App Functionality | Igen | Nem | csak ha feltölti |
| User Content › **Other User Content** | bejelentések (típus, irány), szavazatok | App Functionality | Igen | Nem | mások számára névtelen |
| Identifiers › **User ID** | névtelen auth-azonosító (UUID), fióknál ugyanaz | App Functionality | Igen | Nem | nem IDFA, nem gyári azonosító |
| Usage Data, Diagnostics | – | – | – | – | nincs saját analitika vagy hibagyűjtés; lásd lent a Mapboxot |

**Nem gyűjtünk:** egészség, pénzügy, névjegyek, böngészési előzmény, keresési előzmény a szerveren (a legutóbbi célok fióknál csak
koordinátával szinkronizálódnak – ez a Location sorba tartozik), érzékeny adat, telefonszám, fizikai cím.

## Harmadik féltől származó SDK-k

- **Mapbox Maps SDK** (térkép, telemetria): a Mapbox saját névtelen használati és helyadatot gyűjt, a felhasználó a térkép „i” gombjával
  kikapcsolhatja. Az Apple szerint a beépített SDK gyűjtése a mi címkénkhez tartozik: a Mapbox SDK saját privacy manifestjét
  (`PrivacyInfo.xcprivacy` a Mapbox-csomagban) a feltöltés előtt nézd át, és ha a Mapbox „Product Interaction” vagy „Location” adatot
  analitikára jelöl, vedd fel Analytics céllal, **nem kapcsolt**, **nem követés** jelöléssel.
- **supabase-swift, SwiftyH3:** saját adatgyűjtésük nincs.

## Nyitott (a feltöltés előtt)

1. **Az appnak nincs saját `PrivacyInfo.xcprivacy` fájlja.** A required-reason API-k (pl. `UserDefaults`: `CA92.1`; fájl-időbélyeg, ha
   a kód használja) deklarációja nélkül a feltöltés ITMS-91053 figyelmeztetést vagy elutasítást kaphat. Egy iOS-körben kell felvenni a
   `project.yml`-be (mindkét targetnek), a fenti adattípusokkal egyezően.
2. Captcha (Cloudflare Turnstile) bekapcsolásakor: a Cloudflare a webes kérésekhez IP-t és böngésző-jellemzőt kap – az iOS-címkét nem
   érinti, ha az iOS nem használja; a tájékoztatót igen (`docs/legal/ugyvedi-atnezes.md` 12.).
3. A címkét az App Store Connectben a fenti táblázat szerint Kristof tölti ki (a fiók az övé).
