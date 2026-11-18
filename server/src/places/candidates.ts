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
import { checkWish, type WishFit } from "./wishCheck.js";
import { adjustedRating } from "./rating.js";

export interface Candidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Google's rating as shown to the user. */
  rating: number | null;
  ratingCount: number | null;
  address: string | null;
  source: "google" | "osm" | "both";
  google: GooglePlace | null;
  osmTags: Record<string, string> | null;
  /** How the place fits the item's wish; null when the item has no wish. */
  wish: WishFit | null;
}

export interface ItemCandidates {
  candidates: Candidate[];
  /** OSM places of this item's kinds in the whole city; null when the item has no OSM kind. */
  cityCount: number | null;
  /**
   * none: no wish; confirmed: places that fit were found and only those are used;
   * unconfirmed: no place could be confirmed, places that may fit are used;
   * no_match: every place found clearly does not fit.
   */
  wishStatus: "none" | "confirmed" | "unconfirmed" | "no_match";
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

/** The person's own phrase for this Google type when one fits, otherwise the type's name. */
export function googleText(item: Item, type: string): string {
  const typeName = type.replace(/_/g, " ").toLowerCase();
  const phrase =
    item.search.find((s) => s.toLowerCase().includes(typeName) || typeName.includes(s.toLowerCase())) ?? typeName;
  return [item.details, phrase].filter((s) => s.trim()).join(" ");
}

/** Some candidates closest to the route, some best-rated within reach. */
export function choosePool(all: Candidate[], detour: (p: Point) => number): Candidate[] {
  const total = PARAMS.candidatesPerItem.value;
  const byRating = Math.min(PARAMS.candidatesByRating.value, total);
  const near = [...all].sort((a, b) => detour(a) - detour(b));
  const picked = new Set(near.slice(0, total - byRating));
  // Best-rated by the adjusted rating, so a 5-star place with one review does not outrank a well-proven one.
  const adj = (c: Candidate) => adjustedRating(c.rating, c.ratingCount);
  const rated = all.filter((c) => c.rating != null && !picked.has(c)).sort((a, b) => adj(b) - adj(a) || detour(a) - detour(b));
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
      const hasWish = item.details.trim().length > 0;
      const googleLists = await Promise.all(item.googleTypes.map((t) => searchPlaces(t, googleText(item, t), box, hasWish)));
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
        out.push({
          id: g.id, name: g.name, lat: g.lat, lng: g.lng, rating: g.rating, ratingCount: g.ratingCount, address: g.address,
          source: twin ? "both" : "google", google: g, osmTags: twin?.tags ?? null, wish: null,
        });
      }
      for (const o of osm) {
        if (mergedOsm.has(o.id)) continue;
        const label = o.name ?? item.osm.find((k) => Object.entries(k.tags).every(([kk, v]) => v === "*" || o.tags[kk] === v))?.name ?? item.label;
        out.push({ id: o.id, name: label, lat: o.lat, lng: o.lng, rating: null, ratingCount: null, address: null, source: "osm", google: null, osmTags: o.tags, wish: null });
      }

      if (!hasWish || out.length === 0) return { candidates: choosePool(out, detour), cityCount, wishStatus: "none" as const };

      // Check the places closest to the route against the wish.
      const nearest = [...out].sort((a, b) => detour(a) - detour(b)).slice(0, PARAMS.wishCheckMaxCandidates.value);
      const fits = await checkWish(
        item.phrase,
        nearest.map((c) => ({
          id: c.id,
          name: c.name,
          googleTypes: c.google?.types ?? [],
          summary: c.google?.summary ?? null,
          osmTags: c.osmTags,
        })),
      );
      for (const c of nearest) c.wish = fits.get(c.id) ?? "unknown";
      const yes = nearest.filter((c) => c.wish === "yes");
      const maybe = nearest.filter((c) => c.wish === "unknown");
      if (yes.length) return { candidates: choosePool(yes, detour), cityCount, wishStatus: "confirmed" as const };
      if (maybe.length) return { candidates: choosePool(maybe, detour), cityCount, wishStatus: "unconfirmed" as const };
      return { candidates: [], cityCount, wishStatus: "no_match" as const };
    }),
  );
}
