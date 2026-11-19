/**
 * Builds one city's offline data from an OSM extract.
 *
 *   npm run build:city -- cluj-napoca
 *
 * One streaming pass over the .osm.pbf (sorted nodes -> ways -> relations):
 * nodes inside the bbox are remembered, ways become walking edges and/or
 * places, relations are only counted. Output goes to data/cities/<id>/
 * in the format described in cityStore.ts.
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createOSMStream } from "osm-pbf-parser-node";
import type { BBox, CityConfig } from "./cityTypes.js";
import { CityMeta, FORMAT_VERSION, GRAPH_ARRAYS, StoredPlace, cityDir } from "./cityStore.js";
import { haversineMeters } from "./geo.js";
import { isWalkable } from "./walkable.js";
import { Geometry, Preset, PresetMatcher } from "./presetMatcher.js";
import { STREET_TAG_KEYS } from "../routing/streetProperties.js";

const SERVER_DIR = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG_FILE = path.join(SERVER_DIR, "config", "cities.json");
const RAW_DIR = path.join(SERVER_DIR, "data", "raw");


type Tags = Record<string, string>;
interface OsmNode { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
interface OsmWay { type: "way"; id: number; refs: number[]; tags?: Tags }
interface OsmRelation { type: "relation"; id: number; members: Array<{ type: string; ref: number; role: string }>; tags?: Tags }
type OsmItem = OsmNode | OsmWay | OsmRelation | { type?: undefined };

export async function loadCityConfig(id: string): Promise<CityConfig> {
  const all: CityConfig[] = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  const config = all.find((c) => c.id === id);
  if (!config) throw new Error(`Unknown city "${id}". Known: ${all.map((c) => c.id).join(", ")}`);
  return config;
}

async function ensureExtract(url: string): Promise<string> {
  const file = path.join(RAW_DIR, path.basename(new URL(url).pathname));
  if (existsSync(file)) return file;
  await mkdir(RAW_DIR, { recursive: true });
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  // Download beside the target and rename, so a broken download is never mistaken for an extract.
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  await rename(part, file);
  return file;
}


function inBBox(b: BBox, lat: number, lng: number): boolean {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

/** Why a matched element is not kept as a place, or null if it is kept. */
function placeRejection(preset: Preset, tags: Tags): string | null {
  if (!preset.searchable) return "preset not searchable";
  const g = preset.geometry;
  if (g.every((x) => x === "line")) return "preset is line-only";
  if (g.every((x) => x === "vertex")) return "preset is vertex-only";
  // Bare buildings would flood the place list; named ones are landmarks.
  if (!tags.name && preset.id.startsWith("building")) return "unnamed building";
  // Same reason, stated generally: an unnamed element that only matches a key-is-present
  // preset (address-only points, barrier=access, ...) is not something to visit.
  if (!tags.name && preset.generic) return "unnamed, generic preset";
  return null;
}

function topKey(presetId: string): string {
  return presetId.split("/")[0];
}

