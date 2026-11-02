import { useEffect, useRef, useState } from 'react';
import {
  checksText,
  formatClock,
  LOCALES,
  getLanguage,
  mapTheme,
  sortTrips,
  speedRuns,
  t,
  TRIP_PERIODS,
  tripAvgKmh,
  tripDurationText,
  tripRowParts,
  tripSpeedText,
  tripTitle,
  tripTotals,
  turnsText,
  formatDistance,
  type LightPreset,
  type SpeedUnit,
  type Trip,
  type TripPeriod,
  type TKey,
} from '@atlagsebesseg/app-logic';
import { color } from '@atlagsebesseg/design-tokens';
import { deleteAllTrips, deleteTrip, listTrips, tripSamples } from '../trips/tripStore';
import { Icon } from './Icon';
import { mapStyleFor } from '../map/testMapMode';
import { Sheet } from './Sheet';

/**
 * AW19: az utak naplója (Beállítások › „Utak naplója”): felül az összesítő kártya időszakváltóval (ez a hét / hónap /
 * összes), alatta az utak dátum szerint csökkenő sorrendben; koppintásra a részlet (kis térkép a Visszafogott stílusban, a
 * számok, a szakaszmérések). Törlés: hosszú nyomásra vagy balra húzásra a sor „Törlés” gombja; alul „Összes törlése”
 * megerősítéssel. Minden adat csak ezen a készüléken (IndexedDB).
 */
export function TripLogSheet({
  unit,
  version,
  lightPreset,
  now,
  initialTripId,
  onClose,
}: {
  unit: SpeedUnit;
  /** Nő, ha új út került a naplóba (újratöltés). */
  version: number;
  lightPreset: LightPreset;
  now: number;
  /** A szimulátor / képernyőkép: rögtön ennek az útnak a részlete (`?tripOpen=first`). */
  initialTripId?: string | null;
  onClose: () => void;
}) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [period, setPeriod] = useState<TripPeriod>('het');
  const [openId, setOpenId] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const reload = () =>
    void listTrips()
      .then((x) => setTrips(sortTrips(x)))
      .catch(() => setTrips([]));
  useEffect(reload, [version]);
  useEffect(() => {
    if (initialTripId && trips?.length && openId === null) setOpenId(initialTripId === 'first' ? trips[0]!.id : initialTripId);
  }, [initialTripId, trips]);

  const open = trips?.find((x) => x.id === openId) ?? null;
  if (open)
    return (
      <Sheet title={tripTitle(open)} onClose={onClose}>
        <TripDetail trip={open} unit={unit} lightPreset={lightPreset} onBack={() => setOpenId(null)} />
      </Sheet>
    );

  const totals = tripTotals(trips ?? [], period, now);
  const periodLabel: Record<TripPeriod, TKey> = { het: 'trips.period.week', honap: 'trips.period.month', osszes: 'trips.period.all' };
  return (
    <Sheet title={t('trips.title')} onClose={onClose}>
      <div className="trip-stats" data-testid="trip-stats">
        <div className="segmented" role="group" aria-label={t('trips.period')}>
          {TRIP_PERIODS.map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t(periodLabel[p])}
            </button>
          ))}
        </div>
        <div className="trip-stat-grid">
          <Stat label={t('trips.stat.distance')} value={distText(totals.distanceM, unit)} big />
          <Stat label={t('trips.stat.moving')} value={tripDurationText(totals.movingS)} big />
          <Stat label={t('trips.stat.count')} value={String(totals.trips)} />
          <Stat label={t('trips.stat.avg')} value={tripSpeedText(totals.avgKmh, unit)} />
          <Stat label={t('trips.stat.turns')} value={turnsText(totals.turns)} />
          <Stat label={t('trips.stat.dirChanges')} value={turnsText(totals.dirChanges)} />
          <Stat label={t('trips.stat.checks')} value={checksText(totals.checksOk, totals.checksTooFast)} />
          <Stat label={t('trips.stat.jam')} value={tripDurationText(totals.jamS)} />
        </div>
      </div>

      {trips !== null && trips.length === 0 && <div className="sheet-note">{t('trips.empty')}</div>}
      {trips !== null && trips.length > 0 && (
        <div className="list trip-list">
          {trips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              unit={unit}
              armed={armed === trip.id}
              onArm={() => setArmed(trip.id)}
              onOpen={() => (armed ? setArmed(null) : setOpenId(trip.id))}
              onDelete={() => {
                setArmed(null);
                void deleteTrip(trip.id).then(reload);
              }}
            />
          ))}
        </div>
      )}

      {trips !== null && trips.length > 0 && (
        <div className="trip-delete-all">
          {confirmAll ? (
            <div className="list-row">
              <div className="label">{t('trips.deleteAllConfirm')}</div>
              <div className="mini-btns">
                <button className="mini-btn" onClick={() => setConfirmAll(false)}>
                  {t('trips.cancel')}
                </button>
                <button
                  className="mini-btn danger"
                  onClick={() => {
                    setConfirmAll(false);
                    void deleteAllTrips().then(reload);
                  }}
                >
                  {t('trips.delete')}
                </button>
              </div>
            </div>
          ) : (
            <button className="mini-btn danger wide" onClick={() => setConfirmAll(true)}>
              {t('trips.deleteAll')}
            </button>
          )}
        </div>
      )}
      <div className="sheet-note">{t('trips.local')}</div>
    </Sheet>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="trip-stat" data-big={big ? 'true' : undefined}>
      <div className="trip-stat-label">{label}</div>
      <div className="trip-stat-value">{value}</div>
    </div>
  );
}

