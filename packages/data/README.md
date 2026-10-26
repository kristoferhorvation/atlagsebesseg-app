# @atlagsebesseg/data – szakasz-import

Átlagsebesség-mérő szakaszok importja az OpenStreetMapből, az Overpass API-n át.

## Mit kérdez le

1. Országonként az összes `type=enforcement` + `enforcement=average_speed` relációt és a tag-nodokat
   (`from`, `to`, `device`) – `relationsQuery(cc)`.
2. Relációnként a környék autópálya-/főúthálózatát geometriával – `roadsQuery(bbox)`.
3. Az úthálózaton (egyirányúság szerint, Dijkstra) a kezdő→végpont legrövidebb útja adja a
   szakasz vonalát. Így osztott pályás autópályán a **helyes pályatestet** kapjuk, és a hossz
   az útvonal menti hossz.

Kezdőpont/végpont: `from`/`to`; ha csak `device`-ok vannak, az első és az utolsó, az irányt pedig
az úthálózat egyirányúsága dönti el (kétirányú úton ilyenkor a reláció kimarad).
Sebességhatár: a reláció `maxspeed`-je, ennek hiányában az út `maxspeed`-je.
A kihagyott relációk indokkal a kimenet `skipped` mezőjébe kerülnek.

## Futtatás (helyi gépen – kell hozzá internet)

```bash
npm run import:sections                       # IT,AT,HU
npm run import:sections -- --country IT --limit 5
npm run import:sections -- --country AT --endpoint https://overpass.kumi.systems/api/interpreter
```

Opciók: `--country IT,AT`, `--endpoint <url>` (vagy `OVERPASS_ENDPOINT`), `--limit N`,
`--delay ms` (relációnkénti várakozás, alapból 1500 – légy kíméletes a nyilvános Overpass-szal), `--out <dir>`.

Kimenet: `output/sections.<CC>.json` (`Section[]`, plusz `skipped`). Alapból IT, AT és HU.

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
