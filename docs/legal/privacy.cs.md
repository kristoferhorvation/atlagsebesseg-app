# Zásady ochrany osobních údajů – Tempomate

**Verze:** 1.0 · **Účinnost:** 6. listopadu 2026 · **Jazyk:** čeština (překlad maďarského originálu; v případě rozporu má přednost maďarská verze)

Tyto zásady popisují, jaké osobní údaje zpracovává aplikace Tempomate pro iPhone a webová aplikace (`app.tempomate.app`), k čemu je používáme, komu je předáváme, jak dlouho je uchováváme a jaká máš práva. Zásady vycházejí z obecného nařízení EU o ochraně osobních údajů (**GDPR**, nařízení (EU) 2016/679) a z **maďarského zákona č. CXII/2011 o informačním sebeurčení a svobodě informací (Infotv.)**.

> **[PRÁVNÍ KONTROLA 1]** Správce je uveden jako samostatný vývojář. Pokud službu poskytuje podnikatel (osoba samostatně výdělečně činná, společnost s ručením omezeným), je třeba nahradit jméno, sídlo a registrační číslo.

## 1. Správce

- **Jméno:** Kristóf Horváth, samostatný vývojář
- **Adresa:** 1XXX Budapešť, [ulice, číslo], Maďarsko *(doplnit)*
- **E-mail:** hello@tempomate.app
- **Web:** https://tempomate.app

Pověřence pro ochranu osobních údajů jsme nejmenovali, protože to zákon nevyžaduje. S dotazy k ochraně osobních údajů se na nás obrať na výše uvedeném e-mailu.

## 2. Ve zkratce

- Aplikace **plně funguje i bez účtu**. Bez účtu dostaneš **náhodný anonymní identifikátor**. Jméno, e-mail ani telefonní číslo nežádáme.
- Tvou **polohu** používáme kvůli měření, navigaci a deníku jízd. Deník jízd a tvoje vlastní teplotní mapa jsou **ve tvém zařízení**. Na server se dostanou, jen pokud se přihlásíš a zapneš zálohu do cloudu.
- Pro **komunitní teplotní mapu** se odesílají jen souhrnné, anonymní údaje o úsecích silnic. Začátek a konec jízd ani okolí tvých uložených míst se nikdy neodesílají. Sdílení můžeš vypnout.
- Nezobrazujeme reklamy, nesledujeme tě napříč jinými aplikacemi nebo weby a tvoje údaje **neprodáváme**.

## 3. Jaké údaje zpracováváme, k čemu a na jakém právním základě

### 3.1 Poloha (v popředí i na pozadí)

- **Co:** poloha GPS (zeměpisná šířka, délka, přesnost), rychlost a směr jízdy.
- **K čemu:** rozpoznání a měření úseků s měřením průměrné rychlosti, navigace, upozornění, deník jízd (volná jízda) a tvoje vlastní teplotní mapa. Aplikace pro iPhone měří tvou polohu **i při zamčené obrazovce (na pozadí)**, pokud to povolíš. Úsekové měření se tak během jízdy nepřeruší ani po zamčení telefonu. Na webu prohlížeč určování polohy pro kartu na pozadí pozastaví.
- **Kde:** nezpracované údaje o poloze zůstávají **ve tvém zařízení** (deník jízd, vlastní teplotní mapa). Na server se údaje dostanou jen v případech popsaných v bodech 3.3–3.6.
- **Právní základ:** poskytování služby, o kterou žádáš (GDPR čl. 6 odst. 1 písm. b)). Určování polohy můžeš kdykoli vypnout v nastavení telefonu. Bez něj měření a navigace nefungují.

### 3.2 Anonymní identifikátor zařízení