const distText = (m: number, unit: SpeedUnit) => {
  const d = formatDistance(m, unit);
  return `${d.value} ${d.unit}`;
};

/** „okt. 31. 14:32” a nyelv szerint, a készülék időzónájában. */
export const tripDateText = (ms: number) => `${new Date(ms).toLocaleDateString(LOCALES[getLanguage()], { month: 'short', day: 'numeric' })} ${formatClock(ms)}`;

/** Hosszú nyomás (0,5 s) vagy balra húzás (60 px) után a sor végén „Törlés”. */
const LONG_PRESS_MS = 500;
const SWIPE_PX = 60;

function TripRow({ trip, unit, armed, onArm, onOpen, onDelete }: { trip: Trip; unit: SpeedUnit; armed: boolean; onArm: () => void; onOpen: () => void; onDelete: () => void }) {
  const p = tripRowParts(trip, unit);
  const press = useRef<{ x: number; timer: number; fired: boolean } | null>(null);
  const clear = () => {
    if (press.current) clearTimeout(press.current.timer);
  };
  return (
    <div className="list-row trip-row" data-armed={armed ? 'true' : undefined} data-trip={trip.id}>
      <button
        className="trip-row-main"
        onPointerDown={(e) => {
          clear();
          const st = { x: e.clientX, fired: false, timer: 0 };
          st.timer = window.setTimeout(() => {
            st.fired = true;
            onArm();
          }, LONG_PRESS_MS);
          press.current = st;
        }}
        onPointerMove={(e) => {
          const st = press.current;
          if (st && !st.fired && st.x - e.clientX > SWIPE_PX) {
            clear();
            st.fired = true;
            onArm();
          }
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (press.current?.fired) return;
          onOpen();
        }}
      >
        <div className="hint">{tripDateText(trip.startedAt)}</div>
        <div className="label">{p.title}</div>
        <div className="trip-row-nums">
          {p.distance} · {p.duration} · {p.avg}
        </div>
        <div className="trip-row-nums" data-testid="trip-row-turns">
          {p.turns}
        </div>
      </button>
      {armed ? (
        <button className="mini-btn danger" onClick={onDelete}>
          {t('trips.delete')}
        </button>
      ) : (
        <Icon name="chevronRight" size={20} />
      )}
    </div>
  );
}

