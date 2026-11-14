/**
 * Sentence → editable items.
 *
 *  1. The LLM reads the sentence and returns labels only: the separate items,
 *     plain search phrases for each, required/optional, order, count, pace,
 *     and street preferences chosen from the supported menu.
 *  2. Each search phrase is compared with the OSM and Google vocabularies
 *     (embeddings) to get real candidates.
 *  3. When the best candidate is not clearly ahead, the LLM picks from the
 *     candidates only (or none). It can never produce a tag that does not exist.
 *
 * Code turns the labels into minutes (stays.ts). The user then reviews and
 * edits everything before planning.
 */
import { PARAMS } from "../params.js";
import { STREET_PROPERTIES, streetProperty, type StreetPropertyId } from "../routing/streetProperties.js";
import type { Item, OsmKind, Pace, StreetPreference, TypicalVisit, Understanding } from "../types.js";
import { cached } from "../apiCache.js";
import { embed, llmModel, openai } from "./openai.js";
import { indexes, search, type Match } from "./vocabulary.js";
import { defaultStay } from "../planning/stays.js";

// ─── Step 1: read the sentence ──────────────────────────────────────────────

interface ParsedItem {
  phrase: string;
  label: string;
  search: string[];
  details: string;
  required: boolean;
  order: number | null;
  count: number | null;
  pace: Pace;
  typical_visit: TypicalVisit;
  stay_minutes: number | null;
}

interface Parsed {
  items: ParsedItem[];
  street: Array<{ property: StreetPropertyId; mode: "prefer" | "require" }>;
  unsupported: string[];
}

const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "street", "unsupported"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phrase", "label", "search", "details", "required", "order", "count", "pace", "typical_visit", "stay_minutes"],
        properties: {
          phrase: { type: "string" },
          label: { type: "string" },
          search: { type: "array", items: { type: "string" } },
          details: { type: "string" },
          required: { type: "boolean" },
          order: { anyOf: [{ type: "integer" }, { type: "null" }] },
          count: { anyOf: [{ type: "integer" }, { type: "null" }] },
          pace: { type: "string", enum: ["quick", "normal", "long"] },
          typical_visit: { type: "string", enum: ["brief", "short", "medium", "long"] },
          stay_minutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
        },
      },
    },
    street: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["property", "mode"],
        properties: {
          property: { type: "string", enum: STREET_PROPERTIES.map((p) => p.id) },
          mode: { type: "string", enum: ["prefer", "require"] },
        },
      },
    },
    unsupported: { type: "array", items: { type: "string" } },
  },
} as const;

const PARSE_PROMPT = `
You read one request for a walk between two points and list what the person wants to do on the way.
Return labels only; the app turns them into numbers and searches the map itself.

For each place the person wants to visit or pass, return one item:
- phrase: the person's own words for it.
- label: a short display name, capitalised ("Museum", "Coffee").
- search: 1 to 3 plain English names of kinds of place where this can be done, as they would appear on a map
  (no adjectives, no wishes). Use the thing itself when it is a kind of place ("museum" -> ["museum"]).
  When it is a need rather than a place, name the kinds of place that meet it
  ("charge my phone" -> ["cafe", "library"]; "something sweet" -> ["bakery", "ice cream shop"]).
- details: wishes about the place that are not part of its kind ("catholic", "cheap", "with a terrace"); empty if none.
- required: false only if the words make it optional ("if there's one", "along the way", "maybe", "if possible",
  "if there's time"); otherwise true. Listing things or "then" does not make anything optional.
- order: 1, 2, 3... only when the person states a sequence ("first", "then", "after that", "finally"); otherwise null.
- count: the number of such places when the person says a number or a plural with a number word; otherwise null.
- pace: "quick" if they signal a short stay ("quick", "grab", "pop in", "to go"), "long" if they signal a long one
  ("spend time", "explore", "linger", "relax"), otherwise "normal".
- typical_visit: how long people usually stay at this kind of place: "brief" (a few minutes: a bench, a fountain,
  a toilet, a cash machine), "short" (about a quarter hour: a shop, coffee to go), "medium" (about half an hour:
  a cafe, a church, a park), "long" (an hour or more: a museum, a meal at a restaurant).
- stay_minutes: only if the person states a duration for this place ("an hour at the museum" -> 60); otherwise null.

Street preferences: only when the person describes the streets or paths themselves, choose from this menu:
${STREET_PROPERTIES.map((p) => `- ${p.id}: ${p.description}`).join("\n")}
mode "require" when they cannot do without it ("no stairs at all", "I'm in a wheelchair"), otherwise "prefer".
A wish about the streets that is not on the menu ("shady", "quiet", "flat") goes in unsupported, in a few words.

Do not add places or preferences the person did not ask for. Do not include the start or the end point as items.
`.trim();

async function parseSentence(request: string): Promise<Parsed> {
  const model = llmModel();
  return cached("llm-parse", { model, prompt: PARSE_PROMPT, request }, async () => {
    const res = await openai().responses.create({
      model,
      temperature: 0,
      input: [
        { role: "system", content: PARSE_PROMPT },
        { role: "user", content: request },
      ],
      text: { format: { type: "json_schema", name: "walk_request", schema: PARSE_SCHEMA, strict: true } },
    });
    return JSON.parse(res.output_text) as Parsed;
  });
}

// ─── Steps 2 and 3: phrases → real kinds of place ───────────────────────────

interface Candidates {
  osm: Match[];
  google: Match[];
}

/** Take the best candidate without asking when it is clearly ahead of the next one. */
function clearWinner(matches: Match[], minScore: number): Match | null {
  const [first, second] = matches;
  if (!first || first.score < minScore) return null;
  if (!second || first.score - second.score >= PARAMS.presetClearLead.value) return first;
  return null;
}

