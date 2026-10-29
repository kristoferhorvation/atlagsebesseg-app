/**
 * SVG-útvonal (a webes Icon.tsx 24 × 24-es vonalikonjai) → SwiftUI `Path`-kód. Az íveket (A/a)
 * köbös Bézier-görbékre bontjuk, így a Swift-oldalnak csak move/line/curve/close kell.
 */

type Cmd = { op: 'M' | 'L'; x: number; y: number } | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: 'Z' };

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvAaZzCcSs])|(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Elliptikus ív → köbös Bézier-szakaszok (SVG 1.1, F.6 függelék: végpont → középpont). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number): Cmd[] {
  if (rx === 0 || ry === 0) return [{ op: 'L', x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * -(ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2));
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const deriv = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: Cmd[] = [];
  for (let i = 0; i < n; i++) {
    const a = th1 + i * step;
    const b = a + step;
    const p0 = point(a);
    const p3 = i === n - 1 ? { x: x2, y: y2 } : point(b);
    const d0 = deriv(a);
    const d3 = deriv(b);
    out.push({ op: 'C', x1: p0.x + k * d0.x, y1: p0.y + k * d0.y, x2: p3.x - k * d3.x, y2: p3.y - k * d3.y, x: p3.x, y: p3.y });
  }
  return out;
}

/** SVG `d` → abszolút move/line/curve/close parancsok. */
export function parsePath(d: string): Cmd[] {
  const tk = tokenize(d);
  const out: Cmd[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let op = '';
  /** Az előző köbös görbe második kontrollpontja (az S/s tükrözéséhez). */
  let lastC: { x: number; y: number } | null = null;
  const n = () => {
    const v = tk[i++];
    if (typeof v !== 'number') throw new Error(`szám kell: ${d}`);
    return v;
  };
  while (i < tk.length) {
    if (typeof tk[i] === 'string') op = tk[i++] as string;
    const rel = op === op.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const prevC: { x: number; y: number } | null = lastC;
    lastC = null;
    switch (op.toUpperCase()) {
      case 'M':
        x = ox + n();
        y = oy + n();
        sx = x;
        sy = y;
        out.push({ op: 'M', x, y });
        op = rel ? 'l' : 'L'; // a további párok vonalak
        break;
      case 'L':
        x = ox + n();
        y = oy + n();
        out.push({ op: 'L', x, y });
        break;
      case 'H':
        x = ox + n();
        out.push({ op: 'L', x, y });
        break;
      case 'V':
        y = oy + n();
        out.push({ op: 'L', x, y });
        break;
      case 'C': {
        const c = { x1: ox + n(), y1: oy + n(), x2: ox + n(), y2: oy + n(), x: ox + n(), y: oy + n() };
        out.push({ op: 'C', ...c });
        x = c.x;
        y = c.y;
        lastC = { x: c.x2, y: c.y2 };
        break;
      }
      case 'S': {
        // az első kontrollpont az előző görbe második kontrollpontjának tükörképe
        const x1: number = prevC ? 2 * x - prevC.x : x;
        const y1: number = prevC ? 2 * y - prevC.y : y;
        const c = { x1, y1, x2: ox + n(), y2: oy + n(), x: ox + n(), y: oy + n() };
        out.push({ op: 'C', ...c });
        x = c.x;
        y = c.y;
        lastC = { x: c.x2, y: c.y2 };
        break;
      }
      case 'A': {
        const [rx, ry, rot, large, sweep] = [n(), n(), n(), n(), n()];
        const ex = ox + n();
        const ey = oy + n();
        out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey));
        x = ex;
        y = ey;
        break;
      }
      case 'Z':
        out.push({ op: 'Z' });
        x = sx;
        y = sy;
        break;
      default:
        throw new Error(`ismeretlen SVG-parancs: ${op} (${d})`);
    }
  }
  return out;
}

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function swiftPath(cmds: Cmd[]): string[] {
  return cmds.map((c) => {
    switch (c.op) {
      case 'M':
        return `p.move(to: CGPoint(x: ${f(c.x)}, y: ${f(c.y)}))`;
      case 'L':
        return `p.addLine(to: CGPoint(x: ${f(c.x)}, y: ${f(c.y)}))`;
      case 'C':
        return `p.addCurve(to: CGPoint(x: ${f(c.x)}, y: ${f(c.y)}), control1: CGPoint(x: ${f(c.x1)}, y: ${f(c.y1)}), control2: CGPoint(x: ${f(c.x2)}, y: ${f(c.y2)}))`;
      case 'Z':
        return 'p.closeSubpath()';
    }
  });
}

/** Az ikonok Swift-forrása: `IconName` + 24 × 24-es `Path`. */
export function iconsSwift(paths: Record<string, readonly string[]>, filled: readonly string[]): string {
  const names = Object.keys(paths);
  const L = [
    '// GENERÁLT FÁJL – kézzel ne szerkeszd.',
    '// Forrás: apps/web/src/ui/Icon.tsx (PATHS); újragenerálás: npm run generate -w @atlagsebesseg/ios',
    '',
    'import SwiftUI',
    '',
    '/// A web 24 × 24-es vonalikonjai (stroke 2, kerek végek).',
    'enum IconName: String, CaseIterable, Sendable {',
    ...names.map((n) => `    case ${n}`),
    '}',
    '',
    'extension IconName {',
    '    /// Kitöltött (nem vonal) ikon.',
    `    var filled: Bool { ${filled.length ? filled.map((n) => `self == .${n}`).join(' || ') : 'false'} }`,
    '',
    '    /// Az ikon útvonala a 24 × 24-es nézetben.',
    '    var path: Path {',
    '        var p = Path()',
    '        switch self {',
  ];
  for (const n of names) {
    L.push(`        case .${n}:`);
    for (const d of paths[n]!) for (const line of swiftPath(parsePath(d))) L.push(`            ${line}`);
  }
  L.push('        }', '        return p', '    }', '}', '');
  return L.join('\n');
}

/** A navigáció manőver-ikonjai (a webes ManeuverIcon.tsx `MANEUVER_PATHS`-e): `extension ManeuverIcon { var path }`. */
export function maneuverIconsSwift(paths: Record<string, readonly string[]>): string {
  const L = [
    '// GENERÁLT FÁJL – kézzel ne szerkeszd.',
    '// Forrás: apps/web/src/ui/ManeuverIcon.tsx (MANEUVER_PATHS); újragenerálás: npm run generate -w @atlagsebesseg/ios',
    '',
    'import SwiftUI',
    '',
    '/// A manőver-ikonok vonalrajzai (24 × 24, az autó lentről halad felfelé; stroke 2,2, kerek végek).',
    'extension ManeuverIcon {',
    '    var path: Path {',
    '        var p = Path()',
    '        switch self {',
  ];
  for (const n of Object.keys(paths)) {
    L.push(`        case .${n}:`);
    for (const d of paths[n]!) for (const line of swiftPath(parsePath(d))) L.push(`            ${line}`);
  }
  L.push('        }', '        return p', '    }', '}', '');
  return L.join('\n');
}
