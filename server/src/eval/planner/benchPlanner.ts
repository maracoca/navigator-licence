/**
 * npm run bench:planner [-- --quick]
 *
 * The planner study: the exact planner compared with brute force, greedy, cheapest insertion and
 * insertion + local search, on
 *   1. small random problems (straight-line times, from a seed) — is each planner's plan the best one?
 *   2. realistic problems on the city's real places and street walking times — quality and speed;
 *   3. growing numbers of stops — how the exact planner's run time grows.
 * No LLM and no network. Writes eval/planner-runs/<time>_planner.json (all numbers),
 * <time>_planner.md (tables) and <time>_problems.json (the city problems, so they can be re-run).
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCity } from "../../data/cityStore.js";
import { PARAMS } from "../../params.js";
import { plan, type PlanInput, type PlanResult } from "../../planning/planner.js";
import { bruteForce, cheapestInsertion, greedy, localSearch } from "../../planning/baselines.js";
import { cityProblems, syntheticProblems, toPlanInput, type StoredProblem } from "./problems.js";
import { appProblems } from "./appProblems.js";
import { planWalk } from "../../planning/planWalk.js";
import { rng } from "./problems.js";
import { STREET_PROPERTIES, type StreetPropertyId } from "../../routing/streetProperties.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const OUT_DIR = path.join(ROOT, "eval", "planner-runs");
const quick = process.argv.includes("--quick");
const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const PLANNERS: Record<string, (p: PlanInput) => PlanResult> = {
  exact: plan,
  greedy,
  insertion: cheapestInsertion,
  local: localSearch,
};
const NAMES = Object.keys(PLANNERS);

// ─── Helpers ────────────────────────────────────────────────────────────────

function scoreOf(input: PlanInput, res: PlanResult): number[] {
  const req = res.stops.filter((s) => input.items[s.itemIndex].required).length;
  const rating = res.stops.reduce((sum, s) => sum + (input.candidates[s.itemIndex][s.candidateIndex].rating ?? 0), 0);
  return [-req, -(res.stops.length - req), res.walkMinutes - rating * PARAMS.ratingTiebreakMinutesPerStar.value];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Milliseconds per run; repeats fast planners so the timer can see them. */
function timeIt(fn: () => unknown, maxReps = 200): number {
  const t0 = performance.now();
  fn();
  const first = performance.now() - t0;
  if (first > 20 || maxReps <= 1) return first;
  let reps = 1;
  const t1 = performance.now();
  while (reps < maxReps && performance.now() - t1 < 20) {
    fn();
    reps++;
  }
  return (performance.now() - t1) / (reps - 1 || 1);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fmt = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "–");

interface Comparison {
  n: number;
  worse: number;
  better: number;
  fewerStops: number;
  /** For plans with the same stops covered but a worse walking/rating score: extra minutes. */
  extraWhenSameStops: number[];
}

function emptyComparison(): Comparison {
  return { n: 0, worse: 0, better: 0, fewerStops: 0, extraWhenSameStops: [] };
}

function addComparison(c: Comparison, mine: number[], ref: number[]): void {
  c.n++;
  const d = compare(mine, ref);
  if (d < 0) c.better++;
  if (d > 0) {
    c.worse++;
    if (mine[0] !== ref[0] || mine[1] !== ref[1]) c.fewerStops++;
    else c.extraWhenSameStops.push(mine[2] - ref[2]);
  }
}

function git(): { commit: string | null; dirty: boolean } {
  try {
    const commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: true };
  }
}

// ─── 1. Small random problems vs brute force ────────────────────────────────

const SYN_SEED = 42;
const SYN_COUNT = quick ? 300 : 3000;
console.log(`1/4 Small random problems: ${SYN_COUNT} (seed ${SYN_SEED}) vs brute force ...`);
const synthetic = syntheticProblems(SYN_SEED, SYN_COUNT);
const synResults: Record<string, Comparison> = Object.fromEntries(NAMES.map((n) => [n, emptyComparison()]));
for (const p of synthetic) {
  const input = toPlanInput(p);
  const ref = scoreOf(input, bruteForce(input));
  for (const n of NAMES) addComparison(synResults[n], scoreOf(input, PLANNERS[n](input)), ref);
}

// ─── 2. Realistic problems, built by the app's own pipeline ─────────────────

