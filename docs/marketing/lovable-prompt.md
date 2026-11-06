# Lovable prompt – tempomate.app (AW22b)

> Paste everything below the line into a new Lovable project. Upload the files from `docs/marketing/lovable-assets/`
> with their exact names (see `assets-index.md`). Every colour, radius, size and UI word in this prompt comes from
> `packages/design-tokens` and `packages/app-logic/src/i18n/{hu,en}.json` – the test
> `packages/design-tokens/test/marketing.test.ts` fails if a colour here is not a token.

---

## 1. Role & goal

Build the marketing site for **Tempomate** (domain `tempomate.app`). Tempomate is a speed-compliance assistant and
navigation app for European drivers: the only app that, inside an average-speed (section control) zone, shows your
running average and how fast you may still go. It is **not a radar detector**. No ads, 6 languages, web + iPhone.

You are matching an existing product design system exactly. **Do not invent colours, radii, shadows, fonts or UI
wording.** Use the tokens and the copy blocks below verbatim. The site must look like it was built by the same team
that built the app: dark, calm, glassy, one big number, colour only for state.

Product names:
- Brand: **Tempomate**. Web app: `https://app.tempomate.app`.
- The Hungarian home-screen name of the iPhone app stays **„Átlagsebesség”** – mention it once on the Hungarian page
  (e.g. in the footer: „Az iPhone-on Átlagsebesség néven találod.”). Do not use it as the brand anywhere else.

Tech: static site (React + Vite as Lovable prefers is fine), no backend, no forms that store data, no cookies, no
analytics, no third-party scripts. Self-host the Inter font (OFL) – do not load Google Fonts at runtime.

## 2. Design system – use these verbatim

