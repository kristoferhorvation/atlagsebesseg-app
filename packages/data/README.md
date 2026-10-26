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
npm run import:sections                       # IT,AT
npm run import:sections -- --country IT --limit 5
npm run import:sections -- --country AT --endpoint https://overpass.kumi.systems/api/interpreter
```

Opciók: `--country IT,AT`, `--endpoint <url>` (vagy `OVERPASS_ENDPOINT`), `--limit N`,
`--delay ms` (relációnkénti várakozás, alapból 1500 – légy kíméletes a nyilvános Overpass-szal), `--out <dir>`.

Kimenet: `output/sections.IT.json`, `output/sections.AT.json` (`Section[]`, plusz `skipped`).
`output/sections.HU.json`: üres lista + TODO – Magyarországon a bevezetés még nem történt meg,
a hivatalos listából töltjük.

> **Megjegyzés:** az első körben a felhős fejlesztői környezet nem érte el az Overpass API-t
> (`overpass-api.de` – DNS/proxy tiltás), ezért az IT/AT fájlok még üresek. Az importot helyben kell futtatni.

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
