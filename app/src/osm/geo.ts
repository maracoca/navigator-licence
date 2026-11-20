/** Small geometry helpers for following the walk by GPS. */

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

export interface Pt {
  lat: number;
  lng: number;
}

/** Distance in metres between two points (equirectangular; exact enough within a city). */
export function meters(a: Pt, b: Pt): number {
  const x = (b.lng - a.lng) * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(x, y);
}

/** Shortest distance in metres from p to a line given as [lat, lng] points. */
export function metersToLine(p: Pt, line: [number, number][]): number {
  const kx = M_PER_DEG * Math.cos(p.lat * RAD);
  const ky = M_PER_DEG;
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    // Work in metres around p.
    const ax = (line[i][1] - p.lng) * kx, ay = (line[i][0] - p.lat) * ky;
    const bx = (line[i + 1][1] - p.lng) * kx, by = (line[i + 1][0] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  if (line.length === 1) best = Math.hypot((line[0][1] - p.lng) * kx, (line[0][0] - p.lat) * ky);
  return best;
}

/**
 * Height of the sun above the horizon in degrees (low-precision formula from the Astronomical Almanac,
 * accurate to about 1 degree, enough to tell day from night).
 */
export function sunAltitude(date: Date, p: Pt): number {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmstHours * 15 + p.lng) * RAD - ra;
  const lat = p.lat * RAD;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** Dark enough that street lights would be on: the sun is below the horizon (incl. refraction). */
export function isDark(date: Date, p: Pt): boolean {
  return sunAltitude(date, p) < -0.833;
}
