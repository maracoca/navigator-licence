/** Google Places API (New) Text Search, for businesses and for finding the start and end. */
import { cached } from "../apiCache.js";
import type { BBox } from "../data/cityTypes.js";
import { PARAMS } from "../params.js";

const URL = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "places.regularOpeningHours.periods",
  "places.utcOffsetMinutes",
].join(",");
/** Short description; asked for only when a wish has to be checked (it is a pricier field). */
const SUMMARY_FIELD = "places.editorialSummary";

export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface GooglePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  /** Number of Google reviews behind the rating. */
  ratingCount: number | null;
  address: string | null;
  types: string[];
  /** null = hours unknown. */
  periods: OpeningPeriod[] | null;
  utcOffsetMinutes: number | null;
  summary: string | null;
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  regularOpeningHours?: { periods?: OpeningPeriod[] };
  utcOffsetMinutes?: number;
  editorialSummary?: { text?: string };
}

function apiKey(): string {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return k;
}

async function searchText(body: Record<string, unknown>, withSummary = false): Promise<RawPlace[]> {
  const fields = withSummary ? `${FIELDS},${SUMMARY_FIELD}` : FIELDS;
  const out = await cached("google-text-search", { body, fields }, async () => {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": fields },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { places?: RawPlace[] }).places ?? [];
  });
  return out;
}

function toPlace(p: RawPlace): GooglePlace | null {
  if (!p.id || p.location?.latitude == null || p.location?.longitude == null) return null;
  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return null;
  return {
    id: `google:${p.id}`,
    name: p.displayName?.text ?? "Unnamed place",
    lat: p.location.latitude,
    lng: p.location.longitude,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    address: p.shortFormattedAddress ?? p.formattedAddress ?? null,
    types: [...new Set([p.primaryType, ...(p.types ?? [])].filter((t): t is string => !!t))],
    periods: p.regularOpeningHours?.periods ?? null,
    utcOffsetMinutes: p.utcOffsetMinutes ?? null,
    summary: p.editorialSummary?.text ?? null,
  };
}

const rectangle = (b: BBox) => ({
  rectangle: { low: { latitude: b.south, longitude: b.west }, high: { latitude: b.north, longitude: b.east } },
});

/**
 * Places of one Google type inside the area. The text is the person's wish
 * plus their own phrase for the place ("modern" + "art museum"), so Google
 * ranks by what they asked; the type keeps unrelated places out.
 */
export async function searchPlaces(type: string, text: string, area: BBox, withSummary: boolean): Promise<GooglePlace[]> {
  const raw = await searchText(
    {
      textQuery: text,
      includedType: type,
      strictTypeFiltering: true,
      locationRestriction: rectangle(area),
      pageSize: PARAMS.googleResultsPerSearch.value,
    },
    withSummary,
  );
  return raw.map(toPlace).filter((p): p is GooglePlace => p !== null);
}

/** Areas (a whole city, county, country) are not a point to walk from or to. */
const AREA_TYPES = new Set(["locality", "political", "country", "administrative_area_level_1", "administrative_area_level_2", "administrative_area_level_3", "sublocality", "postal_code"]);

/**
 * Start or end typed as text: Google's best match near the city that is a
 * place, not a whole area. "Gara Cluj-Napoca" should be the station, not the city.
 */
export async function findLocation(text: string, city: BBox): Promise<GooglePlace | null> {
  const raw = await searchText({ textQuery: text, locationBias: rectangle(city), pageSize: 5 });
  const places = raw.map(toPlace).filter((p): p is GooglePlace => p !== null);
  return places.find((p) => !p.types.every((t) => AREA_TYPES.has(t) || t === "geocode")) ?? places[0] ?? null;
}

// ─── Opening hours ──────────────────────────────────────────────────────────

const WEEK = 7 * 24 * 60;

/**
 * Is the place open for the whole interval? `startUtcMs` is departure time;
 * arrive/stay are minutes after it. Unknown hours count as open.
 */
export function openFor(place: GooglePlace, startUtcMs: number, arriveMinute: number, stayMinutes: number): boolean {
  if (!place.periods || place.periods.length === 0 || place.utcOffsetMinutes == null) return true;
  // A single period without a close time means open around the clock.
  if (place.periods.length === 1 && !place.periods[0].close) return true;

  const local = new Date(startUtcMs + place.utcOffsetMinutes * 60000);
  const nowWeekMinute = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const from = (nowWeekMinute + arriveMinute) % WEEK;
  const to = from + stayMinutes;

  for (const p of place.periods) {
    if (!p.close) continue;
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let c = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (c <= o) c += WEEK;
    // Check this period and the same period one week earlier (for wrap-around).
    for (const shift of [0, -WEEK]) {
      if (from >= o + shift && to <= c + shift) return true;
    }
  }
  return false;
}
