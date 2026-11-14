# Walk planner

Plan a walk between two points that includes the things you want to do on the way, within the time you have:

> *From the train station to Central Park in 90 minutes: visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please.*

- `server/` — Node + TypeScript API: understands the request, finds places, routes on an offline street graph, plans the stops.
- `app/` — Expo app (runs in **Expo Go**, so it can be tested on an iPhone from Windows).
- `docs/api.md` — the API between them.

## How it works

1. **City data (once per city).** `npm run build:city -- <city>` downloads an OSM extract (Geofabrik), cuts the city's area, and saves the walkable street graph (with the street tags the app supports) and every OSM place that matches an iD preset. No map API is called at request time. Cities are listed in `server/config/cities.json`.
2. **Vocabularies (once).** `npm run build:presets` embeds the ~1,300 OSM kinds of place (iD tagging schema: names and search terms written by OSM contributors) and Google's place types.
3. **Understanding.** One LLM call turns the sentence into items with labels only (required/optional, order, count, quick/normal/long, typical visit length) and street preferences chosen from a fixed menu. Each item's plain search phrases are matched to real OSM kinds and Google types by embedding similarity; when the best match is not clearly ahead, the LLM chooses among the candidates only.
4. **Review.** The app shows the items as editable cards.
5. **Places.** OSM places from the city file plus Google Text Search results inside the reachable area; the same place from both sources is merged.
6. **Planning.** An exact dynamic-programming planner chooses the stops and order: required stops first, optional stops only if they add little walking, the requested order, walking + stays within the budget, places open when you arrive.
7. **Streets.** Without street preferences the shortest walk is used. "Prefer" preferences take the walk with the most good streets among walks at most 12% longer than the shortest (Quercia et al. 2014); "require" removes bad streets. The result reports how much of the walk is good, bad or unknown for each requested property.

Every number used is in `server/src/params.ts` with its source or marked as assumed.

## Run it

### Server
```bash
cd server
npm install
cp .env.example .env            # fill in OPENAI_API_KEY and GOOGLE_PLACES_API_KEY
npm run build:city -- cluj-napoca   # ~1 min, downloads ~330 MB the first time
npm run build:presets           # ~15 s
npm start                       # http://0.0.0.0:3000
npm test                        # unit tests
```

`API_CACHE=record` (default) saves every OpenAI and Google answer under `server/data/api-cache/`; `API_CACHE=replay` uses only saved answers, so test runs repeat exactly.

### App on an iPhone
See `app/README.md`. In short: install **Expo Go** from the App Store, put `EXPO_PUBLIC_API_URL=http://<your PC's LAN IP>:3000` in `app/.env.local`, run `npx expo start` in `app/`, scan the QR code. Phone and PC must be on the same Wi-Fi. `EXPO_PUBLIC_MOCK=1` runs the app without the server.

### Add a city
Add an entry (id, name, Geofabrik extract URL, bounding box) to `server/config/cities.json`, run `npm run build:city -- <id>`, and start the server with `CITY=<id>`.
