import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, type PlanInput, type PlanItem } from "../src/planning/planner.js";

/** Points on a line; walking minutes = distance. 0 = start (x=0), 1 = end (x=10). */
function lineMatrix(xs: number[]): number[][] {
  return xs.map((a) => xs.map((b) => Math.abs(a - b)));
}

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  required: true,
  order: null,
  count: 1,
  stay: { preferred: 10, min: 10 },
  ...over,
});

test("picks the place that adds the least walking", () => {
  // points: start 0, end 10, cafe A at 5 (on the way), cafe B at 20 (behind the end)
  const input: PlanInput = {
    items: [item()],
    candidates: [[{ point: 2, rating: null }, { point: 3, rating: null }]],
    minutes: lineMatrix([0, 10, 5, 20]),
    budgetMinutes: null,
  };
  const r = plan(input);
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].point, 2);
  assert.equal(r.walkMinutes, 10);
  assert.equal(r.totalMinutes, 20);
});

test("respects the requested order even when it costs more walking", () => {
  // museum at 8, coffee at 2; the user wants museum first, then coffee.
  const input: PlanInput = {
    items: [item({ order: 1 }), item({ order: 2 })],
    candidates: [[{ point: 2, rating: null }], [{ point: 3, rating: null }]],
    minutes: lineMatrix([0, 10, 8, 2]),
    budgetMinutes: null,
  };
  const r = plan(input);
  assert.deepEqual(r.stops.map((s) => s.itemIndex), [0, 1]);
  assert.equal(r.walkMinutes, 8 + 6 + 8);
});

test("drops an optional stop whose detour is too long", () => {
  const input: PlanInput = {
    items: [item({ required: false, stay: { preferred: 5, min: 5 } })],
    candidates: [[{ point: 2, rating: null }]],
    minutes: lineMatrix([0, 10, -4]), // 8 extra minutes there and back
    budgetMinutes: null,
  };
  const r = plan(input);
  assert.equal(r.stops.length, 0);
  assert.equal(r.missing[0].reason, "optional_too_far");
});

test("shortens a flexible stay to fit the budget, never below its minimum", () => {
  const input: PlanInput = {
    items: [item({ stay: { preferred: 60, min: 30 } })],
    candidates: [[{ point: 2, rating: null }]],
    minutes: lineMatrix([0, 10, 5]),
    budgetMinutes: 55,
  };
  const r = plan(input);
  assert.equal(r.stops[0].stayMinutes, 45);
  assert.equal(r.totalMinutes, 55);
  assert.equal(r.staysShortened, true);
});

test("keeps required stops ahead of optional ones when time is short", () => {
  const input: PlanInput = {
    items: [item({ stay: { preferred: 20, min: 20 } }), item({ required: false, stay: { preferred: 20, min: 20 } })],
    candidates: [[{ point: 2, rating: null }], [{ point: 3, rating: null }]],
    minutes: lineMatrix([0, 10, 4, 6]),
    budgetMinutes: 35,
  };
  const r = plan(input);
  assert.deepEqual(r.stops.map((s) => s.itemIndex), [0]);
  assert.equal(r.missing[0].itemIndex, 1);
  assert.equal(r.missing[0].reason, "over_budget");
});

test("uses different places for an item asked twice", () => {
  const input: PlanInput = {
    items: [item({ count: 2, stay: { preferred: 5, min: 5 } })],
    candidates: [[{ point: 2, rating: null }, { point: 3, rating: null }, { point: 4, rating: null }]],
    minutes: lineMatrix([0, 10, 3, 6, 30]),
    budgetMinutes: null,
  };
  const r = plan(input);
  assert.deepEqual(r.stops.map((s) => s.point).sort(), [2, 3]);
});

test("skips a place that is closed when we would arrive", () => {
  const input: PlanInput = {
    items: [item()],
    candidates: [[
      { point: 2, rating: null, isOpen: () => false },
      { point: 3, rating: null },
    ]],
    minutes: lineMatrix([0, 10, 5, 7]),
    budgetMinutes: null,
  };
  const r = plan(input);
  assert.equal(r.stops[0].point, 3);
});

test("reports when nothing was found", () => {
  const r = plan({ items: [item()], candidates: [[]], minutes: lineMatrix([0, 10]), budgetMinutes: null });
  assert.equal(r.missing[0].reason, "no_candidates");
  assert.equal(r.walkMinutes, 10);
});

test("asking for two of something is not reported as a cut request", () => {
  const r = plan({
    items: [item({ count: 2, stay: { preferred: 5, min: 5 } })],
    candidates: [[{ point: 2, rating: null }, { point: 3, rating: null }]],
    minutes: lineMatrix([0, 10, 3, 6]),
    budgetMinutes: null,
  });
  assert.equal(r.truncated, false);
});
