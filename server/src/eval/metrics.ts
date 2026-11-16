/**
 * Scores for the evaluation (see eval/README.md, "Results"). Pure functions:
 * no I/O, no API calls, so they can be unit-tested and re-run on saved runs.
 *
 * Every aggregate carries its own n, so small samples stay visible, and a
 * ratio with n = 0 is null ("n/a"), never 0 or NaN.
 */
import type { Pace } from "../types.js";

// ─── Shapes ─────────────────────────────────────────────────────────────────

export type StreetMode = "prefer" | "require";

export interface ExpectedItem {
  what?: string;
  /** "key=value"; any one matching counts. "key=*" accepts any value of the key. */
  tags: string[];
  required?: boolean;
  order?: number | null;
  count?: number | null;
  pace?: Pace;
  wish?: string | null;
}

export interface ExpectedStreet {
  property: string;
  mode: StreetMode;
}

export interface Expected {
  items: ExpectedItem[];
  street: ExpectedStreet[];
  unsupported: string[];
}

/** The parts of an understood item the scores look at. */
export interface ProducedItem {
  id: string;
  label?: string;
  osm: Array<{ presetId?: string; tags: Record<string, string> }>;
  required: boolean;
  order: number | null;
  count: number;
  pace: Pace;
  details: string;
}

export interface Produced {
  items: ProducedItem[];
  street: ExpectedStreet[];
  unsupported: string[];
}

/** The parts of a plan the planning facts look at. */
export interface PlanSummary {
  stops: Array<{ itemId: string }>;
  totals: { walkMinutes: number; shortestWalkMinutes: number; budgetMinutes: number | null; withinBudget: boolean };
  coverage: Array<{ property: string; goodPercent: number; badPercent: number; unknownPercent: number }>;
  skipped: Array<{ itemId: string; reason: string }>;
}

/** A share: num of n. value is null when n = 0. */
export interface Ratio {
  value: number | null;
  num: number;
  n: number;
}

export interface Stat {
  mean: number | null;
  median: number | null;
  max: number | null;
  n: number;
}

export const ratio = (num: number, n: number): Ratio => ({ value: n > 0 ? num / n : null, num, n });

export function stat(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { mean: null, median: null, max: null, n: 0 };
  const mid = Math.floor(v.length / 2);
  return {
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    max: v[v.length - 1],
    n: v.length,
  };
}

/** F1 from a precision and recall; null when either is undefined or both are 0. */
export function f1(p: number | null, r: number | null): number | null {
  if (p == null || r == null || p + r === 0) return null;
  return (2 * p * r) / (p + r);
}

// ─── Item matching ──────────────────────────────────────────────────────────

export function parseTag(tag: string): { key: string; value: string } | null {
  const m = /^([^=\s]+)=([^=]+)$/.exec(tag.trim());
  if (!m || m[2].trim() !== m[2]) return null;
  return { key: m[1], value: m[2] };
}

/**
 * How well one OSM kind fits one expected tag:
 *   2  exact: the kind is just that tag ({amenity:"cafe"} for amenity=cafe)
 *   1  more specific preset of it ({amenity:"place_of_worship", religion:"christian"} for amenity=place_of_worship)
 *   0  no match
 * An expected "key=*" accepts any value. A produced "*" (a generic preset such
 * as "Shop" = shop=*) does NOT match a specific expected value (shop=bakery):
 * the planner would then look for any shop, which is not the kind asked for.
 */
export function kindTagMatch(kindTags: Record<string, string>, tag: string): 0 | 1 | 2 {
  const t = parseTag(tag);
  if (!t) return 0;
  const have = kindTags[t.key];
  if (have === undefined) return 0;
  if (t.value !== "*" && have !== t.value) return 0;
  return Object.keys(kindTags).length === 1 ? 2 : 1;
}

/** Best fit of any of the item's OSM kinds to any expected tag (0, 1 or 2). Google types are not used. */
export function itemMatch(item: ProducedItem, expected: ExpectedItem): number {
  let best = 0;
  for (const kind of item.osm) for (const tag of expected.tags) best = Math.max(best, kindTagMatch(kind.tags, tag));
  return best;
}

export interface Pair {
  produced: number;
  expected: number;
  strength: number;
}