- **Co:** při prvním spuštění přidělí náš systém (Supabase Auth) aplikaci náhodný identifikátor (UUID). Není to hardwarový identifikátor zařízení ani reklamní identifikátor (IDFA).
- **K čemu:** abychom mohli rozlišit tvá hlášení a hlasy (např. abys nemohl hlasovat dvakrát a abychom se tě neptali na tvé vlastní hlášení) a abychom proti zneužití (hromadnému odesílání) uplatnili denní limit.
- **Právní základ:** oprávněný zájem (GDPR čl. 6 odst. 1 písm. f)): spolehlivost komunitních údajů a ochrana služby.

### 3.3 Komunitní hlášení a hlasy

- **Co:** typ hlášení (např. nehoda, uzavírka silnice, zácpa, nebezpečí), tvoje poloha a směr jízdy v okamžiku hlášení, čas a tvůj anonymní identifikátor; u hlasu (Potvrdit / Není tam) hlas a tvůj identifikátor.
- **K čemu:** aby aktuální událost viděli i ostatní řidiči. Hlášení je **pro ostatní anonymní**: tvůj identifikátor nikdo nevidí.
- **Právní základ:** poskytování služby (čl. 6 odst. 1 písm. b)) a oprávněný zájem na kvalitě komunitních údajů (čl. 6 odst. 1 písm. f)).

### 3.4 Údaje o zácpách

- **Co:** když aplikace během navigace zjistí zácpu nebo když zácpu nahlásíš: místo, směr, průměrná rychlost naměřená na místě, délka zácpy, čas a tvůj anonymní identifikátor.
- **K čemu:** přesnější čas příjezdu pro ostatní řidiče.
- **Právní základ:** oprávněný zájem (čl. 6 odst. 1 písm. f)).

### 3.5 Anonymní data o jízdě (komunitní teplotní mapa)

- **Co:** na konci jízdy údaje **souhrnně po úsecích silnice**: úsek silnice (cca 25 m), počet průjezdů, průměrná rychlost, hodinové pásmo a den v týdnu. **Neodesílá se:** tvoje trasa, přesný čas, jakýkoli identifikátor, chráněná zóna kolem tvých uložených míst (Domů, Práce atd., ve výchozím stavu 200 m) a prvních a posledních 300 metrů každé jízdy.
- **K čemu:** komunitní teplotní mapa (kde, kdy a jak rychle se jezdí).
- **Právní základ:** oprávněný zájem (čl. 6 odst. 1 písm. f)). **Lze vypnout:** Nastavení › Soukromí › „Sdílet anonymní data o jízdě“. Po vypnutí se dosud neodeslané údaje smažou.
- Souhrnné údaje po odeslání nelze přiřadit k tobě, proto je nelze dodatečně jednotlivě smazat.

> **[PRÁVNÍ KONTROLA 2]** Sdílení anonymních dat o jízdě je ve výchozím stavu zapnuté a opírá se o oprávněný zájem. Doporučuje se písemný test vyváženosti oprávněného zájmu. Vyplatí se nechat potvrdit, zda souhrnné údaje o úsecích silnic bez identifikátoru jsou anonymními údaji.

### 3.6 Účet (nepovinný)

- **Co:** při přihlášení podle zvoleného způsobu:
  - **Apple:** identifikátor od Applu, e-mailová adresa (nebo adresa z funkce Applu „Skrýt můj e-mail“) a tvoje jméno, pokud ho uvedeš;
  - **Google:** identifikátor Google, e-mailová adresa, jméno a adresa profilového obrázku;
  - **Odkaz e-mailem:** tvoje e-mailová adresa (heslo neukládáme).

  Dále: Oslovení (pokud ho zadáš), profilový obrázek (pokud ho nahraješ), tvoje nastavení, uložená místa a poslední vyhledávání – aby byly stejné na všech tvých zařízeních.
- **K čemu:** přihlášení, synchronizace nastavení, záloha do cloudu, e-maily k účtu (přihlašovací odkaz, uvítání, potvrzení smazání účtu).
- **Právní základ:** poskytování služby (čl. 6 odst. 1 písm. b)).

