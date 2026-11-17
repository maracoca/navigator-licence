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
 * Search: dynamic programming over (set of filled slots, last place), keeping
 * the quickest way to reach each state. Exact when every item has count 1;
 * with counts above 1 a place already used on the stored best path is skipped,
 * which can in rare cases miss the optimum (reported as `approximate`). A request with more
 * stops than `maxSlots` is planned on its first stops (reported as `truncated`).
 */
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
  /** Walking minutes; point 0 = start, point 1 = end. */
  minutes: number[][];
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
  /** Walking + minimum stays so far. */
  time: number;
  walk: number;
  slot: number;
  cand: number;
  prev: State | null;
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

  const start: State = { mask: 0, point: 0, time: 0, walk: 0, slot: -1, cand: -1, prev: null };
  const best = new Map<string, State>([["0:0", start]]);
  const byMask: State[][] = Array.from({ length: 1 << S }, () => []);
  byMask[0].push(start);

  // Masks in increasing order: every transition adds a bit, so predecessors come first.
  for (let mask = 0; mask < 1 << S; mask++) {
    for (const st of byMask[mask]) {
      if (best.get(`${mask}:${st.point}`) !== st) continue;
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
          const nmask = mask | (1 << s);
          const key = `${nmask}:${cand.point}`;
          const prev = best.get(key);
          if (prev && prev.time <= time) return;
          const next: State = { mask: nmask, point: cand.point, time, walk: st.walk + leg, slot: s, cand: ci, prev: st };
          best.set(key, next);
          byMask[nmask].push(next);
        });
      }
    }
  }

  // Pick the best finished plan, judged by the shared rules (routeRules.ts).
  let chosen: { route: RouteStop[]; score: number[] } | null = null;
  const optionalRejectedByDetour = new Set<number>();
  for (const st of best.values()) {
    const route = pathOf(st).map((x) => ({ slot: x.slot, cand: x.cand }));
    const check = checkRoute(input, slots, route);
    for (const i of check.detourBroken) optionalRejectedByDetour.add(i);
    if (!check.valid) continue;
    if (!chosen || lexLess(check.score, chosen.score)) chosen = { route, score: check.score };
  }

  return finishPlan(input, slots, chosen?.route ?? [], { approximate, truncated, optionalRejectedByDetour });
}
