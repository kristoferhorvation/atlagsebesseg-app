import { describe, expect, it } from 'vitest';
import { toGpsFix } from './toGpsFix';

const pos = (c: Partial<GeolocationCoordinates>) => ({
  timestamp: 1000,
  coords: { latitude: 47, longitude: 19, accuracy: 6, altitude: null, altitudeAccuracy: null, heading: null, speed: null, ...c } as GeolocationCoordinates,
});

describe('toGpsFix', () => {
  it('érvényes értékek', () => {
    expect(toGpsFix(pos({ speed: 30, heading: 90 }))).toEqual({ lat: 47, lon: 19, timestamp: 1000, speed: 30, accuracy: 6, heading: 90 });
  });
  it('NaN irány, negatív sebesség → null', () => {
    expect(toGpsFix(pos({ speed: -1, heading: NaN }))).toMatchObject({ speed: null, heading: null });
  });
});
