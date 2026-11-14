/**
 * One request from start to finish:
 * find start and end → find candidate places → walking minutes between all
 * points → choose stops (planner.ts) → route each leg with the street
 * preferences → coverage and explanations.
 */
import type { CityData } from "../data/cityTypes.js";
import { PARAMS, metersPerMinute } from "../params.js";
import { findCandidates, type Candidate } from "../places/candidates.js";
import { findLocation, openFor } from "../places/google.js";
import {
  costModel,
  coverage,
  hasSoftPreference,
  haversineMeters,
  pathPoints,
  shortestTree,
  walkLeg,
  type Coverage,
  type LatLng,
  type Path,
} from "../routing/router.js";
import type { Item, StreetPreference } from "../types.js";
import { plan, type PlanCandidate, type SkipReason } from "./planner.js";
import { minimumStay } from "./stays.js";

export type LocationInput = { text: string } | { lat: number; lng: number; label?: string };

export interface PlanRequest {
  origin: LocationInput;
  destination: LocationInput;
  budgetMinutes: number | null;
  departAt?: string;
  items: Item[];
  street: StreetPreference[];
}

export class UserError extends Error {}

interface Place {
  name: string;
  lat: number;
  lng: number;
}

interface Snapped {
  node: number;
  /** Straight walk from the point to its street node. */
  snapMeters: number;
}

const minutesFor = (meters: number) => meters / metersPerMinute();

async function resolve(city: CityData, input: LocationInput, what: string): Promise<Place> {
  if ("text" in input) {
    const text = input.text?.trim();
    if (!text) throw new UserError(`The ${what} is empty.`);
    const found = await findLocation(text, city.config.bbox);
    if (!found) throw new UserError(`Could not find "${text}".`);
    return { name: found.name, lat: found.lat, lng: found.lng };
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) throw new UserError(`The ${what} has no valid coordinates.`);
  return { name: input.label ?? "Selected point", lat: input.lat, lng: input.lng };
}

function snap(city: CityData, p: { lat: number; lng: number }): Snapped | null {
  const node = city.graph.nearestNode(p.lat, p.lng, PARAMS.snapMaxMeters.value);
  if (node < 0) return null;
  return { node, snapMeters: haversineMeters(p, { lat: city.graph.lat[node], lng: city.graph.lng[node] }) };
}

function skipMessage(reason: SkipReason | "unreachable", label: string): string {
  const l = label.toLowerCase();
  switch (reason) {
    case "no_candidates":
      return `No ${l} found near your route.`;
    case "unreachable":
      return `The ${l} places found cannot be reached on foot using the street map.`;
    case "over_budget":
      return `A ${l} does not fit in your time.`;
    case "optional_too_far":
      return `Skipped the ${l}: every option adds more than ${PARAMS.optionalMaxDetourMinutes.value} minutes of walking.`;
    case "closed":
      return `Every ${l} found is closed when you would get there.`;
  }
}

