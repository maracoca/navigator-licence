import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustedRating } from "../src/places/rating.js";
import { PARAMS } from "../src/params.js";

const mean = PARAMS.ratingPriorMean.value;

test("a perfect rating from one review stays close to the average", () => {
  assert.ok(Math.abs(adjustedRating(5, 1) - mean) < 0.05);
});

test("a rating from many reviews keeps its value", () => {
  assert.ok(Math.abs(adjustedRating(4.5, 1300) - 4.5) < 0.01);
});

test("a well-proven 4.5 beats a 5.0 from two reviews", () => {
  assert.ok(adjustedRating(4.5, 1300) > adjustedRating(5, 2));
});

test("a place without a rating counts as exactly average", () => {
  assert.equal(adjustedRating(null, null), mean);
});

test("with m reviews the rating sits halfway between its own value and the average", () => {
  const m = PARAMS.ratingPriorReviews.value;
  assert.ok(Math.abs(adjustedRating(5, m) - (5 + mean) / 2) < 1e-9);
});
