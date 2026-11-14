import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildStreetGraph, cityDir, loadCity, makeCityData } from "../src/data/cityStore.js";
import type { CityConfig, OsmPlace, StreetGraph } from "../src/data/cityTypes.js";
import { haversineMeters } from "../src/data/geo.js";
import { PresetMatcher } from "../src/data/presetMatcher.js";

const config: CityConfig = {
  id: "test",
  name: "Test",
  extractUrl: "https://example.invalid/x.osm.pbf",
  bbox: { south: 46, west: 23, north: 47, east: 24 },
};

// A square 0-1-2-3 with a diagonal 0-2 and a tail 2-4, roughly 100 m sides.
const d = 0.0009;
function tinyGraph(): StreetGraph {
  const lat = Float64Array.from([46.5, 46.5, 46.5 + d, 46.5 + d, 46.5 + 2 * d]);
  const lng = Float64Array.from([23.5, 23.5 + d, 23.5 + d, 23.5, 23.5 + d]);
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [2, 4]];
  return buildStreetGraph({
    lat,
    lng,
    edgeA: Int32Array.from(pairs, (p) => p[0]),
    edgeB: Int32Array.from(pairs, (p) => p[1]),
    edgeLength: Float32Array.from(pairs, ([a, b]) => haversineMeters(lat[a], lng[a], lat[b], lng[b])),
    edgeTagSet: new Int32Array(pairs.length),
    tagSets: [{ highway: "footway" }],
  });
}

/** Every edge appears exactly twice in the adjacency, once from each end. */
function assertCsrConsistent(g: StreetGraph) {
  assert.equal(g.adjStart.length, g.nodeCount + 1);
  assert.equal(g.adjStart[0], 0);
  assert.equal(g.adjStart[g.nodeCount], 2 * g.edgeCount);
  const seen = new Int32Array(g.edgeCount);
  const ends: Array<[number, number]> = [];
  for (let n = 0; n < g.nodeCount; n++) {
    assert.ok(g.adjStart[n] <= g.adjStart[n + 1]);
    for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
      const e = g.adjEdge[k];
      const m = g.adjTo[k];
      seen[e]++;
      if (seen[e] === 1) ends[e] = [n, m];
      else assert.deepEqual([ends[e][1], ends[e][0]], [n, m], `edge ${e} is not symmetric`);
    }
  }
  for (let e = 0; e < g.edgeCount; e++) assert.equal(seen[e], 2, `edge ${e} listed ${seen[e]} times`);
}

test("CSR adjacency is symmetric and lists each edge from both ends", () => {
  const g = tinyGraph();
  assert.equal(g.nodeCount, 5);
  assert.equal(g.edgeCount, 6);
  assertCsrConsistent(g);
  const neighbours = (n: number) => [...g.adjTo.subarray(g.adjStart[n], g.adjStart[n + 1])].sort();
  assert.deepEqual(neighbours(2), [0, 1, 3, 4]);
  assert.deepEqual(neighbours(4), [2]);
});

test("nearestNode finds the closest node within range and -1 beyond it", () => {
  const g = tinyGraph();
  assert.equal(g.nearestNode(46.5 + d + 0.0001, 23.5 + d - 0.0001, 50), 2);
  assert.equal(g.nearestNode(46.5, 23.5, 0), 0);
  assert.equal(g.nearestNode(46.6, 23.6, 150), -1);
  // Far outside the grid, but within a huge radius: still answered.
  assert.equal(g.nearestNode(46.4, 23.5, 20_000), 0);
});

test("placesMatching supports exact values, '*' wildcards and several tags", () => {
  const place = (id: string, tags: Record<string, string>): OsmPlace => ({
    id, lat: 46.5, lng: 23.5, name: tags.name ?? null, tags, presetId: "x",
  });
  const places = [
    place("osm:n1", { amenity: "cafe", name: "A" }),
    place("osm:n2", { amenity: "cafe", cuisine: "coffee_shop" }),
    place("osm:n3", { amenity: "bench" }),
    place("osm:w4", { tourism: "museum", name: "B" }),
  ];
  const city = makeCityData(config, tinyGraph(), places);
  const ids = (q: Record<string, string>) => city.placesMatching(q).map((p) => p.id).sort();
  assert.deepEqual(ids({ amenity: "cafe" }), ["osm:n1", "osm:n2"]);
  assert.deepEqual(ids({ amenity: "*" }), ["osm:n1", "osm:n2", "osm:n3"]);
  assert.deepEqual(ids({ amenity: "cafe", cuisine: "*" }), ["osm:n2"]);
  assert.deepEqual(ids({ name: "*" }), ["osm:n1", "osm:w4"]);
  assert.deepEqual(ids({ shop: "*" }), []);
  assert.equal(city.placesMatching({}).length, 4);
});

test("preset matching prefers specific presets over catch-alls", () => {
  const m = PresetMatcher.fromSchema();
  assert.equal(m.match({ amenity: "cafe" }, ["point", "vertex"])?.id, "amenity/cafe");
  assert.equal(m.match({ amenity: "place_of_worship", religion: "christian" }, ["point"])?.id, "amenity/place_of_worship/christian");
  assert.equal(m.match({ building: "yes" }, ["line", "area"])?.id, "building");
  assert.equal(m.match({ building: "no" }, ["line", "area"]), null);
  assert.equal(m.match({ "addr:street": "X", "addr:housenumber": "1" }, ["point"])?.id, "address");
  assert.equal(m.match({ foo: "bar" }, ["point"]), null);
});

const builtId = "cluj-napoca";
const built = existsSync(path.join(cityDir(builtId), "meta.json"));

test("built city loads with a consistent graph and searchable places", { skip: !built && "city not built" }, async () => {
  const t0 = performance.now();
  const city = await loadCity(builtId);
  const ms = performance.now() - t0;
  const g = city.graph;
  assertCsrConsistent(g);
  assert.ok(g.nodeCount > 1000 && g.edgeCount > 1000);
  for (let e = 0; e < g.edgeCount; e++) {
    assert.ok(g.edgeLength[e] >= 0 && g.edgeLength[e] < 5000);
    assert.ok(g.edgeTagSet[e] >= 0 && g.edgeTagSet[e] < g.tagSets.length);
  }
  const { south, west, north, east } = city.config.bbox;
  for (let n = 0; n < g.nodeCount; n++) {
    assert.ok(g.lat[n] >= south && g.lat[n] <= north && g.lng[n] >= west && g.lng[n] <= east);
  }
  // Central Cluj (Piața Unirii) is on the street network.
  assert.notEqual(g.nearestNode(46.7694, 23.5899, 150), -1);
  const cafes = city.placesMatching({ amenity: "cafe" });
  assert.ok(cafes.length > 10);
  assert.ok(cafes.every((p) => p.tags.amenity === "cafe"));
  assert.ok(city.placesMatching({ tourism: "*" }).length >= city.placesMatching({ tourism: "museum" }).length);
  assert.ok(ms < 5000, `loading took ${ms.toFixed(0)} ms`);
});
