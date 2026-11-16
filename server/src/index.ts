import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadCity } from "./data/cityStore.js";
import { PARAMS } from "./params.js";
import { planWalk, UserError, type PlanRequest } from "./planning/planWalk.js";
import { STREET_PROPERTIES } from "./routing/streetProperties.js";
import { understand } from "./understand/understand.js";
import { indexes } from "./understand/vocabulary.js";

const cityId = process.env.CITY?.trim() || "cluj-napoca";
const started = Date.now();
const city = await loadCity(cityId);
await indexes();
console.log(`Loaded ${city.config.name}: ${city.graph.nodeCount} street nodes, ${city.places.length} places (${Date.now() - started} ms)`);

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

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UserError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Listening on http://0.0.0.0:${port}`));
