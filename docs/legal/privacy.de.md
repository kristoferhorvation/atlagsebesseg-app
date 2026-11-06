# Datenschutzerklärung – Tempomate

**Version:** 1.0 · **Gültig ab:** 6. November 2026 · **Sprache:** Deutsch (Übersetzung des ungarischen Originals; bei Abweichungen gilt die ungarische Fassung)

Diese Erklärung beschreibt, welche personenbezogenen Daten die Tempomate-App für das iPhone und die Web-App (`app.tempomate.app`) verarbeiten, wofür wir sie nutzen, an wen wir sie weitergeben, wie lange wir sie speichern und welche Rechte du hast. Sie beruht auf der Datenschutz-Grundverordnung der Europäischen Union (**DSGVO**, Verordnung (EU) 2016/679) und dem ungarischen **Gesetz CXII von 2011 über das Recht auf informationelle Selbstbestimmung und die Informationsfreiheit (Infotv., ungarisches Informationsgesetz)**.

> **[ANWALTLICHE PRÜFUNG 1]** Als Verantwortlicher ist ein einzelner Entwickler angegeben. Wird der Dienst von einem Unternehmen (Einzelunternehmer, GmbH) erbracht, sind Name, Sitz und Registernummer zu ersetzen.

## 1. Verantwortlicher

- **Name:** Kristóf Horváth, Einzelentwickler
- **Anschrift:** 1XXX Budapest, [Straße, Hausnummer], Ungarn *(auszufüllen)*
- **E-Mail:** hello@tempomate.app
- **Website:** https://tempomate.app

Einen Datenschutzbeauftragten haben wir nicht benannt, da das Gesetz dies nicht vorschreibt. Bei Fragen zum Datenschutz erreichst du uns unter der oben genannten E-Mail-Adresse.

## 2. Kurz gesagt

- Die App **funktioniert ohne Konto vollständig**. Ohne Konto bekommst du eine **zufällige, anonyme Kennung**. Wir fragen nicht nach Namen, E-Mail-Adresse oder Telefonnummer.
- Deine **Standortdaten** nutzen wir für die Messung, die Navigation und das Fahrtenbuch. Das Fahrtenbuch und deine eigene Heatmap liegen **auf deinem Gerät**. Auf unseren Server gelangen sie nur, wenn du mit einem Konto die Cloud-Sicherung einschaltest.
- Für die **Community-Heatmap** werden nur zusammengefasste, anonyme Daten zu Straßenabschnitten hochgeladen. Anfang und Ende deiner Fahrten sowie die Umgebung deiner gespeicherten Orte werden nie hochgeladen. Du kannst das ausschalten.
- Wir zeigen keine Werbung, verfolgen dich nicht über andere Apps oder Websites hinweg und **verkaufen** deine Daten **nicht**.

## 3. Welche Daten wir wofür und auf welcher Rechtsgrundlage verarbeiten

### 3.1 Standortdaten (im Vordergrund und im Hintergrund)

- **Was:** die GPS-Position (Breitengrad, Längengrad, Genauigkeit), die Geschwindigkeit und die Fahrtrichtung.
- **Wofür:** Erkennen und Messen von Abschnittskontrollen, Navigation, Warnungen, das Fahrtenbuch („Freie Fahrt“) und deine eigene Heatmap. Wenn du es erlaubst, misst die iPhone-App deinen Standort **auch bei gesperrtem Bildschirm (im Hintergrund)**. So bricht die Abschnittsmessung beim Fahren nicht ab, wenn sich das Telefon sperrt. Im Web setzt der Browser die Standortbestimmung für Tabs im Hintergrund aus.
- **Wo:** Die rohen Standortdaten bleiben **auf deinem Gerät** (Fahrtenbuch, eigene Heatmap). Auf unseren Server gelangen Daten nur in den Fällen der Abschnitte 3.3–3.6.
- **Rechtsgrundlage:** Erbringung des Dienstes, den du anforderst (Art. 6 Abs. 1 lit. b DSGVO). Du kannst die Standortbestimmung jederzeit in den Einstellungen deines Telefons ausschalten. Ohne sie funktionieren Messung und Navigation nicht.

### 3.2 Anonyme Gerätekennung