const city = await loadCity(process.env.CITY?.trim() || "cluj-napoca");
const CITY_SEED = 7;
const APP_SEED = 11;
const CANDIDATES = PARAMS.candidatesPerItem.value;
const BRUTE_MAX_SLOTS = 3;
const MAX_GOOGLE_SEARCHES = 400;
// Starts and ends are drawn from the central part of the city's map area (15 % margin on each side).
const bb = city.config.bbox;
const marginLat = (bb.north - bb.south) * 0.15, marginLng = (bb.east - bb.west) * 0.15;
const AREA = city.config.benchArea ?? { south: bb.south + marginLat, west: bb.west + marginLng, north: bb.north - marginLat, east: bb.east - marginLng };
const PAIRS = Number(argValue("--pairs") ?? 25);
// Monday morning, Wednesday afternoon, Friday evening, Saturday night, Sunday late morning (local time, Cluj).
const DEPARTURES = ["2026-11-23T09:00:00+02:00", "2026-11-25T14:00:00+02:00", "2026-11-27T18:30:00+02:00", "2026-11-28T21:00:00+02:00", "2026-11-29T11:00:00+02:00"];
const appOpts = { seed: APP_SEED, pairs: quick ? 4 : PAIRS, perPair: quick ? 3 : 6, maxStops: 6, maxGoogleSearches: MAX_GOOGLE_SEARCHES, area: AREA, departures: DEPARTURES };
console.log(`2/4 App-built problems on ${city.config.name}: ${appOpts.pairs} start/end pairs × ${appOpts.perPair} requests (seed ${APP_SEED}) ...`);
const app = await appProblems(city, appOpts);
console.log(`   ${app.problems.length} problems, ${app.googleSearchesPlanned} Google searches needed (saved after the first run), ${app.skipped} skipped (no walking connection)`);
const cityList = app.problems;

interface CityRow {
  id: string;
  slots: number;
  reference: "brute" | "exact";
  scores: Record<string, number[]>;
  ms: Record<string, number>;
}
const cityRows: CityRow[] = [];
for (const p of cityList) {
  const input = toPlanInput(p);
  const scores: Record<string, number[]> = {};
  const ms: Record<string, number> = {};
  for (const n of NAMES) {
    let res!: PlanResult;
    ms[n] = timeIt(() => (res = PLANNERS[n](input)));
    scores[n] = scoreOf(input, res);
  }
  let reference: CityRow["reference"] = "exact";
  if (p.slots <= BRUTE_MAX_SLOTS) {
    let res!: PlanResult;
    ms.brute = timeIt(() => (res = bruteForce(input)), 3);
    scores.brute = scoreOf(input, res);
    reference = "brute";
  }
  cityRows.push({ id: p.id, slots: p.slots, reference, scores, ms });
}

const sizes = [...new Set(cityRows.map((r) => r.slots))].sort((a, b) => a - b);
const citySummary = sizes.map((slots) => {
  const rows = cityRows.filter((r) => r.slots === slots);
  const per: Record<string, { cmp: Comparison; ms: number[] }> = {};
  for (const n of [...NAMES, ...(rows[0].reference === "brute" ? ["brute"] : [])]) {
    const cmp = emptyComparison();
    for (const r of rows) addComparison(cmp, r.scores[n], r.scores[r.reference]);
    per[n] = { cmp, ms: rows.map((r) => r.ms[n]) };
  }
  return { slots, problems: rows.length, reference: rows[0].reference, per };
});

// ─── 3. Exact planner run time as stops grow ────────────────────────────────

const SCALE_MAX = quick ? 8 : 10;
const scalePerSize = quick ? 2 : 5;
console.log(`3/4 Run time for 1..${SCALE_MAX} stops (${scalePerSize} problems each) ...`);
const savedMaxSlots = PARAMS.maxSlots.value;
(PARAMS.maxSlots as { value: number }).value = SCALE_MAX;
const scaleProblems = cityProblems(city, {
  seed: CITY_SEED + 1,
  perSize: Object.fromEntries(Array.from({ length: SCALE_MAX }, (_, i) => [i + 1, scalePerSize])),
  candidatesPerItem: CANDIDATES,
  area: AREA,
});
const scaling = Array.from({ length: SCALE_MAX }, (_, i) => i + 1).map((slots) => {
  const ps = scaleProblems.filter((p) => p.slots === slots);
  const ms: Record<string, number[]> = Object.fromEntries(NAMES.map((n) => [n, [] as number[]]));
  for (const p of ps) {
    const input = toPlanInput(p);
    for (const n of NAMES) ms[n].push(timeIt(() => PLANNERS[n](input), slots >= 8 ? 1 : 200));
  }
  console.log(`   ${slots} stops: exact median ${fmt(median(ms.exact))} ms`);
  return { slots, problems: ps.length, ms };
});
(PARAMS.maxSlots as { value: number }).value = savedMaxSlots;

