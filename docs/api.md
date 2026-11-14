# Server API

Base URL: `http://<computer LAN IP>:3000`. JSON in, JSON out. Errors: HTTP 4xx/5xx with `{ "error": string }`.

The app works in two steps:
1. **Understand**: send the sentence and get back editable items (the review cards).
2. **Plan**: send the (possibly edited) items with origin, destination and time, and get back the route.

## `GET /api/health`
`{ "ok": true, "city": "Cluj-Napoca", "bbox": { south, west, north, east }, "streetProperties": [ { "id": "lit", "label": "Lit streets" } ] }`

`streetProperties` is the menu of street preferences the app may offer (the user can add one on the review screen).

## `POST /api/understand`
Request: `{ "request": "Visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please." }`

Response:
```jsonc
{
  "items": [
    {
      "id": "i1",
      "phrase": "a museum",            // the user's words
      "label": "Museum",               // display name of the kind of place
      "search": ["museum"],            // 1-3 plain kinds of place used for searching ("charge my phone" -> ["cafe", "library"])
      "details": "",                   // extra wishes, e.g. "catholic", "cheap"
      "osm": [ { "presetId": "tourism/museum", "name": "Museum", "tags": { "tourism": "museum" } } ],  // may be empty
      "googleTypes": ["museum"],       // may be empty when Google has no such category (e.g. a bench)
      "required": true,                // false = only if it's along the way
      "order": 1,                      // null = any order
      "count": 1,
      "pace": "normal",                // "quick" | "normal" | "long"
      "stayMinutes": 60,               // editable on the card; this is the value the planner uses
      "stayFixed": false               // set to true when the user edits stayMinutes: a fixed stay is never shortened
    }
  ],
  "street": [
    { "property": "lit", "label": "Lit streets", "mode": "prefer" }   // mode: "prefer" | "require"
  ],
  "notices": ["Shady streets are not supported yet."]
}
```

## `POST /api/plan`
Request:
```jsonc
{
  "origin": { "text": "Gara Cluj-Napoca" },             // or { "lat": 46.78, "lng": 23.59, "label": "My location" }
  "destination": { "text": "Parcul Central" },
  "budgetMinutes": 90,                                  // or null
  "departAt": "2026-11-14T15:00:00+02:00",              // optional, default now
  "items": [ /* items from /api/understand, possibly edited */ ],
  "street": [ /* street preferences, possibly edited */ ]
}
```

Response:
```jsonc
{
  "origin": { "name": "Gara Cluj-Napoca", "lat": 46.78, "lng": 23.58 },
  "destination": { "name": "Parcul Central", "lat": 46.77, "lng": 23.57 },
  "stops": [
    {
      "itemId": "i1", "label": "Museum",
      "name": "Muzeul de Artă", "lat": 46.77, "lng": 23.59,
      "source": "google",                 // "google" | "osm" | "both"
      "rating": 4.6,                       // or null
      "address": "Piața Unirii 30",       // or null
      "stayMinutes": 52,
      "arriveMinute": 14                   // minutes after departure
    }
  ],
  "legs": [ { "points": [[46.78, 23.58], [46.779, 23.581]], "meters": 1200, "minutes": 14 } ],  // stops.length + 1 legs
  "totals": {
    "walkMinutes": 28, "stayMinutes": 62, "totalMinutes": 90,
    "budgetMinutes": 90, "withinBudget": true, "staysShortened": true,
    "shortestWalkMinutes": 25            // walking with no preferences and no stops
  },
  "coverage": [
    { "property": "lit", "label": "Lit streets", "goodWord": "lit", "badWord": "unlit", "goodPercent": 60, "badPercent": 10, "unknownPercent": 30 }
  ],
  "skipped": [
    { "itemId": "i3", "label": "Bench", "reason": "optional_too_far",
      "message": "Skipped the bench: every option adds more than 5 minutes of walking.",
      "cityCount": 40 }                    // OSM places of this kind mapped in the whole city, or null
  ],
  "notices": []
}
```

`reason` is one of: `no_candidates`, `unreachable`, `over_budget`, `optional_too_far`, `closed`.

Notes:
- `pace` is informational (it was used to compute the first `stayMinutes`); the planner uses `stayMinutes` and `stayFixed`. `order` and `count` are used as sent.
- `budgetMinutes: null` means no time limit; then `withinBudget` is `true`.
- Stays shortened to fit are reported only by `totals.staysShortened` (no notice).
- `/api/plan` answers 200 even when items are skipped (they are in `skipped`). It answers 400 when the start or end cannot be found or is outside the city's map.
- `stops` are in visiting order and `legs[k]` leads to `stops[k]` (the last leg to the end). A place appears at most once.
