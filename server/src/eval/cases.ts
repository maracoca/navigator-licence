/**
 * Reading and checking the evaluation sets (format: eval/README.md).
 * A bad case is reported (case id + field) and skipped; the others still run.
 */
import { STREET_PROPERTIES } from "../routing/streetProperties.js";
import { PARAMS } from "../params.js";
import { parseTag, type Expected, type ExpectedItem } from "./metrics.js";

export type LocationSpec = string | { lat: number; lng: number; label?: string };

export interface EvalCase {
  id: string;
  request: string;
  origin: LocationSpec;
  destination: LocationSpec;
  budgetMinutes: number | null;
  departAt: string;
  expected: Expected;
  notes?: string;
}

export interface CaseProblem {
  /** Case id, or "#<index>" when the case has no usable id. */
  caseId: string;
  field: string;
  message: string;
}

const CASE_FIELDS = new Set(["id", "request", "origin", "destination", "budgetMinutes", "departAt", "expected", "notes"]);
const EXPECTED_FIELDS = new Set(["items", "street", "unsupported"]);
const ITEM_FIELDS = new Set(["what", "tags", "required", "order", "count", "pace", "wish"]);
const PACES = ["quick", "normal", "long"];
const MODES = ["prefer", "require"];
const MENU = STREET_PROPERTIES.map((p) => p.id as string);
// An explicit offset (or Z) keeps the walk time independent of the computer's time zone.
const DATE_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;

function checkLocation(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? null : "is empty";
  if (isObj(v)) {
    if (typeof v.lat !== "number" || !Number.isFinite(v.lat) || typeof v.lng !== "number" || !Number.isFinite(v.lng)) {
      return "needs numeric lat and lng";
    }
    const extra = Object.keys(v).filter((k) => !["lat", "lng", "label"].includes(k));
    if (extra.length) return `unknown field(s) ${extra.join(", ")}`;
    return null;
  }
  return 'must be a place name or { "lat": .., "lng": .. }';
}

function checkItem(it: unknown, at: string, add: (field: string, msg: string) => void): void {
  if (!isObj(it)) return add(at, "must be an object");
  for (const k of Object.keys(it)) if (!ITEM_FIELDS.has(k)) add(`${at}.${k}`, "unknown field (typo?)");
  if (it.what !== undefined && typeof it.what !== "string") add(`${at}.what`, "must be a string");
  if (!Array.isArray(it.tags) || it.tags.length === 0) add(`${at}.tags`, "must be a non-empty list of key=value");
  else
    it.tags.forEach((t, k) => {
      if (typeof t !== "string" || !parseTag(t)) add(`${at}.tags[${k}]`, `"${String(t)}" is not key=value`);
    });
  if (it.required !== undefined && typeof it.required !== "boolean") add(`${at}.required`, "must be true or false");
  if (it.order !== undefined && it.order !== null && !isPosInt(it.order)) add(`${at}.order`, "must be a positive integer or null");
  if (it.count !== undefined && it.count !== null && !isPosInt(it.count)) add(`${at}.count`, "must be a positive integer or null");
  if (it.pace !== undefined && !PACES.includes(it.pace as string)) add(`${at}.pace`, `must be one of ${PACES.join(", ")}`);
  if (it.wish !== undefined && it.wish !== null && (typeof it.wish !== "string" || !it.wish.trim())) {
    add(`${at}.wish`, "must be a non-empty string or null");
  }
}

/**
 * Checks every case. `set` ("dev" / "test") also checks the id prefix; pass
 * null for an ad-hoc file. Returns the good cases and every problem found.
 */
