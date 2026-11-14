/** npm run build:presets — embeds the OSM preset and Google type vocabularies once. */
import "dotenv/config";
import { buildIndexes } from "./vocabulary.js";

const started = Date.now();
const counts = await buildIndexes();
console.log(`Indexed ${counts.osm} OSM kinds of place and ${counts.google} Google types in ${((Date.now() - started) / 1000).toFixed(1)}s`);