### 3.7 Záloha do cloudu (deník a teplotní mapa)

- **Co:** s účtem, pokud je zapnuto „Zálohovat deník a teplotní mapu do cloudu“ (u účtu ve výchozím stavu zapnuto): souhrn dokončených jízd, jejich zjednodušená trasa a prořídlé vzorky (jeden každých 5 sekund), čára přichycená k silnicím s nezpracovanými body trasy a tvoje vlastní teplotní mapa.
- **K čemu:** aby ti deník zůstal i na novém zařízení nebo po přeinstalování.
- **Právní základ:** poskytování služby (čl. 6 odst. 1 písm. b)). Zálohu můžeš kdykoli vypnout. Potom se nové údaje neodesílají.

### 3.8 Vyhledávání, trasa, mapa (Mapbox)

- **Co:** text hledané adresy, tvoje poloha k seřazení výsledků, výchozí bod a cíl plánované trasy, viditelná oblast k načtení mapových dlaždic, zjednodušená stopa tvé jízdy k přichycení pruhů teplotní mapy k silnicím („Map Matching“) a okolní oblast pro obrázek mapy na zamčené obrazovce. Mapbox zpracovává tyto požadavky na svých serverech. Náš identifikátor nedostává.
- **Uložená místa:** u Domova, Práce, dalších uložených míst a posledních cílů ukládáme jen souřadnice (a tvůj vlastní název, pokud ho zadáš) – v zařízení a s účtem i v synchronizaci. Název a adresu od Mapboxu neukládáme: při zobrazení je znovu načteme a držíme jen v paměti.
- **Telemetrie Mapboxu:** mapový software Mapboxu sbírá vlastní anonymní údaje o používání a poloze ke zlepšování map. V aplikaci pro iPhone ji můžeš vypnout tlačítkem „i“ vpravo nahoře na mapě. Webová mapa jen počítá načtení mapy a údaje o poloze nesbírá.
- **Právní základ:** poskytování služby (čl. 6 odst. 1 písm. b)); u telemetrie oprávněný zájem Mapboxu s možností vypnutí.

### 3.9 Technické záznamy (logy)

- **Co:** naše servery (Vercel, Supabase) při vyřizování požadavků zaznamenávají IP adresu, čas, požadovanou adresu (URL) a typ prohlížeče či zařízení.
- **K čemu:** provoz, hledání chyb a ochrana proti zneužití.
- **Právní základ:** oprávněný zájem (čl. 6 odst. 1 písm. f)).

### 3.10 Co nezpracováváme

Nežádáme datum narození, telefonní číslo ani heslo. Nepoužíváme reklamní identifikátor (IDFA), nemáme reklamy ani analytiku třetích stran a nesledujeme tě (ani ve smyslu pojmu „tracking“ podle Applu).

## 4. Zpracovatelé a příjemci

| Poskytovatel | Role | Kde | Co dostává |
|---|---|---|---|
| **Supabase Inc.** | databáze, přihlášení, serverové funkce | EU (Irsko, AWS eu-west-1) | 3.2–3.7, 3.9 |
| **Vercel Inc.** | provoz webové aplikace | globální CDN, USA | 3.9 |
| **Mapbox Inc.** | mapa, vyhledávání, trasa, přichycení k silnicím, obrázek mapy | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | odesílání e-mailů | EU (Irsko, AWS eu-west-1) | e-mailová adresa, obsah e-mailu |
| **Apple Inc.** | „Přihlásit se přes Apple“, App Store | USA / EU | 3.6 (Apple) |
| **Google LLC** | „Přihlásit se přes Google“ | USA | 3.6 (Google) |

Předávání údajů poskytovatelům v USA probíhá na základě certifikace podle rámce pro ochranu osobních údajů mezi EU a USA (Data Privacy Framework) nebo standardních smluvních doložek Evropské komise (SCC).

