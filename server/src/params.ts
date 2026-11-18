/**
 * Every number the app depends on, in one place.
 *
 * Each entry says where it comes from:
 *   sourced     taken from a reference (named in `note`)
 *   assumed     a design choice; the evaluation varies it to see how much it matters
 *   cost-limit  bounds API calls, memory or search time, not result quality
 */

export type Provenance = "sourced" | "assumed" | "cost-limit";

export interface Param {
  value: number;
  provenance: Provenance;
  note: string;
}

function p(value: number, provenance: Provenance, note: string): Param {
  return { value, provenance, note };
}

export const PARAMS = {
  // ── Walking ──────────────────────────────────────────────────────────────
  walkingSpeedKmh: p(
    5,
    "sourced",
    "Comfortable adult walking speed is about 1.3-1.4 m/s (Bohannon 1997, Age and Ageing 26:15-19); 5 km/h = 1.39 m/s.",
  ),
  snapMaxMeters: p(
    150,
    "assumed",
    "A place or endpoint farther than this from any walkable street is treated as unreachable.",
  ),

  // ── Street preferences ───────────────────────────────────────────────────
  preferenceMaxExtraPercent: p(
    12,
    "sourced",
    "Soft street preferences may make a walk at most this much longer than the shortest. Quercia et al. 2014 ('The Shortest Path to Happiness', ACM Hypertext) found preferred routes were on average about 12% longer than the shortest. Varied in the evaluation.",
  ),
  preferenceFactorSteps: p(
    6,
    "cost-limit",
    "How many preference strengths are tried per walk when looking for the strongest one that stays within the allowed extra length.",
  ),

  jointPreferenceStrength: p(
    0.7,
    "assumed",
    "In the joint street-preference mode, a good street counts as this fraction of its length (a bad one as length / this) when choosing stops and routes. The middle of the strengths the separate mode tries (0.5-1). Varied in the evaluation.",
  ),

  // ── Finding places ───────────────────────────────────────────────────────
  searchSlackMeters: p(
    1000,
    "assumed",
    "Without a time budget, a place is a candidate when going start → place → end is at most this much longer (straight line) than start → end.",
  ),
  candidatesPerItem: p(
    8,
    "cost-limit",
    "Closest candidates per requested item handed to the planner. Keeps the exact search small.",
  ),
  candidatesByRating: p(
    4,
    "assumed",
    "Of the candidates per item, this many are the best-rated places within reach; the rest are the ones closest to the route. Without it, small unrated places next to the route crowd out well-known ones.",
  ),
  wishCheckMaxCandidates: p(
    20,
    "cost-limit",
    "For an item with a wish ('modern', 'catholic'), at most this many candidates closest to the route are checked against the wish.",
  ),
  googleResultsPerSearch: p(20, "cost-limit", "Google Text Search returns at most 20 results per request."),
  googleTypeMinScore: p(
    0.5,
    "assumed",
    "Google is searched for an item only when one of Google's place types is at least this similar (cosine) to the item's phrase. Below it, Google has no category for the thing (e.g. a bench) and only OSM is used.",
  ),
  presetMinScore: p(
    0.35,
    "assumed",
    "An OSM kind of place is used only when it is at least this similar (cosine) to the item's phrase.",
  ),
  presetTopK: p(10, "cost-limit", "OSM kinds of place shown to the LLM when the best matches are close."),
  presetClearLead: p(
    0.05,
    "assumed",
    "If the best OSM kind of place beats the second by at least this much similarity, it is taken without asking the LLM.",
  ),
  mergeDistanceMeters: p(
    40,
    "assumed",
    "A Google place and an OSM place closer than this, with similar names, are treated as the same place.",
  ),

  // ── Stays ────────────────────────────────────────────────────────────────
  stayBriefMinutes: p(5, "assumed", "Typical stay for a 'brief' kind of place (bench, fountain, toilet). To be replaced by measured visit durations where a source exists."),
  stayShortMinutes: p(15, "assumed", "Typical stay for a 'short' kind of place (coffee to go, a shop)."),
  stayMediumMinutes: p(30, "assumed", "Typical stay for a 'medium' kind of place (a cafe, a church, a park)."),
  stayLongMinutes: p(60, "assumed", "Typical stay for a 'long' kind of place (a museum, a restaurant meal)."),
  paceQuickFactor: p(0.5, "assumed", "A stay the user calls quick is this fraction of the typical stay."),
  paceLongFactor: p(1.5, "assumed", "A stay the user calls long is this multiple of the typical stay."),
  stayStepMinutes: p(5, "assumed", "Stays are rounded to this step; also the shortest stay."),

  // ── Planner ──────────────────────────────────────────────────────────────
  optionalMaxDetourMinutes: p(
    5,
    "assumed",
    "An optional ('if there's one along the way') stop may add at most this much walking.",
  ),
  ratingPriorMean: p(
    4.35,
    "sourced",
    "Average Google rating of places in the city (measured: 1,375 rated places from the app's Google searches in Cluj, 2026-11-18). A rating from few reviews is pulled towards it; a place without a rating counts as exactly this.",
  ),
  ratingPriorReviews: p(
    50,
    "assumed",
    "How many reviews it takes before a place's own rating counts as much as the city average (the 'm' of a Bayesian average, as in IMDb's published Top 250 formula). The median place in Cluj has about 60 reviews.",
  ),
  ratingTiebreakMinutesPerStar: p(
    1,
    "assumed",
    "Between otherwise equal plans, one more star of rating is worth this many walking minutes.",
  ),
  maxStatesPerStep: p(
    50,
    "cost-limit",
    "Most ways the exact planner keeps for one step (stops done + where you stand) that are not beaten on both time and score. A safety limit for very large requests; when it is reached the plan is marked as possibly not the best.",
  ),
  maxSlots: p(7, "cost-limit", "Most stops searched exactly. Larger requests keep the first items and say so."),
  maxCountPerItem: p(5, "cost-limit", "Most stops for one item ('five museums')."),
  maxBudgetMinutes: p(600, "cost-limit", "Longest time budget accepted."),
  maxRequestChars: p(500, "cost-limit", "Longest request text accepted."),
} satisfies Record<string, Param>;

export const metersPerMinute = (): number => (PARAMS.walkingSpeedKmh.value * 1000) / 60;
