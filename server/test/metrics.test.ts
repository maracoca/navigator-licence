import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignItems,
  itemMatch,
  kindTagMatch,
  planningFacts,
  ratio,
  scoreUnderstanding,
  stat,
  summarizePlanning,
  summarizeUnderstanding,
  type Expected,
  type ExpectedItem,
  type PlanSummary,
  type Produced,
  type ProducedItem,
} from "../src/eval/metrics.js";
import { validateCases } from "../src/eval/cases.js";

const prod = (id: string, tags: Array<Record<string, string>>, over: Partial<ProducedItem> = {}): ProducedItem => ({
  id,
  osm: tags.map((t) => ({ tags: t })),
  required: true,
  order: null,
  count: 1,
  pace: "normal",
  details: "",
  ...over,
});
const exp = (tags: string[], over: Partial<ExpectedItem> = {}): ExpectedItem => ({ tags, ...over });
const produced = (items: ProducedItem[], over: Partial<Produced> = {}): Produced => ({ items, street: [], unsupported: [], ...over });
const expected = (items: ExpectedItem[], over: Partial<Expected> = {}): Expected => ({ items, street: [], unsupported: [], ...over });

// ─── Tag and item matching ──────────────────────────────────────────────────

test("exact tag, more specific preset, wildcard and mismatch", () => {
  assert.equal(kindTagMatch({ amenity: "cafe" }, "amenity=cafe"), 2);
  assert.equal(kindTagMatch({ amenity: "place_of_worship", religion: "christian" }, "amenity=place_of_worship"), 1);
  assert.equal(kindTagMatch({ amenity: "restaurant" }, "amenity=cafe"), 0);
  assert.equal(kindTagMatch({ shop: "bakery" }, "shop=*"), 2);
  // A generic produced preset (shop=*) is not the specific kind asked for.
  assert.equal(kindTagMatch({ shop: "*" }, "shop=bakery"), 0);
  assert.equal(kindTagMatch({ amenity: "cafe" }, "not a tag"), 0);
});

test("an item matches when any of its kinds fits any expected tag", () => {
  const coffee = prod("i1", [{ shop: "coffee" }, { amenity: "cafe" }]);
  assert.equal(itemMatch(coffee, exp(["amenity=cafe"])), 2);
  assert.equal(itemMatch(coffee, exp(["amenity=bar", "shop=coffee"])), 2);
  assert.equal(itemMatch(coffee, exp(["amenity=bar"])), 0);
  assert.equal(itemMatch(prod("i2", []), exp(["amenity=bar"])), 0);
});

test("assignment is one-to-one and maximises the number of pairs", () => {
  // Produced 0 fits both expected items, produced 1 fits only expected 0.
  // Greedy-by-index would pair 0-0 and leave 1 alone; the best assignment pairs both.
  const p = [prod("i1", [{ amenity: "cafe" }, { amenity: "bar" }]), prod("i2", [{ amenity: "cafe" }])];
  const e = [exp(["amenity=cafe"]), exp(["amenity=bar"])];
  const pairs = assignItems(p, e);
  assert.deepEqual(
    pairs.map((x) => [x.produced, x.expected]),
    [[0, 1], [1, 0]],
  );
});

test("one produced item never matches two expected items", () => {
  const pairs = assignItems([prod("i1", [{ amenity: "cafe" }])], [exp(["amenity=cafe"]), exp(["amenity=cafe"])]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].produced, pairs[0].expected], [0, 0]); // ties keep sentence order
});

test("ties prefer an exact tag over a more specific preset, then sentence order", () => {
  const p = [prod("i1", [{ amenity: "place_of_worship", religion: "christian" }]), prod("i2", [{ amenity: "place_of_worship" }])];
  const e = [exp(["amenity=place_of_worship"])];
  assert.deepEqual(assignItems(p, e).map((x) => x.produced), [1]);
  const same = [prod("i1", [{ amenity: "cafe" }]), prod("i2", [{ amenity: "cafe" }])];
  assert.deepEqual(
    assignItems(same, [exp(["amenity=cafe"], { order: 1 }), exp(["amenity=cafe"], { order: 2 })]).map((x) => [x.produced, x.expected]),
    [[0, 0], [1, 1]],
  );
});

