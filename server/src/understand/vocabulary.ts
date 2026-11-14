/**
 * The two place vocabularies the app searches: OSM kinds of place (iD
 * presets, maintained by OSM contributors) and Google place types.
 *
 * Each entry gets one line of text ("Cafe — bistro, coffee, espresso"), the
 * line is embedded once (npm run build:presets), and at request time a phrase
 * is compared with every line. Nothing in here is written by hand per kind of
 * place.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dot, embed, embeddingModel } from "./openai.js";
import googleTypes from "./data/googleTypes.json" with { type: "json" };

const require = createRequire(import.meta.url);
const INDEX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "preset-index");

export interface VocabEntry {
  /** "amenity/cafe" for OSM, "cafe" for Google. */
  id: string;
  name: string;
  text: string;
  /** OSM tags of the preset; empty for Google types. */
  tags: Record<string, string>;
}

export interface Match {
  entry: VocabEntry;
  score: number;
}

interface RawPreset {
  tags: Record<string, string>;
  geometry: string[];
  searchable?: boolean;
}

/** Presets a person could go to: searchable, and mapped as a point or an area. */
export function osmEntries(): VocabEntry[] {
  const presets = require("@openstreetmap/id-tagging-schema/dist/presets.json") as Record<string, RawPreset>;
  const en = require("@openstreetmap/id-tagging-schema/dist/translations/en.json") as {
    en: { presets: { presets: Record<string, { name?: string; terms?: string[] | string; aliases?: string[] | string }> } };
  };
  const strings = en.en.presets.presets;
  const list = (v: string[] | string | undefined): string[] =>
    Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : [];

  const out: VocabEntry[] = [];
  for (const [id, preset] of Object.entries(presets)) {
    if (preset.searchable === false) continue;
    if (!preset.geometry.some((g) => g === "point" || g === "area")) continue;
    const name = strings[id]?.name;
    if (!name) continue;
    const words = [...list(strings[id]?.aliases), ...list(strings[id]?.terms)];
    out.push({ id, name, text: words.length ? `${name} — ${words.join(", ")}` : name, tags: preset.tags });
  }
  return out;
}

export function googleEntries(): VocabEntry[] {
  return googleTypes.types.map((t) => {
    const name = t.replace(/_/g, " ");
    return { id: t, name, text: name, tags: {} };
  });
}

export interface VocabIndex {
  model: string;
  entries: VocabEntry[];
  vectors: Float32Array[];
}

async function save(name: string, index: VocabIndex): Promise<void> {
  await mkdir(INDEX_DIR, { recursive: true });
  const dims = index.vectors[0]?.length ?? 0;
  const flat = new Float32Array(index.vectors.length * dims);
  index.vectors.forEach((v, i) => flat.set(v, i * dims));
  await writeFile(join(INDEX_DIR, `${name}.json`), JSON.stringify({ model: index.model, dims, entries: index.entries }));
  await writeFile(join(INDEX_DIR, `${name}.f32`), Buffer.from(flat.buffer));
}

async function load(name: string): Promise<VocabIndex> {
  const meta = JSON.parse(await readFile(join(INDEX_DIR, `${name}.json`), "utf8")) as {
    model: string;
    dims: number;
    entries: VocabEntry[];
  };
  const buf = await readFile(join(INDEX_DIR, `${name}.f32`));
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const vectors = meta.entries.map((_, i) => flat.subarray(i * meta.dims, (i + 1) * meta.dims));
  if (meta.model !== embeddingModel()) {
    throw new Error(`Index ${name} was built with ${meta.model}, but EMBEDDING_MODEL is ${embeddingModel()}. Run npm run build:presets.`);
  }
  return { model: meta.model, entries: meta.entries, vectors };
}

export async function buildIndexes(): Promise<{ osm: number; google: number }> {
  const model = embeddingModel();
  const osm = osmEntries();
  const google = googleEntries();
  await save("osm", { model, entries: osm, vectors: await embed(osm.map((e) => e.text)) });
  await save("google", { model, entries: google, vectors: await embed(google.map((e) => e.text)) });
  return { osm: osm.length, google: google.length };
}

let loaded: { osm: VocabIndex; google: VocabIndex } | null = null;

export async function indexes(): Promise<{ osm: VocabIndex; google: VocabIndex }> {
  loaded ??= { osm: await load("osm"), google: await load("google") };
  return loaded;
}

export function search(index: VocabIndex, query: Float32Array, k: number): Match[] {
  return index.vectors
    .map((v, i) => ({ entry: index.entries[i], score: dot(v, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
