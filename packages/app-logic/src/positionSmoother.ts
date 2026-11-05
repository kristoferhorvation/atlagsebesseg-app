import type { GpsFix } from '@atlagsebesseg/core';

/**
 * AW23: a pozíció-jelölő és a követő kamera közös mozgása (a Swift-pár: `Logic/PositionSmoother.swift`, azonos nevű tesztekkel).
 * A fixek között a jelölő a sebességgel és az iránnyal halad tovább; új fixnél nem ugrik, hanem korlátozott tempóval áll rá az
 * új becslésre: egy képkockán belül a mozgás legfeljebb a várható elmozdulás `maxSpeedFactor`-szorosa.
 */
export const POSITION_SMOOTH = {
  /** Az utolsó fix után legfeljebb eddig becsül előre (s); GPS-kiesésnél a jelölő megáll. */
  predictMaxS: 1.5,
  /** A korrekció időállandója (s). */
  correctTauS: 0.8,
  /** A menetirányú sebesség a mért sebesség ennyiszeresére gyorsulhat (`1 + x`), illetve lassulhat (`1 - x`). */
  alongFactor: 0.5,
  /** Az oldalirányú korrekció a mért sebesség ennyiszereséig. */
  crossFactor: 0.5,
  /** Lassú haladásnál / állva is legalább ekkora korrekciós tempó (m/s). */
  correctMinMps: 1,
  /** Ez alatt (m/s) áll: nincs előrebecslés. */
  stillMps: 0.7,
  /** A megjelenített sebesség időállandója (s): a GPS-sebesség ugrása nem látszik. */
  speedTauS: 0.5,
  /** Az irány időállandója (s). */
  bearingTauS: 0.35,
  /** Ennél nagyobb eltérésnél (m) ugrik: GPS újraindulás, szimulátor-ablak. */
  snapM: 80,
} as const;

export interface SmoothPose {
  lat: number;
  lon: number;
  bearing: number;
  /** A simított sebesség (m/s) – a sebességfüggő zoomhoz. */
  speedMps: number;
}

const M_PER_DEG = 111_195;
const rad = (d: number) => (d * Math.PI) / 180;
const shortest = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

export class PositionSmoother {
  private fix: GpsFix | null = null;
  private fixAt = 0;
  /** A fix sebessége (m/s) és iránya (°) – irány vagy sebesség nélküli fixnél az előzőből számolva. */
  private vMps = 0;
  private dir = 0;
  private pose: SmoothPose | null = null;
  private lastT = 0;
  private scale = 1;

  /** `simClock`: szimulátor-lejátszás – a fixek saját óráját követi (gyorsított lejátszásnál is); éles módban mindig valós idő. */
  constructor(private readonly simClock = false) {}

  /** Új fix: `now` a platform monoton órája (ms). */
  onFix(fix: GpsFix, now: number): void {
    const prev = this.fix;
    if (this.simClock && prev && now > this.fixAt && fix.timestamp > prev.timestamp) this.scale = Math.max(1, (fix.timestamp - prev.timestamp) / (now - this.fixAt));
    this.fix = fix;
    this.fixAt = now;
    const dt = prev ? (fix.timestamp - prev.timestamp) / 1000 : 0;
    const dx = prev ? (fix.lon - prev.lon) * M_PER_DEG * Math.cos(rad(fix.lat)) : 0;
    const dy = prev ? (fix.lat - prev.lat) * M_PER_DEG : 0;
    const moved = Math.hypot(dx, dy);
    this.vMps = fix.speed !== null && fix.speed >= 0 ? fix.speed : dt > 0 ? moved / dt : 0;
    if (fix.heading !== null) this.dir = fix.heading;
    else if (moved > 4) this.dir = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    if (!this.pose) {
      this.pose = { lat: fix.lat, lon: fix.lon, bearing: this.dir, speedMps: this.vMps };
      this.lastT = now;
    }
  }

  /** A megjelenítendő póz a `now` pillanatban (képkockánként hívva); fix nélkül `null`. */
  at(now: number): SmoothPose | null {
    const f = this.fix;
    const p = this.pose;
    if (!f || !p) return null;
    const dt = (Math.max(0, now - this.lastT) / 1000) * this.scale;
    this.lastT = now;
    if (dt === 0) return p;
    const C = POSITION_SMOOTH;
    const v = p.speedMps + (this.vMps - p.speedMps) * (1 - Math.exp(-dt / C.speedTauS));
    const age = (Math.max(0, now - this.fixAt) / 1000) * this.scale;
    // a becsült helyzet most: az utolsó fix + sebesség × eltelt idő (korlátozva), álló autónál maga a fix
    const predict = this.vMps >= C.stillMps ? this.vMps * Math.min(C.predictMaxS, age) : 0;
    const dirRad = rad(this.dir);
    const [sin, cos] = [Math.sin(dirRad), Math.cos(dirRad)];
    const cosLat = Math.cos(rad(f.lat));
    const ex = (f.lon - p.lon) * M_PER_DEG * cosLat + sin * predict;
    const ey = (f.lat - p.lat) * M_PER_DEG + cos * predict;
    let lat: number;
    let lon: number;
    if (Math.hypot(ex, ey) > C.snapM) {
      lat = f.lat + (cos * predict) / M_PER_DEG;
      lon = f.lon + (sin * predict) / (M_PER_DEG * cosLat);
    } else {
      // az eltérés a menetirány szerint felbontva
      const along = ex * sin + ey * cos;
      const cross = ex * cos - ey * sin;
      const k = 1 - Math.exp(-dt / C.correctTauS);
      let stepAlong: number;
      let stepCross: number;
      if (v < C.stillMps || age > C.predictMaxS) {
        // áll, vagy nincs friss fix: lassan a becslésre (hátrafelé is)
        const cap = C.correctMinMps * dt;
        stepAlong = clampAbs(along * k, cap);
        stepCross = clampAbs(cross * k, cap);
      } else {
        // menetirányban a mért sebesség körül, korlátok között: nem ugrik és nem megy hátra
        stepAlong = Math.max(v * (1 - C.alongFactor) * dt, Math.min(v * (1 + C.alongFactor) * dt, v * dt + along * k));
        stepCross = clampAbs(cross * k, Math.max(C.correctMinMps, v * C.crossFactor) * dt);
      }
      lat = p.lat + (cos * stepAlong - sin * stepCross) / M_PER_DEG;
      lon = p.lon + (sin * stepAlong + cos * stepCross) / (M_PER_DEG * cosLat);
    }
    const bearing = (p.bearing + shortest(p.bearing, this.dir) * (1 - Math.exp(-dt / C.bearingTauS)) + 360) % 360;
    this.pose = { lat, lon, bearing, speedMps: v };
    return this.pose;
  }
}

const clampAbs = (x: number, cap: number) => Math.max(-cap, Math.min(cap, x));
