/**
 * Matches OSM tags to iD editor presets (@openstreetmap/id-tagging-schema),
 * so a place gets the same category a mapper would see in iD.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export type Geometry = "point" | "vertex" | "line" | "area" | "relation";

export interface Preset {
  id: string;
  tags: Record<string, string>;
  keyCount: number;
  geometry: Geometry[];
  searchable: boolean;
  matchScore: number;
  /** Every tag value is "*": the preset only says which key is present (e.g. "building", "address"). */
  generic: boolean;
  /** iD's score for a full match: matchScore per exact tag, half of it per "*" tag. */
  score: number;
}

interface RawPreset {
  tags?: Record<string, string>;
  geometry?: Geometry[];
  searchable?: boolean;
  matchScore?: number;
}

export class PresetMatcher {
  /** Presets indexed by one of their tag keys: every candidate must have that key. */
  private byKey = new Map<string, Preset[]>();
  /** Presets with a key wildcard such as "addr:*", checked against every element. */
  private prefixPresets: Preset[] = [];

  constructor(raw: Record<string, RawPreset>) {
    for (const [id, r] of Object.entries(raw)) {
      const tags = r.tags ?? {};
      const keys = Object.keys(tags);
      // Fallback presets ("point", "line", ...) have no tags and would match anything.
      if (keys.length === 0) continue;
      const matchScore = r.matchScore ?? 1;
      const preset: Preset = {
        id,
        tags,
        keyCount: keys.length,
        geometry: r.geometry ?? [],
        searchable: r.searchable !== false,
        matchScore,
        generic: Object.values(tags).every((v) => v === "*"),
        score: Object.values(tags).reduce((sum, v) => sum + (v === "*" ? matchScore / 2 : matchScore), 0),
      };
      const plainKey = keys.find((k) => !k.endsWith("*"));
      if (plainKey === undefined) {
        this.prefixPresets.push(preset);
      } else {
        let list = this.byKey.get(plainKey);
        if (!list) this.byKey.set(plainKey, (list = []));
        list.push(preset);
      }
    }
  }

  static fromSchema(): PresetMatcher {
    const require = createRequire(import.meta.url);
    const file = require.resolve("@openstreetmap/id-tagging-schema/dist/presets.json");
    return new PresetMatcher(JSON.parse(readFileSync(file, "utf8")));
  }

  /**
   * Best preset whose every tag matches and whose geometry overlaps `geometries`.
   * More matching keys win, then the higher score, so "amenity=cafe" beats the
   * catch-all "amenity=*" as it does in iD.
   */
  match(tags: Record<string, string>, geometries: Geometry[]): Preset | null {
    let best: Preset | null = null;
    const consider = (p: Preset) => {
      if (best && (p.keyCount < best.keyCount || (p.keyCount === best.keyCount && p.score <= best.score))) return;
      if (!p.geometry.some((g) => geometries.includes(g))) return;
      if (!presetTagsMatch(p.tags, tags)) return;
      best = p;
    };
    for (const k in tags) {
      const list = this.byKey.get(k);
      if (list) for (const p of list) consider(p);
    }
    for (const p of this.prefixPresets) consider(p);
    return best;
  }
}

function presetTagsMatch(presetTags: Record<string, string>, tags: Record<string, string>): boolean {
  for (const k in presetTags) {
    const want = presetTags[k];
    if (k.endsWith("*")) {
      const prefix = k.slice(0, -1);
      if (!Object.keys(tags).some((t) => t.startsWith(prefix))) return false;
      continue;
    }
    const have = tags[k];
    if (have === undefined) return false;
    // "building=no" and the like mean the feature is absent, so they must not satisfy "*".
    if (want === "*" ? have === "no" : have !== want) return false;
  }
  return true;
}
