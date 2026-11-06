# Polityka prywatności – Tempomate (Átlagsebesség)

**Wersja:** 1.0 · **Obowiązuje od:** 6 listopada 2026 r. · **Język:** polski (tłumaczenie węgierskiego oryginału; w razie rozbieżności rozstrzyga wersja węgierska)

Ta polityka opisuje, jakie dane osobowe przetwarza aplikacja Tempomate (po węgiersku: Átlagsebesség) na iPhone’a oraz aplikacja internetowa (`app.tempomate.app`), w jakim celu je wykorzystujemy, komu je przekazujemy, jak długo je przechowujemy i jakie masz prawa. Polityka została przygotowana na podstawie ogólnego rozporządzenia Unii Europejskiej o ochronie danych (**RODO**, rozporządzenie (UE) 2016/679) oraz węgierskiej ustawy nr CXII z 2011 r. o prawie do samostanowienia informacyjnego i o wolności informacji (**Infotv.**).

> **[WERYFIKACJA PRAWNA 1]** Dane administratora podano jako dane indywidualnego dewelopera. Jeśli usługę świadczy przedsiębiorca (jednoosobowa działalność gospodarcza, spółka z o.o.), należy zastąpić imię i nazwisko, siedzibę i numer rejestrowy.

## 1. Administrator

- **Imię i nazwisko:** Kristóf Horváth, indywidualny deweloper
- **Adres:** 1XXX Budapeszt, [ulica, numer], Węgry *(do uzupełnienia)*
- **E-mail:** hello@tempomate.app
- **Strona internetowa:** https://tempomate.app

Nie wyznaczyliśmy inspektora ochrony danych, ponieważ przepisy tego nie wymagają. W sprawach ochrony danych skontaktuj się z nami pod powyższym adresem e-mail.

## 2. W skrócie

- Aplikacja **w pełni działa bez konta**. Bez konta dostajesz **losowy, anonimowy identyfikator**. Nie prosimy o imię, adres e-mail ani numer telefonu.
- Twoich **danych o lokalizacji** używamy do pomiaru, nawigacji i dziennika jazd. Dziennik jazd i twoja własna mapa cieplna są przechowywane **na twoim urządzeniu**. Na serwer trafiają tylko wtedy, gdy zalogujesz się na konto i włączysz kopię w chmurze.
- Na potrzeby **wspólnej mapy cieplnej** wysyłane są tylko zbiorcze, anonimowe dane o odcinkach dróg. Początek i koniec jazdy oraz okolice twoich zapisanych miejsc nie są wysyłane nigdy. Możesz to wyłączyć.
- Nie wyświetlamy reklam, nie śledzimy cię w innych aplikacjach ani na innych stronach internetowych i **nie sprzedajemy** twoich danych.

## 3. Jakie dane przetwarzamy, w jakim celu i na jakiej podstawie prawnej

### 3.1 Dane o lokalizacji (na pierwszym planie i w tle)

- **Co:** pozycja GPS (szerokość i długość geograficzna, dokładność), prędkość i kierunek jazdy.
- **Cel:** rozpoznawanie i pomiar odcinków odcinkowego pomiaru prędkości, nawigacja, ostrzeżenia, dziennik jazd (Swobodna jazda) i twoja własna mapa cieplna. Jeśli wyrazisz zgodę w systemie, aplikacja na iPhone’a ustala twoją pozycję **także przy zablokowanym ekranie (w tle)**. Dzięki temu pomiar odcinka nie przerywa się, gdy telefon zablokuje się w czasie jazdy. W wersji internetowej przeglądarka wstrzymuje ustalanie lokalizacji, gdy karta działa w tle.
- **Gdzie:** surowe dane o lokalizacji pozostają **na twoim urządzeniu** (dziennik jazd, własna mapa cieplna). Dane trafiają na serwer tylko w przypadkach opisanych w punktach 3.3–3.6.
- **Podstawa prawna:** świadczenie usługi, o którą prosisz (art. 6 ust. 1 lit. b RODO). Lokalizację możesz w każdej chwili wyłączyć w ustawieniach telefonu. Bez niej pomiar i nawigacja nie działają.

### 3.2 Anonimowy identyfikator urządzenia

