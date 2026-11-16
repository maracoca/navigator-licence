/**
 * Evaluation runner (format and rules: eval/README.md).
 *
 *   npm run eval -- --set dev|test [--replay] [--only id1,id2]
 *   npm run eval:check -- --set dev|test        format check only, no API calls
 *
 * Each case runs end to end in-process, as the app would with no human edits:
 * understand(sentence) → planWalk(items and street exactly as understood).
 * The run is saved to eval/runs/<date>_<set>.json with everything needed to
 * reproduce or re-score it.
 *
 * Hidden options for development of the runner itself:
 *   --file <path>        run a case file outside eval/ (ids are not prefix-checked)
 *   --concurrency <1-3>  cases in parallel (default 1; timings are cleanest sequential)
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { unknownTagWarnings, validateCases, type CaseProblem, type EvalCase, type LocationSpec } from "./cases.js";
import {
  planningFacts,
  scoreUnderstanding,
  summarizePlanning,
  summarizeUnderstanding,
  FIELD_NAMES,
  type CasePlanningFacts,
  type CaseUnderstandingScore,
  type Produced,
  type Ratio,
  type Stat,
} from "./metrics.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EVAL_DIR = join(REPO_ROOT, "eval");
const RUNS_DIR = join(EVAL_DIR, "runs");

// ─── Arguments ──────────────────────────────────────────────────────────────

interface Args {
  set: string | null;
  file: string | null;
  replay: boolean;
  only: string[] | null;
  check: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { set: null, file: null, replay: false, only: null, check: false, concurrency: 1 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) fail(`${k} needs a value`);
      return v;
    };
    if (k === "--set") a.set = next();
    else if (k === "--file") a.file = next();
    else if (k === "--replay") a.replay = true;
    else if (k === "--check") a.check = true;
    else if (k === "--only") a.only = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--concurrency") a.concurrency = Math.max(1, Math.min(3, Number(next()) || 1));
    else fail(`unknown option ${k}`);
  }
  if (!a.file && a.set !== "dev" && a.set !== "test") fail("use --set dev or --set test");
  return a;
}

function fail(msg: string): never {
  console.error(`eval: ${msg}`);
  process.exit(2);
}

// ─── Loading and checking ───────────────────────────────────────────────────

async function loadSet(args: Args) {
  const file = args.file ? resolve(args.file) : join(EVAL_DIR, `${args.set}.json`);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    fail(`cannot read ${file}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const { cases, problems } = validateCases(raw, args.file ? null : args.set);
  const { osmEntries } = await import("../understand/vocabulary.js");
  const warnings = unknownTagWarnings(cases, osmEntries().map((e) => e.tags));
  return {
    file,
    sha256: createHash("sha256").update(text).digest("hex"),
    total: Array.isArray(raw) ? raw.length : 0,
    cases,
    problems,
    warnings,
  };
}

function printProblems(title: string, list: CaseProblem[]) {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const p of list) console.log(`  ${p.caseId}  ${p.field}: ${p.message}`);
}

// ─── Run metadata ───────────────────────────────────────────────────────────

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function gitInfo() {
  const commit = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  // Saved runs themselves do not make the code "dirty".
  const dirtyFiles = status == null ? null : status.split("\n").filter((l) => l && !l.slice(3).startsWith("eval/runs/"));
  return { commit, dirty: dirtyFiles == null ? null : dirtyFiles.length > 0, dirtyFiles };
}

function stamp(d: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}

// ─── One case ───────────────────────────────────────────────────────────────

type Understanding = import("../types.js").Understanding;
type PlanResult = Awaited<ReturnType<typeof import("../planning/planWalk.js").planWalk>>;

interface CaseResult {
  id: string;
  request: string;
  notes?: string;
  understanding: Understanding | null;
  plan: Omit<PlanResult, "legs"> & { legs: Array<{ meters: number; minutes: number }> } | null;
  scores: { understanding: CaseUnderstandingScore | null; planning: CasePlanningFacts | null };
  timing: { understandMs: number | null; planMs: number | null };
  error: { stage: "understand" | "plan"; message: string } | null;
}

const toLocation = (l: LocationSpec) => (typeof l === "string" ? { text: l } : l);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function runCase(c: EvalCase, deps: Deps): Promise<CaseResult> {
  const out: CaseResult = {
    id: c.id,
    request: c.request,
    ...(c.notes ? { notes: c.notes } : {}),
    understanding: null,
    plan: null,
    scores: { understanding: null, planning: null },
    timing: { understandMs: null, planMs: null },
    error: null,
  };

  let u: Understanding;
  let t = performance.now();
  try {
    const name = (l: typeof c.origin) => (typeof l === "string" ? l : l.label ?? null);
    u = await deps.understand(c.request.trim(), { origin: name(c.origin), destination: name(c.destination) });
  } catch (e) {
    out.error = { stage: "understand", message: errText(e) };
    return out;
  }
  out.timing.understandMs = Math.round(performance.now() - t);
  out.understanding = u;
  const produced: Produced = { items: u.items, street: u.street, unsupported: u.unsupported };
  const us = scoreUnderstanding(c.expected, produced);
  out.scores.understanding = us;

  t = performance.now();
  let plan: PlanResult;
  try {
    plan = await deps.planWalk(deps.city, {
      origin: toLocation(c.origin),
      destination: toLocation(c.destination),
      budgetMinutes: c.budgetMinutes,
      departAt: c.departAt,
      items: u.items,
      street: u.street,
    });
  } catch (e) {
    out.error = { stage: "plan", message: errText(e) };
    return out;
  }
  out.timing.planMs = Math.round(performance.now() - t);
  // Leg geometry is large and not needed for scoring; keep its length and minutes.
  out.plan = { ...plan, legs: plan.legs.map((l) => ({ meters: l.meters, minutes: l.minutes })) };
  out.scores.planning = planningFacts(c.expected, produced, us.pairs, plan);
  return out;
}

interface Deps {
  city: import("../data/cityTypes.js").CityData;
  understand: typeof import("../understand/understand.js").understand;
  planWalk: typeof import("../planning/planWalk.js").planWalk;
}

// ─── Printing ───────────────────────────────────────────────────────────────

const pct = (r: Ratio) => (r.value == null ? `n/a (n=0)` : `${(100 * r.value).toFixed(1)}% (${r.num}/${r.n})`);
const num = (x: number | null, d = 2) => (x == null ? "n/a" : x.toFixed(d));
const statText = (s: Stat, d = 2) => (s.n === 0 ? "n/a (n=0)" : `mean ${num(s.mean, d)}, median ${num(s.median, d)}, max ${num(s.max, d)} (n=${s.n})`);

function table(rows: string[][]) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log("  " + r.map((c, i) => c.padEnd(w[i])).join("  "));
}

function printRun(results: CaseResult[], summary: ReturnType<typeof summarize>) {
  const rows = [["case", "items m/p/e", "street m/p/e", "unsup", "plan", "stops", "walk/shortest", "budget", "skipped", "error"]];
  for (const r of results) {
    const u = r.scores.understanding;
    const p = r.plan;
    rows.push([
      r.id,
      u ? `${u.itemsMatched}/${u.itemsProduced}/${u.itemsExpected}` : "-",
      u ? `${u.street.matched}/${u.street.produced}/${u.street.expected}` : "-",
      u ? (u.unsupported.correct ? "ok" : "WRONG") : "-",
      p ? "ok" : r.error?.stage === "plan" ? "FAIL" : "-",
      p ? String(p.stops.length) : "-",
      p ? `${p.totals.walkMinutes}/${p.totals.shortestWalkMinutes}` : "-",
      p ? (p.totals.budgetMinutes == null ? "none" : p.totals.withinBudget ? "within" : "OVER") : "-",
      p ? p.skipped.map((s) => s.reason).join(",") || "-" : "-",
      r.error ? `${r.error.stage}: ${r.error.message.slice(0, 60)}` : "",
    ]);
  }
  console.log("\nCases (m/p/e = matched / produced / expected):");
  table(rows);

  const wish = results.flatMap((r) => (r.scores.understanding?.wishPairs ?? []).map((w) => ({ id: r.id, ...w })));
  if (wish.length) {
    console.log("\nWish pairs (matched items whose expected item states a wish):");
    for (const w of wish) {
      console.log(`  ${w.correct ? "ok   " : "WRONG"} ${w.id} ${w.what}: expected ${JSON.stringify(w.expected)}, app "${w.produced}"`);
    }
  }

  const U = summary.understanding, P = summary.planning;
  console.log(`\nUnderstanding (micro-averaged over ${U.cases} understood case(s); ${summary.understandErrors} understand error(s) excluded)`);
  console.log(`  items       precision ${pct(U.items.precision)}  recall ${pct(U.items.recall)}  F1 ${num(U.items.f1, 3)}`);
  console.log(`  kinds       ${pct(U.kindPrecision)} of the OSM kinds chosen for matched items fit an expected tag`);
  for (const f of FIELD_NAMES) console.log(`  ${f.padEnd(10)}  ${pct(U.fields[f])}  (matched items whose expected item states it)`);
  console.log(`  street      precision ${pct(U.street.precision)}  recall ${pct(U.street.recall)}  F1 ${num(U.street.f1, 3)}  (property+mode)`);
  console.log(`  street prop precision ${pct(U.streetProperty.precision)}  recall ${pct(U.streetProperty.recall)}  F1 ${num(U.streetProperty.f1, 3)}`);
  console.log(`  unsupported street wish detected correctly ${pct(U.unsupportedDetection)}`);

  console.log(`\nPlanning`);
  console.log(`  plan success                ${pct(P.success)}`);
  console.log(`  all understood required placed ${pct(P.requiredAllPlaced)}`);
  console.log(`  within budget               ${pct(P.withinBudget)}`);
  console.log(`  walk / shortest walk        ${statText(P.walkOverhead)}`);
  console.log(`  stops per plan              ${statText(P.stops)}`);
  const reasons = Object.entries(P.skipReasons.counts).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  console.log(`  skipped items               ${P.skipReasons.skippedItems} over ${P.skipReasons.n} plan(s): ${reasons}`);
  for (const [prop, c] of Object.entries(P.coverage)) {
    console.log(`  street ${prop.padEnd(10)}           good ${num(c.good, 1)}%  bad ${num(c.bad, 1)}%  unknown ${num(c.unknown, 1)}%  (n=${c.n})`);
  }
  console.log(`  understanding time (ms)     ${statText(P.understandMs, 0)}`);
  console.log(`  planning time (ms)          ${statText(P.planMs, 0)}`);
}

function summarize(results: CaseResult[]) {
  const understood = results.filter((r) => r.scores.understanding);
  const planned = results.filter((r) => r.scores.planning);
  return {
    understandErrors: results.filter((r) => r.error?.stage === "understand").length,
    planErrors: results.filter((r) => r.error?.stage === "plan").length,
    understanding: summarizeUnderstanding(understood.map((r) => r.scores.understanding!)),
    planning: summarizePlanning(
      understood.length,
      planned.map((r) => r.scores.planning!),
      understood.map((r) => r.timing.understandMs!),
      planned.map((r) => r.timing.planMs!),
    ),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const set = await loadSet(args);
const setName = args.file ? basename(args.file).replace(/\.json$/i, "") : args.set!;
console.log(`${relative(REPO_ROOT, set.file) || set.file}: ${set.total} case(s), ${set.cases.length} valid`);
printProblems("Problems (these cases are skipped)", set.problems);
printProblems("Warnings", set.warnings);

if (args.check) {
  console.log(set.problems.length ? "\nCheck failed." : "\nCheck passed.");
  process.exit(set.problems.length ? 1 : 0);
}

let cases = set.cases;
if (args.only) {
  const missing = args.only.filter((id) => !cases.some((c) => c.id === id));
  if (missing.length) console.log(`\n--only: no valid case with id ${missing.join(", ")}`);
  cases = cases.filter((c) => args.only!.includes(c.id));
}
if (cases.length === 0) {
  console.log("\nNo valid cases to run.");
  process.exit(1);
}

// The flag decides, not .env: a run is either fully recorded or fully replayed.
const cacheMode = args.replay ? "replay" : "record";
process.env.API_CACHE = cacheMode;

const { loadCity } = await import("../data/cityStore.js");
const { understand } = await import("../understand/understand.js");
const { planWalk } = await import("../planning/planWalk.js");
const { llmModel, embeddingModel } = await import("../understand/openai.js");
const { PARAMS } = await import("../params.js");

const cityId = process.env.CITY?.trim() || "cluj-napoca";
const started = new Date();
const t0 = performance.now();
const deps: Deps = { city: await loadCity(cityId), understand, planWalk };
console.log(`\nRunning ${cases.length} case(s), cache ${cacheMode}, ${llmModel()} / ${embeddingModel()}, concurrency ${args.concurrency}`);

const results: CaseResult[] = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++;
    results[i] = await runCase(cases[i], deps);
    const r = results[i];
    console.log(`  ${r.id}: ${r.error ? `${r.error.stage} error: ${r.error.message}` : "ok"}`);
  }
}
await Promise.all(Array.from({ length: Math.min(args.concurrency, cases.length) }, worker));

const durationMs = Math.round(performance.now() - t0);
const summary = summarize(results);
printRun(results, summary);

const run = {
  meta: {
    set: setName,
    file: relative(REPO_ROOT, set.file).startsWith("..") ? set.file : relative(REPO_ROOT, set.file).replace(/\\/g, "/"),
    fileSha256: set.sha256,
    casesInFile: set.total,
    casesInvalid: set.problems.length ? new Set(set.problems.map((p) => p.caseId)).size : 0,
    casesRun: cases.length,
    only: args.only,
    problems: set.problems,
    warnings: set.warnings,
    git: gitInfo(),
    city: cityId,
    llmModel: llmModel(),
    embeddingModel: embeddingModel(),
    cacheMode,
    concurrency: args.concurrency,
    params: PARAMS,
    node: process.version,
    startedAt: started.toISOString(),
    durationMs,
  },
  summary,
  cases: results,
};

await mkdir(RUNS_DIR, { recursive: true });
const outFile = join(RUNS_DIR, `${stamp(started)}_${setName}.json`);
await writeFile(outFile, JSON.stringify(run, null, 2) + "\n");
console.log(`\nSaved ${relative(REPO_ROOT, outFile).replace(/\\/g, "/")} (${(durationMs / 1000).toFixed(1)} s)`);
