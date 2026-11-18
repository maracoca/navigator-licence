import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAMS } from "../src/params.js";
import { plan, type PlanInput, type PlanResult } from "../src/planning/planner.js";
import { bruteForce, cheapestInsertion, greedy, localSearch } from "../src/planning/baselines.js";
import { syntheticProblems, toPlanInput } from "../src/eval/planner/problems.js";

function scoreOf(input: PlanInput, res: PlanResult): number[] {
  const req = res.stops.filter((s) => input.items[s.itemIndex].required).length;
  const rating = res.stops.reduce((sum, s) => sum + (input.candidates[s.itemIndex][s.candidateIndex].rating ?? 0), 0);
  return [-req, -(res.stops.length - req), res.walkMinutes - rating * PARAMS.ratingTiebreakMinutesPerStar.value];
}
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] < b[i] ? -1 : 1;
  return 0;
}

const problems = syntheticProblems(1234, 400).map(toPlanInput);
const planners = { exact: plan, greedy, insertion: cheapestInsertion, local: localSearch };

test("no planner ever beats brute force (the scoring is consistent)", () => {
  for (const input of problems) {
    const best = scoreOf(input, bruteForce(input));
    for (const [name, fn] of Object.entries(planners)) {
      assert.ok(compare(scoreOf(input, fn(input)), best) >= 0, `${name} beat brute force`);
    }
  }
});

test("every planner keeps the time budget", () => {
  for (const input of problems) {
    for (const [name, fn] of Object.entries(planners)) {
      const res = fn(input);
      if (input.budgetMinutes != null && res.stops.length) {
        const minStays = res.stops.reduce((s, x) => s + input.items[x.itemIndex].stay.min, 0);
        assert.ok(res.walkMinutes + minStays <= input.budgetMinutes + 1e-6, `${name} over budget`);
      }
      assert.equal(new Set(res.stops.map((s) => s.point)).size, res.stops.length, `${name} used a place twice`);
    }
  }
});

test("with one of each item, the exact planner always finds the best plan (ratings, optional stops and opening hours included)", () => {
  for (const input of syntheticProblems(99, 400).map(toPlanInput)) {
    for (const it of input.items) it.count = 1;
    assert.equal(compare(scoreOf(input, plan(input)), scoreOf(input, bruteForce(input))), 0);
  }
});

test("a slightly slower but better-rated way to the same step is not lost", () => {
  // start (0) → cafe A or cafe B → pharmacy (4) → end (1). A is 1 min quicker, B is rated 2 stars higher.
  const minutes = [
    [0, 30, 5, 6, 99],
    [30, 0, 99, 99, 10],
    [5, 99, 0, 99, 10],
    [6, 99, 99, 0, 10],
    [99, 10, 10, 10, 0],
  ];
  const input: PlanInput = {
    items: [
      { required: true, order: 1, count: 1, stay: { preferred: 5, min: 5 } },
      { required: true, order: 2, count: 1, stay: { preferred: 5, min: 5 } },
    ],
    candidates: [[{ point: 2, rating: 2 }, { point: 3, rating: 4 }], [{ point: 4, rating: null }]],
    minutes,
    budgetMinutes: null,
  };
  const res = plan(input);
  assert.equal(res.stops[0].point, 3);
  assert.equal(compare(scoreOf(input, res), scoreOf(input, bruteForce(input))), 0);
});
