# Körnapló

| Kör | Dátum | Modell | Fő commit | Eredmény |
|---|---|---|---|---|
| A1 | 2026-10-26 | felhő | `52279e6` | Mérőmag (core), OSM-import, Supabase-séma és Expo-váz elkészült. |
| A2 | 2026-10-26 | felhő | `e8e929e` | Supabase-logika, ideiglenes kapuk, tűrés, HU-import és edge function dokumentálva. |
| A2b | 2026-10-27 | Sonnet (helyi) | `39bfbdb` | Helyi összekötés, migráció, feltöltés, CRON_SECRET-es cron, élő DB-tesztek. |
| A3 | 2026-10-27 | Opus (helyi) | `b7646e0` | Web PWA, DESIGN.md + tokenek, app-logic kiemelés, szimulátor, Vercel-előkészítés. |
| A3b | 2026-10-27 | Sonnet 5.5 (helyi) | `22da7a2` | CLAUDE.md, ROUNDS.md és caffeinate-hook. |
| A4 | 2026-10-27 | Opus 5.5 (helyi) | `162ad36` | Dizájn-döntések (várható végső átlag színe, Lassíts-sáv, ideiglenes szakasz, térkép-téma), csiszolás, térkép-magasság hiba javítva; Vercel production, main-push = deploy: https://atlagsebesseg.vercel.app (deploy-commit `a05e508`). |
| A5 | 2026-10-27 | Opus 5.5 (helyi) | `2ba7e66` | Térkép-interakció: aktív bejelentések ikonként (bbox, 60 s, kártya megerősítés/nincs ott), szabad mozgatás + „Vissza a helyemre” (mérésben 5 s után auto), kompakt alapkártya, attribúció a felső sarkokban; lezárás `9b259cf`: pillek vissza, active_reports nézet gate_kind-dal, kártya mérés közben 3 s után zár; élesben. |
| A6 | 2026-10-28 | Opus 5.5 (helyi) | `859fcf6` | Hivatalos szakaszlisták (PL GITD, IT Polizia/ASPI, FR data.gouv, ES DGT, NL OM/NWB, AT ASFINAG-összevetés): csak biztos adat, forrás + ellenőrzött jelzés a kártyán; OSM-duplikátum-szabály (út, irány, ≥70% átfedés); élőben 680 szakasz, ebből 298 hivatalos; lezárás `451eaad`: limit_source oszlop (hivatalos/osm), caffeinate-hook oka és ellenőrzése, hosszú futások szabálya. |
