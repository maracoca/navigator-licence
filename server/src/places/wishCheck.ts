/**
 * Does a place fit the person's wish ("modern", "catholic", "vegan")?
 *
 * Neither source has a field for most wishes, so the LLM judges each
 * candidate from the facts we hold about it (name, Google types and short
 * description, OSM tags) and answers yes / no / unknown. It is told to judge
 * only from those facts, so every answer can be traced to data.
 */
import { cached } from "../apiCache.js";
import { llmCacheExtra, llmModel, llmParams, openai } from "../understand/openai.js";

export type WishFit = "yes" | "no" | "unknown";

export interface WishFacts {
  id: string;
  name: string;
  googleTypes: string[];
  summary: string | null;
  osmTags: Record<string, string> | null;
}

/** Tags that say nothing about what the place is like. */
const NOISE = /^(addr:|contact:|source|check_date|survey|fixme|note|ref|wikimedia|image|phone|email|website|opening_hours|level|building|roof|height|start_date$|operator:wikidata|brand:wikidata)/;

function describe(f: WishFacts, n: number): string {
  const parts = [`${n}. ${f.name}`];
  if (f.googleTypes.length) parts.push(`Google types: ${f.googleTypes.join(", ")}`);
  if (f.summary) parts.push(`Description: ${f.summary}`);
  if (f.osmTags) {
    const tags = Object.entries(f.osmTags)
      .filter(([k]) => !NOISE.test(k))
      .map(([k, v]) => `${k}=${v}`);
    if (tags.length) parts.push(`OSM tags: ${tags.join(", ")}`);
  }
  return parts.join(" | ");
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "fit"],
        properties: {
          n: { type: "integer" },
          fit: { type: "string", enum: ["yes", "no", "unknown"] },
        },
      },
    },
  },
} as const;

const SYSTEM = `
You check whether places fit what a person asked for. Ignore words about time or effort ("quick", "maybe").
Judge each place ONLY from the facts listed for it
(name, Google types, description, OSM tags), not from anything you may know about it.
- yes: the facts state the wish itself, or something that directly implies it.
  A broader category that merely could include the wish is not enough ("clothes shop" does not show "second-hand").
- no: the facts show it does not fit (for example a different cuisine, or a different period or style than asked).
- unknown: the facts do not say either way. When in doubt between yes and unknown, answer unknown.
Answer for every numbered place.
`.trim();

/** `request` is the person's own words for the place ("a modern art museum"), so a wrong split into kind and wish cannot change the question. */
export async function checkWish(request: string, places: WishFacts[]): Promise<Map<string, WishFit>> {
  const result = new Map<string, WishFit>(places.map((p) => [p.id, "unknown"]));
  if (!request.trim() || places.length === 0) return result;
  const listing = `The person asked for: "${request}"\n\n${places.map((p, i) => describe(p, i + 1)).join("\n")}`;
  const model = llmModel();
  const out = await cached("llm-wish", { model, ...llmCacheExtra(), system: SYSTEM, listing }, async () => {
    const res = await openai().responses.create({
      model,
      ...(llmParams() as object),
      input: [
        { role: "system", content: SYSTEM },
        { role: "user", content: listing },
      ],
      text: { format: { type: "json_schema", name: "wish_fit", schema: SCHEMA, strict: true } },
    });
    return JSON.parse(res.output_text) as { answers: Array<{ n: number; fit: WishFit }> };
  });
  for (const a of out.answers) {
    const p = places[a.n - 1];
    if (p) result.set(p.id, a.fit);
  }
  return result;
}