```css
:root {
  /* colour – dark only, there is no light theme */
  --color-bg: #06070A;                       /* page background */
  --color-surface: rgba(14,16,22,0.72);      /* glass cards (with blur 28px, saturate 150%) */
  --color-surface-strong: rgba(22,25,32,0.88); /* sheets, solid panels, header on scroll */
  --color-surface-raised: rgba(255,255,255,0.06); /* list cards, inner panels, 1px top highlight */
  --color-stroke: rgba(255,255,255,0.08);    /* 1px borders */
  --color-stroke-strong: rgba(255,255,255,0.16); /* hover border, switch track */
  --color-text: #F4F6FA;
  --color-text-muted: rgba(244,246,250,0.64);
  --color-text-faint: rgba(244,246,250,0.40);
  --color-accent: #2EE59D;  /* selection marker only: switch on, checkbox, focus ring, selected route */
  --color-brand: #7A86FF;   /* brand / manual mode / position dot / map elements */
  --color-fill-08: rgba(255,255,255,0.08);   /* segmented track, neutral chip */
  --color-fill-10: rgba(255,255,255,0.10);   /* secondary button */
  --color-pill-surface: rgba(16,18,24,0.6);  /* status pills */
  --color-sheet-backdrop: rgba(0,0,0,0.45);  /* modal / mobile menu backdrop (blur 3px) */
  --color-sign-ring: #E5303F;  /* speed-limit sign ring */
  --color-sign-face: #FFFFFF;  /* speed-limit sign face, white text on --status-fast buttons */
  --color-sign-text: #0B0C10;  /* text on white (primary button, selected segment, sign digits) */

  /* the three measuring states – the core of the product */
  --status-good: #2EE59D;   /* „Jó ütem” / “On pace”            – average ≤ limit */
  --status-high: #FFB224;   /* „Átlag magas” / “Average too high” – average > limit, expected final ≤ limit */
  --status-fast: #FF4D61;   /* „Túl gyors” / “Too fast”          – expected final > limit */
  --status-idle: #8C93A3;   /* interrupted / no data */
  --color-planned: #F2DC82; /* planned police check line – not a status colour */

  /* navigation */
  --color-route: #1F5BFF;            /* selected route line */
  --color-route-casing: #FFFFFF;     /* its 2px casing */
  --color-route-alt-day: #799CF8;    /* alternative route, day light */
  --color-route-alt-night: #1E49C1;  /* alternative route, night light */
  --color-map-bg-day: #E8EBEF;       /* typical Mapbox Standard ground, day */
  --color-map-bg-night: #1B2030;     /* typical Mapbox Standard ground, night */

  /* heatmap scales (stops in this order) */
  --heat-freq-low: #5B6CFF;   /* Frequency: rarely */
  --heat-freq-mid: #C65CFF;
  --heat-freq-high: #FFD166;  /* often */
  --heat-speed-low: #2EE59D;  /* Average speed: slow */
  --heat-speed-mid: #FFB224;
  --heat-speed-high: #FF4D61; /* fast */
  --heat-grey: rgba(140,147,163,0.55); /* privacy-zone cells */

  /* typography – Inter Variable, numbers always tabular */
  --font-family: 'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --type-hero-size: 196px;    --type-hero-weight: 680;    --type-hero-line: 0.9;  --type-hero-tracking: -0.045em;
  --type-hero-fluid: clamp(120px, 42vw, 196px);
  --type-display-size: 64px;  --type-display-weight: 650; --type-display-line: 1;  --type-display-tracking: -0.03em;
  --type-title-size: 28px;    --type-title-weight: 620;   --type-title-line: 1.15; --type-title-tracking: -0.015em;
  --type-body-size: 20px;     --type-body-weight: 500;    --type-body-line: 1.3;  --type-body-tracking: -0.005em;
  --type-caption-size: 15px;  --type-caption-weight: 500; --type-caption-line: 1.35; --type-caption-tracking: 0em;
  /* allowed extra sizes (px): 12 13 14 15 16 17 18 19 20 22 24 26 28 30 32 34 36 38 40 44 46 50 64
     allowed weights: 400 500 520 540 560 580 600 620 640 650 680 700 720 760 */

  /* spacing – 4px scale */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px;

  /* radii */
  --radius-button: 14px;  /* small buttons, icon tiles */
  --radius-btn-large: 18px; /* 60px primary/secondary buttons */
  --radius-tile: 22px;    /* list cards, tiles */
  --radius-card: 32px;    /* glass cards, sheets, phone-frame screen */
  --radius-card-compact: 24px;
  --radius-pill: 999px;   /* pills, chips */
  --radius-segment-track: 12px;
  --radius-segment: 9px;
  --radius-app-icon: 20px; /* at 76px icon size */

  /* sizes */
  --size-touch: 56px; --size-round-button: 64px; --size-progress: 10px; --size-tile: 76px;
  --blur-glass: 28px; --blur-backdrop: 3px;

  /* shadows – the app uses almost none; these are the only ones */
  --shadow-card: 0 24px 60px -12px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35);
  --shadow-sign: 0 8px 24px rgba(0,0,0,0.45);
  --shadow-knob: 0 2px 6px rgba(0,0,0,0.35);
  --shadow-start-mark: 0 12px 40px rgba(0,0,0,0.5);

  /* motion – transform/opacity only */
  --motion-fast: 160ms; --motion-base: 280ms; --motion-slow: 480ms;
  --motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

Use these verbatim. If you need a colour that is not listed, you don't need it – use `--color-text-muted`,
`--color-surface-raised` or a `color-mix(in srgb, <token> N%, transparent)` of an existing token instead.

Typography rules: body text 17–20px, never below 15px (captions/footer 15px, legal fine print 14px). Headings use
`--type-display-*` (64px desktop, scale to 44px/700/-0.035em on phones – the app's start-screen title size) and
`--type-title-*`. Big numbers (e.g. „121”) use the hero style in the status colour with
`text-shadow: 0 0 40px color-mix(in srgb, <status> 35%, transparent)`. All numbers: `font-variant-numeric: tabular-nums`.

## 3. Component rules

**Glass card** (the main surface): `background: var(--color-surface); backdrop-filter: blur(28px) saturate(150%);
border: 1px solid var(--color-stroke); border-radius: var(--radius-card); padding: 22px;
box-shadow: var(--shadow-card), inset 0 1px 0 var(--color-surface-raised);`. A state-coloured card (the three
measuring-state cards) additionally gets: a background tint `color-mix(in srgb, <status> 9%, transparent)`, a soft
radial glow at the top (`radial-gradient(closest-side, <status>, transparent)` at 20% opacity), and a 1.5px top hairline
`linear-gradient(90deg, transparent, <status>, transparent)` inset 28px from both sides. These are the only gradients.

**Buttons**
- Primary: height 60px, radius 18px, `background: var(--color-text); color: var(--color-sign-text)`, 20px / 620,
  padding 0 24px, gap 10px for an icon. Active: `transform: scale(0.96)` in 160ms. Hover (desktop): opacity 0.92.
  Focus: `outline: 2px solid var(--color-accent); outline-offset: 2px`. Disabled: opacity 0.45.
- Secondary: same shape, `background: var(--color-fill-10); color: var(--color-text)`.
- Small button: height 48px, radius 14px, padding 0 16px, 16px / 600, `background: var(--color-fill-10)`.
- Round icon button: 64px circle, glass surface (as the card), icon 24–28px. Used for the language switch on mobile.
- No other button styles. No gradients on buttons, no glow on buttons.

**Pills** (status / meta labels): height 36px, padding 0 13px 0 11px, radius 999px, 15px / 580, colour
`--color-text-muted`, `background: var(--color-pill-surface); backdrop-filter: blur(20px) saturate(160%);
border: 1px solid var(--color-stroke)`. Optional 8px dot in a status colour with `box-shadow: 0 0 10px <same colour>`.

**Chips** (the state label, exactly as in the app): height 40px, padding 0 16px 0 11px, radius 999px, 20px / 640,
gap 8px, `color: <status>; background: color-mix(in srgb, <status> 17%, transparent)`, with the state icon
(✓ check for good, ↓ arrow-down for high, ↑ arrow-up for fast – draw as line icons, not emoji). Neutral chip:
`background: var(--color-fill-08); color: var(--color-text-muted)`.

**Segmented control** (language switch HU | EN, and any tab switch): track `display: inline-flex; padding: 3px;
border-radius: 12px; background: var(--color-fill-08)`; on top of imagery the track is the glass surface instead
(`background: var(--color-surface)` + blur 28px + 1px `--color-stroke`). Segment: height 34px, padding 0 14px,
radius 9px, 15px / 620, colour `--color-text-muted`. **Selected segment: `background: var(--color-text);
color: var(--color-sign-text)`** – this is the shipped, approved style in the app.

**Lists / FAQ**: list card `background: var(--color-surface-raised); border: 1px solid var(--color-stroke);
border-radius: 22px`; rows min-height 60px, padding 14px 16px, 1px `--color-stroke` separators. Row title 17px / 580,
description 14px `--color-text-muted`. Group heading 13px / 640, uppercase, letter-spacing 0.06em, `--color-text-faint`.
FAQ rows expand with a chevron (line icon) rotating 90°, 280ms.

**Speed-limit sign** (may be used as a decorative element, e.g. „130”): circle, white face `--color-sign-face`,
ring `--color-sign-ring` ≈ 12% of diameter, digits `--color-sign-text` 700, `box-shadow: var(--shadow-sign)`.

**Bottom bar** (phone-width sticky CTA, mirrors the app's bottom navigation bar): a compact glass card
(radius 24px, padding 12px 20px) fixed 12px above the bottom safe area on phones only, containing the primary
„Open the app” button. It never covers content: add matching bottom padding to `main`.

**Shadow policy**: the app barely uses shadows. Only glass cards and the phone frame get `--shadow-card`; the
speed-limit sign gets `--shadow-sign`; the app icon gets `--shadow-start-mark`. Nothing else has a shadow.

**Icons**: monochrome line icons, 2px stroke, round caps/joins, 24px grid (Lucide style is acceptable), colour
`currentColor` (`--color-text` or `--color-text-muted`; a status colour only next to a state). No filled, duotone,
3D or emoji icons.

**Screenshot frame (iPhone mock-up)**: build it in CSS from tokens, no stock device images. Outer body
`background: var(--color-bg); border: 1px solid var(--color-stroke-strong); border-radius: var(--radius-card) /* 32px */;
padding: var(--space-1) /* 4px */; box-shadow: var(--shadow-card)`. Screen: the screenshot itself with
`border-radius: 28px; overflow: hidden` (32 − 4). Aspect ratio of every phone screenshot: 1206 × 2622 (iPhone 17 Pro);
the status bar (9:41) is part of the image – do not draw a notch or Dynamic Island. Never crop the status cards out of
a screenshot; if space is short, scale the whole frame. Exception: `12-live-activity-measure` and
`13-live-activity-nav` are crops of the iPhone lock-screen widget (1206 px wide, not full screens) – show them without
the phone frame, centred on a plain `--color-bg` area with `border-radius: var(--radius-tile)` and `--shadow-card`.

**Image files**: every screenshot exists twice, `<name>-hu.png` and `<name>-en.png` (same composition, UI in that
language). The Hungarian pages use `-hu`, the English pages use `-en`. If an `-en` file is missing, use the `-hu` file of
the same name until it is uploaded. Below, image names are given without the suffix.

**Layout**: max content width 1120px, side gutter 16px (phones) / 32px (≥ 768px). Section spacing `calc(2 * var(--space-12))` (96px) desktop,
`var(--space-12)` (48px) phone. Header: brand mark (app icon 32px, radius 8px) + „Tempomate” 20px / 700, right side: HU | EN segmented
control + small „Open the app” button (desktop). The header becomes `--color-surface-strong` + blur 28px after 8px of
scroll.

**Motion**: only `opacity` and `transform`, `--motion-base` with `--motion-ease`; sections fade/rise 12px once on
enter. `prefers-reduced-motion: reduce` → no animation at all.

**Forbidden**
- no stock photos, no people, no cars, no road photos – only the app's own screenshots;
- no emoji anywhere (flags in the language switch are text „HU” / „EN”, not flag emoji);
- no gradients except the three listed in "Glass card" and the hero fade below;
- no “AI glow”, neon, aurora blobs, mesh gradients, glassmorphism on everything – glass is for cards only;
- no ad-like elements: no countdowns, no “limited offer”, no badges like “#1”, no pop-ups, no cookie banner
  (there are no cookies);
- no animated noise, grain, particles, parallax, auto-playing video or carousels that move on their own;
- no colours outside the token list; no light theme; no fonts other than Inter;
- never claim "radar detector", "avoid fines", "beat the camera" or similar; the product helps you **keep** the limit.

## 4. Pages and sections

Language: every page exists in **Hungarian and English** (`/` = auto, `/hu/...` and `/en/...`). On first visit pick
the browser language (`navigator.languages`: any `hu*` → HU, otherwise EN); the HU | EN switch overrides it and is
remembered in `localStorage` (wrap in try/catch). Set `<html lang>` accordingly and add `hreflang` alternates.
Text blocks below are given as **HU / EN pairs – use them as written**. Words in „…” / “…” are the app's own labels;
do not paraphrase them.

### 4.1 `/` – Home

**Hero** (two columns ≥ 1024px: text left, phone frame right with `01-hero-measure-green`; stacked on phones,
image under the text). Background: `--color-bg` with a single fade `linear-gradient(color-mix(in srgb, var(--color-bg)
10%, transparent), color-mix(in srgb, var(--color-bg) 94%, transparent) 52%)` over nothing else (this is the app's
start-screen fade).

- Eyebrow pill (neutral): HU „Hirdetés nélkül · 6 nyelven · web + iPhone” / EN “No ads · 6 languages · web + iPhone”
- H1: HU „Tempomate” / EN “Tempomate” (44px / 700 / -0.035em on phones, 64px / 650 desktop, never wraps)
- One sentence (the app's own start-screen tagline):
  HU „Mérőszakaszon automatikusan indul: élő átlag, határ és egyértelmű színkód.”
  EN “Starts by itself at a section: live average, limit and a clear colour code.”
- Three check rows (✓ line icon in `--status-good`, 17px / 540):
  - HU „Az egyetlen app, ami szakaszellenőrzésben mutatja a futó átlagot – és hogy mennyivel mehetsz még.” /
    EN “The only app that shows your running average inside a section check – and how fast you may still go.”
  - HU „Navigáció, ami ismeri a szakaszellenőrzéseket.” / EN “Navigation that knows the section checks.”
  - HU „Nem radardetektor. Abban segít, hogy a határon belül maradj.” /
    EN “Not a radar detector. It helps you stay within the limit.”
- Primary button: HU „Megnyitás” / EN “Open the app” → `https://app.tempomate.app` (same tab).
- Next to it a placeholder slot for the App Store / TestFlight badge: a 48px-high, 160px-wide box with 1px dashed
  `--color-stroke-strong`, radius 14px, text 13px `--color-text-faint`, label HU „App Store-jelvény helye” /
  EN “App Store badge”, attribute `data-placeholder="appstore-badge"` – Kristof swaps in the official badge SVG later.
  Never write “coming soon” / „hamarosan”. Do not draw an Apple logo.

