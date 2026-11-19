/**
 * Which streets of a planned walk the app may ask the user about ("Is this street lit?").
 *
 * Only `lit` for now. A street qualifies when the walk follows it for a useful stretch
 * (params.questionMinWayMeters) and its lighting is unknown in the map data. The answers
 * are uploaded to OpenStreetMap in the user's name (osmClient.ts).
 */
import type { StreetGraph } from "../data/cityTypes.js";
import { PARAMS } from "../params.js";
import type { LatLng, Path } from "../routing/router.js";
import { judgeStreet, streetProperty } from "../routing/streetProperties.js";

export type QuestionProperty = "lit";

export interface StreetQuestion {
  wayId: number;
  property: QuestionProperty;
  /** Street name from OSM, or null. */
  name: string | null;
  /** Metres of the walk on this street. */
  meters: number;
  /** The walked parts of the street, as [lat, lng] lines (one per stretch). */
  segments: LatLng[][];
}

export interface QuestionRules {
  maxPerWalk: number;
  minGapSeconds: number;
  showSeconds: number;
  minWalkedMeters: number;
  nearWayMeters: number;
}

export function questionRules(): QuestionRules {
  return {
    maxPerWalk: PARAMS.questionMaxPerWalk.value,
    minGapSeconds: PARAMS.questionMinGapSeconds.value,
    showSeconds: PARAMS.questionShowSeconds.value,
    minWalkedMeters: PARAMS.questionMinWalkedMeters.value,
    nearWayMeters: PARAMS.questionNearWayMeters.value,
  };
}

/** Streets on the walk whose lighting is unknown, longest stretch first. Empty when the city has no way ids. */
export function streetQuestions(graph: StreetGraph, paths: Path[]): StreetQuestion[] {
  const wayIds = graph.edgeWayId;
  if (!wayIds) return [];
  const lit = streetProperty("lit")!;
  const byWay = new Map<number, StreetQuestion>();
  for (const path of paths) {
    let current: { wayId: number; points: LatLng[] } | null = null;
    path.edges.forEach((e, i) => {
      const wayId = wayIds[e];
      const tags = graph.tagSets[graph.edgeTagSet[e]];
      if (judgeStreet(lit, tags) !== "unknown") {
        current = null;
        return;
      }
      const a = path.nodes[i], b = path.nodes[i + 1];
      let q = byWay.get(wayId);
      if (!q) {
        q = { wayId, property: "lit", name: tags.name ?? null, meters: 0, segments: [] };
        byWay.set(wayId, q);
      }
      q.meters += graph.edgeLength[e];
      if (!current || current.wayId !== wayId) {
        current = { wayId, points: [[graph.lat[a], graph.lng[a]]] };
        q.segments.push(current.points);
      }
      current.points.push([graph.lat[b], graph.lng[b]]);
    });
  }
  return [...byWay.values()]
    .filter((q) => q.meters >= PARAMS.questionMinWayMeters.value)
    .sort((x, y) => y.meters - x.meters)
    .slice(0, PARAMS.questionCandidates.value)
    .map((q) => ({ ...q, meters: Math.round(q.meters) }));
}
