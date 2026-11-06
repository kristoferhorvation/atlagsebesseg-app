# Lovable-assetek (AW22b)

Feltöltendő a Lovable-projektbe **pontosan ezekkel a nevekkel** (`lovable-assets/`). Minden képernyőkép kétszer van meg:
`-hu.png` (magyar oldal) és `-en.png` (angol oldal) – ugyanaz a jelenet, a felület az adott nyelven.

Forrás: iPhone 17 Pro szimulátor (iOS 27.0), 1206 × 2622 px, „Színes” térkép, állapotsor 9:41 / teli akku, az app
2026-11-05-i buildje (AW23 utáni felület), egyszeri képkészítő szkripttel a `packages/parity/scripts/shots.mjs` mintájára
(kicsinyítés nélkül). A számok a szimulátor-forgatókönyvekből jönnek (130-as autópálya-szakasz, M1 Budapest → Győr).

| # | Fájl | Szekció a promptban | Felirat (HU / EN) |
|---|---|---|---|
| 01 | `01-hero-measure-green` | Hero + „Hogyan működik” 1. kártya + Funkciók 1. | „Jó ütem” / “On pace” – átlag 121, határ 130 |
| 02 | `02-measure-amber` | „Hogyan működik” 2. kártya | „Átlag magas” / “Average too high” – „Maradj 122 alatt” / “Stay under 122”, átlag 138–139 |
| 03 | `03-measure-red` | „Hogyan működik” 3. kártya | „Túl gyors” / “Too fast” – „Lassíts · max 121” / “Slow down · max 121” |
| 04 | `04-start-screen` | Funkciók alatti képsor (1.) | A kezdőképernyő: „Mérőszakaszon automatikusan indul…” / “Starts by itself at a section…” |
| 05 | `05-offer-compact-measuring` | Funkciók 3. | Gyorsabb út mérés közben: „Kijárat 56 · 2,7 km · −7 perc gyorsabb” |
| 06 | `06-route-picker` | Funkciók 2. | Útvonalválasztó: „Leggyorsabb”, „Szakaszellenőrzés: 1”, kamerák |
| 07 | `07-nav-maneuver` | Funkciók 2. + képsor (2.) | Navigáció: 150 m, Krisztina körút, „Utána M1” |
| 08 | `08-camera-card` | Funkciók 4. | Kamera-kártya: „A te irányodban mér · 2,1 km távolságra”, hivatalos forrás |
| 09 | `09-camera-near` | Funkciók 4. | Közeli kamera a manőverkártyán (borostyán), alatta a kész szakasz: „A határ alatt” |
| 10 | `10-report-menu` | Funkciók 5. | Bejelentés-menü |
| 11 | `11-settings` | Képsor (3.) | Beállítások (Fiók nem kötelező, tűrés, egység, tervezett mérések) |
| 12 | `12-live-activity-measure` | Funkciók 9. (keret nélkül) | Lezárt képernyő, mérés: 138, „Maradj 122 alatt” – kivágott widget |
| 13 | `13-live-activity-nav` | Funkciók 9. (keret nélkül) | Lezárt képernyő, navigáció: 140 m, Krisztina körút – kivágott widget |
| 14 | `14-idle-greeting` | Adatvédelem | Üres nézet: „Szia!”, „Nincs mérőszakasz a közelben” |
| 15 | `15-heatmap` | Funkciók 8. | Hőtérkép (AW24): az utcákra illesztett csíkok „Gyakoriság” módban, Budapest, krúzing „indulásra kész” |

Ikonok (favicon, Open Graph, header):

| Fájl | Méret | Mire |
|---|---|---|
| `icon-1024.png` | 1024 | forrás, OG-kép, header-jel (az iOS AppIcon, alfa nélkül) |
| `icon-512.png`, `icon-192.png` | 512 / 192 | web manifest |
| `icon-180-apple-touch.png` | 180 | `apple-touch-icon` |
| `icon-32-favicon.png` | 32 | favicon |

## Cserélendő képek

- **AW24-ben pótolva / cserélve** (`tsx packages/parity/scripts/landing-assets.mjs [--only 01,04,09,13,15]`, 17 Pro, a mai build):
  `01-hero-measure-green-en`, `09-camera-near-en` (ugyanaz a jelenet, mint a `-hu`: 34,7 km, „Camera 230 m”, `--cameraSeek` 0.775),
  `13-live-activity-nav-en` (az élő navigációs állapot, a szkript a lezárt képernyős kártyára vágja, 1206 px széles; a
  jelenet a navigáció elejéről, ezért a manőver más, mint a `-hu` képen), `15-heatmap-hu/en` (új), `04-start-screen-hu/en`
  (az EN cím már „Tempomate”). Az app mostani felületén a mérés alatt felül a krúzing-sáv is látszik (01-EN), a régebbi
  `-hu` képeken még nincs.
- **App Store-jelvény:** a hero helyőrzője (`data-placeholder="appstore-badge"`) az App Store-megjelenés után az Apple
  hivatalos jelvényére cserélendő.
