# Adatvédelmi tájékoztató – Tempomate (Átlagsebesség)

**Verzió:** 1.0 · **Hatályos:** 2026. november 6. · **Nyelv:** magyar (az angol és a többi nyelvi változat fordítás; eltérés esetén a magyar az irányadó)

Ez a tájékoztató leírja, milyen személyes adatot kezel a Tempomate (magyarul: Átlagsebesség) iPhone-alkalmazás és webes alkalmazás (`app.tempomate.app`), mire használjuk, kinek adjuk át, meddig őrizzük, és milyen jogaid vannak. A tájékoztató az Európai Unió általános adatvédelmi rendelete (**GDPR**, (EU) 2016/679 rendelet) és az információs önrendelkezési jogról és az információszabadságról szóló **2011. évi CXII. törvény (Infotv.)** alapján készült.

> **[ÜGYVÉDI ÁTNÉZÉS 1]** Az adatkezelő adatai egyéni fejlesztőként szerepelnek. Ha a szolgáltatást vállalkozás (egyéni vállalkozó, kft.) nyújtja, a nevet, a székhelyet és a nyilvántartási számot ki kell cserélni.

## 1. Az adatkezelő

- **Név:** Horváth Kristóf, egyéni fejlesztő
- **Cím:** 1XXX Budapest, [utca, házszám] *(kitöltendő)*
- **E-mail:** hello@tempomate.app
- **Weboldal:** https://tempomate.app

Adatvédelmi tisztviselőt nem neveztünk ki, mert a jogszabály nem írja elő. Adatvédelmi kérdésben a fenti e-mail-címen érsz el minket.

## 2. Röviden

- Az app **fiók nélkül is teljes értékűen működik**. Fiók nélkül egy **véletlenszerű, névtelen azonosítót** kapsz, nevet, e-mail-címet vagy telefonszámot nem kérünk.
- A **helyadatodat** a mérés, a navigáció és az utak naplója miatt használjuk. Az utak naplója és a saját hőtérképed **a készülékeden** van; a szerverre csak akkor kerül, ha fiókkal bekapcsolod a felhőmentést.
- A **közösségi hőtérképhez** csak összevont, névtelen útszakasz-adat megy fel, az utak eleje és vége, valamint a mentett helyeid környéke soha. Ez kikapcsolható.
- Nem jelenítünk meg hirdetést, nem követünk más alkalmazásokon vagy webhelyeken át, és **nem adjuk el** az adataidat.

## 3. Milyen adatot, mire és milyen jogalapon kezelünk

### 3.1 Helyadat (előtérben és háttérben)

- **Mi:** a GPS-pozíció (szélesség, hosszúság, pontosság), a sebesség és a haladási irány.
- **Mire:** az átlagsebesség-mérő szakaszok felismerése és mérése, a navigáció, a figyelmeztetések, az utak naplója (krúzing) és a saját hőtérkép. Az iPhone-alkalmazás **zárolt képernyővel (háttérben) is** méri a helyzetedet, ha engedélyezed. Így vezetés közben, a telefon lezárása után sem szakad meg a szakaszmérés. A weben a böngésző a háttérbe tett lap helymeghatározását felfüggeszti.
- **Hol:** a nyers helyadat **a készülékeden** marad (az utak naplója, a saját hőtérkép). A szerverre csak az alábbi 3.3–3.6. pontokban leírt esetekben kerül adat.
- **Jogalap:** a szolgáltatás nyújtása, amelyet te kérsz (GDPR 6. cikk (1) b) pont). A helymeghatározást a telefon beállításaiban bármikor kikapcsolhatod; enélkül a mérés és a navigáció nem működik.

### 3.2 Névtelen eszközazonosító

- **Mi:** az első indításkor a rendszerünk (Supabase Auth) egy véletlenszerű azonosítót (UUID) ad az alkalmazásnak. Ez nem a készülék gyári azonosítója, és nem a hirdetési azonosító (IDFA).
- **Mire:** hogy a bejelentéseidet és a szavazataidat el tudjuk különíteni (pl. ne szavazhass kétszer, a saját bejelentésedről ne kérdezzünk), és a visszaélések (tömeges beküldés) ellen napi korlátot tartsunk.
- **Jogalap:** jogos érdek (GDPR 6. cikk (1) f) pont): a közösségi adatok megbízhatósága és a szolgáltatás védelme.

### 3.3 Közösségi bejelentések és szavazatok

- **Mi:** a bejelentés típusa (pl. baleset, útlezárás, dugó, veszély), a bejelentéskori helyed és haladási irányod, az időpont, a névtelen azonosítód; a szavazatnál (Megerősítés / Nincs ott) a szavazat és az azonosítód.
- **Mire:** hogy más sofőrök is lássák az aktuális eseményt. A bejelentés **mások számára névtelen**: az azonosítódat senki nem látja.
- **Jogalap:** a szolgáltatás nyújtása (6. cikk (1) b) pont) és jogos érdek a közösségi adatok minőségében (6. cikk (1) f) pont).

### 3.4 Dugó-adat

