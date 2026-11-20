/**
 * The app's own copy of street answers, so the next plan uses them at once
 * (the city files only pick up OSM changes when the city is rebuilt).
 *
 * Kept in data/street-answers.jsonl, one answer per line; applied to the loaded
 * street graph at server start and whenever new answers arrive. Only the API
 * server applies them; evaluations load the city as built.
 */
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { StreetGraph } from "../data/cityTypes.js";
import type { StreetAnswer, UploadResult } from "./osmClient.js";

export const ANSWERS_FILE = fileURLToPath(new URL("../../data/street-answers.jsonl", import.meta.url));

interface StoredAnswer extends StreetAnswer {
  city: string;
  mode: UploadResult["mode"];
  changesetId: number | null;
}

/** Edges of each OSM way, built on first use. */
const edgesOfWay = new WeakMap<StreetGraph, Map<number, number[]>>();

function wayIndex(graph: StreetGraph): Map<number, number[]> {
  let m = edgesOfWay.get(graph);
  if (!m) {
    m = new Map();
    const ids = graph.edgeWayId;
    if (ids) {
      for (let e = 0; e < graph.edgeCount; e++) {
        const list = m.get(ids[e]);
        if (list) list.push(e);
        else m.set(ids[e], [e]);
      }
    }
    edgesOfWay.set(graph, m);
  }
  return m;
}

/** Sets the answered tag on every edge of the way (new tag sets are added; existing ones are never changed). */
export function applyAnswer(graph: StreetGraph, a: Pick<StreetAnswer, "wayId" | "property" | "value">): number {
  const edges = wayIndex(graph).get(a.wayId) ?? [];
  const added = new Map<number, number>();
  for (const e of edges) {
    const old = graph.edgeTagSet[e];
    let ts = added.get(old);
    if (ts === undefined) {
      ts = graph.tagSets.length;
      graph.tagSets.push({ ...graph.tagSets[old], [a.property]: a.value });
      added.set(old, ts);
    }
    graph.edgeTagSet[e] = ts;
  }
  return edges.length;
}

export async function loadAnswers(graph: StreetGraph, city: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(ANSWERS_FILE, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const a = JSON.parse(line) as StoredAnswer;
    if (a.city === city) {
      applyAnswer(graph, a);
      n++;
    }
  }
  return n;
}

export async function recordAnswers(graph: StreetGraph, city: string, result: UploadResult): Promise<void> {
  if (result.applied.length === 0) return;
  const lines = result.applied.map((a) => {
    applyAnswer(graph, a);
    const stored: StoredAnswer = { ...a, city, mode: result.mode, changesetId: result.changesetId };
    return JSON.stringify(stored) + "\n";
  });
  await appendFile(ANSWERS_FILE, lines.join(""));
}
