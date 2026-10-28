# @atlagsebesseg/data – szakasz-import

Átlagsebesség-mérő szakaszok importja: **hivatalos listákból** (A6) és az **OpenStreetMapből**.

**Elsőbbségi szabály:** a hivatalos adat elsőbbséget élvez, de az OSM-szakasz nem ellenőrzöttként
(`verified: false`) megmarad, ha nincs hivatalos párja. **Duplikátum** = ugyanaz az út (normalizált
útszám), ugyanaz az irány (kezdő→vég irányszög < 90°), és a geometria legalább **70%-ban átfed**
(a pontok 30 m-en belül, a rövidebbik hosszára vetítve) – ilyenkor csak a hivatalos marad
(`mergeOfficialWithOsm`). Minden más OSM-szakasz marad.

Rétegek: `osm/sections.<CC>.json` – az OSM-import (`npm run import:sections`); `output/sections.<CC>.json`
– az appba és a DB-be kerülő összefésült lista (`npm run import:official`), a duplikátumként kiesett
OSM-szakaszok az `official.osmDuplicates` listában.

## Hivatalos listák (A6) – `npm run import:official`

Alapelv: **csak biztos adat kerül be.** Ami nem azonosítható egyértelműen vagy nem illeszthető
útvonalra, kimarad, és a kimeneti fájl `official.skipped` listájába kerül **név szerint, okkal**.

```bash
npm run import:official                                  # PL,IT,FR,ES,NL,AT
npm run import:official -- --country IT                  # egy ország
npm run import:official -- --country PL --refresh        # a forrás újratöltése (különben cache/)
```

A letöltések és az Overpass-válaszok a `cache/` mappába kerülnek (nem kerül a repóba); újrafuttatás
hálózat nélkül is megy, amíg a cache megvan.

### Közös formátum

Minden szakasz `provenance` mezője: a forrás (hivatalos szerv) **neve**, **URL**-je, **dátuma**
(`YYYY-MM` vagy `YYYY-MM-DD`) és az **azonosítás módja** (`koordinata` / `km_szelveny` /
`telepules`). Hivatalos szakasz: `source: "hivatalos"`, `verified: true`. OSM-szakasz:
`source: "osm"`, `verified: false`, forrás = a reláció URL-je és az import napja. A DB-ben:
`sections.source_name / source_url / source_date / located_by` (hivatalos szakasznál kötelező).
A kimeneti fájl `official` mezője: források, a listán szereplő tételek száma (irányonként), a
bekerültek száma, a kihagyottak okkal, és a megjegyzések (pl. „határ az OSM-ből”).

### Ellenőrzés minden tételre (`src/official.ts` – `evaluateOfficial`)

1. **Útvonal:** irányhelyes útvonal a két kapu között az OSM-úthálózaton (egyirányúság szerint –
   osztott pályán a helyes pályatest); a kapuk legfeljebb 60 m-re (km-szelvényből számolt helynél
   80–150 m-re) az úttól.
2. **Hossz:** 0,5–50 km; ha a forrás ad hosszt (vagy két km-szelvényt), az útvonal legfeljebb 15%-kal
   (min. 400 m-rel) térhet el tőle – a végső hossz a hivatalos.
3. **Útszám:** az útvonal hosszának ≥ 80%-a a megadott útszámú OSM-úton fut (`ref`; szóköz,
   kötőjel nem számít; PL: `DK7`/`DW132` = OSM `7`/`132`).
4. **Határ:** a forrásból; ha a forrás nem adja, az OSM `maxspeed`, de csak ha az útvonal ≥ 80%-án
   ugyanaz (megjegyzés a kimenetben) – különben kimarad.

### Országok és források

