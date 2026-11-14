/**
 * Saved answers from outside services (OpenAI, Google), so a test run can be
 * repeated exactly. Mode comes from API_CACHE:
 *   record  use a saved answer when there is one, otherwise call and save
 *   replay  only saved answers; a missing one is an error
 *   off     always call, never save
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "api-cache");

type Mode = "record" | "replay" | "off";

function mode(): Mode {
  const m = process.env.API_CACHE?.trim();
  return m === "replay" || m === "off" ? m : "record";
}

export async function cached<T>(service: string, key: unknown, call: () => Promise<T>): Promise<T> {
  const m = mode();
  if (m === "off") return call();

  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
  const file = join(CACHE_DIR, service, `${hash}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")).value as T;
  } catch {
    if (m === "replay") throw new Error(`No saved ${service} answer for this request (API_CACHE=replay)`);
  }
  const value = await call();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ key, value }));
  return value;
}
