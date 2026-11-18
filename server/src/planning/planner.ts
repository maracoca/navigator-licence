/**
 * Exact stop planner (an orienteering problem with stays).
 *
 * Chooses which place serves each requested item and in what order, given
 * walking minutes between all points. Rules:
 *  - Required items come first: the best plan covers as many required stops
 *    as fit, then as many optional ones, then has the least walking (rating
 *    only breaks near-ties).
 *  - An optional stop may add at most `optionalMaxDetourMinutes` of walking.
 *  - Items with an order are visited in that order.
 *  - Total = walking + stays ≤ budget. Stays are counted at their minimum
 *    while choosing; afterwards they are lengthened back towards the preferred
 *    stay as far as the budget allows.
 *  - A place is used once; a place must be open for the whole stay when its
 *    hours are known.
 *
 * Search: dynamic programming over (set of filled slots, last place). For each
 * such step it keeps every way there that no other way beats on both time
 * (walking + stays, for the budget) and score (walking — preference-weighted
 * when given — minus the rating bonus): a "label" method from constrained
 * shortest-path search. Known gaps, measured by the planner benchmark against
 * brute force: an optional stop's detour depends on the next stop, which is not
 * known when ways are compared; with counts above 1 the stored way decides
 * which places are used (reported as `approximate`); a place must be open on
 * arrival (no waiting), so arriving earlier is not always better. A request
 * with more stops than `maxSlots` is planned on its first stops (`truncated`).
 */
import { PARAMS } from "../params.js";
import { buildSlots, checkRoute, finishPlan, lexLess, type RouteStop } from "./routeRules.js";

export interface PlanItem {
  required: boolean;
  order: number | null;
  count: number;
  stay: { preferred: number; min: number };
}

export interface PlanCandidate {
  /** Row/column in the matrix. */
  point: number;
  rating: number | null;
  /** True when the place is open for the whole stay starting at `arriveMinute`; omitted = always open. */
  isOpen?: (arriveMinute: number, stayMinutes: number) => boolean;
}

export interface PlanInput {
  items: PlanItem[];
  /** candidates[i] = places for items[i]. */
  candidates: PlanCandidate[][];
  /** Walking minutes; point 0 = start, point 1 = end. Decide the time budget. */
  minutes: number[][];
  /**
   * Optional: the minutes a walk "feels like" with the street preferences (good streets count shorter, bad ones longer).
   * When given, plans are judged by these instead of real walking minutes; the budget still uses `minutes`.
   */
  costMinutes?: number[][];
  budgetMinutes: number | null;
}

export interface PlannedStop {
  itemIndex: number;
  candidateIndex: number;
  point: number;
  stayMinutes: number;
}

export type SkipReason = "no_candidates" | "over_budget" | "optional_too_far" | "closed";

export interface PlanResult {
  stops: PlannedStop[];
  walkMinutes: number;
  stayMinutes: number;
  totalMinutes: number;
  staysShortened: boolean;
  /** Items with fewer stops than asked, and why. */
  missing: Array<{ itemIndex: number; missing: number; reason: SkipReason }>;
  approximate: boolean;
  /** Some requested stops were left out of the search because the request had more than maxSlots. */
  truncated: boolean;
}

interface State {
  mask: number;
  point: number;
  /** Walking + minimum stays so far (real minutes; decides the budget). */
  time: number;
  walk: number;
  /** What the plan is judged by so far: walking (preference-weighted when given) minus the rating bonus. */
  obj: number;
  slot: number;
  cand: number;
  prev: State | null;
  /** Replaced by a state that is at least as good on both time and obj. */
  dead?: boolean;
  /**
   * When the last stop is optional, the place before it: that stop's detour is only known once the next place is
   * chosen, so ways are compared only with ways that share it. -1 otherwise.
   */
  ctx: number;
}

function pathOf(s: State): State[] {
  const out: State[] = [];
  for (let x: State | null = s; x && x.slot >= 0; x = x.prev) out.push(x);
  return out.reverse();
}

