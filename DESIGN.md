# DESIGN – Átlagsebesség

Sötét, fintech-szintű kijelző vezetéshez. A térkép a háttér, a UI üvegszerű, lebegő rétegekben
felette. A tokenek egyetlen forrása `packages/design-tokens` (TS, platformfüggetlen) – a web CSS
változókká alakítja, a natív app közvetlenül importálja.

## Elvek

1. **1,5 m-ről olvasható.** Vezetés közben egy óriási szám (az átlag), alatta a határ, egy
   progress és egy színkód. Vezetés közben nincs 20 px alatti szöveg.
2. **A szín sosem egyedül beszél.** Minden állapotnak színe, ikonja és szava is van (színtévesztők).
3. **Nyugodt felület.** Egy hangsúlyszín, a többi szürkeskála; a figyelmet a státuszszín kapja.
4. **Mozgás csak transform/opacity.** 60 fps, 1 Hz-es adathoz igazított lineáris átmenetek,
   `prefers-reduced-motion` esetén nincs animáció.
5. **Max 2 koppintás** minden vezetés közbeni művelethez; érintési cél ≥ 56 px.

## Színek (sötét)

| token | érték | használat |
|---|---|---|
| `bg` | `#06070A` | háttér térkép nélkül |
| `surface` | `rgba(16,18,24,0.66)` + blur 28 px | üvegkártyák |
| `surfaceStrong` | `rgba(22,25,32,0.88)` | lapok (beállítások, bejelentés) |
| `stroke` | `rgba(255,255,255,0.08)` | 1 px-es élek |
| `text` / `textMuted` / `textFaint` | `#F4F6FA` / 64% / 40% | szöveg |
| `accent` | `#7A86FF` | márka, kézi mód, fókusz |
| `ok` | `#2EE59D` | **jó** – az átlag ≥ 3% (min. 3 km/h) a határ alatt |
| `near` | `#FFB224` | **határon** – az utolsó 3%-on belül |
| `over` | `#FF4D61` | **túl** – az átlag a határ felett |
| `idle` | `#8C93A3` | megszakadt / nincs adat |

A státuszszín a nagy számot, a progress kitöltését, a kártya felső fényívét és a térképen az
aktív szakasz vonalát színezi. Az állapot-ikonok: ✓ jó, ≈ határon, ↑ túl, ⏸ megszakadt.

## Tipográfia

**Inter Variable** (önállóan hostolt, offline is), számoknál `tabular-nums` – a számjegyek nem
ugrálnak.

| token | méret / súly | használat |
|---|---|---|
| `hero` | clamp(120px, 42vw, 196px) / 680, −0,045em | az átlag |
| `display` | 64 / 650 | közeledés távolsága, összegzés értékei |
| `title` | 28 / 620 | kártyacímek, határ |
| `body` | 20 / 500 | vezetés közben a legkisebb |
| `caption` | 15 / 500 | csak álló helyzetben (beállítások, összegzés részletei) |

## Térköz, forma, mélység

Térköz-skála 4-es léptékkel (4 … 48). Lekerekítés: 14 (gomb), 22 (csempe), 32 (kártya),
999 (pill). Mélység: üveg + 1 px-es fényes él + nagy, puha árnyék; a kártyák alja a
biztonsági zóna fölött lebeg.

## Komponensek

- **HUD-kártya** (alul lebeg): progress (10 px, kerek), hero szám, egység, határ-tábla
  (piros gyűrűs kör, benne a szám), opcionálisan „max 112” javaslat-pill.
- **Határ-tábla**: KRESZ-tábla stílusú kör, `title` méret; tűrés bekapcsolva a tábla mellett
  „+tűrés 137”.
- **Állapot-pillek** (fent): GPS pontosság, kijelző ébren / elalhat, offline. Koppinthatók,
  ha teendő van (pl. ébrentartás újrakérése).
- **Kerek gombok** (64 px, üveg): bejelentés, kézi mérés, beállítások.
- **Lap** (bottom sheet): bejelentés-rács (2 oszlop, 76 px-es csempék), beállítások.
- **Toast**: rövid visszajelzés felül, 2,5 s.

## Állapotok

| állapot | mit mutat |
|---|---|
| **nincs szakasz** | térkép teljes képen; alul kompakt kártya: pillanatnyi sebesség (`display`), „Nincs mérőszakasz a közelben”, gombsor |
| **közeledés** | kártya: út + irány, „múlva” távolság (`display`), határ-tábla; a szakasz vonala kiemelve |
| **mérés** | HUD-kártya; a szín az átlag és a határ viszonyából; alagútban „becsült” jelzés |
| **befejezve** | összegzés: végső átlag (hero, státuszszín), ítélet („határ alatt” / „+4 km/h”), hossz, idő, határ; 60 s után eltűnik |
| **kézi mód** | HUD az `accent` színnel (nincs határ): átlag, megtett út, idő, nagy „Leállítás” gomb; utána összegzés „Kapuk bejelentése” gombbal |
| **megszakadt** | szürke kártya ⏸ ikonnal: ok (háttérbe került / letértél / ellenirány / nincs GPS) és „Az átlag nem érvényes” – nincs szám |

## Mozgás

`fast` 160 ms, `base` 280 ms, `slow` 480 ms; görbe `cubic-bezier(0.2, 0.8, 0.2, 1)`.
Adatkövető átmenet (progress, kamera): 1000 ms lineáris – pont a GPS-ütem.

## Térkép

Mapbox Standard, `lightPreset` automatikusan (rendszermód + napállás), POI- és tömegközlekedési
címkék nélkül. Kamera: pitch 60°, haladási irány felfelé, az autó a képernyő alsó harmadában
(a HUD fölött). A szakaszok vonala halványan, az aktív a státuszszínnel, a megtett rész teltebb.
