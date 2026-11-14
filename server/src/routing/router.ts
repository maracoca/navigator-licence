/**
 * Walking routes on the city's street graph.
 *
 * Without street preferences every street costs its length. With them:
 *  - "require": streets with a bad value are not used at all;
 *  - "prefer":  among walks at most X% longer than the shortest
 *    (params.preferenceMaxExtraPercent), take the one that uses the most
 *    good streets. Done by trying preference strengths from strongest to
 *    weakest and keeping the first walk that fits.
 */
import type { StreetGraph } from "../data/cityTypes.js";
import { PARAMS } from "../params.js";
import { judgeStreet, streetProperty, type StreetProperty } from "./streetProperties.js";
import type { StreetPreference } from "../types.js";

export type LatLng = [number, number];

// ─── Binary heap keyed by cost ──────────────────────────────────────────────

class Heap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  push(node: number, key: number): void {
    const n = this.nodes, k = this.keys;
    n.push(node);
    k.push(key);
    let i = n.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [n[p], n[i]] = [n[i], n[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const n = this.nodes, k = this.keys;
    const top: [number, number] = [n[0], k[0]];
    const lastN = n.pop()!, lastK = k.pop()!;
    if (n.length) {
      n[0] = lastN;
      k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n.length && k[l] < k[m]) m = l;
        if (r < n.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [n[m], n[i]] = [n[i], n[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

// ─── Edge costs from preferences ────────────────────────────────────────────

export interface CostModel {
  /** Multiplier per edge; Infinity = not walkable for this request. */
  factor: Float32Array;
}

interface ActivePreference {
  prop: StreetProperty;
  mode: "prefer" | "require";
}

function active(prefs: StreetPreference[]): ActivePreference[] {
  return prefs
    .map((p) => ({ prop: streetProperty(p.property)!, mode: p.mode }))
    .filter((p) => p.prop);
}

/**
 * strength 1 = plain length; strength s < 1 = good streets cost s per metre,
 * bad streets 1/s, unknown streets 1. Required properties remove bad streets.
 */
export function costModel(graph: StreetGraph, prefs: StreetPreference[], strength: number): CostModel {
  const list = active(prefs);
  const perTagSet = graph.tagSets.map((tags) => {
    let f = 1;
    for (const { prop, mode } of list) {
      const j = judgeStreet(prop, tags);
      if (mode === "require" && j === "bad") return Infinity;
      if (mode === "prefer" && strength < 1) {
        if (j === "good") f *= strength;
        else if (j === "bad") f /= strength;
      }
    }
    return f;
  });
  const factor = new Float32Array(graph.edgeCount);
  for (let e = 0; e < graph.edgeCount; e++) factor[e] = perTagSet[graph.edgeTagSet[e]];
  return { factor };
}

export function hasSoftPreference(prefs: StreetPreference[]): boolean {
  return prefs.some((p) => p.mode === "prefer");
}

// ─── Shortest paths ─────────────────────────────────────────────────────────

export interface Tree {
  cost: Float64Array;
  /** Real metres along the chosen path (differs from cost when preferences apply). */
  meters: Float64Array;
  prevEdge: Int32Array;
  prevNode: Int32Array;
}

/** Dijkstra from one node; stops once every target is settled. */
export function shortestTree(graph: StreetGraph, cost: CostModel, source: number, targets?: number[]): Tree {
  const n = graph.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const meters = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const prevNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const want = targets ? new Set(targets) : null;
  let remaining = want ? want.size : Infinity;

  dist[source] = 0;
  meters[source] = 0;
  const heap = new Heap();
  heap.push(source, 0);
  while (heap.size) {
    const [u, d] = heap.pop();
    if (done[u] || d > dist[u]) continue;
    done[u] = 1;
    if (want?.has(u) && --remaining === 0) break;
    for (let i = graph.adjStart[u]; i < graph.adjStart[u + 1]; i++) {
      const e = graph.adjEdge[i];
      const f = cost.factor[e];
      if (f === Infinity) continue;
      const v = graph.adjTo[i];
      const nd = d + graph.edgeLength[e] * f;
      if (nd < dist[v]) {
        dist[v] = nd;
        meters[v] = meters[u] + graph.edgeLength[e];
        prevEdge[v] = e;
        prevNode[v] = u;
        heap.push(v, nd);
      }
    }
  }
  return { cost: dist, meters, prevEdge, prevNode };
}

export interface Path {
  nodes: number[];
  edges: number[];
  meters: number;
}

export function pathTo(tree: Tree, target: number): Path | null {
  if (tree.meters[target] === Infinity) return null;
  const nodes = [target];
  const edges: number[] = [];
  let v = target;
  while (tree.prevNode[v] !== -1) {
    edges.push(tree.prevEdge[v]);
    v = tree.prevNode[v];
    nodes.push(v);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse(), meters: tree.meters[target] };
}

// ─── Walk between two nodes, honouring preferences ──────────────────────────

/** Preference strengths tried, strongest first; the last one (1) is plain length. */
export function strengths(): number[] {
  const steps = Math.max(2, PARAMS.preferenceFactorSteps.value);
  return Array.from({ length: steps }, (_, i) => 0.5 + (0.5 * i) / (steps - 1));
}

export interface Leg {
  path: Path;
  /** Length of the shortest walk allowed by the hard requirements. */
  shortestMeters: number;
}

export function walkLeg(graph: StreetGraph, prefs: StreetPreference[], from: number, to: number, hardOnly: CostModel): Leg | null {
  const base = pathTo(shortestTree(graph, hardOnly, from, [to]), to);
  if (!base) return null;
  if (!hasSoftPreference(prefs) || from === to) return { path: base, shortestMeters: base.meters };
  const limit = base.meters * (1 + PARAMS.preferenceMaxExtraPercent.value / 100);
  for (const s of strengths()) {
    if (s >= 1) break;
    const p = pathTo(shortestTree(graph, costModel(graph, prefs, s), from, [to]), to);
    if (p && p.meters <= limit) return { path: p, shortestMeters: base.meters };
  }
  return { path: base, shortestMeters: base.meters };
}

export function pathPoints(graph: StreetGraph, path: Path): LatLng[] {
  return path.nodes.map((n) => [graph.lat[n], graph.lng[n]]);
}

// ─── Coverage: how much of a walk has each requested property ───────────────

export interface Coverage {
  property: string;
  label: string;
  goodWord: string;
  badWord: string;
  goodPercent: number;
  badPercent: number;
  unknownPercent: number;
}

export function coverage(graph: StreetGraph, prefs: StreetPreference[], paths: Path[]): Coverage[] {
  return active(prefs).map(({ prop }) => {
    let good = 0, bad = 0, unknown = 0;
    for (const p of paths) {
      for (const e of p.edges) {
        const len = graph.edgeLength[e];
        const j = judgeStreet(prop, graph.tagSets[graph.edgeTagSet[e]]);
        if (j === "good") good += len;
        else if (j === "bad") bad += len;
        else unknown += len;
      }
    }
    const total = good + bad + unknown || 1;
    const pct = (x: number) => Math.round((100 * x) / total);
    return { property: prop.id, label: prop.label, goodWord: prop.goodWord, badWord: prop.badWord, goodPercent: pct(good), badPercent: pct(bad), unknownPercent: pct(unknown) };
  });
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
