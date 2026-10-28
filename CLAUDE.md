# Átlagsebesség-app – Claude Code útmutató

## Mi ez
Szekciókontroll-(átlagsebesség-)mérő app, Kristof és apja ötlete. Először web PWA, később natív
(Expo). Az app méri az átlagsebességet a szakaszokon, és jelzi a határhoz képesti helyzetet.

## Monorepo-térkép
| Mappa | Szerep | Fő parancs |
|---|---|---|
| `packages/core` | Függőségmentes mérőmotor (szakasz-felismerés, átlag, tűrés, napállás) | `npm test -w @atlagsebesseg/core` |
| `packages/data` | OSM-import, HU kézi lista, edge-bundle, feltöltő | `npm run import:sections`, `npm run build:edge` |
| `packages/app-logic` | Közös app-logika (cache, kapuk, Supabase, mérés-munkamenet) | `npm test -w @atlagsebesseg/app-logic` |
| `packages/design-tokens` | Platformfüggetlen dizájn-tokenek, CSS-változók | `npm test -w @atlagsebesseg/design-tokens` |
| `apps/web` | Web PWA (Vite + React, mapbox-gl) | `npm run dev -w @atlagsebesseg/web` |
| `apps/mobile` | Expo-váz, **parkoltatva** | `npm run typecheck -w @atlagsebesseg/mobile` |
| `supabase/` | Migrációk, edge function, SQL-tesztek | `npm run db:test:local`, `npm run test:edge` |

Gyökér: `npm test` és `npm run typecheck` minden csomagra; `npm run test:all` a teljes lánc
(csomagok + edge + helyi DB).

## Kötelező szabályok
- A `packages/core` **függőségmentes** marad (nincs runtime-függőség).
- Kulcs (service_role, CRON_SECRET, tokenek) **soha** nem kerül repóba, chatbe vagy commitba.
- A `.env` fájlt nem módosítjuk; csak `.env.example` bővíthető.
- RLS: kliensről csak `source = kozosseg` és `verified = false` szakasz írható; az
  OSM/hivatalos adatot csak a service_role tölti.
- UI-ben a dizájn-tokenek a `DESIGN.md`-ből jönnek, nem ad hoc színek/méretek.
- Szakaszadat: a hivatalos adat elsőbbséget élvez, de az OSM-szakasz nem ellenőrzöttként megmarad,
  ha nincs hivatalos párja. Duplikátum = ugyanaz az út, ugyanaz az irány, és a geometria legalább
  70%-ban átfed – ilyenkor csak a hivatalos marad. Minden más OSM-szakasz marad (élőben is csak a duplikátum törlődik).
- Kód-kommentek és commit-üzenetek magyarul.

## Kör-rendszer
- Minden prompt „A<n> kör”-rel kezdődik; minden commit-üzenet `A<n>: ...` prefixű.
- A kör végén frissül a `ROUNDS.md` (dátum, modell, fő commit, 1 mondat).

## Zárójelentés (minden kör végén)
1. **Mi készült**
2. **Mi nem és miért**
3. **Tesztek** (számokkal)
4. **Nyitott kérdések** (max 5, döntést kérők)
5. **Mi kell a következő körhöz**

## Tesztszabály
- Commit előtt: `npm test` zöld minden csomagra, `npm run typecheck` tiszta.
- Élő Supabase-teszt csak ROLLBACK-kel (`npm run db:live`).
- Élő migrációt (`npm run db:live`) a Claude Code maga futtat, ha csak hozzáad (új tábla /
  oszlop / nézet / függvény / feltétel); ha adatot vagy oszlopot töröl vagy átnevez, előbb megkérdez.
- Feltöltés (`npm run upload:sections`) után az élő darabszámot ellenőrizni kell, és a
  zárójelentésbe beírni.

## Hol vannak a döntések
- `supabase/README.md` – séma, cron, RLS-indoklás
- `DESIGN.md` – UI, tokenek
- `packages/data/README.md` – adatforrások, ODbL

## Mac-specifikus
Hosszú futás alatt a gép ne aludjon: ezt a **globális** `~/.claude/settings.json`
SessionStart/SessionEnd hookja intézi (`caffeinate -dims -w <claude PID>`, macOS-ellenőrzéssel).
A PID-fájl sessionönkénti: `/tmp/claude-caffeinate-<session_id>.pid` (a `session_id` a hook
stdin-JSON-jából). A SessionStart indítja (ha a sessionnek már fut, nem indít másikat), a
SessionEnd csak a saját session caffeinate-jét állítja le. A `-w` miatt a caffeinate akkor is kilép, ha a
session SessionEnd nélkül hal meg (ilyenkor csak egy ártalmatlan, elárvult PID-fájl marad).

- A hook globális, ezért **minden sessionben fut, bármelyik mappából indul** (ez a projekt, a
  saját mappa, BookMatch stb.). A projektnek nincs saját `.claude/settings.json`-ja, hogy a
  `caffeinate` ne induljon kétszer. A hook-beállítás változása új sessiontől érvényes.
- Párhuzamos sessionök nem állítják le egymás caffeinate-jét (mindegyiknek saját példánya és
  PID-fájlja van; két sessionnel tesztelve).
- **Ellenőrzés** minden hosszú feladat elején: `pgrep -l caffeinate`.
- **Tartalék**, ha üres (a hook nem futott): a Claude Code maga indítja háttérben, és a feladat
  végén leállítja:
  ```bash
  nohup caffeinate -dims >/dev/null 2>&1 </dev/null & echo $! > /tmp/claude-caffeinate-manual.pid
  # a végén:
  kill "$(cat /tmp/claude-caffeinate-manual.pid)" && rm -f /tmp/claude-caffeinate-manual.pid
  ```
  Ha már fut egy `caffeinate`, nem indít másikat.

## Hosszú futások
- Hosszú futású parancsot (import, feltöltés, build) **előtérben** futtass, és a kört **ne zárd
  „várom” állapotban**: a kör addig tart, amíg a feladat kész, vagy döntést kell kérni.
- Ha a parancs túllépi az előtérbeli időkorlátot (10 perc), oszd fel előtérben futó lépésekre
  (pl. `--from`/`--limit`), vagy indítsd háttérben, és ugyanabban a körben, előtérben
  pollozva várd meg a végét – a kört nem zárod le közben.
