/**
 * OpenStreetMap login and upload of street answers, in the user's own name.
 *
 * Login: OAuth 2.0 with the "copy the code" redirect (urn:ietf:wg:oauth:2.0:oob). OSM accepts only https
 * redirect addresses (or http://127.0.0.1) besides this one, and an app running in Expo Go has neither.
 * The user logs in once; the app keeps the token.
 *
 * Upload: one changeset per walk (open -> change ways -> close). A way that already has the tag is left
 * alone: someone else answered first, and we never overwrite another mapper's value.
 *
 * Environment:
 *   OSM_CLIENT_ID      id of the app registered on the OSM server (questions are off without it)
 *   OSM_CLIENT_SECRET  only if the app was registered as "confidential"
 *   OSM_SERVER         default https://master.apis.dev.openstreetmap.org (the test server)
 *   OSM_UPLOAD         "on" = really upload; anything else = dry run: ways are read from the live OSM API,
 *                      the change is prepared and returned, nothing is written
 */
import type { QuestionProperty } from "./streetQuestions.js";

export const OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";
export const SCOPES = "read_prefs write_api";
const LIVE_API = "https://api.openstreetmap.org";
const CREATED_BY = "Walk Planner (thesis prototype)";

export interface OsmConfig {
  /** Login and (when upload is on) writes. */
  server: string;
  clientId: string;
  clientSecret: string | null;
  upload: boolean;
}

export function osmConfig(env: NodeJS.ProcessEnv = process.env): OsmConfig | null {
  const clientId = env.OSM_CLIENT_ID?.trim();
  if (!clientId) return null;
  return {
    server: (env.OSM_SERVER?.trim() || "https://master.apis.dev.openstreetmap.org").replace(/\/+$/, ""),
    clientId,
    clientSecret: env.OSM_CLIENT_SECRET?.trim() || null,
    upload: env.OSM_UPLOAD?.trim().toLowerCase() === "on",
  };
}

/** Where the user logs in and approves the app; OSM then shows a code to copy. */
export function authorizeUrl(cfg: OsmConfig): string {
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: OOB_REDIRECT, scope: SCOPES });
  return `${cfg.server}/oauth2/authorize?${q}`;
}

/** The OSM server rejected the token (expired, revoked, or missing permissions): the user must log in again. */
export class OsmAuthError extends Error {}
/** Any other failure talking to OSM. */
export class OsmError extends Error {}

type Fetch = typeof fetch;

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text().catch(() => "")).slice(0, 200);
  if (res.status === 401 || res.status === 403) throw new OsmAuthError(`OpenStreetMap refused ${what} (HTTP ${res.status}). ${body}`.trim());
  throw new OsmError(`OpenStreetMap: ${what} failed (HTTP ${res.status}). ${body}`.trim());
}

