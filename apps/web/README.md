# apps/web – PWA

Vite + React + TypeScript, mobil-first. iPhone-on Safariból a kezdőképernyőre tehető, és vezetés
közben (telefon tartóban, kijelző bekapcsolva) méri az átlagsebességet. A dizájn: [`DESIGN.md`](../../DESIGN.md),
a tokenek: `packages/design-tokens`. A logika a mobillal közös: `packages/app-logic`
(mérés-munkamenet, szakasz-cache, bejelentések, Supabase, lightPreset).

## Beállítás

```bash
cp apps/web/.env.example apps/web/.env   # VITE_MAPBOX_TOKEN=pk.…, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev --workspace apps/web         # http://localhost:5173
```

- **Mapbox-token nélkül** a térkép helyén sötét háttér van – a HUD, a szimulátor és a mérés így is megy.
- **Supabase nélkül** offline mód: csak a beépített 30 szakasz (`packages/data/output`), bejelentés nincs.

## Szimulátor (GPS nélkül, asztali gépen)

`http://localhost:5173/?sim` – a core tesztjeinek vezetés-generátorával (`drive()`, zaj, alagút)
lejátszott útvonal: a core tesztpályája vagy a leghosszabb beépített szakaszok. A panelen:
forgatókönyv (jó ütem / túl gyors / gyors, majd lassít – ez mind a 3 állapotot végigjárja / alagút), 1×/4×/12×, „Háttérbe”
(a megszakítás kipróbálása).

Közvetlen ugrás egy állapotra (dizájn-iterációhoz):

```
/?sim=jo&seek=0.15        közeledés
/?sim=lassit&seek=0.35    mérés, túl gyors (piros)
/?sim=lassit&seek=0.50    mérés, lassíts (borostyán)
/?sim=lassit&seek=0.80    mérés, jó ütem (zöld)
/?sim=tul&seek=0.6        mérés, túl (piros)
/?sim=jo&seek=0.97        befejezve (összegzés)
/?sim=alagut&seek=0.45    alagút (becslés)
&route=1 … 6              valódi (beépített) szakasz; &speed=1|4|12
```

## iPhone-on, a helyi hálózaton

A geolocation csak HTTPS-en működik, ezért:

```bash
npm run dev:https --workspace apps/web
```

Ez a `vite-plugin-mkcert`-tel helyi tanúsítványt készít (első futáskor letölti az mkcert-et, a
gépre telepíti a helyi CA-t – jelszót kérhet), a tanúsítvány a gép helyi IP-címeire is szól. A
kimenet `Network:` sora adja a címet, pl. `https://192.168.0.28:5173`.

1. A CA-t az iPhone-ra is fel kell tenni: `~/.vite-plugin-mkcert/rootCA.pem` → AirDrop az
   iPhone-ra → Beállítások → *Profil letöltve* → Telepítés; majd Beállítások → Általános → Névjegy →
   Tanúsítványmegbízhatósági beállítások → a „mkcert …” kapcsoló be.
2. Az iPhone ugyanazon a Wi-Fin legyen; Safariban a `Network:` címet nyisd meg.
3. Megosztás → Főképernyőhöz adás → az ikonról indítva teljes képernyőn fut.

Alternatíva tanúsítvány-telepítés nélkül: egy alagút valódi tanúsítvánnyal, pl.
`npx cloudflared tunnel --url http://localhost:5173` vagy `ngrok http 5173` – ilyenkor a kiírt
`https://…` címet kell megnyitni (a Mapbox-token URL-korlátozásához ezt a domaint is add hozzá).

## Viselkedés

- **GPS:** `watchPosition`, `enableHighAccuracy`, `maximumAge: 0`.
- **Kijelző:** Screen Wake Lock; előtérbe érve újrakéri. Ha nem elérhető vagy elengedte a rendszer,
  a felső sávban sárga „Kijelző elalhat” pill jelzi (koppintásra újrapróbál).
- **Háttérbe kerülés:** a böngésző a háttérben nem ad GPS-t, ezért a futó mérés **megszakad**
  (`megszakadt` állapot, „Az átlag nem érvényes”), és a következő szakasz belépő kapujánál indul újra
  – nem becsül tovább, nem ad hibás átlagot. Kézi mérésre ugyanez vonatkozik.
- **PWA:** manifest, ikonok, standalone. A service worker csak az app shellt cache-eli (build-időben
  generált lista); a Mapbox-csempék, a Mapbox API és a Supabase nem kerül cache-be. A 30 beépített
  szakasz a bundle része, a Supabase-ből csempénként frissül (localStorage-cache, 24 óra).
- **Térkép:** `src/map/MapboxWebAdapter.tsx` az egyetlen Mapbox-függő fájl (lustán töltve); a
  `WebMapAdapter` a mobil `MapAdapter` megfelelője (közös `MapController`).

## Ellenőrzés

```bash
npm test --workspace apps/web        # szimulátor (valódi szakaszon is), GPS-konverzió
npm run typecheck --workspace apps/web
npm run build --workspace apps/web   # dist/ + sw.js
```