/**
 * One-to-one assignment of produced to expected items. Exact search (dynamic
 * programming over subsets of expected items), maximising, in this order:
 *   1. the number of matched pairs,
 *   2. the sum of match strengths (exact tag before more specific preset),
 *   3. keeping sentence order: the smallest sum of |produced index − expected index|
 *      (so "a cafe first … another cafe later" pairs up in order).
 * Requests have a handful of items; above 16 expected items it falls back to
 * greedy in the same preference order.
 */
export function assignItems(produced: ProducedItem[], expected: ExpectedItem[]): Pair[] {
  const P = produced.length, E = expected.length;
  const s = produced.map((p) => expected.map((e) => itemMatch(p, e)));
  if (P === 0 || E === 0) return [];
  if (E > 16) return greedyAssign(s);

  type Best = { count: number; strength: number; dist: number; pairs: Pair[] };
  const better = (a: Best, b: Best) =>
    a.count !== b.count ? a.count > b.count : a.strength !== b.strength ? a.strength > b.strength : a.dist < b.dist;
  const memo = new Map<number, Best>();
  const solve = (i: number, used: number): Best => {
    if (i === P) return { count: 0, strength: 0, dist: 0, pairs: [] };
    const key = i * (1 << E) + used;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = solve(i + 1, used); // produced item i left unmatched
    for (let j = 0; j < E; j++) {
      if (used & (1 << j) || s[i][j] === 0) continue;
      const rest = solve(i + 1, used | (1 << j));
      const cand: Best = {
        count: rest.count + 1,
        strength: rest.strength + s[i][j],
        dist: rest.dist + Math.abs(i - j),
        pairs: [{ produced: i, expected: j, strength: s[i][j] }, ...rest.pairs],
      };
      if (better(cand, best)) best = cand;
    }
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).pairs;
}

function greedyAssign(s: number[][]): Pair[] {
  const all: Pair[] = [];
  s.forEach((row, i) => row.forEach((v, j) => v > 0 && all.push({ produced: i, expected: j, strength: v })));
  all.sort((a, b) => b.strength - a.strength || Math.abs(a.produced - a.expected) - Math.abs(b.produced - b.expected));
  const usedP = new Set<number>(), usedE = new Set<number>();
  const out: Pair[] = [];
  for (const p of all) {
    if (usedP.has(p.produced) || usedE.has(p.expected)) continue;
    usedP.add(p.produced);
    usedE.add(p.expected);
    out.push(p);
  }
  return out.sort((a, b) => a.produced - b.produced);
}

// ─── Understanding, one case ────────────────────────────────────────────────

/** correct of n, for one field, over the matched items whose expected item specifies it. */
export interface FieldScore {
  correct: number;
  n: number;
}

export type FieldName = "required" | "order" | "count" | "pace" | "wish";
export const FIELD_NAMES: FieldName[] = ["required", "order", "count", "pace", "wish"];

export interface WishPair {
  what: string;
  expected: string | null;
  produced: string;
  correct: boolean;
}

export interface CaseUnderstandingScore {
  itemsProduced: number;
  itemsExpected: number;
  itemsMatched: number;
  pairs: Array<Pair & { what: string; label: string; fields: Partial<Record<FieldName, boolean>> }>;
  fields: Record<FieldName, FieldScore>;
  /** OSM kinds of matched items, and how many of them fit an expected tag (an item matches on any one kind). */
  kinds: { fitting: number; total: number };
  wishPairs: WishPair[];
  street: { matched: number; produced: number; expected: number };
  streetProperty: { matched: number; produced: number; expected: number };
  unsupported: { expected: boolean; produced: boolean; correct: boolean };
}

const has = <K extends keyof ExpectedItem>(e: ExpectedItem, k: K) => Object.prototype.hasOwnProperty.call(e, k) && e[k] !== undefined;

/**
 * Order is compared as relative order, not as numbers: a matched item's order
 * is correct when
 *   - expected null  → produced null;
 *   - expected a number → produced a number, and against every other matched
 *     item where both expected and produced orders are numbers, the produced
 *     order says "before / same / after" exactly as the expected one does.
 * So expected 1,2 and produced 2,3 is correct; produced 2,1 or 1,1 is not.
 */
function orderCorrect(pairs: Pair[], produced: ProducedItem[], expected: ExpectedItem[], k: number): boolean {
  const pk = produced[pairs[k].produced].order;
  const ek = expected[pairs[k].expected].order ?? null;
  if (ek === null) return pk === null;
  if (pk === null) return false;
  for (let m = 0; m < pairs.length; m++) {
    if (m === k) continue;
    const pm = produced[pairs[m].produced].order;
    const em = expected[pairs[m].expected].order ?? null;
    if (pm === null || em === null) continue;
    if (Math.sign(pk - pm) !== Math.sign(ek - em)) return false;
  }
  return true;
}

