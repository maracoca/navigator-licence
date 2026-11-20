# Server API

Base URL: `http://<computer LAN IP>:3000`. JSON in, JSON out. Errors: HTTP 4xx/5xx with `{ "error": string }`.

The app works in two steps:
1. **Understand**: send the sentence and get back editable items (the review cards).
2. **Plan**: send the (possibly edited) items with origin, destination and time, and get back the route.

## `GET /api/health`
`{ "ok": true, "city": "Cluj-Napoca", "bbox": { south, west, north, east }, "streetProperties": [ { "id": "lit", "label": "Lit streets" } ] }`

`streetProperties` is the menu of street preferences the app may offer (the user can add one on the review screen).

## `POST /api/understand`
Request: `{ "request": "Visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please.", "origin": "Gara Cluj-Napoca", "destination": "Parcul Central" }`

`origin` and `destination` are optional: the start and end as the user typed them (leave `origin` out for "my location"). They let the server tell the endpoints apart from stops ("before heading to the mall" when the mall is the end of the walk).

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
  "notices": ["Shady streets are not supported yet."],
  "unsupported": ["shady"]             // street wishes not on the menu, raw (also in notices); used by the evaluation
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
      "rating": 4.6,                       // Google's rating as shown to people, or null
      "ratingCount": 1303,                 // number of Google reviews behind it, or null
      "address": "Piața Unirii 30",       // or null
      "wishConfirmed": "modern",          // the item's wish when this place was confirmed to fit it, else null
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
  "notices": [],
  "questions": {                         // streets of this walk the app may ask about (lighting unknown)
    "rules": { "maxPerWalk": 3, "minGapSeconds": 180, "showSeconds": 10, "minWalkedMeters": 30, "nearWayMeters": 25 },
    "streets": [
      { "wayId": 13341852, "property": "lit", "name": "Strada Ilie Măcelaru", "meters": 119,
        "segments": [[[46.768, 23.585], [46.767, 23.586]]] }   // walked parts of the OSM way, [lat, lng]
    ]                                    // empty when the city was built without OSM way ids
  }
}
```

`reason` is one of: `no_candidates`, `no_match` (places found, but none fits the item's wish/details), `unreachable`, `over_budget`, `optional_too_far`, `closed`.

Notes:
- `pace` is informational (it was used to compute the first `stayMinutes`); the planner uses `stayMinutes` and `stayFixed`. `order` and `count` are used as sent.
- `budgetMinutes: null` means no time limit; then `withinBudget` is `true`.
- Stays shortened to fit are reported only by `totals.staysShortened` (no notice).
- `/api/plan` answers 200 even when items are skipped (they are in `skipped`). It answers 400 when the start or end cannot be found or is outside the city's map.
- `stops` are in visiting order and `legs[k]` leads to `stops[k]` (the last leg to the end). A place appears at most once.

## OpenStreetMap street questions

Users logged in to OpenStreetMap are asked during the walk whether a street is lit; answers are uploaded in their
own name (one changeset per walk) and also kept in `server/data/street-answers.jsonl`, so the next plan uses them.
Off unless `OSM_CLIENT_ID` is set (see `server/.env.example`). `OSM_UPLOAD=on` uploads for real; otherwise a dry run
reads the way from the live OSM API, prepares the change and writes nothing.

### `GET /api/osm/config`
`{ "enabled": false }`, or `{ "enabled": true, "server": "https://master.apis.dev.openstreetmap.org", "upload": false, "authorizeUrl": "…" }`.
The app opens `authorizeUrl`; after approval OSM shows a code to copy (redirect `urn:ietf:wg:oauth:2.0:oob`).

### `POST /api/osm/login`
`{ "code": "…" }` → `{ "token": "…", "user": "display name" }`. The app keeps the token (secure storage) and sends it
with answers; the server keeps no session.

### `POST /api/osm/answers`
```jsonc
{ "token": "…", "answers": [ { "wayId": 13341852, "property": "lit", "value": "yes", "answeredAt": "2026-11-19T18:00:00Z" } ] }
```
→ `{ "mode": "upload" | "dry-run", "server": "…", "changesetId": 123 | null, "applied": [ …answers… ], "skipped": [ { "wayId": 1, "reason": "already recorded" } ] }`.
A way that already has the tag is never overwritten. 401 with `"osmLogin": true` when OSM rejects the token (log in again).