| Ország | Forrás | Letöltés módja | Helymeghatározás |
|---|---|---|---|
| **PL** | GITD / CANARD eszköztérkép – https://www.canard.gitd.gov.pl/cms/web/guest/o-nas/mapa-urzadzen | A térképoldal HTML-jében `fotoradaryOPP` (LZString base64) = OPP-eszközök; eszközönként `POST …?p_p_resource_id=/objdata…&_…_type=OPP` (body `…_id=<id>`, LZString UTF16): útszám, két pont koordinátája, irányonkénti hossz, határ, állapot, hitelesítés. A portlet-azonosítót és a végpontot az importer a HTML-ből olvassa. | koordináta |
| **IT** | Polizia di Stato – https://www.poliziadistato.it/articolo/tutor (2026-08; PDF „aggiornato al 27 maggio 2026”, 204 tratta) + Autostrade per l'Italia – https://www.autostrade.it/it/tecnologia-sicurezza/sicurezza/il-tutor | ASPI HTML-táblázat (178 tratta km-szelvénnyel; mind szerepel a Polizia-listán). A Polizia-PDF-ben az autópálya-jelölés kép, ezért a nem-ASPI tratták listája kézzel kivonatolva: `manual/it-polizia-nem-aspi.json`. | km-szelvény → OSM `highway=milestone`: két szomszédos (≤ 3 km), konzisztens km-kő közti interpoláció; a jelöltek szórása ≤ 400 m. Egész úton való lineáris vetítést nem használunk (nem biztos). |
| **FR** | Ministère de l'Intérieur – data.gouv.fr „Liste des radars fixes en France” (Licence Ouverte 2.0) + radars.securite-routiere.gouv.fr | Az adathalmaz API-ja (`/api/1/datasets/6712583387af110196942793/`) adja a legfrissebb CSV-t (latin-1, `;`), ETVM = radar tronçon. Tronçononként `GET https://radars.securite-routiere.gouv.fr/radars/<id>?_format=json`: útszám, irány („X vers Y”), hossz. | A forrás **egy pontot** ad. A kapuk az OSM `enforcement=average_speed` relációjából, ha **pontosan egy** reláció: ≤ 150 m-re a ponttól, a hivatalos úton, hosszal, határral, és a „X vers Y” irányban (OSM-település alapján). |
| **ES** | DGT NAP, DATEX II (CC BY) – https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml + DGT „Listado de cinemómetros” PDF (2025-03-21) | DATEX: `GUID_Inventario_CinemometrosVelocidadMedia` halmaz, `from`/`to` koordináta, ini/fin km. A PDF-összevetés: `manual/es-dgt-pdf-2025-03.json`. Katalónia és Baszkföld nincs benne. | koordináta |
| **NL** | Openbaar Ministerie – https://www.om.nl/onderwerpen/v/verkeer/handhaving/snelheid-en-te-hard-rijden/trajectcontroles (2026-06-18) | Csak helyszínnevek; irány a WAHV-PDF-ből, hectometer és határ az OM-hírekből – soronként a forrás-URL-lel: `manual/nl-om-trajecten.json`. | hectometer → Rijkswaterstaat NWB (CC-0) WFS `hectopunten` a fő pályán (`bst_code` = HR) |
| **AT** | ASFINAG (6 fix Section Control, lista nélkül) + RIS: hatályos „Section Control-Messstreckenverordnung”-ok (km) | `manual/at-asfinag-section-control.json` | A meglévő 10 OSM-szakasz marad; ami a rendeleti km-ekből (OSM km-kövek) számolt kapukkal egyezik (≤ 400 m, hossz ±15%), ellenőrzött lesz. |
| **HU** | nincs hivatalos lista | – | 0 szakasz |

A `manual/*.json` fájlok tényadatok a hivatalos forrásokból (szó szerint, forrás-URL-lel); ott,
ahol a forrás nem géppel olvasható (PDF-kép, hírek), ezek adják az importer bemenetét.

### Feltöltés

`npm run upload:sections` – upsert; nem töröl, kivéve az `official.osmDuplicates` OSM-sorait (azokból
a szabály szerint csak a hivatalos pár marad). Előfeltétel: a `20261028000000_sections_forras.sql`
migráció élesítve (`npm run db:live`). Feltöltés után az élő darabszámot ellenőrizni kell.

## OSM-import – `npm run import:sections`

### Mit kérdez le

1. Országonként az összes `type=enforcement` + `enforcement=average_speed` relációt és a tag-nodokat
   (`from`, `to`, `device`) – `relationsQuery(cc)`.
2. Relációnként a környék autópálya-/főúthálózatát geometriával – `roadsQuery(bbox)`.
3. Az úthálózaton (egyirányúság szerint, Dijkstra) a kezdő→végpont legrövidebb útja adja a
   szakasz vonalát. Így osztott pályás autópályán a **helyes pályatestet** kapjuk, és a hossz
   az útvonal menti hossz.

Kezdőpont/végpont: `from`/`to`; ha csak `device`-ok vannak, az első és az utolsó, az irányt pedig
az úthálózat egyirányúsága dönti el (kétirányú úton ilyenkor a reláció kimarad).
Sebességhatár: a reláció `maxspeed`-je, ennek hiányában az út `maxspeed`-je.
Útszám: a reláció `ref`-je, de ha az mérőeszköz-kód (pontot vagy ≥ 5 egymás utáni számjegyet tartalmaz –
PL „CAN.O.2.006”, NL „a0020001”), az útvonal útjainak leggyakoribb `ref`-je. (A6: a PL-réteg 191 ilyen
szakaszának útszáma utólag, a geometria alatti utakból lett pótolva – 5 mintapont, ≥ 4 egyezés,
különben üres; lásd a fájl `note` mezőjét.)
A kihagyott relációk indokkal a kimenet `skipped` mezőjébe kerülnek.

### Futtatás (helyi gépen – kell hozzá internet)

```bash
npm run import:sections                       # IT,AT,HU
npm run import:sections -- --country IT --limit 5
npm run import:sections -- --country AT --endpoint https://overpass.kumi.systems/api/interpreter
```

Opciók: `--country IT,AT`, `--endpoint <url>` (vagy `OVERPASS_ENDPOINT`), `--limit N`,
`--delay ms` (relációnkénti várakozás, alapból 1500 – légy kíméletes a nyilvános Overpass-szal), `--out <dir>`,
`--from N` (a relációk azonosító szerint rendezve; `--limit`-tel együtt részfutáshoz).

