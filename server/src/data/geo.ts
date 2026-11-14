const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Metres per degree of latitude (and of longitude at the equator). */
export const METERS_PER_DEGREE = EARTH_RADIUS_M * RAD;