function TripDetail({ trip, unit, lightPreset, onBack }: { trip: Trip; unit: SpeedUnit; lightPreset: LightPreset; onBack: () => void }) {
  const rows: [TKey, string][] = [
    ['trips.d.start', tripDateText(trip.startedAt)],
    ['trips.d.end', formatClock(trip.endedAt)],
    ['trips.d.distance', distText(trip.distanceM, unit)],
    ['trips.d.moving', tripDurationText(trip.movingS)],
    ['trips.d.idle', tripDurationText(trip.idleS)],
    ['trips.d.avg', tripSpeedText(tripAvgKmh(trip), unit)],
    ['trips.d.max', tripSpeedText(trip.maxKmh, unit)],
    ['trips.d.turns', turnsText(trip.turns)],
    ['trips.d.dirChanges', turnsText(trip.dirChanges)],
    ['trips.d.reroutes', String(trip.reroutes)],
    ['trips.d.jam', tripDurationText(trip.jamS)],
  ];
  return (
    <div className="trip-detail">
      <button className="mini-btn trip-back" onClick={onBack}>
        <Icon name="chevronLeft" size={20} /> {t('trips.title')}
      </button>
      <TripMap trip={trip} lightPreset={lightPreset} />
      <div className="list">
        {rows.map(([k, v]) => (
          <div className="list-row" key={k}>
            <div className="label">{t(k)}</div>
            <div className="value">{v}</div>
          </div>
        ))}
      </div>
      <div className="group-label">{t('trips.d.checks')}</div>
      <div className="list">
        {trip.measurements.length === 0 && (
          <div className="list-row">
            <div className="hint">{t('trips.d.noChecks')}</div>
          </div>
        )}
        {trip.measurements.map((m) => (
          <div className="list-row" key={`${m.sectionId}:${m.at}`}>
            <div style={{ minWidth: 0 }}>
              <div className="label">{m.name}</div>
              <div className="hint">
                {formatClock(m.at)} · {t('trips.checkLimit', { v: tripSpeedText(m.limitKmh, unit) })}
              </div>
            </div>
            <div className="value" data-tone={m.tooFast ? 'tul' : 'jo'}>
              {tripSpeedText(m.avgKmh, unit)}
              <div className="hint">{t(m.tooFast ? 'trips.checkFast' : 'trips.checkOk')}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Kis, nem mozgatható térkép az út vonalával (Visszafogott stílus, a mostani napszak fényével). AW20: az útvonal a mért
 * sebesség szerint színezve (zöld–sárga–piros a tábla-limithez képest, ha ismert; különben abszolút skála); minta nélkül
 * (régi út) az egyszínű vonal.
 */
function TripMap({ trip, lightPreset }: { trip: Trip; lightPreset: LightPreset }) {
  const ref = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState<'limit' | 'abs' | null>(null);
  useEffect(() => {
    const el = ref.current;
    const token = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
    const pts = trip.path.flat();
    if (!el || !token || pts.length < 2) return;
    let map: import('mapbox-gl').Map | null = null;
    let cancelled = false;
    // a Mapbox GL külön, lustán töltött chunk (mint a fő térképnél) – a napló ne húzza a fő csomagba
    void Promise.all([import('mapbox-gl'), tripSamples(trip.id).catch(() => [])]).then(([{ default: mapboxgl }, samples]) => {
      if (cancelled) return;
      const runs = speedRuns(samples);
      setLegend(runs.length > 0 ? (samples.some((x) => x.limitKmh) ? 'limit' : 'abs') : null);
      const bounds = pts.reduce((b, [lat, lon]) => b.extend([lon, lat]), new mapboxgl.LngLatBounds([pts[0]![1], pts[0]![0]], [pts[0]![1], pts[0]![0]]));
      const base = mapStyleFor('mapbox://styles/mapbox/standard', { lightPreset, theme: mapTheme('visszafogott'), showPointOfInterestLabels: false, showTransitLabels: false, showPedestrianRoads: false });
      const m = new mapboxgl.Map({
        container: el,
        accessToken: token,
        style: base.style,
        bounds,
        fitBoundsOptions: { padding: 28 },
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        config: base.config,
      });
      map = m;
      m.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: t('map.attribution') }), 'bottom-right');
      m.on('style.load', () => {
        m.addSource('trip', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: trip.path.map((seg) => seg.map(([lat, lon]) => [lon, lat])) } },
        });
        const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
        m.addLayer({ id: 'trip-casing', type: 'line', source: 'trip', slot: 'top', paint: { 'line-color': color.routeCasing, 'line-width': 7, 'line-opacity': 0.9 }, layout });
        if (runs.length === 0) {
          m.addLayer({ id: 'trip-line', type: 'line', source: 'trip', slot: 'top', paint: { 'line-color': color.route, 'line-width': 4 }, layout });
        } else {
          m.addSource('trip-speed', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: runs.map((r) => ({ type: 'Feature', properties: { tone: r.tone }, geometry: { type: 'LineString', coordinates: r.points.map(([lat, lon]) => [lon, lat]) } })) },
          });
          m.addLayer({
            id: 'trip-line',
            type: 'line',
            source: 'trip-speed',
            slot: 'top',
            paint: { 'line-color': ['interpolate', ['linear'], ['get', 'tone'], 0, color.tripSlow, 0.5, color.tripMid, 1, color.tripFast], 'line-width': 4 },
            layout,
          });
        }
        (window as unknown as { __tripMapReady?: string }).__tripMapReady = trip.id;
        (window as unknown as { __tripMapRuns?: number }).__tripMapRuns = runs.length;
      });
    });
    return () => {
      cancelled = true;
      const m = map;
      if (!m) return;
      // betöltés közbeni eltávolítás a Mapbox belső kéréseit „elvágja” (errorCb kivétel): megvárjuk a betöltést
      if (m.loaded()) m.remove();
      else {
        let removed = false;
        const drop = () => {
          if (!removed) {
            removed = true;
            m.remove();
          }
        };
        m.once('idle', drop);
        setTimeout(drop, 5000);
      }
    };
  }, [trip.id, lightPreset]);
  return (
    <>
      <div className="trip-map" ref={ref} data-testid="trip-map" />
      {legend && (
        <div className="trip-legend" data-testid="trip-legend" data-kind={legend}>
          <span className="trip-legend-bar" />
          <span>{legend === 'limit' ? t('trips.map.legendLimit') : t('trips.map.legendAbs')}</span>
        </div>
      )}
    </>
  );
}