**How it works** (`id="how"`) – title HU „Hogyan működik” / EN “How it works”.
Three state cards side by side (≥ 1024px), stacked on phones, each a state-coloured glass card with its chip,
a phone frame with the screenshot, and one line:
1. Chip HU „Jó ütem” / EN “On pace” (`--status-good`, ✓), image `01-hero-measure-green`.
   HU „Az átlagod a határ alatt van.” / EN “Your average is under the limit.”
2. Chip HU „Átlag magas” / EN “Average too high” (`--status-high`, ↓), image `02-measure-amber`, plus a sample bar in
   the chip colour: HU „Maradj 122 alatt” / EN “Stay under 122”.
   HU „Az átlag a határ fölött van, de a szakasz végéig még behozhatod.” /
   EN “Your average is over the limit, but you can still bring it back before the end of the section.”
3. Chip HU „Túl gyors” / EN “Too fast” (`--status-fast`, ↑), image `03-measure-red`, sample bar:
   HU „Lassíts · max 121” / EN “Slow down · max 121”.
   HU „A várható végső átlag a határ fölött van.” / EN “Your expected final average is over the limit.”
Under the cards, one muted line: HU „A szín sosem egyedül beszél: minden állapotnak ikonja és szava is van.” /
EN “Colour never speaks alone: every state also has an icon and a word.”