- **Was:** Beim ersten Start vergibt unser System (Supabase Auth) eine zufällige Kennung (UUID) an die App. Sie ist nicht die Hardware-Kennung des Geräts und nicht die Werbe-ID (IDFA).
- **Wofür:** um deine Meldungen und Bewertungen auseinanderzuhalten (z. B. damit du nicht zweimal abstimmen kannst und wir dich nicht nach deiner eigenen Meldung fragen) und um gegen Missbrauch (massenhaftes Einsenden) ein Tageslimit durchzusetzen.
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO): verlässliche Community-Daten und Schutz des Dienstes.

### 3.3 Community-Meldungen und Bewertungen

- **Was:** die Art der Meldung (z. B. Unfall, Sperrung, Stau, Gefahr), dein Standort und deine Fahrtrichtung beim Melden, der Zeitpunkt und deine anonyme Kennung; bei Bewertungen („Bestätigen“ / „Nicht mehr da“) die Bewertung und deine Kennung.
- **Wofür:** damit andere Fahrer das aktuelle Ereignis sehen. Die Meldung ist **für andere anonym**: Niemand sieht deine Kennung.
- **Rechtsgrundlage:** Erbringung des Dienstes (Art. 6 Abs. 1 lit. b DSGVO) und berechtigtes Interesse an der Qualität der Community-Daten (Art. 6 Abs. 1 lit. f DSGVO).

### 3.4 Staudaten

- **Was:** wenn die App während der Navigation einen Stau erkennt oder du einen Stau meldest: der Ort, die Richtung, die dort gemessene Durchschnittsgeschwindigkeit, die Länge des Staus, der Zeitpunkt und deine anonyme Kennung.
- **Wofür:** genauere Ankunftszeiten für andere Fahrer.
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO).

### 3.5 Anonyme Fahrdaten (Community-Heatmap)

- **Was:** am Ende einer Fahrt **pro Straßenabschnitt zusammengefasste** Daten: der Straßenabschnitt (ca. 25 m), die Zahl der Durchfahrten, die Durchschnittsgeschwindigkeit, das Stundenfenster und der Wochentag. **Nicht** hochgeladen werden: deine Route, der genaue Zeitpunkt, jegliche Kennung, die Schutzzone um deine gespeicherten Orte (Zuhause, Arbeit usw., standardmäßig 200 m) sowie die ersten und letzten 300 Meter jeder Fahrt.
- **Wofür:** die Community-Heatmap (wo, wann und wie schnell der Verkehr fließt).
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO). **Abschaltbar:** Einstellungen › Datenschutz › „Anonyme Fahrdaten teilen“. Beim Ausschalten werden noch nicht gesendete Daten gelöscht.
- Nach dem Einsenden lassen sich die zusammengefassten Daten dir nicht mehr zuordnen. Deshalb können sie nachträglich nicht einzeln gelöscht werden.

> **[ANWALTLICHE PRÜFUNG 2]** Das standardmäßig eingeschaltete Teilen anonymer Fahrdaten beruht auf berechtigtem Interesse. Dafür wird eine schriftliche Interessenabwägung empfohlen. Es sollte bestätigt werden, ob zusammengefasste Straßenabschnittsdaten ohne Kennung als anonyme Daten gelten.

### 3.6 Konto (freiwillig)

- **Was:** bei der Anmeldung je nach gewählter Methode:
  - **Apple:** die von Apple bereitgestellte Kennung, die E-Mail-Adresse (oder die Adresse von Apples „E-Mail-Adresse verbergen“) und – wenn du ihn angibst – dein Name;
  - **Google:** die Google-Kennung, die E-Mail-Adresse, der Name und die Adresse (URL) des Profilbilds;
  - **E-Mail-Link:** deine E-Mail-Adresse (ein Passwort speichern wir nicht).
  
  Außerdem: dein Name für die „Begrüßung“ (wenn du ihn angibst), das Profilbild (wenn du eines hochlädst), deine Einstellungen, deine gespeicherten Orte und deine letzten Suchen – damit sie auf mehreren Geräten gleich sind.
- **Wofür:** Anmeldung, Synchronisierung der Einstellungen, Cloud-Sicherung und E-Mails zum Konto (Anmeldelink, Begrüßung, Bestätigung der Kontolöschung).
- **Rechtsgrundlage:** Erbringung des Dienstes (Art. 6 Abs. 1 lit. b DSGVO).

### 3.7 Cloud-Sicherung (Fahrtenbuch und Heatmap)