Kimenet: `osm/sections.<CC>.json` (`Section[]`, plusz `skipped`) – az OSM-réteg; az `output/` a
hivatalos importtal összefésült változat. Alapból IT, AT és HU.

Forrásonként (minden országra):

1. `enforcement=average_speed` **relációk** (lásd fent);
2. **címkézett utak**: `maxspeed:enforcement=average_speed` vagy `enforcement=average_speed` a
   way-en – az összefüggő, azonos irányú utakat láncba fűzi (kétirányú úton két szakasz);
   ami relációként már megvan, nem duplikálódik;
3. **kézi lista**, ha van `manual/<cc>-manual.json` – összefésülés: ha egy kézi bejegyzés kapui
   300 m-en belül esnek egy OSM-szakaszéra, a kézi nyer (hivatalos/ellenőrzött), és ha neki
   nincs geometriája, az OSM-ét kapja meg.

## Magyarország – `manual/hu-manual.json`

Az OSM-ben a magyar átlagsebesség-mérés várhatóan sokáig hiányos lesz, ezért a magyar
szakaszokat kézzel is karbantartjuk. Egy bejegyzés = kezdőkapu + zárókapu + irány + határ:

```json
{
  "country": "HU",
  "sections": [
    {
      "id": "hu-m1-pelda",
      "road": "M1",
      "direction": "Budapest → Győr",
      "start": { "lat": 47.0, "lon": 18.0 },
      "end":   { "lat": 47.1, "lon": 17.8 },
      "headingDeg": 300,
      "speedLimitKmh": 130,
      "lengthM": 12400,
      "source": "hivatalos",
      "verified": true,
      "reference": "https://… (közlemény / közlöny / saját mérés dátuma)",
      "note": "opcionális"
    }
  ]
}
```

(A fenti koordináták csak a formátumot mutatják, nem valódi szakaszt.)

- Kötelező: `id` (egyedi, stabil), `road`, `direction`, `start`, `end`, `speedLimitKmh` (20–200),
  `source` (`hivatalos` | `kozosseg`), `verified`, `reference` (forrás nélkül nem vesszük fel).
- Opcionális: `headingDeg` (ellenőrzi, hogy nem fordított-e a start/end), `lengthM` (hivatalos
  hossz – felülírja a számoltat), `note`.
- A geometriát az import az úthálózatból keresi (ugyanazzal a kapu→kapu útvonalkereséssel, mint
  a relációknál), így a helyes pályatestre kerül. Az import a fájlt ellenőrzi (`validateManualFile`),
  hibás fájllal leáll.

### Honnan szerezhető magyar adat

- **Hivatalos közlemények**: a szakaszos (átlag)sebesség-mérés bevezetésének jogszabályi
  háttere a **Magyar Közlönyben** jelenik meg; a helyszíneket várhatóan a **police.hu**
  (ORFK-OBB, VÉDA-rendszer) és a **Magyar Közút Nonprofit Zrt.** (kozut.hu) teszi közzé.
  Ezeket `source: "hivatalos"`, `verified: true` jelöléssel, a közlemény URL-jével vegyük fel.
- **VÉDA-kapuk**: a VÉDA kamerák helyszínlistája (police.hu) jó kiindulópont a kapuk
  koordinátáihoz, de egy kapu még nem jelent átlagsebesség-mérést – csak a hivatalosan
  szakaszmérésre kijelölt kapupárokat vegyük fel.
- **OSM-közösség**: a magyar OSM-közösség (openstreetmap.hu, OSM-fórum) – ha valaki felcímkézi
  a relációkat, az import magától felveszi őket.
- **Saját mérés / közösség**: kézi mérésből (`source: "kozosseg"`, `verified: false`), a
  dátummal és a mérő nevével a `reference`-ben; vagy az app ideiglenes-kapu bejelentéseiből.

**Licenc-figyelmeztetés:** a hivatalos honlapok tartalma nem feltétlenül szabadon
felhasználható; tényadatot (kapu helye, határ) rögzítsünk, ne másoljunk át táblázatokat, és a
forrást mindig tüntessük fel. Az OSM-mel összefésült adatbázisra az ODbL vonatkozik.

> **Megjegyzés:** a felhős fejlesztői környezet nem érte el az Overpass API-t
> (`overpass-api.de` – DNS/proxy tiltás), ezért az IT/AT/HU fájlok még üresek. Az importot helyben kell futtatni.

### Valódi geometria a core tesztjeihez

Import után:

```bash
npm run fixture --workspace @atlagsebesseg/data -- --country IT          # a leghosszabb szakasz
npm run fixture --workspace @atlagsebesseg/data -- --country IT --id osm-123456
```

Ez a `packages/core/test/fixtures/osm/` mappába ír; a `real-geometry.test.ts` automatikusan
lefut rajta (fixtúra nélkül a teszt `skipped`).

## Licenc – ODbL

Az OSM-ből származó adat **© OpenStreetMap contributors**, **ODbL 1.0**. A forrásmegjelölés
kötelező az appban és az adatfájlok mellett (minden kimeneti fájl `attribution`/`license` mezőt
is tartalmaz). Részletek: [`output/ATTRIBUTION.md`](output/ATTRIBUTION.md).