- **Co:** przy pierwszym uruchomieniu nasz system (Supabase Auth) nadaje aplikacji losowy identyfikator (UUID). Nie jest to fabryczny identyfikator urządzenia ani identyfikator reklamowy (IDFA).
- **Cel:** rozróżnianie twoich zgłoszeń i głosów (np. aby nie dało się zagłosować dwa razy i abyśmy nie pytali cię o twoje własne zgłoszenie) oraz stosowanie dziennego limitu chroniącego przed nadużyciami (masowym wysyłaniem).
- **Podstawa prawna:** prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO): wiarygodność wspólnych danych i ochrona usługi.

### 3.3 Zgłoszenia i głosy społeczności

- **Co:** rodzaj zgłoszenia (np. wypadek, zamknięta droga, korek, zagrożenie), twoja lokalizacja i kierunek jazdy w chwili zgłoszenia, czas oraz twój anonimowy identyfikator; przy głosie („Potwierdź” / „Nie ma tam”) – głos i twój identyfikator.
- **Cel:** aby inni kierowcy widzieli bieżące zdarzenia. Zgłoszenie jest **anonimowe dla innych**: nikt nie widzi twojego identyfikatora.
- **Podstawa prawna:** świadczenie usługi (art. 6 ust. 1 lit. b RODO) oraz prawnie uzasadniony interes w jakości wspólnych danych (art. 6 ust. 1 lit. f RODO).

### 3.4 Dane o korkach

- **Co:** gdy aplikacja wykryje korek w czasie nawigacji albo gdy zgłosisz korek: miejsce, kierunek, zmierzona tam średnia prędkość, długość korka, czas oraz twój anonimowy identyfikator.
- **Cel:** dokładniejszy czas dojazdu dla innych kierowców.
- **Podstawa prawna:** prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).

### 3.5 Anonimowe dane o jeździe (wspólna mapa cieplna)

- **Co:** po zakończeniu jazdy dane **zbiorcze dla każdego odcinka drogi**: odcinek drogi (ok. 25 m), liczba przejazdów, średnia prędkość, przedział godzinowy i dzień tygodnia. **Nie** są wysyłane: twoja trasa, dokładny czas, jakikolwiek identyfikator, strefa ochronna wokół twoich zapisanych miejsc (Dom, Praca itp.; domyślnie 200 m) ani pierwsze i ostatnie 300 metrów każdej jazdy.
- **Cel:** wspólna mapa cieplna (gdzie, kiedy i w jakim tempie porusza się ruch).
- **Podstawa prawna:** prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO). **Możesz to wyłączyć:** Ustawienia › Prywatność › „Udostępniaj anonimowe dane o jeździe”. Po wyłączeniu dane, które nie zostały jeszcze wysłane, są usuwane.
- Po wysłaniu dane zbiorcze nie dają się z tobą powiązać, dlatego nie można ich później usunąć pojedynczo.

> **[WERYFIKACJA PRAWNA 2]** Domyślnie włączone udostępnianie anonimowych danych o jeździe opiera się na prawnie uzasadnionym interesie. Zalecany jest pisemny test równowagi interesów. Warto też potwierdzić, czy zbiorcze dane o odcinkach dróg bez identyfikatora są danymi anonimowymi.

### 3.6 Konto (nieobowiązkowe)

- **Co:** przy logowaniu, w zależności od wybranego sposobu:
  - **Apple:** identyfikator nadany przez Apple, adres e-mail (lub adres z funkcji Apple „Ukryj mój adres e-mail”) oraz twoje imię i nazwisko, jeśli je podasz;
  - **Google:** identyfikator Google, adres e-mail, imię i nazwisko oraz adres zdjęcia profilowego;
  - **Link e-mail:** twój adres e-mail (nie przechowujemy hasła).

  Ponadto: forma zwracania się do ciebie („Jak się do ciebie zwracać”, jeśli ją podasz), zdjęcie profilowe (jeśli je prześlesz), twoje ustawienia, zapisane miejsca i ostatnie wyszukiwania – aby były takie same na wszystkich twoich urządzeniach.
- **Cel:** logowanie, synchronizacja ustawień, kopia w chmurze oraz wiadomości związane z kontem (link do logowania, powitanie, potwierdzenie usunięcia konta).
- **Podstawa prawna:** świadczenie usługi (art. 6 ust. 1 lit. b RODO).