// ─── Field accuracies ───────────────────────────────────────────────────────

test("only fields the expected item states are checked", () => {
  const s = scoreUnderstanding(
    expected([exp(["amenity=cafe"], { pace: "quick" })]),
    produced([prod("i1", [{ amenity: "cafe" }], { pace: "normal", required: false, order: 3 })]),
  );
  assert.deepEqual(s.fields.pace, { correct: 0, n: 1 });
  assert.deepEqual(s.fields.required, { correct: 0, n: 0 });
  assert.deepEqual(s.fields.order, { correct: 0, n: 0 });
  assert.deepEqual(s.fields.count, { correct: 0, n: 0 });
  assert.deepEqual(s.fields.wish, { correct: 0, n: 0 });
});

test("fields of unmatched items are not counted", () => {
  const s = scoreUnderstanding(
    expected([exp(["amenity=bar"], { required: true, pace: "long" })]),
    produced([prod("i1", [{ amenity: "cafe" }])]),
  );
  assert.equal(s.itemsMatched, 0);
  assert.equal(s.fields.required.n, 0);
  assert.equal(s.fields.pace.n, 0);
});

test("order is compared as relative order", () => {
  const e = expected([exp(["tourism=museum"], { order: 1 }), exp(["amenity=cafe"], { order: 2 })]);
  const items = (a: number | null, b: number | null) =>
    produced([prod("i1", [{ tourism: "museum" }], { order: a }), prod("i2", [{ amenity: "cafe" }], { order: b })]);
  assert.deepEqual(scoreUnderstanding(e, items(1, 2)).fields.order, { correct: 2, n: 2 });
  assert.deepEqual(scoreUnderstanding(e, items(2, 3)).fields.order, { correct: 2, n: 2 });
  assert.deepEqual(scoreUnderstanding(e, items(2, 1)).fields.order, { correct: 0, n: 2 });
  assert.deepEqual(scoreUnderstanding(e, items(1, 1)).fields.order, { correct: 0, n: 2 });
  assert.deepEqual(scoreUnderstanding(e, items(null, null)).fields.order, { correct: 0, n: 2 });
  const unordered = expected([exp(["tourism=museum"], { order: null })]);
  assert.deepEqual(scoreUnderstanding(unordered, items(null, null)).fields.order, { correct: 1, n: 1 });
  assert.deepEqual(scoreUnderstanding(unordered, items(1, null)).fields.order, { correct: 0, n: 1 });
});

test("count null means 1; required, pace and wish", () => {
  const s = scoreUnderstanding(
    expected([
      exp(["shop=books"], { count: 2, required: false, wish: null }),
      exp(["amenity=place_of_worship"], { count: null, pace: "quick", wish: "catholic" }),
    ]),
    produced([
      prod("i1", [{ shop: "books" }], { count: 2, required: false, details: "" }),
      prod("i2", [{ amenity: "place_of_worship", religion: "christian" }], { count: 1, pace: "quick", details: "catholic" }),
    ]),
  );
  assert.deepEqual(s.fields.count, { correct: 2, n: 2 });
  assert.deepEqual(s.fields.required, { correct: 1, n: 1 });
  assert.deepEqual(s.fields.pace, { correct: 1, n: 1 });
  assert.deepEqual(s.fields.wish, { correct: 2, n: 2 });
  assert.equal(s.wishPairs.length, 2);

  const wrongWish = scoreUnderstanding(expected([exp(["shop=books"], { wish: null })]), produced([prod("i1", [{ shop: "books" }], { details: "cheap" })]));
  assert.deepEqual(wrongWish.fields.wish, { correct: 0, n: 1 });
});

// ─── Street preferences and unsupported wishes ──────────────────────────────

test("street precision and recall, with and without the mode", () => {
  const scores = [
    scoreUnderstanding(
      expected([], { street: [{ property: "lit", mode: "prefer" }, { property: "no_steps", mode: "require" }] }),
      produced([], { street: [{ property: "lit", mode: "require" }, { property: "no_steps", mode: "require" }, { property: "paved", mode: "prefer" }] }),
    ),
  ];
  const sum = summarizeUnderstanding(scores);
  assert.deepEqual(sum.street.precision, ratio(1, 3));
  assert.deepEqual(sum.street.recall, ratio(1, 2));
  assert.deepEqual(sum.streetProperty.precision, ratio(2, 3));
  assert.deepEqual(sum.streetProperty.recall, ratio(2, 2));
});

