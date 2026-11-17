/**
 * Planners the exact one (planner.ts) is compared with in the planner study.
 * All take the same input, follow the same rules and are scored the same way
 * (routeRules.ts), so only the search differs.
 *
 *   bruteForce        every combination and order — only to check the exact planner on small problems
 *   greedy            from where you stand, go to the closest stop that still fits
 *   cheapestInsertion repeatedly insert the stop that adds the least walking, at its best position
 *   localSearch       cheapest insertion, then improve by small changes until none helps
 */
import type { PlanInput, PlanResult } from "./planner.js";
import { buildSlots, checkRoute, finishPlan, lexLess, pointOf, type RouteStop, type Slot } from "./routeRules.js";

interface Ctx {
  input: PlanInput;
  slots: Slot[];
  truncated: boolean;
}

function context(input: PlanInput): Ctx {
  const { slots, truncated } = buildSlots(input);
  return { input, slots, truncated };
}

function done(ctx: Ctx, route: RouteStop[], approximate: boolean): PlanResult {
  const rejected = new Set<number>();
  return finishPlan(ctx.input, ctx.slots, route, { approximate: approximate || ctx.truncated, truncated: ctx.truncated, optionalRejectedByDetour: rejected });
}

const score = (ctx: Ctx, route: RouteStop[]) => checkRoute(ctx.input, ctx.slots, route);

/** Copies of the same item are interchangeable; filling them in order avoids counting the same plan twice. */
function copyReady(ctx: Ctx, route: RouteStop[], s: number): boolean {
  const slot = ctx.slots[s];
  if (slot.copy === 0) return true;
  return route.some((r) => ctx.slots[r.slot].item === slot.item && ctx.slots[r.slot].copy === slot.copy - 1);
}

/** Every (slot, candidate) pair not yet in the route. */
function unused(ctx: Ctx, route: RouteStop[]): RouteStop[] {
  const inRoute = new Set(route.map((r) => r.slot));
  const out: RouteStop[] = [];
  ctx.slots.forEach((slot, s) => {
    if (inRoute.has(s)) return;
    ctx.input.candidates[slot.item].forEach((_, c) => out.push({ slot: s, cand: c }));
  });
  return out;
}

// ─── Brute force ────────────────────────────────────────────────────────────

/**
 * Can stops still be added after this partial route? No when it already breaks a rule that later stops cannot repair:
 * the time up to the last stop is over budget, the requested order is broken, or a place is closed on arrival.
 * (The optional-detour rule is not used here: the next stop changes it.)
 */
function prefixCanGrow(ctx: Ctx, route: RouteStop[]): boolean {
  const { items, candidates, minutes } = ctx.input;
  const budget = ctx.input.budgetMinutes ?? Infinity;
  let time = 0, here = 0, maxOrder = -Infinity;
  for (const s of route) {
    const slot = ctx.slots[s.slot];
    if (slot.order != null) {
      if (slot.order < maxOrder) return false;
      maxOrder = slot.order;
    }
    const p = pointOf(ctx.input, ctx.slots, s);
    const arrive = time + minutes[here][p];
    const cand = candidates[slot.item][s.cand];
    if (!Number.isFinite(arrive) || (cand.isOpen && !cand.isOpen(arrive, items[slot.item].stay.min))) return false;
    time = arrive + items[slot.item].stay.min;
    here = p;
  }
  return time <= budget + 1e-9;
}

/** Tries every subset, order and choice of place. Only for small problems. */
export function bruteForce(input: PlanInput): PlanResult {
  const ctx = context(input);
  let best: { route: RouteStop[]; score: number[] } = { route: [], score: score(ctx, []).score };
  const route: RouteStop[] = [];
  const usedPoints = new Set<number>();

  const visit = () => {
    const check = score(ctx, route);
    if (check.valid && lexLess(check.score, best.score)) best = { route: [...route], score: check.score };
    ctx.slots.forEach((slot, s) => {
      if (route.some((r) => r.slot === s) || !copyReady(ctx, route, s)) return;
      input.candidates[slot.item].forEach((_, c) => {
        const p = pointOf(input, ctx.slots, { slot: s, cand: c });
        if (usedPoints.has(p)) return;
        route.push({ slot: s, cand: c });
        usedPoints.add(p);
        if (prefixCanGrow(ctx, route)) visit();
        route.pop();
        usedPoints.delete(p);
      });
    });
  };
  visit();
  return done(ctx, best.route, false);
}

