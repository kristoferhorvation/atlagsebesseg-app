# Adatforrás és licenc

A `sections.IT.json` és a `sections.AT.json` (és minden `source: "osm"` szakasz) az
**OpenStreetMap** adataiból származik:

> © OpenStreetMap contributors – https://www.openstreetmap.org/copyright

Az adatbázis az **Open Database License (ODbL) 1.0** alatt érhető el:
https://opendatacommons.org/licenses/odbl/1-0/

Ebből következik:

- **Forrásmegjelölés kötelező**: az appban (pl. a térkép alatt vagy a Névjegy oldalon) és minden
  terjesztett adatfájl mellett fel kell tüntetni: „© OpenStreetMap contributors”.
- **Share-alike**: ha ezt az adatbázist (vagy belőle származtatott adatbázist) nyilvánosan
  terjesztjük, azt is ODbL alatt kell elérhetővé tenni. Ez az adatbázisra vonatkozik, az app
  forráskódjára nem.
- A közösségi (`kozosseg`) és a hivatalos (`hivatalos`) forrású szakaszok külön kezelendők;
  OSM-adattal keverve a származtatott adatbázisra az ODbL vonatkozik.

`sections.HU.json`: nem OSM-adat, egyelőre üres (TODO: a hivatalos lista).

## Hivatalos források (A6)

A `source: "hivatalos"` szakaszok kapuhelye és határa hivatalos listákból származik, a vonaluk
(geometria) az OpenStreetMap úthálózatából – így a fájlokra az ODbL is vonatkozik. Források:

| Ország | Forrás | Licenc / felhasználás |
|---|---|---|
| PL | GITD / CANARD eszköztérkép (canard.gitd.gov.pl) | közhiteles nyilvános adat; tényadat (helyszín, határ) |
| IT | Polizia di Stato (Tutor-lista), Autostrade per l'Italia (km-szelvények) | tényadat, forrásmegjelöléssel |
| FR | Ministère de l'Intérieur – data.gouv.fr „Liste des radars fixes en France”; radars.securite-routiere.gouv.fr | Licence Ouverte 2.0 (data.gouv); tényadat |
| ES | DGT – Punto de Acceso Nacional (DATEX II), DGT „Listado de cinemómetros” | CC BY (NAP) |
| NL | Openbaar Ministerie (trajectcontroles); Rijkswaterstaat NWB hectopunten | tényadat; NWB: CC-0 |
| AT | ASFINAG; RIS – Section Control-Messstreckenverordnungen | jogszabály (közkincs) |

A szakaszonkénti forrást (név, URL, dátum) a `provenance` mező, az app szakasz-kártyája pedig a
„Forrás: …” sor mutatja.