test("unsupported street wish: detected or not, compared with expected", () => {
  const yes = scoreUnderstanding(expected([], { unsupported: ["shade"] }), produced([], { unsupported: ["shady streets"] }));
  const missed = scoreUnderstanding(expected([], { unsupported: ["shade"] }), produced([]));
  const none = scoreUnderstanding(expected([]), produced([]));
  const invented = scoreUnderstanding(expected([]), produced([], { unsupported: ["nice"] }));
  assert.equal(yes.unsupported.correct, true);
  assert.equal(missed.unsupported.correct, false);
  assert.equal(none.unsupported.correct, true);
  assert.equal(invented.unsupported.correct, false);
  assert.deepEqual(summarizeUnderstanding([yes, missed, none, invented]).unsupportedDetection, ratio(2, 4));
});

test("item precision/recall are micro-averaged over cases", () => {
  const a = scoreUnderstanding(expected([exp(["amenity=cafe"])]), produced([prod("i1", [{ amenity: "cafe" }]), prod("i2", [{ amenity: "bench" }])]));
  const b = scoreUnderstanding(expected([exp(["amenity=bar"]), exp(["amenity=pub"])]), produced([prod("i1", [{ amenity: "bar" }])]));
  const sum = summarizeUnderstanding([a, b]);
  assert.deepEqual(sum.items.precision, ratio(2, 3));
  assert.deepEqual(sum.items.recall, ratio(2, 3));
  assert.ok(Math.abs(sum.items.f1! - 2 / 3) < 1e-12);
});

test("kind precision counts the extra kinds of matched items", () => {
  // "something to eat" understood as restaurant + cafe; only restaurant was expected.
  const s = scoreUnderstanding(expected([exp(["amenity=restaurant"])]), produced([prod("i1", [{ amenity: "restaurant" }, { amenity: "cafe" }])]));
  assert.equal(s.itemsMatched, 1);
  assert.deepEqual(summarizeUnderstanding([s]).kindPrecision, ratio(1, 2));
  assert.equal(summarizeUnderstanding([]).kindPrecision.value, null);
});

// ─── Empty sets: no division by zero ────────────────────────────────────────

test("empty inputs give null (n/a), never NaN", () => {
  const sum = summarizeUnderstanding([]);
  assert.equal(sum.cases, 0);
  assert.deepEqual(sum.items.precision, { value: null, num: 0, n: 0 });
  assert.equal(sum.items.f1, null);
  assert.equal(sum.fields.order.value, null);
  assert.equal(sum.unsupportedDetection.value, null);

  // A request with no places and no street wishes, answered with nothing.
  const nothing = summarizeUnderstanding([scoreUnderstanding(expected([]), produced([]))]);
  assert.equal(nothing.items.precision.value, null);
  assert.equal(nothing.items.recall.value, null);
  assert.equal(nothing.street.f1, null);
  assert.deepEqual(nothing.unsupportedDetection, ratio(1, 1));

  const plan = summarizePlanning(0, [], [], []);
  assert.equal(plan.success.value, null);
  assert.equal(plan.requiredAllPlaced.value, null);
  assert.equal(plan.withinBudget.value, null);
  assert.deepEqual(plan.walkOverhead, { mean: null, median: null, max: null, n: 0 });
  assert.deepEqual(plan.coverage, {});
  assert.equal(assignItems([], [exp(["amenity=cafe"])]).length, 0);
});

test("stat gives mean, median and max", () => {
  assert.deepEqual(stat([3, 1, 2, 10]), { mean: 4, median: 2.5, max: 10, n: 4 });
  assert.deepEqual(stat([5]), { mean: 5, median: 5, max: 5, n: 1 });
});

// ─── Planning facts ─────────────────────────────────────────────────────────

const planOf = (over: Omit<Partial<PlanSummary>, "totals"> & { totals?: Partial<PlanSummary["totals"]> } = {}): PlanSummary => ({
  stops: over.stops ?? [],
  totals: { walkMinutes: 30, shortestWalkMinutes: 20, budgetMinutes: null, withinBudget: true, ...over.totals },
  coverage: over.coverage ?? [],
  skipped: over.skipped ?? [],
});

