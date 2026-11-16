// Fixture responses (Cluj-Napoca) so the whole flow works without the server.
// The understand fixture ignores the sentence; the plan fixture reacts to edits
// (removed items, stay minutes, required flags, budget, street preferences).
import type {
  Coverage,
  HealthResponse,
  Item,
  Leg,
  NamedPoint,
  PlaceInput,
  PlanRequest,
  PlanResponse,
  Skipped,
  Stop,
  UnderstandRequest,
  UnderstandResponse,
} from './types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockUnderstand(_body: UnderstandRequest): Promise<UnderstandResponse> {
  await delay(600);
  return {
    items: [
      {
        id: 'i1',
        phrase: 'a museum',
        label: 'Museum',
        search: ['museum'],
        details: '',
        osm: [{ presetId: 'tourism/museum', name: 'Museum', tags: { tourism: 'museum' } }],
        googleTypes: ['museum'],
        required: true,
        order: 1,
        count: 1,
        pace: 'normal',
        stayMinutes: 60,
        stayFixed: false,
      },
      {
        id: 'i2',
        phrase: 'a quick coffee',
        label: 'Cafe',
        search: ['cafe'],
        details: '',
        osm: [{ presetId: 'amenity/cafe', name: 'Cafe', tags: { amenity: 'cafe' } }],
        googleTypes: ['cafe'],
        required: true,
        order: 2,
        count: 1,
        pace: 'quick',
        stayMinutes: 10,
        stayFixed: false,
      },
      {
        id: 'i3',
        phrase: "sit on a bench if there's one along the way",
        label: 'Bench',
        search: ['bench'],
        details: '',
        osm: [{ presetId: 'amenity/bench', name: 'Bench', tags: { amenity: 'bench' } }],
        googleTypes: [],
        required: false,
        order: null,
        count: 1,
        pace: 'normal',
        stayMinutes: 10,
        stayFixed: false,
      },
    ],
    street: [{ property: 'lit', label: 'Lit streets', mode: 'prefer' }],
    notices: [],
  };
}

export const MOCK_HEALTH: HealthResponse = {
  ok: true,
  city: 'Cluj-Napoca',
  bbox: { south: 46.73, west: 23.5, north: 46.81, east: 23.7 },
  streetProperties: [
    { id: 'lit', label: 'Lit streets' },
    { id: 'paved', label: 'Paved, smooth paths' },
    { id: 'no_steps', label: 'No stairs' },
    { id: 'quiet', label: 'Little traffic' },
    { id: 'sidewalk', label: 'Sidewalks' },
  ],
};

const COVERAGE: Record<string, Omit<Coverage, 'property' | 'label'>> = {
  lit: { goodWord: 'lit', badWord: 'unlit', goodPercent: 60, badPercent: 10, unknownPercent: 30 },
  paved: { goodWord: 'paved', badWord: 'unpaved', goodPercent: 85, badPercent: 5, unknownPercent: 10 },
  no_steps: { goodWord: 'without steps', badWord: 'with steps', goodPercent: 70, badPercent: 5, unknownPercent: 25 },
  quiet: { goodWord: 'car-free or residential', badWord: 'along main roads', goodPercent: 75, badPercent: 15, unknownPercent: 10 },
  sidewalk: { goodWord: 'with a sidewalk or car-free', badWord: 'no sidewalk', goodPercent: 55, badPercent: 10, unknownPercent: 35 },
};

const STATION: NamedPoint = { name: 'Gara Cluj-Napoca', lat: 46.7845, lng: 23.5862 };
const PARK: NamedPoint = { name: 'Parcul Central', lat: 46.7682, lng: 23.579 };

const PLACES: Record<string, Omit<Stop, 'itemId' | 'label' | 'stayMinutes' | 'arriveMinute'>> = {
  museum: {
    name: 'Muzeul de Artă Cluj-Napoca',
    lat: 46.7699,
    lng: 23.5897,
    source: 'both',
    rating: 4.6,
    address: 'Piața Unirii 30',
  },
  cafe: {
    name: 'Olivo',
    lat: 46.772,
    lng: 23.5867,
    source: 'google',
    rating: 4.5,
    address: 'Piața Muzeului 6',
  },
  bench: {
    name: 'Bench',
    lat: 46.7708,
    lng: 23.5826,
    source: 'osm',
    rating: null,
    address: null,
  },
};

