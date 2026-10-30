import { altOfferCompactLines, formatClock, formatDistance, formatTripDuration, reportVisual, speedIn, t, unitLabel, type ActiveReport, type AlternativeOffer, type NavView, type ReportPrompt, type SpeedUnit } from '@atlagsebesseg/app-logic';
import { Icon } from './Icon';
import { ManeuverIcon } from './ManeuverIcon';

const dist = (m: number, unit: SpeedUnit) => {
  const d = formatDistance(m, unit);
  return `${d.value} ${d.unit}`;
};

/** A közeledő szakasz / kamera / mérés kis jelzése: „Szakaszellenőrzés 2 km · max 110”. */
export function upcomingText(view: NavView, unit: SpeedUnit): string | null {
  const u = view.upcoming;
  if (!u) return null;
  const d = dist(u.distanceM, unit);
  if (u.item.kind === 'camera') return t('nav.upcoming.camera', { d });
  const x = u.item.limitKmh ? speedIn(u.item.limitKmh, unit) : '–';
  return t(u.item.kind === 'section' ? 'nav.upcoming.section' : 'nav.upcoming.planned', { d, x: x ?? '–' });
}

/** AOS14: a közeledő bejelentés a kártyán (a kamera-figyelmeztetés helyén és stílusában). */
export interface ReportAlertProps {
  prompt: ReportPrompt;
  report: ActiveReport;
  canVote: boolean;
  sending: boolean;
  onVote: (confirm: boolean) => void;
}

/**
 * A bejelentés sora: közeledéskor „Rendőrség 240 m”, `askM`-en belül UGYANEZ a sor helyben „Még ott van?” + Igen / Nem
 * (nem jön új elem). A kamera-sor (`.nav-camera`) kinézetével.
 */
