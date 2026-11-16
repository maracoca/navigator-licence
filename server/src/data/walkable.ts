/** Which OSM ways a person can walk on. Shared by the city build and the street-tag report. */

const WALKABLE_HIGHWAYS = new Set([
  "footway", "pedestrian", "path", "steps", "living_street", "residential", "service",
  "unclassified", "tertiary", "secondary", "primary", "track", "cycleway", "bridleway",
  "corridor", "road", "tertiary_link", "secondary_link", "primary_link",
]);
const FOOT_ALLOWED = new Set(["yes", "designated", "permissive"]);

export function isWalkable(tags: Record<string, string>): boolean {
  if (!WALKABLE_HIGHWAYS.has(tags.highway)) return false;
  const foot = tags.foot;
  if (foot === "no" || foot === "private") return false;
  if ((tags.access === "no" || tags.access === "private") && !FOOT_ALLOWED.has(foot)) return false;
  return true;
}
