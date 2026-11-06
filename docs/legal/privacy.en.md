# Privacy Policy – Tempomate

**Version:** 1.0 · **Effective:** 6 November 2026 · **Language:** English (translation of the Hungarian original; the Hungarian version prevails in case of conflict)

This policy explains what personal data the Tempomate iPhone app and web app (`app.tempomate.app`) process, why, who receives it, how long we keep it, and what your rights are. It follows the EU General Data Protection Regulation (**GDPR**, Regulation (EU) 2016/679) and the Hungarian **Act CXII of 2011 on Informational Self-Determination and Freedom of Information (Infotv.)**.

> **[LAWYER REVIEW 1]** The controller is listed as an individual developer. If the service is provided by a business (sole proprietorship, limited company), replace the name, registered address and registration number.

## 1. Controller

- **Name:** Kristóf Horváth, individual developer
- **Address:** 1XXX Budapest, [street, number], Hungary *(to be completed)*
- **Email:** hello@tempomate.app
- **Website:** https://tempomate.app

We have not appointed a data protection officer, as the law does not require one. For privacy questions, contact us at the email above.

## 2. In short

- The app **works fully without an account**. Without one you get a **random anonymous identifier**; we never ask for your name, email or phone number.
- We use your **location** for measuring, navigation and your trip log. Your trip log and personal heatmap stay **on your device**; they reach our server only if you sign in and turn on cloud backup.
- For the **community heatmap** only aggregated, anonymous road-segment data is uploaded, never the start and end of your trips or the area around your saved places. You can switch this off.
- No ads, no tracking across other apps or websites, and we **never sell** your data.

## 3. What we process, why, and on what legal basis

### 3.1 Location (foreground and background)

- **What:** GPS position (latitude, longitude, accuracy), speed and heading.
- **Why:** detecting and measuring average speed sections, navigation, alerts, the trip log (cruise) and your personal heatmap. With your permission, the iPhone app also uses location **with the screen locked (in the background)**, so a section measurement does not stop when the phone locks while you drive. On the web, the browser suspends location for background tabs.
- **Where:** raw location stays **on your device** (trip log, personal heatmap). Data reaches our server only in the cases in sections 3.3–3.6.
- **Legal basis:** providing the service you request (GDPR Art. 6(1)(b)). You can turn off location in your phone settings at any time; measuring and navigation will not work without it.

### 3.2 Anonymous device identifier

- **What:** on first launch our system (Supabase Auth) gives the app a random identifier (UUID). It is not the device's hardware identifier and not the advertising identifier (IDFA).
- **Why:** to tell your reports and votes apart (e.g. so you can't vote twice and we don't ask you about your own report) and to apply a daily limit against abuse (mass submissions).
- **Legal basis:** legitimate interest (Art. 6(1)(f)): reliable community data and protecting the service.

### 3.3 Community reports and votes

- **What:** the report type (e.g. accident, road closure, traffic, hazard), your location and heading when reporting, the time, and your anonymous identifier; for votes (Confirm / Not there), the vote and your identifier.
- **Why:** so other drivers see current events. Reports are **anonymous to others**: nobody sees your identifier.
- **Legal basis:** providing the service (Art. 6(1)(b)) and legitimate interest in community data quality (Art. 6(1)(f)).

### 3.4 Traffic data

- **What:** when the app detects a traffic jam during navigation, or you report one: the location, heading, the average speed measured there, the length of the jam, the time and your anonymous identifier.
- **Why:** more accurate arrival times for other drivers.
- **Legal basis:** legitimate interest (Art. 6(1)(f)).

### 3.5 Anonymous driving data (community heatmap)

- **What:** at the end of a trip, data **aggregated per road segment** (about 25 m): number of passes, average speed, hour band and day of week. **Not** uploaded: your route, exact times, any identifier, the protected zone around your saved places (Home, Work etc., 200 m by default), and the first and last 300 m of each trip.
- **Why:** the community heatmap (where, when and how fast traffic moves).
- **Legal basis:** legitimate interest (Art. 6(1)(f)). **You can switch it off:** Settings › Privacy › "Share anonymous driving data". Switching off deletes data not yet sent.
- Once submitted, aggregated data cannot be linked to you and therefore cannot be deleted individually.

> **[LAWYER REVIEW 2]** Sharing anonymous driving data is on by default, based on legitimate interest. A written legitimate interest assessment is recommended. It is also worth confirming that aggregated road-segment data without identifiers qualifies as anonymous data.

### 3.6 Account (optional)