### 3.7 Kopia w chmurze (dziennik i mapa cieplna)

- **Co:** przy koncie, jeśli opcja „Kopia dziennika i mapy cieplnej w chmurze” jest włączona (dla kont domyślnie włączona): podsumowanie zakończonych jazd, uproszczona trasa i rozrzedzone próbki (jedna co 5 sekund), linia dopasowana do dróg z surowymi punktami trasy oraz twoja własna mapa cieplna.
- **Cel:** aby twój dziennik został zachowany na nowym urządzeniu lub po ponownej instalacji.
- **Podstawa prawna:** świadczenie usługi (art. 6 ust. 1 lit. b RODO). Możesz to w każdej chwili wyłączyć. Wtedy nowe dane nie są wysyłane.

### 3.8 Wyszukiwanie, trasa, mapa (Mapbox)

- **Co:** tekst wyszukiwanego adresu, twoja pozycja do sortowania wyników, punkt początkowy i docelowy planowanej trasy, widoczny obszar do pobrania kafelków mapy, uproszczony ślad twojej jazdy do dopasowania pasków mapy cieplnej do dróg („Map Matching”) oraz otaczający obszar do obrazu mapy na zablokowanym ekranie. Mapbox przetwarza te zapytania na swoich serwerach. Nie otrzymuje naszego identyfikatora.
- **Zapisane miejsca:** dla Domu, Pracy, innych zapisanych miejsc i ostatnich celów przechowujemy tylko współrzędne (i twoją własną nazwę, jeśli ją podasz) – na urządzeniu, a przy koncie także w synchronizacji. Nie przechowujemy nazwy i adresu zwróconych przez Mapbox: przy wyświetlaniu pobieramy je ponownie i trzymamy tylko w pamięci.
- **Telemetria Mapbox:** oprogramowanie mapowe Mapbox zbiera własne, anonimowe dane o użytkowaniu i lokalizacji w celu ulepszania map. W aplikacji na iPhone’a możesz to wyłączyć przyciskiem „i” w prawym górnym rogu mapy. Mapa w wersji internetowej zlicza tylko wczytania mapy i nie zbiera danych o lokalizacji.
- **Podstawa prawna:** świadczenie usługi (art. 6 ust. 1 lit. b RODO); w przypadku telemetrii – prawnie uzasadniony interes Mapbox, z możliwością wyłączenia.

### 3.9 Logi techniczne

- **Co:** nasze serwery (Vercel, Supabase) w celu obsługi zapytań zapisują w logach adres IP, czas, żądany adres oraz typ przeglądarki lub urządzenia.
- **Cel:** działanie usługi, wyszukiwanie błędów i ochrona przed nadużyciami.
- **Podstawa prawna:** prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO).

### 3.10 Czego nie przetwarzamy

Nie prosimy o datę urodzenia, numer telefonu ani hasło. Nie używamy identyfikatora reklamowego (IDFA), nie ma reklam ani analityki podmiotów trzecich i nie śledzimy cię (także w rozumieniu pojęcia „śledzenia” stosowanego przez Apple).

## 4. Podmioty przetwarzające i odbiorcy

| Dostawca | Rola | Gdzie | Co otrzymuje |
|---|---|---|---|
| **Supabase Inc.** | baza danych, logowanie, funkcje serwerowe | UE (Irlandia, AWS eu-west-1) | 3.2–3.7, 3.9 |
| **Vercel Inc.** | udostępnianie aplikacji internetowej | globalna sieć CDN, USA | 3.9 |
| **Mapbox Inc.** | mapa, wyszukiwanie, trasa, dopasowanie do dróg, obraz mapy | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | wysyłka e-maili | UE (Irlandia, AWS eu-west-1) | adres e-mail, treść wiadomości |
| **Apple Inc.** | „Zaloguj się przez Apple”, App Store | USA / UE | 3.6 (Apple) |
| **Google LLC** | „Zaloguj się przez Google” | USA | 3.6 (Google) |

Przekazywanie danych dostawcom z USA odbywa się na podstawie certyfikacji w ramach ochrony danych UE–USA (Data Privacy Framework) lub standardowych klauzul umownych Komisji Europejskiej (SCC).

