/** Shapes shared by the API, the understanding step and the planner (see docs/api.md). */
import type { StreetPropertyId } from "./routing/streetProperties.js";

export type Pace = "quick" | "normal" | "long";
export type TypicalVisit = "brief" | "short" | "medium" | "long";

export interface OsmKind {
  presetId: string;
  name: string;
  tags: Record<string, string>;
}

export interface Item {
  id: string;
  phrase: string;
  label: string;
  search: string[];
  details: string;
  osm: OsmKind[];
  googleTypes: string[];
  required: boolean;
  order: number | null;
  count: number;
  pace: Pace;
  stayMinutes: number;
  /** True when the user stated or edited the stay, or marked it quick/long; such a stay is never shortened. */
  stayFixed: boolean;
}

export interface StreetPreference {
  property: StreetPropertyId;
  label: string;
  /** require = streets with a bad value are not used; prefer = favoured within the allowed extra length. */
  mode: "prefer" | "require";
}

export interface Understanding {
  items: Item[];
  street: StreetPreference[];
  notices: string[];
}
