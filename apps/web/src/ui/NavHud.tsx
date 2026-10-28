import { formatClock, formatDistance, formatTripDuration, speedIn, t, unitLabel, type AlternativeOffer, type NavView, type SpeedUnit } from '@atlagsebesseg/app-logic';
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

/** Felső kártya: következő manőver (ikon + távolság + út), alatta kisebben a rákövetkező, és a közeledő szakasz jelzése. */
export function NavTop({ view, unit }: { view: NavView; unit: SpeedUnit }) {
  const arrived = view.phase === 'arrived';
  const up = upcomingText(view, unit);
  const busy = view.rerouting || view.offRoute;
  return (
    <section className="nav-top glass" data-busy={busy} aria-live="polite" aria-label={view.next.instruction || t('nav.aria')}>
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

/** Mérés közben a navigációs utasítás egysoros sávvá zsugorodik a mérőkártya fölött. */
export function NavStrip({ view, unit }: { view: NavView; unit: SpeedUnit }) {
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

/** Felugró ajánlat: „Gyorsabb út: −7 perc” – Elfogad / Elvet (56 px-es gombok). */
export function OfferCard({ offer, onAccept, onDecline }: { offer: AlternativeOffer; onAccept: () => void; onDecline: () => void }) {
  if (offer.compact) {
    // mérés közben: egysoros, a mérőkártya (státusz) fölött
    const n = Math.max(1, Math.round(offer.gainS / 60));
    const title = offer.exitName ? t('nav.offer.exitNamed', { name: offer.exitName, km: offer.exitKm, n }) : t('nav.offer.exit', { km: offer.exitKm, n });
    return (
      <section className="nav-offer nav-offer-compact glass" role="alertdialog" aria-label={title}>
        <div className="title nav-offer-title">{title}</div>
        <button className="btn" onClick={onDecline}>
          {t('nav.offer.decline')}
        </button>
        <button className="btn primary" onClick={onAccept}>
          {t('nav.offer.accept')}
        </button>
      </section>
    );
  }
  return (
    <section className="nav-offer glass" role="alertdialog" aria-label={t('nav.offer.title', { n: Math.max(1, Math.round(offer.gainS / 60)) })}>
      <div className="title nav-offer-title">{t('nav.offer.title', { n: Math.max(1, Math.round(offer.gainS / 60)) })}</div>
      <div className="btn-row">
        <button className="btn" onClick={onDecline}>
          {t('nav.offer.decline')}
        </button>
        <button className="btn primary" onClick={onAccept}>
          {t('nav.offer.accept')}
        </button>
      </div>
    </section>
  );
}
