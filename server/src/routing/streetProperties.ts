/**
 * The street preferences the app supports — the menu a user can ask from.
 *
 * Each row is data, not code: one general rule (routing/preferences.ts)
 * applies every row the same way. A preference is used only when the user
 * asks for it; otherwise every street is judged by length alone.
 *
 * Good and bad values follow the OSM wiki pages for each key
 * (Key:lit, Key:surface, Key:wheelchair, Tag:highway=steps).
 * A street with no value for the key is "unknown": neither good nor bad.
 */

export type StreetPropertyId = "lit" | "paved" | "no_steps" | "wheelchair";

export interface StreetProperty {
  id: StreetPropertyId;
  label: string;
  /** Plain words for good / bad streets, e.g. "lit" / "unlit". */
  goodWord: string;
  badWord: string;
  /** What the user might say; shown to the LLM so it can pick from the menu. */
  description: string;
  /** OSM key on the street that carries the information. */
  key: string;
  good: string[];
  bad: string[];
  /** Extra tags that also count as bad (e.g. steps for wheelchair users). */
  alsoBad?: Array<{ key: string; values: string[] }>;
}

export const STREET_PROPERTIES: StreetProperty[] = [
  {
    id: "lit",
    label: "Lit streets",
    goodWord: "lit",
    badWord: "unlit",
    description: "well-lit streets, lighting, safe at night",
    key: "lit",
    good: ["yes", "24/7", "automatic", "sunset-sunrise", "dusk-dawn"],
    bad: ["no", "disused"],
  },
  {
    id: "paved",
    label: "Paved paths",
    goodWord: "paved",
    badWord: "unpaved",
    description: "paved, smooth, no gravel or dirt paths",
    key: "surface",
    good: [
      "paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes",
      "paving_stones", "paving_stones:lanes", "sett", "chipseal", "metal", "wood",
    ],
    bad: [
      "unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "rock",
      "ground", "dirt", "earth", "grass", "grass_paver", "mud", "sand", "woodchips",
    ],
  },
  {
    id: "no_steps",
    label: "No stairs",
    goodWord: "step-free",
    badWord: "with stairs",
    description: "no stairs or steps",
    key: "highway",
    good: [],
    bad: ["steps"],
  },
  {
    id: "wheelchair",
    label: "Wheelchair / stroller friendly",
    goodWord: "accessible",
    badWord: "not accessible",
    description: "wheelchair, stroller, pram, mobility aid accessible",
    key: "wheelchair",
    good: ["yes", "designated"],
    bad: ["no"],
    alsoBad: [{ key: "highway", values: ["steps"] }],
  },
];

/** Street tag keys the city build keeps on each street; everything else is dropped. */
export const STREET_TAG_KEYS: string[] = [
  "highway",
  "name",
  ...new Set(STREET_PROPERTIES.flatMap((p) => [p.key, ...(p.alsoBad ?? []).map((b) => b.key)])),
].filter((k, i, all) => all.indexOf(k) === i);

export type StreetJudgement = "good" | "bad" | "unknown";

export function judgeStreet(prop: StreetProperty, tags: Record<string, string>): StreetJudgement {
  for (const extra of prop.alsoBad ?? []) {
    const v = tags[extra.key];
    if (v !== undefined && extra.values.includes(v)) return "bad";
  }
  const v = tags[prop.key];
  if (v === undefined) return "unknown";
  if (prop.bad.includes(v)) return "bad";
  if (prop.good.includes(v)) return "good";
  // A property with no "good" values (no_steps) only knows "bad" vs everything else.
  if (prop.good.length === 0) return "good";
  return "unknown";
}

export function streetProperty(id: string): StreetProperty | undefined {
  return STREET_PROPERTIES.find((p) => p.id === id);
}
