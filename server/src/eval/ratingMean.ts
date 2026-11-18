/**
 * npm run report:ratings -- <city>
 *
 * The average Google rating of places found in a city, from the saved Google searches (no new calls).
 * Each place is counted once. Put the result in cities.json as "ratingMean".
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCityConfig } from "../data/buildCity.js";

const cityId = process.argv[2] ?? "cluj-napoca";
const config = await loadCityConfig(cityId);
const b = config.bbox;
const dir = path.join(fileURLToPath(new URL("../../", import.meta.url)), "data", "api-cache", "google-text-search");
const seen = new Map<string, { rating: number; reviews: number }>();
for (const f of await readdir(dir)) {
  const saved = JSON.parse(await readFile(path.join(dir, f), "utf8")) as {
    value?: Array<{ id?: string; rating?: number; userRatingCount?: number; location?: { latitude?: number; longitude?: number } }>;
  };
  for (const p of saved.value ?? []) {
    const lat = p.location?.latitude, lng = p.location?.longitude;
    if (!p.id || p.rating == null || lat == null || lng == null) continue;
    if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) continue;
    seen.set(p.id, { rating: p.rating, reviews: p.userRatingCount ?? 0 });
  }
}
const all = [...seen.values()];
if (!all.length) throw new Error(`No saved Google places inside ${config.name}'s area yet; run a benchmark or some requests first.`);
const mean = all.reduce((s, p) => s + p.rating, 0) / all.length;
const reviews = all.map((p) => p.reviews).sort((x, y) => x - y);
console.log(`${config.name}: ${all.length} rated places; mean rating ${mean.toFixed(2)}; median reviews ${reviews[Math.floor(reviews.length / 2)]}; fewer than 10 reviews: ${all.filter((p) => p.reviews < 10).length}`);
