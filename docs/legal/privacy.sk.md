# Zásady ochrany osobných údajov – Tempomate

**Verzia:** 1.0 · **Účinnosť od:** 6. novembra 2026 · **Jazyk:** slovenčina (preklad maďarského originálu; v prípade rozporu má prednosť maďarská verzia)

Tieto zásady opisujú, aké osobné údaje spracúva aplikácia Tempomate pre iPhone a webová aplikácia (`app.tempomate.app`), na aký účel ich používame, komu ich poskytujeme, ako dlho ich uchovávame a aké máš práva. Zásady vychádzajú zo všeobecného nariadenia Európskej únie o ochrane údajov (**GDPR**, nariadenie (EÚ) 2016/679) a z maďarského **zákona č. CXII/2011 o práve na informačné sebaurčenie a o slobode informácií (Infotv.)**.

> **[PRÁVNA KONTROLA 1]** Prevádzkovateľ je uvedený ako individuálny vývojár. Ak službu poskytuje podnikateľ (živnostník, s. r. o.), treba nahradiť meno, sídlo a registračné číslo.

## 1. Prevádzkovateľ

- **Meno:** Kristóf Horváth, individuálny vývojár
- **Adresa:** 1XXX Budapešť, [ulica, číslo], Maďarsko *(doplniť)*
- **E-mail:** hello@tempomate.app
- **Webová stránka:** https://tempomate.app

Zodpovednú osobu sme nevymenovali, pretože to zákon nevyžaduje. S otázkami o ochrane údajov nás kontaktuj na uvedenej e-mailovej adrese.

## 2. Stručne

- Aplikácia **plne funguje aj bez účtu**. Bez účtu dostaneš **náhodný anonymný identifikátor**. Meno, e-mailovú adresu ani telefónne číslo nežiadame.
- Tvoju **polohu** používame na meranie, navigáciu a denník jázd. Denník jázd a tvoja vlastná tepelná mapa sú **v tvojom zariadení**. Na server sa dostanú, len ak sa prihlásiš do účtu a zapneš zálohovanie do cloudu.
- Pre **komunitnú tepelnú mapu** sa odosielajú len agregované anonymné údaje o úsekoch ciest. Začiatok a koniec jázd ani okolie tvojich uložených miest sa neodosielajú nikdy. Toto sa dá vypnúť.
- Nezobrazujeme reklamy, nesledujeme ťa naprieč inými aplikáciami ani webmi a tvoje údaje **nepredávame**.

## 3. Aké údaje spracúvame, na aký účel a na akom právnom základe

### 3.1 Poloha (na popredí a na pozadí)

- **Čo:** poloha GPS (zemepisná šírka, dĺžka, presnosť), rýchlosť a smer jazdy.
- **Na čo:** rozpoznanie a meranie úsekov s úsekovým meraním rýchlosti, navigácia, upozornenia, denník jázd (voľná jazda) a tvoja vlastná tepelná mapa. Ak to povolíš, aplikácia pre iPhone meria tvoju polohu **aj pri zamknutej obrazovke (na pozadí)**. Meranie úseku sa tak počas jazdy nepreruší ani po zamknutí telefónu. Na webe prehliadač pozastaví zisťovanie polohy na karte v pozadí.
- **Kde:** nespracované údaje o polohe zostávajú **v tvojom zariadení** (denník jázd, vlastná tepelná mapa). Na server sa údaje dostanú len v prípadoch opísaných v bodoch 3.3 – 3.6.
- **Právny základ:** poskytovanie služby, o ktorú žiadaš (čl. 6 ods. 1 písm. b) GDPR). Zisťovanie polohy môžeš kedykoľvek vypnúť v nastaveniach telefónu. Bez neho meranie a navigácia nefungujú.

### 3.2 Anonymný identifikátor zariadenia

- **Čo:** pri prvom spustení náš systém (Supabase Auth) pridelí aplikácii náhodný identifikátor (UUID). Nie je to výrobný identifikátor zariadenia ani reklamný identifikátor (IDFA).
- **Na čo:** aby sme vedeli od seba odlíšiť tvoje hlásenia a hlasy (napr. aby si nemohol hlasovať dvakrát a aby sme sa ťa nepýtali na tvoje vlastné hlásenie) a aby sme proti zneužitiu (hromadnému odosielaniu) uplatnili denný limit.
- **Právny základ:** oprávnený záujem (čl. 6 ods. 1 písm. f) GDPR): spoľahlivosť komunitných údajov a ochrana služby.