- **Was:** mit Konto, wenn „Fahrtenbuch und Heatmap in der Cloud sichern“ eingeschaltet ist (bei Konten standardmäßig eingeschaltet): die Zusammenfassung, die vereinfachte Route und ausgedünnte Messpunkte (ein Punkt alle 5 Sekunden) der beendeten Fahrten, die den Straßen zugeordnete Linie mit den rohen Messpunkten sowie deine eigene Heatmap.
- **Wofür:** damit dein Fahrtenbuch auch auf einem neuen Gerät oder nach einer Neuinstallation erhalten bleibt.
- **Rechtsgrundlage:** Erbringung des Dienstes (Art. 6 Abs. 1 lit. b DSGVO). Jederzeit abschaltbar; danach werden keine neuen Daten hochgeladen.

### 3.8 Suche, Route, Karte (Mapbox)

- **Was:** der Text der gesuchten Adresse, deine Position zum Sortieren der Treffer, Start- und Zielpunkt der Routenplanung, der sichtbare Bereich zum Laden der Kartenkacheln, für die Heatmap-Linien eine vereinfachte Spur deiner Fahrt (Zuordnung zur Straße, „Map Matching“) und für das Kartenbild auf dem Sperrbildschirm die Umgebung. Mapbox verarbeitet diese Anfragen auf seinen eigenen Servern. Unsere Kennung erhält Mapbox nicht.
- **Gespeicherte Orte:** Von Zuhause, Arbeit, weiteren gespeicherten Orten und den letzten Zielen speichern wir nur die Koordinaten (und deine eigene Bezeichnung, wenn du eine vergibst) – auf dem Gerät und mit Konto auch in der Synchronisierung. Den von Mapbox gelieferten Namen und die Adresse speichern wir nicht: Wir rufen sie bei der Anzeige erneut ab und halten sie nur im Arbeitsspeicher.
- **Mapbox-Telemetrie:** Die Kartensoftware von Mapbox sammelt eigene anonyme Nutzungs- und Standortdaten, um die Karten zu verbessern. In der iPhone-App kannst du das über die „i“-Schaltfläche oben rechts auf der Karte ausschalten. Die Web-Karte zählt nur das Laden der Karte und sammelt keine Standortdaten.
- **Rechtsgrundlage:** Erbringung des Dienstes (Art. 6 Abs. 1 lit. b DSGVO); bei der Telemetrie das berechtigte Interesse von Mapbox, mit Widerspruchsmöglichkeit (Abschaltung).

### 3.9 Technische Protokolle

- **Was:** Unsere Server (Vercel, Supabase) protokollieren zur Bearbeitung der Anfragen IP-Adresse, Zeitpunkt, angefragte Adresse (URL) und Browser- bzw. Gerätetyp.
- **Wofür:** Betrieb, Fehlersuche und Schutz vor Missbrauch.
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO).

### 3.10 Was wir nicht verarbeiten

Wir fragen nicht nach Geburtsdatum, Telefonnummer oder Passwort. Wir nutzen die Werbe-ID (IDFA) nicht, zeigen keine Werbung, setzen keine Analysedienste Dritter ein und verfolgen dich nicht (auch nicht im Sinne von Apples Begriff „Tracking“).

## 4. Auftragsverarbeiter und Empfänger

| Anbieter | Rolle | Ort | Was er erhält |
|---|---|---|---|
| **Supabase Inc.** | Datenbank, Anmeldung, Serverfunktionen | EU (Irland, AWS eu-west-1) | 3.2–3.7, 3.9 |
| **Vercel Inc.** | Bereitstellung der Web-App | globales CDN, USA | 3.9 |
| **Mapbox Inc.** | Karte, Suche, Route, Zuordnung zur Straße, Kartenbild | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | E-Mail-Versand | EU (Irland, AWS eu-west-1) | E-Mail-Adresse, Inhalt der E-Mail |
| **Apple Inc.** | „Mit Apple anmelden“, App Store | USA / EU | 3.6 (Apple) |
| **Google LLC** | „Mit Google anmelden“ | USA | 3.6 (Google) |

Die Übermittlung an Anbieter in den USA erfolgt auf Grundlage der Zertifizierung nach dem EU-US Data Privacy Framework oder der Standardvertragsklauseln der Europäischen Kommission (SCC).

