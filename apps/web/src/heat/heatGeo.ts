import { HEAT, type HeatGeo } from '@atlagsebesseg/app-logic';

/** A hőtérkép H3-műveletei (h3-js, lustán töltve; az iOS-pár: SwiftyH3). */
export interface WebHeatGeo extends HeatGeo {
  /** A koordináta res-10 cellája; hibás koordinátára `null`. */
  cellOf(lat: number, lon: number): string | null;
}

let geo: Promise<WebHeatGeo | null> | null = null;

export function heatGeo(): Promise<WebHeatGeo | null> {
  geo ??= import('h3-js')
    .then(
      (h3): WebHeatGeo => ({
        center: (cell) => {
          const [lat, lon] = h3.cellToLatLng(cell);
          return { lat: lat!, lon: lon! };
        },
        parent: (cell, res) => h3.cellToParent(cell, res),
        cellOf: (lat, lon) => {
          try {
            return h3.latLngToCell(lat, lon, HEAT.res);
          } catch {
            return null;
          }
        },
      }),
    )
    .catch(() => null);
  return geo;
}
