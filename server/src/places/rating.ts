/**
 * Ratings adjusted for the number of reviews (a Bayesian average, the form IMDb published for its Top 250):
 *   adjusted = (reviews × rating + m × average) / (reviews + m)
 * A 5-star rating from one review is pulled almost to the city average; a 4.5 from a thousand reviews keeps its value.
 * A place without a rating (e.g. only in OSM) counts as exactly average — unknown, not bad.
 * `average` and `m` are in params.ts.
 */
import { PARAMS } from "../params.js";

export function adjustedRating(rating: number | null, reviews: number | null): number {
  const mean = PARAMS.ratingPriorMean.value;
  if (rating == null) return mean;
  const n = Math.max(0, reviews ?? 0);
  const m = PARAMS.ratingPriorReviews.value;
  return (n * rating + m * mean) / (n + m);
}
