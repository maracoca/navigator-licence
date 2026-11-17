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

test("without the rating tie-break, optional stops and repeated items, the exact planner always finds the best plan", () => {
  const saved = PARAMS.ratingTiebreakMinutesPerStar.value;
  (PARAMS.ratingTiebreakMinutesPerStar as { value: number }).value = 0;
  try {
    for (const input of problems) {
      for (const it of input.items) {
        it.required = true;
        it.count = 1;
      }
      assert.equal(compare(scoreOf(input, plan(input)), scoreOf(input, bruteForce(input))), 0);
    }
  } finally {
    (PARAMS.ratingTiebreakMinutesPerStar as { value: number }).value = saved;
  }
});