- **What:** depending on how you sign in:
  - **Apple:** the identifier provided by Apple, your email (or Apple's "Hide My Email" address) and your name if you share it;
  - **Google:** your Google identifier, email, name and profile picture URL;
  - **Email link:** your email address (we store no password).

  Also: your preferred name (if you set one), your profile picture (if you upload one), your settings, saved places and recent searches, so they are the same on all your devices.
- **Why:** sign-in, settings sync, cloud backup and account emails (sign-in link, welcome, account deletion confirmation).
- **Legal basis:** providing the service (Art. 6(1)(b)).

### 3.7 Cloud backup (trip log and heatmap)

- **What:** with an account, if "Back up log and heatmap to the cloud" is on (on by default for accounts): completed trips' summary, simplified route and thinned samples (one every 5 seconds), the street-matched line with its raw track points, plus your personal heatmap.
- **Why:** to keep your trip log on a new device or after reinstalling.
- **Legal basis:** providing the service (Art. 6(1)(b)). You can turn it off at any time; no new data is uploaded then.

### 3.8 Search, routing, maps (Mapbox)

- **What:** the text you search for, your position to rank results, the start and destination of a route, the visible map area to load map tiles, a simplified trace of your trip to snap heatmap lines to roads ("Map Matching"), and the surrounding area for the lock-screen map image. Mapbox processes these requests on its servers; it does not receive our identifier.
- **Saved places:** for Home, Work, other saved places and recent destinations we store only the coordinates (and your own label, if you give one) – on your device and, with an account, in sync. We do not store the name and address returned by Mapbox: we look them up again when shown and keep them in memory only.
- **Mapbox telemetry:** Mapbox's map software collects its own anonymous usage and location data to improve its maps. In the iPhone app you can turn it off with the "i" button at the top right of the map. The web map only counts map loads and collects no location.
- **Legal basis:** providing the service (Art. 6(1)(b)); for telemetry, Mapbox's legitimate interest with an opt-out.

### 3.9 Technical logs

- **What:** our servers (Vercel, Supabase) log IP address, time, requested URL and browser/device type to serve requests.
- **Why:** operation, debugging and protection against abuse.
- **Legal basis:** legitimate interest (Art. 6(1)(f)).

### 3.10 What we don't process

We don't ask for your date of birth, phone number or a password. We don't use the advertising identifier (IDFA), show no ads, use no third-party analytics, and don't track you (including under Apple's definition of tracking).

## 4. Processors and recipients

| Provider | Role | Where | What it receives |
|---|---|---|---|
| **Supabase Inc.** | database, sign-in, server functions | EU (Ireland, AWS eu-west-1) | 3.2–3.7, 3.9 |
| **Vercel Inc.** | serving the web app | global CDN, USA | 3.9 |
| **Mapbox Inc.** | maps, search, routing, map matching, map images | USA | 3.8 |
| **Resend (Plus Five Five Inc.)** | sending email | EU (Ireland, AWS eu-west-1) | email address, message content |
| **Apple Inc.** | Sign in with Apple, App Store | USA / EU | 3.6 (Apple) |
| **Google LLC** | Sign in with Google | USA | 3.6 (Google) |

Transfers to US providers rely on the EU–US Data Privacy Framework certification or the European Commission's Standard Contractual Clauses (SCC).

> **[LAWYER REVIEW 3]** For transfers to third countries, check each provider's DPF certification and data processing agreement (DPA): Mapbox, Vercel, Resend, Supabase.

We disclose data to authorities only where the law requires it.

## 5. How long we keep data

| Data | Retention |
|---|---|
| Raw location on the server (reports, votes, traffic data) | **90 days**, then deleted; the community heatmap stores aggregated data only |
| Detailed samples and raw track points in cloud backup | 90 days; after that the trip summary, simplified route and street-matched line remain until you delete them |
| Trip log and personal heatmap on your device | until you delete them (deleted data can be restored for 30 days, then it is gone) |
| Account data | until the account is deleted |
| Account deletion | **can be undone for 30 days** after the request (by signing in again the same way); after that all data linked to it is permanently deleted |
| Anonymous identifier | while you use the app; identifiers unused for 12 months and without data are deleted |
| Community heatmap (aggregated) | indefinitely, as it cannot be linked to a person |
| Technical logs | up to 30 days (depending on the provider's settings) |

## 6. Your rights

Under Articles 15–22 GDPR you have the right to:

- **access** your data and receive a copy;
- have inaccurate data **rectified**;
- have your data **erased**. You can delete your account yourself in the app: Settings › Privacy › "Delete account";
- **restrict** processing;
- **object** to processing based on legitimate interest (e.g. turn off "Share anonymous driving data");
- **data portability**: you can request the data linked to your account in a machine-readable format (JSON).

We reply within **one month** (hello@tempomate.app). For account data, write from your account's email address so we can identify you. Without an account, server data (reports, votes, traffic data) is not linkable to you because of the anonymous identifier, and it is deleted automatically after 90 days.

**Complaints:** if you believe we have violated your rights, you can complain to the Hungarian **National Authority for Data Protection and Freedom of Information** (NAIH, 1055 Budapest, Falk Miksa utca 9–11, ugyfelszolgalat@naih.hu, https://naih.hu) or the data protection authority where you live, and you may also go to court.

## 7. Children

The app is intended for people **aged 16 and over** (Art. 8 GDPR, Infotv.). We do not knowingly process data of anyone under 16; if we learn of it, we delete it.

## 8. Security

All connections are encrypted (HTTPS / TLS). The database uses row-level security: everyone can access only their own data, and community data only through aggregated views. Secret keys are never shipped in the app.

## 9. Changes

If this policy changes materially, we will tell you in the app and on the website. Previous versions are available on request.

---
Previous version: none (first release).
