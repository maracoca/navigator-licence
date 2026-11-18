/**
 * Planner-study problems built by the app's own code (preparePlan in planWalk.ts): OSM + Google candidates,
 * merged and shortlisted like a real request, Google ratings and opening hours (checked at the departure time),
 * real street walking times. Google answers are saved by the API cache, so later runs repeat exactly and cost nothing.
 */
import type { CityData } from "../../data/cityTypes.js";
import { metersPerMinute, PARAMS } from "../../params.js";
import { preparePlan } from "../../planning/planWalk.js";
import { haversineMeters } from "../../routing/router.js";
import type { Item } from "../../types.js";
import { KINDS, rng, type StoredProblem } from "./problems.js";

/** The Google type the app would pick for each kind (the vocabulary match for these plain kinds). */
const GOOGLE_TYPES: Record<string, string[]> = {
  cafe: ["cafe"],
  pharmacy: ["pharmacy"],
  bakery: ["bakery"],
  supermarket: ["supermarket"],
  convenience: ["convenience_store"],
  atm: ["atm"],
  bank: ["bank"],
  restaurant: ["restaurant"],
  fast_food: ["fast_food_restaurant"],
  bench: [],
  florist: ["florist"],
  books: ["book_store"],
  ice_cream: ["ice_cream_shop"],
  place_of_worship: ["church"],
  post_office: ["post_office"],
  park: ["park"],
};

export interface AppProblemOptions {
  seed: number;
  /** Fixed start/end pairs; Google is searched once per pair and kind of place. */
  pairs: number;
  /** Problems per pair, each a different request and departure time on the same pair. */
  perPair: number;
  maxStops: number;
  /** Upper limit on the Google searches the problems may need (each pair × Google type counts once). */
  maxGoogleSearches: number;
  area: { south: number; west: number; north: number; east: number };
  /** Departure times (local, with offset) to choose from. */
  departures: string[];
}

type Kind = (typeof KINDS)[number];

export async function appProblems(
  city: CityData,
  opts: AppProblemOptions,
): Promise<{ problems: StoredProblem[]; googleSearchesPlanned: number; skipped: number }> {
  const r = rng(opts.seed);
  const mpm = metersPerMinute();
  const g = city.graph;
  const pools = KINDS.filter((k) => city.placesMatching(k.tags).length >= 3);
  const randomPoint = () => ({
    lat: opts.area.south + r() * (opts.area.north - opts.area.south),
    lng: opts.area.west + r() * (opts.area.east - opts.area.west),
  });

  // Fixed pairs, each with one budget: the budget decides the app's search area, so it stays fixed per pair.
  const pairs: Array<{ a: { lat: number; lng: number }; b: { lat: number; lng: number }; budget: number | null }> = [];
  while (pairs.length < opts.pairs) {
    const a = randomPoint(), b = randomPoint();
    const straight = haversineMeters(a, b) / mpm;
    if (straight < 8 || straight > 35) continue;
    if (g.nearestNode(a.lat, a.lng, PARAMS.snapMaxMeters.value) < 0 || g.nearestNode(b.lat, b.lng, PARAMS.snapMaxMeters.value) < 0) continue;
    const budget = r() < 0.15 ? null : Math.round(straight * 1.3 + 40 + r() * 80);
    pairs.push({ a, b, budget });
  }

  // Requests per pair; count the Google searches they need before making any.
  const plans: Array<{ pair: number; kinds: Kind[]; items: Item[]; departAt: string }> = [];
  const searches = new Set<string>();
  pairs.forEach((_, pi) => {
    for (let k = 0; k < opts.perPair; k++) {
      const size = 1 + Math.floor(r() * opts.maxStops);
      const kinds = [...pools].sort(() => r() - 0.5);
      const ordered = r() < 0.25;
      const items: Item[] = [];
      const used: Kind[] = [];
      let slots = 0;
      for (const kd of kinds) {
        if (slots >= size) break;
        const count = slots + 2 <= size && r() < 0.1 ? 2 : 1;
        const fixed = r() < 0.3;
        items.push({
          id: `i${items.length + 1}`,
          phrase: kd.kind,
          label: kd.kind,
          search: [kd.kind.replace(/_/g, " ")],
          details: "",
          osm: [{ presetId: Object.entries(kd.tags).map(([key, v]) => `${key}/${v}`).join("/"), name: kd.kind, tags: kd.tags }],
          googleTypes: GOOGLE_TYPES[kd.kind] ?? [],
          required: r() >= 0.25,
          order: ordered ? items.length + 1 : null,
          count,
          pace: fixed ? "quick" : "normal",
          stayMinutes: kd.stay,
          stayFixed: fixed,
        });
        used.push(kd);
        slots += count;
      }
      for (const kd of used) for (const t of GOOGLE_TYPES[kd.kind] ?? []) searches.add(`${pi}:${t}`);
      plans.push({ pair: pi, kinds: used, items, departAt: opts.departures[Math.floor(r() * opts.departures.length)] });
    }
  });
  if (searches.size > opts.maxGoogleSearches) {
    throw new Error(`These problems would need ${searches.size} Google searches (limit ${opts.maxGoogleSearches}). Use fewer pairs or problems.`);
  }

  const problems: StoredProblem[] = [];
  let skipped = 0;
  for (const [n, pl] of plans.entries()) {
    const pair = pairs[pl.pair];
    let prep: Awaited<ReturnType<typeof preparePlan>>;
    try {
      prep = await preparePlan(city, {
        origin: { lat: pair.a.lat, lng: pair.a.lng, label: "start" },
        destination: { lat: pair.b.lat, lng: pair.b.lng, label: "end" },
        budgetMinutes: pair.budget,
        departAt: pl.departAt,
        items: pl.items,
        street: [],
      });
    } catch {
      skipped++;
      continue;
    }
    const { input, found, pointPlace, startMs } = prep;
    const candidates: StoredProblem["candidates"] = input.candidates.map((cs) =>
      cs.map((c) => {
        const place = pointPlace[c.point]!;
        const gp = place.google;
        return {
          point: c.point,
          rating: c.rating,
          window: null,
          name: place.name,
          source: place.source,
          hours: gp?.periods && gp.utcOffsetMinutes != null ? { periods: gp.periods, utcOffsetMinutes: gp.utcOffsetMinutes } : null,
        };
      }),
    );
    problems.push({
      id: `app-${pl.pair}-${n}`,
      slots: pl.items.reduce((s, it) => s + it.count, 0),
      items: input.items.map((it, i) => ({ ...it, kind: pl.kinds[i].kind })),
      candidates,
      minutes: input.minutes,
      budgetMinutes: input.budgetMinutes,
      departMs: startMs,
      about: {
        start: pair.a,
        end: pair.b,
        departAt: pl.departAt,
        kinds: pl.kinds.map((k) => k.kind),
        candidatesFound: found.map((f) => f.candidates.length),
      },
    });
  }
  return { problems, googleSearchesPlanned: searches.size, skipped };
}
