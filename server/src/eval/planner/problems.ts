/**
 * Test problems for the planner study.
 *
 *  - synthetic: small random problems with straight-line walking times, generated from a seed (fully reproducible);
 *    used to check every planner against brute force.
 *  - city: realistic problems on the city's real places and street walking times (Dijkstra on the street graph);
 *    saved to a file, because they depend on the map data.
 */
import type { CityData, OsmPlace } from "../../data/cityTypes.js";
import { metersPerMinute, PARAMS } from "../../params.js";
import type { PlanInput } from "../../planning/planner.js";
import { costModel, haversineMeters, shortestTree } from "../../routing/router.js";

/** Small, fast, seedable random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A problem that can be written to JSON (opening hours as plain windows, not functions). */
export interface StoredProblem {
  id: string;
  /** Requested stops (counting "two of" as two). */
  slots: number;
  items: Array<PlanInput["items"][number] & { kind: string }>;
  candidates: Array<Array<{ point: number; rating: number | null; window: [number, number] | null; name?: string }>>;
  minutes: number[][];
  budgetMinutes: number | null;
}

export function toPlanInput(p: StoredProblem): PlanInput {
  return {
    items: p.items.map(({ kind: _kind, ...it }) => it),
    candidates: p.candidates.map((cs) =>
      cs.map((c) => ({
        point: c.point,
        rating: c.rating,
        isOpen: c.window ? (arrive: number, stay: number) => arrive >= c.window![0] && arrive + stay <= c.window![1] : undefined,
      })),
    ),
    minutes: p.minutes,
    budgetMinutes: p.budgetMinutes,
  };
}

// ─── Synthetic small problems ───────────────────────────────────────────────

export function syntheticProblems(seed: number, count: number): StoredProblem[] {
  const r = rng(seed);
  const out: StoredProblem[] = [];
  for (let k = 0; k < count; k++) {
    const nItems = 1 + Math.floor(r() * 3);
    const pts: Array<[number, number]> = [[0, 0], [10 + r() * 20, r() * 10 - 5]];
    const ordered = r() < 0.3;
    const items = Array.from({ length: nItems }, (_, i) => {
      const preferred = 5 + Math.floor(r() * 6) * 5;
      return {
        kind: `item${i}`,
        required: r() < 0.7,
        order: ordered ? i + 1 : null,
        count: r() < 0.15 ? 2 : 1,
        stay: { preferred, min: r() < 0.5 ? preferred : Math.max(5, preferred / 2) },
      };
    });
    const candidates = items.map(() =>
      Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
        pts.push([r() * 30 - 5, r() * 20 - 10]);
        const window: [number, number] | null = r() < 0.2 ? [r() * 30, 0] : null;
        if (window) window[1] = window[0] + 20 + r() * 30;
        return { point: pts.length - 1, rating: r() < 0.5 ? Math.round((3 + r() * 2) * 10) / 10 : null, window };
      }),
    );
    const minutes = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
    const budgetMinutes = r() < 0.2 ? null : minutes[0][1] + r() * 80;
    out.push({ id: `syn-${k}`, slots: items.reduce((s, it) => s + it.count, 0), items, candidates, minutes, budgetMinutes });
  }
  return out;
}

// ─── Realistic problems on the city's map ───────────────────────────────────

