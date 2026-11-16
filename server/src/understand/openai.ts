import OpenAI from "openai";
import { cached } from "../apiCache.js";

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const llmModel = (): string => process.env.LLM_MODEL?.trim() || "gpt-4o-mini";

/** Reasoning effort for reasoning models ("none", "low", ...); empty = do not send (older models). */
export const llmReasoningEffort = (): string | null => process.env.LLM_REASONING_EFFORT?.trim() || null;

/**
 * Sampling settings for every LLM call. Temperature 0 keeps answers as repeatable as possible, but current
 * models accept it only when reasoning effort is "none" (or not set, for older models).
 */
export function llmParams(): { temperature?: number; reasoning?: { effort: string } } {
  const effort = llmReasoningEffort();
  if (!effort) return { temperature: 0 };
  return effort === "none" ? { temperature: 0, reasoning: { effort } } : { reasoning: { effort } };
}

/** Added to saved-answer keys only when an effort is set, so answers saved for older models still replay. */
export const llmCacheExtra = (): Record<string, string> => {
  const effort = llmReasoningEffort();
  return effort ? { effort } : {};
};
export const embeddingModel = (): string => process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

/** Unit-length embeddings, so cosine similarity is a plain dot product. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const model = embeddingModel();
  const out: Float32Array[] = [];
  const BATCH = 256;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const vectors = await cached("embeddings", { model, batch }, async () => {
      const res = await openai().embeddings.create({ model, input: batch });
      return res.data.map((d) => d.embedding);
    });
    for (const v of vectors) out.push(normalize(Float32Array.from(v)));
  }
  return out;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
