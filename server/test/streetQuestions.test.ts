import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStreetGraph } from "../src/data/cityStore.js";
import { haversineMeters } from "../src/data/geo.js";
import type { StreetGraph } from "../src/data/cityTypes.js";
import { streetQuestions } from "../src/osm/streetQuestions.js";
import { applyAnswer } from "../src/osm/answerStore.js";
import { changesetXml, uploadAnswers, wayXml, type OsmConfig, type StreetAnswer } from "../src/osm/osmClient.js";
import type { Path } from "../src/routing/router.js";

// A straight line of 5 nodes about 100 m apart: way 11 (unknown lighting) for 2 edges, way 22 (lit) for 1,
// way 33 (unknown) for 1 edge.
const d = 0.0009;
function lineGraph(): StreetGraph {
  const lat = Float64Array.from([0, 1, 2, 3, 4].map((i) => 46.5 + i * d));
  const lng = new Float64Array(5).fill(23.5);
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4]];
  return buildStreetGraph({
    lat,
    lng,
    edgeA: Int32Array.from(pairs, (p) => p[0]),
    edgeB: Int32Array.from(pairs, (p) => p[1]),
    edgeLength: Float32Array.from(pairs, ([a, b]) => haversineMeters(lat[a], lng[a], lat[b], lng[b])),
    edgeTagSet: Int32Array.from([0, 0, 1, 2]),
    edgeWayId: Float64Array.from([11, 11, 22, 33]),
    tagSets: [{ highway: "residential", name: "Strada A" }, { highway: "residential", lit: "yes" }, { highway: "footway" }],
  });
}

const walk: Path = { nodes: [0, 1, 2, 3, 4], edges: [0, 1, 2, 3], meters: 400 };

test("asks only about streets with unknown lighting, longest first, one entry per way", () => {
  const qs = streetQuestions(lineGraph(), [walk]);
  assert.deepEqual(qs.map((q) => q.wayId), [11, 33]);
  assert.equal(qs[0].name, "Strada A");
  assert.equal(qs[0].segments.length, 1);
  assert.equal(qs[0].segments[0].length, 3);
  assert.ok(qs[0].meters > qs[1].meters);
});

test("no questions when the city was built without way ids", () => {
  const g = lineGraph();
  delete g.edgeWayId;
  assert.deepEqual(streetQuestions(g, [walk]), []);
});

test("an answer is applied to every edge of the way and the street is not asked again", () => {
  const g = lineGraph();
  assert.equal(applyAnswer(g, { wayId: 11, property: "lit", value: "no" }), 2);
  assert.equal(g.tagSets[g.edgeTagSet[0]].lit, "no");
  assert.equal(g.tagSets[g.edgeTagSet[0]].name, "Strada A");
  assert.equal(g.tagSets[0].lit, undefined, "existing tag sets are not changed");
  assert.deepEqual(streetQuestions(g, [walk]).map((q) => q.wayId), [33]);
});

test("XML is escaped and keeps every node and tag", () => {
  assert.match(changesetXml('a "b" & <c>'), /v="a &quot;b&quot; &amp; &lt;c&gt;"/);
  const xml = wayXml({ id: 5, version: 3, nodes: [1, 2], tags: { highway: "footway", lit: "yes" } }, 99);
  assert.equal(xml, '<osm><way id="5" version="3" changeset="99"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="lit" v="yes"/></way></osm>');
});

// ─── Upload against a fake OSM server ───────────────────────────────────────

function fakeOsm(ways: Record<number, { version: number; tags: Record<string, string> }>, conflictOnce = new Set<number>()) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, "")}`);
    if (typeof init?.body === "string") bodies.push(init.body);
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    let m = u.match(/\/way\/(\d+)\.json$/);
    if (m) {
      const w = ways[Number(m[1])];
      return w ? json({ elements: [{ type: "way", id: Number(m[1]), version: w.version, nodes: [1, 2], tags: w.tags }] }) : new Response("", { status: 410 });
    }
    if (u.endsWith("/changeset/create")) return new Response("777", { status: 200 });
    m = u.match(/\/way\/(\d+)$/);
    if (m && method === "PUT") {
      const id = Number(m[1]);
      if (conflictOnce.delete(id)) {
        ways[id].version++;
        return new Response("Version mismatch", { status: 409 });
      }
      ways[id].version++;
      return new Response(String(ways[id].version), { status: 200 });
    }
    if (u.endsWith("/close")) return new Response("", { status: 200 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls, bodies };
}

const cfg = (upload: boolean): OsmConfig => ({ server: "https://osm.test", clientId: "x", clientSecret: null, upload });
const ans = (wayId: number, value: "yes" | "no"): StreetAnswer => ({ wayId, property: "lit", value, answeredAt: "2026-11-19T18:00:00Z" });

test("upload: one changeset, existing values are never overwritten, deleted ways skipped, changeset closed", async () => {
  const osm = fakeOsm({ 1: { version: 4, tags: { highway: "residential" } }, 2: { version: 1, tags: { highway: "footway", lit: "no" } } });
  const r = await uploadAnswers(cfg(true), "tok", [ans(1, "yes"), ans(2, "yes"), ans(3, "no")], osm.fetchFn);
  assert.equal(r.mode, "upload");
  assert.equal(r.changesetId, 777);
  assert.deepEqual(r.applied.map((a) => a.wayId), [1]);
  assert.deepEqual(r.skipped.map((s) => s.wayId), [2, 3]);
  assert.match(r.skipped[0].reason, /someone else/);
  assert.equal(osm.calls.filter((c) => c.endsWith("/changeset/create")).length, 1);
  assert.ok(osm.calls.at(-1)!.endsWith("/changeset/777/close"));
  assert.ok(osm.bodies.some((b) => b.includes('<way id="1" version="4" changeset="777">') && b.includes('<tag k="lit" v="yes"/>')));
});

test("upload: a version conflict re-reads the way and retries once", async () => {
  const osm = fakeOsm({ 1: { version: 4, tags: { highway: "residential" } } }, new Set([1]));
  const r = await uploadAnswers(cfg(true), "tok", [ans(1, "no")], osm.fetchFn);
  assert.deepEqual(r.applied.map((a) => a.wayId), [1]);
  assert.ok(osm.bodies.some((b) => b.includes('version="5"')));
});

test("dry run writes nothing and opens no changeset; the last answer for a way wins", async () => {
  const osm = fakeOsm({ 1: { version: 4, tags: { highway: "residential" } } });
  const r = await uploadAnswers(cfg(false), "tok", [ans(1, "yes"), ans(1, "no")], osm.fetchFn);
  assert.equal(r.mode, "dry-run");
  assert.equal(r.changesetId, null);
  assert.deepEqual(r.applied.map((a) => a.value), ["no"]);
  assert.ok(osm.calls.every((c) => c.startsWith("GET")));
  assert.match(r.preview![0], /<tag k="lit" v="no"\/>/);
});

test("no changeset is opened when nothing needs uploading", async () => {
  const osm = fakeOsm({ 2: { version: 1, tags: { lit: "yes" } } });
  const r = await uploadAnswers(cfg(true), "tok", [ans(2, "yes")], osm.fetchFn);
  assert.equal(r.changesetId, null);
  assert.equal(r.skipped[0].reason, "already recorded");
  assert.ok(!osm.calls.some((c) => c.includes("changeset")));
});