export function validateCases(raw: unknown, set: string | null): { cases: EvalCase[]; problems: CaseProblem[] } {
  const problems: CaseProblem[] = [];
  if (!Array.isArray(raw)) {
    return { cases: [], problems: [{ caseId: "(file)", field: "(root)", message: "must be a JSON array of cases" }] };
  }
  const seen = new Map<string, number>();
  for (const c of raw) if (isObj(c) && typeof c.id === "string") seen.set(c.id, (seen.get(c.id) ?? 0) + 1);

  const cases: EvalCase[] = [];
  raw.forEach((c, index) => {
    const caseId = isObj(c) && typeof c.id === "string" && c.id.trim() ? c.id : `#${index}`;
    const before = problems.length;
    const add = (field: string, message: string) => problems.push({ caseId, field, message });

    if (!isObj(c)) return add("(case)", "must be an object");
    for (const k of Object.keys(c)) if (!CASE_FIELDS.has(k)) add(k, "unknown field (typo?)");

    if (typeof c.id !== "string" || !c.id.trim()) add("id", "is required");
    else {
      if ((seen.get(c.id) ?? 0) > 1) add("id", "is used by more than one case");
      if (set && !c.id.startsWith(`${set}-`)) add("id", `should start with "${set}-"`);
    }
    if (typeof c.request !== "string" || !c.request.trim()) add("request", "is required");
    else if (c.request.trim().length > PARAMS.maxRequestChars.value) add("request", `is longer than ${PARAMS.maxRequestChars.value} characters (the app refuses it)`);
    for (const k of ["origin", "destination"] as const) {
      const err = checkLocation(c[k]);
      if (err) add(k, err);
    }
    if (c.budgetMinutes !== null && !(typeof c.budgetMinutes === "number" && c.budgetMinutes > 0)) {
      add("budgetMinutes", "must be a positive number or null");
    } else if (typeof c.budgetMinutes === "number" && c.budgetMinutes > PARAMS.maxBudgetMinutes.value) {
      add("budgetMinutes", `is above the app's limit of ${PARAMS.maxBudgetMinutes.value} (it would be capped)`);
    }
    if (typeof c.departAt !== "string" || !DATE_WITH_OFFSET.test(c.departAt) || !Number.isFinite(Date.parse(c.departAt))) {
      add("departAt", 'must be a date-time with a time zone, e.g. "2026-11-20T11:00:00+02:00"');
    }
    if (c.notes !== undefined && typeof c.notes !== "string") add("notes", "must be a string");

    const e = c.expected;
    if (!isObj(e)) add("expected", "is required");
    else {
      for (const k of Object.keys(e)) if (!EXPECTED_FIELDS.has(k)) add(`expected.${k}`, "unknown field (typo?)");
      if (!Array.isArray(e.items)) add("expected.items", "must be a list ([] for none)");
      else e.items.forEach((it, k) => checkItem(it, `expected.items[${k}]`, add));
      if (!Array.isArray(e.street)) add("expected.street", "must be a list ([] for none)");
      else {
        const props = new Set<string>();
        e.street.forEach((s, k) => {
          const at = `expected.street[${k}]`;
          if (!isObj(s)) return add(at, "must be an object");
          if (!MENU.includes(s.property as string)) add(`${at}.property`, `"${String(s.property)}" is not on the menu (${MENU.join(", ")}); put it in unsupported`);
          else if (props.has(s.property as string)) add(`${at}.property`, "is listed twice");
          props.add(s.property as string);
          if (!MODES.includes(s.mode as string)) add(`${at}.mode`, `must be one of ${MODES.join(", ")}`);
          const extra = Object.keys(s).filter((x) => x !== "property" && x !== "mode");
          if (extra.length) add(at, `unknown field(s) ${extra.join(", ")}`);
        });
      }
      if (!Array.isArray(e.unsupported) || e.unsupported.some((u) => typeof u !== "string" || !u.trim())) {
        add("expected.unsupported", "must be a list of non-empty strings ([] for none)");
      }
    }

    if (problems.length === before) cases.push(c as unknown as EvalCase);
  });
  return { cases, problems };
}

/**
 * Expected tags that no OSM kind in the app's vocabulary has: the app can
 * never produce them, so they are probably typos. Warnings, not errors.
 */
export function unknownTagWarnings(cases: EvalCase[], vocabTags: Array<Record<string, string>>): CaseProblem[] {
  const known = new Set<string>();
  const keys = new Set<string>();
  for (const tags of vocabTags) for (const [k, v] of Object.entries(tags)) (known.add(`${k}=${v}`), keys.add(k));
  const out: CaseProblem[] = [];
  for (const c of cases) {
    c.expected.items.forEach((it: ExpectedItem, k) => {
      for (const t of it.tags) {
        const p = parseTag(t)!;
        const ok = p.value === "*" ? keys.has(p.key) : known.has(`${p.key}=${p.value}`);
        if (!ok) out.push({ caseId: c.id, field: `expected.items[${k}].tags`, message: `no OSM kind in the app's vocabulary has ${t} (typo?)` });
      }
    });
  }
  return out;
}