export async function planWalk(city: CityData, req: PlanRequest) {
  const budget = req.budgetMinutes != null && req.budgetMinutes > 0 ? Math.min(req.budgetMinutes, PARAMS.maxBudgetMinutes.value) : null;
  const startMs = req.departAt ? Date.parse(req.departAt) : Date.now();
  if (!Number.isFinite(startMs)) throw new UserError("departAt is not a valid date.");

  const [origin, dest] = await Promise.all([resolve(city, req.origin, "start"), resolve(city, req.destination, "end")]);
  const so = snap(city, origin), sd = snap(city, dest);
  if (!so) throw new UserError(`"${origin.name}" is outside this city's walking map.`);
  if (!sd) throw new UserError(`"${dest.name}" is outside this city's walking map.`);

  const found = await findCandidates(city, req.items, origin, dest, budget);

  // Points: 0 = start, 1 = end, then reachable candidates.
  const snaps: Snapped[] = [so, sd];
  const pointPlace: Array<Candidate | null> = [null, null];
  const unreachableItems = new Set<number>();
  const planCands: PlanCandidate[][] = found.map((f, i) => {
    const list: PlanCandidate[] = [];
    for (const c of f.candidates) {
      const s = snap(city, c);
      if (!s) continue;
      snaps.push(s);
      pointPlace.push(c);
      const g = c.google;
      list.push({
        point: snaps.length - 1,
        rating: c.rating,
        isOpen: g ? (arrive, stay) => openFor(g, startMs, arrive, stay) : undefined,
      });
    }
    if (f.candidates.length > 0 && list.length === 0) unreachableItems.add(i);
    return list;
  });

  // Walking minutes between all points, using only the hard street requirements.
  const graph = city.graph;
  const hard = costModel(graph, req.street, 1);
  const soft = hasSoftPreference(req.street);
  const reserve = soft ? 1 + PARAMS.preferenceMaxExtraPercent.value / 100 : 1;
  const nodes = snaps.map((s) => s.node);
  const minutes = snaps.map((from, a) => {
    const tree = shortestTree(graph, hard, from.node, nodes);
    return snaps.map((to, b) => {
      if (a === b) return 0;
      const m = tree.meters[to.node];
      return Number.isFinite(m) ? minutesFor(m * reserve + from.snapMeters + to.snapMeters) : Infinity;
    });
  });
  if (!Number.isFinite(minutes[0][1])) throw new UserError("There is no walking connection between the start and the end with these street requirements.");

  const result = plan({
    items: req.items.map((it) => ({
      required: it.required,
      order: it.order,
      count: Math.max(1, Math.min(PARAMS.maxCountPerItem.value, Math.round(it.count))),
      stay: { preferred: it.stayMinutes, min: minimumStay(it.stayMinutes, it.stayFixed) },
    })),
    candidates: planCands,
    minutes,
    budgetMinutes: budget,
  });

  // Route each leg with the street preferences.
  const seq = [0, ...result.stops.map((s) => s.point), 1];
  const paths: Path[] = [];
  const legs: Array<{ points: LatLng[]; meters: number; minutes: number }> = [];
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = snaps[seq[k]], b = snaps[seq[k + 1]];
    const leg = walkLeg(graph, req.street, a.node, b.node, hard);
    if (!leg) throw new Error("A planned leg has no route");
    paths.push(leg.path);
    const meters = leg.path.meters + a.snapMeters + b.snapMeters;
    const from = k === 0 ? origin : pointPlace[seq[k]]!;
    const to = k + 2 === seq.length ? dest : pointPlace[seq[k + 1]]!;
    const points: LatLng[] = [[from.lat, from.lng], ...pathPoints(graph, leg.path), [to.lat, to.lng]];
    legs.push({ points, meters: Math.round(meters), minutes: Math.round(minutesFor(meters)) });
  }

  // The plan reserved extra walking for street preferences; give unused minutes back to shortened stays.
  const realWalk = legs.reduce((sum, l) => sum + minutesFor(l.meters), 0);
  if (budget != null) {
    let spare = budget - realWalk - result.stops.reduce((sum, s) => sum + s.stayMinutes, 0);
    for (const s of result.stops) {
      const add = Math.max(0, Math.min(Math.floor(spare), req.items[s.itemIndex].stayMinutes - s.stayMinutes));
      s.stayMinutes += add;
      spare -= add;
    }
  }
  const staysShortened = result.stops.some((s) => s.stayMinutes < req.items[s.itemIndex].stayMinutes);

  let clock = 0;
  const stops = result.stops.map((s, k) => {
    clock += minutesFor(legs[k].meters);
    const c = pointPlace[s.point]!;
    const item = req.items[s.itemIndex];
    const stop = {
      itemId: item.id,
      label: item.label,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      source: c.source,
      rating: c.rating,
      address: c.address,
      stayMinutes: s.stayMinutes,
      arriveMinute: Math.round(clock),
    };
    clock += s.stayMinutes;
    return stop;
  });

  const walkMinutes = Math.round(legs.reduce((sum, l) => sum + minutesFor(l.meters), 0));
  const stayMinutes = stops.reduce((sum, s) => sum + s.stayMinutes, 0);
  const plainTree = shortestTree(graph, costModel(graph, [], 1), so.node, [sd.node]);
  const shortestWalkMinutes = Math.round(minutesFor(plainTree.meters[sd.node] + so.snapMeters + sd.snapMeters));

  const skipped = result.missing.map((m) => {
    const item = req.items[m.itemIndex];
    const reason = unreachableItems.has(m.itemIndex) ? "unreachable" : m.reason;
    return {
      itemId: item.id,
      label: item.label,
      reason,
      message: skipMessage(reason, item.label) + (m.missing < item.count ? ` (${item.count - m.missing} of ${item.count} found)` : ""),
      cityCount: found[m.itemIndex].cityCount,
    };
  });

  const notices: string[] = [];
  if (result.approximate) notices.push("This request has many stops; the plan is good but may not be the best possible.");

  const cov: Coverage[] = coverage(graph, req.street, paths);
  return {
    origin,
    destination: dest,
    stops,
    legs,
    totals: {
      walkMinutes,
      stayMinutes,
      totalMinutes: walkMinutes + stayMinutes,
      budgetMinutes: budget,
      withinBudget: budget == null || walkMinutes + stayMinutes <= budget,
      staysShortened,
      shortestWalkMinutes,
    },
    coverage: cov,
    skipped,
    notices,
  };
}
