import { mapboxMatcher, matchTrace, pendingTrack, rawLines, segmentUploadRows, type HeatZone, type MapMatcher, type TripTrack } from '@atlagsebesseg/app-logic';
import { supabase } from '../backend';
import { listTracks, saveTrack, tripSamples, tripsWithoutTrack } from '../trips/tripStore';
import { enqueueSegmentRows, flushSegmentOutbox } from './heatShare';

/**
 * AW24: az út végi illesztés. Az út a mintáiból pontsort kap (`pending`), az illesztő (`MapMatcher`, ma Mapbox) vonalat ad belőle; hálózati hibánál a sor függőben marad és később
 * újrapróbálódik. A régi utak a nyers mintákból visszamenőleg épülnek újra, de közösségbe nem mennek (mint eddig a régi cellák). Szimulátorban nincs illesztés és nincs feltöltés.
 */
const IS_SIM = ['sim', 'navsim', 'cruise'].some((k) => new URLSearchParams(location.search).has(k));
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const matcher: MapMatcher | null = IS_SIM || !TOKEN ? null : mapboxMatcher(TOKEN);

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
    const lines = matcher ? await matchTrace(t.parts, matcher) : rawLines(t.parts);
    const done: TripTrack = { ...t, status: 'done', lines, matcher: matcher?.id ?? null };
    await saveTrack(done);
    if (done.share && ctx.share() && matcher) {
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