> **[WERYFIKACJA PRAWNA 3]** Przy przekazywaniu danych do państw trzecich warto sprawdzić dla każdego dostawcy certyfikację DPF i zawarcie umowy powierzenia przetwarzania danych (DPA): Mapbox, Vercel, Resend, Supabase.

Organom władzy publicznej udostępniamy dane wyłącznie wtedy, gdy wymagają tego przepisy prawa.

## 5. Jak długo przechowujemy dane

| Dane | Okres przechowywania |
|---|---|
| Surowe dane o lokalizacji na serwerze (zgłoszenia, głosy, dane o korkach) | **90 dni**, potem są usuwane; wspólna mapa cieplna przechowuje tylko dane zbiorcze |
| Szczegółowe próbki i surowe punkty trasy w kopii w chmurze | 90 dni; potem do czasu usunięcia zostają podsumowanie jazdy, uproszczona trasa i linia dopasowana do dróg |
| Dziennik jazd i własna mapa cieplna na urządzeniu | dopóki ich nie usuniesz (usunięte dane można przywrócić przez 30 dni, potem są usuwane trwale) |
| Dane konta | do usunięcia konta |
| Usunięcie konta | **można cofnąć przez 30 dni** od żądania (logując się ponownie w ten sam sposób); potem wszystkie powiązane z nim dane są usuwane trwale |
| Anonimowy identyfikator | dopóki korzystasz z aplikacji; identyfikatory nieużywane od 12 miesięcy i bez danych usuwamy |
| Wspólna mapa cieplna (dane zbiorcze) | bez ograniczenia czasowego, ponieważ nie da się jej powiązać z osobą |
| Logi techniczne | maksymalnie 30 dni (zgodnie z ustawieniami dostawców) |

## 6. Twoje prawa

Na podstawie art. 15–22 RODO masz prawo do:

- **dostępu** do swoich danych i otrzymania ich kopii;
- **sprostowania** nieprawidłowych danych;
- **usunięcia** swoich danych. Konto możesz też usunąć samodzielnie w aplikacji: Ustawienia › Prywatność › „Usuń konto”;
- **ograniczenia** przetwarzania;
- **sprzeciwu** wobec przetwarzania opartego na prawnie uzasadnionym interesie (np. wyłącz ustawienie „Udostępniaj anonimowe dane o jeździe”);
- **przenoszenia danych**: możesz zażądać danych powiązanych z twoim kontem w formacie nadającym się do odczytu maszynowego (JSON).

Na twoje żądanie odpowiemy najpóźniej **w ciągu jednego miesiąca** (hello@tempomate.app). W sprawie danych konta napisz z adresu e-mail swojego konta, abyśmy mogli cię zidentyfikować. Bez konta dane na serwerze (zgłoszenia, głosy, dane o korkach) nie dają się z tobą powiązać ze względu na anonimowy identyfikator, a po 90 dniach są usuwane automatycznie.

**Skarga:** jeśli uważasz, że naruszyliśmy twoje prawa, możesz złożyć skargę do węgierskiego **Krajowego Urzędu Ochrony Danych i Wolności Informacji** (Nemzeti Adatvédelmi és Információszabadság Hatóság, NAIH, 1055 Budapest, Falk Miksa utca 9–11., ugyfelszolgalat@naih.hu, https://naih.hu) lub do organu ochrony danych w kraju twojego miejsca zamieszkania. Możesz też zwrócić się do sądu.

## 7. Dzieci

Aplikacja jest przeznaczona dla osób **powyżej 16. roku życia** (art. 8 RODO, Infotv.). Nie przetwarzamy świadomie danych osób poniżej 16 lat. Jeśli się o tym dowiemy, usuwamy takie dane.

## 8. Bezpieczeństwo

Wszystkie połączenia są szyfrowane (HTTPS / TLS). W bazie danych działa ochrona dostępu na poziomie wierszy: każdy ma dostęp tylko do własnych danych, a do wspólnych danych tylko przez zbiorcze widoki. Klucze tajne nie trafiają do aplikacji.

## 9. Zmiany

Jeśli polityka zmieni się w istotny sposób, poinformujemy o tym w aplikacji i na stronie internetowej. Wcześniejsze wersje są dostępne na żądanie.

---
Poprzednia wersja: brak (pierwsze wydanie).
