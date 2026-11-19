/**
 * Loads a city built by buildCity.ts into memory.
 *
 * On-disk format, in data/cities/<id>/:
 *   meta.json    counts, tag sets, the byte layout of graph.bin, build stats
 *   graph.bin    little-endian typed arrays back to back (see GRAPH_ARRAYS;
 *                edgeWayId may be missing in older builds);
 *                edges are stored once as (edgeA, edgeB) and the CSR adjacency
 *                is rebuilt at load, which is cheap and halves the file
 *   places.json  OsmPlace[] without `name` (it is tags.name)
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CityConfig, CityData, OsmPlace, StreetGraph } from "./cityTypes.js";
import { METERS_PER_DEGREE } from "./geo.js";

export const FORMAT_VERSION = 1;

export const CITIES_DIR = fileURLToPath(new URL("../../data/cities/", import.meta.url));

export function cityDir(id: string): string {
  return path.join(CITIES_DIR, id);
}

/** Order and element type of the arrays in graph.bin. */
export const GRAPH_ARRAYS = [
  { name: "lat", type: "f64", per: "node" },
  { name: "lng", type: "f64", per: "node" },
  { name: "edgeA", type: "i32", per: "edge" },
  { name: "edgeB", type: "i32", per: "edge" },
  { name: "edgeLength", type: "f32", per: "edge" },
  { name: "edgeTagSet", type: "i32", per: "edge" },
  // OSM way ids exceed the Int32 range in places, so float64 (exact for integers up to 2^53).
  { name: "edgeWayId", type: "f64", per: "edge" },
] as const;

export interface CityMeta {
  formatVersion: number;
  config: CityConfig;
  nodeCount: number;
  edgeCount: number;
  tagSets: Array<Record<string, string>>;
  layout: Array<{ name: string; type: string; byteOffset: number; length: number }>;
  stats: Record<string, unknown>;
}

/** Raw arrays as stored on disk; enough to rebuild the full graph. */
export interface GraphArrays {
  lat: Float64Array;
  lng: Float64Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLength: Float32Array;
  edgeTagSet: Int32Array;
  edgeWayId?: Float64Array;
  tagSets: Array<Record<string, string>>;
}

export type StoredPlace = Omit<OsmPlace, "name">;

export async function loadCity(id: string): Promise<CityData> {
  const dir = cityDir(id);
  let meta: CityMeta;
  try {
    meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    throw new Error(`City "${id}" is not built. Run: npm run build:city -- ${id}`);
  }
  if (meta.formatVersion !== FORMAT_VERSION) {
    throw new Error(`City "${id}" was built with an older format. Rebuild: npm run build:city -- ${id}`);
  }
  const [bin, placesText] = await Promise.all([
    readFile(path.join(dir, "graph.bin")),
    readFile(path.join(dir, "places.json"), "utf8"),
  ]);
  const arrays: Record<string, Float64Array | Float32Array | Int32Array> = {};
  for (const a of meta.layout) {
    // Copy out of the file buffer: its offset in the backing ArrayBuffer may not be aligned.
    const bytes = bin.subarray(a.byteOffset, a.byteOffset + a.length * elementSize(a.type));
    const buf = new Uint8Array(bytes).buffer;
    arrays[a.name] = a.type === "f64" ? new Float64Array(buf) : a.type === "f32" ? new Float32Array(buf) : new Int32Array(buf);
  }
  const graph = buildStreetGraph({
    lat: arrays.lat as Float64Array,
    lng: arrays.lng as Float64Array,
    edgeA: arrays.edgeA as Int32Array,
    edgeB: arrays.edgeB as Int32Array,
    edgeLength: arrays.edgeLength as Float32Array,
    edgeTagSet: arrays.edgeTagSet as Int32Array,
    edgeWayId: arrays.edgeWayId as Float64Array | undefined,
    tagSets: meta.tagSets,
  });
  const stored: StoredPlace[] = JSON.parse(placesText);
  const places: OsmPlace[] = stored.map((p) => ({ ...p, name: p.tags.name ?? null }));
  return makeCityData(meta.config, graph, places);
}

function elementSize(type: string): number {
  return type === "f64" ? 8 : 4;
}

/** Builds the CSR adjacency and spatial index from an edge list. */
export function buildStreetGraph(g: GraphArrays): StreetGraph {
  const nodeCount = g.lat.length;
  const edgeCount = g.edgeA.length;
  const adjStart = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    adjStart[g.edgeA[e] + 1]++;
    adjStart[g.edgeB[e] + 1]++;
  }
  for (let n = 0; n < nodeCount; n++) adjStart[n + 1] += adjStart[n];
  const fill = adjStart.slice(0, nodeCount);
  const adjTo = new Int32Array(2 * edgeCount);
  const adjEdge = new Int32Array(2 * edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const a = g.edgeA[e];
    const b = g.edgeB[e];
    adjTo[fill[a]] = b;
    adjEdge[fill[a]++] = e;
    adjTo[fill[b]] = a;
    adjEdge[fill[b]++] = e;
  }
  const grid = new GridIndex(g.lat, g.lng);
  return {
    nodeCount,
    edgeCount,
    lat: g.lat,
    lng: g.lng,
    adjStart,
    adjTo,
    adjEdge,
    edgeLength: g.edgeLength,
    edgeTagSet: g.edgeTagSet,
    edgeWayId: g.edgeWayId,
    tagSets: g.tagSets,
    nearestNode: (lat, lng, maxMeters) => grid.nearest(lat, lng, maxMeters),
  };
}