### 3.3 Komunitné hlásenia a hlasy

- **Čo:** typ hlásenia (napr. nehoda, uzávierka cesty, zápcha, nebezpečenstvo), tvoja poloha a smer jazdy v čase hlásenia, čas a tvoj anonymný identifikátor. Pri hlase (Potvrdiť / Nie je tam) hlas a tvoj identifikátor.
- **Na čo:** aby aktuálnu udalosť videli aj ostatní vodiči. Hlásenie je **pre ostatných anonymné**: tvoj identifikátor nikto nevidí.
- **Právny základ:** poskytovanie služby (čl. 6 ods. 1 písm. b) GDPR) a oprávnený záujem na kvalite komunitných údajov (čl. 6 ods. 1 písm. f) GDPR).

### 3.4 Údaje o zápchach

- **Čo:** keď aplikácia počas navigácie zistí zápchu alebo keď zápchu nahlásiš: miesto, smer, priemerná rýchlosť nameraná na tom mieste, dĺžka zápchy, čas a tvoj anonymný identifikátor.
- **Na čo:** presnejší čas príchodu pre ostatných vodičov.
- **Právny základ:** oprávnený záujem (čl. 6 ods. 1 písm. f) GDPR).

### 3.5 Anonymné údaje o jazde (komunitná tepelná mapa)

- **Čo:** na konci jazdy údaje **agregované podľa úsekov ciest**: úsek cesty (asi 25 m), počet prejazdov, priemerná rýchlosť, hodinové pásmo a deň v týždni. **Neodosiela sa:** tvoja trasa, presný čas, akýkoľvek identifikátor, chránená zóna okolo tvojich uložených miest (Domov, Práca atď., predvolene 200 m) ani prvých a posledných 300 metrov každej jazdy.
- **Na čo:** komunitná tepelná mapa (kde, kedy a akou rýchlosťou sa premávka pohybuje).
- **Právny základ:** oprávnený záujem (čl. 6 ods. 1 písm. f) GDPR). **Dá sa vypnúť:** Nastavenia › Ochrana súkromia › „Zdieľať anonymné údaje o jazde“. Po vypnutí sa vymažú údaje, ktoré ešte neboli odoslané.
- Agregované údaje sa po odoslaní nedajú spojiť s tebou, preto ich nemožno dodatočne vymazať jednotlivo.

> **[PRÁVNA KONTROLA 2]** Zdieľanie anonymných údajov o jazde je predvolene zapnuté a zakladá sa na oprávnenom záujme. Odporúča sa k tomu písomný test vyváženosti oprávneného záujmu. Treba si dať potvrdiť, či agregované údaje o úsekoch ciest bez identifikátora predstavujú anonymné údaje.

### 3.6 Účet (nepovinný)

- **Čo:** pri prihlásení podľa zvoleného spôsobu:
  - **Apple:** identifikátor od spoločnosti Apple, e-mailová adresa (alebo adresa z funkcie Apple „Skryť môj e-mail“) a tvoje meno, ak ho poskytneš;
  - **Google:** identifikátor Google, e-mailová adresa, meno a adresa profilovej fotky;
  - **Odkaz e-mailom:** tvoja e-mailová adresa (heslo neukladáme).
  
  Ďalej: oslovenie (ak ho zadáš), profilová fotka (ak ju nahráš), tvoje nastavenia, uložené miesta a posledné vyhľadávania, aby boli rovnaké vo všetkých tvojich zariadeniach.
- **Na čo:** prihlásenie, synchronizácia nastavení, zálohovanie do cloudu a e-maily súvisiace s účtom (prihlasovací odkaz, privítanie, potvrdenie zmazania účtu).
- **Právny základ:** poskytovanie služby (čl. 6 ods. 1 písm. b) GDPR).

### 3.7 Zálohovanie do cloudu (denník a tepelná mapa)