- **Mi:** ha navigáció közben az app dugót érzékel, vagy dugót jelentesz: a hely, az irány, az ott mért átlagsebesség, a dugó hossza, az időpont és a névtelen azonosítód.
- **Mire:** a többi sofőr érkezési idejének pontosítása.
- **Jogalap:** jogos érdek (6. cikk (1) f) pont).

### 3.5 Névtelen vezetési adatok (közösségi hőtérkép)

- **Mi:** utad végén **útszakaszonként összevont** adat: az útszakasz (kb. 25 m), az áthaladások száma, az átlagsebesség, az óra-sáv és a hét napja. **Nem** megy fel: az útvonalad, a pontos időpont, bármilyen azonosító, a mentett helyeid (Haza, Munka stb.) körüli védett zóna (alapból 200 m), valamint az utak első és utolsó 300 métere.
- **Mire:** a közösségi hőtérkép (hol, mikor, milyen tempóban halad a forgalom).
- **Jogalap:** jogos érdek (6. cikk (1) f) pont). **Kikapcsolható:** Beállítások › Adatvédelem › „Névtelen vezetési adatok megosztása”. Kikapcsoláskor a még el nem küldött adat törlődik.
- Az összevont adat a beküldés után nem köthető hozzád, ezért utólag egyenként nem törölhető.

> **[ÜGYVÉDI ÁTNÉZÉS 2]** A névtelen vezetési adatok alapból bekapcsolt megosztása jogos érdeken alapul. Ehhez írásos érdekmérlegelési teszt ajánlott. Érdemes megerősíttetni, hogy az összevont, azonosító nélküli útszakasz-adat anonim adatnak minősül-e.

### 3.6 Fiók (nem kötelező)

- **Mi:** bejelentkezéskor a választott módtól függően:
  - **Apple:** az Apple által adott azonosító, e-mail-cím (vagy az Apple „E-mail-cím elrejtése” címe) és – ha megadod – a neved;
  - **Google:** a Google-azonosító, az e-mail-cím, a név és a profilkép címe;
  - **E-mail-link:** az e-mail-címed (jelszót nem tárolunk).
  
  Továbbá: a Megszólítás (ha megadod), a profilkép (ha feltöltesz), a beállításaid, a mentett helyeid és a legutóbbi kereséseid – hogy több készüléken is ugyanaz legyen.
- **Mire:** bejelentkezés, a beállítások szinkronja, a felhőmentés, a fiókhoz kapcsolódó levelek (bejelentkező link, üdvözlés, a fiók törlésének megerősítése).
- **Jogalap:** a szolgáltatás nyújtása (6. cikk (1) b) pont).

### 3.7 Felhőmentés (napló és hőtérkép)

- **Mi:** fiókkal, ha a „Napló és hőtérkép mentése a felhőbe” be van kapcsolva (fióknál alapból be): a befejezett utak összesítője, egyszerűsített útvonala és ritkított (5 másodpercenkénti) mintái, az utcákra illesztett vonala a nyers pontsorral, valamint a saját hőtérképed.
- **Mire:** hogy új készüléken vagy újratelepítés után is megmaradjon a naplód.
- **Jogalap:** a szolgáltatás nyújtása (6. cikk (1) b) pont). Bármikor kikapcsolható; ekkor új adat nem megy fel.

### 3.8 Keresés, útvonal, térkép (Mapbox)

- **Mi:** a keresett cím szövege, a pozíciód a találatok rendezéséhez, az útvonaltervezés kiinduló- és célpontja, a térképcsempék kéréséhez a látott terület, a hőtérkép-csíkokhoz az utad egyszerűsített nyomvonala (útra illesztés, „Map Matching”), a zárolt képernyős térképképhez a környező terület. A Mapbox ezeket a kéréseket a saját szerverein dolgozza fel; azonosítónkat nem kapja meg.
- **Mentett helyek:** a Haza, a Munka, a további mentett helyek és a legutóbbi úti célok közül csak a koordinátát (és ha adsz, a saját elnevezésedet) tároljuk – a készüléken és fióknál a szinkronban is. A Mapbox által adott nevet és címet nem tároljuk: megjelenítéskor újra lekérjük, és csak a memóriában tartjuk.
- **Mapbox-telemetria:** a Mapbox térkép-szoftvere saját, névtelen használati és helyadatot gyűjt a térképek javítására. Az iPhone-alkalmazásban a térkép jobb felső „i” gombjában kikapcsolható. A webes térkép csak a térkép betöltését számolja, helyadatot nem gyűjt.
- **Jogalap:** a szolgáltatás nyújtása (6. cikk (1) b) pont); a telemetriánál a Mapbox jogos érdeke, kikapcsolási lehetőséggel.

### 3.9 Műszaki naplók

- **Mi:** a szervereink (Vercel, Supabase) a kérések kiszolgálásához IP-címet, időpontot, kért címet és böngésző-/eszköztípust naplóznak.
- **Mire:** a működés, a hibakeresés és a visszaélések elleni védelem.
- **Jogalap:** jogos érdek (6. cikk (1) f) pont).

### 3.10 Amit nem kezelünk