**Features** (`id="features"`) – title HU „Funkciók” / EN “Features”. Only these (all are live today). Grid: 3 columns
desktop, 1 column phone; each item = line icon, 17px / 580 title, 15px muted text, optional screenshot.
1. HU „Szakaszmérés magától” / EN “Section measuring, automatically” – HU „Élő átlag, határ, „most” és „várható”
   sebesség, hátralévő km.” / EN “Live average, limit, “now” and “expected” speed, distance left.” (image `01`)
2. HU „Navigáció szakaszellenőrzéssel” / EN “Navigation with section checks” – HU „Útvonalválasztó
   „Leggyorsabb” címkével és a szakaszellenőrzések számával, hangos utasítások.” / EN “Route picker with the
   “Fastest” tag and the number of section checks, voice guidance.” (images `06-route-picker`, `07-nav-maneuver`)
3. HU „Gyorsabb út mérés közben is” / EN “Faster route, even while measuring” – HU „„Megéri”, „Lehet” vagy „Nem éri
   meg” – percben és kilométerben.” / EN “ “Worth it”, “Maybe” or “Not worth it” – in minutes and kilometres.”
   (image `05-offer-compact-measuring`)
4. HU „Fix kamerák és tervezett mérések” / EN “Fixed cameras and planned checks” – HU „Kamera-kártya: „A te irányodban
   mér” vagy „Az ellenirányt méri”, távolsággal. Tervezett rendőrségi mérés halvány sárga vonalként.” / EN “Camera
   card: “Measures your direction” or “Measures oncoming traffic”, with distance. Planned police checks as a faint
   yellow line.” (images `08-camera-card`, `09-camera-near`)