- **Čo:** s účtom, ak je zapnutá voľba „Zálohovať denník a teplotnú mapu do cloudu“ (pri účte predvolene zapnutá): súhrn dokončených jázd, ich zjednodušená trasa a zriedené vzorky (jedna za 5 sekúnd), čiara priradená k cestám s nespracovanými bodmi trasy, ako aj tvoja vlastná tepelná mapa.
- **Na čo:** aby ti denník zostal aj v novom zariadení alebo po preinštalovaní aplikácie.
- **Právny základ:** poskytovanie služby (čl. 6 ods. 1 písm. b) GDPR). Zálohovanie môžeš kedykoľvek vypnúť. Potom sa nové údaje neodosielajú.

### 3.8 Vyhľadávanie, trasa, mapa (Mapbox)

- **Čo:** text hľadanej adresy, tvoja poloha na zoradenie výsledkov, východiskový a cieľový bod plánovanej trasy, viditeľná oblasť na načítanie mapových dlaždíc, zjednodušená stopa tvojej jazdy na priradenie pásov tepelnej mapy k cestám („Map Matching“) a okolitá oblasť pre obrázok mapy na zamknutej obrazovke. Mapbox spracúva tieto požiadavky na svojich serveroch. Náš identifikátor nedostáva.
- **Uložené miesta:** pri Domove, Práci, ďalších uložených miestach a posledných cieľoch ukladáme len súradnice (a tvoj vlastný názov, ak ho zadáš) – v zariadení a s účtom aj v synchronizácii. Názov a adresu od Mapboxu neukladáme: pri zobrazení ich znova načítame a držíme len v pamäti.
- **Telemetria Mapbox:** mapový softvér Mapbox zbiera vlastné anonymné údaje o používaní a polohe na zlepšovanie máp. V aplikácii pre iPhone ju môžeš vypnúť tlačidlom „i“ vpravo hore na mape. Webová mapa len počíta načítania mapy a údaje o polohe nezbiera.
- **Právny základ:** poskytovanie služby (čl. 6 ods. 1 písm. b) GDPR); pri telemetrii oprávnený záujem spoločnosti Mapbox s možnosťou vypnutia.

### 3.9 Technické záznamy

- **Čo:** naše servery (Vercel, Supabase) pri vybavovaní požiadaviek zaznamenávajú IP adresu, čas, požadovanú adresu URL a typ prehliadača alebo zariadenia.
- **Na čo:** prevádzka, hľadanie chýb a ochrana proti zneužitiu.
- **Právny základ:** oprávnený záujem (čl. 6 ods. 1 písm. f) GDPR).

### 3.10 Čo nespracúvame

Nežiadame dátum narodenia, telefónne číslo ani heslo. Nepoužívame reklamný identifikátor (IDFA), nezobrazujeme reklamy, nepoužívame analytiku tretích strán a nesledujeme ťa (ani podľa toho, ako sledovanie („tracking“) definuje Apple).

## 4. Sprostredkovatelia a príjemcovia

| Poskytovateľ | Úloha | Kde | Čo dostáva |
|---|---|---|---|
| **Supabase Inc.** | databáza, prihlásenie, serverové funkcie | EÚ (Írsko, AWS eu-west-1) | 3.2 – 3.7, 3.9 |
| **Vercel Inc.** | prevádzka webovej aplikácie | globálna sieť CDN, USA | 3.9 |
| **Mapbox Inc.** | mapa, vyhľadávanie, trasa, priradenie k cestám, obrázok mapy | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | odosielanie e-mailov | EÚ (Írsko, AWS eu-west-1) | e-mailová adresa, obsah správy |
| **Apple Inc.** | „Prihlásiť sa cez Apple“, App Store | USA / EÚ | 3.6 (Apple) |
| **Google LLC** | „Prihlásiť sa cez Google“ | USA | 3.6 (Google) |

Prenos údajov k poskytovateľom v USA prebieha na základe certifikácie podľa rámca ochrany údajov EÚ – USA (Data Privacy Framework) alebo na základe štandardných zmluvných doložiek Európskej komisie (SCC).

