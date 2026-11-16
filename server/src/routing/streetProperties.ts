/**
 * The street preferences the app supports — the menu a user can ask from.
 *
 * Chosen from measured tag usage on walkable ways, worldwide (taginfo, see
 * docs/street-tags-world.md) and in the city (docs/street-tags-<city>.md):
 * only properties that are mapped often enough to shape a route.
 *
 * Each property is data: an ordered list of rules "if this tag has one of these
 * values, the street is good / bad / unknown". The first rule that applies
 * decides; no rule applies → unknown. One general function (judgeStreet)
 * applies every property the same way, and a preference is used only when the
 * user asks for it — otherwise every street is judged by length alone.
 * Values follow the OSM wiki pages for each key.
 */

export type StreetPropertyId = "lit" | "paved" | "no_steps" | "quiet" | "sidewalk";
export type StreetJudgement = "good" | "bad" | "unknown";

export interface StreetRule {
  /** Any of these keys (e.g. sidewalk, sidewalk:both) ... */
  keys: string[];
  /** ... having any of these values ... */
  values: string[];
  /** ... makes the street this. */
  result: StreetJudgement;
}

export interface StreetProperty {
  id: StreetPropertyId;
  label: string;
  /** Plain words for good / bad streets, e.g. "lit" / "unlit". */
  goodWord: string;
  badWord: string;
  /** What the user might say; shown to the LLM so it can pick from the menu. */
  description: string;
  rules: StreetRule[];
}

const CAR_FREE = ["pedestrian", "footway", "path", "steps", "cycleway", "bridleway", "corridor", "track"];
const MAIN_ROADS = ["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"];

export const STREET_PROPERTIES: StreetProperty[] = [
  {
    id: "lit",
    label: "Lit streets",
    goodWord: "lit",
    badWord: "unlit",
    description: "well-lit streets, lighting at night",
    rules: [
      { keys: ["lit"], values: ["yes", "24/7", "automatic", "sunset-sunrise", "dusk-dawn", "limited", "interval"], result: "good" },
      { keys: ["lit"], values: ["no", "disused"], result: "bad" },
    ],
  },
  {
    id: "paved",
    label: "Paved, smooth paths",
    goodWord: "paved",
    badWord: "rough or unpaved",
    description: "paved or smooth paths, no gravel, dirt or broken surfaces (e.g. for a stroller or a suitcase)",
    rules: [
      // A rough surface is bad even if it is paved (broken asphalt).
      { keys: ["smoothness"], values: ["bad", "very_bad", "horrible", "very_horrible", "impassable"], result: "bad" },
      {
        keys: ["surface"],
        values: ["unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "rock", "ground", "dirt", "earth", "grass", "grass_paver", "mud", "sand", "woodchips"],
        result: "bad",
      },
      {
        keys: ["surface"],
        values: ["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "paving_stones:lanes", "sett", "chipseal", "metal", "wood"],
        result: "good",
      },
      { keys: ["smoothness"], values: ["excellent", "good", "intermediate"], result: "good" },
    ],
  },
  {
    id: "no_steps",
    label: "No stairs",
    goodWord: "step-free",
    badWord: "with stairs",
    description: "no stairs or steps",
    rules: [
      { keys: ["highway"], values: ["steps"], result: "bad" },
      // Every walkable way has a highway tag, so the rest is known to be step-free.
      { keys: ["highway"], values: ["*"], result: "good" },
    ],
  },
  {
    id: "quiet",
    label: "Little traffic",
    goodWord: "car-free or residential",
    badWord: "along main roads",
    description: "quiet streets, little traffic, away from busy roads",
    rules: [
      // A sidewalk mapped as its own way runs beside some road; which one is not recorded.
      { keys: ["footway"], values: ["sidewalk"], result: "unknown" },
      { keys: ["highway"], values: [...CAR_FREE, "living_street", "residential", "service"], result: "good" },
      { keys: ["highway"], values: MAIN_ROADS, result: "bad" },
    ],
  },
  {
    id: "sidewalk",
    label: "Sidewalks",
    goodWord: "with a sidewalk or car-free",
    badWord: "no sidewalk",
    description: "streets with sidewalks, not walking on the road",
    rules: [
      { keys: ["footway"], values: ["sidewalk"], result: "good" },
      { keys: ["highway"], values: [...CAR_FREE, "living_street"], result: "good" },
      { keys: ["sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"], values: ["both", "left", "right", "yes"], result: "good" },
      // "separate" = the sidewalk is mapped as its own way; walking on this road itself has none.
      { keys: ["sidewalk", "sidewalk:both"], values: ["no", "none", "separate"], result: "bad" },
    ],
  },
];

/** Street tag keys the city build keeps on each street; everything else is dropped. */
export const STREET_TAG_KEYS: string[] = [
  ...new Set(["highway", "name", ...STREET_PROPERTIES.flatMap((p) => p.rules.flatMap((r) => r.keys))]),
];

export function judgeStreet(prop: StreetProperty, tags: Record<string, string>): StreetJudgement {
  for (const rule of prop.rules) {
    for (const key of rule.keys) {
      const v = tags[key];
      if (v !== undefined && (rule.values.includes(v) || rule.values.includes("*"))) return rule.result;
    }
  }
  return "unknown";
}

export function streetProperty(id: string): StreetProperty | undefined {
  return STREET_PROPERTIES.find((p) => p.id === id);
}