// ─── Greedy ─────────────────────────────────────────────────────────────────

/** From where you stand, the closest stop that keeps the route valid; required stops before optional ones. */
export function greedy(input: PlanInput): PlanResult {
  const ctx = context(input);
  const route: RouteStop[] = [];
  for (;;) {
    const here = route.length ? pointOf(input, ctx.slots, route[route.length - 1]) : 0;
    let pick: { stop: RouteStop; leg: number; required: boolean } | null = null;
    for (const stop of unused(ctx, route)) {
      if (!copyReady(ctx, route, stop.slot)) continue;
      if (!score(ctx, [...route, stop]).valid) continue;
      const leg = input.minutes[here][pointOf(input, ctx.slots, stop)];
      const required = ctx.slots[stop.slot].required;
      const better = !pick || (required && !pick.required) || (required === pick.required && leg < pick.leg);
      if (better) pick = { stop, leg, required };
    }
    if (!pick) break;
    route.push(pick.stop);
  }
  return done(ctx, route, true);
}

// ─── Cheapest insertion ─────────────────────────────────────────────────────

function bestInsertion(ctx: Ctx, route: RouteStop[]): RouteStop[] | null {
  let best: { route: RouteStop[]; added: number; required: boolean } | null = null;
  const base = score(ctx, route).walk;
  for (const stop of unused(ctx, route)) {
    // Copies of an item are interchangeable, so any free copy may be inserted anywhere.
    const required = ctx.slots[stop.slot].required;
    for (let pos = 0; pos <= route.length; pos++) {
      const next = [...route.slice(0, pos), stop, ...route.slice(pos)];
      const check = score(ctx, next);
      if (!check.valid) continue;
      const added = check.walk - base;
      const better = !best || (required && !best.required) || (required === best.required && added < best.added);
      if (better) best = { route: next, added, required };
    }
  }
  return best?.route ?? null;
}

function insertionRoute(ctx: Ctx): RouteStop[] {
  let route: RouteStop[] = [];
  for (;;) {
    const next = bestInsertion(ctx, route);
    if (!next) return route;
    route = next;
  }
}

export function cheapestInsertion(input: PlanInput): PlanResult {
  const ctx = context(input);
  return done(ctx, insertionRoute(ctx), true);
}

// ─── Local search ───────────────────────────────────────────────────────────

/** Small changes to a route: move a stop, reverse a stretch (2-opt), use another place for a stop, add a stop, drop an optional stop. */
function* neighbours(ctx: Ctx, route: RouteStop[]): Generator<RouteStop[]> {
  const n = route.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const moved = [...route];
      const [x] = moved.splice(i, 1);
      moved.splice(j, 0, x);
      yield moved;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j <= n; j++) yield [...route.slice(0, i), ...route.slice(i, j).reverse(), ...route.slice(j)];
  }
  for (let i = 0; i < n; i++) {
    const item = ctx.slots[route[i].slot].item;
    for (let c = 0; c < ctx.input.candidates[item].length; c++) {
      if (c !== route[i].cand) yield route.map((r, k) => (k === i ? { slot: r.slot, cand: c } : r));
    }
  }
  const added = bestInsertion(ctx, route);
  if (added) yield added;
  for (let i = 0; i < n; i++) if (!ctx.slots[route[i].slot].required) yield [...route.slice(0, i), ...route.slice(i + 1)];
}

export function localSearch(input: PlanInput): PlanResult {
  const ctx = context(input);
  let route = insertionRoute(ctx);
  let current = score(ctx, route).score;
  for (let improved = true; improved; ) {
    improved = false;
    for (const next of neighbours(ctx, route)) {
      const check = score(ctx, next);
      if (check.valid && lexLess(check.score, current)) {
        route = next;
        current = check.score;
        improved = true;
        break;
      }
    }
  }
  return done(ctx, route, true);
}