5. HU „Közösségi bejelentések” / EN “Community reports” – HU „Rendőrség, Baleset, Veszély, Útlezárás, Dugó, Beállt,
   Átlagmérés eleje / vége – és „Még ott van?” kérdés, amikor odaérsz.” / EN “Police, Accident, Hazard, Road closed,
   Traffic, Standstill, Section start / end – and a “Still there?” question when you get there.” (image `10-report-menu`)
6. HU „Forgalom és dugó” / EN “Traffic and jams” – HU „„+N perc dugó” az érkezés mellett, és „Dugóba kerültél?”,
   ha megállsz.” / EN “ “+N min traffic jam” next to your arrival time, and “Stuck in a traffic jam?” when you stop.”
7. HU „Kézi átlagmérés” / EN “Manual average measurement” – HU „Bárhol elindíthatod; privát, nem küld semmit.” /
   EN “Start it anywhere; it’s private and sends nothing.”
8. HU „Utak naplója és hőtérkép” / EN “Trip log and heatmap” – HU „Táv, menetidő, átlag, szakaszmérések; saját vagy
   közösségi hőtérkép „Gyakoriság” és „Átlagsebesség” módban.” / EN “Distance, driving time, average, section checks;
   your own or the community heatmap in “Frequency” and “Average speed” mode.” Image: `15-heatmap` (the street-matched heatmap lines in “Frequency” mode, Budapest).
9. HU „Lezárt képernyőn is (iPhone)” / EN “On the lock screen too (iPhone)” – HU „Live Activity és Dynamic Island:
   átlag, határ, következő manőver.” / EN “Live Activity and Dynamic Island: average, limit, next manoeuvre.”
   (images `12-live-activity-measure`, `13-live-activity-nav`)
Screenshot strip under the grid: `04-start-screen`, `07-nav-maneuver`, `11-settings` (phones: stacked; desktop: 3 in
a row).