function ReportAlertRow({ alert, unit }: { alert: ReportAlertProps; unit: SpeedUnit }) {
  const v = reportVisual(alert.report);
  const ask = alert.prompt.phase === 'ask';
  return (
    <div className="nav-camera report-alert-row" data-phase={alert.prompt.phase} role="alert">
      <div className="report-alert-head">
        <Icon name={v.icon} size={40} />
        <b className="num">{ask ? v.label : t('report.alert.ahead', { label: v.label, d: dist(alert.prompt.distanceM, unit) })}</b>
        {ask && <span className="report-alert-q">{t('report.prompt.question')}</span>}
      </div>
      {ask && (
        <div className="btn-row">
          <button className="btn" disabled={!alert.canVote || alert.sending} onClick={() => alert.onVote(true)}>
            <Icon name="check" /> {t('report.prompt.yes')}
          </button>
          <button className="btn" disabled={!alert.canVote || alert.sending} onClick={() => alert.onVote(false)}>
            <Icon name="close" /> {t('report.prompt.no')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Navigáció nélkül (vagy ha a felső kártya nem látszik) a bejelentés kártyája önállóan, a felső kártya helyén. */
export function ReportAlertCard({ alert, unit }: { alert: ReportAlertProps; unit: SpeedUnit }) {
  return (
    <section className="nav-top glass report-alert" data-camera="true" aria-live="polite">
      <ReportAlertRow alert={alert} unit={unit} />
    </section>
  );
}

/** Közeli kamera: „Kamera 250 m · max 50” (határ nélkül csak a távolság). */
export function cameraNearText(view: NavView, unit: SpeedUnit): string | null {
  const c = view.cameraNear;
  if (!c) return null;
  const d = dist(c.distanceM, unit);
  const x = c.item.limitKmh ? speedIn(c.item.limitKmh, unit) : null;
  return x ? t('nav.camera.near', { d, x }) : t('nav.upcoming.camera', { d });
}

/**
 * Felső kártya: következő manőver (ikon + távolság + út), alatta kisebben a rákövetkező, és a közeledő szakasz jelzése.
 * Közeli kameránál (AW12) a kártya borostyánra vált, nagy kamera-ikonnal; elhaladás után vissza. AOS14: a közeledő
 * bejelentés ugyanígy (`report`), a kamera helyén – kérdés-fázisban Igen / Nem gombbal.
 */
/** `hidden` (AOS13): a kártya nem fér ki – rejtve elrendezve marad (mérhető), a lépés egysoros sávként látszik. */
export function NavTop({ view, unit, hidden = false, report = null }: { view: NavView; unit: SpeedUnit; hidden?: boolean; report?: ReportAlertProps | null }) {
  const arrived = view.phase === 'arrived';
  const busy = view.rerouting || view.offRoute;
  const cam = busy || arrived ? null : cameraNearText(view, unit);
  // AOS14: a közeledő bejelentés a kamera helyén (a közeli kamera elsőbbséget kap)
  const rep = cam || busy ? null : report;
  const up = cam || rep ? null : upcomingText(view, unit);
  return (
    <section className="nav-top glass" data-busy={busy} data-camera={cam !== null || rep !== null} data-strip={hidden} aria-hidden={hidden} aria-live="polite" aria-label={view.next.instruction || t('nav.aria')}>
      {busy || view.rerouteFailed ? (
        <div className="nav-reroute" data-failed={!view.rerouting && view.rerouteFailed}>
          <Icon name="restart" size={34} className={view.rerouting ? 'spin' : undefined} />
          <span>{view.rerouting || !view.rerouteFailed ? t('nav.rerouting') : t('nav.rerouteFailed')}</span>
        </div>
      ) : arrived ? (
        <div className="nav-main">
          <ManeuverIcon kind="arrive" size={64} />
          <div className="nav-text">
            <b className="nav-arrived">{t('nav.arrived')}</b>
            <span className="nav-road">{view.destination.name}</span>
          </div>
        </div>
      ) : (
        <div className="nav-main">
          <ManeuverIcon kind={view.next.icon} size={64} />
          <div className="nav-text">
            <b className="nav-dist num">{dist(view.next.distanceM, unit)}</b>
            <span className="nav-road">{view.next.text}</span>
          </div>
        </div>
      )}
      {cam && (
        <div className="nav-camera" role="alert">
          <Icon name="cam_speed" size={40} />
          <b className="num">{cam}</b>
        </div>
      )}
      {rep && <ReportAlertRow alert={rep} unit={unit} />}
      {up && !arrived && (
        <div className="nav-badge" data-kind={view.upcoming!.item.kind}>
          <Icon name={view.upcoming!.item.kind === 'camera' ? 'cam_speed' : 'rendorseg'} size={22} /> {up}
        </div>
      )}
      {view.then && !arrived && !busy && (
        <div className="nav-then">
          <span>{t('nav.then')}</span>
          <ManeuverIcon kind={view.then.icon} size={26} />
          <span className="nav-then-text">{view.then.text}</span>
        </div>
      )}
    </section>
  );
}

/** Mérés közben a navigációs utasítás egysoros sávvá zsugorodik a mérőkártya fölött; közeli kameránál borostyán kamera-sor. */
export function NavStrip({ view, unit }: { view: NavView; unit: SpeedUnit }) {
  const cam = view.phase === 'arrived' ? null : cameraNearText(view, unit);
  if (cam)
    return (
      <div className="nav-strip glass" data-camera="true" role="alert">
        <Icon name="cam_speed" size={32} />
        <b className="nav-strip-text num">{cam}</b>
      </div>
    );
  return (
    <div className="nav-strip glass" aria-label={view.next.instruction || t('nav.aria')} aria-live="polite">
      <ManeuverIcon kind={view.phase === 'arrived' ? 'arrive' : view.next.icon} size={32} />
      <b className="num">{dist(view.next.distanceM, unit)}</b>
      <span className="nav-strip-text">{view.next.text}</span>
      <span className="nav-strip-eta num">{formatClock(view.etaMs)}</span>
    </div>
  );
}

/** Alsó sáv: pillanatnyi sebesség, érkezés, hátralévő idő és táv, „Befejezés”. */
export function NavBottom({ view, unit, currentKmh, onEnd }: { view: NavView; unit: SpeedUnit; currentKmh: number | null; onEnd: () => void }) {
  return (
    <section className="card glass compact nav-bottom" aria-label={t('nav.aria')}>
      <div className="nav-bottom-speed num">
        {speedIn(currentKmh ?? 0, unit) ?? 0}
        <small>{unitLabel(unit)}</small>
      </div>
      <div className="nav-bottom-eta">
        <b className="num" aria-label={t('nav.eta')}>
          {formatClock(view.etaMs)}
        </b>
        <span className="num">
          {formatTripDuration(view.remainingS)} · {dist(view.remainingM, unit)}
        </span>
      </div>
      <button className="btn danger nav-end" onClick={onEnd}>
        {t('nav.end')}
      </button>
    </section>
  );
}

/** A lehajtó sora: „Lehajtó: Kijárat 56 · 5,2 km” / „Lehajtó 5,2 km-nél”; ismeretlen lehajtónál nincs. */
const exitLine = (o: AlternativeOffer): string | null =>
  o.exitAlongM === null ? null : o.exitName ? t('nav.offer.exitAtNamed', { name: o.exitName, km: o.exitKm }) : t('nav.offer.exitAt', { km: o.exitKm });

/**
 * Felugró ajánlat (AW12): „Megéri · −7 perc, +4 km” / „Lehet · −2 perc, +1 km” / „Nem éri meg · +20 km kerülő, −10 perc”,
 * alatta a lehajtó; Elfogad / Elvet (56 px-es gombok). A kiemelt gomb az, ami 45 s után magától történik; alatta vékony,
 * fogyó csík mutatja a hátralévő időt, szám nélkül (AW13). Mérés közben kompakt, kétsoros: „Kijárat 56” / „2,1 km · −7 perc”.
 */
export function OfferCard({ offer, onAccept, onDecline }: { offer: AlternativeOffer; onAccept: () => void; onDecline: () => void }) {
  const exit = exitLine(offer);
  const acceptByDefault = offer.verdict === 'worth';
  const timer = <span className="nav-offer-timer" aria-hidden="true" style={{ transform: `scaleX(${offer.timeLeft})` }} />;
  const buttons = (
    <>
      <button className={acceptByDefault ? 'btn' : 'btn primary'} onClick={onDecline}>
        {t('nav.offer.decline')}
        {!acceptByDefault && timer}
      </button>
      <button className={acceptByDefault ? 'btn primary' : 'btn'} onClick={onAccept}>
        {t('nav.offer.accept')}
        {acceptByDefault && timer}
      </button>
    </>
  );
  const head = (
    <div className="nav-offer-head">
      <div className="title nav-offer-title">{offer.title}</div>
      {exit && <div className="nav-offer-exit num">{exit}</div>}
    </div>
  );
  // mérés közben: kompakt, a mérőkártya (státusz) fölött, két sorban: „Kijárat 56” / „2,1 km · −7 perc”
  if (offer.compact) {
    const [line1, line2] = altOfferCompactLines(offer);
    return (
      <section className="nav-offer nav-offer-compact glass" data-verdict={offer.verdict} role="alertdialog" aria-label={offer.title}>
        <div className="nav-offer-head">
          <div className="title nav-offer-title">{line1}</div>
          {line2 && <div className="nav-offer-exit num">{line2}</div>}
        </div>
        {buttons}
      </section>
    );
  }
  return (
    <section className="nav-offer glass" data-verdict={offer.verdict} role="alertdialog" aria-label={offer.title}>
      {head}
      <div className="btn-row">{buttons}</div>
    </section>
  );
}
