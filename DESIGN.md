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
| `surface` | `rgba(14,16,22,0.72)` + blur 28 px, saturate 150% | üvegkártyák (A4: a színes térképen is olvasható) |
| `surfaceStrong` | `rgba(22,25,32,0.88)` | lapok (beállítások, bejelentés) |
| `stroke` | `rgba(255,255,255,0.08)` | 1 px-es élek |
| `text` / `textMuted` / `textFaint` | `#F4F6FA` / 64% / 40% | szöveg |
| `accent` | `#7A86FF` | márka, kézi mód, fókusz |
| `ok` | `#2EE59D` | **Jó ütem** (`jo`) – az átlag ≤ határ |
| `near` | `#FFB224` | **Átlag magas** (`lassits`) – az átlag a határ felett, de a várható végső ≤ határ |
| `over` | `#FF4D61` | **Túl gyors** (`tul_gyors`) – a várható végső a határ felett |
| `idle` | `#8C93A3` | megszakadt / nincs adat |
| `planned` | `#F2DC82` | tervezett rendőrségi mérés: vonal és sáv (A7) – nem státuszszín |
| `route` / `routeCasing` | `#1F5BFF` / `#FFFFFF` | navigáció (A8d): a kiválasztott útvonal, 7 px, 2 px-es fehér kontúrral (dugónál a szakasz `near`/`over`) |
| `routeAltDay` / `routeAltNight` | `#799CF8` / `#1E49C1` | az alternatív útvonal: **tömör**, 5 px, a kiválasztott ALATT. Nappal (hajnal is): `route` 55% + a térkép háttere (`mapBgDay` `#E8EBEF`) 45%, `routeAltCasingDay` `#1A2130` sötét kontúr. Éjjel (alkony is, AW11): `route` 70% + háttér (`mapBgNight` `#1B2030`) 30%, `routeAltCasingNight` világos kontúr (`#E8EBEF`, 60%) – éjjel a kiválasztottól a kontúr (fehér vs. 60%) és a vastagság választja el |

A státuszszín a nagy számot, a chipet, a sávot, a progress kitöltését, a kártya háttér-
árnyalatát és fényívét, valamint a térképen az aktív szakasz vonalát színezi – **mindig ugyanabból
az egy állapotból**. Az állapot-ikonok: ✓ jó ütem, ↓ átlag magas, ↑ túl gyors, ⏸ megszakadt.

**Az állapot (A7b; core `meterState`, app-logic `speedStatus`):**

| állapot | feltétel | chip | sáv |
|---|---|---|---|
| `jo` (zöld) | átlag ≤ határ | „Jó ütem” | nincs |
| `lassits` (borostyán) | átlag > határ, de várható végső ≤ határ | „Átlag magas” | mindig: „Maradj X alatt” (X = a szükséges max) |
| `tul_gyors` (piros) | várható végső > határ | „Túl gyors” | mindig: „Lassíts · max X”; ha X a „nem lehetséges” küszöb alatt (határ 60%-a): „Nem hozható be” |

A régi „határon” (3%) sáv megszűnt. A **várható végső** a core becslése (`projectedAverageKmh`): a
hátralévő utat a jelenlegi sebességgel megtéve mennyi lesz a szakasz átlaga. Sebesség nélkül (álló
helyzet) a pillanatnyi átlag a tartalék. Befejezve a tényleges végső átlag: ≤ határ jó, felette túl gyors.

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

- **HUD-kártya, mérés közben** (alul lebeg, A7b): chip (állapot) → hero szám (a pillanatnyi
  **átlag**) → alatta kicsiben „km/h átlag” → egy sor: **[határ-tábla] most 144 · várható 122**
  (a „most” a pillanatnyi GPS-sebesség; mindkét szám 44 px, tabular, 1,5 m-ről olvasható) →
  progress + hátralévő táv. A „most” borostyán (`near`), ha a pillanatnyi sebesség a határ felett van – az állapot ettől nem változik (az átlag és a várható végső dönt). Ha a Beállításokban a tűrés-kijelzés be van kapcsolva, a határ-tábla alatt kicsiben „tűrés 136” (20 px; lefelé kerekítve). Más szám nem kerül a kártyára.
