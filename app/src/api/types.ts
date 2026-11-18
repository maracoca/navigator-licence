// Mirrors docs/api.md. Keep in sync with the server contract.

export type Pace = 'quick' | 'normal' | 'long';
export type StreetMode = 'prefer' | 'require';
export type PlaceSource = 'google' | 'osm' | 'both';
export type SkipReason =
  | 'no_candidates'
  | 'unreachable'
  | 'over_budget'
  | 'optional_too_far'
  | 'closed';

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: boolean;
  city: string;
  bbox: { south: number; west: number; north: number; east: number };
  /** Street preferences the app may offer for adding on the review screen */
  streetProperties: StreetProperty[];
}

export interface StreetProperty {
  id: string;
  label: string;
}

export interface OsmPreset {
  presetId: string;
  name: string;
  tags: Record<string, string>;
}

export interface Item {
  id: string;
  phrase: string;
  label: string;
  /** 1-3 plain kinds of place used for searching */
  search: string[];
  details: string;
  osm: OsmPreset[];
  googleTypes: string[];
  required: boolean;
  order: number | null;
  count: number;
  pace: Pace;
  stayMinutes: number;
  /** true once the user edits stayMinutes; a fixed stay is never shortened */
  stayFixed: boolean;
}

export interface StreetPreference {
  property: string;
  label: string;
  mode: StreetMode;
}

export interface UnderstandRequest {
  request: string;
  /** Start and end as typed, so the server does not mistake them for stops. */
  origin?: string;
  destination?: string;
}

export interface UnderstandResponse {
  items: Item[];
  street: StreetPreference[];
  notices: string[];
}

export type PlaceInput =
  | { text: string }
  | { lat: number; lng: number; label: string };

export interface PlanRequest {
  origin: PlaceInput;
  destination: PlaceInput;
  budgetMinutes: number | null;
  departAt?: string;
  items: Item[];
  street: StreetPreference[];
}

export interface NamedPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface Stop {
  itemId: string;
  label: string;
  name: string;
  lat: number;
  lng: number;
  source: PlaceSource;
  rating: number | null;
  /** Number of Google reviews behind the rating. */
  ratingCount?: number | null;
  address: string | null;
  /** The item's wish when this place was confirmed to fit it ("modern"), otherwise null. */
  wishConfirmed?: string | null;
  stayMinutes: number;
  arriveMinute: number;
}

export interface Leg {
  /** [lat, lng] pairs */
  points: [number, number][];
  meters: number;
  minutes: number;
}

export interface Totals {
  walkMinutes: number;
  stayMinutes: number;
  totalMinutes: number;
  budgetMinutes: number | null;
  withinBudget: boolean;
  staysShortened: boolean;
  shortestWalkMinutes: number;
}

export interface Coverage {
  property: string;
  label: string;
  goodWord: string;
  badWord: string;
  goodPercent: number;
  badPercent: number;
  unknownPercent: number;
}

export interface Skipped {
  itemId: string;
  label: string;
  reason: SkipReason;
  message: string;
  cityCount: number | null;
}

export interface PlanResponse {
  origin: NamedPoint;
  destination: NamedPoint;
  stops: Stop[];
  legs: Leg[];
  totals: Totals;
  coverage: Coverage[];
  skipped: Skipped[];
  notices: string[];
}