/** Common kinds of place, with the typical stay class used by the app (stays.ts). */
const KINDS: Array<{ kind: string; tags: Record<string, string>; stay: number }> = [
  { kind: "cafe", tags: { amenity: "cafe" }, stay: PARAMS.stayMediumMinutes.value },
  { kind: "pharmacy", tags: { amenity: "pharmacy" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "bakery", tags: { shop: "bakery" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "supermarket", tags: { shop: "supermarket" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "convenience", tags: { shop: "convenience" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "atm", tags: { amenity: "atm" }, stay: PARAMS.stayBriefMinutes.value },
  { kind: "bank", tags: { amenity: "bank" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "restaurant", tags: { amenity: "restaurant" }, stay: PARAMS.stayLongMinutes.value },
  { kind: "fast_food", tags: { amenity: "fast_food" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "bench", tags: { amenity: "bench" }, stay: PARAMS.stayBriefMinutes.value },
  { kind: "florist", tags: { shop: "florist" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "books", tags: { shop: "books" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "ice_cream", tags: { amenity: "ice_cream" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "place_of_worship", tags: { amenity: "place_of_worship" }, stay: PARAMS.stayMediumMinutes.value },
  { kind: "post_office", tags: { amenity: "post_office" }, stay: PARAMS.stayShortMinutes.value },
  { kind: "park", tags: { leisure: "park" }, stay: PARAMS.stayMediumMinutes.value },
];

export interface CityProblemOptions {
  seed: number;
  /** Number of problems per number of requested stops. */
  perSize: Record<number, number>;
  candidatesPerItem: number;
  /** Area where starts and ends are drawn. */
  area: { south: number; west: number; north: number; east: number };
}

export function cityProblems(city: CityData, opts: CityProblemOptions): StoredProblem[] {
  const r = rng(opts.seed);
  const g = city.graph;
  const plain = costModel(g, [], 1);
  const mpm = metersPerMinute();
  const pools = KINDS.map((k) => ({ ...k, places: city.placesMatching(k.tags) })).filter((k) => k.places.length >= opts.candidatesPerItem);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const randomPoint = () => ({
    lat: opts.area.south + r() * (opts.area.north - opts.area.south),
    lng: opts.area.west + r() * (opts.area.east - opts.area.west),
  });

  const out: StoredProblem[] = [];
  for (const [sizeText, howMany] of Object.entries(opts.perSize)) {
    const size = Number(sizeText);
    let made = 0, attempts = 0;
    while (made < howMany && attempts++ < howMany * 50) {
      // Start and end: 10–45 minutes' walk apart in a straight line.
      const a = randomPoint(), b = randomPoint();
      const straight = haversineMeters(a, b) / mpm;
      if (straight < 10 || straight > 45) continue;
      const na = g.nearestNode(a.lat, a.lng, PARAMS.snapMaxMeters.value);
      const nb = g.nearestNode(b.lat, b.lng, PARAMS.snapMaxMeters.value);
      if (na < 0 || nb < 0 || na === nb) continue;

      // Items: distinct kinds; sometimes "two of", sometimes optional, sometimes in an order.
      const kinds = [...pools].sort(() => r() - 0.5);
      const items: StoredProblem["items"] = [];
      let slots = 0;
      const ordered = r() < 0.25;
      for (const k of kinds) {
        if (slots >= size) break;
        const count = slots + 2 <= size && r() < 0.1 ? 2 : 1;
        const fixed = r() < 0.3;
        items.push({
          kind: k.kind,
          required: r() >= 0.25,
          order: ordered ? items.length + 1 : null,
          count,
          stay: { preferred: k.stay, min: fixed ? k.stay : Math.max(PARAMS.stayStepMinutes.value, Math.round(k.stay / 2)) },
        });
        slots += count;
      }
      if (slots !== size) continue;

      // Candidates: like the app's shortlist, the places closest to the straight line start → end.
      const detour = (p: OsmPlace) => haversineMeters(a, p) + haversineMeters(p, b);
      const points: Array<{ node: number; snap: number }> = [
        { node: na, snap: haversineMeters(a, { lat: g.lat[na], lng: g.lng[na] }) },
        { node: nb, snap: haversineMeters(b, { lat: g.lat[nb], lng: g.lng[nb] }) },
      ];
      const candidates: StoredProblem["candidates"] = [];
      let ok = true;
      for (const it of items) {
        const pool = pools.find((k) => k.kind === it.kind)!;
        const near = [...pool.places].sort((x, y) => detour(x) - detour(y));
        const cs: StoredProblem["candidates"][number] = [];
        for (const p of near) {
          if (cs.length >= opts.candidatesPerItem) break;
          const n = g.nearestNode(p.lat, p.lng, PARAMS.snapMaxMeters.value);
          if (n < 0 || points.some((q) => q.node === n)) continue;
          points.push({ node: n, snap: haversineMeters(p, { lat: g.lat[n], lng: g.lng[n] }) });
          cs.push({ point: points.length - 1, rating: null, window: null, name: p.name ?? undefined });
        }
        if (cs.length === 0) ok = false;
        candidates.push(cs);
      }
      if (!ok) continue;

      // Real walking minutes between all points (shortest street walk + walk to the street).
      const nodes = points.map((p) => p.node);
      const minutes = points.map((from) => {
        const tree = shortestTree(g, plain, from.node, nodes);
        return points.map((to) => (from === to ? 0 : Math.round(((tree.meters[to.node] + from.snap + to.snap) / mpm) * 100) / 100));
      });
      if (!Number.isFinite(minutes[0][1])) continue;

      // Budget: none (15 %), or the direct walk + the minimum stays + 0–40 min of slack, so some are tight.
      const minStays = items.reduce((s, it) => s + it.stay.min * it.count, 0);
      const budgetMinutes = r() < 0.15 ? null : Math.round(minutes[0][1] + minStays + r() * 40);

      out.push({ id: `city-${size}-${made}`, slots: size, items, candidates, minutes, budgetMinutes });
      made++;
    }
  }
  return out;
}
