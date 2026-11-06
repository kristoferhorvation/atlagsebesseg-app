# Valódi WebKit-mérés (AW24, INV-22, INV-23)

A webes elrendezés (felső sáv, alsó sáv) **nem zárható le Chromium-emulációval**. Az AW23 kezdőképernyős javítása Chromiumban zöld volt, valódi
WebKitben levágta az alsó sávot. Két mérés van, mindkettő a kör-záró kapu része (CLAUDE.md › Kör-rend).

## 1. `npm run webkit:layout` – Playwright WebKit (gyors őr)

`packages/parity/scripts/webkit-layout.mjs`. Három méret (SE 375 × 667, Pro 402 × 874, Pro Max 440 × 956), a `screen` a teljes kijelző, négy mód:

| mód | látható nézetablak | biztonsági sáv (fent / lent) | `navigator.standalone` |
|---|---|---|---|
| `safari` | kijelző − állapotsor − 98 pt eszköztár | 0 / 0 | nem |
| `safari-eszkoztar-nelkul` | ugyanaz (a Safari eltérő ICB-jét a WebKit-motor nem tudja utánozni → ezt a 2. mérés fedi) | 0 / 0 | nem |
| `kezdokepernyo` | a teljes kijelző | 62 / 34 (SE: 20 / 0) | igen |
| `kezdokepernyo-rovid` | kijelző − állapotsor (az iOS néha így indítja a webappot) | 62 / 34 | igen |

A biztonsági sávot a betöltött CSS `env(safe-area-inset-*)` értékeinek átírása szimulálja. Ellenőrzés nézetenként (üres nézet, navigáció):
`.app` = látható nézetablak; az alsó sáv alja = nézetablak − biztonsági sáv − 12; semmi nem lóg ki; a Mapbox-logó (4, sáv + 4, 88 × 23), az „i”
(jobb szél − 8, sáv + 4, 24 pt), a felső sötétítés (sáv + 140). `--shots`: képek `docs/screenshots/<dátum>-aw24-webkit-*`.
Mutációs próba (AW24): az AW23-as magasság-számítással a `kezdokepernyo-rovid` mód 6 ellenőrzése bukik.

## 2. `npm run safari:real -- --device <se|pro|max>` – Mobile Safari a szimulátoron

`packages/parity/scripts/safari-real.mjs` + `packages/parity/safari-probe` (XCUITest, a projekt a `.work`-be generálódik). Egyszerre egy szimulátor,
a végén leáll. Lépések: a Safari megnyitja a `/?navsim&panel=0&heat=ki`-t → mérés eszköztárral → „Eszközsor elrejtése” → mérés → megosztás →
„Főképernyőhöz adás” (webappként) → indítás a kezdőképernyőről → „Kipróbálom GPS nélkül” → mérés. Ellenőrzés: a webtartalom legalsó szövege a
látható rész alja − biztonsági sáv − 12 pt fölött; az „i” a webtartalom tetején + 4 pt. `--shots`: `docs/screenshots/<dátum>-aw24-safari-<méret>-<mód>.png`.

A feliratok a szimulátor nyelvén (magyar) vannak; a megosztás-lap egy része a SpringBoard folyamatában fut. Több futás után több „Átlag” ikon lehet
a kezdőképernyőn: a legutóbb hozzáadottat indítja.

## Mért értékek (iOS 27, iPhone 17 Pro, 2026-11-05)

| mód | `innerHeight` | látható | `100dvh` / fix tartóblokk | AW23-as `.app` |
|---|---|---|---|---|
| Safari, eszköztárral | 714 | 714 | 714 | 714 |
| Safari, eszköztár nélkül | 714 | 714 | 754 | 754 (40 pt levágva) |
| kezdőképernyő | 874 | 874 | 874 | 874 |
| kezdőképernyő, rövid indítás | 812 | 812 | 812 | 874 (62 pt levágva) |

A rövid kezdőképernyős indításnál a kijelző alsó 62 pt-jén sötét sáv marad: a fix elemek a nézetablakon túl nem rajzolódnak ki (WebKit-korlát,
nem javítható a weben); a tartalom ilyenkor teljes, semmi nem vágódik le.
