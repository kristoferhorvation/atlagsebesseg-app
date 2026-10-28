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
- **Kerek gombok** (64 px, üveg): bejelentés, kézi mérés, beállítások.
- **Lap** (bottom sheet): bejelentés-rács (2 oszlop, 76 px-es csempék), beállítások.
- **Ideiglenes szakasz (A4-döntés):** a bejelentés-rácsban **egy** teljes szélességű csempe,
  „Ideiglenes szakasz kezdete”: elindítja a kézi mérést **és** bejelenti a kezdő kaput (ha még
  nincs irány, a kezdő kapu a mérés első pontjából a végén megy el). Mérés közben a gomb
  „Vége · záró kapu”: lezárja és bejelenti a záró kaput. A sima „Kézi mérés” (stopper-gomb)
  bejelentés nélkül marad külön. A két külön kapu-csempe megszűnt.
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
  most érintett vonal 75%), a szakaszok alatt. A vonalon haladva (ugyanaz a 40 m-es illesztés,
  mint a szakaszoknál) felül, a pillek alatt **pulzáló sáv**: sárga pont táguló gyűrűvel
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

Mapbox Standard, `lightPreset` automatikusan (rendszermód + napállás), POI- és tömegközlekedési
címkék nélkül.

**Téma (A4-döntés):** alapból a Standard `default` témája – a színes, 3D-s look marad. A nyugalmat
a UI-rétegek adják (üveg, kevés saját szín, felső/alsó sötét átmenet), **nem a térkép
szegényítése**. A Beállításokban „Térkép: színes / visszafogott” kapcsoló (`default` /
`monochrome`), alapból színes. Kamera: pitch 60°, haladási irány felfelé, az autó a képernyő alsó harmadában
(a HUD fölött). A szakaszok vonala halványan, az aktív a státuszszínnel, a megtett rész teltebb.
