/**
 * The rules every planner is judged by, in one place, so the exact planner and
 * the baselines (baselines.ts) are compared fairly:
 *  - each requested stop is a "slot"; a route is an ordered list of (slot, candidate);
 *  - a route is valid when places are distinct, the requested order is kept,
 *    every place is open on arrival (when its hours are known), walking + minimum
 *    stays fit the budget, and every optional stop adds at most
 *    `optionalMaxDetourMinutes` of walking;
 *  - routes are compared by: more required stops, then more optional stops,
 *    then less walking (rating breaks near-ties).
 */
import { PARAMS } from "../params.js";
import type { PlanInput, PlanResult, PlannedStop, SkipReason } from "./planner.js";

export interface Slot {
  item: number;
  /** Which copy of the item (0..count-1); copies are filled in order. */
  copy: number;
  required: boolean;
  order: number | null;
}

export interface RouteStop {
  slot: number;
  cand: number;
}

export interface RouteCheck {
  valid: boolean;
  /** Walking minutes start → stops → end. */
  walk: number;
  /** Walking + minimum stays. */
  time: number;
  /** Lower is better, compared lexicographically. */
  score: number[];
  /** Items whose optional stop broke the detour limit (for skip reasons). */
  detourBroken: number[];
}

/** One slot per requested stop; required first so that cutting keeps them. */
export function buildSlots(input: PlanInput): { slots: Slot[]; truncated: boolean } {
  let slots: Slot[] = [];
  input.items.forEach((it, i) => {
    for (let c = 0; c < it.count; c++) slots.push({ item: i, copy: c, required: it.required, order: it.order });
  });
  slots.sort((a, b) => Number(b.required) - Number(a.required));
  const truncated = slots.length > PARAMS.maxSlots.value;
  if (truncated) slots = slots.slice(0, PARAMS.maxSlots.value);
  return { slots, truncated };
}

export function pointOf(input: PlanInput, slots: Slot[], s: RouteStop): number {
  return input.candidates[slots[s.slot].item][s.cand].point;
}

export function checkRoute(input: PlanInput, slots: Slot[], route: RouteStop[]): RouteCheck {
  const { items, candidates, minutes } = input;
  const budget = input.budgetMinutes ?? Infinity;
  const invalid = (walk = Infinity): RouteCheck => ({ valid: false, walk, time: Infinity, score: [Infinity], detourBroken: [] });

  const seenSlots = new Set<number>();
  const seenPoints = new Set<number>();
  let maxOrder = -Infinity;
  const cost = input.costMinutes ?? minutes;
  let time = 0;
  let walk = 0;
  let felt = 0;
  let here = 0;
  for (const s of route) {
    const slot = slots[s.slot];
    if (seenSlots.has(s.slot)) return invalid();
    seenSlots.add(s.slot);
    const p = pointOf(input, slots, s);
    if (seenPoints.has(p)) return invalid();
    seenPoints.add(p);
    if (slot.order != null) {
      if (slot.order < maxOrder) return invalid();
      maxOrder = slot.order;
    }
    const leg = minutes[here][p];
    if (!Number.isFinite(leg)) return invalid();
    const item = items[slot.item];
    const arrive = time + leg;
    const cand = candidates[slot.item][s.cand];
    if (cand.isOpen && !cand.isOpen(arrive, item.stay.min)) return invalid();
    time = arrive + item.stay.min;
    walk += leg;
    felt += cost[here][p];
    here = p;
  }
  const toEnd = minutes[here][1];
  if (!Number.isFinite(toEnd)) return invalid();
  time += toEnd;
  walk += toEnd;
  felt += cost[here][1];
  if (time > budget + 1e-9) return invalid(walk);

  const pts = [0, ...route.map((s) => pointOf(input, slots, s)), 1];
  const detourBroken: number[] = [];
  route.forEach((s, k) => {
    if (slots[s.slot].required) return;
    const added = minutes[pts[k]][pts[k + 1]] + minutes[pts[k + 1]][pts[k + 2]] - minutes[pts[k]][pts[k + 2]];
    if (added > PARAMS.optionalMaxDetourMinutes.value + 1e-9) detourBroken.push(slots[s.slot].item);
  });
  if (detourBroken.length) return { ...invalid(walk), detourBroken };

  const req = route.filter((s) => slots[s.slot].required).length;
  const rating = route.reduce((sum, s) => sum + (candidates[slots[s.slot].item][s.cand].rating ?? 0), 0);
  // Judged by the walk as it "feels" with street preferences when given, else by real walking minutes.
  const score = [-req, -(route.length - req), felt - rating * PARAMS.ratingTiebreakMinutesPerStar.value];
  return { valid: true, walk, time, score, detourBroken: [] };
}

export function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (Math.abs(x - y) > 1e-9) return x < y;
  }
  return false;
}

/** Turn a chosen route into a plan: give spare minutes back to stays, and explain what is missing. */
export function finishPlan(
  input: PlanInput,
  slots: Slot[],
  route: RouteStop[],
  extra: { approximate: boolean; truncated: boolean; optionalRejectedByDetour: Set<number> },
): PlanResult {
  const { items, candidates, minutes } = input;
  const budget = input.budgetMinutes ?? Infinity;
  const check = checkRoute(input, slots, route);
  const walk = route.length ? check.walk : minutes[0][1];

  const stops: PlannedStop[] = route.map((s) => ({
    itemIndex: slots[s.slot].item,
    candidateIndex: s.cand,
    point: pointOf(input, slots, s),
    stayMinutes: items[slots[s.slot].item].stay.min,
  }));
  let spare = budget - walk - stops.reduce((sum, x) => sum + x.stayMinutes, 0);
  const growable = () => stops.filter((x) => x.stayMinutes < items[x.itemIndex].stay.preferred);
  while (spare > 1e-9 && growable().length) {
    const g = growable();
    const share = spare / g.length;
    for (const x of g) {
      const add = Math.min(share, items[x.itemIndex].stay.preferred - x.stayMinutes);
      x.stayMinutes += add;
      spare -= add;
    }
  }
  for (const x of stops) x.stayMinutes = Math.floor(x.stayMinutes + 1e-9);
  const staysShortened = stops.some((x) => x.stayMinutes < items[x.itemIndex].stay.preferred);
  const stayMinutes = stops.reduce((sum, x) => sum + x.stayMinutes, 0);

  const missing: PlanResult["missing"] = [];
  items.forEach((it, i) => {
    const got = stops.filter((x) => x.itemIndex === i).length;
    if (got >= it.count) return;
    let reason: SkipReason;
    if (candidates[i].length === 0) reason = "no_candidates";
    else if (candidates[i].every((c) => c.isOpen && !c.isOpen(minutes[0][c.point], it.stay.min))) reason = "closed";
    else if (!it.required && extra.optionalRejectedByDetour.has(i)) reason = "optional_too_far";
    else reason = "over_budget";
    missing.push({ itemIndex: i, missing: it.count - got, reason });
  });

  return {
    stops,
    walkMinutes: walk,
    stayMinutes,
    totalMinutes: walk + stayMinutes,
    staysShortened,
    missing,
    approximate: extra.approximate,
    truncated: extra.truncated,
  };
}