const GRID_CELL_METERS = 100;

/** Uniform lat/lng grid; nodes of each cell stored contiguously (CSR again). */
class GridIndex {
  private south = 0;
  private west = 0;
  private cellLat = 1;
  private cellLng = 1;
  private rows = 0;
  private cols = 0;
  private cellStart = new Int32Array(1);
  private cellNodes = new Int32Array(0);
  /** Metres per degree of longitude at the city's latitude. */
  private mPerLng = METERS_PER_DEGREE;

  constructor(private lat: Float64Array, private lng: Float64Array) {
    const n = lat.length;
    if (n === 0) return;
    let s = Infinity, w = Infinity, no = -Infinity, e = -Infinity;
    for (let i = 0; i < n; i++) {
      if (lat[i] < s) s = lat[i];
      if (lat[i] > no) no = lat[i];
      if (lng[i] < w) w = lng[i];
      if (lng[i] > e) e = lng[i];
    }
    this.mPerLng = METERS_PER_DEGREE * Math.cos((((s + no) / 2) * Math.PI) / 180);
    this.south = s;
    this.west = w;
    this.cellLat = GRID_CELL_METERS / METERS_PER_DEGREE;
    this.cellLng = GRID_CELL_METERS / this.mPerLng;
    this.rows = Math.floor((no - s) / this.cellLat) + 1;
    this.cols = Math.floor((e - w) / this.cellLng) + 1;
    const cellOf = new Int32Array(n);
    this.cellStart = new Int32Array(this.rows * this.cols + 1);
    for (let i = 0; i < n; i++) {
      const c = this.row(lat[i]) * this.cols + this.col(lng[i]);
      cellOf[i] = c;
      this.cellStart[c + 1]++;
    }
    for (let c = 0; c < this.rows * this.cols; c++) this.cellStart[c + 1] += this.cellStart[c];
    const fill = this.cellStart.slice(0, -1);
    this.cellNodes = new Int32Array(n);
    for (let i = 0; i < n; i++) this.cellNodes[fill[cellOf[i]]++] = i;
  }

  private row(lat: number): number {
    return Math.floor((lat - this.south) / this.cellLat);
  }
  private col(lng: number): number {
    return Math.floor((lng - this.west) / this.cellLng);
  }

  nearest(lat: number, lng: number, maxMeters: number): number {
    if (this.cellNodes.length === 0 || !(maxMeters >= 0)) return -1;
    const dLat = maxMeters / METERS_PER_DEGREE;
    const dLng = maxMeters / this.mPerLng;
    const r0 = Math.max(0, this.row(lat - dLat));
    const r1 = Math.min(this.rows - 1, this.row(lat + dLat));
    const c0 = Math.max(0, this.col(lng - dLng));
    const c1 = Math.min(this.cols - 1, this.col(lng + dLng));
    // Equirectangular distance: exact enough within a city, and much cheaper than haversine.
    let best = -1;
    let bestSq = maxMeters * maxMeters;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
          const i = this.cellNodes[k];
          const y = (this.lat[i] - lat) * METERS_PER_DEGREE;
          const x = (this.lng[i] - lng) * this.mPerLng;
          const sq = x * x + y * y;
          if (sq <= bestSq) {
            bestSq = sq;
            best = i;
          }
        }
      }
    }
    return best;
  }
}

export function makeCityData(config: CityConfig, graph: StreetGraph, places: OsmPlace[]): CityData {
  // Places by "key=value" and by key, so a query only scans places sharing one of its tags.
  const byKeyValue = new Map<string, OsmPlace[]>();
  const byKey = new Map<string, OsmPlace[]>();
  const push = (m: Map<string, OsmPlace[]>, k: string, p: OsmPlace) => {
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  };
  for (const p of places) {
    for (const k in p.tags) {
      push(byKey, k, p);
      push(byKeyValue, `${k}=${p.tags[k]}`, p);
    }
  }
  return {
    config,
    graph,
    places,
    placesMatching(query) {
      const entries = Object.entries(query);
      if (entries.length === 0) return places.slice();
      // Start from the smallest candidate list among the query's tags.
      let candidates: OsmPlace[] | undefined;
      for (const [k, v] of entries) {
        const list = (v === "*" ? byKey.get(k) : byKeyValue.get(`${k}=${v}`)) ?? [];
        if (!candidates || list.length < candidates.length) candidates = list;
      }
      return candidates!.filter((p) =>
        entries.every(([k, v]) => p.tags[k] !== undefined && (v === "*" || p.tags[k] === v)),
      );
    },
  };
}