> **[ANWALTLICHE PRÜFUNG 3]** Bei der Übermittlung in Drittländer sollte für jeden Anbieter die DPF-Zertifizierung und das Vorliegen eines Auftragsverarbeitungsvertrags (AVV, englisch DPA) geprüft werden: Mapbox, Vercel, Resend, Supabase.

An Behörden geben wir Daten nur heraus, wenn ein Gesetz dies zwingend vorschreibt.

## 5. Wie lange wir Daten speichern

| Daten | Speicherdauer |
|---|---|
| Rohe Standortdaten auf dem Server (Meldungen, Bewertungen, Staudaten) | **90 Tage**, danach gelöscht; die Community-Heatmap speichert nur zusammengefasste Daten |
| Detaillierte und rohe Messpunkte der Cloud-Sicherung | 90 Tage; danach bleiben Zusammenfassung, vereinfachte Route und die den Straßen zugeordnete Linie der Fahrt bis zur Löschung erhalten |
| Fahrtenbuch und eigene Heatmap auf dem Gerät | bis du sie löschst (gelöschte Daten sind 30 Tage lang wiederherstellbar, danach endgültig gelöscht) |
| Kontodaten | bis zur Löschung des Kontos |
| Löschung des Kontos | ab der Anfrage **30 Tage lang wiederherstellbar** (durch erneute Anmeldung auf dieselbe Weise), danach werden alle mit dem Konto verbundenen Daten endgültig gelöscht |
| Anonyme Kennung | solange du die App nutzt; Kennungen, die seit 12 Monaten nicht genutzt wurden und keine Daten haben, löschen wir |
| Community-Heatmap (zusammengefasst) | unbegrenzt, da sie keiner Person zugeordnet werden kann |
| Technische Protokolle | höchstens 30 Tage (je nach Einstellung der Anbieter) |

## 6. Deine Rechte

Nach Art. 15–22 DSGVO hast du folgende Rechte:

- **Recht auf Auskunft** über deine Daten und auf eine Kopie davon;
- **Recht auf Berichtigung** unrichtiger Daten;
- **Recht auf Löschung** deiner Daten. Dein Konto kannst du in der App auch selbst löschen: Einstellungen › Datenschutz › „Konto löschen“;
- **Recht auf Einschränkung** der Verarbeitung;
- **Recht auf Widerspruch** gegen eine Verarbeitung, die auf berechtigtem Interesse beruht (z. B. schalte die Einstellung „Anonyme Fahrdaten teilen“ aus);
- **Recht auf Datenübertragbarkeit:** Die mit deinem Konto verbundenen Daten kannst du in einem maschinenlesbaren Format (JSON) anfordern.

Auf deine Anfrage antworten wir spätestens **innerhalb eines Monats** (hello@tempomate.app). Bei Kontodaten schreib uns bitte von der E-Mail-Adresse deines Kontos, damit wir dich identifizieren können. Ohne Konto lassen sich die Daten auf dem Server (Meldung, Bewertung, Staudaten) wegen der anonymen Kennung dir nicht zuordnen. Nach 90 Tagen werden sie automatisch gelöscht.

**Beschwerde:** Wenn du meinst, dass wir deine Rechte verletzt haben, kannst du dich bei der ungarischen **Nationalen Behörde für Datenschutz und Informationsfreiheit** (Nemzeti Adatvédelmi és Információszabadság Hatóság, NAIH, 1055 Budapest, Falk Miksa utca 9–11, Ungarn, ugyfelszolgalat@naih.hu, https://naih.hu) oder bei der Datenschutzbehörde an deinem Wohnort beschweren. Du kannst dich auch an ein Gericht wenden.

## 7. Kinder

Die App ist für Personen **ab 16 Jahren** bestimmt (Art. 8 DSGVO, Infotv.). Daten von Personen unter 16 Jahren verarbeiten wir nicht wissentlich. Erfahren wir davon, löschen wir sie.

## 8. Sicherheit

Die Verbindung ist überall verschlüsselt (HTTPS / TLS). In der Datenbank gilt ein Zugriffsschutz auf Zeilenebene: Jeder erreicht nur seine eigenen Daten, die Community-Daten nur über zusammengefasste Ansichten. Geheime Schlüssel gelangen nicht in die App.

## 9. Änderungen

Wenn sich diese Erklärung wesentlich ändert, weisen wir in der App und auf der Website darauf hin. Frühere Fassungen sind auf Anfrage erhältlich.

---
Vorherige Fassung: keine (dies ist die erste Ausgabe).
