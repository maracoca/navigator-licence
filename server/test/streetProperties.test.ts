import { test } from "node:test";
import assert from "node:assert/strict";
import { STREET_TAG_KEYS, judgeStreet, streetProperty } from "../src/routing/streetProperties.js";

const judge = (id: string, tags: Record<string, string>) => judgeStreet(streetProperty(id)!, tags);

test("lit: tag value decides, missing tag is unknown", () => {
  assert.equal(judge("lit", { highway: "residential", lit: "yes" }), "good");
  assert.equal(judge("lit", { highway: "residential", lit: "no" }), "bad");
  assert.equal(judge("lit", { highway: "residential" }), "unknown");
});

test("paved: a rough surface is bad even when paved", () => {
  assert.equal(judge("paved", { surface: "asphalt" }), "good");
  assert.equal(judge("paved", { surface: "asphalt", smoothness: "very_bad" }), "bad");
  assert.equal(judge("paved", { surface: "gravel" }), "bad");
  assert.equal(judge("paved", { smoothness: "good" }), "good");
  assert.equal(judge("paved", { highway: "footway" }), "unknown");
});

test("no_steps: every walkable way is known", () => {
  assert.equal(judge("no_steps", { highway: "steps" }), "bad");
  assert.equal(judge("no_steps", { highway: "footway" }), "good");
});

test("quiet: main roads bad, residential and car-free good, separate sidewalks unknown", () => {
  assert.equal(judge("quiet", { highway: "primary" }), "bad");
  assert.equal(judge("quiet", { highway: "residential" }), "good");
  assert.equal(judge("quiet", { highway: "pedestrian" }), "good");
  assert.equal(judge("quiet", { highway: "footway", footway: "sidewalk" }), "unknown");
  assert.equal(judge("quiet", { highway: "unclassified" }), "unknown");
});

test("sidewalk: mapped sidewalks and car-free ways good, roads without one bad", () => {
  assert.equal(judge("sidewalk", { highway: "footway", footway: "sidewalk" }), "good");
  assert.equal(judge("sidewalk", { highway: "secondary", sidewalk: "both" }), "good");
  assert.equal(judge("sidewalk", { highway: "secondary", "sidewalk:right": "yes" }), "good");
  assert.equal(judge("sidewalk", { highway: "secondary", sidewalk: "no" }), "bad");
  assert.equal(judge("sidewalk", { highway: "secondary", sidewalk: "separate" }), "bad");
  assert.equal(judge("sidewalk", { highway: "residential" }), "unknown");
});

test("the city build keeps every key the rules read", () => {
  for (const k of ["highway", "lit", "surface", "smoothness", "footway", "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"]) {
    assert.ok(STREET_TAG_KEYS.includes(k), k);
  }
});
