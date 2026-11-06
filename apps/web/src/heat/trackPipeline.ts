import { gridMatcher, migrateTrack, pendingTrack, segmentUploadRows, type HeatZone, type TrackMatcher, type TripTrack } from '@atlagsebesseg/app-logic';
import { supabase } from '../backend';
import { listTracks, saveTrack, tripSamples, tripsWithoutTrack } from '../trips/tripStore';
import { enqueueSegmentRows, flushSegmentOutbox } from './heatShare';

/**
 * AW24: az út végi illesztés. Az út a mintáiból pontsort kap (`pending`), az illesztő vonalat ad belőle; hibánál a sor függőben marad és később
 * újrapróbálódik. A régi utak a nyers mintákból visszamenőleg épülnek újra, de közösségbe nem mennek (mint eddig a régi cellák). Szimulátorban és
 * automatizált böngészőben (nav-shots, `navigator.webdriver`) nincs feltöltés.
 * AW25 (Kristof, Mapbox-feltételek): az illesztő a saját rács-illesztő (`gridMatcher`, nyers GPS-pontokból, hálózat nélkül); a Mapbox Map Matching
 * kikerült. A réteg cserélhető (később saját Valhalla-szerver).
 */
const IS_SIM = navigator.webdriver || ['sim', 'navsim', 'cruise'].some((k) => new URLSearchParams(location.search).has(k));
const matcher: TrackMatcher = gridMatcher;

/** A futó út (a pillanatképét még nem dolgozzuk fel) és a folyamatban lévő illesztések (egy út egyszer). */
let openTrip: string | null = null;
export const noteOpenTrip = (id: string | null) => {
  openTrip = id;
};
const inFlight = new Set<string>();

export interface TrackContext {
  share: () => boolean;
  zones: () => readonly HeatZone[];
}

async function complete(t: TripTrack, ctx: TrackContext): Promise<TripTrack> {
  if (inFlight.has(t.tripId)) return t;
  inFlight.add(t.tripId);
  try {
    const lines = await matcher.lines(t.parts);
    const done: TripTrack = { ...t, status: 'done', lines, matcher: matcher.id };
    await saveTrack(done);
    if (done.share && ctx.share() && !IS_SIM) {
      enqueueSegmentRows(segmentUploadRows(done, -new Date(done.startedAt).getTimezoneOffset(), ctx.zones()));
      void flushSegmentOutbox(supabase);
    }
    return done;
  } finally {
    inFlight.delete(t.tripId);
  }
}

/** Az út vége: pontsor a mintákból, majd illesztés; hiba esetén függőben marad. */
export async function finishTrack(tripId: string, startedAt: number, ctx: TrackContext): Promise<void> {
  const t = pendingTrack(tripId, startedAt, await tripSamples(tripId), ctx.share());
  await saveTrack(t);
  await complete(t, ctx);
}

let running: Promise<boolean> | null = null;

/** Indításkor és visszatéréskor: a függő illesztések és a még vonal nélküli régi utak. `true`: új vonal készült. */
export function catchUpTracks(ctx: TrackContext): Promise<boolean> {
  running ??= (async () => {
    let changed = false;
    for (const trip of await tripsWithoutTrack()) {
      if (trip.id === openTrip) continue;
      await saveTrack(pendingTrack(trip.id, trip.startedAt, await tripSamples(trip.id), false));
    }
    for (const t of await listTracks()) {
      // AW25: a tárolt Mapbox-illesztett (és régi egyenes) vonal a nyers pontsorból újra; nyers pontsor nélkül a Mapbox-geometria törlődik
      const m = migrateTrack(t);
      if (m !== t) {
        await saveTrack(m);
        changed = true;
        continue;
      }
      if (t.status !== 'pending' || t.tripId === openTrip) continue;
      try {
        await complete(t, ctx);
        changed = true;
      } catch (e) {
        // hálózat nélkül a többit sem érdemes próbálni, a következő indítás folytatja
        console.warn('[heat] match failed', e);
        break;
      }
    }
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}
