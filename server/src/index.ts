import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadCity } from "./data/cityStore.js";
import { PARAMS } from "./params.js";
import { planWalk, UserError, type PlanRequest } from "./planning/planWalk.js";
import { STREET_PROPERTIES } from "./routing/streetProperties.js";
import { understand } from "./understand/understand.js";
import { indexes } from "./understand/vocabulary.js";
import { authorizeUrl, exchangeCode, osmConfig, OsmAuthError, OsmError, uploadAnswers, userName, type StreetAnswer } from "./osm/osmClient.js";
import { loadAnswers, recordAnswers } from "./osm/answerStore.js";

const cityId = process.env.CITY?.trim() || "cluj-napoca";
const started = Date.now();
const city = await loadCity(cityId);
await indexes();
const answersApplied = await loadAnswers(city.graph, cityId);
const osm = osmConfig();
console.log(`Loaded ${city.config.name}: ${city.graph.nodeCount} street nodes, ${city.places.length} places, ${answersApplied} street answers (${Date.now() - started} ms)`);
if (!city.graph.edgeWayId) console.log(`  Street questions are off: rebuild the city to store OSM way ids (npm run build:city -- ${cityId}).`);
console.log(osm ? `  OSM: ${osm.server}, upload ${osm.upload ? "ON" : "off (dry run)"}` : "  OSM: off (set OSM_CLIENT_ID to ask street questions)");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    city: city.config.name,
    bbox: city.config.bbox,
    streetProperties: STREET_PROPERTIES.map((p) => ({ id: p.id, label: p.label })),
  });
});

app.post("/api/understand", async (req, res) => {
  const text = typeof req.body?.request === "string" ? req.body.request.trim() : "";
  if (!text) throw new UserError("request is required");
  if (text.length > PARAMS.maxRequestChars.value) throw new UserError(`request must be at most ${PARAMS.maxRequestChars.value} characters`);
  const name = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  res.json(await understand(text, { origin: name(req.body?.origin), destination: name(req.body?.destination) }));
});

app.post("/api/plan", async (req, res) => {
  const body = req.body as Partial<PlanRequest>;
  if (!body?.origin || !body.destination) throw new UserError("origin and destination are required");
  if (!Array.isArray(body.items) || !Array.isArray(body.street ?? [])) throw new UserError("items must be a list");
  const t = Date.now();
  const result = await planWalk(city, {
    origin: body.origin,
    destination: body.destination,
    budgetMinutes: typeof body.budgetMinutes === "number" ? body.budgetMinutes : null,
    departAt: body.departAt,
    items: body.items,
    street: body.street ?? [],
  });
  console.log(`  planned ${result.stops.length} stop(s), ${result.totals.totalMinutes} min, ${result.skipped.length} skipped (${Date.now() - t} ms)`);
  res.json(result);
});

// ─── OpenStreetMap: login and street answers ────────────────────────────────

app.get("/api/osm/config", (_req, res) => {
  const enabled = !!osm && !!city.graph.edgeWayId;
  res.json(enabled ? { enabled, server: osm.server, upload: osm.upload, authorizeUrl: authorizeUrl(osm) } : { enabled: false });
});

function osmOrFail() {
  if (!osm) throw new UserError("OpenStreetMap is not set up on this server.");
  return osm;
}

app.post("/api/osm/login", async (req, res) => {
  const cfg = osmOrFail();
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!code || code.length > 200) throw new UserError("A login code is required.");
  const token = await exchangeCode(cfg, code);
  res.json({ token, user: await userName(cfg, token) });
});

const MAX_ANSWERS = 50;

app.post("/api/osm/answers", async (req, res) => {
  const cfg = osmOrFail();
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) throw new UserError("Log in to OpenStreetMap first.");
  const raw: unknown[] = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (raw.length === 0 || raw.length > MAX_ANSWERS) throw new UserError(`Send between 1 and ${MAX_ANSWERS} answers.`);
  const answers: StreetAnswer[] = raw.map((x) => {
    const a = x as Partial<StreetAnswer>;
    if (!Number.isSafeInteger(a.wayId) || a.wayId! <= 0 || a.property !== "lit" || (a.value !== "yes" && a.value !== "no")) {
      throw new UserError("Each answer needs a wayId, property \"lit\" and value \"yes\" or \"no\".");
    }
    const at = typeof a.answeredAt === "string" && Number.isFinite(Date.parse(a.answeredAt)) ? a.answeredAt : new Date().toISOString();
    return { wayId: a.wayId!, property: "lit", value: a.value, answeredAt: at };
  });
  // Checks the token even in a dry run, so only logged-in users' answers are kept.
  const user = await userName(cfg, token);
  const result = await uploadAnswers(cfg, token, answers);
  await recordAnswers(city.graph, cityId, result);
  console.log(`  ${user}: ${result.applied.length} street answer(s) ${result.mode === "upload" ? `uploaded, changeset ${result.changesetId}` : "(dry run)"}, ${result.skipped.length} skipped`);
  res.json(result);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof OsmAuthError) {
    res.status(401).json({ error: err.message, osmLogin: true });
    return;
  }
  if (err instanceof OsmError) {
    res.status(502).json({ error: err.message });
    return;
  }
  if (err instanceof UserError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Listening on http://0.0.0.0:${port}`));