const streetKey = (s: ExpectedStreet) => `${s.property}:${s.mode}`;

function setOverlap(produced: string[], expected: string[]) {
  const p = new Set(produced), e = new Set(expected);
  let matched = 0;
  for (const x of p) if (e.has(x)) matched++;
  return { matched, produced: p.size, expected: e.size };
}

export function scoreUnderstanding(expected: Expected, produced: Produced): CaseUnderstandingScore {
  const pairs = assignItems(produced.items, expected.items);
  const fields = Object.fromEntries(FIELD_NAMES.map((f) => [f, { correct: 0, n: 0 }])) as Record<FieldName, FieldScore>;
  const wishPairs: WishPair[] = [];
  const kinds = { fitting: 0, total: 0 };

  const scoredPairs = pairs.map((pair, k) => {
    const p = produced.items[pair.produced];
    const e = expected.items[pair.expected];
    const res: Partial<Record<FieldName, boolean>> = {};
    for (const kind of p.osm) {
      kinds.total++;
      if (e.tags.some((t) => kindTagMatch(kind.tags, t) > 0)) kinds.fitting++;
    }
    if (has(e, "required")) res.required = p.required === e.required;
    if (has(e, "order")) res.order = orderCorrect(pairs, produced.items, expected.items, k);
    // The app always sends a count (unspecified = 1), so an expected null means 1.
    if (has(e, "count")) res.count = p.count === (e.count ?? 1);
    if (has(e, "pace")) res.pace = p.pace === e.pace;
    if (has(e, "wish")) {
      const exp = e.wish ?? null;
      const prodWish = (p.details ?? "").trim();
      res.wish = (exp === null) === (prodWish === "");
      wishPairs.push({ what: e.what ?? e.tags[0] ?? "", expected: exp, produced: prodWish, correct: res.wish });
    }
    for (const f of FIELD_NAMES) {
      if (res[f] === undefined) continue;
      fields[f].n++;
      if (res[f]) fields[f].correct++;
    }
    return { ...pair, what: e.what ?? e.tags.join("|"), label: p.label ?? p.id, fields: res };
  });

  const expUns = expected.unsupported.length > 0;
  const prodUns = produced.unsupported.length > 0;
  return {
    itemsProduced: produced.items.length,
    itemsExpected: expected.items.length,
    itemsMatched: pairs.length,
    pairs: scoredPairs,
    fields,
    kinds,
    wishPairs,
    street: setOverlap(produced.street.map(streetKey), expected.street.map(streetKey)),
    streetProperty: setOverlap(produced.street.map((s) => s.property), expected.street.map((s) => s.property)),
    unsupported: { expected: expUns, produced: prodUns, correct: expUns === prodUns },
  };
}

// ─── Understanding, whole set ───────────────────────────────────────────────

export interface PRF {
  precision: Ratio;
  recall: Ratio;
  f1: number | null;
}

export interface UnderstandingSummary {
  /** Cases that were understood without error. */
  cases: number;
  items: PRF;
  /** Of the OSM kinds the app chose for matched items, the share that fit an expected tag. */
  kindPrecision: Ratio;
  fields: Record<FieldName, Ratio>;
  street: PRF;
  streetProperty: PRF;
  unsupportedDetection: Ratio;
}

function prf(matched: number, produced: number, expected: number): PRF {
  const precision = ratio(matched, produced);
  const recall = ratio(matched, expected);
  return { precision, recall, f1: f1(precision.value, recall.value) };
}

