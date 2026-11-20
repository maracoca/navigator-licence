# Walk planner

Plan a walk between two points that includes the things you want to do on the way, within the time you have:

> *From the train station to Central Park in 90 minutes: visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please.*

- `server/` — Node + TypeScript API: understands the request, finds places, routes on an offline street graph, plans the stops.
- `app/` — Expo app (runs in **Expo Go**, so it can be tested on an iPhone from Windows).
- `docs/api.md` — the API between them.
- `docs/experiments.md` — every experiment and measurement, with what changed because of it (E1, E2, …).
- `docs/street-tags-*.md` — how often each street tag is mapped, worldwide and per city.
- `eval/` — the dev and test sets, their instructions (`eval/README.md`) and every evaluation run (`eval/runs/`).
- `eval/planner-runs/` — planner benchmark results (tables, numbers and the test problems).

## How it works

1. **City data (once per city).** `npm run build:city -- <city>` downloads an OSM extract (Geofabrik), cuts the city's area, and saves the walkable street graph (with the street tags the app supports) and every OSM place that matches an iD preset. No map API is called at request time. Cities are listed in `server/config/cities.json` (built so far: Cluj-Napoca, Berlin, Paris).
2. **Vocabularies (once).** `npm run build:presets` embeds the ~1,300 OSM kinds of place (iD tagging schema: names and search terms written by OSM contributors) and Google's place types.
3. **Understanding.** One LLM call (`gpt-6-luna`, see `.env.example`) turns the sentence into items with labels only (required/optional, order, count, quick/normal/long, typical visit length, wishes such as "catholic") and street preferences chosen from a fixed menu. The start and end are given to the model so they are not taken for stops. Each item's plain search phrases are matched to real OSM kinds and Google types by embedding similarity; when the best match is not clearly ahead, the LLM chooses among the candidates only.
4. **Review.** The app shows the items as editable cards.
5. **Places.** OSM places from the city file plus Google Text Search results inside the reachable area; the same place from both sources is merged. Shortlist per item: the places closest to the route plus the best-rated ones. Ratings are adjusted for the number of reviews (a Bayesian average), so a 5★ from one review does not beat a 4.5★ from a thousand; places without a rating count as average. For items with a wish, candidates are checked against it from their map facts only.
6. **Planning.** An exact planner (dynamic programming that keeps every way not beaten on both time and score) chooses the stops and order: required stops first, optional stops only if they add little walking, the requested order, walking + stays within the budget, places open on arrival (Google opening hours). It is checked against brute force and compared with greedy, insertion and local-search planners (`npm run bench:planner`).
7. **Streets.** Street preferences come from a menu chosen by measured tag usage: lit, paved & smooth, no stairs, little traffic, sidewalks. Without preferences the shortest walk is used. "Require" removes bad streets. "Prefer" works in one of two modes: *joint* (default: stops and walks are chosen on preference-shaped routes, good streets counting shorter) or *separate* (stops chosen on walking time, then each walk takes the most good streets within 12 % extra length, Quercia et al. 2014). Joint was chosen after measuring both in Cluj, Berlin and Paris (E19, E20). The result reports how much of the walk is good, bad or unknown for each requested property.

8. **Street questions (OpenStreetMap users).** During the walk ("Start walk"), users logged in to OpenStreetMap are sometimes asked, Waze-style, whether the street they are on is lit, only for streets whose lighting is unknown. Answers are uploaded to OSM in the user's own name and used by the app at once. Off unless an OSM app is registered (`OSM_CLIENT_ID`, see `server/.env.example` and `docs/api.md`); dry run unless `OSM_UPLOAD=on`. Needs a city built with OSM way ids (rebuild older cities).

Every number used is in `server/src/params.ts` with its source or marked as assumed.

## Run it

### Server
```bash
cd server
npm install
cp .env.example .env                 # fill in OPENAI_API_KEY and GOOGLE_PLACES_API_KEY
npm run build:city -- cluj-napoca    # ~1 min, downloads ~330 MB the first time
npm run build:presets                # ~15 s
npm start                            # http://0.0.0.0:3000 (CITY=<id> for another built city)
npm test                             # unit tests
```

`API_CACHE=record` (default) saves every OpenAI and Google answer under `server/data/api-cache/`; `API_CACHE=replay` uses only saved answers, so runs repeat exactly. Keep a copy of that folder with the results you cite: it is not in git.

### Evaluation and measurements (in `server/`)
| Command | What it does |
|---|---|
| `npm run eval:check -- --set dev` | checks a case file's format (no API calls) |
| `npm run eval -- --set dev` (`--replay`) | runs the dev or test set end to end and saves the run in `eval/runs/` |
| `npm run bench:planner` (`--pairs 15`, `CITY=<id>`) | planner benchmark: brute force, greedy, insertion, local search, exact; separate vs joint street preferences |
| `npm run report:street-tags -- <city>` | tag coverage on a city's walkable streets → `docs/street-tags-<city>.md` |
| `npm run report:street-tags-world` | worldwide tag usage (OSM taginfo) → `docs/street-tags-world.md` |
| `npm run report:ratings -- <city>` | average Google rating in a city, from saved searches (for `ratingMean` in `cities.json`) |

### App on an iPhone
See `app/README.md`. In short: install **Expo Go** from the App Store, put `EXPO_PUBLIC_API_URL=http://<your PC's LAN IP>:3000` in `app/.env.local`, run `npx expo start` in `app/`, scan the QR code. Phone and PC must be on the same Wi-Fi. `EXPO_PUBLIC_MOCK=1` runs the app without the server.

### Add a city
Add an entry (id, name, Geofabrik extract URL, bounding box) to `server/config/cities.json`, run `npm run build:city -- <id>`, and start the server with `CITY=<id>`. Large, well-mapped cities need more memory: `NODE_OPTIONS=--max-old-space-size=6144`.