- **Határ-tábla**: KRESZ-tábla stílusú kör, `title` méret.
- **Állapot-pillek** (fent): GPS pontosság, kijelző ébren / elalhat, offline. Vezetés közben
  **csak ikonok** (szöveg nélkül). Koppinthatók, ha teendő van (pl. ébrentartás újrakérése).
- **Ébrentartás (A4-döntés):** ha a Wake Lock nem sikerül, **egyszer**, induláskor egy csendes,
  semleges toast szól (5 s); utána csak a szürke kijelző-ikon jelzi – nem sárga, nem ismétlődik.
- **Sáv: „Lassíts · max X” / „Maradj X alatt” (A4-, A7b-döntés):** külön, nagy üvegpill középen a kártya fölött (76 px magas,
  `title` címke + 44 px-es szám), **`lassits` és `tul_gyors` állapotban mindig, `jo`-ban soha** (a színe az állapoté: borostyán „Maradj X alatt”, piros „Lassíts · max X”, vagy „Nem hozható be”, ha a „max” már nem reális). Megjelenés/eltűnés `slow` (480 ms)
  opacity + transform; hiszterézis: 1,5 s fennállás után jelenik meg, 3 s hiány után tűnik el,
  így a határérték körüli ingadozás nem villog. 
- **Kerek gombok** (64 px, üveg): bejelentés, kézi mérés, beállítások; a kereső ugyanilyen, de felül, a GPS-pill sorában (AW16).
- **Lap** (bottom sheet): bejelentés-rács (2 oszlop, 76 px-es csempék), beállítások.
- **Átlagmérés eleje / vége (AW16):** a bejelentés-rács alján két teljes szélességű csempe, „Átlagmérés eleje” és „Átlagmérés
  vége”: egy-egy ideiglenes kapu a jelenlegi helyről és haladási irányból (a meglévő kapu-jelentés) – ismeretlen mérési zóna
  bejelentésére; irány nélkül tiltott. A kézi mérés (stopper-gomb) **privát**: nem küld semmit a szerverre, hálózat nélkül is
  megy; az „ideiglenes szakasz” folyamat, a kapu-küldés és az „Újra” gomb megszűnt.
- **Kézi átlagmérés navigáció közben (AW16):** a kártya 5 s után (vagy ha a navigációnak hely kell: manőver < 500 m,
  ajánlat-kártya, közeli kamera) a mérőkártya lekicsinyített változatává zsugorodik a gombsor jobb oldalán: a nagy átlag-szám
  (40 px) mindig a kézi mérés semleges (accent, `kezi`) színében, mint a teljes kézi kártyán – kézi mérésnél nincs referencia, nincs
  státusz-szín –, alatta kicsiben „km/h átlag” és az eltelt idő; Leállítás nélkül. Bökésre a
  teljes kártya, újabb bökésre vagy 5 s után vissza. Indítás után az első 5 s-ban hely-igény mellett is nyitva marad, de 3 s után
  összemegy. A zsugorított kártya alatt a navigáció teljes. Navigáció nélkül a nagy kártya marad. Az eredmény navigáció közben
  egysoros, kompakt kártya (mint a szakaszé).
- **Navigáció – elrendezés (AW17, web és iOS):** az alsó navigációs sáv (sebesség · érkezés · hátralévő · Befejezés)
  navigáció közben **mindig a képernyő alján**; a mérőkártya (és minden más alsó kártya) fölötte, soha nem alatta és nem
  helyette. Szakaszmérés közben a sávban nincs pillanatnyi sebesség (a mérőkártya „most” mezője mutatja), csak érkezés +
  hátralévő + Befejezés. A sáv km/h-ja `over` (piros), ha a kijelzett sebesség a bal alsó tábla limitje fölött van – csak
  szín, hang, rezgés, értesítés nincs. Mérés + „Gyorsabb út” ajánlat egyszerre: a mérőkártya **egysoros** (átlag 30 px a
  státusz színével · „most / várható” 28 px · kis tábla), az ajánlat eltűnése után visszanő. A kompakt ajánlat egy szöveg:
  „Kijárat 56 · 2,5 km · −7 perc gyorsabb” (keskeny képernyőn tördelve, nem levágva). A manőverkártya „Utána” sora csak
  5 km-en belüli következő manővernél látszik.