/** Google type names are the vocabulary itself, so an exact name is unambiguous. */
function exactGoogle(matches: Match[]): Match | null {
  return matches[0] && matches[0].score > 0.97 ? matches[0] : null;
}

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "osm", "google"],
        properties: {
          item: { type: "integer" },
          osm: { type: "array", items: { type: "string" } },
          google: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

interface Pick {
  item: number;
  osm: string[];
  google: string[];
}

async function pickKinds(items: ParsedItem[], cands: Candidates[]): Promise<Pick[]> {
  const listing = items
    .map((it, i) =>
      [
        `Item ${i}: "${it.phrase}" (searching for: ${it.search.join(", ")}${it.details ? `; wishes: ${it.details}` : ""})`,
        `  OSM options: ${cands[i].osm.map((m) => `${m.entry.id} = ${m.entry.name}`).join(" | ") || "none"}`,
        `  Google options: ${cands[i].google.map((m) => m.entry.id).join(" | ") || "none"}`,
      ].join("\n"),
    )
    .join("\n\n");
  const system = `
For each item, choose the kinds of place from its options that match what the person is looking for.
osm: 1 to 3 option ids; prefer the general kind over a narrow variant unless the person asked for that variant.
google: 0 to 2 option ids; choose none when no option is that kind of place.
Choose only from the listed options. Choose none rather than something that does not fit.
`.trim();
  const model = llmModel();
  const out = await cached("llm-pick", { model, system, listing }, async () => {
    const res = await openai().responses.create({
      model,
      temperature: 0,
      input: [
        { role: "system", content: system },
        { role: "user", content: listing },
      ],
      text: { format: { type: "json_schema", name: "kind_picks", schema: PICK_SCHEMA, strict: true } },
    });
    return JSON.parse(res.output_text) as { picks: Pick[] };
  });
  return out.picks;
}

function dedupe(matches: Match[]): Match[] {
  const best = new Map<string, Match>();
  for (const m of matches) {
    const prev = best.get(m.entry.id);
    if (!prev || prev.score < m.score) best.set(m.entry.id, m);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function understand(request: string): Promise<Understanding> {
  const parsed = await parseSentence(request);
  const { osm, google } = await indexes();

  const phrases = parsed.items.flatMap((it) => it.search.slice(0, 3));
  const vectors = phrases.length ? await embed(phrases) : [];
  let v = 0;
  const cands: Candidates[] = parsed.items.map((it) => {
    const own = it.search.slice(0, 3).map(() => vectors[v++]);
    return {
      osm: dedupe(own.flatMap((q) => search(osm, q, PARAMS.presetTopK.value))).slice(0, PARAMS.presetTopK.value),
      google: dedupe(own.flatMap((q) => search(google, q, 5))).slice(0, 5),
    };
  });

  // Ask the LLM only for items whose candidates are not clear-cut.
  const chosen = parsed.items.map((it, i) => {
    if (it.search.length !== 1) return null;
    const o = clearWinner(cands[i].osm, PARAMS.presetMinScore.value);
    const g = exactGoogle(cands[i].google);
    const noGoogle = (cands[i].google[0]?.score ?? 0) < PARAMS.googleTypeMinScore.value;
    if (o && (g || noGoogle) && !it.details) return { osm: [o.entry.id], google: g ? [g.entry.id] : [] };
    return null;
  });
  const unclear = chosen.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (unclear.length) {
    const picks = await pickKinds(
      unclear.map((i) => parsed.items[i]),
      unclear.map((i) => cands[i]),
    );
    unclear.forEach((itemIndex, k) => {
      const p = picks.find((x) => x.item === k);
      const osmIds = new Set(cands[itemIndex].osm.map((m) => m.entry.id));
      const gIds = new Set(cands[itemIndex].google.map((m) => m.entry.id));
      chosen[itemIndex] = {
        osm: (p?.osm ?? []).filter((id) => osmIds.has(id)).slice(0, 3),
        google: (p?.google ?? []).filter((id) => gIds.has(id)).slice(0, 2),
      };
    });
  }

  const notices: string[] = [];
  const items: Item[] = parsed.items.map((it, i) => {
    const pick = chosen[i] ?? { osm: [], google: [] };
    const osmKinds: OsmKind[] = pick.osm.map((id) => {
      const e = osm.entries.find((x) => x.id === id)!;
      return { presetId: e.id, name: e.name, tags: e.tags };
    });
    if (osmKinds.length === 0 && pick.google.length === 0) {
      notices.push(`Could not find a kind of place on the map for "${it.phrase}".`);
    }
    const count = Math.min(PARAMS.maxCountPerItem.value, Math.max(1, it.count ?? 1));
    const stated = it.stay_minutes != null && it.stay_minutes > 0;
    return {
      id: `i${i + 1}`,
      phrase: it.phrase,
      label: it.label,
      search: it.search.slice(0, 3),
      details: it.details,
      osm: osmKinds,
      googleTypes: pick.google,
      required: it.required,
      order: it.order,
      count,
      pace: it.pace,
      stayMinutes: stated ? it.stay_minutes! : defaultStay(it.typical_visit, it.pace),
      stayFixed: stated || it.pace !== "normal",
    };
  });

  const street: StreetPreference[] = [];
  for (const s of parsed.street) {
    const prop = streetProperty(s.property);
    if (!prop || street.some((x) => x.property === s.property)) continue;
    street.push({ property: prop.id, label: prop.label, mode: s.mode });
  }
  for (const u of parsed.unsupported) notices.push(`Street wish not supported yet: ${u}.`);

  return { items, street, notices };
}