function increment(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function round7(x: number): number {
  return Math.round(x * 1e7) / 1e7;
}

async function build(id: string) {
  const t0 = performance.now();
  const config = await loadCityConfig(id);
  const extract = await ensureExtract(config.extractUrl);
  const bbox = config.bbox;
  const matcher = PresetMatcher.fromSchema();
  const streetKeys = STREET_TAG_KEYS;

  // Nodes inside the bbox, indexed in arrival order.
  const nodeIndex = new Map<number, number>();
  const nodeLat: number[] = [];
  const nodeLng: number[] = [];

  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeLen: number[] = [];
  const edgeTag: number[] = [];
  const edgeWay: number[] = [];
  const tagSets: Tags[] = [];
  const tagSetIndex = new Map<string, number>();
  let streetWays = 0;

  const places: StoredPlace[] = [];
  const rejected = new Map<string, number>();
  const rejectedPresets = new Map<string, number>();
  const waysInBBox = new Set<number>();
  let relationsSkipped = 0;
  const relationsSkippedByKey = new Map<string, number>();

  const pointGeoms: Geometry[] = ["point", "vertex"];
  const openWayGeoms: Geometry[] = ["line"];
  const closedWayGeoms: Geometry[] = ["line", "area"];

  const consider = (osmId: string, tags: Tags, geoms: Geometry[], lat: number, lng: number) => {
    const preset = matcher.match(tags, geoms);
    if (!preset) return;
    const why = placeRejection(preset, tags);
    if (why) {
      increment(rejected, why);
      increment(rejectedPresets, `${why}: ${preset.id}`);
      return;
    }
    places.push({ id: osmId, lat: round7(lat), lng: round7(lng), tags, presetId: preset.id });
  };

  let phase = "";
  let seen = 0;
  for await (const raw of createOSMStream(extract)) {
    const item = raw as OsmItem;
    if (item.type !== phase && item.type) {
      phase = item.type;
      console.log(`  ${((performance.now() - t0) / 1000).toFixed(0)}s: reading ${phase}s`);
    }
    if (++seen % 5_000_000 === 0) console.log(`  ${((performance.now() - t0) / 1000).toFixed(0)}s: ${seen / 1e6}M elements`);

    if (item.type === "node") {
      if (!inBBox(bbox, item.lat, item.lon)) continue;
      nodeIndex.set(item.id, nodeLat.length);
      nodeLat.push(item.lat);
      nodeLng.push(item.lon);
      if (item.tags) consider(`osm:n${item.id}`, item.tags, pointGeoms, item.lat, item.lon);
    } else if (item.type === "way") {
      const refs = item.refs;
      const idx = refs.map((r) => nodeIndex.get(r) ?? -1);
      if (!idx.some((i) => i >= 0)) continue;
      waysInBBox.add(item.id);
      const tags = item.tags;
      if (!tags) continue;

      if (isWalkable(tags)) {
        streetWays++;
        const kept: Tags = {};
        for (const k of streetKeys) if (tags[k] !== undefined) kept[k] = tags[k];
        const key = JSON.stringify(kept);
        let ts = tagSetIndex.get(key);
        if (ts === undefined) {
          ts = tagSets.length;
          tagSets.push(kept);
          tagSetIndex.set(key, ts);
        }
        // Pairs with a node outside the bbox are dropped, which cuts the way at the border.
        for (let i = 0; i + 1 < idx.length; i++) {
          const a = idx[i];
          const b = idx[i + 1];
          if (a < 0 || b < 0 || a === b) continue;
          edgeA.push(a);
          edgeB.push(b);
          edgeLen.push(haversineMeters(nodeLat[a], nodeLng[a], nodeLat[b], nodeLng[b]));
          edgeTag.push(ts);
          edgeWay.push(item.id);
        }
      }

      const closed = refs.length > 2 && refs[0] === refs[refs.length - 1];
      // A closed way repeats its first node; count it once in the average.
      const end = closed ? idx.length - 1 : idx.length;
      let sLat = 0, sLng = 0, n = 0;
      for (let i = 0; i < end; i++) {
        if (idx[i] < 0) continue;
        sLat += nodeLat[idx[i]];
        sLng += nodeLng[idx[i]];
        n++;
      }
      consider(`osm:w${item.id}`, tags, closed ? closedWayGeoms : openWayGeoms, sLat / n, sLng / n);
    } else if (item.type === "relation") {
      // Only multipolygons describe a place's area; routes, restrictions etc. are not places.
      if (item.tags?.type !== "multipolygon") continue;
      const touches = item.members.some((m) =>
        m.type === "way" ? waysInBBox.has(m.ref) : m.type === "node" ? nodeIndex.has(m.ref) : false,
      );
      if (!touches) continue;
      const preset = matcher.match(item.tags, ["area"]);
      if (preset && !placeRejection(preset, item.tags)) {
        relationsSkipped++;
        increment(relationsSkippedByKey, topKey(preset.id));
      }
    }
  }
  const tParsed = performance.now();

  // Keep only the largest connected component, so a route never starts on an island.
  const rawNodes = nodeLat.length;
  const parent = new Int32Array(rawNodes);
  for (let i = 0; i < rawNodes; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let e = 0; e < edgeA.length; e++) {
    const ra = find(edgeA[e]);
    const rb = find(edgeB[e]);
    if (ra !== rb) parent[ra] = rb;
  }
  const used = new Uint8Array(rawNodes);
  for (let e = 0; e < edgeA.length; e++) used[edgeA[e]] = used[edgeB[e]] = 1;
  const compSize = new Map<number, number>();
  for (let i = 0; i < rawNodes; i++) if (used[i]) {
    const r = find(i);
    compSize.set(r, (compSize.get(r) ?? 0) + 1);
  }
  let mainRoot = -1;
  let mainSize = 0;
  for (const [root, size] of compSize) if (size > mainSize) [mainRoot, mainSize] = [root, size];
  const usedNodes = used.reduce((s, x) => s + x, 0);

  const remap = new Int32Array(rawNodes).fill(-1);
  const lat: number[] = [];
  const lng: number[] = [];
  for (let i = 0; i < rawNodes; i++) {
    if (used[i] && find(i) === mainRoot) {
      remap[i] = lat.length;
      lat.push(nodeLat[i]);
      lng.push(nodeLng[i]);
    }
  }
  const keptEdges: number[] = [];
  for (let e = 0; e < edgeA.length; e++) if (remap[edgeA[e]] >= 0) keptEdges.push(e);
  const E = keptEdges.length;
  const out = {
    lat: Float64Array.from(lat),
    lng: Float64Array.from(lng),
    edgeA: Int32Array.from(keptEdges, (e) => remap[edgeA[e]]),
    edgeB: Int32Array.from(keptEdges, (e) => remap[edgeB[e]]),
    edgeLength: Float32Array.from(keptEdges, (e) => edgeLen[e]),
    edgeTagSet: Int32Array.from(keptEdges, (e) => edgeTag[e]),
    edgeWayId: Float64Array.from(keptEdges, (e) => edgeWay[e]),
  };

  // Drop tag sets no kept edge uses and renumber the rest.
  const tsRemap = new Int32Array(tagSets.length).fill(-1);
  const keptTagSets: Tags[] = [];
  for (let e = 0; e < E; e++) {
    const t = out.edgeTagSet[e];
    if (tsRemap[t] < 0) {
      tsRemap[t] = keptTagSets.length;
      keptTagSets.push(tagSets[t]);
    }
    out.edgeTagSet[e] = tsRemap[t];
  }

  // Share of walkable length that carries each preference key.
  let totalLength = 0;
  const lengthWithKey: Record<string, number> = {};
  const coverageKeys = streetKeys.filter((k) => k !== "highway" && k !== "name");
  for (const k of coverageKeys) lengthWithKey[k] = 0;
  for (let e = 0; e < E; e++) {
    const len = out.edgeLength[e];
    totalLength += len;
    const t = keptTagSets[out.edgeTagSet[e]];
    for (const k of coverageKeys) if (t[k] !== undefined) lengthWithKey[k] += len;
  }
  const coverage: Record<string, number> = {};
  for (const k of coverageKeys) coverage[k] = round6(lengthWithKey[k] / totalLength);

  const placesByKey = new Map<string, number>();
  const placesByPreset = new Map<string, number>();
  for (const p of places) {
    increment(placesByKey, topKey(p.presetId));
    increment(placesByPreset, p.presetId);
  }

  const stats = {
    builtAt: new Date().toISOString(),
    extract: path.basename(extract),
    nodesInBBox: rawNodes,
    streetWays,
    nodesOnStreets: usedNodes,
    edgesBeforeComponentFilter: edgeA.length,
    components: compSize.size,
    nodesRemovedOutsideLargestComponent: usedNodes - lat.length,
    edgesRemovedOutsideLargestComponent: edgeA.length - E,
    totalStreetLengthKm: round4(totalLength / 1000),
    streetKeyCoverageByLength: coverage,
    places: places.length,
    placesByTopKey: Object.fromEntries([...placesByKey].sort((a, b) => b[1] - a[1])),
    topPresets: Object.fromEntries([...placesByPreset].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    matchedButRejected: Object.fromEntries(rejected),
    topRejectedPresets: Object.fromEntries([...rejectedPresets].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    relationsSkipped,
    relationsSkippedByTopKey: Object.fromEntries([...relationsSkippedByKey].sort((a, b) => b[1] - a[1])),
    parseSeconds: round4((tParsed - t0) / 1000),
  };

  const dir = cityDir(id);
  await mkdir(dir, { recursive: true });
  const layout: CityMeta["layout"] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const a of GRAPH_ARRAYS) {
    // Typed arrays are written in host byte order; every platform Node targets here is little-endian.
    const arr = out[a.name];
    layout.push({ name: a.name, type: a.type, byteOffset: offset, length: arr.length });
    chunks.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
    offset += arr.byteLength;
  }
  const meta: CityMeta = {
    formatVersion: FORMAT_VERSION,
    config,
    nodeCount: lat.length,
    edgeCount: E,
    tagSets: keptTagSets,
    layout,
    stats: { ...stats, buildSeconds: round4((performance.now() - t0) / 1000) },
  };
  await writeFile(path.join(dir, "graph.bin"), Buffer.concat(chunks));
  await writeFile(path.join(dir, "places.json"), JSON.stringify(places));
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));

  const size = async (f: string) => ((await stat(path.join(dir, f))).size / 1e6).toFixed(2) + " MB";
  console.log(`\n${config.name} built in ${((performance.now() - t0) / 1000).toFixed(1)} s -> ${dir}`);
  console.log(`  graph:   ${lat.length} nodes, ${E} edges, ${keptTagSets.length} tag sets, ${(totalLength / 1000).toFixed(0)} km`);
  console.log(`  removed: ${compSize.size - 1} smaller components (${stats.nodesRemovedOutsideLargestComponent} nodes, ${stats.edgesRemovedOutsideLargestComponent} edges)`);
  console.log(`  coverage by length: ${coverageKeys.map((k) => `${k} ${(coverage[k] * 100).toFixed(2)}%`).join(", ")}`);
  console.log(`  places:  ${places.length}`, stats.placesByTopKey);
  console.log(`  top presets:`, stats.topPresets);
  console.log(`  rejected matches:`, stats.matchedButRejected);
  console.log(`  top rejected presets:`, stats.topRejectedPresets);
  console.log(`  relations skipped: ${relationsSkipped}`, stats.relationsSkippedByTopKey);
  for (const f of ["graph.bin", "places.json", "meta.json"]) console.log(`  ${f}: ${await size(f)}`);
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

// Run only when started as a script, so other scripts can import loadCityConfig without building.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npm run build:city -- <city-id>");
    process.exit(1);
  }
  build(id).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