> **[PRÁVNÍ KONTROLA 3]** U předávání do třetích zemí je vhodné u každého poskytovatele ověřit certifikaci DPF a existenci smlouvy o zpracování osobních údajů (DPA): Mapbox, Vercel, Resend, Supabase.

Orgánům veřejné moci poskytujeme údaje jen tehdy, když to ukládá zákon.

## 5. Jak dlouho údaje uchováváme

| Údaje | Doba uchování |
|---|---|
| Nezpracované údaje o poloze na serveru (hlášení, hlasy, údaje o zácpách) | **90 dní**, potom se smažou; komunitní teplotní mapa ukládá jen souhrnné údaje |
| Podrobné vzorky a nezpracované body trasy zálohy do cloudu | 90 dní; potom zůstane souhrn jízdy, zjednodušená trasa a čára přichycená k silnicím až do smazání |
| Deník jízd a vlastní teplotní mapa v zařízení | dokud je nesmažeš (smazané údaje lze 30 dní obnovit, potom se trvale smažou) |
| Údaje účtu | do smazání účtu |
| Smazání účtu | **lze vrátit do 30 dní** od žádosti (opětovným přihlášením stejným způsobem); potom se trvale smažou všechny s ním spojené údaje |
| Anonymní identifikátor | dokud aplikaci používáš; identifikátor nepoužitý 12 měsíců a bez údajů smažeme |
| Komunitní teplotní mapa (souhrnná) | bez časového omezení, protože ji nelze přiřadit k osobě |
| Technické záznamy | nejvýše 30 dní (podle nastavení poskytovatelů) |

## 6. Tvoje práva

Podle čl. 15–22 GDPR máš právo:

- na **přístup** ke svým údajům a na jejich kopii;
- na **opravu** nepřesných údajů;
- na **výmaz** svých údajů. Účet můžeš smazat i sám v aplikaci: Nastavení › Soukromí › „Smazat účet“;
- na **omezení** zpracování;
- **vznést námitku** proti zpracování založenému na oprávněném zájmu (např. vypni nastavení „Sdílet anonymní data o jízdě“);
- na **přenositelnost** údajů: údaje spojené s tvým účtem si můžeš vyžádat ve strojově čitelném formátu (JSON).

Na tvou žádost odpovíme nejpozději **do jednoho měsíce** (hello@tempomate.app). U údajů z účtu nám napiš z e-mailové adresy svého účtu, abychom tě mohli ověřit. Bez účtu nelze údaje na serveru (hlášení, hlasy, údaje o zácpách) kvůli anonymnímu identifikátoru přiřadit k tobě a po 90 dnech se samy smažou.

**Stížnost:** pokud máš pocit, že jsme porušili tvá práva, můžeš podat stížnost u maďarského **Národního úřadu pro ochranu údajů a svobodu informací** (Nemzeti Adatvédelmi és Információszabadság Hatóság, NAIH, 1055 Budapest, Falk Miksa utca 9–11., ugyfelszolgalat@naih.hu, https://naih.hu) nebo u dozorového úřadu pro ochranu osobních údajů podle místa svého bydliště. Můžeš se obrátit i na soud.

## 7. Děti

Aplikace je určena osobám **starším 16 let** (GDPR čl. 8, Infotv.). Údaje osob mladších 16 let vědomě nezpracováváme. Pokud se o nich dozvíme, smažeme je.

## 8. Zabezpečení

Spojení je všude šifrované (HTTPS / TLS). V databázi funguje ochrana přístupu na úrovni řádků: každý má přístup jen ke svým údajům a ke komunitním údajům jen přes souhrnné pohledy. Tajné klíče nejsou součástí aplikace.

## 9. Změny

Pokud se tyto zásady podstatně změní, oznámíme to v aplikaci a na webu. Předchozí verze jsou k dispozici na vyžádání.

---
Předchozí verze: žádná (toto je první vydání).