> **[PRÁVNA KONTROLA 3]** Pri prenose do tretích krajín treba pri každom poskytovateľovi overiť certifikáciu DPF a existenciu zmluvy so sprostredkovateľom (DPA): Mapbox, Vercel, Resend, Supabase.

Orgánom verejnej moci poskytujeme údaje len vtedy, ak to výslovne vyžaduje zákon.

## 5. Ako dlho údaje uchovávame

| Údaje | Uchovávanie |
|---|---|
| Nespracované údaje o polohe na serveri (hlásenia, hlasy, údaje o zápchach) | **90 dní**, potom sa vymažú; komunitná tepelná mapa ukladá len agregované údaje |
| Podrobné vzorky a nespracované body trasy v zálohe v cloude | 90 dní; potom zostane súhrn jazdy, zjednodušená trasa a čiara priradená k cestám až do vymazania |
| Denník jázd a vlastná tepelná mapa v zariadení | kým ich nevymažeš (vymazané údaje sa dajú obnoviť 30 dní, potom sa natrvalo vymažú) |
| Údaje účtu | do zmazania účtu |
| Zmazanie účtu | **dá sa vrátiť späť do 30 dní** od žiadosti (opätovným prihlásením rovnakým spôsobom); potom sa natrvalo vymažú všetky údaje spojené s účtom |
| Anonymný identifikátor | kým aplikáciu používaš; identifikátory nepoužívané 12 mesiacov a bez údajov vymažeme |
| Komunitná tepelná mapa (agregovaná) | bez časového obmedzenia, pretože sa nedá spojiť s konkrétnou osobou |
| Technické záznamy | najviac 30 dní (podľa nastavenia poskytovateľov) |

## 6. Tvoje práva

Podľa čl. 15 – 22 GDPR máš:

- **právo na prístup** k svojim údajom a na ich kópiu;
- **právo na opravu** nepresných údajov;
- **právo na vymazanie** svojich údajov. Účet môžeš v aplikácii zmazať aj sám: Nastavenia › Ochrana súkromia › „Zmazať účet“;
- **právo na obmedzenie** spracúvania;
- **právo namietať** proti spracúvaniu založenému na oprávnenom záujme (napr. vypni voľbu „Zdieľať anonymné údaje o jazde“);
- **právo na prenosnosť** údajov: údaje spojené s tvojím účtom si môžeš vyžiadať v strojovo čitateľnom formáte (JSON).

Na tvoju žiadosť odpovieme najneskôr **do jedného mesiaca** (hello@tempomate.app). Pri údajoch z účtu nám napíš z e-mailovej adresy svojho účtu, aby sme ťa mohli overiť. Bez účtu sa údaje na serveri (hlásenia, hlasy, údaje o zápchach) kvôli anonymnému identifikátoru nedajú spojiť s tebou a po 90 dňoch sa automaticky vymažú.

**Sťažnosť:** ak sa domnievaš, že sme porušili tvoje práva, môžeš podať sťažnosť na maďarskom **Národnom úrade pre ochranu údajov a slobodu informácií** (Nemzeti Adatvédelmi és Információszabadság Hatóság, NAIH, 1055 Budapest, Falk Miksa utca 9–11, ugyfelszolgalat@naih.hu, https://naih.hu) alebo na dozornom orgáne pre ochranu údajov v krajine tvojho bydliska. Môžeš sa obrátiť aj na súd.

## 7. Deti

Aplikácia je určená **osobám starším ako 16 rokov** (čl. 8 GDPR, Infotv. – maďarský zákon č. CXII/2011). Údaje osôb mladších ako 16 rokov vedome nespracúvame. Ak sa o takých údajoch dozvieme, vymažeme ich.

## 8. Bezpečnosť

Spojenie je všade šifrované (HTTPS / TLS). V databáze funguje ochrana prístupu na úrovni riadkov: každý má prístup len k svojim údajom a ku komunitným údajom len cez agregované zobrazenia. Tajné kľúče nie sú súčasťou aplikácie.

## 9. Zmeny

Ak sa tieto zásady podstatne zmenia, oznámime to v aplikácii a na webovej stránke. Predchádzajúce verzie sú dostupné na požiadanie.

---
Predchádzajúca verzia: žiadna (toto je prvé vydanie).