/** Micro-averaged: counts are summed over all cases before dividing. */
export function summarizeUnderstanding(scores: CaseUnderstandingScore[]): UnderstandingSummary {
  const sum = (f: (s: CaseUnderstandingScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((f) => [f, ratio(sum((s) => s.fields[f].correct), sum((s) => s.fields[f].n))]),
  ) as Record<FieldName, Ratio>;
  return {
    cases: scores.length,
    items: prf(sum((s) => s.itemsMatched), sum((s) => s.itemsProduced), sum((s) => s.itemsExpected)),
    kindPrecision: ratio(sum((s) => s.kinds.fitting), sum((s) => s.kinds.total)),
    fields,
    street: prf(sum((s) => s.street.matched), sum((s) => s.street.produced), sum((s) => s.street.expected)),
    streetProperty: prf(
      sum((s) => s.streetProperty.matched),
      sum((s) => s.streetProperty.produced),
      sum((s) => s.streetProperty.expected),
    ),
    unsupportedDetection: ratio(sum((s) => (s.unsupported.correct ? 1 : 0)), scores.length),
  };
}

// ─── Planning, one case ─────────────────────────────────────────────────────

export interface CasePlanningFacts {
  /** Expected required items that were understood (matched), and how many of them got at least one stop. */
  requiredUnderstood: number;
  requiredWithStop: number;
  /** null when the case has no budget. */
  withinBudget: boolean | null;
  /** walkMinutes / shortestWalkMinutes; null when the shortest walk is 0 (start = end). */
  walkOverhead: number | null;
  stops: number;
  skipReasons: string[];
  coverage: PlanSummary["coverage"];
}

export function planningFacts(expected: Expected, produced: Produced, pairs: Pair[], plan: PlanSummary): CasePlanningFacts {
  const withStop = new Set(plan.stops.map((s) => s.itemId));
  let requiredUnderstood = 0, requiredWithStop = 0;
  for (const pair of pairs) {
    if (expected.items[pair.expected].required !== true) continue;
    requiredUnderstood++;
    if (withStop.has(produced.items[pair.produced].id)) requiredWithStop++;
  }
  const t = plan.totals;
  return {
    requiredUnderstood,
    requiredWithStop,
    withinBudget: t.budgetMinutes == null ? null : t.withinBudget,
    walkOverhead: t.shortestWalkMinutes > 0 ? t.walkMinutes / t.shortestWalkMinutes : null,
    stops: plan.stops.length,
    skipReasons: plan.skipped.map((s) => s.reason),
    coverage: plan.coverage,
  };
}

// ─── Planning, whole set ────────────────────────────────────────────────────

export interface PlanningSummary {
  /** Plans without error, of the cases where planning was attempted (understanding succeeded). */
  success: Ratio;
  /** Cases where every understood required item got a stop, of the planned cases that have at least one. */
  requiredAllPlaced: Ratio;
  /** Within budget, of the planned cases that have a budget. */
  withinBudget: Ratio;
  walkOverhead: Stat;
  stops: Stat;
  /** Count per skip reason over all skipped items; n = planned cases. */
  skipReasons: { counts: Record<string, number>; skippedItems: number; n: number };
  /** Mean percentages per street property, over the planned cases that asked for it. */
  coverage: Record<string, { good: number | null; bad: number | null; unknown: number | null; n: number }>;
  planMs: Stat;
  understandMs: Stat;
}

export function summarizePlanning(
  attempted: number,
  facts: CasePlanningFacts[],
  understandMs: number[],
  planMs: number[],
): PlanningSummary {
  const withRequired = facts.filter((f) => f.requiredUnderstood > 0);
  const withBudget = facts.filter((f) => f.withinBudget !== null);
  const counts: Record<string, number> = {};
  for (const f of facts) for (const r of f.skipReasons) counts[r] = (counts[r] ?? 0) + 1;

  const byProp = new Map<string, Array<PlanSummary["coverage"][number]>>();
  for (const f of facts) for (const c of f.coverage) byProp.set(c.property, [...(byProp.get(c.property) ?? []), c]);
  const coverage: PlanningSummary["coverage"] = {};
  for (const [prop, list] of byProp) {
    coverage[prop] = {
      good: stat(list.map((c) => c.goodPercent)).mean,
      bad: stat(list.map((c) => c.badPercent)).mean,
      unknown: stat(list.map((c) => c.unknownPercent)).mean,
      n: list.length,
    };
  }

  return {
    success: ratio(facts.length, attempted),
    requiredAllPlaced: ratio(withRequired.filter((f) => f.requiredWithStop === f.requiredUnderstood).length, withRequired.length),
    withinBudget: ratio(withBudget.filter((f) => f.withinBudget).length, withBudget.length),
    walkOverhead: stat(facts.map((f) => f.walkOverhead).filter((x): x is number => x !== null)),
    stops: stat(facts.map((f) => f.stops)),
    skipReasons: { counts, skippedItems: Object.values(counts).reduce((a, b) => a + b, 0), n: facts.length },
    coverage,
    planMs: stat(planMs),
    understandMs: stat(understandMs),
  };
}