**Data advantage** (`id="data"`) – title HU „Adat, amiben bízhatsz” / EN “Data you can trust”. Three stat cards
(glass, number in `--type-display-*`, `--color-text`):
- HU „Hivatalos szakaszlisták” / EN “Official section lists” – HU „Magyarország, Lengyelország (GITD), Olaszország,
  Franciaország, Spanyolország (DGT), Hollandia; Ausztriában az ASFINAG-listával összevetve; a többi az
  OpenStreetMapből, nem ellenőrzöttként jelölve.” / EN “Hungary, Poland (GITD), Italy, France, Spain (DGT), the
  Netherlands; Austria cross-checked with ASFINAG; everything else from OpenStreetMap, marked as unverified.”
- HU „VÉDA fix kamerák” / EN “VÉDA fixed cameras” – HU „Az ORFK VÉDA-listája és az OpenStreetMap: a hivatalos pontok
  „ellenőrzött” jelzéssel.” / EN “The Hungarian police VÉDA list plus OpenStreetMap; official points are marked
  as verified.”
- HU „6 nyelv” / EN “6 languages” – HU „Magyar, English, Deutsch, Slovenčina, Čeština, Polski – hanggal együtt.” /
  EN “Magyar, English, Deutsch, Slovenčina, Čeština, Polski – including voice.”
Do not print exact counts of sections or cameras.

**Privacy** (`id="privacy"`) – title HU „Adatvédelem” / EN “Privacy”. Two columns ≥ 1024px: the list card left,
phone frame with `14-idle-greeting` right (stacked on phones). List card:
- HU „Hirdetés nincs. Követés nincs.” / EN “No ads. No tracking.”
- HU „Az utak naplója és a mentett helyek a készülékeden maradnak.” / EN “Your trip log and saved places stay on your
  device.”
- HU „Védett zónák: minden mentett hely körül zóna, alapból 200 m. A zónák útszakaszai sosem mennek fel.” / EN “Privacy
  zones: every saved place has a zone around it, 200 m by default. Cells inside a zone are never sent.”
- HU „Névtelen vezetési adatok: útszakasz, áthaladás-szám, átlagsebesség, óra-sáv, a hét napja – útvonal, pontos idő és
  azonosító soha.” / EN “Anonymous driving data: road segment, number of passes, average speed, hour of day, day of week –
  never the route, exact time or an identifier.”
- HU „Fiók nem kell.” / EN “No account needed.”
Link: HU „Adatvédelmi tájékoztató” / EN “Privacy policy” → `/privacy`.

**Footer**: HU „Készült Budapesten.” / EN “Made in Budapest.” · links `/privacy`, `/support`, `/imprint` · HU „Az
iPhone-on Átlagsebesség néven találod.” (HU page only) · © 2026 Tempomate. 15px, `--color-text-muted`, top border 1px
`--color-stroke`. In the footer, also: HU „Németországban a vezető nem használhatja ezt a funkciót” /
EN “Drivers may not use this feature in Germany” (15px faint) – this is the app's own warning text.

### 4.2 `/privacy` – Privacy policy (skeleton)

Put a banner at the top (neutral chip): HU „Tervezet – jogi átnézés alatt” / EN “Draft – under legal review”, and wrap
every paragraph that needs confirmation in `<mark data-legal-review>` (styled: 1px dashed `--status-high` outline,
no background). Sections (HU / EN headings, content in both languages):

1. **Adatkezelő / Controller** – `[name, address, e-mail: hello@tempomate.app]` placeholders.
2. **Milyen adatot kezelünk / What we process**
   - Location (GPS): processed **on the device** to detect sections, measure the average and navigate. Trips (1 Hz
     samples), saved places and privacy zones are stored **only on the device** (iPhone: local database; web:
     IndexedDB) unless the user turns on cloud backup with an account.
   - Anonymous identifier: on first use the app creates a random anonymous user ID (Supabase Auth anonymous sign-in).
     It is used to attribute community reports, votes and traffic samples; it contains no name, e-mail or device ID.
   - Community reports and votes: report type, position, heading and time; shown to others for 2 hours (+2 hours per
     confirmation). `<mark data-legal-review>`retention of the stored rows after expiry`</mark>`
   - Traffic samples: position, heading and speed when a jam is detected or reported; used by others for 15 minutes.
     `<mark data-legal-review>`retention`</mark>`
   - Anonymous driving data (heatmap), **on by default, can be turned off** in Settings: per road segment (~25 m) the
     number of passes, average speed, hour of day and day of week; never the route, exact time, any identifier, the
     area around saved places, or the first and last 300 m of a trip. Only aggregated views (cells with ≥ 3
     submissions) are readable. `<mark data-legal-review>`legal basis for a default-on setting`</mark>`
   - Optional account (Apple, Google or e-mail magic link, no password): e-mail or provider ID, the chosen
     display name („Megszólítás”), synced settings, saved places and zones; trips and personal heatmap only if
     “cloud backup” is turned on (off by default). No date of birth, age or phone number.