export async function exchangeCode(cfg: OsmConfig, code: string, fetchFn: Fetch = fetch): Promise<string> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: OOB_REDIRECT, client_id: cfg.clientId });
  if (cfg.clientSecret) form.set("client_secret", cfg.clientSecret);
  const res = await fetchFn(`${cfg.server}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  // A wrong or used code gives 400/401 here; both mean "log in again".
  if (res.status === 400) throw new OsmAuthError("OpenStreetMap did not accept this code. Copy the newest code and try again.");
  await check(res, "the login code");
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new OsmError("OpenStreetMap sent no access token.");
  return data.access_token;
}

export async function userName(cfg: OsmConfig, token: string, fetchFn: Fetch = fetch): Promise<string> {
  const res = await check(await fetchFn(`${cfg.server}/api/0.6/user/details.json`, { headers: auth(token) }), "the login");
  const data = (await res.json()) as { user?: { display_name?: string } };
  return data.user?.display_name ?? "OSM user";
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ─── Upload ─────────────────────────────────────────────────────────────────

export interface StreetAnswer {
  wayId: number;
  property: QuestionProperty;
  value: "yes" | "no";
  /** When the user answered (ISO time). */
  answeredAt: string;
}

export interface UploadResult {
  mode: "upload" | "dry-run";
  server: string;
  changesetId: number | null;
  /** Answers written to OSM (or, in a dry run, that would have been). */
  applied: StreetAnswer[];
  skipped: Array<{ wayId: number; reason: string }>;
  /** Dry run only: the way documents that would have been sent. */
  preview?: string[];
}

interface OsmWay {
  id: number;
  version: number;
  nodes: number[];
  tags?: Record<string, string>;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

const tagXml = (tags: Record<string, string>) =>
  Object.entries(tags).map(([k, v]) => `<tag k="${xmlEscape(k)}" v="${xmlEscape(v)}"/>`).join("");

export function changesetXml(comment: string): string {
  return `<osm><changeset>${tagXml({ created_by: CREATED_BY, comment, source: "survey" })}</changeset></osm>`;
}

export function wayXml(way: OsmWay, changesetId: number): string {
  const nodes = way.nodes.map((n) => `<nd ref="${n}"/>`).join("");
  return `<osm><way id="${way.id}" version="${way.version}" changeset="${changesetId}">${nodes}${tagXml(way.tags ?? {})}</way></osm>`;
}

const COMMENTS: Record<QuestionProperty, string> = {
  lit: "Street lighting surveyed on foot",
};

/** Last answer per (way, property) wins. */
function latest(answers: StreetAnswer[]): StreetAnswer[] {
  const m = new Map<string, StreetAnswer>();
  for (const a of answers) m.set(`${a.wayId}:${a.property}`, a);
  return [...m.values()];
}

export async function uploadAnswers(cfg: OsmConfig, token: string, answers: StreetAnswer[], fetchFn: Fetch = fetch): Promise<UploadResult> {
  const readBase = cfg.upload ? cfg.server : LIVE_API;
  const result: UploadResult = { mode: cfg.upload ? "upload" : "dry-run", server: cfg.upload ? cfg.server : LIVE_API, changesetId: null, applied: [], skipped: [] };
  if (!cfg.upload) result.preview = [];

  const readWay = async (id: number): Promise<OsmWay | null> => {
    const res = await fetchFn(`${readBase}/api/0.6/way/${id}.json`, { headers: cfg.upload ? auth(token) : {} });
    if (res.status === 404 || res.status === 410) return null;
    await check(res, `reading way ${id}`);
    const data = (await res.json()) as { elements?: OsmWay[] };
    return data.elements?.find((e) => e.id === id) ?? null;
  };

  const openChangeset = async (): Promise<number> => {
    const comment = [...new Set(answers.map((a) => COMMENTS[a.property]))].join("; ");
    const res = await check(
      await fetchFn(`${cfg.server}/api/0.6/changeset/create`, {
        method: "PUT",
        headers: { ...auth(token), "Content-Type": "text/xml" },
        body: changesetXml(comment),
      }),
      "opening a changeset",
    );
    return Number((await res.text()).trim());
  };

  try {
    for (const a of latest(answers)) {
      // A version conflict means the way changed in the meantime: read it again and retry once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const way = await readWay(a.wayId);
        if (!way) {
          result.skipped.push({ wayId: a.wayId, reason: "the street is no longer on OpenStreetMap" });
          break;
        }
        const existing = way.tags?.[a.property];
        if (existing !== undefined) {
          result.skipped.push({
            wayId: a.wayId,
            reason: existing === a.value ? "already recorded" : `already recorded as ${a.property}=${existing} by someone else`,
          });
          break;
        }
        const changed: OsmWay = { ...way, tags: { ...(way.tags ?? {}), [a.property]: a.value } };
        if (!cfg.upload) {
          result.preview!.push(wayXml(changed, 0));
          result.applied.push(a);
          break;
        }
        result.changesetId ??= await openChangeset();
        const res = await fetchFn(`${cfg.server}/api/0.6/way/${a.wayId}`, {
          method: "PUT",
          headers: { ...auth(token), "Content-Type": "text/xml" },
          body: wayXml(changed, result.changesetId),
        });
        if (res.status === 409 && attempt === 0) continue;
        if (res.status === 409) {
          result.skipped.push({ wayId: a.wayId, reason: "the street was being changed by someone else" });
          break;
        }
        await check(res, `updating way ${a.wayId}`);
        result.applied.push(a);
        break;
      }
    }
  } finally {
    if (result.changesetId != null) {
      // Closing is best effort: OSM closes idle changesets on its own after an hour.
      await fetchFn(`${cfg.server}/api/0.6/changeset/${result.changesetId}/close`, { method: "PUT", headers: auth(token) }).catch(() => undefined);
    }
  }
  return result;
}