test("planning facts: required items placed, overhead, budget, loops", () => {
  const e = expected([exp(["tourism=museum"], { required: true }), exp(["amenity=bench"], { required: false }), exp(["amenity=bar"], { required: true })]);
  const p = produced([prod("i1", [{ tourism: "museum" }]), prod("i2", [{ amenity: "bench" }])]);
  const pairs = assignItems(p.items, e.items);
  const f = planningFacts(e, p, pairs, planOf({ stops: [{ itemId: "i1" }], skipped: [{ itemId: "i2", reason: "optional_too_far" }] }));
  // The bar was not understood, so it does not count against the planner.
  assert.equal(f.requiredUnderstood, 1);
  assert.equal(f.requiredWithStop, 1);
  assert.equal(f.walkOverhead, 1.5);
  assert.equal(f.withinBudget, null);

  const loop = planningFacts(e, p, pairs, planOf({ totals: { shortestWalkMinutes: 0, budgetMinutes: 60, withinBudget: false } }));
  assert.equal(loop.walkOverhead, null);
  assert.equal(loop.withinBudget, false);
  assert.equal(loop.requiredWithStop, 0);

  const sum = summarizePlanning(3, [f, loop], [100, 200, 300], [10, 20]);
  assert.deepEqual(sum.success, ratio(2, 3));
  assert.deepEqual(sum.requiredAllPlaced, ratio(1, 2));
  assert.deepEqual(sum.withinBudget, ratio(0, 1));
  assert.equal(sum.walkOverhead.n, 1);
  assert.deepEqual(sum.skipReasons.counts, { optional_too_far: 1 });
  assert.equal(sum.understandMs.median, 200);
});

test("street coverage is averaged per property over the plans that have it", () => {
  const e = expected([]), p = produced([]);
  const a = planningFacts(e, p, [], planOf({ coverage: [{ property: "lit", goodPercent: 60, badPercent: 10, unknownPercent: 30 }] }));
  const b = planningFacts(e, p, [], planOf({ coverage: [{ property: "lit", goodPercent: 80, badPercent: 0, unknownPercent: 20 }] }));
  const c = planningFacts(e, p, [], planOf());
  const sum = summarizePlanning(3, [a, b, c], [], []);
  assert.deepEqual(sum.coverage.lit, { good: 70, bad: 5, unknown: 25, n: 2 });
});

// ─── Case validation ────────────────────────────────────────────────────────

const goodCase = {
  id: "dev-01",
  request: "a coffee then a museum",
  origin: "Piața Unirii, Cluj-Napoca",
  destination: { lat: 46.77, lng: 23.59 },
  budgetMinutes: null,
  departAt: "2026-11-20T11:00:00+02:00",
  expected: { items: [{ what: "coffee", tags: ["amenity=cafe"], order: 1 }], street: [{ property: "lit", mode: "prefer" }], unsupported: [] },
};

test("validation accepts a good case and reports bad ones by id and field", () => {
  const bad = {
    ...goodCase,
    id: "dev-02",
    departAt: "2026-11-20T11:00:00",
    expected: { items: [{ tags: ["amenity:cafe"], requried: true }], street: [{ property: "shady", mode: "prefer" }], unsupported: [] },
  };
  const { cases, problems } = validateCases([goodCase, bad, { ...goodCase }], "dev");
  // The duplicate id makes both dev-01 cases invalid.
  assert.deepEqual(cases, []);
  const fields = problems.filter((p) => p.caseId === "dev-02").map((p) => p.field).sort();
  assert.deepEqual(fields, ["departAt", "expected.items[0].requried", "expected.items[0].tags[0]", "expected.street[0].property"]);
  assert.ok(problems.some((p) => p.caseId === "dev-01" && p.field === "id"));
});

test("validation checks the id prefix only for named sets", () => {
  assert.equal(validateCases([goodCase], "test").cases.length, 0);
  assert.equal(validateCases([goodCase], null).cases.length, 1);
  assert.equal(validateCases({}, "dev").problems[0].field, "(root)");
  assert.deepEqual(validateCases([], "dev"), { cases: [], problems: [] });
});