- **Útvonalválasztó címke (AW17):** a „+N perc” buborék helye képernyő-pontban, az aktuális zoomon számolódik
  (`placeAltLabel`): az alternatíva saját (nem közös) szakaszának a kiválasztottól messze eső pontja mellé, fölé / alá / balra
  / jobbra; soha nem takarja a leágazást (12 px) és a cél-jelölőt (40 px-es doboz), és a lehető legkevesebbet takar a két
  vonalból. Ha sehol sem fér ki, rálóghat.
- **Kereső (AW16):** kerek ikon-gomb (ugyanaz a stílus, mint az alsó kerek gomboké) a térkép tetején, a GPS-pill sorában, a
  jobb szélre zárva; csak az üres nézeten; érintésre teljes szélességű keresés.
- **Toast**: rövid visszajelzés felül, 2,5 s.
- **Bejelentések a térképen (A5):** minden aktív bejelentés ikonként (a bejelentés-lap ikonja
  és tónusa; kapunál kezdő/záró), 44 px-es kör 56 px-es érintési céllal, mindig a képernyő felé
  fordulva. Koppintásra kis kártya a HUD fölött: típus, „12 perce”, **Megerősítés** / **Nincs ott**
  (60 px magas gombok, a saját bejelentésnél „Saját bejelentésed”). A térkép üres részére
  koppintva bezárul; mérés közben 3 s után magától is, mérésen kívül nyitva marad bezárásig.
  Dőlés-gesztus (két ujjas pitch) nincs. Lekérés a látható terület szerint, csempe-rácsra kerekítve, 60 s-enként.
- **Fix kamerák (A7):** kicsi, **visszafogott** ikon – 32 px-es lekerekített négyzet (nem kör),
  sötét üveg, halvány él, fehér vonalikon (kamera / jelzőlámpa / kamera + lámpa); 56 px-es
  érintési cél. Nincs tónusszín és fény – a bejelentések (44 px-es, színes kör) hangosabbak.
  Koppintásra kártya: típus, út · határ, forrás (ellenőrzöttnél zöld pipa). Csak a 15 km-es
  körzet kamerái kerülnek a térképre. `zone` láthatóságnál (FR) szaggatott szélű, halvány kör
  (±1 km), pont nélkül; `hide`-nál (CH) semmi.
- **Tervezett rendőrségi mérés (A7):** a vonal halvány sárga (`planned`, 42% átlátszóság, a
  most érintett vonal 75%), a szakaszok alatt. A vonalon haladva (100 m-es tűrés, `PLANNED_MATCH_M` – A10,
  web és iOS közösen; csak a sávra – a navigáció útvonal-elemzése a saját `ROUTE_MATCH_M`-jével, 40 m-rel
  veszi az útvonalra a szakaszt, kamerát és tervezett mérést) felül, a pillek alatt **pulzáló sáv**: sárga pont táguló gyűrűvel
  (transform + opacity), „Tervezett rendőrségi mérés” (22 px, `planned`), alatta „okt 27–nov 2 ·
  **max 90**” (20 px); KRESZ-alapértéknél „max ~90”, időszaknál „· ápr 15. 6:00 – ápr 16. 6:00”.
  Mérés közben (szakasz / kézi) kisebb, egysoros (20 px) – a nagy szám marad a fókusz.
  Letéréskor 2 vonalon kívüli fix után tűnik el (egy kiugró GPS-pont nem tünteti el); be/ki
  `slow` opacity + transform. Beállítás: „Tervezett mérések mutatása” (alapból be).
- **Országos figyelmeztetés (A7):** ha a környéken német kamera/mérés van, egyszer (eszközönként)
  toast: „Németországban a vezető nem használhatja ezt a funkciót” (6 s).