// ─── 4. Street preferences: separate vs joint ───────────────────────────────

// The same app-built requests, each with one "prefer" street preference; planned by the whole app pipeline in both modes.
// Street preferences do not change the Google searches, so this needs no new ones.
const STREET_SEED = 21;
const PROPS: StreetPropertyId[] = ["lit", "quiet", "sidewalk", "paved"];
console.log(`4/4 Street preferences, separate vs joint: ${app.requests.length} requests (seed ${STREET_SEED}) ...`);
const sr = rng(STREET_SEED);
interface StreetRow {
  id: string;
  property: StreetPropertyId;
  stopsChanged: boolean;
  sep: { stops: number; walk: number; good: number; bad: number; unknown: number; within: boolean; ms: number };
  joint: { stops: number; walk: number; good: number; bad: number; unknown: number; within: boolean; ms: number };
}
const streetRows: StreetRow[] = [];
for (const [i, base0] of app.requests.entries()) {
  const property = PROPS[Math.floor(sr() * PROPS.length)];
  const label = STREET_PROPERTIES.find((p) => p.id === property)!.label;
  const req = { ...base0, street: [{ property, label, mode: "prefer" as const }] };
  const run = async (streetMode: "separate" | "joint") => {
    const t = performance.now();
    const r = await planWalk(city, req, { streetMode });
    const ms = performance.now() - t;
    const c = r.coverage[0];
    return {
      names: r.stops.map((s) => s.name).join(" | "),
      row: { stops: r.stops.length, walk: r.totals.walkMinutes, good: c?.goodPercent ?? 0, bad: c?.badPercent ?? 0, unknown: c?.unknownPercent ?? 0, within: r.totals.withinBudget, ms },
    };
  };
  try {
    const s = await run("separate");
    const j = await run("joint");
    streetRows.push({ id: app.problems[i].id, property, stopsChanged: s.names !== j.names, sep: s.row, joint: j.row });
  } catch (e) {
    console.log(`   ${app.problems[i].id}: ${(e as Error).message}`);
  }
}
const streetSummary = ["all", ...PROPS].map((prop) => {
  const rows = streetRows.filter((r) => prop === "all" || r.property === prop);
  const m = (f: (r: StreetRow) => number) => mean(rows.map(f));
  return {
    property: prop,
    n: rows.length,
    stopsChanged: rows.filter((r) => r.stopsChanged).length,
    goodSep: m((r) => r.sep.good), goodJoint: m((r) => r.joint.good),
    badSep: m((r) => r.sep.bad), badJoint: m((r) => r.joint.bad),
    walkSep: m((r) => r.sep.walk), walkJoint: m((r) => r.joint.walk),
    stopsSep: m((r) => r.sep.stops), stopsJoint: m((r) => r.joint.stops),
    withinSep: rows.filter((r) => r.sep.within).length, withinJoint: rows.filter((r) => r.joint.within).length,
    msSep: median(rows.map((r) => r.sep.ms)), msJoint: median(rows.map((r) => r.joint.ms)),
  };
});

// ─── Write results ──────────────────────────────────────────────────────────

const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
const meta = {
  date: new Date().toISOString(),
  git: git(),
  node: process.version,
  quick,
  city: city.config.name,
  seeds: { synthetic: SYN_SEED, app: APP_SEED, scaling: CITY_SEED + 1 },
  appProblems: { ...appOpts, googleSearchesPlanned: app.googleSearchesPlanned, skipped: app.skipped },
  candidatesPerItem: CANDIDATES,
  bruteMaxSlots: BRUTE_MAX_SLOTS,
  params: Object.fromEntries(Object.entries(PARAMS).map(([k, v]) => [k, v.value])),
};
await mkdir(OUT_DIR, { recursive: true });
const base = path.join(OUT_DIR, `${stamp}_${city.config.id}`);
await writeFile(`${base}_problems.json`, JSON.stringify({ meta, problems: cityList }));
await writeFile(`${base}_planner.json`, JSON.stringify({ meta, synthetic: synResults, city: { rows: cityRows, summary: citySummary }, scaling, streets: { seed: STREET_SEED, rows: streetRows, summary: streetSummary } }, null, 1));