3. **Feldolgozók / Processors**: Supabase (database and auth, EU – Ireland, eu-west-1); Mapbox (map tiles, search,
   directions, lock-screen map image – receives map positions and search text; `<mark data-legal-review>`transfer
   outside the EU`</mark>`); Resend (sign-in e-mails, EU – eu-west-1); Vercel (hosting of the web app); Apple / Google
   (only if you sign in with them).
4. **Jogalap / Legal basis** – `<mark data-legal-review>` placeholder per purpose: service (GDPR 6(1)(b)),
   community features (6(1)(f)), anonymous driving data (to be decided), account (6(1)(b)) `</mark>`.
5. **Megőrzés / Retention** – on-device data until the user deletes it (Settings › „Összes törlése” / “Delete all”,
   with an optional 30-day restore) or uninstalls; account data until account deletion; server rows:
   `<mark data-legal-review>`to be specified`</mark>`.
6. **Törlés és jogaid / Deletion and your rights** – in-app account deletion removes all account rows; anonymous
   community cells cannot be linked to anyone and remain. Access, rectification, erasure, objection, complaint to the
   NAIH (Hungarian DPA). Contact: hello@tempomate.app.
7. **Sütik / Cookies** – this website uses no cookies and no analytics.
8. **Hatály / Effective date** – `[date]`.

### 4.3 `/support`

Title HU „Segítség” / EN “Support”. E-mail button (secondary): `mailto:hello@tempomate.app` – label
„hello@tempomate.app”. FAQ (6 items, HU / EN):
1. HU „Radardetektor?” – „Nem. Nem jelez rendőrt, amit nem jelentettek, és nem segít elkerülni a mérést. Azt mutatja,
   mennyivel mehetsz, hogy a szakasz végén a határon belül légy.” / EN “Is it a radar detector?” – “No. It does not
   detect anything and does not help you avoid checks. It shows how fast you may go so that you finish the section
   within the limit.”
2. HU „Hol működik?” – „Ahol van mérőszakasz az adatainkban: hivatalos listák (HU, PL, IT, FR, ES, NL; AT
   összevetve) és OpenStreetMap. Németországban a vezető nem használhatja ezt a funkciót.” / EN “Where does it work?” –
   “Wherever we have section data: official lists (HU, PL, IT, FR, ES, NL; AT cross-checked) and OpenStreetMap.
   Drivers may not use this feature in Germany.”
3. HU „Kell hozzá internet vagy fiók?” – „Fiók nem kell. A mérés a beépített szakaszokkal hálózat nélkül is megy; a
   térképhez, a navigációhoz és a bejelentésekhez net kell.” / EN “Do I need internet or an account?” – “No account.
   Measuring works offline with the built-in sections; the map, navigation and reports need a connection.”
4. HU „Háttérben is mér?” – „iPhone-on igen, zárolt képernyővel is (Live Activity). A webes app maradjon előtérben –
   háttérben a mérés megszakad.” / EN “Does it measure in the background?” – “On iPhone, yes, even with the screen
   locked (Live Activity). Keep the web app in the foreground – measuring stops in the background.”
5. HU „Hibás szakaszt vagy kamerát láttam.” – „A Bejelentés menüben válaszd a „Térképhiba” csempét, vagy az
   „Átlagmérés eleje” / „Átlagmérés vége” tételt egy hiányzó szakaszhoz.” / EN “I found a wrong section or camera.” –
   “Open the report menu and pick “Map error”, or “Section start” / “Section end” for a missing section.”
6. HU „Milyen adat megy fel rólam?” – „Névtelen vezetési adatok, ha be van kapcsolva (alapból be, a Beállításokban
   kikapcsolható), és a bejelentéseid. Részletek: Adatvédelmi tájékoztató.” / EN “What data about me is sent?” –
   “Anonymous driving data if enabled (on by default, can be turned off in Settings) and your reports. Details:
   Privacy policy.”