- **Szabad térkép (A5):** húzás, csípés, forgatás. Mozdításkor a követés kikapcsol, és a gombsor
  fölött megjelenik a **„Vissza a helyemre”** (64 px, célkereszt, accent); rá a követő kamera
  animálva (900 ms) áll vissza. Mérés közben 5 s tétlenség után magától is; mérésen kívül csak a
  gombra. Mérés közben a gomb a állapot-sáv helye fölött ül.
- **Mapbox-attribúció (A5):** logó a bal, kompakt „i” a jobb felső sarokban, alapméretben, a
  biztonsági zóna alatt 4 px-re; kinyitva az attribúció több sorba tördel, nem takarja a logót.
  Az állapot-pillek közvetlenül a logó sora alatt (az A4-es helyükön).

## Állapotok

| állapot | mit mutat |
|---|---|
| **nincs szakasz** | **kompakt** (A5): egysoros kártya – pillanatnyi sebesség (`title`, félkövér) + „Nincs mérőszakasz a közelben”; az alsó sötétítés is kisebb, a térkép a képernyő ~80%-át látja. Közeledéskor / méréskor a nagy kártya; a váltásnál a gombsor és a kártya a régi helyéről csúszik (FLIP, `base`), az autó helye simán követi |
| **közeledés** | kártya: út + irány, „múlva” távolság (`display`), határ-tábla; a szakasz vonala kiemelve |
| **mérés** | HUD-kártya; a szín az egy állapotból (jo / lassits / tul_gyors); alagútban „becsült” jelzés |
| **befejezve** | összegzés: végső átlag (hero, státuszszín), ítélet („határ alatt” / „+4 km/h”), hossz, idő, határ; 60 s után eltűnik |
| **kézi mód** | HUD az `accent` színnel (nincs határ): átlag, megtett út, idő, nagy „Leállítás” gomb; utána összegzés (bejelentés nélkül) |
| **ideiglenes szakasz** | mint a kézi mód, „Ideiglenes szakasz” chip és „Vége · záró kapu” gomb; az összegzés a kapuk küldésének állapotát mutatja (hiba esetén „Újraküldés”) |
| **megszakadt** | szürke kártya ⏸ ikonnal: ok (háttérbe került / letértél / ellenirány / nincs GPS) és „Az átlag nem érvényes” – nincs szám |

## Mozgás

`fast` 160 ms, `base` 280 ms, `slow` 480 ms; görbe `cubic-bezier(0.2, 0.8, 0.2, 1)`.
Adatkövető átmenet (progress, kamera): 1000 ms lineáris – pont a GPS-ütem.

## Térkép

Mapbox Standard, `lightPreset` automatikusan (napállás + a térképstílus; a készülék sötét módja nem számít), POI- és tömegközlekedési
címkék nélkül.

**Téma (A4-döntés):** alapból a Standard `default` témája – a színes, 3D-s look marad. A nyugalmat
a UI-rétegek adják (üveg, kevés saját szín, felső/alsó sötét átmenet), **nem a térkép
szegényítése**. A Beállításokban „Térkép: Világos / Színes / Visszafogott” választó (`default` / `default` / `monochrome`), alapból
színes. **Fény (AW16):** napközben a beállítás dönt – „Világos” = nappali fény (`day`), „Színes” = alkonyi fény (`dusk`);
hajnalban (`dawn`), napnyugtakor (`dusk`) és éjjel (`night`) mindkettő a napszaké; „Visszafogott” végig a napszak szerint. A
térkép-rétegek (pl. alternatív útvonal) az alkalmazott fényhez igazodnak. Nappali fényű „Világos” térképen az üveg-felületek a
`surfaceStrong` kitöltést kapják (a halvány szöveg a legvilágosabb háttéren is ≥ 5:1), a kártyák sötétek maradnak. Kamera: pitch 60°, haladási irány felfelé, az autó a képernyő alsó harmadában
(a HUD fölött). A szakaszok vonala halványan, az aktív a státuszszínnel, a megtett rész teltebb.