Nem kérünk születési dátumot, telefonszámot, jelszót. Nem használjuk a hirdetési azonosítót (IDFA), nincs reklám, nincs harmadik féltől származó analitika, és nem követünk (az Apple „tracking” fogalma szerint sem).

## 4. Adatfeldolgozók és címzettek

| Szolgáltató | Szerep | Hol | Mi jut el hozzá |
|---|---|---|---|
| **Supabase Inc.** | adatbázis, bejelentkezés, szerverfüggvények | EU (Írország, AWS eu-west-1) | 3.2–3.7, 3.9 |
| **Vercel Inc.** | a webes alkalmazás kiszolgálása | globális CDN, USA | 3.9 |
| **Mapbox Inc.** | térkép, keresés, útvonal, útra illesztés, térképkép | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | levélküldés | EU (Írország, AWS eu-west-1) | e-mail-cím, a levél tartalma |
| **Apple Inc.** | „Bejelentkezés Apple-lel”, App Store | USA / EU | 3.6 (Apple) |
| **Google LLC** | „Bejelentkezés Google-lel” | USA | 3.6 (Google) |

Az USA-beli szolgáltatókhoz az adattovábbítás az EU–USA adatvédelmi keretrendszer (Data Privacy Framework) tanúsítása vagy az Európai Bizottság általános szerződési feltételei (SCC) alapján történik.

> **[ÜGYVÉDI ÁTNÉZÉS 3]** A harmadik országba továbbításnál érdemes szolgáltatónként ellenőrizni a DPF-tanúsítást és az adatfeldolgozói szerződés (DPA) meglétét: Mapbox, Vercel, Resend, Supabase.

Hatóságnak csak jogszabály kötelező előírása alapján adunk ki adatot.

## 5. Meddig őrizzük

| Adat | Megőrzés |
|---|---|
| Nyers helyadat a szerveren (bejelentések, szavazatok, dugó-adat) | **90 nap**, utána törlődik; a közösségi hőtérkép csak összevont adatot tárol |
| Felhőmentés részletes mintái és nyers pontsora | 90 nap; utána az út összesítője, egyszerűsített útvonala és utcákra illesztett vonala marad a törlésig |
| Utak naplója, saját hőtérkép a készüléken | amíg te nem törlöd (a törölt adat 30 napig visszaállítható, utána végleg törlődik) |
| Fiókadatok | a fiók törléséig |
| Fiók törlése | a kéréstől számított **30 napig visszaállítható** (ugyanazzal a módon újra bejelentkezve), utána végleg törlődik minden hozzá kötött adat |
| Névtelen azonosító | amíg használod az alkalmazást; a 12 hónapja nem használt és adat nélküli azonosítót töröljük |
| Közösségi hőtérkép (összevont) | korlátlan ideig, mert nem köthető személyhez |
| Műszaki naplók | legfeljebb 30 nap (a szolgáltatók beállítása szerint) |

## 6. A jogaid

A GDPR 15–22. cikke alapján jogod van:

- **hozzáférést** kérni az adataidhoz, és másolatot kapni róluk;
- a pontatlan adat **helyesbítését** kérni;
- az adataid **törlését** kérni. A fiókot az alkalmazásban magad is törölheted: Beállítások › Adatvédelem › „Fiók törlése”;
- az adatkezelés **korlátozását** kérni;
- **tiltakozni** a jogos érdeken alapuló adatkezelés ellen (pl. kapcsold ki a „Névtelen vezetési adatok megosztása” beállítást);
- az **adathordozhatósághoz**: a fiókodhoz kötött adatokat géppel olvasható formában (JSON) kikérheted.

Kérésedre legkésőbb **egy hónapon belül** válaszolunk (hello@tempomate.app). Fiókos adatnál a fiókod e-mail-címéről írj, hogy azonosítani tudjunk. Fiók nélkül a szerveren lévő adat (bejelentés, szavazat, dugó-adat) a névtelen azonosító miatt hozzád nem köthető, 90 nap után pedig magától törlődik.

**Panasz:** ha úgy érzed, megsértettük a jogaidat, panaszt tehetsz a **Nemzeti Adatvédelmi és Információszabadság Hatóságnál** (NAIH, 1055 Budapest, Falk Miksa utca 9–11., ugyfelszolgalat@naih.hu, https://naih.hu), vagy a lakóhelyed szerinti adatvédelmi hatóságnál, és bírósághoz is fordulhatsz.

## 7. Gyermekek

Az alkalmazást **16 éven felülieknek** szánjuk (GDPR 8. cikk, Infotv.). 16 év alatti személyről tudatosan nem kezelünk adatot. Ha tudomásunkra jut, töröljük.

## 8. Biztonság

A kapcsolat mindenhol titkosított (HTTPS / TLS). Az adatbázisban sorszintű hozzáférés-védelem működik: mindenki csak a saját adatát éri el, a közösségi adatot csak összevont nézeteken keresztül. A titkos kulcsok nem kerülnek az alkalmazásba.

## 9. Változások

Ha a tájékoztató lényegesen változik, az alkalmazásban és a weboldalon jelezzük. A korábbi változatok kérésre elérhetők.

---
Előző változat: nincs (ez az első kiadás).
