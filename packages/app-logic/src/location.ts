/**
 * Helyhozzáférés (AW13): a GPS-pill viselkedése az engedély állapotából, az első felhasználói gesztusra történő
 * újrakérés (Mac Safari csak gesztusra kérdez), és a tiltott hozzáférés bekapcsolásának útja a felismert böngészőre.
 * Platformfüggetlen: a web a Permissions API-ból és a user agentből tölti, az iOS a saját engedély-állapotából.
 */
import type { TKey } from './i18n';

/** A helymeghatározás állapota (a `watchPosition` eredménye). */
export type GeoStatus = 'ki' | 'kereses' | 'aktiv' | 'elutasitva' | 'nem_elerheto' | 'hiba';

/** Az engedély (Permissions API `geolocation`); `unknown`: a böngésző nem adja meg. */
export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

/** A felismert böngésző – a tiltott hozzáférés bekapcsolásának útja ehhez igazodik. */
export type BrowserKind = 'iosSafari' | 'macSafari' | 'chrome' | 'androidChrome' | 'other';

/** A GPS-pill koppintására: engedélykérés / a tiltott-lap megnyitása / semmi. */
export type GpsPillAction = 'request' | 'deniedHelp' | 'none';

/**
 * Böngésző a user agentből. Az iPadOS asztali UA-t ad („Macintosh”), ezt az érintőpontok száma különbözteti meg;
 * iOS-en a nem-Safari böngészők (CriOS, FxiOS, EdgiOS) és a Chromium-alapú nem-Chrome-ok (Edge, Opera, Samsung)
 * az általános útmutatót kapják.
 */
export function detectBrowser(ua: string, maxTouchPoints = 0): BrowserKind {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'other' : 'iosSafari';
  if (/Edg\/|EdgA\/|OPR\/|SamsungBrowser|Firefox\//.test(ua)) return 'other';
  if (/Android/.test(ua)) return /Chrome\//.test(ua) ? 'androidChrome' : 'other';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua)) return 'macSafari';
  return 'other';
}

/**
 * A GPS-pill koppintása (AW14). A helyzet-állapot nyer a Permissions API felett: ha van pozíció (aktív), a hozzáférés
 * megvan – a pill a pontosságot mutatja, koppintásra semmi, akármit mond az API (iOS Safarin élesben „denied”-et adott
 * ±8 m-es pozíció mellett). Az engedély csak pozíció nélkül számít: `granted` → semmi, `denied` → tiltott-lap, `prompt`
 * → kérés; ha az API nincs vagy hibát ad (`unknown`), „prompt”-nak vesszük – a kérés kideríti, nem a lap állítja.
 * HTTPS nélkül (nem elérhető) és kikapcsolva nincs mit kérni.
 */
export function gpsPillAction(permission: GeoPermission, status: GeoStatus): GpsPillAction {
  if (status === 'nem_elerheto' || status === 'ki' || status === 'aktiv') return 'none';
  if (permission === 'granted') return 'none';
  if (permission === 'denied') return 'deniedHelp';
  return 'request';
}

/** A geolocation `PositionError.PERMISSION_DENIED` kódja. */
export const GEO_PERMISSION_DENIED = 1;

/**
 * A GPS-pill újrakérésének hibája (AW15): ha a pill koppintására indított kérés PERMISSION_DENIED (1) hibát ad, a
 * tiltott-lap nyílik – a Permissions API-tól függetlenül (iOS Safariban nincs, és a gesztusból kért engedély elutasítása
 * egyértelmű). Más hibára (nincs jel, időtúllépés) és az automatikus / első-gesztusos kérés elutasítására nem nyit lapot.
 */
export function pillRequestError(code: number, byPill: boolean): GpsPillAction {
  return byPill && code === GEO_PERMISSION_DENIED ? 'deniedHelp' : 'none';
}

/**
 * Az első érintés / kattintás bárhol indítsa újra a kérést, ha az indításkori automatikus kérés nem jutott el a
 * pozícióig, és az engedély nincs eldöntve (Mac Safari gesztus nélkül nem kérdez, vagy azonnal elutasít).
 */
export function retryOnGesture(permission: GeoPermission, status: GeoStatus): boolean {
  if (permission === 'granted' || permission === 'denied') return false;
  return status === 'kereses' || status === 'elutasitva' || status === 'hiba';
}

const HELP_STEPS: Record<BrowserKind, readonly TKey[]> = {
  iosSafari: ['geo.help.iosSafari.1', 'geo.help.iosSafari.2'],
  macSafari: ['geo.help.macSafari.1', 'geo.help.macSafari.2'],
  chrome: ['geo.help.chrome.1', 'geo.help.chrome.2'],
  androidChrome: ['geo.help.androidChrome.1', 'geo.help.androidChrome.2'],
  other: ['geo.help.other.1'],
};

/** A tiltott helyhozzáférés bekapcsolásának lépései (szótárkulcsok, sorrendben) a felismert böngészőre. */
export const deniedHelpSteps = (browser: BrowserKind): readonly TKey[] => HELP_STEPS[browser];
