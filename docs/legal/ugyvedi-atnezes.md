# Ügyvédre jelölt pontok (AW25, 2026-11-06)

A jogi szövegek (`docs/legal/*.hu.md`, az irányadó változat a magyar) a kód mai viselkedését írják le. Az alábbi pontokban jogi
megerősítés kell az App Store-kiadás előtt. A szövegben `[ÜGYVÉDI ÁTNÉZÉS n]` jelöli, ahol a pont egy konkrét mondathoz tartozik.

| # | Téma | Kérdés | Hol |
|---|---|---|---|
| 1 | Adatkezelő | Egyéni fejlesztőként szerepel (Horváth Kristóf, Budapest, a cím helyén placeholder). Vállalkozás (egyéni vállalkozó, kft.) esetén a név, a székhely, a nyilvántartási szám és az adószám cserélendő. Kell-e magánszemélyként lakcímet közölni? | privacy 1., imprint, terms 1. |
| 2 | Névtelen vezetési adatok alapból BE | Jogos érdek (6. cikk (1) f)) – írásos érdekmérlegelési teszt kell. Az összevont, azonosító és időbélyeg nélküli útszakasz-adat anonim adatnak minősül-e (ha igen, a GDPR nem vonatkozik rá)? | privacy 3.5 |
| 3 | Harmadik országba továbbítás | Szolgáltatónként a DPF-tanúsítás és az adatfeldolgozói szerződés (DPA): Mapbox, Vercel, Resend, Supabase, Apple, Google. | privacy 4. |
| 4 | Németország (StVO 23. § (1c)) | Ma a kamerák látszanak, és első alkalommal figyelmeztetünk, hogy a vezető nem használhatja. iOS-en a közeledő kamerára hang és rezgés is szól (A10-es jelzés), a figyelmeztetés ezt nem kapcsolja ki. Elég-e ez, vagy DE-ben a jelzést (vagy a teljes réteget) ki kell kapcsolni? Az átlagsebesség-szakasz mérése (Section Control, Alsó-Szászország) DE-ben is fut. | terms 4., INV-24 |
| 5 | Franciaország (2012-es „zones de danger” rendelet) | Ma a kamera helyett egy 1 km sugarú, 500 m-es rácsra kerekített „Ellenőrzési zóna” látszik, jelzés nélkül. A francia szabály útkategóriánként rögzített zónahosszt ír elő (lakott területen 300 m, autópályán akár 4 km), és a mobil ellenőrzések jelzésére is vonatkozik. Megfelel-e a mai megoldás? A francia átlagsebesség-szakaszok (radar tronçon) mérése ma látszik. | terms 4., INV-24 |
| 6 | Svájc (SVG 98a. cikk) és a közösségi bejelentések | Svájcban a kamerák és a tervezett mérések rejtve vannak, de a **közösségi „Rendőrség” bejelentések minden országban látszanak** (DE, FR, CH is) – ezt a kamera-szabály ma nem szűri. Ki kell-e szűrni országonként (CH: tilos, FR: zóna, DE: vezetőnek tilos)? | terms 4. (a szöveg nem állítja, hogy szűrnénk) |
| 7 | Fiók törlése 30 napos visszaállítással | A GDPR 17. cikke „indokolatlan késedelem nélkül” törlést ír elő. Elfogadható-e a 30 napos visszaállítási idő, ha a felhasználót a levél és az app tájékoztatja, és az újra-bejelentkezés visszaállít? | privacy 5., account.delete.body |
| 8 | Megőrzési idők | Nyers helyadat 90 nap, műszaki naplók 30 nap, 12 hónapja nem használt névtelen azonosító törlése, napi beküldési kvóta: az indoklás megfelelő-e (jogos érdek, célhoz kötöttség)? | privacy 5. |
| 9 | Korhatár | 16 év (Infotv., GDPR 8. cikk). Más tagállamokban 13–16 év; az App Store korhatár-besorolásával összhangban van-e? Kell-e életkor-ellenőrzés a fióknál? | privacy 7., terms 7. |
| 10 | Mapbox-feltételek | A mentett helyeknél a Mapbox-azonosító (`mapbox_id`) a hely kulcsaként tárolva marad (a név és a cím nem). Megengedett-e? A Map Matching eredményének tárolása (közösségi hőtérkép, `cloud_tracks`) és a Search Box ideiglenes jellege: döntés a következő körökben. | privacy 3.8 |
| 11 | Felelősségkorlátozás és fogyasztóvédelem | A „ahogy van” kizárás és a kártérítés-korlátozás fogyasztóval szemben érvényes-e (Ptk. 6:152. §, az EU-s fogyasztóvédelmi szabályok); az Apple EULA mellett a saját feltételek viszonya. | terms 6., 10., 11. |
| 12 | Captcha bekapcsolása | A Cloudflare Turnstile bekapcsolásakor (az iOS-kör után) a Cloudflare új adatfeldolgozó: a tájékoztatót bővíteni kell (IP, böngésző-jellemzők a bot-szűréshez). Ma ki van kapcsolva, ezért a szöveg nem említi. | privacy 4. |
| 13 | Profilkép és név | A profilkép kicsinyített képként a profilban tárolódik; az Apple / Google által adott név előtöltés. Kell-e külön hozzájárulás a képhez? | privacy 3.6 |
| 14 | NAIH | Kell-e adatvédelmi hatásvizsgálat (DPIA) a háttér-helymeghatározás és a közösségi helyadat miatt? | privacy 3.1, 3.5 |