export function plan(input: PlanInput): PlanResult {
  const { items, candidates, minutes, budgetMinutes } = input;
  const budget = budgetMinutes ?? Infinity;

  const { slots, truncated } = buildSlots(input);
  const approximate = truncated || items.some((it) => it.count > 1);
  const S = slots.length;
  const slotIndex = new Map(slots.map((s, i) => [`${s.item}:${s.copy}`, i]));

  const cost = input.costMinutes ?? minutes;
  const tiebreak = PARAMS.ratingTiebreakMinutesPerStar.value;
  const maxLabels = PARAMS.maxStatesPerStep.value;
  let capped = false;

  const start: State = { mask: 0, point: 0, time: 0, walk: 0, obj: 0, slot: -1, cand: -1, prev: null, ctx: -1 };
  const detourCap = PARAMS.optionalMaxDetourMinutes.value;
  // Per step ("these stops done, standing here"): every way there that no other way beats on both time and obj.
  // Keeping only the fastest would lose a slower way that is better rated or uses preferred streets.
  const labels = new Map<string, State[]>([["0:0", [start]]]);
  const byMask: State[][] = Array.from({ length: 1 << S }, () => []);
  byMask[0].push(start);

  const add = (next: State): void => {
    const key = `${next.mask}:${next.point}`;
    const list = labels.get(key) ?? [];
    for (const l of list) if (l.ctx === next.ctx && l.time <= next.time + 1e-9 && l.obj <= next.obj + 1e-9) return;
    const kept = list.filter((l) => {
      const beaten = l.ctx === next.ctx && next.time <= l.time + 1e-9 && next.obj <= l.obj + 1e-9;
      if (beaten) l.dead = true;
      return !beaten;
    });
    kept.push(next);
    if (kept.length > maxLabels) {
      // Safety valve against very large requests: keep the best-judged ones and say the plan may not be the best.
      kept.sort((a, b) => a.obj - b.obj);
      for (const l of kept.splice(maxLabels)) l.dead = true;
      capped = true;
    }
    labels.set(key, kept);
    byMask[next.mask].push(next);
  };

  // Masks in increasing order: every transition adds a bit, so predecessors come first.
  for (let mask = 0; mask < 1 << S; mask++) {
    for (const st of byMask[mask]) {
      if (st.dead) continue;
      const used = new Set(pathOf(st).map((x) => x.point));
      for (let s = 0; s < S; s++) {
        if (mask & (1 << s)) continue;
        const slot = slots[s];
        if (slot.copy > 0) {
          const prevCopy = slotIndex.get(`${slot.item}:${slot.copy - 1}`);
          if (prevCopy !== undefined && !(mask & (1 << prevCopy))) continue;
        }
        if (slot.order != null) {
          let blocked = false;
          for (let t = 0; t < S; t++) {
            const o = slots[t].order;
            if (mask & (1 << t) && o != null && o > slot.order) blocked = true;
          }
          if (blocked) continue;
        }
        const it = items[slot.item];
        candidates[slot.item].forEach((cand, ci) => {
          if (used.has(cand.point)) return;
          const leg = minutes[st.point][cand.point];
          if (!Number.isFinite(leg)) return;
          const arrive = st.time + leg;
          if (cand.isOpen && !cand.isOpen(arrive, it.stay.min)) return;
          const time = arrive + it.stay.min;
          if (time + minutes[cand.point][1] > budget) return;
          // The previous stop's detour is known now: if it was optional, it may add at most detourCap of walking.
          if (st.ctx >= 0 && minutes[st.ctx][st.point] + leg - minutes[st.ctx][cand.point] > detourCap + 1e-9) return;
          const obj = st.obj + cost[st.point][cand.point] - (cand.rating ?? 0) * tiebreak;
          const ctx = slot.required ? -1 : st.point;
          add({ mask: mask | (1 << s), point: cand.point, time, walk: st.walk + leg, obj, slot: s, cand: ci, prev: st, ctx });
        });
      }
    }
  }

  // Pick the best finished plan, judged by the shared rules (routeRules.ts).
  let chosen: { route: RouteStop[]; score: number[] } | null = null;
  const optionalRejectedByDetour = new Set<number>();
  for (const st of [...labels.values()].flat()) {
    if (st.dead) continue;
    const route = pathOf(st).map((x) => ({ slot: x.slot, cand: x.cand }));
    const check = checkRoute(input, slots, route);
    for (const i of check.detourBroken) optionalRejectedByDetour.add(i);
    if (!check.valid) continue;
    if (!chosen || lexLess(check.score, chosen.score)) chosen = { route, score: check.score };
  }

  return finishPlan(input, slots, chosen?.route ?? [], { approximate: approximate || capped, truncated, optionalRejectedByDetour });
}