function resolvePlace(p: PlaceInput, fallback: NamedPoint): NamedPoint {
  if ('lat' in p) return { name: p.label, lat: p.lat, lng: p.lng };
  return { ...fallback, name: p.text.trim() || fallback.name };
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A two-segment "street-like" path: go along one axis, then the other.
function makeLeg(a: [number, number], b: [number, number]): Leg {
  const corner: [number, number] = [b[0], a[1]];
  const points: [number, number][] = [a, corner, b];
  const meters = Math.round(haversine(a, corner) + haversine(corner, b));
  return { points, meters, minutes: Math.max(1, Math.round(meters / 80)) };
}

export async function mockPlan(body: PlanRequest): Promise<PlanResponse> {
  await delay(1200);
  const origin = resolvePlace(body.origin, STATION);
  const destination = resolvePlace(body.destination, PARK);

  const ordered = [...body.items].sort(
    (x, y) => (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER),
  );

  const skipped: Skipped[] = [];
  const chosen: { item: Item; place: (typeof PLACES)[string] }[] = [];
  for (const item of ordered) {
    const kind = item.search.map((k) => k.toLowerCase()).find((k) => k in PLACES);
    const place = kind ? PLACES[kind] : undefined;
    if (!place) {
      skipped.push({
        itemId: item.id,
        label: item.label,
        reason: 'no_candidates',
        message: `Could not find any ${item.label.toLowerCase()} near your route.`,
        cityCount: null,
      });
    } else if (kind === 'bench' && !item.required) {
      skipped.push({
        itemId: item.id,
        label: item.label,
        reason: 'optional_too_far',
        message: 'Skipped the bench: every option adds more than 5 minutes of walking.',
        cityCount: 40,
      });
    } else {
      chosen.push({ item, place });
    }
  }

  const waypoints: [number, number][] = [
    [origin.lat, origin.lng],
    ...chosen.map((c) => [c.place.lat, c.place.lng] as [number, number]),
    [destination.lat, destination.lng],
  ];
  const legs = waypoints.slice(1).map((p, i) => makeLeg(waypoints[i], p));
  const walkMinutes = legs.reduce((s, l) => s + l.minutes, 0);

  let stays = chosen.map((c) => c.item.stayMinutes);
  let staysShortened = false;
  const budget = body.budgetMinutes;
  const total = stays.reduce((s, m) => s + m, 0);
  // Fixed stays are never shortened; only the flexible ones shrink to fit.
  const fixed = chosen.reduce((s, c, i) => s + (c.item.stayFixed ? stays[i] : 0), 0);
  const flexible = total - fixed;
  if (budget !== null && walkMinutes + total > budget && flexible > 0) {
    const available = Math.max(0, budget - walkMinutes - fixed);
    stays = stays.map((m, i) =>
      chosen[i].item.stayFixed ? m : Math.min(m, Math.max(5, Math.floor((m * available) / flexible))),
    );
    staysShortened = stays.some((m, i) => m < chosen[i].item.stayMinutes);
  }
  const stayMinutes = stays.reduce((s, m) => s + m, 0);
  const totalMinutes = walkMinutes + stayMinutes;

  let clock = 0;
  const stops: Stop[] = chosen.map((c, i) => {
    clock += legs[i].minutes;
    const stop: Stop = {
      itemId: c.item.id,
      label: c.item.label,
      ...c.place,
      stayMinutes: stays[i],
      arriveMinute: clock,
    };
    clock += stays[i];
    return stop;
  });

  const coverage: Coverage[] = body.street.map((s) => {
    const c = COVERAGE[s.property] ?? COVERAGE.lit;
    return { property: s.property, label: s.label, ...c };
  });

  const direct = makeLeg([origin.lat, origin.lng], [destination.lat, destination.lng]);
  const notices: string[] = [];

  return {
    origin,
    destination,
    stops,
    legs,
    totals: {
      walkMinutes,
      stayMinutes,
      totalMinutes,
      budgetMinutes: budget,
      withinBudget: budget === null || totalMinutes <= budget,
      staysShortened,
      shortestWalkMinutes: direct.minutes,
    },
    coverage,
    skipped,
    notices,
  };
}
