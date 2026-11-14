/**
 * Candidate places for each item, from the city's OSM places and from Google.
 *
 * Only places in the area the walk could reach are considered: going
 * start → place → end in a straight line must not be longer than the walk
 * could be (from the time budget, or the start–end distance plus a slack).
 * The same place found in both sources is merged.
 */
import type { BBox, CityData, OsmPlace } from "../data/cityTypes.js";
import { PARAMS, metersPerMinute } from "../params.js";
import { haversineMeters } from "../routing/router.js";
import type { Item } from "../types.js";
import { searchPlaces, type GooglePlace } from "./google.js";

export interface Candidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  address: string | null;
  source: "google" | "osm" | "both";
  google: GooglePlace | null;
}

export interface ItemCandidates {
  candidates: Candidate[];
  /** OSM places of this item's kinds in the whole city; null when the item has no OSM kind. */
  cityCount: number | null;
}

interface Point {
  lat: number;
  lng: number;
}

export function reachLimitMeters(origin: Point, dest: Point, budgetMinutes: number | null): number {
  const direct = haversineMeters(origin, dest);
  if (budgetMinutes != null) return Math.max(direct, budgetMinutes * metersPerMinute());
  return direct + PARAMS.searchSlackMeters.value;
}

/** Bounding box of the ellipse start → place → end ≤ limit (generous, for the Google search). */
function areaBox(origin: Point, dest: Point, limit: number): BBox {
  const pad = limit / 2;
  const dLat = pad / 111_320;
  const midLat = (origin.lat + dest.lat) / 2;
  const dLng = pad / (111_320 * Math.cos((midLat * Math.PI) / 180));
  const mid = { lat: midLat, lng: (origin.lng + dest.lng) / 2 };
  return { south: mid.lat - dLat, north: mid.lat + dLat, west: mid.lng - dLng, east: mid.lng + dLng };
}

function normName(s: string | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarNames(a: string | null, b: string | null): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" "));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

/** Some candidates closest to the route, some best-rated within reach. */
export function choosePool(all: Candidate[], detour: (p: Point) => number): Candidate[] {
  const total = PARAMS.candidatesPerItem.value;
  const byRating = Math.min(PARAMS.candidatesByRating.value, total);
  const near = [...all].sort((a, b) => detour(a) - detour(b));
  const picked = new Set(near.slice(0, total - byRating));
  const rated = all.filter((c) => c.rating != null && !picked.has(c)).sort((a, b) => b.rating! - a.rating! || detour(a) - detour(b));
  for (const c of rated.slice(0, byRating)) picked.add(c);
  for (const c of near) {
    if (picked.size >= total) break;
    picked.add(c);
  }
  return [...picked];
}

export async function findCandidates(
  city: CityData,
  items: Item[],
  origin: Point,
  dest: Point,
  budgetMinutes: number | null,
): Promise<ItemCandidates[]> {
  const limit = reachLimitMeters(origin, dest, budgetMinutes);
  const box = areaBox(origin, dest, limit);
  const reachable = (p: Point) => haversineMeters(origin, p) + haversineMeters(p, dest) <= limit;
  const detour = (p: Point) => haversineMeters(origin, p) + haversineMeters(p, dest);

  return Promise.all(
    items.map(async (item) => {
      // OSM
      const osmAll = new Map<string, OsmPlace>();
      for (const kind of item.osm) for (const p of city.placesMatching(kind.tags)) osmAll.set(p.id, p);
      const cityCount = item.osm.length ? osmAll.size : null;
      const osm = [...osmAll.values()].filter(reachable);

      // Google
      const googleLists = await Promise.all(item.googleTypes.map((t) => searchPlaces(t, item.details, box)));
      const google = new Map<string, GooglePlace>();
      for (const list of googleLists) for (const g of list) if (reachable(g)) google.set(g.id, g);

      // Merge: a Google place and an OSM place close together with similar names are one place.
      const out: Candidate[] = [];
      const mergedOsm = new Set<string>();
      for (const g of google.values()) {
        const twin = osm.find(
          (o) => !mergedOsm.has(o.id) && haversineMeters(o, g) <= PARAMS.mergeDistanceMeters.value && similarNames(o.name, g.name),
        );
        if (twin) mergedOsm.add(twin.id);
        out.push({ id: g.id, name: g.name, lat: g.lat, lng: g.lng, rating: g.rating, address: g.address, source: twin ? "both" : "google", google: g });
      }
      for (const o of osm) {
        if (mergedOsm.has(o.id)) continue;
        const label = o.name ?? item.osm.find((k) => Object.entries(k.tags).every(([kk, v]) => v === "*" || o.tags[kk] === v))?.name ?? item.label;
        out.push({ id: o.id, name: label, lat: o.lat, lng: o.lng, rating: null, address: null, source: "osm", google: null });
      }

      return { candidates: choosePool(out, detour), cityCount };
    }),
  );
}