### 4.4 `/imprint`

Title HU „Impresszum” / EN “Imprint”. Placeholders: operator name, address, e-mail hello@tempomate.app, company /
tax number if any, hosting provider of this site. Mark the block `data-legal-review`.

## 5. Responsive rules

- Works from **320px** wide: no horizontal scroll at 320px, 375px, 390px, 430px, 768px, 1024px, 1440px.
- Side gutter 16px on phones. Body text never smaller than 15px at any width.
- Screenshots: on phones **one under the other**, each frame max 300px wide, centred; tablet 2 per row; desktop
  (≥ 1024px) **3 per row**. The hero frame is max 340px wide on desktop, 280px on phones.
- The H1 „Tempomate” never wraps; long German/Polish words are not an issue here (only HU/EN), but buttons must allow
  their label to wrap rather than overflow at 320px.
- Tap targets ≥ 56px high on touch devices (`--size-touch`).

## 6. Performance / SEO

- Static output (prerender every route in both languages). No client-side data fetching.
- `<title>`: **„Tempomate – Average Speed Navigation”** (EN) / „Tempomate – Átlagsebesség-navigáció” (HU).
- Meta description EN: “Starts by itself at a section: live average, limit and a clear colour code.” – HU: „Mérőszakaszon
  automatikusan indul: élő átlag, határ és egyértelmű színkód.”
- Open Graph / Twitter image: 1200 × 630, built from `01-hero-measure-green` in the phone frame on `--color-bg`, with
  „Tempomate” in 64px / 650 – export as a static PNG at build time (`/og.png`).
- Favicon and app icons from the uploaded files: `icon-32-favicon.png`, `icon-180-apple-touch.png`,
  `icon-192.png`, `icon-512.png`, `icon-1024.png` (source). `theme-color` = `#06070A`.
- Images: serve WebP/AVIF with PNG fallback, `width`/`height` set (1206 × 2622 ratio), `loading="lazy"` except the
  hero. Inter self-hosted, `font-display: swap`. Lighthouse ≥ 95 in all four categories on mobile.
- `sitemap.xml`, `robots.txt` (allow all), canonical URLs, `hreflang` hu / en / x-default.

## 7. Technical notes for Lovable

- You own only the **root domain `tempomate.app`** (and `www` → redirect to the root).
- Do **not** create, proxy, redirect or configure `app.tempomate.app` or `partner.tempomate.app` – they are served
  elsewhere. Links to the app are plain absolute links to `https://app.tempomate.app`.
- `/privacy` and `/support` are **final URLs** referenced by the App Store submission: they must return 200 at exactly
  these paths (no trailing-slash redirect loops, no language prefix required – `/privacy` shows the browser language,
  `/hu/privacy` and `/en/privacy` are the explicit variants). Same for `/imprint`.
- No cookies, no analytics, no tag manager, no chat widget, no newsletter form.

## 8. Acceptance checklist (Kristof checks the finished site)

1. Colours: background `#06070A`, text `#F4F6FA`, the three state colours `#2EE59D` / `#FFB224` / `#FF4D61` – spot-check
   with the browser colour picker; no colour on the page outside section 2.
2. Radii: 60px buttons 18px, small buttons 14px, glass cards 32px, list cards 22px, pills/chips fully rounded,
   segmented 12px / 9px.
3. Font is Inter everywhere (DevTools › Computed › rendered font), numbers tabular; no text under 15px except legal fine
   print (14px).
4. Screenshots appear in the order of `assets-index.md`, uncropped, in the token-built iPhone frame, sharp on retina.
5. HU | EN switch works on every page, the selected segment is white with dark text, the choice survives a reload, and
   the first visit follows the browser language.
6. At 320px width there is no horizontal scroll on any page (DevTools device toolbar 320 × 568).
7. `https://tempomate.app/privacy` and `https://tempomate.app/support` return 200 in both languages; `/imprint` too.
8. Every „Open the app” button goes to `https://app.tempomate.app`; nothing on the site touches `app.` or `partner.`.
9. No emoji, no stock photo, no gradient other than the card glow / hairline / hero fade, no shadow other than the four
   listed, no cookie banner, no third-party request at all in the Network tab.
10. `<title>` is “Tempomate – Average Speed Navigation” (EN), favicon is the app icon, `/og.png` shows the hero
    screenshot, and the privacy page shows the “Draft – under legal review” banner.
