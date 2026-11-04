# Web–iOS paritás (AOS18)

A web az etalon. A harness (`packages/parity`) két dolgot mér:

- **`specs/*.json`** – a jóváhagyott webes komponensek computed style-ja és mért mérete (`npm run parity:specs`, iPhone 17 Pro méret). Az iOS `AtlagsebessegTests/ParityTests.swift` ezekre assertál.
- **`diff/`** – azonos állapotok képei web · iOS · diff elrendezésben (`npm run parity`), a küszöb és az eredmény a `diff/README.md`-ben és a `diff/summary.json`-ban.

A térkép helyén mindkét oldalon egyszínű háttér áll, ezért a kapu a UI-réteget méri. A térképi elemeket (GPS-jelölő, „+N perc” címke, kamera) a specek, a tokenek és a valódi térképes képek ellenőrzik. A részletek: `CLAUDE.md` › Paritás-harness.