const md: string[] = [];
md.push(`# Planner study — ${meta.date.slice(0, 10)}`, "");
md.push(`Commit ${meta.git.commit?.slice(0, 7) ?? "?"}${meta.git.dirty ? " (with uncommitted changes)" : ""}, ${meta.city}, Node ${meta.node}${quick ? ", QUICK run" : ""}.`, "");
md.push(`## 1. Small random problems vs brute force (${SYN_COUNT} problems, seed ${SYN_SEED})`, "");
md.push("| Planner | worse than best | of which fewer stops | extra min when same stops (median / max) | better than best (= bug) |", "|---|---|---|---|---|");
for (const n of NAMES) {
  const c = synResults[n];
  md.push(`| ${n} | ${c.worse} (${pct(c.worse, c.n)}) | ${c.fewerStops} | ${fmt(median(c.extraWhenSameStops))} / ${fmt(c.extraWhenSameStops.length ? Math.max(...c.extraWhenSameStops) : null)} | ${c.better} |`);
}
md.push("", `## 2. App-built problems (${cityList.length} problems: the app's own place search (OSM + Google), shortlist, opening hours and street walking times; ${appOpts.pairs} start/end pairs, departures Mon 09:00, Wed 14:00, Fri 18:30, Sat 21:00, Sun 11:00)`, "");
md.push(`Reference = brute force up to ${BRUTE_MAX_SLOTS} stops, the exact planner above that. Google ratings and opening hours are included.`, "");
md.push("| Stops | Problems | Planner | worse than reference | fewer stops | extra min when same stops (mean) | run time ms (median) |", "|---|---|---|---|---|---|---|");
for (const s of citySummary) {
  for (const [n, v] of Object.entries(s.per)) {
    md.push(`| ${s.slots} | ${s.problems} | ${n} | ${v.cmp.worse} (${pct(v.cmp.worse, v.cmp.n)}) | ${v.cmp.fewerStops} | ${fmt(mean(v.cmp.extraWhenSameStops))} | ${fmt(median(v.ms), 3)} |`);
  }
}
md.push("", `## 3. Run time as the number of stops grows (${scalePerSize} city problems per size, ${CANDIDATES} candidates per item)`, "");
md.push(`| Stops | ${NAMES.map((n) => `${n} ms (median)`).join(" | ")} |`, `|---|${NAMES.map(() => "---").join("|")}|`);
for (const s of scaling) md.push(`| ${s.slots} | ${NAMES.map((n) => fmt(median(s.ms[n]), 3)).join(" | ")} |`);
md.push("", `## 4. Street preferences: separate vs joint (${streetRows.length} app-built requests, one "prefer" street preference each, seed ${STREET_SEED}; joint strength ${PARAMS.jointPreferenceStrength.value})`, "");
md.push("Separate: stops chosen on plain walking times, the preference shapes each leg afterwards (12 % rule). Joint: stops and legs chosen on preference-shaped routes. Good / bad = share of the walk on streets with a good / bad value for the requested property.", "");
md.push("| Preference | Requests | stops changed | good % sep → joint | bad % sep → joint | walk min sep → joint | stops sep → joint | within budget sep / joint | run time ms sep → joint (median) |", "|---|---|---|---|---|---|---|---|---|");
for (const s of streetSummary) {
  md.push(`| ${s.property} | ${s.n} | ${s.stopsChanged} (${pct(s.stopsChanged, s.n)}) | ${fmt(s.goodSep, 1)} → ${fmt(s.goodJoint, 1)} | ${fmt(s.badSep, 1)} → ${fmt(s.badJoint, 1)} | ${fmt(s.walkSep, 1)} → ${fmt(s.walkJoint, 1)} | ${fmt(s.stopsSep)} → ${fmt(s.stopsJoint)} | ${s.withinSep} / ${s.withinJoint} | ${fmt(s.msSep, 0)} → ${fmt(s.msJoint, 0)} |`);
}
await writeFile(`${base}_planner.md`, md.join("\n") + "\n");

console.log(`\nSaved ${path.relative(ROOT, base)}_planner.md, _planner.json, _problems.json`);
console.log("\n" + md.join("\n"));
