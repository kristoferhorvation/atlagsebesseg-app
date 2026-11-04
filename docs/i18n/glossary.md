# Szótár-glosszárium (AW21, 2026-11-04)

Az app **tegez**: „Szia, indulhatunk!” – DE „du” (soha „Sie”), a többi nyelven a tegező forma
(EN „you”, SK „ty”, CS „ty”, PL „ty”). A szótár: `packages/app-logic/src/i18n/<nyelv>.json`.

| hu | de | en | sk | cs | pl |
|---|---|---|---|---|---|
| szakaszellenőrzés | Abschnittskontrolle | section control / average speed check | úseková kontrola (úsekové meranie rýchlosti) | úsekové měření | odcinkowy pomiar prędkości |
| átlagsebesség | Durchschnittsgeschwindigkeit | average speed | priemerná rýchlosť | průměrná rychlost | średnia prędkość |
| kapu (szakasz kapuja) | Messpunkt | gate | brána | brána | bramka |
| kamera (fix) | Blitzer | speed camera | radar | radar | fotoradar |
| bejelentés | Meldung | report | hlásenie | hlášení | zgłoszenie |
| dugó | Stau | traffic jam | zápcha | zácpa | korek |
| lehajtó | Ausfahrt | exit | výjazd | výjezd | zjazd |
| Haza / Munka | Zuhause / Arbeit | Home / Work | Domov / Práca | Domů / Práce | Dom / Praca |

## Szabályok
- Placeholderek ({n}, {km}, …) változatlanul, a célnyelv természetes szórendjében; minden nyelvben ugyanaz a készlet.
- Hang-szövegek (TTS, `*.voice.*`): kiejthető, rövid mondat; jel- és rövidítés nélkül (ne „km/h”, hanem a kimondott alak, ha a TTS rosszul olvassa).
- Márkanevek (Mapbox, OpenStreetMap), „km/h”, mértékegységek és számok nyelvenként azonosak lehetnek.
